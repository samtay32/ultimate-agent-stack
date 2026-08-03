import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  behaviorSurfaceEntries,
  behaviorSurfaceHash,
  buildScaffold,
  hashBehaviorEntries,
  parseSkillMetadata,
  readBehaviorSurfacePath,
  sanitizeEvidenceText,
  summarizeRoutingRates,
  validateRunRecord,
  validateScenarioCatalog,
} from "../scripts/skill-eval.mjs";
import {
  EVALUATION_SCRUBBED_CREDENTIAL_ENVIRONMENT,
  expectedFixtureBaseline,
  projectStateSha256,
} from "../scripts/skill-fixture.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const catalog = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "evals", "scenarios.json"), "utf8"),
);
const COORDINATOR_TOKEN = "0123456789abcdef".repeat(4);
const NORMAL_HASH = "fedcba9876543210".repeat(4);

function stableJson(value) {
  if (Array.isArray(value)) {
    return value.map(stableJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJson(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(stableJson(value))).digest("hex");
}

function activationReceipt(scenario, skill) {
  const receipt = {
    id: "",
    skill,
    mode: "file-read",
    harness: "test-harness",
    model: "test-model",
    run_id: `test-run:${scenario.id}`,
    event_id: `activation:${scenario.id}:${skill}`,
    recorded_at: "2026-01-01T00:00:00Z",
    skill_path: `.agents/skills/${skill}/SKILL.md`,
    skill_sha256: createHash("sha256")
      .update(readFileSync(join(PACKAGE_ROOT, "skills", skill, "SKILL.md")))
      .digest("hex"),
    claim: "agent-recorded",
  };
  receipt.id = `skill-activation-${sha256({
    harness: receipt.harness,
    model: receipt.model,
    run_id: receipt.run_id,
    event_id: receipt.event_id,
  }).slice(0, 20)}`;
  receipt.receipt_sha256 = sha256(receipt);
  return receipt;
}

function reviewEvidence(
  scenario,
  gitCommit,
  { result = "passed", reviewerId = `reviewer:${scenario.id}` } = {},
) {
  const receipt = {
    schema_version: 1,
    receipt_id: "",
    run_id: `test-run:${scenario.id}`,
    git_commit: gitCommit,
    git_object_format: gitCommit.length === 64 ? "sha256" : "sha1",
    coordinator_id: "coordinator:test-run",
    reviewer_kind: "independent-reviewer",
    reviewer_id: reviewerId,
    result,
    result_file: `.agent-stack/runs/reviews/${scenario.id}-${result}.json`,
    result_file_sha256: "",
    recorded_at: "2026-01-01T00:00:00Z",
    claim: "agent-recorded",
  };
  const artifact = {
    schema_version: 1,
    run_id: receipt.run_id,
    git_commit: receipt.git_commit,
    reviewer_kind: receipt.reviewer_kind,
    reviewer_id: receipt.reviewer_id,
    result: receipt.result,
    summary: "The bounded reviewer result is structurally inspectable.",
    findings:
      receipt.result === "passed" ? [] : ["A bounded change is required."],
    reviewed_at: "2026-01-01T00:00:00Z",
  };
  const artifactContent = `${JSON.stringify(artifact)}\n`;
  const artifactBytes = Buffer.from(artifactContent, "utf8");
  receipt.result_file_sha256 = `sha256:${createHash("sha256")
    .update(artifactBytes)
    .digest("hex")}`;
  const body = { ...receipt };
  delete body.receipt_id;
  receipt.receipt_id = sha256(body);
  return {
    receipt,
    artifact: {
      path: receipt.result_file,
      content: artifactContent,
    },
  };
}

function evaluateRecord(record, catalogValue = catalog) {
  return validateRunRecord(record, catalogValue);
}

function evaluateRoutingRates(records, catalogValue = catalog) {
  return summarizeRoutingRates(records, catalogValue);
}

function rewriteReviewerResultArtifact(
  caseItem,
  receipt,
  mutate,
  { raw, refreshReceipt = true } = {},
) {
  const snapshot = caseItem.observed.review_result_artifacts.find(
    (entry) => entry.path === receipt.result_file,
  );
  assert.ok(snapshot, `missing snapshot for ${receipt.result_file}`);
  const bytes = raw ?? (() => {
    const artifact = JSON.parse(snapshot.content);
    mutate(artifact);
    return Buffer.from(`${JSON.stringify(artifact)}\n`);
  })();
  snapshot.content = Buffer.isBuffer(bytes)
    ? bytes.toString("utf8")
    : String(bytes);
  if (!refreshReceipt) {
    return;
  }
  receipt.result_file_sha256 = `sha256:${createHash("sha256")
    .update(Buffer.from(snapshot.content, "utf8"))
    .digest("hex")}`;
  const body = { ...receipt };
  delete body.receipt_id;
  receipt.receipt_id = sha256(body);
}

function unavailableReviewReceipt(scenario) {
  const receipt = {
    schema_version: 1,
    receipt_id: "",
    run_id: `test-run:${scenario.id}`,
    coordinator_id: "coordinator:test-run",
    reason: "reviewer-unavailable",
    details: "The bounded independent reviewer was unavailable.",
    recorded_at: "2026-01-01T00:00:00Z",
    claim: "agent-recorded",
    status: "unavailable",
  };
  const body = { ...receipt };
  delete body.receipt_id;
  receipt.receipt_id = sha256(body);
  return receipt;
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
  record.cases = catalog.scenarios.map((scenario) => {
    const scaffold = scaffoldCases.get(scenario.id);
    const baseline = expectedFixtureBaseline(scenario.id);
    const initialGitHead = baseline.git_head;
    const initialProjectTreeSha256 = baseline.project_tree_sha256;
    const finalGitHead = baseline.git_head;
    const finalProjectTreeSha256 = baseline.project_tree_sha256;
    const review =
      scenario.expected.review === "passed"
        ? reviewEvidence(scenario, finalGitHead)
        : null;
    return {
      scenario_id: scenario.id,
      fixture_receipt: scaffold.fixture_receipt,
      materialization_receipt: scaffold.materialization_receipt,
      materialization_spec_sha256:
        scaffold.materialization_spec_sha256,
      materialized_git_head: initialGitHead,
      materialized_git_object_format:
        initialGitHead.length === 64 ? "sha256" : "sha1",
      materialized_project_tree_sha256: initialProjectTreeSha256,
      materialized_project_state_sha256: projectStateSha256({
        materializationSpecSha256:
          scaffold.materialization_spec_sha256,
        gitHead: initialGitHead,
        projectTreeSha256: initialProjectTreeSha256,
      }),
      final_git_head: finalGitHead,
      final_git_object_format:
        finalGitHead.length === 64 ? "sha256" : "sha1",
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
      observed: {
        run_id: `test-run:${scenario.id}`,
        activation_receipts: scenario.expected.must_activate.map((skill) =>
          activationReceipt(scenario, skill),
        ),
        activation_status: {
          run_id: `test-run:${scenario.id}`,
          required_skills: [...scenario.expected.must_activate].sort(),
          activated_skills: [...scenario.expected.must_activate].sort(),
          missing_skills: [],
          status: "satisfied",
        },
        activated_skills: [...scenario.expected.must_activate].sort(),
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
        review_receipts: review ? [review.receipt] : [],
        review_unavailable_receipts:
          scenario.expected.review === "blocked"
            ? [unavailableReviewReceipt(scenario)]
            : [],
        review_result_artifacts: review ? [review.artifact] : [],
        review_status: {
          independent_reviewed: scenario.expected.review === "passed",
          review_gate_ready: scenario.expected.review === "passed",
          status:
            scenario.expected.review === "passed"
              ? "passed"
              : scenario.expected.review,
        },
      },
      evidence: {
        summary: `Observed ${scenario.id} in the test harness.`,
        source: `test-run:${scenario.id}`,
      },
    };
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
      message: /live prompt and context must be at most 2048 bytes/,
      mutate(broken) {
        broken.scenarios[0].context.payload = "x".repeat(2_048);
      },
    },
    {
      message: /request\/context must not disclose expected skill name/,
      mutate(broken) {
        broken.scenarios[0].context.notes = "setup-autonomous-project";
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
  assert.ok(paths.has("scripts/skill-fixture.mjs"));
  assert.ok(paths.has("assets/project-template/CLAUDE.md"));
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
  const changedClaudeAdapter = entries.map(([path, content]) => [
    path,
    path === "assets/project-template/CLAUDE.md"
      ? Buffer.from(`${content.toString("utf8")}\nchanged adapter\n`)
      : content,
  ]);
  assert.notEqual(
    hashBehaviorEntries(changedClaudeAdapter),
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

test("evidence sanitizer redacts shell coordinator-token arguments", () => {
  const raw = [
    `node .agent-stack/bin/agent-stack.mjs start --coordinator-token ${COORDINATOR_TOKEN}`,
    `node .agent-stack/bin/agent-stack.mjs checkpoint --coordinator-token='${COORDINATOR_TOKEN}'`,
  ].join("\n");
  const redacted = sanitizeEvidenceText(raw);
  assert.doesNotMatch(redacted, new RegExp(COORDINATOR_TOKEN, "i"));
  assert.match(redacted, /--coordinator-token \[REDACTED\]/);
  assert.match(redacted, /--coordinator-token='\[REDACTED\]'/);
});

test("evidence sanitizer redacts snake and camel JSON token fields", () => {
  const raw = JSON.stringify({
    coordinator_token: COORDINATOR_TOKEN,
    coordinatorToken: COORDINATOR_TOKEN,
    project_tree_sha256: `sha256:${NORMAL_HASH}`,
  });
  const parsed = JSON.parse(sanitizeEvidenceText(raw));
  assert.equal(parsed.coordinator_token, "[REDACTED]");
  assert.equal(parsed.coordinatorToken, "[REDACTED]");
  assert.equal(parsed.project_tree_sha256, `sha256:${NORMAL_HASH}`);
});

test("evidence sanitizer redacts the whole JSON field when its value has quotes", () => {
  const raw = JSON.stringify({
    coordinator_token: 'prefix"suffix',
    coordinatorToken: "other\\suffix",
  });
  const parsed = JSON.parse(sanitizeEvidenceText(raw));
  assert.equal(parsed.coordinator_token, "[REDACTED]");
  assert.equal(parsed.coordinatorToken, "[REDACTED]");
});

test("evidence sanitizer keeps numeric coordinator fields valid JSON", () => {
  const numericToken = `1${"0".repeat(63)}`;
  const raw = `{"coordinator_token":${numericToken}}`;
  const parsed = JSON.parse(sanitizeEvidenceText(raw));
  assert.equal(parsed.coordinator_token, "[REDACTED]");
});

test("evidence sanitizer handles JSON argv and escaped shell token arguments", () => {
  const escapedShell = String.raw`node --coordinator-token \"${COORDINATOR_TOKEN}\"`;
  const raw = [
    JSON.stringify({
      argv: ["node", "--coordinator-token", COORDINATOR_TOKEN],
    }),
    JSON.stringify({ command: escapedShell }),
  ].join("\n");
  const lines = sanitizeEvidenceText(raw)
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(lines[0].argv[2], "[REDACTED]");
  assert.equal(
    lines[1].command,
    String.raw`node --coordinator-token \"[REDACTED]\"`,
  );
  assert.doesNotMatch(
    JSON.stringify(lines),
    new RegExp(COORDINATOR_TOKEN, "i"),
  );
});

test("evidence sanitizer handles escaped JSONL payloads", () => {
  const raw = [
    JSON.stringify({
      event: "tool-result",
      payload: JSON.stringify({ coordinatorToken: COORDINATOR_TOKEN }),
    }),
    JSON.stringify({
      event: "tool-result",
      payload: JSON.stringify({ coordinator_token: COORDINATOR_TOKEN }),
    }),
  ].join("\n");
  const lines = sanitizeEvidenceText(raw)
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const line of lines) {
    const payload = JSON.parse(line.payload);
    assert.equal(
      payload.coordinatorToken ?? payload.coordinator_token,
      "[REDACTED]",
    );
  }
});

test("evidence sanitizer preserves validity through nested escaped JSONL", () => {
  const raw = JSON.stringify({
    payload: JSON.stringify({
      payload: JSON.stringify({ coordinator_token: COORDINATOR_TOKEN }),
    }),
  });
  const outer = JSON.parse(sanitizeEvidenceText(raw));
  const middle = JSON.parse(outer.payload);
  const inner = JSON.parse(middle.payload);
  assert.equal(inner.coordinator_token, "[REDACTED]");
  assert.doesNotMatch(
    JSON.stringify(outer),
    new RegExp(COORDINATOR_TOKEN, "i"),
  );
});

test("evidence sanitizer replaces repeated discovered token values", () => {
  const raw = [
    `first observation: ${COORDINATOR_TOKEN}`,
    JSON.stringify({ coordinator_token: COORDINATOR_TOKEN }),
    `last observation: ${COORDINATOR_TOKEN}`,
  ].join("\n");
  const redacted = sanitizeEvidenceText(raw);
  assert.doesNotMatch(redacted, new RegExp(COORDINATOR_TOKEN, "i"));
  assert.equal(
    redacted.split("[REDACTED]").length - 1,
    3,
  );
});

test("evidence sanitizer leaves ordinary hashes intact", () => {
  const raw = [
    `sha256:${NORMAL_HASH}`,
    JSON.stringify({ project_tree_sha256: `sha256:${NORMAL_HASH}` }),
  ].join("\n");
  assert.equal(sanitizeEvidenceText(raw), raw);
});

test("evidence sanitizer handles long adversarial non-JSON input linearly", () => {
  const raw = `${String.raw`\\"`.repeat(50_000)}${"x".repeat(100_000)}`;
  assert.equal(sanitizeEvidenceText(raw), raw);
});

test("evidence sanitizer fails closed on an unredacted coordinator field", () => {
  assert.throws(
    () =>
      sanitizeEvidenceText(
        `{"coordinator_token":[${COORDINATOR_TOKEN}]}`,
      ),
    /still contains recognizable coordinator token/,
  );
});

test("evidence export preserves private raw input and writes a redacted sibling", () => {
  const target = mkdtempSync(join(tmpdir(), "uas-skill-eval-"));
  const input = join(target, "raw.jsonl");
  const output = join(target, "redacted.jsonl");
  const raw = JSON.stringify({ coordinator_token: COORDINATOR_TOKEN });
  try {
    writeFileSync(input, raw, "utf8");
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          join(PACKAGE_ROOT, "scripts", "skill-eval.mjs"),
          "export-evidence",
          "--input",
          input,
          "--output",
          output,
        ],
        { encoding: "utf8" },
      ),
    );
    assert.equal(result.ok, true);
    assert.equal(result.raw_preserved, true);
    assert.equal(readFileSync(input, "utf8"), raw);
    assert.equal(
      JSON.parse(readFileSync(output, "utf8")).coordinator_token,
      "[REDACTED]",
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("a complete live run record passes against the current behavior surface", () => {
  const record = passingRecord();
  assert.equal(record.schema_version, 3);
  assert.equal(
    record.cases.every((item) => Array.isArray(item.observed.review_result_artifacts)),
    true,
  );
  const result = evaluateRecord(record, catalog);
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, {
    total: 28,
    passed: 28,
    failed: 0,
  });
  assert.equal(result.surface_hash, behaviorSurfaceHash());
  assert.equal(
    result.cases[0].evidence_source,
    "test-run:direct-setup",
  );
});

test("run-record schema 3 requires claim dispositions and rejects stale schemas", () => {
  const current = passingRecord();
  delete current.cases[0].observed.source_claim_dispositions;
  let result = evaluateRecord(current, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /source_claim_dispositions must be an array/,
  );

  for (const staleVersion of [1, 2]) {
    const stale = passingRecord();
    stale.schema_version = staleVersion;
    result = evaluateRecord(stale, catalog);
    assert.equal(result.ok, false);
    assert.match(
      result.errors.join("\n"),
      /run record schema_version must equal 3/,
    );
  }
});

test("live run cases are bound to the exact canonical fixture", () => {
  for (const fixtureValue of [undefined, "sha256:wrong-fixture"]) {
    const record = passingRecord();
    const direct = record.cases.find(
      (item) => item.scenario_id === "direct-delivery",
    );
    direct.fixture_receipt = fixtureValue;
    const result = evaluateRecord(record, catalog);
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
  let result = evaluateRecord(missingMaterialization, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /materialization_receipt must equal sha256:[a-f0-9]{64}/,
  );

  const invalidState = passingRecord();
  invalidState.cases[0].materialized_project_tree_sha256 =
    `sha256:${"0".repeat(64)}`;
  result = evaluateRecord(invalidState, catalog);
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
  result = evaluateRecord(reassignedFixture, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /must equal the canonical direct-delivery baseline/,
  );

  const detachedFinal = passingRecord();
  detachedFinal.cases[0].final_baseline_ancestor = false;
  result = evaluateRecord(detachedFinal, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /final_baseline_ancestor must confirm/,
  );

  const ambientCredentials = passingRecord();
  ambientCredentials.cases[0].harness_session.execution_boundary
    .external_provider_credentials = "inherited";
  result = evaluateRecord(ambientCredentials, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /external_provider_credentials must equal scrubbed/,
  );

  const wrongMount = passingRecord();
  wrongMount.cases[0].harness_session.execution_boundary
    .isolated_package_surface_hash = `sha256:${"0".repeat(64)}`;
  result = evaluateRecord(wrongMount, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /isolated_package_surface_hash must equal/,
  );

  const reusedSession = passingRecord();
  reusedSession.cases[1].harness_session.id =
    reusedSession.cases[0].harness_session.id;
  result = evaluateRecord(reusedSession, catalog);
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
  result = evaluateRecord(missingProviderAuthority, catalog);
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
  result = evaluateRecord(missingExternalInput, catalog);
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
  const result = evaluateRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /forbidden skill activated: run-autonomous-delivery/,
  );
});

test("activation receipt mutations report their specific binding findings", () => {
  const cases = [
    {
      name: "missing receipt hash",
      mutate: (receipt) => delete receipt.receipt_sha256,
      finding: /receipt_sha256 must be present and be a SHA-256 digest/,
    },
    {
      name: "altered installed skill path",
      mutate: (receipt) => {
        receipt.skill_path = `.agents/skills/${receipt.skill}/changed.md`;
      },
      finding: /skill_path must be the canonical installed skill path/,
    },
    {
      name: "altered installed skill hash",
      mutate: (receipt) => {
        receipt.skill_sha256 = "0".repeat(64);
      },
      finding: /skill_sha256 must match the canonical skill content/,
    },
    {
      name: "native mode changes the receipt hash binding",
      mutate: (receipt) => {
        receipt.mode = "native";
      },
      finding: /receipt_sha256 must match its canonical content hash/,
    },
    {
      name: "different valid timestamp changes the receipt hash binding",
      mutate: (receipt) => {
        receipt.recorded_at = "2025-01-01T00:00:00Z";
      },
      finding: /receipt_sha256 must match its canonical content hash/,
    },
    {
      name: "receipt harness must bind to the enclosing run",
      mutate: (receipt) => {
        receipt.harness = "other-harness";
      },
      finding: /harness must equal observed\.harness\.name/,
    },
    {
      name: "receipt model must bind to the enclosing run",
      mutate: (receipt) => {
        receipt.model = "other-model";
      },
      finding: /model must equal observed\.harness\.model/,
    },
  ];
  for (const { name, mutate, finding } of cases) {
    const record = passingRecord();
    const direct = record.cases.find(
      (item) => item.scenario_id === "direct-delivery",
    );
    mutate(direct.observed.activation_receipts[0]);
    const result = evaluateRecord(record, catalog);
    assert.equal(result.ok, false);
    assert.match(
      JSON.stringify(result),
      finding,
      name,
    );
  }
});

test("starter prompt stays within the compact progressive-disclosure budget", () => {
  const starter = readFileSync(join(PACKAGE_ROOT, "STARTER_PROMPT.md"), "utf8");
  assert.ok(
    Buffer.byteLength(starter, "utf8") <= 4_096,
    `expected compact starter prompt, got ${Buffer.byteLength(starter, "utf8")} bytes`,
  );
  assert.match(starter, /Route before loading more/);
  assert.match(starter, /Do not dump directories/);
});

test("review evidence derives blocked and conflicting outcomes without treating them as passes", () => {
  const changes = passingRecord();
  const direct = changes.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  const scenario = catalog.scenarios.find(
    (item) => item.id === "direct-delivery",
  );
  const changesEvidence = reviewEvidence(scenario, direct.final_git_head, {
    result: "changes-requested",
    reviewerId: "second-reviewer",
  });
  direct.observed.review_receipts.push(changesEvidence.receipt);
  direct.observed.review_result_artifacts.push(changesEvidence.artifact);
  let result = evaluateRecord(changes, catalog);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result), /review outcome was blocked/);

  const unavailable = passingRecord();
  const unavailableDirect = unavailable.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  unavailableDirect.observed.review_unavailable_receipts = [
    unavailableReviewReceipt(scenario),
  ];
  result = evaluateRecord(unavailable, catalog);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result), /review outcome was blocked/);

  const tampered = passingRecord();
  const tamperedDirect = tampered.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  const invalidUnavailable = unavailableReviewReceipt(scenario);
  invalidUnavailable.claim = "unsupported-claim";
  tamperedDirect.observed.review_unavailable_receipts = [invalidUnavailable];
  result = evaluateRecord(tampered, catalog);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result), /review_unavailable_receipts.*claim/);
});

