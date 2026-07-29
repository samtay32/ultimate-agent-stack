#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { startPromptPolicySurface } from "../bin/ultimate-agent-stack.mjs";
import {
  EVALUATION_SCRUBBED_CREDENTIAL_ENVIRONMENT,
  LIVE_LINEAR_SANDBOX_OPT_IN,
  expectedFixtureBaseline,
  expectedMaterializationSha256,
  externalInputsForFixture,
  fixtureCatalog,
  fixtureReceipt,
  projectStateSha256,
} from "./skill-fixture.mjs";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(SCRIPT_FILE), "..");
const SCENARIOS_FILE = join(PACKAGE_ROOT, "evals", "scenarios.json");
const SKILLS_ROOT = join(PACKAGE_ROOT, "skills");
const QUESTION_POLICIES = new Set(["allowed", "forbidden", "required"]);
const SOURCE_CLAIM_DISPOSITIONS = new Set([
  "kept",
  "tightened",
  "rejected",
  "deferred",
]);
const CURRENT_RUN_RECORD_SCHEMA_VERSION = 2;
const SHA256_RECEIPT = /^sha256:[a-f0-9]{64}$/;
const GIT_COMMIT_ID = /^[a-f0-9]{40}$/;
const ARTIFACT_STATUSES = new Set([
  "DRAFT",
  "APPROVED",
  "ABSENT",
  "INVALID",
]);
const ARTIFACT_LOCK_STATES = new Set([
  "unlocked",
  "locked",
  "rejected",
  "absent",
]);
const REQUIRED_CATEGORIES = new Set([
  "direct",
  "indirect",
  "incomplete",
  "negative",
  "edge",
  "authority",
  "continuity",
  "existing-project",
]);
const TEXT_SURFACE_EXTENSIONS = new Set([
  ".json",
  ".md",
  ".mdc",
  ".mjs",
  ".toml",
  ".yaml",
  ".yml",
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readBehaviorSurfacePath(projectPath) {
  const absolute = join(PACKAGE_ROOT, projectPath);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`behavior surface path not found: ${projectPath}`);
  }
  return readFileSync(absolute);
}

function listFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function normalizePath(path) {
  return relative(PACKAGE_ROOT, path).split(sep).join("/");
}

function parseSkillMetadata(content, path = "SKILL.md") {
  const frontmatter = content.match(
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n/,
  );
  const lines = frontmatter?.[1].split(/\r?\n/) ?? [];
  const field = (key) => {
    const prefix = `${key}:`;
    const line = lines.find((candidate) => candidate.startsWith(prefix));
    return line?.slice(prefix.length).trim();
  };
  const name = field("name");
  const description = field("description");
  if (!name || !description) {
    throw new Error(`Missing skill metadata in ${path}`);
  }
  return { name, description };
}

function skillCatalog() {
  const catalog = new Map();
  for (const path of listFiles(SKILLS_ROOT).filter((item) =>
    item.endsWith(`${sep}SKILL.md`),
  )) {
    const content = readFileSync(path, "utf8");
    const { name, description } = parseSkillMetadata(
      content,
      normalizePath(path),
    );
    if (catalog.has(name)) {
      throw new Error(`Duplicate skill name: ${name}`);
    }
    catalog.set(name, {
      name,
      description,
      path: normalizePath(path),
    });
  }
  return catalog;
}

