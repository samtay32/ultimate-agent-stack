# Changelog

All notable changes to Ultimate Agent Stack are documented here.

## Unreleased

## 0.6.0 - 2026-07-27

### Added

- Quality checks can use explicitly approved non-secret environment variables
  through `quality.environment.allow`. Names associated with credentials or
  runtime injection remain forbidden, and approved values are fingerprinted
  for approval drift while being redacted from evidence.
- Fresh installs now include the primary Claude entry skill and conservative
  native worker adapter by default while preserving marker detection and
  legacy `--claude` compatibility.
- `docs/TRUST.md` maps CLI-enforced controls separately from agent instructions
  and documents containment, executable-check, parallel-work, review, release,
  and account-security boundaries.

### Changed

- Verification preserves the minimum safe toolchain environment and reuses
  existing cache-only directories without inheriting ordinary credentials.
- Human doctor output now includes Git initialization when Git and the first
  quality baseline are both missing, and runtime diagnostics distinguish
  output-capture overflow from ordinary command failure.
- The README is now a shorter plain-language front door for non-coders and
  coders, with direct onboarding, conditional independent review, replaceable
  adapters, honest safety boundaries, and links to the full technical record.
- Package validation relies on packed-tarball duplicate detection instead of an
  unreliable npm `files` negation pattern.

### Security

- Direct inline-evaluation commands, sensitive environment names,
  execution-control variables, and non-executable command paths are rejected.
  Changed approved environment values invalidate approval before checks run.

### Upgrade impact

This is a compatible minor release. Existing project configuration remains
valid, and `quality.environment.allow` is optional and approval-bound. Updated
protected CLI behavior and managed guidance are installed through the existing
proposal and reconciliation flow; customized files are not silently
overwritten. The configuration schema remains at version 2.

## 0.5.1 - 2026-07-26

### Fixed

- `doctor --human` now treats an otherwise intact, newly initialized empty
  project with no first quality-check baseline as **Almost ready** and tells the
  coding agent to create that baseline. Machine-readable validation, nonzero
  exit status, check approval, and Git requirements remain fail-closed.
  Machine-readable doctor reasons keep stale approvals and invalid Git state
  from being mistaken for ordinary first-time setup.

### Upgrade impact

This is a compatible patch release. Existing projects receive a versioned
proposal for the updated protected CLI and guidance; customized files are never
overwritten. The doctor JSON contract gains additive diagnostic reason codes,
while validation, nonzero failure status, approvals, and Git requirements
remain fail-closed.

## 0.5.0 - 2026-07-26

### Added

- `doctor --human` provides non-coders with a plain-language readiness summary
  and one concrete next action while preserving JSON as the default agent and
  automation contract.
- `configure --preset simple` records approved standard, built-in-review,
  repository-knowledge, local-only, human-merge defaults without creating a
  weaker installation or separate policy tier.

### Changed

- The README and operating manual now lead with a 30-second non-coder path,
  explain when the simple-project recommendation applies, and state plainly
  that package guardrails do not replace sandboxing, permissions, backups, or
  human judgment.
- Installed setup guidance recommends the simple preset only when repository
  evidence does not require production release protection or external
  providers.

### Fixed

- GitHub draft-release preparation now treats GitHub's specific HTTP 422
  "No commit found for SHA" response as an absent version tag while preserving
  fail-closed behavior for unrelated API errors.
- npm package contents exclude macOS-style " 2" duplicate-copy paths, and the
  packed-install smoke test rejects them if they ever reappear.

### Upgrade impact

This is a compatible minor release. Existing projects receive versioned
proposals for the updated protected CLI and installed guidance; customized
files are never overwritten. The JSON command contract and configuration schema
remain compatible. The simple preset and human-readable doctor output are
optional, and existing advanced provider configurations remain unchanged.

## 0.4.0 - 2026-07-26

### Added

