import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  PACKAGE_NAME,
  PACKAGE_ROOT,
  PACKAGE_VERSION,
  portableTextSha256,
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
const closeReviewDescription = frontmatterDescription(closeReviewSkill);
const runDeliverySkill = readFileSync(
  join(PACKAGE_ROOT, "skills/run-autonomous-delivery/SKILL.md"),
  "utf8",
);
const deliveryPolicy = readFileSync(
  join(
    PACKAGE_ROOT,
    "skills/run-autonomous-delivery/references/delivery-policy.md",
  ),
  "utf8",
);
const developBriefSkill = readFileSync(
  join(PACKAGE_ROOT, "skills/develop-project-brief/SKILL.md"),
  "utf8",
);
function frontmatterDescription(source) {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(frontmatter, "skill must have YAML frontmatter");
  const description = frontmatter[1]
    .split(/\r?\n/)
    .find((line) => line.startsWith("description: "));
  assert.ok(description, "skill frontmatter must contain description");
  return description.slice("description: ".length);
}
const runDeliveryDescription = frontmatterDescription(runDeliverySkill);
const developBriefDescription = frontmatterDescription(developBriefSkill);
const briefContract = readFileSync(
  join(
    PACKAGE_ROOT,
    "skills/develop-project-brief/references/brief-contract.md",
  ),
  "utf8",
);
const intakeReconciliation = readFileSync(
  join(
    PACKAGE_ROOT,
    "skills/develop-project-brief/references/intake-and-reconciliation.md",
  ),
  "utf8",
);
const briefTemplate = readFileSync(
  join(
    PACKAGE_ROOT,
    "assets/project-template/.agent-stack/artifacts/BRIEF.md",
  ),
  "utf8",
);
const decisionsTemplate = readFileSync(
  join(
    PACKAGE_ROOT,
    "assets/project-template/.agent-stack/artifacts/DECISIONS.md",
  ),
  "utf8",
);
const shapeProjectSkill = readFileSync(
  join(PACKAGE_ROOT, "skills/shape-project/SKILL.md"),
  "utf8",
);
const buildSliceSkill = readFileSync(
  join(PACKAGE_ROOT, "skills/build-vertical-slice/SKILL.md"),
  "utf8",
);
const verifyChangeSkill = readFileSync(
  join(PACKAGE_ROOT, "skills/verify-change/SKILL.md"),
  "utf8",
);
const coordinateDeliverySkill = readFileSync(
  join(PACKAGE_ROOT, "skills/coordinate-parallel-delivery/SKILL.md"),
  "utf8",
);
const delegationContract = readFileSync(
  join(
    PACKAGE_ROOT,
    "skills/coordinate-parallel-delivery/references/delegation-contract.md",
  ),
  "utf8",
);
const shapingContract = readFileSync(
  join(PACKAGE_ROOT, "skills/shape-project/references/shaping-contract.md"),
  "utf8",
);
const securityReadiness = readFileSync(
  join(PACKAGE_ROOT, "skills/secure-launch/references/security-readiness.md"),
  "utf8",
);
const verificationMatrix = readFileSync(
  join(PACKAGE_ROOT, "skills/verify-change/references/verification-matrix.md"),
  "utf8",
);
const setupProjectSkill = readFileSync(
  join(PACKAGE_ROOT, "skills/setup-autonomous-project/SKILL.md"),
  "utf8",
);
const manageProjectWorkSkill = readFileSync(
  join(PACKAGE_ROOT, "skills/manage-project-work/SKILL.md"),
  "utf8",
);
const plainLanguageEntryAdapters = [
  "setup-autonomous-project",
  "run-autonomous-delivery",
  "use-project-telemetry",
  "maintain-agent-stack",
].map((skill) =>
  readFileSync(
    join(PACKAGE_ROOT, `skills/${skill}/agents/openai.yaml`),
    "utf8",
  ),
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
const handoffTemplate = readFileSync(
  join(PACKAGE_ROOT, "assets/project-template/.agent-stack/HANDOFF.md"),
  "utf8",
);
const projectAgents = readFileSync(
  join(PACKAGE_ROOT, "assets/project-template/AGENTS.md"),
  "utf8",
);
const claudeAdapter = readFileSync(
  join(PACKAGE_ROOT, "assets/project-template/CLAUDE.md"),
  "utf8",
);
const geminiAdapter = readFileSync(
  join(PACKAGE_ROOT, "assets/project-template/GEMINI.md"),
  "utf8",
);
const readme = readFileSync(join(PACKAGE_ROOT, "README.md"), "utf8");
const trustGuide = readFileSync(
  join(PACKAGE_ROOT, "docs/TRUST.md"),
  "utf8",
);
const sourcesAndTradeoffs = readFileSync(
  join(PACKAGE_ROOT, "docs/SOURCES_AND_TRADEOFFS.md"),
  "utf8",
);
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
const linearWriteHelper = readFileSync(
  join(PACKAGE_ROOT, "scripts/linear-write.mjs"),
  "utf8",
);
const telemetryReadonlyHelper = readFileSync(
  join(PACKAGE_ROOT, "scripts/telemetry-readonly.mjs"),
  "utf8",
);
const linearReceiptedWrites = readFileSync(
  join(
    PACKAGE_ROOT,
    "skills/manage-project-work/references/linear-receipted-writes.md",
  ),
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
const providerReceiptSchema = JSON.parse(
  readFileSync(
    join(
      PACKAGE_ROOT,
      "assets/project-template/.agent-stack/contracts/provider-receipt.schema.json",
    ),
    "utf8",
  ),
);
const campaignStateSchema = JSON.parse(
  readFileSync(
    join(
      PACKAGE_ROOT,
      "assets/project-template/.agent-stack/contracts/campaign-state.schema.json",
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
  const decodedCloseReviewDescription = JSON.parse(closeReviewDescription);
  assert.equal(typeof decodedCloseReviewDescription, "string");
  assert.match(decodedCloseReviewDescription, /review thread: address/);

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

test("plain-language entry skills permit implicit activation", () => {
  for (const adapter of plainLanguageEntryAdapters) {
    assert.match(adapter, /allow_implicit_invocation:\s*true\b/);
  }
});

test("flexible intake stays ordered, proportionate, and source preserving", () => {
  for (const source of [
    runDeliverySkill,
    deliveryPolicy,
    packageCliSource,
    starterPrompt,
    projectAgents,
    handoffTemplate,
  ]) {
    let previous = -1;
    for (const marker of ["RESUME", "EXTERNAL", "DISCOVER", "DIRECT"]) {
      const current = source.indexOf(marker, previous + 1);
      assert.ok(
        current > previous,
        `${marker} must follow the preceding intake mode`,
      );
      previous = current;
    }
  }

  assert.match(developBriefSkill, /references\/brief-contract\.md/);
  assert.match(developBriefSkill, /references\/intake-and-reconciliation\.md/);
  assert.match(
    runDeliveryDescription,
    /including vague greenfield ideas and elaborate supplied plans/,
  );
  assert.match(
    runDeliveryDescription,
    /activate develop-project-brief under this controller before shaping/,
  );
  assert.match(
    developBriefDescription,
    /For an end-to-end DISCOVER or EXTERNAL request, activate run-autonomous-delivery instead/,
  );
  assert.match(
    developBriefDescription,
    /Activate this directly only when the request is explicitly limited to brief refinement, source audit, or reconciliation/,
  );
  assert.match(runDeliveryDescription, /Do not activate for explanation-only/);
  assert.match(
    runDeliveryDescription,
    /requests explicitly limited to brief refinement, source audit, or reconciliation/,
  );
  assert.match(developBriefDescription, /Do not activate for .*explanation-only/);
  assert.match(
    developBriefSkill,
    /brief-only request may invoke this skill directly without starting the\s+delivery controller/,
  );
  assert.match(
    developBriefSkill,
    /RESUME and clear bounded DIRECT delivery do not create/,
  );
  assert.match(developBriefSkill, /preserve the source unchanged/);
  assert.match(
    developBriefSkill,
    /explicitly requests an approved brief[\s\S]*counts as acceptance[\s\S]*produce the \*\*APPROVED-ONLY\*\* exit[\s\S]*do not ask for acceptance again/,
  );
  assert.match(
    developBriefSkill,
    /otherwise, for a request limited to source audit or producing a DRAFT or\s+working brief[\s\S]*do not ask for\s+acceptance/,
  );
  assert.match(
    developBriefSkill,
    /DRAFT ready for[\s\S]*later approval[\s\S]*pending optional approval is future work, not a blocker\s+or residual\s+question/i,
  );
  assert.match(
    developBriefSkill,
    /for end-to-end delivery[\s\S]*ask once for acceptance[\s\S]*end the turn/,
  );
  assert.match(
    briefContract,
    /explicit request from an authorized product owner for an approved brief[\s\S]*counts as acceptance[\s\S]*without asking for acceptance again/,
  );
  assert.match(
    briefContract,
    /Otherwise, a[\s\S]*gap-free request limited to source audit or producing a DRAFT or working brief[\s\S]*stop without an approval question/,
  );
  assert.match(
    briefContract,
    /Source\s+completeness alone never grants approval/,
  );
  assert.match(intakeReconciliation, /already implemented/);
  assert.match(intakeReconciliation, /material conflict/);
  assert.match(
    intakeReconciliation,
    /Do not edit it unless the user explicitly asks/,
  );
  assert.match(briefContract, /does not replace[\s\S]*`DELIVERY\.md`/);
  assert.match(briefContract, /Do not keep two independently editable binding copies/);

  for (const source of [
    runDeliverySkill,
    deliveryPolicy,
    packageCliSource,
    starterPrompt,
    projectAgents,
    handoffTemplate,
    readme,
    operatingManual,
  ]) {
    assert.match(
      source,
      /unmet\s+(?:done(?:\s+or\s+|\/)evidence|done\/evidence|condition)/i,
    );
    assert.match(
      source,
      /supporting\s+screenshot, log, or\s+attachment|screenshot, log, or\s+attachment that merely supports/i,
    );
    assert.match(
      source,
      /clear\s+bounded\s+work\s+remains DIRECT|bounded\s+work\s+remains direct/i,
    );
  }
});

test("always-loaded delivery policy stays compact and routes detail to phase references", () => {
  const words = (source) => source.trim().split(/\s+/).length;
  assert.ok(Buffer.byteLength(projectAgents) < 10_000);
  assert.ok(words(projectAgents) <= 1_600);
  assert.ok(Buffer.byteLength(runDeliverySkill) < 9_000);
  assert.ok(words(runDeliverySkill) <= 1_150);

  const routes = [
    ["develop-project-brief/references/brief-contract.md", briefContract],
    ["shape-project/references/shaping-contract.md", shapingContract],
    ["secure-launch/references/security-readiness.md", securityReadiness],
    ["coordinate-parallel-delivery/references/delegation-contract.md", delegationContract],
    ["verify-change/references/verification-matrix.md", verificationMatrix],
    ["close-review-loop/references/review-closure-policy.md", reviewClosurePolicy],
  ];
  for (const [path, reference] of routes) {
    assert.match(`${projectAgents}\n${runDeliverySkill}`, new RegExp(path.replace(/[.]/g, "\\.")));
    assert.ok(reference.length > 200, `${path} must retain its routed policy`);
  }
  assert.match(deliveryPolicy, /Human-owned unless pre-authorized/);
  assert.match(delegationContract, /coordinator token belongs only to the primary/);
  assert.match(verificationMatrix, /every required row passes/);
  assert.match(reviewClosurePolicy, /Treat every reviewer claim as a hypothesis/);
});

test("security routing and plain-language authority questions survive compaction", () => {
  assert.match(
    runDeliverySkill,
    /approved EXTERNAL\/DISCOVER brief[\s\S]{0,80}DIRECT T2\+ work/i,
  );
  assert.match(
    runDeliverySkill,
    /any\s+intake route[\s\S]{0,100}`\$secure-launch`[\s\S]{0,180}authentication[\s\S]{0,80}uploads[\s\S]{0,80}personal data[\s\S]{0,80}paid APIs[\s\S]{0,80}deployment/i,
  );
  assert.match(runDeliverySkill, /not applicable only for offline or\s+no-exposure work/i);
  assert.match(
    runDeliverySkill,
    /secure-launch\/references\/security-readiness\.md/,
  );
  for (const source of [projectAgents, runDeliverySkill]) {
    assert.match(
      source,
      /recommend one safe\s+default[\s\S]{0,80}at most\s+one genuinely safe alternative[\s\S]{0,80}practical\s+consequence[\s\S]{0,80}(?:ask\s+and end the turn|ends the turn)/i,
    );
  }
});

test("workflow loading stays route-aware and provider-neutral", () => {
  assert.match(claudeAdapter, /^@AGENTS\.md$/m);
  assert.match(
    claudeAdapter,
    /native\s+`Skill`\s+tool to invoke `run-autonomous-delivery` before any other tool/i,
  );
  assert.match(
    claudeAdapter,
    /controller owns implementation and verification[\s\S]*(?:it )?does\s+not require nested native activation[\s\S]*`build-vertical-slice`[\s\S]*`verify-change`/i,
  );
  assert.doesNotMatch(
    claudeAdapter,
    /workflow enters implementation or verification[\s\S]*invoke[\s\S]*`build-vertical-slice`/i,
  );
  assert.match(
    claudeAdapter,
    /Reading this file or `AGENTS\.md` does not count as skill[\s\S]*activation/i,
  );
  for (const source of [
    projectAgents,
    geminiAdapter,
    runDeliverySkill,
    starterPrompt,
    packageCliSource,
  ]) {
    assert.match(
      source,
      /explicitly limited[\s\S]{0,60}brief refinement/i,
    );
    assert.match(source, /run-autonomous-delivery/);
    assert.match(source, /develop-project-brief/);
  }
  for (const source of [projectAgents, runDeliverySkill, packageCliSource]) {
    assert.match(
      source,
      /explicitly\s+(?:phase-specific|limited\s+to)\s+implementation[\s\S]*build-vertical-slice/is,
    );
    assert.match(
      source,
      /explicitly\s+(?:phase-specific|limited\s+to)\s+verification[\s\S]*verify-change/is,
    );
    assert.match(
      source,
      /(?:(?:without\s+requiring)|(?:does\s+not\s+require))\s+(?:a\s+)?nested native[\s\S]*(?:build-vertical-slice|verify-change)|controller owns routine implementation and verification/is,
    );
    assert.match(
      source,
      /close-review-loop.*existing pull request.*(?:provider|human).*review thread/is,
    );
  }
  assert.match(
    runDeliverySkill,
    /focused checks[\s\S]*deterministic full gate[\s\S]*evidence matrix[\s\S]*binary readiness/i,
  );
  assert.match(
    manageProjectWorkSkill,
    /provider-write readiness[\s\S]*diagramming[\s\S]*bounded campaign/i,
  );
  assert.match(
    projectAgents,
    /harness supports native skills[\s\S]*same installed `SKILL\.md`/i,
  );
  assert.match(
    projectAgents,
    /can do neither safely[\s\S]*capability limitation[\s\S]*do not force/i,
  );
});

test("optional skills remain route-conditional and discovery stays serial", () => {
  for (const source of [projectAgents, geminiAdapter, handoffTemplate, runDeliverySkill]) {
    assert.match(
      source,
      /(?:selected route|after routing)[\s\S]{0,100}immediate next/i,
    );
    assert.match(source, /DISCOVER[\s\S]{0,100}serial/i);
  }
  assert.doesNotMatch(projectAgents, /use-project-knowledge` at recovery/i);
  assert.doesNotMatch(
    geminiAdapter,
    /Apply `\$use-project-knowledge` with the configured provider/i,
  );
  assert.doesNotMatch(
    handoffTemplate,
    /^\d+\. Apply `\$manage-project-work`\./m,
  );
});

test("discovery fast path is self-contained and avoids verbose follow-up work", () => {
  assert.match(
    projectAgents,
    /evidence activate --skill run-autonomous-delivery --skill-path \.agents\/skills\/run-autonomous-delivery\/SKILL\.md --mode file-read --harness "EXACT_HARNESS_ID" --model "EXACT_MODEL_ID" --run "RUN_ID" --event "activate-run-autonomous-delivery" --coordinator-token "TOKEN"/,
  );
  assert.match(
    projectAgents,
    /--skill develop-project-brief[\s\S]{0,120}\.agents\/skills\/develop-project-brief\/SKILL\.md/,
  );
  assert.match(
    projectAgents,
    /Choose one non-secret local `RUN_ID` of at most 200 characters[\s\S]{0,80}letters, digits, dot, underscore, and hyphen[\s\S]{0,160}Reuse it exactly[\s\S]{0,120}controller, brief[\s\S]{0,120}review receipt/,
  );
  assert.match(
    projectAgents,
    /agent-recorded correlation label, not a\s+harness-authenticated identity/,
  );
  for (const source of [projectAgents, runDeliverySkill, starterPrompt]) {
    assert.match(source, /Do not inspect CLI\s+source or help/i);
    assert.match(source, /do not checkpoint[\s\S]{0,120}activation(?:-status|\/readiness)[\s\S]{0,80}readiness|do not checkpoint[\s\S]{0,120}activation\/readiness status/i);
    assert.match(source, /do not[\s\S]{0,100}print a full diff/i);
    assert.match(source, /git diff --check[\s\S]{0,80}git status --short/i);
  }
  for (const source of [claudeAdapter, geminiAdapter]) {
    assert.match(source, /Do not run[\s\S]{0,80}initial one-question DISCOVER draft/i);
  }
  assert.match(
    claudeAdapter,
    /actual native `Skill` invocation[\s\S]{0,100}--mode native[\s\S]{0,200}file-read/i,
  );
  assert.match(
    geminiAdapter,
    /native`? only after an actual native invocation[\s\S]{0,100}file-read/i,
  );
  assert.doesNotMatch(
    projectAgents,
    /\.agents\/skills\/run-autonomous-delivery\/SKILL\.md --mode native/,
  );
});

test("independent review fails closed without a real separate result", () => {
  for (const source of [
    projectAgents,
    handoffTemplate,
    runDeliverySkill,
    verifyChangeSkill,
    coordinateDeliverySkill,
    delegationContract,
  ]) {
    assert.match(source, /separate reviewer|worker or thread ID/i);
    assert.match(
      source,
      /returns?\s+an inspectable\s+result|returned result|worker result/i,
    );
    assert.match(source, /self-review/i);
    assert.match(source, /blocked|incomplete/i);
  }
  for (const source of [
    projectAgents,
    handoffTemplate,
    runDeliverySkill,
    verifyChangeSkill,
    coordinateDeliverySkill,
    delegationContract,
  ]) {
    assert.doesNotMatch(source, /Ed25519|evaluation-authority|outer collector/i);
  }
});

test("working brief and lock guidance preserve honest promotion boundaries", () => {
  for (const marker of [
    "Status: DRAFT",
    "Intake mode: DISCOVER",
    "Material open conflicts: YES",
  ]) {
    assert.match(briefTemplate, new RegExp(marker));
  }
  for (const disposition of ["kept", "tightened", "rejected", "deferred"]) {
    assert.match(briefContract, new RegExp(`\\b${disposition}\\b`));
    assert.match(briefTemplate, new RegExp(`\\b${disposition}\\b`, "i"));
    assert.match(sourcesAndTradeoffs, new RegExp(`\\b${disposition}\\b`, "i"));
  }
  assert.match(
    trustGuide,
    /requires each selected artifact to contain\s+exactly one visible `Status: APPROVED` declaration/,
  );
  assert.match(trustGuide, /`Material open conflicts: NO` declaration/);
  assert.match(trustGuide, /unresolved\s+double-bracket placeholders/);
  assert.match(trustGuide, /does not understand whether the prose is complete/);
  assert.match(trustGuide, /does not\s+cryptographically authenticate/);
  assert.match(briefContract, /does not understand the truth of prose/);
  assert.match(briefContract, /does not[\s\S]*authenticate the approver/);
  for (const source of [
    projectAgents,
    runDeliverySkill,
    developBriefSkill,
    shapeProjectSkill,
  ]) {
    assert.match(source, /only `?DRAFT`? or `?APPROVED`?|only `DRAFT` and `APPROVED`/i);
    assert.match(
      source,
      /(?:lock state|["`]locked["`] is (?:CLI )?state)[\s\S]{0,100}(?:protected CLI|CLI state|protected `lock` command|artifact declaration)/is,
    );
  }
  for (const source of [
    projectAgents,
    runDeliverySkill,
    developBriefSkill,
  ]) {
    assert.match(source, /(?:failed|rejected) guard.*(?:never authorizes|does not authorize)/is);
  }
  for (const artifact of [
    "ARCHITECTURE.md",
    "BRIEF.md",
    "DECISIONS.md",
    "DELEGATION.md",
    "DELIVERY.md",
    "SECURITY.md",
    "VERIFICATION.md",
  ]) {
    const source = readFileSync(
      join(
        PACKAGE_ROOT,
        "assets/project-template/.agent-stack/artifacts",
        artifact,
      ),
      "utf8",
    );
    assert.match(source, /^Status: DRAFT$/m, artifact);
    assert.match(
      source,
      /^Material open conflicts: YES$/m,
      artifact,
    );
  }
});

test("simple onboarding uses one combined recommendation only without a requested advanced provider", () => {
  const combinedRecommendation =
    /I recommend the private repository-only setup\. It uses no outside memory,\s+tracking, or telemetry, and you retain merge control\. Use this\?/;
  for (const source of [
    setupProjectSkill,
    packageCliSource,
    readme,
    starterPrompt,
    handoffTemplate,
  ]) {
    const withoutMarkdownQuotes = source.replace(/^\s*>\s?/gm, "");
    assert.match(withoutMarkdownQuotes, combinedRecommendation);
    assert.match(
      source,
      /user\s+has not requested a relevant advanced provider/i,
    );
  }
  for (const source of [
    setupProjectSkill,
    packageCliSource,
    starterPrompt,
    readme,
    operatingManual,
  ]) {
    assert.match(
      source,
      /explicit(?:ly)? request(?:s| for)?(?: a)? relevant\s+advanced provider|user explicitly requests it|explicit request for a relevant\s+advanced provider takes precedence/i,
    );
  }
  assert.match(
    setupProjectSkill,
    /Do not then ask separate questions about GBrain, Linear, telemetry/,
  );
  assert.match(
    packageCliSource,
    /do not separately ask about GBrain, Linear, telemetry/,
  );
  for (const source of [
    projectAgents,
    setupProjectSkill,
    runDeliverySkill,
    packageCliSource,
  ]) {
    assert.match(
      source,
      /(?:question|asking).*ends the turn|end the turn after asking/is,
    );
    assert.match(
      source,
      /(?:prior explicit instruction|prior explicit).*use.*recommendation/is,
    );
  }
});

test("closed decisions remain canonical and are consumed downstream", () => {
  assert.match(decisionsTemplate, /## Closed Product Decisions/);
  assert.match(decisionsTemplate, /Do not reopen without product-owner instruction/);
  assert.match(decisionsTemplate, /## Changes to Previously Locked Intent/);
  for (const source of [
    shapeProjectSkill,
    buildSliceSkill,
    verifyChangeSkill,
  ]) {
    assert.match(source, /\.agent-stack\/artifacts\/DECISIONS\.md/);
  }
  for (const source of [shapeProjectSkill, buildSliceSkill]) {
    assert.match(source, /Do not reopen|do not reopen/);
  }
  assert.match(verifyChangeSkill, /preserved each governing closed decision/);
  assert.match(closeReviewSkill, /closed decisions/);
});

test("promoted briefs lock every canonical contract while direct work stays proportionate", () => {
  for (const artifact of [
    "DELIVERY.md",
    "ARCHITECTURE.md",
    "SECURITY.md",
    "VERIFICATION.md",
    "DECISIONS.md",
  ]) {
    for (const source of [shapeProjectSkill, runDeliverySkill]) {
      assert.match(
        source,
        new RegExp(
          `--artifact \\.agent-stack/artifacts/${artifact.replace(".", "\\.")}`,
        ),
      );
    }
  }
  assert.match(
    shapeProjectSkill,
    /lock\s+all five canonical promoted\s+contracts/i,
  );
  assert.match(shapeProjectSkill, /DIRECT T0\/T1/);
});

test("documented evaluator JSON commands suppress npm banners", () => {
  assert.match(behavioralEvals, /npm run --silent eval:scaffold >/);
  assert.match(
    behavioralEvals,
    /npm run --silent eval:fixture -- propose-baselines/,
  );
  assert.doesNotMatch(behavioralEvals, /npm run eval:scaffold >/);
});

test("later milestone roadmap remains detailed and explicitly deferred", () => {
  const normalized = operatingManual.replace(/\s+/g, " ");
  for (const marker of [
    "DEFINITION_OF_DONE.md",
    "simulated production behavior",
    "guided no-coder acceptance walkthrough",
    "post-merge launch-readiness path",
    "filesystem and containment",
    "hard token ceiling",
    "community-skill static risk scanning",
    "optional specialist packs",
  ]) {
    assert.match(normalized, new RegExp(marker));
  }
  assert.match(
    normalized,
    /Neither later milestone nor the deferred specialist scope is implemented/,
  );
});

test("packed installs cover flexible intake and live evidence stays harness-scoped", () => {
  for (const packagedPath of [
    "assets/project-template/.agent-stack/artifacts/BRIEF.md",
    "skills/develop-project-brief/SKILL.md",
    "skills/develop-project-brief/references/brief-contract.md",
    "skills/develop-project-brief/references/intake-and-reconciliation.md",
  ]) {
    assert.match(packedSmoke, new RegExp(packagedPath.replaceAll(".", "\\.")));
  }
  assert.match(packedSmoke, /rejected packed DRAFT lock wrote active state/);
  for (const source of [readme, behavioralEvals, releaseGuide, trustGuide]) {
    const normalized = source.replace(/\s+/g, " ");
    assert.match(
      normalized,
      /at least two distinct primary supported harnesses/,
    );
    assert.match(
      normalized,
      /No named harness is privileged by this (?:release )?rule/,
    );
  }
  assert.match(
    readme.replace(/\s+/g, " "),
    /every untested scenario and harness must be named/,
  );
  assert.match(trustGuide, /must not\s+be generalized to another harness/);
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
    assert.match(workflow, /issue_comment:/);
    assert.match(workflow, /pr_number:/);
    assert.match(workflow, /concurrency:/);
    assert.match(
      workflow,
      /group:\s*review-receipt-\$\{\{\s*github\.event\.pull_request\.number\s*\|\|\s*github\.event\.issue\.number\s*\|\|\s*inputs\.pr_number\s*\}\}/,
    );
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
  assert.match(repositoryReviewReceiptWorkflow, /--provider qodo/);
  assert.doesNotMatch(
    repositoryReviewReceiptWorkflow,
    /Require a current CodeRabbit review/,
  );
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
  assert.match(ciWorkflow, /concurrency:/);
  assert.match(ciWorkflow, /cancel-in-progress: true/);
  assert.match(ciWorkflow, /verify:\s+needs: compatibility/);
  assert.ok(
    [...ciWorkflow.matchAll(/run: npm run release:check/g)].length >= 2,
    "both compatibility and required verify must run the release gate",
  );
});

test("upstream watch scopes issue writes to its only writing job", () => {
  assert.match(upstreamWatchWorkflow, /^permissions: \{\}$/m);
  assert.match(
    upstreamWatchWorkflow,
    /concurrency:\s+group: upstream-watch\s+cancel-in-progress: false/,
  );
  const inspectStart = upstreamWatchWorkflow.indexOf("  inspect:\n");
  assert.notEqual(inspectStart, -1);
  const inspectRemainder = upstreamWatchWorkflow.slice(inspectStart + 1);
  const nextJobOffset = inspectRemainder.search(/^  [A-Za-z0-9_-]+:\n/m);
  const inspectJob = upstreamWatchWorkflow.slice(
    inspectStart,
    nextJobOffset === -1 ? undefined : inspectStart + 1 + nextJobOffset,
  );
  assert.match(inspectJob, /^\s+permissions:\s*$/m);
  assert.match(inspectJob, /^\s+contents:\s*read\s*$/m);
  assert.match(inspectJob, /^\s+issues:\s*write\s*$/m);
  assert.equal(
    [...upstreamWatchWorkflow.matchAll(/^\s+issues:\s*write\s*$/gm)].length,
    1,
  );
  assert.match(
    inspectJob,
    /^\s+ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}\s*$/m,
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
      "scripts/linear-write.mjs",
      "scripts/telemetry-readonly.mjs",
      "scripts/check-portable-bundle.mjs",
      "scripts/packed-smoke.mjs",
      "scripts/release-preflight.mjs",
      "scripts/review-receipt.mjs",
      "scripts/skill-eval.mjs",
      "scripts/skill-fixture.mjs",
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
    packageData.files.includes(".gitattributes"),
    true,
    "package files must include the LF policy hashed by behavioral evidence",
  );
  assert.equal(
    packageData.files.includes("SECURITY.md"),
    true,
    "package files must include the private vulnerability reporting policy",
  );
  assert.doesNotMatch(
    readFileSync(join(PACKAGE_ROOT, "scripts", "packed-smoke.mjs"), "utf8"),
    /["']exec["'][\s\S]{0,120}--package=/,
    "packed smoke must execute the already-installed tarball instead of relying on npm exec syntax",
  );
  assert.equal(packageData.files.includes("lib/"), true);
  assert.equal(packageData.files.includes("evals/"), true);
  assert.equal(
    packageData.scripts?.["eval:contracts"],
    "node scripts/skill-eval.mjs contracts",
  );
  assert.equal(
    packageData.scripts?.["eval:fixture"],
    "node scripts/skill-fixture.mjs",
  );
  assert.match(packageData.scripts?.["release:check"], /eval:contracts/);
  assert.match(packedSmoke, /packed\[0\]\.files/);
  assert.match(packedSmoke, /duplicate-copy paths/);
  assert.match(packedSmoke, /spawnNpm/);
  assert.match(packedSmoke, /packed canonical fixture catalog is invalid/);
  assert.match(packedSmoke, /packed behavioral contracts did not validate/);
  assert.match(packedSmoke, /packed canonical fixture did not materialize/);
  assert.match(packedSmoke, /packed canonical fixture inspection did not match/);
  assert.match(packedSmoke, /node --test tests\/smoke\.test\.mjs/);
  assert.equal(packageData.engines?.node, ">=22");
  assert.deepEqual(packageData.dependencies ?? {}, {});
  assert.equal(packageData.devDependencies?.["cross-spawn"], "7.0.6");
  assert.equal(packageData.devDependencies?.esbuild, "0.28.1");
  assert.equal(
    packageData.devDependencies?.["markdownlint-cli2"],
    "0.23.2",
  );
  assert.equal(
    packageLockData.packages?.[""]?.devDependencies?.["cross-spawn"],
    "7.0.6",
  );
  assert.equal(
    packageLockData.packages?.[""]?.devDependencies?.["markdownlint-cli2"],
    "0.23.2",
  );
  assert.match(packageData.scripts?.lint, /lint:markdown/);
  assert.match(packageData.scripts?.["test:coverage"], /test-coverage-lines=75/);
  assert.match(
    packageData.scripts?.["test:coverage"],
    /test-coverage-branches=70/,
  );
  assert.match(
    packageData.scripts?.["test:coverage"],
    /test-coverage-functions=85/,
  );
  assert.match(packageData.scripts?.["release:check"], /test:coverage/);
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
  assert.match(releaseGuide, /real\s+supported harness/);
  assert.equal(
    [...releaseGuide.matchAll(/behavior-surface hash changed/g)].length,
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
  for (const provider of ["PostHog", "Sentry", "New Relic"]) {
    assert.match(adaptersGuide, new RegExp(provider, "i"));
  }
  assert.doesNotMatch(telemetryReadonlyHelper, /\bmutation\b/i);
  assert.match(telemetryReadonlyHelper, /redirect:\s*"error"/);
  assert.match(telemetryReadonlyHelper, /MAX_RESPONSE_BYTES/);
  assert.match(telemetryReadonlyHelper, /raw_payload_retained:\s*false/);
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
  const linearReadonlyHash = portableTextSha256(linearReadonlyHelper);
  assert.match(packageCliSource, new RegExp(linearReadonlyHash));
  const linearWriteHash = portableTextSha256(linearWriteHelper);
  assert.match(packageCliSource, new RegExp(linearWriteHash));
  assert.match(linearReceiptedWrites, /disabled by default/i);
  assert.match(
    linearReceiptedWrites,
    /repository ledger[\s\S]{0,80}(?:portable work contract|authoritative|source of truth)/i,
  );
  assert.match(linearReceiptedWrites, /LINEAR_CREATE_API_KEY/);
  assert.match(linearReceiptedWrites, /LINEAR_COMMENT_API_KEY/);
  assert.doesNotMatch(
    linearWriteHelper,
    /\b(issueUpdate|issueDelete|issueArchive|projectCreate|cycleCreate|labelCreate)\b/,
  );
  assert.match(linearWriteHelper, /\bissueCreate\b/);
  assert.match(linearWriteHelper, /\bcommentCreate\b/);
  assert.equal(workItemSchema.additionalProperties, false);
  assert.equal(evidenceGraphSchema.additionalProperties, false);
  assert.equal(providerReceiptSchema.additionalProperties, false);
  assert.equal(campaignStateSchema.additionalProperties, false);
  assert.deepEqual(campaignStateSchema.properties.status.enum, [
    "active",
    "complete",
    "decision-needed",
    "stopped",
  ]);
  assert.equal(campaignStateSchema.properties.max_iterations.maximum, 25);
  assert.equal(campaignStateSchema.properties.max_iterations.minimum, 1);
  assert.match(
    campaignStateSchema.properties.iterations_completed.description,
    /must not exceed max_iterations/i,
  );
  assert.ok(
    campaignStateSchema.allOf.some(
      (rule) =>
        rule.if?.properties?.status?.const === "active" &&
        rule.else?.properties?.active_work_item?.type === "null",
    ),
  );
  assert.deepEqual(
    providerReceiptSchema.properties.result.enum,
    ["succeeded", "not-needed", "failed", "decision-needed"],
  );
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
  assert.match(publishWorkflow, /^permissions: \{\}$/m);
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
  assert.match(releaseSyncWorkflow, /^permissions: \{\}$/m);
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