test("blocked expectations require valid durable blocking evidence", () => {
  const blockedScenario = catalog.scenarios.find(
    (item) => item.id === "edge-reviewer-unavailable",
  );

  const absent = passingRecord();
  const absentCase = absent.cases.find(
    (item) => item.scenario_id === blockedScenario.id,
  );
  absentCase.observed.review_receipts = [];
  absentCase.observed.review_unavailable_receipts = [];
  absentCase.observed.review_result_artifacts = [];
  absentCase.observed.review_status = {
    independent_reviewed: false,
    review_gate_ready: false,
    status: "blocked",
  };
  let result = evaluateRecord(absent, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /expected blocked review outcome was not observed/,
  );

  const unavailable = passingRecord();
  result = evaluateRecord(unavailable, catalog);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(
    result.cases.find((item) => item.scenario_id === blockedScenario.id).review
      .status,
    "blocked",
  );

  const changes = passingRecord();
  const changesCase = changes.cases.find(
    (item) => item.scenario_id === blockedScenario.id,
  );
  const changesEvidence = reviewEvidence(
    blockedScenario,
    changesCase.final_git_head,
    { result: "changes-requested", reviewerId: "blocked-reviewer" },
  );
  changesCase.observed.review_receipts = [changesEvidence.receipt];
  changesCase.observed.review_unavailable_receipts = [];
  changesCase.observed.review_result_artifacts = [changesEvidence.artifact];
  changesCase.observed.review_status = {
    independent_reviewed: false,
    review_gate_ready: false,
    status: "blocked",
  };
  result = evaluateRecord(changes, catalog);
  assert.equal(result.ok, true, JSON.stringify(result));

  const malformed = passingRecord();
  const malformedCase = malformed.cases.find(
    (item) => item.scenario_id === blockedScenario.id,
  );
  malformedCase.observed.review_unavailable_receipts[0].claim =
    "unsupported-claim";
  result = evaluateRecord(malformed, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /review_unavailable_receipts.*claim.*expected blocked review outcome was not observed/s,
  );
});

