# Plain-Language Operating Manual

## What You Do

Describe the result you want. The agent configures the project, researches,
asks only consequential product questions, builds, tests, documents, opens or
updates the pull request when authorized, responds to review, and returns either
a completed result or one action that truly requires your authority.

When a decision is genuinely yours, the agent explains it in plain language,
recommends one answer, offers at most one genuinely safe alternative, and
explains the practical consequence. You may answer `use the recommendation`.

You do not need to choose frameworks, write code, design test commands, organize
tickets, or relay review comments.

Ultimate Agent Stack enforces the controls owned by its CLI, including
containment, protected files, approval fingerprints, and fail-closed checks. It
cannot guarantee that every coding agent will follow conversational
instructions, and it does not replace the agent harness's sandbox, repository
permissions, backups, human judgment, or production access controls.

The package is provider-neutral, not magically model-independent. Every
adapter points to the same repository contract; no adapter receives weaker
authority or evidence rules. Current live evidence identifies the exact
harness and model tested. If a model cannot follow the shared contract safely,
maintainers report the limitation instead of adding a vendor-specific bypass.

## First-Time Setup

Open a dedicated project folder in Codex or another capable coding agent and
say:

```text
Set up Ultimate Agent Stack in this project. My idea is: [describe the result].
If this is a simple project, recommend the simple setup. For each consequential
decision, recommend one safe choice, offer at most one genuinely safe
alternative, and handle all routine technical work.
```

The agent runs:

```bash
npx -y ultimate-agent-stack@latest init
```

The default install includes the portable skill path and each shipped native
harness adapter, including Claude Code, so a brand-new folder does not need
detection hints. Existing harness markers such as `.claude/` or `CLAUDE.md`
are still reported for the agent. The older `--claude` spelling remains
accepted for compatibility. The agent then:

1. reads existing project instructions and preserves them;
2. reconciles any proposals instead of overwriting files;
3. detects the project's real checks;
4. detects review, knowledge, work, and telemetry capabilities;
5. offers one combined private repository-only recommendation when it fits and
   the user has not requested a relevant advanced provider, then reveals an
   advanced provider question only when repository evidence, the user, or a real
   requirement makes it relevant;
6. inspects and approves argument arrays and delegated package-script
   definitions;
7. applies `$secure-launch` to classify exposure and add proportionate gates;
8. runs `doctor` and the initial verification baseline;
9. starts `$run-autonomous-delivery` and asks the first meaningful question.

The installed repository work ledger and evidence graph need no outside
account. The agent validates both before material work, uses only bounded ready
items, and links completion to acceptance evidence. An external tracker remains
optional and cannot change merge, deployment, or release authority.

If you prefer to run setup yourself, that one `npx` command is enough. Open a
fresh agent session afterward if the agent harness discovers new skills only at
session start.

## Simple Project Path

For a local prototype or straightforward project that does not require
production release protection, external data, external memory, or delegated
merge authority, and where the user has not requested a relevant advanced
provider, the agent should ask exactly one combined question:

> I recommend the private repository-only setup. It uses no outside memory,
> tracking, or telemetry, and you retain merge control. Use this?

After you approve the recommendation, it records the choice with:

```bash
node .agent-stack/bin/agent-stack.mjs configure \
  --preset simple \
  --reason "Approved the recommended simple project configuration"
```

The recommendation and its acceptance are separate turns unless your request
already says to use the recommendation. A question asking "Use this?" ends the
turn. A prior explicit instruction to use the recommended safe setup is the
single approval and must not be asked again.

You should not have to construct or interpret that command. The preset selects:

- the standard project profile;
- built-in repository review;
- repository-owned project knowledge;
- repository-owned work tracking;
- no telemetry provider;
- local-only data handling;
- agent-owned routine execution;
- human approval for merging.

The complete safety installation remains in place. Small work stays serial
through the adaptive coordinator; safely isolated subagents remain available
when they would materially help. Projects needing production release protection
or an external provider use guided advanced configuration instead. An explicit
request for a relevant advanced provider takes precedence: ask only that one
advanced choice rather than offering the simple preset first. Approval of the
simple path ends provider questioning; it is recorded conversational
authority, not cryptographic authentication of the approver.

## Account-Only Connections

The agent may still need you to:

- sign in to GitHub or npm;
- authorize a GitHub connector or CodeRabbit;
- provide a secret through the project's approved secret manager;
- approve a purchase, legal or license choice, destructive production action,
  deployment, release, or merge.

