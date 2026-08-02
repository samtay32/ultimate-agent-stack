#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
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
const EVIDENCE_REDACTION_MARKER = "[REDACTED]";
const RECOGNIZABLE_COORDINATOR_TOKEN = /^[a-f0-9]{64}$/i;
const COORDINATOR_TOKEN_FIELD_NAMES = new Set([
  "coordinator_token",
  "coordinatorToken",
]);
const COORDINATOR_OPTION = "--coordinator-token";
const CURRENT_RUN_RECORD_SCHEMA_VERSION = 3;
const SHA256_RECEIPT = /^sha256:[a-f0-9]{64}$/;
const GIT_COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const GIT_OBJECT_FORMATS = new Set(["sha1", "sha256"]);
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
const ACTIVATION_RECEIPT_ID = /^skill-activation-[a-f0-9]{20}$/;
const ACTIVATION_RECEIPT_HASH = /^[a-f0-9]{64}$/;
const REVIEW_RECEIPT_ID = /^[a-f0-9]{64}$/;
const REVIEW_UNAVAILABLE_STATUS = "unavailable";
const REVIEW_RESULTS = new Set(["passed", "changes-requested"]);
const REVIEW_EXPECTATIONS = new Set(["not-required", "passed", "blocked"]);
const LIVE_PROMPT_MAX_BYTES = 2 * 1024;

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
    "bin/ultimate-agent-stack.mjs",
    "STARTER_PROMPT.md",
    "assets/project-template/.agent-stack/core-policy.json",
    "assets/project-template/.agent-stack/contracts/evidence-graph.schema.json",
    "assets/project-template/.agent-stack/contracts/review-receipt.schema.json",
    "assets/project-template/.agent-stack/contracts/review-unavailable.schema.json",
    "assets/project-template/.agent-stack/contracts/reviewer-result.schema.json",
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
    "assets/project-template/CLAUDE.md",
    "assets/project-template/GEMINI.md",
    "evals/fixture-baselines.json",
    "evals/fixtures.json",
    "evals/scenarios.json",
    "scripts/skill-eval.mjs",
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

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function activationReceiptId(receipt) {
  return `skill-activation-${digest(
    canonicalJson({
      harness: receipt.harness,
      model: receipt.model,
      run_id: receipt.run_id,
      event_id: receipt.event_id,
    }),
  ).slice(0, 20)}`;
}

function reviewReceiptId(receipt) {
  const copy = { ...receipt };
  delete copy.receipt_id;
  return digest(canonicalJson(copy));
}

function reviewUnavailableReceiptId(receipt) {
  const copy = { ...receipt };
  delete copy.receipt_id;
  return digest(canonicalJson(copy));
}

function activationReceiptSha256(receipt) {
  const copy = { ...receipt };
  delete copy.receipt_sha256;
  return digest(canonicalJson(copy));
}

function gitObjectFormatForId(value) {
  if (typeof value !== "string") {
    return null;
  }
  if (value.length === 40 && /^[a-f0-9]{40}$/.test(value)) {
    return "sha1";
  }
  if (value.length === 64 && /^[a-f0-9]{64}$/.test(value)) {
    return "sha256";
  }
  return null;
}

function reviewerResultPath(value) {
  return (
    isNonEmptyString(value) &&
    value.startsWith(".agent-stack/runs/") &&
    value.endsWith(".json") &&
    safeScenarioPath(value)
  );
}

function validateActivationReceipts(receipts, observedRunId, skills, findings) {
  if (!Array.isArray(receipts)) {
    findings.push("activation_receipts must be an array");
    return [];
  }
  if (receipts.length > 128) {
    findings.push("activation_receipts must contain at most 128 receipts");
  }
  const seen = new Set();
  const derived = new Set();
  for (const [index, receipt] of receipts.entries()) {
    const location = `activation_receipts[${index}]`;
    const receiptErrors = [];
    const issue = (message) => {
      receiptErrors.push(message);
      findings.push(message);
    };
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      issue(`${location} must be an object`);
      continue;
    }
    const activationKeys = new Set([
      "id",
      "skill",
      "mode",
      "harness",
      "model",
      "run_id",
      "event_id",
      "recorded_at",
      "skill_path",
      "skill_sha256",
      "claim",
      "receipt_sha256",
    ]);
    for (const key of Object.keys(receipt)) {
      if (!activationKeys.has(key)) {
        issue(`${location} contains unsupported field ${key}`);
      }
    }
    for (const key of [
      "id",
      "skill",
      "mode",
      "harness",
      "model",
      "run_id",
      "event_id",
      "recorded_at",
      "skill_path",
      "skill_sha256",
      "claim",
    ]) {
      if (!isNonEmptyString(receipt[key])) {
        issue(`${location}.${key} must be a non-empty string`);
      }
    }
    if (!ACTIVATION_RECEIPT_ID.test(receipt.id ?? "")) {
      issue(`${location}.id must be a deterministic activation receipt id`);
    } else if (receipt.id !== activationReceiptId(receipt)) {
      issue(`${location}.id must match its deterministic activation identity`);
    }
    if (seen.has(receipt.id)) {
      issue(`${location} duplicates activation receipt ${receipt.id}`);
    }
    seen.add(receipt.id);
    if (!skills.has(receipt.skill)) {
      issue(`${location}.skill references an unknown skill`);
    }
    if (!new Set(["native", "file-read"]).has(receipt.mode)) {
      issue(`${location}.mode must be native or file-read`);
    }
    if (receipt.run_id !== observedRunId) {
      issue(`${location}.run_id must equal observed.run_id`);
    }
    if (
      !skills.has(receipt.skill) ||
      !new Set([
        `.agents/skills/${receipt.skill}/SKILL.md`,
        `.claude/skills/${receipt.skill}/SKILL.md`,
      ]).has(receipt.skill_path)
    ) {
      issue(`${location}.skill_path must be the canonical installed skill path`);
    }
    if (!ACTIVATION_RECEIPT_HASH.test(receipt.skill_sha256 ?? "")) {
      issue(`${location}.skill_sha256 must be a SHA-256 digest`);
    } else if (skills.has(receipt.skill)) {
      const canonicalHash = digest(
        readFileSync(join(PACKAGE_ROOT, skills.get(receipt.skill).path)),
      );
      if (receipt.skill_sha256 !== canonicalHash) {
        issue(`${location}.skill_sha256 must match the canonical skill content`);
      }
    }
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
        receipt.recorded_at ?? "",
      ) ||
      Number.isNaN(Date.parse(receipt.recorded_at))
    ) {
      issue(`${location}.recorded_at must be a UTC timestamp`);
    }
    if (receipt.claim !== "agent-recorded") {
      issue(`${location}.claim must equal agent-recorded`);
    }
    if (!ACTIVATION_RECEIPT_HASH.test(receipt.receipt_sha256 ?? "")) {
      issue(`${location}.receipt_sha256 must be present and be a SHA-256 digest`);
    } else if (receipt.receipt_sha256 !== activationReceiptSha256(receipt)) {
      issue(`${location}.receipt_sha256 must match its canonical content hash`);
    }
    if (receiptErrors.length === 0) {
      derived.add(receipt.skill);
    }
  }
  return [...derived].sort();
}

