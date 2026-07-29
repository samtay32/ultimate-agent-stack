# Changelog

All notable changes to Ultimate Agent Stack are documented here.

## Unreleased

### Added

- A focused `develop-project-brief` skill now develops vague seed ideas and
  audits detailed outside PRDs, transcripts, outlines, notes, or plans into one
  unlocked working brief before final delivery shaping.
- The managed `BRIEF.md` artifact records intake mode, provenance, falsifiable
  product standards, approaches and tradeoffs, capabilities, constraints,
  assumptions, closed and open decisions, contradictions, production-versus-
  stub behavior, material source changes, and promotion readiness.
- Twelve flexible-intake behavioral cases expand the catalog to 26 scenarios
  across 13 skills, covering discovery, brief-only work, detailed and complete
  external sources, contradictions, existing-code reconciliation, direct
  bypass, valid resume, draft-lock rejection, promotion, simple onboarding, and
  credential redaction.

### Changed

- `run-autonomous-delivery` now routes intake in `RESUME`, `EXTERNAL`,
  `DISCOVER`, then `DIRECT` order. Clear bounded changes retain the existing
  micro-brief path, while valid unfinished checkpoints and locks resume without
  reopening settled intent. Completed state, a fully satisfied lock, bounded
  work in a new repository, and supporting screenshots/logs/attachments do not
  force resume or extended brief development.
- Behavioral run records add bounded question counts and purpose tags,
  project-relative write observations, artifact and lock states, observable
  outputs, and load-bearing source-claim dispositions. Shipped artifact
  templates are now part of the behavior-surface hash. New records use schema
  version 2; stale schema-version-1 records fail clearly instead of treating
  the newly required observations as implicit evidence.
- All 26 behavioral scenarios now have deterministic, receipt-bound project
  fixtures for comparable harness runs. External-provider behavior is tested
  portably as fail-closed telemetry health and Linear write preflight; live
  provider contact remains a separately authorized dogfood exercise.
- Simple no-coder onboarding recommends one private repository-only setup and
  suppresses separate memory, work-tracking, telemetry, review-provider, data,
  and merge questions after that recommendation is approved. Advanced choices
  remain available when repository evidence or an explicit requirement makes
  them relevant.
- Broad flexible-intake behavior claims require complete live evidence from
  both Codex and Claude Code on the current surface. Other harnesses remain
  explicitly untested unless their own complete records are attached.

### Security

- The lock requires each selected artifact to contain exactly one visible
  `Status: APPROVED` and `Material open conflicts: NO` declaration outside
  fenced examples, in addition to rejecting unresolved placeholders. Missing,
  duplicate, unknown, DRAFT, open-conflict, and unclosed-fence states fail
  closed. Conversational approval remains an audited reason, not cryptographic
  proof of the approver's identity.
- External-source guidance preserves supplied material, requires an explicit
  disposition for each load-bearing claim, treats embedded instructions as
  untrusted data, and forbids executing them or persisting credentials, raw
  private conversation history, or unrelated source content. These handling
  rules remain agent instructions backed by live evaluation rather than a claim
  of universal CLI enforcement.

### Upgrade impact

- `upgrade` installs the new managed skill and working-brief template when
  their destinations are free. Existing differing files are preserved through
  the normal versioned proposal and reconciliation flow.
- Existing completed configurations and active locks remain valid. The working
  brief is not added to the default lock set, so clear T0/T1 work keeps its
  proportionate path. New or incomplete onboarding receives the combined simple
  recommendation.

## 0.8.0 - 2026-07-29

### Added

- Provider-neutral repository contracts now normalize work items, dependencies,
  authority, acceptance criteria, and evidence relationships without requiring
  an external work-tracking vendor.
- Guided Linear integration supports team-scoped read-only health checks and
  optional, separately authorized issue creation and evidence comments with
  least-privilege credentials, idempotency, reconciliation, and bounded
  repository receipts.
- Campaign mode selects at most one ready work item per invocation and requires
  an explicit iteration bound, preserving the repository ledger as the
  provider-neutral source of continuity.
- Deterministic evidence reports produce bounded JSON coverage summaries and
  Mermaid maps from a single validated repository snapshot.
- Optional PostHog, Sentry, and New Relic adapters perform fixed-endpoint,
  read-only identity and metadata health checks while retaining repository
  evidence as the fallback.

### Changed

