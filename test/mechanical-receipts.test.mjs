import assert from "node:assert/strict";
import {
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
  commandEvidenceActivate,
  commandEvidenceActivationStatus,
  commandReviewRecord,
  commandReviewStatus,
  commandReviewUnavailable,
  commandStart,
  installOrUpgrade,
} from "../bin/ultimate-agent-stack.mjs";

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

function createFixture({ activation = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mechanical-receipts-test-"));
  runGit(directory, ["init", "-q"]);
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
  mkdirSync(join(directory, "reviews"), { recursive: true });
  const resultFile = join(directory, "reviews", "independent-review.md");
  writeFileSync(resultFile, "Independent review passed.\n");
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
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function recordPassed(fixture, overrides = {}) {
  return commandReviewRecord(fixture.directory, {
    runId: overrides.runId ?? fixture.runId,
    reviewerKind: overrides.reviewerKind ?? "independent-reviewer",
    reviewerId: overrides.reviewerId ?? "reviewer@example.test",
    result: overrides.result ?? "passed",
    resultFile: overrides.resultFile ?? "reviews/independent-review.md",
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

test("review record emits a deterministic exact-head local receipt", () => {
  const fixture = createFixture();
  try {
    const result = recordPassed(fixture);
    assert.equal(result.ok, true);
    assert.equal(result.receipt.claim, "agent-recorded");
    assert.equal(result.receipt.git_commit, runGit(fixture.directory, ["rev-parse", "HEAD"]));
    assert.equal(result.receipt.result_file, "reviews/independent-review.md");
    assert.match(result.receipt.result_file_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.ok(existsSync(join(fixture.directory, result.path)));
    const status = commandReviewStatus(fixture.directory, fixture.runId);
    assert.equal(status.independent_reviewed, true);
    assert.equal(status.pr_ready, true);
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
    assert.equal(status.pr_ready, false);
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
    assert.equal(status.pr_ready, false);
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
    assert.equal(status.pr_ready, false);
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
    assert.throws(
      () =>
        recordPassed(fixture, {
          reviewerKind: "reviewer@example.test",
          reviewerId: "reviewer@example.test",
        }),
      (error) => error.details?.some((detail) => /distinct/.test(detail)) === true,
    );
  } finally {
    fixture.cleanup();
  }
});