function validateReviewEvidence(observed, item, expectedReview, findings) {
  const receipts = observed.review_receipts;
  const unavailableReceipts = observed.review_unavailable_receipts;
  if (!Array.isArray(receipts)) {
    findings.push("review_receipts must be an array");
  }
  if (!Array.isArray(unavailableReceipts)) {
    findings.push("review_unavailable_receipts must be an array");
  }
  const validReviews = [];
  const validChangesRequested = [];
  let invalidReviewCount = 0;
  for (const [index, receipt] of asArray(receipts).entries()) {
    const location = `review_receipts[${index}]`;
    const receiptErrors = [];
    const issue = (message) => {
      receiptErrors.push(message);
      findings.push(message);
    };
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      issue(`${location} must be an object`);
      invalidReviewCount += 1;
      continue;
    }
    const reviewKeys = new Set([
      "schema_version",
      "receipt_id",
      "run_id",
      "git_commit",
      "git_object_format",
      "coordinator_id",
      "reviewer_kind",
      "reviewer_id",
      "result",
      "result_file",
      "result_file_sha256",
      "recorded_at",
      "claim",
    ]);
    for (const key of Object.keys(receipt)) {
      if (!reviewKeys.has(key)) {
        issue(`${location} contains unsupported field ${key}`);
      }
    }
    for (const key of [
      "schema_version",
      "receipt_id",
      "run_id",
      "git_commit",
      "git_object_format",
      "coordinator_id",
      "reviewer_kind",
      "reviewer_id",
      "result",
      "result_file",
      "result_file_sha256",
      "recorded_at",
      "claim",
    ]) {
      if (receipt[key] === undefined) {
        issue(`${location}.${key} is required`);
      }
    }
    if (receipt.schema_version !== 1) {
      issue(`${location}.schema_version must equal 1`);
    }
    if (!REVIEW_RECEIPT_ID.test(receipt.receipt_id ?? "")) {
      issue(`${location}.receipt_id must be a SHA-256 digest`);
    } else if (receipt.receipt_id !== reviewReceiptId(receipt)) {
      issue(`${location}.receipt_id must match its canonical content hash`);
    }
    if (receipt.run_id !== observed.run_id) {
      issue(`${location}.run_id must equal observed.run_id`);
    }
    if (!GIT_COMMIT_ID.test(receipt.git_commit ?? "")) {
      issue(`${location}.git_commit must be a full Git commit`);
    } else if (receipt.git_commit !== item.final_git_head) {
      issue(`${location}.git_commit must equal final_git_head`);
    }
    if (
      !GIT_OBJECT_FORMATS.has(receipt.git_object_format) ||
      gitObjectFormatForId(receipt.git_commit) !== receipt.git_object_format
    ) {
      issue(`${location}.git_object_format must match git_commit`);
    }
    for (const key of ["coordinator_id", "reviewer_kind", "reviewer_id"]) {
      if (!isNonEmptyString(receipt[key])) {
        issue(`${location}.${key} must be non-empty`);
      }
    }
    if (
      isNonEmptyString(receipt.reviewer_id) &&
      isNonEmptyString(receipt.coordinator_id) &&
      receipt.reviewer_id.trim().toLowerCase() ===
        receipt.coordinator_id.trim().toLowerCase()
    ) {
      issue(`${location} reviewer must be distinct from coordinator`);
    }
    if (
      isNonEmptyString(receipt.reviewer_kind) &&
      new Set(["coordinator", "primary", "project-steward"]).has(
        receipt.reviewer_kind.trim().toLowerCase(),
      )
    ) {
      issue(`${location} reviewer kind cannot identify the coordinator`);
    }
    if (!REVIEW_RESULTS.has(receipt.result)) {
      issue(`${location}.result must be passed or changes-requested`);
    }
    if (!reviewerResultPath(receipt.result_file)) {
      issue(`${location}.result_file must be a JSON reviewer-result artifact under .agent-stack/runs/`);
    }
    if (!SHA256_RECEIPT.test(receipt.result_file_sha256 ?? "")) {
      issue(`${location}.result_file_sha256 must be a SHA-256 receipt`);
    }
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
        receipt.recorded_at ?? "",
      ) ||
      Number.isNaN(Date.parse(receipt.recorded_at))
    ) {
      issue(`${location}.recorded_at must be a UTC timestamp`);
    }
    if (receipt.claim !== "agent-recorded") {
      issue(`${location}.claim must equal agent-recorded`);
    }
    if (receiptErrors.length === 0) {
      if (receipt.result === "passed") {
        validReviews.push(receipt);
      } else {
        validChangesRequested.push(receipt);
      }
    } else {
      invalidReviewCount += 1;
    }
  }
  const validUnavailable = [];
  let invalidUnavailableCount = 0;
  for (const [index, receipt] of asArray(unavailableReceipts).entries()) {
    const location = `review_unavailable_receipts[${index}]`;
    const receiptErrors = [];
    const issue = (message) => {
      receiptErrors.push(message);
      findings.push(message);
    };
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      issue(`${location} must be an object`);
      invalidUnavailableCount += 1;
      continue;
    }
    const unavailableKeys = new Set([
      "schema_version",
      "receipt_id",
      "run_id",
      "coordinator_id",
      "reason",
      "details",
      "recorded_at",
      "claim",
      "status",
    ]);
    for (const key of Object.keys(receipt)) {
      if (!unavailableKeys.has(key)) {
        issue(`${location} contains unsupported field ${key}`);
      }
    }
    for (const key of [
      "schema_version",
      "receipt_id",
      "run_id",
      "coordinator_id",
      "reason",
      "details",
      "recorded_at",
      "claim",
      "status",
    ]) {
      if (receipt[key] === undefined) {
        issue(`${location}.${key} is required`);
      }
    }
    if (receipt.schema_version !== 1) {
      issue(`${location}.schema_version must equal 1`);
    }
    if (!REVIEW_RECEIPT_ID.test(receipt.receipt_id ?? "")) {
      issue(`${location}.receipt_id must be a SHA-256 digest`);
    } else if (receipt.receipt_id !== reviewUnavailableReceiptId(receipt)) {
      issue(`${location}.receipt_id must match its canonical content hash`);
    }
    if (receipt.run_id !== observed.run_id) {
      issue(`${location}.run_id must equal observed.run_id`);
    }
    for (const key of ["coordinator_id", "reason", "details"]) {
      if (!isNonEmptyString(receipt[key])) {
        issue(`${location}.${key} must be non-empty`);
      }
    }
    if (receipt.status !== REVIEW_UNAVAILABLE_STATUS) {
      issue(`${location}.status must equal unavailable`);
    }
    if (receipt.claim !== "agent-recorded") {
      issue(`${location}.claim must equal agent-recorded`);
    }
    if (receiptErrors.length === 0) {
      validUnavailable.push(receipt);
    } else {
      invalidUnavailableCount += 1;
    }
  }
  const expected = expectedReview;
  if (!REVIEW_EXPECTATIONS.has(expected)) {
    findings.push("expected review expectation must be not-required, passed, or blocked");
  }
  const status = observed.review_status;
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    findings.push("review_status must be an object");
  }
  const hasBlockingOutcome =
    validChangesRequested.length > 0 || validUnavailable.length > 0;
  const hasInvalidOutcome = invalidReviewCount > 0 || invalidUnavailableCount > 0;
  const passes = validReviews.length > 0 && !hasBlockingOutcome && !hasInvalidOutcome;
  let derived;
  if (expected === "not-required") {
    derived = {
      independent_reviewed: false,
      review_gate_ready: false,
      status: "not-required",
    };
  } else if (expected === "passed") {
    if (!passes) {
      if (hasBlockingOutcome) {
        findings.push("review outcome was blocked");
      } else if (!hasInvalidOutcome) {
        findings.push("required passed review outcome was not observed");
      }
    }
    derived = {
      independent_reviewed: passes,
      review_gate_ready: passes,
      status: passes ? "passed" : "blocked",
    };
  } else {
    if (!hasBlockingOutcome && !hasInvalidOutcome) {
      findings.push("expected blocked review outcome was not observed");
    }
    if (hasBlockingOutcome && validReviews.length > 0) {
      findings.push("review evidence contains conflicting outcomes");
    }
    derived = {
      independent_reviewed: false,
      review_gate_ready: false,
      status: "blocked",
    };
  }
  if (
    status &&
    (status.independent_reviewed !== derived.independent_reviewed ||
      status.review_gate_ready !== derived.review_gate_ready ||
      status.status !== derived.status ||
      Object.hasOwn(status, "pr_ready"))
  ) {
    findings.push("review_status must agree with receipt-derived review readiness");
  }
  return {
    validReviews,
    validChangesRequested,
    validUnavailable,
    derived,
  };
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
    const livePrompt = JSON.stringify({
      request: scenario?.request ?? "",
      context: scenario?.context ?? {},
    });
    if (Buffer.byteLength(livePrompt, "utf8") > LIVE_PROMPT_MAX_BYTES) {
      errors.push(
        `${location} live prompt and context must be at most ${LIVE_PROMPT_MAX_BYTES} bytes`,
      );
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
    if (!REVIEW_EXPECTATIONS.has(expected.review)) {
      errors.push(
        `${location}.expected.review must be exactly not-required, passed, or blocked`,
      );
    }
    const mustActivateNames = asArray(expected.must_activate);
    const mustNotActivateNames = asArray(expected.must_not_activate);
    for (const name of [...mustActivateNames, ...mustNotActivateNames]) {
      if (!skills.has(name)) {
        errors.push(`${location} references unknown skill ${name}`);
      }
      const promptSurface = `${scenario?.request ?? ""}\n${JSON.stringify(
        scenario?.context ?? {},
      )}`.toLowerCase();
      if (promptSurface.includes(name.toLowerCase())) {
        errors.push(
          `${location}.request/context must not disclose expected skill name ${name}`,
        );
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
    for (const [index, artifact] of asArray(
      expected.required_artifact_states,
    ).entries()) {
      if (artifact?.status === "INVALID") {
        errors.push(
          `${location}.expected.required_artifact_states[${index}].status cannot be INVALID because every observed INVALID artifact fails closed`,
        );
      }
    }
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
        !GIT_OBJECT_FORMATS.has(item.materialized_git_object_format) ||
        gitObjectFormatForId(item.materialized_git_head) !==
          item.materialized_git_object_format
      ) {
        findings.push(
          "materialized_git_object_format must match materialized_git_head",
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
          "final_git_head must be the exact post-run Git commit",
        );
      }
      if (
        !GIT_OBJECT_FORMATS.has(item.final_git_object_format) ||
        gitObjectFormatForId(item.final_git_head) !== item.final_git_object_format
      ) {
        findings.push("final_git_object_format must match final_git_head");
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
        if (!isNonEmptyString(observed.run_id)) {
          findings.push("run_id must be a non-empty string");
        }
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
        const derivedActivated = validateActivationReceipts(
          observed.activation_receipts,
          observed.run_id,
          skills,
          findings,
        );
        if (
          JSON.stringify(asArray(observed.activated_skills).slice().sort()) !==
          JSON.stringify(derivedActivated)
        ) {
          findings.push(
            "activated_skills must exactly equal the skills derived from activation_receipts",
          );
        }
        const activated = new Set(derivedActivated);
        const reportedActivated = new Set(asArray(observed.activated_skills));
        const activationStatus = observed.activation_status;
        const requiredSkills = [...(scenario?.expected?.must_activate ?? [])].sort();
        const missingSkills = requiredSkills.filter(
          (skill) => !activated.has(skill),
        );
        if (
          !activationStatus ||
          typeof activationStatus !== "object" ||
          Array.isArray(activationStatus)
        ) {
          findings.push("activation_status must be an object");
        } else {
          if (activationStatus.run_id !== observed.run_id) {
            findings.push("activation_status.run_id must equal observed.run_id");
          }
          if (JSON.stringify(activationStatus.required_skills) !== JSON.stringify(requiredSkills)) {
            findings.push("activation_status.required_skills must equal expected required skills");
          }
          if (JSON.stringify(activationStatus.activated_skills) !== JSON.stringify(derivedActivated)) {
            findings.push("activation_status.activated_skills must be receipt-derived");
          }
          if (JSON.stringify(activationStatus.missing_skills) !== JSON.stringify(missingSkills)) {
            findings.push("activation_status.missing_skills must be receipt-derived");
          }
          const expectedActivationStatus = missingSkills.length === 0 ? "satisfied" : "blocked";
          if (activationStatus.status !== expectedActivationStatus) {
            findings.push("activation_status.status must reflect receipt-derived activation");
          }
        }
        validateReviewEvidence(
          observed,
          item,
          scenario?.expected?.review,
          findings,
        );
        for (const name of reportedActivated) {
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
          if (reportedActivated.has(name)) {
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
      materialized_git_object_format:
        gitObjectFormatForId(expectedFixtureBaseline(scenario.id).git_head),
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
      final_git_object_format: "replace-with-final-git-object-format",
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
        run_id: `scaffold-run:${scenario.id}`,
        activation_receipts: [],
        activation_status: {
          run_id: `scaffold-run:${scenario.id}`,
          required_skills: [...(scenario.expected?.must_activate ?? [])].sort(),
          activated_skills: [],
          missing_skills: [...(scenario.expected?.must_activate ?? [])].sort(),
          status: "blocked",
        },
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
        review_receipts: [],
        review_unavailable_receipts: [],
        review_status: {
          independent_reviewed: false,
          review_gate_ready: false,
          status: scenario.expected?.review ?? "not-required",
        },
      },
      evidence: {
        summary: "Replace with a concise observation grounded in the run.",
        source: "Replace with a transcript, trace, or run identifier.",
      },
    })),
  };
}