These are intentionally the human 1%. Never paste secrets into chat, Markdown,
a pull request, or an evidence file.

## Starting Any Project or Change

Plain language is enough:

```text
Use $run-autonomous-delivery. Build a private customer portal where customers
can sign in, see current orders, download invoices, and contact support. It must
work on phones and preserve the existing accounting database.
```

The agent should research and recommend the implementation. Add constraints
only when they are real. [../STARTER_PROMPT.md](../STARTER_PROMPT.md) provides a
longer copy-and-paste contract for harnesses that need it.

The controller accepts four front doors:

1. **RESUME:** continue a valid non-complete checkpoint or active lock with an
   unmet done/evidence condition from the first unmet condition without
   reopening closed decisions.
2. **EXTERNAL:** read substantial supplied material that defines product intent
   or an existing plan completely; preserve it unchanged; audit its claims; and
   reconcile it against the repository.
3. **DISCOVER:** turn vague, contradictory, exploratory, or greenfield
   product/system intent that needs development into an early unlocked
   `BRIEF.md`, asking one consequential question at a time and withholding
   product implementation.
4. **DIRECT:** take a clear bounded testable request through the existing
   micro-brief path without forcing extended discovery.

A completed checkpoint and fully satisfied lock do not hijack a new request. A
supporting screenshot, log, or attachment does not make an otherwise clear
bounded request EXTERNAL, and bounded work remains DIRECT in a new repository.

EXTERNAL and DISCOVER may stop after an approved brief when that is all the
user requested. Otherwise `shape-project` promotes the approved brief into the
canonical delivery, architecture, security, verification, and decision
contracts. The brief remains provenance and audit context rather than a second
binding state machine.

## Continuing in a New Conversation

Ask the current Project Steward to checkpoint and hand off before leaving. Then
open a new conversation in the same project and say:

```text
Continue this project with Ultimate Agent Stack. Load the checkpoint, inspect
the current repository, and resume from the first unfinished step.
```

`start` validates the checkpoint, tests configured memory, and acquires the
checkout lease. A second conversation cannot claim the same checkout while the
first Project Steward is active. If the old conversation ended unexpectedly,
the new agent must ask you to confirm it stopped before using the explicit
takeover command.

The coordinator lease is an Ultimate Agent Stack guardrail, not an
operating-system lock. Unrelated tools can ignore it.

## Review, Knowledge, and Telemetry Providers

The agent runs:

```bash
node .agent-stack/bin/agent-stack.mjs capabilities
```

The simple path already selects the portable baseline: built-in review,
repository knowledge and work, no telemetry, local-only data, and human merge
authority. Advanced setup considers a provider only when the repository already
uses it and it is relevant, the user explicitly requests it, or a real
requirement cannot be met locally. Production profiles require an allowed
current independent reviewer. GBrain remains optional and requires approval for
external data. When it is relevant, the agent may ask:

> Should this project remember progress only in its repository files, or also
> use a private local searchable memory for easier continuation across
> conversations?

Repository memory is the recommendation for a short or simple project.
Project-scoped local GBrain is the recommendation for a long-running build that
will likely cross conversations.

The agent records the approved choices with `configure`; you should not have to
construct the command. Provider, external-data, execution, or merge changes
invalidate the prior configuration approval.

If GBrain is selected, Ultimate Agent Stack uses only scoped retrieval and
verified capture. It does not install GBrain's complete skills or autonomous
runtime. If GBrain is unavailable, the agent continues with repository
artifacts. Memory never overrides current code, tests, locked decisions, or
security policy.

The agent obtains the guarded local plan with `memory-setup`. The plan uses
checkout-local PGLite, starts without embeddings or external model keys, and
merges a project-scoped MCP connection into the detected harness. A missing
global GBrain CLI still requires explicit installation approval. `doctor`
verifies the active database path, GBrain health, and brain identity; `start`
also checks retrieval of the mirrored repository checkpoint.

For telemetry, the agent asks whether the deployed project already uses a
reviewed provider for a concrete product, error, or service question.
Repository-only evidence is recommended for an early or undeployed project.
PostHog, Sentry, and New Relic may be selected only with an approved numeric
project/account or organization/project scope. The agent records repeated
`--telemetry provider@region:scope` choices, runs `telemetry-setup`, waits for
the human to place the scoped credential in the named process environment, and
runs `telemetry-health`.

