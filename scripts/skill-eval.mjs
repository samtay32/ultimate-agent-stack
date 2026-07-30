#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

import {
  startPromptPolicySurface,
  validateReviewReceipt,
} from "../bin/ultimate-agent-stack.mjs";
import {
  capabilityPreflightAttestationSha256,
  canonicalPayloadSerialization,
  sha256Bytes,
  validateReviewAttestationKeyring,
  verifyCapabilityAttestation,
  verifyCapabilityPreflightAttestation,
  verifyReviewAttestation,
} from "../lib/review-attestation.mjs";
import {
  EVALUATION_SCRUBBED_CREDENTIAL_ENVIRONMENT,
  LIVE_LINEAR_SANDBOX_OPT_IN,
  expectedFixtureBaseline,
  expectedMaterializationSha256,
  externalInputsForFixture,
  fixtureCatalog,
  fixtureReceipt,
  projectStateSha256,
  reviewEnvironmentForFixture,
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
const CURRENT_RUN_RECORD_SCHEMA_VERSION = 4;
const EVALUATION_AUTHORITY_KIND = "uas.evaluation-authority/v1";
const SHA256_RECEIPT = /^sha256:[a-f0-9]{64}$/;
const GIT_COMMIT_ID = /^[a-f0-9]{40}$/;
const AUTHORITY_IDENTIFIER = /^[a-z][a-z0-9]*(?:[-_.:][a-z0-9]+)*$/;
const REVIEW_RECEIPT_PATH =
  /^\.agent-stack\/review-receipts\/[a-f0-9]{64}\.json$/;
const REVIEW_MECHANISMS = new Set([
  "native-subagent",
  "isolated-session",
  "external-provider",
  "human",
]);
const REVIEW_GATES = new Set([
  "signed-review-required",
  "signed-all-disabled",
]);
const POST_REVIEW_EVIDENCE_PATHS = new Set([
  ".agent-stack/artifacts/PRE_PR_REVIEW.md",
  ".agent-stack/evidence-graph.json",
  ".agent-stack/work-items.json",
]);
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
    "assets/project-template/.agent-stack/artifacts/PRE_PR_REVIEW.md",
    "assets/project-template/.agent-stack/artifacts/SECURITY.md",
    "assets/project-template/.agent-stack/artifacts/VERIFICATION.md",
    "assets/project-template/.agent-stack/contracts/review-receipt.schema.json",
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
    "lib/review-attestation.mjs",
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

function isUtcTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function timestampWithin(value, lower, upper) {
  return (
    isUtcTimestamp(value) &&
    isUtcTimestamp(lower) &&
    isUtcTimestamp(upper) &&
    Date.parse(value) >= Date.parse(lower) &&
    Date.parse(value) <= Date.parse(upper)
  );
}

function authorityCaseWindow(authority, authorityCase) {
  return {
    lower: authorityCase?.not_before ?? authority?.issued_at,
    upper: authorityCase?.deadline ?? authority?.expires_at,
  };
}

function validateEvaluationAuthorityManifest(
  authority,
  catalog = readJson(SCENARIOS_FILE),
) {
  const errors = [];
  const caseMap = new Map();
  if (!authority || typeof authority !== "object" || Array.isArray(authority)) {
    return {
      ok: false,
      errors: ["evaluation authority must be an object"],
      caseMap,
    };
  }
  const expectedKeys = new Set([
    "schema_version",
    "kind",
    "batch_id",
    "surface_hash",
    "issued_at",
    "expires_at",
    "cases",
    "trusted_review_keyring",
  ]);
  for (const key of Object.keys(authority)) {
    if (!expectedKeys.has(key)) {
      errors.push(`evaluation authority contains unknown field ${key}`);
    }
  }
  if (authority.schema_version !== 1) {
    errors.push("evaluation authority schema_version must equal 1");
  }
  if (authority.kind !== EVALUATION_AUTHORITY_KIND) {
    errors.push(
      `evaluation authority kind must equal ${EVALUATION_AUTHORITY_KIND}`,
    );
  }
  if (
    typeof authority.batch_id !== "string" ||
    authority.batch_id.length > 128 ||
    !AUTHORITY_IDENTIFIER.test(authority.batch_id) ||
    !isCompletedField(authority.batch_id)
  ) {
    errors.push(
      "evaluation authority batch_id must be a bounded unique identifier",
    );
  }
  const expectedSurface = behaviorSurfaceHash();
  if (authority.surface_hash !== expectedSurface) {
    errors.push(
      `evaluation authority surface_hash must equal ${expectedSurface}`,
    );
  }
  if (!isUtcTimestamp(authority.issued_at)) {
    errors.push("evaluation authority issued_at must be a UTC timestamp");
  }
  if (!isUtcTimestamp(authority.expires_at)) {
    errors.push("evaluation authority expires_at must be a UTC timestamp");
  }
  if (
    isUtcTimestamp(authority.issued_at) &&
    isUtcTimestamp(authority.expires_at) &&
    Date.parse(authority.expires_at) <= Date.parse(authority.issued_at)
  ) {
    errors.push(
      "evaluation authority expires_at must follow issued_at",
    );
  }
  const keyringValidation = validateReviewAttestationKeyring(
    authority.trusted_review_keyring,
    {
      now: isUtcTimestamp(authority.issued_at)
        ? authority.issued_at
        : new Date(),
    },
  );
  if (!keyringValidation.ok) {
    errors.push(
      ...keyringValidation.errors.map(
        (error) => `evaluation authority trusted_review_keyring: ${error}`,
      ),
    );
  }
  if (!Array.isArray(authority.cases)) {
    errors.push("evaluation authority cases must be an array");
  }
  const expectedScenarioIds = new Set(
    asArray(catalog?.scenarios)
      .filter((scenario) => scenario?.expected?.required_review_gate)
      .map((scenario) => scenario.id),
  );
  const projectInstances = new Set();
  const primarySessions = new Set();
  const projectRoots = new Set();
  for (const [index, authorityCase] of asArray(authority.cases).entries()) {
    const label = `evaluation authority cases[${index}]`;
    if (
      !authorityCase ||
      typeof authorityCase !== "object" ||
      Array.isArray(authorityCase)
    ) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const expectedCaseKeys = new Set([
      "scenario_id",
      "project_instance_sha256",
      "project_root",
      "materialized_git_head",
      "primary_session_id",
      "not_before",
      "deadline",
    ]);
    for (const key of Object.keys(authorityCase)) {
      if (!expectedCaseKeys.has(key)) {
        errors.push(`${label} contains unknown field ${key}`);
      }
    }
    if (!expectedScenarioIds.has(authorityCase.scenario_id)) {
      errors.push(
        `${label}.scenario_id must identify a review-bearing scenario`,
      );
    } else if (caseMap.has(authorityCase.scenario_id)) {
      errors.push(
        `evaluation authority duplicates scenario ${authorityCase.scenario_id}`,
      );
    } else {
      caseMap.set(authorityCase.scenario_id, authorityCase);
    }
    if (!SHA256_RECEIPT.test(authorityCase.project_instance_sha256 ?? "")) {
      errors.push(`${label}.project_instance_sha256 must be a sha256 receipt`);
    } else if (projectInstances.has(authorityCase.project_instance_sha256)) {
      errors.push(
        `${label}.project_instance_sha256 must be unique within the batch`,
      );
    } else {
      projectInstances.add(authorityCase.project_instance_sha256);
    }
    if (
      typeof authorityCase.project_root !== "string" ||
      !isAbsolute(authorityCase.project_root) ||
      resolve(authorityCase.project_root) !== authorityCase.project_root ||
      authorityCase.project_root === parse(authorityCase.project_root).root
    ) {
      errors.push(
        `${label}.project_root must be a canonical absolute non-root path`,
      );
    } else {
      const overlappingRoot = [...projectRoots].find(
        (existingRoot) =>
          pathIsWithin(existingRoot, authorityCase.project_root) ||
          pathIsWithin(authorityCase.project_root, existingRoot),
      );
      if (overlappingRoot) {
        errors.push(
          `${label}.project_root must not equal, contain, or be contained by another case project_root`,
        );
      } else {
        projectRoots.add(authorityCase.project_root);
      }
    }
    const expectedBaseline = expectedScenarioIds.has(
      authorityCase.scenario_id,
    )
      ? expectedFixtureBaseline(authorityCase.scenario_id)
      : null;
    if (
      !GIT_COMMIT_ID.test(authorityCase.materialized_git_head ?? "") ||
      (expectedBaseline &&
        authorityCase.materialized_git_head !== expectedBaseline.git_head)
    ) {
      errors.push(
        `${label}.materialized_git_head must equal the canonical scenario baseline`,
      );
    }
    if (
      !isCompletedField(authorityCase.primary_session_id) ||
      authorityCase.primary_session_id.length > 256
    ) {
      errors.push(
        `${label}.primary_session_id must be a bounded session identifier`,
      );
    } else if (primarySessions.has(authorityCase.primary_session_id)) {
      errors.push(
        `${label}.primary_session_id must be unique within the batch`,
      );
    } else {
      primarySessions.add(authorityCase.primary_session_id);
    }
    for (const field of ["not_before", "deadline"]) {
      if (
        authorityCase[field] !== undefined &&
        authorityCase[field] !== null &&
        !isUtcTimestamp(authorityCase[field])
      ) {
        errors.push(`${label}.${field} must be null or a UTC timestamp`);
      }
    }
    const window = authorityCaseWindow(authority, authorityCase);
    if (
      isUtcTimestamp(window.lower) &&
      isUtcTimestamp(window.upper) &&
      Date.parse(window.upper) <= Date.parse(window.lower)
    ) {
      errors.push(`${label} authority window must have positive duration`);
    }
    if (
      isUtcTimestamp(authority.issued_at) &&
      isUtcTimestamp(window.lower) &&
      Date.parse(window.lower) < Date.parse(authority.issued_at)
    ) {
      errors.push(`${label}.not_before cannot precede authority issued_at`);
    }
    if (
      isUtcTimestamp(authority.expires_at) &&
      isUtcTimestamp(window.upper) &&
      Date.parse(window.upper) > Date.parse(authority.expires_at)
    ) {
      errors.push(`${label}.deadline cannot exceed authority expires_at`);
    }
  }
  for (const scenarioId of expectedScenarioIds) {
    if (!caseMap.has(scenarioId)) {
      errors.push(
        `evaluation authority is missing review-bearing scenario ${scenarioId}`,
      );
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    caseMap,
  };
}

function pathIsWithin(root, candidate) {
  const relation = relative(root, candidate);
  return (
    relation === "" ||
    (!isAbsolute(relation) &&
      relation !== ".." &&
      !relation.startsWith(`..${sep}`))
  );
}

function assertNoSymlinkComponents(absolutePath, label) {
  const parsed = parse(absolutePath);
  let cursor = parsed.root;
  for (const part of absolutePath.slice(parsed.root.length).split(sep)) {
    if (!part) {
      continue;
    }
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`${label} must not contain symlink path components`);
    }
  }
}

