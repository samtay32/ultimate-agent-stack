# Plain-Language Operating Manual

## What You Do

Describe the result you want. The agent configures the project, researches,
asks only consequential product questions, builds, tests, documents, opens or
updates the pull request when authorized, responds to review, and returns either
a completed result or one action that truly requires your authority.

You do not need to choose frameworks, write code, design test commands, organize
tickets, or relay review comments.

## First-Time Setup

Open a dedicated project folder in Codex or another capable coding agent and
say:

```text
Set up Ultimate Agent Stack in this project. My idea is: [describe the result].
Recommend safe defaults, ask one important question at a time, and handle all
routine technical work.
```

The agent runs:

```bash
npx -y ultimate-agent-stack@latest init
```

For Claude Code support it adds `--claude`. The agent then:

1. reads existing project instructions and preserves them;
2. reconciles any proposals instead of overwriting files;
3. detects the project's real checks;
4. inspects and approves argument arrays and delegated package-script
   definitions;
5. applies `$secure-launch` to classify exposure and add proportionate gates;
6. runs `doctor` and the initial verification baseline;
7. starts `$run-autonomous-delivery` and asks the first meaningful question.

If you prefer to run setup yourself, that one `npx` command is enough. Open a
fresh agent session afterward if the agent harness discovers new skills only at
session start.

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

## When the Agent Asks a Question

A valid question should:

- be impossible to answer safely from the repository or authoritative sources;
- materially affect product intent, cost, credentials, risk, deletion, or
  release;
- recommend one answer and explain the consequence;
- ask one decision, not present a technical questionnaire.

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
configured.

### The safety check says commands need approval

This is expected after setup or when package scripts change. The agent inspects
the definitions and runs:

```bash
node .agent-stack/bin/agent-stack.mjs approve-checks \
  --reason "Inspected project-native quality command definitions"
```

You should not be asked to interpret those commands.

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
npx -y ultimate-agent-stack@latest doctor
node .agent-stack/bin/agent-stack.mjs verify
```

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
