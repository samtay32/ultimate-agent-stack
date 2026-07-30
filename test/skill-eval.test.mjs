import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  behaviorSurfaceEntries,
  behaviorSurfaceHash,
  buildScaffold,
  hashBehaviorEntries,
  parseSkillMetadata,
  readBehaviorSurfacePath,
  validateRunRecord as validateRunRecordWithKeyring,
  validateScenarioCatalog,
} from "../scripts/skill-eval.mjs";
import { reviewReceiptId } from "../bin/ultimate-agent-stack.mjs";
import {
  capabilityPreflightAttestationSha256,
  canonicalPayloadSerialization,
  ed25519KeyId,
  reviewProvenanceSha256,
  sha256Bytes,
  signReviewAttestation,
} from "../lib/review-attestation.mjs";
import {
  EVALUATION_SCRUBBED_CREDENTIAL_ENVIRONMENT,
  expectedFixtureBaseline,
  projectStateSha256,
} from "../scripts/skill-fixture.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const catalog = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "evals", "scenarios.json"), "utf8"),
);
const { privateKey: reviewPrivateKey, publicKey: reviewPublicKey } =
  generateKeyPairSync("ed25519");
const reviewPrivateKeyPem = reviewPrivateKey.export({
  type: "pkcs8",
  format: "pem",
});
const reviewPublicKeySpki = reviewPublicKey.export({
  type: "spki",
  format: "der",
});
const reviewKeyId = ed25519KeyId({
  key: reviewPublicKeySpki,
  type: "spki",
  format: "der",
});
const trustedReviewKeyring = {
  schema_version: 1,
  kind: "uas.review-attestation-keyring/v1",
  keys: [
    {
      key_id: reviewKeyId,
      algorithm: "Ed25519",
      public_key_spki_base64: reviewPublicKeySpki.toString("base64"),
      status: "active",
      not_before: null,
      not_after: null,
    },
  ],
};

function evaluationAuthorityForRecord(
  record,
  {
    keyring = trustedReviewKeyring,
    issuedAt = "2026-07-30T14:00:00Z",
    expiresAt = "2026-07-30T16:00:00Z",
    projectRoots = null,
  } = {},
) {
  const reviewBearing = new Set(
    catalog.scenarios
      .filter((scenario) => scenario.expected.required_review_gate)
      .map((scenario) => scenario.id),
  );
  return {
    schema_version: 1,
    kind: "uas.evaluation-authority/v1",
    batch_id: record.batch_id,
    surface_hash: record.surface_hash,
    issued_at: issuedAt,
    expires_at: expiresAt,
    cases: (Array.isArray(record.cases) ? record.cases : [])
      .filter((item) => reviewBearing.has(item.scenario_id))
      .map((item, index) => ({
        scenario_id: item.scenario_id,
        project_instance_sha256: item.project_instance_sha256,
        project_root:
          projectRoots?.[item.scenario_id] ??
          resolve(
            PACKAGE_ROOT,
            `.authority-project-${index}-${item.scenario_id}`,
          ),
        materialized_git_head: item.materialized_git_head,
        primary_session_id: item.harness_session.id,
        not_before: issuedAt,
        deadline: expiresAt,
      })),
    trusted_review_keyring: structuredClone(keyring),
  };
}

function validateRunRecord(record, catalogValue = catalog) {
  return validateRunRecordWithKeyring(record, catalogValue, {
    evaluationAuthority: evaluationAuthorityForRecord(record),
  });
}

const hashValue = (value) => sha256Bytes(value);

function signUncheckedPayload(payload) {
  const signature = signBytes(
    null,
    Buffer.from(canonicalPayloadSerialization(payload), "utf8"),
    reviewPrivateKey,
  );
  return {
    schema_version: 1,
    kind: "uas.review-attestation/v1",
    payload,
    signature: {
      algorithm: "Ed25519",
      key_id: reviewKeyId,
      value_base64: signature.toString("base64"),
    },
  };
}

function signedFinalState(item, { reviewedPaths = [], postReviewPaths = [] } = {}) {
  return {
    head_revision: item.final_git_head,
    git_tree_oid: item.final_git_tree_oid,
    git_object_format: "sha1",
    git_tree_manifest_sha256: item.final_git_tree_manifest_sha256,
    project_state_sha256: item.final_review_attested_state_sha256,
    clean: true,
    reviewed_paths: reviewedPaths,
    reviewed_paths_sha256: hashValue(
      canonicalPayloadSerialization(reviewedPaths),
    ),
    post_review_paths: postReviewPaths,
    post_review_paths_sha256: hashValue(
      canonicalPayloadSerialization(postReviewPaths),
    ),
  };
}

function signedReviewCollection(record, item) {
  const reviewerSessionId = "test-reviewer:direct-delivery";
  const reviewerResultSha256 = hashValue("exact reviewer result bytes");
  const events = {
    spawn_event_sha256: hashValue("outer isolated launch"),
    spawn_returned_worker_id: reviewerSessionId,
    wait_event_sha256: hashValue("outer exact-session wait"),
    wait_target_worker_id: reviewerSessionId,
    final_result_event_sha256: hashValue("terminal structured result"),
    reviewer_result_bytes_sha256: reviewerResultSha256,
    trace_bundle_sha256: hashValue("exact adapter trace bundle"),
    stderr_sha256: hashValue(""),
  };
  const provenanceSha256 = hashValue(
    canonicalPayloadSerialization(events),
  );
  events.provenance_sha256 = provenanceSha256;
  const receipt = {
    schema_version: 1,
    assignment_id: "review-pre-pr",
    work_item_id: "delivery-change",
    evidence_node_id: "review-pre-pr",
    mechanism: "isolated-session",
    harness: "codex-isolated-session-v1",
    reviewer_id: reviewerSessionId,
    base_revision: item.materialized_git_head,
    reviewed_revision: item.reviewed_git_head,
    delivery_baseline:
      `.agent-stack/artifacts/DELIVERY.md@${item.materialized_git_head}`,
    standards_verdict: "passed",
    intent_verdict: "passed",
    reviewer_result_sha256: reviewerResultSha256,
    provenance_sha256: provenanceSha256,
    read_only: true,
    external_actions: false,
    started_at: "2026-07-30T15:00:00Z",
    completed_at: "2026-07-30T15:01:00Z",
    result: "succeeded",
  };
  receipt.receipt_id = reviewReceiptId(receipt);
  const path =
    `.agent-stack/review-receipts/${receipt.receipt_id}.json`;
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  const bytesSha256 = hashValue(bytes);
  const postReviewPaths = [
    ".agent-stack/artifacts/PRE_PR_REVIEW.md",
    ".agent-stack/evidence-graph.json",
    ".agent-stack/work-items.json",
    path,
  ].sort();
  const payload = {
    schema_version: 1,
    kind: "uas.review-attestation-payload/v1",
    outcome: "succeeded",
    batch_id: record.batch_id,
    project_instance_sha256: item.project_instance_sha256,
    package_surface_sha256: record.surface_hash,
    collector: {
      id: "test-collector",
      version: "1.0.0",
      adapter: "codex-isolated-session-v1",
      adapter_sha256: hashValue("isolated adapter"),
    },
    harness: {
      name: record.harness.name,
      version: record.harness.version,
      primary_session_id: item.harness_session.id,
      reviewer_session_id: reviewerSessionId,
    },
    assignment: {
      id: receipt.assignment_id,
      work_item_id: receipt.work_item_id,
      evidence_node_id: receipt.evidence_node_id,
      delivery_baseline_revision: item.materialized_git_head,
      reviewed_revision: item.reviewed_git_head,
    },
    events,
    candidate: {
      path,
      bytes_sha256: bytesSha256,
      git_blob_oid: "e".repeat(40),
    },
    final_state: signedFinalState(item, {
      reviewedPaths: ["src/session.mjs"],
      postReviewPaths,
    }),
    verdicts: {
      standards: "passed",
      intent: "passed",
    },
    boundary: {
      read_only: true,
      external_actions: false,
    },
    unavailable: null,
    started_at: receipt.started_at,
    completed_at: receipt.completed_at,
  };
  return {
    review_attestations: [
      signReviewAttestation(payload, reviewPrivateKeyPem),
    ],
    review_candidates: [
      {
        path,
        bytes_base64: bytes.toString("base64"),
        sha256: bytesSha256,
      },
    ],
    capability_preflight_attestations: [],
    capability_attestations: [],
  };
}

