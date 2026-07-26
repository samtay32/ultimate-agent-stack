#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
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
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const CLI_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(CLI_FILE), "..");
const PACKAGE_JSON = existsSync(join(PACKAGE_ROOT, "package.json"))
  ? JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"))
  : {
      name: "ultimate-agent-stack",
      version: "0.3.0",
    };
const PACKAGE_NAME = PACKAGE_JSON.name;
const PACKAGE_VERSION = PACKAGE_JSON.version;
const CONFIG_PATH = ".agent-stack/config.json";
const INSTALLATION_PATH = ".agent-stack/installation.json";
const STATE_PATH = ".agent-stack/state.json";
const RUNS_PATH = ".agent-stack/runs";
const PROJECT_CLI_PATH = ".agent-stack/bin/agent-stack.mjs";
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
const SAFE_ENVIRONMENT_NAMES = [
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
];
const SENSITIVE_ENVIRONMENT_NAME =
  /(api|auth|access|private|secret|token|password|passwd|credential|cookie|session|key)/i;

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

function projectFile(target, raw, label = "project path") {
  return pathInside(target, raw, label);
}

function atomicProjectJson(target, raw, value, label = raw) {
  atomicJson(projectFile(target, raw, label), value);
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

function redact(text, limit = 12_000) {
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

function executableExists(target, executable) {
  if (!executable) {
    return false;
  }
  if (
    executable.startsWith(".") ||
    executable.includes("/") ||
    executable.includes("\\")
  ) {
    try {
      return existsSync(projectFile(target, executable, "quality executable"));
    } catch {
      return false;
    }
  }
  const extensions =
    platform() === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) {
      continue;
    }
    for (const extension of extensions) {
      const candidate = join(directory, `${executable}${extension}`);
      if (existsSync(candidate)) {
        return true;
      }
    }
  }
  return false;
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
    const executable = projectExists(target, "mvnw") ? "./mvnw" : "mvn";
    addCheck(checks, "verify", [executable, "verify"], 1800);
  } else if (
    projectExists(target, "build.gradle") ||
    projectExists(target, "build.gradle.kts")
  ) {
    stacks.push("java-gradle");
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
  };
}

function defaultConfig(target, detected) {
  return {
    schema_version: 1,
    project: {
      name: basename(target),
      stacks: detected.stacks,
      detected_at: detected.detected_at,
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
      project_root_only: true,
      forbid_shell_commands: true,
      max_check_timeout_seconds: 7200,
    },
    quality: {
      require_project_checks: true,
      checks: detected.checks,
      evidence_directory: RUNS_PATH,
    },
    lock_artifacts: DEFAULT_ARTIFACTS,
  };
}

