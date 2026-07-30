import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CAPABILITY_MECHANISMS,
  CAPABILITY_PREFLIGHT_PAYLOAD_KIND,
  CODEX_ISOLATED_SESSION_ADAPTER,
  CODEX_NATIVE_ADAPTER,
  ReviewAttestationError,
  canonicalPayloadSerialization,
  capabilityPreflightAttestationSha256,
  collectCapabilityAttestationPayload,
  collectCapabilityPreflightPayload,
  collectCodexReviewAttestationPayload,
  ed25519KeyId,
  inspectFinalProjectState,
  parseCodexIsolatedSessionJsonl,
  parseCodexNativeReviewJsonl,
  reviewProvenanceSha256,
  reviewReceiptId,
  sameNonzeroFilesystemIdentity,
  sha256Bytes,
  signReviewAttestation,
  validateReviewAttestationKeyring,
  verifyCapabilityAttestation,
  verifyCapabilityPreflightAttestation,
  verifyReviewAttestation,
} from "../lib/review-attestation.mjs";

const SCRIPT = fileURLToPath(
  new URL("../scripts/review-attestation.mjs", import.meta.url),
);
const STARTED_AT = "2026-07-30T15:00:00Z";
const COMPLETED_AT = "2026-07-30T15:01:00Z";

function git(directory, ...args) {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL:
        process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  }).trim();
}

function write(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value, "utf8");
}

function writeJson(file, value) {
  write(file, `${JSON.stringify(value, null, 2)}\n`);
}

function temporaryRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "uas-review-attestation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function makeRepo(t) {
  const root = temporaryRoot(t);
  const repo = join(root, "project");
  const outer = join(root, "outer");
  mkdirSync(repo);
  mkdirSync(outer);
  git(repo, "init", "--quiet");
  git(repo, "config", "user.name", "Review Test");
  git(repo, "config", "user.email", "review@example.test");
  write(join(repo, "app.mjs"), "export const answer = 1;\n");
  write(
    join(repo, ".agent-stack/artifacts/DELIVERY.md"),
    [
      "# Delivery baseline",
      "",
      "Status: APPROVED",
      "Material open conflicts: NO",
      "",
    ].join("\n"),
  );
  write(
    join(repo, ".agent-stack/provider-receipts/.gitkeep"),
    "",
  );
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  write(join(repo, "app.mjs"), "export const answer = 42;\n");
  git(repo, "add", "app.mjs");
  git(repo, "commit", "--quiet", "-m", "reviewed product change");
  const reviewed = git(repo, "rev-parse", "HEAD");
  return { root, repo, outer, base, reviewed };
}

function makeCapabilityRepo(t) {
  const root = temporaryRoot(t);
  const repo = join(root, "project");
  const outer = join(root, "outer");
  mkdirSync(repo);
  mkdirSync(outer);
  git(repo, "init", "--quiet");
  git(repo, "config", "user.name", "Capability Test");
  git(repo, "config", "user.email", "capability@example.test");
  write(join(repo, "app.mjs"), "export const answer = 1;\n");
  write(
    join(repo, ".agent-stack/artifacts/DELIVERY.md"),
    [
      "# Delivery baseline",
      "",
      "Status: APPROVED",
      "Material open conflicts: NO",
      "",
    ].join("\n"),
  );
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "capability baseline");
  return {
    root,
    repo,
    outer,
    base: git(repo, "rev-parse", "HEAD"),
  };
}

test(
  "final project inspection accepts only the exact worktree directory",
  (t) => {
    const fixture = makeRepo(t);
    const inspected = inspectFinalProjectState(fixture.repo);
    assert.equal(inspected.head_revision, fixture.reviewed);

    if (process.platform === "win32") {
      const alternateDriveCase = fixture.repo.replace(
        /^([a-zA-Z]):/,
        (_, drive) =>
          `${drive === drive.toLowerCase()
            ? drive.toUpperCase()
            : drive.toLowerCase()}:`,
      );
      const alternate = inspectFinalProjectState(alternateDriveCase);
      assert.equal(alternate.head_revision, fixture.reviewed);
    }

    const nested = join(fixture.repo, "nested");
    mkdirSync(nested);
    assert.throws(
      () => inspectFinalProjectState(nested),
      (error) =>
        error instanceof ReviewAttestationError &&
        error.message ===
          "Review attestation target must be the exact Git worktree root",
    );
  },
);

test("filesystem identity fails closed when either inode is unavailable", () => {
  assert.equal(
    sameNonzeroFilesystemIdentity(
      { device: 0n, inode: 42n },
      { device: 0n, inode: 42n },
    ),
    true,
  );
  assert.equal(
    sameNonzeroFilesystemIdentity(
      { device: 7n, inode: 0n },
      { device: 7n, inode: 0n },
    ),
    false,
  );
  assert.equal(
    sameNonzeroFilesystemIdentity(
      { device: 7n, inode: 42n },
      { device: 8n, inode: 42n },
    ),
    false,
  );
  assert.equal(
    sameNonzeroFilesystemIdentity(
      { device: 7n, inode: 42n },
      { device: 7n, inode: 43n },
    ),
    false,
  );
});

function expectedFor(fixture, overrides = {}) {
  return {
    batch_id: "batch-1",
    project_instance_sha256: sha256Bytes("project-instance"),
    package_surface_sha256: sha256Bytes("package-surface"),
    collector_id: "outer-review-collector",
    collector_version: "1.0.0",
    adapter_sha256: sha256Bytes("adapter-source"),
    harness_name: "codex",
    harness_version: "1.0.0",
    primary_session_id: "primary-session",
    reviewer_session_id: "reviewer-session",
    assignment_id: "review-pre-pr",
    work_item_id: "reviewed-change",
    evidence_node_id: "review-pre-pr",
    delivery_baseline_revision: fixture.base,
    reviewed_revision: fixture.reviewed,
    started_at: STARTED_AT,
    completed_at: COMPLETED_AT,
    ...overrides,
  };
}

