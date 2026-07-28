import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CHECKPOINT_MARKDOWN_PATH,
  CHECKPOINT_PATH,
  CONFIG_PATH,
  COORDINATOR_PATH,
  CORE_POLICY_PATH,
  INSTALLATION_PATH,
  PROJECT_CLI_PATH,
  REVIEW_RECEIPT_PATH,
  REVIEW_WORKFLOW_PATH,
  StackError,
  checksHash,
  commandCheckpoint,
  commandCapabilities,
  commandAdoptManaged,
  commandApproveChecks,
  commandCheckLock,
  commandConfigure,
  commandCoordinator,
  commandDetect,
  commandDoctor,
  commandLock,
  commandMemoryHealth,
  commandMemorySetup,
  commandStart,
  commandStatus,
  commandUnlock,
  commandVerify,
  configurationHash,
  defaultConfig,
  detectProject,
  execute,
  installOrUpgrade,
  loadInstallation,
  pathInside,
  resolveTarget,
  validateConfig,
} from "../bin/ultimate-agent-stack.mjs";

const PACKAGE_CLI = fileURLToPath(
  new URL("../bin/ultimate-agent-stack.mjs", import.meta.url),
);

function temporaryProject() {
  const directory = mkdtempSync(join(tmpdir(), "ultimate-agent-stack-test-"));
  return {
    directory,
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function safeParallelPolicy(overrides = {}) {
  return {
    mode: "adaptive",
    max_workers: 3,
    serial_fallback: true,
    require_isolation_for_parallel_writes: true,
    allow_nested_delegation: false,
    authority_inheritance: "no_expansion",
    integration_owner: "primary_agent",
    ...overrides,
  };
}

function safeConfig() {
  const config = defaultConfig("/tmp/fixture", {
    stacks: ["javascript"],
    detected_at: "2026-01-01T00:00:00Z",
    checks: [],
  });
  config.onboarding.status = "complete";
  config.onboarding.configured_at = "2026-01-01T00:00:00Z";
  config.quality.checks = [
    {
      id: "test",
      argv: ["node", "--test"],
      required: true,
      timeout_seconds: 30,
    },
  ];
  return config;
}

function initializeGit(directory) {
  const result = spawnSync("git", ["init", directory], {
    encoding: "utf8",
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr);
}

function createJavaScriptFixture(directory) {
  writeJson(join(directory, "package.json"), {
    name: "fixture",
    private: true,
    type: "module",
    scripts: {
      lint: "node --check app.mjs",
      test: "node --test tests/*.test.mjs",
      build: "node -e \"console.log('build pass')\"",
    },
  });
  writeFileSync(
    join(directory, "app.mjs"),
    "export const answer = 42;\n",
    "utf8",
  );
  mkdirSync(join(directory, "tests"), { recursive: true });
  writeFileSync(
    join(directory, "tests", "app.test.mjs"),
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "import { answer } from '../app.mjs';",
      "test('answer', () => assert.equal(answer, 42));",
      "",
    ].join("\n"),
    "utf8",
  );
}

function fillLockArtifacts(directory) {
  const artifacts = join(directory, ".agent-stack", "artifacts");
  writeFileSync(
    join(artifacts, "DELIVERY.md"),
    "# Delivery\n\nThe fixture remains runnable.\n",
    "utf8",
  );
  writeFileSync(
    join(artifacts, "ARCHITECTURE.md"),
    "# Architecture\n\nNo binding decision.\n",
    "utf8",
  );
  writeFileSync(
    join(artifacts, "SECURITY.md"),
    "# Security\n\nNo exposed security surface in the fixture.\n",
    "utf8",
  );
}

function configureFixture(directory, knowledge = "repository") {
  initializeGit(directory);
  createJavaScriptFixture(directory);
  installOrUpgrade(directory, { mode: "init" });
  commandConfigure(directory, {
    profile: "standard",
    review: "builtin",
    knowledge,
    knowledgeScope: "project",
    externalData:
      knowledge === "gbrain" ? "approved_providers" : "local_only",
    reason:
      knowledge === "gbrain"
        ? "Approved project-scoped local GBrain with repository fallback"
        : "Approved project-scoped repository memory for this fixture",
  });
}

function installFakeGbrain(directory, options = {}) {
  const toolDirectory = join(directory, "tool-bin");
  const executable = join(toolDirectory, "gbrain");
  const identity = options.malformedIdentity
    ? { version: "test" }
    : {
        version: "test",
        engine: "pglite",
        page_count: 1,
        chunk_count: 1,
      };
  mkdirSync(toolDirectory, { recursive: true });
  writeJson(join(toolDirectory, "package.json"), { type: "commonjs" });
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const home = process.env.GBRAIN_HOME;
const cache = path.join(home, "checkpoint-cache.json");
if (args[0] === "config" && args[1] === "get" && args[2] === "database_path") {
  process.stdout.write(path.join(home, "brain.pglite") + "\\n");
} else if (args[0] === "doctor") {
  process.stdout.write(JSON.stringify({status:"healthy",health_score:100,padding:"x".repeat(25000)}) + "\\n");
} else if (args[0] === "call" && args[1] === "get_brain_identity") {
  process.stdout.write(JSON.stringify(${JSON.stringify(identity)}) + "\\n");
} else if (args[0] === "capture") {
  const file = args[args.indexOf("--file") + 1];
  fs.writeFileSync(cache, JSON.stringify({compiled_truth:fs.readFileSync(file, "utf8")}));
  process.stdout.write(JSON.stringify({slug:"projects/ultimate-agent-stack/checkpoint"}) + "\\n");
} else if (args[0] === "call" && args[1] === "get_page") {
  if (!fs.existsSync(cache)) process.exit(1);
  process.stdout.write(fs.readFileSync(cache, "utf8") + "\\n");
} else {
  process.stderr.write("unexpected fake gbrain command: " + args.join(" ") + "\\n");
  process.exit(2);
}
`,
    "utf8",
  );
  chmodSync(executable, 0o755);
  mkdirSync(join(directory, ".agent-stack", "gbrain-home"), {
    recursive: true,
  });
  mkdirSync(
    join(directory, ".agent-stack", "gbrain-home", "brain.pglite"),
    { recursive: true },
  );
  return toolDirectory;
}

test("detectProject discovers project-native JavaScript checks", () => {
  const fixture = temporaryProject();
  try {
    createJavaScriptFixture(fixture.directory);
    writeFileSync(join(fixture.directory, "pnpm-lock.yaml"), "", "utf8");

    const detected = detectProject(fixture.directory);

    assert.deepEqual(detected.stacks, ["javascript"]);
    assert.deepEqual(
      detected.checks.map((check) => check.id),
      ["lint", "test", "build"],
    );
    assert.ok(
      detected.checks.every(
        (check) => check.argv[0] === "pnpm" && check.argv[1] === "run",
      ),
    );
  } finally {
    fixture.cleanup();
  }
});

test("detectProject explains isolated ecosystem environment requirements", () => {
  const fixture = temporaryProject();
  try {
    writeFileSync(join(fixture.directory, "pom.xml"), "<project />\n");

    const detected = detectProject(fixture.directory);

    assert.deepEqual(detected.stacks, ["java-maven"]);
    assert.equal(detected.checks[0].argv[0], "mvn");
    assert.deepEqual(
      detected.environment_warnings[0].inherited_if_present,
      ["JAVA_HOME", "M2_HOME", "MAVEN_HOME"],
    );
    assert.match(
      detected.environment_warnings[0].detail,
      /user-home Maven settings are isolated/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("project path guard rejects traversal and symlink escapes", () => {
  const fixture = temporaryProject();
  const outside = temporaryProject();
  try {
    assert.throws(
      () => pathInside(fixture.directory, "../outside", "test"),
      StackError,
    );
    symlinkSync(outside.directory, join(fixture.directory, "escape"));
    assert.throws(
      () => pathInside(fixture.directory, "escape/file.txt", "test"),
      /symlink outside the project/,
    );
  } finally {
    fixture.cleanup();
    outside.cleanup();
  }
});

test("resolveTarget rejects filesystem root and user home", () => {
  assert.throws(() => resolveTarget("/"), /Refusing broad target/);
});

test("clean project lifecycle initializes, approves, verifies, and locks", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    createJavaScriptFixture(fixture.directory);

    const initialized = installOrUpgrade(fixture.directory, { mode: "init" });
    assert.equal(initialized.ok, true);
    assert.equal(initialized.pending_reconciliation.length, 0);
    assert.ok(existsSync(join(fixture.directory, INSTALLATION_PATH)));
    assert.ok(existsSync(join(fixture.directory, PROJECT_CLI_PATH)));
    assert.ok(
      existsSync(
        join(
          fixture.directory,
          ".agent-stack",
          "bin",
          "gbrain-project.mjs",
        ),
      ),
    );
    assert.ok(existsSync(join(fixture.directory, CORE_POLICY_PATH)));
    assert.ok(
      existsSync(
        join(
          fixture.directory,
          ".agents",
          "skills",
          "run-autonomous-delivery",
          "SKILL.md",
        ),
      ),
    );
    assert.ok(
      existsSync(
        join(
          fixture.directory,
          ".agents",
          "skills",
          "coordinate-parallel-delivery",
          "SKILL.md",
        ),
      ),
    );
    assert.ok(
      existsSync(
        join(
          fixture.directory,
          ".codex",
          "agents",
          "uas_researcher.toml",
        ),
      ),
    );
    assert.ok(
      existsSync(
        join(
          fixture.directory,
          ".gemini",
          "agents",
          "uas-researcher.md",
        ),
      ),
    );
    assert.ok(
      existsSync(
        join(
          fixture.directory,
          ".opencode",
          "agents",
          "uas-researcher.md",
        ),
      ),
    );
    assert.ok(
      existsSync(
        join(
          fixture.directory,
          ".claude",
          "agents",
          "uas-researcher.md",
        ),
      ),
    );
    assert.ok(
      existsSync(
        join(
          fixture.directory,
          ".claude",
          "skills",
          "run-autonomous-delivery",
          "SKILL.md",
        ),
      ),
    );
    const initializedConfig = readJson(
      join(fixture.directory, CONFIG_PATH),
    );
    assert.deepEqual(
      initializedConfig.parallel_delivery,
      safeParallelPolicy(),
    );
    assert.equal(initializedConfig.schema_version, 2);
    assert.equal(initializedConfig.onboarding.status, "pending");
    assert.equal(initializedConfig.capabilities.knowledge.scope, "project");
    assert.deepEqual(initializedConfig.quality.environment, { allow: [] });

    const copiedCli = spawnSync(
      "node",
      [join(fixture.directory, PROJECT_CLI_PATH), "--version"],
      { encoding: "utf8", shell: false },
    );
    assert.equal(copiedCli.status, 0, copiedCli.stderr);
    assert.match(copiedCli.stdout, /ultimate-agent-stack/);
    const restrictedGbrainLauncher = spawnSync(
      "node",
      [
        join(
          fixture.directory,
          ".agent-stack",
          "bin",
          "gbrain-project.mjs",
        ),
        "doctor",
      ],
      { encoding: "utf8", shell: false },
    );
    assert.equal(
      restrictedGbrainLauncher.status,
      2,
      restrictedGbrainLauncher.stderr,
    );
    assert.match(restrictedGbrainLauncher.stderr, /only permits/);

    const initialDoctor = commandDoctor(fixture.directory);
    assert.equal(initialDoctor.ok, false);
    assert.ok(
      initialDoctor.reports.some(
        (report) => report.name === "check-approval" && !report.ok,
      ),
    );
    assert.ok(
      initialDoctor.reports.some(
        (report) => report.name === "onboarding" && !report.ok,
      ),
    );

    const onboardingStart = commandStart(
      fixture.directory,
      "Build a safe fixture",
    );
    assert.equal(onboardingStart.phase, "onboarding");
    assert.match(onboardingStart.prompt, /at most one genuinely safe alternative/);
    assert.match(onboardingStart.prompt, /private local searchable memory/);

    const capabilities = commandCapabilities(fixture.directory);
    assert.equal(capabilities.available.review.builtin.available, true);
    assert.equal(capabilities.available.knowledge.repository.available, true);

    commandConfigure(fixture.directory, {
      profile: "standard",
      review: "builtin",
      knowledge: "repository",
      externalData: "local_only",
      reason: "Approved safe local defaults for the fixture project",
    });

    commandApproveChecks(
      fixture.directory,
      "Inspected package scripts and direct project commands",
    );
    const doctor = commandDoctor(fixture.directory);
    assert.equal(doctor.ok, true, JSON.stringify(doctor, null, 2));

    const verification = commandVerify(fixture.directory);
    assert.equal(
      verification.ok,
      true,
      JSON.stringify(verification, null, 2),
    );
    assert.ok(
      existsSync(
        join(fixture.directory, ".agent-stack", "runs", "latest.json"),
      ),
    );

    fillLockArtifacts(fixture.directory);
    assert.equal(commandLock(fixture.directory, []).ok, true);
    assert.equal(commandCheckLock(fixture.directory).ok, true);
    writeFileSync(
      join(fixture.directory, ".agent-stack", "artifacts", "DELIVERY.md"),
      "changed\n",
      "utf8",
    );
    assert.deepEqual(commandCheckLock(fixture.directory).differences, [
      "changed: .agent-stack/artifacts/DELIVERY.md",
    ]);
    assert.equal(
      commandUnlock(
        fixture.directory,
        "Acceptance contract changed after implementation discovery",
      ).ok,
      true,
    );

    const start = commandStart(
      fixture.directory,
      "Build a safe fixture",
      onboardingStart.coordinator.coordinator_token,
    );
    assert.equal(start.phase, "project-discovery");
    assert.match(start.prompt, /\$run-autonomous-delivery/);
    assert.match(start.prompt, /\$coordinate-parallel-delivery/);
    assert.match(start.prompt, /\$use-project-knowledge/);
    assert.match(start.prompt, /at most one genuinely useful safe alternative/);
  } finally {
    fixture.cleanup();
  }
});

test("one active Project Steward owns a checkout and stale leases recover", () => {
  const fixture = temporaryProject();
  try {
    configureFixture(fixture.directory);
    const mutexFile = join(
      fixture.directory,
      ".agent-stack",
      "coordinator.mutex",
    );
    writeFileSync(mutexFile, "abandoned-holder\n", "utf8");
    const staleTime = new Date(Date.now() - 60_000);
    utimesSync(mutexFile, staleTime, staleTime);

    const first = commandStart(fixture.directory, "Continue the project");
    assert.equal(existsSync(mutexFile), false);
    const token = first.coordinator.coordinator_token;
    assert.equal(first.coordinator.active, true);
    assert.ok(token.length >= 32);
    assert.throws(
      () => commandStart(fixture.directory, "Competing conversation"),
      /Another Project Steward/,
    );

    const heartbeat = commandCoordinator(fixture.directory, "heartbeat", {
      token,
    });
    assert.equal(heartbeat.resumed, true);
    assert.equal(
      commandCoordinator(fixture.directory, "status").state,
      "active",
    );
    assert.equal(
      commandCoordinator(fixture.directory, "release", { token }).released,
      true,
    );

    const second = commandStart(fixture.directory, "New conversation");
    const leaseFile = join(fixture.directory, COORDINATOR_PATH);
    const lease = readJson(leaseFile);
    lease.expires_at = "2000-01-01T00:00:00.000Z";
    writeJson(leaseFile, lease);
    const recovered = commandStart(fixture.directory, "Recover stale work");
    assert.equal(recovered.coordinator.replaced_stale_lease, true);
    assert.notEqual(
      recovered.coordinator.coordinator_token,
      second.coordinator.coordinator_token,
    );
    assert.throws(
      () =>
        commandCoordinator(fixture.directory, "takeover", {
          reason: "The prior conversation is no longer running",
        }),
      /requires --confirm-stopped/,
    );
    const takeover = commandCoordinator(fixture.directory, "takeover", {
      reason: "The prior conversation is no longer running",
      confirmStopped: true,
    });
    assert.equal(takeover.takeover, true);
    assert.notEqual(
      takeover.coordinator_token,
      recovered.coordinator.coordinator_token,
    );
  } finally {
    fixture.cleanup();
  }
});

test("checkpoint writes a validated handoff and start resumes it", () => {
  const fixture = temporaryProject();
  try {
    configureFixture(fixture.directory);
    const start = commandStart(fixture.directory, "Build continuity");
    const token = start.coordinator.coordinator_token;
    const checkpoint = commandCheckpoint(fixture.directory, {
      objective: "Ship the continuity layer",
      summary: "Coordinator and checkpoint behavior are implemented",
      status: "in_progress",
      completed: ["Added the coordinator lease"],
      decisions: ["Repository checkpoints remain authoritative"],
      nextSteps: ["Run the complete release check"],
      blockers: [],
      evidence: ["package.json"],
      token,
    });

    assert.equal(checkpoint.ok, true);
    assert.ok(existsSync(join(fixture.directory, CHECKPOINT_PATH)));
    assert.ok(existsSync(join(fixture.directory, CHECKPOINT_MARKDOWN_PATH)));
    assert.match(
      readFileSync(join(fixture.directory, CHECKPOINT_MARKDOWN_PATH), "utf8"),
      /Run the complete release check/,
    );
    const resumed = commandStart(
      fixture.directory,
      "Continue continuity",
      token,
    );
    assert.equal(resumed.checkpoint.checkpoint_id, checkpoint.checkpoint_id);
    assert.match(resumed.prompt, new RegExp(checkpoint.checkpoint_id));

    assert.throws(
      () =>
        commandCheckpoint(fixture.directory, {
          objective: "Unsafe handoff",
          summary: "api_key=raw-test-secret-value",
          status: "complete",
          completed: [],
          decisions: [],
          nextSteps: [],
          blockers: [],
          evidence: [],
          token,
        }),
      /appears to contain a secret/,
    );

    const checkpointFile = join(fixture.directory, CHECKPOINT_PATH);
    const tampered = readJson(checkpointFile);
    tampered.summary = "Manually altered";
    writeJson(checkpointFile, tampered);
    const recovery = commandStart(
      fixture.directory,
      "Use tampered state",
      token,
    );
    assert.equal(recovery.ok, false);
    assert.equal(recovery.phase, "checkpoint-recovery");
    assert.match(recovery.error, /integrity check failed/);
    assert.equal(recovery.coordinator.coordinator_token, token);
    assert.match(
      commandStatus(fixture.directory).checkpoint.error,
      /integrity check failed/,
    );

    commandCheckpoint(fixture.directory, {
      objective: "Recover the continuity record",
      summary: "The invalid checkpoint was safely replaced",
      status: "complete",
      completed: ["Recreated the deterministic checkpoint"],
      decisions: ["Preserve the repository checkpoint as authority"],
      nextSteps: [],
      blockers: [],
      evidence: ["package.json"],
      token,
    });
    writeJson(join(fixture.directory, COORDINATOR_PATH), {
      schema_version: 1,
    });
    const corruptLeaseStatus = commandStatus(fixture.directory);
    assert.equal(corruptLeaseStatus.ok, false);
    assert.match(
      corruptLeaseStatus.coordinator.error,
      /Invalid .agent-stack\/coordinator.json/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("local GBrain setup is scoped and doctor performs live checks", () => {
  const fixture = temporaryProject();
  const outside = temporaryProject();
  const originalPath = process.env.PATH;
  try {
    configureFixture(fixture.directory, "gbrain");
    const toolDirectory = installFakeGbrain(fixture.directory);
    process.env.PATH = `${toolDirectory}${platform() === "win32" ? ";" : ":"}${originalPath}`;

    const setup = commandMemorySetup(fixture.directory, "codex");
    assert.equal(setup.mode, "guided-local-project");
    assert.match(
      setup.steps.find((step) => step.id === "connect-project-mcp")
        .connection.config,
      /\[mcp_servers\.gbrain\]/,
    );
    assert.match(
      setup.steps.find((step) => step.id === "initialize-local-brain")
        .environment.GBRAIN_HOME,
      /\.agent-stack\/gbrain-home$/,
    );

    const health = commandMemoryHealth(fixture.directory);
    assert.equal(health.ok, true, JSON.stringify(health, null, 2));
    assert.equal(health.scope_verified, true);
    assert.equal(health.identity.engine, "pglite");
    const doctor = commandDoctor(fixture.directory);
    const knowledge = doctor.reports.find(
      (report) => report.name === "knowledge-provider",
    );
    assert.equal(knowledge.ok, true, JSON.stringify(knowledge, null, 2));

    const start = commandStart(fixture.directory, "Use local memory");
    const checkpoint = commandCheckpoint(fixture.directory, {
      objective: "Prove GBrain continuity",
      summary: "The verified handoff is ready to mirror",
      status: "complete",
      completed: ["Ran the live provider checks"],
      decisions: ["Use project-scoped local memory"],
      nextSteps: [],
      blockers: [],
      evidence: ["package.json"],
      token: start.coordinator.coordinator_token,
    });
    assert.equal(checkpoint.memory_capture.status, "mirrored");
    commandCoordinator(fixture.directory, "release", {
      token: start.coordinator.coordinator_token,
    });
    const resumed = commandStart(fixture.directory, "Resume from memory");
    assert.equal(resumed.memory.checkpoint_test, "passed");

    const databasePath = join(
      fixture.directory,
      ".agent-stack",
      "gbrain-home",
      "brain.pglite",
    );
    rmSync(databasePath, { recursive: true, force: true });
    symlinkSync(outside.directory, databasePath);
    const escaped = commandMemoryHealth(fixture.directory);
    assert.equal(escaped.ok, false);
    assert.match(escaped.error, /not contained/);
  } finally {
    process.env.PATH = originalPath;
    fixture.cleanup();
    outside.cleanup();
  }
});

test("GBrain health attributes a malformed identity response correctly", () => {
  const fixture = temporaryProject();
  const originalPath = process.env.PATH;
  try {
    configureFixture(fixture.directory, "gbrain");
    const toolDirectory = installFakeGbrain(fixture.directory, {
      malformedIdentity: true,
    });
    process.env.PATH = `${toolDirectory}${platform() === "win32" ? ";" : ":"}${originalPath}`;

    const health = commandMemoryHealth(fixture.directory);

    assert.equal(health.ok, false);
    assert.equal(
      health.error,
      "gbrain identity response is missing an engine identifier",
    );
  } finally {
    process.env.PATH = originalPath;
    fixture.cleanup();
  }
});

test("init preserves a pre-existing policy and requires reconciliation", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    writeFileSync(join(fixture.directory, "AGENTS.md"), "local policy\n", "utf8");

    const result = installOrUpgrade(fixture.directory, { mode: "init" });

    assert.equal(
      readFileSync(join(fixture.directory, "AGENTS.md"), "utf8"),
      "local policy\n",
    );
    assert.deepEqual(result.pending_reconciliation, ["AGENTS.md"]);
    const installation = loadInstallation(fixture.directory);
    assert.equal(
      installation.pending_files["AGENTS.md"].reason,
      "pre-existing-file",
    );
    assert.ok(
      existsSync(
        join(
          fixture.directory,
          installation.pending_files["AGENTS.md"].proposal,
        ),
      ),
    );

    commandAdoptManaged(
      fixture.directory,
      "AGENTS.md",
      "Merged package safety rules into the existing project policy",
    );
    const adopted = loadInstallation(fixture.directory);
    assert.equal(adopted.pending_files["AGENTS.md"], undefined);
    assert.equal(adopted.managed_files["AGENTS.md"].customized, true);
  } finally {
    fixture.cleanup();
  }
});

test("simple preset expands to the safe local project configuration", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    createJavaScriptFixture(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });

    assert.throws(
      () =>
        execute("configure", [
          "--target",
          fixture.directory,
          "--preset",
          "unknown",
          "--reason",
          "Approved a deliberately unknown configuration preset",
        ]),
      /--preset must be one of: simple/,
    );
    for (const inheritedPreset of [
      "constructor",
      "toString",
      "hasOwnProperty",
      "valueOf",
      "__proto__",
    ]) {
      assert.throws(
        () =>
          execute("configure", [
            "--target",
            fixture.directory,
            "--preset",
            inheritedPreset,
            "--reason",
            "Rejected an inherited object property as a preset name",
          ]),
        /--preset must be one of: simple/,
      );
    }
    assert.throws(
      () =>
        execute("configure", [
          "--target",
          fixture.directory,
          "--preset",
          "simple",
          "--profile",
          "standard",
          "--reason",
          "Attempted to mix a preset with manual configuration",
        ]),
      /--preset cannot be combined with manual configuration options: --profile/,
    );

    const configured = execute("configure", [
      "--target",
      fixture.directory,
      "--preset",
      "simple",
      "--reason",
      "Approved the recommended simple project configuration",
    ]);
    assert.equal(configured.preset, "simple");
    const config = readJson(join(fixture.directory, CONFIG_PATH));
    assert.deepEqual(config.onboarding, {
      status: "complete",
      project_profile: "standard",
      external_data_policy: "local_only",
      configured_at: config.onboarding.configured_at,
    });
    assert.deepEqual(config.capabilities.review, {
      provider: "builtin",
      required_for_release: false,
      current_revision_required: true,
      allowed_logins: [],
    });
    assert.deepEqual(config.capabilities.knowledge, {
      provider: "repository",
      scope: "project",
      required: false,
      capture: "verified_proposals_only",
      repository_fallback: true,
    });
    assert.equal(config.autonomy.execution, "agent_owned");
    assert.equal(config.autonomy.merge, "human_approval_required");
    assert.equal(config.parallel_delivery.mode, "adaptive");
    assert.equal(config.parallel_delivery.serial_fallback, true);
    assert.equal(
      config.safety.approved_configuration_hash,
      configurationHash(config),
    );
  } finally {
    fixture.cleanup();
  }
});

test("doctor keeps JSON by default and offers an explicit human summary", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    createJavaScriptFixture(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });

    const jsonDoctor = spawnSync(
      process.execPath,
      [PACKAGE_CLI, "doctor", "--target", fixture.directory],
      { encoding: "utf8", shell: false },
    );
    assert.equal(jsonDoctor.status, 1, jsonDoctor.stderr);
    assert.equal(JSON.parse(jsonDoctor.stdout).ok, false);

    const pendingDoctor = spawnSync(
      process.execPath,
      [PACKAGE_CLI, "doctor", "--target", fixture.directory, "--human"],
      { encoding: "utf8", shell: false },
    );
    assert.equal(pendingDoctor.status, 1, pendingDoctor.stderr);
    assert.match(pendingDoctor.stdout, /Almost ready\./);
    assert.match(pendingDoctor.stdout, /Tell your coding agent/);
    assert.match(
      pendingDoctor.stdout,
      /You do not need to edit configuration files yourself/,
    );
    assert.doesNotMatch(pendingDoctor.stdout, /^\s*\{/);

    execute("configure", [
      "--target",
      fixture.directory,
      "--preset",
      "simple",
      "--reason",
      "Approved the recommended simple project configuration",
    ]);
    commandApproveChecks(
      fixture.directory,
      "Inspected package scripts and direct project commands",
    );
    const readyDoctor = spawnSync(
      process.execPath,
      [PACKAGE_CLI, "doctor", "--target", fixture.directory, "--human"],
      { encoding: "utf8", shell: false },
    );
    assert.equal(readyDoctor.status, 0, readyDoctor.stderr);
    assert.match(readyDoctor.stdout, /Ready\./);
    assert.match(
      readyDoctor.stdout,
      /Tell your coding agent what you want to build or change/,
    );

    const policy = join(fixture.directory, CORE_POLICY_PATH);
    chmodSync(policy, 0o600);
    writeFileSync(policy, "{}\n", "utf8");
    const unsafeDoctor = spawnSync(
      process.execPath,
      [PACKAGE_CLI, "doctor", "--target", fixture.directory, "--human"],
      { encoding: "utf8", shell: false },
    );
    assert.equal(unsafeDoctor.status, 1, unsafeDoctor.stderr);
    assert.match(unsafeDoctor.stdout, /Needs attention\./);
    assert.match(unsafeDoctor.stdout, /protected safety files/);
    assert.match(unsafeDoctor.stdout, /Do not edit the protected files yourself/);
  } finally {
    fixture.cleanup();
  }
});

test("doctor describes an empty post-init project as almost ready", () => {
  const fixture = temporaryProject();
  try {
    installOrUpgrade(fixture.directory, { mode: "init" });

    const jsonDoctor = spawnSync(
      process.execPath,
      [PACKAGE_CLI, "doctor", "--target", fixture.directory],
      { encoding: "utf8", shell: false },
    );
    assert.equal(jsonDoctor.status, 1, jsonDoctor.stderr);
    const result = JSON.parse(jsonDoctor.stdout);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.reports.find((report) => report.name === "config")?.detail,
      ["no project quality checks configured"],
    );
    assert.equal(
      result.reports.find((report) => report.name === "config")?.code,
      "first-baseline-pending",
    );
    assert.equal(
      result.reports.find((report) => report.name === "onboarding")?.code,
      "pending",
    );
    assert.equal(
      result.reports.find(
        (report) => report.name === "configuration-approval",
      )?.code,
      "not-approved",
    );
    assert.equal(
      result.reports.find((report) => report.name === "check-approval")?.code,
      "not-approved",
    );
    assert.ok(
      result.reports.some(
        (report) =>
          report.name === "git" &&
          !report.ok &&
          report.code === "not-initialized",
      ),
    );

    const humanDoctor = spawnSync(
      process.execPath,
      [PACKAGE_CLI, "doctor", "--target", fixture.directory, "--human"],
      { encoding: "utf8", shell: false },
    );
    assert.equal(humanDoctor.status, 1, humanDoctor.stderr);
    assert.match(humanDoctor.stdout, /Almost ready\./);
    assert.match(humanDoctor.stdout, /first quality-check baseline/);
    assert.match(humanDoctor.stdout, /Initialize Git in this project/);
    assert.match(humanDoctor.stdout, /create the first project checks/i);
    assert.doesNotMatch(
      humanDoctor.stdout,
      /project configuration is missing or invalid/,
    );

    const configFile = join(fixture.directory, CONFIG_PATH);
    const pendingConfig = readJson(configFile);
    pendingConfig.safety.approved_configuration_hash = "stale";
    writeJson(configFile, pendingConfig);
    const staleConfigurationDoctor = spawnSync(
      process.execPath,
      [PACKAGE_CLI, "doctor", "--target", fixture.directory, "--human"],
      { encoding: "utf8", shell: false },
    );
    assert.equal(staleConfigurationDoctor.status, 1);
    assert.match(staleConfigurationDoctor.stdout, /Needs attention\./);
    assert.doesNotMatch(staleConfigurationDoctor.stdout, /Almost ready\./);

    pendingConfig.safety.approved_configuration_hash = null;
    pendingConfig.safety.approved_checks_hash = "stale";
    writeJson(configFile, pendingConfig);
    const staleChecksDoctor = spawnSync(
      process.execPath,
      [PACKAGE_CLI, "doctor", "--target", fixture.directory, "--human"],
      { encoding: "utf8", shell: false },
    );
    assert.equal(staleChecksDoctor.status, 1);
    assert.match(staleChecksDoctor.stdout, /Needs attention\./);
    assert.doesNotMatch(staleChecksDoctor.stdout, /Almost ready\./);

    pendingConfig.safety.approved_checks_hash = null;
    writeJson(configFile, pendingConfig);
    mkdirSync(join(fixture.directory, ".git"));
    const invalidGitDoctor = spawnSync(
      process.execPath,
      [PACKAGE_CLI, "doctor", "--target", fixture.directory, "--human"],
      { encoding: "utf8", shell: false },
    );
    assert.equal(invalidGitDoctor.status, 1);
    assert.match(invalidGitDoctor.stdout, /Needs attention\./);
    assert.match(
      invalidGitDoctor.stdout,
      /project configuration is missing or invalid/,
    );
    assert.doesNotMatch(invalidGitDoctor.stdout, /Almost ready\./);

    rmSync(join(fixture.directory, ".git"), {
      recursive: true,
      force: true,
    });
    const malformedConfig = readJson(configFile);
    malformedConfig.schema_version = 999;
    malformedConfig.onboarding.status = null;
    writeJson(configFile, malformedConfig);
    const malformedDoctor = spawnSync(
      process.execPath,
      [PACKAGE_CLI, "doctor", "--target", fixture.directory, "--human"],
      { encoding: "utf8", shell: false },
    );
    assert.equal(malformedDoctor.status, 1, malformedDoctor.stderr);
    assert.match(malformedDoctor.stdout, /Needs attention\./);
    assert.match(
      malformedDoctor.stdout,
      /project configuration is missing or invalid/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("guided configuration enforces safe provider combinations", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    createJavaScriptFixture(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });

    assert.throws(
      () =>
        commandConfigure(fixture.directory, {
          profile: "production",
          review: "builtin",
          knowledge: "repository",
          externalData: "local_only",
          reason: "Attempted unsafe production configuration",
        }),
      /requires CodeRabbit or an allowed GitHub human reviewer/,
    );
    assert.throws(
      () =>
        commandConfigure(fixture.directory, {
          profile: "standard",
          review: "builtin",
          knowledge: "gbrain",
          externalData: "local_only",
          reason: "Attempted external memory without data approval",
        }),
      /external provider/,
    );
    assert.throws(
      () =>
        commandConfigure(fixture.directory, {
          profile: "standard",
          review: "builtin",
          knowledge: "repository",
          knowledgeScope: "organization",
          externalData: "local_only",
          reason: "Attempted unsupported repository organization scope",
        }),
      /project scope only/,
    );
    assert.throws(
      () =>
        commandConfigure(fixture.directory, {
          profile: "production",
          review: "github-human",
          knowledge: "repository",
          externalData: "local_only",
          reason: "Attempted human review without an allowlist",
        }),
      /allowed GitHub logins/,
    );

    const validArguments = {
      profile: "standard",
      review: "builtin",
      knowledge: "repository",
      externalData: "local_only",
      execution: "agent_owned",
      merge: "human_approval_required",
      reason: "Approved values used to exercise configuration validation",
    };
    const invalidArguments = [
      {
        override: { reason: "too short" },
        expected: /Configuration reason/,
      },
      {
        override: { profile: "unknown-profile" },
        expected: /--profile must be/,
      },
      {
        override: { review: "unknown-review" },
        expected: /--review must be/,
      },
      {
        override: { knowledge: "unknown-knowledge" },
        expected: /--knowledge must be/,
      },
      {
        override: { externalData: "unknown-policy" },
        expected: /--external-data must be/,
      },
      {
        override: { execution: "unknown-execution" },
        expected: /--execution must be/,
      },
      {
        override: { merge: "unknown-merge" },
        expected: /--merge must be/,
      },
    ];
    for (const { override, expected } of invalidArguments) {
      assert.throws(
        () =>
          commandConfigure(fixture.directory, {
            ...validArguments,
            ...override,
          }),
        expected,
      );
    }
    const unapproved = readJson(join(fixture.directory, CONFIG_PATH));
    assert.equal(unapproved.onboarding.status, "pending");
    assert.equal(unapproved.safety.approved_configuration_hash, null);
    assert.equal(unapproved.safety.configuration_approved_at, null);

    const configured = commandConfigure(fixture.directory, {
      profile: "production",
      review: "github-human",
      knowledge: "repository",
      externalData: "local_only",
      reviewers: ["Trusted-Owner", "trusted-owner"],
      reason: "Approved production review by the repository owner",
    });
    assert.deepEqual(
      configured.capabilities.review.allowed_logins,
      ["trusted-owner"],
    );
    const gbrain = commandConfigure(fixture.directory, {
      profile: "standard",
      review: "builtin",
      knowledge: "gbrain",
      knowledgeScope: "organization",
      externalData: "approved_providers",
      reason: "Approved organization-scoped GBrain knowledge",
    });
    assert.equal(gbrain.capabilities.knowledge.scope, "organization");
    const organizationHealth = commandMemoryHealth(fixture.directory);
    assert.equal(organizationHealth.ok, false);
    assert.equal(organizationHealth.scope_verified, false);
    assert.match(organizationHealth.error, /remote identity/);
  } finally {
    fixture.cleanup();
  }
});

test("github-human validation returns errors for non-array allowlists", () => {
  const config = safeConfig();
  config.capabilities.review = {
    provider: "github-human",
    required_for_release: true,
    current_revision_required: true,
    allowed_logins: null,
  };

  const errors = validateConfig(config);

  assert.match(errors.join("\n"), /allowed_logins must contain/);
  assert.match(errors.join("\n"), /requires at least one allowed/);
});

test("provider or authority changes invalidate configuration approval", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    createJavaScriptFixture(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });
    commandConfigure(fixture.directory, {
      profile: "standard",
      review: "builtin",
      knowledge: "repository",
      externalData: "local_only",
      reason: "Approved local providers with human-controlled merge",
    });

    const configFile = join(fixture.directory, CONFIG_PATH);
    const config = readJson(configFile);
    assert.equal(
      config.safety.approved_configuration_hash,
      configurationHash(config),
    );
    config.autonomy.merge = "policy_authorized";
    config.interaction.maximum_options = 3;
    config.capabilities.knowledge.command = "unreviewed-provider-command";
    writeJson(configFile, config);

    const doctor = commandDoctor(fixture.directory);
    assert.ok(
      doctor.reports.some(
        (report) =>
          report.name === "config" &&
          report.ok === false &&
          JSON.stringify(report.detail).includes("unsupported key: command"),
      ),
    );
    assert.ok(
      doctor.reports.some(
        (report) =>
          report.name === "configuration-approval" && report.ok === false,
      ),
    );
    const verification = commandVerify(fixture.directory);
    assert.equal(verification.ok, false);
    assert.match(
      verification.configuration_errors.join("\n"),
      /choices changed or were not approved/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("upgrade preserves local customizations and proposes changed package content", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });
    const handoff = join(fixture.directory, ".agent-stack", "HANDOFF.md");
    writeFileSync(handoff, `${readFileSync(handoff, "utf8")}\nLocal rule.\n`);

    const firstUpgrade = installOrUpgrade(fixture.directory, { mode: "upgrade" });
    const localOutcome = firstUpgrade.outcomes.find(
      (outcome) => outcome.path === ".agent-stack/HANDOFF.md",
    );
    assert.equal(localOutcome.status, "adopted-local-change");
    assert.match(readFileSync(handoff, "utf8"), /Local rule/);

    const installationFile = join(fixture.directory, INSTALLATION_PATH);
    const installation = readJson(installationFile);
    installation.managed_files[".agent-stack/HANDOFF.md"].source_hash =
      "0".repeat(64);
    installation.managed_files[".agent-stack/HANDOFF.md"].accepted_hash =
      hashText(readFileSync(handoff, "utf8"));
    installation.managed_files[".agent-stack/HANDOFF.md"].customized = true;
    writeJson(installationFile, installation);

    const secondUpgrade = installOrUpgrade(fixture.directory, {
      mode: "upgrade",
    });
    const conflict = secondUpgrade.outcomes.find(
      (outcome) => outcome.path === ".agent-stack/HANDOFF.md",
    );
    assert.equal(conflict.status, "needs-reconciliation");
    assert.ok(existsSync(join(fixture.directory, conflict.proposal)));
    assert.match(readFileSync(handoff, "utf8"), /Local rule/);
  } finally {
    fixture.cleanup();
  }
});

test("upgrade proposes rather than overwrites an unmodified old managed file", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });
    const handoff = join(fixture.directory, ".agent-stack", "HANDOFF.md");
    writeFileSync(handoff, "old package handoff\n", "utf8");
    const installationFile = join(fixture.directory, INSTALLATION_PATH);
    const installation = readJson(installationFile);
    const oldHash = hashText("old package handoff\n");
    installation.managed_files[".agent-stack/HANDOFF.md"] = {
      source_hash: oldHash,
      accepted_hash: oldHash,
      customized: false,
      protected: false,
    };
    writeJson(installationFile, installation);

    const upgraded = installOrUpgrade(fixture.directory, { mode: "upgrade" });

    assert.equal(
      upgraded.outcomes.find(
        (outcome) => outcome.path === ".agent-stack/HANDOFF.md",
      ).status,
      "needs-reconciliation",
    );
    assert.match(readFileSync(handoff, "utf8"), /old package handoff/);
  } finally {
    fixture.cleanup();
  }
});

test("doctor fails when a protected package file drifts", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });
    const policy = join(fixture.directory, CORE_POLICY_PATH);
    chmodSync(policy, 0o600);
    writeFileSync(policy, "{}\n", "utf8");

    const doctor = commandDoctor(fixture.directory);

    assert.equal(doctor.ok, false);
    assert.ok(
      doctor.reports.some(
        (report) => report.name === "protected-files" && !report.ok,
      ),
    );
  } finally {
    fixture.cleanup();
  }
});

test("review receipt script and workflow install as protected guardrails", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });
    const installation = loadInstallation(fixture.directory);

    assert.ok(existsSync(join(fixture.directory, REVIEW_RECEIPT_PATH)));
    assert.ok(existsSync(join(fixture.directory, REVIEW_WORKFLOW_PATH)));
    assert.equal(
      installation.managed_files[REVIEW_RECEIPT_PATH].protected,
      true,
    );
    assert.equal(
      installation.managed_files[REVIEW_WORKFLOW_PATH].protected,
      true,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Claude mode installs the native read-only worker and skill copy", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    installOrUpgrade(fixture.directory, { claude: true, mode: "init" });
    const installation = loadInstallation(fixture.directory);

    assert.ok(
      existsSync(
        join(
          fixture.directory,
          ".claude",
          "agents",
          "uas-researcher.md",
        ),
      ),
    );
    assert.ok(
      existsSync(
        join(
          fixture.directory,
          ".claude",
          "skills",
          "coordinate-parallel-delivery",
          "SKILL.md",
        ),
      ),
    );
    assert.ok(installation.harnesses.includes("claude"));
  } finally {
    fixture.cleanup();
  }
});

test("init auto-detects Claude markers and upgrades remember the adapter", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    writeFileSync(join(fixture.directory, "CLAUDE.md"), "# Claude\n");
    mkdirSync(join(fixture.directory, ".grok"));

    const initialized = installOrUpgrade(fixture.directory, { mode: "init" });
    assert.deepEqual(initialized.harnesses.detected, ["claude", "grok"]);
    assert.ok(initialized.harnesses.enabled.includes("claude"));
    assert.ok(
      existsSync(
        join(
          fixture.directory,
          ".claude",
          "skills",
          "run-autonomous-delivery",
          "SKILL.md",
        ),
      ),
    );

    const upgraded = installOrUpgrade(fixture.directory, { mode: "upgrade" });
    assert.ok(upgraded.harnesses.enabled.includes("claude"));
    assert.equal(
      upgraded.outcomes.some(
        (outcome) =>
          outcome.path.startsWith(".claude/") &&
          outcome.status === "upstream-removed-preserved",
      ),
      false,
    );
  } finally {
    fixture.cleanup();
  }
});

test("default init installs the Claude entry skill without project markers", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    const initialized = execute("init", ["--target", fixture.directory]);
    assert.ok(initialized.harnesses.enabled.includes("claude"));
    assert.deepEqual(initialized.harnesses.detected, []);
    assert.ok(
      existsSync(
        join(
          fixture.directory,
          ".claude",
          "skills",
          "run-autonomous-delivery",
          "SKILL.md",
        ),
      ),
    );
  } finally {
    fixture.cleanup();
  }
});

test("legacy serial policy migrates to safe adaptive coordination", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    createJavaScriptFixture(fixture.directory);
    writeJson(join(fixture.directory, CONFIG_PATH), {
      schema_version: 1,
      project: { name: "legacy-fixture" },
      autonomy: {
        execution: "agent_owned",
        merge: "human_approval_required",
        parallel_work: "isolated_independent_only",
        max_repair_loops: 5,
      },
      safety: {
        require_check_approval: true,
        approved_checks_hash: null,
        project_root_only: true,
        forbid_shell_commands: true,
        max_check_timeout_seconds: 7200,
      },
      quality: {
        require_project_checks: true,
        checks: [],
        evidence_directory: ".agent-stack/runs",
      },
      lock_artifacts: [".agent-stack/artifacts/DELIVERY.md"],
    });

    installOrUpgrade(fixture.directory, { mode: "init" });

    const migrated = readJson(join(fixture.directory, CONFIG_PATH));
    assert.equal(
      migrated.autonomy.parallel_work,
      "coordinator_managed_isolated_only",
    );
    assert.deepEqual(migrated.parallel_delivery, safeParallelPolicy());
    assert.equal(migrated.schema_version, 2);
    assert.equal(migrated.onboarding.status, "needs_confirmation");
    assert.equal(migrated.onboarding.project_profile, "production");
    assert.equal(migrated.capabilities.review.provider, "coderabbit");
    assert.equal(
      migrated.capabilities.review.required_for_release,
      true,
    );
    assert.deepEqual(migrated.quality.environment, { allow: [] });
  } finally {
    fixture.cleanup();
  }
});

test("shipped native worker adapters are read-only and non-recursive", () => {
  const codex = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "assets",
      "project-template",
      ".codex",
      "agents",
      "uas_researcher.toml",
    ),
    "utf8",
  );
  const claude = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "assets",
      "project-template",
      ".claude",
      "agents",
      "uas-researcher.md",
    ),
    "utf8",
  );
  const gemini = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "assets",
      "project-template",
      ".gemini",
      "agents",
      "uas-researcher.md",
    ),
    "utf8",
  );
  const opencode = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "assets",
      "project-template",
      ".opencode",
      "agents",
      "uas-researcher.md",
    ),
    "utf8",
  );

  assert.match(codex, /sandbox_mode = "read-only"/);
  assert.match(codex, /Do not edit files, delegate/);
  assert.match(claude, /tools: Read, Grep, Glob/);
  assert.doesNotMatch(claude, /\bBash\b|\bWrite\b|\bEdit\b/);
  assert.match(gemini, /read_file/);
  assert.match(gemini, /grep_search/);
  assert.doesNotMatch(gemini, /run_shell_command/);
  assert.match(opencode, /edit: deny/);
  assert.match(opencode, /bash: deny/);
  assert.match(opencode, /"\*": deny/);
});

test("shell and destructive quality checks are rejected", () => {
  const config = safeConfig();
  config.quality.checks = [
    {
      id: "unsafe",
      argv: ["bash", "-c", "rm -rf ."],
      required: true,
      timeout_seconds: 30,
    },
  ];

  assert.match(validateConfig(config).join("\n"), /forbidden shell/);
});

test("inline evaluation checks are rejected in favor of reviewed files", () => {
  for (const argv of [
    ["node", "-e", "process.exit(0)"],
    ["node", "--eval=process.exit(0)"],
    ["node", "--print=1"],
    ["python3", "-c", "print('ok')"],
    ["python3", "-cprint('ok')"],
    ["ruby", "-e", "puts 'ok'"],
    ["perl", "-Esay 1"],
  ]) {
    const config = safeConfig();
    config.quality.checks = [
      {
        id: "inline",
        argv,
        required: true,
        timeout_seconds: 30,
      },
    ];

    assert.match(
      validateConfig(config).join("\n"),
      /uses inline code evaluation/,
    );
  }
});

test("Git inspection checks use subcommand-specific argument allowlists", () => {
  const accepted = [
    [
      "git",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--check",
    ],
    [
      "git",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--cached",
      "--name-only",
      "HEAD",
      "--",
      "src",
    ],
    [
      "git",
      "log",
      "--no-ext-diff",
      "--no-textconv",
      "--no-patch",
      "--format=%H",
      "--max-count=1",
      "HEAD",
    ],
    ["git", "rev-parse", "--verify", "HEAD"],
    [
      "git",
      "show",
      "--no-ext-diff",
      "--no-textconv",
      "--no-patch",
      "--format=%H",
      "HEAD",
    ],
    [
      "git",
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
    ],
  ];
  for (const argv of accepted) {
    const config = safeConfig();
    config.quality.checks = [
      {
        id: "git-inspection",
        argv,
        required: true,
        timeout_seconds: 30,
      },
    ];
    assert.deepEqual(
      validateConfig(config),
      [],
      `expected ${argv.join(" ")} to be accepted`,
    );
  }

  const rejected = [
    {
      argv: [
        "git",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-index",
        "a",
        "b",
      ],
      expected: /forbids write or execution argument: --no-index/,
    },
    {
      argv: [
        "git",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--output=/tmp/proof",
      ],
      expected: /forbids write or execution argument: --output=/,
    },
    {
      argv: ["git", "diff", "--no-ext-diff", "--textconv", "--check"],
      expected: /forbids write or execution argument: --textconv/,
    },
    {
      argv: ["git", "diff", "--ext-diff", "--no-textconv", "--check"],
      expected: /forbids write or execution argument: --ext-diff/,
    },
    {
      argv: ["git", "diff", "--check"],
      expected: /must include --no-ext-diff and --no-textconv/,
    },
    {
      argv: [
        "git",
        "log",
        "--no-ext-diff",
        "--no-textconv",
        "--output",
        "/tmp/proof",
      ],
      expected: /forbids write or execution argument: --output/,
    },
    {
      argv: [
        "git",
        "log",
        "--no-ext-diff",
        "--no-textconv",
        "--exec=touch /tmp/proof",
      ],
      expected: /forbids write or execution argument: --exec=/,
    },
    {
      argv: [
        "git",
        "log",
        "--no-ext-diff",
        "--no-textconv",
        "--format=%G?",
      ],
      expected: /argument is not allowlisted: --format=%G\?/,
    },
    {
      argv: ["git", "rev-parse", "--git-path=../../outside"],
      expected: /argument is not allowlisted: --git-path=/,
    },
    {
      argv: [
        "git",
        "show",
        "--no-ext-diff",
        "--no-textconv",
        "HEAD",
        "HEAD~1",
      ],
      expected: /accepts at most 1 revision argument/,
    },
    {
      argv: ["git", "status", "--porcelain", "../outside"],
      expected: /pathspecs must follow --/,
    },
    {
      argv: ["git", "status", "--porcelain", "--", "../outside"],
      expected: /pathspec escapes the project root/,
    },
  ];
  for (const { argv, expected } of rejected) {
    const config = safeConfig();
    config.quality.checks = [
      {
        id: "git-inspection",
        argv,
        required: true,
        timeout_seconds: 30,
      },
    ];
    assert.match(
      validateConfig(config).join("\n"),
      expected,
      `expected ${argv.join(" ")} to be rejected by ${expected}`,
    );
  }

  const fixture = temporaryProject();
  const outside = temporaryProject();
  try {
    symlinkSync(
      outside.directory,
      join(fixture.directory, "escaped"),
      platform() === "win32" ? "junction" : "dir",
    );
    const config = safeConfig();
    config.quality.checks = [
      {
        id: "git-inspection",
        argv: ["git", "status", "--porcelain", "--", "escaped"],
        required: true,
        timeout_seconds: 30,
      },
    ];
    assert.match(
      validateConfig(config, fixture.directory).join("\n"),
      /git status pathspec escapes the project root: escaped/,
    );
  } finally {
    fixture.cleanup();
    outside.cleanup();
  }
});

test("Terraform checks cannot format files or read arbitrary targets", () => {
  for (const argv of [
    ["terraform", "fmt", "-check", "-recursive"],
    [
      "terraform",
      "fmt",
      "-check",
      "-diff",
      "-list=false",
      "-no-color",
      "-write=false",
      ".",
    ],
    ["terraform", "validate"],
    ["terraform", "validate", "-json", "-no-color"],
  ]) {
    const config = safeConfig();
    config.quality.checks = [
      {
        id: "terraform",
        argv,
        required: true,
        timeout_seconds: 30,
      },
    ];
    assert.deepEqual(
      validateConfig(config),
      [],
      `expected ${argv.join(" ")} to be accepted`,
    );
  }

  for (const { argv, expected } of [
    {
      argv: ["terraform", "fmt"],
      expected: /terraform fmt must include -check/,
    },
    {
      argv: ["terraform", "fmt", "-write=true"],
      expected: /terraform fmt argument is not allowlisted: -write=true/,
    },
    {
      argv: ["terraform", "fmt", "-check", "../outside"],
      expected: /terraform fmt target escapes the project root/,
    },
    {
      argv: ["terraform", "validate", "-var-file=../../outside.tfvars"],
      expected: /terraform validate argument is not allowlisted: -var-file=/,
    },
    {
      argv: ["terraform", "validate", "../outside"],
      expected: /terraform validate argument is not allowlisted: ..\/outside/,
    },
  ]) {
    const config = safeConfig();
    config.quality.checks = [
      {
        id: "terraform",
        argv,
        required: true,
        timeout_seconds: 30,
      },
    ];
    assert.match(
      validateConfig(config).join("\n"),
      expected,
      `expected ${argv.join(" ")} to be rejected by ${expected}`,
    );
  }
});

test("verification rejects Git output attacks before outside files change", () => {
  const fixture = temporaryProject();
  const outside = temporaryProject();
  try {
    configureFixture(fixture.directory);
    writeFileSync(join(fixture.directory, "left"), "same\n", "utf8");
    writeFileSync(join(fixture.directory, "right"), "same\n", "utf8");
    const existingOutside = join(outside.directory, "existing-proof");
    const newOutside = join(outside.directory, "new-proof");
    writeFileSync(existingOutside, "do not truncate\n", "utf8");

    const configFile = join(fixture.directory, CONFIG_PATH);
    const config = readJson(configFile);
    config.quality.checks = [
      {
        id: "create-outside",
        argv: [
          "git",
          "diff",
          "--no-index",
          `--output=${newOutside}`,
          "left",
          "right",
        ],
        required: true,
        timeout_seconds: 30,
      },
      {
        id: "truncate-outside",
        argv: [
          "git",
          "diff",
          "--no-index",
          `--output=${existingOutside}`,
          "left",
          "right",
        ],
        required: true,
        timeout_seconds: 30,
      },
    ];
    config.safety.approved_checks_hash = checksHash(
      config.quality.checks,
      fixture.directory,
      config.quality.environment.allow,
    );
    writeJson(configFile, config);

    const verification = commandVerify(fixture.directory);
    assert.equal(verification.ok, false);
    assert.match(
      verification.configuration_errors.join("\n"),
      /forbids write or execution argument/,
    );
    assert.equal(existsSync(newOutside), false);
    assert.equal(
      readFileSync(existingOutside, "utf8"),
      "do not truncate\n",
    );
  } finally {
    fixture.cleanup();
    outside.cleanup();
  }
});

test(
  "approved Git inspection checks disable configured filesystem monitors",
  { skip: platform() === "win32" },
  () => {
    const fixture = temporaryProject();
    const outside = temporaryProject();
    try {
      configureFixture(fixture.directory);
      const marker = join(outside.directory, "fsmonitor-ran");
      const monitor = join(outside.directory, "fsmonitor");
      writeFileSync(
        monitor,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          `fs.writeFileSync(${JSON.stringify(marker)}, 'ran\\n');`,
          "process.stdout.write('0\\n');",
          "",
        ].join("\n"),
        "utf8",
      );
      chmodSync(monitor, 0o700);
      const configured = spawnSync(
        "git",
        ["-C", fixture.directory, "config", "core.fsmonitor", monitor],
        { encoding: "utf8", shell: false },
      );
      assert.equal(configured.status, 0, configured.stderr);

      const baseline = spawnSync(
        "git",
        ["-C", fixture.directory, "status", "--porcelain=v1"],
        { encoding: "utf8", shell: false },
      );
      assert.equal(baseline.status, 0, baseline.stderr);
      assert.equal(
        existsSync(marker),
        true,
        "fixture must prove the configured monitor is executable",
      );
      rmSync(marker);

      const configFile = join(fixture.directory, CONFIG_PATH);
      const config = readJson(configFile);
      config.quality.checks = [
        {
          id: "git-status",
          argv: ["git", "status", "--porcelain=v1"],
          required: true,
          timeout_seconds: 30,
        },
      ];
      writeJson(configFile, config);
      commandApproveChecks(
        fixture.directory,
        "Inspected the bounded Git status quality command",
      );

      const verification = commandVerify(fixture.directory);
      assert.equal(
        verification.ok,
        true,
        JSON.stringify(verification, null, 2),
      );
      assert.equal(existsSync(marker), false);
    } finally {
      fixture.cleanup();
      outside.cleanup();
    }
  },
);

test("environment allowlist accepts names and rejects credential-bearing names", () => {
  const valid = safeConfig();
  valid.quality.environment.allow = ["FEATURE_MODE", "LC_MESSAGES"];
  assert.equal(
    validateConfig(valid).some((error) =>
      error.includes("quality.environment.allow"),
    ),
    false,
  );

  for (const name of [
    "DATABASE_URL",
    "SERVICE_DSN",
    "API_TOKEN",
    "CONNECTION_STRING",
    "GIT_TRACE",
    "GIT_WORK_TREE",
    "bad-name",
    "NODE_OPTIONS",
    "PYTHONPATH",
    "JAVA_TOOL_OPTIONS",
    "TF_CLI_ARGS_fmt",
    "TF_LOG_PATH",
  ]) {
    const invalid = safeConfig();
    invalid.quality.environment.allow = [name];
    assert.match(
      validateConfig(invalid).join("\n"),
      /valid non-sensitive, non-execution-control environment names/,
    );
  }
});

test("malformed environment policy reports validation instead of crashing migration", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    createJavaScriptFixture(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });
    const configFile = join(fixture.directory, CONFIG_PATH);
    const config = readJson(configFile);
    config.quality.environment = "none";
    writeJson(configFile, config);

    const doctor = commandDoctor(fixture.directory);
    const configReport = doctor.reports.find(
      (report) => report.name === "config",
    );
    assert.equal(doctor.ok, false);
    assert.equal(configReport.ok, false);
    assert.match(
      JSON.stringify(configReport.detail),
      /quality\.environment must be an object/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("quality guardrails cannot be disabled in project config", () => {
  const config = safeConfig();
  config.safety.require_check_approval = false;
  config.safety.max_check_timeout_seconds = 9000;
  config.quality.require_project_checks = false;
  config.quality.checks = [
    {
      id: "unsafe-publish",
      argv: ["npm", "publish"],
      required: false,
      timeout_seconds: 900,
    },
  ];
  const errors = validateConfig(config);

  assert.match(errors.join("\n"), /require_check_approval must remain true/);
  assert.match(errors.join("\n"), /between 1 and 7200/);
  assert.match(errors.join("\n"), /require_project_checks must remain true/);
  assert.match(errors.join("\n"), /required must remain true/);
  assert.match(errors.join("\n"), /must be run or test/);
});

test("parallel-delivery guardrails cannot be disabled in project config", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    createJavaScriptFixture(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });
    const configFile = join(fixture.directory, CONFIG_PATH);
    const config = readJson(configFile);
    config.parallel_delivery = safeParallelPolicy({
      max_workers: 99,
      serial_fallback: false,
      require_isolation_for_parallel_writes: false,
      allow_nested_delegation: true,
      authority_inheritance: "worker_decides",
      integration_owner: "any_worker",
    });
    config.autonomy.parallel_work = "unrestricted";
    writeJson(configFile, config);

    const doctor = commandDoctor(fixture.directory);
    const parallelReport = doctor.reports.find(
      (report) => report.name === "parallel-delivery",
    );
    const configReport = doctor.reports.find(
      (report) => report.name === "config",
    );

    assert.equal(doctor.ok, false);
    assert.equal(parallelReport.ok, false);
    assert.match(JSON.stringify(configReport.detail), /max_workers/);
    assert.match(JSON.stringify(configReport.detail), /serial_fallback/);
    assert.match(JSON.stringify(configReport.detail), /nested_delegation/);
    assert.match(JSON.stringify(configReport.detail), /authority_inheritance/);
    assert.match(JSON.stringify(configReport.detail), /integration_owner/);
    assert.match(JSON.stringify(configReport.detail), /autonomy\.parallel_work/);
  } finally {
    fixture.cleanup();
  }
});

test("doctor rejects a malformed whole parallel-delivery policy", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    createJavaScriptFixture(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });
    const configFile = join(fixture.directory, CONFIG_PATH);
    const config = readJson(configFile);
    config.parallel_delivery = "unrestricted";
    writeJson(configFile, config);

    const doctor = commandDoctor(fixture.directory);
    const parallelReport = doctor.reports.find(
      (report) => report.name === "parallel-delivery",
    );

    assert.equal(doctor.ok, false);
    assert.equal(parallelReport.ok, false);
    assert.match(
      JSON.stringify(parallelReport.detail),
      /parallel_delivery must be an object/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("detect invalidates approval when discovered checks change", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    createJavaScriptFixture(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });
    commandApproveChecks(
      fixture.directory,
      "Inspected the original package script definitions",
    );
    const packageFile = join(fixture.directory, "package.json");
    const packageData = readJson(packageFile);
    delete packageData.scripts.build;
    writeJson(packageFile, packageData);

    commandDetect(fixture.directory, true);

    const config = readJson(join(fixture.directory, CONFIG_PATH));
    assert.equal(config.safety.approved_checks_hash, null);
    assert.equal(commandStatus(fixture.directory).checks_approved, false);
  } finally {
    fixture.cleanup();
  }
});

test("changing an approved package script invalidates approval before execution", () => {
  const fixture = temporaryProject();
  const outside = temporaryProject();
  try {
    initializeGit(fixture.directory);
    writeJson(join(fixture.directory, "package.json"), {
      name: "fixture",
      private: true,
      scripts: { test: "node safe.mjs" },
    });
    writeFileSync(join(fixture.directory, "safe.mjs"), "process.exit(0);\n");
    installOrUpgrade(fixture.directory, { mode: "init" });
    commandApproveChecks(
      fixture.directory,
      "Inspected the exact original package test script definition",
    );

    const escaped = join(outside.directory, "escaped.txt");
    writeFileSync(
      join(fixture.directory, "unsafe.mjs"),
      [
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync(${JSON.stringify(escaped)}, "unsafe");`,
        "",
      ].join("\n"),
    );
    writeJson(join(fixture.directory, "package.json"), {
      name: "fixture",
      private: true,
      scripts: { test: "node unsafe.mjs" },
    });

    assert.equal(commandStatus(fixture.directory).checks_approved, false);
    const verification = commandVerify(fixture.directory);
    assert.equal(verification.ok, false);
    assert.equal(existsSync(escaped), false);
    assert.match(
      verification.configuration_errors.join("\n"),
      /checks changed or were not reviewed/,
    );
  } finally {
    fixture.cleanup();
    outside.cleanup();
  }
});