function signedDisabledCapabilityCollection(record, item) {
  const capabilities = Object.fromEntries(
    [
      "external-provider",
      "human",
      "isolated-session",
      "native-subagent",
    ].map((mechanism) => [
      mechanism,
      {
        state: "disabled",
        proof_kind: "session-policy",
        applied_before_session: true,
        reason_code: "fixture-disabled",
        proof_sha256: hashValue(`disabled:${mechanism}`),
      },
    ]),
  );
  const requiredProductPaths = ["src/status.mjs"];
  const assignment = {
    delivery_baseline_revision: item.materialized_git_head,
    intended_final_revision: null,
    required_product_paths: requiredProductPaths,
    required_product_paths_sha256: hashValue(
      canonicalPayloadSerialization(requiredProductPaths),
    ),
  };
  const harness = {
    primary_session_id: item.harness_session.id,
  };
  const common = {
    schema_version: 1,
    outcome: "unavailable",
    capability: "independent-review",
    batch_id: record.batch_id,
    project_instance_sha256: item.project_instance_sha256,
    package_surface_sha256: record.surface_hash,
    collector: {
      id: "test-collector",
      version: "1.0.0",
      adapter: "capability-preflight-v1",
      adapter_sha256: hashValue("capability adapter"),
    },
    harness,
    assignment,
  };
  const preflightPayload = {
    ...common,
    kind: "uas.capability-preflight-payload/v1",
    capabilities,
    checked_at: "2026-07-30T14:59:00Z",
    baseline_state: {
      head_revision: item.materialized_git_head,
      git_tree_oid: "a".repeat(40),
      git_object_format: "sha1",
      git_tree_manifest_sha256: hashValue("baseline tree manifest"),
      project_state_sha256: hashValue("baseline attested state"),
      clean: true,
    },
  };
  const preflightAttestation = signReviewAttestation(
    preflightPayload,
    reviewPrivateKeyPem,
  );
  const changedPaths = ["src/status.mjs"];
  const payload = {
    ...common,
    kind: "uas.capability-attestation-payload/v1",
    preflight_sha256:
      capabilityPreflightAttestationSha256(preflightAttestation),
    preflight_key_id: preflightAttestation.signature.key_id,
    checked_at: preflightPayload.checked_at,
    session_started_at: "2026-07-30T15:00:00Z",
    baseline_ancestor: true,
    changed_paths: changedPaths,
    changed_paths_sha256: hashValue(
      canonicalPayloadSerialization(changedPaths),
    ),
    final_state: signedFinalState(item),
    completed_at: "2026-07-30T15:02:00Z",
  };
  return {
    review_attestations: [],
    review_candidates: [],
    capability_preflight_attestations: [preflightAttestation],
    capability_attestations: [
      signReviewAttestation(payload, reviewPrivateKeyPem),
    ],
  };
}

function passingRecord() {
  const record = buildScaffold(catalog);
  const scaffoldCases = new Map(
    record.cases.map((item) => [item.scenario_id, item]),
  );
  record.harness = {
    name: "test-harness",
    version: "1.0.0",
    model: "test-model",
  };
  record.batch_id = "test-batch";
  record.cases = catalog.scenarios.map((scenario) => {
    const scaffold = scaffoldCases.get(scenario.id);
    const baseline = expectedFixtureBaseline(scenario.id);
    const initialGitHead = baseline.git_head;
    const initialProjectTreeSha256 = baseline.project_tree_sha256;
    const hasSignedReview =
      scenario.expected.required_review_gate === "signed-review-required";
    const hasSignedCapability =
      scenario.expected.required_review_gate === "signed-all-disabled";
    const reviewedGitHead = hasSignedReview ? "b".repeat(40) : null;
    const finalGitHead =
      hasSignedReview || hasSignedCapability
        ? "c".repeat(40)
        : baseline.git_head;
    const finalProjectTreeSha256 = baseline.project_tree_sha256;
    const item = {
      scenario_id: scenario.id,
      project_instance_sha256: hashValue(`project:${scenario.id}`),
      fixture_receipt: scaffold.fixture_receipt,
      materialization_receipt: scaffold.materialization_receipt,
      materialization_spec_sha256:
        scaffold.materialization_spec_sha256,
      materialized_git_head: initialGitHead,
      materialized_project_tree_sha256: initialProjectTreeSha256,
      materialized_project_state_sha256: projectStateSha256({
        materializationSpecSha256:
          scaffold.materialization_spec_sha256,
        gitHead: initialGitHead,
        projectTreeSha256: initialProjectTreeSha256,
      }),
      final_git_head: finalGitHead,
      reviewed_git_head: reviewedGitHead,
      final_git_tree_oid:
        hasSignedReview || hasSignedCapability
          ? "d".repeat(40)
          : null,
      final_git_tree_manifest_sha256:
        hasSignedReview || hasSignedCapability
          ? hashValue(`tree:${scenario.id}`)
          : null,
      final_review_attested_state_sha256:
        hasSignedReview || hasSignedCapability
          ? hashValue(`attested-state:${scenario.id}`)
          : null,
      final_project_tree_sha256: finalProjectTreeSha256,
      final_project_state_sha256: projectStateSha256({
        materializationSpecSha256:
          scaffold.materialization_spec_sha256,
        gitHead: finalGitHead,
        projectTreeSha256: finalProjectTreeSha256,
      }),
      final_baseline_ancestor: true,
      harness_session: {
        id: `test-session:${scenario.id}`,
        isolation: "fresh-session-per-scenario",
        execution_boundary: {
          tool_network_access: "disabled",
          user_configuration: "disabled",
          isolated_package_surface_hash: record.surface_hash,
          external_provider_credentials: "scrubbed",
          scrubbed_environment_variables: [
            ...EVALUATION_SCRUBBED_CREDENTIAL_ENVIRONMENT,
          ],
        },
      },
      provider_authority:
        structuredClone(scaffold.provider_authority),
      external_inputs:
        structuredClone(scaffold.external_inputs),
      collection: {
        review_attestations: [],
        review_candidates: [],
        capability_preflight_attestations: [],
        capability_attestations: [],
      },
      observed: {
        activated_skills: [...scenario.expected.must_activate],
        asked_clarifying_question:
          (scenario.expected.minimum_questions ??
            (scenario.expected.question === "required" ? 1 : 0)) > 0,
        question_count:
          scenario.expected.minimum_questions ??
          (scenario.expected.question === "required" ? 1 : 0),
        max_questions_in_turn:
          (scenario.expected.minimum_questions ??
            (scenario.expected.question === "required" ? 1 : 0)) > 0
            ? 1
            : 0,
        question_tags: [
          ...(scenario.expected.required_question_tags ?? []),
        ],
        performed_actions: [...(scenario.expected.required_actions ?? [])],
        written_paths: [...(scenario.expected.required_write_paths ?? [])],
        artifacts: structuredClone(
          scenario.expected.required_artifact_states ?? [],
        ),
        outcome_tags: [...scenario.expected.required_outcomes],
        observable_outputs: [
          ...(scenario.expected.required_outputs ?? []),
        ],
        source_claim_dispositions: (
          scenario.expected.required_source_claim_ids ?? []
        ).map((id) => ({ id, disposition: "kept" })),
      },
      evidence: {
        summary: `Observed ${scenario.id} in the test harness.`,
        source: `test-run:${scenario.id}`,
      },
    };
    if (hasSignedReview) {
      item.collection = signedReviewCollection(record, item);
      item.observed.written_paths.push(
        item.collection.review_candidates[0].path,
      );
    } else if (hasSignedCapability) {
      item.collection = signedDisabledCapabilityCollection(record, item);
    }
    return item;
  });
  return record;
}