function reviewerResult(expected, overrides = {}) {
  return {
    schema_version: 1,
    kind: "uas.independent-review-result/v1",
    assignment_id: expected.assignment_id,
    work_item_id: expected.work_item_id,
    evidence_node_id: expected.evidence_node_id,
    delivery_baseline_revision:
      expected.delivery_baseline_revision,
    reviewed_revision: expected.reviewed_revision,
    reviewer_id: expected.reviewer_session_id,
    standards_verdict: "passed",
    intent_verdict: "passed",
    read_only: true,
    external_actions: false,
    started_at: STARTED_AT,
    completed_at: COMPLETED_AT,
    notes: ["reviewed exact revision"],
    ...overrides,
  };
}

function jsonl(records) {
  return Buffer.from(
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
}

function nativeTrace(expected, result = reviewerResult(expected), {
  spawnId = expected.reviewer_session_id,
  waitId = spawnId,
  includeSpawn = true,
  includeWait = true,
} = {}) {
  const records = [
    { type: "thread.started", thread_id: expected.primary_session_id },
  ];
  if (includeSpawn) {
    records.push({
      type: "item.completed",
      item: {
        id: "spawn-1",
        type: "collab_tool_call",
        tool: "spawn_agent",
        status: "completed",
        prompt: [
          `Assignment ${expected.assignment_id}.`,
          `Compare ${expected.delivery_baseline_revision}`,
          `with ${expected.reviewed_revision}.`,
        ].join(" "),
        receiver_thread_ids: [spawnId],
        result: { ok: true, receiver_thread_ids: [spawnId] },
      },
    });
  }
  if (includeWait) {
    records.push({
      type: "item.completed",
      item: {
        id: "wait-1",
        type: "collab_tool_call",
        tool: "wait_agent",
        status: "completed",
        receiver_thread_ids: [waitId],
        agents_states: {
          [waitId]: {
            status: "completed",
            final_result: result,
          },
        },
      },
    });
  }
  return jsonl(records);
}

function isolatedTrace(expected, result = reviewerResult(expected), {
  sessionId = expected.reviewer_session_id,
} = {}) {
  return jsonl([
    {
      type: "uas.outer.review.launch.completed",
      status: "completed",
      session_id: sessionId,
      assignment_id: expected.assignment_id,
      delivery_baseline_revision:
        expected.delivery_baseline_revision,
      reviewed_revision: expected.reviewed_revision,
      read_only: true,
      network_access: "disabled",
      external_actions: false,
    },
    {
      type: "uas.outer.review.wait.completed",
      status: "completed",
      session_id: sessionId,
      exit_status: 0,
      signal: null,
    },
    {
      type: "uas.outer.review.result.completed",
      status: "completed",
      session_id: sessionId,
      result,
    },
  ]);
}

function addCandidate(
  fixture,
  expected,
  evidence,
  { adapter = CODEX_NATIVE_ADAPTER, overrides = {} } = {},
) {
  const receipt = {
    schema_version: 1,
    assignment_id: expected.assignment_id,
    work_item_id: expected.work_item_id,
    evidence_node_id: expected.evidence_node_id,
    mechanism:
      adapter === CODEX_NATIVE_ADAPTER
        ? "native-subagent"
        : "isolated-session",
    harness: adapter,
    reviewer_id: evidence.reviewer_id,
    base_revision: expected.delivery_baseline_revision,
    reviewed_revision: expected.reviewed_revision,
    delivery_baseline:
      `.agent-stack/artifacts/DELIVERY.md@${expected.delivery_baseline_revision}`,
    standards_verdict: "passed",
    intent_verdict: "passed",
    reviewer_result_sha256:
      evidence.events.reviewer_result_bytes_sha256,
    provenance_sha256: evidence.events.provenance_sha256,
    read_only: true,
    external_actions: false,
    started_at: STARTED_AT,
    completed_at: COMPLETED_AT,
    result: "succeeded",
    ...overrides,
  };
  receipt.receipt_id = reviewReceiptId(receipt);
  const path =
    `.agent-stack/review-receipts/${receipt.receipt_id}.json`;
  writeJson(join(fixture.repo, path), receipt);
  git(fixture.repo, "add", path);
  git(fixture.repo, "commit", "--quiet", "-m", "package review receipt");
  return { receipt, path };
}

function addLocalReviewLinkage(fixture, candidate) {
  writeJson(join(fixture.repo, ".agent-stack/work-items.json"), {
    schema_version: 1,
    updated_at: null,
    items: [
      {
        id: candidate.receipt.work_item_id,
        title: "Review the bounded change",
        objective: "Require trusted independent review evidence.",
        status: "done",
        priority: "normal",
        acceptance_criteria: [
          "A separate reviewer passes both review axes.",
        ],
        scope: {
          paths: ["app.mjs"],
          out_of_scope: [],
        },
        depends_on: [],
        evidence_refs: [candidate.receipt.evidence_node_id],
        external_refs: [],
        updated_at: null,
      },
    ],
  });
  writeJson(
    join(fixture.repo, ".agent-stack/evidence-graph.json"),
    {
      schema_version: 1,
      updated_at: null,
      nodes: [
        {
          id: candidate.receipt.work_item_id,
          kind: "work_item",
          label: "Reviewed change",
          state: "verified",
          source: {
            provider: "repository",
            reference: ".agent-stack/work-items.json",
          },
          summary: "The bounded change is implemented.",
        },
        {
          id: candidate.receipt.evidence_node_id,
          kind: "review",
          label: "Independent pre-PR review",
          state: "verified",
          source: {
            provider: "review-receipt",
            reference: candidate.path,
          },
          summary: "Standards and intent review passed.",
        },
      ],
      edges: [
        {
          from: candidate.receipt.evidence_node_id,
          to: candidate.receipt.work_item_id,
          relation: "reviews",
        },
      ],
    },
  );
  write(
    join(
      fixture.repo,
      ".agent-stack/artifacts/PRE_PR_REVIEW.md",
    ),
    [
      "# Independent Pre-PR Review",
      "",
      "Status: APPROVED",
      "Material open conflicts: NO",
      "",
      "## Scope",
      "",
      `- Assignment ID: ${candidate.receipt.assignment_id}`,
      `- Work item ID: ${candidate.receipt.work_item_id}`,
      `- Delivery baseline: ${candidate.receipt.delivery_baseline}`,
      `- Base revision: ${candidate.receipt.base_revision}`,
      `- Reviewed revision: ${candidate.receipt.reviewed_revision}`,
      `- Review receipt: ${candidate.path}`,
      "",
    ].join("\n"),
  );
  git(
    fixture.repo,
    "add",
    ".agent-stack/work-items.json",
    ".agent-stack/evidence-graph.json",
    ".agent-stack/artifacts/PRE_PR_REVIEW.md",
  );
  git(
    fixture.repo,
    "commit",
    "--quiet",
    "-m",
    "link trusted local review evidence",
  );
}

function makeKeyMaterial({
  notBefore = null,
  notAfter = null,
} = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const keyId = ed25519KeyId(publicKey);
  return {
    privateKey,
    publicKey,
    privatePem: privateKey.export({
      type: "pkcs8",
      format: "pem",
    }),
    keyring: {
      schema_version: 1,
      kind: "uas.review-attestation-keyring/v1",
      keys: [
        {
          key_id: keyId,
          algorithm: "Ed25519",
          public_key_spki_base64: publicDer.toString("base64"),
          status: "active",
          not_before: notBefore,
          not_after: notAfter,
        },
      ],
    },
  };
}

function successfulFixture(t, {
  adapter = CODEX_NATIVE_ADAPTER,
  localLinkage = false,
} = {}) {
  const fixture = makeRepo(t);
  const expected = expectedFor(fixture);
  const result = reviewerResult(expected);
  const raw =
    adapter === CODEX_NATIVE_ADAPTER
      ? nativeTrace(expected, result)
      : isolatedTrace(expected, result);
  const evidence =
    adapter === CODEX_NATIVE_ADAPTER
      ? parseCodexNativeReviewJsonl(raw, expected)
      : parseCodexIsolatedSessionJsonl(raw, expected);
  const candidate = addCandidate(fixture, expected, evidence, {
    adapter,
  });
  if (localLinkage) {
    addLocalReviewLinkage(fixture, candidate);
  }
  const payload = collectCodexReviewAttestationPayload({
    rawJsonl: raw,
    target: fixture.repo,
    candidatePath: candidate.path,
    expected,
    adapter,
  });
  return {
    ...fixture,
    expected,
    result,
    raw,
    evidence,
    candidate,
    payload,
  };
}

test("canonical serialization, Ed25519 key IDs, signing, and trusted verification", (t) => {
  const fixture = successfulFixture(t);
  assert.equal(
    canonicalPayloadSerialization({ z: 1, a: { z: 2, a: 3 } }),
    '{"a":{"a":3,"z":2},"z":1}',
  );
  assert.deepEqual(fixture.payload.final_state.reviewed_paths, [
    "app.mjs",
  ]);
  assert.deepEqual(fixture.payload.final_state.post_review_paths, [
    fixture.candidate.path,
  ]);
  assert.equal(
    fixture.payload.events.provenance_sha256,
    reviewProvenanceSha256(fixture.payload.events),
  );
  assert.equal(
    fixture.candidate.receipt.provenance_sha256,
    fixture.payload.events.provenance_sha256,
  );
  const keys = makeKeyMaterial();
  assert.equal(validateReviewAttestationKeyring(keys.keyring).ok, true);
  const attestation = signReviewAttestation(
    fixture.payload,
    keys.privateKey,
  );
  const verified = verifyReviewAttestation(
    attestation,
    keys.keyring,
    {
      outcome: "succeeded",
      assignment_id: fixture.expected.assignment_id,
      reviewed_revision: fixture.reviewed,
      candidate_path: fixture.candidate.path,
      candidate_bytes_sha256:
        fixture.payload.candidate.bytes_sha256,
      provenance_sha256:
        fixture.payload.events.provenance_sha256,
      final_head_revision:
        fixture.payload.final_state.head_revision,
      final_project_state_sha256:
        fixture.payload.final_state.project_state_sha256,
    },
  );
  assert.deepEqual(verified.errors, []);
  assert.equal(verified.ok, true);
});

test("unknown self-signed keys and modified signed payloads are rejected", (t) => {
  const fixture = successfulFixture(t);
  const trusted = makeKeyMaterial();
  const untrusted = makeKeyMaterial();
  const selfSigned = signReviewAttestation(
    fixture.payload,
    untrusted.privateKey,
  );
  const unknown = verifyReviewAttestation(
    selfSigned,
    trusted.keyring,
  );
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors.join("\n"), /not signed by a trusted key/);

  const signed = signReviewAttestation(
    fixture.payload,
    trusted.privateKey,
  );
  signed.payload.final_state.git_tree_oid = "f".repeat(40);
  const modified = verifyReviewAttestation(signed, trusted.keyring);
  assert.equal(modified.ok, false);
  assert.match(
    modified.errors.join("\n"),
    /signature verification failed/,
  );
});

