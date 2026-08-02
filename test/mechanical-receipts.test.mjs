import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  commandConfigure,
  commandApproveChecks,
  commandEvidenceActivate,
  commandEvidenceActivationStatus,
  commandReviewRecord,
  commandReviewStatus,
  commandReviewUnavailable,
  commandStart,
  commandStatus,
  commandVerify,
  installOrUpgrade,
} from "../bin/ultimate-agent-stack.mjs";
import { fileURLToPath } from "node:url";

const PACKAGE_CLI = fileURLToPath(new URL("../bin/ultimate-agent-stack.mjs", import.meta.url));

function runGit(directory, args) {
  const result = spawnSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commit(directory, message) {
  runGit(directory, ["add", "-A"]);
  runGit(directory, [
    "-c",
    "user.name=Receipt Test",
    "-c",
    "user.email=receipt-test@example.com",
    "commit",
    "-m",
    message,
  ]);
}

function createFixture({ activation = false, objectFormat = "sha1" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mechanical-receipts-test-"));
  runGit(directory, [
    "init",
    "-q",
    ...(objectFormat === "sha256" ? ["--object-format=sha256"] : []),
  ]);
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify(
      {
        name: "receipt-fixture",
        private: true,
        type: "module",
        scripts: { test: "node --test" },
      },
      null,
      2,
    ) + "\n",
  );
  installOrUpgrade(directory, { mode: "init" });
  commandConfigure(directory, {
    profile: "standard",
    review: "builtin",
    knowledge: "repository",
    knowledgeScope: "project",
    externalData: "local_only",
    reason: "Receipt test fixture uses repository-only controls",
  });
  commit(directory, "fixture baseline");
  const started = commandStart(directory, "Exercise mechanical receipts");
  const runId = "run-issue-39";
  mkdirSync(join(directory, ".agent-stack", "runs", "reviews"), {
    recursive: true,
  });
  const resultFile = join(
    directory,
    ".agent-stack",
    "runs",
    "reviews",
    "independent-review.json",
  );
  writeFileSync(
    resultFile,
    JSON.stringify({
      schema_version: 1,
      run_id: runId,
      git_commit: runGit(directory, ["rev-parse", "HEAD"]),
      reviewer_kind: "independent-reviewer",
      reviewer_id: "reviewer@example.test",
      result: "passed",
      summary: "The bounded receipt implementation passed independent review.",
      findings: [],
      reviewed_at: "2026-01-01T00:00:00Z",
    }) + "\n",
  );
  if (activation) {
    commandEvidenceActivate(directory, {
      skill: "run-autonomous-delivery",
      skillPath: ".agents/skills/run-autonomous-delivery/SKILL.md",
      mode: "file-read",
      harness: "test-harness",
      model: "test-model",
      runId,
      eventId: "activation-1",
      coordinatorToken: started.coordinator.coordinator_token,
    });
    commit(directory, "record activation evidence");
  }
  return {
    directory,
    resultFile,
    runId,
    token: started.coordinator.coordinator_token,
    coordinatorId: started.coordinator.lease.coordinator_id,
    objectFormat,
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function recordPassed(fixture, overrides = {}) {
  const runId = overrides.runId ?? fixture.runId;
  const reviewerKind = overrides.reviewerKind ?? "independent-reviewer";
  const reviewerId = overrides.reviewerId ?? "reviewer@example.test";
  const result = overrides.result ?? "passed";
  const resultFile = overrides.resultFile ?? ".agent-stack/runs/reviews/independent-review.json";
  if (resultFile === ".agent-stack/runs/reviews/independent-review.json") {
    writeFileSync(
      fixture.resultFile,
      JSON.stringify({
        schema_version: 1,
        run_id: runId,
        git_commit: runGit(fixture.directory, ["rev-parse", "HEAD"]),
        reviewer_kind: reviewerKind,
        reviewer_id: reviewerId,
        result,
        summary: "The bounded receipt implementation passed independent review.",
        findings: result === "passed" ? [] : ["Changes are required before merge."],
        reviewed_at: "2026-01-01T00:00:00Z",
      }) + "\n",
    );
  }
  return commandReviewRecord(fixture.directory, {
    runId,
    reviewerKind,
    reviewerId,
    result,
    resultFile,
    coordinatorToken: fixture.token,
  });
}

test("activation-status derives exact-run activated skills from receipts", () => {
  const fixture = createFixture({ activation: true });
  try {
    const status = commandEvidenceActivationStatus(fixture.directory, {
      runId: fixture.runId,
      requiredSkills: ["run-autonomous-delivery"],
    });
    assert.equal(status.ok, true);
    assert.deepEqual(status.activated_skills, ["run-autonomous-delivery"]);
    assert.deepEqual(status.missing_skills, []);
    assert.equal(status.receipts.length, 1);
    assert.match(status.boundary, /not independent proof/);

    const otherRun = commandEvidenceActivationStatus(fixture.directory, {
      runId: "another-run",
      requiredSkills: ["run-autonomous-delivery"],
    });
    assert.equal(otherRun.ok, false);
    assert.deepEqual(otherRun.activated_skills, []);
    assert.deepEqual(otherRun.missing_skills, ["run-autonomous-delivery"]);
  } finally {
    fixture.cleanup();
  }
});

test("legacy activation graph entries remain readable but do not satisfy current status until upgraded", () => {
  const fixture = createFixture({ activation: true });
  try {
    const graphPath = join(fixture.directory, ".agent-stack", "evidence-graph.json");
    const graph = JSON.parse(readFileSync(graphPath, "utf8"));
    delete graph.skill_activations[0].receipt_sha256;
    writeFileSync(graphPath, JSON.stringify(graph, null, 2) + "\n");
    const blocked = commandEvidenceActivationStatus(fixture.directory, {
      runId: fixture.runId,
      requiredSkills: ["run-autonomous-delivery"],
    });
    assert.equal(blocked.ok, false);
    assert.deepEqual(blocked.activated_skills, []);
    assert.match(blocked.errors.join(" "), /legacy activation receipt/);
    const upgraded = commandEvidenceActivate(fixture.directory, {
      skill: "run-autonomous-delivery",
      skillPath: ".agents/skills/run-autonomous-delivery/SKILL.md",
      mode: "file-read",
      harness: "test-harness",
      model: "test-model",
      runId: fixture.runId,
      eventId: "activation-1",
      coordinatorToken: fixture.token,
    });
    assert.equal(upgraded.reason, "legacy-receipt-upgraded");
    const satisfied = commandEvidenceActivationStatus(fixture.directory, {
      runId: fixture.runId,
      requiredSkills: ["run-autonomous-delivery"],
    });
    assert.equal(satisfied.ok, true);
  } finally {
    fixture.cleanup();
  }
});

test("review record emits a deterministic exact-head local receipt", () => {
  const fixture = createFixture();
  try {
    const result = recordPassed(fixture);
    assert.equal(result.ok, true);
    assert.equal(result.receipt.claim, "agent-recorded");
    assert.equal(result.receipt.git_commit, runGit(fixture.directory, ["rev-parse", "HEAD"]));
    assert.equal(
      result.receipt.result_file,
      ".agent-stack/runs/reviews/independent-review.json",
    );
    assert.match(result.receipt.result_file_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.receipt.git_object_format, "sha1");
    assert.ok(existsSync(join(fixture.directory, result.path)));
    const status = commandReviewStatus(fixture.directory, fixture.runId);
    assert.equal(status.independent_reviewed, true);
    assert.equal(status.review_gate_ready, true);
    assert.equal(status.receipts.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("missing review evidence remains blocked", () => {
  const fixture = createFixture();
  try {
    const status = commandReviewStatus(fixture.directory, fixture.runId);
    assert.equal(status.independent_reviewed, false);
    assert.equal(status.review_gate_ready, false);
    assert.match(status.reasons.join(" "), /no review receipt/);
  } finally {
    fixture.cleanup();
  }
});

test("failed review evidence remains blocked", () => {
  const fixture = createFixture();
  try {
    recordPassed(fixture, { result: "changes-requested" });
    const status = commandReviewStatus(fixture.directory, fixture.runId);
    assert.equal(status.independent_reviewed, false);
    assert.equal(status.review_gate_ready, false);
    assert.match(status.reasons.join(" "), /requested changes/);
  } finally {
    fixture.cleanup();
  }
});

test("empty review result files invalidate an otherwise valid receipt", () => {
  const fixture = createFixture();
  try {
    recordPassed(fixture);
    writeFileSync(fixture.resultFile, "");
    const status = commandReviewStatus(fixture.directory, fixture.runId);
    assert.equal(status.independent_reviewed, false);
    assert.match(status.invalid_receipts.join(" "), /non-empty|hash/);
  } finally {
    fixture.cleanup();
  }
});

test("stale exact-head review receipts are rejected", () => {
  const fixture = createFixture();
  try {
    recordPassed(fixture);
    writeFileSync(join(fixture.directory, "later.txt"), "later\n");
    commit(fixture.directory, "advance after review");
    const status = commandReviewStatus(fixture.directory, fixture.runId);
    assert.equal(status.independent_reviewed, false);
    assert.match(status.invalid_receipts.join(" "), /stale|current HEAD/);
  } finally {
    fixture.cleanup();
  }
});

test("dirty trees invalidate review readiness", () => {
  const fixture = createFixture();
  try {
    recordPassed(fixture);
    writeFileSync(join(fixture.directory, "uncommitted.txt"), "dirty\n");
    const status = commandReviewStatus(fixture.directory, fixture.runId);
    assert.equal(status.independent_reviewed, false);
    assert.match(status.invalid_receipts.join(" "), /clean Git/);
  } finally {
    fixture.cleanup();
  }
});

test("altered receipts are rejected by canonical identity and schema checks", () => {
  const fixture = createFixture();
  try {
    const recorded = recordPassed(fixture);
    const receiptFile = join(fixture.directory, recorded.path);
    const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
    receipt.result = "changes-requested";
    writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + "\n");
    const status = commandReviewStatus(fixture.directory, fixture.runId);
    assert.equal(status.independent_reviewed, false);
    assert.match(status.invalid_receipts.join(" "), /canonical content hash/);
  } finally {
    fixture.cleanup();
  }
});

test("unavailable reviewer evidence is a durable blocker", () => {
  const fixture = createFixture();
  try {
    const unavailable = commandReviewUnavailable(fixture.directory, {
      runId: fixture.runId,
      reason: "reviewer-timeout",
      details: "The independent reviewer did not return a bounded result.",
      coordinatorToken: fixture.token,
    });
    assert.equal(unavailable.receipt.status, "unavailable");
    const status = commandReviewStatus(fixture.directory, fixture.runId);
    assert.equal(status.independent_reviewed, false);
    assert.equal(status.review_gate_ready, false);
    assert.match(status.reasons.join(" "), /unavailable/);
  } finally {
    fixture.cleanup();
  }
});

test("wrong-run and wrong-commit receipts never satisfy the requested run", () => {
  const wrongRun = createFixture();
  try {
    recordPassed(wrongRun, { runId: "different-run" });
    const status = commandReviewStatus(wrongRun.directory, wrongRun.runId);
    assert.equal(status.independent_reviewed, false);
    assert.match(status.reasons.join(" "), /no review receipt/);
  } finally {
    wrongRun.cleanup();
  }

  const wrongCommit = createFixture();
  try {
    const recorded = recordPassed(wrongCommit);
    const receiptFile = join(wrongCommit.directory, recorded.path);
    const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
    receipt.git_commit = "f".repeat(40);
    writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + "\n");
    const status = commandReviewStatus(wrongCommit.directory, wrongCommit.runId);
    assert.equal(status.independent_reviewed, false);
    assert.match(status.invalid_receipts.join(" "), /canonical content hash|stale/);
  } finally {
    wrongCommit.cleanup();
  }
});

test("the coordinator cannot self-identify as the independent reviewer", () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => recordPassed(fixture, { reviewerId: fixture.coordinatorId }),
      (error) =>
        error.details?.some((detail) =>
          /distinct from the coordinator|reviewer kind cannot identify the coordinator/.test(
            detail,
          ),
        ) === true,
    );
  } finally {
    fixture.cleanup();
  }
});

test("review result paths stay contained and bounded", () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => recordPassed(fixture, { resultFile: "../outside.txt" }),
      /within the target|project path|result-file|escapes the project root/,
    );
    for (const resultFile of ["package.json", "README.md", ".git/config"]) {
      assert.throws(
        () => recordPassed(fixture, { resultFile }),
        /JSON reviewer-result artifact|result-file/,
      );
    }
    const sameKindAndId = recordPassed(fixture, {
      reviewerKind: "reviewer@example.test",
      reviewerId: "reviewer@example.test",
    });
    assert.equal(sameKindAndId.ok, true);
  } finally {
    fixture.cleanup();
  }
});

