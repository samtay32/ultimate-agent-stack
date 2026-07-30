import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    return {
      scenario_id: scenario.id,
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
  });
  return record;
}

test("behavioral scenario contracts cover activation and false activation", () => {
  const result = validateScenarioCatalog(catalog);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.scenario_count, 27);
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
  assert.equal(record.schema_version, 2);
  const result = validateRunRecord(record, catalog);
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.summary, {
    total: 27,
    passed: 27,
    failed: 0,
  });
  assert.equal(result.surface_hash, behaviorSurfaceHash());
  assert.equal(
    result.cases[0].evidence_source,
    "test-run:direct-setup",
  );
});

test("run-record schema 2 requires claim dispositions and rejects stale schemas", () => {
  const current = passingRecord();
  delete current.cases[0].observed.source_claim_dispositions;
  let result = validateRunRecord(current, catalog);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result),
    /source_claim_dispositions must be an array/,
  );

  for (const staleVersion of [1, 3]) {
    const stale = passingRecord();
    stale.schema_version = staleVersion;
    result = validateRunRecord(stale, catalog);
    assert.equal(result.ok, false);
    assert.match(
      result.errors.join("\n"),
      /run record schema_version must equal 2/,
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