function migrateConfig(config) {
  config.schema_version ??= 1;
  config.project ??= {};
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
  config.parallel_delivery.mode ??= "adaptive";
  config.parallel_delivery.max_workers ??= 3;
  config.parallel_delivery.serial_fallback ??= true;
  config.parallel_delivery.require_isolation_for_parallel_writes ??= true;
  config.parallel_delivery.allow_nested_delegation ??= false;
  config.parallel_delivery.authority_inheritance ??= "no_expansion";
  config.parallel_delivery.integration_owner ??= "primary_agent";
  config.safety ??= {};
  config.safety.require_check_approval ??= true;
  config.safety.approved_checks_hash ??= null;
  config.safety.approved_at ??= null;
  config.safety.approval_reason ??= null;
  config.safety.project_root_only = true;
  config.safety.forbid_shell_commands = true;
  config.safety.max_check_timeout_seconds ??= 7200;
  config.quality ??= {};
  config.quality.require_project_checks ??= true;
  config.quality.checks ??= [];
  config.quality.evidence_directory ??= RUNS_PATH;
  config.lock_artifacts = Array.isArray(config.lock_artifacts)
    ? [...new Set([...config.lock_artifacts, ...DEFAULT_ARTIFACTS])]
    : DEFAULT_ARTIFACTS;
  return config;
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
  if (
    executable === "git" &&
    !["diff", "status", "rev-parse", "show", "log"].includes(check.argv[1])
  ) {
    errors.push(
      `quality.checks[${index}] uses a non-read-only git command: ${check.argv[1]}`,
    );
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
    executable === "terraform" &&
    !["fmt", "validate"].includes(check.argv[1])
  ) {
    errors.push(
      `quality.checks[${index}] terraform command must be fmt or validate`,
    );
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

function validateConfig(config, target = undefined) {
  const errors = [];
  if (config.schema_version !== 1) {
    errors.push("schema_version must equal 1");
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
    errors.push("no project quality checks configured");
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

function checksHash(checks, target = undefined) {
  const payload = target
    ? {
        checks,
        delegated_definitions: checks.map((check) =>
          delegatedCheckDefinition(target, check),
        ),
      }
    : checks;
  return sha256(stableJson(payload));
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
    destination: PROJECT_CLI_PATH,
    source: CLI_FILE,
    protected: true,
  });
  return entries.sort((left, right) =>
    left.destination.localeCompare(right.destination),
  );
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

function installOrUpgrade(target, { claude = false, mode = "init" } = {}) {
  const existing = loadInstallation(target);
  if (mode === "init" && existing) {
    return {
      ok: true,
      action: "already-initialized",
      installed_version: existing.package?.version,
      next: `Run npx -y ${PACKAGE_NAME}@latest upgrade`,
    };
  }

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
  const entries = sourceEntries({ claude });

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
      if (destination === PROJECT_CLI_PATH) {
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
    const config = migrateConfig(readJson(configFile, "project config"));
    atomicJson(configFile, config);
    outcomes.push({ path: CONFIG_PATH, status: "migrated-or-unchanged" });
  }

  manifest.schema_version = 1;
  manifest.package = { name: PACKAGE_NAME, version: PACKAGE_VERSION };
  manifest.updated_at = utcTimestamp();
  manifest.harnesses = [
    "codex",
    "cursor",
    "gemini",
    "grok",
    "opencode",
    ...(claude || manifest.harnesses.includes("claude") ? ["claude"] : []),
  ];
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
    outcomes,
    pending_reconciliation: pending,
    next_prompt:
      pending.length > 0
        ? "Reconcile the listed proposals, run adopt-managed for each, then run doctor."
        : "Read .agent-stack/HANDOFF.md, run doctor, review and approve detected checks, then begin conversational project shaping. The primary agent may coordinate safe parallel work automatically.",
  };
}

function loadConfig(target) {
  return migrateConfig(
    readJson(projectFile(target, CONFIG_PATH, "project config"), "project config"),
  );
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
    checksHash(updatedChecks, target) !== config.safety.approved_checks_hash
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
  config.safety.approved_checks_hash = checksHash(
    config.quality.checks,
    target,
  );
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
  const report = (name, ok, detail, severity = "required") => {
    reports.push({ name, ok, detail, severity });
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
    report("config", errors.length === 0, errors.length === 0 ? "valid" : errors);
    const parallel = config.parallel_delivery;
    report(
      "parallel-delivery",
      errors.length === 0 ||
        !errors.some(
          (error) =>
            error.startsWith("parallel_delivery.") ||
            error.startsWith("autonomy.parallel_work"),
        ),
      parallel
        ? {
            mode: parallel.mode,
            max_workers: parallel.max_workers,
            write_isolation_required:
              parallel.require_isolation_for_parallel_writes,
            nested_delegation: parallel.allow_nested_delegation,
            integration_owner: parallel.integration_owner,
          }
        : "missing parallel_delivery policy",
    );
    const actualHash = checksHash(config.quality.checks, target);
    report(
      "check-approval",
      config.safety.approved_checks_hash === actualHash,
      config.safety.approved_checks_hash === actualHash
        ? `approved ${config.safety.approved_at}`
        : "commands changed or have not been reviewed",
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
  report("git", isGitRepository(target), "Git repository");
  report(
    "github-cli",
    executableExists(target, "gh"),
    "optional until pull-request phase",
    "warning",
  );
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

function checkEnvironment(target) {
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

function runCheck(target, check) {
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
  const processResult = spawnSync(check.argv[0], check.argv.slice(1), {
    cwd: target,
    encoding: "utf8",
    env: checkEnvironment(target),
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    timeout: (check.timeout_seconds ?? 900) * 1000,
  });
  const output = [processResult.stdout, processResult.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  const timedOut = processResult.error?.code === "ETIMEDOUT";
  const returncode = timedOut
    ? 124
    : (processResult.status ?? (processResult.error ? 1 : 0));
  return {
    ...result,
    status: returncode === 0 ? "passed" : "failed",
    returncode,
    duration_seconds: Math.round((Date.now() - started) / 10) / 100,
    output: redact(timedOut ? `timed out\n${output}` : output),
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
  const actualChecksHash = checksHash(config.quality.checks, target);
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
      const record = runCheck(target, check);
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

function commandStatus(target) {
  const installation = loadInstallation(target);
  const config = projectExists(target, CONFIG_PATH, "project config")
    ? loadConfig(target)
    : null;
  const state = loadState(target);
  const pending = Object.keys(installation?.pending_files ?? {});
  const drift = protectedDrift(target, installation);
  const actualChecksHash = config
    ? checksHash(config.quality?.checks ?? [], target)
    : null;
  return {
    ok: Boolean(installation && config) && pending.length === 0 && drift.length === 0,
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
    active_lock: state.active_lock?.locked_at ?? null,
  };
}

function commandStart(target, idea) {
  const installation = loadInstallation(target);
  if (!installation) {
    throw new StackError(
      `Project is not initialized. Run npx -y ${PACKAGE_NAME}@latest init`,
    );
  }
  const request = idea?.trim() || "[describe what you want to build or change]";
  return {
    ok: true,
    prompt: `Read AGENTS.md, .agent-stack/HANDOFF.md, and the installed skills. Use $run-autonomous-delivery for this request: ${request}\n\nInspect the project first. Use $coordinate-parallel-delivery to manage independent subagent work when it is safe and useful; keep it serial otherwise. You remain the integration owner, and the user must not manage workers. Then ask me one high-impact question at a time, recommend a safe default, and own all routine implementation and verification.`,
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

Safe project setup:
  ultimate-agent-stack init [--target DIR] [--claude]
  ultimate-agent-stack upgrade [--target DIR] [--claude]
  ultimate-agent-stack status [--target DIR]
  ultimate-agent-stack doctor [--target DIR]
  ultimate-agent-stack start [--target DIR] [--idea TEXT]

Agent-operated quality controls:
  ultimate-agent-stack detect [--target DIR] [--write]
  ultimate-agent-stack approve-checks --reason TEXT [--target DIR]
  ultimate-agent-stack verify [--target DIR] [--fail-fast]
  ultimate-agent-stack lock [--target DIR] [--artifact PATH ...]
  ultimate-agent-stack check-lock [--target DIR]
  ultimate-agent-stack unlock --reason TEXT [--target DIR]
  ultimate-agent-stack adopt-managed --path PATH --reason TEXT [--target DIR]

Maintainer:
  ultimate-agent-stack upstream-check [--target DIR] [--output PATH]

All commands are non-interactive and return JSON. init and upgrade never overwrite
customized files; they create reconciliation proposals instead. Parallel delivery
is coordinator-managed and falls back to serial work when safe isolation is absent.`;
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
    case "approve-checks": {
      assertNoUnknownOptions(args, ["--target", "--reason"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandApproveChecks(target, getOption(args, "--reason"));
    }
    case "doctor": {
      assertNoUnknownOptions(args, ["--target"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandDoctor(target);
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
    case "status": {
      assertNoUnknownOptions(args, ["--target"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandStatus(target);
    }
    case "start": {
      assertNoUnknownOptions(args, ["--target", "--idea"]);
      const target = resolveTarget(getOption(args, "--target", "."));
      return commandStart(target, getOption(args, "--idea"));
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
  CONFIG_PATH,
  CORE_POLICY_PATH,
  INSTALLATION_PATH,
  PACKAGE_NAME,
  PACKAGE_ROOT,
  PACKAGE_VERSION,
  PROJECT_CLI_PATH,
  REVIEW_RECEIPT_PATH,
  REVIEW_WORKFLOW_PATH,
  StackError,
  checksHash,
  commandAdoptManaged,
  commandApproveChecks,
  commandCheckLock,
  commandDetect,
  commandDoctor,
  commandLock,
  commandStart,
  commandStatus,
  commandUnlock,
  commandUpstreamCheck,
  commandVerify,
  defaultConfig,
  detectProject,
  execute,
  installOrUpgrade,
  loadInstallation,
  main,
  pathInside,
  resolveTarget,
  validateConfig,
};