test("structured reviewer fields are cross-checked before a receipt is written", () => {
  const fixture = createFixture();
  try {
    const artifact = JSON.parse(readFileSync(fixture.resultFile, "utf8"));
    artifact.reviewer_id = "different-reviewer@example.test";
    writeFileSync(fixture.resultFile, JSON.stringify(artifact) + "\n");
    assert.throws(
      () =>
        commandReviewRecord(fixture.directory, {
          runId: fixture.runId,
          reviewerKind: "independent-reviewer",
          reviewerId: "reviewer@example.test",
          result: "passed",
          resultFile: ".agent-stack/runs/reviews/independent-review.json",
          coordinatorToken: fixture.token,
        }),
      (error) =>
        error.details?.some((detail) =>
          /reviewer result artifact reviewer_id does not match/.test(detail),
        ) === true,
    );
  } finally {
    fixture.cleanup();
  }
});

test("valid passed review plus unavailable or changes-requested evidence remains blocked", () => {
  const unavailableFixture = createFixture();
  try {
    recordPassed(unavailableFixture);
    commandReviewUnavailable(unavailableFixture.directory, {
      runId: unavailableFixture.runId,
      reason: "reviewer-timeout",
      details: "The independent reviewer did not return a bounded result.",
      coordinatorToken: unavailableFixture.token,
    });
    const status = commandReviewStatus(
      unavailableFixture.directory,
      unavailableFixture.runId,
    );
    assert.equal(status.review_gate_ready, false);
    assert.match(status.reasons.join(" "), /unavailable/);
  } finally {
    unavailableFixture.cleanup();
  }

  const conflictingFixture = createFixture();
  try {
    recordPassed(conflictingFixture);
    const changesPath = join(
      conflictingFixture.directory,
      ".agent-stack",
      "runs",
      "reviews",
      "changes-requested.json",
    );
    const head = runGit(conflictingFixture.directory, ["rev-parse", "HEAD"]);
    writeFileSync(
      changesPath,
      JSON.stringify({
        schema_version: 1,
        run_id: conflictingFixture.runId,
        git_commit: head,
        reviewer_kind: "independent-reviewer",
        reviewer_id: "second-reviewer@example.test",
        result: "changes-requested",
        summary: "A bounded change is required.",
        findings: ["The review found a concrete issue."],
        reviewed_at: "2026-01-01T00:00:00Z",
      }) + "\n",
    );
    recordPassed(conflictingFixture, {
      reviewerId: "second-reviewer@example.test",
      result: "changes-requested",
      resultFile: ".agent-stack/runs/reviews/changes-requested.json",
    });
    const status = commandReviewStatus(
      conflictingFixture.directory,
      conflictingFixture.runId,
    );
    assert.equal(status.review_gate_ready, false);
    assert.match(status.reasons.join(" "), /requested changes/);
  } finally {
    conflictingFixture.cleanup();
  }
});

