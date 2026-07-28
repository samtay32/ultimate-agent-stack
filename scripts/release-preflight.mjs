#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(SCRIPT_FILE), "..");

function versionAtLeast(actual, minimum) {
  const parse = (value) =>
    String(value)
      .replace(/^v/, "")
      .split(".")
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10));
  const left = parse(actual);
  const right = parse(minimum);
  if (
    left.length !== 3 ||
    right.length !== 3 ||
    [...left, ...right].some(Number.isNaN)
  ) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] > right[index];
    }
  }
  return true;
}

function releaseBlockers(packageData, confirmation, runtime = null) {
  const blockers = [];
  if (!packageData.name || !packageData.version) {
    blockers.push("package name and version are required");
  }
  if (!packageData.license || packageData.license === "UNLICENSED") {
    blockers.push("choose and record the intended public-package license");
  }
  if (!packageData.repository) {
    blockers.push("record the real source repository in package.json");
  }
  const expected = `${packageData.name}@${packageData.version}`;
  if (confirmation !== expected) {
    blockers.push(`confirmation must exactly equal ${expected}`);
  }
  if (!["bootstrap", "staged"].includes(runtime?.releaseMode)) {
    blockers.push("release mode must be explicitly set to bootstrap or staged");
  }
  if (runtime && runtime.gitClean !== true) {
    blockers.push("publication requires a clean Git working tree");
  }
  if (
    runtime?.releaseMode === "bootstrap" &&
    !versionAtLeast(runtime.node, "20.12.0")
  ) {
    blockers.push("bootstrap publication requires Node.js 20.12.0 or newer");
  }
  if (
    runtime?.releaseMode === "bootstrap" &&
    !versionAtLeast(runtime.npm, "10.8.0")
  ) {
    blockers.push("bootstrap publication requires npm 10.8.0 or newer");
  }
  if (
    runtime?.releaseMode === "staged" &&
    !versionAtLeast(runtime.node, "22.14.0")
  ) {
    blockers.push("staged trusted publishing requires Node.js 22.14.0 or newer");
  }
  if (
    runtime?.releaseMode === "staged" &&
    !versionAtLeast(runtime.npm, "11.15.0")
  ) {
    blockers.push("staged trusted publishing requires npm 11.15.0 or newer");
  }
  if (
    runtime?.releaseMode === "staged" &&
    runtime.githubActions !== true
  ) {
    blockers.push("staged publication must run inside GitHub Actions");
  }
  if (
    runtime?.releaseMode === "staged" &&
    runtime.ref &&
    runtime?.defaultBranch &&
    runtime.ref !== `refs/heads/${runtime.defaultBranch}`
  ) {
    blockers.push("publication must run from the repository default branch");
  }
  const repositoryUrl =
    typeof packageData.repository === "string"
      ? packageData.repository
      : packageData.repository?.url;
  const normalizeRepository = (value) =>
    String(value ?? "")
      .replace(/^git\+/, "")
      .replace(/^git@github\.com:/, "https://github.com/")
      .replace(/\.git$/, "")
      .replace(/\/$/, "");
  if (
    runtime?.releaseMode === "bootstrap" &&
    runtime.gitBranch !== "main"
  ) {
    blockers.push("bootstrap publication must run from the local main branch");
  }
  if (
    runtime?.releaseMode === "bootstrap" &&
    normalizeRepository(runtime.gitRemote) !== normalizeRepository(repositoryUrl)
  ) {
    blockers.push(
      "bootstrap publication remote must match the package repository",
    );
  }
  if (
    runtime?.repository &&
    repositoryUrl &&
    !normalizeRepository(repositoryUrl).endsWith(
      `github.com/${runtime.repository}`,
    )
  ) {
    blockers.push(
      "package.json repository must match the publishing GitHub repository",
    );
  }
  return blockers;
}

function main() {
  const packageFile = join(PACKAGE_ROOT, "package.json");
  if (!existsSync(packageFile)) {
    throw new Error(`Missing package.json: ${packageFile}`);
  }
  const packageData = JSON.parse(readFileSync(packageFile, "utf8"));
  const npmCli = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].find((candidate) => candidate && existsSync(candidate));
  const npmExecutable = npmCli
    ? process.execPath
    : (process.platform === "win32" ? "npm.cmd" : "npm");
  const npmArguments = npmCli ? [npmCli, "--version"] : ["--version"];
  const npmResult = spawnSync(npmExecutable, npmArguments, {
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
  });
  const gitStatus = spawnSync(
    "git",
    ["-C", PACKAGE_ROOT, "status", "--porcelain", "--untracked-files=all"],
    {
      encoding: "utf8",
      shell: false,
      timeout: 10_000,
    },
  );
  const gitBranch = spawnSync(
    "git",
    ["-C", PACKAGE_ROOT, "branch", "--show-current"],
    {
      encoding: "utf8",
      shell: false,
      timeout: 10_000,
    },
  );
  const gitRemote = spawnSync(
    "git",
    ["-C", PACKAGE_ROOT, "remote", "get-url", "origin"],
    {
      encoding: "utf8",
      shell: false,
      timeout: 10_000,
    },
  );
  const runtime = {
    node: process.versions.node,
    npm: npmResult.status === 0 ? npmResult.stdout.trim() : "unknown",
    releaseMode: process.env.NPM_RELEASE_MODE,
    githubActions: process.env.GITHUB_ACTIONS === "true",
    gitClean: gitStatus.status === 0 && gitStatus.stdout.trim().length === 0,
    gitBranch: gitBranch.status === 0 ? gitBranch.stdout.trim() : null,
    gitRemote: gitRemote.status === 0 ? gitRemote.stdout.trim() : null,
    ref: process.env.RELEASE_REF,
    defaultBranch: process.env.RELEASE_DEFAULT_BRANCH,
    repository: process.env.RELEASE_REPOSITORY,
  };
  const blockers = releaseBlockers(
    packageData,
    process.env.PUBLISH_CONFIRM,
    runtime,
  );
  const result = {
    ok: blockers.length === 0,
    package: `${packageData.name}@${packageData.version}`,
    runtime,
    blockers,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 2;
  }
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

export { releaseBlockers, versionAtLeast };
