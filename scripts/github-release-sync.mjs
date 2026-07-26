#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(SCRIPT_FILE), "..");
const GITHUB_API = "https://api.github.com";
const NPM_REGISTRY = "https://registry.npmjs.org";
const PUBLISH_WORKFLOW = ".github/workflows/publish.yml";
const PUBLISH_PREDICATE =
  "https://github.com/npm/attestation/tree/main/specs/publish/v0.1";
const SLSA_PREDICATE = "https://slsa.dev/provenance/v1";
const SEMVER_PATTERN =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

class RequestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

function requireValue(value, message) {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function validateRepository(repository) {
  const parts = String(repository ?? "").split("/");
  if (
    parts.length !== 2 ||
    parts.some(
      (part) =>
        !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..",
    )
  ) {
    throw new Error("GITHUB_REPOSITORY must be an owner/repository name");
  }
  return repository;
}

function validateCommit(commit, label = "commit") {
  if (!/^[0-9a-f]{40}$/i.test(commit ?? "")) {
    throw new Error(`${label} must be a full Git commit SHA`);
  }
  return commit.toLowerCase();
}

function validateVersion(version) {
  if (!SEMVER_PATTERN.test(version ?? "")) {
    throw new Error("package version must be valid SemVer");
  }
  return version;
}

function packageIdentity(packageName, version) {
  return `pkg:npm/${packageName}@${version}`;
}

function sha512FromIntegrity(integrity) {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity ?? "");
  if (!match) {
    throw new Error("published package must have sha512 integrity metadata");
  }
  const digest = Buffer.from(match[1], "base64");
  if (digest.length !== 64) {
    throw new Error("published package sha512 integrity digest is malformed");
  }
  return digest.toString("hex");
}

function decodeAttestation(attestation) {
  const encoded = attestation?.bundle?.dsseEnvelope?.payload;
  if (typeof encoded !== "string") {
    throw new Error("npm attestation is missing its DSSE payload");
  }
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("npm attestation DSSE payload is malformed");
  }
}

function validateSubject(payload, expectedName, expectedDigest) {
  const subject = payload?.subject?.find(
    (candidate) => candidate?.name === expectedName,
  );
  if (!subject || subject?.digest?.sha512 !== expectedDigest) {
    throw new Error(
      "npm attestation subject does not match the published package digest",
    );
  }
}

function provenanceCommit({
  attestations,
  defaultBranch,
  integrity,
  packageName,
  repository,
  version,
}) {
  const expectedName = packageIdentity(packageName, version);
  const expectedDigest = sha512FromIntegrity(integrity);
  const publishAttestation = attestations?.find(
    (candidate) => candidate?.predicateType === PUBLISH_PREDICATE,
  );
  const slsaAttestation = attestations?.find(
    (candidate) => candidate?.predicateType === SLSA_PREDICATE,
  );
  if (!publishAttestation || !slsaAttestation) {
    throw new Error(
      "published package must include npm publish and SLSA provenance attestations",
    );
  }

  const publishPayload = decodeAttestation(publishAttestation);
  const slsaPayload = decodeAttestation(slsaAttestation);
  if (
    publishPayload?.predicateType !== PUBLISH_PREDICATE ||
    slsaPayload?.predicateType !== SLSA_PREDICATE
  ) {
    throw new Error("npm attestation predicate type does not match its bundle");
  }
  validateSubject(publishPayload, expectedName, expectedDigest);
  validateSubject(slsaPayload, expectedName, expectedDigest);

  if (
    publishPayload?.predicate?.name !== packageName ||
    publishPayload?.predicate?.version !== version ||
    publishPayload?.predicate?.registry !== NPM_REGISTRY
  ) {
    throw new Error(
      "npm publish attestation identity does not match the release",
    );
  }

  const workflow =
    slsaPayload?.predicate?.buildDefinition?.externalParameters?.workflow;
  const expectedRepository = `https://github.com/${repository}`;
  if (
    String(workflow?.repository ?? "").toLowerCase() !==
      expectedRepository.toLowerCase() ||
    workflow?.path !== PUBLISH_WORKFLOW ||
    workflow?.ref !== `refs/heads/${defaultBranch}`
  ) {
    throw new Error(
      "SLSA provenance must identify this repository, publish workflow, and default branch",
    );
  }

  const dependency =
    slsaPayload?.predicate?.buildDefinition?.resolvedDependencies?.find(
      (candidate) =>
        String(candidate?.uri ?? "").toLowerCase() ===
        `git+${expectedRepository.toLowerCase()}@refs/heads/${defaultBranch.toLowerCase()}`,
    );
  return validateCommit(
    dependency?.digest?.gitCommit,
    "SLSA provenance commit",
  );
}

async function requestJson(
  url,
  { body, method = "GET", token } = {},
  fetchImplementation = fetch,
) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ultimate-agent-stack-release-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetchImplementation(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const detail =
      typeof parsed?.message === "string" ? `: ${parsed.message}` : "";
    throw new RequestError(
      `${method} ${new URL(url).pathname} failed with ${response.status}${detail}`,
      response.status,
    );
  }
  return parsed;
}

