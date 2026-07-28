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
      version: "0.7.2",
    };
const PACKAGE_NAME = PACKAGE_JSON.name;
const PACKAGE_VERSION = PACKAGE_JSON.version;
const CONFIG_SCHEMA_VERSION = 4;
const WORK_LEDGER_PATH = ".agent-stack/work-items.json";
const EVIDENCE_GRAPH_PATH = ".agent-stack/evidence-graph.json";
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
const GBRAIN_CHECKPOINT_SLUG = "projects/ultimate-agent-stack/checkpoint";
const RUNS_PATH = ".agent-stack/runs";
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
const PLACEHOLDER = /\[\[[A-Z0-9_ -]+\]\]/g;
const SECRET_ASSIGNMENT =
  /\b(api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)(\s*[=:]\s*)([^\s,;]+)/gi;
const SECRET_LIKE_TEXT =
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]|npm|sk)-?[A-Za-z0-9_]{20,}\b|\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})/i;
const COORDINATOR_TTL_SECONDS = 2 * 60 * 60;
const COORDINATOR_MUTEX_STALE_MS = 30_000;
const FORBIDDEN_EXECUTABLES = new Set([
  "bash",
  "cmd",
  "cmd.exe",
  "dd",
  "del",
  "format",
  "mkfs",
  "powershell",
  "powershell.exe",
  "pwsh",
  "reboot",
  "rm",
  "rmdir",
  "sh",
  "shutdown",
  "su",
  "sudo",
  "zsh",
]);
const PACKAGE_MANAGERS = new Set([
  "bun",
  "npm",
  "npm.cmd",
  "pnpm",
  "pnpm.cmd",
  "yarn",
  "yarn.cmd",
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
  ["node.exe", new Set(["-e", "--eval", "-p", "--print"])],
  ["perl", new Set(["-e", "-E"])],
  ["php", new Set(["-r"])],
  ["py", new Set(["-c"])],
  ["python", new Set(["-c"])],
  ["python3", new Set(["-c"])],
  ["ruby", new Set(["-e"])],
]);
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
const TELEMETRY_PROVIDERS = new Map();
const TELEMETRY_ACCESS_MODES = new Set(["read_only"]);
const TELEMETRY_EVIDENCE_MODES = new Set([
  "bounded_references_only",
]);
const WORK_PROVIDERS = new Set(["repository"]);
const WORK_SYNC_MODES = new Set(["repository_only"]);
const WORK_WRITE_POLICIES = new Set(["repository_only"]);
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

function utcTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function filenameTimestamp() {
  return utcTimestamp().replaceAll("-", "").replaceAll(":", "");
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
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

function atomicJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = join(
    dirname(file),
    `.${basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, file);
}

function atomicText(file, value, mode = 0o600) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = join(
    dirname(file),
    `.${basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(temporary, value, {
    encoding: "utf8",
    mode,
  });
  renameSync(temporary, file);
}

function projectFile(target, raw, label = "project path") {
  return pathInside(target, raw, label);
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
    config.capabilities.work.provider ??= "repository";
    config.capabilities.work.required ??= false;
    config.capabilities.work.sync_mode ??= "repository_only";
    config.capabilities.work.write_policy ??= "repository_only";
    config.capabilities.work.repository_fallback ??= true;
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
  const executable = basename(check.argv[0]).toLowerCase();
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
      `quality.checks[${index}] uses forbidden shell or destructive executable: ${executable}`,
    );
  }
  const inlineEvaluationArguments = INLINE_EVALUATION_ARGUMENTS.get(executable);
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
      ]),
      "capabilities.work",
    );
    if (!WORK_PROVIDERS.has(work.provider)) {
      errors.push("capabilities.work.provider must be repository");
    }
    if (work.required !== false) {
      errors.push("capabilities.work.required must remain false");
    }
    if (!WORK_SYNC_MODES.has(work.sync_mode)) {
      errors.push(
        "capabilities.work.sync_mode must be repository_only",
      );
    }
    if (!WORK_WRITE_POLICIES.has(work.write_policy)) {
      errors.push(
        "capabilities.work.write_policy must be repository_only",
      );
    }
    if (work.repository_fallback !== true) {
      errors.push(
        "capabilities.work.repository_fallback must remain true",
      );
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
    new Set(["schema_version", "updated_at", "nodes", "edges"]),
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

function validateRepositoryContract(target, path, validator, label) {
  try {
    const value = readJson(projectFile(target, path, label), label);
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

function commandEvidenceValidate(target) {
  const result = validateRepositoryContract(
    target,
    EVIDENCE_GRAPH_PATH,
    validateEvidenceGraph,
    "evidence graph",
  );
  const ledger = validateRepositoryContract(
    target,
    WORK_LEDGER_PATH,
    validateWorkLedger,
    "work ledger",
  );
  const linkageErrors =
    result.ok && ledger.ok
      ? validateWorkEvidenceLinkage(ledger.value, result.value)
      : [];
  const errors = [...result.errors, ...linkageErrors];
  return {
    ok: result.ok && ledger.ok && errors.length === 0,
    path: result.path,
    work_ledger: {
      ok: ledger.ok,
      path: ledger.path,
    },
    node_count: Array.isArray(result.value?.nodes)
      ? result.value.nodes.length
      : 0,
    edge_count: Array.isArray(result.value?.edges)
      ? result.value.edges.length
      : 0,
    errors,
  };
}

function delegatedCheckDefinition(target, check) {
  const executable = basename(check.argv?.[0] ?? "").toLowerCase();
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

// Every shipped adapter installs by default. Detection tells the agent which
// harnesses already had project markers; --claude remains a compatible no-op.
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

function loadConfig(target) {
  return migrateConfig(
    readJson(projectFile(target, CONFIG_PATH, "project config"), "project config"),
    target,
  );
}

function commandCapabilities(target) {
  const config = projectExists(target, CONFIG_PATH, "project config")
    ? loadConfig(target)
    : null;
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
      preset,
      reason: options.reason,
    };
  }
  return {
    ...options,
    knowledgeScope: options.knowledgeScope ?? "project",
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

  const config = loadConfig(target);
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

function isGitRepository(target) {
  const result = spawnSync("git", ["-C", target, "rev-parse", "--git-dir"], {
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
  });
  return result.status === 0;
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
    report(
      "telemetry-providers",
      true,
      {
        selected: telemetryProviders.map((provider) => provider.provider),
        access: telemetry.default_access ?? "invalid",
        evidence_capture: telemetry.evidence_capture ?? "invalid",
        raw_payload_storage: telemetry.raw_payload_storage ?? "invalid",
        fallback: "repository evidence",
      },
      "warning",
      telemetryProviders.length === 0 ? "not-configured" : "configured",
    );
    const work =
      config.capabilities.work &&
      typeof config.capabilities.work === "object" &&
      !Array.isArray(config.capabilities.work)
        ? config.capabilities.work
        : {};
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
  if (basename(check.argv[0]).toLowerCase() !== "git") {
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
    started_at: utcTimestamp(),
    target,
    checks: [],
  };
  const actualChecksHash = currentChecksHash(config, target);
  if (config.onboarding.status !== "complete") {
    errors.push(
      "guided onboarding is incomplete; configure the approved project profile and providers",
    );
  }
  if (
    config.safety.approved_configuration_hash !== configurationHash(config)
  ) {
    errors.push(
      "provider, interaction, autonomy, or profile choices changed or were not approved",
    );
  }
  if (
    config.safety.require_check_approval !== false &&
    config.safety.approved_checks_hash !== actualChecksHash
  ) {
    errors.push(
      "quality checks changed or were not reviewed; run approve-checks after inspecting them",
    );
  }
  if (errors.length > 0) {
    evidence.ok = false;
    evidence.configuration_errors = errors;
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
    configuration_errors: evidence.configuration_errors,
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
  const run = (args) =>
    spawnSync("git", ["-C", target, ...args], {
      encoding: "utf8",
      shell: false,
      timeout: 10_000,
    });
  const headResult = run(["rev-parse", "HEAD"]);
  const branchResult = run(["branch", "--show-current"]);
  const statusResult = run(["status", "--porcelain=v1"]);
  const statusLines =
    statusResult.status === 0
      ? statusResult.stdout.split("\n").filter(Boolean)
      : [];
  return {
    head: headResult.status === 0 ? headResult.stdout.trim() : null,
    branch:
      branchResult.status === 0 && branchResult.stdout.trim().length > 0
        ? branchResult.stdout.trim()
        : null,
    tracked_changes: statusLines.filter((line) => !line.startsWith("??"))
      .length,
    untracked_changes: statusLines.filter((line) => line.startsWith("??"))
      .length,
    clean: statusLines.length === 0,
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
    const placeholders = [
      ...new Set(readFileSync(file, "utf8").match(PLACEHOLDER) ?? []),
    ].sort();
    if (placeholders.length > 0) {
      throw new StackError(
        `Cannot lock ${artifact}; unresolved placeholders: ${placeholders.join(", ")}`,
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

function commandStatus(target) {
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
  return {
    ok:
      Boolean(installation && config) &&
      pending.length === 0 &&
      drift.length === 0 &&
      config.onboarding.status === "complete" &&
      config.safety.approved_configuration_hash === actualConfigurationHash &&
      !checkpoint?.error &&
      !coordinator?.error,
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
      prompt: `Read AGENTS.md, .agent-stack/core-policy.json, .agent-stack/HANDOFF.md, .agent-stack/config.json, and any valid .agent-stack/CHECKPOINT.md. Inspect the repository and run the capabilities command. Complete Ultimate Agent Stack onboarding before material implementation.\n\nAsk only consequential setup decisions, one at a time. For each decision use plain language, state one recommended choice, provide at most one genuinely safe alternative, explain the practical consequence, and accept "use the recommendation" as an answer. Never invent an unsafe alternative. Prefer repository evidence and safe defaults over questions.\n\nAsk this memory decision in plain language: "Should this project remember progress only in its repository files, or also use a private local searchable memory for easier continuation across conversations?" Recommend repository memory for a short or simple project. Recommend project-scoped local GBrain for a long-running build likely to span conversations. Explain that GBrain is optional, repository checkpoints remain the source of truth, and work still resumes when GBrain is unavailable. If GBrain is approved, configure it, run memory-setup for the detected harness, perform the approved setup, and verify it with doctor.\n\nTelemetry remains repository-only until a reviewed provider adapter is installed. Do not ask the user to select or connect an unavailable provider.\n\nConfigure the approved project profile, review provider, knowledge provider, external-data policy, and authority mode with the non-interactive configure command. Then run doctor and continue with this request: ${request}`,
      pending: {
        onboarding_status: config.onboarding.status,
        configuration_approved: configurationApproved,
      },
      checkpoint,
      memory: memoryHealth,
      coordinator,
    };
  }
  const continuity = checkpoint
    ? `Resume checkpoint ${checkpoint.checkpoint_id}: ${checkpoint.summary} Next steps: ${checkpoint.next_steps.join("; ") || "none recorded"}.`
    : "No checkpoint exists yet. Create one after the first verified delivery milestone.";
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
    coordinator,
    prompt: `Read AGENTS.md, .agent-stack/core-policy.json, .agent-stack/HANDOFF.md, .agent-stack/config.json, .agent-stack/work-items.json, .agent-stack/evidence-graph.json, any valid .agent-stack/CHECKPOINT.md, and the installed skills. Use $run-autonomous-delivery for this request: ${request}\n\n${continuity}\n\nInspect the project first. Apply $manage-project-work using the configured ${config.capabilities.work.provider} provider; validate the repository ledger and graph, select only bounded ready work, and keep completion tied to real evidence. Apply $use-project-knowledge using the configured ${config.capabilities.knowledge.provider} provider at ${config.capabilities.knowledge.scope} scope, with repository evidence as the source of truth and fallback. The start command already tested configured memory; if its result is unhealthy or the checkpoint mirror is stale, continue from the repository and repair the optional adapter without blocking delivery. ${telemetryGuidance} Use $coordinate-parallel-delivery to manage independent subagent work when it is safe and useful; keep it serial otherwise. You are the one Project Steward and integration owner. Do not give the coordinator token to subagents, and do not make the user manage workers.\n\nBuild a living project brief. Research routine answers. Ask only consequential questions, one at a time. Each question must use plain language, recommend one safe choice, provide at most one genuinely useful safe alternative, explain the consequence, and allow "use the recommendation." Own all routine implementation and verification. Write a deterministic checkpoint after verified milestones and release the coordinator lease only at final handoff.`,
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
    if (!/^[a-f0-9]{40}$/.test(remoteCommit)) {
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
  ultimate-agent-stack init [--target DIR] [--claude]
  ultimate-agent-stack upgrade [--target DIR] [--claude]
  ultimate-agent-stack status [--target DIR]
  ultimate-agent-stack doctor [--target DIR] [--human]
  ultimate-agent-stack capabilities [--target DIR]
  ultimate-agent-stack work validate [--target DIR]
  ultimate-agent-stack evidence validate [--target DIR]
  ultimate-agent-stack memory-setup [--target DIR] [--harness NAME]
  ultimate-agent-stack memory-health [--target DIR]
  ultimate-agent-stack start [--target DIR] [--idea TEXT]
    [--coordinator-token TOKEN]

Agent-operated quality controls:
  ultimate-agent-stack detect [--target DIR] [--write]
  ultimate-agent-stack configure --preset simple --reason TEXT [--target DIR]
  ultimate-agent-stack configure --profile PROFILE --review PROVIDER
    --knowledge PROVIDER [--knowledge-scope SCOPE] --external-data POLICY
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
overwrite customized files; they create reconciliation proposals instead.
Parallel delivery is coordinator-managed and falls back to serial work when safe
isolation is absent. The coding agent conducts guided onboarding; configure records
the approved choices. The simple preset selects standard, local-only, repository-
backed defaults with built-in review and human-controlled merge authority.
Repository checkpoints remain authoritative. Optional GBrain memory is project-
scoped and falls back safely. Optional project telemetry is read-only, disabled by
default, and falls back to repository evidence; Ultimate Agent Stack does not phone
home. One active Project Steward owns a checkout at a time.`;
}

function execute(command, args) {
  switch (command) {
    case "init": {
      assertNoUnknownOptions(args, ["--target"], ["--claude"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return installOrUpgrade(target, {
        claude: hasFlag(args, "--claude"),
        mode: "init",
      });
    }
    case "upgrade": {
      assertNoUnknownOptions(args, ["--target"], ["--claude"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return installOrUpgrade(target, {
        claude: hasFlag(args, "--claude"),
        mode: "upgrade",
      });
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
      if (subcommand !== "validate") {
        throw new StackError("evidence subcommand must be validate");
      }
      assertNoUnknownOptions(evidenceArgs, ["--target"]);
      const target = resolveTarget(getOption(evidenceArgs, "--target", "."));
      return commandEvidenceValidate(target);
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
    case "configure": {
      assertNoUnknownOptions(args, [
        "--target",
        "--preset",
        "--profile",
        "--review",
        "--knowledge",
        "--knowledge-scope",
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
      assertNoUnknownOptions(args, ["--target"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandStatus(target);
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
    const [command, ...args] = argv;
    const result = execute(command, args);
    emit(result);
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
  CONFIG_PATH,
  COORDINATOR_PATH,
  CORE_POLICY_PATH,
  EVIDENCE_GRAPH_PATH,
  INSTALLATION_PATH,
  PACKAGE_NAME,
  PACKAGE_ROOT,
  PACKAGE_VERSION,
  PROJECT_CLI_PATH,
  REVIEW_RECEIPT_PATH,
  REVIEW_WORKFLOW_PATH,
  SAFE_ENVIRONMENT_NAMES,
  StackError,
  WORK_LEDGER_PATH,
  checksHash,
  commandCheckpoint,
  commandCapabilities,
  commandAdoptManaged,
  commandApproveChecks,
  commandCheckLock,
  commandConfigure,
  commandCoordinator,
  commandDetect,
  commandDoctor,
  commandEvidenceValidate,
  commandLock,
  commandMemoryHealth,
  commandMemorySetup,
  commandStart,
  commandStatus,
  commandUnlock,
  commandUpstreamCheck,
  commandVerify,
  commandWorkValidate,
  configurationHash,
  defaultConfig,
  detectProject,
  execute,
  formatDoctorHuman,
  installOrUpgrade,
  loadInstallation,
  main,
  normalizeWindowsExtensions,
  pathInside,
  resolveConfigureOptions,
  resolveTarget,
  validateConfig,
  validateEvidenceGraph,
  validateWorkEvidenceLinkage,
  validateWorkLedger,
};