The protected helper makes only three fixed identity/availability checks:
PostHog basic saved-insight metadata, Sentry project identity, and New Relic
account identity. It rejects custom endpoints and redirects, bounds responses,
retains no raw payload, and exposes no arbitrary query or mutation. A missing
credential, scope mismatch, or provider failure produces a warning and
repository fallback. Ultimate Agent Stack sends no usage telemetry of its own
and never installs instrumentation implicitly.

For work tracking, the agent asks:

> Should this project keep its task list only in the repository, or also read
> approved work from Linear while keeping a portable repository copy?

Repository tracking is recommended for solo, short, or early work. If the team
already uses Linear, the reviewed adapter can be selected with approved team
keys and an API key created with only Linear's Read permission. The key stays in
`LINEAR_API_KEY`, outside the repository. The agent runs `linear-setup`, waits
for the credential action, then runs `linear-health` and `doctor`.

The helper exposes a bounded, paginated GraphQL query shape and no mutations.
It can verify authentication and configured team visibility, but Linear's
response does not attest the permission chosen when the key was created. If the
provider fails, the Project Steward continues from
`.agent-stack/work-items.json` and records synchronization as pending.

Read-only is the recommended default. If the user asks for Linear writes, ask a
second question:

> Should Linear stay read-only, or may the Project Steward create receipted
> issues and evidence comments after you approve each operation?

Enable no writes without explicit approval. `issue_create` requires a separate
team-restricted Create issues key. `evidence_comment` additionally requires a
separate Create comments key. Every command requires the active coordinator
token, `--confirm-external-write`, and a recorded authority source. Run
`receipts validate` and `doctor` after writes.

For a bounded campaign, use `campaign start` with 1–25 iterations and then
`campaign next` for one repository item at a time. Campaign mode never calls a
provider. Stop when the bound is reached, evidence is incomplete, work is
blocked, or a consequential decision is required.

Use `evidence report` when the user needs a compact state summary. Use
`--format mermaid --output .agent-stack/reports/evidence.mmd` for a diagram.
Keep `--max-nodes` proportionate to the review context. The renderer also caps
the total edges at four times the selected-node count. The report counts nodes
excluded by the node bound and selected-node edges excluded by that aggregate
cap. Those omissions are not lost evidence; they remain in the validated graph.
After a skill actually activates or is hash-bound read, record it with
`evidence activate --skill NAME --skill-path PATH --mode native|file-read
--harness NAME --model NAME --run ID --event ID --coordinator-token TOKEN`
after the current session owns the checkout. Use the exact installed `SKILL.md`
path and one stable ID for the activation event. The entry is agent-recorded
trace evidence and must not be presented as independent proof of a harness tool
call. Do not persist it when the user authorized read-only work only.

## What Happens With Subagents

You continue speaking only with the primary coding agent—the Project Steward.
It alone owns the checkout lease, coordinator token, checkpoint, integration,
and final answer. It decides whether parallel work is useful after the request
is understood:

- a small fix or tightly connected change stays with the primary agent;
- independent research, review, tests, or documentation may run in parallel;
- independent code changes run in parallel only in verified isolated
  workspaces;
- if a worker fails or the coding tool has no safe subagent feature, the primary
  agent continues serially.

The primary agent writes the assignments, limits their authority, watches
progress, rejects bad output, combines accepted work, runs the final checks, and
returns one result. You should never be asked to open extra chats, copy messages
between workers, resolve branches, or decide how many agents to use.
Subagents never receive the coordinator token and never become another Project
Steward.

If an agent asks you to manage its workers, reply:

```text
Apply $coordinate-parallel-delivery. You own worker assignment, monitoring,
integration, verification, and cleanup. Keep the work serial if you cannot do
that safely.
```

## When the Agent Asks a Question

A valid question should:

- be impossible to answer safely from the repository or authoritative sources;
- materially affect product intent, cost, credentials, risk, deletion, or
  release;
- recommend one answer and explain the consequence;
- provide at most one genuinely safe alternative when useful;
- ask one decision, not present a technical questionnaire;
- allow `use the recommendation`.

If only one safe choice exists, the agent should say so. It must not present a
dangerous option merely to make a two-item list.

Answer in plain language. If it asks you to choose an ordinary technical detail,
reply:

```text
Use repository evidence and the simplest production-grade reversible choice.
Protect the guardrails, record the assumption, and continue.
```

If you request a mechanism that would weaken security, checks, data safety, or
architecture, the agent should not blindly comply. It should explain the risk
plainly, recommend the closest safe outcome, and continue all safe work.

## What Progress Should Look Like

For meaningful work, expect:

1. a short understanding and assumptions note;
2. a delivery contract proportionate to the change;
3. implementation in demonstrable slices;
4. test and verification evidence;
5. a draft pull request when authorized;
6. bounded repair batches as CI or review finds issues;
7. a final report leading with the outcome.

Activity, token usage, or many commits are not proof. Green evidence and a
shrinking actionable review set are.

## How to Read the Final Report

Look for:

- outcome;
- pull-request or merge result;
- exact checks and evidence file;
- zero unresolved actionable review findings;
- residual risk;
- ideally no action for you, otherwise one account or authority action.

If the report says “done” without evidence, say:

```text
Apply $verify-change and return final-revision evidence and unresolved review
status. Treat unavailable or skipped required checks as failure.
```

## Common Situations

### No project checks exist

For a new project, the agent creates standard checks after choosing the stack.
For an existing project, it proposes the smallest production-grade test,
lint/type, and build baseline. A project with no meaningful check is not fully
configured. In a newly initialized empty folder, `doctor --human` calls this
**Almost ready** and asks the coding agent to create the first checks and finish
setup. The JSON report and exit status remain fail-closed until that baseline is
configured and approved.

### The project already has code

Run setup in the existing project folder. The installer preserves existing
instructions and customized files, creates reconciliation proposals when
package guidance differs, and detects the real project checks. It does not
restart the project or impose a replacement architecture.

### The safety check says commands need approval

This is expected after setup or when package scripts change. The agent inspects
the definitions and runs:

```bash
node .agent-stack/bin/agent-stack.mjs approve-checks \
  --reason "Inspected project-native quality command definitions"
```

You should not be asked to interpret those commands.

### Checks work in the terminal but fail under `verify`

Verification deliberately removes inherited credentials and gives checks an
isolated `HOME`. Common non-secret toolchain paths such as `JAVA_HOME` and
`DOTNET_ROOT`, plus existing cache-only directories for npm, pip, uv, and Go,
remain available. User-home Maven, Gradle, and Cargo data directories
(`~/.m2`, `GRADLE_USER_HOME`, and `CARGO_HOME`) are not inherited because they
can contain credentials or executable configuration. Maven installation paths
such as `M2_HOME` and `MAVEN_HOME` remain available when already configured.

If a project needs another non-secret variable, the agent may add its name to
`quality.environment.allow`, inspect the resulting check definitions, and run
`approve-checks` again. Sensitive-looking names—including tokens, passwords,
keys, database URLs, DSNs, and connection strings—are rejected. Approved
inherited values are hashed into check approval and redacted from captured
evidence, so changing a value requires review again. Variables that can inject
runtime code, such as `NODE_OPTIONS`, `PYTHONPATH`, or `JAVA_TOOL_OPTIONS`, are
also rejected. Do not use this escape hatch for secrets; configure integration
tests through an approved sandbox or test-secret mechanism instead.

`detect` reports ecosystem-specific environment warnings. A failure whose
reason is `output-exceeded-capture-limit` means the check produced more output
than the evidence recorder can safely retain; it does not mean the underlying
test assertion failed.

### Setup says onboarding is pending

Run `doctor --human` if you want one plain-language next action. The agent should
inspect `capabilities`, recommend the simple preset when its constraints fit or
the safest advanced profile/provider combination otherwise, ask only the
remaining consequential choices, and run `configure`. This is expected for a
new install and after migrating an older configuration.

### An optional provider is unavailable

Review, knowledge, and telemetry fail differently. Optional knowledge falls
back to repository state. Optional telemetry falls back to repository evidence.
Both produce a warning. A review provider required by the selected profile
blocks release until a current qualifying review exists; the agent may not
silently downgrade the profile, broaden data scope, or switch providers.

### An update reports pending reconciliation

Your customized file was preserved. The agent inspects the proposal under
`.agent-stack/update-proposals/<version>/`, merges compatible changes, records
the result with `adopt-managed`, and re-runs `doctor` and `verify`.

### Review keeps finding issues

