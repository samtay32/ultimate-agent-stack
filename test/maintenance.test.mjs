import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { spawnNpm } from "../lib/portable-process.mjs";

const packageData = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
);
const pluginData = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, ".codex-plugin", "plugin.json"), "utf8"),
);
const packageLockData = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "package-lock.json"), "utf8"),
);
const packedSmoke = readFileSync(
  join(PACKAGE_ROOT, "scripts/packed-smoke.mjs"),
  "utf8",
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
const repositoryReviewReceiptWorkflow = readFileSync(
  join(PACKAGE_ROOT, ".github/workflows/review-receipt.yml"),
  "utf8",
);
const ciWorkflow = readFileSync(
  join(PACKAGE_ROOT, ".github/workflows/ci.yml"),
  "utf8",
);
const upstreamWatchWorkflow = readFileSync(
  join(PACKAGE_ROOT, ".github/workflows/upstream-watch.yml"),
  "utf8",
);
const publishWorkflow = readFileSync(
  join(PACKAGE_ROOT, ".github/workflows/publish.yml"),
  "utf8",
);
const releaseSyncWorkflow = readFileSync(
  join(PACKAGE_ROOT, ".github/workflows/sync-github-release.yml"),
  "utf8",
);
const reviewClosurePolicy = readFileSync(
  join(
    PACKAGE_ROOT,
    "skills/close-review-loop/references/review-closure-policy.md",
  ),
  "utf8",
);
const closeReviewSkill = readFileSync(
  join(PACKAGE_ROOT, "skills/close-review-loop/SKILL.md"),
  "utf8",
);
const runDeliverySkill = readFileSync(
  join(PACKAGE_ROOT, "skills/run-autonomous-delivery/SKILL.md"),
  "utf8",
);
const setupProjectSkill = readFileSync(
  join(PACKAGE_ROOT, "skills/setup-autonomous-project/SKILL.md"),
  "utf8",
);
const githubLoop = readFileSync(
  join(PACKAGE_ROOT, "docs/GITHUB_LOOP.md"),
  "utf8",
);
const operatingManual = readFileSync(
  join(PACKAGE_ROOT, "docs/OPERATING_MANUAL.md"),
  "utf8",
);
const starterPrompt = readFileSync(
  join(PACKAGE_ROOT, "STARTER_PROMPT.md"),
  "utf8",
);
const projectAgents = readFileSync(
  join(PACKAGE_ROOT, "assets/project-template/AGENTS.md"),
  "utf8",
);
const readme = readFileSync(join(PACKAGE_ROOT, "README.md"), "utf8");
const behavioralEvals = readFileSync(
  join(PACKAGE_ROOT, "docs/BEHAVIORAL_EVALS.md"),
  "utf8",
);
const releaseGuide = readFileSync(
  join(PACKAGE_ROOT, "docs/RELEASE.md"),
  "utf8",
);
const telemetrySkill = readFileSync(
  join(PACKAGE_ROOT, "skills/use-project-telemetry/SKILL.md"),
  "utf8",
);
const telemetryContract = readFileSync(
  join(
    PACKAGE_ROOT,
    "skills/use-project-telemetry/references/telemetry-contract.md",
  ),
  "utf8",
);
const adaptersGuide = readFileSync(
  join(PACKAGE_ROOT, "docs/ADAPTERS.md"),
  "utf8",
);
const workSkill = readFileSync(
  join(PACKAGE_ROOT, "skills/manage-project-work/SKILL.md"),
  "utf8",
);
const workEvidenceContract = readFileSync(
  join(
    PACKAGE_ROOT,
    "skills/manage-project-work/references/work-evidence-contract.md",
  ),
  "utf8",
);
const linearReadonlyProvider = readFileSync(
  join(
    PACKAGE_ROOT,
    "skills/manage-project-work/references/linear-readonly-provider.md",
  ),
  "utf8",
);
const linearReadonlyHelper = readFileSync(
  join(PACKAGE_ROOT, "scripts/linear-readonly.mjs"),
  "utf8",
);
const packageCliSource = readFileSync(
  join(PACKAGE_ROOT, "bin/ultimate-agent-stack.mjs"),
  "utf8",
);
const workItemSchema = JSON.parse(
  readFileSync(
    join(
      PACKAGE_ROOT,
      "assets/project-template/.agent-stack/contracts/work-item.schema.json",
    ),
    "utf8",
  ),
);
const evidenceGraphSchema = JSON.parse(
  readFileSync(
    join(
      PACKAGE_ROOT,
      "assets/project-template/.agent-stack/contracts/evidence-graph.schema.json",
    ),
    "utf8",
  ),
);

function assertCheckoutCredentialsDisabled(workflow) {
  const lines = workflow.split("\n");
  let checkoutCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const usesMatch = lines[index].match(
      /^(\s*)uses:\s+actions\/checkout@/,
    );
    if (!usesMatch) {
      continue;
    }
    checkoutCount += 1;
    const usesIndent = usesMatch[1].length;
    let stepStart = -1;
    let stepIndent = -1;
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const stepMatch = lines[cursor].match(/^(\s*)-\s+/);
      if (stepMatch && stepMatch[1].length < usesIndent) {
        stepStart = cursor;
        stepIndent = stepMatch[1].length;
        break;
      }
    }
    assert.notEqual(stepStart, -1, "checkout must belong to a workflow step");
    let stepEnd = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const stepMatch = lines[cursor].match(/^(\s*)-\s+/);
      if (stepMatch && stepMatch[1].length === stepIndent) {
        stepEnd = cursor;
        break;
      }
    }
    const withIndex = lines.findIndex(
      (line, cursor) =>
        cursor > index &&
        cursor < stepEnd &&
        /^\s*with:\s*$/.test(line) &&
        line.length - line.trimStart().length > stepIndent,
    );
    assert.notEqual(
      withIndex,
      -1,
      "checkout must contain a with block",
    );
    const withIndent =
      lines[withIndex].length - lines[withIndex].trimStart().length;
    let credentialsDisabled = false;
    for (let cursor = withIndex + 1; cursor < stepEnd; cursor += 1) {
      const line = lines[cursor];
      if (line.trim().length === 0) {
        continue;
      }
      const indentation = line.length - line.trimStart().length;
      if (indentation <= withIndent) {
        break;
      }
      if (line.trim() === "persist-credentials: false") {
        credentialsDisabled = true;
        break;
      }
    }
    assert.equal(
      credentialsDisabled,
      true,
      "checkout with block must disable persisted credentials",
    );
  }
  assert.ok(checkoutCount > 0, "workflow must contain a checkout step");
}