test("review and unavailable receipt bounds fail structurally before outcome derivation", () => {
  for (const mutate of [
    (receipt) => {
      receipt.reviewer_kind = "k".repeat(121);
    },
    (receipt) => {
      receipt.reviewer_id = "r".repeat(257);
    },
    (receipt) => {
      receipt.result_file = `.agent-stack/runs/${"r".repeat(600)}.json`;
    },
  ]) {
    const record = passingRecord();
    const direct = record.cases.find(
      (item) => item.scenario_id === "direct-delivery",
    );
    mutate(direct.observed.review_receipts[0]);
    const result = evaluateRecord(record, catalog);
    assert.equal(result.ok, false);
    assert.match(
      JSON.stringify(result),
      /review_receipts.*(?:single-line string of at most|result_file)/,
    );
  }

  for (const mutate of [
    (receipt) => {
      receipt.recorded_at = "not-a-timestamp";
    },
    (receipt) => {
      receipt.reason = "r".repeat(201);
    },
    (receipt) => {
      receipt.details = "line one\nline two";
    },
  ]) {
    const record = passingRecord();
    const blocked = record.cases.find(
      (item) => item.scenario_id === "edge-reviewer-unavailable",
    );
    mutate(blocked.observed.review_unavailable_receipts[0]);
    const result = evaluateRecord(record, catalog);
    assert.equal(result.ok, false);
    assert.match(
      JSON.stringify(result),
      /review_unavailable_receipts.*(?:UTC timestamp|single-line string of at most)/,
    );
  }
});

