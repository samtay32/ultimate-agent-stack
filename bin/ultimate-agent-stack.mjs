#!/usr/bin/env node

import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname, platform, tmpdir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { spawnPortable as spawnPortableProcess } from "../lib/portable-process.mjs";

const CLI_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(CLI_FILE), "..");
const PACKAGE_JSON = existsSync(join(PACKAGE_ROOT, "package.json"))
  ? JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"))
  : {
      name: "ultimate-agent-stack",
      version: "0.9.2",
    };
const PACKAGE_NAME = PACKAGE_JSON.name;
const PACKAGE_VERSION = PACKAGE_JSON.version;
const MINIMUM_NODE_MAJOR = 22;
const CONFIG_SCHEMA_VERSION = 7;
const WORK_LEDGER_PATH = ".agent-stack/work-items.json";
const EVIDENCE_GRAPH_PATH = ".agent-stack/evidence-graph.json";
const EVIDENCE_REPORTS_PATH = ".agent-stack/reports";
const EVIDENCE_MERMAID_EDGES_PER_NODE = 4;
const PROVIDER_RECEIPTS_PATH = ".agent-stack/provider-receipts";
const CAMPAIGN_PATH = ".agent-stack/campaign.json";
const COMPLETION_EVIDENCE_RELATIONS = new Set([
  "implements",
  "verifies",
  "reviews",
  "releases",
  "observes",
]);
const DEPENDENCY_EVIDENCE_RELATIONS = new Set([
  "depends_on",
  "requires",
  "blocks",
]);
const CHECK_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const CONFIG_PATH = ".agent-stack/config.json";
const INSTALLATION_PATH = ".agent-stack/installation.json";
const STATE_PATH = ".agent-stack/state.json";
const CHECKPOINT_PATH = ".agent-stack/checkpoint.json";
const CHECKPOINT_MARKDOWN_PATH = ".agent-stack/CHECKPOINT.md";
const COORDINATOR_PATH = ".agent-stack/coordinator.json";
const COORDINATOR_MUTEX_PATH = ".agent-stack/coordinator.mutex";
const GBRAIN_HOME_PATH = ".agent-stack/gbrain-home";
const GBRAIN_LAUNCHER_PATH = ".agent-stack/bin/gbrain-project.mjs";
const LINEAR_READONLY_PATH = ".agent-stack/bin/linear-readonly.mjs";
const LINEAR_READONLY_SOURCE_HASH =
  "1b80dff43ae40adbf724f392a735b697011ca956e8748aba3ca52ebd269a4aad";
const LINEAR_CREDENTIAL_ENV = "LINEAR_API_KEY";
const LINEAR_WRITE_PATH = ".agent-stack/bin/linear-write.mjs";
const LINEAR_WRITE_SOURCE_HASH =
  "147428fb3a0487ba08fa7d0814f0e7eff198963dea5f61c38eaec0a5a662a3ca";
const LINEAR_CREATE_CREDENTIAL_ENV = "LINEAR_CREATE_API_KEY";
const LINEAR_COMMENT_CREDENTIAL_ENV = "LINEAR_COMMENT_API_KEY";
const TELEMETRY_READONLY_PATH =
  ".agent-stack/bin/telemetry-readonly.mjs";
const TELEMETRY_READONLY_SOURCE_HASH =
  "adc0dc4c330e140dd679c24a052ffd7ed1e17cbaa88b64c4f809b238f590d87c";
const TELEMETRY_CREDENTIAL_ENVIRONMENTS = Object.freeze({
  posthog: "POSTHOG_PERSONAL_API_KEY",
  sentry: "SENTRY_AUTH_TOKEN",
  "new-relic": "NEW_RELIC_USER_KEY",
});
const GBRAIN_CHECKPOINT_SLUG = "projects/ultimate-agent-stack/checkpoint";
const RUNS_PATH = ".agent-stack/runs";
const REVIEW_RECEIPTS_PATH = ".agent-stack/review-receipts";
const REVIEW_UNAVAILABLE_PATH = ".agent-stack/review-unavailable";
const MAX_REVIEW_RECEIPTS = 1_000;
const MAX_REVIEW_UNAVAILABLE_RECEIPTS = 1_000;
const MAX_REVIEW_RECEIPT_BYTES = 32 * 1024;
const MAX_ACTIVATION_RECEIPTS_PER_RUN = 128;
const MAX_REVIEW_RESULT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_REVIEW_SUMMARY_CHARS = 2_000;
const MAX_REVIEW_FINDINGS = 64;
const MAX_REVIEW_FINDING_CHARS = 1_000;
const MAX_STATUS_EVIDENCE_PATHS = 128;
const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const GIT_OBJECT_FORMATS = new Set(["sha1", "sha256"]);

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
const PROJECT_CLI_PATH = ".agent-stack/bin/agent-stack.mjs";
const PROJECT_PROCESS_HELPER_PATH =
  ".agent-stack/lib/portable-process.mjs";
const PROJECT_THIRD_PARTY_NOTICES_PATH =
  ".agent-stack/lib/THIRD_PARTY_NOTICES.md";
const CORE_POLICY_PATH = ".agent-stack/core-policy.json";
const REVIEW_RECEIPT_PATH = ".agent-stack/bin/review-receipt.mjs";
const REVIEW_WORKFLOW_PATH = ".github/workflows/review-receipt.yml";
const DEFAULT_ARTIFACTS = [
  ".agent-stack/artifacts/DELIVERY.md",
  ".agent-stack/artifacts/ARCHITECTURE.md",
  ".agent-stack/artifacts/SECURITY.md",
];
const PLACEHOLDER = /\[\[[^\]\r\n]*\]\]/g;
const ARTIFACT_STATUS_DECLARATION =
  /^ {0,3}Status:[ \t]*(.*?)[ \t]*$/gim;
const MATERIAL_CONFLICTS_DECLARATION =
  /^ {0,3}Material open conflicts:[ \t]*(.*?)[ \t]*$/gim;
const PROVIDER_UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SECRET_ASSIGNMENT =
  /\b(api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)(\s*[=:]\s*)([^\s,;]+)/gi;
const SECRET_LIKE_TEXT =
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]|npm|sk)-?[A-Za-z0-9_]{20,}\b|\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})/i;
const COORDINATOR_TTL_SECONDS = 2 * 60 * 60;
const COORDINATOR_MUTEX_STALE_MS = 30_000;
const CAMPAIGN_STATUSES = new Set([
  "active",
  "complete",
  "decision-needed",
  "stopped",
]);
const WORK_PRIORITY_ORDER = new Map([
  ["urgent", 0],
  ["high", 1],
  ["normal", 2],
  ["low", 3],
]);
const FORBIDDEN_EXECUTABLES = new Set([
  "ansible",
  "ansible-playbook",
  "awk",
  "bash",
  "bunx",
  "busybox",
  "chmod",
  "chown",
  "corepack",
  "csh",
  "curl",
  "cmd",
  "dash",
  "dd",
  "del",
  "env",
  "find",
  "fish",
  "format",
  "ksh",
  "mkfs",
  "nc",
  "netcat",
  "nice",
  "nohup",
  "npx",
  "pnpx",
  "powershell",
  "pwsh",
  "reboot",
  "rm",
  "rmdir",
  "setsid",
  "sh",
  "shutdown",
  "socat",
  "ssh",
  "start",
  "su",
  "sudo",
  "tcsh",
  "time",
  "wget",
  "wsl",
  "xargs",
  "yarnpkg",
  "zsh",
]);
const PACKAGE_MANAGERS = new Set([
  "bun",
  "npm",
  "pnpm",
  "yarn",
]);
const SAFE_ENVIRONMENT_NAMES = Object.freeze([
  "COLORTERM",
  "ComSpec",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "TERM",
  "TZ",
  "WINDIR",
]);
const TOOLCHAIN_ENVIRONMENT_NAMES = [
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "BUN_INSTALL",
  "DOTNET_ROOT",
  "GOPATH",
  "GOROOT",
  "JAVA_HOME",
  "M2_HOME",
  "MAVEN_HOME",
  "NVM_BIN",
  "NVM_INC",
  "NVM_DIR",
  "PNPM_HOME",
  "PYENV_ROOT",
  "RBENV_ROOT",
  "RUSTUP_HOME",
  "SDKMAN_DIR",
  "VOLTA_HOME",
];
const SENSITIVE_ENVIRONMENT_NAME =
  /(api|auth|access|private|secret|token|password|passwd|credential|cookie|session|key|database[_-]?url|db[_-]?url|dsn|connection[_-]?string)/i;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXECUTION_CONTROL_ENVIRONMENT_NAMES = new Set([
  "BASH_ENV",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "ENV",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "JAVA_TOOL_OPTIONS",
  "JDK_JAVA_OPTIONS",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NPM_CONFIG_USERCONFIG",
  "PERL5OPT",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "RUBYOPT",
]);
const EXECUTION_CONTROL_ENVIRONMENT_PREFIXES = [
  "GIT_",
  "TF_",
];
const INLINE_EVALUATION_ARGUMENTS = new Map([
  ["deno", new Set(["eval"])],
  ["node", new Set(["-e", "--eval", "-p", "--print"])],
  ["perl", new Set(["-e", "-E"])],
  ["php", new Set(["-r"])],
  ["py", new Set(["-c"])],
  ["python", new Set(["-c"])],
  ["python3", new Set(["-c"])],
  ["ruby", new Set(["-e"])],
]);
const VERSIONED_INLINE_EVALUATION_ARGUMENTS = [
  [/^deno\d+(?:\.\d+)*$/u, INLINE_EVALUATION_ARGUMENTS.get("deno")],
  [/^node\d+(?:\.\d+)*$/u, INLINE_EVALUATION_ARGUMENTS.get("node")],
  [/^perl\d+(?:\.\d+)*$/u, INLINE_EVALUATION_ARGUMENTS.get("perl")],
  [/^php\d+(?:\.\d+)*$/u, INLINE_EVALUATION_ARGUMENTS.get("php")],
  [/^python\d+(?:\.\d+)*$/u, INLINE_EVALUATION_ARGUMENTS.get("python")],
  [/^ruby\d+(?:\.\d+)*$/u, INLINE_EVALUATION_ARGUMENTS.get("ruby")],
];
const GIT_INSPECTION_SUBCOMMANDS = new Set([
  "diff",
  "log",
  "rev-parse",
  "show",
  "status",
]);
const GIT_DIFF_EXACT_ARGUMENTS = new Set([
  "--",
  "--cached",
  "--check",
  "--compact-summary",
  "--exit-code",
  "--histogram",
  "--ignore-all-space",
  "--ignore-blank-lines",
  "--ignore-cr-at-eol",
  "--ignore-space-at-eol",
  "--ignore-space-change",
  "--merge-base",
  "--minimal",
  "--name-only",
  "--name-status",
  "--no-color",
  "--no-ext-diff",
  "--no-patch",
  "--no-renames",
  "--no-textconv",
  "--numstat",
  "--patch",
  "--patience",
  "--quiet",
  "--raw",
  "--relative",
  "--shortstat",
  "--staged",
  "--stat",
  "--summary",
  "-b",
  "-p",
  "-s",
  "-w",
  "-z",
]);
const GIT_LOG_EXACT_ARGUMENTS = new Set([
  "--",
  "--abbrev-commit",
  "--all",
  "--author-date-order",
  "--boundary",
  "--branches",
  "--cherry",
  "--cherry-mark",
  "--cherry-pick",
  "--date-order",
  "--decorate",
  "--first-parent",
  "--left-right",
  "--merges",
  "--name-only",
  "--name-status",
  "--no-color",
  "--no-decorate",
  "--no-ext-diff",
  "--no-mailmap",
  "--no-merges",
  "--no-patch",
  "--no-textconv",
  "--numstat",
  "--oneline",
  "--patch",
  "--remotes",
  "--reverse",
  "--shortstat",
  "--source",
  "--stat",
  "--summary",
  "--tags",
  "--topo-order",
  "--use-mailmap",
  "-p",
  "-s",
]);
const GIT_REV_PARSE_EXACT_ARGUMENTS = new Set([
  "--abbrev-ref",
  "--absolute-git-dir",
  "--end-of-options",
  "--git-dir",
  "--is-bare-repository",
  "--is-inside-git-dir",
  "--is-inside-work-tree",
  "--is-shallow-repository",
  "--quiet",
  "--short",
  "--show-cdup",
  "--show-object-format",
  "--show-prefix",
  "--show-superproject-working-tree",
  "--show-toplevel",
  "--symbolic",
  "--symbolic-full-name",
  "--verify",
  "-q",
]);
const GIT_SHOW_EXACT_ARGUMENTS = new Set([
  "--",
  "--abbrev-commit",
  "--decorate",
  "--name-only",
  "--name-status",
  "--no-color",
  "--no-decorate",
  "--no-ext-diff",
  "--no-patch",
  "--no-textconv",
  "--numstat",
  "--oneline",
  "--patch",
  "--quiet",
  "--shortstat",
  "--stat",
  "--summary",
  "-p",
  "-s",
]);
const GIT_STATUS_EXACT_ARGUMENTS = new Set([
  "--",
  "--ahead-behind",
  "--branch",
  "--column",
  "--long",
  "--no-ahead-behind",
  "--no-column",
  "--no-renames",
  "--porcelain",
  "--renames",
  "--short",
  "--show-stash",
  "-b",
  "-s",
  "-z",
]);
const GIT_FORBIDDEN_ARGUMENT_PATTERNS = [
  /^--config-env(?:=|$)/,
  /^--exec(?:=|$)/,
  /^--ext-diff$/,
  /^--no-index$/,
  /^--output(?:=|$)/,
  /^--textconv$/,
];
const SUPPORTED_HARNESSES = new Set([
  "claude",
  "codex",
  "cursor",
  "gemini",
  "grok",
  "opencode",
]);
const PROJECT_PROFILES = new Set(["experimental", "standard", "production"]);
const REVIEW_PROVIDERS = new Set([
  "builtin",
  "coderabbit",
  "github-human",
]);
const KNOWLEDGE_PROVIDERS = new Set(["repository", "gbrain"]);
const KNOWLEDGE_SCOPES = new Set(["project", "organization"]);
const TELEMETRY_PROVIDER_ROLES = Object.freeze({
  posthog: "product",
  sentry: "errors",
  "new-relic": "service",
});
const TELEMETRY_PROVIDER_REGIONS = Object.freeze({
  posthog: new Set(["us", "eu"]),
  sentry: new Set(["global", "us", "de"]),
  "new-relic": new Set(["us", "eu"]),
});
const TELEMETRY_NUMERIC_ID = /^[1-9]\d{0,18}$/;
const TELEMETRY_IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,99}$/i;
const TELEMETRY_PROVIDER_TIMEOUT_MS = 20_000;
const TELEMETRY_TOTAL_TIMEOUT_MS = 20_000;
const TELEMETRY_PROVIDERS = new Map(
  Object.keys(TELEMETRY_PROVIDER_ROLES).map((provider) => [
    provider,
    (value, label) => validateTelemetryProvider(value, label, provider),
  ]),
);
const TELEMETRY_ACCESS_MODES = new Set(["read_only"]);
const TELEMETRY_EVIDENCE_MODES = new Set([
  "bounded_references_only",
]);
const WORK_PROVIDERS = new Set(["repository", "linear"]);
const WORK_SYNC_MODES = new Set(["repository_only", "read_only_mirror"]);
const WORK_WRITE_POLICIES = new Set([
  "repository_only",
  "read_only",
  "receipted_create",
  "receipted_create_and_comment",
]);
const LINEAR_WRITE_OPERATIONS = new Set([
  "issue_create",
  "evidence_comment",
]);
const PROVIDER_RECEIPT_RESULTS = new Set([
  "succeeded",
  "not-needed",
  "failed",
  "decision-needed",
]);
const WORK_ITEM_STATUSES = new Set([
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "in_review",
  "done",
  "cancelled",
]);
const WORK_ITEM_PRIORITIES = new Set([
  "urgent",
  "high",
  "normal",
  "low",
]);
const EVIDENCE_NODE_KINDS = new Set([
  "intent",
  "requirement",
  "decision",
  "work_item",
  "file",
  "test",
  "commit",
  "pull_request",
  "review",
  "release",
  "telemetry",
  "checkpoint",
]);
const EVIDENCE_NODE_STATES = new Set([
  "planned",
  "active",
  "verified",
  "failed",
  "superseded",
]);
const EVIDENCE_RELATIONS = new Set([
  "requires",
  "implements",
  "verifies",
  "reviews",
  "releases",
  "observes",
  "blocks",
  "depends_on",
  "supersedes",
]);
const SKILL_ACTIVATION_MODES = new Set(["native", "file-read"]);
const REVIEW_RESULTS = new Set(["passed", "changes-requested"]);
const EXTERNAL_DATA_POLICIES = new Set([
  "local_only",
  "approved_providers",
]);
const EXECUTION_MODES = new Set(["agent_owned", "proposal_only"]);
const MERGE_MODES = new Set([
  "human_approval_required",
  "policy_authorized",
]);
const NO_PROJECT_CHECKS_ERROR = "no project quality checks configured";
const CONFIGURATION_PRESETS = Object.freeze({
  simple: Object.freeze({
    profile: "standard",
    review: "builtin",
    knowledge: "repository",
    knowledgeScope: "project",
    work: "repository",
    linearTeams: Object.freeze([]),
    linearWrites: Object.freeze([]),
    telemetrySpecs: Object.freeze([]),
    externalData: "local_only",
    execution: "agent_owned",
    merge: "human_approval_required",
    reviewers: Object.freeze([]),
  }),
});

class StackError extends Error {
  constructor(message, exitCode = 2, details = undefined) {
    super(message);
    this.name = "StackError";
    this.exitCode = exitCode;
    this.details = details;
  }
}

function assertSupportedNodeVersion(version = process.versions.node) {
  const major = Number.parseInt(String(version).split(".")[0], 10);
  if (!Number.isInteger(major) || major < MINIMUM_NODE_MAJOR) {
    throw new StackError(
      `Ultimate Agent Stack requires Node.js ${MINIMUM_NODE_MAJOR} or newer. Detected ${version}. Switch Node versions, then run the command again.`,
      1,
    );
  }
  return {
    ok: true,
    detected: version,
    minimum_major: MINIMUM_NODE_MAJOR,
  };
}

function utcTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function filenameTimestamp() {
  return utcTimestamp().replaceAll("-", "").replaceAll(":", "");
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function portableTextSha256(data) {
  const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  return sha256(text.replaceAll("\r\n", "\n"));
}

function hashFile(file) {
  return sha256(readFileSync(file));
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function activationReceiptSha256(activation) {
  const canonical = { ...activation };
  delete canonical.receipt_sha256;
  return sha256(stableJson(canonical));
}

function atomicText(file, value, mode = 0o600) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = join(
    dirname(file),
    `.${basename(file)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    writeFileSync(temporary, value, {
      encoding: "utf8",
      flush: true,
      mode,
    });
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary);
    }
  }
}

function atomicJson(file, value) {
  atomicText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function projectFile(target, raw, label = "project path") {
  return pathInside(target, raw, label);
}

function projectFileWithoutSymlinkComponents(
  target,
  raw,
  label = "project path",
) {
  const candidate = projectFile(target, raw, label);
  const canonicalTarget = realpathSync(target);
  const relation = relative(canonicalTarget, candidate);
  let cursor = canonicalTarget;
  for (const component of relation.split(sep).filter(Boolean)) {
    cursor = join(cursor, component);
    if (!existsSync(cursor)) {
      break;
    }
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new StackError(`${label} crosses a symlinked path component: ${raw}`);
    }
  }
  return candidate;
}

function atomicProjectJson(target, raw, value, label = raw) {
  atomicJson(projectFile(target, raw, label), value);
}

function atomicProjectText(target, raw, value, label = raw, mode = 0o600) {
  atomicText(projectFile(target, raw, label), value, mode);
}

function projectExists(target, raw, label = raw) {
  return existsSync(projectFile(target, raw, label));
}

function readJson(file, label = file) {
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new StackError(`Missing ${label}: ${file}`);
    }
    throw new StackError(`Invalid JSON in ${label}: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StackError(`${label} must contain a JSON object`);
  }
  return value;
}

function resolveTarget(raw = ".") {
  const candidate = resolve(raw);
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw new StackError(`Target is not a directory: ${candidate}`);
  }
  const target = realpathSync(candidate);
  const root = parse(target).root;
  const userHome = existsSync(homedir()) ? realpathSync(homedir()) : homedir();
  if (target === root || target === userHome) {
    throw new StackError(
      `Refusing broad target ${target}. Use a dedicated project directory.`,
    );
  }
  return target;
}

function pathInside(target, raw, label = "path") {
  if (typeof raw !== "string" || raw.includes("\0")) {
    throw new StackError(`${label} must be a safe relative path`);
  }
  const canonicalTarget = realpathSync(target);
  const candidate = resolve(canonicalTarget, raw);
  const relation = relative(canonicalTarget, candidate);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new StackError(`${label} escapes the project root: ${raw}`);
  }
  let existingAncestor = candidate;
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) {
      break;
    }
    existingAncestor = parent;
  }
  const resolvedAncestor = realpathSync(existingAncestor);
  const ancestorRelation = relative(canonicalTarget, resolvedAncestor);
  if (
    ancestorRelation === ".." ||
    ancestorRelation.startsWith(`..${sep}`) ||
    isAbsolute(ancestorRelation)
  ) {
    throw new StackError(`${label} crosses a symlink outside the project: ${raw}`);
  }
  if (existsSync(candidate)) {
    const resolvedCandidate = realpathSync(candidate);
    const candidateRelation = relative(canonicalTarget, resolvedCandidate);
    if (
      candidateRelation === ".." ||
      candidateRelation.startsWith(`..${sep}`) ||
      isAbsolute(candidateRelation)
    ) {
      throw new StackError(
        `${label} resolves through a symlink outside the project: ${raw}`,
      );
    }
  }
  return candidate;
}

function redact(text, limit = 12_000, additionalValues = []) {
  let clean = String(text ?? "").replace(
    SECRET_ASSIGNMENT,
    "$1$2[REDACTED]",
  );
  for (const [name, value] of Object.entries(process.env)) {
    if (
      SENSITIVE_ENVIRONMENT_NAME.test(name) &&
      typeof value === "string" &&
      value.length >= 8
    ) {
      clean = clean.replaceAll(value, "[REDACTED]");
    }
  }
  for (const value of additionalValues) {
    if (typeof value === "string" && value.length >= 8) {
      clean = clean.replaceAll(value, "[REDACTED]");
    }
  }
  return clean.length > limit
    ? `[output truncated]\n${clean.slice(-limit)}`
    : clean;
}

function getOption(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  if (index + 1 >= args.length || args[index + 1].startsWith("--")) {
    throw new StackError(`${name} requires a value`);
  }
  return args[index + 1];
}

function getRepeatedOption(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      if (index + 1 >= args.length || args[index + 1].startsWith("--")) {
        throw new StackError(`${name} requires a value`);
      }
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function assertNoUnknownOptions(args, allowedWithValue, allowedFlags = []) {
  const valueOptions = new Set(allowedWithValue);
  const flags = new Set(allowedFlags);
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) {
      throw new StackError(`Unexpected argument: ${item}`);
    }
    if (flags.has(item)) {
      continue;
    }
    if (valueOptions.has(item)) {
      index += 1;
      if (index >= args.length || args[index].startsWith("--")) {
        throw new StackError(`${item} requires a value`);
      }
      continue;
    }
    throw new StackError(`Unknown option: ${item}`);
  }
}

function listFiles(root) {
  if (!existsSync(root)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new StackError(`Package assets may not contain symlinks: ${absolute}`);
    }
    if (entry.isDirectory()) {
      files.push(...listFiles(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files.sort();
}

function resolveExecutable(target, executable) {
  if (!executable) {
    return null;
  }
  if (
    executable.startsWith(".") ||
    executable.includes("/") ||
    executable.includes("\\")
  ) {
    try {
      const candidate = projectFile(
        target,
        executable,
        "quality executable",
      );
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      return null;
    }
  }
  const windowsExtensions = normalizeWindowsExtensions(process.env.PATHEXT);
  const hasWindowsExtension =
    platform() === "win32" &&
    windowsExtensions.some((extension) =>
      executable.toLowerCase().endsWith(extension),
    );
  const extensions = platform() === "win32"
    ? (hasWindowsExtension ? [""] : windowsExtensions)
    : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) {
      continue;
    }
    for (const extension of extensions) {
      const candidate = join(directory, `${executable}${extension}`);
      try {
        accessSync(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // Continue searching PATH for an executable candidate.
      }
    }
  }
  return null;
}

function normalizeWindowsExtensions(value) {
  const fallback = [".exe", ".cmd", ".bat", ".com"];
  if (typeof value !== "string") {
    return fallback;
  }
  const extensions = [
    ...new Set(
      value
        .split(";")
        .map((extension) => extension.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  return extensions.length > 0 ? extensions : fallback;
}

function executableExists(target, executable) {
  return resolveExecutable(target, executable) !== null;
}

function spawnPortable(target, executable, args, options) {
  const resolved = resolveExecutable(target, executable) ?? executable;
  return spawnPortableProcess(resolved, args, options);
}

function addCheck(checks, id, argv, timeoutSeconds = 900) {
  if (checks.some((check) => check.id === id)) {
    return;
  }
  checks.push({
    id,
    argv,
    required: true,
    source: "detected",
    timeout_seconds: timeoutSeconds,
  });
}

function packageRunner(manager, script) {
  return [manager, "run", script];
}

function readTextIfPresent(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function detectProject(target) {
  const stacks = [];
  const checks = [];
  const notes = [];
  const environmentWarnings = [];
  const packageFile = projectFile(target, "package.json", "package.json");

  if (existsSync(packageFile)) {
    stacks.push("javascript");
    let manager = "npm";
    if (projectExists(target, "pnpm-lock.yaml")) {
      manager = "pnpm";
    } else if (projectExists(target, "yarn.lock")) {
      manager = "yarn";
    } else if (
      projectExists(target, "bun.lock") ||
      projectExists(target, "bun.lockb")
    ) {
      manager = "bun";
    }
    try {
      const packageData = readJson(packageFile, "package.json");
      const scripts =
        packageData.scripts &&
        typeof packageData.scripts === "object" &&
        !Array.isArray(packageData.scripts)
          ? packageData.scripts
          : {};
      const candidates = [
        ["format", ["format:check", "check:format"]],
        ["lint", ["lint"]],
        ["typecheck", ["typecheck", "type-check", "check:types"]],
        ["test", ["test", "test:ci"]],
        ["build", ["build"]],
      ];
      for (const [id, names] of candidates) {
        const selected = names.find((name) => Object.hasOwn(scripts, name));
        if (selected) {
          addCheck(checks, id, packageRunner(manager, selected));
        }
      }
      notes.push(`JavaScript package manager: ${manager}`);
    } catch (error) {
      notes.push(error.message);
    }
  }

  const pyproject = projectFile(target, "pyproject.toml", "pyproject.toml");
  const requirementFiles = existsSync(target)
    ? readdirSync(target)
        .filter((name) => /^requirements.*\.txt$/i.test(name))
        .map((name) => projectFile(target, name, "Python requirements file"))
    : [];
  if (existsSync(pyproject) || requirementFiles.length > 0) {
    stacks.push("python");
    const pythonText = [pyproject, ...requirementFiles]
      .map(readTextIfPresent)
      .join("\n")
      .toLowerCase();
    const uv = projectExists(target, "uv.lock");
    if (pythonText.includes("ruff")) {
      addCheck(
        checks,
        "lint",
        uv
          ? ["uv", "run", "ruff", "check", "."]
          : ["python3", "-m", "ruff", "check", "."],
      );
    }
    if (pythonText.includes("mypy")) {
      addCheck(
        checks,
        "typecheck",
        uv
          ? ["uv", "run", "mypy", "."]
          : ["python3", "-m", "mypy", "."],
      );
    } else if (pythonText.includes("pyright")) {
      addCheck(
        checks,
        "typecheck",
        uv ? ["uv", "run", "pyright"] : ["pyright"],
      );
    }
    if (
      pythonText.includes("pytest") ||
      projectExists(target, "tests")
    ) {
      addCheck(
        checks,
        "test",
        uv
          ? ["uv", "run", "pytest", "-q"]
          : ["python3", "-m", "pytest", "-q"],
      );
    }
  }

  if (projectExists(target, "go.mod")) {
    stacks.push("go");
    addCheck(checks, "lint", ["go", "vet", "./..."]);
    addCheck(checks, "test", ["go", "test", "./..."]);
    addCheck(checks, "build", ["go", "build", "./..."]);
  }

  if (projectExists(target, "Cargo.toml")) {
    stacks.push("rust");
    environmentWarnings.push({
      stack: "rust",
      isolated: ["CARGO_HOME"],
      detail:
        "CARGO_HOME remains isolated because it can contain registry credentials. Configure an approved non-secret cache path if offline checks require one.",
    });
    addCheck(checks, "format", ["cargo", "fmt", "--check"]);
    addCheck(
      checks,
      "lint",
      [
        "cargo",
        "clippy",
        "--all-targets",
        "--all-features",
        "--",
        "-D",
        "warnings",
      ],
      1200,
    );
    addCheck(
      checks,
      "test",
      ["cargo", "test", "--all-features"],
      1200,
    );
    addCheck(checks, "build", ["cargo", "build"], 1200);
  }

  if (projectExists(target, "pom.xml")) {
    stacks.push("java-maven");
    environmentWarnings.push({
      stack: "java-maven",
      inherited_if_present: ["JAVA_HOME", "M2_HOME", "MAVEN_HOME"],
      isolated: ["HOME"],
      detail:
        "Java toolchain paths are preserved, but user-home Maven settings are isolated. Explicitly approve any additional non-secret environment names before check approval.",
    });
    const executable = projectExists(target, "mvnw") ? "./mvnw" : "mvn";
    addCheck(checks, "verify", [executable, "verify"], 1800);
  } else if (
    projectExists(target, "build.gradle") ||
    projectExists(target, "build.gradle.kts")
  ) {
    stacks.push("java-gradle");
    environmentWarnings.push({
      stack: "java-gradle",
      inherited_if_present: ["JAVA_HOME"],
      isolated: ["GRADLE_USER_HOME", "HOME"],
      detail:
        "JAVA_HOME is preserved when present, but Gradle user-home data stays isolated because it may contain credentials. Explicitly approve only non-secret environment names.",
    });
    const executable = projectExists(target, "gradlew")
      ? "./gradlew"
      : "gradle";
    addCheck(checks, "verify", [executable, "check"], 1800);
  }

  const rootNames = readdirSync(target);
  const dotnet =
    rootNames.find((name) => name.endsWith(".sln")) ??
    rootNames.find((name) => name.endsWith(".csproj"));
  if (dotnet) {
    stacks.push("dotnet");
    environmentWarnings.push({
      stack: "dotnet",
      inherited_if_present: ["DOTNET_ROOT"],
      isolated: ["HOME"],
      detail:
        "DOTNET_ROOT is preserved when present; other environment names require explicit approval.",
    });
    addCheck(checks, "build", ["dotnet", "build", dotnet], 1200);
    addCheck(checks, "test", ["dotnet", "test", dotnet], 1200);
  }

  if (projectExists(target, "Gemfile")) {
    stacks.push("ruby");
    if (projectExists(target, ".rubocop.yml")) {
      addCheck(checks, "lint", ["bundle", "exec", "rubocop"]);
    }
    if (projectExists(target, "spec")) {
      addCheck(checks, "test", ["bundle", "exec", "rspec"]);
    }
  }

  if (projectExists(target, "Package.swift")) {
    stacks.push("swift");
    addCheck(checks, "test", ["swift", "test"], 1200);
    addCheck(checks, "build", ["swift", "build"], 1200);
  }

  if (rootNames.some((name) => name.endsWith(".tf"))) {
    stacks.push("terraform");
    addCheck(checks, "format", [
      "terraform",
      "fmt",
      "-check",
      "-recursive",
    ]);
    addCheck(checks, "validate", ["terraform", "validate"]);
  }

  if (
    projectExists(target, "docker-compose.yml") ||
    projectExists(target, "compose.yaml")
  ) {
    stacks.push("docker-compose");
    addCheck(checks, "compose-config", ["docker", "compose", "config"]);
  }

  return {
    detected_at: utcTimestamp(),
    stacks: stacks.length > 0 ? stacks : ["unknown"],
    checks,
    notes,
    environment_warnings: environmentWarnings,
  };
}

function defaultConfig(target, detected) {
  return {
    schema_version: CONFIG_SCHEMA_VERSION,
    project: {
      name: basename(target),
      stacks: detected.stacks,
      detected_at: detected.detected_at,
    },
    onboarding: {
      status: "pending",
      project_profile: "standard",
      external_data_policy: "local_only",
      configured_at: null,
    },
    interaction: {
      mode: "guided",
      plain_language: true,
      ask_one_decision_at_a_time: true,
      recommendation_required: true,
      maximum_options: 2,
      unsafe_alternatives_forbidden: true,
    },
    capabilities: {
      review: {
        provider: "builtin",
        required_for_release: false,
        current_revision_required: true,
        allowed_logins: [],
      },
      knowledge: {
        provider: "repository",
        scope: "project",
        required: false,
        capture: "verified_proposals_only",
        repository_fallback: true,
      },
      telemetry: {
        providers: [],
        required: false,
        default_access: "read_only",
        evidence_capture: "bounded_references_only",
        raw_payload_storage: false,
        repository_fallback: true,
      },
      work: {
        provider: "repository",
        required: false,
        sync_mode: "repository_only",
        write_policy: "repository_only",
        repository_fallback: true,
        linear_idempotency_namespace: randomBytes(32).toString("hex"),
        connection: null,
      },
    },
    learning: {
      auto_activate_skills: false,
      verified_candidates_only: true,
      evaluation_required: true,
    },
    autonomy: {
      execution: "agent_owned",
      merge: "human_approval_required",
      parallel_work: "coordinator_managed_isolated_only",
      max_repair_loops: 5,
    },
    parallel_delivery: {
      mode: "adaptive",
      max_workers: 3,
      serial_fallback: true,
      require_isolation_for_parallel_writes: true,
      allow_nested_delegation: false,
      authority_inheritance: "no_expansion",
      integration_owner: "primary_agent",
    },
    safety: {
      require_check_approval: true,
      approved_checks_hash: null,
      approved_at: null,
      approval_reason: null,
      approved_configuration_hash: null,
      configuration_approved_at: null,
      configuration_approval_reason: null,
      project_root_only: true,
      forbid_shell_commands: true,
      max_check_timeout_seconds: 7200,
    },
    quality: {
      require_project_checks: true,
      checks: detected.checks,
      evidence_directory: RUNS_PATH,
      environment: {
        allow: [],
      },
    },
    lock_artifacts: DEFAULT_ARTIFACTS,
  };
}

function migrateConfig(config, target = undefined) {
  const previousSchema = config.schema_version ?? 1;
  if (previousSchema < CONFIG_SCHEMA_VERSION) {
    config.schema_version = CONFIG_SCHEMA_VERSION;
  }
  config.project ??= {};
  const detectedCodeRabbit =
    Boolean(target) &&
    (projectExists(target, ".coderabbit.yaml") ||
      projectExists(target, REVIEW_WORKFLOW_PATH));
  config.onboarding ??= {
    status: previousSchema < CONFIG_SCHEMA_VERSION ? "needs_confirmation" : "pending",
    project_profile: detectedCodeRabbit ? "production" : "standard",
    external_data_policy: "local_only",
    configured_at: null,
  };
  config.onboarding.status ??=
    previousSchema < CONFIG_SCHEMA_VERSION ? "needs_confirmation" : "pending";
  config.onboarding.project_profile ??= detectedCodeRabbit
    ? "production"
    : "standard";
  config.onboarding.external_data_policy ??= "local_only";
  config.onboarding.configured_at ??= null;
  config.interaction ??= {};
  config.interaction.mode ??= "guided";
  config.interaction.plain_language ??= true;
  config.interaction.ask_one_decision_at_a_time ??= true;
  config.interaction.recommendation_required ??= true;
  config.interaction.maximum_options ??= 2;
  config.interaction.unsafe_alternatives_forbidden ??= true;
  config.capabilities ??= {};
  config.capabilities.review ??= {
    provider: detectedCodeRabbit ? "coderabbit" : "builtin",
    required_for_release: detectedCodeRabbit,
    current_revision_required: true,
    allowed_logins: [],
  };
  config.capabilities.review.provider ??= detectedCodeRabbit
    ? "coderabbit"
    : "builtin";
  config.capabilities.review.required_for_release ??=
    config.capabilities.review.provider !== "builtin";
  config.capabilities.review.current_revision_required ??= true;
  config.capabilities.review.allowed_logins = Array.isArray(
    config.capabilities.review.allowed_logins,
  )
    ? [...new Set(config.capabilities.review.allowed_logins)]
    : [];
  config.capabilities.knowledge ??= {};
  config.capabilities.knowledge.provider ??= "repository";
  config.capabilities.knowledge.scope ??= "project";
  config.capabilities.knowledge.required ??= false;
  config.capabilities.knowledge.capture ??= "verified_proposals_only";
  config.capabilities.knowledge.repository_fallback ??= true;
  if (config.capabilities.telemetry == null) {
    config.capabilities.telemetry = {};
  }
  if (
    typeof config.capabilities.telemetry === "object" &&
    !Array.isArray(config.capabilities.telemetry)
  ) {
    config.capabilities.telemetry.providers = Array.isArray(
      config.capabilities.telemetry.providers,
    )
      ? config.capabilities.telemetry.providers
      : [];
    config.capabilities.telemetry.required ??= false;
    config.capabilities.telemetry.default_access ??= "read_only";
    config.capabilities.telemetry.evidence_capture ??=
      "bounded_references_only";
    config.capabilities.telemetry.raw_payload_storage ??= false;
    config.capabilities.telemetry.repository_fallback ??= true;
  }
  if (config.capabilities.work == null) {
    config.capabilities.work = {};
  }
  if (
    typeof config.capabilities.work === "object" &&
    !Array.isArray(config.capabilities.work)
  ) {
    const legacyLinearNamespace =
      previousSchema < 7 &&
      typeof config.capabilities.work.connection?.writes
        ?.idempotency_namespace === "string" &&
      /^[a-f0-9]{64}$/.test(
        config.capabilities.work.connection.writes.idempotency_namespace,
      )
        ? config.capabilities.work.connection.writes.idempotency_namespace
        : null;
    config.capabilities.work.provider ??= "repository";
    config.capabilities.work.required ??= false;
    config.capabilities.work.sync_mode ??= "repository_only";
    config.capabilities.work.write_policy ??= "repository_only";
    config.capabilities.work.repository_fallback ??= true;
    config.capabilities.work.linear_idempotency_namespace ??=
      legacyLinearNamespace ?? randomBytes(32).toString("hex");
    config.capabilities.work.connection ??= null;
    if (
      config.capabilities.work.connection &&
      typeof config.capabilities.work.connection === "object" &&
      !Array.isArray(config.capabilities.work.connection)
    ) {
      config.capabilities.work.connection.writes ??= null;
      if (
        previousSchema < 7 &&
        config.capabilities.work.connection.writes &&
        typeof config.capabilities.work.connection.writes === "object" &&
        !Array.isArray(config.capabilities.work.connection.writes)
      ) {
        delete config.capabilities.work.connection.writes
          .idempotency_namespace;
      }
    }
  }
  config.learning ??= {};
  config.learning.auto_activate_skills ??= false;
  config.learning.verified_candidates_only ??= true;
  config.learning.evaluation_required ??= true;
  config.autonomy ??= {};
  config.autonomy.execution ??= "agent_owned";
  config.autonomy.merge ??= "human_approval_required";
  if (
    config.autonomy.parallel_work === undefined ||
    config.autonomy.parallel_work === "isolated_independent_only"
  ) {
    config.autonomy.parallel_work = "coordinator_managed_isolated_only";
  }
  config.autonomy.max_repair_loops ??= 5;
  config.parallel_delivery ??= {};
  if (
    typeof config.parallel_delivery === "object" &&
    !Array.isArray(config.parallel_delivery)
  ) {
    config.parallel_delivery.mode ??= "adaptive";
    config.parallel_delivery.max_workers ??= 3;
    config.parallel_delivery.serial_fallback ??= true;
    config.parallel_delivery.require_isolation_for_parallel_writes ??= true;
    config.parallel_delivery.allow_nested_delegation ??= false;
    config.parallel_delivery.authority_inheritance ??= "no_expansion";
    config.parallel_delivery.integration_owner ??= "primary_agent";
  }
  config.safety ??= {};
  config.safety.require_check_approval ??= true;
  config.safety.approved_checks_hash ??= null;
  config.safety.approved_at ??= null;
  config.safety.approval_reason ??= null;
  config.safety.approved_configuration_hash ??= null;
  config.safety.configuration_approved_at ??= null;
  config.safety.configuration_approval_reason ??= null;
  config.safety.project_root_only = true;
  config.safety.forbid_shell_commands = true;
  config.safety.max_check_timeout_seconds ??= 7200;
  config.quality ??= {};
  config.quality.require_project_checks ??= true;
  config.quality.checks ??= [];
  config.quality.evidence_directory ??= RUNS_PATH;
  if (config.quality.environment == null) {
    config.quality.environment = {};
  }
  if (
    typeof config.quality.environment === "object" &&
    !Array.isArray(config.quality.environment)
  ) {
    config.quality.environment.allow = Array.isArray(
      config.quality.environment.allow,
    )
      ? [...new Set(config.quality.environment.allow)]
      : [];
  }
  config.lock_artifacts = Array.isArray(config.lock_artifacts)
    ? [...new Set([...config.lock_artifacts, ...DEFAULT_ARTIFACTS])]
    : DEFAULT_ARTIFACTS;
  return config;
}

function gitArgumentAllowed(subcommand, argument) {
  const exactArguments = {
    diff: GIT_DIFF_EXACT_ARGUMENTS,
    log: GIT_LOG_EXACT_ARGUMENTS,
    "rev-parse": GIT_REV_PARSE_EXACT_ARGUMENTS,
    show: GIT_SHOW_EXACT_ARGUMENTS,
    status: GIT_STATUS_EXACT_ARGUMENTS,
  }[subcommand];
  if (exactArguments?.has(argument)) {
    return true;
  }
  const patterns = {
    diff: [
      /^--color=(?:always|auto|never)$/,
      /^--diff-filter=[ACDMRTUXB*]+$/,
      /^--ignore-submodules=(?:all|dirty|none|untracked)$/,
      /^--unified=\d+$/,
      /^-U\d+$/,
    ],
    log: [
      /^--color=(?:always|auto|never)$/,
      /^--date=(?:default|human|iso|iso-strict|local|raw|relative|rfc|short|unix)$/,
      /^--decorate=(?:auto|full|no|short)$/,
      /^--diff-filter=[ACDMRTUXB*]+$/,
      /^--format=(?:%H|%h|%s|%an|%ae|%aI|%cI)$/,
      /^--grep=.+$/,
      /^--ignore-submodules=(?:all|dirty|none|untracked)$/,
      /^--max-count=\d+$/,
      /^--pretty=(?:email|full|fuller|medium|oneline|raw|reference|short)$/,
      /^--skip=\d+$/,
      /^-n\d+$/,
    ],
    "rev-parse": [
      /^--abbrev-ref=(?:loose|strict)$/,
      /^--short=\d+$/,
      /^--show-object-format=(?:input|output|storage)$/,
    ],
    show: [
      /^--color=(?:always|auto|never)$/,
      /^--date=(?:default|human|iso|iso-strict|local|raw|relative|rfc|short|unix)$/,
      /^--decorate=(?:auto|full|no|short)$/,
      /^--diff-filter=[ACDMRTUXB*]+$/,
      /^--format=(?:%H|%h|%s|%an|%ae|%aI|%cI)$/,
      /^--ignore-submodules=(?:all|dirty|none|untracked)$/,
      /^--pretty=(?:email|full|fuller|medium|oneline|raw|reference|short)$/,
    ],
    status: [
      /^--find-renames=\d+%?$/,
      /^--ignore-submodules=(?:all|dirty|none|untracked)$/,
      /^--ignored=(?:matching|no|traditional)$/,
      /^--porcelain=v[12]$/,
      /^--untracked-files=(?:all|no|normal)$/,
      /^-u(?:all|no|normal)$/,
    ],
  }[subcommand] ?? [];
  return patterns.some((pattern) => pattern.test(argument));
}

function gitRevisionAtomSafe(value) {
  const withoutSuffix = value.replace(/(?:[~^]\d*)+$/, "");
  if (
    !/^(?:@|HEAD|[0-9A-Fa-f]{4,64}|(?:refs\/)?[A-Za-z0-9][A-Za-z0-9._/-]*)$/.test(
      withoutSuffix,
    )
  ) {
    return false;
  }
  const segments = withoutSuffix.split("/");
  return !segments.includes(".") && !segments.includes("..");
}

function gitRevisionSafe(value) {
  if (
    value.includes("\\") ||
    value.includes(":") ||
    isAbsolute(value)
  ) {
    return false;
  }
  const separator = value.includes("...") ? "..." : value.includes("..") ? ".." : null;
  const atoms = separator ? value.split(separator) : [value];
  return (
    atoms.length <= 2 &&
    atoms.every((atom) => atom.length > 0 && gitRevisionAtomSafe(atom))
  );
}

function projectArgumentSafe(raw, target, label) {
  if (
    isAbsolute(raw) ||
    /^[A-Za-z]:[\\/]/.test(raw) ||
    raw.split(/[\\/]+/).includes("..")
  ) {
    return false;
  }
  if (!target) {
    return true;
  }
  try {
    projectFile(target, raw, label);
    return true;
  } catch {
    return false;
  }
}

function validateGitCommand(argv, index, target = undefined) {
  const errors = [];
  const subcommand = argv[1];
  const label = `quality.checks[${index}]`;
  if (!GIT_INSPECTION_SUBCOMMANDS.has(subcommand)) {
    return [
      `${label} uses a non-read-only git command: ${subcommand}`,
    ];
  }

  const argumentsAfterSubcommand = argv.slice(2);
  const forbidden = argumentsAfterSubcommand.find((argument) =>
    GIT_FORBIDDEN_ARGUMENT_PATTERNS.some((pattern) =>
      pattern.test(argument),
    ),
  );
  if (forbidden) {
    errors.push(
      `${label} git ${subcommand} forbids write or execution argument: ${forbidden}`,
    );
  }

  const requiresDiffIsolation = ["diff", "log", "show"].includes(subcommand);
  if (
    requiresDiffIsolation &&
    (!argumentsAfterSubcommand.includes("--no-ext-diff") ||
      !argumentsAfterSubcommand.includes("--no-textconv"))
  ) {
    errors.push(
      `${label} git ${subcommand} must include --no-ext-diff and --no-textconv`,
    );
  }

  let pathsFollow = false;
  let revisionCount = 0;
  for (const argument of argumentsAfterSubcommand) {
    if (pathsFollow) {
      if (!projectArgumentSafe(argument, target, "git pathspec")) {
        errors.push(
          `${label} git ${subcommand} pathspec escapes the project root: ${argument}`,
        );
      }
      continue;
    }
    if (argument === "--" && subcommand !== "rev-parse") {
      pathsFollow = true;
      continue;
    }
    if (argument.startsWith("-")) {
      if (!gitArgumentAllowed(subcommand, argument)) {
        errors.push(
          `${label} git ${subcommand} argument is not allowlisted: ${argument}`,
        );
      }
      continue;
    }
    if (subcommand === "status") {
      errors.push(
        `${label} git status pathspecs must follow --: ${argument}`,
      );
      continue;
    }
    if (!gitRevisionSafe(argument)) {
      errors.push(
        `${label} git ${subcommand} revision is not allowlisted: ${argument}`,
      );
      continue;
    }
    revisionCount += 1;
  }

  const maximumRevisions = {
    diff: 2,
    log: 2,
    "rev-parse": 1,
    show: 1,
    status: 0,
  }[subcommand];
  if (revisionCount > maximumRevisions) {
    errors.push(
      `${label} git ${subcommand} accepts at most ${maximumRevisions} revision argument${maximumRevisions === 1 ? "" : "s"}`,
    );
  }
  return errors;
}

function validateTerraformCommand(argv, index, target = undefined) {
  const errors = [];
  const subcommand = argv[1];
  const label = `quality.checks[${index}]`;
  if (!["fmt", "validate"].includes(subcommand)) {
    return [`${label} terraform command must be fmt or validate`];
  }
  const argumentsAfterSubcommand = argv.slice(2);
  if (subcommand === "validate") {
    const allowed = new Set(["-json", "-no-color"]);
    for (const argument of argumentsAfterSubcommand) {
      if (!allowed.has(argument)) {
        errors.push(
          `${label} terraform validate argument is not allowlisted: ${argument}`,
        );
      }
    }
    return errors;
  }

  const allowed = new Set([
    "-check",
    "-diff",
    "-list=false",
    "-no-color",
    "-recursive",
    "-write=false",
  ]);
  if (!argumentsAfterSubcommand.includes("-check")) {
    errors.push(`${label} terraform fmt must include -check`);
  }
  for (const argument of argumentsAfterSubcommand) {
    if (argument.startsWith("-")) {
      if (!allowed.has(argument)) {
        errors.push(
          `${label} terraform fmt argument is not allowlisted: ${argument}`,
        );
      }
      continue;
    }
    if (!projectArgumentSafe(argument, target, "terraform fmt target")) {
      errors.push(
        `${label} terraform fmt target escapes the project root: ${argument}`,
      );
    }
  }
  return errors;
}

function canonicalExecutableName(value) {
  const portableBasename = String(value)
    .replaceAll("\\", "/")
    .split("/")
    .at(-1);
  return portableBasename
    .toLowerCase()
    .replace(/\.(?:bat|cmd|com|exe)$/u, "");
}

function inlineEvaluationArgumentsForExecutable(executable) {
  const exact = INLINE_EVALUATION_ARGUMENTS.get(executable);
  if (exact) {
    return exact;
  }
  return VERSIONED_INLINE_EVALUATION_ARGUMENTS.find(([pattern]) =>
    pattern.test(executable),
  )?.[1];
}

function validateCommand(check, index, config, target = undefined) {
  const errors = [];
  if (!check || typeof check !== "object" || Array.isArray(check)) {
    return [`quality.checks[${index}] must be an object`];
  }
  if (typeof check.id !== "string" || check.id.length === 0) {
    errors.push(`quality.checks[${index}].id must be a non-empty string`);
  }
  if (
    !Array.isArray(check.argv) ||
    check.argv.length === 0 ||
    !check.argv.every(
      (value) =>
        typeof value === "string" &&
        value.length > 0 &&
        !/[\0\r\n]/.test(value),
    )
  ) {
    errors.push(
      `quality.checks[${index}].argv must be a non-empty, control-free string array`,
    );
    return errors;
  }
  const executable = canonicalExecutableName(check.argv[0]);
  if (
    isAbsolute(check.argv[0]) ||
    check.argv[0] === ".." ||
    check.argv[0].startsWith(`..${sep}`) ||
    check.argv[0].startsWith("../") ||
    check.argv[0].startsWith("..\\")
  ) {
    errors.push(
      `quality.checks[${index}] executable must use PATH or a project-local relative path`,
    );
  }
  if (
    target &&
    (check.argv[0].startsWith(".") ||
      check.argv[0].includes("/") ||
      check.argv[0].includes("\\"))
  ) {
    try {
      projectFile(target, check.argv[0], "quality executable");
    } catch (error) {
      errors.push(`quality.checks[${index}] ${error.message}`);
    }
  }
  if (FORBIDDEN_EXECUTABLES.has(executable)) {
    errors.push(
      `quality.checks[${index}] uses forbidden shell, command wrapper, network client, or destructive executable: ${executable}`,
    );
  }
  const inlineEvaluationArguments =
    inlineEvaluationArgumentsForExecutable(executable);
  if (
    inlineEvaluationArguments &&
    check.argv
      .slice(1)
      .some((argument) =>
        [...inlineEvaluationArguments].some(
          (option) =>
            argument === option ||
            argument.startsWith(`${option}=`) ||
            (option.startsWith("-") &&
              !option.startsWith("--") &&
              !argument.startsWith("--") &&
              argument.startsWith(option)),
        ),
      )
  ) {
    errors.push(
      `quality.checks[${index}] uses inline code evaluation; use a reviewed project file or fingerprinted package script instead`,
    );
  }
  if (
    executable === "git"
  ) {
    errors.push(...validateGitCommand(check.argv, index, target));
  }
  if (
    PACKAGE_MANAGERS.has(executable) &&
    !["run", "test"].includes(check.argv[1])
  ) {
    errors.push(
      `quality.checks[${index}] package-manager command must be run or test`,
    );
  }
  if (
    executable === "terraform"
  ) {
    errors.push(...validateTerraformCommand(check.argv, index, target));
  }
  if (
    executable === "docker" &&
    !(check.argv[1] === "compose" && check.argv.at(-1) === "config")
  ) {
    errors.push(
      `quality.checks[${index}] docker quality command must be compose config`,
    );
  }
  if (check.required !== true) {
    errors.push(`quality.checks[${index}].required must remain true`);
  }
  const timeout = check.timeout_seconds ?? 900;
  const maximum = config.safety?.max_check_timeout_seconds ?? 7200;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > maximum) {
    errors.push(
      `quality.checks[${index}].timeout_seconds must be between 1 and ${maximum}`,
    );
  }
  return errors;
}

function rejectUnknownKeys(errors, value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`${label} contains unsupported key: ${key}`);
    }
  }
}

function validateTelemetryProvider(value, label, expectedProvider) {
  const errors = [];
  rejectUnknownKeys(
    errors,
    value,
    new Set(["provider", "role", "region", "credential_env", "scope"]),
    label,
  );
  if (value.provider !== expectedProvider) {
    errors.push(`${label}.provider must equal ${expectedProvider}`);
  }
  if (value.role !== TELEMETRY_PROVIDER_ROLES[expectedProvider]) {
    errors.push(
      `${label}.role must equal ${TELEMETRY_PROVIDER_ROLES[expectedProvider]}`,
    );
  }
  if (!TELEMETRY_PROVIDER_REGIONS[expectedProvider].has(value.region)) {
    errors.push(
      `${label}.region is not approved for ${expectedProvider}`,
    );
  }
  if (
    value.credential_env !==
    TELEMETRY_CREDENTIAL_ENVIRONMENTS[expectedProvider]
  ) {
    errors.push(
      `${label}.credential_env must equal ${TELEMETRY_CREDENTIAL_ENVIRONMENTS[expectedProvider]}`,
    );
  }
  if (!value.scope || typeof value.scope !== "object" || Array.isArray(value.scope)) {
    errors.push(`${label}.scope must be an object`);
    return errors;
  }
  if (expectedProvider === "posthog") {
    rejectUnknownKeys(
      errors,
      value.scope,
      new Set(["project_id"]),
      `${label}.scope`,
    );
    if (
      typeof value.scope.project_id !== "string" ||
      !TELEMETRY_NUMERIC_ID.test(value.scope.project_id) ||
      !Number.isSafeInteger(Number(value.scope.project_id))
    ) {
      errors.push(`${label}.scope.project_id must be a positive numeric identifier`);
    }
  } else if (expectedProvider === "sentry") {
    rejectUnknownKeys(
      errors,
      value.scope,
      new Set(["organization", "project"]),
      `${label}.scope`,
    );
    if (
      typeof value.scope.organization !== "string" ||
      !TELEMETRY_IDENTIFIER.test(value.scope.organization)
    ) {
      errors.push(`${label}.scope.organization must be a bounded slug`);
    }
    if (
      typeof value.scope.project !== "string" ||
      !TELEMETRY_IDENTIFIER.test(value.scope.project)
    ) {
      errors.push(`${label}.scope.project must be a bounded slug`);
    }
  } else {
    rejectUnknownKeys(
      errors,
      value.scope,
      new Set(["account_id"]),
      `${label}.scope`,
    );
    if (
      typeof value.scope.account_id !== "string" ||
      !TELEMETRY_NUMERIC_ID.test(value.scope.account_id) ||
      !Number.isSafeInteger(Number(value.scope.account_id))
    ) {
      errors.push(`${label}.scope.account_id must be a positive numeric identifier`);
    }
  }
  return errors;
}

function validateConfig(config, target = undefined) {
  const errors = [];
  if (config.schema_version !== CONFIG_SCHEMA_VERSION) {
    errors.push(`schema_version must equal ${CONFIG_SCHEMA_VERSION}`);
  }
  if (!config.quality || typeof config.quality !== "object") {
    return [...errors, "quality must be an object"];
  }
  if (!config.safety || typeof config.safety !== "object") {
    return [...errors, "safety must be an object"];
  }
  if (
    !config.parallel_delivery ||
    typeof config.parallel_delivery !== "object" ||
    Array.isArray(config.parallel_delivery)
  ) {
    return [...errors, "parallel_delivery must be an object"];
  }
  if (
    !config.onboarding ||
    typeof config.onboarding !== "object" ||
    Array.isArray(config.onboarding)
  ) {
    return [...errors, "onboarding must be an object"];
  }
  if (!["pending", "needs_confirmation", "complete"].includes(config.onboarding.status)) {
    errors.push(
      "onboarding.status must be pending, needs_confirmation, or complete",
    );
  }
  if (!PROJECT_PROFILES.has(config.onboarding.project_profile)) {
    errors.push(
      "onboarding.project_profile must be experimental, standard, or production",
    );
  }
  if (
    !EXTERNAL_DATA_POLICIES.has(config.onboarding.external_data_policy)
  ) {
    errors.push(
      "onboarding.external_data_policy must be local_only or approved_providers",
    );
  }
  rejectUnknownKeys(
    errors,
    config.onboarding,
    new Set([
      "status",
      "project_profile",
      "external_data_policy",
      "configured_at",
    ]),
    "onboarding",
  );
  rejectUnknownKeys(
    errors,
    config.interaction,
    new Set([
      "mode",
      "plain_language",
      "ask_one_decision_at_a_time",
      "recommendation_required",
      "maximum_options",
      "unsafe_alternatives_forbidden",
    ]),
    "interaction",
  );
  if (
    config.interaction?.mode !== "guided" ||
    config.interaction?.plain_language !== true ||
    config.interaction?.ask_one_decision_at_a_time !== true ||
    config.interaction?.recommendation_required !== true ||
    config.interaction?.maximum_options !== 2 ||
    config.interaction?.unsafe_alternatives_forbidden !== true
  ) {
    errors.push(
      "interaction must preserve guided plain-language decisions with one recommendation, at most one alternative, and no unsafe alternatives",
    );
  }
  const review = config.capabilities?.review;
  const knowledge = config.capabilities?.knowledge;
  const telemetry = config.capabilities?.telemetry;
  const work = config.capabilities?.work;
  rejectUnknownKeys(
    errors,
    config.capabilities,
    new Set(["review", "knowledge", "telemetry", "work"]),
    "capabilities",
  );
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    errors.push("capabilities.review must be an object");
  } else {
    rejectUnknownKeys(
      errors,
      review,
      new Set([
        "provider",
        "required_for_release",
        "current_revision_required",
        "allowed_logins",
      ]),
      "capabilities.review",
    );
    if (!REVIEW_PROVIDERS.has(review.provider)) {
      errors.push(
        "capabilities.review.provider must be builtin, coderabbit, or github-human",
      );
    }
    if (typeof review.required_for_release !== "boolean") {
      errors.push(
        "capabilities.review.required_for_release must be a boolean",
      );
    }
    if (review.current_revision_required !== true) {
      errors.push(
        "capabilities.review.current_revision_required must remain true",
      );
    }
    if (
      !Array.isArray(review.allowed_logins) ||
      !review.allowed_logins.every(
        (login) =>
          typeof login === "string" &&
          /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login),
      )
    ) {
      errors.push(
        "capabilities.review.allowed_logins must contain valid GitHub logins",
      );
    }
    if (
      review.provider === "github-human" &&
      (!Array.isArray(review.allowed_logins) ||
        review.allowed_logins.length === 0)
    ) {
      errors.push(
        "github-human review requires at least one allowed GitHub login",
      );
    }
  }
  if (!knowledge || typeof knowledge !== "object" || Array.isArray(knowledge)) {
    errors.push("capabilities.knowledge must be an object");
  } else {
    rejectUnknownKeys(
      errors,
      knowledge,
      new Set([
        "provider",
        "scope",
        "required",
        "capture",
        "repository_fallback",
      ]),
      "capabilities.knowledge",
    );
    if (!KNOWLEDGE_PROVIDERS.has(knowledge.provider)) {
      errors.push(
        "capabilities.knowledge.provider must be repository or gbrain",
      );
    }
    if (!KNOWLEDGE_SCOPES.has(knowledge.scope)) {
      errors.push(
        "capabilities.knowledge.scope must be project or organization",
      );
    }
    if (knowledge.required !== false) {
      errors.push("capabilities.knowledge.required must remain false");
    }
    if (
      !["disabled", "verified_proposals_only"].includes(knowledge.capture)
    ) {
      errors.push(
        "capabilities.knowledge.capture must be disabled or verified_proposals_only",
      );
    }
    if (knowledge.repository_fallback !== true) {
      errors.push(
        "capabilities.knowledge.repository_fallback must remain true",
      );
    }
    if (
      knowledge.provider === "gbrain" &&
      config.onboarding.external_data_policy !== "approved_providers"
    ) {
      errors.push(
        "gbrain requires onboarding.external_data_policy approved_providers",
      );
    }
    if (
      knowledge.provider === "repository" &&
      knowledge.scope !== "project"
    ) {
      errors.push("repository knowledge supports project scope only");
    }
  }
  if (!telemetry || typeof telemetry !== "object" || Array.isArray(telemetry)) {
    errors.push("capabilities.telemetry must be an object");
  } else {
    rejectUnknownKeys(
      errors,
      telemetry,
      new Set([
        "providers",
        "required",
        "default_access",
        "evidence_capture",
        "raw_payload_storage",
        "repository_fallback",
      ]),
      "capabilities.telemetry",
    );
    if (!Array.isArray(telemetry.providers)) {
      errors.push("capabilities.telemetry.providers must be an array");
    } else {
      const providerNames = new Set();
      for (const [index, provider] of telemetry.providers.entries()) {
        const label = `capabilities.telemetry.providers[${index}]`;
        if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
          errors.push(`${label} must be an object`);
          continue;
        }
        if (typeof provider.provider !== "string") {
          errors.push(`${label}.provider must be a string`);
          continue;
        }
        if (providerNames.has(provider.provider)) {
          errors.push(
            `capabilities.telemetry.providers contains duplicate provider: ${provider.provider}`,
          );
        }
        providerNames.add(provider.provider);
        const validator = TELEMETRY_PROVIDERS.get(provider.provider);
        if (!validator) {
          errors.push(
            `${label}.provider is not a reviewed telemetry provider: ${provider.provider}`,
          );
        } else {
          errors.push(...validator(provider, label));
        }
      }
    }
    if (telemetry.required !== false) {
      errors.push("capabilities.telemetry.required must remain false");
    }
    if (!TELEMETRY_ACCESS_MODES.has(telemetry.default_access)) {
      errors.push(
        "capabilities.telemetry.default_access must be read_only",
      );
    }
    if (!TELEMETRY_EVIDENCE_MODES.has(telemetry.evidence_capture)) {
      errors.push(
        "capabilities.telemetry.evidence_capture must be bounded_references_only",
      );
    }
    if (telemetry.raw_payload_storage !== false) {
      errors.push(
        "capabilities.telemetry.raw_payload_storage must remain false",
      );
    }
    if (telemetry.repository_fallback !== true) {
      errors.push(
        "capabilities.telemetry.repository_fallback must remain true",
      );
    }
    if (
      Array.isArray(telemetry.providers) &&
      telemetry.providers.length > 0 &&
      config.onboarding.external_data_policy !== "approved_providers"
    ) {
      errors.push(
        "external telemetry providers require onboarding.external_data_policy approved_providers",
      );
    }
  }
  if (!work || typeof work !== "object" || Array.isArray(work)) {
    errors.push("capabilities.work must be an object");
  } else {
    rejectUnknownKeys(
      errors,
      work,
      new Set([
        "provider",
        "required",
        "sync_mode",
        "write_policy",
        "repository_fallback",
        "linear_idempotency_namespace",
        "connection",
      ]),
      "capabilities.work",
    );
    if (!WORK_PROVIDERS.has(work.provider)) {
      errors.push("capabilities.work.provider must be repository or linear");
    }
    if (work.required !== false) {
      errors.push("capabilities.work.required must remain false");
    }
    if (!WORK_SYNC_MODES.has(work.sync_mode)) {
      errors.push(
        "capabilities.work.sync_mode must be repository_only or read_only_mirror",
      );
    }
    if (!WORK_WRITE_POLICIES.has(work.write_policy)) {
      errors.push(
        "capabilities.work.write_policy must be repository_only, read_only, receipted_create, or receipted_create_and_comment",
      );
    }
    if (work.repository_fallback !== true) {
      errors.push(
        "capabilities.work.repository_fallback must remain true",
      );
    }
    if (
      typeof work.linear_idempotency_namespace !== "string" ||
      !/^[a-f0-9]{64}$/.test(work.linear_idempotency_namespace)
    ) {
      errors.push(
        "capabilities.work.linear_idempotency_namespace must be a non-secret 64-character hex namespace",
      );
    }
    if (work.provider === "repository") {
      if (
        work.sync_mode !== "repository_only" ||
        work.write_policy !== "repository_only" ||
        work.connection !== null
      ) {
        errors.push(
          "repository work requires repository_only sync/write policy and no external connection",
        );
      }
    }
    if (work.provider === "linear") {
      if (
        work.sync_mode !== "read_only_mirror" ||
        ![
          "read_only",
          "receipted_create",
          "receipted_create_and_comment",
        ].includes(work.write_policy)
      ) {
        errors.push(
          "linear work requires read_only_mirror sync and an approved bounded write policy",
        );
      }
      if (
        !work.connection ||
        typeof work.connection !== "object" ||
        Array.isArray(work.connection)
      ) {
        errors.push("linear work requires a bounded connection object");
      } else {
        rejectUnknownKeys(
          errors,
          work.connection,
          new Set(["kind", "credential_env", "team_keys", "writes"]),
          "capabilities.work.connection",
        );
        if (work.connection.kind !== "linear_api_key") {
          errors.push(
            "capabilities.work.connection.kind must be linear_api_key",
          );
        }
        if (work.connection.credential_env !== LINEAR_CREDENTIAL_ENV) {
          errors.push(
            `capabilities.work.connection.credential_env must be ${LINEAR_CREDENTIAL_ENV}`,
          );
        }
        if (
          !Array.isArray(work.connection.team_keys) ||
          work.connection.team_keys.length === 0 ||
          work.connection.team_keys.length > 20 ||
          !work.connection.team_keys.every(
            (key) =>
              typeof key === "string" &&
              /^[A-Z][A-Z0-9]{0,9}$/.test(key),
          ) ||
          new Set(work.connection.team_keys).size !==
            work.connection.team_keys.length
        ) {
          errors.push(
            "capabilities.work.connection.team_keys must contain 1-20 unique uppercase Linear team keys",
          );
        }
        const writes = work.connection.writes;
        if (work.write_policy === "read_only") {
          if (writes !== null) {
            errors.push(
              "read_only Linear work requires capabilities.work.connection.writes null",
            );
          }
        } else if (
          !writes ||
          typeof writes !== "object" ||
          Array.isArray(writes)
        ) {
          errors.push(
            "receipted Linear writes require a bounded writes configuration",
          );
        } else {
          rejectUnknownKeys(
            errors,
            writes,
            new Set([
              "operations",
              "create_credential_env",
              "comment_credential_env",
            ]),
            "capabilities.work.connection.writes",
          );
          if (
            !Array.isArray(writes.operations) ||
            writes.operations.length === 0 ||
            writes.operations.length > LINEAR_WRITE_OPERATIONS.size ||
            writes.operations.some(
              (operation) => !LINEAR_WRITE_OPERATIONS.has(operation),
            ) ||
            new Set(writes.operations).size !== writes.operations.length
          ) {
            errors.push(
              "capabilities.work.connection.writes.operations contains unsupported or duplicate operations",
            );
          }
          const expectedOperations =
            work.write_policy === "receipted_create"
              ? ["issue_create"]
              : work.write_policy === "receipted_create_and_comment"
                ? ["issue_create", "evidence_comment"]
                : [];
          if (
            writes.operations?.length !== expectedOperations.length ||
            expectedOperations.some(
              (operation) => !writes.operations?.includes(operation),
            )
          ) {
            errors.push(
              "Linear write policy and approved operations must match exactly",
            );
          }
          if (
            writes.create_credential_env !== LINEAR_CREATE_CREDENTIAL_ENV
          ) {
            errors.push(
              `capabilities.work.connection.writes.create_credential_env must be ${LINEAR_CREATE_CREDENTIAL_ENV}`,
            );
          }
          if (
            expectedOperations.includes("evidence_comment")
              ? writes.comment_credential_env !==
                LINEAR_COMMENT_CREDENTIAL_ENV
              : writes.comment_credential_env !== null
          ) {
            errors.push(
              `capabilities.work.connection.writes.comment_credential_env must be ${
                expectedOperations.includes("evidence_comment")
                  ? LINEAR_COMMENT_CREDENTIAL_ENV
                  : "null"
              }`,
            );
          }
        }
      }
      if (
        config.onboarding.external_data_policy !== "approved_providers"
      ) {
        errors.push(
          "linear work requires onboarding.external_data_policy approved_providers",
        );
      }
    }
  }
  if (
    config.learning?.auto_activate_skills !== false ||
    config.learning?.verified_candidates_only !== true ||
    config.learning?.evaluation_required !== true
  ) {
    errors.push(
      "learning must forbid automatic skill activation and require verified, evaluated candidates",
    );
  }
  rejectUnknownKeys(
    errors,
    config.learning,
    new Set([
      "auto_activate_skills",
      "verified_candidates_only",
      "evaluation_required",
    ]),
    "learning",
  );
  if (!EXECUTION_MODES.has(config.autonomy?.execution)) {
    errors.push("autonomy.execution must be agent_owned or proposal_only");
  }
  if (!MERGE_MODES.has(config.autonomy?.merge)) {
    errors.push(
      "autonomy.merge must be human_approval_required or policy_authorized",
    );
  }
  if (
    config.onboarding.project_profile === "production" &&
    review?.provider === "builtin"
  ) {
    errors.push(
      "production profile requires an independent external review provider",
    );
  }
  if (
    config.onboarding.project_profile === "production" &&
    review?.required_for_release !== true
  ) {
    errors.push(
      "production profile requires review.required_for_release true",
    );
  }
  if (config.autonomy?.parallel_work !== "coordinator_managed_isolated_only") {
    errors.push(
      "autonomy.parallel_work must remain coordinator_managed_isolated_only",
    );
  }
  if (!["adaptive", "serial"].includes(config.parallel_delivery.mode)) {
    errors.push("parallel_delivery.mode must be adaptive or serial");
  }
  if (
    !Number.isInteger(config.parallel_delivery.max_workers) ||
    config.parallel_delivery.max_workers < 1 ||
    config.parallel_delivery.max_workers > 4
  ) {
    errors.push("parallel_delivery.max_workers must be between 1 and 4");
  }
  if (config.parallel_delivery.serial_fallback !== true) {
    errors.push("parallel_delivery.serial_fallback must remain true");
  }
  if (
    config.parallel_delivery.require_isolation_for_parallel_writes !== true
  ) {
    errors.push(
      "parallel_delivery.require_isolation_for_parallel_writes must remain true",
    );
  }
  if (config.parallel_delivery.allow_nested_delegation !== false) {
    errors.push(
      "parallel_delivery.allow_nested_delegation must remain false",
    );
  }
  if (config.parallel_delivery.authority_inheritance !== "no_expansion") {
    errors.push(
      "parallel_delivery.authority_inheritance must remain no_expansion",
    );
  }
  if (config.parallel_delivery.integration_owner !== "primary_agent") {
    errors.push(
      "parallel_delivery.integration_owner must remain primary_agent",
    );
  }
  if (config.safety.project_root_only !== true) {
    errors.push("safety.project_root_only must remain true");
  }
  if (config.safety.forbid_shell_commands !== true) {
    errors.push("safety.forbid_shell_commands must remain true");
  }
  if (config.safety.require_check_approval !== true) {
    errors.push("safety.require_check_approval must remain true");
  }
  if (
    !Number.isInteger(config.safety.max_check_timeout_seconds) ||
    config.safety.max_check_timeout_seconds < 1 ||
    config.safety.max_check_timeout_seconds > 7200
  ) {
    errors.push(
      "safety.max_check_timeout_seconds must be between 1 and 7200",
    );
  }
  if (config.quality.require_project_checks !== true) {
    errors.push("quality.require_project_checks must remain true");
  }
  const environment = config.quality.environment;
  if (
    !environment ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    errors.push("quality.environment must be an object");
  } else {
    rejectUnknownKeys(
      errors,
      environment,
      new Set(["allow"]),
      "quality.environment",
    );
    if (
      !Array.isArray(environment.allow) ||
      !environment.allow.every(
        (name) =>
          typeof name === "string" &&
          ENVIRONMENT_NAME.test(name) &&
          !SENSITIVE_ENVIRONMENT_NAME.test(name) &&
          !EXECUTION_CONTROL_ENVIRONMENT_NAMES.has(name.toUpperCase()) &&
          !EXECUTION_CONTROL_ENVIRONMENT_PREFIXES.some((prefix) =>
            name.toUpperCase().startsWith(prefix),
          ),
      )
    ) {
      errors.push(
        "quality.environment.allow must contain valid non-sensitive, non-execution-control environment names",
      );
    } else if (new Set(environment.allow).size !== environment.allow.length) {
      errors.push("quality.environment.allow must not contain duplicates");
    }
  }
  const checks = config.quality.checks;
  if (!Array.isArray(checks)) {
    return [...errors, "quality.checks must be an array"];
  }
  const ids = new Set();
  checks.forEach((check, index) => {
    errors.push(...validateCommand(check, index, config, target));
    if (check && typeof check.id === "string") {
      if (ids.has(check.id)) {
        errors.push(`duplicate check id: ${check.id}`);
      }
      ids.add(check.id);
    }
  });
  if (config.quality.require_project_checks !== false && checks.length === 0) {
    errors.push(NO_PROJECT_CHECKS_ERROR);
  }
  if (
    !Array.isArray(config.lock_artifacts) ||
    config.lock_artifacts.length === 0 ||
    !config.lock_artifacts.every(
      (value) => typeof value === "string" && value.length > 0,
    )
  ) {
    errors.push("lock_artifacts must be a non-empty string array");
  }
  return errors;
}

function contractIdentifier(value) {
  return (
    typeof value === "string" &&
    /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/.test(value) &&
    value.length <= 96
  );
}

function contractString(errors, value, label, maximum, { empty = false } = {}) {
  if (
    typeof value !== "string" ||
    (!empty && value.trim().length === 0) ||
    value.length > maximum
  ) {
    errors.push(
      `${label} must be ${empty ? "a" : "a non-empty"} string of at most ${maximum} characters`,
    );
    return;
  }
  if (SECRET_LIKE_TEXT.test(value) || SECRET_ASSIGNMENT.test(value)) {
    SECRET_ASSIGNMENT.lastIndex = 0;
    errors.push(`${label} must not contain credential-like text`);
  }
  SECRET_ASSIGNMENT.lastIndex = 0;
}

function contractStringArray(
  errors,
  value,
  label,
  { maximumItems = 100, maximumLength = 512 } = {},
) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    errors.push(`${label} must be an array with at most ${maximumItems} items`);
    return;
  }
  const seen = new Set();
  value.forEach((item, index) => {
    contractString(errors, item, `${label}[${index}]`, maximumLength);
    if (typeof item === "string") {
      if (seen.has(item)) {
        errors.push(`${label} must not contain duplicates`);
      }
      seen.add(item);
    }
  });
}

function contractTimestamp(errors, value, label) {
  if (
    value !== null &&
    (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
      Number.isNaN(Date.parse(value)))
  ) {
    errors.push(`${label} must be null or an ISO-8601 UTC timestamp`);
  }
}

function contractProjectPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.includes("\0") &&
    !isAbsolute(value) &&
    !/^[A-Za-z]:[\\/]/.test(value) &&
    !/^[\\/]/.test(value) &&
    !value.split(/[\\/]/).includes("..")
  );
}

function directedGraphHasCycle(adjacency) {
  const visiting = new Set();
  const visited = new Set();
  for (const root of adjacency.keys()) {
    if (visited.has(root)) {
      continue;
    }
    visiting.add(root);
    const stack = [
      {
        id: root,
        cursor: 0,
        neighbors: adjacency.get(root) ?? [],
      },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.cursor >= frame.neighbors.length) {
        visiting.delete(frame.id);
        visited.add(frame.id);
        stack.pop();
        continue;
      }
      const neighbor = frame.neighbors[frame.cursor];
      frame.cursor += 1;
      if (!adjacency.has(neighbor) || visited.has(neighbor)) {
        continue;
      }
      if (visiting.has(neighbor)) {
        return true;
      }
      visiting.add(neighbor);
      stack.push({
        id: neighbor,
        cursor: 0,
        neighbors: adjacency.get(neighbor) ?? [],
      });
    }
  }
  return false;
}

function validateWorkLedger(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
    return ["work ledger must be an object"];
  }
  rejectUnknownKeys(
    errors,
    ledger,
    new Set(["schema_version", "updated_at", "items"]),
    "work ledger",
  );
  if (ledger.schema_version !== 1) {
    errors.push("work ledger schema_version must equal 1");
  }
  contractTimestamp(errors, ledger.updated_at, "work ledger updated_at");
  if (!Array.isArray(ledger.items) || ledger.items.length > 10_000) {
    errors.push("work ledger items must be an array with at most 10000 entries");
    return errors;
  }
  const ids = new Set();
  const itemsById = new Map(
    ledger.items
      .filter(
        (item) =>
          item && typeof item === "object" && !Array.isArray(item),
      )
      .map((item) => [item.id, item]),
  );
  for (const [index, item] of ledger.items.entries()) {
    const label = `work ledger items[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    rejectUnknownKeys(
      errors,
      item,
      new Set([
        "id",
        "title",
        "objective",
        "status",
        "priority",
        "acceptance_criteria",
        "scope",
        "depends_on",
        "evidence_refs",
        "external_refs",
        "updated_at",
      ]),
      label,
    );
    if (!contractIdentifier(item.id)) {
      errors.push(`${label}.id must be a bounded lowercase identifier`);
    } else if (ids.has(item.id)) {
      errors.push(`work ledger contains duplicate item id: ${item.id}`);
    } else {
      ids.add(item.id);
    }
    contractString(errors, item.title, `${label}.title`, 200);
    contractString(errors, item.objective, `${label}.objective`, 2_000);
    if (!WORK_ITEM_STATUSES.has(item.status)) {
      errors.push(`${label}.status is not canonical`);
    }
    if (!WORK_ITEM_PRIORITIES.has(item.priority)) {
      errors.push(`${label}.priority is not canonical`);
    }
    contractStringArray(
      errors,
      item.acceptance_criteria,
      `${label}.acceptance_criteria`,
      { maximumItems: 50, maximumLength: 1_000 },
    );
    if (
      Array.isArray(item.acceptance_criteria) &&
      item.acceptance_criteria.length === 0
    ) {
      errors.push(`${label}.acceptance_criteria must not be empty`);
    }
    if (!item.scope || typeof item.scope !== "object" || Array.isArray(item.scope)) {
      errors.push(`${label}.scope must be an object`);
    } else {
      rejectUnknownKeys(
        errors,
        item.scope,
        new Set(["paths", "out_of_scope"]),
        `${label}.scope`,
      );
      for (const key of ["paths", "out_of_scope"]) {
        const values = item.scope[key];
        if (!Array.isArray(values) || values.length > 100) {
          errors.push(`${label}.scope.${key} must contain at most 100 paths`);
          continue;
        }
        if (key === "paths" && values.length === 0) {
          errors.push(`${label}.scope.paths must not be empty`);
        }
        const seen = new Set();
        values.forEach((value, pathIndex) => {
          if (!contractProjectPath(value)) {
            errors.push(
              `${label}.scope.${key}[${pathIndex}] must be a bounded project-relative path`,
            );
          } else if (seen.has(value)) {
            errors.push(`${label}.scope.${key} must not contain duplicates`);
          }
          seen.add(value);
        });
      }
    }
    for (const key of ["depends_on", "evidence_refs"]) {
      const values = item[key];
      if (!Array.isArray(values) || values.length > 100) {
        errors.push(`${label}.${key} must contain at most 100 identifiers`);
        continue;
      }
      const seen = new Set();
      values.forEach((value, valueIndex) => {
        if (!contractIdentifier(value)) {
          errors.push(
            `${label}.${key}[${valueIndex}] must be a bounded lowercase identifier`,
          );
        } else if (seen.has(value)) {
          errors.push(`${label}.${key} must not contain duplicates`);
        }
        seen.add(value);
      });
    }
    if (!Array.isArray(item.external_refs) || item.external_refs.length > 50) {
      errors.push(`${label}.external_refs must contain at most 50 references`);
    } else {
      const seen = new Set();
      item.external_refs.forEach((reference, referenceIndex) => {
        const referenceLabel = `${label}.external_refs[${referenceIndex}]`;
        if (
          !reference ||
          typeof reference !== "object" ||
          Array.isArray(reference)
        ) {
          errors.push(`${referenceLabel} must be an object`);
          return;
        }
        rejectUnknownKeys(
          errors,
          reference,
          new Set(["provider", "reference"]),
          referenceLabel,
        );
        if (!contractIdentifier(reference.provider)) {
          errors.push(`${referenceLabel}.provider must be a bounded identifier`);
        }
        contractString(
          errors,
          reference.reference,
          `${referenceLabel}.reference`,
          512,
        );
        const key = `${reference.provider}\0${reference.reference}`;
        if (seen.has(key)) {
          errors.push(`${label}.external_refs must not contain duplicates`);
        }
        seen.add(key);
      });
    }
    contractTimestamp(errors, item.updated_at, `${label}.updated_at`);
  }
  for (const [index, item] of ledger.items.entries()) {
    if (!item || typeof item !== "object" || !Array.isArray(item.depends_on)) {
      continue;
    }
    item.depends_on.forEach((dependency) => {
      if (dependency === item.id) {
        errors.push(`work ledger items[${index}] must not depend on itself`);
      } else if (contractIdentifier(dependency) && !ids.has(dependency)) {
        errors.push(
          `work ledger items[${index}] depends on missing item: ${dependency}`,
        );
      } else if (
        ["ready", "in_progress", "in_review", "done"].includes(item.status) &&
        itemsById.get(dependency)?.status !== "done"
      ) {
        errors.push(
          `work ledger items[${index}] cannot be ${item.status} until dependency ${dependency} is done`,
        );
      }
    });
  }
  const dependencies = new Map(
    ledger.items
      .filter(
        (item) =>
          item &&
          typeof item === "object" &&
          contractIdentifier(item.id) &&
          Array.isArray(item.depends_on),
      )
      .map((item) => [item.id, item.depends_on]),
  );
  if (directedGraphHasCycle(dependencies)) {
    errors.push("work ledger dependencies must not contain a cycle");
  }
  return errors;
}

function validateEvidenceGraph(graph) {
  const errors = [];
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    return ["evidence graph must be an object"];
  }
  rejectUnknownKeys(
    errors,
    graph,
    new Set([
      "schema_version",
      "updated_at",
      "nodes",
      "edges",
      "skill_activations",
    ]),
    "evidence graph",
  );
  if (graph.schema_version !== 1) {
    errors.push("evidence graph schema_version must equal 1");
  }
  contractTimestamp(errors, graph.updated_at, "evidence graph updated_at");
  if (!Array.isArray(graph.nodes) || graph.nodes.length > 20_000) {
    errors.push("evidence graph nodes must be an array with at most 20000 entries");
    return errors;
  }
  if (!Array.isArray(graph.edges) || graph.edges.length > 50_000) {
    errors.push("evidence graph edges must be an array with at most 50000 entries");
    return errors;
  }
  if (
    graph.skill_activations !== undefined &&
    (!Array.isArray(graph.skill_activations) ||
      graph.skill_activations.length > 20_000)
  ) {
    errors.push(
      "evidence graph skill_activations must be an array with at most 20000 entries",
    );
    return errors;
  }
  const activationIds = new Set();
  const activationEventKeys = new Set();
  for (const [index, activation] of (
    graph.skill_activations ?? []
  ).entries()) {
    const label = `evidence graph skill_activations[${index}]`;
    if (
      !activation ||
      typeof activation !== "object" ||
      Array.isArray(activation)
    ) {
      errors.push(`${label} must be an object`);
      continue;
    }
    rejectUnknownKeys(
      errors,
      activation,
      new Set([
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
      ]),
      label,
    );
    if (!contractIdentifier(activation.id)) {
      errors.push(`${label}.id must be a bounded lowercase identifier`);
    } else if (activationIds.has(activation.id)) {
      errors.push(
        `evidence graph contains duplicate skill activation id: ${activation.id}`,
      );
    } else {
      activationIds.add(activation.id);
    }
    if (!contractIdentifier(activation.skill)) {
      errors.push(`${label}.skill must be a bounded lowercase identifier`);
    }
    if (!SKILL_ACTIVATION_MODES.has(activation.mode)) {
      errors.push(`${label}.mode must be native or file-read`);
    }
    contractString(errors, activation.harness, `${label}.harness`, 120);
    contractString(errors, activation.model, `${label}.model`, 120);
    contractString(errors, activation.run_id, `${label}.run_id`, 200);
    contractString(errors, activation.event_id, `${label}.event_id`, 200);
    contractTimestamp(errors, activation.recorded_at, `${label}.recorded_at`);
    if (activation.recorded_at === null) {
      errors.push(`${label}.recorded_at must not be null`);
    }
    if (!contractProjectPath(activation.skill_path)) {
      errors.push(`${label}.skill_path must be a bounded project-relative path`);
    }
    if (
      typeof activation.skill_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(activation.skill_sha256)
    ) {
      errors.push(`${label}.skill_sha256 must be a lowercase SHA-256 digest`);
    }
    if (activation.claim !== "agent-recorded") {
      errors.push(`${label}.claim must equal agent-recorded`);
    }
    if (activation.receipt_sha256 !== undefined) {
      if (
        typeof activation.receipt_sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(activation.receipt_sha256)
      ) {
        errors.push(`${label}.receipt_sha256 must be a lowercase SHA-256 digest`);
      } else if (activation.receipt_sha256 !== activationReceiptSha256(activation)) {
        errors.push(`${label}.receipt_sha256 must match its canonical content hash`);
      }
    }
    if (
      [
        activation.harness,
        activation.model,
        activation.run_id,
        activation.event_id,
      ].every(
        (value) => typeof value === "string" && value.length > 0,
      )
    ) {
      const eventKey = stableJson({
        harness: activation.harness,
        model: activation.model,
        run_id: activation.run_id,
        event_id: activation.event_id,
      });
      if (activationEventKeys.has(eventKey)) {
        errors.push(
          "evidence graph must not contain duplicate skill activation events",
        );
      }
      activationEventKeys.add(eventKey);
      const expectedId =
        `skill-activation-${sha256(eventKey).slice(0, 20)}`;
      if (activation.id !== expectedId) {
        errors.push(`${label}.id must match its deterministic event identity`);
      }
    }
  }
  const nodeIds = new Set();
  graph.nodes.forEach((node, index) => {
    const label = `evidence graph nodes[${index}]`;
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      errors.push(`${label} must be an object`);
      return;
    }
    rejectUnknownKeys(
      errors,
      node,
      new Set(["id", "kind", "label", "state", "source", "summary"]),
      label,
    );
    if (!contractIdentifier(node.id)) {
      errors.push(`${label}.id must be a bounded lowercase identifier`);
    } else if (nodeIds.has(node.id)) {
      errors.push(`evidence graph contains duplicate node id: ${node.id}`);
    } else {
      nodeIds.add(node.id);
    }
    if (!EVIDENCE_NODE_KINDS.has(node.kind)) {
      errors.push(`${label}.kind is not canonical`);
    }
    contractString(errors, node.label, `${label}.label`, 200);
    if (!EVIDENCE_NODE_STATES.has(node.state)) {
      errors.push(`${label}.state is not canonical`);
    }
    if (!node.source || typeof node.source !== "object" || Array.isArray(node.source)) {
      errors.push(`${label}.source must be an object`);
    } else {
      rejectUnknownKeys(
        errors,
        node.source,
        new Set(["provider", "reference"]),
        `${label}.source`,
      );
      if (!contractIdentifier(node.source.provider)) {
        errors.push(`${label}.source.provider must be a bounded identifier`);
      }
      contractString(
        errors,
        node.source.reference,
        `${label}.source.reference`,
        512,
      );
    }
    contractString(errors, node.summary, `${label}.summary`, 1_000, {
      empty: true,
    });
  });
  const edgeKeys = new Set();
  const dependencies = new Map(
    [...nodeIds].map((nodeId) => [nodeId, []]),
  );
  graph.edges.forEach((edge, index) => {
    const label = `evidence graph edges[${index}]`;
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
      errors.push(`${label} must be an object`);
      return;
    }
    rejectUnknownKeys(
      errors,
      edge,
      new Set(["from", "to", "relation"]),
      label,
    );
    for (const endpoint of ["from", "to"]) {
      if (!contractIdentifier(edge[endpoint])) {
        errors.push(`${label}.${endpoint} must be a bounded lowercase identifier`);
      } else if (!nodeIds.has(edge[endpoint])) {
        errors.push(`${label}.${endpoint} references a missing node`);
      }
    }
    if (!EVIDENCE_RELATIONS.has(edge.relation)) {
      errors.push(`${label}.relation is not canonical`);
    }
    if (edge.from === edge.to) {
      errors.push(`${label} must not connect a node to itself`);
    }
    const key = `${edge.from}\0${edge.relation}\0${edge.to}`;
    if (edgeKeys.has(key)) {
      errors.push("evidence graph must not contain duplicate edges");
    }
    edgeKeys.add(key);
    if (
      DEPENDENCY_EVIDENCE_RELATIONS.has(edge.relation) &&
      nodeIds.has(edge.from) &&
      nodeIds.has(edge.to)
    ) {
      dependencies.get(edge.from).push(edge.to);
    }
  });
  if (directedGraphHasCycle(dependencies)) {
    errors.push(
      "evidence graph dependency relations must not contain a cycle",
    );
  }
  return errors;
}

function validateWorkEvidenceLinkage(ledger, graph) {
  if (
    validateWorkLedger(ledger).length > 0 ||
    validateEvidenceGraph(graph).length > 0
  ) {
    return [];
  }
  const errors = [];
  const items = new Map(ledger.items.map((item) => [item.id, item]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const completionLinks = new Set(
    graph.edges
      .filter((edge) => COMPLETION_EVIDENCE_RELATIONS.has(edge.relation))
      .map((edge) => `${edge.from}\0${edge.to}`),
  );
  for (const item of ledger.items) {
    const workNode = nodes.get(item.id);
    if (
      item.status !== "backlog" &&
      (!workNode || workNode.kind !== "work_item")
    ) {
      errors.push(
        `work item ${item.id} requires a matching work_item evidence node`,
      );
    }
    for (const reference of item.evidence_refs) {
      if (!nodes.has(reference)) {
        errors.push(
          `work item ${item.id} references missing evidence node: ${reference}`,
        );
      } else if (!completionLinks.has(`${reference}\0${item.id}`)) {
        errors.push(
          `work item ${item.id} evidence node ${reference} requires a completion-evidence edge to the work item`,
        );
      }
    }
    if (item.status === "done") {
      if (item.evidence_refs.length === 0) {
        errors.push(`done work item ${item.id} requires evidence_refs`);
      }
      for (const reference of item.evidence_refs) {
        if (nodes.get(reference)?.state !== "verified") {
          errors.push(
            `done work item ${item.id} requires verified evidence node: ${reference}`,
          );
        }
      }
    }
  }
  for (const node of graph.nodes) {
    if (node.kind === "work_item" && !items.has(node.id)) {
      errors.push(
        `work_item evidence node ${node.id} has no matching work ledger item`,
      );
    }
  }
  return errors;
}

function validateProviderReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return ["provider receipt must be an object"];
  }
  rejectUnknownKeys(
    errors,
    receipt,
    new Set([
      "schema_version",
      "receipt_id",
      "provider",
      "operation",
      "work_item_id",
      "provider_reference",
      "before",
      "after",
      "authority_source",
      "idempotency_key",
      "revision",
      "performed_at",
      "result",
    ]),
    "provider receipt",
  );
  if (receipt.schema_version !== 1) {
    errors.push("provider receipt schema_version must equal 1");
  }
  if (
    typeof receipt.receipt_id !== "string" ||
    !/^[a-f0-9]{64}$/.test(receipt.receipt_id)
  ) {
    errors.push("provider receipt receipt_id must be a sha256 hex digest");
  }
  if (!contractIdentifier(receipt.provider)) {
    errors.push("provider receipt provider must be a bounded identifier");
  }
  if (!contractIdentifier(receipt.operation)) {
    errors.push("provider receipt operation must be a bounded identifier");
  }
  if (!contractIdentifier(receipt.work_item_id)) {
    errors.push("provider receipt work_item_id must be a bounded identifier");
  }
  for (const key of ["provider_reference", "before", "after"]) {
    if (receipt[key] !== null) {
      contractString(
        errors,
        receipt[key],
        `provider receipt ${key}`,
        key === "provider_reference" ? 512 : 200,
      );
    }
  }
  contractString(
    errors,
    receipt.authority_source,
    "provider receipt authority_source",
    1_000,
  );
  if (
    typeof receipt.authority_source === "string" &&
    receipt.authority_source.trim().length < 12
  ) {
    errors.push(
      "provider receipt authority_source must contain at least 12 characters",
    );
  }
  if (
    typeof receipt.idempotency_key !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(receipt.idempotency_key)
  ) {
    errors.push(
      "provider receipt idempotency_key must be a prefixed sha256 digest",
    );
  }
  if (
    receipt.revision !== null &&
    (typeof receipt.revision !== "string" ||
      !GIT_OBJECT_ID.test(receipt.revision ?? ""))
  ) {
    errors.push("provider receipt revision must be a full Git commit or null");
  }
  if (
    typeof receipt.performed_at !== "string" ||
    !Number.isFinite(Date.parse(receipt.performed_at)) ||
    !receipt.performed_at.endsWith("Z")
  ) {
    errors.push("provider receipt performed_at must be a UTC timestamp");
  }
  if (!PROVIDER_RECEIPT_RESULTS.has(receipt.result)) {
    errors.push("provider receipt result is not canonical");
  }
  return errors;
}

function validateCampaignState(campaign) {
  const errors = [];
  if (!campaign || typeof campaign !== "object" || Array.isArray(campaign)) {
    return ["campaign state must be an object"];
  }
  rejectUnknownKeys(
    errors,
    campaign,
    new Set([
      "schema_version",
      "campaign_id",
      "objective",
      "max_iterations",
      "iterations_completed",
      "active_work_item",
      "status",
      "reason",
      "created_at",
      "updated_at",
    ]),
    "campaign state",
  );
  if (campaign.schema_version !== 1) {
    errors.push("campaign state schema_version must equal 1");
  }
  if (
    typeof campaign.campaign_id !== "string" ||
    !/^[a-f0-9]{64}$/.test(campaign.campaign_id)
  ) {
    errors.push("campaign state campaign_id must be a sha256 hex digest");
  }
  contractString(errors, campaign.objective, "campaign state objective", 2_000);
  if (
    !Number.isInteger(campaign.max_iterations) ||
    campaign.max_iterations < 1 ||
    campaign.max_iterations > 25
  ) {
    errors.push("campaign state max_iterations must be between 1 and 25");
  }
  if (
    !Number.isInteger(campaign.iterations_completed) ||
    campaign.iterations_completed < 0 ||
    campaign.iterations_completed > 25 ||
    (Number.isInteger(campaign.max_iterations) &&
      campaign.iterations_completed > campaign.max_iterations)
  ) {
    errors.push(
      "campaign state iterations_completed must be within the campaign bound",
    );
  }
  if (
    campaign.active_work_item !== null &&
    !contractIdentifier(campaign.active_work_item)
  ) {
    errors.push(
      "campaign state active_work_item must be a bounded identifier or null",
    );
  }
  if (!CAMPAIGN_STATUSES.has(campaign.status)) {
    errors.push("campaign state status is not canonical");
  }
  if (campaign.reason !== null) {
    contractString(errors, campaign.reason, "campaign state reason", 1_000);
  }
  if (campaign.status === "active" && campaign.reason !== null) {
    errors.push("active campaign state reason must be null");
  }
  if (campaign.status !== "active" && campaign.reason === null) {
    errors.push("inactive campaign state requires a reason");
  }
  for (const key of ["created_at", "updated_at"]) {
    if (
      typeof campaign[key] !== "string" ||
      !Number.isFinite(Date.parse(campaign[key])) ||
      !campaign[key].endsWith("Z")
    ) {
      errors.push(`campaign state ${key} must be a UTC timestamp`);
    }
  }
  if (
    campaign.status !== "active" &&
    campaign.active_work_item !== null
  ) {
    errors.push(
      "campaign state active_work_item must be null unless status is active",
    );
  }
  return errors;
}

function writeProviderReceipt(target, receipt) {
  const errors = validateProviderReceipt(receipt);
  if (errors.length > 0) {
    throw new StackError("Refusing to write an invalid provider receipt", 2, errors);
  }
  const path = `${PROVIDER_RECEIPTS_PATH}/${receipt.receipt_id}.json`;
  atomicProjectJson(target, path, receipt, "provider receipt");
  return path;
}

function commandReceiptsValidate(target) {
  const directory = projectFile(
    target,
    PROVIDER_RECEIPTS_PATH,
    "provider receipts directory",
  );
  if (!existsSync(directory)) {
    return {
      ok: false,
      path: PROVIDER_RECEIPTS_PATH,
      receipt_count: 0,
      errors: [`missing ${PROVIDER_RECEIPTS_PATH}`],
    };
  }
  if (lstatSync(directory).isSymbolicLink() || !statSync(directory).isDirectory()) {
    return {
      ok: false,
      path: PROVIDER_RECEIPTS_PATH,
      receipt_count: 0,
      errors: [`${PROVIDER_RECEIPTS_PATH} must be a real project directory`],
    };
  }
  const entries = readdirSync(directory).sort();
  const receiptEntries = entries.filter((name) => name !== ".gitkeep");
  const errors = [];
  if (receiptEntries.length > 1_000) {
    errors.push("provider receipt directory exceeds the 1,000 receipt limit");
  }
  let receiptCount = 0;
  for (const name of receiptEntries.slice(0, 1_001)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) {
      errors.push(`provider receipt has an invalid file name: ${name}`);
      continue;
    }
    receiptCount += 1;
    const relativePath = `${PROVIDER_RECEIPTS_PATH}/${name}`;
    try {
      const file = projectFile(target, relativePath, "provider receipt");
      if (lstatSync(file).isSymbolicLink() || !statSync(file).isFile()) {
        errors.push(`${relativePath} must be a real project file`);
        continue;
      }
      const receipt = readJson(file, "provider receipt");
      const receiptErrors = validateProviderReceipt(receipt);
      if (receipt.receipt_id !== name.slice(0, -5)) {
        receiptErrors.push(
          "provider receipt file name must match receipt_id",
        );
      }
      for (const error of receiptErrors) {
        errors.push(`${relativePath}: ${error}`);
      }
    } catch (error) {
      errors.push(`${relativePath}: ${error.message}`);
    }
  }
  return {
    ok: errors.length === 0,
    path: PROVIDER_RECEIPTS_PATH,
    receipt_count: receiptCount,
    errors,
  };
}

function loadCampaign(target) {
  const file = projectFile(target, CAMPAIGN_PATH, "campaign state");
  if (!existsSync(file)) {
    return null;
  }
  const campaign = readJson(file, "campaign state");
  const errors = validateCampaignState(campaign);
  if (errors.length > 0) {
    throw new StackError("Campaign state is invalid", 2, errors);
  }
  return campaign;
}

function writeCampaign(target, campaign) {
  const errors = validateCampaignState(campaign);
  if (errors.length > 0) {
    throw new StackError("Refusing to write invalid campaign state", 2, errors);
  }
  atomicProjectJson(target, CAMPAIGN_PATH, campaign, "campaign state");
}

function commandCampaignStatus(target) {
  const campaign = loadCampaign(target);
  return {
    ok: true,
    path: CAMPAIGN_PATH,
    campaign,
  };
}

function requireApprovedCampaignConfiguration(target) {
  const config = loadConfig(target);
  const errors = validateConfig(config, target);
  if (
    errors.length > 0 ||
    config.onboarding?.status !== "complete" ||
    config.safety?.approved_configuration_hash !== configurationHash(config)
  ) {
    throw new StackError(
      "Campaigns require valid, complete, currently approved project configuration.",
      3,
      errors,
    );
  }
}

function commandCampaignStart(target, options) {
  requireCoordinator(target, options.coordinatorToken);
  requireApprovedCampaignConfiguration(target);
  const current = loadCampaign(target);
  if (current?.status === "active") {
    throw new StackError(
      "An active campaign already exists. Continue or stop it before starting another.",
      3,
    );
  }
  const objective = validateCheckpointText(
    options.objective,
    "campaign objective",
    { required: true },
  );
  const maxIterations = Number(options.maxIterations);
  if (
    !Number.isInteger(maxIterations) ||
    maxIterations < 1 ||
    maxIterations > 25
  ) {
    throw new StackError(
      "Campaign max iterations must be an integer between 1 and 25.",
      3,
    );
  }
  const work = commandWorkValidate(target);
  const evidence = commandEvidenceValidate(target);
  if (!work.ok || !evidence.ok) {
    throw new StackError(
      "Campaigns require valid repository work and evidence contracts.",
      3,
      [...work.errors, ...evidence.errors],
    );
  }
  const createdAt = utcTimestamp();
  const campaign = {
    schema_version: 1,
    campaign_id: sha256(
      stableJson({
        objective,
        max_iterations: maxIterations,
        created_at: createdAt,
        nonce: randomBytes(16).toString("hex"),
      }),
    ),
    objective,
    max_iterations: maxIterations,
    iterations_completed: 0,
    active_work_item: null,
    status: "active",
    reason: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
  writeCampaign(target, campaign);
  return {
    ok: true,
    action: "started",
    campaign,
    next:
      "Run campaign next with the same active coordinator token to select one eligible repository work item.",
  };
}

function campaignDecision(campaign, status, reason) {
  return {
    ...campaign,
    active_work_item: null,
    status,
    reason,
    updated_at: utcTimestamp(),
  };
}

function commandCampaignNext(target, options) {
  requireCoordinator(target, options.coordinatorToken);
  requireApprovedCampaignConfiguration(target);
  const campaign = loadCampaign(target);
  if (!campaign || campaign.status !== "active") {
    throw new StackError(
      "No active campaign exists. Start one before requesting the next iteration.",
      3,
    );
  }
  const contracts = loadValidatedWorkEvidence(target);
  if (!contracts.ok) {
    throw new StackError(
      "Campaign iteration refused because repository work or evidence is invalid.",
      3,
      [
        ...contracts.ledger.errors,
        ...contracts.graph.errors,
        ...contracts.linkageErrors,
      ],
    );
  }
  const ledger = contracts.ledger.value;
  const items = new Map(ledger.items.map((item) => [item.id, item]));
  if (campaign.active_work_item !== null) {
    const active = items.get(campaign.active_work_item);
    if (!active) {
      const stopped = campaignDecision(
        campaign,
        "decision-needed",
        "The active repository work item is missing.",
      );
      writeCampaign(target, stopped);
      return { ok: false, action: "decision-needed", campaign: stopped };
    }
    if (["ready", "in_progress", "in_review"].includes(active.status)) {
      if (active.status === "ready") {
        const now = utcTimestamp();
        active.status = "in_progress";
        active.updated_at = now;
        ledger.updated_at = now;
        const repairedErrors = validateWorkLedger(ledger);
        if (repairedErrors.length > 0) {
          throw new StackError(
            "Refusing to repair campaign selection because the ledger is invalid.",
            3,
            repairedErrors,
          );
        }
        atomicProjectJson(target, WORK_LEDGER_PATH, ledger, "work ledger");
      }
      return {
        ok: true,
        action: "continue",
        campaign,
        work_item: active,
        next:
          "Complete, cancel, or explicitly block this repository work item before another iteration can start.",
      };
    }
    if (active.status === "blocked") {
      const stopped = campaignDecision(
        campaign,
        "decision-needed",
        `Active work item ${active.id} is blocked.`,
      );
      writeCampaign(target, stopped);
      return {
        ok: false,
        action: "decision-needed",
        campaign: stopped,
        work_item: active,
      };
    }
    if (!["done", "cancelled"].includes(active.status)) {
      const stopped = campaignDecision(
        campaign,
        "decision-needed",
        `Active work item ${active.id} moved to unsupported campaign status ${active.status}.`,
      );
      writeCampaign(target, stopped);
      return {
        ok: false,
        action: "decision-needed",
        campaign: stopped,
        work_item: active,
      };
    }
    campaign.iterations_completed += 1;
    campaign.active_work_item = null;
    campaign.updated_at = utcTimestamp();
  }
  if (campaign.iterations_completed >= campaign.max_iterations) {
    const complete = campaignDecision(
      campaign,
      "complete",
      "The configured iteration bound was reached.",
    );
    writeCampaign(target, complete);
    return { ok: true, action: "complete", campaign: complete };
  }
  const pending = ledger.items.filter((item) =>
    ["backlog", "ready", "in_progress", "in_review", "blocked"].includes(
      item.status,
    ),
  );
  if (pending.length === 0) {
    const complete = campaignDecision(
      campaign,
      "complete",
      "No unfinished repository work items remain.",
    );
    writeCampaign(target, complete);
    return { ok: true, action: "complete", campaign: complete };
  }
  const unownedActive = pending.filter((item) =>
    ["in_progress", "in_review"].includes(item.status),
  );
  if (unownedActive.length > 0) {
    const stopped = campaignDecision(
      campaign,
      "decision-needed",
      "Repository work is already active outside this campaign.",
    );
    writeCampaign(target, stopped);
    return {
      ok: false,
      action: "decision-needed",
      campaign: stopped,
      pending_work_items: unownedActive.map((item) => item.id).sort(),
    };
  }
  const eligible = ledger.items
    .filter(
      (item) =>
        item.status === "ready" &&
        item.depends_on.every(
          (dependency) => items.get(dependency)?.status === "done",
        ),
    )
    .sort(
      (left, right) =>
        (WORK_PRIORITY_ORDER.get(left.priority) ?? 99) -
          (WORK_PRIORITY_ORDER.get(right.priority) ?? 99) ||
        left.id.localeCompare(right.id),
    );
  if (eligible.length === 0) {
    const stopped = campaignDecision(
      campaign,
      "decision-needed",
      "No ready work item has all dependencies completed.",
    );
    writeCampaign(target, stopped);
    return {
      ok: false,
      action: "decision-needed",
      campaign: stopped,
      pending_work_items: pending.map((item) => item.id).sort(),
    };
  }
  const selected = eligible[0];
  const now = utcTimestamp();
  selected.status = "in_progress";
  selected.updated_at = now;
  ledger.updated_at = now;
  const ledgerErrors = validateWorkLedger(ledger);
  if (ledgerErrors.length > 0) {
    throw new StackError(
      "Refusing to select a work item because the updated ledger is invalid.",
      3,
      ledgerErrors,
    );
  }
  campaign.active_work_item = selected.id;
  campaign.updated_at = now;
  writeCampaign(target, campaign);
  atomicProjectJson(target, WORK_LEDGER_PATH, ledger, "work ledger");
  return {
    ok: true,
    action: "selected",
    campaign,
    work_item: selected,
    guardrails: {
      one_item_at_a_time: true,
      provider_sync: "explicit-only",
      completion_source: "repository evidence contract",
    },
  };
}

function commandCampaignStop(target, options) {
  requireCoordinator(target, options.coordinatorToken);
  const campaign = loadCampaign(target);
  if (!campaign || campaign.status !== "active") {
    throw new StackError("No active campaign exists to stop.", 3);
  }
  const reason = validateCheckpointText(options.reason, "campaign stop reason", {
    required: true,
  });
  const stopped = campaignDecision(campaign, "stopped", reason);
  writeCampaign(target, stopped);
  return { ok: true, action: "stopped", campaign: stopped };
}

function validateRepositoryContract(target, path, validator, label) {
  try {
    const value = readJson(
      projectFileWithoutSymlinkComponents(target, path, label),
      label,
    );
    const errors = validator(value);
    return {
      ok: errors.length === 0,
      path,
      errors,
      value,
    };
  } catch (error) {
    return {
      ok: false,
      path,
      errors: [error.message],
      value: null,
    };
  }
}

function commandWorkValidate(target) {
  const result = validateRepositoryContract(
    target,
    WORK_LEDGER_PATH,
    validateWorkLedger,
    "work ledger",
  );
  const items = Array.isArray(result.value?.items) ? result.value.items : [];
  return {
    ok: result.ok,
    path: result.path,
    item_count: items.length,
    status_counts: Object.fromEntries(
      [...WORK_ITEM_STATUSES].map((status) => [
        status,
        items.filter((item) => item?.status === status).length,
      ]),
    ),
    errors: result.errors,
  };
}

function loadValidatedWorkEvidence(target) {
  const ledger = validateRepositoryContract(
    target,
    WORK_LEDGER_PATH,
    validateWorkLedger,
    "work ledger",
  );
  const graph = validateRepositoryContract(
    target,
    EVIDENCE_GRAPH_PATH,
    validateEvidenceGraph,
    "evidence graph",
  );
  const linkageErrors =
    ledger.ok && graph.ok
      ? validateWorkEvidenceLinkage(ledger.value, graph.value)
      : [];
  return {
    ok: ledger.ok && graph.ok && linkageErrors.length === 0,
    ledger,
    graph,
    linkageErrors,
  };
}

function commandEvidenceValidate(target) {
  const snapshot = loadValidatedWorkEvidence(target);
  const errors = [...snapshot.graph.errors, ...snapshot.linkageErrors];
  return {
    ok: snapshot.ok,
    path: snapshot.graph.path,
    work_ledger: {
      ok: snapshot.ledger.ok,
      path: snapshot.ledger.path,
    },
    node_count: Array.isArray(snapshot.graph.value?.nodes)
      ? snapshot.graph.value.nodes.length
      : 0,
    edge_count: Array.isArray(snapshot.graph.value?.edges)
      ? snapshot.graph.value.edges.length
      : 0,
    skill_activation_count: Array.isArray(
      snapshot.graph.value?.skill_activations,
    )
      ? snapshot.graph.value.skill_activations.length
      : 0,
    errors,
  };
}

function installedSkillFile(target, skill, skillPath) {
  if (!contractIdentifier(skill)) {
    throw new StackError("--skill must be a canonical installed skill name");
  }
  const normalizedSkillPath =
    typeof skillPath === "string"
      ? skillPath
          .replaceAll("\\", "/")
          .replace(/\/{2,}/g, "/")
          .replace(/^(?:\.\/)+/, "")
      : skillPath;
  const allowed = new Set([
    `.agents/skills/${skill}/SKILL.md`,
    `.claude/skills/${skill}/SKILL.md`,
  ]);
  if (!allowed.has(normalizedSkillPath)) {
    throw new StackError(
      "--skill-path must name the actual installed .agents or .claude SKILL.md for --skill",
    );
  }
  const file = projectFileWithoutSymlinkComponents(
    target,
    normalizedSkillPath,
    "installed skill",
  );
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new StackError(
      `Installed skill not found at ${normalizedSkillPath}. Run init or upgrade first.`,
    );
  }
  return { path: normalizedSkillPath, file };
}

function commandEvidenceActivate(
  target,
  {
    skill,
    skillPath,
    mode,
    harness,
    model,
    runId,
    eventId,
    coordinatorToken,
  },
) {
  requireCoordinator(target, coordinatorToken);
  if (!SKILL_ACTIVATION_MODES.has(mode)) {
    throw new StackError("--mode must be native or file-read");
  }
  const normalizedRunId = requireRunId(runId);
  for (const [name, value, maximum] of [
    ["--harness", harness, 120],
    ["--model", model, 120],
    ["--run", normalizedRunId, 200],
    ["--event", eventId, 200],
  ]) {
    const errors = [];
    contractString(errors, value, name, maximum);
    if (errors.length > 0) {
      throw new StackError(errors[0]);
    }
  }
  const installed = installedSkillFile(target, skill, skillPath);
  const graphFile = projectFileWithoutSymlinkComponents(
    target,
    EVIDENCE_GRAPH_PATH,
    "evidence graph",
  );
  const graph = readJson(graphFile, "evidence graph");
  const graphErrors = validateEvidenceGraph(graph);
  if (graphErrors.length > 0) {
    throw new StackError(
      "Cannot record activation in an invalid evidence graph.",
      2,
      graphErrors,
    );
  }
  graph.skill_activations ??= [];
  const activationKey = stableJson({
    harness,
    model,
    run_id: normalizedRunId,
    event_id: eventId,
  });
  const id = `skill-activation-${sha256(activationKey).slice(0, 20)}`;
  const activationPayload = {
    skill,
    mode,
    harness,
    model,
    run_id: normalizedRunId,
    event_id: eventId,
    skill_path: installed.path,
    skill_sha256: hashFile(installed.file),
    claim: "agent-recorded",
  };
  const existing = graph.skill_activations.find(
    (activation) => activation.id === id,
  );
  if (existing) {
    const existingPayload = Object.fromEntries(
      Object.keys(activationPayload).map((key) => [
        key,
        existing[key],
      ]),
    );
    if (stableJson(existingPayload) !== stableJson(activationPayload)) {
      throw new StackError(
        "Activation event idempotency conflict: the same harness, model, run, and event ID was already recorded with different metadata.",
      );
    }
    if (existing.receipt_sha256 === undefined) {
      existing.receipt_sha256 = activationReceiptSha256(existing);
      graph.updated_at = utcTimestamp();
      const upgradedErrors = validateEvidenceGraph(graph);
      if (upgradedErrors.length > 0) {
        throw new StackError(
          "Cannot upgrade the legacy activation receipt in an invalid evidence graph.",
          2,
          upgradedErrors,
        );
      }
      atomicJson(graphFile, graph);
      return {
        ok: true,
        recorded: true,
        reason: "legacy-receipt-upgraded",
        result: "legacy-receipt-upgraded",
        command: "evidence activate",
        path: EVIDENCE_GRAPH_PATH,
        evidence_graph_path: EVIDENCE_GRAPH_PATH,
        activation: existing,
        boundary:
          "Agent-recorded evidence is not independent proof of a harness tool call.",
      };
    }
    return {
      ok: true,
      recorded: false,
      reason: "already-recorded",
      result: "already-recorded",
      command: "evidence activate",
      path: EVIDENCE_GRAPH_PATH,
      evidence_graph_path: EVIDENCE_GRAPH_PATH,
      activation: existing,
      boundary:
        "Agent-recorded evidence is not independent proof of a harness tool call.",
    };
  }
  const runActivationCount = graph.skill_activations.filter(
    (activation) => activation.run_id === normalizedRunId,
  ).length;
  if (runActivationCount >= MAX_ACTIVATION_RECEIPTS_PER_RUN) {
    throw new StackError(
      `A run may contain at most ${MAX_ACTIVATION_RECEIPTS_PER_RUN} activation receipts`,
    );
  }
  const activation = {
    id,
    recorded_at: utcTimestamp(),
    ...activationPayload,
  };
  activation.receipt_sha256 = activationReceiptSha256(activation);
  graph.skill_activations.push(activation);
  graph.updated_at = activation.recorded_at;
  const updatedErrors = validateEvidenceGraph(graph);
  if (updatedErrors.length > 0) {
    throw new StackError(
      "Refusing to write an invalid skill activation.",
      2,
      updatedErrors,
    );
  }
  atomicJson(graphFile, graph);
  return {
    ok: true,
    recorded: true,
    result: "recorded",
    command: "evidence activate",
    path: EVIDENCE_GRAPH_PATH,
    evidence_graph_path: EVIDENCE_GRAPH_PATH,
    activation,
    boundary:
      "Agent-recorded evidence is not independent proof of a harness tool call.",
  };
}

function boundedReceiptText(value, label, maximum) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    /[\r\n\0]/.test(value)
  ) {
    throw new StackError(
      `${label} must be a non-empty single-line string of at most ${maximum} characters`,
    );
  }
  SECRET_ASSIGNMENT.lastIndex = 0;
  if (SECRET_LIKE_TEXT.test(value) || SECRET_ASSIGNMENT.test(value)) {
    SECRET_ASSIGNMENT.lastIndex = 0;
    throw new StackError(`${label} must not contain credential-like text`);
  }
  SECRET_ASSIGNMENT.lastIndex = 0;
  return value;
}

function reviewReceiptId(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return null;
  }
  const canonical = { ...receipt };
  delete canonical.receipt_id;
  return sha256(stableJson(canonical));
}

function reviewUnavailableReceiptId(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return null;
  }
  const canonical = { ...receipt };
  delete canonical.receipt_id;
  return sha256(stableJson(canonical));
}

function normalizeReviewerResultPath(value) {
  if (typeof value !== "string" || value.includes("\\")) {
    return null;
  }
  const normalized = value.replace(/^\.\//, "");
  if (
    !normalized.startsWith(`${RUNS_PATH}/`) ||
    !normalized.endsWith(".json") ||
    normalized.length > 512
  ) {
    return null;
  }
  const components = normalized.split("/");
  if (
    components.some(
      (component) => component.length === 0 || component === "." || component === "..",
    )
  ) {
    return null;
  }
  return normalized;
}

function validateReviewerResultArtifact(artifact, expected = {}) {
  const errors = [];
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return ["reviewer result artifact must be an object"];
  }
  rejectUnknownKeys(
    errors,
    artifact,
    new Set([
      "schema_version",
      "run_id",
      "git_commit",
      "reviewer_kind",
      "reviewer_id",
      "result",
      "summary",
      "findings",
      "reviewed_at",
    ]),
    "reviewer result artifact",
  );
  if (artifact.schema_version !== 1) {
    errors.push("reviewer result artifact schema_version must equal 1");
  }
  for (const [key, maximum] of [
    ["run_id", 200],
    ["reviewer_kind", 120],
    ["reviewer_id", 256],
  ]) {
    contractString(errors, artifact[key], `reviewer result artifact ${key}`, maximum);
    if (typeof artifact[key] === "string" && /[\r\n\0]/.test(artifact[key])) {
      errors.push(`reviewer result artifact ${key} must be a single-line value`);
    }
  }
  if (!GIT_OBJECT_ID.test(artifact.git_commit ?? "")) {
    errors.push("reviewer result artifact git_commit must be a full Git commit");
  }
  if (!REVIEW_RESULTS.has(artifact.result)) {
    errors.push("reviewer result artifact result must be passed or changes-requested");
  }
  if (
    typeof artifact.summary !== "string" ||
    artifact.summary.trim().length === 0 ||
    artifact.summary.length > MAX_REVIEW_SUMMARY_CHARS ||
    /[\0]/.test(artifact.summary)
  ) {
    errors.push(
      `reviewer result artifact summary must be non-empty and at most ${MAX_REVIEW_SUMMARY_CHARS} characters`,
    );
  }
  contractStringArray(errors, artifact.findings, "reviewer result artifact findings", {
    maximumItems: MAX_REVIEW_FINDINGS,
    maximumLength: MAX_REVIEW_FINDING_CHARS,
  });
  if (Array.isArray(artifact.findings)) {
    for (const [index, finding] of artifact.findings.entries()) {
      if (typeof finding === "string" && finding.trim().length === 0) {
        errors.push(`reviewer result artifact findings[${index}] must be non-empty`);
      }
      if (typeof finding === "string" && /[\r\n\0]/.test(finding)) {
        errors.push(`reviewer result artifact findings[${index}] must be single-line`);
      }
    }
  }
  if (
    typeof artifact.reviewed_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      artifact.reviewed_at,
    ) ||
    Number.isNaN(Date.parse(artifact.reviewed_at))
  ) {
    errors.push("reviewer result artifact reviewed_at must be a UTC timestamp");
  }
  for (const key of [
    "run_id",
    "git_commit",
    "reviewer_kind",
    "reviewer_id",
    "result",
  ]) {
    if (expected[key] !== undefined && artifact[key] !== expected[key]) {
      errors.push(`reviewer result artifact ${key} does not match the CLI receipt claim`);
    }
  }
  return errors;
}

function readReviewerResultArtifact(target, receipt, resultFile) {
  let artifact;
  try {
    artifact = readJson(resultFile, "reviewer result artifact");
  } catch (error) {
    return {
      artifact: null,
      errors: [error.message],
    };
  }
  return {
    artifact,
    errors: validateReviewerResultArtifact(artifact, {
      run_id: receipt.run_id,
      git_commit: receipt.git_commit,
      reviewer_kind: receipt.reviewer_kind,
      reviewer_id: receipt.reviewer_id,
      result: receipt.result,
    }),
  };
}

function validateReviewReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return ["review receipt must be an object"];
  }
  rejectUnknownKeys(
    errors,
    receipt,
    new Set([
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
    ]),
    "review receipt",
  );
  if (receipt.schema_version !== 1) {
    errors.push("review receipt schema_version must equal 1");
  }
  if (
    typeof receipt.receipt_id !== "string" ||
    !/^[a-f0-9]{64}$/.test(receipt.receipt_id)
  ) {
    errors.push("review receipt receipt_id must be a sha256 hex digest");
  } else if (receipt.receipt_id !== reviewReceiptId(receipt)) {
    errors.push("review receipt receipt_id must match its canonical content hash");
  }
  for (const [key, maximum] of [
    ["run_id", 200],
    ["coordinator_id", 120],
    ["reviewer_kind", 120],
    ["reviewer_id", 256],
  ]) {
    contractString(errors, receipt[key], `review receipt ${key}`, maximum);
    if (
      typeof receipt[key] === "string" &&
      /[\r\n\0]/.test(receipt[key])
    ) {
      errors.push(`review receipt ${key} must be a single-line value`);
    }
  }
  if (
    typeof receipt.reviewer_id === "string" &&
    typeof receipt.coordinator_id === "string" &&
    receipt.reviewer_id.trim().toLowerCase() ===
      receipt.coordinator_id.trim().toLowerCase()
  ) {
    errors.push("review receipt reviewer must be distinct from the coordinator");
  }
  if (
    typeof receipt.reviewer_kind === "string" &&
    new Set(["coordinator", "primary", "project-steward"]).has(
      receipt.reviewer_kind.trim().toLowerCase(),
    )
  ) {
    errors.push("review receipt reviewer kind cannot identify the coordinator");
  }
  if (!GIT_OBJECT_ID.test(receipt.git_commit ?? "")) {
    errors.push("review receipt git_commit must be a full Git commit");
  }
  if (
    !GIT_OBJECT_FORMATS.has(receipt.git_object_format) ||
    gitObjectFormatForId(receipt.git_commit) !== receipt.git_object_format
  ) {
    errors.push("review receipt git_object_format must match its full Git commit");
  }
  if (!REVIEW_RESULTS.has(receipt.result)) {
    errors.push("review receipt result must be passed or changes-requested");
  }
  if (!normalizeReviewerResultPath(receipt.result_file)) {
    errors.push(
      "review receipt result_file must be a JSON reviewer-result artifact under .agent-stack/runs/",
    );
  }
  if (
    typeof receipt.result_file_sha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(receipt.result_file_sha256)
  ) {
    errors.push("review receipt result_file_sha256 must be a prefixed SHA-256 digest");
  }
  if (
    typeof receipt.recorded_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      receipt.recorded_at,
    ) ||
    Number.isNaN(Date.parse(receipt.recorded_at))
  ) {
    errors.push("review receipt recorded_at must be a UTC timestamp");
  }
  if (receipt.claim !== "agent-recorded") {
    errors.push("review receipt claim must equal agent-recorded");
  }
  return errors;
}

function validateReviewUnavailableReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return ["review unavailable receipt must be an object"];
  }
  rejectUnknownKeys(
    errors,
    receipt,
    new Set([
      "schema_version",
      "receipt_id",
      "run_id",
      "coordinator_id",
      "reason",
      "details",
      "recorded_at",
      "claim",
      "status",
    ]),
    "review unavailable receipt",
  );
  if (receipt.schema_version !== 1) {
    errors.push("review unavailable receipt schema_version must equal 1");
  }
  if (
    typeof receipt.receipt_id !== "string" ||
    !/^[a-f0-9]{64}$/.test(receipt.receipt_id)
  ) {
    errors.push("review unavailable receipt receipt_id must be a sha256 hex digest");
  } else if (receipt.receipt_id !== reviewUnavailableReceiptId(receipt)) {
    errors.push(
      "review unavailable receipt receipt_id must match its canonical content hash",
    );
  }
  for (const [key, maximum] of [
    ["run_id", 200],
    ["coordinator_id", 120],
    ["reason", 200],
    ["details", 2_000],
  ]) {
    contractString(errors, receipt[key], `review unavailable receipt ${key}`, maximum);
    if (
      typeof receipt[key] === "string" &&
      /[\r\n\0]/.test(receipt[key])
    ) {
      errors.push(`review unavailable receipt ${key} must be a single-line value`);
    }
  }
  if (receipt.claim !== "agent-recorded") {
    errors.push("review unavailable receipt claim must equal agent-recorded");
  }
  if (receipt.status !== "unavailable") {
    errors.push("review unavailable receipt status must equal unavailable");
  }
  if (
    typeof receipt.recorded_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      receipt.recorded_at,
    ) ||
    Number.isNaN(Date.parse(receipt.recorded_at))
  ) {
    errors.push("review unavailable receipt recorded_at must be a UTC timestamp");
  }
  return errors;
}

function reviewReceiptDirectory(target, raw, label, maximum, validator) {
  const errors = [];
  let directory;
  try {
    directory = projectFileWithoutSymlinkComponents(target, raw, label);
  } catch (error) {
    return { entries: [], errors: [error.message] };
  }
  if (!existsSync(directory)) {
    return { entries: [], errors: [] };
  }
  if (lstatSync(directory).isSymbolicLink() || !statSync(directory).isDirectory()) {
    return { entries: [], errors: [`${raw} must be a real project directory`] };
  }
  const names = readdirSync(directory).sort();
  const receiptNames = names.filter((name) => name !== ".gitkeep");
  if (receiptNames.length > maximum) {
    errors.push(`${raw} exceeds the ${maximum} receipt limit`);
  }
  const entries = [];
  for (const name of receiptNames.slice(0, maximum + 1)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) {
      errors.push(`${raw} contains an invalid receipt file name: ${name}`);
      continue;
    }
    const relativePath = `${raw}/${name}`;
    try {
      const file = projectFileWithoutSymlinkComponents(
        target,
        relativePath,
        label,
      );
      if (lstatSync(file).isSymbolicLink() || !statSync(file).isFile()) {
        errors.push(`${relativePath} must be a real project file`);
        continue;
      }
      if (statSync(file).size > MAX_REVIEW_RECEIPT_BYTES) {
        errors.push(
          `${relativePath} exceeds the ${MAX_REVIEW_RECEIPT_BYTES}-byte receipt limit`,
        );
        continue;
      }
      const receipt = readJson(file, label);
      const receiptErrors = validator(receipt);
      if (receipt.receipt_id !== name.slice(0, -5)) {
        receiptErrors.push(`${relativePath} file name must match receipt_id`);
      }
      entries.push({ path: relativePath, file, receipt, errors: receiptErrors });
    } catch (error) {
      errors.push(`${relativePath}: ${error.message}`);
    }
  }
  return { entries, errors };
}

function reviewReceiptCurrentErrors(target, receipt, git) {
  const errors = [];
  if (!git || git.head === null || git.clean !== true) {
    errors.push("review evidence requires a clean Git working tree");
  }
  if (git?.head !== receipt.git_commit) {
    errors.push("review receipt git_commit is stale or does not match current HEAD");
  }
  if (git?.object_format !== receipt.git_object_format) {
    errors.push("review receipt git_object_format is stale or does not match current Git");
  }
  let resultFile;
  try {
    resultFile = projectFileWithoutSymlinkComponents(
      target,
      receipt.result_file,
      "review result file",
    );
  } catch (error) {
    errors.push(error.message);
    return errors;
  }
  if (!existsSync(resultFile)) {
    errors.push("review result file is missing");
    return errors;
  }
  if (lstatSync(resultFile).isSymbolicLink() || !statSync(resultFile).isFile()) {
    errors.push("review result file must be a regular non-symlink file");
    return errors;
  }
  const size = statSync(resultFile).size;
  if (size === 0) {
    errors.push("review result file must be non-empty");
  }
  if (size > MAX_REVIEW_RESULT_FILE_BYTES) {
    errors.push(
      `review result file exceeds the ${MAX_REVIEW_RESULT_FILE_BYTES}-byte limit`,
    );
  }
  if (size > 0 && size <= MAX_REVIEW_RESULT_FILE_BYTES) {
    const actual = `sha256:${hashFile(resultFile)}`;
    if (actual !== receipt.result_file_sha256) {
      errors.push("review result file hash does not match the receipt");
    }
    const artifactResult = readReviewerResultArtifact(target, receipt, resultFile);
    errors.push(...artifactResult.errors);
  }
  return errors;
}

function statusEvidencePaths({
  evaluatedReceiptPaths = [],
  evaluatedResultPaths = [],
} = {}) {
  const bounded = (values) => {
    const unique = [...new Set(values)].filter(
      (value) => typeof value === "string" && value.length > 0,
    );
    return {
      values: unique.slice(0, MAX_STATUS_EVIDENCE_PATHS),
      truncated: unique.length > MAX_STATUS_EVIDENCE_PATHS,
    };
  };
  const receipts = bounded(evaluatedReceiptPaths);
  const results = bounded(evaluatedResultPaths);
  return {
    evidence_graph_path: EVIDENCE_GRAPH_PATH,
    review_receipts_directory: REVIEW_RECEIPTS_PATH,
    review_unavailable_directory: REVIEW_UNAVAILABLE_PATH,
    evaluated_receipt_paths: receipts.values,
    evaluated_receipt_paths_truncated: receipts.truncated,
    evaluated_result_paths: results.values,
    evaluated_result_paths_truncated: results.truncated,
  };
}

function requireRunId(runId, label = "--run") {
  return boundedReceiptText(runId, label, 200);
}

function activationReceiptContentErrors(target, activation) {
  const errors = [];
  if (typeof activation.receipt_sha256 !== "string") {
    errors.push("legacy activation receipt lacks receipt_sha256 and cannot satisfy a current activation request");
  } else if (activation.receipt_sha256 !== activationReceiptSha256(activation)) {
    errors.push("activation receipt content hash is invalid");
  }
  try {
    const installed = installedSkillFile(
      target,
      activation.skill,
      activation.skill_path,
    );
    if (installed.path !== activation.skill_path) {
      errors.push("activation receipt skill_path is not canonical");
    }
    if (hashFile(installed.file) !== activation.skill_sha256) {
      errors.push("activation receipt installed skill hash does not match the receipt");
    }
  } catch (error) {
    errors.push(error.message);
  }
  return errors;
}

function activationStatusForRun(target, runId, requiredSkills = []) {
  const normalizedRunId = requireRunId(runId);
  const required = [...new Set(requiredSkills)];
  if (required.length > MAX_ACTIVATION_RECEIPTS_PER_RUN) {
    throw new StackError(
      `--require may contain at most ${MAX_ACTIVATION_RECEIPTS_PER_RUN} skills`,
    );
  }
  for (const skill of required) {
    if (!contractIdentifier(skill)) {
      throw new StackError("--require values must be canonical skill names");
    }
  }
  const graphFile = projectFileWithoutSymlinkComponents(
    target,
    EVIDENCE_GRAPH_PATH,
    "evidence graph",
  );
  let graph;
  try {
    graph = readJson(graphFile, "evidence graph");
  } catch (error) {
    return {
      ok: false,
      command: "evidence activation-status",
      ...statusEvidencePaths({ evaluatedReceiptPaths: [EVIDENCE_GRAPH_PATH] }),
      run_id: normalizedRunId,
      required_skills: required,
      activated_skills: [],
      missing_skills: required,
      receipts: [],
      errors: [error instanceof Error ? error.message : String(error)],
      status: "blocked",
      boundary:
        "Activation status is derived only from durable agent-recorded receipts; it is not independent proof of a harness tool call.",
    };
  }
  const graphErrors = validateEvidenceGraph(graph);
  if (graphErrors.length > 0) {
    return {
      ok: false,
      command: "evidence activation-status",
      ...statusEvidencePaths({ evaluatedReceiptPaths: [EVIDENCE_GRAPH_PATH] }),
      run_id: normalizedRunId,
      required_skills: required,
      activated_skills: [],
      missing_skills: required,
      receipts: [],
      errors: graphErrors,
      status: "blocked",
      boundary:
        "Activation status is derived only from durable agent-recorded receipts; it is not independent proof of a harness tool call.",
    };
  }
  const receipts = (graph.skill_activations ?? []).filter(
    (activation) => activation.run_id === normalizedRunId,
  );
  if (receipts.length > MAX_ACTIVATION_RECEIPTS_PER_RUN) {
    return {
      ok: false,
      command: "evidence activation-status",
      ...statusEvidencePaths({ evaluatedReceiptPaths: [EVIDENCE_GRAPH_PATH] }),
      run_id: normalizedRunId,
      required_skills: required,
      activated_skills: [],
      missing_skills: required,
      receipts: [],
      errors: [
        `run ${normalizedRunId} exceeds the ${MAX_ACTIVATION_RECEIPTS_PER_RUN}-receipt activation bound`,
      ],
      status: "blocked",
      boundary:
        "Activation status is derived only from durable agent-recorded receipts; it is not independent proof of a harness tool call.",
    };
  }
  const validReceipts = [];
  const receiptErrors = [];
  for (const receipt of receipts) {
    const errors = activationReceiptContentErrors(target, receipt);
    if (errors.length === 0) {
      validReceipts.push(receipt);
    } else {
      receiptErrors.push(
        ...errors.map((error) => `activation ${receipt.id}: ${error}`),
      );
    }
  }
  const activated = [...new Set(validReceipts.map((receipt) => receipt.skill))].sort();
  const missing = required.filter((skill) => !activated.includes(skill));
  return {
    ok: missing.length === 0 && receiptErrors.length === 0,
    command: "evidence activation-status",
    ...statusEvidencePaths({ evaluatedReceiptPaths: [EVIDENCE_GRAPH_PATH] }),
    run_id: normalizedRunId,
    required_skills: required,
    activated_skills: activated,
    missing_skills: missing,
    receipts: validReceipts,
    errors: receiptErrors,
    status: missing.length === 0 && receiptErrors.length === 0 ? "satisfied" : "blocked",
    boundary:
      "Activation status is derived only from durable agent-recorded receipts; it is not independent proof of a harness tool call.",
  };
}

function commandEvidenceActivationStatus(target, options) {
  return activationStatusForRun(target, options.runId, options.requiredSkills);
}

function commandReviewRecord(target, options) {
  const coordinator = requireCoordinator(target, options.coordinatorToken);
  const runId = requireRunId(options.runId);
  const reviewerKind = boundedReceiptText(
    options.reviewerKind,
    "--reviewer-kind",
    120,
  );
  const reviewerId = boundedReceiptText(
    options.reviewerId,
    "--reviewer-id",
    256,
  );
  if (!REVIEW_RESULTS.has(options.result)) {
    throw new StackError(
      "--result must be passed or changes-requested",
    );
  }
  const normalizedResultFile = normalizeReviewerResultPath(options.resultFile);
  if (!normalizedResultFile) {
    throw new StackError(
      "--result-file must name a JSON reviewer-result artifact under .agent-stack/runs/",
    );
  }
  const resultFile = projectFileWithoutSymlinkComponents(
    target,
    normalizedResultFile,
    "review result file",
  );
  if (!existsSync(resultFile)) {
    throw new StackError("--result-file must name an existing project file");
  }
  if (lstatSync(resultFile).isSymbolicLink() || !statSync(resultFile).isFile()) {
    throw new StackError("--result-file must name a regular non-symlink project file");
  }
  const size = statSync(resultFile).size;
  if (size === 0 || size > MAX_REVIEW_RESULT_FILE_BYTES) {
    throw new StackError(
      `--result-file must be non-empty and at most ${MAX_REVIEW_RESULT_FILE_BYTES} bytes`,
    );
  }
  const git = gitSnapshot(target);
  if (!git || git.clean !== true || !GIT_OBJECT_ID.test(git.head ?? "")) {
    throw new StackError(
      "review record requires a clean Git working tree at an exact commit",
      2,
      { git },
    );
  }
  const artifact = readJson(resultFile, "reviewer result artifact");
  const artifactErrors = validateReviewerResultArtifact(artifact, {
    run_id: runId,
    git_commit: git.head,
    reviewer_kind: reviewerKind,
    reviewer_id: reviewerId,
    result: options.result,
  });
  if (artifactErrors.length > 0) {
    throw new StackError(
      "Refusing to record an unvalidated reviewer result artifact",
      2,
      artifactErrors,
    );
  }
  const receipt = {
    schema_version: 1,
    run_id: artifact.run_id,
    git_commit: artifact.git_commit,
    git_object_format: git.object_format,
    coordinator_id: coordinator.lease.coordinator_id,
    reviewer_kind: artifact.reviewer_kind,
    reviewer_id: artifact.reviewer_id,
    result: artifact.result,
    result_file: normalizedResultFile,
    result_file_sha256: `sha256:${hashFile(resultFile)}`,
    recorded_at: utcTimestamp(),
    claim: "agent-recorded",
  };
  const receiptWithId = {
    receipt_id: reviewReceiptId(receipt),
    ...receipt,
  };
  const errors = validateReviewReceipt(receiptWithId);
  if (errors.length > 0) {
    throw new StackError("Refusing to write an invalid review receipt", 2, errors);
  }
  const directory = projectFileWithoutSymlinkComponents(
    target,
    REVIEW_RECEIPTS_PATH,
    "review receipts directory",
  );
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
    throw new StackError("review receipts directory must not be a symlink");
  }
  if (
    existsSync(directory) &&
    readdirSync(directory).filter((name) => name !== ".gitkeep").length >=
      MAX_REVIEW_RECEIPTS
  ) {
    throw new StackError(
      `review receipts are limited to ${MAX_REVIEW_RECEIPTS} files`,
    );
  }
  const path = `${REVIEW_RECEIPTS_PATH}/${receiptWithId.receipt_id}.json`;
  atomicProjectJson(target, path, receiptWithId, "local review receipt");
  return {
    ok: true,
    command: "review record",
    recorded: true,
    path,
    receipt: receiptWithId,
    boundary:
      "This is an agent-recorded local pre-PR receipt. It is separate from protected GitHub review receipts and is not external-provider authentication.",
  };
}

function commandReviewUnavailable(target, options) {
  const coordinator = requireCoordinator(target, options.coordinatorToken);
  const receipt = {
    schema_version: 1,
    run_id: requireRunId(options.runId),
    coordinator_id: coordinator.lease.coordinator_id,
    reason: boundedReceiptText(options.reason, "--reason", 200),
    details: boundedReceiptText(options.details, "--details", 2_000),
    recorded_at: utcTimestamp(),
    claim: "agent-recorded",
    status: "unavailable",
  };
  const receiptWithId = {
    receipt_id: reviewUnavailableReceiptId(receipt),
    ...receipt,
  };
  const errors = validateReviewUnavailableReceipt(receiptWithId);
  if (errors.length > 0) {
    throw new StackError(
      "Refusing to write an invalid review unavailable receipt",
      2,
      errors,
    );
  }
  const directory = projectFileWithoutSymlinkComponents(
    target,
    REVIEW_UNAVAILABLE_PATH,
    "review unavailable directory",
  );
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
    throw new StackError("review unavailable directory must not be a symlink");
  }
  if (
    existsSync(directory) &&
    readdirSync(directory).filter((name) => name !== ".gitkeep").length >=
      MAX_REVIEW_UNAVAILABLE_RECEIPTS
  ) {
    throw new StackError(
      `review unavailable receipts are limited to ${MAX_REVIEW_UNAVAILABLE_RECEIPTS} files`,
    );
  }
  const path = `${REVIEW_UNAVAILABLE_PATH}/${receiptWithId.receipt_id}.json`;
  atomicProjectJson(target, path, receiptWithId, "review unavailable receipt");
  return {
    ok: true,
    command: "review unavailable",
    recorded: true,
    path,
    receipt: receiptWithId,
    boundary:
      "Unavailable review evidence is a blocker and can never create a successful independent-review claim or PR-ready state.",
  };
}

function commandReviewStatus(target, runId) {
  const normalizedRunId = requireRunId(runId);
  const reviewDirectory = reviewReceiptDirectory(
    target,
    REVIEW_RECEIPTS_PATH,
    "review receipts directory",
    MAX_REVIEW_RECEIPTS,
    validateReviewReceipt,
  );
  const unavailableDirectory = reviewReceiptDirectory(
    target,
    REVIEW_UNAVAILABLE_PATH,
    "review unavailable directory",
    MAX_REVIEW_UNAVAILABLE_RECEIPTS,
    validateReviewUnavailableReceipt,
  );
  const git = gitSnapshot(target);
  const selectedEntries = reviewDirectory.entries.filter(
    (entry) => entry.receipt.run_id === normalizedRunId,
  );
  const unavailableEntries = unavailableDirectory.entries.filter(
    (entry) => entry.receipt.run_id === normalizedRunId,
  );
  const invalidReceipts = [
    ...reviewDirectory.errors,
    ...reviewDirectory.entries.flatMap((entry) =>
      entry.errors.map((error) => `${entry.path}: ${error}`),
    ),
    ...unavailableDirectory.errors,
    ...unavailableDirectory.entries.flatMap((entry) =>
      entry.errors.map((error) => `${entry.path}: ${error}`),
    ),
  ];
  const currentErrors = [];
  const validReceipts = [];
  const evaluatedResultPaths = [];
  for (const entry of selectedEntries) {
    if (entry.errors.length > 0) {
      continue;
    }
    evaluatedResultPaths.push(entry.receipt.result_file);
    const errors = reviewReceiptCurrentErrors(target, entry.receipt, git);
    if (errors.length > 0) {
      invalidReceipts.push(...errors.map((error) => `${entry.path}: ${error}`));
      currentErrors.push(...errors);
    } else {
      validReceipts.push(entry.receipt);
    }
  }
  const unavailable = unavailableEntries.filter((entry) => entry.errors.length === 0);
  const passed = validReceipts.filter((receipt) => receipt.result === "passed");
  const changesRequested = validReceipts.filter(
    (receipt) => receipt.result === "changes-requested",
  );
  const blockedReasons = [];
  if (unavailable.length > 0) {
    blockedReasons.push("independent review was recorded as unavailable");
  }
  if (selectedEntries.length === 0) {
    blockedReasons.push("no review receipt exists for this run");
  }
  if (passed.length === 0) {
    blockedReasons.push("no passed exact-head independent review exists");
  }
  if (changesRequested.length > 0) {
    blockedReasons.push("a reviewer requested changes");
  }
  if (invalidReceipts.length > 0) {
    blockedReasons.push("review evidence is invalid, stale, altered, or dirty");
  }
  const independentReviewed = blockedReasons.length === 0;
  return {
    ok: independentReviewed,
    command: "review status",
    ...statusEvidencePaths({
      evaluatedReceiptPaths: [
        ...reviewDirectory.entries.map((entry) => entry.path),
        ...unavailableDirectory.entries.map((entry) => entry.path),
      ],
      evaluatedResultPaths,
    }),
    run_id: normalizedRunId,
    git: git
      ? { head: git.head, object_format: git.object_format, clean: git.clean }
      : null,
    receipts: validReceipts,
    unavailable: unavailable.map((entry) => entry.receipt),
    invalid_receipts: invalidReceipts,
    independent_reviewed: independentReviewed,
    review_gate_ready: independentReviewed,
    status: independentReviewed ? "passed" : "blocked",
    reasons: [...new Set(blockedReasons)],
    current_errors: [...new Set(currentErrors)],
    boundary:
      "Local pre-PR review status is derived from durable receipt files and exact current Git state. Protected GitHub review receipts are a separate gate.",
  };
}

function incrementCount(counts, value) {
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

function sortedCounts(counts) {
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function evidenceReportData(ledger, graph) {
  const nodeKinds = new Map();
  const nodeStates = new Map();
  const sourceProviders = new Map();
  const edgeRelations = new Map();
  const connected = new Set();
  const activationSkills = new Map();
  const activationModes = new Map();
  const activationHarnessModels = new Map();
  for (const activation of graph.skill_activations ?? []) {
    incrementCount(activationSkills, activation.skill);
    incrementCount(activationModes, activation.mode);
    incrementCount(
      activationHarnessModels,
      `${activation.harness} / ${activation.model}`,
    );
  }
  for (const node of graph.nodes) {
    incrementCount(nodeKinds, node.kind);
    incrementCount(nodeStates, node.state);
    incrementCount(sourceProviders, node.source.provider);
  }
  for (const edge of graph.edges) {
    incrementCount(edgeRelations, edge.relation);
    connected.add(edge.from);
    connected.add(edge.to);
  }
  const workStatuses = new Map();
  for (const item of ledger.items) {
    incrementCount(workStatuses, item.status);
  }
  const evidenceEligibleWork = ledger.items.filter(
    (item) => item.status !== "cancelled",
  );
  const unconnected = graph.nodes
    .filter((node) => node.kind !== "work_item" && !connected.has(node.id))
    .map((node) => node.id)
    .sort();
  const withoutEvidence = evidenceEligibleWork
    .filter((item) => item.evidence_refs.length === 0)
    .map((item) => item.id)
    .sort();
  return {
    schema_version: 1,
    source: {
      work_ledger: WORK_LEDGER_PATH,
      evidence_graph: EVIDENCE_GRAPH_PATH,
      work_ledger_updated_at: ledger.updated_at,
      evidence_graph_updated_at: graph.updated_at,
    },
    totals: {
      work_items: ledger.items.length,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      skill_activations: (graph.skill_activations ?? []).length,
    },
    work_statuses: sortedCounts(workStatuses),
    node_kinds: sortedCounts(nodeKinds),
    node_states: sortedCounts(nodeStates),
    edge_relations: sortedCounts(edgeRelations),
    source_providers: sortedCounts(sourceProviders),
    skill_activations: {
      by_skill: sortedCounts(activationSkills),
      by_mode: sortedCounts(activationModes),
      by_harness_model: sortedCounts(activationHarnessModels),
      boundary:
        "Agent-recorded activations are trace evidence, not independent proof of harness tool calls.",
    },
    coverage: {
      work_items_with_evidence: evidenceEligibleWork.filter(
        (item) => item.evidence_refs.length > 0,
      ).length,
      work_items_without_evidence: withoutEvidence.length,
      work_items_without_evidence_sample: withoutEvidence.slice(0, 100),
      work_items_without_evidence_sample_truncated:
        withoutEvidence.length > 100,
      unconnected_non_work_nodes: unconnected.length,
      unconnected_non_work_node_sample: unconnected.slice(0, 100),
      unconnected_non_work_node_sample_truncated: unconnected.length > 100,
    },
  };
}

function mermaidLabel(value, maximum = 80) {
  return String(value)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} .,:;_()/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function evidenceMermaid(graph, maxNodes) {
  const orderedNodes = [...graph.nodes].sort(
    (left, right) =>
      Number(right.kind === "work_item") -
        Number(left.kind === "work_item") ||
      left.id.localeCompare(right.id),
  );
  const selected = orderedNodes.slice(0, maxNodes);
  const selectedIds = new Set(selected.map((node) => node.id));
  const aliases = new Map(
    selected.map((node, index) => [node.id, `n${index + 1}`]),
  );
  const eligibleEdges = graph.edges
    .filter(
      (edge) =>
        selectedIds.has(edge.from) && selectedIds.has(edge.to),
    )
    .sort(
      (left, right) =>
        left.from.localeCompare(right.from) ||
        left.relation.localeCompare(right.relation) ||
        left.to.localeCompare(right.to),
    );
  const edgeLimit = selected.length * EVIDENCE_MERMAID_EDGES_PER_NODE;
  const selectedEdges = eligibleEdges.slice(0, edgeLimit);
  const lines = [
    "flowchart LR",
    ...selected.map((node) => {
      const label = mermaidLabel(
        `${node.label} · ${node.kind} · ${node.state}`,
      );
      return `    ${aliases.get(node.id)}["${label}"]:::${node.state}`;
    }),
    ...selectedEdges
      .map(
        (edge) =>
          `    ${aliases.get(edge.from)} -->|${edge.relation}| ${aliases.get(edge.to)}`,
      ),
  ];
  const omittedNodes = graph.nodes.length - selected.length;
  if (omittedNodes > 0) {
    lines.push(
      `    omittedNodes["${omittedNodes} nodes omitted by report bound"]:::omitted`,
    );
  }
  const omittedEdges = eligibleEdges.length - selectedEdges.length;
  if (omittedEdges > 0) {
    lines.push(
      `    omittedEdges["${omittedEdges} edges omitted by report bound"]:::omitted`,
    );
  }
  lines.push(
    "    classDef planned fill:#f4f4f5,stroke:#71717a,color:#18181b",
    "    classDef active fill:#dbeafe,stroke:#2563eb,color:#172554",
    "    classDef verified fill:#dcfce7,stroke:#16a34a,color:#14532d",
    "    classDef failed fill:#fee2e2,stroke:#dc2626,color:#7f1d1d",
    "    classDef superseded fill:#fef3c7,stroke:#d97706,color:#78350f",
    "    classDef omitted fill:#ffffff,stroke:#a1a1aa,color:#52525b,stroke-dasharray: 4 4",
  );
  return {
    mermaid: `${lines.join("\n")}\n`,
    selected_node_count: selected.length,
    omitted_node_count: omittedNodes,
    selected_edge_count: selectedEdges.length,
    omitted_edge_count: omittedEdges,
    edge_limit: edgeLimit,
  };
}

function commandEvidenceReport(
  target,
  { format = "json", output = undefined, maxNodes = 200 } = {},
) {
  if (!["json", "mermaid"].includes(format)) {
    throw new StackError("--format must be json or mermaid");
  }
  const numericMaxNodes = Number(maxNodes);
  if (
    !Number.isInteger(numericMaxNodes) ||
    numericMaxNodes < 1 ||
    numericMaxNodes > 500
  ) {
    throw new StackError("--max-nodes must be an integer between 1 and 500");
  }
  const snapshot = loadValidatedWorkEvidence(target);
  if (!snapshot.ok) {
    throw new StackError(
      "Evidence reporting requires valid repository work and evidence.",
      2,
      [
        ...snapshot.ledger.errors,
        ...snapshot.graph.errors,
        ...snapshot.linkageErrors,
      ],
    );
  }
  const ledger = snapshot.ledger.value;
  const graph = snapshot.graph.value;
  const report = evidenceReportData(ledger, graph);
  const visualization =
    format === "mermaid"
      ? evidenceMermaid(graph, numericMaxNodes)
      : null;
  let normalizedOutput;
  if (output !== undefined) {
    const outputFile = projectFileWithoutSymlinkComponents(
      target,
      output,
      "evidence report",
    );
    normalizedOutput = relative(realpathSync(target), outputFile)
      .split(sep)
      .join("/");
    if (
      !normalizedOutput.startsWith(`${EVIDENCE_REPORTS_PATH}/`) ||
      normalizedOutput === `${EVIDENCE_REPORTS_PATH}/` ||
      (format === "json" && !normalizedOutput.endsWith(".json")) ||
      (format === "mermaid" && !normalizedOutput.endsWith(".mmd"))
    ) {
      throw new StackError(
        "Evidence report output must be a .json or .mmd file under .agent-stack/reports for the selected format.",
      );
    }
    mkdirSync(dirname(outputFile), { recursive: true });
    projectFileWithoutSymlinkComponents(target, output, "evidence report");
    if (format === "json") {
      atomicJson(outputFile, report);
    } else {
      atomicText(outputFile, visualization.mermaid);
    }
  }
  return {
    ok: true,
    format,
    report,
    ...(visualization ?? {}),
    ...(normalizedOutput === undefined
      ? {}
      : { output: normalizedOutput }),
  };
}

function delegatedCheckDefinition(target, check) {
  const executable = canonicalExecutableName(check.argv?.[0] ?? "");
  if (PACKAGE_MANAGERS.has(executable)) {
    const script =
      check.argv[1] === "test"
        ? "test"
        : check.argv[1] === "run"
          ? check.argv[2]
          : undefined;
    const packageFile = projectFile(target, "package.json", "package.json");
    if (!existsSync(packageFile)) {
      return { kind: "package-script", script, status: "missing-package-json" };
    }
    const raw = readFileSync(packageFile, "utf8");
    try {
      const packageData = JSON.parse(raw);
      return {
        kind: "package-script",
        manager: executable,
        package_manager: packageData.packageManager ?? null,
        script,
        definition:
          typeof script === "string" &&
          packageData.scripts &&
          typeof packageData.scripts === "object"
            ? (packageData.scripts[script] ?? null)
            : null,
      };
    } catch {
      return {
        kind: "package-script",
        script,
        status: "invalid-package-json",
        content_hash: sha256(raw),
      };
    }
  }
  if (
    check.argv?.[0]?.startsWith(".") ||
    check.argv?.[0]?.includes("/") ||
    check.argv?.[0]?.includes("\\")
  ) {
    const executableFile = projectFile(
      target,
      check.argv[0],
      "quality executable",
    );
    return {
      kind: "project-executable",
      path: check.argv[0],
      content_hash: existsSync(executableFile) ? hashFile(executableFile) : null,
    };
  }
  return null;
}

function checksHash(checks, target = undefined, environmentAllow = []) {
  const normalizedEnvironmentAllow = Array.isArray(environmentAllow)
    ? [...new Set(environmentAllow)].sort()
    : [];
  const environmentDefinitions = normalizedEnvironmentAllow.map((name) => {
    const value = process.env[name];
    return {
      name,
      present: typeof value === "string",
      ...(typeof value === "string" ? { value_hash: sha256(value) } : {}),
    };
  });
  const payload = target
    ? {
        checks,
        delegated_definitions: checks.map((check) =>
          delegatedCheckDefinition(target, check),
        ),
        ...(environmentDefinitions.length > 0
          ? { environment: environmentDefinitions }
          : {}),
      }
    : checks;
  return sha256(stableJson(payload));
}

function currentChecksHash(config, target) {
  return checksHash(
    config.quality?.checks ?? [],
    target,
    config.quality?.environment?.allow ?? [],
  );
}

function configurationHash(config) {
  return sha256(
    stableJson({
      onboarding: {
        status: config.onboarding?.status,
        project_profile: config.onboarding?.project_profile,
        external_data_policy: config.onboarding?.external_data_policy,
      },
      interaction: config.interaction,
      capabilities: config.capabilities,
      learning: config.learning,
      autonomy: {
        execution: config.autonomy?.execution,
        merge: config.autonomy?.merge,
        parallel_work: config.autonomy?.parallel_work,
      },
      parallel_delivery: config.parallel_delivery,
    }),
  );
}

function loadInstallation(target) {
  const file = projectFile(
    target,
    INSTALLATION_PATH,
    "installation manifest",
  );
  if (!existsSync(file)) {
    return null;
  }
  const manifest = readJson(file, "installation manifest");
  manifest.managed_files ??= {};
  manifest.pending_files ??= {};
  manifest.orphaned_files ??= {};
  manifest.harnesses ??= [];
  return manifest;
}

function sourceEntries({ claude = false } = {}) {
  if (!existsSync(join(PACKAGE_ROOT, ".codex-plugin/plugin.json"))) {
    throw new StackError(
      "init and upgrade must run from the npm/plugin package, not the project-local CLI",
    );
  }
  const entries = [];
  const templateRoot = join(PACKAGE_ROOT, "assets/project-template");
  const protectedTemplates = new Set([
    CORE_POLICY_PATH,
    REVIEW_WORKFLOW_PATH,
  ]);
  for (const source of listFiles(templateRoot)) {
    let destination = relative(templateRoot, source)
      .split(sep)
      .join("/");
    if (!claude && destination.startsWith(".claude/")) {
      continue;
    }
    if (destination === ".agent-stack/gitignore.template") {
      destination = ".agent-stack/.gitignore";
    }
    entries.push({
      destination,
      source,
      protected: protectedTemplates.has(destination),
    });
  }
  const skillsRoot = join(PACKAGE_ROOT, "skills");
  for (const source of listFiles(skillsRoot)) {
    const skillRelative = relative(skillsRoot, source);
    entries.push({
      destination: join(".agents/skills", skillRelative),
      source,
      protected: false,
    });
    if (claude) {
      entries.push({
        destination: join(".claude/skills", skillRelative),
        source,
        protected: false,
      });
    }
  }
  entries.push({
    destination: REVIEW_RECEIPT_PATH,
    source: join(PACKAGE_ROOT, "scripts/review-receipt.mjs"),
    protected: true,
  });
  entries.push({
    destination: GBRAIN_LAUNCHER_PATH,
    source: join(PACKAGE_ROOT, "scripts/gbrain-project.mjs"),
    protected: true,
  });
  entries.push({
    destination: LINEAR_READONLY_PATH,
    source: join(PACKAGE_ROOT, "scripts/linear-readonly.mjs"),
    protected: true,
  });
  entries.push({
    destination: LINEAR_WRITE_PATH,
    source: join(PACKAGE_ROOT, "scripts/linear-write.mjs"),
    protected: true,
  });
  entries.push({
    destination: TELEMETRY_READONLY_PATH,
    source: join(PACKAGE_ROOT, "scripts/telemetry-readonly.mjs"),
    protected: true,
  });
  entries.push({
    destination: PROJECT_CLI_PATH,
    source: CLI_FILE,
    protected: true,
  });
  entries.push({
    destination: PROJECT_PROCESS_HELPER_PATH,
    source: join(PACKAGE_ROOT, "lib/portable-process.mjs"),
    protected: true,
  });
  entries.push({
    destination: PROJECT_THIRD_PARTY_NOTICES_PATH,
    source: join(PACKAGE_ROOT, "lib/THIRD_PARTY_NOTICES.md"),
    protected: true,
  });
  return entries.sort((left, right) =>
    left.destination.localeCompare(right.destination),
  );
}

function detectHarnesses(target) {
  const detected = [];
  if (
    projectExists(target, ".claude") ||
    projectExists(target, "CLAUDE.md")
  ) {
    detected.push("claude");
  }
  if (
    projectExists(target, ".codex") ||
    projectExists(target, "AGENTS.md")
  ) {
    detected.push("codex");
  }
  if (projectExists(target, ".cursor")) {
    detected.push("cursor");
  }
  if (projectExists(target, ".gemini") || projectExists(target, "GEMINI.md")) {
    detected.push("gemini");
  }
  if (projectExists(target, ".opencode")) {
    detected.push("opencode");
  }
  if (projectExists(target, ".grok")) {
    detected.push("grok");
  }
  return detected;
}

// Every shipped adapter installs by default. Detection only tells the agent
// which harnesses already had project markers. The legacy --claude parser flag
// remains a silent compatibility no-op until 1.0.
function resolveHarnesses(target) {
  return {
    detected: detectHarnesses(target),
    enabled: [...SUPPORTED_HARNESSES],
  };
}

function writeProposal(target, packageVersion, destination, bytes) {
  const proposalRelative = join(
    ".agent-stack/update-proposals",
    packageVersion,
    destination,
  );
  const proposal = pathInside(target, proposalRelative, "update proposal");
  mkdirSync(dirname(proposal), { recursive: true });
  writeFileSync(proposal, bytes, { mode: 0o600 });
  return proposalRelative;
}

function installOrUpgrade(
  target,
  {
    mode = "init",
  } = {},
) {
  const existing = loadInstallation(target);
  if (mode === "init" && existing) {
    return {
      ok: true,
      action: "already-initialized",
      installed_version: existing.package?.version,
      next: `Run npx -y ${PACKAGE_NAME}@latest upgrade`,
    };
  }
  const harnesses = resolveHarnesses(target);
  const claudeEnabled = harnesses.enabled.includes("claude");

  const manifest = existing ?? {
    schema_version: 1,
    installed_at: utcTimestamp(),
    managed_files: {},
    pending_files: {},
    orphaned_files: {},
    harnesses: [],
  };
  const previousManaged = { ...manifest.managed_files };
  const currentSources = new Set();
  const outcomes = [];
  const entries = sourceEntries({ claude: claudeEnabled });

  for (const entry of entries) {
    const destination = entry.destination.split(sep).join("/");
    currentSources.add(destination);
    const destinationFile = pathInside(target, destination, "managed file");
    const sourceBytes = readFileSync(entry.source);
    const newSourceHash = sha256(sourceBytes);
    const oldEntry = manifest.managed_files[destination];

    if (!existsSync(destinationFile)) {
      if (oldEntry) {
        const proposal = writeProposal(
          target,
          PACKAGE_VERSION,
          destination,
          sourceBytes,
        );
        manifest.pending_files[destination] = {
          source_hash: newSourceHash,
          proposal,
          protected: entry.protected,
          reason: "locally-deleted",
        };
        outcomes.push({ path: destination, status: "preserved-deletion", proposal });
        continue;
      }
      mkdirSync(dirname(destinationFile), { recursive: true });
      writeFileSync(destinationFile, sourceBytes, { mode: 0o600 });
      if (
        destination === PROJECT_CLI_PATH ||
        destination === GBRAIN_LAUNCHER_PATH
      ) {
        chmodSync(destinationFile, 0o755);
      }
      manifest.managed_files[destination] = {
        source_hash: newSourceHash,
        accepted_hash: newSourceHash,
        customized: false,
        protected: entry.protected,
      };
      delete manifest.pending_files[destination];
      outcomes.push({ path: destination, status: "created" });
      continue;
    }

    if (lstatSync(destinationFile).isSymbolicLink()) {
      throw new StackError(
        `Refusing to manage symlink inside project: ${destination}`,
      );
    }
    const currentHash = hashFile(destinationFile);
    if (currentHash === newSourceHash) {
      manifest.managed_files[destination] = {
        source_hash: newSourceHash,
        accepted_hash: currentHash,
        customized: false,
        protected: entry.protected,
      };
      delete manifest.pending_files[destination];
      outcomes.push({ path: destination, status: "unchanged" });
      continue;
    }

    if (!oldEntry) {
      const proposal = writeProposal(
        target,
        PACKAGE_VERSION,
        destination,
        sourceBytes,
      );
      manifest.pending_files[destination] = {
        source_hash: newSourceHash,
        proposal,
        protected: entry.protected,
        reason: "pre-existing-file",
      };
      outcomes.push({ path: destination, status: "preserved-existing", proposal });
      continue;
    }

    const sourceChanged = oldEntry.source_hash !== newSourceHash;
    const localChanged = currentHash !== oldEntry.accepted_hash;
    const customized =
      oldEntry.customized === true || currentHash !== oldEntry.source_hash;

    if (!sourceChanged) {
      manifest.managed_files[destination] = {
        ...oldEntry,
        accepted_hash: currentHash,
        customized: currentHash !== newSourceHash,
        protected: entry.protected,
      };
      delete manifest.pending_files[destination];
      outcomes.push({
        path: destination,
        status: localChanged ? "adopted-local-change" : "preserved-local",
      });
      continue;
    }

    const proposal = writeProposal(
      target,
      PACKAGE_VERSION,
      destination,
      sourceBytes,
    );
    manifest.pending_files[destination] = {
      source_hash: newSourceHash,
      proposal,
      protected: entry.protected,
      reason:
        customized || localChanged
          ? "local-and-package-changed"
          : "package-changed-safe-reconciliation",
    };
    outcomes.push({ path: destination, status: "needs-reconciliation", proposal });
  }

  for (const [destination, oldEntry] of Object.entries(previousManaged)) {
    if (!currentSources.has(destination)) {
      manifest.orphaned_files[destination] = {
        ...oldEntry,
        noted_at: utcTimestamp(),
        reason: "no-longer-shipped; preserved for manual decision",
      };
      outcomes.push({ path: destination, status: "upstream-removed-preserved" });
    }
  }

  const configFile = projectFile(target, CONFIG_PATH, "project config");
  let detected;
  if (!existsSync(configFile)) {
    detected = detectProject(target);
    atomicJson(configFile, defaultConfig(target, detected));
    outcomes.push({ path: CONFIG_PATH, status: "created" });
  } else {
    const config = migrateConfig(readJson(configFile, "project config"), target);
    atomicJson(configFile, config);
    outcomes.push({ path: CONFIG_PATH, status: "migrated-or-unchanged" });
  }

  manifest.schema_version = 1;
  manifest.package = { name: PACKAGE_NAME, version: PACKAGE_VERSION };
  manifest.updated_at = utcTimestamp();
  manifest.harnesses = harnesses.enabled;
  atomicProjectJson(
    target,
    INSTALLATION_PATH,
    manifest,
    "installation manifest",
  );

  const pending = Object.keys(manifest.pending_files);
  return {
    ok: true,
    action: existing ? "upgraded" : "initialized",
    package: manifest.package,
    target,
    detected,
    harnesses,
    outcomes,
    pending_reconciliation: pending,
    next_prompt:
      pending.length > 0
        ? "Reconcile the listed proposals, run adopt-managed for each, then run doctor."
        : "Read .agent-stack/HANDOFF.md, inspect capabilities, complete guided onboarding with configure, review and approve detected checks, run doctor, then begin conversational project shaping.",
  };
}

// Init and upgrade can touch a large portable bundle. Keep a deliberately
// opt-in compact response for agents that need to conserve context without
// dropping any path that requires reconciliation or another manual decision.
// The attention list contains each notable path once; ordinary outcomes remain
// represented by counts. The normal CLI response and installOrUpgrade() keep
// exposing the original detailed result.
const ATTENTION_INSTALL_STATUSES = new Set([
  "preserved-existing",
  "preserved-deletion",
  "adopted-local-change",
  "preserved-local",
  "needs-reconciliation",
  "upstream-removed-preserved",
]);
const ACTIONABLE_INSTALL_STATUSES = new Set([
  "preserved-existing",
  "preserved-deletion",
  "needs-reconciliation",
  "upstream-removed-preserved",
]);

function summarizeInstallResult(result) {
  if (!result || !Array.isArray(result.outcomes)) {
    return result;
  }

  const outcomeCounts = {};
  for (const outcome of result.outcomes) {
    const status = outcome?.status ?? "unknown";
    outcomeCounts[status] = (outcomeCounts[status] ?? 0) + 1;
  }

  const attention = result.outcomes
    .filter((outcome) => ATTENTION_INSTALL_STATUSES.has(outcome?.status))
    .map(({ path, status, proposal }) => ({
      path,
      status,
      requires_action: ACTIONABLE_INSTALL_STATUSES.has(status),
      ...(proposal ? { proposal: proposal.split(sep).join("/") } : {}),
    }));

  const {
    outcomes,
    pending_reconciliation: _pendingReconciliation,
    ...summary
  } = result;
  return {
    ...summary,
    files_processed: result.outcomes.length,
    outcome_counts: Object.fromEntries(
      Object.entries(outcomeCounts).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    attention,
    attention_total: attention.length,
  };
}

function loadConfig(target) {
  return migrateConfig(
    readJson(projectFile(target, CONFIG_PATH, "project config"), "project config"),
    target,
  );
}

function linearOperationCredentialEnv(operation) {
  return operation === "issue_create"
    ? LINEAR_CREATE_CREDENTIAL_ENV
    : LINEAR_COMMENT_CREDENTIAL_ENV;
}

function validTelemetryCredential(value) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 8_192 &&
    !/[\r\n\0]/.test(value)
  );
}

function commandCapabilities(target) {
  const config = projectExists(target, CONFIG_PATH, "project config")
    ? loadConfig(target)
    : null;
  const telemetryHelperAvailable =
    projectExists(target, TELEMETRY_READONLY_PATH) &&
    protectedProjectFileIssue(target, TELEMETRY_READONLY_PATH) === null;
  const codeRabbitFiles = {
    configuration: projectExists(target, ".coderabbit.yaml"),
    receipt_workflow: projectExists(target, REVIEW_WORKFLOW_PATH),
  };
  return {
    ok: true,
    selected: config?.capabilities ?? null,
    available: {
      review: {
        builtin: {
          available: true,
          external: false,
          detail: "Repository-owned standards and intent review",
        },
        coderabbit: {
          available:
            codeRabbitFiles.configuration &&
            codeRabbitFiles.receipt_workflow,
          external: true,
          detail: codeRabbitFiles,
          authorization:
            "GitHub App authorization is verified during pull-request review",
        },
        "github-human": {
          available:
            projectExists(target, REVIEW_WORKFLOW_PATH) &&
            executableExists(target, "git"),
          external: true,
          detail: "Requires one or more explicitly allowed GitHub logins",
        },
      },
      knowledge: {
        repository: {
          available: true,
          external: false,
          detail: "Locked artifacts, decisions, evidence, and Git history",
        },
        gbrain: {
          available: executableExists(target, "gbrain"),
          external: true,
          detail: executableExists(target, "gbrain")
            ? "gbrain CLI detected; the agent must still verify the selected brain and access scope"
            : "CLI not detected; an existing harness MCP connection may still be available",
        },
      },
      telemetry: {
        none: {
          available: true,
          external: false,
          detail:
            "Repository evidence only; Ultimate Agent Stack sends no usage telemetry",
        },
        ...Object.fromEntries(
          Object.keys(TELEMETRY_PROVIDER_ROLES).map((provider) => {
            const credential =
              TELEMETRY_CREDENTIAL_ENVIRONMENTS[provider];
            return [
              provider,
              {
                available:
                  telemetryHelperAvailable &&
                  validTelemetryCredential(process.env[credential]),
                external: true,
                access: "read_only",
                role: TELEMETRY_PROVIDER_ROLES[provider],
                credential_environment: credential,
                detail:
                  provider === "posthog"
                    ? "Reviewed PostHog project insight-metadata check; no events, recordings, or mutations"
                    : provider === "sentry"
                      ? "Reviewed Sentry project-identity check; no events, stack traces, or mutations"
                      : "Reviewed New Relic account-identity query; no arbitrary NRQL, configuration, or mutations",
              },
            ];
          }),
        ),
      },
      work: {
        repository: {
          available:
            projectExists(target, WORK_LEDGER_PATH) &&
            projectExists(target, EVIDENCE_GRAPH_PATH),
          external: false,
          detail:
            "Portable repository work ledger and reference-only evidence graph",
        },
        linear: {
          available:
            projectExists(target, LINEAR_READONLY_PATH) &&
            typeof process.env[LINEAR_CREDENTIAL_ENV] === "string" &&
            process.env[LINEAR_CREDENTIAL_ENV].length > 0,
          external: true,
          access:
            config?.capabilities?.work?.connection?.writes?.operations
              ?.length > 0
              ? "read_only_with_receipted_writes"
              : "read_only",
          credential_environment: LINEAR_CREDENTIAL_ENV,
          writes:
            config?.capabilities?.work?.connection?.writes?.operations?.map(
              (operation) => {
                const environment =
                  linearOperationCredentialEnv(operation);
                return {
                  operation,
                  credential_environment: environment,
                  available:
                    typeof process.env[environment] === "string" &&
                    process.env[environment].length > 0,
                };
              },
            ) ?? [],
          detail:
            config?.capabilities?.work?.connection?.writes?.operations
              ?.length > 0
              ? "Reviewed Linear reader plus explicitly approved issue/comment creation; repository work and receipts remain authoritative"
              : "Reviewed Linear GraphQL reader with repository fallback; no mutation operation is exposed",
        },
      },
    },
  };
}

function gbrainEnvironment(target) {
  const environment = {};
  for (const name of SAFE_ENVIRONMENT_NAMES) {
    if (typeof process.env[name] === "string") {
      environment[name] = process.env[name];
    }
  }
  for (const name of TOOLCHAIN_ENVIRONMENT_NAMES) {
    if (typeof process.env[name] === "string") {
      environment[name] = process.env[name];
    }
  }
  return {
    ...environment,
    GBRAIN_HOME: projectFile(
      target,
      GBRAIN_HOME_PATH,
      "project GBrain home",
    ),
    NO_COLOR: "1",
  };
}

function runGbrain(target, args, timeout = 30_000) {
  const result = spawnPortable(target, "gbrain", args, {
    cwd: target,
    encoding: "utf8",
    env: gbrainEnvironment(target),
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout,
  });
  const timedOut = result.error?.code === "ETIMEDOUT";
  return {
    ok: result.status === 0 && !timedOut,
    status: timedOut ? 124 : (result.status ?? 1),
    ...(timedOut ? { reason: "timeout" } : {}),
    raw_stdout: result.stdout ?? "",
    stdout: redact(result.stdout ?? "", 24_000),
    stderr: redact(result.stderr ?? "", 4_000),
  };
}

function parseProviderJson(result, label) {
  if (!result.ok) {
    return {
      ok: false,
      error: `${label} failed`,
      status: result.status,
      detail: result.stderr || result.stdout || result.reason,
    };
  }
  try {
    return {
      ok: true,
      value: JSON.parse((result.raw_stdout ?? result.stdout).trim()),
    };
  } catch {
    return {
      ok: false,
      error: `${label} returned invalid JSON`,
      detail: result.stdout,
    };
  }
}

function parseTelemetryProviderJson(result, label) {
  if (result.ok) {
    return parseProviderJson(result, label);
  }
  try {
    const value = JSON.parse(
      (result.raw_stdout ?? result.stdout ?? "").trim(),
    );
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.ok === false &&
      typeof value.error === "string" &&
      value.error.length >= 1 &&
      value.error.length <= 300 &&
      !/[\r\n\0]/.test(value.error)
    ) {
      return {
        ok: false,
        error: redact(value.error, 300),
        status: result.status,
      };
    }
  } catch {
    // Fall through to the generic bounded failure below.
  }
  return {
    ok: false,
    error: `${label} failed`,
    status: result.status,
    detail: result.stderr || result.stdout || result.reason,
  };
}

function telemetryEnvironment(provider) {
  const environment = {};
  for (const name of SAFE_ENVIRONMENT_NAMES) {
    if (typeof process.env[name] === "string") {
      environment[name] = process.env[name];
    }
  }
  const credentialEnvironment =
    TELEMETRY_CREDENTIAL_ENVIRONMENTS[provider];
  if (
    credentialEnvironment &&
    typeof process.env[credentialEnvironment] === "string"
  ) {
    environment[credentialEnvironment] =
      process.env[credentialEnvironment];
  }
  return {
    ...environment,
    NO_COLOR: "1",
  };
}

function telemetryHelperArguments(provider) {
  const args = [
    "health",
    "--provider",
    provider.provider,
    "--region",
    provider.region,
  ];
  if (provider.provider === "posthog") {
    args.push("--project", provider.scope.project_id);
  } else if (provider.provider === "sentry") {
    args.push(
      "--organization",
      provider.scope.organization,
      "--project",
      provider.scope.project,
    );
  } else {
    args.push("--account", provider.scope.account_id);
  }
  return args;
}

function runTelemetryReadonly(target, provider, timeout = 20_000) {
  const helper = projectFile(
    target,
    TELEMETRY_READONLY_PATH,
    "telemetry read-only helper",
  );
  if (!existsSync(helper)) {
    return {
      ok: false,
      status: 1,
      raw_stdout: "",
      stdout: "",
      stderr: `missing ${TELEMETRY_READONLY_PATH}`,
    };
  }
  const result = spawnPortable(
    target,
    "node",
    [helper, ...telemetryHelperArguments(provider)],
    {
      cwd: target,
      encoding: "utf8",
      env: telemetryEnvironment(provider.provider),
      maxBuffer: 256 * 1024,
      shell: false,
      timeout,
    },
  );
  const timedOut = result.error?.code === "ETIMEDOUT";
  return {
    ok: result.status === 0 && !timedOut,
    status: timedOut ? 124 : (result.status ?? 1),
    ...(timedOut ? { reason: "timeout" } : {}),
    raw_stdout: result.stdout ?? "",
    stdout: redact(result.stdout ?? "", 8_000),
    stderr: redact(result.stderr ?? "", 2_000),
  };
}

function linearEnvironment() {
  const environment = {};
  for (const name of SAFE_ENVIRONMENT_NAMES) {
    if (typeof process.env[name] === "string") {
      environment[name] = process.env[name];
    }
  }
  if (typeof process.env[LINEAR_CREDENTIAL_ENV] === "string") {
    environment[LINEAR_CREDENTIAL_ENV] =
      process.env[LINEAR_CREDENTIAL_ENV];
  }
  return {
    ...environment,
    NO_COLOR: "1",
  };
}

function linearWriteEnvironment(command) {
  const environment = {};
  for (const name of SAFE_ENVIRONMENT_NAMES) {
    if (typeof process.env[name] === "string") {
      environment[name] = process.env[name];
    }
  }
  const credential =
    command === "issue-create"
      ? LINEAR_CREATE_CREDENTIAL_ENV
      : command === "evidence-comment"
        ? LINEAR_COMMENT_CREDENTIAL_ENV
        : null;
  if (credential && typeof process.env[credential] === "string") {
    environment[credential] = process.env[credential];
  }
  return {
    ...environment,
    NO_COLOR: "1",
  };
}

function runLinearReadonly(target, args, timeout = 20_000) {
  const helper = projectFile(
    target,
    LINEAR_READONLY_PATH,
    "Linear read-only helper",
  );
  if (!existsSync(helper)) {
    return {
      ok: false,
      status: 1,
      raw_stdout: "",
      stdout: "",
      stderr: `missing ${LINEAR_READONLY_PATH}`,
    };
  }
  const result = spawnPortable(target, "node", [helper, ...args], {
    cwd: target,
    encoding: "utf8",
    env: linearEnvironment(),
    maxBuffer: 512 * 1024,
    shell: false,
    timeout,
  });
  const timedOut = result.error?.code === "ETIMEDOUT";
  return {
    ok: result.status === 0 && !timedOut,
    status: timedOut ? 124 : (result.status ?? 1),
    ...(timedOut ? { reason: "timeout" } : {}),
    raw_stdout: result.stdout ?? "",
    stdout: redact(result.stdout ?? "", 24_000),
    stderr: redact(result.stderr ?? "", 4_000),
  };
}

function runLinearWrite(target, command, input, timeout = 20_000) {
  const helper = projectFile(target, LINEAR_WRITE_PATH, "Linear write helper");
  if (!existsSync(helper)) {
    return {
      ok: false,
      status: 1,
      raw_stdout: "",
      stdout: "",
      stderr: `missing ${LINEAR_WRITE_PATH}`,
    };
  }
  const result = spawnPortable(target, "node", [helper, command], {
    cwd: target,
    encoding: "utf8",
    env: linearWriteEnvironment(command),
    input: stableJson(input),
    maxBuffer: 256 * 1024,
    shell: false,
    timeout,
  });
  const timedOut = result.error?.code === "ETIMEDOUT";
  return {
    ok: result.status === 0 && !timedOut,
    status: timedOut ? 124 : (result.status ?? 1),
    ...(timedOut ? { reason: "timeout" } : {}),
    raw_stdout: result.stdout ?? "",
    stdout: redact(result.stdout ?? "", 8_000),
    stderr: redact(result.stderr ?? "", 2_000),
  };
}

function deterministicUuid(digest) {
  if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new StackError("Cannot derive provider UUID from an invalid digest");
  }
  const bytes = Buffer.from(digest.slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

const LINEAR_HEALTH_ERRORS = new Set([
  "LINEAR_API_KEY is missing or invalid",
  "Linear health response exceeded the bounded capture limit",
  "Linear returned invalid JSON",
  "Linear GraphQL returned one or more errors",
  "Linear health request failed",
  "Linear health response has an invalid team connection",
  "Linear health response has an invalid pagination cursor",
  "Linear team visibility exceeded the bounded pagination limit",
  "one or more configured Linear teams are not visible",
  "Linear viewer identity is missing",
  "Linear health request timed out",
]);

function sanitizedLinearRateLimit(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    ["limit", "remaining", "reset"]
      .filter(
        (key) =>
          typeof value[key] === "string" &&
          /^\d{1,16}$/.test(value[key]),
      )
      .map((key) => [key, value[key]]),
  );
}

function sanitizeLinearHealthResult(value, teamKeys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.ok !== "boolean" ||
    value.provider !== "linear" ||
    value.access !== "read_only"
  ) {
    return {
      ok: false,
      provider: "linear",
      live_check: "failed",
      access: "read_only",
      configured_team_keys: teamKeys,
      error: "Linear read-only helper returned an invalid result",
    };
  }
  const rateLimit = sanitizedLinearRateLimit(value.rate_limit);
  if (!value.ok) {
    return {
      ok: false,
      provider: "linear",
      live_check: "failed",
      access: "read_only",
      configured_team_keys: teamKeys,
      ...(Number.isInteger(value.status) &&
      value.status >= 100 &&
      value.status <= 599
        ? { status: value.status }
        : {}),
      error: LINEAR_HEALTH_ERRORS.has(value.error)
        ? value.error
        : "Linear read-only helper reported a bounded provider failure",
      rate_limit: rateLimit,
    };
  }
  const visibleConfiguredTeamKeys = Array.isArray(
    value.visible_configured_team_keys,
  )
    ? teamKeys.filter((key) =>
        value.visible_configured_team_keys.includes(key),
      )
    : [];
  const missingTeamKeys = teamKeys.filter(
    (key) => !visibleConfiguredTeamKeys.includes(key),
  );
  const validSuccess =
    value.live_check === "graphql-query" &&
    value.adapter_surface_read_only === true &&
    value.credential_scope_verified === false &&
    value.viewer_authenticated === true &&
    missingTeamKeys.length === 0 &&
    Number.isInteger(value.visible_team_count) &&
    value.visible_team_count >= visibleConfiguredTeamKeys.length &&
    value.visible_team_count <= 500 &&
    Number.isInteger(value.pages_read) &&
    value.pages_read >= 1 &&
    value.pages_read <= 10;
  if (!validSuccess) {
    return {
      ok: false,
      provider: "linear",
      live_check: "failed",
      access: "read_only",
      configured_team_keys: teamKeys,
      error: "Linear read-only helper returned an invalid result",
    };
  }
  return {
    ok: true,
    provider: "linear",
    live_check: "graphql-query",
    access: "read_only",
    adapter_surface_read_only: true,
    credential_scope_verified: false,
    viewer_authenticated: true,
    configured_team_keys: teamKeys,
    visible_configured_team_keys: visibleConfiguredTeamKeys,
    missing_team_keys: [],
    visible_team_count: value.visible_team_count,
    pages_read: value.pages_read,
    rate_limit: rateLimit,
  };
}

function linearLookup(target, args, operation) {
  const parsed = parseProviderJson(
    runLinearReadonly(target, args),
    `Linear ${operation} lookup`,
  );
  if (
    !parsed.ok ||
    !parsed.value ||
    typeof parsed.value !== "object" ||
    Array.isArray(parsed.value) ||
    parsed.value.provider !== "linear" ||
    parsed.value.operation !== operation ||
    typeof parsed.value.ok !== "boolean"
  ) {
    return {
      ok: false,
      provider: "linear",
      operation,
      error: `Linear ${operation} lookup failed`,
    };
  }
  const value = parsed.value;
  if (!value.ok) {
    return {
      ok: false,
      provider: "linear",
      operation,
      error: `Linear ${operation} lookup failed`,
    };
  }
  if (
    operation === "resolve-team" &&
    typeof value.team_key === "string" &&
    /^[A-Z][A-Z0-9]{0,9}$/.test(value.team_key) &&
    typeof value.provider_id === "string" &&
    PROVIDER_UUID.test(value.provider_id)
  ) {
    return {
      ok: true,
      provider: "linear",
      operation,
      team_key: value.team_key,
      provider_id: value.provider_id,
    };
  }
  if (
    operation === "resolve-issue" &&
    typeof value.found === "boolean" &&
    typeof value.provider_id === "string" &&
    PROVIDER_UUID.test(value.provider_id)
  ) {
    if (!value.found) {
      return {
        ok: true,
        provider: "linear",
        operation,
        found: false,
        provider_id: value.provider_id,
      };
    }
    if (
      typeof value.provider_identifier === "string" &&
      /^[A-Z][A-Z0-9]{0,9}-\d{1,10}$/.test(value.provider_identifier) &&
      typeof value.team_key === "string" &&
      /^[A-Z][A-Z0-9]{0,9}$/.test(value.team_key)
    ) {
      return {
        ok: true,
        provider: "linear",
        operation,
        found: true,
        provider_id: value.provider_id,
        provider_identifier: value.provider_identifier,
        team_key: value.team_key,
      };
    }
  }
  if (
    operation === "resolve-comment" &&
    typeof value.found === "boolean" &&
    typeof value.provider_id === "string" &&
    PROVIDER_UUID.test(value.provider_id)
  ) {
    if (!value.found) {
      return {
        ok: true,
        provider: "linear",
        operation,
        found: false,
        provider_id: value.provider_id,
      };
    }
    if (
      typeof value.issue_id === "string" &&
      PROVIDER_UUID.test(value.issue_id)
    ) {
      return {
        ok: true,
        provider: "linear",
        operation,
        found: true,
        provider_id: value.provider_id,
        issue_id: value.issue_id,
      };
    }
  }
  return {
    ok: false,
    provider: "linear",
    operation,
    error: `Linear ${operation} lookup returned an invalid result`,
  };
}

function linearMutation(target, command, input) {
  const parsed = parseProviderJson(
    runLinearWrite(target, command, input),
    `Linear ${command}`,
  );
  if (
    !parsed.ok ||
    !parsed.value ||
    typeof parsed.value !== "object" ||
    Array.isArray(parsed.value) ||
    parsed.value.provider !== "linear" ||
    parsed.value.operation !== command ||
    typeof parsed.value.ok !== "boolean"
  ) {
    return {
      ok: false,
      provider: "linear",
      operation: command,
      error: `Linear ${command} failed`,
    };
  }
  const value = parsed.value;
  if (!value.ok || !PROVIDER_UUID.test(value.provider_id)) {
    return {
      ok: false,
      provider: "linear",
      operation: command,
      error: `Linear ${command} failed`,
    };
  }
  if (
    command === "issue-create" &&
    (typeof value.provider_identifier !== "string" ||
      !/^[A-Z][A-Z0-9]{0,9}-\d{1,10}$/.test(value.provider_identifier))
  ) {
    return {
      ok: false,
      provider: "linear",
      operation: command,
      error: "Linear issue-create returned an invalid result",
    };
  }
  return {
    ok: true,
    provider: "linear",
    operation: command,
    provider_id: value.provider_id,
    ...(command === "issue-create"
      ? { provider_identifier: value.provider_identifier }
      : {}),
  };
}

function commandLinearHealth(target, suppliedConfig = undefined) {
  const config = suppliedConfig ?? loadConfig(target);
  const work =
    config.capabilities.work &&
    typeof config.capabilities.work === "object" &&
    !Array.isArray(config.capabilities.work)
      ? config.capabilities.work
      : {};
  if (work.provider !== "linear") {
    return {
      ok: true,
      provider: "repository",
      live_check: "repository",
      access: "repository_only",
      fallback: true,
    };
  }
  const configErrors = validateConfig(config, target);
  if (
    configErrors.length > 0 ||
    config.safety?.approved_configuration_hash !== configurationHash(config)
  ) {
    return {
      ok: false,
      provider: "linear",
      live_check: "not-run",
      access: "read_only",
      fallback: "repository",
      error:
        configErrors.length > 0
          ? "Linear connection configuration is invalid"
          : "Linear connection configuration is not approved",
    };
  }
  const teamKeys = Array.isArray(work.connection?.team_keys)
    ? work.connection.team_keys
    : [];
  if (
    work.connection?.credential_env !== LINEAR_CREDENTIAL_ENV ||
    teamKeys.length === 0
  ) {
    return {
      ok: false,
      provider: "linear",
      live_check: "not-run",
      access: "read_only",
      fallback: "repository",
      error: "Linear connection configuration is invalid",
    };
  }
  const protectedFileIssue = protectedProjectFileIssue(
    target,
    LINEAR_READONLY_PATH,
  );
  if (protectedFileIssue) {
    return {
      ok: false,
      provider: "linear",
      live_check: "not-run",
      access: "read_only",
      configured_team_keys: teamKeys,
      fallback: "repository",
      error: protectedFileIssue,
    };
  }
  if (
    typeof process.env[LINEAR_CREDENTIAL_ENV] !== "string" ||
    process.env[LINEAR_CREDENTIAL_ENV].length === 0
  ) {
    return {
      ok: false,
      provider: "linear",
      live_check: "not-run",
      access: "read_only",
      configured_team_keys: teamKeys,
      credential_environment: LINEAR_CREDENTIAL_ENV,
      fallback: "repository",
      error: `${LINEAR_CREDENTIAL_ENV} is not available to this process`,
    };
  }
  const parsed = parseProviderJson(
    runLinearReadonly(
      target,
      ["health", ...teamKeys.flatMap((key) => ["--team", key])],
    ),
    "Linear read-only health check",
  );
  if (!parsed.ok) {
    return {
      ok: false,
      provider: "linear",
      live_check: "failed",
      access: "read_only",
      configured_team_keys: teamKeys,
      credential_environment: LINEAR_CREDENTIAL_ENV,
      fallback: "repository",
      error: parsed.error,
    };
  }
  const sanitized = sanitizeLinearHealthResult(parsed.value, teamKeys);
  return {
    ...sanitized,
    credential_environment: LINEAR_CREDENTIAL_ENV,
    fallback: "repository",
  };
}

function linearWriteReadiness(target, config) {
  const work =
    config.capabilities.work &&
    typeof config.capabilities.work === "object" &&
    !Array.isArray(config.capabilities.work)
      ? config.capabilities.work
      : {};
  const operations = Array.isArray(work.connection?.writes?.operations)
    ? work.connection.writes.operations
    : [];
  if (work.provider !== "linear" || operations.length === 0) {
    return {
      ok: true,
      enabled_operations: [],
      checks: [],
      live_mutation: "not-run",
    };
  }
  const protectedIssue = protectedProjectFileIssue(target, LINEAR_WRITE_PATH);
  const checks = operations.map((operation) => {
    const environment = linearOperationCredentialEnv(operation);
    return {
      operation,
      credential_environment: environment,
      available:
        typeof process.env[environment] === "string" &&
        process.env[environment].length > 0,
    };
  });
  return {
    ok: protectedIssue === null && checks.every((check) => check.available),
    enabled_operations: operations,
    protected_helper: protectedIssue ?? "intact",
    checks,
    live_mutation: "not-run",
    detail:
      "Readiness checks credentials and protected code only; doctor never performs a provider write.",
  };
}

function commandLinearSetup(target) {
  const config = loadConfig(target);
  const errors = validateConfig(config, target);
  if (
    errors.length > 0 ||
    config.safety?.approved_configuration_hash !== configurationHash(config)
  ) {
    throw new StackError(
      "Cannot guide Linear setup until the project configuration is valid and approved.",
      2,
      errors,
    );
  }
  const work = config.capabilities.work;
  if (work.provider !== "linear") {
    throw new StackError(
      "Linear is not approved for this project. Complete the plain-language work-tracking decision and configure linear first.",
    );
  }
  const approvedWrites = work.connection.writes?.operations ?? [];
  const writeCredentialSteps = [
    ...(approvedWrites.includes("issue_create")
      ? [
          {
            id: "create-issue-create-key",
            status:
              typeof process.env[LINEAR_CREATE_CREDENTIAL_ENV] === "string" &&
              process.env[LINEAR_CREATE_CREDENTIAL_ENV].length > 0
                ? "available"
                : "human-action-required",
            credential_environment: LINEAR_CREATE_CREDENTIAL_ENV,
            instruction:
              "Create a separate team-restricted personal API key with only Create issues permission.",
          },
        ]
      : []),
    ...(approvedWrites.includes("evidence_comment")
      ? [
          {
            id: "create-comment-key",
            status:
              typeof process.env[LINEAR_COMMENT_CREDENTIAL_ENV] === "string" &&
              process.env[LINEAR_COMMENT_CREDENTIAL_ENV].length > 0
                ? "available"
                : "human-action-required",
            credential_environment: LINEAR_COMMENT_CREDENTIAL_ENV,
            instruction:
              "Create a separate team-restricted personal API key with only Create comments permission.",
          },
        ]
      : []),
  ];
  return {
    ok: true,
    provider: "linear",
    mode:
      approvedWrites.length === 0
        ? "guided-read-only"
        : "guided-read-only-with-receipted-writes",
    configured_team_keys: work.connection.team_keys,
    repository_fallback: true,
    steps: [
      {
        id: "create-read-only-key",
        status: "human-action-required",
        url: "https://linear.app/settings/security",
        instruction:
          "Create a personal API key with only the Read permission. Never grant write or admin permission for this adapter.",
      },
      {
        id: "provide-process-environment",
        status:
          typeof process.env[LINEAR_CREDENTIAL_ENV] === "string" &&
          process.env[LINEAR_CREDENTIAL_ENV].length > 0
            ? "available"
            : "human-action-required",
        credential_environment: LINEAR_CREDENTIAL_ENV,
        instruction:
          "Store the key in your shell or coding-harness secret environment, never in the repository, config, checkpoint, or evidence.",
      },
      {
        id: "optional-harness-connection",
        status: "optional",
        endpoint: "https://mcp.linear.app/mcp/readonly",
        instruction:
          "If the coding harness supports remote MCP, connect Linear's official read-only endpoint. Keep this project configuration read-only even if another connection exists.",
      },
      ...writeCredentialSteps,
      {
        id: "verify",
        status: "required",
        argv: [
          "node",
          PROJECT_CLI_PATH,
          "linear-health",
          "--target",
          ".",
        ],
      },
    ],
    guardrails: {
      exposed_remote_operations: ["GraphQL query"],
      exposed_remote_mutations: approvedWrites,
      credential_scope:
        approvedWrites.length === 0
          ? "The CLI proves its own surface is query-only; the user must create the upstream key with Linear's Read permission."
          : "Read, issue-create, and comment credentials remain separate; each must be team-restricted to only its named permission.",
    },
  };
}

function telemetryScopeSummary(provider) {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    return null;
  }
  if (provider.provider === "posthog") {
    return { project_id: provider.scope?.project_id ?? null };
  }
  if (provider.provider === "sentry") {
    return {
      organization: provider.scope?.organization ?? null,
      project: provider.scope?.project ?? null,
    };
  }
  if (provider.provider === "new-relic") {
    return { account_id: provider.scope?.account_id ?? null };
  }
  return null;
}

function sanitizeTelemetryHealthResult(value, provider) {
  const base = {
    provider: provider.provider,
    role: provider.role,
    region: provider.region,
    access: "read_only",
    credential_environment: provider.credential_env,
    configured_scope: telemetryScopeSummary(provider),
    fallback: "repository evidence",
  };
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.ok !== true ||
    value.provider !== provider.provider ||
    value.role !== provider.role ||
    value.region !== provider.region ||
    value.access !== "read_only" ||
    value.adapter_surface_read_only !== true ||
    value.credential_scope_verified !== false ||
    value.scope_verified !== true ||
    value.raw_payload_retained !== false
  ) {
    return {
      ok: false,
      ...base,
      live_check: "failed",
      error: "telemetry read-only helper returned an invalid result",
    };
  }
  if (
    provider.provider === "posthog" &&
    (value.project_id !== provider.scope.project_id ||
      !Number.isInteger(value.saved_insight_count) ||
      value.saved_insight_count < 0 ||
      value.saved_insight_count > Number.MAX_SAFE_INTEGER ||
      value.live_check !== "project-insight-metadata")
  ) {
    return {
      ok: false,
      ...base,
      live_check: "failed",
      error: "PostHog health result did not match the approved project",
    };
  }
  if (
    provider.provider === "sentry" &&
    (value.organization !== provider.scope.organization ||
      value.project !== provider.scope.project ||
      value.live_check !== "project-identity" ||
      typeof value.project_status !== "string" ||
      !TELEMETRY_IDENTIFIER.test(value.project_status))
  ) {
    return {
      ok: false,
      ...base,
      live_check: "failed",
      error: "Sentry health result did not match the approved project",
    };
  }
  if (
    provider.provider === "new-relic" &&
    (value.account_id !== provider.scope.account_id ||
      value.live_check !== "account-identity")
  ) {
    return {
      ok: false,
      ...base,
      live_check: "failed",
      error: "New Relic health result did not match the approved account",
    };
  }
  return {
    ok: true,
    ...base,
    live_check: value.live_check,
    adapter_surface_read_only: true,
    credential_scope_verified: false,
    scope_verified: true,
    raw_payload_retained: false,
    ...(provider.provider === "posthog"
      ? { saved_insight_count: value.saved_insight_count }
      : {}),
    ...(provider.provider === "sentry"
      ? { project_status: value.project_status }
      : {}),
  };
}

function commandTelemetryHealth(
  target,
  suppliedConfig = undefined,
  {
    now = Date.now,
    runTelemetry = runTelemetryReadonly,
    providerTimeout = TELEMETRY_PROVIDER_TIMEOUT_MS,
    totalTimeout = TELEMETRY_TOTAL_TIMEOUT_MS,
  } = {},
) {
  const config = suppliedConfig ?? loadConfig(target);
  const telemetry =
    config.capabilities?.telemetry &&
    typeof config.capabilities.telemetry === "object" &&
    !Array.isArray(config.capabilities.telemetry)
      ? config.capabilities.telemetry
      : {};
  const providers = Array.isArray(telemetry.providers)
    ? telemetry.providers
    : [];
  if (providers.length === 0) {
    return {
      ok: true,
      providers: [],
      live_check: "not-configured",
      fallback: "repository evidence",
    };
  }
  const configErrors = validateConfig(config, target);
  const configurationApproved =
    config.safety?.approved_configuration_hash === configurationHash(config);
  if (configErrors.length > 0 || !configurationApproved) {
    return {
      ok: false,
      providers: providers.map((provider) => ({
        provider: provider?.provider ?? "invalid",
        live_check: "not-run",
        error:
          configErrors.length > 0
            ? "telemetry connection configuration is invalid"
            : "telemetry connection configuration is not approved",
      })),
      fallback: "repository evidence",
    };
  }
  const protectedFileIssue = protectedProjectFileIssue(
    target,
    TELEMETRY_READONLY_PATH,
  );
  const deadline = now() + totalTimeout;
  const results = providers.map((provider) => {
    const base = {
      provider: provider.provider,
      role: provider.role,
      region: provider.region,
      access: "read_only",
      credential_environment: provider.credential_env,
      configured_scope: telemetryScopeSummary(provider),
      fallback: "repository evidence",
    };
    if (protectedFileIssue) {
      return {
        ok: false,
        ...base,
        live_check: "not-run",
        error: protectedFileIssue,
      };
    }
    if (
      typeof process.env[provider.credential_env] !== "string" ||
      process.env[provider.credential_env].length === 0
    ) {
      return {
        ok: false,
        ...base,
        live_check: "not-run",
        error: `${provider.credential_env} is not available to this process`,
      };
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      return {
        ok: false,
        ...base,
        live_check: "not-run",
        error:
          "telemetry health aggregate time budget was exhausted",
      };
    }
    const parsed = parseTelemetryProviderJson(
      runTelemetry(
        target,
        provider,
        Math.max(1, Math.min(providerTimeout, remaining)),
      ),
      `${provider.provider} read-only health check`,
    );
    if (!parsed.ok) {
      return {
        ok: false,
        ...base,
        live_check: "failed",
        error: parsed.error,
      };
    }
    return sanitizeTelemetryHealthResult(parsed.value, provider);
  });
  return {
    ok: results.every((result) => result.ok),
    providers: results,
    live_check: "provider-identity",
    fallback: "repository evidence",
  };
}

function commandTelemetrySetup(target) {
  const config = loadConfig(target);
  const errors = validateConfig(config, target);
  if (
    errors.length > 0 ||
    config.safety?.approved_configuration_hash !== configurationHash(config)
  ) {
    throw new StackError(
      "Cannot guide telemetry setup until the project configuration is valid and approved.",
      2,
      errors,
    );
  }
  const providers = config.capabilities.telemetry.providers;
  if (providers.length === 0) {
    throw new StackError(
      "No telemetry provider is approved for this project. Complete the plain-language telemetry decision and configure an existing provider first.",
    );
  }
  const providerInstructions = {
    posthog: {
      url: (provider) =>
        `https://${provider.region}.posthog.com/settings/user-api-keys`,
      permission:
        "Create a personal API key limited to insight:read. Do not grant feature-flag, survey, replay, data-management, or write scopes.",
    },
    sentry: {
      url: () => "https://sentry.io/settings/account/api/auth-tokens/",
      permission:
        "Create an authentication token with project:read only and verify that it can access only the intended organization and project.",
    },
    "new-relic": {
      url: () => "https://one.newrelic.com/api-keys",
      permission:
        "Create a user key for a user whose role has only the account access this project needs. New Relic user keys are not intrinsically read-only; the protected adapter exposes one fixed account query and no mutation or arbitrary NRQL.",
    },
  };
  return {
    ok: true,
    mode: "guided-read-only",
    providers: providers.map((provider) => ({
      provider: provider.provider,
      role: provider.role,
      region: provider.region,
      scope: telemetryScopeSummary(provider),
      credential_environment: provider.credential_env,
      steps: [
        {
          id: "create-scoped-credential",
          status: "human-action-required",
          url: providerInstructions[provider.provider].url(provider),
          instruction:
            providerInstructions[provider.provider].permission,
        },
        {
          id: "provide-process-environment",
          status:
            typeof process.env[provider.credential_env] === "string" &&
            process.env[provider.credential_env].length > 0
              ? "available"
              : "human-action-required",
          credential_environment: provider.credential_env,
          instruction:
            "Store the credential in the shell or coding-harness secret environment, never in the repository, config, checkpoint, report, receipt, or evidence graph.",
        },
      ],
    })),
    verify: {
      status: "required",
      argv: [
        "node",
        PROJECT_CLI_PATH,
        "telemetry-health",
        "--target",
        ".",
      ],
    },
    guardrails: {
      remote_surface:
        "PostHog basic insight metadata, Sentry project identity, and New Relic account identity only",
      arbitrary_queries: false,
      mutations: false,
      raw_payload_storage: false,
      credential_scope_verified:
        "The CLI proves its own fixed read-only surface and project/account identity. It cannot prove that an upstream credential lacks unrelated permissions.",
      fallback: "repository evidence",
    },
  };
}

function providerReceipt({
  provider,
  operation,
  workItemId,
  providerReference,
  before,
  after,
  authoritySource,
  idempotencyKey,
  revision,
  result,
}) {
  const performedAt = utcTimestamp();
  return {
    schema_version: 1,
    receipt_id: sha256(
      stableJson({
        provider,
        operation,
        work_item_id: workItemId,
        idempotency_key: idempotencyKey,
        performed_at: performedAt,
        nonce: randomBytes(16).toString("hex"),
      }),
    ),
    provider,
    operation,
    work_item_id: workItemId,
    provider_reference: providerReference,
    before,
    after,
    authority_source: authoritySource,
    idempotency_key: idempotencyKey,
    revision,
    performed_at: performedAt,
    result,
  };
}

function validatedLinearWriteContext(target, operation, options) {
  if (options.confirmExternalWrite !== true) {
    throw new StackError(
      "Linear writes require --confirm-external-write after the human approves the exact operation.",
      3,
    );
  }
  const authoritySource = validateCheckpointText(
    options.authoritySource,
    "Linear write authority source",
    { required: true },
  );
  if (authoritySource.length < 12) {
    throw new StackError(
      "Linear write authority source must identify the approval or policy in at least 12 characters.",
      3,
    );
  }
  const config = loadConfig(target);
  const configErrors = validateConfig(config, target);
  if (
    configErrors.length > 0 ||
    config.safety?.approved_configuration_hash !== configurationHash(config)
  ) {
    throw new StackError(
      "Linear writes require valid, currently approved project configuration.",
      3,
      configErrors,
    );
  }
  const work = config.capabilities.work;
  const writes = work.connection?.writes;
  if (
    work.provider !== "linear" ||
    !writes ||
    !Array.isArray(writes.operations) ||
    !writes.operations.includes(operation)
  ) {
    throw new StackError(
      `Linear operation ${operation} is not approved in project configuration.`,
      3,
    );
  }
  requireCoordinator(target, options.coordinatorToken);
  const readonlyIssue = protectedProjectFileIssue(
    target,
    LINEAR_READONLY_PATH,
  );
  const writeIssue = protectedProjectFileIssue(target, LINEAR_WRITE_PATH);
  if (readonlyIssue || writeIssue) {
    throw new StackError(
      "Refusing Linear write because a protected provider helper is not intact.",
      3,
      [readonlyIssue, writeIssue].filter(Boolean),
    );
  }
  const contracts = loadValidatedWorkEvidence(target);
  if (!contracts.ok) {
    throw new StackError(
      "Refusing Linear write until repository work and evidence validate.",
      3,
      [
        ...contracts.ledger.errors,
        ...contracts.graph.errors,
        ...contracts.linkageErrors,
      ],
    );
  }
  const ledger = contracts.ledger.value;
  const graph = contracts.graph.value;
  const item = ledger.items.find(
    (candidate) => candidate.id === options.workItemId,
  );
  if (!item) {
    throw new StackError(
      `Repository work item not found: ${options.workItemId ?? "missing"}`,
      3,
    );
  }
  const git = gitSnapshot(target);
  return {
    authoritySource,
    config,
    work,
    writes,
    ledger,
    graph,
    item,
    revision: git.head && GIT_OBJECT_ID.test(git.head) ? git.head : null,
  };
}

function linearIssueDescription(item) {
  const lines = [
    `Repository work item: ${item.id}`,
    "",
    "## Objective",
    "",
    item.objective,
    "",
    "## Acceptance criteria",
    "",
    ...item.acceptance_criteria.map((criterion) => `- ${criterion}`),
    "",
    "## Included paths",
    "",
    ...item.scope.paths.map((path) => `- \`${path}\``),
    "",
    "## Out of scope",
    "",
    ...(item.scope.out_of_scope.length > 0
      ? item.scope.out_of_scope.map((path) => `- \`${path}\``)
      : ["- None recorded."]),
    "",
    "Managed through the Ultimate Agent Stack provider-neutral work contract.",
  ];
  const description = lines.join("\n");
  if (description.length > 12_000) {
    throw new StackError(
      "The repository work item is too large for the bounded Linear issue adapter. Split it into smaller work.",
      3,
    );
  }
  return description;
}

function linearEvidenceComment(item, graph, revision) {
  if (
    !["in_review", "done"].includes(item.status) ||
    item.evidence_refs.length === 0
  ) {
    throw new StackError(
      "Evidence comments require an in_review or done work item with linked evidence.",
      3,
    );
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const lines = [
    `Repository evidence update for \`${item.id}\``,
    "",
    `Canonical status: \`${item.status}\``,
    `Repository revision: \`${revision ?? "uncommitted"}\``,
    "",
    "Evidence references:",
    "",
    ...item.evidence_refs.flatMap((reference) => {
      const node = nodes.get(reference);
      return [
        `- **${node.label}** — ${node.kind}, ${node.state}`,
        `  - ${node.source.provider}: \`${node.source.reference}\``,
        ...(node.summary ? [`  - ${node.summary}`] : []),
      ];
    }),
    "",
    "Linear status is advisory. Repository evidence remains authoritative.",
  ];
  const body = lines.join("\n");
  if (body.length > 8_000) {
    throw new StackError(
      "The evidence summary exceeds the bounded Linear comment limit. Reduce or split the work evidence.",
      3,
    );
  }
  return body;
}

function addLinearIssueReference(target, ledger, item, issueId) {
  const existing = item.external_refs.filter(
    (reference) => reference.provider === "linear",
  );
  if (
    existing.some((reference) => reference.reference !== issueId) ||
    existing.length > 1
  ) {
    throw new StackError(
      "The work item has a conflicting Linear reference. Resolve it before synchronizing.",
      3,
    );
  }
  if (existing.length === 0) {
    item.external_refs.push({
      provider: "linear",
      reference: issueId,
    });
    const now = utcTimestamp();
    item.updated_at = now;
    ledger.updated_at = now;
    const errors = validateWorkLedger(ledger);
    if (errors.length > 0) {
      throw new StackError(
        "Refusing to record an invalid Linear issue reference.",
        3,
        errors,
      );
    }
    atomicProjectJson(target, WORK_LEDGER_PATH, ledger, "work ledger");
  }
}

function commandLinearIssueCreate(
  target,
  options,
  provider = { lookup: linearLookup, mutate: linearMutation },
) {
  const context = validatedLinearWriteContext(
    target,
    "issue_create",
    options,
  );
  if (["done", "cancelled"].includes(context.item.status)) {
    throw new StackError(
      "Do not create a new Linear issue for done or cancelled repository work.",
      3,
    );
  }
  const teamKey = String(options.teamKey ?? "").trim().toUpperCase();
  if (!context.work.connection.team_keys.includes(teamKey)) {
    throw new StackError(
      "Linear issue creation requires one configured --team key.",
      3,
    );
  }
  const digest = sha256(
    `${context.work.linear_idempotency_namespace}\0issue_create\0${context.item.id}`,
  );
  const idempotencyKey = `sha256:${digest}`;
  const issueId = deterministicUuid(digest);
  const existingReference = context.item.external_refs.filter(
    (reference) => reference.provider === "linear",
  );
  if (
    existingReference.some((reference) => reference.reference !== issueId) ||
    existingReference.length > 1
  ) {
    const receipt = providerReceipt({
      provider: "linear",
      operation: "issue_create",
      workItemId: context.item.id,
      providerReference: issueId,
      before: "conflicting repository reference",
      after: null,
      authoritySource: context.authoritySource,
      idempotencyKey,
      revision: context.revision,
      result: "decision-needed",
    });
    const receiptPath = writeProviderReceipt(target, receipt);
    return {
      ok: false,
      provider: "linear",
      operation: "issue_create",
      result: "decision-needed",
      receipt: receiptPath,
      error:
        "The work item already has a different Linear reference. No remote write was attempted.",
    };
  }
  const team = provider.lookup(
    target,
    ["resolve-team", "--team", teamKey],
    "resolve-team",
  );
  if (!team.ok || team.team_key !== teamKey) {
    const receipt = providerReceipt({
      provider: "linear",
      operation: "issue_create",
      workItemId: context.item.id,
      providerReference: issueId,
      before: "team lookup failed",
      after: null,
      authoritySource: context.authoritySource,
      idempotencyKey,
      revision: context.revision,
      result: "failed",
    });
    return {
      ok: false,
      provider: "linear",
      operation: "issue_create",
      result: "failed",
      receipt: writeProviderReceipt(target, receipt),
      error: "Configured Linear team could not be verified. No write occurred.",
    };
  }
  let issue = provider.lookup(
    target,
    ["resolve-issue", "--id", issueId],
    "resolve-issue",
  );
  let result = "not-needed";
  let before = "existing provider issue";
  if (!issue.ok) {
    const receipt = providerReceipt({
      provider: "linear",
      operation: "issue_create",
      workItemId: context.item.id,
      providerReference: issueId,
      before: "issue lookup failed",
      after: null,
      authoritySource: context.authoritySource,
      idempotencyKey,
      revision: context.revision,
      result: "failed",
    });
    return {
      ok: false,
      provider: "linear",
      operation: "issue_create",
      result: "failed",
      receipt: writeProviderReceipt(target, receipt),
      error: "Linear issue preflight failed. No write occurred.",
    };
  }
  if (!issue.found) {
    before = "provider issue not found";
    const mutation = provider.mutate(target, "issue-create", {
      issue_id: issueId,
      team_id: team.provider_id,
      title: context.item.title,
      description: linearIssueDescription(context.item),
    });
    if (mutation.ok) {
      issue = {
        ok: true,
        found: true,
        provider_id: mutation.provider_id,
        provider_identifier: mutation.provider_identifier,
        team_key: teamKey,
      };
      result = "succeeded";
    } else {
      issue = provider.lookup(
        target,
        ["resolve-issue", "--id", issueId],
        "resolve-issue",
      );
      if (!issue.ok || !issue.found) {
        const receipt = providerReceipt({
          provider: "linear",
          operation: "issue_create",
          workItemId: context.item.id,
          providerReference: issueId,
          before,
          after: "write failed or outcome is unknown",
          authoritySource: context.authoritySource,
          idempotencyKey,
          revision: context.revision,
          result: "failed",
        });
        return {
          ok: false,
          provider: "linear",
          operation: "issue_create",
          result: "failed",
          receipt: writeProviderReceipt(target, receipt),
          error:
            "Linear issue creation failed and reconciliation found no issue.",
        };
      }
      result = "succeeded";
    }
  }
  if (issue.team_key !== teamKey || issue.provider_id !== issueId) {
    const receipt = providerReceipt({
      provider: "linear",
      operation: "issue_create",
      workItemId: context.item.id,
      providerReference: issueId,
      before,
      after: "provider identity mismatch",
      authoritySource: context.authoritySource,
      idempotencyKey,
      revision: context.revision,
      result: "decision-needed",
    });
    return {
      ok: false,
      provider: "linear",
      operation: "issue_create",
      result: "decision-needed",
      receipt: writeProviderReceipt(target, receipt),
      error: "The resolved Linear issue does not match the approved team and id.",
    };
  }
  const receipt = providerReceipt({
    provider: "linear",
    operation: "issue_create",
    workItemId: context.item.id,
    providerReference: issueId,
    before,
    after: `linked ${issue.provider_identifier}`,
    authoritySource: context.authoritySource,
    idempotencyKey,
    revision: context.revision,
    result,
  });
  const receiptPath = writeProviderReceipt(target, receipt);
  addLinearIssueReference(
    target,
    context.ledger,
    context.item,
    issueId,
  );
  return {
    ok: true,
    provider: "linear",
    operation: "issue_create",
    result,
    provider_reference: issueId,
    provider_identifier: issue.provider_identifier,
    receipt: receiptPath,
  };
}

function commandLinearEvidenceComment(
  target,
  options,
  provider = { lookup: linearLookup, mutate: linearMutation },
) {
  const context = validatedLinearWriteContext(
    target,
    "evidence_comment",
    options,
  );
  const issueDigest = sha256(
    `${context.work.linear_idempotency_namespace}\0issue_create\0${context.item.id}`,
  );
  const issueId = deterministicUuid(issueDigest);
  if (
    !context.item.external_refs.some(
      (reference) =>
        reference.provider === "linear" && reference.reference === issueId,
    )
  ) {
    throw new StackError(
      "Evidence comments require the work item's receipted Linear issue link.",
      3,
    );
  }
  const body = linearEvidenceComment(
    context.item,
    context.graph,
    context.revision,
  );
  const evidenceSnapshot = sha256(
    stableJson({
      work_item_id: context.item.id,
      status: context.item.status,
      evidence_refs: context.item.evidence_refs,
      body,
    }),
  );
  const digest = sha256(
    `${context.work.linear_idempotency_namespace}\0evidence_comment\0${context.item.id}\0${evidenceSnapshot}`,
  );
  const idempotencyKey = `sha256:${digest}`;
  const commentId = deterministicUuid(digest);
  const issue = provider.lookup(
    target,
    ["resolve-issue", "--id", issueId],
    "resolve-issue",
  );
  if (
    !issue.ok ||
    !issue.found ||
    !context.work.connection.team_keys.includes(issue.team_key)
  ) {
    const receipt = providerReceipt({
      provider: "linear",
      operation: "evidence_comment",
      workItemId: context.item.id,
      providerReference: commentId,
      before: "linked issue lookup failed",
      after: null,
      authoritySource: context.authoritySource,
      idempotencyKey,
      revision: context.revision,
      result: "failed",
    });
    return {
      ok: false,
      provider: "linear",
      operation: "evidence_comment",
      result: "failed",
      receipt: writeProviderReceipt(target, receipt),
      error:
        "The linked Linear issue could not be verified in an approved team. No write occurred.",
    };
  }
  let comment = provider.lookup(
    target,
    ["resolve-comment", "--id", commentId],
    "resolve-comment",
  );
  if (!comment.ok) {
    const receipt = providerReceipt({
      provider: "linear",
      operation: "evidence_comment",
      workItemId: context.item.id,
      providerReference: commentId,
      before: "comment lookup failed",
      after: null,
      authoritySource: context.authoritySource,
      idempotencyKey,
      revision: context.revision,
      result: "failed",
    });
    return {
      ok: false,
      provider: "linear",
      operation: "evidence_comment",
      result: "failed",
      receipt: writeProviderReceipt(target, receipt),
      error: "Linear comment preflight failed. No write occurred.",
    };
  }
  let result = "not-needed";
  let before = "existing provider comment";
  if (!comment.found) {
    before = "provider comment not found";
    const mutation = provider.mutate(target, "evidence-comment", {
      comment_id: commentId,
      issue_id: issueId,
      body,
    });
    if (mutation.ok) {
      comment = {
        ok: true,
        found: true,
        provider_id: mutation.provider_id,
        issue_id: issueId,
      };
      result = "succeeded";
    } else {
      comment = provider.lookup(
        target,
        ["resolve-comment", "--id", commentId],
        "resolve-comment",
      );
      if (!comment.ok || !comment.found) {
        const receipt = providerReceipt({
          provider: "linear",
          operation: "evidence_comment",
          workItemId: context.item.id,
          providerReference: commentId,
          before,
          after: "write failed or outcome is unknown",
          authoritySource: context.authoritySource,
          idempotencyKey,
          revision: context.revision,
          result: "failed",
        });
        return {
          ok: false,
          provider: "linear",
          operation: "evidence_comment",
          result: "failed",
          receipt: writeProviderReceipt(target, receipt),
          error:
            "Linear evidence comment failed and reconciliation found no comment.",
        };
      }
      result = "succeeded";
    }
  }
  if (comment.issue_id !== issueId || comment.provider_id !== commentId) {
    const receipt = providerReceipt({
      provider: "linear",
      operation: "evidence_comment",
      workItemId: context.item.id,
      providerReference: commentId,
      before,
      after: "provider identity mismatch",
      authoritySource: context.authoritySource,
      idempotencyKey,
      revision: context.revision,
      result: "decision-needed",
    });
    return {
      ok: false,
      provider: "linear",
      operation: "evidence_comment",
      result: "decision-needed",
      receipt: writeProviderReceipt(target, receipt),
      error: "The resolved Linear comment does not match the linked issue.",
    };
  }
  const receipt = providerReceipt({
    provider: "linear",
    operation: "evidence_comment",
    workItemId: context.item.id,
    providerReference: commentId,
    before,
    after: "evidence comment present",
    authoritySource: context.authoritySource,
    idempotencyKey,
    revision: context.revision,
    result,
  });
  return {
    ok: true,
    provider: "linear",
    operation: "evidence_comment",
    result,
    provider_reference: commentId,
    issue_reference: issueId,
    receipt: writeProviderReceipt(target, receipt),
  };
}

function pathContainedBy(root, candidate) {
  const relation = relative(resolve(root), resolve(candidate));
  return (
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

function commandMemoryHealth(target, suppliedConfig = undefined) {
  const config = suppliedConfig ?? loadConfig(target);
  const knowledge = config.capabilities.knowledge;
  if (knowledge.provider === "repository") {
    const checkpointPresent = projectExists(
      target,
      CHECKPOINT_PATH,
      "project checkpoint",
    );
    return {
      ok: true,
      provider: "repository",
      live_check: "repository",
      scope: "project",
      scope_verified: true,
      checkpoint: checkpointPresent ? CHECKPOINT_PATH : null,
      fallback: true,
    };
  }
  if (knowledge.scope !== "project") {
    return {
      ok: false,
      provider: "gbrain",
      live_check: "not-run",
      scope: knowledge.scope,
      scope_verified: false,
      fallback: "repository",
      error:
        "Organization-scoped GBrain must be verified through its remote identity and authorization boundary; local project setup cannot attest that scope.",
    };
  }

  const home = projectFile(target, GBRAIN_HOME_PATH, "project GBrain home");
  if (!executableExists(target, "gbrain")) {
    return {
      ok: false,
      provider: "gbrain",
      live_check: "failed",
      scope: "project",
      scope_verified: false,
      expected_home: home,
      fallback: "repository",
      error: "gbrain CLI is not installed",
    };
  }
  if (!existsSync(home)) {
    return {
      ok: false,
      provider: "gbrain",
      live_check: "failed",
      scope: "project",
      scope_verified: false,
      expected_home: home,
      fallback: "repository",
      error: "project-local GBrain has not been initialized",
    };
  }

  const databaseResult = runGbrain(
    target,
    ["config", "get", "database_path"],
    15_000,
  );
  if (!databaseResult.ok) {
    return {
      ok: false,
      provider: "gbrain",
      live_check: "failed",
      scope: "project",
      scope_verified: false,
      expected_home: home,
      fallback: "repository",
      error: "could not read the active GBrain database path",
      detail:
        databaseResult.stderr ||
        databaseResult.stdout ||
        databaseResult.reason,
    };
  }
  const databasePath = (
    databaseResult.raw_stdout ?? databaseResult.stdout
  ).trim();
  if (
    databasePath.length === 0 ||
    !isAbsolute(databasePath) ||
    !existsSync(databasePath) ||
    !pathContainedBy(realpathSync(home), realpathSync(databasePath))
  ) {
    return {
      ok: false,
      provider: "gbrain",
      live_check: "failed",
      scope: "project",
      scope_verified: false,
      expected_home: home,
      database_path: databasePath || null,
      fallback: "repository",
      error:
        "the active GBrain database is missing or not contained by this project's approved memory scope",
    };
  }

  const doctor = parseProviderJson(
    runGbrain(target, ["doctor", "--json", "--fast", "--scope=brain"]),
    "gbrain doctor",
  );
  if (!doctor.ok) {
    return {
      ok: false,
      provider: "gbrain",
      live_check: "failed",
      scope: "project",
      scope_verified: true,
      expected_home: home,
      database_path: databasePath,
      fallback: "repository",
      error: doctor.error,
      detail: doctor.detail,
    };
  }
  const identity = parseProviderJson(
    runGbrain(target, ["call", "get_brain_identity", "{}"], 15_000),
    "gbrain identity",
  );
  const doctorUnhealthy = doctor.value?.status === "unhealthy";
  const identityMalformed =
    identity.ok && typeof identity.value?.engine !== "string";
  const healthy =
    identity.ok &&
    !doctorUnhealthy &&
    !identityMalformed;
  return {
    ok: healthy,
    provider: "gbrain",
    live_check: healthy ? "passed" : "failed",
    scope: "project",
    scope_verified: true,
    expected_home: home,
    database_path: databasePath,
    doctor: {
      status: doctor.value?.status ?? "unknown",
      health_score: doctor.value?.health_score ?? null,
    },
    identity: identity.ok
      ? {
          version: identity.value?.version ?? null,
          engine: identity.value?.engine ?? null,
          page_count: identity.value?.page_count ?? null,
          chunk_count: identity.value?.chunk_count ?? null,
        }
      : { error: identity.error, detail: identity.detail },
    fallback: "repository",
    ...(healthy
      ? {}
      : {
          error: !identity.ok
            ? identity.error
            : doctorUnhealthy
              ? "gbrain doctor reported unhealthy"
              : "gbrain identity response is missing an engine identifier",
        }),
  };
}

function commandMemorySetup(target, harnessOption = undefined) {
  const config = loadConfig(target);
  const knowledge = config.capabilities.knowledge;
  if (knowledge.provider !== "gbrain") {
    throw new StackError(
      "GBrain is not approved for this project. Complete the plain-language memory decision and configure gbrain first.",
    );
  }
  if (knowledge.scope !== "project") {
    throw new StackError(
      "Guided local setup supports project scope. Organization scope requires a separately approved remote GBrain.",
    );
  }
  const detectedHarnesses = detectHarnesses(target);
  const harness =
    harnessOption ??
    (detectedHarnesses.includes("codex")
      ? "codex"
      : detectedHarnesses[0] ?? "codex");
  if (!SUPPORTED_HARNESSES.has(harness)) {
    throw new StackError(
      `--harness must be one of: ${[...SUPPORTED_HARNESSES].sort().join(", ")}`,
    );
  }
  const home = projectFile(target, GBRAIN_HOME_PATH, "project GBrain home");
  const databasePath = join(home, "brain.pglite");
  let connection;
  if (harness === "codex") {
    connection = {
      method: "merge-project-config",
      path: ".codex/config.toml",
      note:
        "Merge this table into the trusted project's existing config; never overwrite unrelated Codex settings.",
      config: [
        "[mcp_servers.gbrain]",
        'command = "node"',
        `args = ["${GBRAIN_LAUNCHER_PATH}", "serve"]`,
      ].join("\n"),
    };
  } else if (harness === "claude") {
    connection = {
      method: "command",
      argv: [
        "claude",
        "mcp",
        "add",
        "--scope",
        "project",
        "gbrain",
        "--",
        "node",
        GBRAIN_LAUNCHER_PATH,
        "serve",
      ],
    };
  } else {
    connection = {
      method: "project-mcp-stdio",
      server_name: "gbrain",
      command: "node",
      args: [GBRAIN_LAUNCHER_PATH, "serve"],
      note:
        "Merge this stdio server into the harness's project-scoped MCP configuration. Do not create a global cross-project connection.",
    };
  }
  return {
    ok: true,
    provider: "gbrain",
    mode: "guided-local-project",
    harness,
    scope: {
      type: "project",
      home,
      database_path: databasePath,
      repository_fallback: true,
    },
    steps: [
      {
        id: "install-cli",
        status: executableExists(target, "gbrain")
          ? "already-available"
          : "requires-explicit-global-install-approval",
        argv: ["bun", "install", "-g", "github:garrytan/gbrain"],
        guardrail:
          "Verify the current official GBrain installation instructions before running a global install.",
      },
      {
        id: "initialize-local-brain",
        status: existsSync(home) ? "inspect-existing" : "ready-after-install",
        environment: { GBRAIN_HOME: home },
        argv: [
          "gbrain",
          "init",
          "--pglite",
          "--path",
          databasePath,
          "--no-embedding",
          "--non-interactive",
          "--json",
        ],
        guardrail:
          "Do not use --force. The no-embedding default avoids silently requesting or inheriting external API keys; add an embedding provider only after separate approval.",
      },
      {
        id: "connect-project-mcp",
        status: "merge-with-existing-project-configuration",
        connection,
      },
      {
        id: "verify",
        status: "required",
        argv: [
          "node",
          PROJECT_CLI_PATH,
          "memory-health",
          "--target",
          ".",
        ],
        mcp_probe:
          "Restart or reload the coding harness, call get_brain_identity, then retrieve the checkpoint page if one exists.",
      },
    ],
  };
}

function parseTelemetrySpec(spec) {
  if (
    typeof spec !== "string" ||
    spec.length === 0 ||
    spec.length > 256 ||
    /[\r\n\0]/.test(spec)
  ) {
    throw new StackError(
      "--telemetry must use provider@region:scope with a bounded value",
    );
  }
  const match = /^([a-z-]+)@([a-z]+):(.+)$/.exec(spec.trim().toLowerCase());
  if (!match) {
    throw new StackError(
      "--telemetry must use provider@region:scope, for example posthog@us:12345",
    );
  }
  const [, provider, region, scopeValue] = match;
  if (!TELEMETRY_PROVIDERS.has(provider)) {
    throw new StackError(
      "--telemetry provider must be posthog, sentry, or new-relic",
    );
  }
  if (!TELEMETRY_PROVIDER_REGIONS[provider].has(region)) {
    throw new StackError(
      `--telemetry region is not approved for ${provider}`,
    );
  }
  let scope;
  if (provider === "posthog") {
    if (
      !TELEMETRY_NUMERIC_ID.test(scopeValue) ||
      !Number.isSafeInteger(Number(scopeValue))
    ) {
      throw new StackError(
        "PostHog telemetry scope must be its positive numeric project ID",
      );
    }
    scope = { project_id: scopeValue };
  } else if (provider === "sentry") {
    const parts = scopeValue.split("/");
    if (
      parts.length !== 2 ||
      !parts.every((part) => TELEMETRY_IDENTIFIER.test(part))
    ) {
      throw new StackError(
        "Sentry telemetry scope must be organization-slug/project-slug",
      );
    }
    scope = { organization: parts[0], project: parts[1] };
  } else {
    if (
      !TELEMETRY_NUMERIC_ID.test(scopeValue) ||
      !Number.isSafeInteger(Number(scopeValue))
    ) {
      throw new StackError(
        "New Relic telemetry scope must be its positive numeric account ID",
      );
    }
    scope = { account_id: scopeValue };
  }
  return {
    provider,
    role: TELEMETRY_PROVIDER_ROLES[provider],
    region,
    credential_env: TELEMETRY_CREDENTIAL_ENVIRONMENTS[provider],
    scope,
  };
}

function resolveConfigureOptions(options) {
  const preset = options.preset;
  if (preset !== undefined) {
    const presetOptions = Object.hasOwn(CONFIGURATION_PRESETS, preset)
      ? CONFIGURATION_PRESETS[preset]
      : undefined;
    if (!presetOptions) {
      throw new StackError(
        `--preset must be one of: ${Object.keys(CONFIGURATION_PRESETS).join(", ")}`,
      );
    }
    const incompatibleOptions = [
      ["--profile", options.profile],
      ["--review", options.review],
      ["--knowledge", options.knowledge],
      ["--knowledge-scope", options.knowledgeScope],
      ["--work", options.work],
      [
        "--linear-team",
        Array.isArray(options.linearTeams) && options.linearTeams.length > 0
          ? options.linearTeams
          : undefined,
      ],
      [
        "--linear-write",
        Array.isArray(options.linearWrites) && options.linearWrites.length > 0
          ? options.linearWrites
          : undefined,
      ],
      [
        "--telemetry",
        Array.isArray(options.telemetrySpecs) &&
        options.telemetrySpecs.length > 0
          ? options.telemetrySpecs
          : undefined,
      ],
      ["--external-data", options.externalData],
      ["--execution", options.execution],
      ["--merge", options.merge],
      [
        "--reviewer",
        Array.isArray(options.reviewers) && options.reviewers.length > 0
          ? options.reviewers
          : undefined,
      ],
    ]
      .filter(([, value]) => value !== undefined)
      .map(([name]) => name);
    if (incompatibleOptions.length > 0) {
      throw new StackError(
        `--preset cannot be combined with manual configuration options: ${incompatibleOptions.join(", ")}`,
      );
    }
    return {
      ...presetOptions,
      reviewers: [...presetOptions.reviewers],
      linearWrites: [...presetOptions.linearWrites],
      telemetrySpecs: [...presetOptions.telemetrySpecs],
      preset,
      reason: options.reason,
    };
  }
  return {
    ...options,
    knowledgeScope: options.knowledgeScope ?? "project",
    work: options.work ?? "repository",
    linearTeams: options.linearTeams ?? [],
    linearWrites: options.linearWrites ?? [],
    telemetrySpecs: options.telemetrySpecs ?? [],
    execution: options.execution ?? "agent_owned",
    merge: options.merge ?? "human_approval_required",
    reviewers: options.reviewers ?? [],
  };
}

function commandConfigure(target, options) {
  const {
    profile,
    review,
    knowledge,
    knowledgeScope,
    work,
    linearTeams,
    linearWrites,
    telemetrySpecs,
    externalData,
    execution,
    merge,
    reviewers,
    preset,
    reason,
  } = resolveConfigureOptions(options);
  if (typeof reason !== "string" || reason.trim().length < 12) {
    throw new StackError(
      "Configuration reason must record the user's approved project and provider choices.",
    );
  }
  if (!PROJECT_PROFILES.has(profile)) {
    throw new StackError(
      "--profile must be experimental, standard, or production",
    );
  }
  if (!REVIEW_PROVIDERS.has(review)) {
    throw new StackError(
      "--review must be builtin, coderabbit, or github-human",
    );
  }
  if (!KNOWLEDGE_PROVIDERS.has(knowledge)) {
    throw new StackError("--knowledge must be repository or gbrain");
  }
  if (!KNOWLEDGE_SCOPES.has(knowledgeScope)) {
    throw new StackError(
      "--knowledge-scope must be project or organization",
    );
  }
  if (!WORK_PROVIDERS.has(work)) {
    throw new StackError("--work must be repository or linear");
  }
  const telemetryProviders = telemetrySpecs
    .map(parseTelemetrySpec)
    .sort((left, right) => left.provider.localeCompare(right.provider));
  if (telemetryProviders.length > 3) {
    throw new StackError("--telemetry supports at most three reviewed providers");
  }
  const telemetryProviderNames = telemetryProviders.map(
    (provider) => provider.provider,
  );
  if (new Set(telemetryProviderNames).size !== telemetryProviderNames.length) {
    throw new StackError(
      "--telemetry may configure each reviewed provider only once",
    );
  }
  if (!EXTERNAL_DATA_POLICIES.has(externalData)) {
    throw new StackError(
      "--external-data must be local_only or approved_providers",
    );
  }
  if (!EXECUTION_MODES.has(execution)) {
    throw new StackError("--execution must be agent_owned or proposal_only");
  }
  if (!MERGE_MODES.has(merge)) {
    throw new StackError(
      "--merge must be human_approval_required or policy_authorized",
    );
  }
  if (profile === "production" && review === "builtin") {
    throw new StackError(
      "The production profile requires CodeRabbit or an allowed GitHub human reviewer.",
    );
  }
  if (knowledge === "gbrain" && externalData !== "approved_providers") {
    throw new StackError(
      "GBrain is an external provider. Select approved_providers or keep repository memory.",
    );
  }
  if (knowledge === "repository" && knowledgeScope !== "project") {
    throw new StackError(
      "Repository knowledge supports project scope only. Select GBrain for an approved organization scope.",
    );
  }
  const normalizedLinearTeams = [
    ...new Set(
      linearTeams
        .map((key) => String(key).trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const normalizedLinearWrites = [
    ...new Set(
      linearWrites
        .map((operation) => String(operation).trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
  if (
    normalizedLinearTeams.length > 20 ||
    !normalizedLinearTeams.every((key) => /^[A-Z][A-Z0-9]{0,9}$/.test(key))
  ) {
    throw new StackError(
      "--linear-team must be repeated with at most 20 valid Linear team keys",
    );
  }
  if (work === "linear" && normalizedLinearTeams.length === 0) {
    throw new StackError(
      "Linear work tracking requires at least one --linear-team key",
    );
  }
  if (work === "repository" && normalizedLinearTeams.length > 0) {
    throw new StackError(
      "--linear-team can only be used with --work linear",
    );
  }
  if (
    normalizedLinearWrites.some(
      (operation) => !LINEAR_WRITE_OPERATIONS.has(operation),
    )
  ) {
    throw new StackError(
      "--linear-write must be issue_create or evidence_comment",
    );
  }
  if (
    normalizedLinearWrites.includes("evidence_comment") &&
    !normalizedLinearWrites.includes("issue_create")
  ) {
    throw new StackError(
      "evidence_comment requires issue_create so comments have a receipted issue link",
    );
  }
  if (work !== "linear" && normalizedLinearWrites.length > 0) {
    throw new StackError(
      "--linear-write can only be used with --work linear",
    );
  }
  if (work === "linear" && externalData !== "approved_providers") {
    throw new StackError(
      "Linear is an external provider. Select approved_providers or keep repository work tracking.",
    );
  }
  if (
    telemetryProviders.length > 0 &&
    externalData !== "approved_providers"
  ) {
    throw new StackError(
      "Telemetry uses external providers. Select approved_providers or keep repository evidence only.",
    );
  }

  const config = loadConfig(target);
  const existingIdempotencyNamespace =
    typeof config.capabilities.work?.linear_idempotency_namespace ===
      "string" &&
    /^[a-f0-9]{64}$/.test(
      config.capabilities.work.linear_idempotency_namespace,
    )
      ? config.capabilities.work.linear_idempotency_namespace
      : randomBytes(32).toString("hex");
  const normalizedReviewers = [
    ...new Set(
      reviewers
        .map((login) => String(login).trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (review === "github-human" && normalizedReviewers.length === 0) {
    throw new StackError(
      "github-human review requires one or more allowed GitHub logins.",
    );
  }
  config.onboarding = {
    status: "complete",
    project_profile: profile,
    external_data_policy: externalData,
    configured_at: utcTimestamp(),
  };
  config.interaction = {
    mode: "guided",
    plain_language: true,
    ask_one_decision_at_a_time: true,
    recommendation_required: true,
    maximum_options: 2,
    unsafe_alternatives_forbidden: true,
  };
  config.capabilities.review = {
    provider: review,
    required_for_release: review !== "builtin",
    current_revision_required: true,
    allowed_logins: review === "github-human" ? normalizedReviewers : [],
  };
  config.capabilities.knowledge = {
    provider: knowledge,
    scope: knowledgeScope,
    required: false,
    capture: "verified_proposals_only",
    repository_fallback: true,
  };
  config.capabilities.telemetry = {
    providers: telemetryProviders,
    required: false,
    default_access: "read_only",
    evidence_capture: "bounded_references_only",
    raw_payload_storage: false,
    repository_fallback: true,
  };
  config.capabilities.work =
    work === "linear"
      ? {
          provider: "linear",
          required: false,
          sync_mode: "read_only_mirror",
          write_policy:
            normalizedLinearWrites.length === 0
              ? "read_only"
              : normalizedLinearWrites.includes("evidence_comment")
                ? "receipted_create_and_comment"
                : "receipted_create",
          repository_fallback: true,
          linear_idempotency_namespace: existingIdempotencyNamespace,
          connection: {
            kind: "linear_api_key",
            credential_env: LINEAR_CREDENTIAL_ENV,
            team_keys: normalizedLinearTeams,
            writes:
              normalizedLinearWrites.length === 0
                ? null
                : {
                    operations: normalizedLinearWrites,
                    create_credential_env: LINEAR_CREATE_CREDENTIAL_ENV,
                    comment_credential_env: normalizedLinearWrites.includes(
                      "evidence_comment",
                    )
                      ? LINEAR_COMMENT_CREDENTIAL_ENV
                      : null,
                  },
          },
        }
      : {
          provider: "repository",
          required: false,
          sync_mode: "repository_only",
          write_policy: "repository_only",
          repository_fallback: true,
          linear_idempotency_namespace: existingIdempotencyNamespace,
          connection: null,
        };
  config.learning = {
    auto_activate_skills: false,
    verified_candidates_only: true,
    evaluation_required: true,
  };
  config.autonomy.execution = execution;
  config.autonomy.merge = merge;
  const errors = validateConfig(config, target);
  if (errors.length > 0) {
    throw new StackError("Cannot approve invalid configuration", 2, errors);
  }
  config.safety.approved_configuration_hash = configurationHash(config);
  config.safety.configuration_approved_at = utcTimestamp();
  config.safety.configuration_approval_reason = reason.trim();
  atomicProjectJson(target, CONFIG_PATH, config, "project config");
  return {
    ok: true,
    ...(preset ? { preset } : {}),
    onboarding: config.onboarding,
    capabilities: config.capabilities,
    autonomy: {
      execution: config.autonomy.execution,
      merge: config.autonomy.merge,
    },
    approved_configuration_hash:
      config.safety.approved_configuration_hash,
    approved_at: config.safety.configuration_approved_at,
  };
}

function commandDetect(target, write) {
  const detected = detectProject(target);
  if (!write) {
    return { ok: true, ...detected };
  }
  const configFile = projectFile(target, CONFIG_PATH, "project config");
  const config = existsSync(configFile)
    ? loadConfig(target)
    : defaultConfig(target, detected);
  config.project.name ||= basename(target);
  config.project.stacks = detected.stacks;
  config.project.detected_at = detected.detected_at;
  const existingChecks = Array.isArray(config.quality.checks)
    ? config.quality.checks
    : [];
  const manualChecks = existingChecks.filter(
    (check) => check && check.source !== "detected",
  );
  const manualIds = new Set(manualChecks.map((check) => check.id));
  const updatedChecks = [
    ...manualChecks,
    ...detected.checks.filter((check) => !manualIds.has(check.id)),
  ];
  if (
    checksHash(
      updatedChecks,
      target,
      config.quality.environment?.allow ?? [],
    ) !== config.safety.approved_checks_hash
  ) {
    config.safety.approved_checks_hash = null;
    config.safety.approved_at = null;
    config.safety.approval_reason = null;
  }
  config.quality.checks = updatedChecks;
  atomicJson(configFile, config);
  return { ok: true, ...detected, wrote: CONFIG_PATH };
}

function commandApproveChecks(target, reason) {
  if (typeof reason !== "string" || reason.trim().length < 12) {
    throw new StackError(
      "Approval reason must explain what command definitions were inspected.",
    );
  }
  const config = loadConfig(target);
  const errors = validateConfig(config, target);
  if (errors.length > 0) {
    throw new StackError("Cannot approve invalid checks", 2, errors);
  }
  config.safety.approved_checks_hash = currentChecksHash(config, target);
  config.safety.approved_at = utcTimestamp();
  config.safety.approval_reason = reason.trim();
  atomicProjectJson(target, CONFIG_PATH, config, "project config");
  return {
    ok: true,
    approved_checks_hash: config.safety.approved_checks_hash,
    approved_at: config.safety.approved_at,
  };
}

function protectedDrift(target, installation) {
  const drift = [];
  if (!installation) {
    return drift;
  }
  const packageAssetsAvailable = existsSync(
    join(PACKAGE_ROOT, ".codex-plugin/plugin.json"),
  );
  if (!packageAssetsAvailable) {
    return [
      {
        path: PROJECT_CLI_PATH,
        status: "unverifiable-from-project-copy",
        detail: `Run npx -y ${PACKAGE_NAME}@${installation.package?.version ?? PACKAGE_VERSION} doctor to verify protected files against the package.`,
      },
    ];
  }
  const claude = installation.harnesses?.includes("claude") ?? false;
  for (const entry of sourceEntries({ claude }).filter(
    (candidate) => candidate.protected,
  )) {
    const destination = entry.destination.split(sep).join("/");
    const expectedHash = hashFile(entry.source);
    const manifestEntry = installation.managed_files?.[destination];
    const file = pathInside(target, destination, "protected file");
    if (!existsSync(file)) {
      drift.push({ path: destination, status: "missing" });
    } else if (hashFile(file) !== expectedHash) {
      drift.push({ path: destination, status: "modified" });
    }
    if (
      !manifestEntry ||
      manifestEntry.protected !== true ||
      manifestEntry.source_hash !== expectedHash ||
      manifestEntry.customized === true
    ) {
      drift.push({ path: destination, status: "manifest-mismatch" });
    }
  }
  return drift;
}

function protectedProjectFileIssue(target, destination) {
  const installation = loadInstallation(target);
  const manifestEntry = installation?.managed_files?.[destination];
  if (
    !installation ||
    !manifestEntry ||
    manifestEntry.protected !== true ||
    manifestEntry.customized === true ||
    typeof manifestEntry.source_hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifestEntry.source_hash)
  ) {
    return `${destination} is not recorded as an intact protected file`;
  }
  const file = pathInside(target, destination, "protected provider helper");
  if (!existsSync(file) || hashFile(file) !== manifestEntry.source_hash) {
    return `${destination} is missing or modified`;
  }
  if (
    destination === LINEAR_READONLY_PATH &&
    portableTextSha256(readFileSync(file)) !== LINEAR_READONLY_SOURCE_HASH
  ) {
    return `${destination} does not match the hash pinned in the protected CLI`;
  }
  if (
    destination === LINEAR_WRITE_PATH &&
    portableTextSha256(readFileSync(file)) !== LINEAR_WRITE_SOURCE_HASH
  ) {
    return `${destination} does not match the hash pinned in the protected CLI`;
  }
  if (
    destination === TELEMETRY_READONLY_PATH &&
    portableTextSha256(readFileSync(file)) !== TELEMETRY_READONLY_SOURCE_HASH
  ) {
    return `${destination} does not match the hash pinned in the protected CLI`;
  }
  if (existsSync(join(PACKAGE_ROOT, ".codex-plugin/plugin.json"))) {
    const claude = installation.harnesses?.includes("claude") ?? false;
    const source = sourceEntries({ claude }).find(
      (entry) =>
        entry.destination.split(sep).join("/") === destination &&
        entry.protected,
    )?.source;
    if (!source || hashFile(source) !== manifestEntry.source_hash) {
      return `${destination} does not match the reviewed package source`;
    }
  }
  return null;
}

function hardenedGitEnvironment() {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_SYSTEM = platform() === "win32" ? "NUL" : "/dev/null";
  environment.GIT_CONFIG_GLOBAL = platform() === "win32" ? "NUL" : "/dev/null";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_PAGER = "cat";
  environment.GIT_TERMINAL_PROMPT = "0";
  return environment;
}

function hardenedGitProbe(target, args) {
  return spawnSync(
    "git",
    [
      "--no-pager",
      "--no-optional-locks",
      "-C",
      resolve(target),
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "-c",
      "status.showUntrackedFiles=all",
      ...args,
    ],
    {
      encoding: "utf8",
      shell: false,
      timeout: 10_000,
      env: hardenedGitEnvironment(),
      windowsHide: true,
    },
  );
}

function isGitRepository(target) {
  return hardenedGitProbe(target, ["rev-parse", "--git-dir"]).status === 0;
}

function commandDoctor(target) {
  const reports = [];
  const report = (
    name,
    ok,
    detail,
    severity = "required",
    code = undefined,
  ) => {
    reports.push({
      name,
      ok,
      detail,
      severity,
      ...(code === undefined ? {} : { code }),
    });
  };
  const installation = loadInstallation(target);
  report(
    "installation",
    Boolean(installation),
    installation
      ? `${installation.package?.name}@${installation.package?.version}`
      : `missing ${INSTALLATION_PATH}`,
  );
  if (installation) {
    const drift = protectedDrift(target, installation);
    report(
      "protected-files",
      drift.length === 0,
      drift.length === 0 ? "intact" : drift,
    );
    report(
      "update-proposals",
      Object.keys(installation.pending_files ?? {}).length === 0,
      Object.keys(installation.pending_files ?? {}),
    );
  }

  const configFile = projectFile(target, CONFIG_PATH, "project config");
  if (!existsSync(configFile)) {
    report("config", false, `missing ${CONFIG_PATH}`);
  } else {
    const config = loadConfig(target);
    const errors = validateConfig(config, target);
    report(
      "config",
      errors.length === 0,
      errors.length === 0 ? "valid" : errors,
      "required",
      errors.length === 0
        ? "valid"
        : errors.length === 1 && errors[0] === NO_PROJECT_CHECKS_ERROR
          ? "first-baseline-pending"
          : "invalid",
    );
    report(
      "onboarding",
      config.onboarding.status === "complete",
      config.onboarding.status === "complete"
        ? {
            profile: config.onboarding.project_profile,
            external_data: config.onboarding.external_data_policy,
            configured_at: config.onboarding.configured_at,
          }
        : `${config.onboarding.status}; complete guided setup with the configure command`,
      "required",
      typeof config.onboarding.status === "string"
        ? config.onboarding.status.replaceAll("_", "-")
        : "invalid",
    );
    const actualConfigurationHash = configurationHash(config);
    const configurationApproved =
      config.safety.approved_configuration_hash === actualConfigurationHash;
    report(
      "configuration-approval",
      configurationApproved,
      configurationApproved
        ? `approved ${config.safety.configuration_approved_at}`
        : "provider, interaction, autonomy, or profile choices changed or have not been approved",
      "required",
      configurationApproved
        ? "approved"
        : config.safety.approved_configuration_hash === null
          ? "not-approved"
          : "changed",
    );
    const capabilities = commandCapabilities(target);
    const reviewProvider = config.capabilities.review.provider;
    const reviewAvailability =
      capabilities.available.review[reviewProvider]?.available === true;
    report(
      "review-provider",
      reviewAvailability,
      {
        selected: reviewProvider,
        required_for_release:
          config.capabilities.review.required_for_release,
        availability: capabilities.available.review[reviewProvider],
      },
      config.capabilities.review.required_for_release ? "required" : "warning",
    );
    const knowledgeProvider = config.capabilities.knowledge.provider;
    const knowledgeHealth = commandMemoryHealth(target, config);
    report(
      "knowledge-provider",
      knowledgeHealth.ok,
      {
        selected: knowledgeProvider,
        fallback: "repository",
        health: knowledgeHealth,
      },
      "warning",
    );
    const telemetry =
      config.capabilities.telemetry &&
      typeof config.capabilities.telemetry === "object" &&
      !Array.isArray(config.capabilities.telemetry)
        ? config.capabilities.telemetry
        : {};
    const telemetryProviders = Array.isArray(telemetry.providers)
      ? telemetry.providers
      : [];
    const telemetryHealth = commandTelemetryHealth(target, config);
    report(
      "telemetry-providers",
      telemetryHealth.ok,
      {
        selected: telemetryProviders.map((provider) => ({
          provider: provider?.provider ?? "invalid",
          role: provider?.role ?? "invalid",
          region: provider?.region ?? "invalid",
          scope: telemetryScopeSummary(provider),
        })),
        access: telemetry.default_access ?? "invalid",
        evidence_capture: telemetry.evidence_capture ?? "invalid",
        raw_payload_storage: telemetry.raw_payload_storage ?? "invalid",
        fallback: "repository evidence",
        health: telemetryHealth,
      },
      "warning",
      telemetryProviders.length === 0
        ? "not-configured"
        : telemetryHealth.ok
          ? "available"
          : "repository-fallback",
    );
    const work =
      config.capabilities.work &&
      typeof config.capabilities.work === "object" &&
      !Array.isArray(config.capabilities.work)
        ? config.capabilities.work
        : {};
    const workProviderHealth = commandLinearHealth(target, config);
    report(
      "work-provider",
      workProviderHealth.ok,
      {
        selected: work.provider ?? "invalid",
        health: workProviderHealth,
      },
      "warning",
      workProviderHealth.ok ? "available" : "repository-fallback",
    );
    const workWriteReadiness = linearWriteReadiness(target, config);
    report(
      "work-provider-writes",
      workWriteReadiness.ok,
      workWriteReadiness,
      "warning",
      workWriteReadiness.enabled_operations.length === 0
        ? "disabled"
        : workWriteReadiness.ok
          ? "ready"
          : "not-ready",
    );
    const workLedger = commandWorkValidate(target);
    report(
      "work-ledger",
      workLedger.ok,
      workLedger.ok
        ? {
            provider: work.provider ?? "invalid",
            path: workLedger.path,
            item_count: workLedger.item_count,
            status_counts: workLedger.status_counts,
          }
        : workLedger.errors,
    );
    const evidenceGraph = commandEvidenceValidate(target);
    report(
      "evidence-graph",
      evidenceGraph.ok,
      evidenceGraph.ok
        ? {
            path: evidenceGraph.path,
            node_count: evidenceGraph.node_count,
            edge_count: evidenceGraph.edge_count,
          }
        : evidenceGraph.errors,
    );
    const providerReceipts = commandReceiptsValidate(target);
    report(
      "provider-receipts",
      providerReceipts.ok,
      providerReceipts.ok
        ? {
            path: providerReceipts.path,
            receipt_count: providerReceipts.receipt_count,
          }
        : providerReceipts.errors,
    );
    try {
      const campaign = commandCampaignStatus(target).campaign;
      report(
        "campaign",
        true,
        campaign ?? "not started",
        "warning",
        campaign?.status ?? "not-started",
      );
    } catch (error) {
      report("campaign", false, error.message, "required", "invalid");
    }
    const parallel = config.parallel_delivery;
    const parallelErrors = errors.filter(
      (error) =>
        error.startsWith("parallel_delivery") ||
        error.startsWith("autonomy.parallel_work"),
    );
    const parallelObject =
      parallel && typeof parallel === "object" && !Array.isArray(parallel);
    report(
      "parallel-delivery",
      Boolean(parallelObject) && parallelErrors.length === 0,
      parallelObject && parallelErrors.length === 0
        ? {
            mode: parallel.mode,
            max_workers: parallel.max_workers,
            write_isolation_required:
              parallel.require_isolation_for_parallel_writes,
            nested_delegation: parallel.allow_nested_delegation,
            integration_owner: parallel.integration_owner,
          }
        : parallelErrors,
    );
    const actualHash = currentChecksHash(config, target);
    const checksApproved = config.safety.approved_checks_hash === actualHash;
    report(
      "check-approval",
      checksApproved,
      checksApproved
        ? `approved ${config.safety.approved_at}`
        : "commands changed or have not been reviewed",
      "required",
      checksApproved
        ? "approved"
        : config.safety.approved_checks_hash === null
          ? "not-approved"
          : "changed",
    );
    for (const check of config.quality.checks) {
      report(
        `command:${check.id}`,
        executableExists(target, check.argv?.[0]),
        Array.isArray(check.argv) ? check.argv.join(" ") : "missing argv",
      );
    }
  }

  report(
    "instructions",
    projectExists(target, "AGENTS.md"),
    "AGENTS.md",
  );
  const gitReady = isGitRepository(target);
  report(
    "git",
    gitReady,
    "Git repository",
    "required",
    gitReady
      ? "repository"
      : projectExists(target, ".git")
        ? "invalid"
        : "not-initialized",
  );
  report(
    "github-cli",
    executableExists(target, "gh"),
    "optional until pull-request phase",
    "warning",
  );
  try {
    const checkpoint = loadCheckpoint(target);
    report(
      "checkpoint",
      true,
      checkpoint
        ? {
            id: checkpoint.checkpoint_id,
            status: checkpoint.status,
            updated_at: checkpoint.updated_at,
          }
        : "not created yet",
      "required",
    );
  } catch (error) {
    report("checkpoint", false, error.message, "required", "invalid");
  }
  try {
    const coordinator = publicCoordinator(readCoordinator(target));
    report(
      "coordinator",
      coordinator.state !== "stale",
      coordinator,
      "warning",
      coordinator.state,
    );
  } catch (error) {
    report("coordinator", false, error.message, "required", "invalid");
  }
  const failures = reports.filter(
    (item) => !item.ok && item.severity === "required",
  );
  return {
    ok: failures.length === 0,
    reports,
    warnings: reports.filter(
      (item) => !item.ok && item.severity === "warning",
    ),
  };
}

function formatDoctorHuman(result) {
  const failures = result.reports.filter(
    (report) => !report.ok && report.severity === "required",
  );
  const warnings = result.reports.filter(
    (report) => !report.ok && report.severity === "warning",
  );
  const failureNames = new Set(failures.map((report) => report.name));
  const setupFailureNames = new Set([
    "onboarding",
    "configuration-approval",
    "check-approval",
  ]);
  const setupOnly =
    failures.length > 0 &&
    failures.every((report) => setupFailureNames.has(report.name));
  const firstBaselineFailureCodes = new Map([
    ["config", "first-baseline-pending"],
    ["onboarding", "pending"],
    ["configuration-approval", "not-approved"],
    ["check-approval", "not-approved"],
    ["git", "not-initialized"],
  ]);
  const requiredFirstBaselineFailures = [
    "config",
    "onboarding",
    "configuration-approval",
    "check-approval",
  ];
  const firstBaselinePending =
    requiredFirstBaselineFailures.every((name) => failureNames.has(name)) &&
    failures.every(
      (report) =>
        firstBaselineFailureCodes.get(report.name) === report.code,
    );
  const gitNeedsInitialization = failures.some(
    (report) => report.name === "git" && report.code === "not-initialized",
  );

  const outcomes = [
    {
      matches: result.ok,
      status: "Ready.",
      explanation:
        "Ultimate Agent Stack is installed and its required safety checks are configured.",
      nextAction:
        "Tell your coding agent what you want to build or change.",
    },
    {
      matches: failureNames.has("installation"),
      status: "Not set up yet.",
      explanation:
        "Ultimate Agent Stack is not installed in this project folder.",
      nextAction:
        'Tell your coding agent: "Set up Ultimate Agent Stack in this project."',
    },
    {
      matches: failureNames.has("protected-files"),
      status: "Needs attention.",
      explanation:
        "One or more protected safety files are missing or changed.",
      nextAction:
        "Ask your coding agent to repair the Ultimate Agent Stack installation and run doctor again. Do not edit the protected files yourself.",
    },
    {
      matches: failureNames.has("update-proposals"),
      status: "Update review needed.",
      explanation:
        "A safe update proposal is waiting to be reconciled; your customized files were not overwritten.",
      nextAction:
        "Ask your coding agent to review the update proposal, adopt the reconciled files, and run doctor again.",
    },
    {
      matches: firstBaselinePending,
      status: "Almost ready.",
      explanation:
        "Ultimate Agent Stack is installed, but this project does not have its first quality-check baseline yet.",
      nextAction: gitNeedsInitialization
        ? 'Tell your coding agent: "Initialize Git in this project, create the first project checks, finish Ultimate Agent Stack setup, and run doctor again." You do not need to edit configuration files yourself.'
        : 'Tell your coding agent: "Create the first project checks, finish Ultimate Agent Stack setup, and run doctor again." You do not need to edit configuration files yourself.',
    },
    {
      matches: setupOnly,
      status: "Almost ready.",
      explanation:
        "The package is installed, but guided setup or project-check approval is not complete.",
      nextAction:
        'Tell your coding agent: "Finish Ultimate Agent Stack setup, recommend the safe choices, inspect the project checks, and run doctor again." You do not need to edit configuration files yourself.',
    },
    {
      matches: failureNames.has("config"),
      status: "Needs attention.",
      explanation: "The project configuration is missing or invalid.",
      nextAction:
        "Ask your coding agent to repair the Ultimate Agent Stack configuration and run doctor again.",
    },
    {
      matches: failures.some((report) => report.name.startsWith("command:")),
      status: "Project tool needed.",
      explanation:
        "At least one approved project check cannot run with the tools currently available.",
      nextAction:
        "Ask your coding agent to repair the missing project tool or safely update the approved check, then run doctor again.",
    },
    {
      matches: true,
      status: "Setup needs attention.",
      explanation:
        "One or more required project safeguards are not ready.",
      nextAction:
        "Ask your coding agent to inspect this doctor result, fix the required items without weakening safety, and run doctor again.",
    },
  ];
  const { status, explanation, nextAction } = outcomes.find(
    (outcome) => outcome.matches,
  );

  const lines = [
    "Ultimate Agent Stack doctor",
    "",
    status,
    explanation,
    "",
    `Next: ${nextAction}`,
  ];
  if (failures.length > 0) {
    lines.push(
      "",
      `Required items needing attention: ${failures
        .map((report) => report.name)
        .join(", ")}`,
    );
  }
  if (warnings.length > 0) {
    lines.push(
      `Optional notices: ${warnings.map((report) => report.name).join(", ")}`,
    );
  }
  return lines.join("\n");
}

function commandAdoptManaged(target, destination, reason) {
  if (!destination) {
    throw new StackError("--path is required");
  }
  if (typeof reason !== "string" || reason.trim().length < 12) {
    throw new StackError("Adoption reason must explain the reconciliation.");
  }
  const installation = loadInstallation(target);
  if (!installation) {
    throw new StackError("Project has no installation manifest");
  }
  const normalized = destination.replaceAll("\\", "/");
  const pending = installation.pending_files?.[normalized];
  if (!pending) {
    throw new StackError(`No pending proposal for ${normalized}`);
  }
  const destinationFile = pathInside(target, normalized, "managed file");
  if (!existsSync(destinationFile)) {
    throw new StackError(`Cannot adopt missing file: ${normalized}`);
  }
  const currentHash = hashFile(destinationFile);
  const customized = currentHash !== pending.source_hash;
  if (pending.protected && customized) {
    throw new StackError(
      `Protected file ${normalized} must exactly match its package proposal`,
    );
  }
  installation.managed_files[normalized] = {
    source_hash: pending.source_hash,
    accepted_hash: currentHash,
    customized,
    protected: pending.protected,
    adopted_at: utcTimestamp(),
    adoption_reason: reason.trim(),
  };
  delete installation.pending_files[normalized];
  installation.updated_at = utcTimestamp();
  atomicProjectJson(
    target,
    INSTALLATION_PATH,
    installation,
    "installation manifest",
  );
  return { ok: true, path: normalized, customized };
}

function defaultCacheEnvironment() {
  const userHome = homedir();
  const candidates =
    platform() === "win32"
      ? {
          npm_config_cache: join(userHome, "AppData", "Local", "npm-cache"),
          PIP_CACHE_DIR: join(userHome, "AppData", "Local", "pip", "Cache"),
          UV_CACHE_DIR: join(userHome, "AppData", "Local", "uv", "cache"),
        }
      : platform() === "darwin"
        ? {
            GOCACHE: join(userHome, "Library", "Caches", "go-build"),
            GOMODCACHE: join(userHome, "go", "pkg", "mod"),
            npm_config_cache: join(userHome, ".npm"),
            PIP_CACHE_DIR: join(userHome, "Library", "Caches", "pip"),
            UV_CACHE_DIR: join(userHome, "Library", "Caches", "uv"),
          }
        : {
            GOCACHE: join(userHome, ".cache", "go-build"),
            GOMODCACHE: join(userHome, "go", "pkg", "mod"),
            npm_config_cache: join(userHome, ".npm"),
            PIP_CACHE_DIR: join(userHome, ".cache", "pip"),
            UV_CACHE_DIR: join(userHome, ".cache", "uv"),
          };
  return Object.fromEntries(
    Object.entries(candidates)
      .filter(([, path]) => existsSync(path)),
  );
}

function checkEnvironment(target, config) {
  const runtimeHome = projectFile(
    target,
    ".agent-stack/runtime-home",
    "quality runtime home",
  );
  const runtimeTemp = projectFile(
    target,
    ".agent-stack/runtime-tmp",
    "quality runtime temp",
  );
  mkdirSync(runtimeHome, { recursive: true });
  mkdirSync(runtimeTemp, { recursive: true });
  const environment = {};
  for (const name of SAFE_ENVIRONMENT_NAMES) {
    if (typeof process.env[name] === "string") {
      environment[name] = process.env[name];
    }
  }
  for (const name of TOOLCHAIN_ENVIRONMENT_NAMES) {
    if (typeof process.env[name] === "string") {
      environment[name] = process.env[name];
    }
  }
  Object.assign(environment, defaultCacheEnvironment());
  for (const name of config.quality?.environment?.allow ?? []) {
    if (typeof process.env[name] === "string") {
      environment[name] = process.env[name];
    }
  }
  return {
    ...environment,
    CI: "1",
    HOME: runtimeHome,
    NO_COLOR: "1",
    TMP: runtimeTemp,
    TEMP: runtimeTemp,
    TMPDIR: runtimeTemp,
    USERPROFILE: runtimeHome,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
}

function hardenCheckEnvironment(check, environment) {
  if (canonicalExecutableName(check.argv[0]) !== "git") {
    return environment;
  }
  return {
    ...environment,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "7",
    GIT_CONFIG_KEY_0: "core.fsmonitor",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "diff.external",
    GIT_CONFIG_VALUE_1: "",
    GIT_CONFIG_KEY_2: "core.pager",
    GIT_CONFIG_VALUE_2: "",
    GIT_CONFIG_KEY_3: "pager.diff",
    GIT_CONFIG_VALUE_3: "false",
    GIT_CONFIG_KEY_4: "pager.log",
    GIT_CONFIG_VALUE_4: "false",
    GIT_CONFIG_KEY_5: "pager.show",
    GIT_CONFIG_VALUE_5: "false",
    GIT_CONFIG_KEY_6: "pager.status",
    GIT_CONFIG_VALUE_6: "false",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "",
    GIT_TERMINAL_PROMPT: "0",
    PAGER: "",
  };
}

function runCheck(target, check, config) {
  const startedAt = utcTimestamp();
  const started = Date.now();
  const result = {
    id: check.id,
    argv: check.argv,
    required: check.required !== false,
    started_at: startedAt,
  };
  if (!executableExists(target, check.argv[0])) {
    return {
      ...result,
      status: "failed",
      returncode: 127,
      duration_seconds: 0,
      output: `command not found: ${check.argv[0]}`,
    };
  }
  const environment = hardenCheckEnvironment(
    check,
    checkEnvironment(target, config),
  );
  const processResult = spawnPortable(
    target,
    check.argv[0],
    check.argv.slice(1),
    {
      cwd: target,
      encoding: "utf8",
      env: environment,
      maxBuffer: CHECK_OUTPUT_LIMIT_BYTES,
      shell: false,
      timeout: (check.timeout_seconds ?? 900) * 1000,
    },
  );
  const output = [processResult.stdout, processResult.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  const timedOut = processResult.error?.code === "ETIMEDOUT";
  const outputExceeded = processResult.error?.code === "ENOBUFS";
  const returncode = timedOut
    ? 124
    : outputExceeded
      ? 125
    : (processResult.status ?? (processResult.error ? 1 : 0));
  const failureReason = timedOut
    ? "timeout"
    : outputExceeded
      ? "output-exceeded-capture-limit"
      : processResult.error
        ? "spawn-error"
        : undefined;
  const outputPrefix = timedOut
    ? "timed out"
    : outputExceeded
      ? `output exceeded ${CHECK_OUTPUT_LIMIT_BYTES}-byte capture limit`
      : "";
  const redactionValues = (config.quality?.environment?.allow ?? [])
    .map((name) => environment[name])
    .filter((value) => typeof value === "string");
  return {
    ...result,
    status: returncode === 0 ? "passed" : "failed",
    returncode,
    ...(failureReason ? { reason: failureReason } : {}),
    duration_seconds: Math.round((Date.now() - started) / 10) / 100,
    output: [
      outputPrefix,
      redact(output, 12_000, redactionValues),
    ].filter(Boolean).join("\n"),
  };
}

function commandVerify(target, failFast = false) {
  const config = loadConfig(target);
  const errors = validateConfig(config, target);
  const evidence = {
    schema_version: 1,
    command: "verify",
    started_at: utcTimestamp(),
    target,
    checks: [],
  };
  const actualChecksHash = currentChecksHash(config, target);
  let blockedBy;
  let nextSteps;
  if (config.onboarding.status !== "complete") {
    blockedBy = "setup";
    nextSteps = [
      'node .agent-stack/bin/agent-stack.mjs configure --preset simple --reason "Approved the private repository-only setup"',
      'node .agent-stack/bin/agent-stack.mjs approve-checks --reason "Inspected the configured project test commands"',
      "node .agent-stack/bin/agent-stack.mjs verify",
    ];
    errors.push(
      "Setup is incomplete. Run configure --preset simple first, then inspect and approve the project checks.",
    );
  } else if (
    config.safety.approved_configuration_hash !== configurationHash(config)
  ) {
    blockedBy = "configuration-approval";
    nextSteps = [
      "Review the configured provider, interaction, autonomy, and project-profile choices.",
      "Run node .agent-stack/bin/agent-stack.mjs configure again with the approved choices and an approval reason.",
      "Run node .agent-stack/bin/agent-stack.mjs verify again.",
    ];
    errors.push(
      "provider, interaction, autonomy, or profile choices changed or were not approved",
    );
  } else if (
    config.safety.require_check_approval !== false &&
    config.safety.approved_checks_hash !== actualChecksHash
  ) {
    blockedBy = "check-approval";
    nextSteps = [
      "Inspect the configured project test commands.",
      'Run node .agent-stack/bin/agent-stack.mjs approve-checks --reason "Inspected the configured project test commands".',
      "Run node .agent-stack/bin/agent-stack.mjs verify again.",
    ];
    errors.push(
      "quality checks changed or were not reviewed; run approve-checks after inspecting them",
    );
  }
  if (errors.length > 0) {
    evidence.ok = false;
    evidence.configuration_errors = errors;
    if (blockedBy) {
      evidence.blocked_by = blockedBy;
      evidence.next_steps = nextSteps;
    }
  } else {
    for (const check of config.quality.checks) {
      const record = runCheck(target, check, config);
      evidence.checks.push(record);
      if (record.status === "failed" && failFast) {
        break;
      }
    }
    evidence.ok =
      evidence.checks.length === config.quality.checks.length &&
      evidence.checks.every(
        (record) => record.status === "passed" || !record.required,
      );
  }
  evidence.git_after = gitSnapshot(target);
  evidence.finished_at = utcTimestamp();
  const evidenceDirectory = pathInside(
    target,
    config.quality.evidence_directory ?? RUNS_PATH,
    "quality.evidence_directory",
  );
  mkdirSync(evidenceDirectory, { recursive: true });
  const evidenceFile = join(
    evidenceDirectory,
    `${filenameTimestamp()}-verify.json`,
  );
  atomicJson(evidenceFile, evidence);
  atomicJson(join(evidenceDirectory, "latest.json"), evidence);
  return {
    ok: evidence.ok,
    evidence: relative(target, evidenceFile),
    checks: evidence.checks.map((record) => ({
      id: record.id,
      status: record.status,
      returncode: record.returncode,
      ...(record.reason ? { reason: record.reason } : {}),
    })),
    git: evidence.git_after,
    configuration_errors: evidence.configuration_errors,
    ...(evidence.blocked_by
      ? {
          blocked_by: evidence.blocked_by,
          next_steps: evidence.next_steps,
        }
      : {}),
  };
}

function verificationReadiness(target, config, git) {
  const reasons = [];
  if (!config) {
    reasons.push("project configuration is missing");
  }
  if (!git || git.clean !== true || !GIT_OBJECT_ID.test(git.head ?? "")) {
    reasons.push("current Git state is not a clean exact commit");
  }
  let evidence = null;
  let evidencePath = null;
  if (config) {
    try {
      evidencePath = config.quality?.evidence_directory ?? RUNS_PATH;
      const file = projectFileWithoutSymlinkComponents(
        target,
        `${evidencePath}/latest.json`,
        "latest verification evidence",
      );
      evidence = readJson(file, "latest verification evidence");
    } catch (error) {
      reasons.push(error.message);
    }
  }
  if (evidence) {
    if (evidence.schema_version !== 1 || evidence.command !== "verify") {
      reasons.push("latest verification evidence is not stack-generated verify evidence");
    }
    if (evidence.ok !== true) {
      reasons.push("latest verification did not pass");
    }
    if (!evidence.git_after || typeof evidence.git_after !== "object") {
      reasons.push("latest verification lacks post-check Git evidence");
    } else {
      const recordedGit = evidence.git_after;
      if (
        recordedGit.head !== git?.head ||
        recordedGit.object_format !== git?.object_format ||
        recordedGit.clean !== true
      ) {
        reasons.push("latest verification is stale or does not prove a clean current Git head");
      }
    }
    if (!Array.isArray(evidence.checks)) {
      reasons.push("latest verification checks must be an array");
    } else if (
      config.quality?.checks?.some(
        (check) =>
          check.required === true &&
          !evidence.checks.some(
            (record) => record.id === check.id && record.status === "passed",
          ),
      )
    ) {
      reasons.push("latest verification lacks a passed required check");
    }
  }
  return {
    ok: reasons.length === 0,
    status: reasons.length === 0 ? "passed" : "blocked",
    evidence: evidencePath ? `${evidencePath}/latest.json` : null,
    git: evidence?.git_after ?? null,
    reasons: [...new Set(reasons)],
  };
}

function loadState(target) {
  const file = projectFile(target, STATE_PATH, "delivery state");
  if (!existsSync(file)) {
    return { schema_version: 1, active_lock: null, history: [] };
  }
  const state = readJson(file, "delivery state");
  state.schema_version ??= 1;
  state.active_lock ??= null;
  state.history ??= [];
  return state;
}

function gitSnapshot(target) {
  if (!isGitRepository(target)) {
    return null;
  }
  const headResult = hardenedGitProbe(target, ["rev-parse", "HEAD"]);
  const objectFormatResult = hardenedGitProbe(target, [
    "rev-parse",
    "--show-object-format=storage",
  ]);
  const branchResult = hardenedGitProbe(target, ["branch", "--show-current"]);
  const statusResult = hardenedGitProbe(target, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  const statusOk = statusResult.status === 0;
  const head = headResult.status === 0 ? headResult.stdout.trim() : null;
  const objectFormat =
    objectFormatResult.status === 0 &&
    GIT_OBJECT_FORMATS.has(objectFormatResult.stdout.trim())
      ? objectFormatResult.stdout.trim()
      : head?.length === 40
        ? "sha1"
        : head?.length === 64
          ? "sha256"
          : null;
  const statusLines = statusOk
    ? statusResult.stdout.split("\n").filter(Boolean)
    : ["<git status failed>"];
  return {
    head,
    object_format: objectFormat,
    branch:
      branchResult.status === 0 && branchResult.stdout.trim().length > 0
        ? branchResult.stdout.trim()
        : null,
    tracked_changes: statusLines.filter((line) => !line.startsWith("??"))
      .length,
    untracked_changes: statusLines.filter((line) => line.startsWith("??"))
      .length,
    clean:
      headResult.status === 0 &&
      GIT_OBJECT_ID.test(head ?? "") &&
      statusOk &&
      statusLines.length === 0,
  };
}

function readCoordinator(target) {
  const file = projectFile(target, COORDINATOR_PATH, "coordinator lease");
  if (!existsSync(file)) {
    return null;
  }
  const lease = readJson(file, "coordinator lease");
  const valid =
    lease.schema_version === 1 &&
    typeof lease.coordinator_id === "string" &&
    typeof lease.token_hash === "string" &&
    /^[a-f0-9]{64}$/.test(lease.token_hash) &&
    typeof lease.checkout_hash === "string" &&
    typeof lease.acquired_at === "string" &&
    typeof lease.heartbeat_at === "string" &&
    typeof lease.expires_at === "string" &&
    Number.isFinite(Date.parse(lease.expires_at));
  if (!valid) {
    throw new StackError(
      `Invalid ${COORDINATOR_PATH}. Ask the coding agent to inspect it before recovering the lease.`,
    );
  }
  return lease;
}

function coordinatorActive(lease, now = Date.now()) {
  return Boolean(lease) && Date.parse(lease.expires_at) > now;
}

function publicCoordinator(lease, now = Date.now()) {
  if (!lease) {
    return { state: "available", active: false, lease: null };
  }
  const active = coordinatorActive(lease, now);
  return {
    state: active ? "active" : "stale",
    active,
    lease: {
      coordinator_id: lease.coordinator_id,
      host: lease.host,
      checkout_hash: lease.checkout_hash,
      acquired_at: lease.acquired_at,
      heartbeat_at: lease.heartbeat_at,
      expires_at: lease.expires_at,
      git: lease.git,
      ...(lease.takeover ? { takeover: lease.takeover } : {}),
    },
  };
}

function withCoordinatorMutex(target, operation) {
  const mutex = projectFile(
    target,
    COORDINATOR_MUTEX_PATH,
    "coordinator mutex",
  );
  mkdirSync(dirname(mutex), { recursive: true });
  const marker = `${stableJson({
    pid: process.pid,
    created_at: utcTimestamp(),
    nonce: randomBytes(12).toString("hex"),
  })}\n`;
  const createMutex = () => {
    writeFileSync(mutex, marker, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  };
  const openMutex = () => {
    try {
      createMutex();
      return;
    } catch (error) {
      if (error.code === "EEXIST") {
        let age;
        let observedMarker;
        try {
          observedMarker = readFileSync(mutex, "utf8");
          age = Date.now() - statSync(mutex).mtimeMs;
        } catch (statError) {
          if (statError.code === "ENOENT") {
            createMutex();
            return;
          }
          throw statError;
        }
        if (age > COORDINATOR_MUTEX_STALE_MS) {
          let currentMarker;
          try {
            currentMarker = readFileSync(mutex, "utf8");
          } catch (readError) {
            if (readError.code === "ENOENT") {
              createMutex();
              return;
            }
            throw readError;
          }
          if (currentMarker === observedMarker) {
            try {
              unlinkSync(mutex);
              createMutex();
              return;
            } catch (reclaimError) {
              if (
                reclaimError.code !== "ENOENT" &&
                reclaimError.code !== "EEXIST"
              ) {
                throw reclaimError;
              }
            }
          }
        }
      }
      if (error.code === "EEXIST") {
        throw new StackError(
          "Another coordinator lease operation is in progress. Retry in a moment.",
        );
      }
      throw error;
    }
  };
  openMutex();
  try {
    return operation();
  } finally {
    try {
      if (readFileSync(mutex, "utf8") === marker) {
        unlinkSync(mutex);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        process.stderr.write(
          `Warning: failed to release coordinator mutex: ${redact(error.message, 500)}\n`,
        );
      }
    }
  }
}

function coordinatorTokenValid(lease, token) {
  return (
    typeof token === "string" &&
    token.length >= 32 &&
    sha256(token) === lease.token_hash
  );
}

function createCoordinatorLease(target, now = Date.now()) {
  const token = randomBytes(32).toString("hex");
  const acquiredAt = new Date(now).toISOString();
  const lease = {
    schema_version: 1,
    coordinator_id: `steward-${randomBytes(6).toString("hex")}`,
    token_hash: sha256(token),
    checkout_hash: sha256(realpathSync(target)),
    host: hostname(),
    acquired_at: acquiredAt,
    heartbeat_at: acquiredAt,
    expires_at: new Date(
      now + COORDINATOR_TTL_SECONDS * 1000,
    ).toISOString(),
    git: gitSnapshot(target),
  };
  return { lease, token };
}

function acquireCoordinator(target, suppliedToken = undefined) {
  return withCoordinatorMutex(target, () => {
    const now = Date.now();
    const existing = readCoordinator(target);
    if (coordinatorActive(existing, now)) {
      if (!coordinatorTokenValid(existing, suppliedToken)) {
        throw new StackError(
          `Another Project Steward (${existing.coordinator_id}) is active in this checkout until ${existing.expires_at}. Continue in that conversation or wait for the lease to become stale.`,
          3,
          publicCoordinator(existing, now),
        );
      }
      existing.heartbeat_at = new Date(now).toISOString();
      existing.expires_at = new Date(
        now + COORDINATOR_TTL_SECONDS * 1000,
      ).toISOString();
      existing.git = gitSnapshot(target);
      atomicProjectJson(
        target,
        COORDINATOR_PATH,
        existing,
        "coordinator lease",
      );
      return {
        ...publicCoordinator(existing, now),
        resumed: true,
        coordinator_token: suppliedToken,
      };
    }

    const { lease, token } = createCoordinatorLease(target, now);
    atomicProjectJson(target, COORDINATOR_PATH, lease, "coordinator lease");
    return {
      ...publicCoordinator(lease, now),
      resumed: false,
      replaced_stale_lease: Boolean(existing),
      coordinator_token: token,
    };
  });
}

function commandCoordinator(target, action, options = {}) {
  if (action === "status") {
    return { ok: true, ...publicCoordinator(readCoordinator(target)) };
  }
  if (action === "heartbeat") {
    const coordinator = acquireCoordinator(target, options.token);
    return { ok: true, ...coordinator };
  }
  if (action === "release") {
    return withCoordinatorMutex(target, () => {
      const lease = readCoordinator(target);
      if (!lease) {
        return { ok: true, state: "available", released: false };
      }
      if (!coordinatorTokenValid(lease, options.token)) {
        throw new StackError(
          "Only the active Project Steward can release this checkout.",
          3,
        );
      }
      unlinkSync(projectFile(target, COORDINATOR_PATH, "coordinator lease"));
      return {
        ok: true,
        state: "available",
        released: true,
        coordinator_id: lease.coordinator_id,
      };
    });
  }
  if (action === "takeover") {
    if (options.confirmStopped !== true) {
      throw new StackError(
        "Takeover requires --confirm-stopped after the user confirms the previous Project Steward is no longer working.",
        3,
      );
    }
    if (typeof options.reason !== "string" || options.reason.trim().length < 12) {
      throw new StackError(
        "Takeover reason must explain why the previous coordinator is no longer active.",
        3,
      );
    }
    return withCoordinatorMutex(target, () => {
      const previous = readCoordinator(target);
      if (!previous || !coordinatorActive(previous)) {
        throw new StackError(
          "No active coordinator requires takeover. Run start to acquire the available checkout.",
          3,
        );
      }
      const now = Date.now();
      const { lease, token } = createCoordinatorLease(target, now);
      lease.takeover = {
        previous_coordinator_id: previous.coordinator_id,
        replaced_at: new Date(now).toISOString(),
        reason: options.reason.trim(),
      };
      atomicProjectJson(target, COORDINATOR_PATH, lease, "coordinator lease");
      return {
        ok: true,
        ...publicCoordinator(lease, now),
        resumed: false,
        takeover: true,
        replaced: previous
          ? {
              coordinator_id: previous.coordinator_id,
              expires_at: previous.expires_at,
            }
          : null,
        reason: options.reason.trim(),
        coordinator_token: token,
      };
    });
  }
  throw new StackError(
    "Coordinator action must be status, heartbeat, release, or takeover.",
  );
}

function requireCoordinator(target, token) {
  const lease = readCoordinator(target);
  if (!coordinatorActive(lease)) {
    throw new StackError(
      "No active Project Steward owns this checkout. Run start before writing a checkpoint.",
      3,
    );
  }
  if (!coordinatorTokenValid(lease, token)) {
    throw new StackError(
      `Another Project Steward (${lease.coordinator_id}) owns this checkout. Do not write from an independent conversation.`,
      3,
    );
  }
  return acquireCoordinator(target, token);
}

function validateCheckpointText(value, label, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new StackError(`${label} is required`);
    }
    return null;
  }
  const normalized = String(value).trim();
  if (
    normalized.length === 0 ||
    normalized.length > 1_000 ||
    /[\r\n\0]/.test(normalized)
  ) {
    throw new StackError(
      `${label} must be a single line between 1 and 1000 characters`,
    );
  }
  SECRET_ASSIGNMENT.lastIndex = 0;
  if (SECRET_ASSIGNMENT.test(normalized) || SECRET_LIKE_TEXT.test(normalized)) {
    throw new StackError(
      `${label} appears to contain a secret. Store only a redacted reference.`,
    );
  }
  SECRET_ASSIGNMENT.lastIndex = 0;
  return normalized;
}

function checkpointMarkdown(checkpoint) {
  const escape = (value) => value.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
  const section = (title, values, empty = "None.") => [
    `## ${title}`,
    "",
    ...(values.length > 0
      ? values.map((value) => `- ${escape(value)}`)
      : [empty]),
    "",
  ];
  const git = checkpoint.git
    ? [
        `- Branch: ${checkpoint.git.branch ?? "detached"}`,
        `- Commit: ${checkpoint.git.head ?? "unavailable"}`,
        `- Working tree: ${checkpoint.git.clean ? "clean" : "has changes"}`,
        `- Tracked changes: ${checkpoint.git.tracked_changes}`,
        `- Untracked changes: ${checkpoint.git.untracked_changes}`,
      ]
    : ["- Git state: unavailable"];
  return [
    "# Project Checkpoint",
    "",
    "This is the current deterministic handoff written by Ultimate Agent Stack.",
    "Repository evidence remains authoritative; optional memory is only a searchable mirror.",
    "",
    `- Checkpoint: \`${checkpoint.checkpoint_id}\``,
    `- Updated: ${checkpoint.updated_at}`,
    `- Status: ${checkpoint.status}`,
    `- Objective: ${escape(checkpoint.objective)}`,
    `- Summary: ${escape(checkpoint.summary)}`,
    "",
    ...section("Completed", checkpoint.completed),
    ...section("Decisions", checkpoint.decisions),
    ...section("Next Steps", checkpoint.next_steps),
    ...section("Blockers", checkpoint.blockers),
    ...section("Evidence", checkpoint.evidence),
    "## Git",
    "",
    ...git,
    "",
  ].join("\n");
}

function commandCheckpoint(target, options) {
  const coordinator = requireCoordinator(target, options.token);
  const status = options.status ?? "in_progress";
  if (!["in_progress", "blocked", "complete"].includes(status)) {
    throw new StackError(
      "--status must be in_progress, blocked, or complete",
    );
  }
  const objective = validateCheckpointText(
    options.objective,
    "--objective",
    { required: true },
  );
  const summary = validateCheckpointText(options.summary, "--summary", {
    required: true,
  });
  const normalizeList = (values, label) =>
    values.map((value) => validateCheckpointText(value, label));
  const completed = normalizeList(options.completed ?? [], "--completed");
  const decisions = normalizeList(options.decisions ?? [], "--decision");
  const nextSteps = normalizeList(options.nextSteps ?? [], "--next");
  const blockers = normalizeList(options.blockers ?? [], "--blocker");
  if (status !== "complete" && nextSteps.length === 0) {
    throw new StackError(
      "An in-progress or blocked checkpoint requires at least one --next step.",
    );
  }
  if (status === "blocked" && blockers.length === 0) {
    throw new StackError(
      "A blocked checkpoint requires at least one --blocker.",
    );
  }
  const evidence = [...new Set(options.evidence ?? [])]
    .map((item) => {
      const normalized = validateCheckpointText(item, "--evidence", {
        required: true,
      });
      const file = projectFile(target, normalized, "checkpoint evidence");
      if (!existsSync(file) || !statSync(file).isFile()) {
        throw new StackError(
          `Checkpoint evidence must be an existing project file: ${normalized}`,
        );
      }
      return relative(target, file).split(sep).join("/");
    })
    .sort();
  const git = gitSnapshot(target);
  const body = {
    schema_version: 1,
    status,
    objective,
    summary,
    completed,
    decisions,
    next_steps: nextSteps,
    blockers,
    evidence,
    git,
  };
  const checkpoint = {
    ...body,
    checkpoint_id: sha256(stableJson(body)),
    updated_at: utcTimestamp(),
    coordinator_id: coordinator.lease.coordinator_id,
  };
  atomicProjectJson(
    target,
    CHECKPOINT_PATH,
    checkpoint,
    "project checkpoint",
  );
  atomicProjectText(
    target,
    CHECKPOINT_MARKDOWN_PATH,
    checkpointMarkdown(checkpoint),
    "project checkpoint handoff",
  );

  const config = loadConfig(target);
  let memoryCapture = {
    provider: config.capabilities.knowledge.provider,
    status: "repository-only",
  };
  if (
    config.capabilities.knowledge.provider === "gbrain" &&
    config.capabilities.knowledge.scope === "project"
  ) {
    const health = commandMemoryHealth(target, config);
    if (health.ok) {
      const capture = parseProviderJson(
        runGbrain(
          target,
          [
            "capture",
            "--file",
            projectFile(
              target,
              CHECKPOINT_MARKDOWN_PATH,
              "project checkpoint handoff",
            ),
            "--slug",
            GBRAIN_CHECKPOINT_SLUG,
            "--type",
            "project",
            "--json",
          ],
          30_000,
        ),
        "gbrain checkpoint capture",
      );
      memoryCapture = capture.ok
        ? {
            provider: "gbrain",
            status: "mirrored",
            slug: capture.value?.slug ?? GBRAIN_CHECKPOINT_SLUG,
          }
        : {
            provider: "gbrain",
            status: "fallback",
            error: capture.error,
            detail: capture.detail,
          };
    } else {
      memoryCapture = {
        provider: "gbrain",
        status: "fallback",
        error: health.error,
      };
    }
  }
  return {
    ok: true,
    checkpoint: CHECKPOINT_PATH,
    handoff: CHECKPOINT_MARKDOWN_PATH,
    checkpoint_id: checkpoint.checkpoint_id,
    memory_capture: memoryCapture,
    coordinator,
  };
}

function markdownFenceProbeLine(line) {
  let probe = line;
  while (true) {
    const blockquote = probe.match(/^ {0,3}>[ \t]?/);
    if (blockquote) {
      probe = probe.slice(blockquote[0].length);
      continue;
    }
    const list = probe.match(
      /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/,
    );
    if (list) {
      probe = probe.slice(list[0].length);
      continue;
    }
    return probe;
  }
}

function markdownOutsideFencedCode(content, artifact) {
  const visible = [];
  let fence = null;
  for (const line of content.split(/\r?\n/)) {
    if (fence) {
      const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (
        closing &&
        closing[1][0] === fence.character &&
        closing[1].length >= fence.length
      ) {
        fence = null;
      }
      visible.push("");
      continue;
    }
    const probeLine = markdownFenceProbeLine(line);
    const opening = probeLine.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening) {
      if (opening[1][0] === "`" && opening[2].includes("`")) {
        throw new StackError(
          `Cannot lock ${artifact}; invalid backtick in fenced code info string prevents safe declaration checks`,
        );
      }
      if (probeLine !== line) {
        throw new StackError(
          `Cannot lock ${artifact}; nested fenced code block prevents safe declaration checks`,
        );
      }
      fence = {
        character: opening[1][0],
        length: opening[1].length,
      };
      visible.push("");
      continue;
    }
    visible.push(line);
  }
  if (fence) {
    throw new StackError(
      `Cannot lock ${artifact}; unclosed fenced code block prevents safe declaration checks`,
    );
  }
  return visible.join("\n");
}

function artifactDeclarationValues(content, pattern) {
  return [...content.matchAll(pattern)].map((match) =>
    match[1].trim().toUpperCase(),
  );
}

function commandLock(target, artifacts) {
  const config = loadConfig(target);
  const errors = validateConfig(config, target);
  if (errors.length > 0) {
    throw new StackError("Cannot lock with invalid config", 2, errors);
  }
  const selected = artifacts.length > 0 ? artifacts : config.lock_artifacts;
  const hashes = {};
  for (const artifact of selected) {
    const file = pathInside(target, artifact, "lock artifact");
    if (!existsSync(file) || !statSync(file).isFile()) {
      throw new StackError(`Cannot lock missing artifact: ${artifact}`);
    }
    const content = readFileSync(file, "utf8");
    const declarations = markdownOutsideFencedCode(content, artifact);
    const statuses = artifactDeclarationValues(
      declarations,
      ARTIFACT_STATUS_DECLARATION,
    );
    if (statuses.includes("DRAFT")) {
      throw new StackError(
        `Cannot lock ${artifact}; artifact status is DRAFT`,
      );
    }
    if (statuses.length !== 1 || statuses[0] !== "APPROVED") {
      throw new StackError(
        `Cannot lock ${artifact}; expected exactly one visible Status: APPROVED declaration`,
      );
    }
    const conflicts = artifactDeclarationValues(
      declarations,
      MATERIAL_CONFLICTS_DECLARATION,
    );
    if (conflicts.includes("YES")) {
      throw new StackError(
        `Cannot lock ${artifact}; material open conflicts remain`,
      );
    }
    if (conflicts.length !== 1 || conflicts[0] !== "NO") {
      throw new StackError(
        `Cannot lock ${artifact}; expected exactly one visible Material open conflicts: NO declaration`,
      );
    }
    const unresolvedPlaceholders = [
      ...new Set(content.match(PLACEHOLDER) ?? []),
    ].sort();
    if (unresolvedPlaceholders.length > 0) {
      const placeholders = unresolvedPlaceholders
        .slice(0, 20)
        .map((placeholder) =>
          placeholder.length > 200
            ? `${placeholder.slice(0, 197)}...`
            : placeholder,
        );
      const remainder =
        unresolvedPlaceholders.length > placeholders.length
          ? ` (+${unresolvedPlaceholders.length - placeholders.length} more)`
          : "";
      throw new StackError(
        `Cannot lock ${artifact}; unresolved placeholders: ${placeholders.join(", ")}${remainder}`,
      );
    }
    hashes[artifact] = hashFile(file);
  }
  const state = loadState(target);
  if (state.active_lock) {
    state.history.push({
      ...state.active_lock,
      closed_at: utcTimestamp(),
      close_reason: "superseded by new lock",
    });
  }
  state.active_lock = { locked_at: utcTimestamp(), artifacts: hashes };
  atomicProjectJson(target, STATE_PATH, state, "delivery state");
  return { ok: true, artifacts: hashes };
}

function lockDifferences(target, lock) {
  const differences = [];
  for (const [artifact, expected] of Object.entries(lock.artifacts ?? {})) {
    const file = pathInside(target, artifact, "lock artifact");
    if (!existsSync(file)) {
      differences.push(`missing: ${artifact}`);
    } else if (hashFile(file) !== expected) {
      differences.push(`changed: ${artifact}`);
    }
  }
  return differences;
}

function commandCheckLock(target) {
  const state = loadState(target);
  if (!state.active_lock) {
    return { ok: false, error: "no active artifact lock" };
  }
  const differences = lockDifferences(target, state.active_lock);
  return {
    ok: differences.length === 0,
    locked_at: state.active_lock.locked_at,
    differences,
  };
}

function commandUnlock(target, reason) {
  if (typeof reason !== "string" || reason.trim().length < 12) {
    throw new StackError("Unlock reason must explain the material change.");
  }
  const state = loadState(target);
  if (!state.active_lock) {
    throw new StackError("No active artifact lock");
  }
  state.history.push({
    ...state.active_lock,
    closed_at: utcTimestamp(),
    close_reason: reason.trim(),
  });
  state.active_lock = null;
  atomicProjectJson(target, STATE_PATH, state, "delivery state");
  return { ok: true, reason: reason.trim() };
}

function loadCheckpoint(target) {
  const file = projectFile(target, CHECKPOINT_PATH, "project checkpoint");
  if (!existsSync(file)) {
    return null;
  }
  const checkpoint = readJson(file, "project checkpoint");
  const allowed = new Set([
    "schema_version",
    "status",
    "objective",
    "summary",
    "completed",
    "decisions",
    "next_steps",
    "blockers",
    "evidence",
    "git",
    "checkpoint_id",
    "updated_at",
    "coordinator_id",
  ]);
  const unknown = Object.keys(checkpoint).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new StackError(
      `Project checkpoint contains unsupported fields: ${unknown.join(", ")}`,
    );
  }
  if (
    checkpoint.schema_version !== 1 ||
    !["in_progress", "blocked", "complete"].includes(checkpoint.status) ||
    !Array.isArray(checkpoint.completed) ||
    !Array.isArray(checkpoint.decisions) ||
    !Array.isArray(checkpoint.next_steps) ||
    !Array.isArray(checkpoint.blockers) ||
    !Array.isArray(checkpoint.evidence)
  ) {
    throw new StackError(
      `Invalid ${CHECKPOINT_PATH}. Create a new checkpoint with the CLI rather than editing it manually.`,
    );
  }
  validateCheckpointText(checkpoint.objective, "checkpoint objective", {
    required: true,
  });
  validateCheckpointText(checkpoint.summary, "checkpoint summary", {
    required: true,
  });
  for (const [name, values] of [
    ["completed", checkpoint.completed],
    ["decisions", checkpoint.decisions],
    ["next_steps", checkpoint.next_steps],
    ["blockers", checkpoint.blockers],
    ["evidence", checkpoint.evidence],
  ]) {
    for (const value of values) {
      validateCheckpointText(value, `checkpoint ${name}`, { required: true });
    }
  }
  const body = {
    schema_version: checkpoint.schema_version,
    status: checkpoint.status,
    objective: checkpoint.objective,
    summary: checkpoint.summary,
    completed: checkpoint.completed,
    decisions: checkpoint.decisions,
    next_steps: checkpoint.next_steps,
    blockers: checkpoint.blockers,
    evidence: checkpoint.evidence,
    git: checkpoint.git ?? null,
  };
  if (
    typeof checkpoint.checkpoint_id !== "string" ||
    checkpoint.checkpoint_id !== sha256(stableJson(body))
  ) {
    throw new StackError(
      `Project checkpoint integrity check failed. Recreate ${CHECKPOINT_PATH} with the checkpoint command.`,
    );
  }
  return checkpoint;
}

function testConfiguredMemory(target, config, health, checkpoint) {
  if (config.capabilities.knowledge.provider === "repository") {
    return health;
  }
  if (!health.ok || !checkpoint) {
    return {
      ...health,
      checkpoint_test: checkpoint ? "not-run" : "not-applicable",
    };
  }
  const retrieval = parseProviderJson(
    runGbrain(
      target,
      [
        "call",
        "get_page",
        JSON.stringify({ slug: GBRAIN_CHECKPOINT_SLUG }),
      ],
      15_000,
    ),
    "gbrain checkpoint retrieval",
  );
  const serialized = retrieval.ok ? stableJson(retrieval.value) : "";
  const current =
    retrieval.ok && serialized.includes(checkpoint.checkpoint_id);
  return {
    ...health,
    ok: health.ok && current,
    checkpoint_test: current ? "passed" : "failed",
    checkpoint_id: checkpoint.checkpoint_id,
    ...(current
      ? {}
      : {
          checkpoint_error: retrieval.ok
            ? "GBrain checkpoint does not match repository checkpoint"
            : retrieval.error,
        }),
  };
}

function commandStatus(target, runId) {
  const installation = loadInstallation(target);
  const config = projectExists(target, CONFIG_PATH, "project config")
    ? loadConfig(target)
    : null;
  const state = loadState(target);
  const pending = Object.keys(installation?.pending_files ?? {});
  const drift = protectedDrift(target, installation);
  const actualChecksHash = config ? currentChecksHash(config, target) : null;
  const actualConfigurationHash = config
    ? configurationHash(config)
    : null;
  let checkpoint = null;
  try {
    const loadedCheckpoint = projectExists(
      target,
      CHECKPOINT_PATH,
      "project checkpoint",
    )
      ? loadCheckpoint(target)
      : null;
    checkpoint = loadedCheckpoint
      ? {
          id: loadedCheckpoint.checkpoint_id,
          status: loadedCheckpoint.status,
          updated_at: loadedCheckpoint.updated_at,
        }
      : null;
  } catch (error) {
    checkpoint = { error: error.message };
  }
  let coordinator;
  try {
    coordinator = publicCoordinator(readCoordinator(target));
  } catch (error) {
    coordinator = { error: error.message };
  }
  let review = null;
  let readiness = {
    independent_reviewed: false,
    review_gate_ready: false,
    pr_ready: false,
    status: "blocked",
    reasons: ["a run id is required to evaluate review readiness"],
  };
  if (runId !== undefined) {
    try {
      review = commandReviewStatus(target, runId);
      readiness = {
        independent_reviewed: review.independent_reviewed,
        review_gate_ready: review.review_gate_ready,
        pr_ready: false,
        status: review.status,
        reasons: review.reasons,
      };
    } catch (error) {
      review = {
        ok: false,
        command: "review status",
        run_id: runId,
        independent_reviewed: false,
        review_gate_ready: false,
        pr_ready: false,
        status: "blocked",
        reasons: [error.message],
      };
      readiness = {
        independent_reviewed: false,
        review_gate_ready: false,
        pr_ready: false,
        status: "blocked",
        reasons: [error.message],
      };
    }
  }
  const projectHealthy =
    Boolean(installation && config) &&
    pending.length === 0 &&
    drift.length === 0 &&
    config?.onboarding?.status === "complete" &&
    config?.safety?.approved_configuration_hash === actualConfigurationHash &&
    !checkpoint?.error &&
    !coordinator?.error;
  const verification =
    runId === undefined
      ? null
      : verificationReadiness(target, config, gitSnapshot(target));
  if (runId !== undefined) {
    const reviewGateReady = review?.review_gate_ready === true;
    const prReady = projectHealthy && verification?.ok === true && reviewGateReady;
    readiness = {
      ...readiness,
      review_gate_ready: reviewGateReady,
      pr_ready: prReady,
      status: prReady ? "passed" : "blocked",
      reasons: [
        ...(review?.reasons ?? []),
        ...(verification?.reasons ?? []),
      ],
    };
  }
  return {
    ok:
      runId === undefined
        ? projectHealthy
        : projectHealthy &&
          verification?.ok === true &&
          review?.review_gate_ready === true,
    package_available: { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    installed: installation?.package ?? null,
    upgrade_available:
      Boolean(installation?.package?.version) &&
      installation.package.version !== PACKAGE_VERSION,
    pending_reconciliation: pending,
    protected_drift: drift,
    checks_approved:
      Boolean(config) &&
      config.safety?.approved_checks_hash === actualChecksHash,
    onboarding: config?.onboarding ?? null,
    capabilities: config?.capabilities ?? null,
    configuration_approved:
      Boolean(config) &&
      config.safety?.approved_configuration_hash === actualConfigurationHash,
    active_lock: state.active_lock?.locked_at ?? null,
    checkpoint,
    coordinator,
    ...(review ? { review } : {}),
    ...(verification ? { verification } : {}),
    readiness,
  };
}

function onboardingStartPrompt(request) {
  return `Read AGENTS.md, .agent-stack/core-policy.json, .agent-stack/HANDOFF.md, .agent-stack/config.json, and any valid .agent-stack/CHECKPOINT.md. Inspect the repository and run the capabilities command. Complete Ultimate Agent Stack onboarding before material implementation.\n\nAsk only consequential setup decisions, one at a time. For each decision use plain language, state one recommended choice, provide at most one genuinely safe alternative, explain the practical consequence, and accept "use the recommendation" as an answer. A question asking for acceptance ends the turn; do not continue until the user answers. A prior explicit instruction such as "use your recommended safe setup" is already approval and must not trigger the same question again. Never invent an unsafe alternative. Prefer repository evidence and safe defaults over questions.\n\nWhen repository evidence does not require an existing external provider or a production-specific review policy and the user has not requested a relevant advanced provider, make this one combined recommendation: "I recommend the private repository-only setup. It uses no outside memory, tracking, or telemetry, and you retain merge control. Use this?" If the user approves, run configure --preset simple with an approval reason and do not separately ask about GBrain, Linear, telemetry, review providers, data policy, or merge authority. The reason records conversational approval; it does not cryptographically authenticate the approver.\n\nReveal an advanced choice only when the project already uses it and repository evidence makes it relevant, the user explicitly requests it, or a real requirement cannot be met locally. Ask only that relevant question. Repository checkpoints remain authoritative if optional GBrain is selected. The repository work ledger remains authoritative if optional Linear is selected. Telemetry is limited to an existing reviewed provider needed for a concrete operational question; never install instrumentation implicitly. Provider credentials, external writes, billing, and broader data scope remain separate human authority steps.\n\nConfigure the approved choices with the non-interactive configure command. Then run doctor and continue with this request: ${request}`;
}

function deliveryStartPrompt({
  request,
  continuity,
  workProvider,
  knowledgeProvider,
  knowledgeScope,
  telemetryGuidance,
}) {
  return [
    `Read AGENTS.md, .agent-stack/core-policy.json, .agent-stack/HANDOFF.md, .agent-stack/config.json, .agent-stack/work-items.json, .agent-stack/evidence-graph.json, any valid .agent-stack/CHECKPOINT.md, and the installed skills. For end-to-end delivery or RESUME, use $run-autonomous-delivery for this request: ${request} For a request explicitly limited to brief refinement, source audit, or reconciliation, use $develop-project-brief directly and stop before delivery. For explanation-only work, use neither.`,
    continuity,
    `Inspect the project first. Apply $manage-project-work when shaping or selecting real work, checking provider-write readiness, reporting or diagramming work evidence, or handling a bounded campaign. Validate the configured ${workProvider} repository ledger and graph, select only bounded ready work, and keep completion tied to real evidence. The start command already tested the configured work provider. If it is unavailable or unhealthy, continue from the repository ledger and record synchronization as pending; never block safe local delivery or infer remote state. Apply $use-project-knowledge using the configured ${knowledgeProvider} provider at ${knowledgeScope} scope, with repository evidence as the source of truth and fallback. The start command already tested configured memory; if its result is unhealthy or the checkpoint mirror is stale, continue from the repository and repair the optional adapter without blocking delivery. The start command also tested configured telemetry identity and scope; if it is unavailable or unhealthy, use repository evidence and do not broaden provider scope. ${telemetryGuidance} Use $coordinate-parallel-delivery to manage independent subagent work when it is safe and useful; keep it serial otherwise. You are the one Project Steward and integration owner. Do not give the coordinator token to subagents, and do not make the user manage workers.`,
    `Route intake in this order: RESUME for a valid non-complete checkpoint or active lock with an unmet done/evidence condition; EXTERNAL when substantial supplied material defines product intent or an existing plan; DISCOVER for vague, contradictory, exploratory, or greenfield product/system intent that needs development; DIRECT for a clear bounded testable request. Completed state does not hijack a new request. A supporting screenshot, log, or attachment does not turn bounded work into EXTERNAL, and clear bounded work remains DIRECT in a new or empty repository. Apply $develop-project-brief only for EXTERNAL or DISCOVER, or directly when the user explicitly limits the request to brief refinement, source audit, or reconciliation. DIRECT keeps the proportionate micro-brief path, and RESUME continues from the first unmet condition without reopening closed decisions. The controller owns routine implementation and verification without requiring nested native phase activations. A request explicitly limited to implementation may use $build-vertical-slice directly; a request explicitly limited to verification may use $verify-change directly. Apply $close-review-loop only for an existing pull request or an external provider or human review thread. Research routine answers. Ask only consequential questions, one at a time. Each question must use plain language, recommend one safe choice, provide at most one genuinely useful safe alternative, explain the consequence, and allow "use the recommendation." A question that asks for acceptance ends the turn; do not continue as though the recommendation approved itself. Own all routine implementation and verification. Artifact status is only DRAFT or APPROVED, and lock state exists only in protected CLI state. A failed guard never authorizes changing prerequisites. Do not claim added, read-complete, reviewed, locked, or ready state without path and command/result evidence. Write a deterministic checkpoint after verified milestones and release the coordinator lease only at final handoff.`,
  ].join("\n\n");
}

function checkpointContinuityPrompt(checkpoint) {
  if (!checkpoint) {
    return "No checkpoint exists yet. Create one after the first verified delivery milestone.";
  }
  if (checkpoint.status === "complete") {
    return `Completed checkpoint ${checkpoint.checkpoint_id} is historical context only: ${checkpoint.summary} Do not resume it or let it hijack the current request. Route the current request normally unless a newer unfinished checkpoint or an active lock with an unmet done/evidence condition exists.`;
  }
  return `Resume checkpoint ${checkpoint.checkpoint_id}: ${checkpoint.summary} Next steps: ${checkpoint.next_steps.join("; ") || "none recorded"}.`;
}

function startPromptPolicySurface() {
  const sampleCheckpoint = {
    checkpoint_id: "<CHECKPOINT_ID>",
    summary: "<CHECKPOINT_SUMMARY>",
    next_steps: ["<NEXT_STEP>"],
  };
  return {
    onboarding: onboardingStartPrompt("<REQUEST>"),
    delivery: deliveryStartPrompt({
      request: "<REQUEST>",
      continuity: "<CONTINUITY>",
      workProvider: "<WORK_PROVIDER>",
      knowledgeProvider: "<KNOWLEDGE_PROVIDER>",
      knowledgeScope: "<KNOWLEDGE_SCOPE>",
      telemetryGuidance: "<TELEMETRY_GUIDANCE>",
    }),
    continuity: {
      none: checkpointContinuityPrompt(undefined),
      in_progress: checkpointContinuityPrompt({
        ...sampleCheckpoint,
        status: "in_progress",
      }),
      blocked: checkpointContinuityPrompt({
        ...sampleCheckpoint,
        status: "blocked",
      }),
      complete: checkpointContinuityPrompt({
        ...sampleCheckpoint,
        status: "complete",
      }),
    },
  };
}

function commandStart(target, idea, coordinatorToken = undefined) {
  const installation = loadInstallation(target);
  if (!installation) {
    throw new StackError(
      `Project is not initialized. Run npx -y ${PACKAGE_NAME}@latest init`,
    );
  }
  const config = loadConfig(target);
  const coordinator = acquireCoordinator(target, coordinatorToken);
  let checkpoint;
  try {
    checkpoint = loadCheckpoint(target);
  } catch (error) {
    return {
      ok: false,
      phase: "checkpoint-recovery",
      error: error.message,
      recovery:
        "Preserve the invalid checkpoint if forensic evidence is needed, then use the checkpoint command with this coordinator token to replace it atomically.",
      coordinator,
    };
  }
  const memoryHealth = testConfiguredMemory(
    target,
    config,
    commandMemoryHealth(target, config),
    checkpoint,
  );
  const workProviderHealth = commandLinearHealth(target, config);
  const telemetryHealth = commandTelemetryHealth(target, config);
  const request = idea?.trim() || "[describe what you want to build or change]";
  const configurationApproved =
    config.safety.approved_configuration_hash === configurationHash(config);
  if (
    config.onboarding.status !== "complete" ||
    !configurationApproved
  ) {
    return {
      ok: true,
      phase: "onboarding",
      prompt: onboardingStartPrompt(request),
      pending: {
        onboarding_status: config.onboarding.status,
        configuration_approved: configurationApproved,
      },
      checkpoint,
      memory: memoryHealth,
      work_provider: workProviderHealth,
      telemetry: telemetryHealth,
      coordinator,
    };
  }
  const continuity = checkpointContinuityPrompt(checkpoint);
  const telemetryProviders = config.capabilities.telemetry.providers.map(
    (provider) => provider.provider,
  );
  const telemetryGuidance =
    telemetryProviders.length > 0
      ? `Apply $use-project-telemetry only when production evidence is relevant, using the configured ${telemetryProviders.join(", ")} provider${telemetryProviders.length === 1 ? "" : "s"}. Keep access read-only and bounded, retain references instead of raw payloads, validate observations against repository evidence, and never let telemetry authorize a mutation.`
      : "No project telemetry provider is configured. Continue with repository evidence; do not add instrumentation or connect a provider implicitly.";
  return {
    ok: true,
    phase: "project-discovery",
    configuration: {
      profile: config.onboarding.project_profile,
      review: config.capabilities.review.provider,
      knowledge: config.capabilities.knowledge.provider,
      knowledge_scope: config.capabilities.knowledge.scope,
      telemetry: telemetryProviders,
      work: config.capabilities.work.provider,
      execution: config.autonomy.execution,
      merge: config.autonomy.merge,
    },
    checkpoint,
    memory: memoryHealth,
    work_provider: workProviderHealth,
    telemetry: telemetryHealth,
    coordinator,
    prompt: deliveryStartPrompt({
      request,
      continuity,
      workProvider: config.capabilities.work.provider,
      knowledgeProvider: config.capabilities.knowledge.provider,
      knowledgeScope: config.capabilities.knowledge.scope,
      telemetryGuidance,
    }),
  };
}

function commandUpstreamCheck(target, output) {
  const sourceFile = join(PACKAGE_ROOT, "sources/upstreams.json");
  const registry = readJson(sourceFile, "upstream registry");
  if (!Array.isArray(registry.sources)) {
    throw new StackError("sources/upstreams.json must contain a sources array");
  }
  const results = registry.sources.map((source) => {
    if (
      typeof source.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]*$/.test(source.id) ||
      typeof source.repository !== "string" ||
      !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(
        source.repository,
      ) ||
      typeof source.pinned_commit !== "string" ||
      !/^[a-f0-9]{12,40}$/.test(source.pinned_commit)
    ) {
      return {
        id: source.id ?? "invalid",
        repository: source.repository,
        pinned_commit: source.pinned_commit,
        status: "error",
        error: "invalid source registry entry",
      };
    }
    const response = spawnSync("git", ["ls-remote", source.repository, "HEAD"], {
      encoding: "utf8",
      shell: false,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    if (response.status !== 0) {
      return {
        id: source.id,
        repository: source.repository,
        pinned_commit: source.pinned_commit,
        status: "error",
        error: redact(response.stderr || response.error?.message || "git ls-remote failed"),
      };
    }
    const remoteCommit = response.stdout.trim().split(/\s+/)[0];
    if (!GIT_OBJECT_ID.test(remoteCommit)) {
      return {
        id: source.id,
        repository: source.repository,
        pinned_commit: source.pinned_commit,
        status: "error",
        error: "remote HEAD did not resolve to a full commit hash",
      };
    }
    const current =
      remoteCommit.startsWith(source.pinned_commit) ||
      source.pinned_commit.startsWith(remoteCommit);
    return {
      id: source.id,
      repository: source.repository,
      role: source.role,
      pinned_commit: source.pinned_commit,
      remote_commit: remoteCommit,
      status: current ? "current" : "changed",
    };
  });
  const report = {
    ok: results.every((result) => result.status !== "error"),
    checked_at: utcTimestamp(),
    policy: registry.checked_policy,
    changed: results.filter((result) => result.status === "changed"),
    errors: results.filter((result) => result.status === "error"),
    sources: results,
  };
  if (output) {
    const outputFile = pathInside(target, output, "upstream report");
    atomicJson(outputFile, report);
    report.output = relative(target, outputFile);
  }
  return report;
}

function helpText() {
  return `Ultimate Agent Stack ${PACKAGE_VERSION}
Your Project Steward — one conversation managing the entire build.

Safe project setup:
  ultimate-agent-stack init [--target DIR] [--concise]
  ultimate-agent-stack upgrade [--target DIR] [--concise]
  ultimate-agent-stack status [--target DIR] [--run RUN]
  ultimate-agent-stack doctor [--target DIR] [--human]
  ultimate-agent-stack capabilities [--target DIR]
  ultimate-agent-stack work validate [--target DIR]
  ultimate-agent-stack evidence validate [--target DIR]
  ultimate-agent-stack evidence activate --skill NAME
    --skill-path PATH --mode native|file-read
    --harness NAME --model NAME --run ID --event ID
    --coordinator-token TOKEN
    [--target DIR]
  ultimate-agent-stack evidence activation-status --run RUN
    [--require SKILL ...] [--target DIR]
  ultimate-agent-stack evidence report [--format json|mermaid]
    [--max-nodes 1..500] [--output PATH] [--target DIR]
  ultimate-agent-stack review record --run RUN --reviewer-kind KIND
    --reviewer-id ID --result passed|changes-requested
    --result-file .agent-stack/runs/reviews/<safe-id>.json
    --coordinator-token TOKEN [--target DIR]
  ultimate-agent-stack review unavailable --run RUN --reason REASON
    --details TEXT --coordinator-token TOKEN [--target DIR]
  ultimate-agent-stack review status --run RUN [--target DIR]
  ultimate-agent-stack receipts validate [--target DIR]
  ultimate-agent-stack campaign status [--target DIR]
  ultimate-agent-stack campaign start --objective TEXT --max-iterations 1..25
    --coordinator-token TOKEN [--target DIR]
  ultimate-agent-stack campaign next --coordinator-token TOKEN [--target DIR]
  ultimate-agent-stack campaign stop --reason TEXT --coordinator-token TOKEN
    [--target DIR]
  ultimate-agent-stack memory-setup [--target DIR] [--harness NAME]
  ultimate-agent-stack memory-health [--target DIR]
  ultimate-agent-stack linear-setup [--target DIR]
  ultimate-agent-stack linear-health [--target DIR]
  ultimate-agent-stack telemetry-setup [--target DIR]
  ultimate-agent-stack telemetry-health [--target DIR]
  ultimate-agent-stack linear-write issue-create --work-item ID --team KEY
    --authority-source TEXT --coordinator-token TOKEN
    --confirm-external-write [--target DIR]
  ultimate-agent-stack linear-write evidence-comment --work-item ID
    --authority-source TEXT --coordinator-token TOKEN
    --confirm-external-write [--target DIR]
  ultimate-agent-stack start [--target DIR] [--idea TEXT]
    [--coordinator-token TOKEN]

Agent-operated quality controls:
  ultimate-agent-stack detect [--target DIR] [--write]
  ultimate-agent-stack configure --preset simple --reason TEXT [--target DIR]
  ultimate-agent-stack configure --profile PROFILE --review PROVIDER
    --knowledge PROVIDER [--knowledge-scope SCOPE] --external-data POLICY
    [--work repository|linear] [--linear-team KEY ...]
    [--linear-write issue_create|evidence_comment ...]
    [--telemetry PROVIDER@REGION:SCOPE ...]
    --reason TEXT [--reviewer LOGIN ...]
    [--execution MODE] [--merge MODE] [--target DIR]
  ultimate-agent-stack approve-checks --reason TEXT [--target DIR]
  ultimate-agent-stack verify [--target DIR] [--fail-fast]
  ultimate-agent-stack lock [--target DIR] [--artifact PATH ...]
  ultimate-agent-stack check-lock [--target DIR]
  ultimate-agent-stack unlock --reason TEXT [--target DIR]
  ultimate-agent-stack checkpoint --objective TEXT --summary TEXT
    [--status STATUS] [--completed TEXT ...] [--decision TEXT ...]
    [--next TEXT ...] [--blocker TEXT ...] [--evidence PATH ...]
    --coordinator-token TOKEN [--target DIR]
  ultimate-agent-stack coordinator status [--target DIR]
  ultimate-agent-stack coordinator heartbeat|release
    --coordinator-token TOKEN [--target DIR]
  ultimate-agent-stack coordinator takeover --reason TEXT --confirm-stopped
    [--target DIR]
  ultimate-agent-stack adopt-managed --path PATH --reason TEXT [--target DIR]

Maintainer:
  ultimate-agent-stack upstream-check [--target DIR] [--output PATH]

Commands are non-interactive and return JSON by default. doctor --human prints a
plain-language summary with one recommended next action. init and upgrade never
overwrite customized files; they create reconciliation proposals instead. Init
and upgrade return the full per-file JSON outcome list by default. Pass
--concise when an agent or script needs a smaller summary; it includes every
path that needs reconciliation or another manual decision, plus notable
preserved local paths, while counts cover ordinary outcomes.
Parallel delivery is coordinator-managed and falls back to serial work when safe
isolation is absent. The coding agent conducts guided onboarding; configure records
the approved choices. The simple preset selects standard, local-only, repository-
backed defaults with built-in review and human-controlled merge authority.
Repository checkpoints remain authoritative. Optional GBrain memory is project-
scoped and falls back safely. Optional project telemetry is read-only, disabled by
default, supports reviewed PostHog, Sentry, and New Relic identity checks, and
falls back to repository evidence; Ultimate Agent Stack does not phone home.
Linear is read-only by default; the only optional writes are receipted issue
and evidence-comment creation with explicit authority. Campaigns select one
repository item at a time and stop at their configured bound. One active Project
Steward owns a checkout at a time.`;
}

function execute(command, args) {
  switch (command) {
    case "init": {
      assertNoUnknownOptions(args, ["--target"], ["--claude", "--concise"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return installOrUpgrade(target, { mode: "init" });
    }
    case "upgrade": {
      assertNoUnknownOptions(args, ["--target"], ["--claude", "--concise"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return installOrUpgrade(target, { mode: "upgrade" });
    }
    case "detect": {
      assertNoUnknownOptions(args, ["--target"], ["--write"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandDetect(target, hasFlag(args, "--write"));
    }
    case "capabilities": {
      assertNoUnknownOptions(args, ["--target"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandCapabilities(target);
    }
    case "work": {
      const [subcommand, ...workArgs] = args;
      if (subcommand !== "validate") {
        throw new StackError("work subcommand must be validate");
      }
      assertNoUnknownOptions(workArgs, ["--target"]);
      const target = resolveTarget(getOption(workArgs, "--target", "."));
      return commandWorkValidate(target);
    }
    case "evidence": {
      const [subcommand, ...evidenceArgs] = args;
      if (!["validate", "activate", "activation-status", "report"].includes(subcommand)) {
        throw new StackError(
          "evidence subcommand must be validate, activate, activation-status, or report",
        );
      }
      assertNoUnknownOptions(
        evidenceArgs,
        subcommand === "validate"
          ? ["--target"]
            : subcommand === "activate"
            ? [
                "--target",
                "--skill",
                "--skill-path",
                "--mode",
                "--harness",
                "--model",
                "--run",
                "--event",
                "--coordinator-token",
              ]
            : subcommand === "activation-status"
              ? ["--target", "--run", "--require"]
            : ["--target", "--format", "--max-nodes", "--output"],
      );
      const target = resolveTarget(getOption(evidenceArgs, "--target", "."));
      if (subcommand === "validate") {
        return commandEvidenceValidate(target);
      }
      if (subcommand === "activate") {
        return commandEvidenceActivate(target, {
          skill: getOption(evidenceArgs, "--skill"),
          skillPath: getOption(evidenceArgs, "--skill-path"),
          mode: getOption(evidenceArgs, "--mode"),
          harness: getOption(evidenceArgs, "--harness"),
          model: getOption(evidenceArgs, "--model"),
          runId: getOption(evidenceArgs, "--run"),
          eventId: getOption(evidenceArgs, "--event"),
          coordinatorToken: getOption(
            evidenceArgs,
            "--coordinator-token",
          ),
        });
      }
      if (subcommand === "activation-status") {
        return commandEvidenceActivationStatus(target, {
          runId: getOption(evidenceArgs, "--run"),
          requiredSkills: getRepeatedOption(evidenceArgs, "--require"),
        });
      }
      return commandEvidenceReport(target, {
        format: getOption(evidenceArgs, "--format", "json"),
        maxNodes: getOption(evidenceArgs, "--max-nodes", "200"),
        output: getOption(evidenceArgs, "--output"),
      });
    }
    case "review": {
      const [subcommand, ...reviewArgs] = args;
      if (!["record", "unavailable", "status"].includes(subcommand)) {
        throw new StackError(
          "review subcommand must be record, unavailable, or status",
        );
      }
      const allowedReviewOptions = {
        record: [
          "--target",
          "--run",
          "--reviewer-kind",
          "--reviewer-id",
          "--result",
          "--result-file",
          "--coordinator-token",
        ],
        unavailable: [
          "--target",
          "--run",
          "--reason",
          "--details",
          "--coordinator-token",
        ],
        status: ["--target", "--run"],
      };
      assertNoUnknownOptions(reviewArgs, allowedReviewOptions[subcommand]);
      const target = resolveTarget(getOption(reviewArgs, "--target", "."));
      if (subcommand === "record") {
        return commandReviewRecord(target, {
          runId: getOption(reviewArgs, "--run"),
          reviewerKind: getOption(reviewArgs, "--reviewer-kind"),
          reviewerId: getOption(reviewArgs, "--reviewer-id"),
          result: getOption(reviewArgs, "--result"),
          resultFile: getOption(reviewArgs, "--result-file"),
          coordinatorToken: getOption(reviewArgs, "--coordinator-token"),
        });
      }
      if (subcommand === "unavailable") {
        return commandReviewUnavailable(target, {
          runId: getOption(reviewArgs, "--run"),
          reason: getOption(reviewArgs, "--reason"),
          details: getOption(reviewArgs, "--details"),
          coordinatorToken: getOption(reviewArgs, "--coordinator-token"),
        });
      }
      return commandReviewStatus(target, getOption(reviewArgs, "--run"));
    }
    case "receipts": {
      const [subcommand, ...receiptArgs] = args;
      if (subcommand !== "validate") {
        throw new StackError("receipts subcommand must be validate");
      }
      assertNoUnknownOptions(receiptArgs, ["--target"]);
      const target = resolveTarget(getOption(receiptArgs, "--target", "."));
      return commandReceiptsValidate(target);
    }
    case "campaign": {
      const [subcommand, ...campaignArgs] = args;
      if (!["start", "status", "next", "stop"].includes(subcommand)) {
        throw new StackError(
          "campaign subcommand must be start, status, next, or stop",
        );
      }
      const allowedCampaignOptions = {
        start: [
          "--target",
          "--objective",
          "--max-iterations",
          "--coordinator-token",
        ],
        status: ["--target"],
        next: ["--target", "--coordinator-token"],
        stop: ["--target", "--reason", "--coordinator-token"],
      };
      assertNoUnknownOptions(
        campaignArgs,
        allowedCampaignOptions[subcommand],
      );
      const target = resolveTarget(getOption(campaignArgs, "--target", "."));
      if (subcommand === "status") {
        return commandCampaignStatus(target);
      }
      const coordinatorToken = getOption(
        campaignArgs,
        "--coordinator-token",
      );
      if (subcommand === "start") {
        return commandCampaignStart(target, {
          objective: getOption(campaignArgs, "--objective"),
          maxIterations: getOption(campaignArgs, "--max-iterations"),
          coordinatorToken,
        });
      }
      if (subcommand === "next") {
        return commandCampaignNext(target, { coordinatorToken });
      }
      return commandCampaignStop(target, {
        reason: getOption(campaignArgs, "--reason"),
        coordinatorToken,
      });
    }
    case "memory-setup": {
      assertNoUnknownOptions(args, ["--target", "--harness"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandMemorySetup(target, getOption(args, "--harness"));
    }
    case "memory-health": {
      assertNoUnknownOptions(args, ["--target"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandMemoryHealth(target);
    }
    case "linear-setup": {
      assertNoUnknownOptions(args, ["--target"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandLinearSetup(target);
    }
    case "linear-health": {
      assertNoUnknownOptions(args, ["--target"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandLinearHealth(target);
    }
    case "telemetry-setup": {
      assertNoUnknownOptions(args, ["--target"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandTelemetrySetup(target);
    }
    case "telemetry-health": {
      assertNoUnknownOptions(args, ["--target"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandTelemetryHealth(target);
    }
    case "linear-write": {
      const [operation, ...writeArgs] = args;
      if (!["issue-create", "evidence-comment"].includes(operation)) {
        throw new StackError(
          "linear-write operation must be issue-create or evidence-comment",
        );
      }
      assertNoUnknownOptions(
        writeArgs,
        [
          "--target",
          "--work-item",
          "--team",
          "--authority-source",
          "--coordinator-token",
        ],
        ["--confirm-external-write"],
      );
      const target = resolveTarget(getOption(writeArgs, "--target", "."));
      const options = {
        workItemId: getOption(writeArgs, "--work-item"),
        teamKey: getOption(writeArgs, "--team"),
        authoritySource: getOption(writeArgs, "--authority-source"),
        coordinatorToken: getOption(writeArgs, "--coordinator-token"),
        confirmExternalWrite: hasFlag(
          writeArgs,
          "--confirm-external-write",
        ),
      };
      if (operation === "issue-create") {
        return commandLinearIssueCreate(target, options);
      }
      if (options.teamKey !== undefined) {
        throw new StackError(
          "--team is only supported for linear-write issue-create",
        );
      }
      return commandLinearEvidenceComment(target, options);
    }
    case "configure": {
      assertNoUnknownOptions(args, [
        "--target",
        "--preset",
        "--profile",
        "--review",
        "--knowledge",
        "--knowledge-scope",
        "--work",
        "--linear-team",
        "--linear-write",
        "--telemetry",
        "--external-data",
        "--execution",
        "--merge",
        "--reviewer",
        "--reason",
      ]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandConfigure(target, {
        preset: getOption(args, "--preset"),
        profile: getOption(args, "--profile"),
        review: getOption(args, "--review"),
        knowledge: getOption(args, "--knowledge"),
        knowledgeScope: getOption(args, "--knowledge-scope"),
        work: getOption(args, "--work"),
        linearTeams: getRepeatedOption(args, "--linear-team"),
        linearWrites: getRepeatedOption(args, "--linear-write"),
        telemetrySpecs: getRepeatedOption(args, "--telemetry"),
        externalData: getOption(args, "--external-data"),
        execution: getOption(args, "--execution"),
        merge: getOption(args, "--merge"),
        reviewers: getRepeatedOption(args, "--reviewer"),
        reason: getOption(args, "--reason"),
      });
    }
    case "approve-checks": {
      assertNoUnknownOptions(args, ["--target", "--reason"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandApproveChecks(target, getOption(args, "--reason"));
    }
    case "doctor": {
      assertNoUnknownOptions(args, ["--target"], ["--human"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      const result = commandDoctor(target);
      return hasFlag(args, "--human")
        ? { ...result, human: formatDoctorHuman(result) }
        : result;
    }
    case "verify": {
      assertNoUnknownOptions(args, ["--target"], ["--fail-fast"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandVerify(target, hasFlag(args, "--fail-fast"));
    }
    case "lock": {
      assertNoUnknownOptions(args, ["--target", "--artifact"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandLock(target, getRepeatedOption(args, "--artifact"));
    }
    case "check-lock": {
      assertNoUnknownOptions(args, ["--target"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandCheckLock(target);
    }
    case "unlock": {
      assertNoUnknownOptions(args, ["--target", "--reason"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandUnlock(target, getOption(args, "--reason"));
    }
    case "checkpoint": {
      assertNoUnknownOptions(args, [
        "--target",
        "--objective",
        "--summary",
        "--status",
        "--completed",
        "--decision",
        "--next",
        "--blocker",
        "--evidence",
        "--coordinator-token",
      ]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandCheckpoint(target, {
        objective: getOption(args, "--objective"),
        summary: getOption(args, "--summary"),
        status: getOption(args, "--status"),
        completed: getRepeatedOption(args, "--completed"),
        decisions: getRepeatedOption(args, "--decision"),
        nextSteps: getRepeatedOption(args, "--next"),
        blockers: getRepeatedOption(args, "--blocker"),
        evidence: getRepeatedOption(args, "--evidence"),
        token: getOption(args, "--coordinator-token"),
      });
    }
    case "coordinator": {
      const [action, ...options] = args;
      assertNoUnknownOptions(options, [
        "--target",
        "--coordinator-token",
        "--reason",
      ], ["--confirm-stopped"]);
      const target = resolveTarget(getOption(options, "--target", "."));
      return commandCoordinator(target, action, {
        token: getOption(options, "--coordinator-token"),
        reason: getOption(options, "--reason"),
        confirmStopped: hasFlag(options, "--confirm-stopped"),
      });
    }
    case "status": {
      assertNoUnknownOptions(args, ["--target", "--run"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandStatus(target, getOption(args, "--run"));
    }
    case "start": {
      assertNoUnknownOptions(args, [
        "--target",
        "--idea",
        "--coordinator-token",
      ]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandStart(
        target,
        getOption(args, "--idea"),
        getOption(args, "--coordinator-token"),
      );
    }
    case "adopt-managed": {
      assertNoUnknownOptions(args, ["--target", "--path", "--reason"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandAdoptManaged(
        target,
        getOption(args, "--path"),
        getOption(args, "--reason"),
      );
    }
    case "upstream-check": {
      assertNoUnknownOptions(args, ["--target", "--output"]);
      const target = resolveTarget(getOption(args, "--target", PACKAGE_ROOT));
      return commandUpstreamCheck(target, getOption(args, "--output"));
    }
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return { ok: true, help: helpText() };
    case "version":
    case "--version":
    case "-v":
      return { ok: true, name: PACKAGE_NAME, version: PACKAGE_VERSION };
    default:
      throw new StackError(`Unknown command: ${command}\n\n${helpText()}`);
  }
}

function emit(result) {
  if (result.help) {
    process.stdout.write(`${result.help}\n`);
    return;
  }
  if (result.human) {
    process.stdout.write(`${result.human}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
  try {
    assertSupportedNodeVersion();
    const [command, ...args] = argv;
    const result = execute(command, args);
    const output =
      (command === "init" || command === "upgrade") &&
      hasFlag(args, "--concise")
        ? summarizeInstallResult(result)
        : result;
    emit(output);
    return result.ok === false ? 1 : 0;
  } catch (error) {
    const stackError =
      error instanceof StackError
        ? error
        : new StackError(`Unexpected failure: ${error.message}`, 1);
    process.stderr.write(
      `${JSON.stringify(
        {
          ok: false,
          error: stackError.message,
          details: stackError.details,
        },
        null,
        2,
      )}\n`,
    );
    return stackError.exitCode;
  }
}

const isEntryPoint =
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(CLI_FILE);
if (isEntryPoint) {
  process.exitCode = main();
}

export {
  CHECKPOINT_MARKDOWN_PATH,
  CHECKPOINT_PATH,
  CAMPAIGN_PATH,
  CONFIG_PATH,
  COORDINATOR_PATH,
  CORE_POLICY_PATH,
  EVIDENCE_GRAPH_PATH,
  INSTALLATION_PATH,
  PACKAGE_NAME,
  PACKAGE_ROOT,
  PACKAGE_VERSION,
  MINIMUM_NODE_MAJOR,
  PROJECT_CLI_PATH,
  PROVIDER_RECEIPTS_PATH,
  REVIEW_RECEIPT_PATH,
  REVIEW_WORKFLOW_PATH,
  SAFE_ENVIRONMENT_NAMES,
  StackError,
  TELEMETRY_READONLY_PATH,
  WORK_LEDGER_PATH,
  checksHash,
  assertSupportedNodeVersion,
  atomicText,
  canonicalExecutableName,
  commandCheckpoint,
  commandCapabilities,
  commandCampaignNext,
  commandCampaignStart,
  commandCampaignStatus,
  commandCampaignStop,
  commandAdoptManaged,
  commandApproveChecks,
  commandCheckLock,
  commandConfigure,
  commandCoordinator,
  commandDetect,
  commandDoctor,
  commandEvidenceValidate,
  commandEvidenceActivate,
  commandEvidenceActivationStatus,
  commandEvidenceReport,
  commandReviewRecord,
  commandReviewUnavailable,
  commandReviewStatus,
  validateReviewerResultArtifact,
  commandLock,
  commandLinearHealth,
  commandLinearEvidenceComment,
  commandLinearIssueCreate,
  commandLinearSetup,
  commandMemoryHealth,
  commandMemorySetup,
  commandReceiptsValidate,
  commandStart,
  commandStatus,
  commandTelemetryHealth,
  commandTelemetrySetup,
  commandUnlock,
  commandUpstreamCheck,
  commandVerify,
  commandWorkValidate,
  configurationHash,
  defaultConfig,
  detectProject,
  deterministicUuid,
  execute,
  formatDoctorHuman,
  hardenCheckEnvironment,
  installOrUpgrade,
  loadInstallation,
  main,
  normalizeWindowsExtensions,
  pathInside,
  portableTextSha256,
  resolveConfigureOptions,
  resolveTarget,
  startPromptPolicySurface,
  validateConfig,
  validateCampaignState,
  validateEvidenceGraph,
  validateProviderReceipt,
  validateWorkEvidenceLinkage,
  validateWorkLedger,
};