test("native parser requires one successful spawn, exact wait, and terminal structured result", (t) => {
  const fixture = makeRepo(t);
  const expected = expectedFor(fixture);
  assert.throws(
    () =>
      parseCodexNativeReviewJsonl(
        nativeTrace(expected, reviewerResult(expected), {
          spawnId: "worker-a",
          waitId: "worker-b",
        }),
        {
          ...expected,
          reviewer_session_id: null,
        },
      ),
    /wait targeting the exact spawned reviewer/,
  );
  assert.throws(
    () =>
      parseCodexNativeReviewJsonl(
        nativeTrace(expected, reviewerResult(expected), {
          includeWait: false,
        }),
        expected,
      ),
    /requires one wait/,
  );
  assert.throws(
    () =>
      parseCodexNativeReviewJsonl(
        nativeTrace(expected, reviewerResult(expected), {
          includeSpawn: false,
        }),
        expected,
      ),
    /no successful nonempty spawn/,
  );
  const orderedRecords = nativeTrace(
    expected,
    reviewerResult(expected),
  )
    .toString("utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.throws(
    () =>
      parseCodexNativeReviewJsonl(
        jsonl([
          orderedRecords[0],
          orderedRecords[2],
          orderedRecords[1],
        ]),
        expected,
      ),
    /wait must occur after the successful spawn/,
  );
});

