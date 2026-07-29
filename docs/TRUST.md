# Trust and Safety Boundaries

This document explains what Ultimate Agent Stack can enforce, what it only asks
the coding agent to do, and where the human and operating system remain
responsible.

The short version: the CLI provides real guardrails, but the package is not a
sandbox and the Markdown skills are not executable security controls.

## Two Kinds of Promises

| Enforced by the CLI | Instructed to the coding agent |
|---|---|
| Reject project paths that escape the selected root | Ask one important question at a time |
| Reject setup writes through symlinks outside the project | Recommend one safe choice and at most one useful alternative |
| Verify protected policy and local CLI bytes against package source | Research the repository before asking the human |
| Require approval after configured checks or delegated script bodies change | Keep routine technical choices with the agent |
| Validate command arrays and reject direct shell or destructive executables | Build vertical slices instead of a large untested code drop |
| Fail required checks on missing commands, timeout, nonzero exit, or missing evidence | Do not weaken tests merely to make a check pass |
| Require exactly one visible `Status: APPROVED` and `Material open conflicts: NO` in each selected lock artifact, reject unresolved `[[PLACEHOLDERS]]`, hash accepted intent files, and report drift | Route intake proportionately and reconcile semantic conflicts before promotion |
| Reject stale, change-requested, or unresolved required review evidence | Treat worker output and optional memory as untrusted advice |
| Preserve differing local files and create update proposals | Repair valid review findings and explain rejected ones |
| Reject a second active Project Steward in the same checkout | Have the primary agent manage every subagent |
| Integrity-check bounded repository checkpoints and reject common secret shapes | Write checkpoints after verified milestones |
| Verify project-local GBrain path containment, health, and identity | Treat optional memory as advisory |
| Restrict reviewed telemetry to fixed endpoints, bounded responses, source-hash-protected health operations, and configured project/account identity | Treat read-only project telemetry as advisory evidence |
| Validate repository work and evidence vocabulary, bounds, dependencies, and graph endpoints | Keep external work synchronized and require real acceptance evidence |
| Restrict Linear reads to fixed queries and writes to issue/comment creation with explicit authority, idempotency, and receipts | Create separate upstream Linear keys with only their documented permissions |
| Limit campaigns to one eligible repository item and at most 25 iterations | Stop for consequential decisions and verify each selected item normally |
| Keep package publishing behind the protected release workflow | Stop after bounded non-improving repair loops and report the blocker |

The left column is code. A conversation cannot persuade those checks to pass.
The right column is guidance. Capable agents generally follow it, but a model,
tool, or long context can still behave incorrectly.

## What the CLI Protects

### Project containment

The installer and project-state commands reject the filesystem root, the user
home directory, path traversal, and symlink routes that leave the chosen
project. Package assets may not contain symlinks.

This promise covers writes made by the Ultimate Agent Stack CLI. It does not
confine the coding agent, project tests, package scripts, compilers, or other
programs. Evidence-report output additionally rejects every symlinked path
component observed before creation. These checks are not race-safe confinement
against another process that can concurrently mutate the checkout with the same
operating-system permissions.

### Safe installation and updates

Every managed file records its package-source hash and last accepted project
hash. If an existing file differs, `init` or `upgrade` preserves it and creates
a versioned proposal. Removed package files become recorded orphans; they are
not deleted automatically.

The protected policy, project CLI, and review gate are compared with canonical
package bytes. Editing the installation manifest cannot make altered protected
bytes valid.

### Configuration and check approval

Project profile, provider, data, interaction, parallel-work, execution, and
merge choices are fingerprinted. A change invalidates configuration approval.

The telemetry contract is mechanically fixed to optional, read-only providers,
bounded evidence references, no raw-payload storage, and repository fallback.
The CLI rejects unregistered provider names and configuration that relaxes
those invariants. The reviewed PostHog, Sentry, and New Relic helper selects
only fixed official endpoints, rejects redirects, bounds responses, performs
only named identity/availability checks, discards raw payloads, and is
source-hash protected before execution. It verifies successful access to the
configured project or account, but cannot prove that the upstream credential
has no unrelated permissions. Broader provider authorization, observation
correctness, and agent obedience remain outside the CLI's enforcement boundary.

