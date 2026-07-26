import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  PACKAGE_NAME,
  PACKAGE_ROOT,
  PACKAGE_VERSION,
} from "../bin/ultimate-agent-stack.mjs";
import {
  buildIssueBody,
  markdownCell,
  parseRepository,
} from "../scripts/upstream-issue.mjs";
import {
  releaseBlockers,
  versionAtLeast,
} from "../scripts/release-preflight.mjs";

const packageData = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
);
const pluginData = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, ".codex-plugin", "plugin.json"), "utf8"),
);
const repositoryCodeRabbit = readFileSync(
  join(PACKAGE_ROOT, ".coderabbit.yaml"),
  "utf8",
);
const templateCodeRabbit = readFileSync(
  join(PACKAGE_ROOT, "assets/project-template/.coderabbit.yaml"),
  "utf8",
);
const reviewReceiptWorkflow = readFileSync(
  join(
    PACKAGE_ROOT,
    "assets/project-template/.github/workflows/review-receipt.yml",
  ),
  "utf8",
);

test("package, plugin, and CLI identity stay synchronized", () => {
  assert.equal(PACKAGE_NAME, packageData.name);
  assert.equal(PACKAGE_VERSION, packageData.version);
  assert.equal(pluginData.name, packageData.name);
  assert.equal(pluginData.version, packageData.version);
});

test("repository and installed-project CodeRabbit policies stay synchronized", () => {
  assert.equal(repositoryCodeRabbit, templateCodeRabbit);
  assert.match(repositoryCodeRabbit, /profile: "assertive"/);
  assert.match(repositoryCodeRabbit, /auto_incremental_review: false/);
});

test("review receipt workflow never executes the pull request copy of its gate", () => {
  assert.match(
    reviewReceiptWorkflow,
    /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/,
  );
  assert.match(
    reviewReceiptWorkflow,
    /node \.agent-stack\/bin\/review-receipt\.mjs/,
  );
  assert.doesNotMatch(reviewReceiptWorkflow, /pull_request\.head|bootstrap-gate/);
});

test("package has no install hooks and guards publication with prepublishOnly", () => {
  const lifecycle = [
    "preinstall",
    "install",
    "postinstall",
    "prepare",
    "prepublish",
  ];
  for (const name of lifecycle) {
    assert.equal(packageData.scripts?.[name], undefined);
  }
  assert.equal(
    packageData.scripts?.prepublishOnly,
    "node scripts/release-preflight.mjs",
  );
  assert.deepEqual(packageData.dependencies ?? {}, {});
});

test("release preflight records public identity and still requires release authority", () => {
  const blockers = releaseBlockers(
    packageData,
    `${packageData.name}@${packageData.version}`,
  );
  assert.equal(packageData.license, "MIT");
  assert.match(
    typeof packageData.repository === "string"
      ? packageData.repository
      : packageData.repository.url,
    /github\.com\/samtay32\/ultimate-agent-stack/,
  );
  assert.equal(blockers.some((item) => item.includes("license")), false);
  assert.equal(blockers.some((item) => item.includes("repository")), false);
  assert.ok(blockers.some((item) => item.includes("release mode")));
});

test("release preflight accepts explicit fully configured metadata", () => {
  const candidate = {
    name: "example-package",
    version: "1.2.3",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/example/example-package.git",
    },
  };
  assert.match(
    releaseBlockers(candidate, "example-package@1.2.3").join("\n"),
    /release mode/,
  );
  assert.deepEqual(
    releaseBlockers(candidate, "example-package@1.2.3", {
      node: "20.12.0",
      npm: "10.8.0",
      releaseMode: "bootstrap",
      gitClean: true,
      gitBranch: "main",
      gitRemote: "https://github.com/example/example-package.git",
    }),
    [],
  );
  assert.match(
    releaseBlockers(candidate, "example-package@1.2.3", {
      node: "24.0.0",
      npm: "11.15.0",
      releaseMode: "staged",
      githubActions: true,
      gitClean: true,
      ref: "refs/heads/release-test",
      defaultBranch: "main",
      repository: "other/example-package",
    }).join("\n"),
    /default branch|publishing GitHub repository/,
  );
  assert.equal(versionAtLeast("22.14.0", "22.14.0"), true);
  assert.equal(versionAtLeast("22.13.9", "22.14.0"), false);
  const stagedRuntimeBlockers = releaseBlockers(
    candidate,
    "example-package@1.2.3",
    {
      node: "20.19.0",
      npm: "10.8.2",
      releaseMode: "staged",
      githubActions: true,
      gitClean: true,
      ref: "refs/heads/main",
      defaultBranch: "main",
      repository: "example/example-package",
    },
  ).join("\n");
  assert.match(
    stagedRuntimeBlockers,
    /Node.js 22.14.0/,
  );
  assert.match(
    stagedRuntimeBlockers,
    /npm 11.15.0/,
  );
  assert.match(
    releaseBlockers(candidate, "example-package@1.2.3", {
      node: "24.0.0",
      npm: "11.15.0",
      releaseMode: "staged",
      githubActions: false,
      gitClean: true,
      ref: "refs/heads/main",
      defaultBranch: "main",
      repository: "example/example-package",
    }).join("\n"),
    /GitHub Actions/,
  );
  assert.match(
    releaseBlockers(candidate, "example-package@1.2.3", {
      node: "24.0.0",
      npm: "11.15.0",
      releaseMode: "bootstrap",
      gitClean: false,
      gitBranch: "main",
      gitRemote: "https://github.com/example/example-package.git",
    }).join("\n"),
    /working tree/,
  );
  assert.match(
    releaseBlockers(candidate, "example-package@1.2.3", {
      node: "24.0.0",
      npm: "11.15.0",
      releaseMode: "bootstrap",
      gitClean: true,
      gitBranch: "feature",
      gitRemote: "https://github.com/example/wrong-package.git",
    }).join("\n"),
    /local main branch|remote must match/,
  );
});

test("direct npm publication fails closed without explicit release authority", () => {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const environment = { ...process.env };
  delete environment.NPM_RELEASE_MODE;
  delete environment.PUBLISH_CONFIRM;
  const result = spawnSync(npmExecutable, ["publish", "--dry-run"], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    env: environment,
    shell: false,
    timeout: 30_000,
  });

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /release mode must be explicitly set|confirmation must exactly equal/,
  );
});

test("upstream issue body is review-only and repository names are validated", () => {
  const body = buildIssueBody({
    checked_at: "2026-07-25T00:00:00.000Z",
    changed: [
      {
        id: "source",
        status: "changed",
        pinned_commit: "abc",
        remote_commit: "def",
      },
    ],
    errors: [],
  });
  assert.match(body, /untrusted research inputs/);
  assert.match(body, /Do not copy, merge, install, or publish/);
  assert.equal(markdownCell("line one|line two\nline three"), "line one\\|line two line three");
  assert.equal(parseRepository("owner/repository"), "owner/repository");
  assert.throws(() => parseRepository("https://github.com/owner/repository"));
});