test("verification does not expose inherited secret environment values", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    writeJson(join(fixture.directory, "package.json"), {
      name: "fixture",
      private: true,
      scripts: { test: "node check-env.mjs" },
    });
    writeFileSync(
      join(fixture.directory, "check-env.mjs"),
      [
        "const value = process.env.UAS_AUDIT_SECRET ?? 'not-inherited';",
        "process.stdout.write(value);",
        "",
      ].join("\n"),
    );
    installOrUpgrade(fixture.directory, { mode: "init" });
    commandConfigure(fixture.directory, {
      profile: "standard",
      review: "builtin",
      knowledge: "repository",
      externalData: "local_only",
      reason: "Approved safe local defaults for environment isolation",
    });
    commandApproveChecks(
      fixture.directory,
      "Inspected the exact environment-checking package script definition",
    );
    process.env.UAS_AUDIT_SECRET = "RAW_SENTINEL_SECRET_7f31";

    const verification = commandVerify(fixture.directory);
    const evidence = readFileSync(
      join(fixture.directory, ".agent-stack", "runs", "latest.json"),
      "utf8",
    );

    assert.equal(verification.ok, true);
    assert.doesNotMatch(evidence, /RAW_SENTINEL_SECRET_7f31/);
    assert.match(evidence, /not-inherited/);
  } finally {
    delete process.env.UAS_AUDIT_SECRET;
    fixture.cleanup();
  }
});

