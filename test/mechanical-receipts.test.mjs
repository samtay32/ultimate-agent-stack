import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { delimiter, dirname, join } from "node:path";
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

function supportsSha256Git() {
  const directory = mkdtempSync(join(tmpdir(), "mechanical-sha256-capability-"));
  try {
    return spawnSync(
      "git",
      ["-C", directory, "init", "-q", "--object-format=sha256"],
      { encoding: "utf8", shell: false },
    ).status === 0;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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

function prepareVerifiedFixture() {
  const fixture = createFixture();
  commandApproveChecks(
    fixture.directory,
    "Inspected the bounded fixture verification commands",
  );
  commit(fixture.directory, "approve fixture verification checks");
  recordPassed(fixture);
  commandVerify(fixture.directory);
  return fixture;
}

function latestVerificationPath(fixture) {
  return join(fixture.directory, ".agent-stack", "runs", "latest.json");
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function verificationReceiptHash(evidence) {
  const body = { ...evidence };
  delete body.receipt_sha256;
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(body)))
    .digest("hex");
}

function reviewReceiptHash(receipt) {
  const body = { ...receipt };
  delete body.receipt_id;
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(body)))
    .digest("hex");
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
    assert.equal(status.evidence_graph_path, ".agent-stack/evidence-graph.json");
    assert.equal(status.review_receipts_directory, ".agent-stack/review-receipts");
    assert.equal(status.review_unavailable_directory, ".agent-stack/review-unavailable");
    assert.deepEqual(status.evaluated_receipt_paths, [
      ".agent-stack/evidence-graph.json",
    ]);
    assert.deepEqual(status.evaluated_result_paths, []);
    assert.match(status.boundary, /not independent proof/);

    const otherRun = commandEvidenceActivationStatus(fixture.directory, {
      runId: "another-run",
      requiredSkills: ["run-autonomous-delivery"],
    });
    assert.equal(otherRun.ok, false);
    assert.deepEqual(otherRun.activated_skills, []);
    assert.deepEqual(otherRun.missing_skills, ["run-autonomous-delivery"]);
    assert.equal(otherRun.evidence_graph_path, ".agent-stack/evidence-graph.json");
    assert.equal(otherRun.review_receipts_directory, ".agent-stack/review-receipts");
    assert.equal(otherRun.review_unavailable_directory, ".agent-stack/review-unavailable");
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
    assert.equal(status.evidence_graph_path, ".agent-stack/evidence-graph.json");
    assert.equal(status.review_receipts_directory, ".agent-stack/review-receipts");
    assert.equal(status.review_unavailable_directory, ".agent-stack/review-unavailable");
    assert.deepEqual(status.evaluated_receipt_paths, [result.path]);
    assert.deepEqual(status.evaluated_result_paths, [result.receipt.result_file]);
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
    assert.equal(status.evidence_graph_path, ".agent-stack/evidence-graph.json");
    assert.equal(status.review_receipts_directory, ".agent-stack/review-receipts");
    assert.equal(status.review_unavailable_directory, ".agent-stack/review-unavailable");
    assert.deepEqual(status.evaluated_receipt_paths, []);
    assert.deepEqual(status.evaluated_result_paths, []);
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
    for (const resultFile of [
      ".agent-stack/runs/reviews\\bad.json",
      ".agent-stack/runs/reviews:bad.json",
      ".agent-stack/runs/reviews/bad./result.json",
      ".agent-stack/runs/reviews\tbad.json",
      ".agent-stack/runs/reviews\u0001bad.json",
      ".agent-stack/runs/reviews\u007fbad.json",
      ".agent-stack/runs/.json",
      ".agent-stack/runs/reviews/bad.json ",
      ".agent-stack/runs/reviews/CON.json",
      ".agent-stack/runs/reviews/Com1.json",
      ".agent-stack/runs/reviews/LpT9.json",
      ".agent-stack/runs/reviews/COM¹.json",
      ".agent-stack/runs/reviews/LPT².txt.json",
    ]) {
      assert.throws(
        () => recordPassed(fixture, { resultFile }),
        /JSON reviewer-result artifact|result-file/,
        resultFile,
      );
    }
    const friendly = recordPassed(fixture, {
      resultFile: "./.agent-stack/runs/reviews/independent-review.json",
    });
    assert.equal(
      friendly.receipt.result_file,
      ".agent-stack/runs/reviews/independent-review.json",
    );
    const receiptFile = join(fixture.directory, friendly.path);
    const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
    receipt.result_file = `./${receipt.result_file}`;
    receipt.receipt_id = reviewReceiptHash(receipt);
    writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + "\n");
    const nonCanonical = commandReviewStatus(fixture.directory, fixture.runId);
    assert.equal(nonCanonical.review_gate_ready, false);
    assert.match(
      nonCanonical.invalid_receipts.join(" "),
      /canonical normalized path/,
    );
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

