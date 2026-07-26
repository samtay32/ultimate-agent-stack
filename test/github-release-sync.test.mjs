import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLISH_PREDICATE,
  SLSA_PREDICATE,
  buildSyncPlan,
  prepareDraftRelease,
  provenanceCommit,
  releaseCommit,
  sha512FromIntegrity,
  syncDraftReleases,
} from "../scripts/github-release-sync.mjs";

const PACKAGE_NAME = "ultimate-agent-stack";
const VERSION = "0.3.0";
const OLDER_VERSION = "0.2.0";
const REPOSITORY = "samtay32/ultimate-agent-stack";
const COMMIT = "5a63dbc7d0a0175d2fc1598e419c79c8e5bf5f1a";
const OTHER_COMMIT = "a".repeat(40);
const OLDER_COMMIT = "b".repeat(40);
const DIGEST = "e8".repeat(64);
const OLDER_DIGEST = "d7".repeat(64);
const INTEGRITY = `sha512-${Buffer.from(DIGEST, "hex").toString("base64")}`;
const OLDER_INTEGRITY = `sha512-${Buffer.from(OLDER_DIGEST, "hex").toString("base64")}`;
const ATTESTATION_URL =
  "https://registry.npmjs.org/-/npm/v1/attestations/ultimate-agent-stack@0.3.0";
const OLDER_ATTESTATION_URL =
  "https://registry.npmjs.org/-/npm/v1/attestations/ultimate-agent-stack@0.2.0";

function attestation(
  predicateType,
  predicate,
  { digest = DIGEST, version = VERSION } = {},
) {
  const payload = {
    _type: "https://in-toto.io/Statement/v0.1",
    predicate,
    predicateType,
    subject: [
      {
        digest: { sha512: digest },
        name: `pkg:npm/${PACKAGE_NAME}@${version}`,
      },
    ],
  };
  return {
    bundle: {
      dsseEnvelope: {
        payload: Buffer.from(JSON.stringify(payload)).toString("base64url"),
      },
    },
    predicateType,
  };
}

function validAttestations({
  commit = COMMIT,
  digest = DIGEST,
  version = VERSION,
} = {}) {
  return [
    attestation(
      PUBLISH_PREDICATE,
      {
        name: PACKAGE_NAME,
        registry: "https://registry.npmjs.org",
        version,
      },
      { digest, version },
    ),
    attestation(
      SLSA_PREDICATE,
      {
        buildDefinition: {
          externalParameters: {
            workflow: {
              path: ".github/workflows/publish.yml",
              ref: "refs/heads/main",
              repository: `https://github.com/${REPOSITORY}`,
            },
          },
          resolvedDependencies: [
            {
              digest: { gitCommit: commit },
              uri: `git+https://github.com/${REPOSITORY}@refs/heads/main`,
            },
          ],
        },
      },
      { digest, version },
    ),
  ];
}

function response(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return value === undefined ? "" : JSON.stringify(value);
    },
  };
}

test("sha512 integrity is converted to the provenance digest", () => {
  assert.equal(sha512FromIntegrity(INTEGRITY), DIGEST);
  assert.throws(
    () => sha512FromIntegrity("sha256-not-accepted"),
    /sha512 integrity/,
  );
});

test("provenance binds the npm artifact to the trusted workflow commit", () => {
  assert.equal(
    provenanceCommit({
      attestations: validAttestations(),
      defaultBranch: "main",
      integrity: INTEGRITY,
      packageName: PACKAGE_NAME,
      repository: REPOSITORY,
      version: VERSION,
    }),
    COMMIT,
  );
});

test("provenance fails closed for a foreign workflow or altered digest", () => {
  const foreign = validAttestations();
  const payload = JSON.parse(
    Buffer.from(foreign[1].bundle.dsseEnvelope.payload, "base64url").toString(
      "utf8",
    ),
  );
  payload.predicate.buildDefinition.externalParameters.workflow.repository =
    "https://github.com/attacker/foreign";
  foreign[1].bundle.dsseEnvelope.payload = Buffer.from(
    JSON.stringify(payload),
  ).toString("base64url");

  assert.throws(
    () =>
      provenanceCommit({
        attestations: foreign,
        defaultBranch: "main",
        integrity: INTEGRITY,
        packageName: PACKAGE_NAME,
        repository: REPOSITORY,
        version: VERSION,
      }),
    /this repository/,
  );
  assert.throws(
    () =>
      provenanceCommit({
        attestations: validAttestations().map((candidate) => ({
          ...candidate,
          bundle: {
            dsseEnvelope: {
              payload: Buffer.from(
                Buffer.from(candidate.bundle.dsseEnvelope.payload, "base64url")
                  .toString("utf8")
                  .replace(DIGEST, "ff".repeat(64)),
              ).toString("base64url"),
            },
          },
        })),
        defaultBranch: "main",
        integrity: INTEGRITY,
        packageName: PACKAGE_NAME,
        repository: REPOSITORY,
        version: VERSION,
      }),
    /package digest/,
  );
});