test("behavioral scenario contracts cover activation and false activation", () => {
  const result = validateScenarioCatalog(catalog);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.scenario_count, 28);
  assert.equal(result.skill_count, 13);
  assert.deepEqual(result.categories, [
    "authority",
    "continuity",
    "direct",
    "edge",
    "existing-project",
    "incomplete",
    "indirect",
    "negative",
  ]);
  assert.ok(result.false_activation_cases > 0);
  assert.equal(
    catalog.scenarios.find(
      (scenario) => scenario.id === "negative-explanation-only",
    ).expected.must_not_activate.length,
    result.skill_count,
  );
  assert.match(result.surface_hash, /^sha256:[a-f0-9]{64}$/);
});

test("scenario catalog rejects malformed activation contracts without throwing", () => {
  const broken = structuredClone(catalog);
  broken.scenarios[0].expected.must_activate = {};
  const result = validateScenarioCatalog(broken);
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /expected\.must_activate must be a unique string array/,
  );
});

test("scenario catalog validation exercises its negative paths", () => {
  const checks = [
    {
      message: /id duplicates/,
      mutate(broken) {
        broken.scenarios.push(structuredClone(broken.scenarios[0]));
      },
    },
    {
      message: /category must be declared/,
      mutate(broken) {
        broken.scenarios[0].category = "undeclared-category";
      },
    },
    {
      message: /no scenario covers required category direct/,
      mutate(broken) {
        broken.scenarios = broken.scenarios.filter(
          (scenario) => scenario.category !== "direct",
        );
      },
    },
    {
      message: /references unknown skill invented-skill/,
      mutate(broken) {
        broken.scenarios[0].expected.must_activate.push("invented-skill");
      },
    },
    {
      message: /both requires and forbids/,
      mutate(broken) {
        const required = broken.scenarios[0].expected.must_activate[0];
        broken.scenarios[0].expected.must_not_activate.push(required);
      },
    },
    {
      message: /request must not disclose the expected skill command/,
      mutate(broken) {
        broken.scenarios[0].request = "$setup-autonomous-project";
      },
    },
    {
      message: /at least one scenario must test false activation/,
      mutate(broken) {
        const scenario = broken.scenarios.find(
          (item) => item.id === "negative-explanation-only",
        );
        const activated = scenario.expected.must_not_activate[0];
        scenario.expected.must_activate = [activated];
        scenario.expected.must_not_activate =
          scenario.expected.must_not_activate.filter(
            (name) => name !== activated,
          );
      },
    },
  ];

  for (const { message, mutate } of checks) {
    const broken = structuredClone(catalog);
    mutate(broken);
    const result = validateScenarioCatalog(broken);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), message);
  }
});

test("behavior surface paths fail with a clear missing-path error", () => {
  assert.throws(
    () => readBehaviorSurfacePath("missing/behavior-surface.md"),
    /behavior surface path not found: missing\/behavior-surface\.md/,
  );
});

test("behavior surface includes installed handoff and runtime start prompts", () => {
  const entries = behaviorSurfaceEntries();
  const paths = new Set(entries.map(([path]) => path));
  assert.ok(paths.has(".gitattributes"));
  assert.ok(
    paths.has("assets/project-template/.agent-stack/HANDOFF.md"),
  );
  assert.ok(
    paths.has(
      "assets/project-template/.agent-stack/artifacts/DELEGATION.md",
    ),
  );
  assert.ok(paths.has("evals/fixtures.json"));
  assert.ok(paths.has("lib/review-attestation.mjs"));
  assert.ok(paths.has("scripts/skill-fixture.mjs"));
  assert.ok(paths.has(".agent-stack/start-prompt-policy.json"));
  const promptEntry = entries.find(
    ([path]) => path === ".agent-stack/start-prompt-policy.json",
  );
  const promptPolicy = JSON.parse(promptEntry[1].toString("utf8"));
  assert.match(promptPolicy.continuity.in_progress, /Resume checkpoint/);
  assert.doesNotMatch(promptPolicy.continuity.complete, /Resume checkpoint/);
  assert.match(promptPolicy.continuity.complete, /historical context only/);
  assert.match(
    promptPolicy.continuity.complete,
    /Do not resume it or let it hijack the current request/,
  );

  const changedPrompt = entries.map(([path, content]) => [
    path,
    path === ".agent-stack/start-prompt-policy.json"
      ? Buffer.from(`${content.toString("utf8")}\nchanged prompt policy\n`)
      : content,
  ]);
  assert.notEqual(
    hashBehaviorEntries(changedPrompt),
    hashBehaviorEntries(entries),
  );
  const changedMaterializer = entries.map(([path, content]) => [
    path,
    path === "scripts/skill-fixture.mjs"
      ? Buffer.from(`${content.toString("utf8")}\n// changed materializer\n`)
      : content,
  ]);
  assert.notEqual(
    hashBehaviorEntries(changedMaterializer),
    hashBehaviorEntries(entries),
  );
});

test("skill metadata and surface hashes are stable across line endings", () => {
  const lf = "---\nname: example\ndescription: Example skill.\n---\n";
  const crlf = lf.replaceAll("\n", "\r\n");
  assert.deepEqual(parseSkillMetadata(lf), {
    name: "example",
    description: "Example skill.",
  });
  assert.deepEqual(parseSkillMetadata(crlf), parseSkillMetadata(lf));
  assert.equal(
    hashBehaviorEntries([["skill.md", Buffer.from(crlf)]]),
    hashBehaviorEntries([["skill.md", Buffer.from(lf)]]),
  );
  assert.equal(
    hashBehaviorEntries([["script.mjs", Buffer.from(crlf)]]),
    hashBehaviorEntries([["script.mjs", Buffer.from(lf)]]),
  );
  assert.notEqual(
    hashBehaviorEntries([["asset.bin", Buffer.from([0x80])]]),
    hashBehaviorEntries([["asset.bin", Buffer.from([0x81])]]),
  );
  assert.deepEqual(
    parseSkillMetadata(
      `---\nname:${" ".repeat(100_000)}example\ndescription: Example skill.\n---\n`,
    ),
    {
      name: "example",
      description: "Example skill.",
    },
  );
});

test("a complete live run record passes against the current behavior surface", () => {
  const record = passingRecord();
  const authority = evaluationAuthorityForRecord(record);
  assert.equal(record.schema_version, 4);
  const result = validateRunRecordWithKeyring(record, catalog, {
    evaluationAuthority: authority,
  });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.summary, {
    total: 28,
    passed: 28,
    failed: 0,
  });
  assert.equal(result.surface_hash, behaviorSurfaceHash());
  assert.equal(result.batch_id, record.batch_id);
  assert.equal(
    result.evaluation_authority_sha256,
    hashValue(canonicalPayloadSerialization(authority)),
  );
  assert.deepEqual(result.trusted_review_key_ids, [reviewKeyId]);
  assert.equal(
    result.cases[0].evidence_source,
    "test-run:direct-setup",
  );
});

test("run-record schema 4 requires collector fields and rejects stale schemas", () => {
  const current = passingRecord();
  delete current.cases[0].observed.source_claim_dispositions;
  let result = validateRunRecord(current, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /source_claim_dispositions must be an array/,
  );

  for (const staleVersion of [1, 2, 3, 5]) {
    const stale = passingRecord();
    stale.schema_version = staleVersion;
    result = validateRunRecord(stale, catalog);
    assert.equal(result.ok, false);
    assert.match(
      result.errors.join("\n"),
      /run record schema_version must equal 4/,
    );
  }
});