test("reviewer-result snapshots are exact bounded self-contained evidence", () => {
  assert.equal(evaluateRecord(passingRecord(), catalog).ok, true);
  const cases = [
    {
      name: "altered bytes",
      mutate: (caseItem, receipt) => rewriteReviewerResultArtifact(
        caseItem,
        receipt,
        (artifact) => {
          artifact.summary = "altered after the receipt was recorded";
        },
        { refreshReceipt: false },
      ),
      finding: /result_file_sha256 must match review_result_artifacts/,
    },
    {
      name: "missing snapshot",
      mutate: (caseItem) => {
        caseItem.observed.review_result_artifacts = [];
      },
      finding: /must have exactly one matching review_result_artifacts entry/,
    },
    {
      name: "duplicate snapshot",
      mutate: (caseItem) => {
        caseItem.observed.review_result_artifacts.push(
          structuredClone(caseItem.observed.review_result_artifacts[0]),
        );
      },
      finding: /duplicates artifact path|must have exactly one matching/,
    },
    {
      name: "unreferenced snapshot",
      mutate: (caseItem) => {
        caseItem.observed.review_result_artifacts.push({
          path: ".agent-stack/runs/reviews/unreferenced.json",
          content: caseItem.observed.review_result_artifacts[0].content,
        });
      },
      finding: /path is unreferenced by review_receipts/,
    },
    {
      name: "non-string content",
      mutate: (caseItem) => {
        caseItem.observed.review_result_artifacts[0].content = 42;
      },
      finding: /content must be a string/,
    },
    {
      name: "empty content",
      mutate: (caseItem) => {
        caseItem.observed.review_result_artifacts[0].content = "";
      },
      finding: /content must be non-empty/,
    },
    {
      name: "oversized content",
      mutate: (caseItem) => {
        caseItem.observed.review_result_artifacts[0].content = "a".repeat(
          4 * 1024 * 1024 + 1,
        );
      },
      finding: /content exceeds the 4194304-byte limit/,
    },
    {
      name: "invalid JSON",
      mutate: (caseItem) => {
        caseItem.observed.review_result_artifacts[0].content = "{not-json\n";
      },
      finding: /content contains invalid JSON/,
    },
    {
      name: "altered hash",
      mutate: (caseItem, receipt) => {
        receipt.result_file_sha256 = `sha256:${"0".repeat(64)}`;
        const body = { ...receipt };
        delete body.receipt_id;
        receipt.receipt_id = sha256(body);
      },
      finding: /result_file_sha256 must match review_result_artifacts/,
    },
    {
      name: "wrong run",
      mutate: (caseItem, receipt) => rewriteReviewerResultArtifact(
        caseItem,
        receipt,
        (artifact) => {
          artifact.run_id = "wrong-run";
        },
      ),
      finding: /artifact run_id does not match/,
    },
    {
      name: "wrong commit",
      mutate: (caseItem, receipt) => rewriteReviewerResultArtifact(
        caseItem,
        receipt,
        (artifact) => {
          artifact.git_commit = "f".repeat(40);
        },
      ),
      finding: /artifact git_commit does not match/,
    },
    {
      name: "wrong reviewer",
      mutate: (caseItem, receipt) => rewriteReviewerResultArtifact(
        caseItem,
        receipt,
        (artifact) => {
          artifact.reviewer_id = "wrong-reviewer";
        },
      ),
      finding: /artifact reviewer_id does not match/,
    },
    {
      name: "wrong result",
      mutate: (caseItem, receipt) => rewriteReviewerResultArtifact(
        caseItem,
        receipt,
        (artifact) => {
          artifact.result = "changes-requested";
          artifact.findings = ["The result was changed after recording."];
        },
      ),
      finding: /artifact result does not match/,
    },
    {
      name: "unsafe path",
      mutate: (caseItem, receipt) => {
        receipt.result_file = "../outside.json";
        const body = { ...receipt };
        delete body.receipt_id;
        receipt.receipt_id = sha256(body);
      },
      finding: /result_file must be a JSON reviewer-result artifact|unreferenced by review_receipts/,
    },
  ];
  for (const testCase of cases) {
    const record = passingRecord();
    const direct = record.cases.find(
      (item) => item.scenario_id === "direct-delivery",
    );
    const receipt = direct.observed.review_receipts[0];
    testCase.mutate(direct, receipt);
    const result = evaluateRecord(record, catalog);
    assert.equal(result.ok, false, testCase.name);
    assert.match(JSON.stringify(result), testCase.finding, testCase.name);
  }
});