The bounded loop continues while findings are valid and shrinking. After five
non-improving cycles, the agent preserves the work and reports the smallest
actual blocker instead of looping forever.

### A test was already failing

The agent must reproduce it on the base revision before calling it pre-existing.
It records evidence and decides whether safe delivery still requires fixing it.

### Locked intent must change

The agent records why, unlocks with an audit reason, updates the contract,
relocks, and continues. It never drifts silently.

### Work stopped mid-session

Start a fresh session and paste:

```text
Resume $run-autonomous-delivery from repository state. Read AGENTS.md,
.agent-stack configuration, locked artifacts, git/PR state, and latest
evidence. Continue from the first unmet done condition.
```

## Updating

Tell the agent “Update Ultimate Agent Stack safely,” or run:

```bash
npx -y ultimate-agent-stack@latest upgrade
```

Updates never replace an existing differing managed file or delete removed
package files. The agent resolves proposals, then runs:

```bash
node .agent-stack/bin/agent-stack.mjs doctor --human
node .agent-stack/bin/agent-stack.mjs verify
```

This front-half update adds the optional working-brief template and one skill.
Existing configurations and active locks remain readable. New lock attempts
require exactly one visible `Status: APPROVED` and
`Material open conflicts: NO` declaration in every selected artifact. Missing,
duplicate, unknown, DRAFT, and open-conflict declarations fail closed. Changed
managed guidance arrives as reconciliation proposals; a pre-existing
project-owned `BRIEF.md` is preserved rather than overwritten.

## Dogfooding Before the Next Milestone

Before expanding the workflow, exercise this milestone through:

1. a vague greenfield no-coder idea;
2. an elaborate outside brief;
3. an elaborate brief reconciled with an existing repository;
4. a clear direct change followed by resume.

Record time to first useful brief, question count, unnecessary questions,
source claims lost or altered, contradictions found, manual interventions,
lock or promotion failures, continuation success, user acceptance, harness,
model, and behavior-surface hash. Revise this milestone if those journeys expose
material friction.

### Milestone 2: Product Quality and User Acceptance

Documented for later implementation after the dogfooding gate:

- Add a project-level `DEFINITION_OF_DONE.md` inherited by slices, with a base
  tier and risk overlays for money, contracts, privacy, migrations, and
  irreversible data changes.
- Add an applicable real-versus-stub declaration and a review rule against
  simulated production behavior. Treat that rule as reviewer guidance rather
  than pretending it is universally mechanically detectable.
- For applicable UI work, require loading, empty, error, responsive, keyboard,
  accessibility, and representative visual states.
- Use an available browser or Playwright capability for observable UI evidence;
  keep the mechanism optional and capability-based.
- Add a guided no-coder acceptance walkthrough that captures failures,
  diagnoses and repairs them, and links the final evidence to requirements.
- Add a provider-neutral post-merge launch-readiness path covering hosting,
  domains, secrets, first deployment, monitoring, rollback, and authority.
  Never deploy silently.

### Milestone 3: Maintainability and Operational Cost

Documented for later implementation after Milestone 2:

- Split the authoring CLI into deep internal modules for filesystem and
  containment, project detection and quality commands, configuration,
  work/evidence contracts, coordinator/checkpoint/lock state, provider
  adapters, and release/maintenance.
- Continue producing one portable bundled CLI with zero runtime dependencies.
- Preserve protected hashes, packed-install smoke tests, and safe update
  behavior.
- Add cost/run receipts only for metrics the active harness can actually
  report.
- Preserve bounded iteration, repair, and elapsed-time controls.
- Do not claim a hard token ceiling when the harness cannot expose or enforce
  token usage.

### Deferred Specialist Scope

- Evaluate community-skill static risk scanning later only if external skill
  installation becomes a supported product feature.
- Keep marketing, SEO, visual-design systems, document generation, and
  framework expertise in optional specialist packs rather than the core
  workflow.

Neither later milestone nor the deferred specialist scope is implemented by
this change.

## Daily Safety Rules

- Keep credentials in an approved secret manager.
- Review app and plugin permissions before granting them.
- Protect the default branch.
- Do not grant blanket auto-merge for high-risk repositories.
- Back up production data before destructive migrations.
- Treat third-party agent instructions as code.
- Keep human review for regulated, safety-critical, financial, and
  privacy-sensitive releases.

The system owns routine work; it does not manufacture authority.