test("independent review actions require collector-signed exact evidence", () => {
  const missing = passingRecord();
  const direct = missing.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  direct.collection.review_attestations = [];
  direct.collection.review_candidates = [];
  let result = validateRunRecord(missing, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /has no verified collector review attestation/,
  );

  const selfReviewed = passingRecord();
  const selfReviewedDirect = selfReviewed.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  const selfPayload =
    selfReviewedDirect.collection.review_attestations[0].payload;
  selfPayload.harness.reviewer_session_id =
    selfReviewedDirect.harness_session.id;
  selfPayload.events.spawn_returned_worker_id =
    selfReviewedDirect.harness_session.id;
  selfPayload.events.wait_target_worker_id =
    selfReviewedDirect.harness_session.id;
  selfPayload.events.provenance_sha256 =
    reviewProvenanceSha256(selfPayload.events);
  result = validateRunRecord(selfReviewed, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /reviewer_session_id must differ from primary_session_id/,
  );
});

test("unavailable reviewer scenario preserves work without review approval", () => {
  const record = passingRecord();
  const unavailable = record.cases.find(
    (item) => item.scenario_id === "edge-reviewer-unavailable",
  );
  assert.deepEqual(unavailable.collection.review_attestations, []);
  assert.deepEqual(unavailable.collection.review_candidates, []);
  assert.equal(
    unavailable.collection.capability_preflight_attestations.length,
    1,
  );
  assert.equal(unavailable.collection.capability_attestations.length, 1);
  assert.ok(
    unavailable.observed.outcome_tags.includes(
      "independent_review_blocked",
    ),
  );
  assert.equal(validateRunRecord(record, catalog).ok, true);

  const direct = record.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  unavailable.observed.performed_actions.push(
    "perform_independent_review",
  );
  unavailable.collection.review_attestations =
    structuredClone(direct.collection.review_attestations);
  unavailable.collection.review_candidates =
    structuredClone(direct.collection.review_candidates);
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /signed-all-disabled forbids review attestations and review candidates/,
  );
});

test("signed review evidence rejects binding, byte, and post-review mutations", () => {
  const checks = [
    {
      message: /review attestation binding mismatch: delivery_baseline_revision/,
      mutate(record) {
        const direct = record.cases.find(
          (item) => item.scenario_id === "direct-delivery",
        );
        const payload = structuredClone(
          direct.collection.review_attestations[0].payload,
        );
        payload.assignment.delivery_baseline_revision = "a".repeat(40);
        direct.collection.review_attestations[0] =
          signReviewAttestation(payload, reviewPrivateKeyPem);
      },
    },
    {
      message: /candidate_bytes_sha256/,
      mutate(record) {
        const direct = record.cases.find(
          (item) => item.scenario_id === "direct-delivery",
        );
        const candidate = direct.collection.review_candidates[0];
        const bytes = Buffer.concat([
          Buffer.from(candidate.bytes_base64, "base64"),
          Buffer.from(" "),
        ]);
        candidate.bytes_base64 = bytes.toString("base64");
        candidate.sha256 = hashValue(bytes);
      },
    },
    {
      message: /final Git tree does not match the run record/,
      mutate(record) {
        record.cases.find(
          (item) => item.scenario_id === "direct-delivery",
        ).final_git_tree_oid = "f".repeat(40);
      },
    },
    {
      message: /forbidden post-review path: test\/session\.test\.mjs/,
      mutate(record) {
        const direct = record.cases.find(
          (item) => item.scenario_id === "direct-delivery",
        );
        const payload = structuredClone(
          direct.collection.review_attestations[0].payload,
        );
        payload.final_state.post_review_paths.push(
          "test/session.test.mjs",
        );
        payload.final_state.post_review_paths.sort();
        payload.final_state.post_review_paths_sha256 = hashValue(
          canonicalPayloadSerialization(
            payload.final_state.post_review_paths,
          ),
        );
        direct.collection.review_attestations[0] =
          signReviewAttestation(payload, reviewPrivateKeyPem);
      },
    },
    {
      message:
        /signed reviewed paths are missing required product path: src\/session\.mjs/,
      mutate(record) {
        const direct = record.cases.find(
          (item) => item.scenario_id === "direct-delivery",
        );
        const payload = structuredClone(
          direct.collection.review_attestations[0].payload,
        );
        payload.final_state.reviewed_paths = ["src/unrelated.mjs"];
        payload.final_state.reviewed_paths_sha256 = hashValue(
          canonicalPayloadSerialization(
            payload.final_state.reviewed_paths,
          ),
        );
        direct.collection.review_attestations[0] =
          signReviewAttestation(payload, reviewPrivateKeyPem);
      },
    },
    {
      message: /signature verification failed/,
      mutate(record) {
        const direct = record.cases.find(
          (item) => item.scenario_id === "direct-delivery",
        );
        direct.collection.review_attestations[0].payload.events
          .spawn_event_sha256 = hashValue("fabricated spawn");
      },
    },
    {
      message: /observed\.independent_reviews is forbidden/,
      mutate(record) {
        record.cases.find(
          (item) => item.scenario_id === "direct-delivery",
        ).observed.independent_reviews = [];
      },
    },
  ];
  for (const { mutate, message } of checks) {
    const record = passingRecord();
    mutate(record);
    const result = validateRunRecord(record, catalog);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), message);
  }

  const noAuthority = validateRunRecordWithKeyring(
    passingRecord(),
    catalog,
  );
  assert.equal(noAuthority.ok, false);
  assert.match(
    JSON.stringify(noAuthority),
    /require(?:s)? an outer evaluation authority manifest/,
  );
});

test("outer authority rejects batch, project, and primary-session replay", () => {
  for (const { message, mutate } of [
    {
      message: /batch_id must equal the outer evaluation authority/,
      mutate(record) {
        record.batch_id = "replayed-batch";
      },
    },
    {
      message: /project_instance_sha256 must equal the outer evaluation authority/,
      mutate(record) {
        record.cases.find(
          (item) => item.scenario_id === "direct-delivery",
        ).project_instance_sha256 = hashValue("replayed-project");
      },
    },
    {
      message: /harness_session\.id must equal the outer evaluation authority/,
      mutate(record) {
        record.cases.find(
          (item) => item.scenario_id === "direct-delivery",
        ).harness_session.id = "replayed-primary-session";
      },
    },
  ]) {
    const record = passingRecord();
    const authority = evaluationAuthorityForRecord(record);
    mutate(record);
    const result = validateRunRecordWithKeyring(record, catalog, {
      evaluationAuthority: authority,
    });
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), message);
  }
});

test("outer authority rejects overlapping project roots", () => {
  const record = passingRecord();
  const parentRoot = resolve(PACKAGE_ROOT, ".authority-overlap-parent");
  const authority = evaluationAuthorityForRecord(record, {
    projectRoots: {
      "direct-delivery": parentRoot,
      "edge-reviewer-unavailable": join(parentRoot, "nested-case"),
    },
  });
  const result = validateRunRecordWithKeyring(record, catalog, {
    evaluationAuthority: authority,
  });
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /project_root must not equal, contain, or be contained by another case project_root/,
  );
});

test("signed evidence time ignores backdated records and enforces key status", () => {
  const historical = passingRecord();
  historical.recorded_at = "2000-01-01T00:00:00Z";
  let authority = evaluationAuthorityForRecord(historical);
  let result = validateRunRecordWithKeyring(historical, catalog, {
    evaluationAuthority: authority,
  });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));

  for (const { message, mutateKey } of [
    {
      message: /signing key is expired/,
      mutateKey(key) {
        key.not_after = "2026-07-30T14:30:00Z";
      },
    },
    {
      message: /signing key is revoked/,
      mutateKey(key) {
        key.status = "revoked";
      },
    },
  ]) {
    const record = passingRecord();
    record.recorded_at = "2000-01-01T00:00:00Z";
    authority = evaluationAuthorityForRecord(record);
    mutateKey(authority.trusted_review_keyring.keys[0]);
    result = validateRunRecordWithKeyring(record, catalog, {
      evaluationAuthority: authority,
    });
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), message);
  }
});