function readEvaluationAuthorityFile(
  authorityPath,
  inputPath,
  catalog = readJson(SCENARIOS_FILE),
) {
  if (!isAbsolute(authorityPath)) {
    throw new Error(
      "evaluate --evaluation-authority must be an absolute outer-controlled path",
    );
  }
  const resolvedAuthority = resolve(authorityPath);
  if (
    !existsSync(resolvedAuthority) ||
    !lstatSync(resolvedAuthority).isFile()
  ) {
    throw new Error(
      "evaluate --evaluation-authority must point to a regular file",
    );
  }
  assertNoSymlinkComponents(
    resolvedAuthority,
    "evaluate --evaluation-authority",
  );
  const authorityStat = statSync(resolvedAuthority);
  if (
    process.platform !== "win32" &&
    (authorityStat.mode & 0o077) !== 0
  ) {
    throw new Error(
      "evaluate --evaluation-authority must be owner-only readable and writable",
    );
  }
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    authorityStat.uid !== process.getuid()
  ) {
    throw new Error(
      "evaluate --evaluation-authority must be owned by the current user",
    );
  }
  const canonicalAuthority = realpathSync(resolvedAuthority);
  const authorityParent = dirname(canonicalAuthority);
  const authorityParentStat = statSync(authorityParent);
  if (
    process.platform !== "win32" &&
    (authorityParentStat.mode & 0o077) !== 0
  ) {
    throw new Error(
      "evaluate --evaluation-authority parent must be an owner-only directory",
    );
  }
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    authorityParentStat.uid !== process.getuid()
  ) {
    throw new Error(
      "evaluate --evaluation-authority parent must be owned by the current user",
    );
  }
  const canonicalInput = realpathSync(resolve(inputPath));
  const inputRoot = dirname(canonicalInput);
  if (pathIsWithin(inputRoot, canonicalAuthority)) {
    throw new Error(
      "evaluate --evaluation-authority must remain outside the input root",
    );
  }
  const authority = readJson(canonicalAuthority);
  const validation = validateEvaluationAuthorityManifest(authority, catalog);
  if (!validation.ok) {
    throw new Error(
      `evaluation authority manifest is invalid: ${validation.errors.join("; ")}`,
    );
  }
  for (const authorityCase of validation.caseMap.values()) {
    const projectRoot = authorityCase.project_root;
    if (
      !existsSync(projectRoot) ||
      lstatSync(projectRoot).isSymbolicLink() ||
      !statSync(projectRoot).isDirectory() ||
      realpathSync(projectRoot) !== projectRoot
    ) {
      throw new Error(
        `evaluation authority project_root must identify a canonical existing directory: ${projectRoot}`,
      );
    }
    if (pathIsWithin(projectRoot, canonicalAuthority)) {
      throw new Error(
        "evaluate --evaluation-authority must remain outside every project root",
      );
    }
  }
  return authority;
}