function summarizeRoutingRates(
  records,
  catalog = readJson(SCENARIOS_FILE),
) {
  const scenarios = new Map(
    asArray(catalog?.scenarios).map((scenario) => [scenario.id, scenario]),
  );
  const behavioralFinding = (finding) =>
    [
      /^required skill did not activate:/,
      /^forbidden skill activated:/,
      /^required clarifying question was not asked$/,
      /^a clarifying question was forbidden$/,
      /^at least \d+ question\(s\) were required$/,
      /^at most \d+ question\(s\) were allowed/,
      /^required question tag was not observed:/,
      /^forbidden question tag was observed:/,
      /^required action was not performed:/,
      /^forbidden action was performed:/,
      /^required outcome was not observed:/,
      /^forbidden write path was observed:/,
      /^required write path was absent:/,
      /^required artifact state was not observed:/,
      /^artifact .* expected .* but observed /,
      /^noncanonical artifact status was observed:/,
      /^required observable output was absent:/,
      /^required source claim was not accounted for:/,
      /^required passed review outcome was not observed$/,
      /^review outcome was blocked$/,
      /^expected blocked review outcome was not observed$/,
      /^review evidence contains conflicting outcomes$/,
    ].some((pattern) => pattern.test(finding));
  const usedSessions = new Set();
  const groups = new Map();
  const errors = [];
  for (const [recordIndex, record] of asArray(records).entries()) {
    const recordLabel = `run record ${recordIndex + 1}`;
    if (
      record?.schema_version !== CURRENT_RUN_RECORD_SCHEMA_VERSION ||
      record?.surface_hash !== behaviorSurfaceHash() ||
      !record?.harness ||
      typeof record.harness !== "object" ||
      Array.isArray(record.harness) ||
      ![
        record.harness.name,
        record.harness.version,
        record.harness.model,
      ].every(isCompletedField) ||
      !isCompletedField(record.recorded_at) ||
      Number.isNaN(Date.parse(record.recorded_at)) ||
      !Array.isArray(record.cases) ||
      record.cases.length !== scenarios.size
    ) {
      errors.push(
        `${recordLabel} is not a complete current behavioral record`,
      );
      continue;
    }
    const caseIds = record.cases.map((item) => item?.scenario_id);
    if (
      new Set(caseIds).size !== scenarios.size ||
      caseIds.some((id) => !scenarios.has(id))
    ) {
      errors.push(
        `${recordLabel} must contain each current scenario exactly once`,
      );
      continue;
    }
    const evaluation = validateRunRecord(record, catalog);
    const structuralFindings = evaluation.cases.flatMap((item) =>
      item.findings
        .filter((finding) => !behavioralFinding(finding))
        .map((finding) => `${item.scenario_id}: ${finding}`),
    );
    if (evaluation.errors.length > 0 || structuralFindings.length > 0) {
      errors.push(
        `${recordLabel} lacks current structured evidence: ${[
          ...evaluation.errors,
          ...structuralFindings,
        ][0]}`,
      );
      continue;
    }
    const sessionIds = record.cases.map(
      (item) => item.harness_session.id,
    );
    if (
      new Set(sessionIds).size !== sessionIds.length ||
      sessionIds.some((sessionId) => usedSessions.has(sessionId))
    ) {
      errors.push(`${recordLabel} reuses a harness session`);
      continue;
    }
    sessionIds.forEach((sessionId) => usedSessions.add(sessionId));

    const harness = {
      name: record.harness.name,
      version: record.harness.version,
      model: record.harness.model,
    };
    const groupKey = JSON.stringify(harness);
    const group = groups.get(groupKey) ?? {
      harness,
      run_records: 0,
      evaluated_runs_passed: 0,
      requiredSkills: new Map(),
      forbiddenSkills: new Map(),
      routes: new Map(),
      activationReceiptOutcomes: new Map(),
      reviewOutcomes: new Map(),
      matchedConstraints: 0,
      constraints: 0,
      matchedScenarios: 0,
      scenarioAttempts: 0,
    };
    group.run_records += 1;
    if (evaluation.ok) {
      group.evaluated_runs_passed += 1;
    }
    for (const item of record.cases) {
      const scenario = scenarios.get(item?.scenario_id);
      const activationReceiptOutcome =
        item.observed.activation_status?.status ??
        (asArray(item.observed.activation_receipts).length > 0
          ? "recorded"
          : "missing");
      const activationOutcomeKey = `${scenario.id}\0${activationReceiptOutcome}`;
      const activationOutcome =
        group.activationReceiptOutcomes.get(activationOutcomeKey) ?? {
          scenario_id: scenario.id,
          outcome: activationReceiptOutcome,
          observed: 0,
          attempts: 0,
        };
      activationOutcome.observed += 1;
      activationOutcome.attempts += 1;
      group.activationReceiptOutcomes.set(activationOutcomeKey, activationOutcome);
      const reviewOutcome = item.observed.review_status?.status ?? "missing";
      const reviewOutcomeKey = `${scenario.id}\0${reviewOutcome}`;
      const reviewOutcomeCount = group.reviewOutcomes.get(reviewOutcomeKey) ?? {
        scenario_id: scenario.id,
        outcome: reviewOutcome,
        observed: 0,
        attempts: 0,
      };
      reviewOutcomeCount.observed += 1;
      reviewOutcomeCount.attempts += 1;
      group.reviewOutcomes.set(reviewOutcomeKey, reviewOutcomeCount);
      const activated = new Set(item.observed.activated_skills);
      let scenarioMatched = true;
      let scenarioConstraints = 0;
      for (const [expected, skills] of [
        ["activate", asArray(scenario.expected?.must_activate)],
        ["not-activate", asArray(scenario.expected?.must_not_activate)],
      ]) {
        for (const skill of skills) {
          const observedActivated = activated.has(skill);
          const matched =
            observedActivated === (expected === "activate") ? 1 : 0;
          const skillMap =
            expected === "activate"
              ? group.requiredSkills
              : group.forbiddenSkills;
          const skillCount = skillMap.get(skill) ?? {
            skill,
            matched: 0,
            opportunities: 0,
          };
          skillCount.matched += matched;
          skillCount.opportunities += 1;
          skillMap.set(skill, skillCount);

          const routeKey = `${scenario.id}\0${skill}\0${expected}`;
          const routeCount = group.routes.get(routeKey) ?? {
            scenario_id: scenario.id,
            skill,
            expected,
            matched: 0,
            observed_activated: 0,
            attempts: 0,
          };
          routeCount.matched += matched;
          routeCount.observed_activated += observedActivated ? 1 : 0;
          routeCount.attempts += 1;
          group.routes.set(routeKey, routeCount);
          group.matchedConstraints += matched;
          group.constraints += 1;
          scenarioMatched &&= matched === 1;
          scenarioConstraints += 1;
        }
      }
      if (scenarioConstraints > 0) {
        group.matchedScenarios += scenarioMatched ? 1 : 0;
        group.scenarioAttempts += 1;
      }
    }
    groups.set(groupKey, group);
  }
  for (const group of groups.values()) {
    if (group.run_records < 2) {
      errors.push(
        `${group.harness.name} ${group.harness.version} / ${group.harness.model} has ${group.run_records}/2 required independent run records`,
      );
    }
  }
  const rate = (matched, opportunities) =>
    `${matched}/${opportunities}`;
  const skillRates = (items, matchedLabel) =>
    [...items.values()]
      .sort((left, right) => left.skill.localeCompare(right.skill))
      .map((item) => ({
        skill: item.skill,
        [matchedLabel]: item.matched,
        opportunities: item.opportunities,
        rate: rate(item.matched, item.opportunities),
      }));
  const outcomeRates = (items) => {
    const values = [...items.values()];
    const attemptsByScenario = new Map();
    for (const item of values) {
      attemptsByScenario.set(
        item.scenario_id,
        (attemptsByScenario.get(item.scenario_id) ?? 0) + item.attempts,
      );
    }
    return values
      .sort(
        (left, right) =>
          left.scenario_id.localeCompare(right.scenario_id) ||
          left.outcome.localeCompare(right.outcome),
      )
      .map((item) => ({
        ...item,
        attempts: attemptsByScenario.get(item.scenario_id),
        rate: rate(
          item.observed,
          attemptsByScenario.get(item.scenario_id),
        ),
      }));
  };
  return {
    ok: errors.length === 0,
    errors,
    surface_hash: behaviorSurfaceHash(),
    boundary:
      "Rates summarize complete independent recorded observations. They do not authenticate that a collector described a run truthfully.",
    groups: [...groups.values()]
      .sort((left, right) =>
        JSON.stringify(left.harness).localeCompare(
          JSON.stringify(right.harness),
        ),
      )
      .map((group) => ({
        harness: group.harness,
        run_records: group.run_records,
        reliability_ready: group.run_records >= 2,
        evaluated_runs_passed: group.evaluated_runs_passed,
        scenario_route_accuracy: {
          matched: group.matchedScenarios,
          opportunities: group.scenarioAttempts,
          rate: rate(group.matchedScenarios, group.scenarioAttempts),
        },
        constraint_micro_accuracy: {
          matched: group.matchedConstraints,
          opportunities: group.constraints,
          rate: rate(group.matchedConstraints, group.constraints),
        },
        required_activation_recall: skillRates(
          group.requiredSkills,
          "activated",
        ),
        forbidden_activation_compliance: skillRates(
          group.forbiddenSkills,
          "not_activated",
        ),
        activation_receipt_outcomes: outcomeRates(
          group.activationReceiptOutcomes,
        ),
        review_outcomes: outcomeRates(group.reviewOutcomes),
        routes: [...group.routes.values()]
          .sort(
            (left, right) =>
              left.scenario_id.localeCompare(right.scenario_id) ||
              left.skill.localeCompare(right.skill) ||
              left.expected.localeCompare(right.expected),
          )
          .map((item) => ({
            ...item,
            rate: rate(item.matched, item.attempts),
          })),
      })),
  };
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}