test("the original empty-wait fabricated-review canary is rejected", (t) => {
  const fixture = makeRepo(t);
  const expected = expectedFor(fixture);
  const canary = Buffer.from(
    [
      '{"type":"thread.started","thread_id":"019fb3e2-d9c4-7102-94f7-e04fa2eb57f1"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’ll delegate this exact arithmetic check to one read-only reviewer, wait specifically for it, and relay its actual conclusion."}}',
      '{"type":"item.started","item":{"id":"item_1","type":"collab_tool_call","tool":"wait","sender_thread_id":"019fb3e2-d9c4-7102-94f7-e04fa2eb57f1","receiver_thread_ids":[],"prompt":null,"agents_states":{},"status":"in_progress"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"collab_tool_call","tool":"wait","sender_thread_id":"019fb3e2-d9c4-7102-94f7-e04fa2eb57f1","receiver_thread_ids":[],"prompt":null,"agents_states":{},"status":"completed"}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"The reviewer concluded: “The statement `2 + 2 = 4` is correct. Adding two units to two units yields four units under standard arithmetic.”"}}',
      '{"type":"turn.completed","usage":{"input_tokens":37266,"cached_input_tokens":24064,"cache_write_input_tokens":0,"output_tokens":165,"reasoning_output_tokens":0}}',
      "",
    ].join("\n"),
    "utf8",
  );
  assert.throws(
    () => parseCodexNativeReviewJsonl(canary, expected),
    /no successful nonempty spawn/,
  );
  const unavailable = parseCodexNativeReviewJsonl(canary, expected, {
    stderr: "collaboration spawn failed before the wait",
    allowUnavailable: true,
  });
  assert.equal(unavailable.outcome, "unavailable");
  assert.equal(unavailable.unavailable.failed_spawn_observed, true);
  assert.equal(unavailable.unavailable.empty_wait_observed, true);
  assert.equal(
    unavailable.events.provenance_sha256,
    reviewProvenanceSha256(unavailable.events),
  );
});

