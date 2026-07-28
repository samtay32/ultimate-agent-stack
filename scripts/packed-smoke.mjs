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
import { fileURLToPath } from "node:url";

import {
  spawnNpm,
  spawnPortable,
} from "../lib/portable-process.mjs";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(SCRIPT_FILE), "..");

function run(command, args, cwd) {
  const result = spawnPortable(command, args, {
    cwd,
    encoding: "utf8",
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

function runNpm(args, cwd) {
  const result = spawnNpm(args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `npm ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function main() {
  const sandbox = mkdtempSync(join(tmpdir(), "ultimate-agent-stack-pack-"));
  try {
    const packOutput = runNpm(
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
            test: "node --test tests/smoke.test.mjs",
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
    runNpm(
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
    const expectedFiles = [
      [[".agent-stack", "bin", "agent-stack.mjs"], "project CLI"],
      [[".agent-stack", ".gitignore"], "project evidence ignore"],
      [
        [
          ".agents",
          "skills",
          "coordinate-parallel-delivery",
          "SKILL.md",
        ],
        "coordination skill",
      ],
      [
        [".agents", "skills", "use-project-knowledge", "SKILL.md"],
        "knowledge skill",
      ],
      [
        [".agents", "skills", "use-project-telemetry", "SKILL.md"],
        "telemetry skill",
      ],
      [
        [".agents", "skills", "manage-project-work", "SKILL.md"],
        "work-management skill",
      ],
      [
        [".agent-stack", "work-items.json"],
        "repository work ledger",
      ],
      [
        [".agent-stack", "evidence-graph.json"],
        "repository evidence graph",
      ],
      [
        [".agent-stack", "bin", "linear-readonly.mjs"],
        "protected Linear read-only helper",
      ],
      [
        [".agent-stack", "bin", "linear-write.mjs"],
        "protected Linear write helper",
      ],
      [
        [
          ".agent-stack",
          "contracts",
          "provider-receipt.schema.json",
        ],
        "provider receipt contract",
      ],
      [
        [
          ".agent-stack",
          "contracts",
          "campaign-state.schema.json",
        ],
        "bounded campaign contract",
      ],
      [
        [".codex", "agents", "uas_researcher.toml"],
        "Codex worker adapter",
      ],
      [
        [
          ".claude",
          "skills",
          "run-autonomous-delivery",
          "SKILL.md",
        ],
        "Claude entry skill",
      ],
      [
        [".gemini", "agents", "uas-researcher.md"],
        "Gemini worker adapter",
      ],
      [
        [".opencode", "agents", "uas-researcher.md"],
        "OpenCode worker adapter",
      ],
    ];
    for (const [segments, description] of expectedFiles) {
      if (!existsSync(join(project, ...segments))) {
        throw new Error(`packed install did not create the ${description}`);
      }
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
      config.schema_version !== 6 ||
      config.onboarding?.status !== "pending" ||
      config.capabilities?.review?.provider !== "builtin" ||
      config.capabilities?.knowledge?.provider !== "repository" ||
      config.capabilities?.knowledge?.scope !== "project" ||
      !Array.isArray(config.capabilities?.telemetry?.providers) ||
      config.capabilities.telemetry.providers.length !== 0 ||
      config.capabilities.telemetry.required !== false ||
      config.capabilities.telemetry.default_access !== "read_only" ||
      config.capabilities.telemetry.evidence_capture !==
        "bounded_references_only" ||
      config.capabilities.telemetry.raw_payload_storage !== false ||
      config.capabilities.telemetry.repository_fallback !== true ||
      config.capabilities?.work?.provider !== "repository" ||
      config.capabilities?.work?.required !== false ||
      config.capabilities?.work?.sync_mode !== "repository_only" ||
      config.capabilities?.work?.write_policy !== "repository_only" ||
      config.capabilities?.work?.repository_fallback !== true ||
      config.capabilities?.work?.connection !== null ||
      !Array.isArray(config.quality?.environment?.allow) ||
      config.quality.environment.allow.length !== 0
    ) {
      throw new Error("packed install did not preserve safe guided defaults");
    }
    const start = JSON.parse(
      run(process.execPath, [localCli, "start", "--target", project], project),
    );
    if (start.phase !== "onboarding") {
      throw new Error("packed install did not enter guided onboarding");
    }
    const receipts = JSON.parse(
      run(
        process.execPath,
        [localCli, "receipts", "validate", "--target", project],
        project,
      ),
    );
    if (!receipts.ok || receipts.receipt_count !== 0) {
      throw new Error("packed install did not validate empty provider receipts");
    }
    const campaign = JSON.parse(
      run(
        process.execPath,
        [localCli, "campaign", "status", "--target", project],
        project,
      ),
    );
    if (!campaign.ok || campaign.campaign !== null) {
      throw new Error("packed install did not report an inactive campaign");
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