test("package, plugin, and CLI identity stay synchronized", () => {
  assert.equal(PACKAGE_NAME, packageData.name);
  assert.equal(PACKAGE_VERSION, packageData.version);
  assert.equal(pluginData.name, packageData.name);
  assert.equal(pluginData.version, packageData.version);
  assert.equal(packageLockData.version, packageData.version);
  assert.equal(packageLockData.packages[""].version, packageData.version);
});

test("repository and installed-project CodeRabbit policies stay synchronized", () => {
  assert.equal(repositoryCodeRabbit, templateCodeRabbit);
  assert.match(repositoryCodeRabbit, /profile: "assertive"/);
  assert.match(repositoryCodeRabbit, /auto_incremental_review: false/);
});

test("installed doctor guidance is version-bound and directory metadata fits", () => {
  assert.ok(
    [...pluginData.interface.shortDescription].length <= 30,
    "public plugin short description must be 30 characters or fewer",
  );
  for (const source of [
    projectAgents,
    readme,
    starterPrompt,
    operatingManual,
    runDeliverySkill,
    setupProjectSkill,
  ]) {
    assert.doesNotMatch(
      source,
      /ultimate-agent-stack@latest doctor/,
      "installed projects must not execute mutable latest-tag doctor code",
    );
    assert.match(
      source,
      /node \.agent-stack\/bin\/agent-stack\.mjs doctor/,
    );
  }
});