function sha256Receipt(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function strictBase64Bytes(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 * 1024 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    return null;
  }
  const bytes = Buffer.from(value, "base64");
  return bytes.length <= 64 * 1024 && bytes.toString("base64") === value
    ? bytes
    : null;
}

function validateReviewCollection(value, findings) {
  const empty = {
    reviewAttestations: [],
    capabilityPreflightAttestations: [],
    capabilityAttestations: [],
    candidates: [],
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    findings.push("collection must be an object");
    return empty;
  }
  const expectedKeys = new Set([
    "review_attestations",
    "review_candidates",
    "capability_preflight_attestations",
    "capability_attestations",
  ]);
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      findings.push(`collection contains unknown field ${key}`);
    }
  }
  for (const [field, maximum] of [
    ["review_attestations", 10],
    ["review_candidates", 10],
    ["capability_preflight_attestations", 4],
    ["capability_attestations", 4],
  ]) {
    if (!Array.isArray(value[field])) {
      findings.push(`collection.${field} must be an array`);
    } else if (value[field].length > maximum) {
      findings.push(
        `collection.${field} must contain at most ${maximum} entries`,
      );
    }
  }
  const candidates = [];
  const paths = new Set();
  for (const [index, candidate] of asArray(
    value.review_candidates,
  ).entries()) {
    const label = `collection.review_candidates[${index}]`;
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      findings.push(`${label} must be an object`);
      continue;
    }
    const candidateKeys = new Set(["path", "bytes_base64", "sha256"]);
    for (const key of Object.keys(candidate)) {
      if (!candidateKeys.has(key)) {
        findings.push(`${label} contains unknown field ${key}`);
      }
    }
    if (!REVIEW_RECEIPT_PATH.test(candidate.path ?? "")) {
      findings.push(`${label}.path must name a canonical review receipt`);
    } else if (paths.has(candidate.path)) {
      findings.push(`collection.review_candidates duplicates ${candidate.path}`);
    } else {
      paths.add(candidate.path);
    }
    const bytes = strictBase64Bytes(candidate.bytes_base64);
    if (!bytes) {
      findings.push(
        `${label}.bytes_base64 must contain at most 64 KiB of canonical base64`,
      );
      continue;
    }
    const actualSha256 = sha256Receipt(bytes);
    if (candidate.sha256 !== actualSha256) {
      findings.push(`${label}.sha256 must hash the exact candidate bytes`);
    }
    let receipt;
    try {
      receipt = JSON.parse(bytes.toString("utf8"));
    } catch {
      findings.push(`${label}.bytes_base64 must decode to JSON`);
      continue;
    }
    for (const error of validateReviewReceipt(receipt)) {
      findings.push(`${label}: ${error}`);
    }
    if (
      REVIEW_RECEIPT_PATH.test(candidate.path ?? "") &&
      receipt?.receipt_id !== candidate.path.slice(
        ".agent-stack/review-receipts/".length,
        -".json".length,
      )
    ) {
      findings.push(`${label}.path must match the decoded receipt_id`);
    }
    candidates.push({
      ...candidate,
      bytes,
      receipt,
      actualSha256,
    });
  }
  return {
    reviewAttestations: asArray(value.review_attestations),
    capabilityPreflightAttestations: asArray(
      value.capability_preflight_attestations,
    ),
    capabilityAttestations: asArray(value.capability_attestations),
    candidates,
  };
}