function argumentValues(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function decodeEvidenceString(value) {
  const candidate = String(value ?? "");
  try {
    return JSON.parse(`"${candidate}"`);
  } catch {
    // Evidence may contain a partially escaped line from a failed tool call.
    // Decode the quote/backslash pairs that are relevant to token discovery,
    // while leaving the bytes being exported untouched.
    let decoded = "";
    for (let index = 0; index < candidate.length; index += 1) {
      if (
        candidate[index] === "\\" &&
        index + 1 < candidate.length &&
        ["\\", '"', "'"].includes(candidate[index + 1])
      ) {
        decoded += candidate[index + 1];
        index += 1;
      } else {
        decoded += candidate[index];
      }
    }
    return decoded;
  }
}

function rememberCoordinatorToken(discovered, value) {
  const token = decodeEvidenceString(value).trim();
  if (RECOGNIZABLE_COORDINATOR_TOKEN.test(token)) {
    discovered.add(token);
  }
}

function isHexCharacter(value) {
  return (
    (value >= "0" && value <= "9") ||
    (value >= "a" && value <= "f") ||
    (value >= "A" && value <= "F")
  );
}

function isRecognizableTokenAt(text, start) {
  if (start < 0 || start + 64 > text.length) {
    return false;
  }
  for (let index = start; index < start + 64; index += 1) {
    if (!isHexCharacter(text[index])) {
      return false;
    }
  }
  return true;
}

function countBackslashesBefore(text, index) {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    count += 1;
    if (count > 1_024) {
      return count;
    }
  }
  return count;
}

