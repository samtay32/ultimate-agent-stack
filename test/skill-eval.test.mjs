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
  assert.equal(result.scenario_count, 9);
  assert.equal(result.skill_count, 10);
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
    total: 9,
    passed: 9,
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