test("duplicate artifact-path finding is emitted once", () => {
  const record = passingRecord();
  const direct = record.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  direct.observed.review_result_artifacts.push(
    structuredClone(direct.observed.review_result_artifacts[0]),
  );
  const result = evaluateRecord(record, catalog);
  assert.equal(result.ok, false);
  const evaluated = result.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  assert.equal(
    evaluated.findings.filter((finding) => /duplicates artifact path/.test(finding))
      .length,
    1,
  );
  assert.equal(evaluated.review.status, "blocked");
});

test("evaluator rejects noncanonical portable reviewer-result paths", () => {
  for (const path of [
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
    ".agent-stack/runs/reviews/LPT9.json",
    ".agent-stack/runs/reviews/COM¹.json",
    ".agent-stack/runs/reviews/LPT³.txt.json",
    `./.agent-stack/runs/reviews/direct-delivery-passed.json`,
  ]) {
    const record = passingRecord();
    const direct = record.cases.find(
      (item) => item.scenario_id === "direct-delivery",
    );
    const receipt = direct.observed.review_receipts[0];
    receipt.result_file = path;
    const body = { ...receipt };
    delete body.receipt_id;
    receipt.receipt_id = sha256(body);
    const result = evaluateRecord(record, catalog);
    assert.equal(result.ok, false, path);
    assert.match(JSON.stringify(result), /result_file.*(?:safe|JSON reviewer-result|canonical)/s, path);
  }
});