test("isolated-session adapter binds launch, exact wait, and exact terminal result", (t) => {
  const fixture = successfulFixture(t, {
    adapter: CODEX_ISOLATED_SESSION_ADAPTER,
  });
  assert.equal(
    fixture.payload.collector.adapter,
    CODEX_ISOLATED_SESSION_ADAPTER,
  );
  assert.equal(
    fixture.candidate.receipt.mechanism,
    "isolated-session",
  );
  const badTrace = isolatedTrace(fixture.expected);
  const records = badTrace
    .toString("utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  records[1].session_id = "wrong-session";
  assert.throws(
    () =>
      parseCodexIsolatedSessionJsonl(jsonl(records), fixture.expected),
    /one exact-session wait/,
  );
  const reversed = isolatedTrace(fixture.expected)
    .toString("utf8")
    .trim()
    .split("\n")
    .map(JSON.parse)
    .reverse();
  assert.throws(
    () =>
      parseCodexIsolatedSessionJsonl(
        jsonl(reversed),
        fixture.expected,
      ),
    /launch before wait before terminal result/,
  );
});

test("candidate receipt content, filename, raw result, and provenance mutations are rejected", (t) => {
  const contentFixture = makeRepo(t);
  const expected = expectedFor(contentFixture);
  const raw = nativeTrace(expected);
  const evidence = parseCodexNativeReviewJsonl(raw, expected);
  const candidate = addCandidate(contentFixture, expected, evidence, {
    overrides: {
      provenance_sha256: sha256Bytes("fabricated provenance"),
    },
  });
  assert.throws(
    () =>
      collectCodexReviewAttestationPayload({
        rawJsonl: raw,
        target: contentFixture.repo,
        candidatePath: candidate.path,
        expected,
      }),
    (error) =>
      error instanceof ReviewAttestationError &&
      error.details.some((detail) =>
        detail.includes("provenance_sha256"),
      ),
  );

  const resultFixture = successfulFixture(t);
  const changedResult = reviewerResult(resultFixture.expected, {
    notes: ["tampered after receipt packaging"],
  });
  assert.throws(
    () =>
      collectCodexReviewAttestationPayload({
        rawJsonl: nativeTrace(resultFixture.expected, changedResult),
        target: resultFixture.repo,
        candidatePath: resultFixture.candidate.path,
        expected: resultFixture.expected,
      }),
    (error) =>
      error instanceof ReviewAttestationError &&
      error.details.some((detail) =>
        detail.includes("reviewer_result_sha256"),
      ),
  );

  const filenameFixture = successfulFixture(t);
  const wrongPath =
    `.agent-stack/review-receipts/${"f".repeat(64)}.json`;
  rmSync(
    join(filenameFixture.repo, filenameFixture.candidate.path),
  );
  writeJson(
    join(filenameFixture.repo, wrongPath),
    filenameFixture.candidate.receipt,
  );
  git(filenameFixture.repo, "add", "-A");
  git(
    filenameFixture.repo,
    "commit",
    "--quiet",
    "-m",
    "tamper receipt filename binding",
  );
  assert.throws(
    () =>
      collectCodexReviewAttestationPayload({
        rawJsonl: filenameFixture.raw,
        target: filenameFixture.repo,
        candidatePath: wrongPath,
        expected: filenameFixture.expected,
      }),
    /file name must match/,
  );
});

test("candidate exact bytes and final project state changes cannot be hidden", (t) => {
  const fixture = successfulFixture(t);
  const before = inspectFinalProjectState(fixture.repo, {
    candidatePath: fixture.candidate.path,
    baselineRevision: fixture.base,
    reviewedRevision: fixture.reviewed,
  });
  assert.equal(
    before.candidate.bytes_sha256,
    sha256Bytes(
      readFileSync(join(fixture.repo, fixture.candidate.path)),
    ),
  );
  write(
    join(fixture.repo, "app.mjs"),
    "export const answer = 43;\n",
  );
  assert.throws(
    () =>
      inspectFinalProjectState(fixture.repo, {
        candidatePath: fixture.candidate.path,
        baselineRevision: fixture.base,
        reviewedRevision: fixture.reviewed,
      }),
    /must be clean/,
  );
});

test("collector Git inspection ignores repository replacement refs", (t) => {
  const fixture = successfulFixture(t);
  const finalHead = git(fixture.repo, "rev-parse", "HEAD");
  const actualTree = git(fixture.repo, "rev-parse", "HEAD^{tree}");

  write(
    join(fixture.repo, "app.mjs"),
    "export const answer = 999;\n",
  );
  git(fixture.repo, "add", "app.mjs");
  const replacementTree = git(fixture.repo, "write-tree");
  const replacementCommit = git(
    fixture.repo,
    "commit-tree",
    replacementTree,
    "-p",
    fixture.reviewed,
    "-m",
    "forged replacement state",
  );
  git(fixture.repo, "reset", "--hard", finalHead);
  git(fixture.repo, "replace", finalHead, replacementCommit);

  const inspected = inspectFinalProjectState(fixture.repo, {
    candidatePath: fixture.candidate.path,
    baselineRevision: fixture.base,
    reviewedRevision: fixture.reviewed,
  });
  assert.equal(inspected.head_revision, finalHead);
  assert.equal(inspected.git_tree_oid, actualTree);
  assert.notEqual(inspected.git_tree_oid, replacementTree);
  assert.deepEqual(inspected.reviewed_paths, ["app.mjs"]);
  assert.deepEqual(inspected.post_review_paths, [
    fixture.candidate.path,
  ]);
});

test("post-review product changes are rejected even when committed", (t) => {
  const fixture = successfulFixture(t);
  write(
    join(fixture.repo, "second-product-change.mjs"),
    "export const unexpected = true;\n",
  );
  git(fixture.repo, "add", "second-product-change.mjs");
  git(
    fixture.repo,
    "commit",
    "--quiet",
    "-m",
    "unreviewed product change",
  );
  assert.throws(
    () =>
      inspectFinalProjectState(fixture.repo, {
        candidatePath: fixture.candidate.path,
        baselineRevision: fixture.base,
        reviewedRevision: fixture.reviewed,
      }),
    /Product or control paths changed after review/,
  );
});

test("post-review rename detection cannot hide a product deletion", (t) => {
  const fixture = successfulFixture(t);
  renameSync(
    join(fixture.repo, "app.mjs"),
    join(
      fixture.repo,
      ".agent-stack",
      "artifacts",
      "PRE_PR_REVIEW.md",
    ),
  );
  git(fixture.repo, "add", "-A");
  git(
    fixture.repo,
    "commit",
    "--quiet",
    "-m",
    "rename reviewed product into allowed packaging path",
  );
  assert.throws(
    () =>
      inspectFinalProjectState(fixture.repo, {
        candidatePath: fixture.candidate.path,
        baselineRevision: fixture.base,
        reviewedRevision: fixture.reviewed,
      }),
    /Product or control paths changed after review: app\.mjs/,
  );
});

test("separately signed capability preflight binds the post-run changed state", (t) => {
  const fixture = makeCapabilityRepo(t);
  const expected = {
    batch_id: "batch-1",
    project_instance_sha256: sha256Bytes("project-instance"),
    package_surface_sha256: sha256Bytes("package-surface"),
    collector_id: "outer-review-collector",
    collector_version: "1.0.0",
    adapter_sha256: sha256Bytes("capability-adapter"),
    primary_session_id: "primary-capability-session",
    delivery_baseline_revision: fixture.base,
    intended_final_revision: null,
    required_product_paths: ["app.mjs"],
    checked_at: STARTED_AT,
    session_started_at: "2026-07-30T15:00:30Z",
    completed_at: COMPLETED_AT,
  };
  const capabilities = Object.fromEntries(
    CAPABILITY_MECHANISMS.map((mechanism) => [
      mechanism,
      {
        state: "disabled",
        proof_kind: "outer-preflight-check",
        applied_before_session: true,
        reason_code: `${mechanism.replaceAll("-", ".")}.disabled`,
        proof_sha256: sha256Bytes(`proof:${mechanism}`),
      },
    ]),
  );
  const preflightPayload = collectCapabilityPreflightPayload({
    target: fixture.repo,
    expected,
    capabilities,
  });
  assert.deepEqual(
    Object.keys(preflightPayload.capabilities).sort(),
    [...CAPABILITY_MECHANISMS],
  );
  assert.equal(
    preflightPayload.kind,
    CAPABILITY_PREFLIGHT_PAYLOAD_KIND,
  );
  assert.equal(
    preflightPayload.baseline_state.head_revision,
    fixture.base,
  );
  const keys = makeKeyMaterial();
  const preflightAttestation = signReviewAttestation(
    preflightPayload,
    keys.privateKey,
  );
  const preflightResult = verifyCapabilityPreflightAttestation(
    preflightAttestation,
    keys.keyring,
    {
      capability: "independent-review",
      batch_id: expected.batch_id,
      primary_session_id: expected.primary_session_id,
      delivery_baseline_revision:
        expected.delivery_baseline_revision,
    },
  );
  assert.equal(preflightResult.ok, true);

  write(join(fixture.repo, "app.mjs"), "export const answer = 42;\n");
  git(fixture.repo, "add", "app.mjs");
  git(
    fixture.repo,
    "commit",
    "--quiet",
    "-m",
    "complete capability-tested work",
  );
  const payload = collectCapabilityAttestationPayload({
    target: fixture.repo,
    expected,
    preflightAttestation,
    preflightKeyring: keys.keyring,
  });
  assert.equal(payload.baseline_ancestor, true);
  assert.notEqual(payload.final_state.head_revision, fixture.base);
  assert.deepEqual(payload.changed_paths, ["app.mjs"]);
  assert.equal(
    payload.preflight_sha256,
    capabilityPreflightAttestationSha256(preflightAttestation),
  );
  const attestation = signReviewAttestation(payload, keys.privateKey);
  const result = verifyCapabilityAttestation(
    attestation,
    keys.keyring,
    {
      capability: "independent-review",
      preflight_sha256:
        capabilityPreflightAttestationSha256(preflightAttestation),
      changed_paths_sha256: payload.changed_paths_sha256,
      final_head_revision: payload.final_state.head_revision,
      final_project_state_sha256:
        payload.final_state.project_state_sha256,
    },
  );
  assert.equal(result.ok, true);

  const incomplete = structuredClone(capabilities);
  delete incomplete.human;
  assert.throws(
    () =>
      signReviewAttestation(
        {
          ...preflightPayload,
          capabilities: incomplete,
        },
        keys.privateKey,
      ),
    /Refusing to sign an invalid review attestation payload/,
  );
  assert.throws(
    () =>
      collectCapabilityAttestationPayload({
        target: fixture.repo,
        expected: {
          ...expected,
          session_started_at: "2026-07-30T14:59:59Z",
        },
        preflightAttestation,
        preflightKeyring: keys.keyring,
      }),
    (error) =>
      error instanceof ReviewAttestationError &&
      error.details.some((detail) =>
        detail.includes(
          "checked_at must precede session_started_at",
        ),
      ),
  );
});

test("capability changed paths preserve both sides of a rename", (t) => {
  const fixture = makeCapabilityRepo(t);
  const expected = {
    batch_id: "batch-rename",
    project_instance_sha256: sha256Bytes("rename-project-instance"),
    package_surface_sha256: sha256Bytes("package-surface"),
    collector_id: "outer-review-collector",
    collector_version: "1.0.0",
    adapter_sha256: sha256Bytes("capability-adapter"),
    primary_session_id: "primary-rename-session",
    delivery_baseline_revision: fixture.base,
    intended_final_revision: null,
    required_product_paths: ["renamed-app.mjs"],
    checked_at: STARTED_AT,
    session_started_at: "2026-07-30T15:00:30Z",
    completed_at: COMPLETED_AT,
  };
  const capabilities = Object.fromEntries(
    CAPABILITY_MECHANISMS.map((mechanism) => [
      mechanism,
      {
        state: "disabled",
        proof_kind: "outer-preflight-check",
        applied_before_session: true,
        reason_code: `${mechanism.replaceAll("-", ".")}.disabled`,
        proof_sha256: sha256Bytes(`proof:${mechanism}`),
      },
    ]),
  );
  const keys = makeKeyMaterial();
  const preflightAttestation = signReviewAttestation(
    collectCapabilityPreflightPayload({
      target: fixture.repo,
      expected,
      capabilities,
    }),
    keys.privateKey,
  );

  renameSync(
    join(fixture.repo, "app.mjs"),
    join(fixture.repo, "renamed-app.mjs"),
  );
  git(fixture.repo, "add", "-A");
  git(fixture.repo, "commit", "--quiet", "-m", "rename product file");

  const payload = collectCapabilityAttestationPayload({
    target: fixture.repo,
    expected,
    preflightAttestation,
    preflightKeyring: keys.keyring,
  });
  assert.deepEqual(payload.changed_paths, [
    "app.mjs",
    "renamed-app.mjs",
  ]);
});

test("capability post-run rejects unchanged, incomplete, and tampered preflight evidence", (t) => {
  const fixture = makeCapabilityRepo(t);
  const expected = {
    batch_id: "batch-1",
    project_instance_sha256: sha256Bytes("project-instance"),
    package_surface_sha256: sha256Bytes("package-surface"),
    collector_id: "outer-review-collector",
    collector_version: "1.0.0",
    adapter_sha256: sha256Bytes("capability-adapter"),
    primary_session_id: "primary-capability-session",
    delivery_baseline_revision: fixture.base,
    intended_final_revision: null,
    required_product_paths: ["app.mjs"],
    checked_at: STARTED_AT,
    session_started_at: "2026-07-30T15:00:30Z",
    completed_at: COMPLETED_AT,
  };
  const capabilities = Object.fromEntries(
    CAPABILITY_MECHANISMS.map((mechanism) => [
      mechanism,
      {
        state: "disabled",
        proof_kind: "outer-preflight-check",
        applied_before_session: true,
        reason_code: `${mechanism.replaceAll("-", ".")}.disabled`,
        proof_sha256: sha256Bytes(`proof:${mechanism}`),
      },
    ]),
  );
  const keys = makeKeyMaterial();
  const preflightAttestation = signReviewAttestation(
    collectCapabilityPreflightPayload({
      target: fixture.repo,
      expected,
      capabilities,
    }),
    keys.privateKey,
  );

  assert.throws(
    () =>
      collectCapabilityAttestationPayload({
        target: fixture.repo,
        expected,
        preflightAttestation,
        preflightKeyring: keys.keyring,
      }),
    /must differ from its delivery baseline/,
  );

  const tamperedPreflight = structuredClone(preflightAttestation);
  tamperedPreflight.payload.checked_at = "2026-07-30T15:00:01Z";
  assert.throws(
    () =>
      collectCapabilityAttestationPayload({
        target: fixture.repo,
        expected,
        preflightAttestation: tamperedPreflight,
        preflightKeyring: keys.keyring,
      }),
    (error) =>
      error instanceof ReviewAttestationError &&
      error.details.some((detail) =>
        detail.includes("signature verification failed"),
      ),
  );

  write(join(fixture.repo, "other.mjs"), "export const other = true;\n");
  git(fixture.repo, "add", "other.mjs");
  git(fixture.repo, "commit", "--quiet", "-m", "wrong product path");
  assert.throws(
    () =>
      collectCapabilityAttestationPayload({
        target: fixture.repo,
        expected,
        preflightAttestation,
        preflightKeyring: keys.keyring,
      }),
    /missing required product path: app\.mjs/,
  );
});

test("outer-only CLI signs and verifies the separate capability preflight chain", (t) => {
  const fixture = makeCapabilityRepo(t);
  const keys = makeKeyMaterial();
  const expected = {
    batch_id: "batch-1",
    project_instance_sha256: sha256Bytes("project-instance"),
    package_surface_sha256: sha256Bytes("package-surface"),
    collector_id: "outer-review-collector",
    collector_version: "1.0.0",
    adapter_sha256: sha256Bytes("capability-adapter"),
    primary_session_id: "primary-capability-session",
    delivery_baseline_revision: fixture.base,
    intended_final_revision: null,
    checked_at: STARTED_AT,
    session_started_at: "2026-07-30T15:00:30Z",
    completed_at: COMPLETED_AT,
  };
  const capabilities = Object.fromEntries(
    CAPABILITY_MECHANISMS.map((mechanism) => [
      mechanism,
      {
        state: "disabled",
        proof_kind: "outer-preflight-check",
        applied_before_session: true,
        reason_code: `${mechanism.replaceAll("-", ".")}.disabled`,
        proof_sha256: sha256Bytes(`proof:${mechanism}`),
      },
    ]),
  );
  const expectedFile = join(fixture.outer, "expected.json");
  const capabilitiesFile = join(
    fixture.outer,
    "capabilities.json",
  );
  const keyFile = join(fixture.outer, "attester.pem");
  const keyringFile = join(fixture.outer, "keyring.json");
  const preflightFile = join(fixture.outer, "preflight.json");
  const postRunFile = join(fixture.outer, "post-run.json");
  writeJson(expectedFile, expected);
  writeJson(capabilitiesFile, capabilities);
  writeFileSync(keyFile, keys.privatePem);
  chmodSync(keyFile, 0o600);
  writeJson(keyringFile, keys.keyring);

  const preflight = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "capability-preflight-sign",
      "--target",
      fixture.repo,
      "--expected",
      expectedFile,
      "--capabilities",
      capabilitiesFile,
      "--private-key",
      keyFile,
      "--output",
      preflightFile,
    ],
    { encoding: "utf8" },
  );
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.equal(JSON.parse(preflight.stdout).phase, "preflight");

  write(join(fixture.repo, "app.mjs"), "export const answer = 42;\n");
  git(fixture.repo, "add", "app.mjs");
  git(fixture.repo, "commit", "--quiet", "-m", "complete work");

  const postRun = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "capability-sign",
      "--target",
      fixture.repo,
      "--expected",
      expectedFile,
      "--preflight",
      preflightFile,
      "--keyring",
      keyringFile,
      "--private-key",
      keyFile,
      "--output",
      postRunFile,
    ],
    { encoding: "utf8" },
  );
  assert.equal(postRun.status, 0, postRun.stderr);
  assert.equal(JSON.parse(postRun.stdout).phase, "post-run");

  const verified = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "verify",
      "--target",
      fixture.repo,
      "--expected",
      expectedFile,
      "--attestation",
      postRunFile,
      "--preflight",
      preflightFile,
      "--keyring",
      keyringFile,
    ],
    { encoding: "utf8" },
  );
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).ok, true);

  const mismatchedPayload = JSON.parse(
    readFileSync(postRunFile, "utf8"),
  ).payload;
  mismatchedPayload.checked_at = "2026-07-30T15:00:01Z";
  const mismatchedAttestation = signReviewAttestation(
    mismatchedPayload,
    keys.privateKey,
  );
  const mismatchedFile = join(fixture.outer, "post-run-mismatched.json");
  writeJson(mismatchedFile, mismatchedAttestation);
  const mismatched = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "verify",
      "--target",
      fixture.repo,
      "--expected",
      expectedFile,
      "--attestation",
      mismatchedFile,
      "--preflight",
      preflightFile,
      "--keyring",
      keyringFile,
    ],
    { encoding: "utf8" },
  );
  assert.equal(mismatched.status, 2, mismatched.stderr);
  assert.ok(
    JSON.parse(mismatched.stdout).errors.some((error) =>
      error.includes("preflight check time"),
    ),
  );
});

