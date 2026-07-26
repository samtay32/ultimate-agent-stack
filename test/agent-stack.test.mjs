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

import {
  CONFIG_PATH,
  CORE_POLICY_PATH,
  INSTALLATION_PATH,
  PROJECT_CLI_PATH,
  StackError,
  checksHash,
  commandAdoptManaged,
  commandApproveChecks,
  commandCheckLock,
  commandDetect,
  commandDoctor,
  commandLock,
  commandStart,
  commandStatus,
  commandUnlock,
  commandVerify,
  detectProject,
  installOrUpgrade,
  loadInstallation,
  pathInside,
  resolveTarget,
  validateConfig,
} from "../bin/ultimate-agent-stack.mjs";

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
    assert.match(start.prompt, /\$run-autonomous-delivery/);
    assert.match(start.prompt, /one high-impact question at a time/);
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

test("shell and destructive quality checks are rejected", () => {
  const config = {
    schema_version: 1,
    safety: {
      project_root_only: true,
      forbid_shell_commands: true,
      require_check_approval: true,
      max_check_timeout_seconds: 7200,
    },
    quality: {
      require_project_checks: true,
      checks: [
        {
          id: "unsafe",
          argv: ["bash", "-c", "rm -rf ."],
          required: true,
          timeout_seconds: 30,
        },
      ],
    },
    lock_artifacts: [".agent-stack/artifacts/DELIVERY.md"],
  };

  assert.match(validateConfig(config).join("\n"), /forbidden shell/);
});

test("quality guardrails cannot be disabled in project config", () => {
  const errors = validateConfig({
    schema_version: 1,
    safety: {
      project_root_only: true,
      forbid_shell_commands: true,
      require_check_approval: false,
      max_check_timeout_seconds: 9000,
    },
    quality: {
      require_project_checks: false,
      checks: [
        {
          id: "unsafe-publish",
          argv: ["npm", "publish"],
          required: false,
          timeout_seconds: 900,
        },
      ],
    },
    lock_artifacts: [".agent-stack/artifacts/DELIVERY.md"],
  });

  assert.match(errors.join("\n"), /require_check_approval must remain true/);
  assert.match(errors.join("\n"), /between 1 and 7200/);
  assert.match(errors.join("\n"), /require_project_checks must remain true/);
  assert.match(errors.join("\n"), /required must remain true/);
  assert.match(errors.join("\n"), /must be run or test/);
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