test("approved non-secret environment is inherited, redacted, and fingerprinted", () => {
  const fixture = temporaryProject();
  const previousBuildMode = process.env.UAS_BUILD_MODE;
  const previousJavaHome = process.env.JAVA_HOME;
  const previousNpmCache = process.env.npm_config_cache;
  try {
    initializeGit(fixture.directory);
    writeJson(join(fixture.directory, "package.json"), {
      name: "fixture",
      private: true,
      scripts: { test: "node check-approved-env.mjs" },
    });
    writeFileSync(
      join(fixture.directory, "check-approved-env.mjs"),
      [
        "if (process.env.UAS_BUILD_MODE !== 'approved-mode-sentinel') process.exit(2);",
        "if (process.env.JAVA_HOME !== '/opt/fixture-jdk') process.exit(3);",
        `if (process.env.npm_config_cache === ${JSON.stringify(fixture.directory)}) process.exit(4);`,
        "process.stdout.write(`${process.env.UAS_BUILD_MODE}\\n${process.env.JAVA_HOME}`);",
        "",
      ].join("\n"),
    );
    installOrUpgrade(fixture.directory, { mode: "init" });
    commandConfigure(fixture.directory, {
      profile: "standard",
      review: "builtin",
      knowledge: "repository",
      externalData: "local_only",
      reason: "Approved safe local defaults for explicit environment testing",
    });
    const configFile = join(fixture.directory, CONFIG_PATH);
    const config = readJson(configFile);
    config.quality.environment.allow = ["UAS_BUILD_MODE"];
    writeJson(configFile, config);
    process.env.UAS_BUILD_MODE = "approved-mode-sentinel";
    process.env.JAVA_HOME = "/opt/fixture-jdk";
    process.env.npm_config_cache = fixture.directory;
    commandApproveChecks(
      fixture.directory,
      "Inspected the check and approved one non-secret build-mode variable",
    );

    const verification = commandVerify(fixture.directory);
    const evidence = readFileSync(
      join(fixture.directory, ".agent-stack", "runs", "latest.json"),
      "utf8",
    );
    assert.equal(verification.ok, true, evidence);
    assert.doesNotMatch(evidence, /approved-mode-sentinel/);
    assert.match(evidence, /\[REDACTED\]/);
    assert.match(evidence, /\/opt\/fixture-jdk/);

    process.env.UAS_BUILD_MODE = "changed-mode-sentinel";
    assert.equal(commandStatus(fixture.directory).checks_approved, false);
    process.env.UAS_BUILD_MODE = "approved-mode-sentinel";
    assert.equal(commandStatus(fixture.directory).checks_approved, true);

    const changed = readJson(configFile);
    changed.quality.environment.allow = [];
    writeJson(configFile, changed);
    assert.equal(commandStatus(fixture.directory).checks_approved, false);
    const blocked = commandVerify(fixture.directory);
    assert.equal(blocked.ok, false);
    assert.match(
      blocked.configuration_errors.join("\n"),
      /quality checks changed or were not reviewed/,
    );
  } finally {
    for (const [name, value] of [
      ["UAS_BUILD_MODE", previousBuildMode],
      ["JAVA_HOME", previousJavaHome],
      ["npm_config_cache", previousNpmCache],
    ]) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    fixture.cleanup();
  }
});

