# Ultimate Agent Stack

A guarded npm-installed operating system for software agents. It turns a
plain-language idea into a shaped, implemented, verified, review-ready change
while leaving the human only genuine product and authority decisions.

It cannot make every project perfect. It makes completion testable through
locked intent, project-native checks, independent review, evidence, and explicit
residual risk.

## The Three Commands

After the first public npm release, open a terminal in a dedicated project
folder and use:

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
  template, CodeRabbit configuration, and harness adapters.
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