test("invalid same-run unavailable evidence is aggregated with other review evidence", () => {
  const fixture = createFixture();
  try {
    recordPassed(fixture);
    const unavailable = commandReviewUnavailable(fixture.directory, {
      runId: fixture.runId,
      reason: "reviewer-timeout",
      details: "The independent reviewer did not return a bounded result.",
      coordinatorToken: fixture.token,
    });
    const path = join(fixture.directory, unavailable.path);
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    receipt.details = "tampered";
    writeFileSync(path, JSON.stringify(receipt) + "\n");
    const status = commandReviewStatus(fixture.directory, fixture.runId);
    assert.equal(status.review_gate_ready, false);
    assert.match(status.invalid_receipts.join(" "), /canonical content hash/);
  } finally {
    fixture.cleanup();
  }
});

test("hardened Git probes ignore ambient redirection and fsmonitor settings", () => {
  const fixture = createFixture();
  const head = runGit(fixture.directory, ["rev-parse", "HEAD"]);
  const prior = Object.fromEntries(
    [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_INDEX_FILE",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_SYSTEM",
    ].map((name) => [name, process.env[name]]),
  );
  const monitorDirectory = mkdtempSync(join(tmpdir(), "mechanical-fsmonitor-"));
  const marker = join(monitorDirectory, "fsmonitor-ran");
  const monitor = join(monitorDirectory, "fsmonitor");
  try {
    writeFileSync(
      monitor,
      `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran\\n");\n`,
    );
    chmodSync(monitor, 0o700);
    runGit(fixture.directory, ["config", "core.fsmonitor", monitor]);
    recordPassed(fixture);
    process.env.GIT_DIR = join(fixture.directory, "missing-git-dir");
    process.env.GIT_WORK_TREE = join(fixture.directory, "missing-work-tree");
    process.env.GIT_INDEX_FILE = join(fixture.directory, "missing-index");
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "status.showUntrackedFiles";
    process.env.GIT_CONFIG_VALUE_0 = "no";
    process.env.GIT_CONFIG_GLOBAL = join(fixture.directory, "missing-global");
    process.env.GIT_CONFIG_SYSTEM = join(fixture.directory, "missing-system");
    const ambientArtifact = join(
      fixture.directory,
      ".agent-stack",
      "runs",
      "reviews",
      "ambient.json",
    );
    writeFileSync(
      ambientArtifact,
      JSON.stringify({
        schema_version: 1,
        run_id: fixture.runId,
        git_commit: head,
        reviewer_kind: "independent-reviewer",
        reviewer_id: "ambient-reviewer@example.test",
        result: "passed",
        summary: "The hardened Git probe ignored ambient redirection.",
        findings: [],
        reviewed_at: "2026-01-01T00:00:00Z",
      }) + "\n",
    );
    commandReviewRecord(fixture.directory, {
      runId: fixture.runId,
      reviewerKind: "independent-reviewer",
      reviewerId: "ambient-reviewer@example.test",
      result: "passed",
      resultFile: ".agent-stack/runs/reviews/ambient.json",
      coordinatorToken: fixture.token,
    });
    assert.equal(existsSync(marker), false);
    assert.equal(
      commandReviewStatus(fixture.directory, fixture.runId).review_gate_ready,
      true,
    );
  } finally {
    for (const [name, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(monitorDirectory, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test("SHA-256 repositories carry the exact 64-character Git object ID", () => {
  const fixture = createFixture({ objectFormat: "sha256" });
  try {
    assert.match(runGit(fixture.directory, ["rev-parse", "HEAD"]), /^[a-f0-9]{64}$/);
    const recorded = recordPassed(fixture);
    assert.equal(recorded.receipt.git_object_format, "sha256");
    assert.equal(
      commandReviewStatus(fixture.directory, fixture.runId).review_gate_ready,
      true,
    );
  } finally {
    fixture.cleanup();
  }
});

test("status --run requires current verification and exposes full readiness separately", () => {
  const fixture = createFixture();
  try {
    commandApproveChecks(
      fixture.directory,
      "Inspected the bounded fixture verification commands",
    );
    commit(fixture.directory, "approve fixture verification checks");
    recordPassed(fixture);
    const before = commandStatus(fixture.directory, fixture.runId);
    assert.equal(before.ok, false);
    assert.equal(before.review.review_gate_ready, true);
    assert.equal(before.readiness.pr_ready, false);
    assert.equal(before.verification.ok, false);
    const cliBefore = spawnSync(
      process.execPath,
      [PACKAGE_CLI, "status", "--target", fixture.directory, "--run", fixture.runId],
      { encoding: "utf8" },
    );
    assert.notEqual(cliBefore.status, 0);
    commandVerify(fixture.directory);
    const after = commandStatus(fixture.directory, fixture.runId);
    assert.equal(after.ok, true, JSON.stringify(after, null, 2));
    assert.equal(after.readiness.review_gate_ready, true);
    assert.equal(after.readiness.pr_ready, true);
    const cliAfter = spawnSync(
      process.execPath,
      [PACKAGE_CLI, "status", "--target", fixture.directory, "--run", fixture.runId],
      { encoding: "utf8" },
    );
    assert.equal(cliAfter.status, 0, cliAfter.stderr);
  } finally {
    fixture.cleanup();
  }
});