- Guided onboarding that detects capabilities, recommends one choice with at
  most one genuinely safe alternative, and records approved project profile,
  external-data, provider, execution, and merge choices.
- Provider-neutral review configuration with built-in, CodeRabbit, and
  allowlisted GitHub-human options.
- `$use-project-knowledge` with repository and optional GBrain providers,
  provenance and staleness checks, repository fallback, verified capture, and
  guarded skill-candidate promotion.
- Capability discovery and provider/configuration health reports in the
  dependency-free CLI.

### Changed

- Project configuration migrates to schema v2 and fingerprints consequential
  provider and authority choices so silent changes invalidate approval.
- The protected review receipt now reads installed-project configuration,
  supports CodeRabbit or allowlisted current-head GitHub approval, and becomes
  inert when the selected profile does not require an external receipt.
- Startup separates short system onboarding from adaptive product discovery;
  the coding agent owns the conversation while the CLI remains non-interactive.
- Successful npm staging now prepares a commit-bound draft GitHub Release.
- An hourly, manually triggerable synchronization verifies the public npm
  artifact, publish attestation, SLSA workflow identity, and provenance commit
  before publishing the corresponding GitHub Release.

### Upgrade impact

This is a compatible minor release. Existing CodeRabbit installations migrate
to a production CodeRabbit selection but require confirmation of the new
profile and provider configuration. Existing protections are preserved.
Customized managed files receive reconciliation proposals. GBrain remains
disabled unless explicitly selected with an approved external-data policy.

## 0.3.0 - 2026-07-26

### Added

- `$coordinate-parallel-delivery`, a portable coordinator that lets the primary
  agent choose serial or bounded native-subagent execution and own assignment,
  monitoring, recovery, integration, verification, and cleanup.
- Conservative read-only worker adapters for Codex, Gemini CLI, and OpenCode,
  plus a Claude Code adapter installed with `--claude`.
- A durable delegation record and capability model for serial, shared-checkout
  read-only, and isolated-write execution.
- README and architecture diagrams explaining the one-conversation coordination
  model for non-coders and coders.

### Changed

- The end-to-end delivery workflow now routes every shaped request through an
  adaptive execution decision instead of relying on an informal serial default.
- Project configuration caps workers, requires serial fallback and isolated
  parallel writes, forbids nested delegation and authority expansion, and keeps
  integration with the primary agent.
- The Firstmate principle of one human-facing coordinator is now implemented as
  original portable policy; Firstmate's Kimi/tmux runtime adapter remains
  deliberately deferred.

### Upgrade impact

This is a compatible minor release. Existing projects receive versioned
proposals for changed managed instructions and new coordinator assets. The
config migrator adds the safe parallel-delivery defaults. Upgrade never
overwrites an existing differing file; the agent must reconcile proposals,
approve any changed project checks, and rerun `doctor` and `verify`.

## 0.2.0 - 2026-07-26

### Added

- A dependency-free review-receipt evaluator that verifies CodeRabbit submitted
  an actual review against the current pull-request head.
- A protected installed-project workflow that rejects missing, stale,
  rate-limited, change-requested, unresolved, or incomplete review evidence.
- A manual receipt re-evaluation path for GitHub's silent review-thread
  resolution case.
- Repository and installed-project workflow synchronization tests.

### Changed

- The repository now uses the assertive CodeRabbit profile instead of falling
  back to organization defaults.
- Every fix push invalidates the prior CodeRabbit receipt and requires another
  review of the new head.
- Receipt workflows execute the evaluator only from the protected default
  branch and use concurrency control to supersede noisy intermediate events.

### Upgrade impact

This is a compatible minor release. Existing projects receive versioned
proposals for changed managed files and the new protected receipt files.
Upgrade does not overwrite an existing differing file; the agent must reconcile
each proposal and rerun project verification.

## 0.1.0 - 2026-07-25

- Initial public release of the guarded, project-adaptive agent workflow.