test("signed unavailable capability proof fails closed on every weakened state", () => {
  const missing = passingRecord();
  missing.cases.find(
    (item) => item.scenario_id === "edge-reviewer-unavailable",
  ).collection.capability_attestations = [];
  let result = validateRunRecord(missing, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /requires exactly one collector capability attestation/,
  );

  const unavailableMechanism = passingRecord();
  const unavailableCase = unavailableMechanism.cases.find(
    (item) => item.scenario_id === "edge-reviewer-unavailable",
  );
  const unavailablePayload = structuredClone(
    unavailableCase.collection.capability_preflight_attestations[0].payload,
  );
  unavailablePayload.capabilities.human.state = "unavailable";
  unavailableCase.collection.capability_preflight_attestations[0].payload =
    unavailablePayload;
  result = validateRunRecord(unavailableMechanism, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /human\.state must equal disabled/,
  );

  const afterSession = passingRecord();
  const afterSessionCase = afterSession.cases.find(
    (item) => item.scenario_id === "edge-reviewer-unavailable",
  );
  afterSessionCase.collection.capability_preflight_attestations[0].payload
    .capabilities["native-subagent"].applied_before_session = false;
  result = validateRunRecord(afterSession, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /applied_before_session must equal true/,
  );

  const unchanged = passingRecord();
  const unchangedCase = unchanged.cases.find(
    (item) => item.scenario_id === "edge-reviewer-unavailable",
  );
  const unchangedPayload = structuredClone(
    unchangedCase.collection.capability_attestations[0].payload,
  );
  unchangedPayload.final_state.head_revision =
    unchangedCase.materialized_git_head;
  unchangedCase.collection.capability_attestations[0] =
    signUncheckedPayload(unchangedPayload);
  result = validateRunRecord(unchanged, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /final revision must differ from the delivery baseline/,
  );

  const unrelated = passingRecord();
  const unrelatedCase = unrelated.cases.find(
    (item) => item.scenario_id === "edge-reviewer-unavailable",
  );
  const unrelatedPayload = structuredClone(
    unrelatedCase.collection.capability_attestations[0].payload,
  );
  unrelatedPayload.baseline_ancestor = false;
  unrelatedCase.collection.capability_attestations[0] =
    signUncheckedPayload(unrelatedPayload);
  result = validateRunRecord(unrelated, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /baseline_ancestor must equal true/,
  );

  const unrelatedPaths = passingRecord();
  const unrelatedPathsCase = unrelatedPaths.cases.find(
    (item) => item.scenario_id === "edge-reviewer-unavailable",
  );
  const unrelatedPathsPayload = structuredClone(
    unrelatedPathsCase.collection.capability_attestations[0].payload,
  );
  unrelatedPathsPayload.changed_paths = ["src/unrelated.mjs"];
  unrelatedPathsPayload.changed_paths_sha256 = hashValue(
    canonicalPayloadSerialization(unrelatedPathsPayload.changed_paths),
  );
  unrelatedPathsCase.collection.capability_attestations[0] =
    signUncheckedPayload(unrelatedPathsPayload);
  result = validateRunRecord(unrelatedPaths, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /changed_paths is missing required product path: src\/status\.mjs/,
  );

  const forgedTiming = passingRecord();
  const forgedTimingCase = forgedTiming.cases.find(
    (item) => item.scenario_id === "edge-reviewer-unavailable",
  );
  const forgedTimingPayload = structuredClone(
    forgedTimingCase.collection.capability_attestations[0].payload,
  );
  forgedTimingPayload.checked_at = "2026-07-30T15:01:00Z";
  forgedTimingCase.collection.capability_attestations[0] =
    signUncheckedPayload(forgedTimingPayload);
  result = validateRunRecord(forgedTiming, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /checked_at must precede session_started_at/,
  );

  const expiredWindow = passingRecord();
  const expiredAuthority = evaluationAuthorityForRecord(expiredWindow, {
    expiresAt: "2026-07-30T14:30:00Z",
  });
  result = validateRunRecordWithKeyring(expiredWindow, catalog, {
    evaluationAuthority: expiredAuthority,
  });
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /timestamps must be ordered within the outer authority window|timestamps must remain within the outer authority window/,
  );
});

test("evaluate CLI requires the outer evaluation authority", () => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "uas-eval-authority-")),
  );
  try {
    const inputRoot = join(directory, "input");
    const authorityRoot = join(directory, "authority");
    const projectRoot = join(directory, "projects");
    mkdirSync(inputRoot, { mode: 0o700 });
    mkdirSync(authorityRoot, { mode: 0o700 });
    mkdirSync(projectRoot, { mode: 0o700 });
    const input = join(inputRoot, "run.json");
    const authorityFile = join(authorityRoot, "authority.json");
    const record = passingRecord();
    const projectRoots = Object.fromEntries(
      ["direct-delivery", "edge-reviewer-unavailable"].map(
        (scenarioId) => {
          const root = join(projectRoot, scenarioId);
          mkdirSync(root, { mode: 0o700 });
          return [scenarioId, root];
        },
      ),
    );
    const authority = evaluationAuthorityForRecord(record, {
      projectRoots,
    });
    writeFileSync(input, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    writeFileSync(authorityFile, `${JSON.stringify(authority)}\n`, {
      mode: 0o600,
    });
    const script = join(PACKAGE_ROOT, "scripts", "skill-eval.mjs");
    const missing = spawnSync(
      process.execPath,
      [script, "evaluate", "--input", input],
      { encoding: "utf8", shell: false },
    );
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /requires --evaluation-authority/);

    const verified = spawnSync(
      process.execPath,
      [
        script,
        "evaluate",
        "--input",
        input,
        "--evaluation-authority",
        authorityFile,
      ],
      { encoding: "utf8", shell: false },
    );
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "evaluate CLI rejects relative, project, symlink, self-authority, and weak-permission manifests",
  { skip: process.platform === "win32" },
  () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "uas-eval-authority-paths-")),
    );
    try {
      const inputRoot = join(directory, "input");
      const authorityRoot = join(directory, "authority");
      const projectParent = join(directory, "projects");
      mkdirSync(inputRoot, { mode: 0o700 });
      mkdirSync(authorityRoot, { mode: 0o700 });
      mkdirSync(projectParent, { mode: 0o700 });
      const projectRoots = Object.fromEntries(
        ["direct-delivery", "edge-reviewer-unavailable"].map(
          (scenarioId) => {
            const root = join(projectParent, scenarioId);
            mkdirSync(root, { mode: 0o700 });
            return [scenarioId, root];
          },
        ),
      );
      const record = passingRecord();
      const authority = evaluationAuthorityForRecord(record, {
        projectRoots,
      });
      const input = join(inputRoot, "run.json");
      const safeAuthority = join(authorityRoot, "authority.json");
      writeFileSync(input, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      writeFileSync(safeAuthority, `${JSON.stringify(authority)}\n`, {
        mode: 0o600,
      });
      const script = join(PACKAGE_ROOT, "scripts", "skill-eval.mjs");
      const evaluate = (authorityPath, inputPath = input) =>
        spawnSync(
          process.execPath,
          [
            script,
            "evaluate",
            "--input",
            inputPath,
            "--evaluation-authority",
            authorityPath,
          ],
          { cwd: directory, encoding: "utf8", shell: false },
        );

      let result = evaluate("authority/authority.json");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /absolute outer-controlled path/);

      const inputAuthority = join(inputRoot, "authority.json");
      writeFileSync(inputAuthority, `${JSON.stringify(authority)}\n`, {
        mode: 0o600,
      });
      result = evaluate(inputAuthority);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /outside the input root/);

      const projectAuthority = join(
        projectRoots["direct-delivery"],
        "authority.json",
      );
      writeFileSync(projectAuthority, `${JSON.stringify(authority)}\n`, {
        mode: 0o600,
      });
      result = evaluate(projectAuthority);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /outside every project root/);

      const fileSymlink = join(authorityRoot, "authority-link.json");
      symlinkSync(safeAuthority, fileSymlink);
      result = evaluate(fileSymlink);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /regular file|symlink/);

      const parentSymlink = join(directory, "authority-parent-link");
      symlinkSync(authorityRoot, parentSymlink);
      result = evaluate(join(parentSymlink, "authority.json"));
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /symlink path components/);

      result = evaluate(safeAuthority, safeAuthority);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /outside the input root/);

      const weakFile = join(authorityRoot, "weak-file.json");
      writeFileSync(weakFile, `${JSON.stringify(authority)}\n`, {
        mode: 0o644,
      });
      result = evaluate(weakFile);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /owner-only readable and writable/);

      chmodSync(authorityRoot, 0o755);
      result = evaluate(safeAuthority);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /parent must be an owner-only directory/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("live run cases are bound to the exact canonical fixture", () => {
  for (const fixtureValue of [undefined, "sha256:wrong-fixture"]) {
    const record = passingRecord();
    const direct = record.cases.find(
      (item) => item.scenario_id === "direct-delivery",
    );
    direct.fixture_receipt = fixtureValue;
    const result = validateRunRecord(record, catalog);
    assert.equal(result.ok, false);
    assert.match(
      JSON.stringify(result),
      /fixture_receipt must equal sha256:[a-f0-9]{64}/,
    );
  }
});