function readEscapedDelimiter(text, start, delimiter) {
  let slashCount = 0;
  let cursor = start;
  while (cursor < text.length && text[cursor] === "\\") {
    slashCount += 1;
    cursor += 1;
    if (slashCount > 1_024) {
      return null;
    }
  }
  return text[cursor] === delimiter
    ? { quote: cursor, slashes: slashCount, delimiter }
    : null;
}

function readEscapedQuote(text, start) {
  return readEscapedDelimiter(text, start, '"');
}

function readShellDelimiter(text, start) {
  let cursor = start;
  while (cursor < text.length && text[cursor] === "\\") {
    cursor += 1;
  }
  return ["'", '"'].includes(text[cursor])
    ? readEscapedDelimiter(text, start, text[cursor])
    : null;
}

function findEscapedQuoteEnd(
  text,
  openingQuote,
  openingSlashes,
  delimiter = '"',
) {
  let slashCount = 0;
  for (let cursor = openingQuote + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (character === "\\") {
      slashCount += 1;
      continue;
    }
    if (character === delimiter && slashCount === openingSlashes) {
      return cursor;
    }
    slashCount = 0;
  }
  return -1;
}

function skipHorizontalWhitespace(text, start) {
  let cursor = start;
  while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) {
    cursor += 1;
  }
  return cursor;
}