test("review closure validates claims and has one disposition vocabulary", () => {
  const dispositionLine = reviewClosurePolicy.match(
    /^Disposition: (.+)$/m,
  );
  assert.ok(dispositionLine, "review policy must define its response format");
  assert.deepEqual(
    dispositionLine[1].split(" | "),
    ["fixed", "rebutted", "deferred", "decision-needed"],
  );
  assert.match(
    reviewClosurePolicy,
    /Treat every reviewer claim as a hypothesis/,
  );
  assert.match(
    reviewClosurePolicy,
    /Never change production code merely because a reviewer asserted a defect/,
  );
  assert.match(
    closeReviewSkill,
    /Validate each reviewer claim before acting/,
  );
  assert.match(
    closeReviewSkill,
    /Apply one exact canonical disposition and the response format/,
  );

  for (const source of [
    closeReviewSkill,
    githubLoop,
    starterPrompt,
    projectAgents,
    readme,
  ]) {
    assert.match(
      source,
      /Review\s+Closure Policy|review-closure-policy\.md/,
    );
    assert.doesNotMatch(
      source,
      /\*\*(?:fix|rebut|defer|decision needed):\*\*/,
      "secondary guidance must not restate noncanonical labels",
    );
    assert.doesNotMatch(
      source,
      /^[ \t]*Disposition:/m,
      "secondary guidance must defer to the canonical policy",
    );
  }
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
  assert.doesNotMatch(
    reviewReceiptWorkflow,
    /pull_request\.head|bootstrap-gate/,
  );
});

test("repository and installed receipt workflows preserve trusted controls", () => {
  for (const workflow of [
    repositoryReviewReceiptWorkflow,
    reviewReceiptWorkflow,
  ]) {
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /pr_number:/);
    assert.match(workflow, /concurrency:/);
    assert.match(
      workflow,
      /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/,
    );
    assert.match(
      workflow,
      /--repo "\$GITHUB_REPOSITORY"\s+--pr "\$PR_NUMBER"/,
    );
  }
  assert.doesNotMatch(repositoryReviewReceiptWorkflow, /--config/);
  assert.match(
    reviewReceiptWorkflow,
    /--config \.agent-stack\/config\.json/,
  );
});

test("read-only workflow checkouts do not persist Git credentials", () => {
  for (const workflow of [
    ciWorkflow,
    upstreamWatchWorkflow,
    repositoryReviewReceiptWorkflow,
    reviewReceiptWorkflow,
  ]) {
    assertCheckoutCredentialsDisabled(workflow);
  }
});

test("CI covers minimum Node and Windows before the required verify job", () => {
  assert.match(ciWorkflow, /compatibility:/);
  assert.match(ciWorkflow, /name: ubuntu-node-minimum/);
  assert.match(ciWorkflow, /name: windows-node-minimum/);
  assert.match(ciWorkflow, /name: windows-node-current/);
  assert.equal([...ciWorkflow.matchAll(/node: 22\b/g)].length, 2);
  assert.equal([...ciWorkflow.matchAll(/node: 26\b/g)].length, 1);
  assert.doesNotMatch(ciWorkflow, /20\.12/);
  assert.match(ciWorkflow, /os: windows-latest/);
  assert.match(ciWorkflow, /verify:\s+needs: compatibility/);
  assert.ok(
    [...ciWorkflow.matchAll(/run: npm run release:check/g)].length >= 2,
    "both compatibility and required verify must run the release gate",
  );
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
  assert.equal(
    packageData.scripts?.test,
    "node --test",
    "test discovery must not depend on shell glob expansion",
  );
  assert.deepEqual(
    packageData.files.filter((entry) => entry.startsWith("scripts/")),
    [
    "scripts/github-release-sync.mjs",
    "scripts/gbrain-project.mjs",
    "scripts/linear-readonly.mjs",
    "scripts/check-portable-bundle.mjs",
      "scripts/packed-smoke.mjs",
      "scripts/release-preflight.mjs",
      "scripts/review-receipt.mjs",
      "scripts/skill-eval.mjs",
      "scripts/upstream-issue.mjs",
    ],
  );
  assert.equal(
    packageData.files.some((entry) => entry.includes("* 2.*")),
    false,
    "package files must not rely on inconsistent negation patterns",
  );
  assert.equal(
    packageData.files.includes("STARTER_PROMPT.md"),
    true,
    "package files must include STARTER_PROMPT.md",
  );
  assert.equal(
    packageData.files.includes("SECURITY.md"),
    true,
    "package files must include the private vulnerability reporting policy",
  );
  assert.equal(packageData.files.includes("lib/"), true);
  assert.equal(packageData.files.includes("evals/"), true);
  assert.equal(
    packageData.scripts?.["eval:contracts"],
    "node scripts/skill-eval.mjs contracts",
  );
  assert.match(packageData.scripts?.["release:check"], /eval:contracts/);
  assert.match(packedSmoke, /packed\[0\]\.files/);
  assert.match(packedSmoke, /duplicate-copy paths/);
  assert.match(packedSmoke, /spawnNpm/);
  assert.match(packedSmoke, /node --test tests\/smoke\.test\.mjs/);
  assert.equal(packageData.engines?.node, ">=22");
  assert.deepEqual(packageData.dependencies ?? {}, {});
  assert.equal(packageData.devDependencies?.["cross-spawn"], "7.0.6");
  assert.equal(packageData.devDependencies?.esbuild, "0.28.1");
  assert.equal(
    packageLockData.packages?.[""]?.devDependencies?.["cross-spawn"],
    "7.0.6",
  );
  assert.match(packageData.scripts?.["release:check"], /check:portable/);
});