function mechanismForCollectorAdapter(adapter) {
  if (adapter === "codex-isolated-session-v1") {
    return "isolated-session";
  }
  if (adapter === "codex-native-v1") {
    return "native-subagent";
  }
  if (adapter === "external-provider-v1") {
    return "external-provider";
  }
  if (adapter === "human-review-v1") {
    return "human";
  }
  return null;
}

function validateReceiptAgainstReviewPayload(
  candidate,
  payload,
  label,
  findings,
) {
  const receipt = candidate.receipt;
  const expectedMechanism = mechanismForCollectorAdapter(
    payload?.collector?.adapter,
  );
  if (!expectedMechanism) {
    findings.push(`${label} uses an unsupported collector adapter`);
  }
  for (const [receiptField, payloadValue] of [
    ["assignment_id", payload?.assignment?.id],
    ["work_item_id", payload?.assignment?.work_item_id],
    ["evidence_node_id", payload?.assignment?.evidence_node_id],
    ["mechanism", expectedMechanism],
    ["harness", payload?.collector?.adapter],
    ["reviewer_id", payload?.harness?.reviewer_session_id],
    ["base_revision", payload?.assignment?.delivery_baseline_revision],
    ["reviewed_revision", payload?.assignment?.reviewed_revision],
    [
      "delivery_baseline",
      `.agent-stack/artifacts/DELIVERY.md@${payload?.assignment?.delivery_baseline_revision}`,
    ],
    ["standards_verdict", payload?.verdicts?.standards],
    ["intent_verdict", payload?.verdicts?.intent],
    [
      "reviewer_result_sha256",
      payload?.events?.reviewer_result_bytes_sha256,
    ],
    ["provenance_sha256", payload?.events?.provenance_sha256],
    ["read_only", payload?.boundary?.read_only],
    ["external_actions", payload?.boundary?.external_actions],
    ["started_at", payload?.started_at],
    ["completed_at", payload?.completed_at],
  ]) {
    if (receipt?.[receiptField] !== payloadValue) {
      findings.push(
        `${label} decoded receipt ${receiptField} does not match the signed review payload`,
      );
    }
  }
  if (receipt?.result !== "succeeded") {
    findings.push(`${label} decoded receipt result must equal succeeded`);
  }
  if (payload?.candidate?.path !== candidate.path) {
    findings.push(`${label} candidate path does not match signed review payload`);
  }
  if (payload?.candidate?.bytes_sha256 !== candidate.actualSha256) {
    findings.push(
      `${label} candidate byte hash does not match signed review payload`,
    );
  }
}

