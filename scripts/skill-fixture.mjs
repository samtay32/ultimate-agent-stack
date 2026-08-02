#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  opendirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  checksHash,
  commandApproveChecks,
  commandCheckpoint,
  commandConfigure,
  commandCoordinator,
  commandDetect,
  commandLock,
  commandStart,
  configurationHash,
  installOrUpgrade,
} from "../bin/ultimate-agent-stack.mjs";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(SCRIPT_FILE), "..");
const FIXTURES_FILE = join(PACKAGE_ROOT, "evals", "fixtures.json");
const FIXTURE_BASELINES_FILE = join(
  PACKAGE_ROOT,
  "evals",
  "fixture-baselines.json",
);
const SCENARIOS_FILE = join(PACKAGE_ROOT, "evals", "scenarios.json");
const FIXED_TIMESTAMP = "2026-01-01T00:00:00Z";
const LIVE_LINEAR_SANDBOX_OPT_IN = "--allow-live-linear-sandbox-fixture";
const GIT_COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA256_RECEIPT = /^sha256:[a-f0-9]{64}$/;
const PROJECT_TREE_MAX_ENTRIES = 20_000;
const PROJECT_TREE_MAX_FILES = 10_000;
const PROJECT_TREE_MAX_FILE_BYTES = 16 * 1024 * 1024;
const PROJECT_TREE_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const EVALUATION_SCRUBBED_CREDENTIAL_ENVIRONMENT = Object.freeze([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "NODE_AUTH_TOKEN",
  "NPM_TOKEN",
  "LINEAR_API_KEY",
  "LINEAR_CREATE_API_KEY",
  "LINEAR_COMMENT_API_KEY",
  "POSTHOG_PERSONAL_API_KEY",
  "SENTRY_AUTH_TOKEN",
  "NEW_RELIC_USER_KEY",
]);
const EXPECTED_FIXTURE_IDS = new Set([
  "direct-setup",
  "direct-delivery",
  "direct-telemetry-diagnosis",
  "direct-work-evidence",
  "direct-receipted-linear-write",
  "direct-evidence-graph-report",
  "indirect-setup",
  "incomplete-product-idea",
  "negative-explanation-only",
  "edge-bypass-gates",
  "edge-unbounded-campaign",
  "edge-reviewer-unavailable",
  "authority-release-boundary",
  "continuity-active-coordinator",
  "existing-project-reconciliation",
  "flexible-vague-discovery",
  "flexible-brief-only",
  "flexible-external-detailed-prd",
  "flexible-external-complete-prd",
  "flexible-external-contradictory",
  "flexible-external-existing-reconciliation",
  "flexible-direct-bypass",
  "flexible-resume-valid",
  "flexible-draft-lock",
  "flexible-approved-promotion",
  "flexible-simple-onboarding",
  "flexible-simple-onboarding-approved",
  "flexible-external-secret-redaction",
]);
const CONFIGURATION_STATES = new Set([
  "configured",
  "pending",
  "uninstalled",
  "linear-readonly",
  "linear-write",
  "telemetry-readonly",
]);
const BASE_PROJECT = {
  schema_version: 1,
  package_name_template: "uas-eval-<scenario-id>",
  package_version: "1.0.0",
  private: true,
  module_type: "module",
  node_test_command: "node --test",
  git_branch: "main",
  git_author_date: "2000-01-01T00:00:00Z",
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function projectTreeSha256(
  target,
  {
    maxEntries = PROJECT_TREE_MAX_ENTRIES,
    maxFiles = PROJECT_TREE_MAX_FILES,
    maxFileBytes = PROJECT_TREE_MAX_FILE_BYTES,
    maxTotalBytes = PROJECT_TREE_MAX_TOTAL_BYTES,
  } = {},
) {
  for (const [label, value] of [
    ["maxEntries", maxEntries],
    ["maxFiles", maxFiles],
    ["maxFileBytes", maxFileBytes],
    ["maxTotalBytes", maxTotalBytes],
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`project-tree ${label} must be a positive safe integer`);
    }
  }
  const root = realpathSync(target);
  const hash = createHash("sha256");
  const pending = [{ type: "directory", path: root, prefix: "" }];
  let entryCount = 0;
  let fileCount = 0;
  let totalBytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.type === "directory") {
      const entries = [];
      const directory = opendirSync(current.path);
      try {
        while (true) {
          const entry = directory.readSync();
          if (entry === null) {
            break;
          }
          const relativePath = current.prefix
            ? `${current.prefix}/${entry.name}`
            : entry.name;
          if (relativePath === ".git") {
            continue;
          }
          entryCount += 1;
          if (entryCount > maxEntries) {
            throw new Error(
              `refusing to hash project tree with more than ${maxEntries} entries`,
            );
          }
          entries.push({
            entry,
            path: join(current.path, entry.name),
            relativePath,
          });
        }
      } finally {
        directory.closeSync();
      }
      entries.sort((left, right) =>
        left.entry.name < right.entry.name
          ? -1
          : left.entry.name > right.entry.name
            ? 1
            : 0,
      );
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const { entry, path, relativePath } = entries[index];
        if (entry.isSymbolicLink()) {
          throw new Error(
            `refusing to hash symlink in materialized project tree: ${relativePath}`,
          );
        }
        if (entry.isDirectory()) {
          pending.push({
            type: "directory",
            path,
            prefix: relativePath,
          });
          continue;
        }
        if (!entry.isFile()) {
          throw new Error(
            `refusing to hash unsupported project tree entry: ${relativePath}`,
          );
        }
        pending.push({ type: "file", path, relativePath });
      }
      continue;
    }
    fileCount += 1;
    if (fileCount > maxFiles) {
      throw new Error(
        `refusing to hash project tree with more than ${maxFiles} files`,
      );
    }
    const metadata = lstatSync(current.path);
    if (metadata.isSymbolicLink()) {
      throw new Error(
        `refusing to hash symlink in materialized project tree: ${current.relativePath}`,
      );
    }
    if (!metadata.isFile()) {
      throw new Error(
        `refusing to hash unsupported project tree entry: ${current.relativePath}`,
      );
    }
    const size = metadata.size;
    if (size > maxFileBytes) {
      throw new Error(
        `refusing to hash project file larger than ${maxFileBytes} bytes: ${current.relativePath}`,
      );
    }
    totalBytes += size;
    if (totalBytes > maxTotalBytes) {
      throw new Error(
        `refusing to hash project tree larger than ${maxTotalBytes} bytes`,
      );
    }
    hash.update(current.relativePath);
    hash.update("\0");
    hash.update(readFileSync(current.path));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function safeRelativePath(path, label = "fixture path") {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\0") ||
    path.includes("\\") ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path)
  ) {
    throw new Error(`${label} must be a project-relative POSIX path`);
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} must not contain empty, dot, or parent segments`);
  }
  return parts;
}

function validateFixtureProviderBoundary(fixture) {
  const isLinearWrite = fixture.configuration === "linear-write";
  const providerExecution = fixture.provider_execution;
  if (isLinearWrite !== (providerExecution !== undefined)) {
    throw new Error(
      `${fixture.scenario_id} must declare configuration=linear-write if and only if provider_execution is present`,
    );
  }
  if (
    providerExecution !== undefined &&
    (
      providerExecution?.provider !== "linear" ||
      !["live-write", "readiness-only"].includes(
        providerExecution?.mode,
      ) ||
      providerExecution?.requires_explicit_sandbox_opt_in !==
        (providerExecution?.mode === "live-write")
    )
  ) {
    throw new Error(
      `${fixture.scenario_id}.provider_execution must declare a valid Linear readiness-only or explicit sandbox live-write boundary`,
    );
  }
}

function fixtureCatalog() {
  const catalog = readJson(FIXTURES_FILE);
  if (catalog.schema_version !== 1 || !Array.isArray(catalog.fixtures)) {
    throw new Error("evals/fixtures.json must be a schema-version 1 fixture catalog");
  }
  const scenarios = readJson(SCENARIOS_FILE);
  const scenarioIds = new Set(scenarios.scenarios.map((scenario) => scenario.id));
  const seen = new Set();
  for (const fixture of catalog.fixtures) {
    if (
      !fixture ||
      typeof fixture !== "object" ||
      Array.isArray(fixture) ||
      !EXPECTED_FIXTURE_IDS.has(fixture.scenario_id)
    ) {
      throw new Error("fixture catalog contains an unknown or malformed flexible scenario");
    }
    if (seen.has(fixture.scenario_id)) {
      throw new Error(`fixture scenario duplicates: ${fixture.scenario_id}`);
    }
    if (!scenarioIds.has(fixture.scenario_id)) {
      throw new Error(`fixture references missing scenario: ${fixture.scenario_id}`);
    }
    if (!CONFIGURATION_STATES.has(fixture.configuration)) {
      throw new Error(`${fixture.scenario_id} has an invalid configuration state`);
    }
    if (!["empty-greenfield", "existing"].includes(fixture.project_kind)) {
      throw new Error(`${fixture.scenario_id} has an invalid project kind`);
    }
    for (const collection of ["files", "artifact_files"]) {
      if (!Array.isArray(fixture[collection])) {
        throw new Error(`${fixture.scenario_id}.${collection} must be an array`);
      }
      for (const file of fixture[collection]) {
        safeRelativePath(file?.path, `${fixture.scenario_id}.${collection}.path`);
        if (typeof file?.content !== "string") {
          throw new Error(`${fixture.scenario_id}.${collection} content must be text`);
        }
      }
    }
    for (const input of fixture.external_inputs ?? []) {
      if (
        typeof input?.id !== "string" ||
        typeof input?.kind !== "string" ||
        typeof input?.content !== "string"
      ) {
        throw new Error(`${fixture.scenario_id} has a malformed external input`);
      }
    }
    if (
      fixture.state?.active_coordinator !== undefined &&
      (
        !fixture.state.active_coordinator ||
        typeof fixture.state.active_coordinator !== "object" ||
        !["harness", "foreign"].includes(
          fixture.state.active_coordinator.owner,
        )
      )
    ) {
      throw new Error(
        `${fixture.scenario_id}.state.active_coordinator must declare owner harness or foreign`,
      );
    }
    validateFixtureProviderBoundary(fixture);
    seen.add(fixture.scenario_id);
  }
  if (
    seen.size !== EXPECTED_FIXTURE_IDS.size ||
    [...EXPECTED_FIXTURE_IDS].some((id) => !seen.has(id))
  ) {
    throw new Error("fixture catalog must cover exactly all current scenarios");
  }
  return catalog;
}

function fixtureBaselineCatalog() {
  const catalog = readJson(FIXTURE_BASELINES_FILE);
  if (catalog.schema_version !== 1 || !Array.isArray(catalog.baselines)) {
    throw new Error(
      "evals/fixture-baselines.json must be a schema-version 1 baseline catalog",
    );
  }
  const seen = new Set();
  for (const baseline of catalog.baselines) {
    if (
      !baseline ||
      typeof baseline !== "object" ||
      Array.isArray(baseline) ||
      !EXPECTED_FIXTURE_IDS.has(baseline.scenario_id) ||
      !GIT_COMMIT_ID.test(baseline.git_head ?? "") ||
      !SHA256_RECEIPT.test(baseline.project_tree_sha256 ?? "")
    ) {
      throw new Error(
        "fixture baseline catalog contains an unknown or malformed baseline",
      );
    }
    if (seen.has(baseline.scenario_id)) {
      throw new Error(
        `fixture baseline scenario duplicates: ${baseline.scenario_id}`,
      );
    }
    seen.add(baseline.scenario_id);
  }
  if (
    seen.size !== EXPECTED_FIXTURE_IDS.size ||
    [...EXPECTED_FIXTURE_IDS].some((id) => !seen.has(id))
  ) {
    throw new Error(
      "fixture baseline catalog must cover exactly all current scenarios",
    );
  }
  return catalog;
}

function expectedFixtureBaseline(scenarioId) {
  fixtureById(scenarioId);
  const baseline = fixtureBaselineCatalog().baselines.find(
    (candidate) => candidate.scenario_id === scenarioId,
  );
  if (!baseline) {
    throw new Error(`missing canonical fixture baseline: ${scenarioId}`);
  }
  return structuredClone(baseline);
}

function fixtureById(scenarioId) {
  const fixture = fixtureCatalog().fixtures.find(
    (candidate) => candidate.scenario_id === scenarioId,
  );
  if (!fixture) {
    throw new Error(`unknown canonical fixture: ${scenarioId}`);
  }
  return fixture;
}

function receiptForFixture(fixture) {
  return `sha256:${sha256(canonicalJson({
    base_project: BASE_PROJECT,
    fixture,
  }))}`;
}

function prepareEmptyTarget(targetInput) {
  const requested = resolve(targetInput);
  if (existsSync(requested)) {
    if (lstatSync(requested).isSymbolicLink()) {
      throw new Error("refusing a symlink fixture target");
    }
    if (!statSync(requested).isDirectory()) {
      throw new Error("fixture target must be a directory");
    }
    if (readdirSync(requested).length > 0) {
      throw new Error("fixture target must be empty");
    }
    return realpathSync(requested);
  }
  const parent = realpathSync(dirname(requested));
  if (!statSync(parent).isDirectory()) {
    throw new Error("fixture target parent must be a directory");
  }
  const target = join(parent, basename(requested));
  mkdirSync(target, { mode: 0o700 });
  return realpathSync(target);
}

function projectPath(target, relativePath) {
  const parts = safeRelativePath(relativePath);
  let current = target;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`refusing symlink component in fixture path: ${relativePath}`);
    }
  }
  const path = join(target, ...parts);
  if (!path.startsWith(`${target}${sep}`)) {
    throw new Error(`fixture path escapes target: ${relativePath}`);
  }
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`refusing symlink fixture file: ${relativePath}`);
  }
  return path;
}

function writeProjectFile(target, file) {
  const path = projectPath(target, file.path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, file.content, { encoding: "utf8", mode: 0o600 });
}

function basePackage(scenarioId) {
  return {
    name: `uas-eval-${scenarioId}`,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      test: "node --test",
    },
  };
}

function configureOptions(configuration) {
  if (configuration === "configured") {
    return {
      preset: "simple",
      reason: "Canonical evaluation fixture safe defaults",
    };
  }
  const options = {
    profile: "standard",
    review: "builtin",
    knowledge: "repository",
    knowledgeScope: "project",
    work: "repository",
    linearTeams: [],
    linearWrites: [],
    telemetrySpecs: [],
    externalData: "approved_providers",
    execution: "agent_owned",
    merge: "human_approval_required",
    reviewers: [],
    reason: "Canonical evaluation fixture approved provider scope",
  };
  if (configuration === "linear-readonly") {
    options.work = "linear";
    options.linearTeams = ["ENG"];
  } else if (configuration === "linear-write") {
    options.work = "linear";
    options.linearTeams = ["ENG"];
    options.linearWrites = ["issue_create"];
  } else if (configuration === "telemetry-readonly") {
    options.telemetrySpecs = ["new-relic@us:12345"];
  }
  return options;
}

function canonicalWorkLedger() {
  return {
    schema_version: 1,
    updated_at: FIXED_TIMESTAMP,
    items: [
      {
        id: "linear-contract",
        title: "Deliver the bounded status contract",
        objective: "Implement and verify the repository status behavior.",
        status: "ready",
        priority: "normal",
        acceptance_criteria: [
          "The exact project-native Node regression test passes.",
        ],
        scope: {
          paths: ["src/status.mjs", "test/status.test.mjs"],
          out_of_scope: ["deployment", "release"],
        },
        depends_on: [],
        evidence_refs: ["status-implementation", "status-test"],
        external_refs: [],
        updated_at: FIXED_TIMESTAMP,
      },
    ],
  };
}

function canonicalEvidenceGraph() {
  return {
    schema_version: 1,
    updated_at: FIXED_TIMESTAMP,
    nodes: [
      {
        id: "linear-contract",
        kind: "work_item",
        label: "Status contract",
        state: "active",
        source: {
          provider: "repository",
          reference: ".agent-stack/work-items.json",
        },
        summary: "One bounded repository work item.",
      },
      {
        id: "status-implementation",
        kind: "file",
        label: "Status implementation",
        state: "planned",
        source: {
          provider: "repository",
          reference: "src/status.mjs",
        },
        summary: "Implementation evidence.",
      },
      {
        id: "status-test",
        kind: "test",
        label: "Status regression test",
        state: "planned",
        source: {
          provider: "repository",
          reference: "test/status.test.mjs",
        },
        summary: "Verification evidence.",
      },
    ],
    edges: [
      {
        from: "status-implementation",
        to: "linear-contract",
        relation: "implements",
      },
      {
        from: "status-test",
        to: "linear-contract",
        relation: "verifies",
      },
    ],
  };
}

function writeCanonicalWorkEvidence(target) {
  writeFileSync(
    projectPath(target, ".agent-stack/work-items.json"),
    `${JSON.stringify(canonicalWorkLedger(), null, 2)}\n`,
  );
  writeFileSync(
    projectPath(target, ".agent-stack/evidence-graph.json"),
    `${JSON.stringify(canonicalEvidenceGraph(), null, 2)}\n`,
  );
}

function normalizeGeneratedState(target, fixture) {
  const installationPath = join(target, ".agent-stack", "installation.json");
  const installation = readJson(installationPath);
  installation.installed_at = FIXED_TIMESTAMP;
  installation.updated_at = FIXED_TIMESTAMP;
  writeFileSync(installationPath, `${JSON.stringify(installation, null, 2)}\n`);

  const configPath = join(target, ".agent-stack", "config.json");
  const config = readJson(configPath);
  config.project.name = fixture.scenario_id;
  config.project.detected_at = FIXED_TIMESTAMP;
  config.capabilities.work.linear_idempotency_namespace = sha256(
    `fixture:${fixture.scenario_id}`,
  );
  if (config.onboarding.status === "complete") {
    config.onboarding.configured_at = FIXED_TIMESTAMP;
    config.safety.configuration_approved_at = FIXED_TIMESTAMP;
    config.safety.approved_at = FIXED_TIMESTAMP;
    config.safety.approved_configuration_hash = configurationHash(config);
    config.safety.approved_checks_hash = checksHash(
      config.quality.checks,
      target,
      config.quality.environment?.allow ?? [],
    );
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function checkpointMarkdown(checkpoint) {
  const escape = (value) => value.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
  const section = (title, values, empty = "None.") => [
    `## ${title}`,
    "",
    ...(values.length > 0
      ? values.map((value) => `- ${escape(value)}`)
      : [empty]),
    "",
  ];
  const git = checkpoint.git
    ? [
        `- Branch: ${checkpoint.git.branch ?? "detached"}`,
        `- Commit: ${checkpoint.git.head ?? "unavailable"}`,
        `- Working tree: ${checkpoint.git.clean ? "clean" : "has changes"}`,
        `- Tracked changes: ${checkpoint.git.tracked_changes}`,
        `- Untracked changes: ${checkpoint.git.untracked_changes}`,
      ]
    : ["- Git state: unavailable"];
  return [
    "# Project Checkpoint",
    "",
    "This is the current deterministic handoff written by Ultimate Agent Stack.",
    "Repository evidence remains authoritative; optional memory is only a searchable mirror.",
    "",
    `- Checkpoint: \`${checkpoint.checkpoint_id}\``,
    `- Updated: ${checkpoint.updated_at}`,
    `- Status: ${checkpoint.status}`,
    `- Objective: ${escape(checkpoint.objective)}`,
    `- Summary: ${escape(checkpoint.summary)}`,
    "",
    ...section("Completed", checkpoint.completed),
    ...section("Decisions", checkpoint.decisions),
    ...section("Next Steps", checkpoint.next_steps),
    ...section("Blockers", checkpoint.blockers),
    ...section("Evidence", checkpoint.evidence),
    "## Git",
    "",
    ...git,
    "",
  ].join("\n");
}