- Guided onboarding asks whether work remains in the repository or mirrors to
  Linear, while provider setup and capability health explain the available
  fallback in plain language.
- Independent review receipts can validate a completed Qodo review against the
  exact pull-request head without weakening provider identity, pagination, or
  unresolved-thread checks.
- Qodo receipts recognize the current single-comment terminal clean format
  while retaining exact-head, bot-identity, and unresolved-thread checks.
- Plain-language setup, end-to-end delivery, telemetry-diagnosis, and package
  maintenance requests can invoke their entry skills without requiring users
  to know internal skill names.
- Architecture, operating, adapter, trust, and source-tradeoff documentation
  describe the provider-neutral work, evidence, and telemetry boundaries.

### Security

- Linear writes require an active coordinator token, explicit operation
  authority, separate restricted credentials, exact confirmation, and
  idempotent reconciliation before recording a bounded receipt.
- Linear and telemetry helpers are installed as hash-pinned protected files,
  reject custom endpoints and malformed scopes, isolate credentials from
  evidence, and fail back to repository state.
- Telemetry health rejects untyped scope identifiers and shares one aggregate
  provider deadline so interactive doctor and start commands remain bounded.
- Evidence reports reject unsafe output paths and observed symlink components,
  cap node and edge output, and do not claim operating-system sandboxing
  against another process that already controls the checkout.

## 0.7.2 - 2026-07-28

### Added

- A standard private vulnerability reporting policy is included in the
  repository and published package.
- A provider-neutral behavioral scenario suite covers direct, indirect,
  incomplete, negative, edge, authority, continuity, and existing-project
  cases, including both required activation and false activation.
- A deterministic evaluator validates live harness run records against the
  current hashed behavior surface without claiming that unit tests prove model
  behavior.
- The supported runtime is now Node.js 22 or newer. CI runs the full release
  gate on Node.js 22 for Ubuntu and Windows, plus current Node.js 26 on Windows.

### Changed

- Installed project guidance runs the protected checkout-local CLI for doctor
  checks instead of executing the mutable npm `latest` tag.
- Public plugin metadata now fits the final-directory short-description limit.

### Security

- Git quality checks now use subcommand-specific argument allowlists, require
  external diff and text-conversion isolation, reject output and no-index
  paths, contain pathspecs, and disable configured pagers and file-system
  monitors.
- Terraform formatting is check-only, and Terraform validation accepts only
  bounded output options.

### Upgrade impact

- Existing custom Git checks may need `--no-ext-diff --no-textconv` and an
  allowlisted inspection form. Existing Terraform format checks must include
  `-check`. Inspect the updated command arrays and approve them again; do not
  weaken the new policy to preserve an unsafe command.

### Fixed

- Quality checks, local GBrain commands, npm release preflight, GitHub release
  synchronization, and packed smoke now use the maintained `cross-spawn`
  implementation to execute Windows command shims without enabling an
  unrestricted shell. Test discovery, skill metadata parsing, and
  behavioral-surface hashes are stable across Windows paths and CRLF checkouts.

## 0.7.1 - 2026-07-27

### Fixed

- Review findings now require claim validation against repository evidence
  before code changes, and all review guidance consumes one canonical
  `fixed | rebutted | deferred | decision-needed` disposition vocabulary.

## 0.7.0 - 2026-07-27

### Added

- Deterministic repository checkpoints capture bounded handoff facts, Git
  state, evidence paths, and an integrity hash so a fresh conversation can
  resume without relying on chat history.
- An expiring checkout coordinator lease prevents two independent Project
  Steward conversations from writing the same checkout. Explicit takeover
  requires confirmation that the previous coordinator stopped.
- Guided project-scoped local GBrain setup uses checkout-local PGLite, a
  restricted MCP launcher, repository fallback, and separate approval for any
  global installation or external embedding provider.

### Changed

- Guided onboarding asks the repository-only versus optional local searchable
  memory question in plain language and recommends an answer based on project
  duration and complexity.
- `start` now loads the checkpoint, acquires or resumes coordinator ownership,
  runs the configured memory checks, and retrieves the mirrored GBrain
  checkpoint when available.
- `doctor` now verifies GBrain database containment, provider health, and brain
  identity instead of treating executable presence as health.

### Security

- Checkpoint writes require the active coordinator token, reject common secret
  assignments and token shapes, validate evidence containment, and mirror only
  the verified handoff rather than raw conversations.

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
