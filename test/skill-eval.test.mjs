import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  behaviorSurfaceHash,
  buildScaffold,
  hashBehaviorEntries,
  parseSkillMetadata,
  readBehaviorSurfacePath,
  validateRunRecord,
  validateScenarioCatalog,
} from "../scripts/skill-eval.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const catalog = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "evals", "scenarios.json"), "utf8"),
);

function passingRecord() {
  const record = buildScaffold(catalog);
  record.harness = {
    name: "test-harness",
    version: "1.0.0",
    model: "test-model",
  };
  record.cases = catalog.scenarios.map((scenario) => ({
    scenario_id: scenario.id,
    observed: {
      activated_skills: [...scenario.expected.must_activate],
      asked_clarifying_question:
        scenario.expected.question === "required",
      performed_actions: [],
      outcome_tags: [...scenario.expected.required_outcomes],
    },
    evidence: {
      summary: `Observed ${scenario.id} in the test harness.`,
      source: `test-run:${scenario.id}`,
    },
  }));
  return record;
}

test("behavioral scenario contracts cover activation and false activation", () => {
  const result = validateScenarioCatalog(catalog);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.scenario_count, 10);
  assert.equal(result.skill_count, 11);
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
  const result = validateRunRecord(passingRecord(), catalog);
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.summary, {
    total: 10,
    passed: 10,
    failed: 0,
  });
  assert.equal(result.surface_hash, behaviorSurfaceHash());
  assert.equal(
    result.cases[0].evidence_source,
    "test-run:direct-setup",
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