test("release docs separate deterministic contracts from live model evidence", () => {
  for (const source of [behavioralEvals, releaseGuide, readme]) {
    assert.match(source, /behavior(?:al)?/i);
  }
  assert.match(
    behavioralEvals,
    /They cannot prove that a model activates\s+the right skill/,
  );
  assert.match(behavioralEvals, /false activation/);
  assert.match(behavioralEvals, /`must_activate` is empty/);
  assert.match(behavioralEvals, /names every skill currently in the catalog/);
  assert.match(behavioralEvals, /surface.hash/i);
  assert.match(releaseGuide, /real supported harness/);
  assert.equal(
    [
      ...releaseGuide.matchAll(
        /no\s+accepted evaluated report exists or the behavior-surface hash\s+changed/g,
      ),
    ].length,
    2,
  );
  assert.match(
    releaseGuide,
    /must not be generalized\s+to\s+untested providers/,
  );
});

test("telemetry remains optional, bounded, read-only, and provider-neutral", () => {
  for (const source of [
    telemetrySkill,
    telemetryContract,
    adaptersGuide,
    operatingManual,
    projectAgents,
    readme,
  ]) {
    assert.match(source, /read[- ]only/i);
    assert.match(source, /repository evidence/i);
  }
  assert.match(telemetrySkill, /Never send Ultimate Agent Stack usage data/);
  assert.match(telemetrySkill, /Never mutate provider data/);
  assert.match(telemetryContract, /Do not place authentication material/);
  assert.match(telemetryContract, /OpenTelemetry is a vendor-neutral/);
  assert.match(adaptersGuide, /sends no usage telemetry/);
  assert.match(adaptersGuide, /multi-provider|more than one provider/i);
  assert.doesNotMatch(
    telemetryContract,
    /api[_ -]?key|access[_ -]?token|client[_ -]?secret/i,
    "the provider-neutral contract must not introduce credential fields",
  );
});

test("work and evidence contracts remain portable and provider-neutral", () => {
  for (const source of [
    workSkill,
    workEvidenceContract,
    linearReadonlyProvider,
    adaptersGuide,
    projectAgents,
    readme,
  ]) {
    assert.match(source, /repository/i);
    assert.match(source, /provider/i);
    assert.match(source, /evidence/i);
  }
  assert.match(workSkill, /provider never grants authority/i);
  assert.match(workSkill, /Do not infer completion from a provider status/i);
  assert.match(workEvidenceContract, /Provider labels never replace/);
  assert.match(workEvidenceContract, /Never store an access token/);
  assert.match(linearReadonlyProvider, /mcp\/readonly/);
  assert.match(linearReadonlyProvider, /repository fallback/i);
  assert.doesNotMatch(linearReadonlyHelper, /\bmutation\b/i);
  assert.match(linearReadonlyHelper, /https:\/\/api\.linear\.app\/graphql/);
  const linearReadonlyHash = createHash("sha256")
    .update(linearReadonlyHelper.replaceAll("\r\n", "\n"))
    .digest("hex");
  assert.match(packageCliSource, new RegExp(linearReadonlyHash));
  assert.equal(workItemSchema.additionalProperties, false);
  assert.equal(evidenceGraphSchema.additionalProperties, false);
  assert.equal(
    workItemSchema.$defs.timestamp.oneOf[1].pattern,
    "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$",
  );
  assert.equal(
    evidenceGraphSchema.$defs.timestamp.oneOf[1].pattern,
    workItemSchema.$defs.timestamp.oneOf[1].pattern,
  );
  assert.equal(
    workItemSchema.$defs.workItem.properties.external_refs.uniqueItems,
    true,
  );
  assert.equal(evidenceGraphSchema.properties.edges.uniqueItems, true);
  assert.equal(
    workItemSchema.$defs.workItem.properties.status.enum.includes("done"),
    true,
  );
  assert.equal(
    evidenceGraphSchema.$defs.edge.properties.relation.enum.includes(
      "verifies",
    ),
    true,
  );
  assert.match(
    adaptersGuide,
    /acceptance,\s+implementation,\s+verification,\s+and review evidence/i,
  );
  assert.match(
    workEvidenceContract,
    /Every item\s+beyond `backlog` requires a matching `work_item` node/i,
  );
});