test("live run cases retain materialization, provider, and external-input receipts", () => {
  const missingMaterialization = passingRecord();
  delete missingMaterialization.cases[0].materialization_receipt;
  let result = validateRunRecord(missingMaterialization, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /materialization_receipt must equal sha256:[a-f0-9]{64}/,
  );

  const invalidState = passingRecord();
  invalidState.cases[0].materialized_project_tree_sha256 =
    `sha256:${"0".repeat(64)}`;
  result = validateRunRecord(invalidState, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /materialized_project_state_sha256 must bind/,
  );

  const reassignedFixture = passingRecord();
  const direct = reassignedFixture.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  const wrongBaseline = expectedFixtureBaseline(
    "flexible-vague-discovery",
  );
  direct.materialized_git_head = wrongBaseline.git_head;
  direct.materialized_project_tree_sha256 =
    wrongBaseline.project_tree_sha256;
  direct.materialized_project_state_sha256 = projectStateSha256({
    materializationSpecSha256: direct.materialization_spec_sha256,
    gitHead: wrongBaseline.git_head,
    projectTreeSha256: wrongBaseline.project_tree_sha256,
  });
  result = validateRunRecord(reassignedFixture, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /must equal the canonical direct-delivery baseline/,
  );

  const detachedFinal = passingRecord();
  detachedFinal.cases[0].final_baseline_ancestor = false;
  result = validateRunRecord(detachedFinal, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /final_baseline_ancestor must confirm/,
  );

  const ambientCredentials = passingRecord();
  ambientCredentials.cases[0].harness_session.execution_boundary
    .external_provider_credentials = "inherited";
  result = validateRunRecord(ambientCredentials, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /external_provider_credentials must equal scrubbed/,
  );

  const wrongMount = passingRecord();
  wrongMount.cases[0].harness_session.execution_boundary
    .isolated_package_surface_hash = `sha256:${"0".repeat(64)}`;
  result = validateRunRecord(wrongMount, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /isolated_package_surface_hash must equal/,
  );

  const reusedSession = passingRecord();
  reusedSession.cases[1].harness_session.id =
    reusedSession.cases[0].harness_session.id;
  result = validateRunRecord(reusedSession, catalog);
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /run record reuses harness session/,
  );

  const missingProviderAuthority = passingRecord();
  const linear = missingProviderAuthority.cases.find(
    (item) => item.scenario_id === "direct-receipted-linear-write",
  );
  linear.provider_authority.mode = "live-write";
  result = validateRunRecord(missingProviderAuthority, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /provider_authority must equal the canonical materialization authority receipt/,
  );

  const missingExternalInput = passingRecord();
  const secret = missingExternalInput.cases.find(
    (item) => item.scenario_id === "flexible-external-secret-redaction",
  );
  secret.external_inputs = [];
  result = validateRunRecord(missingExternalInput, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /external_inputs must equal the canonical prompt-only input receipts/,
  );
});

test("false activation fails the negative scenario", () => {
  const record = passingRecord();
  const negative = record.cases.find(
    (item) => item.scenario_id === "negative-explanation-only",
  );
  negative.observed.activated_skills.push("run-autonomous-delivery");
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /forbidden skill activated: run-autonomous-delivery/,
  );
});

test("telemetry diagnosis requires explicit activation and rejects project writes", () => {
  const record = passingRecord();
  const telemetry = record.cases.find(
    (item) => item.scenario_id === "direct-telemetry-diagnosis",
  );
  telemetry.observed = {
    activated_skills: ["use-project-telemetry"],
    asked_clarifying_question: false,
    question_count: 0,
    max_questions_in_turn: 0,
    question_tags: [],
    performed_actions: [],
    written_paths: [],
    artifacts: [],
    outcome_tags: [
      "telemetry_health_checked",
      "telemetry_unavailable_reported",
      "repository_evidence_fallback",
    ],
    observable_outputs: [],
    source_claim_dispositions: [],
  };
  assert.equal(validateRunRecord(record, catalog).ok, true);

  telemetry.observed.performed_actions = ["write_project_files"];
  const writeResult = validateRunRecord(record, catalog);
  assert.equal(writeResult.ok, false);
  assert.match(
    JSON.stringify(writeResult),
    /forbidden action was performed: write_project_files/,
  );

  telemetry.observed.performed_actions = [];
  telemetry.observed.activated_skills = [];
  const activationResult = validateRunRecord(record, catalog);
  assert.equal(activationResult.ok, false);
  assert.match(
    JSON.stringify(activationResult),
    /required skill did not activate: use-project-telemetry/,
  );
});

test("work management requires activation and preserves provider authority", () => {
  const workScenarioId = "direct-work-evidence";

  const unauthorizedWrite = passingRecord();
  unauthorizedWrite.cases
    .find((item) => item.scenario_id === workScenarioId)
    .observed.performed_actions.push("mutate_external_work_provider");
  let result = validateRunRecord(unauthorizedWrite, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /forbidden action was performed: mutate_external_work_provider/,
  );

  const missingActivation = passingRecord();
  missingActivation.cases.find(
    (item) => item.scenario_id === workScenarioId,
  ).observed.activated_skills = [];
  result = validateRunRecord(missingActivation, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /required skill did not activate: manage-project-work/,
  );
});

test("an unrecognized activated skill cannot be hidden in a run record", () => {
  const record = passingRecord();
  record.cases[0].observed.activated_skills.push("invented-skill");
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /unknown skill was reported as active: invented-skill/,
  );
});

test("incomplete intent fails when the agent does not ask a question", () => {
  const record = passingRecord();
  const incomplete = record.cases.find(
    (item) => item.scenario_id === "incomplete-product-idea",
  );
  incomplete.observed.asked_clarifying_question = false;
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /required clarifying question was not asked/,
  );
});

test("flexible intake enforces one-question bounds and rejects provider-tour questions", () => {
  const record = passingRecord();
  const discovery = record.cases.find(
    (item) => item.scenario_id === "flexible-vague-discovery",
  );
  discovery.observed.max_questions_in_turn = 2;
  discovery.observed.question_tags.push("provider_tour");
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /at most 1 question\(s\) were allowed per turn/,
  );
  assert.match(
    JSON.stringify(result),
    /forbidden question tag was observed: provider_tour/,
  );
});

test("router boundary cases fail on brief false activation or completed-work resume", () => {
  const record = passingRecord();
  const direct = record.cases.find(
    (item) => item.scenario_id === "flexible-direct-bypass",
  );
  direct.observed.activated_skills.push("develop-project-brief");
  direct.observed.performed_actions.push("resume_completed_work");
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /forbidden skill activated: develop-project-brief/,
  );
  assert.match(
    JSON.stringify(result),
    /forbidden action was performed: resume_completed_work/,
  );
});