test("not-required review expectations cannot hide blocking evidence", () => {
  const record = passingRecord();
  const scenario = catalog.scenarios.find(
    (item) => item.expected.review === "not-required",
  );
  const target = record.cases.find(
    (item) => item.scenario_id === scenario.id,
  );
  const unexpectedEvidence = reviewEvidence(scenario, target.final_git_head, {
    result: "changes-requested",
    reviewerId: "unexpected-reviewer",
  });
  target.observed.review_receipts = [unexpectedEvidence.receipt];
  target.observed.review_result_artifacts = [unexpectedEvidence.artifact];
  target.observed.review_status = {
    independent_reviewed: false,
    review_gate_ready: false,
    status: "blocked",
  };
  const hidden = evaluateRecord(record, catalog);
  assert.equal(hidden.ok, false);
  assert.equal(
    hidden.cases.find((item) => item.scenario_id === scenario.id).review.status,
    "blocked",
  );
  assert.match(
    JSON.stringify(hidden),
    /review outcome was blocked for a not-required scenario/,
  );

  const second = passingRecord();
  for (const item of second.cases) {
    item.harness_session.id = `${item.harness_session.id}:second`;
  }
  const rates = evaluateRoutingRates([record, second], catalog);
  assert.equal(rates.ok, true, JSON.stringify(rates));
  assert.ok(
    rates.groups[0].review_outcomes.some(
      (item) => item.scenario_id === scenario.id && item.outcome === "blocked",
    ),
  );
});

test("activation receipt bounds stop before deriving or inspecting receipts", () => {
  const record = passingRecord();
  const scenario = catalog.scenarios.find((item) => item.id === "direct-delivery");
  const target = record.cases.find((item) => item.scenario_id === scenario.id);
  target.observed.activation_receipts = Array.from(
    { length: 129 },
    () => structuredClone(target.observed.activation_receipts[0]),
  );
  const result = evaluateRecord(record, catalog);
  assert.equal(result.ok, false);
  const findings = result.cases.find((item) => item.scenario_id === scenario.id).findings;
  assert.ok(findings.includes("activation_receipts must contain at most 128 receipts"));
  assert.ok(
    !findings.some((finding) => finding.includes("canonical installed skill path")),
  );
});

test("review outcomes are derived before scenario expectations", () => {
  const absent = passingRecord();
  const notRequired = catalog.scenarios.find(
    (item) => item.expected.review === "not-required",
  );
  const absentCase = absent.cases.find(
    (item) => item.scenario_id === notRequired.id,
  );
  assert.equal(
    evaluateRecord(absent, catalog).cases.find(
      (item) => item.scenario_id === notRequired.id,
    ).review.status,
    "not-required",
  );

  const passedExtra = passingRecord();
  const passedCase = passedExtra.cases.find(
    (item) => item.scenario_id === notRequired.id,
  );
  const passedEvidence = reviewEvidence(notRequired, passedCase.final_git_head);
  passedCase.observed.review_receipts = [passedEvidence.receipt];
  passedCase.observed.review_result_artifacts = [passedEvidence.artifact];
  passedCase.observed.review_status = {
    independent_reviewed: true,
    review_gate_ready: true,
    status: "passed",
  };
  const passedResult = evaluateRecord(passedExtra, catalog);
  assert.equal(passedResult.ok, true, JSON.stringify(passedResult));
  assert.equal(
    passedResult.cases.find((item) => item.scenario_id === notRequired.id).review
      .status,
    "passed",
  );

  const absentRequired = passingRecord();
  const requiredCase = absentRequired.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  requiredCase.observed.review_receipts = [];
  requiredCase.observed.review_result_artifacts = [];
  requiredCase.observed.review_status = {
    independent_reviewed: false,
    review_gate_ready: false,
    status: "blocked",
  };
  const absentRequiredResult = evaluateRecord(absentRequired, catalog);
  assert.equal(absentRequiredResult.ok, false);
  assert.equal(
    absentRequiredResult.cases.find(
      (item) => item.scenario_id === "direct-delivery",
    ).review.status,
    "blocked",
  );
  assert.match(
    JSON.stringify(absentRequiredResult),
    /review outcome was blocked/,
  );

  const blocked = passingRecord();
  const blockedScenario = catalog.scenarios.find(
    (item) => item.id === "edge-reviewer-unavailable",
  );
  const blockedCase = blocked.cases.find(
    (item) => item.scenario_id === blockedScenario.id,
  );
  assert.equal(
    evaluateRecord(blocked, catalog).cases.find(
      (item) => item.scenario_id === blockedScenario.id,
    ).review.status,
    "blocked",
  );
  const unexpectedPass = reviewEvidence(blockedScenario, blockedCase.final_git_head);
  blockedCase.observed.review_unavailable_receipts = [];
  blockedCase.observed.review_receipts = [unexpectedPass.receipt];
  blockedCase.observed.review_result_artifacts = [unexpectedPass.artifact];
  blockedCase.observed.review_status = {
    independent_reviewed: true,
    review_gate_ready: true,
    status: "passed",
  };
  const blockedResult = evaluateRecord(blocked, catalog);
  assert.equal(blockedResult.ok, false);
  assert.equal(
    blockedResult.cases.find(
      (item) => item.scenario_id === blockedScenario.id,
    ).review.status,
    "passed",
  );
  assert.match(
    JSON.stringify(blockedResult),
    /expected blocked review outcome was not observed/,
  );
  assert.equal(absentCase.observed.review_result_artifacts.length, 0);
});

test("review receipt and snapshot arrays stop at 128 before parsing", () => {
  const reviewOverflow = passingRecord();
  const reviewCase = reviewOverflow.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  reviewCase.observed.review_receipts = Array.from(
    { length: 129 },
    () => structuredClone(reviewCase.observed.review_receipts[0]),
  );
  let result = evaluateRecord(reviewOverflow, catalog);
  let findings = result.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  ).findings;
  assert.ok(findings.includes("review_receipts must contain at most 128 items"));
  assert.ok(!findings.some((finding) => finding.includes("review_receipts[0]")));
  assert.ok(!findings.some((finding) => finding.includes("review_result_artifacts[0]")));

  const unavailableOverflow = passingRecord();
  const unavailableCase = unavailableOverflow.cases.find(
    (item) => item.scenario_id === "edge-reviewer-unavailable",
  );
  unavailableCase.observed.review_unavailable_receipts = Array.from(
    { length: 129 },
    () => structuredClone(unavailableCase.observed.review_unavailable_receipts[0]),
  );
  result = evaluateRecord(unavailableOverflow, catalog);
  findings = result.cases.find(
    (item) => item.scenario_id === "edge-reviewer-unavailable",
  ).findings;
  assert.ok(
    findings.includes("review_unavailable_receipts must contain at most 128 items"),
  );
  assert.ok(
    !findings.some((finding) => finding.includes("review_unavailable_receipts[0]")),
  );

  const artifactOverflow = passingRecord();
  const artifactCase = artifactOverflow.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  artifactCase.observed.review_result_artifacts = Array.from(
    { length: 129 },
    () => structuredClone(artifactCase.observed.review_result_artifacts[0]),
  );
  result = evaluateRecord(artifactOverflow, catalog);
  findings = result.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  ).findings;
  assert.ok(
    findings.includes("review_result_artifacts must contain at most 128 items"),
  );
  assert.ok(
    !findings.some((finding) => finding.includes("review_result_artifacts[0]")),
  );
});