test(
  "doctor requires direct project commands to be executable",
  { skip: platform() === "win32" },
  () => {
    const fixture = temporaryProject();
    try {
      initializeGit(fixture.directory);
      createJavaScriptFixture(fixture.directory);
      installOrUpgrade(fixture.directory, { mode: "init" });
      const commandFile = join(fixture.directory, "project-check");
      writeFileSync(commandFile, "#!/bin/sh\nexit 0\n");
      chmodSync(commandFile, 0o600);
      const configFile = join(fixture.directory, CONFIG_PATH);
      const config = readJson(configFile);
      config.quality.checks = [
        {
          id: "direct",
          argv: ["./project-check"],
          required: true,
          timeout_seconds: 30,
        },
      ];
      writeJson(configFile, config);

      const unavailable = commandDoctor(fixture.directory);
      assert.equal(
        unavailable.reports.find(
          (report) => report.name === "command:direct",
        ).ok,
        false,
      );

      chmodSync(commandFile, 0o700);
      const available = commandDoctor(fixture.directory);
      assert.equal(
        available.reports.find(
          (report) => report.name === "command:direct",
        ).ok,
        true,
      );
    } finally {
      fixture.cleanup();
    }
  },
);

test("verification distinguishes output capture overflow from test failure", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    writeJson(join(fixture.directory, "package.json"), {
      name: "fixture",
      private: true,
      scripts: { test: "node noisy.mjs" },
    });
    writeFileSync(
      join(fixture.directory, "noisy.mjs"),
      'process.stdout.write("x".repeat(5 * 1024 * 1024));\n',
    );
    installOrUpgrade(fixture.directory, { mode: "init" });
    commandConfigure(fixture.directory, {
      profile: "standard",
      review: "builtin",
      knowledge: "repository",
      externalData: "local_only",
      reason: "Approved safe defaults for output overflow classification",
    });
    commandApproveChecks(
      fixture.directory,
      "Inspected the intentionally verbose package test definition",
    );

    const verification = commandVerify(fixture.directory);
    const evidence = readJson(
      join(fixture.directory, ".agent-stack", "runs", "latest.json"),
    );
    assert.equal(verification.ok, false);
    assert.deepEqual(verification.checks, [
      {
        id: "test",
        status: "failed",
        returncode: 125,
        reason: "output-exceeded-capture-limit",
      },
    ]);
    assert.equal(
      evidence.checks[0].reason,
      "output-exceeded-capture-limit",
    );
    assert.match(evidence.checks[0].output, /output exceeded/);
  } finally {
    fixture.cleanup();
  }
});