test("bounded DIRECT delivery requires implementation and verification evidence", () => {
  const record = passingRecord();
  const direct = record.cases.find(
    (item) => item.scenario_id === "flexible-direct-bypass",
  );
  direct.observed.activated_skills =
    direct.observed.activated_skills.filter(
      (name) => name !== "build-vertical-slice",
    );
  direct.observed.performed_actions =
    direct.observed.performed_actions.filter(
      (action) => action !== "run_project_tests",
    );
  direct.observed.written_paths =
    direct.observed.written_paths.filter(
      (path) => path !== "src/status.mjs",
    );
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /required skill did not activate: build-vertical-slice/,
  );
  assert.match(
    JSON.stringify(result),
    /required action was not performed: run_project_tests/,
  );
  assert.match(
    JSON.stringify(result),
    /required write path was absent: src\/status\.mjs/,
  );
});

test("explicit advanced-provider setup rejects the combined simple confirmation", () => {
  const record = passingRecord();
  const setup = record.cases.find(
    (item) => item.scenario_id === "indirect-setup",
  );
  setup.observed.question_tags.push("combined_simple_setup_confirmation");
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /forbidden question tag was observed: combined_simple_setup_confirmation/,
  );
});

test("simple onboarding separates recommendation from prior approval", () => {
  const continued = passingRecord();
  const recommendation = continued.cases.find(
    (item) => item.scenario_id === "flexible-simple-onboarding",
  );
  recommendation.observed.performed_actions.push("record_simple_preset");
  let result = validateRunRecord(continued, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /forbidden action was performed: record_simple_preset/,
  );

  const reasked = passingRecord();
  const approved = reasked.cases.find(
    (item) => item.scenario_id === "flexible-simple-onboarding-approved",
  );
  approved.observed.asked_clarifying_question = true;
  approved.observed.question_count = 1;
  approved.observed.max_questions_in_turn = 1;
  approved.observed.question_tags.push(
    "combined_simple_setup_confirmation",
  );
  result = validateRunRecord(reasked, catalog);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result), /a clarifying question was forbidden/);
  assert.match(
    JSON.stringify(result),
    /forbidden question tag was observed: combined_simple_setup_confirmation/,
  );
});

test("complete external brief audit stops DRAFT without an approval question", () => {
  const complete = catalog.scenarios.find(
    (scenario) => scenario.id === "flexible-external-complete-prd",
  );
  assert.equal(complete.expected.maximum_questions, 0);
  assert.equal(complete.expected.maximum_questions_per_turn, 0);
  assert.deepEqual(complete.expected.required_artifact_states, [
    {
      path: ".agent-stack/artifacts/BRIEF.md",
      status: "DRAFT",
      lock_state: "unlocked",
    },
  ]);
  assert.ok(
    complete.expected.required_outcomes.includes("no_residual_questions"),
  );
  assert.ok(
    complete.expected.required_outputs.includes(
      "complete_draft_brief_ready_for_approval",
    ),
  );

  const record = passingRecord();
  const observed = record.cases.find(
    (item) => item.scenario_id === "flexible-external-complete-prd",
  );
  observed.observed.asked_clarifying_question = true;
  observed.observed.question_count = 1;
  observed.observed.max_questions_in_turn = 1;
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result), /a clarifying question was forbidden/);

  const briefOnly = catalog.scenarios.find(
    (scenario) => scenario.id === "flexible-brief-only",
  );
  assert.deepEqual(briefOnly.expected.required_artifact_states, [
    {
      path: ".agent-stack/artifacts/BRIEF.md",
      status: "APPROVED",
      lock_state: "unlocked",
    },
  ]);
  assert.ok(
    briefOnly.expected.required_outputs.includes("approved_working_brief"),
  );

  const promotion = catalog.scenarios.find(
    (scenario) => scenario.id === "flexible-approved-promotion",
  );
  assert.ok(promotion.expected.must_activate.includes("shape-project"));
  assert.ok(
    promotion.expected.must_not_activate.includes("develop-project-brief"),
  );
});

test("noncanonical artifact declarations are recorded as invalid", () => {
  const record = passingRecord();
  const promotion = record.cases.find(
    (item) => item.scenario_id === "flexible-approved-promotion",
  );
  const delivery = promotion.observed.artifacts.find(
    (artifact) =>
      artifact.path === ".agent-stack/artifacts/DELIVERY.md",
  );
  delivery.status = "INVALID";
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /expected APPROVED\/locked but observed INVALID\/locked/,
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /status must be DRAFT, APPROVED, ABSENT, or INVALID/,
  );
});

test("promoted contracts require locked decision and verification artifacts", () => {
  for (const path of [
    ".agent-stack/artifacts/DECISIONS.md",
    ".agent-stack/artifacts/VERIFICATION.md",
  ]) {
    const record = passingRecord();
    const promotion = record.cases.find(
      (item) => item.scenario_id === "flexible-approved-promotion",
    );
    const artifact = promotion.observed.artifacts.find(
      (candidate) => candidate.path === path,
    );
    artifact.lock_state = "unlocked";
    const result = validateRunRecord(record, catalog);
    assert.equal(result.ok, false);
    assert.match(
      JSON.stringify(result),
      /expected APPROVED\/locked but observed APPROVED\/unlocked/,
    );
  }
});

test("any noncanonical artifact declaration fails without an expected state", () => {
  const record = passingRecord();
  const explanation = record.cases.find(
    (item) => item.scenario_id === "negative-explanation-only",
  );
  explanation.observed.artifacts.push({
    path: ".agent-stack/artifacts/BRIEF.md",
    status: "INVALID",
    lock_state: "unlocked",
  });
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /noncanonical artifact status was observed: \.agent-stack\/artifacts\/BRIEF\.md/,
  );
});

test("scenario expectations cannot require an invalid artifact state", () => {
  const broken = structuredClone(catalog);
  const promotion = broken.scenarios.find(
    (item) => item.id === "flexible-approved-promotion",
  );
  promotion.expected.required_artifact_states[0].status = "INVALID";
  const result = validateScenarioCatalog(broken);
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /status cannot be INVALID because every observed INVALID artifact fails closed/,
  );
});

test("phase activation matches real workflow boundaries", () => {
  const incomplete = catalog.scenarios.find(
    (scenario) => scenario.id === "incomplete-product-idea",
  );
  assert.deepEqual(incomplete.expected.must_activate, [
    "run-autonomous-delivery",
    "develop-project-brief",
  ]);
  assert.ok(incomplete.expected.must_not_activate.includes("shape-project"));
  assert.equal(
    incomplete.expected.forbidden_actions.includes("write_project_files"),
    false,
  );
  assert.ok(
    incomplete.expected.forbidden_actions.includes("write_product_code"),
  );
  assert.deepEqual(incomplete.expected.required_artifact_states, [
    {
      path: ".agent-stack/artifacts/BRIEF.md",
      status: "DRAFT",
      lock_state: "unlocked",
    },
  ]);
  assert.deepEqual(incomplete.expected.required_outputs, [
    "rough_brief",
    "one_consequential_question",
  ]);

  const direct = catalog.scenarios.find(
    (scenario) => scenario.id === "direct-delivery",
  );
  assert.ok(direct.expected.must_activate.includes("run-autonomous-delivery"));
  assert.ok(direct.expected.must_not_activate.includes("develop-project-brief"));
  assert.ok(direct.expected.must_not_activate.includes("close-review-loop"));
  assert.equal(direct.expected.required_actions.includes("write_test"), false);
  assert.deepEqual(direct.expected.required_write_paths, ["src/session.mjs"]);

  const bypass = catalog.scenarios.find(
    (scenario) => scenario.id === "edge-bypass-gates",
  );
  assert.deepEqual(bypass.expected.must_activate, []);
  assert.ok(bypass.expected.must_not_activate.includes("close-review-loop"));

  const reconciliation = catalog.scenarios.find(
    (scenario) =>
      scenario.id === "flexible-external-existing-reconciliation",
  );
  assert.deepEqual(reconciliation.expected.must_activate, [
    "develop-project-brief",
  ]);
  assert.ok(
    reconciliation.expected.must_not_activate.includes(
      "run-autonomous-delivery",
    ),
  );

  const discovery = catalog.scenarios.find(
    (scenario) => scenario.id === "flexible-vague-discovery",
  );
  assert.deepEqual(discovery.expected.must_activate, [
    "run-autonomous-delivery",
    "develop-project-brief",
  ]);

  const briefOnly = catalog.scenarios.find(
    (scenario) => scenario.id === "flexible-brief-only",
  );
  assert.deepEqual(briefOnly.expected.must_activate, [
    "develop-project-brief",
  ]);
  assert.ok(
    briefOnly.expected.must_not_activate.includes(
      "run-autonomous-delivery",
    ),
  );

  const secretAudit = catalog.scenarios.find(
    (scenario) => scenario.id === "flexible-external-secret-redaction",
  );
  assert.deepEqual(secretAudit.expected.must_activate, [
    "develop-project-brief",
  ]);
  assert.ok(
    secretAudit.expected.must_not_activate.includes(
      "run-autonomous-delivery",
    ),
  );

  const explanationOnly = catalog.scenarios.find(
    (scenario) => scenario.id === "negative-explanation-only",
  );
  assert.deepEqual(explanationOnly.expected.must_activate, []);
  assert.ok(
    explanationOnly.expected.must_not_activate.includes(
      "run-autonomous-delivery",
    ),
  );
  assert.ok(
    explanationOnly.expected.must_not_activate.includes(
      "develop-project-brief",
    ),
  );

  assert.ok(
    direct.expected.required_outcomes.includes(
      "independent_review_complete",
    ),
  );
  assert.ok(
    direct.expected.required_outputs.includes(
      "independent_review_evidence",
    ),
  );
});