function validateCollectorReviewEvidence({
  item,
  scenario,
  collection,
  evaluationAuthority,
  authorityCase,
  trustedReviewKeyring,
  findings,
}) {
  const gate = scenario?.expected?.required_review_gate;
  const hasSignedEvidence =
    collection.reviewAttestations.length > 0 ||
    collection.capabilityPreflightAttestations.length > 0 ||
    collection.capabilityAttestations.length > 0;
  if (hasSignedEvidence && !trustedReviewKeyring) {
    findings.push(
      "collector-signed review evidence requires an outer trusted review keyring",
    );
  }
  const successfulReviews = [];
  const consumedCandidatePaths = new Set();

  if (gate === "signed-review-required") {
    if (
      collection.capabilityPreflightAttestations.length > 0 ||
      collection.capabilityAttestations.length > 0
    ) {
      findings.push(
        "signed-review-required must not contain capability attestations or preflights",
      );
    }
    for (const [index, attestation] of collection.reviewAttestations.entries()) {
      const label = `collection.review_attestations[${index}]`;
      const claimedPayload = attestation?.payload;
      const candidatePath = claimedPayload?.candidate?.path;
      const candidate = collection.candidates.find(
        (entry) => entry.path === candidatePath,
      );
      if (!candidate) {
        findings.push(
          `${label} references a candidate absent from post-run exact bytes`,
        );
        continue;
      }
      const reviewerSessionId =
        claimedPayload?.harness?.reviewer_session_id;
      const expectedBindings = {
        outcome: "succeeded",
        batch_id: evaluationAuthority?.batch_id,
        project_instance_sha256:
          authorityCase?.project_instance_sha256,
        package_surface_sha256: evaluationAuthority?.surface_hash,
        primary_session_id: authorityCase?.primary_session_id,
        reviewer_session_id: reviewerSessionId,
        assignment_id: candidate.receipt?.assignment_id,
        work_item_id: candidate.receipt?.work_item_id,
        evidence_node_id: candidate.receipt?.evidence_node_id,
        delivery_baseline_revision:
          authorityCase?.materialized_git_head,
        reviewed_revision: item?.reviewed_git_head,
        candidate_path: candidate.path,
        candidate_bytes_sha256: candidate.actualSha256,
        final_head_revision: item?.final_git_head,
        final_project_state_sha256:
          item?.final_review_attested_state_sha256,
      };
      if (!trustedReviewKeyring) {
        continue;
      }
      const verification = verifyReviewAttestation(
        attestation,
        trustedReviewKeyring,
        expectedBindings,
        { now: claimedPayload?.completed_at },
      );
      if (!verification.ok) {
        for (const error of verification.errors) {
          findings.push(`${label}: ${error}`);
        }
        continue;
      }
      const payload = verification.payload;
      const authorityWindow = authorityCaseWindow(
        evaluationAuthority,
        authorityCase,
      );
      if (
        !timestampWithin(
          payload?.started_at,
          authorityWindow.lower,
          authorityWindow.upper,
        ) ||
        !timestampWithin(
          payload?.completed_at,
          authorityWindow.lower,
          authorityWindow.upper,
        )
      ) {
        findings.push(
          `${label} signed review timestamps must remain within the outer authority window`,
        );
      }
      if (
        !isCompletedField(payload?.harness?.reviewer_session_id) ||
        payload.harness.reviewer_session_id === item?.harness_session?.id
      ) {
        findings.push(
          `${label} reviewer session must differ from the primary harness session`,
        );
      }
      if (
        payload?.events?.spawn_returned_worker_id !==
          payload?.harness?.reviewer_session_id ||
        payload?.events?.wait_target_worker_id !==
          payload?.harness?.reviewer_session_id
      ) {
        findings.push(
          `${label} spawn and wait events must bind the exact reviewer session`,
        );
      }
      if (
        payload?.assignment?.delivery_baseline_revision !==
        item?.materialized_git_head
      ) {
        findings.push(
          `${label} review base must equal materialized_git_head`,
        );
      }
      if (
        payload?.assignment?.reviewed_revision !== item?.reviewed_git_head ||
        payload?.final_state?.head_revision !== item?.final_git_head
      ) {
        findings.push(
          `${label} reviewed and final revisions must match their exact run-record bindings`,
        );
      }
      if (
        payload?.assignment?.reviewed_revision ===
        item?.materialized_git_head
      ) {
        findings.push(
          `${label} reviewed revision must differ from the materialized base`,
        );
      }
      if (payload?.final_state?.git_tree_oid !== item?.final_git_tree_oid) {
        findings.push(`${label} final Git tree does not match the run record`);
      }
      if (
        payload?.final_state?.git_tree_manifest_sha256 !==
        item?.final_git_tree_manifest_sha256
      ) {
        findings.push(
          `${label} final Git tree manifest does not match the run record`,
        );
      }
      const postReviewPaths = asArray(
        payload?.final_state?.post_review_paths,
      );
      if (
        payload?.final_state?.post_review_paths_sha256 !==
        sha256Bytes(canonicalPayloadSerialization(postReviewPaths))
      ) {
        findings.push(
          `${label} post-review path hash does not match the signed path list`,
        );
      }
      for (const path of postReviewPaths) {
        if (
          path !== candidate.path &&
          !POST_REVIEW_EVIDENCE_PATHS.has(path)
        ) {
          findings.push(
            `${label} contains a forbidden post-review path: ${path}`,
          );
        }
      }
      if (!postReviewPaths.includes(candidate.path)) {
        findings.push(
          `${label} final evidence commit must contain the exact review candidate path`,
        );
      }
      const reviewedPaths = asArray(
        payload?.final_state?.reviewed_paths,
      );
      if (
        payload?.final_state?.reviewed_paths_sha256 !==
        sha256Bytes(canonicalPayloadSerialization(reviewedPaths))
      ) {
        findings.push(
          `${label} reviewed path hash does not match the signed path list`,
        );
      }
      if (
        !reviewedPaths.some((path) => !path.startsWith(".agent-stack/"))
      ) {
        findings.push(
          `${label} reviewed revision must contain at least one product change from the materialized base`,
        );
      }
      for (const requiredPath of asArray(
        scenario?.expected?.required_write_paths,
      ).filter((path) => !path.startsWith(".agent-stack/"))) {
        if (!reviewedPaths.includes(requiredPath)) {
          findings.push(
            `${label} signed reviewed paths are missing required product path: ${requiredPath}`,
          );
        }
      }
      validateReceiptAgainstReviewPayload(
        candidate,
        payload,
        label,
        findings,
      );
      if (consumedCandidatePaths.has(candidate.path)) {
        findings.push(`${label} reuses review candidate ${candidate.path}`);
      } else {
        consumedCandidatePaths.add(candidate.path);
      }
      successfulReviews.push(payload);
    }
    if (successfulReviews.length === 0) {
      findings.push(
        "signed-review-required has no verified collector review attestation",
      );
    }
  } else if (gate === "signed-all-disabled") {
    if (
      collection.reviewAttestations.length > 0 ||
      collection.candidates.length > 0
    ) {
      findings.push(
        "signed-all-disabled forbids review attestations and review candidates",
      );
    }
    if (collection.capabilityAttestations.length !== 1) {
      findings.push(
        "signed-all-disabled requires exactly one collector capability attestation",
      );
    }
    if (collection.capabilityPreflightAttestations.length !== 1) {
      findings.push(
        "signed-all-disabled requires exactly one collector capability preflight attestation",
      );
    }
    if (
      collection.capabilityAttestations.length === 1 &&
      collection.capabilityPreflightAttestations.length === 1 &&
      trustedReviewKeyring
    ) {
      const preflightAttestation =
        collection.capabilityPreflightAttestations[0];
      const postRunAttestation = collection.capabilityAttestations[0];
      const preflightPayload = preflightAttestation?.payload;
      const postRunPayload = postRunAttestation?.payload;
      const requiredProductPaths = asArray(
        scenario?.expected?.required_write_paths,
      )
        .filter((path) => !path.startsWith(".agent-stack/"))
        .sort();
      const requiredProductPathsSha256 = sha256Bytes(
        canonicalPayloadSerialization(requiredProductPaths),
      );
      const commonExpectedBindings = {
        outcome: "unavailable",
        batch_id: evaluationAuthority?.batch_id,
        project_instance_sha256:
          authorityCase?.project_instance_sha256,
        package_surface_sha256: evaluationAuthority?.surface_hash,
        primary_session_id: authorityCase?.primary_session_id,
        delivery_baseline_revision:
          authorityCase?.materialized_git_head,
        intended_final_revision: null,
        required_product_paths_sha256: requiredProductPathsSha256,
        capability: "independent-review",
      };
      const preflightVerification =
        verifyCapabilityPreflightAttestation(
          preflightAttestation,
          trustedReviewKeyring,
          commonExpectedBindings,
          { now: preflightPayload?.checked_at },
        );
      if (!preflightVerification.ok) {
        for (const error of preflightVerification.errors) {
          findings.push(
            `collection.capability_preflight_attestations[0]: ${error}`,
          );
        }
      }
      const exactPreflightSha256 =
        capabilityPreflightAttestationSha256(preflightAttestation);
      const postRunVerification = verifyCapabilityAttestation(
        postRunAttestation,
        trustedReviewKeyring,
        {
          ...commonExpectedBindings,
          preflight_sha256: exactPreflightSha256,
          final_head_revision: item?.final_git_head,
          final_project_state_sha256:
            item?.final_review_attested_state_sha256,
        },
        { now: postRunPayload?.completed_at },
      );
      if (!postRunVerification.ok) {
        for (const error of postRunVerification.errors) {
          findings.push(
            `collection.capability_attestations[0]: ${error}`,
          );
        }
      }
      if (preflightVerification.ok && postRunVerification.ok) {
        const preflight = preflightVerification.payload;
        const postRun = postRunVerification.payload;
        const authorityWindow = authorityCaseWindow(
          evaluationAuthority,
          authorityCase,
        );
        if (
          !timestampWithin(
            preflight.checked_at,
            authorityWindow.lower,
            authorityWindow.upper,
          ) ||
          !timestampWithin(
            postRun.session_started_at,
            authorityWindow.lower,
            authorityWindow.upper,
          ) ||
          !timestampWithin(
            postRun.completed_at,
            authorityWindow.lower,
            authorityWindow.upper,
          ) ||
          Date.parse(preflight.checked_at) >=
            Date.parse(postRun.session_started_at) ||
          Date.parse(postRun.session_started_at) >
            Date.parse(postRun.completed_at)
        ) {
          findings.push(
            "signed-all-disabled preflight, session, and completion timestamps must be ordered within the outer authority window",
          );
        }
        if (
          postRun.preflight_key_id !==
          preflightAttestation?.signature?.key_id
        ) {
          findings.push(
            "signed-all-disabled post-run attestation must bind the exact preflight signing key",
          );
        }
        if (
          JSON.stringify(postRun.harness) !==
            JSON.stringify(preflight.harness) ||
          JSON.stringify(postRun.assignment) !==
            JSON.stringify(preflight.assignment) ||
          postRun.checked_at !== preflight.checked_at
        ) {
          findings.push(
            "signed-all-disabled post-run attestation must copy the exact preflight identity, assignment, and checked_at",
          );
        }
        if (
          reviewEnvironmentForFixture(scenario.id)?.mode !== "all-disabled"
        ) {
          findings.push(
            "signed-all-disabled requires the canonical all-disabled fixture policy",
          );
        }
        for (const mechanism of REVIEW_MECHANISMS) {
          if (
            preflight.capabilities?.[mechanism]?.state !==
            "disabled"
          ) {
            findings.push(
              `signed-all-disabled requires ${mechanism} state disabled`,
            );
          }
        }
        if (
          preflight.baseline_state?.head_revision !==
          authorityCase?.materialized_git_head
        ) {
          findings.push(
            "signed-all-disabled preflight baseline state must match the outer authority baseline",
          );
        }
        if (
          postRun.final_state?.head_revision ===
            authorityCase?.materialized_git_head ||
          postRun.baseline_ancestor !== true
        ) {
          findings.push(
            "signed-all-disabled final revision must differ from and descend from the outer authority baseline",
          );
        }
        for (const requiredPath of requiredProductPaths) {
          if (!asArray(postRun.changed_paths).includes(requiredPath)) {
            findings.push(
              `signed-all-disabled changed paths are missing required product path: ${requiredPath}`,
            );
          }
        }
        if (
          postRun.final_state?.git_tree_oid !==
          item?.final_git_tree_oid
        ) {
          findings.push(
            "signed-all-disabled final Git tree does not match the run record",
          );
        }
        if (
          postRun.final_state
            ?.git_tree_manifest_sha256 !==
          item?.final_git_tree_manifest_sha256
        ) {
          findings.push(
            "signed-all-disabled final Git tree manifest does not match the run record",
          );
        }
      }
    }
  } else if (
    collection.reviewAttestations.length > 0 ||
    collection.capabilityPreflightAttestations.length > 0 ||
    collection.capabilityAttestations.length > 0 ||
    collection.candidates.length > 0
  ) {
    findings.push(
      "collector review evidence is forbidden when the scenario has no review gate",
    );
  }

  for (const candidate of collection.candidates) {
    if (!consumedCandidatePaths.has(candidate.path)) {
      findings.push(
        `collection.review_candidates contains unconsumed candidate ${candidate.path}`,
      );
    }
  }
  return successfulReviews;
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
    if (
      expected.required_review_gate !== undefined &&
      !REVIEW_GATES.has(expected.required_review_gate)
    ) {
      errors.push(
        `${location}.expected.required_review_gate must be signed-review-required or signed-all-disabled`,
      );
    }
    if (
      expected.required_review_gate === "signed-review-required" &&
      !asArray(expected.required_actions).includes("perform_independent_review")
    ) {
      errors.push(
        `${location}.expected signed-review-required must require perform_independent_review`,
      );
    }
    if (
      expected.required_review_gate === "signed-all-disabled" &&
      (
        asArray(expected.required_actions).includes(
          "perform_independent_review",
        ) ||
        !asArray(expected.forbidden_actions).includes(
          "perform_independent_review",
        )
      )
    ) {
      errors.push(
        `${location}.expected signed-all-disabled must forbid perform_independent_review`,
      );
    }
    if (
      expected.required_review_gate === "signed-all-disabled" &&
      reviewEnvironmentForFixture(scenario.id)?.mode !== "all-disabled"
    ) {
      errors.push(
        `${location}.expected signed-all-disabled requires an all-disabled review fixture`,
      );
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

function validateRunRecord(
  record,
  catalog = readJson(SCENARIOS_FILE),
  { evaluationAuthority = null } = {},
) {
  const contract = validateScenarioCatalog(catalog);
  const skills = skillCatalog();
  const errors = [...contract.errors];
  const results = [];
  const reviewBearingScenarios = asArray(catalog?.scenarios).filter(
    (scenario) => scenario?.expected?.required_review_gate,
  );
  const authorityValidation = evaluationAuthority
    ? validateEvaluationAuthorityManifest(evaluationAuthority, catalog)
    : {
        ok: reviewBearingScenarios.length === 0,
        errors:
          reviewBearingScenarios.length === 0
            ? []
            : [
                "review-bearing schema-v4 runs require an outer evaluation authority manifest",
              ],
        caseMap: new Map(),
      };
  errors.push(...authorityValidation.errors);
  const trustedReviewKeyring =
    evaluationAuthority?.trusted_review_keyring ?? null;
  if (evaluationAuthority) {
    if (record?.batch_id !== evaluationAuthority.batch_id) {
      errors.push(
        "run record batch_id must equal the outer evaluation authority batch_id",
      );
    }
    if (record?.surface_hash !== evaluationAuthority.surface_hash) {
      errors.push(
        "run record surface_hash must equal the outer evaluation authority surface_hash",
      );
    }
  }
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
  if (!isCompletedField(record?.batch_id)) {
    errors.push("run record batch_id must identify the collector-owned batch");
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
      const authorityCase = authorityValidation.caseMap.get(scenario.id);
      if (scenario?.expected?.required_review_gate) {
        if (!authorityCase) {
          findings.push(
            "review-bearing scenario is absent from the outer evaluation authority",
          );
        } else {
          if (
            item.project_instance_sha256 !==
            authorityCase.project_instance_sha256
          ) {
            findings.push(
              "project_instance_sha256 must equal the outer evaluation authority case",
            );
          }
          if (
            item.materialized_git_head !==
            authorityCase.materialized_git_head
          ) {
            findings.push(
              "materialized_git_head must equal the outer evaluation authority case",
            );
          }
          if (
            item?.harness_session?.id !==
            authorityCase.primary_session_id
          ) {
            findings.push(
              "harness_session.id must equal the outer evaluation authority primary session",
            );
          }
        }
      }
      if (!SHA256_RECEIPT.test(item.project_instance_sha256 ?? "")) {
        findings.push(
          "project_instance_sha256 must identify the isolated project instance",
        );
      }
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
      if (scenario?.expected?.required_review_gate) {
        if (
          scenario.expected.required_review_gate ===
            "signed-review-required" &&
          !GIT_COMMIT_ID.test(item.reviewed_git_head ?? "")
        ) {
          findings.push(
            "reviewed_git_head must be the exact independently reviewed commit",
          );
        }
        if (!GIT_COMMIT_ID.test(item.final_git_tree_oid ?? "")) {
          findings.push(
            "final_git_tree_oid must be the exact signed final Git tree",
          );
        }
        if (
          !SHA256_RECEIPT.test(
            item.final_git_tree_manifest_sha256 ?? "",
          )
        ) {
          findings.push(
            "final_git_tree_manifest_sha256 must bind the signed final Git tree manifest",
          );
        }
        if (
          !SHA256_RECEIPT.test(
            item.final_review_attested_state_sha256 ?? "",
          )
        ) {
          findings.push(
            "final_review_attested_state_sha256 must equal the collector-signed final Git-state receipt",
          );
        }
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
      const collectedReviewEvidence = validateReviewCollection(
        item.collection,
        findings,
      );
      const independentReviews = validateCollectorReviewEvidence({
        item,
        scenario,
        collection: collectedReviewEvidence,
        evaluationAuthority,
        authorityCase,
        trustedReviewKeyring,
        findings,
      });
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
        if (Object.hasOwn(observed, "independent_reviews")) {
          findings.push(
            "observed.independent_reviews is forbidden; review authority must come from collector-signed evidence",
          );
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
        if (
          independentReviews.length > 0 &&
          !actions.has("perform_independent_review")
        ) {
          findings.push(
            "independent review provenance was recorded without the matching performed action",
          );
        }
        if (
          actions.has("perform_independent_review") &&
          independentReviews.length === 0
        ) {
          findings.push(
            "perform_independent_review requires a provenance-bound independent review receipt",
          );
        }
        if (
          asArray(scenario?.expected?.required_actions).includes(
            "perform_independent_review",
          ) &&
          independentReviews.length === 0
        ) {
          findings.push(
            "required independent review has no reviewer provenance",
          );
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
        if (scenario?.expected?.required_review_gate === "signed-review-required") {
          for (const candidate of collectedReviewEvidence.candidates) {
            if (!writtenPaths.has(candidate.path)) {
              findings.push(
                `signed review candidate was not observed as a project write: ${candidate.path}`,
              );
            }
          }
        }
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
    batch_id: evaluationAuthority?.batch_id ?? record?.batch_id ?? null,
    evaluation_authority_sha256: evaluationAuthority
      ? sha256Bytes(canonicalPayloadSerialization(evaluationAuthority))
      : null,
    trusted_review_key_ids: asArray(
      evaluationAuthority?.trusted_review_keyring?.keys,
    )
      .map((key) => key?.key_id)
      .filter((keyId) => SHA256_RECEIPT.test(keyId ?? ""))
      .sort(),
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
    batch_id: "replace-with-collector-batch-id",
    surface_hash: behaviorSurfaceHash(),
    harness: {
      name: "replace-with-harness-name",
      version: "replace-with-harness-version",
      model: "replace-with-model",
    },
    recorded_at: new Date().toISOString(),
    cases: asArray(catalog?.scenarios).map((scenario) => ({
      scenario_id: scenario.id,
      project_instance_sha256:
        "replace-with-project-instance-sha256",
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
      reviewed_git_head:
        scenario.expected.required_review_gate === "signed-review-required"
          ? "replace-with-reviewed-git-head"
          : null,
      final_git_tree_oid: scenario.expected.required_review_gate
        ? "replace-with-final-git-tree-oid"
        : null,
      final_git_tree_manifest_sha256:
        scenario.expected.required_review_gate
          ? "replace-with-final-git-tree-manifest-sha256"
          : null,
      final_review_attested_state_sha256:
        scenario.expected.required_review_gate
          ? "replace-with-final-review-attested-state-sha256"
          : null,
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
      collection: {
        review_attestations: [],
        review_candidates: [],
        capability_preflight_attestations: [],
        capability_attestations: [],
      },
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

function runRecordHasSignedReviewEvidence(record) {
  return asArray(record?.cases).some(
    (item) =>
      asArray(item?.collection?.review_attestations).length > 0 ||
      asArray(
        item?.collection?.capability_preflight_attestations,
      ).length > 0 ||
      asArray(item?.collection?.capability_attestations).length > 0,
  );
}

function runRecordRequiresEvaluationAuthority(
  record,
  catalog = readJson(SCENARIOS_FILE),
) {
  const reviewBearing = new Set(
    asArray(catalog?.scenarios)
      .filter((scenario) => scenario?.expected?.required_review_gate)
      .map((scenario) => scenario.id),
  );
  return (
    runRecordHasSignedReviewEvidence(record) ||
    asArray(record?.cases).some((item) =>
      reviewBearing.has(item?.scenario_id),
    )
  );
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
    const resolvedInput = resolve(input);
    const record = readJson(resolvedInput);
    if (args.includes("--review-keyring")) {
      throw new Error(
        "evaluate --review-keyring was replaced by --evaluation-authority",
      );
    }
    const authorityPath = argumentValue(args, "--evaluation-authority");
    if (
      runRecordRequiresEvaluationAuthority(record) &&
      !authorityPath
    ) {
      throw new Error(
        "evaluate requires --evaluation-authority for a review-bearing schema-v4 run",
      );
    }
    const evaluationAuthority = authorityPath
      ? readEvaluationAuthorityFile(authorityPath, resolvedInput)
      : null;
    const result = validateRunRecord(record, undefined, {
      evaluationAuthority,
    });
    print(result);
    if (!result.ok) {
      process.exitCode = 2;
    }
    return;
  }
  throw new Error(
    "usage: skill-eval.mjs contracts | surface-hash | scaffold | evaluate --input FILE --evaluation-authority ABSOLUTE_FILE",
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
  readEvaluationAuthorityFile,
  runRecordHasSignedReviewEvidence,
  runRecordRequiresEvaluationAuthority,
  validateEvaluationAuthorityManifest,
  validateRunRecord,
  validateScenarioCatalog,
};