function coordinatorFieldAt(text, start, name) {
  if (!text.startsWith(name, start)) {
    return null;
  }
  const keyQuote = start - 1 - countBackslashesBefore(text, start);
  if (keyQuote < 0 || text[keyQuote] !== '"') {
    return null;
  }
  const keyEnd = start + name.length;
  const keyClosing = readEscapedQuote(text, keyEnd);
  if (!keyClosing) {
    return null;
  }
  let cursor = skipHorizontalWhitespace(text, keyClosing.quote + 1);
  if (text[cursor] !== ":") {
    return null;
  }
  cursor = skipHorizontalWhitespace(text, cursor + 1);
  const valueOpening = readEscapedQuote(text, cursor);
  if (!valueOpening) {
    return {
      valueStart: cursor,
      valueEnd: -1,
      end: cursor,
    };
  }
  const valueEnd = findEscapedQuoteEnd(
    text,
    valueOpening.quote,
    valueOpening.slashes,
  );
  return {
    valueStart: valueOpening.quote + 1,
    valueEnd,
    suffixStart:
      valueEnd === -1
        ? text.length
        : valueEnd - countBackslashesBefore(text, valueEnd),
    end: valueEnd === -1 ? text.length : valueEnd + 1,
  };
}

function coordinatorOptionAt(text, start) {
  if (!text.startsWith(COORDINATOR_OPTION, start)) {
    return null;
  }
  const optionEnd = start + COORDINATOR_OPTION.length;
  if (
    optionEnd < text.length &&
    text[optionEnd] !== "=" &&
    text[optionEnd] !== " " &&
    text[optionEnd] !== "\t"
  ) {
    return null;
  }
  let cursor = optionEnd;
  if (text[cursor] === "=") {
    cursor = skipHorizontalWhitespace(text, cursor + 1);
  } else {
    cursor = skipHorizontalWhitespace(text, cursor);
  }
  if (cursor >= text.length) {
    return null;
  }
  const opening = readShellDelimiter(text, cursor);
  if (opening) {
    const valueEnd = findEscapedQuoteEnd(
      text,
      opening.quote,
      opening.slashes,
      opening.delimiter,
    );
    return {
      valueStart: opening.quote + 1,
      valueEnd,
      suffixStart:
        valueEnd === -1
          ? text.length
          : valueEnd - countBackslashesBefore(text, valueEnd),
      end: valueEnd === -1 ? text.length : valueEnd + 1,
    };
  }
  let valueEnd = cursor;
  while (
    valueEnd < text.length &&
    ![" ", "\t", "\r", "\n", "'", '"', "`", "\\"].includes(
      text[valueEnd],
    )
  ) {
    valueEnd += 1;
  }
  return { valueStart: cursor, valueEnd, end: valueEnd };
}