test("evaluate CLI consumes self-contained reviewer-result snapshots", () => {
  const target = mkdtempSync(join(tmpdir(), "uas-evaluate-cli-"));
  const input = join(target, "run.json");
  try {
    writeFileSync(input, `${JSON.stringify(passingRecord())}\n`);
    const result = spawnSync(
      process.execPath,
      [
        join(PACKAGE_ROOT, "scripts", "skill-eval.mjs"),
        "evaluate",
        "--input",
        input,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("routing reliability is reported as k/N per harness and model", () => {
  const first = passingRecord();
  const second = passingRecord();
  for (const item of second.cases) {
    item.harness_session.id = `${item.harness_session.id}:second`;
  }
  const secondDirect = second.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  rewriteReviewerResultArtifact(
    secondDirect,
    secondDirect.observed.review_receipts[0],
    (artifact) => {
      artifact.summary = "A distinct self-contained snapshot from run two.";
    },
  );
  const route = second.cases.find(
    (item) => item.scenario_id === "flexible-direct-bypass",
  );
  route.observed.activation_receipts = [];
  route.observed.activated_skills = [];
  route.observed.activation_status = {
    run_id: route.observed.run_id,
    required_skills: ["run-autonomous-delivery"],
    activated_skills: [],
    missing_skills: ["run-autonomous-delivery"],
    status: "blocked",
  };
  const missedReview = second.cases.find(
    (item) => item.scenario_id === "direct-delivery",
  );
  missedReview.observed.review_receipts = [];
  missedReview.observed.review_result_artifacts = [];
  missedReview.observed.review_status = {
    independent_reviewed: false,
    review_gate_ready: false,
    status: "blocked",
  };
  const negativeSecond = second.cases.find(
    (item) => item.scenario_id === "negative-explanation-only",
  );
  const negativeScenario = catalog.scenarios.find(
    (scenario) => scenario.id === "negative-explanation-only",
  );
  negativeSecond.observed.activation_receipts = [
    activationReceipt(negativeScenario, "run-autonomous-delivery"),
  ];
  negativeSecond.observed.activated_skills = ["run-autonomous-delivery"];
  negativeSecond.observed.activation_status = {
    run_id: negativeSecond.observed.run_id,
    required_skills: [],
    activated_skills: ["run-autonomous-delivery"],
    missing_skills: [],
    status: "satisfied",
  };

  const result = evaluateRoutingRates([first, second], catalog);
  assert.equal(result.ok, true);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].run_records, 2);
  assert.equal(result.groups[0].reliability_ready, true);
  assert.equal(result.groups[0].evaluated_runs_passed, 1);
  const directReviewOutcome = result.groups[0].review_outcomes.find(
    (item) =>
      item.scenario_id === "direct-delivery" && item.outcome === "blocked",
  );
  assert.deepEqual(directReviewOutcome, {
    scenario_id: "direct-delivery",
    outcome: "blocked",
    observed: 1,
    attempts: 2,
    rate: "1/2",
  });
  const directRoute = result.groups[0].routes.find(
    (item) =>
      item.scenario_id === "flexible-direct-bypass" &&
      item.skill === "run-autonomous-delivery" &&
      item.expected === "activate",
  );
  assert.deepEqual(directRoute, {
    scenario_id: "flexible-direct-bypass",
    skill: "run-autonomous-delivery",
    expected: "activate",
    matched: 1,
    observed_activated: 1,
    attempts: 2,
    rate: "1/2",
  });
  const deliverySkill =
    result.groups[0].required_activation_recall.find(
      (item) => item.skill === "run-autonomous-delivery",
    );
  assert.ok(deliverySkill.opportunities > 2);
  assert.match(deliverySkill.rate, /^\d+\/\d+$/);
  const falseActivation =
    result.groups[0].forbidden_activation_compliance.find(
      (item) => item.skill === "run-autonomous-delivery",
    );
  assert.ok(
    falseActivation.not_activated <
      falseActivation.opportunities,
  );
  const negativeRoute = result.groups[0].routes.find(
    (item) =>
      item.scenario_id === "negative-explanation-only" &&
      item.skill === "run-autonomous-delivery" &&
      item.expected === "not-activate",
  );
  assert.equal(negativeRoute.matched, 1);
  assert.equal(negativeRoute.observed_activated, 1);
  assert.equal(negativeRoute.rate, "1/2");
  assert.match(result.boundary, /do not authenticate/);

  const incomplete = passingRecord();
  incomplete.cases = incomplete.cases.slice(0, 1);
  assert.equal(
    evaluateRoutingRates([incomplete, second], catalog).ok,
    false,
  );

  const duplicate = evaluateRoutingRates(
    [first, structuredClone(first)],
    catalog,
  );
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors.join("\n"), /reuses a harness session/);

  for (const mutate of [
    (record) => {
      delete record.cases[0].observed.question_count;
    },
    (record) => {
      record.cases[0].final_baseline_ancestor = false;
    },
    (record) => {
      record.cases[0].final_project_state_sha256 =
        `sha256:${"0".repeat(64)}`;
    },
  ]) {
    const invalid = passingRecord();
    const independent = passingRecord();
    for (const item of independent.cases) {
      item.harness_session.id =
        `${item.harness_session.id}:independent`;
    }
    mutate(invalid);
    const rejected = evaluateRoutingRates(
      [invalid, independent],
      catalog,
    );
    assert.equal(rejected.ok, false);
    assert.match(
      rejected.errors.join("\n"),
      /lacks current structured evidence/,
    );
  }
});

test("routing-rate CLI output identifies its input records and invocation", () => {
  const target = mkdtempSync(join(tmpdir(), "uas-routing-rate-"));
  const firstPath = join(target, "first.json");
  const secondPath = join(target, "second.json");
  const first = passingRecord();
  const second = passingRecord();
  for (const item of second.cases) {
    item.harness_session.id = `${item.harness_session.id}:second`;
  }
  try {
    writeFileSync(firstPath, `${JSON.stringify(first)}\n`, "utf8");
    writeFileSync(secondPath, `${JSON.stringify(second)}\n`, "utf8");
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          join(PACKAGE_ROOT, "scripts", "skill-eval.mjs"),
          "routing-rate",
          "--input",
          firstPath,
          "--input",
          secondPath,
        ],
        { encoding: "utf8" },
      ),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.command, "routing-rate");
    assert.deepEqual(result.input_paths, [firstPath, secondPath]);
    assert.equal(
      result.invocation.command,
      "node scripts/skill-eval.mjs routing-rate",
    );
    assert.deepEqual(result.invocation.input_paths, [firstPath, secondPath]);
    assert.equal(result.groups[0].reliability_ready, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("telemetry diagnosis requires explicit activation and rejects project writes", () => {
  const record = passingRecord();
  const telemetry = record.cases.find(
    (item) => item.scenario_id === "direct-telemetry-diagnosis",
  );
  telemetry.observed = {
    run_id: `test-run:${telemetry.scenario_id}`,
    activation_receipts: [activationReceipt(
      catalog.scenarios.find((scenario) => scenario.id === telemetry.scenario_id),
      "use-project-telemetry",
    )],
    activation_status: {
      run_id: `test-run:${telemetry.scenario_id}`,
      required_skills: ["use-project-telemetry"],
      activated_skills: ["use-project-telemetry"],
      missing_skills: [],
      status: "satisfied",
    },
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
    review_receipts: [],
    review_unavailable_receipts: [],
    review_result_artifacts: [],
    review_status: {
      independent_reviewed: false,
      review_gate_ready: false,
      status: "not-required",
    },
  };
  assert.equal(evaluateRecord(record, catalog).ok, true);

  telemetry.observed.performed_actions = ["write_project_files"];
  const writeResult = evaluateRecord(record, catalog);
  assert.equal(writeResult.ok, false);
  assert.match(
    JSON.stringify(writeResult),
    /forbidden action was performed: write_project_files/,
  );

  telemetry.observed.performed_actions = [];
  telemetry.observed.activation_receipts = [];
  telemetry.observed.activated_skills = [];
  telemetry.observed.activation_status = {
    run_id: telemetry.observed.run_id,
    required_skills: ["use-project-telemetry"],
    activated_skills: [],
    missing_skills: ["use-project-telemetry"],
    status: "blocked",
  };
  const activationResult = evaluateRecord(record, catalog);
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
  let result = evaluateRecord(unauthorizedWrite, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /forbidden action was performed: mutate_external_work_provider/,
  );

  const missingActivation = passingRecord();
  missingActivation.cases.find(
    (item) => item.scenario_id === workScenarioId,
  ).observed.activation_receipts = [];
  missingActivation.cases.find(
    (item) => item.scenario_id === workScenarioId,
  ).observed.activated_skills = [];
  missingActivation.cases.find(
    (item) => item.scenario_id === workScenarioId,
  ).observed.activation_status = {
    run_id: missingActivation.cases.find(
      (item) => item.scenario_id === workScenarioId,
    ).observed.run_id,
    required_skills: ["manage-project-work"],
    activated_skills: [],
    missing_skills: ["manage-project-work"],
    status: "blocked",
  };
  result = evaluateRecord(missingActivation, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /required skill did not activate: manage-project-work/,
  );
});

test("an unrecognized activated skill cannot be hidden in a run record", () => {
  const record = passingRecord();
  record.cases[0].observed.activated_skills.push("invented-skill");
  const result = evaluateRecord(record, catalog);
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
  const result = evaluateRecord(record, catalog);
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
  const result = evaluateRecord(record, catalog);
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
  const result = evaluateRecord(record, catalog);
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
  direct.observed.performed_actions =
    direct.observed.performed_actions.filter(
      (action) => action !== "run_project_tests",
    );
  direct.observed.written_paths =
    direct.observed.written_paths.filter(
      (path) => path !== "src/status.mjs",
    );
  const result = evaluateRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.doesNotMatch(
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
  const result = evaluateRecord(record, catalog);
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
  let result = evaluateRecord(continued, catalog);
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
  result = evaluateRecord(reasked, catalog);
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
  const result = evaluateRecord(record, catalog);
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
  const result = evaluateRecord(record, catalog);
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
    const result = evaluateRecord(record, catalog);
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
  const result = evaluateRecord(record, catalog);
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
  const result = evaluateRecord(record, catalog);
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
  let result = evaluateRecord(missing, catalog);
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
  result = evaluateRecord(duplicated, catalog);
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
  const result = evaluateRecord(record, catalog);
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
  const result = evaluateRecord(record, catalog);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result), /surface_hash must equal/);
  assert.match(JSON.stringify(result), /missing run result/);
});

test("duplicate and unknown run scenarios fail closed", () => {
  const duplicated = passingRecord();
  duplicated.cases.push(structuredClone(duplicated.cases[0]));
  let result = evaluateRecord(duplicated, catalog);
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
  result = evaluateRecord(unknown, catalog);
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /run record contains unknown scenario not-a-real-scenario/,
  );
});

test("malformed run arrays fail closed with structured findings", () => {
  const malformedCases = passingRecord();
  malformedCases.cases = {};
  let result = evaluateRecord(malformedCases, catalog);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /run record cases must be an array/);

  const malformedObserved = passingRecord();
  malformedObserved.cases[0].observed.activated_skills = {};
  malformedObserved.cases[0].observed.performed_actions = {};
  malformedObserved.cases[0].observed.outcome_tags = {};
  malformedObserved.cases[0].observed.max_questions_in_turn = 1;
  result = evaluateRecord(malformedObserved, catalog);
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
  result = evaluateRecord(hiddenQuestionBurst, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /max_questions_in_turn must be at least 1 when question_count is positive/,
  );
});

test("malformed scenario expectations fail closed without throwing", () => {
  const malformedCatalog = structuredClone(catalog);
  malformedCatalog.scenarios[0].expected = null;
  const result = evaluateRecord(passingRecord(), malformedCatalog);
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /scenarios\[0\]\.expected must be an object/,
  );
});

test("the generated scaffold is not accepted as live evidence", () => {
  const result = evaluateRecord(buildScaffold(catalog), catalog);
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