function behaviorSurfaceEntries() {
  const entries = [];
  for (const path of listFiles(SKILLS_ROOT)) {
    entries.push([normalizePath(path), readFileSync(path)]);
  }
  for (const projectPath of [
    ".gitattributes",
    "STARTER_PROMPT.md",
    "assets/project-template/.agent-stack/core-policy.json",
    "assets/project-template/.agent-stack/HANDOFF.md",
    "assets/project-template/.agent-stack/artifacts/ARCHITECTURE.md",
    "assets/project-template/.agent-stack/artifacts/BRIEF.md",
    "assets/project-template/.agent-stack/artifacts/DECISIONS.md",
    "assets/project-template/.agent-stack/artifacts/DELEGATION.md",
    "assets/project-template/.agent-stack/artifacts/DELIVERY.md",
    "assets/project-template/.agent-stack/artifacts/SECURITY.md",
    "assets/project-template/.agent-stack/artifacts/VERIFICATION.md",
    "assets/project-template/.claude/agents/uas-researcher.md",
    "assets/project-template/.codex/agents/uas_researcher.toml",
    "assets/project-template/.cursor/commands/deliver.md",
    "assets/project-template/.cursor/rules/agent-stack.mdc",
    "assets/project-template/.gemini/agents/uas-researcher.md",
    "assets/project-template/.opencode/agents/uas-researcher.md",
    "assets/project-template/AGENTS.md",
    "assets/project-template/GEMINI.md",
    "evals/fixture-baselines.json",
    "evals/fixtures.json",
    "evals/scenarios.json",
    "scripts/skill-fixture.mjs",
  ]) {
    entries.push([projectPath, readBehaviorSurfacePath(projectPath)]);
  }
  const pluginPath = ".codex-plugin/plugin.json";
  const plugin = JSON.parse(readBehaviorSurfacePath(pluginPath).toString("utf8"));
  delete plugin.version;
  entries.push([
    ".codex-plugin/plugin.behavior.json",
    Buffer.from(`${JSON.stringify(plugin, null, 2)}\n`),
  ]);
  entries.push([
    ".agent-stack/start-prompt-policy.json",
    Buffer.from(`${JSON.stringify(startPromptPolicySurface(), null, 2)}\n`),
  ]);
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

function behaviorSurfaceHash() {
  return hashBehaviorEntries(behaviorSurfaceEntries());
}

function hashBehaviorEntries(entries) {
  const hash = createHash("sha256");
  for (const [path, content] of entries) {
    hash.update(`${path}\0`);
    if (!Buffer.isBuffer(content)) {
      hash.update(String(content).replace(/\r\n/g, "\n"));
    } else if (TEXT_SURFACE_EXTENSIONS.has(extname(path).toLowerCase())) {
      hash.update(
        Buffer.from(
          content.toString("latin1").replace(/\r\n/g, "\n"),
          "latin1",
        ),
      );
    } else {
      hash.update(content);
    }
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isCompletedField(value) {
  return (
    isNonEmptyString(value) &&
    !/^replace(?:-with-| with )/i.test(value.trim()) &&
    !/^unknown$/i.test(value.trim())
  );
}

function stringArray(value) {
  return (
    Array.isArray(value) &&
    value.every((item) => isNonEmptyString(item)) &&
    new Set(value).size === value.length
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function externalInputReceipts(scenarioId) {
  return externalInputsForFixture(scenarioId).map((input) => ({
    id: input.id,
    kind: input.kind,
    delivery: "prompt-only",
    content_sha256: `sha256:${createHash("sha256")
      .update(input.content)
      .digest("hex")}`,
  }));
}

function providerAuthorityReceipt(scenarioId) {
  const fixture = fixtureCatalog().fixtures.find(
    (candidate) => candidate.scenario_id === scenarioId,
  );
  return fixture?.provider_execution
    ? {
        provider: fixture.provider_execution.provider,
        mode: fixture.provider_execution.mode,
        sandbox_opt_in_required:
          fixture.provider_execution.requires_explicit_sandbox_opt_in,
        sandbox_opt_in_supplied:
          fixture.provider_execution.requires_explicit_sandbox_opt_in,
        opt_in_option:
          fixture.provider_execution.requires_explicit_sandbox_opt_in
            ? LIVE_LINEAR_SANDBOX_OPT_IN
            : null,
      }
    : {
        provider: null,
        mode: "none",
        sandbox_opt_in_required: false,
        sandbox_opt_in_supplied: false,
        opt_in_option: null,
      };
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function safeScenarioPath(value, allowPattern = false) {
  if (
    !isNonEmptyString(value) ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.includes("\0")
  ) {
    return false;
  }
  const path = allowPattern && value.endsWith("/**")
    ? value.slice(0, -3)
    : value;
  return (
    path.length > 0 &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

function matchesPathPattern(path, pattern) {
  return pattern.endsWith("/**")
    ? path === pattern.slice(0, -3) ||
        path.startsWith(`${pattern.slice(0, -3)}/`)
    : path === pattern;
}

function validateArtifactStates(value, location, errors) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${location} must be an array`);
    return;
  }
  const paths = new Set();
  for (const [index, artifact] of value.entries()) {
    const itemLocation = `${location}[${index}]`;
    if (
      !artifact ||
      typeof artifact !== "object" ||
      Array.isArray(artifact)
    ) {
      errors.push(`${itemLocation} must be an object`);
      continue;
    }
    if (!safeScenarioPath(artifact.path)) {
      errors.push(`${itemLocation}.path must be a safe project-relative path`);
    } else if (paths.has(artifact.path)) {
      errors.push(`${location} duplicates artifact path ${artifact.path}`);
    } else {
      paths.add(artifact.path);
    }
    if (!ARTIFACT_STATUSES.has(artifact.status)) {
      errors.push(
        `${itemLocation}.status must be DRAFT, APPROVED, ABSENT, or INVALID`,
      );
    }
    if (!ARTIFACT_LOCK_STATES.has(artifact.lock_state)) {
      errors.push(
        `${itemLocation}.lock_state must be unlocked, locked, rejected, or absent`,
      );
    }
  }
}

function validateSourceClaimDispositions(value, location, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${location} must be an array`);
    return;
  }
  const ids = new Set();
  for (const [index, claim] of value.entries()) {
    const itemLocation = `${location}[${index}]`;
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      errors.push(`${itemLocation} must be an object`);
      continue;
    }
    if (!isNonEmptyString(claim.id)) {
      errors.push(`${itemLocation}.id must be a non-empty string`);
    } else if (ids.has(claim.id)) {
      errors.push(`${location} duplicates source claim ${claim.id}`);
    } else {
      ids.add(claim.id);
    }
    if (!SOURCE_CLAIM_DISPOSITIONS.has(claim.disposition)) {
      errors.push(
        `${itemLocation}.disposition must be kept, tightened, rejected, or deferred`,
      );
    }
  }
}

function validateScenarioCatalog(catalog = readJson(SCENARIOS_FILE)) {
  const errors = [];
  const skills = skillCatalog();
  let fixtureIds = new Set();
  try {
    fixtureIds = new Set(
      fixtureCatalog().fixtures.map((fixture) => fixture.scenario_id),
    );
  } catch (error) {
    errors.push(`canonical fixture catalog is invalid: ${error.message}`);
  }
  if (catalog?.schema_version !== 1) {
    errors.push("scenario catalog schema_version must equal 1");
  }
  if (!stringArray(catalog?.required_categories)) {
    errors.push("required_categories must be a unique non-empty string array");
  }
  const declaredCategories = new Set(asArray(catalog?.required_categories));
  for (const category of REQUIRED_CATEGORIES) {
    if (!declaredCategories.has(category)) {
      errors.push(`required_categories is missing ${category}`);
    }
  }
  if (!Array.isArray(catalog?.scenarios) || catalog.scenarios.length === 0) {
    errors.push("scenario catalog must contain scenarios");
  }

  const ids = new Set();
  const coveredCategories = new Set();
  let falseActivationCases = 0;
  for (const [index, scenario] of asArray(catalog?.scenarios).entries()) {
    const location = `scenarios[${index}]`;
    if (!isNonEmptyString(scenario?.id)) {
      errors.push(`${location}.id must be a non-empty string`);
    } else if (ids.has(scenario.id)) {
      errors.push(`${location}.id duplicates ${scenario.id}`);
    } else {
      ids.add(scenario.id);
    }
    if (!declaredCategories.has(scenario?.category)) {
      errors.push(`${location}.category must be declared`);
    } else {
      coveredCategories.add(scenario.category);
    }
    if (!isNonEmptyString(scenario?.request)) {
      errors.push(`${location}.request must be a non-empty string`);
    }
    if (
      !scenario?.context ||
      typeof scenario.context !== "object" ||
      Array.isArray(scenario.context)
    ) {
      errors.push(`${location}.context must be an object`);
    }
    const expected = scenario?.expected;
    if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
      errors.push(`${location}.expected must be an object`);
      continue;
    }
    for (const field of [
      "must_activate",
      "must_not_activate",
      "forbidden_actions",
      "required_outcomes",
    ]) {
      if (!stringArray(expected[field])) {
        errors.push(`${location}.expected.${field} must be a unique string array`);
      }
    }
    const mustActivateNames = asArray(expected.must_activate);
    const mustNotActivateNames = asArray(expected.must_not_activate);
    for (const name of [...mustActivateNames, ...mustNotActivateNames]) {
      if (!skills.has(name)) {
        errors.push(`${location} references unknown skill ${name}`);
      }
    }
    const mustActivate = new Set(mustActivateNames);
    for (const name of mustNotActivateNames) {
      if (mustActivate.has(name)) {
        errors.push(`${location} both requires and forbids ${name}`);
      }
    }
    if (!QUESTION_POLICIES.has(expected.question)) {
      errors.push(
        `${location}.expected.question must be allowed, forbidden, or required`,
      );
    }
    for (const field of [
      "required_question_tags",
      "forbidden_question_tags",
      "required_actions",
      "forbidden_write_paths",
      "required_write_paths",
      "required_outputs",
      "required_source_claim_ids",
    ]) {
      if (
        expected[field] !== undefined &&
        !stringArray(expected[field])
      ) {
        errors.push(
          `${location}.expected.${field} must be a unique string array`,
        );
      }
    }
    for (const pattern of asArray(expected.forbidden_write_paths)) {
      if (!safeScenarioPath(pattern, true)) {
        errors.push(
          `${location}.expected.forbidden_write_paths contains an unsafe pattern`,
        );
      }
    }
    const forbiddenActions = new Set(asArray(expected.forbidden_actions));
    for (const action of asArray(expected.required_actions)) {
      if (forbiddenActions.has(action)) {
        errors.push(
          `${location}.expected both requires and forbids action ${action}`,
        );
      }
    }
    for (const path of asArray(expected.required_write_paths)) {
      if (!safeScenarioPath(path)) {
        errors.push(
          `${location}.expected.required_write_paths contains an unsafe path`,
        );
      }
      for (const pattern of asArray(expected.forbidden_write_paths)) {
        if (
          safeScenarioPath(path) &&
          safeScenarioPath(pattern, true) &&
          matchesPathPattern(path, pattern)
        ) {
          errors.push(
            `${location}.expected requires write path ${path} but forbids it with ${pattern}`,
          );
        }
      }
    }
    for (const field of [
      "minimum_questions",
      "maximum_questions",
      "maximum_questions_per_turn",
    ]) {
      if (
        expected[field] !== undefined &&
        !nonNegativeInteger(expected[field])
      ) {
        errors.push(
          `${location}.expected.${field} must be a non-negative integer`,
        );
      }
    }
    if (
      nonNegativeInteger(expected.minimum_questions) &&
      nonNegativeInteger(expected.maximum_questions) &&
      expected.minimum_questions > expected.maximum_questions
    ) {
      errors.push(
        `${location}.expected minimum_questions cannot exceed maximum_questions`,
      );
    }
    validateArtifactStates(
      expected.required_artifact_states,
      `${location}.expected.required_artifact_states`,
      errors,
    );
    if (
      mustActivateNames.length === 0 &&
      new Set(mustNotActivateNames).size === skills.size
    ) {
      falseActivationCases += 1;
    }
    for (const skill of skills.values()) {
      if (
        scenario?.request
          ?.toLowerCase()
          .includes(`$${skill.name.toLowerCase()}`)
      ) {
        errors.push(
          `${location}.request must not disclose the expected skill command`,
        );
      }
    }
  }
  for (const scenarioId of ids) {
    if (!fixtureIds.has(scenarioId)) {
      errors.push(`canonical fixture is missing scenario ${scenarioId}`);
    }
  }
  for (const fixtureId of fixtureIds) {
    if (!ids.has(fixtureId)) {
      errors.push(`canonical fixture has no scenario ${fixtureId}`);
    }
  }
  for (const category of declaredCategories) {
    if (!coveredCategories.has(category)) {
      errors.push(`no scenario covers required category ${category}`);
    }
  }
  if (falseActivationCases === 0) {
    errors.push("at least one scenario must test false activation");
  }
  return {
    ok: errors.length === 0,
    errors,
    scenario_count: catalog?.scenarios?.length ?? 0,
    skill_count: skills.size,
    categories: [...coveredCategories].sort(),
    false_activation_cases: falseActivationCases,
    surface_hash: behaviorSurfaceHash(),
  };
}

function validateRunRecord(record, catalog = readJson(SCENARIOS_FILE)) {
  const contract = validateScenarioCatalog(catalog);
  const skills = skillCatalog();
  const errors = [...contract.errors];
  const results = [];
  if (record?.schema_version !== CURRENT_RUN_RECORD_SCHEMA_VERSION) {
    errors.push(
      `run record schema_version must equal ${CURRENT_RUN_RECORD_SCHEMA_VERSION}`,
    );
  }
  if (record?.surface_hash !== contract.surface_hash) {
    errors.push(
      `run record surface_hash must equal ${contract.surface_hash}`,
    );
  }
  for (const field of ["name", "version", "model"]) {
    if (!isCompletedField(record?.harness?.[field])) {
      errors.push(
        `run record harness.${field} must identify the actual run`,
      );
    }
  }
  if (
    !isNonEmptyString(record?.recorded_at) ||
    Number.isNaN(Date.parse(record.recorded_at))
  ) {
    errors.push("run record recorded_at must be an ISO date");
  }
  if (!Array.isArray(record?.cases)) {
    errors.push("run record cases must be an array");
  }

  const cases = asArray(record?.cases);
  const caseMap = new Map();
  const harnessSessionIds = new Set();
  for (const [index, item] of cases.entries()) {
    if (!isNonEmptyString(item?.scenario_id)) {
      errors.push(`cases[${index}].scenario_id must be a non-empty string`);
      continue;
    }
    if (caseMap.has(item.scenario_id)) {
      errors.push(`run record duplicates scenario ${item.scenario_id}`);
      continue;
    }
    caseMap.set(item.scenario_id, item);
    const sessionId = item?.harness_session?.id;
    if (isCompletedField(sessionId)) {
      if (harnessSessionIds.has(sessionId)) {
        errors.push(`run record reuses harness session ${sessionId}`);
      }
      harnessSessionIds.add(sessionId);
    }
  }

  const scenarios = asArray(catalog?.scenarios);
  for (const scenario of scenarios) {
    const item = caseMap.get(scenario.id);
    const findings = [];
    if (!item) {
      findings.push("missing run result");
    } else {
      const expectedFixtureReceipt = fixtureReceipt(scenario.id);
      if (item.fixture_receipt !== expectedFixtureReceipt) {
        findings.push(
          `fixture_receipt must equal ${expectedFixtureReceipt}`,
        );
      }
      const expectedMaterializationReceipt =
        expectedMaterializationSha256(scenario.id);
      const expectedBaseline = expectedFixtureBaseline(scenario.id);
      if (
        item.materialization_receipt !== expectedMaterializationReceipt
      ) {
        findings.push(
          `materialization_receipt must equal ${expectedMaterializationReceipt}`,
        );
      }
      if (
        item.materialization_spec_sha256 !==
        expectedMaterializationReceipt
      ) {
        findings.push(
          `materialization_spec_sha256 must equal ${expectedMaterializationReceipt}`,
        );
      }
      if (item.materialized_git_head !== expectedBaseline.git_head) {
        findings.push(
          `materialized_git_head must equal the canonical ${scenario.id} baseline commit`,
        );
      }
      if (
        item.materialized_project_tree_sha256 !==
        expectedBaseline.project_tree_sha256
      ) {
        findings.push(
          `materialized_project_tree_sha256 must equal the canonical ${scenario.id} baseline tree receipt`,
        );
      }
      if (
        GIT_COMMIT_ID.test(item.materialized_git_head ?? "") &&
        SHA256_RECEIPT.test(
          item.materialized_project_tree_sha256 ?? "",
        ) &&
        item.materialized_project_state_sha256 !==
          projectStateSha256({
            materializationSpecSha256:
              expectedMaterializationReceipt,
            gitHead: item.materialized_git_head,
            projectTreeSha256:
              item.materialized_project_tree_sha256,
          })
      ) {
        findings.push(
          "materialized_project_state_sha256 must bind the fixture specification, Git commit, and project tree",
        );
      }
      if (!GIT_COMMIT_ID.test(item.final_git_head ?? "")) {
        findings.push(
          "final_git_head must be the exact 40-character post-run Git commit",
        );
      }
      if (item.final_baseline_ancestor !== true) {
        findings.push(
          "final_baseline_ancestor must confirm that the final HEAD descends from the canonical scenario baseline",
        );
      }
      if (
        !SHA256_RECEIPT.test(item.final_project_tree_sha256 ?? "")
      ) {
        findings.push(
          "final_project_tree_sha256 must be the exact post-run project-tree receipt",
        );
      }
      if (
        GIT_COMMIT_ID.test(item.final_git_head ?? "") &&
        SHA256_RECEIPT.test(item.final_project_tree_sha256 ?? "") &&
        item.final_project_state_sha256 !==
          projectStateSha256({
            materializationSpecSha256:
              expectedMaterializationReceipt,
            gitHead: item.final_git_head,
            projectTreeSha256: item.final_project_tree_sha256,
          })
      ) {
        findings.push(
          "final_project_state_sha256 must bind the fixture specification, final Git commit, and final project tree",
        );
      }
      if (!isCompletedField(item?.harness_session?.id)) {
        findings.push(
          "harness_session.id must identify the fresh session used only for this case",
        );
      }
      if (
        item?.harness_session?.isolation !==
        "fresh-session-per-scenario"
      ) {
        findings.push(
          "harness_session.isolation must equal fresh-session-per-scenario",
        );
      }
      if (
        item?.harness_session?.execution_boundary?.tool_network_access !==
        "disabled"
      ) {
        findings.push(
          "harness_session.execution_boundary.tool_network_access must equal disabled",
        );
      }
      if (
        item?.harness_session?.execution_boundary?.user_configuration !==
        "disabled"
      ) {
        findings.push(
          "harness_session.execution_boundary.user_configuration must equal disabled",
        );
      }
      if (
        item?.harness_session?.execution_boundary
          ?.isolated_package_surface_hash !== record?.surface_hash
      ) {
        findings.push(
          "harness_session.execution_boundary.isolated_package_surface_hash must equal the evaluated behavior-surface hash",
        );
      }
      if (
        item?.harness_session?.execution_boundary
          ?.external_provider_credentials !== "scrubbed"
      ) {
        findings.push(
          "harness_session.execution_boundary.external_provider_credentials must equal scrubbed",
        );
      }
      if (
        JSON.stringify(
          item?.harness_session?.execution_boundary
            ?.scrubbed_environment_variables,
        ) !==
        JSON.stringify(EVALUATION_SCRUBBED_CREDENTIAL_ENVIRONMENT)
      ) {
        findings.push(
          "harness_session.execution_boundary.scrubbed_environment_variables must equal the canonical credential denylist",
        );
      }
      const expectedProviderAuthority =
        providerAuthorityReceipt(scenario.id);
      if (
        JSON.stringify(item.provider_authority) !==
        JSON.stringify(expectedProviderAuthority)
      ) {
        findings.push(
          "provider_authority must equal the canonical materialization authority receipt",
        );
      }
      const expectedExternalInputs = externalInputReceipts(scenario.id);
      if (
        JSON.stringify(item.external_inputs) !==
        JSON.stringify(expectedExternalInputs)
      ) {
        findings.push(
          "external_inputs must equal the canonical prompt-only input receipts",
        );
      }
      const observed = item.observed;
      if (!observed || typeof observed !== "object" || Array.isArray(observed)) {
        findings.push("observed must be an object");
      } else {
        for (const field of [
          "activated_skills",
          "performed_actions",
          "outcome_tags",
          "question_tags",
          "written_paths",
          "observable_outputs",
        ]) {
          if (!stringArray(observed[field])) {
            findings.push(`${field} must be a unique string array`);
          }
        }
        if (typeof observed.asked_clarifying_question !== "boolean") {
          findings.push("asked_clarifying_question must be boolean");
        }
        if (!nonNegativeInteger(observed.question_count)) {
          findings.push("question_count must be a non-negative integer");
        }
        if (!nonNegativeInteger(observed.max_questions_in_turn)) {
          findings.push(
            "max_questions_in_turn must be a non-negative integer",
          );
        }
        if (
          nonNegativeInteger(observed.question_count) &&
          observed.asked_clarifying_question !==
            (observed.question_count > 0)
        ) {
          findings.push(
            "asked_clarifying_question must agree with question_count",
          );
        }
        if (
          nonNegativeInteger(observed.question_count) &&
          nonNegativeInteger(observed.max_questions_in_turn) &&
          observed.max_questions_in_turn > observed.question_count
        ) {
          findings.push(
            "max_questions_in_turn cannot exceed question_count",
          );
        }
        if (
          nonNegativeInteger(observed.question_count) &&
          nonNegativeInteger(observed.max_questions_in_turn) &&
          observed.question_count > 0 &&
          observed.max_questions_in_turn === 0
        ) {
          findings.push(
            "max_questions_in_turn must be at least 1 when question_count is positive",
          );
        }
        for (const path of asArray(observed.written_paths)) {
          if (!safeScenarioPath(path)) {
            findings.push(
              `written_paths contains an unsafe project-relative path: ${path}`,
            );
          }
        }
        validateArtifactStates(
          observed.artifacts,
          "artifacts",
          findings,
        );
        for (const artifact of asArray(observed.artifacts)) {
          if (artifact?.status === "INVALID") {
            findings.push(
              `noncanonical artifact status was observed: ${artifact.path}`,
            );
          }
        }
        validateSourceClaimDispositions(
          observed.source_claim_dispositions,
          "source_claim_dispositions",
          findings,
        );
        const activated = new Set(asArray(observed.activated_skills));
        for (const name of activated) {
          if (!skills.has(name)) {
            findings.push(`unknown skill was reported as active: ${name}`);
          }
        }
        for (const name of asArray(scenario?.expected?.must_activate)) {
          if (!activated.has(name)) {
            findings.push(`required skill did not activate: ${name}`);
          }
        }
        for (const name of asArray(scenario?.expected?.must_not_activate)) {
          if (activated.has(name)) {
            findings.push(`forbidden skill activated: ${name}`);
          }
        }
        if (
          scenario?.expected?.question === "required" &&
          observed.asked_clarifying_question !== true
        ) {
          findings.push("required clarifying question was not asked");
        }
        if (
          scenario?.expected?.question === "forbidden" &&
          observed.asked_clarifying_question !== false
        ) {
          findings.push("a clarifying question was forbidden");
        }
        if (
          nonNegativeInteger(scenario?.expected?.minimum_questions) &&
          observed.question_count < scenario.expected.minimum_questions
        ) {
          findings.push(
            `at least ${scenario.expected.minimum_questions} question(s) were required`,
          );
        }
        if (
          nonNegativeInteger(scenario?.expected?.maximum_questions) &&
          observed.question_count > scenario.expected.maximum_questions
        ) {
          findings.push(
            `at most ${scenario.expected.maximum_questions} question(s) were allowed`,
          );
        }
        if (
          nonNegativeInteger(
            scenario?.expected?.maximum_questions_per_turn,
          ) &&
          observed.max_questions_in_turn >
            scenario.expected.maximum_questions_per_turn
        ) {
          findings.push(
            `at most ${scenario.expected.maximum_questions_per_turn} question(s) were allowed per turn`,
          );
        }
        const questionTags = new Set(asArray(observed.question_tags));
        for (const tag of asArray(
          scenario?.expected?.required_question_tags,
        )) {
          if (!questionTags.has(tag)) {
            findings.push(`required question tag was not observed: ${tag}`);
          }
        }
        for (const tag of asArray(
          scenario?.expected?.forbidden_question_tags,
        )) {
          if (questionTags.has(tag)) {
            findings.push(`forbidden question tag was observed: ${tag}`);
          }
        }
        const actions = new Set(asArray(observed.performed_actions));
        for (const action of asArray(scenario?.expected?.required_actions)) {
          if (!actions.has(action)) {
            findings.push(`required action was not performed: ${action}`);
          }
        }
        for (const action of asArray(scenario?.expected?.forbidden_actions)) {
          if (actions.has(action)) {
            findings.push(`forbidden action was performed: ${action}`);
          }
        }
        const outcomes = new Set(asArray(observed.outcome_tags));
        for (const outcome of asArray(scenario?.expected?.required_outcomes)) {
          if (!outcomes.has(outcome)) {
            findings.push(`required outcome was not observed: ${outcome}`);
          }
        }
        for (const pattern of asArray(
          scenario?.expected?.forbidden_write_paths,
        )) {
          for (const path of asArray(observed.written_paths)) {
            if (matchesPathPattern(path, pattern)) {
              findings.push(
                `forbidden write path was observed: ${path} matched ${pattern}`,
              );
            }
          }
        }
        const writtenPaths = new Set(asArray(observed.written_paths));
        for (const path of asArray(
          scenario?.expected?.required_write_paths,
        )) {
          if (!writtenPaths.has(path)) {
            findings.push(`required write path was absent: ${path}`);
          }
        }
        const artifacts = new Map(
          asArray(observed.artifacts).map((artifact) => [
            artifact?.path,
            artifact,
          ]),
        );
        for (const required of asArray(
          scenario?.expected?.required_artifact_states,
        )) {
          const actual = artifacts.get(required.path);
          if (!actual) {
            findings.push(
              `required artifact state was not observed: ${required.path}`,
            );
          } else if (
            actual.status !== required.status ||
            actual.lock_state !== required.lock_state
          ) {
            findings.push(
              `artifact ${required.path} expected ${required.status}/${required.lock_state} but observed ${actual.status}/${actual.lock_state}`,
            );
          }
        }
        const outputs = new Set(asArray(observed.observable_outputs));
        for (const output of asArray(
          scenario?.expected?.required_outputs,
        )) {
          if (!outputs.has(output)) {
            findings.push(`required observable output was absent: ${output}`);
          }
        }
        const claimDispositions = new Map(
          asArray(observed.source_claim_dispositions).map((claim) => [
            claim?.id,
            claim?.disposition,
          ]),
        );
        for (const claimId of asArray(
          scenario?.expected?.required_source_claim_ids,
        )) {
          if (!claimDispositions.has(claimId)) {
            findings.push(
              `required source claim was not accounted for: ${claimId}`,
            );
          }
        }
      }
      if (!isCompletedField(item?.evidence?.summary)) {
        findings.push("evidence.summary must describe the actual run");
      }
      if (!isCompletedField(item?.evidence?.source)) {
        findings.push("evidence.source must identify the actual run");
      }
    }
    results.push({
      scenario_id: scenario.id,
      category: scenario.category,
      ok: findings.length === 0,
      findings,
      evidence_source: item?.evidence?.source ?? null,
    });
  }
  for (const scenarioId of caseMap.keys()) {
    if (!scenarios.some((item) => item.id === scenarioId)) {
      errors.push(`run record contains unknown scenario ${scenarioId}`);
    }
  }
  const failedCases = results.filter((item) => !item.ok);
  return {
    ok: errors.length === 0 && failedCases.length === 0,
    errors,
    surface_hash: contract.surface_hash,
    harness: record?.harness ?? null,
    summary: {
      total: results.length,
      passed: results.length - failedCases.length,
      failed: failedCases.length,
    },
    cases: results,
  };
}

function buildScaffold(catalog = readJson(SCENARIOS_FILE)) {
  return {
    schema_version: CURRENT_RUN_RECORD_SCHEMA_VERSION,
    surface_hash: behaviorSurfaceHash(),
    harness: {
      name: "replace-with-harness-name",
      version: "replace-with-harness-version",
      model: "replace-with-model",
    },
    recorded_at: new Date().toISOString(),
    cases: asArray(catalog?.scenarios).map((scenario) => ({
      scenario_id: scenario.id,
      fixture_receipt: fixtureReceipt(scenario.id),
      materialization_receipt:
        expectedMaterializationSha256(scenario.id),
      materialization_spec_sha256:
        expectedMaterializationSha256(scenario.id),
      materialized_git_head:
        expectedFixtureBaseline(scenario.id).git_head,
      materialized_project_tree_sha256:
        expectedFixtureBaseline(scenario.id).project_tree_sha256,
      materialized_project_state_sha256:
        projectStateSha256({
          materializationSpecSha256:
            expectedMaterializationSha256(scenario.id),
          gitHead: expectedFixtureBaseline(scenario.id).git_head,
          projectTreeSha256:
            expectedFixtureBaseline(scenario.id).project_tree_sha256,
        }),
      final_git_head: "replace-with-final-git-head",
      final_project_tree_sha256:
        "replace-with-final-project-tree-sha256",
      final_project_state_sha256:
        "replace-with-final-project-state-sha256",
      final_baseline_ancestor: false,
      harness_session: {
        id: `replace-with-fresh-session-id-for-${scenario.id}`,
        isolation: "fresh-session-per-scenario",
        execution_boundary: {
          tool_network_access: "disabled",
          user_configuration: "disabled",
          isolated_package_surface_hash: behaviorSurfaceHash(),
          external_provider_credentials: "scrubbed",
          scrubbed_environment_variables: [
            ...EVALUATION_SCRUBBED_CREDENTIAL_ENVIRONMENT,
          ],
        },
      },
      provider_authority: providerAuthorityReceipt(scenario.id),
      external_inputs: externalInputReceipts(scenario.id),
      observed: {
        activated_skills: [],
        asked_clarifying_question: false,
        question_count: 0,
        max_questions_in_turn: 0,
        question_tags: [],
        performed_actions: [],
        written_paths: [],
        artifacts: [],
        outcome_tags: [],
        observable_outputs: [],
        source_claim_dispositions: [],
      },
      evidence: {
        summary: "Replace with a concise observation grounded in the run.",
        source: "Replace with a transcript, trace, or run identifier.",
      },
    })),
  };
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main(args = process.argv.slice(2)) {
  const command = args[0] ?? "contracts";
  if (command === "contracts") {
    const result = validateScenarioCatalog();
    print(result);
    if (!result.ok) {
      process.exitCode = 2;
    }
    return;
  }
  if (command === "surface-hash") {
    print({ surface_hash: behaviorSurfaceHash() });
    return;
  }
  if (command === "scaffold") {
    print(buildScaffold());
    return;
  }
  if (command === "evaluate") {
    const input = argumentValue(args, "--input");
    if (!input || !existsSync(resolve(input)) || !statSync(resolve(input)).isFile()) {
      throw new Error("evaluate requires --input pointing to a run-record file");
    }
    const result = validateRunRecord(readJson(resolve(input)));
    print(result);
    if (!result.ok) {
      process.exitCode = 2;
    }
    return;
  }
  throw new Error(
    "usage: skill-eval.mjs contracts | surface-hash | scaffold | evaluate --input FILE",
  );
}

const isEntryPoint =
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(SCRIPT_FILE);
if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

export {
  behaviorSurfaceEntries,
  behaviorSurfaceHash,
  buildScaffold,
  hashBehaviorEntries,
  parseSkillMetadata,
  readBehaviorSurfacePath,
  validateRunRecord,
  validateScenarioCatalog,
};