function repositoryApiUrl(repository, path) {
  return `${GITHUB_API}/repos/${repository}${path}`;
}

async function listReleases(repository, token, fetchImplementation = fetch) {
  const releases = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await requestJson(
      repositoryApiUrl(repository, `/releases?per_page=100&page=${page}`),
      { token },
      fetchImplementation,
    );
    if (!Array.isArray(batch)) {
      throw new Error("GitHub releases response must be an array");
    }
    releases.push(...batch);
    if (batch.length < 100) {
      return releases;
    }
  }
  throw new Error("GitHub release list exceeds the supported 1,000 releases");
}

async function tagCommit(repository, tag, token, fetchImplementation = fetch) {
  try {
    const commit = await requestJson(
      repositoryApiUrl(repository, `/commits/${encodeURIComponent(tag)}`),
      { token },
      fetchImplementation,
    );
    return validateCommit(commit?.sha, `tag ${tag} commit`);
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

function releaseCommit(release, resolvedTagCommit) {
  if (resolvedTagCommit) {
    return resolvedTagCommit;
  }
  if (!release?.draft) {
    throw new Error(
      `published release ${release?.tag_name} is missing its tag`,
    );
  }
  return validateCommit(
    release?.target_commitish,
    `draft release ${release?.tag_name} target`,
  );
}

async function prepareDraftRelease(
  { packageData, repository, sha, token },
  fetchImplementation = fetch,
) {
  validateRepository(repository);
  const commit = validateCommit(sha, "GITHUB_SHA");
  const packageName = requireValue(
    packageData?.name,
    "package name is required",
  );
  const version = validateVersion(packageData?.version);
  const tag = `v${version}`;
  const releases = await listReleases(repository, token, fetchImplementation);
  const existing = releases.find((release) => release?.tag_name === tag);
  if (existing) {
    const resolvedTag = await tagCommit(
      repository,
      tag,
      token,
      fetchImplementation,
    );
    if (releaseCommit(existing, resolvedTag) !== commit) {
      throw new Error(`${tag} already points at a different commit`);
    }
    return {
      action: existing.draft ? "draft-exists" : "release-exists",
      commit,
      tag,
    };
  }

  const resolvedTag = await tagCommit(
    repository,
    tag,
    token,
    fetchImplementation,
  );
  if (resolvedTag && resolvedTag !== commit) {
    throw new Error(`${tag} already points at a different commit`);
  }
  const release = await requestJson(
    repositoryApiUrl(repository, "/releases"),
    {
      body: {
        draft: true,
        generate_release_notes: true,
        name: `${packageName} ${version}`,
        prerelease: false,
        tag_name: tag,
        target_commitish: commit,
      },
      method: "POST",
      token,
    },
    fetchImplementation,
  );
  if (!release?.draft || release?.tag_name !== tag) {
    throw new Error("GitHub did not create the expected draft release");
  }
  return { action: "draft-created", commit, tag };
}

function attestationUrl(value) {
  const url = new URL(value);
  if (url.origin !== NPM_REGISTRY || url.username || url.password) {
    throw new Error("npm attestation URL must use the official HTTPS registry");
  }
  return url.toString();
}

function verifyNpmPackageSignatures(packageName, version) {
  const directory = mkdtempSync(join(tmpdir(), "uas-release-signature-"));
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    const npmConfig = join(directory, ".npmrc");
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify(
        {
          name: "ultimate-agent-stack-release-signature-audit",
          private: true,
          version: "1.0.0",
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(npmConfig, `registry=${NPM_REGISTRY}\n`);
    const environment = {
      ...process.env,
      NPM_CONFIG_AUDIT: "false",
      NPM_CONFIG_CACHE: join(directory, ".npm-cache"),
      NPM_CONFIG_FUND: "false",
      NPM_CONFIG_IGNORE_SCRIPTS: "true",
      NPM_CONFIG_USERCONFIG: npmConfig,
    };
    delete environment.GITHUB_TOKEN;
    delete environment.GH_TOKEN;
    delete environment.NODE_AUTH_TOKEN;
    delete environment.NPM_TOKEN;
    const install = spawnSync(
      npmExecutable,
      [
        "install",
        "--save-exact",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        `${packageName}@${version}`,
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: environment,
        maxBuffer: 1_000_000,
        shell: false,
        timeout: 120_000,
      },
    );
    if (install.status !== 0) {
      throw new Error(
        `could not install ${packageName}@${version} for signature verification`,
      );
    }
    const audit = spawnSync(
      npmExecutable,
      ["audit", "signatures", "--registry", NPM_REGISTRY],
      {
        cwd: directory,
        encoding: "utf8",
        env: environment,
        maxBuffer: 1_000_000,
        shell: false,
        timeout: 120_000,
      },
    );
    if (
      audit.status !== 0 ||
      !/verified registry signature/i.test(audit.stdout ?? "") ||
      !/verified attestation/i.test(audit.stdout ?? "")
    ) {
      throw new Error(
        `npm could not verify the registry signature and provenance for ${packageName}@${version}`,
      );
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

async function buildSyncPlan(
  { defaultBranch, packageData, registryData, releases, repository, token },
  fetchImplementation = fetch,
  signatureVerifier = verifyNpmPackageSignatures,
) {
  validateRepository(repository);
  requireValue(defaultBranch, "RELEASE_DEFAULT_BRANCH is required");
  const packageName = requireValue(
    packageData?.name,
    "package name is required",
  );
  const drafts = releases.filter(
    (release) =>
      release?.draft === true &&
      typeof release?.tag_name === "string" &&
      release.tag_name.startsWith("v") &&
      SEMVER_PATTERN.test(release.tag_name.slice(1)),
  );
  const plan = [];
  const skipped = [];

  for (const release of drafts) {
    const version = release.tag_name.slice(1);
    const published = registryData?.versions?.[version];
    if (!published) {
      skipped.push({ reason: "not-public-on-npm", tag: release.tag_name });
      continue;
    }
    const attestationLocation = published?.dist?.attestations?.url;
    if (
      typeof attestationLocation !== "string" ||
      attestationLocation.length === 0
    ) {
      skipped.push({ reason: "no-npm-attestations", tag: release.tag_name });
      continue;
    }
    await signatureVerifier(packageName, version);
    const url = attestationUrl(attestationLocation);
    const attestationDocument = await requestJson(url, {}, fetchImplementation);
    const provenance = provenanceCommit({
      attestations: attestationDocument?.attestations,
      defaultBranch,
      integrity: published?.dist?.integrity,
      packageName,
      repository,
      version,
    });
    const resolvedTag = await tagCommit(
      repository,
      release.tag_name,
      token,
      fetchImplementation,
    );
    const target = releaseCommit(release, resolvedTag);
    if (target !== provenance) {
      throw new Error(
        `${release.tag_name} target does not match npm SLSA provenance`,
      );
    }
    if (!Number.isSafeInteger(release.id) || release.id <= 0) {
      throw new Error(
        `${release.tag_name} is missing a valid GitHub release ID`,
      );
    }
    plan.push({
      id: release.id,
      latest: registryData?.["dist-tags"]?.latest === version,
      tag: release.tag_name,
      target,
      version,
    });
  }

  plan.sort((left, right) => Number(left.latest) - Number(right.latest));
  return { plan, skipped };
}

async function syncDraftReleases(
  { defaultBranch, packageData, repository, token },
  fetchImplementation = fetch,
  signatureVerifier = verifyNpmPackageSignatures,
) {
  validateRepository(repository);
  const packageName = requireValue(
    packageData?.name,
    "package name is required",
  );
  const registryData = await requestJson(
    `${NPM_REGISTRY}/${encodeURIComponent(packageName)}`,
    {},
    fetchImplementation,
  );
  const releases = await listReleases(repository, token, fetchImplementation);
  const { plan, skipped } = await buildSyncPlan(
    {
      defaultBranch,
      packageData,
      registryData,
      releases,
      repository,
      token,
    },
    fetchImplementation,
    signatureVerifier,
  );
  const published = [];
  for (const candidate of plan) {
    const release = await requestJson(
      repositoryApiUrl(repository, `/releases/${candidate.id}`),
      {
        body: {
          draft: false,
          make_latest: candidate.latest ? "true" : "false",
        },
        method: "PATCH",
        token,
      },
      fetchImplementation,
    );
    if (release?.draft || release?.tag_name !== candidate.tag) {
      throw new Error(`GitHub did not publish ${candidate.tag} as expected`);
    }
    published.push({
      latest: candidate.latest,
      tag: candidate.tag,
      target: candidate.target,
    });
  }
  return { action: "sync-complete", published, skipped };
}

function loadPackageData() {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
}

async function main() {
  const command = process.argv[2];
  const context = {
    defaultBranch: process.env.RELEASE_DEFAULT_BRANCH,
    packageData: loadPackageData(),
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    token: process.env.GITHUB_TOKEN,
  };
  requireValue(context.token, "GITHUB_TOKEN is required");
  let result;
  if (command === "prepare") {
    result = await prepareDraftRelease(context);
  } else if (command === "sync") {
    result = await syncDraftReleases(context);
  } else {
    throw new Error("usage: github-release-sync.mjs <prepare|sync>");
  }
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

const isEntryPoint =
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(SCRIPT_FILE);
if (isEntryPoint) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  PUBLISH_PREDICATE,
  SLSA_PREDICATE,
  buildSyncPlan,
  prepareDraftRelease,
  provenanceCommit,
  releaseCommit,
  sha512FromIntegrity,
  syncDraftReleases,
  verifyNpmPackageSignatures,
};