test("npm staging and GitHub release permissions remain separated", () => {
  assert.doesNotMatch(publishWorkflow, /^permissions:/m);
  assert.match(publishWorkflow, /publish:\s+environment: npm/);
  assert.match(
    publishWorkflow,
    /publish:[\s\S]*?permissions:\s+contents: read[^\n]*\s+id-token: write[^\n]*/,
  );
  assert.match(
    publishWorkflow,
    /prepare-github-release:\s+needs: publish[\s\S]*?permissions:\s+contents: write[^\n]*/,
  );
  assert.match(
    publishWorkflow,
    /ref: \$\{\{ github\.sha \}\}[\s\S]*?persist-credentials: false/,
  );
  assert.match(
    publishWorkflow,
    /node scripts\/github-release-sync\.mjs prepare/,
  );
  assert.equal(
    [...publishWorkflow.matchAll(/uses: actions\/checkout@/g)].length,
    [...publishWorkflow.matchAll(/persist-credentials: false/g)].length,
  );
});

test("release synchronization runs trusted code and retains human npm approval", () => {
  assert.match(releaseSyncWorkflow, /schedule:/);
  assert.match(releaseSyncWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(releaseSyncWorkflow, /^permissions:/m);
  assert.match(
    releaseSyncWorkflow,
    /jobs:\s+sync:[\s\S]*?permissions:\s+contents: write[^\n]*/,
  );
  assert.match(
    releaseSyncWorkflow,
    /if: github\.ref_name == github\.event\.repository\.default_branch/,
  );
  assert.match(releaseSyncWorkflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(releaseSyncWorkflow, /persist-credentials: false/);
  assert.match(releaseSyncWorkflow, /npm install --global npm@11\.15\.0/);
  assert.equal(
    [...releaseSyncWorkflow.matchAll(/uses: actions\/checkout@/g)].length,
    [...releaseSyncWorkflow.matchAll(/persist-credentials: false/g)].length,
  );
  assert.match(
    releaseSyncWorkflow,
    /node scripts\/github-release-sync\.mjs sync/,
  );
  assert.doesNotMatch(releaseSyncWorkflow, /npm (?:stage )?publish/);
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
  assert.equal(
    blockers.some((item) => item.includes("license")),
    false,
  );
  assert.equal(
    blockers.some((item) => item.includes("repository")),
    false,
  );
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
      node: "22.0.0",
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
  assert.match(stagedRuntimeBlockers, /Node.js 22.14.0/);
  assert.match(stagedRuntimeBlockers, /npm 11.15.0/);
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
  const environment = { ...process.env };
  delete environment.NPM_RELEASE_MODE;
  delete environment.PUBLISH_CONFIRM;
  const result = spawnNpm(["publish", "--dry-run"], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    env: environment,
    timeout: 30_000,
  });

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /release mode must be explicitly set|confirmation must exactly equal/,
  );
});

test("portable npm fallback works without npm_execpath", () => {
  const environment = { ...process.env };
  delete environment.npm_execpath;
  const result = spawnNpm(["--version"], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    env: environment,
    timeout: 10_000,
  });

  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.match(result.stdout, /^\d+\./);
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
  assert.equal(
    markdownCell("line one|line two\nline three"),
    "line one\\|line two line three",
  );
  assert.equal(parseRepository("owner/repository"), "owner/repository");
  assert.throws(() => parseRepository("https://github.com/owner/repository"));
});
