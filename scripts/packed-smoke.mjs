#!/usr/bin/env node

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(SCRIPT_FILE), "..");
const NPM_EXECUTABLE = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function main() {
  const sandbox = mkdtempSync(join(tmpdir(), "ultimate-agent-stack-pack-"));
  try {
    const packOutput = run(
      NPM_EXECUTABLE,
      ["pack", "--json", "--pack-destination", sandbox],
      PACKAGE_ROOT,
    );
    const packed = JSON.parse(packOutput);
    if (!Array.isArray(packed) || !packed[0]?.filename) {
      throw new Error("npm pack did not return a tarball filename");
    }
    const duplicatePaths = (packed[0].files ?? [])
      .map((entry) => entry.path)
      .filter((path) => /(?:^|\/)[^/]+ 2\.[^/]+$/.test(path));
    if (duplicatePaths.length > 0) {
      throw new Error(
        `npm pack included duplicate-copy paths: ${duplicatePaths.join(", ")}`,
      );
    }
    const tarball = join(sandbox, packed[0].filename);
    const project = join(sandbox, "project");
    mkdirSync(project);
    run("git", ["init", project], PACKAGE_ROOT);
    writeFileSync(
      join(project, "package.json"),
      `${JSON.stringify(
        {
          name: "packed-smoke-fixture",
          private: true,
          scripts: {
            test: "node --test tests/*.test.mjs",
          },
        },
        null,
        2,
      )}\n`,
    );
    mkdirSync(join(project, "tests"));
    writeFileSync(
      join(project, "tests", "smoke.test.mjs"),
      [
        "import assert from 'node:assert/strict';",
        "import test from 'node:test';",
        "test('packed fixture', () => assert.equal(2 + 2, 4));",
        "",
      ].join("\n"),
    );
    run(
      NPM_EXECUTABLE,
      [
        "exec",
        "--yes",
        `--package=${tarball}`,
        "--",
        "ultimate-agent-stack",
        "init",
        "--target",
        project,
      ],
      project,
    );
    const localCli = join(project, ".agent-stack", "bin", "agent-stack.mjs");
    if (!existsSync(localCli)) {
      throw new Error("packed install did not create the project CLI");
    }
    if (!existsSync(join(project, ".agent-stack", ".gitignore"))) {
      throw new Error("packed install did not create the project evidence ignore");
    }
    if (
      !existsSync(
        join(
          project,
          ".agents",
          "skills",
          "coordinate-parallel-delivery",
          "SKILL.md",
        ),
      )
    ) {
      throw new Error("packed install did not create the coordination skill");
    }
    if (
      !existsSync(
        join(
          project,
          ".agents",
          "skills",
          "use-project-knowledge",
          "SKILL.md",
        ),
      )
    ) {
      throw new Error("packed install did not create the knowledge skill");
    }
    if (
      !existsSync(
        join(project, ".codex", "agents", "uas_researcher.toml"),
      )
    ) {
      throw new Error("packed install did not create the Codex worker adapter");
    }
    if (
      !existsSync(
        join(project, ".gemini", "agents", "uas-researcher.md"),
      )
    ) {
      throw new Error("packed install did not create the Gemini worker adapter");
    }
    if (
      !existsSync(
        join(project, ".opencode", "agents", "uas-researcher.md"),
      )
    ) {
      throw new Error("packed install did not create the OpenCode worker adapter");
    }
    const version = JSON.parse(
      run(process.execPath, [localCli, "--version"], project),
    );
    const packageData = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
    );
    if (
      version.name !== packageData.name ||
      version.version !== packageData.version
    ) {
      throw new Error("packed CLI version does not match package.json");
    }
    const config = JSON.parse(
      readFileSync(join(project, ".agent-stack", "config.json"), "utf8"),
    );
    if (
      config.schema_version !== 2 ||
      config.onboarding?.status !== "pending" ||
      config.capabilities?.review?.provider !== "builtin" ||
      config.capabilities?.knowledge?.provider !== "repository" ||
      config.capabilities?.knowledge?.scope !== "project"
    ) {
      throw new Error("packed install did not preserve safe guided defaults");
    }
    const start = JSON.parse(
      run(process.execPath, [localCli, "start", "--target", project], project),
    );
    if (start.phase !== "onboarding") {
      throw new Error("packed install did not enter guided onboarding");
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          package: `${version.name}@${version.version}`,
          installed_files: packed[0].entryCount,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
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