function jsonArrayOptionAt(text, start) {
  if (!text.startsWith(COORDINATOR_OPTION, start)) {
    return null;
  }
  const optionOpening = countBackslashesBefore(text, start);
  const optionQuote = start - optionOpening - 1;
  if (optionQuote < 0 || text[optionQuote] !== '"') {
    return null;
  }
  const optionClosing = readEscapedQuote(text, start + COORDINATOR_OPTION.length);
  if (!optionClosing) {
    return null;
  }
  let cursor = skipHorizontalWhitespace(text, optionClosing.quote + 1);
  if (text[cursor] !== ",") {
    return null;
  }
  cursor = skipHorizontalWhitespace(text, cursor + 1);
  const valueOpening = readEscapedQuote(text, cursor);
  if (!valueOpening) {
    return null;
  }
  const valueEnd = findEscapedQuoteEnd(
    text,
    valueOpening.quote,
    valueOpening.slashes,
  );
  return {
    valueStart: valueOpening.quote + 1,
    valueEnd,
    suffixStart:
      valueEnd === -1
        ? text.length
        : valueEnd - countBackslashesBefore(text, valueEnd),
    end: valueEnd === -1 ? text.length : valueEnd + 1,
  };
}

function redactCoordinatorContexts(text, discovered) {
  let output = "";
  let copiedThrough = 0;
  for (let index = 0; index < text.length; index += 1) {
    let field = null;
    for (const name of COORDINATOR_TOKEN_FIELD_NAMES) {
      field = coordinatorFieldAt(text, index, name);
      if (field) {
        break;
      }
    }
    const context = field ?? jsonArrayOptionAt(text, index) ?? coordinatorOptionAt(text, index);
    if (!context) {
      continue;
    }
    if (context.valueEnd < context.valueStart) {
      index = context.end - 1;
      continue;
    }
    const value = text.slice(context.valueStart, context.valueEnd);
    rememberCoordinatorToken(discovered, value);
    output += text.slice(copiedThrough, context.valueStart);
    output += EVIDENCE_REDACTION_MARKER;
    copiedThrough = context.suffixStart ?? context.valueEnd;
    index = context.end - 1;
  }
  return copiedThrough === 0
    ? text
    : `${output}${text.slice(copiedThrough)}`;
}

function replaceDiscoveredTokens(text, discovered) {
  const tokens = new Set([...discovered].map((token) => token.toLowerCase()));
  if (tokens.size === 0) {
    return text;
  }
  let output = "";
  let copiedThrough = 0;
  for (let index = 0; index <= text.length - 64; index += 1) {
    if (!isRecognizableTokenAt(text, index)) {
      continue;
    }
    const token = text.slice(index, index + 64);
    if (!tokens.has(token.toLowerCase())) {
      continue;
    }
    output += text.slice(copiedThrough, index);
    output += EVIDENCE_REDACTION_MARKER;
    index += 63;
    copiedThrough = index + 1;
  }
  return copiedThrough === 0
    ? text
    : `${output}${text.slice(copiedThrough)}`;
}

function tokenBeforeFieldDelimiter(text, start) {
  for (let index = start; index <= text.length - 64; index += 1) {
    if ([",", "}", "]", "\r", "\n"].includes(text[index])) {
      return null;
    }
    if (isRecognizableTokenAt(text, index)) {
      return text.slice(index, index + 64);
    }
  }
  return null;
}

function recursivelyRedactJson(value, discovered, depth = 0) {
  if (depth > 64) {
    return { value, changed: false };
  }
  if (typeof value === "string") {
    let nested;
    try {
      nested = JSON.parse(value);
    } catch {
      const redacted = redactCoordinatorContexts(value, discovered);
      return redacted === value
        ? { value, changed: false }
        : { value: redacted, changed: true };
    }
    if (!nested || typeof nested !== "object") {
      const redacted = redactCoordinatorContexts(value, discovered);
      return redacted === value
        ? { value, changed: false }
        : { value: redacted, changed: true };
    }
    const result = recursivelyRedactJson(nested, discovered, depth + 1);
    return result.changed
      ? { value: JSON.stringify(result.value), changed: true }
      : { value, changed: false };
  }

  if (Array.isArray(value)) {
    let changed = false;
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (typeof item === "string") {
        if (item === "--coordinator-token" && typeof value[index + 1] === "string") {
          rememberCoordinatorToken(discovered, value[index + 1]);
          value[index + 1] = EVIDENCE_REDACTION_MARKER;
          changed = true;
          index += 1;
          continue;
        }
        if (item.startsWith("--coordinator-token=")) {
          rememberCoordinatorToken(
            discovered,
            item.slice("--coordinator-token=".length),
          );
          value[index] = `--coordinator-token=${EVIDENCE_REDACTION_MARKER}`;
          changed = true;
          continue;
        }
      }
      const result = recursivelyRedactJson(item, discovered, depth + 1);
      if (result.changed) {
        value[index] = result.value;
        changed = true;
      }
    }
    return { value, changed };
  }

  if (value && typeof value === "object") {
    let changed = false;
    for (const [key, item] of Object.entries(value)) {
      if (COORDINATOR_TOKEN_FIELD_NAMES.has(key)) {
        if (typeof item === "string") {
          rememberCoordinatorToken(discovered, item);
        }
        value[key] = EVIDENCE_REDACTION_MARKER;
        changed = true;
        continue;
      }
      const result = recursivelyRedactJson(item, discovered, depth + 1);
      if (result.changed) {
        value[key] = result.value;
        changed = true;
      }
    }
    return { value, changed };
  }

  return { value, changed: false };
}

