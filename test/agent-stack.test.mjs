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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONFIG_PATH,
  CORE_POLICY_PATH,
  INSTALLATION_PATH,
  PROJECT_CLI_PATH,
  REVIEW_RECEIPT_PATH,
  REVIEW_WORKFLOW_PATH,
  StackError,
  checksHash,
  commandCapabilities,
  commandAdoptManaged,
  commandApproveChecks,
  commandCheckLock,
  commandConfigure,
  commandDetect,
  commandDoctor,
  commandLock,
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
    assert.equal(
      existsSync(
        join(
          fixture.directory,
          ".claude",
          "agents",
          "uas-researcher.md",
        ),
      ),
      false,
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

    const copiedCli = spawnSync(
      "node",
      [join(fixture.directory, PROJECT_CLI_PATH), "--version"],
      { encoding: "utf8", shell: false },
    );
    assert.equal(copiedCli.status, 0, copiedCli.stderr);
    assert.match(copiedCli.stdout, /ultimate-agent-stack/);

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

    const start = commandStart(fixture.directory, "Build a safe fixture");
    assert.equal(start.phase, "project-discovery");
    assert.match(start.prompt, /\$run-autonomous-delivery/);
    assert.match(start.prompt, /\$coordinate-parallel-delivery/);
    assert.match(start.prompt, /\$use-project-knowledge/);
    assert.match(start.prompt, /at most one genuinely useful safe alternative/);
  } finally {
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