test("draft release targets must be full immutable commits", () => {
  assert.equal(
    releaseCommit(
      { draft: true, tag_name: `v${VERSION}`, target_commitish: COMMIT },
      null,
    ),
    COMMIT,
  );
  assert.throws(
    () =>
      releaseCommit(
        { draft: true, tag_name: `v${VERSION}`, target_commitish: "main" },
        null,
      ),
    /full Git commit SHA/,
  );
});

test("sync plans only public drafts whose provenance matches the target", async () => {
  const releases = [
    {
      draft: true,
      id: 7,
      tag_name: `v${VERSION}`,
      target_commitish: COMMIT,
    },
    {
      draft: true,
      id: 8,
      tag_name: "v0.4.0",
      target_commitish: OTHER_COMMIT,
    },
  ];
  const registryData = {
    "dist-tags": { latest: VERSION },
    versions: {
      [VERSION]: {
        dist: {
          attestations: { url: ATTESTATION_URL },
          integrity: INTEGRITY,
        },
      },
    },
  };
  const fetchImplementation = async (url) => {
    if (url === ATTESTATION_URL) {
      return response(200, { attestations: validAttestations() });
    }
    if (url.endsWith(`/commits/v${VERSION}`)) {
      return response(404, { message: "Not Found" });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await buildSyncPlan(
    {
      defaultBranch: "main",
      packageData: { name: PACKAGE_NAME },
      registryData,
      releases,
      repository: REPOSITORY,
      token: "test-token",
    },
    fetchImplementation,
    async () => {},
  );

  assert.deepEqual(result.plan, [
    {
      id: 7,
      latest: true,
      tag: `v${VERSION}`,
      target: COMMIT,
      version: VERSION,
    },
  ]);
  assert.deepEqual(result.skipped, [
    { reason: "not-public-on-npm", tag: "v0.4.0" },
  ]);
});

test("sync rejects a draft that differs from npm provenance", async () => {
  const fetchImplementation = async (url) => {
    if (url === ATTESTATION_URL) {
      return response(200, { attestations: validAttestations() });
    }
    if (url.endsWith(`/commits/v${VERSION}`)) {
      return response(404, { message: "Not Found" });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  await assert.rejects(
    buildSyncPlan(
      {
        defaultBranch: "main",
        packageData: { name: PACKAGE_NAME },
        registryData: {
          "dist-tags": { latest: VERSION },
          versions: {
            [VERSION]: {
              dist: {
                attestations: { url: ATTESTATION_URL },
                integrity: INTEGRITY,
              },
            },
          },
        },
        releases: [
          {
            draft: true,
            id: 7,
            tag_name: `v${VERSION}`,
            target_commitish: OTHER_COMMIT,
          },
        ],
        repository: REPOSITORY,
        token: "test-token",
      },
      fetchImplementation,
      async () => {},
    ),
    /does not match npm SLSA provenance/,
  );
});

test("draft preparation is idempotent and rejects tag drift", async () => {
  const existingRelease = {
    draft: true,
    id: 7,
    tag_name: `v${VERSION}`,
    target_commitish: COMMIT,
  };
  const fetchImplementation = async (url) => {
    if (url.includes("/releases?")) {
      return response(200, [existingRelease]);
    }
    if (url.endsWith(`/commits/v${VERSION}`)) {
      return response(404, { message: "Not Found" });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  assert.deepEqual(
    await prepareDraftRelease(
      {
        packageData: { name: PACKAGE_NAME, version: VERSION },
        repository: REPOSITORY,
        sha: COMMIT,
        token: "test-token",
      },
      fetchImplementation,
    ),
    { action: "draft-exists", commit: COMMIT, tag: `v${VERSION}` },
  );
  await assert.rejects(
    prepareDraftRelease(
      {
        packageData: { name: PACKAGE_NAME, version: VERSION },
        repository: REPOSITORY,
        sha: OTHER_COMMIT,
        token: "test-token",
      },
      fetchImplementation,
    ),
    /different commit/,
  );
});

test("draft preparation creates only a commit-bound draft", async () => {
  let releaseRequest;
  const fetchImplementation = async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    if (url.includes("/releases?")) {
      return response(200, []);
    }
    if (url.endsWith(`/commits/v${VERSION}`)) {
      return response(404, { message: "Not Found" });
    }
    if (url.endsWith("/releases") && options.method === "POST") {
      releaseRequest = JSON.parse(options.body);
      return response(201, {
        draft: true,
        id: 7,
        tag_name: `v${VERSION}`,
        target_commitish: COMMIT,
      });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  assert.deepEqual(
    await prepareDraftRelease(
      {
        packageData: { name: PACKAGE_NAME, version: VERSION },
        repository: REPOSITORY,
        sha: COMMIT,
        token: "test-token",
      },
      fetchImplementation,
    ),
    { action: "draft-created", commit: COMMIT, tag: `v${VERSION}` },
  );
  assert.deepEqual(releaseRequest, {
    draft: true,
    generate_release_notes: true,
    name: `${PACKAGE_NAME} ${VERSION}`,
    prerelease: false,
    tag_name: `v${VERSION}`,
    target_commitish: COMMIT,
  });
});

test("synchronization publishes older drafts before npm latest", async () => {
  const publishRequests = [];
  const signatureRequests = [];
  const registryData = {
    "dist-tags": { latest: VERSION },
    versions: {
      [OLDER_VERSION]: {
        dist: {
          attestations: { url: OLDER_ATTESTATION_URL },
          integrity: OLDER_INTEGRITY,
        },
      },
      [VERSION]: {
        dist: {
          attestations: { url: ATTESTATION_URL },
          integrity: INTEGRITY,
        },
      },
    },
  };
  const drafts = [
    {
      draft: true,
      id: 7,
      tag_name: `v${VERSION}`,
      target_commitish: COMMIT,
    },
    {
      draft: true,
      id: 6,
      tag_name: `v${OLDER_VERSION}`,
      target_commitish: OLDER_COMMIT,
    },
  ];
  const fetchImplementation = async (url, options) => {
    if (url === "https://registry.npmjs.org/ultimate-agent-stack") {
      return response(200, registryData);
    }
    if (url.includes("/releases?")) {
      return response(200, drafts);
    }
    if (url === ATTESTATION_URL) {
      return response(200, { attestations: validAttestations() });
    }
    if (url === OLDER_ATTESTATION_URL) {
      return response(200, {
        attestations: validAttestations({
          commit: OLDER_COMMIT,
          digest: OLDER_DIGEST,
          version: OLDER_VERSION,
        }),
      });
    }
    if (
      url.endsWith(`/commits/v${VERSION}`) ||
      url.endsWith(`/commits/v${OLDER_VERSION}`)
    ) {
      return response(404, { message: "Not Found" });
    }
    const release = drafts.find((candidate) =>
      url.endsWith(`/releases/${candidate.id}`),
    );
    if (release && options.method === "PATCH") {
      publishRequests.push({
        body: JSON.parse(options.body),
        id: release.id,
      });
      return response(200, { ...release, draft: false });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  assert.deepEqual(
    await syncDraftReleases(
      {
        defaultBranch: "main",
        packageData: { name: PACKAGE_NAME },
        repository: REPOSITORY,
        token: "test-token",
      },
      fetchImplementation,
      async (packageName, version) => {
        signatureRequests.push(`${packageName}@${version}`);
      },
    ),
    {
      action: "sync-complete",
      published: [
        {
          latest: false,
          tag: `v${OLDER_VERSION}`,
          target: OLDER_COMMIT,
        },
        { latest: true, tag: `v${VERSION}`, target: COMMIT },
      ],
      skipped: [],
    },
  );
  assert.deepEqual(signatureRequests, [
    `${PACKAGE_NAME}@${VERSION}`,
    `${PACKAGE_NAME}@${OLDER_VERSION}`,
  ]);
  assert.deepEqual(publishRequests, [
    { body: { draft: false, make_latest: "false" }, id: 6 },
    { body: { draft: false, make_latest: "true" }, id: 7 },
  ]);
});

test("missing attestations skip one draft without blocking others", async () => {
  const result = await buildSyncPlan(
    {
      defaultBranch: "main",
      packageData: { name: PACKAGE_NAME },
      registryData: {
        "dist-tags": { latest: VERSION },
        versions: {
          [VERSION]: {
            dist: { integrity: INTEGRITY },
          },
        },
      },
      releases: [
        {
          draft: true,
          id: 7,
          tag_name: `v${VERSION}`,
          target_commitish: COMMIT,
        },
      ],
      repository: REPOSITORY,
      token: "test-token",
    },
    async () => {
      throw new Error("network must not be called");
    },
    async () => {
      throw new Error("signature verifier must not be called");
    },
  );
  assert.deepEqual(result, {
    plan: [],
    skipped: [{ reason: "no-npm-attestations", tag: `v${VERSION}` }],
  });
});

test("synchronization rejects repository path components before fetching", async () => {
  let fetchCalled = false;
  await assert.rejects(
    syncDraftReleases(
      {
        defaultBranch: "main",
        packageData: { name: PACKAGE_NAME },
        repository: `${REPOSITORY.split("/")[0]}/..`,
        token: "test-token",
      },
      async () => {
        fetchCalled = true;
        throw new Error("must not fetch");
      },
      async () => {},
    ),
    /owner\/repository name/,
  );
  assert.equal(fetchCalled, false);
});
