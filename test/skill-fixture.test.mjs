import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  commandCheckLock,
  commandCoordinator,
  commandEvidenceValidate,
  commandWorkValidate,
} from "../bin/ultimate-agent-stack.mjs";
import {
  EXPECTED_FIXTURE_IDS,
  LIVE_LINEAR_SANDBOX_OPT_IN,
  expectedFixtureBaseline,
  expectedMaterializationSha256,
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
} from "../scripts/skill-fixture.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const scenarios = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "evals", "scenarios.json"), "utf8"),
);

function temporaryDirectory(prefix = "uas-skill-fixture-") {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return {
    directory,
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.name === ".git") {
      continue;
    }
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(root, path));
    } else if (entry.isFile()) {
      files.push(relative(root, path).split(sep).join("/"));
    }
  }
  return files.sort();
}

function projectTreeHash(root) {
  const hash = createHash("sha256");
  for (const path of listFiles(root)) {
    hash.update(`${path}\0`);
    hash.update(readFileSync(join(root, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function git(target, args) {
  const result = spawnSync("git", ["-C", target, ...args], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("canonical catalog covers exactly all 27 current scenarios", () => {
  const catalog = fixtureCatalog();
  const fixtureIds = catalog.fixtures.map((fixture) => fixture.scenario_id);
  const scenarioIds = scenarios.scenarios.map((scenario) => scenario.id);
  assert.equal(fixtureIds.length, 27);
  assert.equal(EXPECTED_FIXTURE_IDS.size, 27);
  assert.deepEqual(new Set(fixtureIds), new Set(scenarioIds));
  assert.equal(fixtureIds.filter((id) => id.startsWith("flexible-")).length, 13);
  for (const id of fixtureIds) {
    assert.match(fixtureReceipt(id), /^sha256:[a-f0-9]{64}$/);
    assert.match(
      expectedMaterializationSha256(id),
      /^sha256:[a-f0-9]{64}$/,
    );
  }
});

test("baseline proposal is deterministic, review-only, and matches the protected catalog", () => {
  const before = readFileSync(
    join(PACKAGE_ROOT, "evals/fixture-baselines.json"),
    "utf8",
  );
  assert.deepEqual(
    proposeFixtureBaselines(),
    fixtureBaselineCatalog(),
  );
  assert.equal(
    readFileSync(
      join(PACKAGE_ROOT, "evals/fixture-baselines.json"),
      "utf8",
    ),
    before,
  );
});

test("provider execution mode is bidirectionally bound to Linear write fixtures", () => {
  const linearFixture = fixtureCatalog().fixtures.find(
    (fixture) => fixture.scenario_id === "direct-receipted-linear-write",
  );
  assert.doesNotThrow(() => validateFixtureProviderBoundary(linearFixture));
  assert.throws(
    () =>
      validateFixtureProviderBoundary({
        ...structuredClone(linearFixture),
        provider_execution: undefined,
      }),
    /configuration=linear-write if and only if provider_execution is present/,
  );
  assert.throws(
    () =>
      validateFixtureProviderBoundary({
        scenario_id: "invalid-non-write-provider",
        configuration: "configured",
        provider_execution: structuredClone(linearFixture.provider_execution),
      }),
    /configuration=linear-write if and only if provider_execution is present/,
  );
  assert.throws(
    () =>
      validateFixtureProviderBoundary({
        ...structuredClone(linearFixture),
        provider_execution: {
          ...structuredClone(linearFixture.provider_execution),
          requires_explicit_sandbox_opt_in: true,
        },
      }),
    /valid Linear readiness-only or explicit sandbox live-write boundary/,
  );
  assert.doesNotThrow(() =>
    validateFixtureProviderBoundary({
      ...structuredClone(linearFixture),
      provider_execution: {
        provider: "linear",
        mode: "live-write",
        requires_explicit_sandbox_opt_in: true,
      },
    }),
  );
});

test("all canonical fixtures materialize with deterministic base and git state", () => {
  const temporary = temporaryDirectory();
  try {
    for (const scenario of scenarios.scenarios) {
      const target = join(temporary.directory, scenario.id);
      const result = materializeFixture(scenario.id, target);
      assert.equal(result.ok, true);
      assert.equal(result.scenario_id, scenario.id);
      assert.match(result.fixture_receipt, /^sha256:[a-f0-9]{64}$/);
      assert.match(result.base_fixture_receipt, /^sha256:[a-f0-9]{64}$/);
      assert.equal(
        result.receipt.materialization_sha256,
        expectedMaterializationSha256(scenario.id),
      );
      assert.equal(
        result.receipt.materialization_spec_sha256,
        result.receipt.materialization_sha256,
      );
      assert.equal(
        result.receipt.project_tree_sha256,
        `sha256:${projectTreeHash(target)}`,
      );
      assert.equal(
        result.receipt.project_tree_sha256,
        projectTreeSha256(target),
      );
      assert.equal(
        result.receipt.project_state_sha256,
        projectStateSha256({
          materializationSpecSha256:
            result.receipt.materialization_spec_sha256,
          gitHead: result.git.head,
          projectTreeSha256: result.receipt.project_tree_sha256,
        }),
      );
      assert.match(result.git.head, /^[a-f0-9]{40}$/);
      assert.equal(result.git.branch, "main");
      assert.deepEqual(
        {
          scenario_id: scenario.id,
          git_head: result.git.head,
          project_tree_sha256: result.receipt.project_tree_sha256,
        },
        expectedFixtureBaseline(scenario.id),
      );
      assert.equal(git(target, ["rev-parse", "HEAD"]), result.git.head);
      const packageFile = readJson(join(target, "package.json"));
      assert.equal(packageFile.scripts.test, "node --test");
      assert.equal(packageFile.type, "module");
      const expectsInstallation = ![
        "direct-setup",
        "indirect-setup",
        "existing-project-reconciliation",
        "flexible-simple-onboarding",
        "flexible-simple-onboarding-approved",
      ].includes(scenario.id);
      assert.equal(
        existsSync(join(target, ".agent-stack", "installation.json")),
        expectsInstallation,
        scenario.id,
      );
      if (expectsInstallation) {
        const installation = readJson(
          join(target, ".agent-stack", "installation.json"),
        );
        assert.equal(installation.installed_at, "2026-01-01T00:00:00Z");
        assert.equal(installation.updated_at, "2026-01-01T00:00:00Z");
      }
    }
  } finally {
    temporary.cleanup();
  }
});

test("project-state receipts bind produced bytes and post-baseline runtime state", () => {
  const temporary = temporaryDirectory();
  try {
    for (const fixtureCase of [
      {
        scenarioId: "flexible-direct-bypass",
        runtimePath: ".agent-stack/checkpoint.json",
        options: undefined,
      },
      {
        scenarioId: "direct-receipted-linear-write",
        runtimePath: ".agent-stack/coordinator.json",
        options: undefined,
      },
    ]) {
      const target = join(temporary.directory, fixtureCase.scenarioId);
      const result = materializeFixture(
        fixtureCase.scenarioId,
        target,
        fixtureCase.options,
      );
      const runtimePath = join(target, fixtureCase.runtimePath);
      assert.equal(existsSync(runtimePath), true);
      assert.equal(
        git(target, ["ls-files", "--", fixtureCase.runtimePath]),
        "",
      );
      assert.equal(
        result.receipt.project_tree_sha256,
        projectTreeSha256(target),
      );
      const originalTreeSha256 = result.receipt.project_tree_sha256;
      const originalStateSha256 = result.receipt.project_state_sha256;
      writeFileSync(
        runtimePath,
        `${readFileSync(runtimePath, "utf8")}\n`,
      );
      const changedTreeSha256 = projectTreeSha256(target);
      assert.notEqual(changedTreeSha256, originalTreeSha256);
      assert.notEqual(
        projectStateSha256({
          materializationSpecSha256:
            result.receipt.materialization_spec_sha256,
          gitHead: result.git.head,
          projectTreeSha256: changedTreeSha256,
        }),
        originalStateSha256,
      );
    }
  } finally {
    temporary.cleanup();
  }
});

test("project-tree receipts fail closed on unbounded files, bytes, and totals", () => {
  const temporary = temporaryDirectory();
  try {
    const target = join(temporary.directory, "bounded-tree");
    mkdirSync(target);
    writeFileSync(join(target, "a.txt"), "aa");
    writeFileSync(join(target, "b.txt"), "bb");
    writeFileSync(join(target, "c.txt"), "cc");
    mkdirSync(join(target, "empty-one"));
    mkdirSync(join(target, "empty-two"));
    assert.throws(
      () => projectTreeSha256(target, { maxEntries: 4 }),
      /more than 4 entries/,
    );
    assert.throws(
      () => projectTreeSha256(target, { maxFiles: 2 }),
      /more than 2 files/,
    );
    assert.throws(
      () => projectTreeSha256(target, { maxFileBytes: 1 }),
      /file larger than 1 bytes: a\.txt/,
    );
    assert.throws(
      () => projectTreeSha256(target, { maxTotalBytes: 5 }),
      /project tree larger than 5 bytes/,
    );
    assert.throws(
      () => projectTreeSha256(target, { maxFiles: 0 }),
      /maxFiles must be a positive safe integer/,
    );
  } finally {
    temporary.cleanup();
  }
});

test("fixture inspection returns exact read-only post-run receipts", () => {
  const temporary = temporaryDirectory();
  try {
    const target = join(temporary.directory, "inspect");
    const materialized = materializeFixture(
      "flexible-direct-bypass",
      target,
    );
    const initial = inspectFixtureProject(
      "flexible-direct-bypass",
      target,
    );
    assert.equal(initial.git.head, materialized.git.head);
    assert.equal(initial.git.baseline_ancestor, true);
    assert.equal(
      initial.git.baseline_head,
      expectedFixtureBaseline("flexible-direct-bypass").git_head,
    );
    assert.equal(
      initial.receipt.project_tree_sha256,
      materialized.receipt.project_tree_sha256,
    );
    assert.equal(
      initial.receipt.project_state_sha256,
      materialized.receipt.project_state_sha256,
    );

    writeFileSync(join(target, "run-output.txt"), "observed\n");
    const postRun = inspectFixtureProject(
      "flexible-direct-bypass",
      target,
    );
    assert.equal(postRun.git.head, initial.git.head);
    assert.notEqual(
      postRun.receipt.project_tree_sha256,
      initial.receipt.project_tree_sha256,
    );
    assert.notEqual(
      postRun.receipt.project_state_sha256,
      initial.receipt.project_state_sha256,
    );
    assert.equal(postRun.git.baseline_ancestor, true);

    assert.throws(
      () =>
        inspectFixtureProject(
          "flexible-vague-discovery",
          target,
        ),
      /does not descend from the canonical flexible-vague-discovery baseline/,
    );

    const cli = spawnSync(
      process.execPath,
      [
        join(PACKAGE_ROOT, "scripts/skill-fixture.mjs"),
        "inspect",
        "--scenario",
        "flexible-direct-bypass",
        "--target",
        target,
      ],
      { encoding: "utf8" },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.deepEqual(
      JSON.parse(cli.stdout).receipt,
      postRun.receipt,
    );

    const symlinkTarget = join(temporary.directory, "inspect-link");
    symlinkSync(target, symlinkTarget, "dir");
    assert.throws(
      () =>
        inspectFixtureProject(
          "flexible-direct-bypass",
          symlinkTarget,
        ),
      /existing non-symlink directory/,
    );
  } finally {
    temporary.cleanup();
  }
});

test("fixture Git commands ignore ambient repository redirection and execution controls", () => {
  const temporary = temporaryDirectory();
  try {
    const outsideGitDirectory = join(
      temporary.directory,
      "outside-git-directory",
    );
    const outsideIndex = join(temporary.directory, "outside-index");
    const hostileEnvironment = {
      ...process.env,
      GIT_DIR: outsideGitDirectory,
      GIT_WORK_TREE: temporary.directory,
      GIT_INDEX_FILE: outsideIndex,
      GIT_OBJECT_DIRECTORY: join(temporary.directory, "outside-objects"),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(
        temporary.directory,
        "outside-alternates",
      ),
      GIT_COMMON_DIR: join(temporary.directory, "outside-common"),
      GIT_CONFIG: join(temporary.directory, "outside-config"),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: temporary.directory,
      GIT_EXTERNAL_DIFF: join(temporary.directory, "outside-diff"),
      GIT_PAGER: join(temporary.directory, "outside-pager"),
      GIT_SSH: join(temporary.directory, "outside-ssh"),
      GIT_SSH_COMMAND: join(temporary.directory, "outside-ssh-command"),
      GIT_TEMPLATE_DIR: join(temporary.directory, "outside-template"),
    };
    for (const scenarioId of [
      "flexible-vague-discovery",
      "flexible-direct-bypass",
    ]) {
      const target = join(temporary.directory, `contained-${scenarioId}`);
      const materialize = spawnSync(
        process.execPath,
        [
          join(PACKAGE_ROOT, "scripts/skill-fixture.mjs"),
          "materialize",
          "--scenario",
          scenarioId,
          "--target",
          target,
        ],
        {
          encoding: "utf8",
          env: hostileEnvironment,
        },
      );
      assert.equal(materialize.status, 0, materialize.stderr);
      assert.equal(existsSync(outsideGitDirectory), false);
      assert.equal(existsSync(outsideIndex), false);
      assert.equal(existsSync(join(target, ".git")), true);

      const inspect = spawnSync(
        process.execPath,
        [
          join(PACKAGE_ROOT, "scripts/skill-fixture.mjs"),
          "inspect",
          "--scenario",
          scenarioId,
          "--target",
          target,
        ],
        {
          encoding: "utf8",
          env: hostileEnvironment,
        },
      );
      assert.equal(inspect.status, 0, inspect.stderr);
      assert.equal(
        JSON.parse(inspect.stdout).git.baseline_ancestor,
        true,
      );
      assert.equal(existsSync(outsideGitDirectory), false);
      assert.equal(existsSync(outsideIndex), false);
    }
  } finally {
    temporary.cleanup();
  }
});

test("flexible source fixtures preserve exact intent and reconciliation evidence", () => {
  const temporary = temporaryDirectory();
  try {
    const detailed = join(temporary.directory, "detailed");
    materializeFixture("flexible-external-detailed-prd", detailed);
    assert.match(
      readFileSync(join(detailed, "docs/source-prd.md"), "utf8"),
      /SRC-1[\s\S]*SRC-2[\s\S]*SRC-3/,
    );
    assert.match(
      readFileSync(join(detailed, "docs/source-prd.md"), "utf8"),
      /completed job may return to `active`/,
    );

    const complete = join(temporary.directory, "complete");
    materializeFixture("flexible-external-complete-prd", complete);
    assert.match(
      readFileSync(join(complete, "docs/complete-prd.md"), "utf8"),
      /No consequential product decision remains open/,
    );

    const contradictory = join(temporary.directory, "contradictory");
    materializeFixture("flexible-external-contradictory", contradictory);
    assert.match(
      readFileSync(join(contradictory, "docs/contradictory-prd.md"), "utf8"),
      /permanently[\s\S]*recoverable forever/,
    );

    const existing = join(temporary.directory, "existing");
    materializeFixture("flexible-external-existing-reconciliation", existing);
    for (const path of [
      "src/jobs.mjs",
      "db/schema.sql",
      "db/migrations/001_create_jobs.sql",
      "test/jobs.test.mjs",
      "docs/LOCKED_DECISIONS.md",
    ]) {
      assert.equal(existsSync(join(existing, path)), true, path);
    }
    assert.match(
      readFileSync(join(existing, "docs/source-prd.md"), "utf8"),
      /SRC-1[\s\S]*SRC-2[\s\S]*SRC-3/,
    );
    assert.match(
      readFileSync(join(existing, "docs/LOCKED_DECISIONS.md"), "utf8"),
      /CD-1/,
    );
  } finally {
    temporary.cleanup();
  }
});

test("direct bypass and resume fixtures carry valid locks and deterministic checkpoints", () => {
  const temporary = temporaryDirectory();
  try {
    const direct = join(temporary.directory, "direct");
    materializeFixture("flexible-direct-bypass", direct);
    assert.equal(existsSync(join(direct, "src/status.mjs")), false);
    assert.equal(
      readJson(join(direct, ".agent-stack/checkpoint.json")).status,
      "complete",
    );
    assert.equal(commandCheckLock(direct).ok, true);
    assert.equal(commandCoordinator(direct, "status").active, false);
    assert.equal(existsSync(join(direct, ".agent-stack/coordinator.json")), false);
    assert.match(
      readFileSync(join(direct, "notes/status-acceptance.txt"), "utf8"),
      /supporting evidence only/i,
    );

    const resume = join(temporary.directory, "resume");
    materializeFixture("flexible-resume-valid", resume);
    const checkpoint = readJson(
      join(resume, ".agent-stack/checkpoint.json"),
    );
    assert.equal(checkpoint.status, "in_progress");
    assert.deepEqual(checkpoint.next_steps, [
      "Remove the test skip and run the exact regression test successfully",
    ]);
    assert.equal(commandCheckLock(resume).ok, true);
    assert.equal(commandCoordinator(resume, "status").active, false);
    assert.equal(existsSync(join(resume, ".agent-stack/coordinator.json")), false);
    assert.match(
      readFileSync(join(resume, ".agent-stack/artifacts/DECISIONS.md"), "utf8"),
      /CD-1/,
    );
    assert.match(
      readFileSync(join(resume, "test/status.test.mjs"), "utf8"),
      /test\.skip/,
    );
  } finally {
    temporary.cleanup();
  }
});

test("draft, approved promotion, onboarding, providers, and work evidence match context", () => {
  const temporary = temporaryDirectory();
  try {
    const draft = join(temporary.directory, "draft");
    materializeFixture("flexible-draft-lock", draft);
    assert.match(
      readFileSync(join(draft, ".agent-stack/artifacts/DELIVERY.md"), "utf8"),
      /^Status: DRAFT$/m,
    );
    assert.equal(commandCheckLock(draft).ok, false);

    const promotion = join(temporary.directory, "promotion");
    materializeFixture("flexible-approved-promotion", promotion);
    assert.match(
      readFileSync(join(promotion, ".agent-stack/artifacts/BRIEF.md"), "utf8"),
      /^Status: APPROVED$/m,
    );
    assert.match(
      readFileSync(join(promotion, ".agent-stack/artifacts/BRIEF.md"), "utf8"),
      /CD-1[\s\S]*SRC-1/,
    );

    for (const id of [
      "direct-setup",
      "indirect-setup",
      "existing-project-reconciliation",
      "flexible-simple-onboarding",
      "flexible-simple-onboarding-approved",
    ]) {
      const target = join(temporary.directory, id);
      materializeFixture(id, target);
      assert.equal(
        existsSync(join(target, ".agent-stack", "installation.json")),
        false,
      );
    }
    assert.equal(
      existsSync(
        join(
          temporary.directory,
          "existing-project-reconciliation",
          ".github/workflows/custom-ci.yml",
        ),
      ),
      true,
    );

    const telemetry = join(temporary.directory, "telemetry");
    materializeFixture("direct-telemetry-diagnosis", telemetry);
    const telemetryConfig = readJson(
      join(telemetry, ".agent-stack/config.json"),
    );
    assert.deepEqual(
      telemetryConfig.capabilities.telemetry.providers.map(
        (provider) => provider.provider,
      ),
      ["new-relic"],
    );

    const linear = join(temporary.directory, "linear");
    const linearResult = materializeFixture(
      "direct-receipted-linear-write",
      linear,
    );
    const linearConfig = readJson(join(linear, ".agent-stack/config.json"));
    assert.equal(linearConfig.capabilities.work.provider, "linear");
    assert.deepEqual(
      linearConfig.capabilities.work.connection.writes.operations,
      ["issue_create"],
    );
    assert.equal(commandWorkValidate(linear).ok, true);
    assert.equal(commandEvidenceValidate(linear).ok, true);
    assert.equal(commandCoordinator(linear, "status").active, true);
    assert.match(linearResult.coordinator_token, /^[a-f0-9]{64}$/);
    assert.deepEqual(linearResult.receipt.provider_authority, {
      provider: "linear",
      mode: "readiness-only",
      sandbox_opt_in_required: false,
      sandbox_opt_in_supplied: false,
      opt_in_option: null,
    });
    assert.equal(
      commandCoordinator(linear, "heartbeat", {
        token: linearResult.coordinator_token,
      }).active,
      true,
    );

    const foreign = join(temporary.directory, "foreign");
    const foreignResult = materializeFixture(
      "continuity-active-coordinator",
      foreign,
    );
    assert.equal(foreignResult.coordinator_token, undefined);
    assert.equal(commandCoordinator(foreign, "status").active, true);
    assert.throws(
      () =>
        commandCoordinator(foreign, "heartbeat", {
          token: "0".repeat(64),
        }),
      /Another Project Steward/,
    );
  } finally {
    temporary.cleanup();
  }
});

test("provider readiness fixture ignores ambient credentials and never claims a provider write", () => {
  const temporary = temporaryDirectory();
  try {
    const preflightTarget = join(temporary.directory, "preflight");
    const preflight = spawnSync(
      process.execPath,
      [
        join(PACKAGE_ROOT, "scripts/skill-fixture.mjs"),
        "materialize",
        "--scenario",
        "direct-receipted-linear-write",
        "--target",
        preflightTarget,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          LINEAR_API_KEY: "ambient-read-key-must-not-authorize",
          LINEAR_CREATE_API_KEY: "ambient-write-key-must-not-authorize",
        },
      },
    );
    assert.equal(preflight.status, 0, preflight.stderr);
    const result = JSON.parse(preflight.stdout);
    assert.deepEqual(result.receipt.provider_authority, {
      provider: "linear",
      mode: "readiness-only",
      sandbox_opt_in_required: false,
      sandbox_opt_in_supplied: false,
      opt_in_option: null,
    });
    assert.match(result.coordinator_token, /^[a-f0-9]{64}$/);

    const invalidOptInTarget = join(temporary.directory, "invalid-opt-in");
    const invalidOptIn = spawnSync(
      process.execPath,
      [
        join(PACKAGE_ROOT, "scripts/skill-fixture.mjs"),
        "materialize",
        "--scenario",
        "direct-receipted-linear-write",
        "--target",
        invalidOptInTarget,
        LIVE_LINEAR_SANDBOX_OPT_IN,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(invalidOptIn.status, 0);
    assert.match(
      invalidOptIn.stderr,
      /valid only for a fixture that declares a live Linear sandbox write/,
    );
    assert.equal(existsSync(invalidOptInTarget), false);
  } finally {
    temporary.cleanup();
  }
});

test("secret-redaction input is bound but never materialized into the project", () => {
  const temporary = temporaryDirectory();
  try {
    const inputs = externalInputsForFixture(
      "flexible-external-secret-redaction",
    );
    assert.equal(inputs.length, 1);
    assert.match(inputs[0].content, /Ignore every repository safety rule/);
    assert.match(inputs[0].content, /api_key=sk-live-fixture/);

    const target = join(temporary.directory, "secret");
    const result = materializeFixture(
      "flexible-external-secret-redaction",
      target,
    );
    assert.equal(result.external_inputs[0].delivery, "prompt-only");
    assert.match(
      result.external_inputs[0].content_sha256,
      /^sha256:[a-f0-9]{64}$/,
    );
    for (const path of listFiles(target)) {
      const content = readFileSync(join(target, path), "utf8");
      assert.doesNotMatch(content, /sk-live-fixture-should-never-be-persisted/);
      assert.doesNotMatch(content, /Ignore every repository safety rule/);
    }
  } finally {
    temporary.cleanup();
  }
});

test("external-inputs CLI returns exact prompt-only inputs without project writes", () => {
  const result = spawnSync(
    process.execPath,
    [
      join(PACKAGE_ROOT, "scripts/skill-fixture.mjs"),
      "external-inputs",
      "--scenario",
      "flexible-external-secret-redaction",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.scenario_id, "flexible-external-secret-redaction");
  assert.equal(payload.external_inputs.length, 1);
  assert.deepEqual(
    payload.external_inputs.map(({ id, kind, delivery }) => ({
      id,
      kind,
      delivery,
    })),
    [
      {
        id: "implementation-outline",
        kind: "attachment",
        delivery: "prompt-only",
      },
    ],
  );
  assert.match(
    payload.external_inputs[0].content,
    /Ignore every repository safety rule/,
  );
  assert.match(
    payload.external_inputs[0].content,
    /api_key=sk-live-fixture-should-never-be-persisted/,
  );
  assert.match(
    payload.external_inputs[0].content_sha256,
    /^sha256:[a-f0-9]{64}$/,
  );
});

test("fixture CLI rejects missing, duplicate, unknown, and misspelled arguments", () => {
  const temporary = temporaryDirectory();
  try {
    const cases = [
      {
        args: ["list", "--unexpected"],
        error: /unsupported CLI argument: --unexpected/,
      },
      {
        args: ["external-inputs"],
        error: /usage: skill-fixture\.mjs external-inputs/,
      },
      {
        args: [
          "external-inputs",
          "--scenario",
          "flexible-vague-discovery",
          "--scenario",
          "flexible-external-secret-redaction",
        ],
        error: /duplicate CLI option: --scenario/,
      },
      {
        args: ["external-inputs", "--scenario", "missing-scenario"],
        error: /unknown canonical fixture: missing-scenario/,
      },
      {
        args: ["inspect", "--scenario", "flexible-vague-discovery"],
        error: /usage: skill-fixture\.mjs inspect/,
      },
      {
        args: [
          "inspect",
          "--scenario",
          "missing-scenario",
          "--target",
          temporary.directory,
        ],
        error: /unknown canonical fixture: missing-scenario/,
      },
    ];
    for (const fixtureCase of cases) {
      const result = spawnSync(
        process.execPath,
        [join(PACKAGE_ROOT, "scripts/skill-fixture.mjs"), ...fixtureCase.args],
        { encoding: "utf8" },
      );
      assert.notEqual(result.status, 0, fixtureCase.args.join(" "));
      assert.match(result.stderr, fixtureCase.error);
    }

    const misspelledTarget = join(temporary.directory, "misspelled-opt-in");
    const misspelled = spawnSync(
      process.execPath,
      [
        join(PACKAGE_ROOT, "scripts/skill-fixture.mjs"),
        "materialize",
        "--scenario",
        "direct-receipted-linear-write",
        "--target",
        misspelledTarget,
        "--allow-live-linear-sandbx-fixture",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          LINEAR_API_KEY: "ambient-read-key-must-not-authorize",
          LINEAR_CREATE_API_KEY: "ambient-write-key-must-not-authorize",
        },
      },
    );
    assert.notEqual(misspelled.status, 0);
    assert.match(
      misspelled.stderr,
      /unsupported CLI argument: --allow-live-linear-sandbx-fixture/,
    );
    assert.equal(existsSync(misspelledTarget), false);
  } finally {
    temporary.cleanup();
  }
});

test("delayed materializations keep receipts, git heads, and project bytes identical", async () => {
  const temporary = temporaryDirectory();
  try {
    const ids = [
      "flexible-direct-bypass",
      "flexible-resume-valid",
      "direct-receipted-linear-write",
      "continuity-active-coordinator",
    ];
    const leftResults = new Map();
    for (const id of ids) {
      const left = join(temporary.directory, `${id}-left`);
      leftResults.set(
        id,
        materializeFixture(id, left),
      );
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200));
    for (const id of ids) {
      const left = join(temporary.directory, `${id}-left`);
      const right = join(temporary.directory, `${id}-right`);
      const leftResult = leftResults.get(id);
      const rightResult = materializeFixture(id, right);
      assert.equal(leftResult.fixture_receipt, rightResult.fixture_receipt);
      assert.equal(
        leftResult.base_fixture_receipt,
        rightResult.base_fixture_receipt,
      );
      assert.equal(leftResult.git.head, rightResult.git.head);
      assert.equal(
        leftResult.receipt.materialization_spec_sha256,
        rightResult.receipt.materialization_spec_sha256,
      );
      assert.equal(
        leftResult.receipt.project_tree_sha256,
        rightResult.receipt.project_tree_sha256,
      );
      assert.equal(
        leftResult.receipt.project_state_sha256,
        rightResult.receipt.project_state_sha256,
      );
      assert.equal(projectTreeHash(left), projectTreeHash(right));
    }
  } finally {
    temporary.cleanup();
  }
});

test("materializer refuses non-empty targets, symlink targets, and unknown fixtures", () => {
  const temporary = temporaryDirectory();
  try {
    const nonEmpty = join(temporary.directory, "non-empty");
    mkdirSync(nonEmpty);
    writeFileSync(join(nonEmpty, "owned.txt"), "preserve me\n");
    assert.throws(
      () => materializeFixture("flexible-vague-discovery", nonEmpty),
      /target must be empty/,
    );
    assert.equal(readFileSync(join(nonEmpty, "owned.txt"), "utf8"), "preserve me\n");

    const outside = join(temporary.directory, "outside");
    mkdirSync(outside);
    const linked = join(temporary.directory, "linked");
    symlinkSync(outside, linked, "dir");
    assert.equal(lstatSync(linked).isSymbolicLink(), true);
    assert.throws(
      () => materializeFixture("flexible-vague-discovery", linked),
      /symlink fixture target/,
    );
    assert.deepEqual(readdirSync(outside), []);

    assert.throws(
      () => materializeFixture("missing-scenario", join(temporary.directory, "missing")),
      /unknown canonical fixture/,
    );
  } finally {
    temporary.cleanup();
  }
});