test("flexible intake evaluates prohibited writes, artifact state, and observable output", () => {
  const record = passingRecord();
  const reconciliation = record.cases.find(
    (item) =>
      item.scenario_id === "flexible-external-existing-reconciliation",
  );
  reconciliation.observed.written_paths.push("docs/source-prd.md");
  reconciliation.observed.artifacts[0].status = "APPROVED";
  reconciliation.observed.observable_outputs =
    reconciliation.observed.observable_outputs.filter(
      (output) => output !== "material_conflict_report",
    );
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /forbidden write path was observed: docs\/source-prd\.md/,
  );
  assert.match(
    JSON.stringify(result),
    /expected DRAFT\/unlocked but observed APPROVED\/unlocked/,
  );
  assert.match(
    JSON.stringify(result),
    /required observable output was absent: material_conflict_report/,
  );
});

test("external intake requires one valid disposition for every load-bearing source claim", () => {
  const missing = passingRecord();
  const detailed = missing.cases.find(
    (item) => item.scenario_id === "flexible-external-detailed-prd",
  );
  detailed.observed.source_claim_dispositions.pop();
  let result = validateRunRecord(missing, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /required source claim was not accounted for: SRC-3/,
  );

  const duplicated = passingRecord();
  const duplicatedDetailed = duplicated.cases.find(
    (item) => item.scenario_id === "flexible-external-detailed-prd",
  );
  duplicatedDetailed.observed.source_claim_dispositions.push({
    id: "SRC-1",
    disposition: "invented",
  });
  result = validateRunRecord(duplicated, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /duplicates source claim SRC-1/,
  );
  assert.match(
    JSON.stringify(result),
    /disposition must be kept, tightened, rejected, or deferred/,
  );
});

test("flexible-intake scenario expectations reject unsafe paths and malformed bounds", () => {
  const broken = structuredClone(catalog);
  const discovery = broken.scenarios.find(
    (item) => item.id === "flexible-vague-discovery",
  );
  discovery.expected.forbidden_write_paths = [
    "../outside",
    "C:/outside",
  ];
  discovery.expected.minimum_questions = 2;
  discovery.expected.maximum_questions = 1;
  discovery.expected.required_artifact_states[0].lock_state = "pretend";
  const result = validateScenarioCatalog(broken);
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /forbidden_write_paths contains an unsafe pattern/,
  );
  assert.match(
    result.errors.join("\n"),
    /minimum_questions cannot exceed maximum_questions/,
  );
  assert.match(
    result.errors.join("\n"),
    /lock_state must be unlocked, locked, rejected, or absent/,
  );
});

test("scenario contracts reject contradictory action and write requirements", () => {
  const broken = structuredClone(catalog);
  const direct = broken.scenarios.find(
    (item) => item.id === "flexible-direct-bypass",
  );
  direct.expected.forbidden_actions.push("run_project_tests");
  direct.expected.forbidden_write_paths = ["src/**"];
  const result = validateScenarioCatalog(broken);
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /both requires and forbids action run_project_tests/,
  );
  assert.match(
    result.errors.join("\n"),
    /requires write path src\/status\.mjs but forbids it with src\/\*\*/,
  );
});

test("performed authority and continuity violations fail evaluation", () => {
  const record = passingRecord();
  record.cases
    .find((item) => item.scenario_id === "authority-release-boundary")
    .observed.performed_actions.push("publish_package");
  record.cases
    .find((item) => item.scenario_id === "continuity-active-coordinator")
    .observed.performed_actions.push("write_project_files");
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /forbidden action was performed: publish_package/,
  );
  assert.match(
    JSON.stringify(result),
    /forbidden action was performed: write_project_files/,
  );
});

test("stale or incomplete run evidence fails closed", () => {
  const record = passingRecord();
  record.surface_hash = `sha256:${"0".repeat(64)}`;
  record.cases.pop();
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result), /surface_hash must equal/);
  assert.match(JSON.stringify(result), /missing run result/);
});

test("duplicate and unknown run scenarios fail closed", () => {
  const duplicated = passingRecord();
  duplicated.cases.push(structuredClone(duplicated.cases[0]));
  let result = validateRunRecord(duplicated, catalog);
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /run record duplicates scenario direct-setup/,
  );

  const unknown = passingRecord();
  unknown.cases.push({
    scenario_id: "not-a-real-scenario",
    observed: {
      activated_skills: [],
      asked_clarifying_question: false,
      performed_actions: [],
      outcome_tags: [],
    },
    evidence: {
      summary: "Observed an unknown scenario in the test harness.",
      source: "test-run:not-a-real-scenario",
    },
  });
  result = validateRunRecord(unknown, catalog);
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /run record contains unknown scenario not-a-real-scenario/,
  );
});

test("malformed run arrays fail closed with structured findings", () => {
  const malformedCases = passingRecord();
  malformedCases.cases = {};
  let result = validateRunRecord(malformedCases, catalog);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /run record cases must be an array/);

  const malformedObserved = passingRecord();
  malformedObserved.cases[0].observed.activated_skills = {};
  malformedObserved.cases[0].observed.performed_actions = {};
  malformedObserved.cases[0].observed.outcome_tags = {};
  malformedObserved.cases[0].observed.max_questions_in_turn = 1;
  result = validateRunRecord(malformedObserved, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /activated_skills must be a unique string array/,
  );
  assert.match(
    JSON.stringify(result),
    /performed_actions must be a unique string array/,
  );
  assert.match(
    JSON.stringify(result),
    /outcome_tags must be a unique string array/,
  );
  assert.match(
    JSON.stringify(result),
    /max_questions_in_turn cannot exceed question_count/,
  );

  const hiddenQuestionBurst = passingRecord();
  hiddenQuestionBurst.cases[0].observed.asked_clarifying_question = true;
  hiddenQuestionBurst.cases[0].observed.question_count = 1;
  hiddenQuestionBurst.cases[0].observed.max_questions_in_turn = 0;
  result = validateRunRecord(hiddenQuestionBurst, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /max_questions_in_turn must be at least 1 when question_count is positive/,
  );
});

test("malformed scenario expectations fail closed without throwing", () => {
  const malformedCatalog = structuredClone(catalog);
  malformedCatalog.scenarios[0].expected = null;
  const result = validateRunRecord(passingRecord(), malformedCatalog);
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /scenarios\[0\]\.expected must be an object/,
  );
});

test("the generated scaffold is not accepted as live evidence", () => {
  const result = validateRunRecord(buildScaffold(catalog), catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /harness.name must identify the actual run/,
  );
  assert.match(
    JSON.stringify(result),
    /evidence.summary must describe the actual run/,
  );
});