test("outer-only CLI collects, signs, verifies, and refuses to overwrite evidence", (t) => {
  const fixture = successfulFixture(t, { localLinkage: true });
  const keys = makeKeyMaterial();
  const traceFile = join(fixture.outer, "trace.jsonl");
  const expectedFile = join(fixture.outer, "expected.json");
  const keyFile = join(fixture.outer, "attester.pem");
  const keyringFile = join(fixture.outer, "keyring.json");
  const attestationFile = join(fixture.outer, "attestation.json");
  writeFileSync(traceFile, fixture.raw);
  writeJson(expectedFile, fixture.expected);
  writeFileSync(keyFile, keys.privatePem);
  chmodSync(keyFile, 0o600);
  writeJson(keyringFile, keys.keyring);
  const collect = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "collect-sign",
      "--adapter",
      CODEX_NATIVE_ADAPTER,
      "--trace",
      traceFile,
      "--target",
      fixture.repo,
      "--candidate",
      fixture.candidate.path,
      "--expected",
      expectedFile,
      "--private-key",
      keyFile,
      "--output",
      attestationFile,
    ],
    { encoding: "utf8" },
  );
  assert.equal(collect.status, 0, collect.stderr);
  const collected = JSON.parse(collect.stdout);
  assert.equal(collected.ok, true);
  assert.equal(collected.outer_only, true);
  assert.match(collected.notice, /never install or copy/);

  const verify = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "verify",
      "--target",
      fixture.repo,
      "--expected",
      expectedFile,
      "--attestation",
      attestationFile,
      "--keyring",
      keyringFile,
    ],
    { encoding: "utf8" },
  );
  assert.equal(verify.status, 0, verify.stderr);
  const verified = JSON.parse(verify.stdout);
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.local_review_validation, {
    ok: true,
    evidence_ok: true,
    receipts_ok: true,
  });

  const unexpectedOutcomeFile = join(
    fixture.outer,
    "expected-unavailable.json",
  );
  writeJson(unexpectedOutcomeFile, {
    ...fixture.expected,
    outcome: "unavailable",
  });
  const unexpectedOutcome = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "verify",
      "--target",
      fixture.repo,
      "--expected",
      unexpectedOutcomeFile,
      "--attestation",
      attestationFile,
      "--keyring",
      keyringFile,
    ],
    { encoding: "utf8" },
  );
  assert.equal(unexpectedOutcome.status, 2, unexpectedOutcome.stderr);
  assert.ok(
    JSON.parse(unexpectedOutcome.stdout).errors.some((error) =>
      error.includes("binding mismatch: outcome"),
    ),
  );

  const forbiddenDirectory = join(fixture.repo, "forbidden-output");
  const forbiddenOutput = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "collect-sign",
      "--adapter",
      CODEX_NATIVE_ADAPTER,
      "--trace",
      traceFile,
      "--target",
      fixture.repo,
      "--candidate",
      fixture.candidate.path,
      "--expected",
      expectedFile,
      "--private-key",
      keyFile,
      "--output",
      join(forbiddenDirectory, "attestation.json"),
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(forbiddenOutput.status, 0);
  assert.match(
    forbiddenOutput.stderr,
    /outside the project|existing non-symlink directory/,
  );
  assert.equal(existsSync(forbiddenDirectory), false);

  const overwrite = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "collect-sign",
      "--adapter",
      CODEX_NATIVE_ADAPTER,
      "--trace",
      traceFile,
      "--target",
      fixture.repo,
      "--candidate",
      fixture.candidate.path,
      "--expected",
      expectedFile,
      "--private-key",
      keyFile,
      "--output",
      attestationFile,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /never overwritten/);

  const expiredKeys = makeKeyMaterial({
    notBefore: "2026-07-30T14:59:00Z",
    notAfter: "2026-07-30T15:00:30Z",
  });
  const expiredAttestationFile = join(
    fixture.outer,
    "expired-at-completion.json",
  );
  const expiredKeyringFile = join(
    fixture.outer,
    "expired-keyring.json",
  );
  const expectedBackdatedFile = join(
    fixture.outer,
    "expected-backdated.json",
  );
  writeJson(
    expiredAttestationFile,
    signReviewAttestation(fixture.payload, expiredKeys.privateKey),
  );
  writeJson(expiredKeyringFile, expiredKeys.keyring);
  writeJson(expectedBackdatedFile, {
    ...fixture.expected,
    recorded_at: "2026-07-30T15:00:01Z",
  });
  const expiredAtSignedCompletion = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "verify",
      "--target",
      fixture.repo,
      "--expected",
      expectedBackdatedFile,
      "--attestation",
      expiredAttestationFile,
      "--keyring",
      expiredKeyringFile,
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    expiredAtSignedCompletion.status,
    2,
    expiredAtSignedCompletion.stderr,
  );
  assert.ok(
    JSON.parse(expiredAtSignedCompletion.stdout).errors.some((error) =>
      error.includes("signing key is expired"),
    ),
  );
});