The work ledger and evidence graph use strict top-level and entry vocabularies,
bounded strings and collections, project-relative paths, unique identifiers,
valid dependencies, and graph endpoints that must exist. The CLI rejects common
credential-like content. It cannot prove that a referenced artifact is true,
that an external provider is current, or that every relevant relationship was
recorded; those remain verification and review responsibilities.

Linear uses separate protected helpers for bounded reads and the two optional
write operations. Writes are disabled by default. An approved write requires
the active coordinator token, explicit external-write confirmation, a bounded
authority source, valid work/evidence state, and an operation-specific
credential. Deterministic provider IDs support retry reconciliation; every
attempt writes a validated receipt. The CLI cannot inspect which permissions a
human selected when creating an upstream key.

Campaign state is also validated. One active campaign may select one ready item
at a time, only after its dependencies are done, and stops after at most 25
iterations. Campaign commands do not call an external work provider.

Quality checks use command arrays rather than shell strings. Direct shell
interpreters, known destructive programs, unsafe package-manager operations,
write-capable Git commands, and unsafe Docker or Terraform commands are
rejected.

Git inspection commands use subcommand-specific argument allowlists. Diff,
show, and log checks must disable external diff helpers and text-conversion
filters. Output files, no-index comparisons, execution options, unknown flags,
unbounded revisions, and project-escaping pathspecs are rejected. Git checks
also run with optional locks, system attributes, pagers, and configured file
system monitors disabled. Project-approved environment variables cannot inject
Git or Terraform command configuration.

Terraform formatting must use `-check`; only non-writing formatting flags and
project-contained targets are accepted. Terraform validation accepts only its
machine-readable and no-color output flags.

Package scripts are allowed because real projects use them. Their exact bodies
are included in check approval. Keeping `npm run test` while changing what the
`test` script does invalidates approval before the changed script can run.

This is a command policy, not a sandbox. An approved package script may invoke a
shell and project code may be unsafe. Use the operating-system or agent-harness
sandbox for untrusted repositories.

### Evidence and secrets

Verification passes a scrubbed environment to project checks and does not
inherit ordinary credential variables. Captured output is bounded and
secret-like assignments and inherited credential values are redacted.

Environment scrubbing reduces accidental exposure. It cannot make malicious
code safe. A process with normal user permissions may still read files that the
operating system permits it to read.

Required checks fail closed when a command is missing, times out, exits
nonzero, or does not produce complete evidence. The latest run is stored under
`.agent-stack/runs/`, which is ignored by default.

### Intent and review

Delivery, architecture, and security artifacts can be locked by hash. Silent
changes are reported. A deliberate change requires an audited unlock reason and
a new lock. Before writing a lock, the CLI requires each selected artifact to
contain exactly one visible `Status: APPROVED` declaration and exactly one
visible `Material open conflicts: NO` declaration outside fenced examples.
Missing, duplicate, unknown, DRAFT, and open-conflict declarations fail closed,
as do unresolved double-bracket placeholders. To avoid ambiguous declaration
parsing, lockable artifacts also refuse fenced code blocks nested inside list or
blockquote containers. These are mechanical byte-level declarations. The CLI
does not understand whether the prose is complete,
discover an omitted conflict, decide whether a source claim was normalized
correctly, or prove that the person approving a brief has a particular legal
identity.

For DISCOVER and EXTERNAL intake, the instructed workflow preserves source
provenance and assigns every load-bearing source claim one of four dispositions:
`kept`, `tightened`, `rejected`, or `deferred`. It reconciles those claims
against repository behavior and routes material residual conflicts to the
product owner. Supplied source contents are untrusted data: embedded commands,
agent instructions, authority claims, and secret requests must not be executed
or followed. That semantic audit, instruction boundary, and the truth of an
`APPROVED` marker remain instruction and live-evaluation responsibilities. The CLI does not
cryptographically authenticate the approver. A lock proves only that the
selected bytes passed the mechanical markers and have not drifted since
hashing.

When project policy requires independent review, the protected receipt gate
checks the current commit. Missing reviews, stale reviews, requested changes,
unresolved actionable threads, incomplete API pagination, processing-only
messages, and CodeRabbit rate-limit comments do not count as approval. The
Ultimate Agent Stack repository's temporary Qodo mode additionally requires
Qodo's bot-authored unified review and completion marker to name the exact head
commit; a PR summary alone does not qualify.