test("non-array reviewer findings fail closed through record and status", () => {
  for (const findings of ["not-an-array", { issue: "not-an-array" }]) {
    const recordFixture = createFixture();
    try {
      const artifact = JSON.parse(readFileSync(recordFixture.resultFile, "utf8"));
      artifact.findings = findings;
      writeFileSync(recordFixture.resultFile, JSON.stringify(artifact) + "\n");
      assert.throws(
        () =>
          commandReviewRecord(recordFixture.directory, {
            runId: recordFixture.runId,
            reviewerKind: "independent-reviewer",
            reviewerId: "reviewer@example.test",
            result: "passed",
            resultFile: ".agent-stack/runs/reviews/independent-review.json",
            coordinatorToken: recordFixture.token,
          }),
        (error) =>
          error.details?.some((detail) => /findings must be an array/.test(detail)) ===
          true,
      );
    } finally {
      recordFixture.cleanup();
    }

    const statusFixture = createFixture();
    try {
      recordPassed(statusFixture);
      const artifact = JSON.parse(readFileSync(statusFixture.resultFile, "utf8"));
      artifact.findings = findings;
      writeFileSync(statusFixture.resultFile, JSON.stringify(artifact) + "\n");
      const status = commandReviewStatus(
        statusFixture.directory,
        statusFixture.runId,
      );
      assert.equal(status.review_gate_ready, false);
      assert.match(status.invalid_receipts.join(" "), /findings must be an array/);
    } finally {
      statusFixture.cleanup();
    }
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

test("receipt validation errors remain global when a receipt run id is altered", () => {
  const fixture = createFixture();
  const writeArtifact = (fileName, runId, reviewerId, result) => {
    const head = runGit(fixture.directory, ["rev-parse", "HEAD"]);
    writeFileSync(
      join(
        fixture.directory,
        ".agent-stack",
        "runs",
        "reviews",
        fileName,
      ),
      JSON.stringify({
        schema_version: 1,
        run_id: runId,
        git_commit: head,
        reviewer_kind: "independent-reviewer",
        reviewer_id: reviewerId,
        result,
        summary: "The bounded review artifact is structurally inspectable.",
        findings: result === "passed" ? [] : ["A bounded change is required."],
        reviewed_at: "2026-01-01T00:00:00Z",
      }) + "\n",
    );
  };
  try {
    recordPassed(fixture);
    writeArtifact(
      "other-run.json",
      "other-run",
      "other-reviewer@example.test",
      "passed",
    );
    commandReviewRecord(fixture.directory, {
      runId: "other-run",
      reviewerKind: "independent-reviewer",
      reviewerId: "other-reviewer@example.test",
      result: "passed",
      resultFile: ".agent-stack/runs/reviews/other-run.json",
      coordinatorToken: fixture.token,
    });
    assert.equal(commandReviewStatus(fixture.directory, fixture.runId).review_gate_ready, true);

    writeArtifact(
      "altered-run.json",
      fixture.runId,
      "altered-reviewer@example.test",
      "changes-requested",
    );
    const altered = commandReviewRecord(fixture.directory, {
      runId: fixture.runId,
      reviewerKind: "independent-reviewer",
      reviewerId: "altered-reviewer@example.test",
      result: "changes-requested",
      resultFile: ".agent-stack/runs/reviews/altered-run.json",
      coordinatorToken: fixture.token,
    });
    const alteredPath = join(fixture.directory, altered.path);
    const alteredReceipt = JSON.parse(readFileSync(alteredPath, "utf8"));
    alteredReceipt.run_id = "other-run";
    writeFileSync(alteredPath, JSON.stringify(alteredReceipt) + "\n");
    const reviewStatus = commandReviewStatus(fixture.directory, fixture.runId);
    assert.equal(reviewStatus.review_gate_ready, false);
    assert.match(reviewStatus.invalid_receipts.join(" "), /canonical content hash/);
  } finally {
    fixture.cleanup();
  }

  const unavailableFixture = createFixture();
  try {
    recordPassed(unavailableFixture);
    const unavailable = commandReviewUnavailable(unavailableFixture.directory, {
      runId: unavailableFixture.runId,
      reason: "reviewer-timeout",
      details: "The independent reviewer did not return a bounded result.",
      coordinatorToken: unavailableFixture.token,
    });
    const unavailablePath = join(unavailableFixture.directory, unavailable.path);
    const receipt = JSON.parse(readFileSync(unavailablePath, "utf8"));
    receipt.run_id = "other-run";
    writeFileSync(unavailablePath, JSON.stringify(receipt) + "\n");
    const unavailableStatus = commandReviewStatus(
      unavailableFixture.directory,
      unavailableFixture.runId,
    );
    assert.equal(unavailableStatus.review_gate_ready, false);
    assert.match(
      unavailableStatus.invalid_receipts.join(" "),
      /canonical content hash/,
    );
  } finally {
    unavailableFixture.cleanup();
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
    runGit(fixture.directory, ["status", "--porcelain=v1"]);
    assert.equal(existsSync(marker), true, "fixture must prove the configured monitor is executable");
    rmSync(marker);
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

test("hardened Git probes infer SHA-1 when object-format is unsupported", () => {
  const fixture = createFixture();
  const fakeGitDirectory = mkdtempSync(join(tmpdir(), "mechanical-fake-git-"));
  const realGit = (process.env.PATH ?? "")
    .split(delimiter)
    .map((directory) =>
      join(directory, process.platform === "win32" ? "git.exe" : "git"),
    )
    .find((candidate) => existsSync(candidate));
  assert.ok(realGit, "test requires a real Git executable");
  const fakeRunner = join(fakeGitDirectory, "fake-git.mjs");
  const fakeGit = join(
    fakeGitDirectory,
    process.platform === "win32" ? "git.cmd" : "git",
  );
  writeFileSync(
    fakeRunner,
    `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args.includes("--show-object-format=storage")) process.exit(129);
const result = spawnSync(process.env.ISSUE39_REAL_GIT, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`,
  );
  if (process.platform === "win32") {
    writeFileSync(
      fakeGit,
      `@echo off\r\n"${process.execPath}" "%~dp0fake-git.mjs" %*\r\n`,
    );
  } else {
    writeFileSync(
      fakeGit,
      `#!/bin/sh\nexec "${process.execPath}" "${fakeRunner}" "$@"\n`,
    );
    chmodSync(fakeGit, 0o700);
  }
  const head = runGit(fixture.directory, ["rev-parse", "HEAD"]);
  const previousPath = process.env.PATH;
  const previousRealGit = process.env.ISSUE39_REAL_GIT;
  try {
    recordPassed(fixture);
    process.env.PATH = [
      fakeGitDirectory,
      dirname(process.execPath),
      previousPath,
    ]
      .filter(Boolean)
      .join(delimiter);
    process.env.ISSUE39_REAL_GIT = realGit;
    const status = commandReviewStatus(fixture.directory, fixture.runId);
    assert.equal(status.review_gate_ready, true, JSON.stringify(status, null, 2));
    assert.deepEqual(status.git, {
      head,
      object_format: "sha1",
      clean: true,
    });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousRealGit === undefined) delete process.env.ISSUE39_REAL_GIT;
    else process.env.ISSUE39_REAL_GIT = previousRealGit;
    fixture.cleanup();
    rmSync(fakeGitDirectory, { recursive: true, force: true });
  }
});

test(
  "SHA-256 repositories carry the exact 64-character Git object ID",
  { skip: !supportsSha256Git() },
  () => {
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
  },
);

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
    assert.match(
      before.verification.reasons.join(" "),
      /latest verification evidence/,
    );
    const cliBefore = spawnSync(
      process.execPath,
      [PACKAGE_CLI, "status", "--target", fixture.directory, "--run", fixture.runId],
      { encoding: "utf8" },
    );
    assert.equal(cliBefore.status, 1);
    const cliBeforeOutput = JSON.parse(cliBefore.stdout);
    assert.match(
      cliBeforeOutput.verification.reasons.join(" "),
      /latest verification evidence/,
    );
    commandVerify(fixture.directory);
    const after = commandStatus(fixture.directory, fixture.runId);
    assert.equal(after.ok, true, JSON.stringify(after, null, 2));
    assert.equal(after.readiness.review_gate_ready, true);
    assert.equal(after.readiness.pr_ready, true);
    assert.deepEqual(after.review.git, after.verification.git);
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

test("verify runs checks on a dirty worktree but readiness requires a clean exact head", () => {
  const fixture = createFixture();
  try {
    recordPassed(fixture);
    commandApproveChecks(
      fixture.directory,
      "Inspected the bounded fixture verification commands",
    );
    const dirtyVerification = commandVerify(fixture.directory);
    assert.equal(dirtyVerification.ok, true, JSON.stringify(dirtyVerification, null, 2));
    const dirtyEvidence = JSON.parse(
      readFileSync(latestVerificationPath(fixture), "utf8"),
    );
    assert.equal(dirtyEvidence.git_before.clean, false);
    assert.equal(dirtyEvidence.git_after.clean, false);
    assert.equal(
      dirtyEvidence.git_before.head,
      dirtyEvidence.git_after.head,
    );
    const blocked = commandStatus(fixture.directory, fixture.runId);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.verification.ok, false);
    assert.match(blocked.verification.reasons.join(" "), /clean exact/);

    commit(fixture.directory, "approve fixture verification checks");
    const cleanVerification = commandVerify(fixture.directory);
    assert.equal(cleanVerification.ok, true);
    const clean = commandStatus(fixture.directory, fixture.runId);
    assert.equal(clean.verification.ok, true, JSON.stringify(clean, null, 2));
  } finally {
    fixture.cleanup();
  }
});

test("verification evidence contains tamper-detection hashes and exact check results", () => {
  const fixture = prepareVerifiedFixture();
  try {
    const evidence = JSON.parse(readFileSync(latestVerificationPath(fixture), "utf8"));
    assert.match(evidence.checks_hash, /^[a-f0-9]{64}$/);
    assert.match(evidence.receipt_sha256, /^[a-f0-9]{64}$/);
    assert.equal(evidence.checks.length, 1);
    assert.equal(evidence.checks[0].required, true);
    assert.equal(evidence.checks[0].status, "passed");
    assert.equal(evidence.checks[0].result, "passed");
    assert.equal(evidence.checks[0].returncode, 0);
    const status = commandStatus(fixture.directory, fixture.runId);
    assert.equal(status.ok, true, JSON.stringify(status, null, 2));
    assert.deepEqual(status.review.git, status.verification.git);
  } finally {
    fixture.cleanup();
  }
});

test("verification readiness rejects missing and altered integrity fields", () => {
  const mutations = [
    ["missing receipt hash", (evidence) => delete evidence.receipt_sha256, /receipt_sha256/],
    ["wrong receipt hash", (evidence) => { evidence.receipt_sha256 = "0".repeat(64); }, /receipt_sha256/],
    ["changed checks hash", (evidence) => { evidence.checks_hash = "0".repeat(64); }, /checks_hash/],
    [
      "altered Git evidence with recomputed receipt",
      (evidence) => {
        evidence.git_after.head = "0".repeat(40);
        evidence.receipt_sha256 = verificationReceiptHash(evidence);
      },
      /Git identity changed|stale|git_after.head/,
    ],
  ];
  for (const [label, mutate, expected] of mutations) {
    const fixture = prepareVerifiedFixture();
    try {
      const evidencePath = latestVerificationPath(fixture);
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      mutate(evidence);
      writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
      const status = commandStatus(fixture.directory, fixture.runId);
      assert.equal(status.ok, false, label);
      assert.match(status.verification.reasons.join(" "), expected, label);
    } finally {
      fixture.cleanup();
    }
  }
});

test("verification semantic mutations fail with their specific errors after rehashing", () => {
  const mutations = [
    [
      "altered target",
      (evidence) => {
        evidence.target = "/another/checkout";
      },
      /target does not match the current checkout/,
    ],
    [
      "null verification timestamp",
      (evidence) => {
        evidence.started_at = null;
      },
      /started_at must be a non-null/,
    ],
    [
      "null check timestamp",
      (evidence) => {
        evidence.checks[0].started_at = null;
      },
      /checks\[0\]\.started_at must be a non-null/,
    ],
    [
      "altered check definition",
      (evidence) => {
        evidence.checks[0].argv = ["node", "--version"];
      },
      /argv does not match configured check/,
    ],
  ];
  for (const [label, mutate, expected] of mutations) {
    const fixture = prepareVerifiedFixture();
    try {
      const evidencePath = latestVerificationPath(fixture);
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      mutate(evidence);
      evidence.receipt_sha256 = verificationReceiptHash(evidence);
      writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
      const status = commandStatus(fixture.directory, fixture.runId);
      assert.equal(status.ok, false, label);
      assert.match(status.verification.reasons.join(" "), expected, label);
      assert.doesNotMatch(
        status.verification.reasons.join(" "),
        /receipt_sha256 does not match its content/,
        label,
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("verification readiness requires every configured check exactly once", () => {
  const mutations = [
    ["empty checks", (evidence) => { evidence.checks = []; }, /missing configured id|exactly once/],
    ["missing checks", (evidence) => delete evidence.checks, /checks must be an array/],
    ["duplicate checks", (evidence) => { evidence.checks = [evidence.checks[0], { ...evidence.checks[0] }]; }, /duplicate id|exactly once/],
    ["unknown check", (evidence) => { evidence.checks[0].id = "unknown-check"; }, /unknown id|missing configured id/],
    ["required/status/result disagreement", (evidence) => { evidence.checks[0].result = "failed"; }, /status and result/],
  ];
  for (const [label, mutate, expected] of mutations) {
    const fixture = prepareVerifiedFixture();
    try {
      const evidencePath = latestVerificationPath(fixture);
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      mutate(evidence);
      evidence.receipt_sha256 = verificationReceiptHash(evidence);
      writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
      const status = commandStatus(fixture.directory, fixture.runId);
      assert.equal(status.ok, false, label);
      assert.match(status.verification.reasons.join(" "), expected, label);
    } finally {
      fixture.cleanup();
    }
  }
});

test("blocked project readiness reports concrete health reasons", () => {
  const directory = mkdtempSync(join(tmpdir(), "mechanical-status-health-"));
  try {
    const status = commandStatus(directory, "run-health");
    assert.equal(status.ok, false);
    assert.equal(status.readiness.status, "blocked");
    assert.ok(status.readiness.reasons.length > 0);
    assert.ok(status.readiness.reasons.includes("project installation is missing"));
    assert.ok(status.readiness.reasons.includes("project configuration is missing"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("status validates configuration and preserves readiness across branch renames", () => {
  const fixture = prepareVerifiedFixture();
  try {
    const renamed = runGit(fixture.directory, ["branch", "-m", "renamed-for-readiness"]);
    assert.equal(renamed, "");
    const status = commandStatus(fixture.directory, fixture.runId);
    assert.equal(status.ok, true, JSON.stringify(status, null, 2));
    assert.deepEqual(status.review.git, {
      head: status.verification.git.head,
      object_format: status.verification.git.object_format,
      clean: true,
    });

    const configPath = join(fixture.directory, ".agent-stack", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.quality.checks = "not-an-array";
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    const invalid = commandStatus(fixture.directory);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.checks_approved, false);
    assert.ok(invalid.configuration_errors?.length > 0);
    assert.ok(invalid.readiness.reasons.includes("project configuration is invalid"));

    const invalidRun = commandStatus(fixture.directory, fixture.runId);
    assert.equal(invalidRun.ok, false);
    assert.equal(invalidRun.verification.ok, false);
    assert.ok(
      invalidRun.readiness.reasons.includes("project configuration is invalid"),
    );
  } finally {
    fixture.cleanup();
  }
});

test("verification evidence cannot replay across real checkout paths", () => {
  const source = prepareVerifiedFixture();
  const copy = createFixture();
  try {
    writeFileSync(
      latestVerificationPath(copy),
      readFileSync(latestVerificationPath(source)),
    );
    const status = commandStatus(copy.directory, copy.runId);
    assert.equal(status.ok, false);
    assert.match(status.verification.reasons.join(" "), /target does not match/);
  } finally {
    source.cleanup();
    copy.cleanup();
  }
});

test("review receipt schema rejects unsafe paths and binds Git digest length to format", () => {
  const schemaPath = fileURLToPath(
    new URL(
      "../assets/project-template/.agent-stack/contracts/review-receipt.schema.json",
      import.meta.url,
    ),
  );
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const pathPattern = new RegExp(schema.properties.result_file.pattern);
  assert.equal(pathPattern.test(".agent-stack/runs/reviews/good.json"), true);
  for (const unsafe of [
    ".agent-stack/runs/reviews\\bad.json",
    ".agent-stack/runs/reviews:bad.json",
    ".agent-stack/runs//bad.json",
    ".agent-stack/runs/reviews/./bad.json",
    ".agent-stack/runs/reviews/../bad.json",
    ".agent-stack/runs/reviews/bad./result.json",
    ".agent-stack/runs/reviews\tbad.json",
    ".agent-stack/runs/reviews\u0001bad.json",
    ".agent-stack/runs/reviews\u007fbad.json",
    ".agent-stack/runs/.json",
    ".agent-stack/runs/reviews/bad.json ",
  ]) {
    assert.equal(pathPattern.test(unsafe), false, unsafe);
  }
  const reservedPattern = new RegExp(
    schema.allOf
      .find((entry) => entry.properties?.result_file?.not?.pattern)
      .properties.result_file.not.pattern,
  );
  for (const unsafe of [
    ".agent-stack/runs/reviews/CON.json",
    ".agent-stack/runs/reviews/PrN.txt.json",
    ".agent-stack/runs/reviews/aux.json",
    ".agent-stack/runs/reviews/COM1.json",
    ".agent-stack/runs/reviews/LPT9.json",
    ".agent-stack/runs/reviews/COM¹.json",
    ".agent-stack/runs/reviews/LPT³.txt.json",
  ]) {
    assert.equal(reservedPattern.test(unsafe), true, unsafe);
  }
  const relevantGitFields = (gitObjectFormat, gitCommit) => ({
    git_object_format: gitObjectFormat,
    git_commit: gitCommit,
  });
  assert.equal(
    schema.allOf[0].if.properties.git_object_format.const,
    "sha1",
  );
  assert.equal(
    schema.allOf[1].if.properties.git_object_format.const,
    "sha256",
  );
  assert.equal(schema.allOf[0].then.properties.git_commit.pattern, "^[a-f0-9]{40}$");
  assert.equal(schema.allOf[1].then.properties.git_commit.pattern, "^[a-f0-9]{64}$");
  const sha1Pattern = new RegExp(schema.allOf[0].then.properties.git_commit.pattern);
  const sha256Pattern = new RegExp(schema.allOf[1].then.properties.git_commit.pattern);
  const sha1Valid = relevantGitFields("sha1", "a".repeat(40));
  const sha256Valid = relevantGitFields("sha256", "a".repeat(64));
  const sha1Reversed = relevantGitFields("sha1", "a".repeat(64));
  const sha256Reversed = relevantGitFields("sha256", "a".repeat(40));
  assert.equal(sha1Pattern.test(sha1Valid.git_commit), true);
  assert.equal(sha256Pattern.test(sha256Valid.git_commit), true);
  assert.equal(sha1Pattern.test(sha1Reversed.git_commit), false);
  assert.equal(sha256Pattern.test(sha256Reversed.git_commit), false);
  for (const key of ["run_id", "coordinator_id", "reviewer_kind", "reviewer_id"]) {
    const pattern = new RegExp(schema.properties[key].pattern);
    assert.equal(pattern.test("recorded-value"), true, key);
    for (const invalid of [" ", "\t", "\u0001", "\u007f", "line\nvalue"]) {
      assert.equal(pattern.test(invalid), false, `${key}: ${JSON.stringify(invalid)}`);
    }
  }
  assert.deepEqual(schema.properties.result.enum, ["passed", "changes-requested"]);
  assert.equal(schema.properties.claim.const, "agent-recorded");
  assert.match(schema.properties.result_file_sha256.pattern, /64/);
  assert.equal(Object.hasOwn(schema.properties, "git_object_format"), true);
  assert.equal(
    schema.required.includes("git_commit"),
    true,
  );
  assert.equal(
    JSON.stringify(schema).includes("coordinator_id"),
    true,
  );
});