test("project state writes reject a symlinked agent-stack directory", () => {
  const fixture = temporaryProject();
  const outside = temporaryProject();
  try {
    writeJson(join(fixture.directory, "package.json"), {
      name: "fixture",
      private: true,
      scripts: { test: "node -e \"process.exit(0)\"" },
    });
    symlinkSync(outside.directory, join(fixture.directory, ".agent-stack"));

    assert.throws(
      () => commandDetect(fixture.directory, true),
      /symlink outside the project/,
    );
    assert.equal(existsSync(join(outside.directory, "config.json")), false);
  } finally {
    fixture.cleanup();
    outside.cleanup();
  }
});

test("installation manifest tampering cannot hide protected-file drift", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });
    const policy = join(fixture.directory, CORE_POLICY_PATH);
    writeFileSync(policy, '{"tampered":true}\n');
    const installationFile = join(fixture.directory, INSTALLATION_PATH);
    const installation = readJson(installationFile);
    const tamperedHash = hashText(readFileSync(policy, "utf8"));
    installation.managed_files[CORE_POLICY_PATH].source_hash = tamperedHash;
    installation.managed_files[CORE_POLICY_PATH].accepted_hash = tamperedHash;
    installation.managed_files[CORE_POLICY_PATH].customized = false;
    writeJson(installationFile, installation);

    const doctor = commandDoctor(fixture.directory);
    const protectedFiles = doctor.reports.find(
      (report) => report.name === "protected-files",
    );

    assert.equal(protectedFiles.ok, false);
    assert.match(JSON.stringify(protectedFiles.detail), /modified|manifest/);
  } finally {
    fixture.cleanup();
  }
});

test("manifest tampering cannot authorize overwriting a customized managed file", () => {
  const fixture = temporaryProject();
  try {
    initializeGit(fixture.directory);
    installOrUpgrade(fixture.directory, { mode: "init" });
    const agents = join(fixture.directory, "AGENTS.md");
    const customization = "OWNER CUSTOMIZATION MUST SURVIVE\n";
    writeFileSync(agents, customization);
    const installationFile = join(fixture.directory, INSTALLATION_PATH);
    const installation = readJson(installationFile);
    const customizedHash = hashText(customization);
    installation.managed_files["AGENTS.md"].source_hash = customizedHash;
    installation.managed_files["AGENTS.md"].accepted_hash = customizedHash;
    installation.managed_files["AGENTS.md"].customized = false;
    writeJson(installationFile, installation);

    const upgraded = installOrUpgrade(fixture.directory, { mode: "upgrade" });

    assert.equal(readFileSync(agents, "utf8"), customization);
    assert.equal(
      upgraded.outcomes.find((outcome) => outcome.path === "AGENTS.md").status,
      "needs-reconciliation",
    );
  } finally {
    fixture.cleanup();
  }
});