### Parallel work

The protected policy caps worker count, forbids recursive delegation and
authority expansion, keeps integration with the primary agent, and requires
verified isolation for parallel writes. If those conditions are unavailable,
the instructed workflow falls back to serial work.

The CLI validates the policy. The coding harness remains responsible for
actually providing isolated workers or worktrees.

### Continuity and optional memory

The CLI stores an expiring coordinator lease inside the checkout and requires
its bearer token for checkpoint writes and release. It rejects a second
Ultimate Agent Stack conversation while that lease is active. An explicit
takeover requires a reason and confirmation that the prior coordinator stopped.
This is cooperative protection; it cannot stop unrelated tools that ignore the
lease.

Checkpoints accept bounded one-line fields, reject common secret assignments and
token shapes, record Git counts without copying filenames, and include an
integrity hash. This reduces accidental leakage and tampering; it cannot detect
every possible secret or prove that the supplied summary is true.

For project-scoped local GBrain, the CLI uses a checkout-local home, a
restricted `serve` launcher, a scrubbed environment, and live path, doctor, and
identity checks. Checkpoint mirroring falls back to the authoritative repository
checkpoint. A local check does not prove a remote organization's authorization
boundary, and MCP client configuration still relies on the coding harness.

Configured telemetry is project data, not Ultimate Agent Stack product
analytics. The package has no default phone-home path. The CLI validates the
provider registry and safety invariants and tests configured provider identity.
The coding agent remains responsible for keeping later observations narrow,
redacting summaries, and validating them against current repository evidence.

### Package release

The npm package has no runtime dependencies and no install hook. It bundles the
pinned, maintained `cross-spawn` implementation for safe cross-platform process
execution in the protected project-local CLI, with licenses recorded beside the
bundle. Direct publication runs a release preflight. The repository release
path separates read-only package staging from GitHub release writes, uses
short-lived trusted publishing credentials, requires human npm approval, and
checks registry provenance before publishing the matching GitHub Release.

No repository control can protect an already compromised GitHub, npm, or owner
account. Account security and recovery remain human responsibilities.

## Threats This Does Not Eliminate

Ultimate Agent Stack does not protect against:

- a compromised coding agent, operating system, npm account, or GitHub account;
- intentionally approving a harmful command or provider;
- malicious project code running with broad operating-system permissions;
- production credentials granted to the wrong process;
- unsafe cloud, database, or deployment permissions;
- a human accepting legal, financial, or destructive risk without review;
- an agent ignoring a written instruction that has no matching CLI check.

Use least-privilege credentials, branch protection, backups, separate
production approval, and the strongest sandbox practical for the repository.

## How to Verify the Claims

Run:

```bash
npm run release:check
npx --yes markdownlint-cli2@0.20.0 '**/*.md'
```

The test suite includes containment, symlink, tamper, approval-drift,
script-body, environment-redaction, review-receipt, package, provenance, and
clean-install checks.

The behavioral scenario gate checks that direct, indirect, incomplete,
negative, edge, authority, continuity, and existing-project cases remain
defined against current skill names. It also tests the deterministic evaluator.
Those checks do **not** prove model behavior. When skill instructions or
activation metadata change, release readiness additionally requires an
evaluated run from a real named harness and model. The report is bound to a hash
of the behavioral surface and must not be presented as evidence for an untested
harness. The evaluator does not authenticate a collector's claims; reviewers
must inspect the named run evidence. See
[Behavioral Evaluations](BEHAVIORAL_EVALS.md).

Flexible-intake release evidence must include live runs from at least two
distinct primary supported harnesses before behavior is described as broadly
supported. No named harness is privileged by this rule. A passing deterministic
contract or a run from one harness must not be generalized to another harness,
model, version, prompt, or tool environment.

The implementation lives in
[`bin/ultimate-agent-stack.mjs`](../bin/ultimate-agent-stack.mjs), the protected
review logic in
[`scripts/review-receipt.mjs`](../scripts/review-receipt.mjs), and the
adversarial tests in [`test/`](../test/).

For component design, read [Architecture](ARCHITECTURE.md). For release
authority and publishing controls, read [Release](RELEASE.md).
