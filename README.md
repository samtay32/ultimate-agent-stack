# Ultimate Agent Stack

[![npm version](https://img.shields.io/npm/v/ultimate-agent-stack.svg)](https://www.npmjs.com/package/ultimate-agent-stack)
[![CI](https://github.com/samtay32/ultimate-agent-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/samtay32/ultimate-agent-stack/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![runtime dependencies: 0](https://img.shields.io/badge/runtime%20dependencies-0-2ea44f.svg)](package.json)

A guarded npm-installed operating system for software agents. It turns a
plain-language idea into a shaped, implemented, verified, review-ready change
while leaving the human only genuine product and authority decisions.

It cannot make every project perfect. It makes completion testable through
locked intent, project-native checks, independent review, evidence, and explicit
residual risk.

## Choose Your Path

| If you are... | Start here | What you need to know |
|---|---|---|
| A non-coder with an idea | Give the conversational prompt below to your coding agent | Describe the result you want. The agent explains important choices in plain language and handles routine setup, implementation, testing, and documentation. |
| A coder adding it to a project | Run the three commands below | The stack detects and wraps your existing tools; it does not replace your framework, tests, CI, or architecture. |
| A maintainer evaluating trust | Read [Guardrails Behind the Scenes](#guardrails-behind-the-scenes) and [the architecture](docs/ARCHITECTURE.md) | The CLI has no runtime dependencies, writes are containment-checked, verification fails closed, and upstream code never updates automatically. |

## The Three Commands

Open a terminal in a dedicated project folder and use:

```bash
# Install into this project
npx -y ultimate-agent-stack@latest init

# Check that the project is safely configured
npx -y ultimate-agent-stack@latest doctor

# Safely update later
npx -y ultimate-agent-stack@latest upgrade
```

You can also tell a capable coding agent:

```text
Set up Ultimate Agent Stack in this project. My idea is: [describe the outcome].
Use the installed conversational workflow, recommend safe defaults, ask me one
important question at a time, and handle all routine technical work.
```

The agent runs the commands, reviews detected project checks, fixes the
baseline, invokes `$run-autonomous-delivery`, and starts the product
conversation. [STARTER_PROMPT.md](STARTER_PROMPT.md) contains the full operating
contract when a harness needs an explicit prompt.

## How It Works

![Flow from a human idea through shaping, implementation, verification, review,
evidence, and human authority](https://raw.githubusercontent.com/samtay32/ultimate-agent-stack/main/docs/assets/delivery-flow.svg)

The human stays at the two points where human judgment matters: defining the
outcome and exercising real-world authority. Between them, the agent follows a
durable, inspectable workflow rather than improvising an unbounded autonomous
loop.

## Built From Research, Finished With Original Engineering

Ultimate Agent Stack is not a fork, wrapper bundle, or repackaging of the
projects below. It is an original synthesis: useful patterns were compared,
adapted into one portable workflow, and then surrounded with a new
dependency-free CLI, safety policy, approval model, state format, tests,
maintenance process, and release system. No third-party source file is included.

![Research patterns flowing into the original Ultimate Agent Stack synthesis and
then into a guarded project workflow](https://raw.githubusercontent.com/samtay32/ultimate-agent-stack/main/docs/assets/synthesis-map.svg)

### Primary design lineage

| Repository | What it taught us | How it changed this stack |
|---|---|---|
| [kunchenguid/firstmate](https://github.com/kunchenguid/firstmate) | One liaison, recoverable state, isolated work, and explicit operating modes | One controlling workflow with resumable repository state; swarms and a permanent supervisor remain optional |
| [kunchenguid/lavish-axi](https://github.com/kunchenguid/lavish-axi) | High-fidelity visual planning can resolve decisions that prose cannot | Visual artifacts are used when fidelity demands them, not as ceremony for every task |
| [kunchenguid/no-mistakes](https://github.com/kunchenguid/no-mistakes) | Locked intent, fail-closed gates, independent review, and evidence over confidence | Intent locks, deterministic verification, two-axis review, and explicit finding disposition |
| [kunchenguid/axi](https://github.com/kunchenguid/axi) | Agent-facing tools need structured errors, bounded output, and idempotent operations | Predictable CLI results, bounded/redacted evidence, loud failures, and actionable next steps |
| [github/spec-kit](https://github.com/github/spec-kit) | Traceable specifications and consistency checks prevent implementation drift | Stable requirements, non-goals, readiness checks, and proportionate shaping rather than universal specification ceremony |
| [mattpocock/skills](https://github.com/mattpocock/skills) | Research-first questioning, prototypes, vertical slices, TDD, and independent review | One high-impact question at a time, a fidelity ladder, tracer slices, and separate standards/intent review |
| [bmad-code-org/bmad-method](https://github.com/bmad-code-org/bmad-method) | Workflow depth should scale with project risk and size | Micro, standard, and extended shaping paths with bounded repair loops and binding architecture decisions |

### What is original in this package

- one scale-adaptive conversation that works for non-coders and experienced
  engineers without pretending they need the same amount of ceremony;
- a containment-checked installer and local project CLI with tamper-resistant
  approvals, canonical policy verification, intent locks, and secret-isolated
  evidence;
- eight composable skills that connect shaping, vertical delivery, conditional
  security, verification, review closure, and maintenance into one flow;
- safe upgrades that propose reconciliations instead of overwriting project
  decisions;
- project-native verification discovery across common ecosystems, with
  definition fingerprints that prevent an approved script name from hiding
  changed behavior;
- a read-only upstream watcher and human-reviewed adoption policy;
- an npm/GitHub release chain designed around protected branches, OIDC,
  provenance, staged publishing, 2FA approval, and no long-lived publish token.

<!-- markdownlint-disable MD033 -->
<details>
<summary>Supporting repository audit (all additional repositories)</summary>

These repositories refined individual decisions without becoming runtime
dependencies:

| Repository | Focus carried into the evaluation |
|---|---|
| [kunchenguid/treehouse](https://github.com/kunchenguid/treehouse) | Leased, recoverable worktree isolation |
| [kunchenguid/gnhf](https://github.com/kunchenguid/gnhf) | Bounded autonomous iterations and rollback |
| [kunchenguid/gh-axi](https://github.com/kunchenguid/gh-axi) | Compact, structured GitHub operations |
| [kunchenguid/chrome-devtools-axi](https://github.com/kunchenguid/chrome-devtools-axi) | Observable browser evidence |
| [kunchenguid/agent-browser-axi](https://github.com/kunchenguid/agent-browser-axi) | Accessibility-oriented browser snapshots |
| [kunchenguid/quota-axi](https://github.com/kunchenguid/quota-axi) | Cost visibility and explicit time bounds |
| [kunchenguid/tasks-axi](https://github.com/kunchenguid/tasks-axi) | Idempotent durable task state |
| [kunchenguid/rough-cut-axi](https://github.com/kunchenguid/rough-cut-axi) | Plain-file truth and structured decisions |
| [kunchenguid/mcp-compressor](https://github.com/kunchenguid/mcp-compressor) | Task-relevant tools and context cost |
| [kunchenguid/acpx](https://github.com/kunchenguid/acpx) | Structured delegation and persistent sessions |
| [kunchenguid/superpowers-bench](https://github.com/kunchenguid/superpowers-bench) | Measured skill discovery |
| [kunchenguid/ProgramBench](https://github.com/kunchenguid/ProgramBench) | Executable behavioral evaluation |
| [kunchenguid/harness-exam](https://github.com/kunchenguid/harness-exam) | Clean-repository and fail/pass harness fixtures |

</details>
<!-- markdownlint-enable MD033 -->

The exact revisions, video research, platform documentation, adopted ideas,
rejected complexity, and Firstmate/Kimi decision are recorded in
[Sources, Synthesis, and Tradeoffs](docs/SOURCES_AND_TRADEOFFS.md). That file is
the evidence ledger; this README is the useful map.

## What the Agent Owns

- project and authoritative-source research;
- setup, requirements shaping, and safe reversible assumptions;
- architecture, implementation, tests, docs, and migrations;
- deterministic local verification;
- pull-request preparation and bounded review repair;
- decisions, evidence, and resumable repository state.

The human supplies the desired outcome and retains authority over credentials,
spending, legal or licensing acceptance, destructive production actions,
material unresolved risk, and external merge, deployment, release, or
publication unless project policy explicitly grants it.

## Guardrails Behind the Scenes

- The stack's own setup and state writes remain inside the selected project,
  reject symlink escapes, and reject broad targets such as the filesystem root
  or home folder.
- Install and update never overwrite an existing differing managed file.
  Changes are proposed under `.agent-stack/update-proposals/<version>/` for the
  agent to reconcile.
- Removed package files are recorded, not deleted automatically.
- Protected safety policy and the local CLI are checked against canonical bytes
  from the executing reviewed package, not a project-editable manifest.
- Direct shell interpreters and known destructive commands are rejected.
  Delegated package scripts are fingerprinted with their exact script
  definitions and require reapproval when those definitions change.
- Quality checks receive a scrubbed environment without inherited credentials.
  They remain executable project code and should run inside the agent
  harness's OS or container sandbox when the project is not already trusted.
- Missing, skipped, timed-out, or failed required checks fail closed.
- A protected review-receipt check rejects absent, stale, rate-limited, or
  unresolved CodeRabbit reviews; each fix push requires another actual review.
- Intent locks detect silent requirement or architecture drift.
- Captured command output is bounded and secret-like assignments are redacted.
- `$secure-launch` derives authentication, tenant isolation, privacy, abuse,
  cost, dependency, and supply-chain gates only when the project exposure makes
  them applicable.
- Upstream repositories are read-only research inputs; changes never flow into
  the package automatically.
- Accidental direct npm publication fails closed. The first release uses a
  documented owner/2FA bootstrap; later releases use protected stage-only
  trusted publishing and human npm approval.

These controls protect a non-technical owner without asking them to approve
technical details they cannot reasonably evaluate. The agent must translate an
unsafe request into the closest safe outcome and explain the difference plainly.

## Agent and Maintainer Commands

Projects receive a self-contained local CLI:

```bash
node .agent-stack/bin/agent-stack.mjs status
node .agent-stack/bin/agent-stack.mjs detect --write
node .agent-stack/bin/agent-stack.mjs approve-checks \
  --reason "Inspected project-native quality command definitions"
node .agent-stack/bin/agent-stack.mjs verify
node .agent-stack/bin/agent-stack.mjs lock
node .agent-stack/bin/agent-stack.mjs check-lock
```

Package maintainers use:

```bash
npm run upstream:check
npm run release:check
```

`$maintain-agent-stack` governs source review, workflow changes, SemVer,
tarball testing, and release preparation. A weekly GitHub workflow opens or
updates a review issue when pinned upstream repositories change. It never
copies, executes, merges, or publishes upstream code.

## Package Contents

- `skills/`: eight validated Agent Skills, including setup, secure launch, delivery,
  verification, review closure, and maintenance.
- `bin/ultimate-agent-stack.mjs`: dependency-free Node.js CLI.
- `assets/project-template/`: protected policy, planning artifacts, PR
  template, CodeRabbit configuration, review-receipt workflow, and harness
  adapters.
- `sources/upstreams.json`: pinned read-only research sources.
- `.github/workflows/`: CI, weekly upstream watch, and protected npm publish.
- `test/`: deterministic safety and lifecycle tests.
- `docs/`: architecture, operating manual, review loop, and source tradeoffs.

The no-code publishing handoff is in [docs/RELEASE.md](docs/RELEASE.md).

## Requirements

- Node.js 20.12 or newer;
- Git for normal delivery;
- project-native tools for the detected checks;
- `gh` or a connected GitHub integration for the pull-request phase;
- CodeRabbit installed when its review loop is desired.

There are no runtime npm dependencies and no install lifecycle scripts. The
only publication lifecycle hook is a fail-closed `prepublishOnly` guard.

## Validate This Package

```bash
npm ci --ignore-scripts
npm run release:check

for skill in skills/*; do
  uv run --with pyyaml python \
    ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$skill"
done

uv run --with pyyaml python \
  ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .

npx --yes markdownlint-cli2@0.20.0 '**/*.md'
```

No third-party source file was copied into this package. The workflows are an
original synthesis of the sources documented in
[docs/SOURCES_AND_TRADEOFFS.md](docs/SOURCES_AND_TRADEOFFS.md).