function redactEvidenceLines(text, discovered) {
  return text
    .split("\n")
    .map((line) => {
      const hasCarriageReturn = line.endsWith("\r");
      const body = hasCarriageReturn ? line.slice(0, -1) : line;
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        const redacted = redactCoordinatorContexts(body, discovered);
        return `${redacted}${hasCarriageReturn ? "\r" : ""}`;
      }
      const result = recursivelyRedactJson(parsed, discovered);
      if (!result.changed) {
        return line;
      }
      return `${JSON.stringify(result.value)}${hasCarriageReturn ? "\r" : ""}`;
    })
    .join("\n");
}

function remainingCoordinatorTokens(text, discovered) {
  const remaining = new Set();
  const inspect = (value) => {
    const token = decodeEvidenceString(value).trim();
    if (RECOGNIZABLE_COORDINATOR_TOKEN.test(token)) {
      remaining.add(token);
    }
  };
  for (let index = 0; index < text.length; index += 1) {
    let context = null;
    for (const name of COORDINATOR_TOKEN_FIELD_NAMES) {
      context = coordinatorFieldAt(text, index, name);
      if (context) {
        break;
      }
    }
    context = context ?? jsonArrayOptionAt(text, index) ?? coordinatorOptionAt(text, index);
    if (!context) {
      continue;
    }
    if (context.valueEnd >= context.valueStart) {
      inspect(text.slice(context.valueStart, context.valueEnd));
      index = context.end - 1;
    } else {
      const token = tokenBeforeFieldDelimiter(text, context.valueStart);
      if (token) {
        remaining.add(token);
      }
      index = context.end - 1;
    }
  }
  const knownTokens = new Set(
    [...discovered].map((token) => token.toLowerCase()),
  );
  for (let index = 0; index <= text.length - 64; index += 1) {
    if (!isRecognizableTokenAt(text, index)) {
      continue;
    }
    const token = text.slice(index, index + 64);
    if (knownTokens.has(token.toLowerCase())) {
      remaining.add(token);
      index += 63;
    }
  }
  return remaining;
}

/**
 * Redact coordinator bearer tokens from a text or JSONL evidence stream.
 *
 * The input is never written by this function. Callers can write the returned
 * string to a separate export path after this fail-closed check succeeds.
 */
function sanitizeEvidenceText(rawEvidence) {
  if (typeof rawEvidence !== "string") {
    throw new TypeError("evidence must be a text string");
  }

  const discovered = new Set();
  // Parse each JSONL line first. This gives escaped strings an exact JSON
  // boundary (including nested JSON strings) before textual fallback patterns
  // handle shell transcripts and malformed/non-JSON lines.
  let redacted = redactEvidenceLines(rawEvidence, discovered);

  // A discovered bearer value can recur in a trace field, a nested JSONL
  // payload, or a repeated command. Replace every exact/case variant before
  // validating the exported bytes.
  redacted = replaceDiscoveredTokens(redacted, discovered);

  const remaining = remainingCoordinatorTokens(redacted, discovered);
  if (remaining.size > 0) {
    throw new Error("evidence export still contains recognizable coordinator token(s)");
  }
  return redacted;
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
  if (command === "export-evidence") {
    const input = argumentValue(args, "--input");
    const output = argumentValue(args, "--output");
    if (!input || !existsSync(resolve(input)) || !statSync(resolve(input)).isFile()) {
      throw new Error("export-evidence requires --input pointing to a text evidence file");
    }
    if (!output) {
      throw new Error("export-evidence requires --output pointing to a separate redacted file");
    }
    const inputPath = resolve(input);
    const outputPath = resolve(output);
    if (inputPath === outputPath) {
      throw new Error("export-evidence refuses to overwrite the private raw evidence");
    }
    if (
      existsSync(outputPath) &&
      realpathSync(inputPath) === realpathSync(outputPath)
    ) {
      throw new Error("export-evidence refuses to overwrite the private raw evidence");
    }
    const redacted = sanitizeEvidenceText(readFileSync(inputPath, "utf8"));
    writeFileSync(outputPath, redacted, "utf8");
    print({
      ok: true,
      input: inputPath,
      output: outputPath,
      raw_preserved: true,
      redacted_bytes: Buffer.byteLength(redacted, "utf8"),
    });
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
  if (command === "routing-rate") {
    const inputs = argumentValues(args, "--input");
    if (
      inputs.length === 0 ||
      inputs.some(
        (input) =>
          !existsSync(resolve(input)) || !statSync(resolve(input)).isFile(),
      )
    ) {
      throw new Error(
        "routing-rate requires one or more --input run-record files",
      );
    }
    const inputPaths = inputs.map((input) => resolve(input));
    const result = summarizeRoutingRates(
      inputPaths.map((inputPath) => readJson(inputPath)),
    );
    print({
      ...result,
      command: "routing-rate",
      input_paths: inputPaths,
      invocation: {
        command: "node scripts/skill-eval.mjs routing-rate",
        input_paths: inputPaths,
      },
    });
    if (!result.ok) {
      process.exitCode = 2;
    }
    return;
  }
  throw new Error(
    "usage: skill-eval.mjs contracts | surface-hash | scaffold | export-evidence --input FILE --output FILE | evaluate --input FILE | routing-rate --input FILE [--input FILE ...]",
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
  sanitizeEvidenceText,
  summarizeRoutingRates,
  validateRunRecord,
  validateScenarioCatalog,
};
