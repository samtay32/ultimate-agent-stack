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
| Hash locked intent files and report drift | Use subagents only when they provide a clear benefit |
| Reject stale, change-requested, or unresolved required review evidence | Treat worker output and optional memory as untrusted advice |
| Preserve differing local files and create update proposals | Repair valid review findings and explain rejected ones |
| Reject a second active Project Steward in the same checkout | Have the primary agent manage every subagent |
| Integrity-check bounded repository checkpoints and reject common secret shapes | Write checkpoints after verified milestones |
| Verify project-local GBrain path containment, health, and identity | Treat optional memory as advisory |
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
programs.

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

Quality checks use command arrays rather than shell strings. Direct shell
interpreters, known destructive programs, unsafe package-manager operations,
write-capable Git commands, and unsafe Docker or Terraform commands are
rejected.

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
a new lock.

When project policy requires independent review, the protected receipt gate
checks the current commit. Missing reviews, stale reviews, requested changes,
unresolved actionable threads, incomplete API pagination, and CodeRabbit
rate-limit comments do not count as approval.

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

### Package release

The npm package has no runtime dependencies and no install hook. Direct
publication runs a release preflight. The repository release path separates
read-only package staging from GitHub release writes, uses short-lived trusted
publishing credentials, requires human npm approval, and checks registry
provenance before publishing the matching GitHub Release.

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

The implementation lives in
[`bin/ultimate-agent-stack.mjs`](../bin/ultimate-agent-stack.mjs), the protected
review logic in
[`scripts/review-receipt.mjs`](../scripts/review-receipt.mjs), and the
adversarial tests in [`test/`](../test/).

For component design, read [Architecture](ARCHITECTURE.md). For release
authority and publishing controls, read [Release](RELEASE.md).