function normalizeRuntimeState(target, scenarioId) {
  const statePath = join(target, ".agent-stack", "state.json");
  if (existsSync(statePath)) {
    const state = readJson(statePath);
    if (state.active_lock) {
      state.active_lock.locked_at = FIXED_TIMESTAMP;
    }
    state.history = (state.history ?? []).map((entry) => ({
      ...entry,
      locked_at: FIXED_TIMESTAMP,
      ...(entry.closed_at ? { closed_at: FIXED_TIMESTAMP } : {}),
    }));
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  const checkpointPath = join(target, ".agent-stack", "checkpoint.json");
  if (existsSync(checkpointPath)) {
    const checkpoint = readJson(checkpointPath);
    checkpoint.updated_at = FIXED_TIMESTAMP;
    checkpoint.coordinator_id = `steward-fixture-${sha256(scenarioId).slice(0, 12)}`;
    writeFileSync(
      checkpointPath,
      `${JSON.stringify(checkpoint, null, 2)}\n`,
    );
    writeFileSync(
      join(target, ".agent-stack", "CHECKPOINT.md"),
      checkpointMarkdown(checkpoint),
    );
  }
}

function normalizeActiveCoordinator(target, scenarioId, owner) {
  const coordinatorPath = join(target, ".agent-stack", "coordinator.json");
  if (!existsSync(coordinatorPath)) {
    return undefined;
  }
  const lease = readJson(coordinatorPath);
  const token = sha256(`fixture-coordinator-token:${owner}:${scenarioId}`);
  lease.coordinator_id = `steward-fixture-${sha256(scenarioId).slice(0, 12)}`;
  lease.token_hash = sha256(token);
  lease.checkout_hash = sha256(`fixture-checkout:${scenarioId}`);
  lease.host = "fixture-host";
  lease.acquired_at = "2099-01-01T00:00:00.000Z";
  lease.heartbeat_at = "2099-01-01T00:00:00.000Z";
  lease.expires_at = "2099-01-01T01:00:00.000Z";
  writeFileSync(coordinatorPath, `${JSON.stringify(lease, null, 2)}\n`);
  return owner === "harness" ? token : undefined;
}

function fixtureGitEnvironment() {
  const environment = {};
  for (const name of [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TMP",
    "TEMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ]) {
    if (typeof process.env[name] === "string") {
      environment[name] = process.env[name];
    }
  }
  return {
    ...environment,
    GIT_AUTHOR_NAME: "Ultimate Agent Stack Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Ultimate Agent Stack Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function runGit(target, args) {
  const protectedArgs = existsSync(join(target, ".git"))
    ? [
        "-c",
        `core.hooksPath=${join(target, ".git", "disabled-hooks")}`,
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        ...args,
      ]
    : args;
  const result = spawnSync("git", protectedArgs, {
    cwd: target,
    encoding: "utf8",
    env: fixtureGitEnvironment(),
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function gitIsAncestor(target, ancestor, descendant) {
  const protectedPrefix = [
    "-c",
    `core.hooksPath=${join(target, ".git", "disabled-hooks")}`,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
  ];
  const objectCheck = spawnSync(
    "git",
    [
      ...protectedPrefix,
      "rev-parse",
      "--verify",
      "--quiet",
      `${ancestor}^{commit}`,
    ],
    {
      cwd: target,
      encoding: "utf8",
      env: fixtureGitEnvironment(),
    },
  );
  if (objectCheck.status === 1) {
    return false;
  }
  if (objectCheck.status !== 0) {
    throw new Error(
      `git rev-parse baseline failed: ${objectCheck.stderr.trim()}`,
    );
  }
  const result = spawnSync(
    "git",
    [
      ...protectedPrefix,
      "merge-base",
      "--is-ancestor",
      ancestor,
      descendant,
    ],
    {
      cwd: target,
      encoding: "utf8",
      env: fixtureGitEnvironment(),
    },
  );
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }
  throw new Error(
    `git merge-base --is-ancestor failed: ${result.stderr.trim()}`,
  );
}

function createDeterministicGitBaseline(target, scenarioId) {
  runGit(target, ["init", "-q", "--initial-branch=main"]);
  mkdirSync(join(target, ".git", "disabled-hooks"), {
    recursive: true,
    mode: 0o700,
  });
  runGit(target, ["config", "core.autocrlf", "false"]);
  runGit(target, ["config", "core.filemode", "false"]);
  runGit(target, ["add", "-A"]);
  runGit(target, ["commit", "-q", "-m", `fixture: ${scenarioId}`]);
  return runGit(target, ["rev-parse", "HEAD"]);
}

function createRequestedState(target, fixture) {
  const state = fixture.state ?? {};
  if (Array.isArray(state.lock_artifacts) && state.lock_artifacts.length > 0) {
    commandLock(target, state.lock_artifacts);
  }
  if (!state.checkpoint) {
    if (state.active_coordinator) {
      commandStart(target, `Materialize ${fixture.scenario_id}`);
      const token = normalizeActiveCoordinator(
        target,
        fixture.scenario_id,
        state.active_coordinator.owner,
      );
      return token ? { coordinator_token: token } : {};
    }
    return {};
  }
  const start = commandStart(
    target,
    `Materialize ${fixture.scenario_id}`,
  );
  const checkpoint = state.checkpoint;
  commandCheckpoint(target, {
    objective: checkpoint.objective,
    summary: checkpoint.summary,
    status: checkpoint.status,
    completed: checkpoint.completed,
    decisions: checkpoint.decisions,
    nextSteps: checkpoint.next_steps,
    blockers: checkpoint.blockers,
    evidence: checkpoint.evidence,
    token: start.coordinator.coordinator_token,
  });
  commandCoordinator(target, "release", {
    token: start.coordinator.coordinator_token,
  });
  normalizeRuntimeState(target, fixture.scenario_id);
  return {};
}

function externalInputsForFixture(scenarioId) {
  return (fixtureById(scenarioId).external_inputs ?? []).map((input) => ({
    ...structuredClone(input),
  }));
}

function fixtureReceipt(scenarioId) {
  return receiptForFixture(fixtureById(scenarioId));
}

function providerAuthorityForFixture(fixture) {
  const providerExecution = fixture.provider_execution;
  return providerExecution
    ? {
        provider: providerExecution.provider,
        mode: providerExecution.mode,
        sandbox_opt_in_required:
          providerExecution.requires_explicit_sandbox_opt_in,
        sandbox_opt_in_supplied:
          providerExecution.requires_explicit_sandbox_opt_in,
        opt_in_option:
          providerExecution.requires_explicit_sandbox_opt_in
            ? LIVE_LINEAR_SANDBOX_OPT_IN
            : null,
      }
    : {
        provider: null,
        mode: "none",
        sandbox_opt_in_required: false,
        sandbox_opt_in_supplied: false,
        opt_in_option: null,
      };
}

function expectedMaterializationSha256(scenarioId) {
  const fixture = fixtureById(scenarioId);
  const baseFixtureReceipt = `sha256:${sha256(canonicalJson(BASE_PROJECT))}`;
  const canonicalFixtureReceipt = receiptForFixture(fixture);
  const providerAuthority = providerAuthorityForFixture(fixture);
  return `sha256:${sha256(canonicalJson({
    base_fixture_receipt: baseFixtureReceipt,
    fixture_receipt: canonicalFixtureReceipt,
    provider_authority: providerAuthority,
  }))}`;
}

function projectStateSha256({
  materializationSpecSha256,
  gitHead,
  projectTreeSha256: treeSha256,
}) {
  return `sha256:${sha256(canonicalJson({
    git_head: gitHead,
    materialization_spec_sha256: materializationSpecSha256,
    project_tree_sha256: treeSha256,
  }))}`;
}

function materializeFixtureInternal(
  scenarioId,
  targetInput,
  {
    allowLiveLinearSandboxFixture = false,
    verifyBaseline = true,
  } = {},
) {
  const fixture = fixtureById(scenarioId);
  const providerExecution = fixture.provider_execution;
  if (
    allowLiveLinearSandboxFixture === true &&
    providerExecution?.requires_explicit_sandbox_opt_in !== true
  ) {
    throw new Error(
      `${LIVE_LINEAR_SANDBOX_OPT_IN} is valid only for a fixture that declares a live Linear sandbox write`,
    );
  }
  if (
    providerExecution?.requires_explicit_sandbox_opt_in === true &&
    allowLiveLinearSandboxFixture !== true
  ) {
    throw new Error(
      `${scenarioId} is a provider-backed live-write fixture. Refusing to materialize without the dedicated disposable Linear sandbox opt-in ${LIVE_LINEAR_SANDBOX_OPT_IN}; ambient LINEAR_* credentials never grant this authority.`,
    );
  }
  const target = prepareEmptyTarget(targetInput);
  const packageFile = {
    path: "package.json",
    content: `${JSON.stringify(basePackage(scenarioId), null, 2)}\n`,
  };
  writeProjectFile(target, packageFile);
  for (const file of fixture.files) {
    writeProjectFile(target, file);
  }
  if (fixture.project_kind === "empty-greenfield") {
    mkdirSync(dirname(projectPath(target, "src/.fixture-placeholder")), {
      recursive: true,
      mode: 0o700,
    });
  }

  let gitHead;
  let runtime = {};
  if (fixture.configuration === "uninstalled") {
    if (fixture.artifact_files.length > 0 || Object.keys(fixture.state ?? {}).length > 0) {
      throw new Error(
        `${scenarioId} cannot request installed stack artifacts or runtime state while uninstalled`,
      );
    }
    gitHead = createDeterministicGitBaseline(target, scenarioId);
  } else {
    installOrUpgrade(target);
    commandDetect(target, true);
    if (fixture.configuration !== "pending") {
      commandConfigure(target, configureOptions(fixture.configuration));
      commandApproveChecks(
        target,
        "Inspected the canonical fixture Node test command",
      );
    }
    if (fixture.state?.work_evidence === "valid") {
      writeCanonicalWorkEvidence(target);
    }
    for (const file of fixture.artifact_files) {
      writeProjectFile(target, file);
    }
    normalizeGeneratedState(target, fixture);
    gitHead = createDeterministicGitBaseline(target, scenarioId);
    runtime = createRequestedState(target, fixture);
  }

  const externalInputs = (fixture.external_inputs ?? []).map((input) => ({
    id: input.id,
    kind: input.kind,
    delivery: "prompt-only",
    content_sha256: `sha256:${sha256(input.content)}`,
  }));
  const baseFixtureReceipt = `sha256:${sha256(canonicalJson(BASE_PROJECT))}`;
  const canonicalFixtureReceipt = fixtureReceipt(scenarioId);
  const providerAuthority = providerAuthorityForFixture(fixture);
  const materializationSpecSha256 =
    expectedMaterializationSha256(scenarioId);
  const treeSha256 = projectTreeSha256(target);
  if (verifyBaseline) {
    const expectedBaseline = expectedFixtureBaseline(scenarioId);
    if (
      gitHead !== expectedBaseline.git_head ||
      treeSha256 !== expectedBaseline.project_tree_sha256
    ) {
      throw new Error(
        `${scenarioId} materialization does not match its protected canonical baseline`,
      );
    }
  }
  const stateSha256 = projectStateSha256({
    materializationSpecSha256,
    gitHead,
    projectTreeSha256: treeSha256,
  });
  return {
    ok: true,
    schema_version: 1,
    scenario_id: scenarioId,
    target,
    base_fixture_receipt: baseFixtureReceipt,
    fixture_receipt: canonicalFixtureReceipt,
    receipt: {
      materialization_sha256: materializationSpecSha256,
      materialization_spec_sha256: materializationSpecSha256,
      project_tree_sha256: treeSha256,
      project_state_sha256: stateSha256,
      provider_authority: providerAuthority,
    },
    git: {
      branch: "main",
      head: gitHead,
    },
    ...runtime,
    external_inputs: externalInputs,
  };
}

function withoutAmbientGitControl(callback) {
  const original = new Map(
    Object.entries(process.env).filter(([name]) =>
      name.toUpperCase().startsWith("GIT_"),
    ),
  );
  for (const name of original.keys()) {
    delete process.env[name];
  }
  try {
    return callback();
  } finally {
    for (const name of Object.keys(process.env)) {
      if (name.toUpperCase().startsWith("GIT_")) {
        delete process.env[name];
      }
    }
    for (const [name, value] of original) {
      process.env[name] = value;
    }
  }
}

function materializeFixture(
  scenarioId,
  targetInput,
  options = {},
) {
  return withoutAmbientGitControl(() =>
    materializeFixtureInternal(scenarioId, targetInput, options),
  );
}

function proposeFixtureBaselines() {
  const root = mkdtempSync(join(tmpdir(), "uas-fixture-baselines-"));
  try {
    return {
      schema_version: 1,
      baselines: fixtureCatalog().fixtures.map((fixture) => {
        const result = materializeFixture(
          fixture.scenario_id,
          join(root, fixture.scenario_id),
          { verifyBaseline: false },
        );
        return {
          scenario_id: fixture.scenario_id,
          git_head: result.git.head,
          project_tree_sha256:
            result.receipt.project_tree_sha256,
        };
      }),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function inspectFixtureProject(scenarioId, targetInput) {
  const expectedBaseline = expectedFixtureBaseline(scenarioId);
  const target = resolve(targetInput);
  if (
    !existsSync(target) ||
    lstatSync(target).isSymbolicLink() ||
    !statSync(target).isDirectory()
  ) {
    throw new Error(
      "fixture inspection target must be an existing non-symlink directory",
    );
  }
  const gitMetadata = join(target, ".git");
  if (
    !existsSync(gitMetadata) ||
    lstatSync(gitMetadata).isSymbolicLink() ||
    !statSync(gitMetadata).isDirectory()
  ) {
    throw new Error(
      "fixture inspection requires project-contained non-symlink Git metadata",
    );
  }
  const materializationSpecSha256 =
    expectedMaterializationSha256(scenarioId);
  const gitHead = runGit(target, ["rev-parse", "--verify", "HEAD"]);
  if (!GIT_COMMIT_ID.test(gitHead)) {
    throw new Error("fixture inspection could not read an exact Git commit");
  }
  if (!gitIsAncestor(target, expectedBaseline.git_head, gitHead)) {
    throw new Error(
      `fixture inspection target does not descend from the canonical ${scenarioId} baseline`,
    );
  }
  const treeSha256 = projectTreeSha256(target);
  return {
    ok: true,
    schema_version: 1,
    scenario_id: scenarioId,
    target,
    receipt: {
      materialization_spec_sha256: materializationSpecSha256,
      project_tree_sha256: treeSha256,
      project_state_sha256: projectStateSha256({
        materializationSpecSha256,
        gitHead,
        projectTreeSha256: treeSha256,
      }),
    },
    git: {
      head: gitHead,
      baseline_head: expectedBaseline.git_head,
      baseline_ancestor: true,
    },
  };
}

function parseCommandArguments(
  args,
  { valueOptions = [], flags = [] } = {},
) {
  const allowedValues = new Set(valueOptions);
  const allowedFlags = new Set(flags);
  const values = new Map();
  const enabledFlags = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (allowedFlags.has(argument)) {
      if (enabledFlags.has(argument)) {
        throw new Error(`duplicate CLI flag: ${argument}`);
      }
      enabledFlags.add(argument);
      continue;
    }
    if (!allowedValues.has(argument)) {
      throw new Error(`unsupported CLI argument: ${argument}`);
    }
    if (values.has(argument)) {
      throw new Error(`duplicate CLI option: ${argument}`);
    }
    const value = args[index + 1];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new Error(`missing value for CLI option: ${argument}`);
    }
    values.set(argument, value);
    index += 1;
  }
  return { values, enabledFlags };
}

function main() {
  const [command = "list", ...args] = process.argv.slice(2);
  if (command === "list") {
    parseCommandArguments(args);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        scenarios: fixtureCatalog().fixtures.map((fixture) => ({
          scenario_id: fixture.scenario_id,
          fixture_receipt: receiptForFixture(fixture),
          expected_baseline: expectedFixtureBaseline(
            fixture.scenario_id,
          ),
          ...(fixture.provider_execution?.requires_explicit_sandbox_opt_in
            ? {
                prerequisite: {
                  provider: fixture.provider_execution.provider,
                  mode: fixture.provider_execution.mode,
                  explicit_opt_in: LIVE_LINEAR_SANDBOX_OPT_IN,
                  ambient_credentials_authorize: false,
                },
              }
            : {}),
        })),
      }, null, 2)}\n`,
    );
    return;
  }
  if (command === "propose-baselines") {
    parseCommandArguments(args);
    process.stdout.write(
      `${JSON.stringify(proposeFixtureBaselines(), null, 2)}\n`,
    );
    return;
  }
  if (command === "external-inputs") {
    const parsed = parseCommandArguments(args, {
      valueOptions: ["--scenario"],
    });
    const scenarioId = parsed.values.get("--scenario");
    if (!scenarioId) {
      throw new Error(
        "usage: skill-fixture.mjs external-inputs --scenario ID",
      );
    }
    const externalInputs = externalInputsForFixture(scenarioId).map(
      (input) => ({
        id: input.id,
        kind: input.kind,
        delivery: "prompt-only",
        content: input.content,
        content_sha256: `sha256:${sha256(input.content)}`,
      }),
    );
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        scenario_id: scenarioId,
        external_inputs: externalInputs,
      }, null, 2)}\n`,
    );
    return;
  }
  if (command === "materialize") {
    const parsed = parseCommandArguments(args, {
      valueOptions: ["--scenario", "--target"],
      flags: [LIVE_LINEAR_SANDBOX_OPT_IN],
    });
    const scenarioId = parsed.values.get("--scenario");
    const target = parsed.values.get("--target");
    if (!scenarioId || !target) {
      throw new Error(
        `usage: skill-fixture.mjs materialize --scenario ID --target DIR [${LIVE_LINEAR_SANDBOX_OPT_IN}]`,
      );
    }
    process.stdout.write(
      `${JSON.stringify(materializeFixture(scenarioId, target, {
        allowLiveLinearSandboxFixture: parsed.enabledFlags.has(
          LIVE_LINEAR_SANDBOX_OPT_IN,
        ),
      }), null, 2)}\n`,
    );
    return;
  }
  if (command === "inspect") {
    const parsed = parseCommandArguments(args, {
      valueOptions: ["--scenario", "--target"],
    });
    const scenarioId = parsed.values.get("--scenario");
    const target = parsed.values.get("--target");
    if (!scenarioId || !target) {
      throw new Error(
        "usage: skill-fixture.mjs inspect --scenario ID --target DIR",
      );
    }
    process.stdout.write(
      `${JSON.stringify(inspectFixtureProject(scenarioId, target), null, 2)}\n`,
    );
    return;
  }
  throw new Error(
    `usage: skill-fixture.mjs list | propose-baselines | external-inputs --scenario ID | materialize --scenario ID --target DIR [${LIVE_LINEAR_SANDBOX_OPT_IN}] | inspect --scenario ID --target DIR`,
  );
}

const isEntryPoint =
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(SCRIPT_FILE);
if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

export {
  EVALUATION_SCRUBBED_CREDENTIAL_ENVIRONMENT,
  EXPECTED_FIXTURE_IDS,
  LIVE_LINEAR_SANDBOX_OPT_IN,
  expectedMaterializationSha256,
  expectedFixtureBaseline,
  externalInputsForFixture,
  fixtureBaselineCatalog,
  fixtureCatalog,
  fixtureReceipt,
  inspectFixtureProject,
  materializeFixture,
  proposeFixtureBaselines,
  projectStateSha256,
  projectTreeSha256,
  validateFixtureProviderBoundary,
};