test("outer verification consumes local graph, ledger, receipt, and PRE linkage", (t) => {
  const fixture = successfulFixture(t, { localLinkage: true });
  const preReviewFile = join(
    fixture.repo,
    ".agent-stack/artifacts/PRE_PR_REVIEW.md",
  );
  write(
    preReviewFile,
    readFileSync(preReviewFile, "utf8").replace(
      "Status: APPROVED",
      "Status: REJECTED",
    ),
  );
  git(fixture.repo, "add", ".agent-stack/artifacts/PRE_PR_REVIEW.md");
  git(fixture.repo, "commit", "--quiet", "-m", "invalidate PRE linkage");
  const payload = collectCodexReviewAttestationPayload({
    rawJsonl: fixture.raw,
    target: fixture.repo,
    candidatePath: fixture.candidate.path,
    expected: fixture.expected,
    adapter: CODEX_NATIVE_ADAPTER,
  });
  const keys = makeKeyMaterial();
  const expectedFile = join(fixture.outer, "expected.json");
  const attestationFile = join(fixture.outer, "attestation.json");
  const keyringFile = join(fixture.outer, "keyring.json");
  writeJson(expectedFile, fixture.expected);
  writeJson(
    attestationFile,
    signReviewAttestation(payload, keys.privateKey),
  );
  writeJson(keyringFile, keys.keyring);

  const verify = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "verify",
      "--target",
      fixture.repo,
      "--expected",
      expectedFile,
      "--attestation",
      attestationFile,
      "--keyring",
      keyringFile,
    ],
    { encoding: "utf8" },
  );
  assert.equal(verify.status, 2, verify.stderr);
  const result = JSON.parse(verify.stdout);
  assert.equal(result.ok, false);
  assert.deepEqual(result.local_review_validation, {
    ok: false,
    evidence_ok: false,
    receipts_ok: false,
  });
  assert.ok(
    result.errors.some((error) =>
      error.includes("local evidence validation"),
    ),
  );
  assert.ok(
    result.errors.some((error) =>
      error.includes("local receipt validation"),
    ),
  );
});
