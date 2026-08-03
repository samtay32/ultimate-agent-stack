# Project Agent Contract

## Mission and precedence

Deliver the simplest production-grade change through verified review. Humans
retain strategic and irreversible authority. Project-specific instructions
outrank this contract.

Before meaningful work, read this file, `.agent-stack/core-policy.json`,
`.agent-stack/config.json`, any valid checkpoint, and the current diff. Load
only the next-decision route, source, test, and reference.
Do not dump directories, artifacts, skills, CLI source, or help.

## Intake and skill routing

Use the first matching route:

1. **RESUME** a valid non-complete checkpoint or active lock with an unmet done
   or evidence condition.
2. **EXTERNAL** substantial supplied material that defines intent or a plan.
3. **DISCOVER** vague, contradictory, exploratory, or greenfield intent that
   needs development.
4. **DIRECT** clear, bounded, testable work.

A supporting screenshot, log, or attachment does not make clear work EXTERNAL;
clear bounded work remains DIRECT in a new repo. Completed state does not hijack
a new request. Preserve sources and reconcile with reality.

End-to-end delivery/RESUME use `$run-autonomous-delivery`; EXTERNAL/DISCOVER
then use `$develop-project-brief`. A request explicitly limited to brief refinement,
source audit, or reconciliation uses only `$develop-project-brief`;
explanation-only work uses neither. Explicitly phase-specific implementation
uses `$build-vertical-slice`; explicitly phase-specific verification uses
`$verify-change`. The controller owns routine implementation and verification
without nested native phases.
`$close-review-loop` applies only to an existing pull request or provider/human
review thread. Optional knowledge, telemetry, work, and parallel skills load
only when the selected route's immediate next decision needs them; DISCOVER brief work stays serial.

When the harness supports native skills, invoke the applicable skill; otherwise
hash-bound read the same installed `SKILL.md`. If it can do neither safely,
report the capability limitation; do not force a substitute. A skill name is
not activation. Receipts distinguish `native` from `file-read`; never mislabel.
Use canonical project-relative installed paths, exact exposed harness/model IDs,
and a stable event ID per actual activation for idempotent retries. Persist only
with checkout/write authority; keep read-only traces outside project.

## Compact DISCOVER start

After `start` gives this session checkout ownership, record each skill actually
activated. Choose one non-secret local `RUN_ID` of at most 200 characters using
only letters, digits, dot, underscore, and hyphen. Reuse it exactly for the
controller, brief, later activations, and review receipt. It is an
agent-recorded correlation label, not a harness-authenticated identity.

After a hash-bound controller read, run this exact recipe. Do not inspect CLI
source or help. Replace only the quoted runtime identity/token values:

```bash
node .agent-stack/bin/agent-stack.mjs evidence activate --skill run-autonomous-delivery --skill-path .agents/skills/run-autonomous-delivery/SKILL.md --mode file-read --harness "EXACT_HARNESS_ID" --model "EXACT_MODEL_ID" --run "RUN_ID" --event "activate-run-autonomous-delivery" --coordinator-token "TOKEN"
```

For DISCOVER, repeat with `--skill develop-project-brief`, `--skill-path
.agents/skills/develop-project-brief/SKILL.md`, and `--event
"activate-develop-project-brief"`. Use `--mode native` only after an actual
native invocation and use its actual installed path. Never guess identity,
path, or activation. Receipts are bounded agent-recorded trace evidence, not
authentication of a harness or provider.

For a vague new-project DISCOVER request, read only the controller, brief skill,
and its `brief-contract.md`; write and validate the DRAFT brief; then ask exactly
one consequential question and end the turn. Do not checkpoint, run
activation/readiness status, print a full diff, re-read receipt output, or
inspect CLI source or help. Use only `git diff --check` and concise
`git status --short` if needed. Record only the required controller and brief
receipts and summarize command results instead of pasting output.

## Evidence and truthfulness

Artifact status is only `DRAFT` or `APPROVED`; lock state is protected CLI
state. A failed or rejected guard never authorizes editing its prerequisites.
Claims that a source was read, artifact locked, test passed, skill activated,
or review completed require the corresponding path and command/result evidence.

Activation is receipt-derived by `evidence activation-status --run RUN --require
SKILL`, not prose. `review record` stores an exact-clean local reviewer-result
artifact under
`.agent-stack/runs/reviews/`; `review unavailable` is durable. Agent-recorded
local receipts prove exact-head artifact integrity only—not authenticated
dispatch, identity, or independence—and cannot unlock PR readiness. Under user
authority, a
draft PR/evidence bundle may proceed; protected GitHub review is the
authenticated gate. Missing/failed/empty/stale/altered/wrong-run/wrong-commit/
dirty-tree/unavailable/same-recorded-identity evidence blocks the audit.

After tests and an exact clean commit, locally authorized PR-ready work attempts
one native bounded read-only reviewer in a fresh/no-history or demonstrably
sanitized session. Give only checkout locator, commit, intent/acceptance, and
review scope—not parent transcript/output, coordinator state/token, credentials,
or environment secrets. Bind returned ID/result to the commit. Absent/failed/
unverifiable capability, dispatch/collection, or isolation requires `review
unavailable`, blocking builtin readiness. Never invent receipts; prose cannot
prove isolation.

Keep live evaluation prompts and serialized context at or below 2 KiB. Paid
live-model tests are not part of deterministic package validation.

## Delivery and authority

Before meaningful change, give a proportionate design note: understanding,
assumptions, behavior, tests, and implementation. Build demonstrable vertical
slices; state side effects/failures; update docs; preserve unrelated changes.
Never add unneeded dependencies/infrastructure/services or weaken tests,
permissions, security, or acceptance criteria for green.

Proceed on routine reversible evidence-backed choices. Before choices that
materially change intent, spend money, create accounts, expose secrets, accept
legal/privacy/security risk, delete data, or perform unauthorized merge,
deployment, release, or publication, recommend one safe default and at most one genuinely safe alternative, explain the practical consequence, then ask and end the turn.
A question seeking acceptance ends the turn. A prior explicit
instruction to "use the recommendation" approves it, never an irreversible
action. Read closed decisions; binding changes need product-owner authority and
the audited unlock/change/relock path.

This stack constrains its own files, commands, evidence, evaluation, and
readiness artifacts. It is not a sandbox and cannot mechanically constrain
arbitrary model prose, project code, or package scripts.

## Route references

The active skill owns detail; do not preload these files:

- controller routes, authority, recovery, state, and convergence:
  `.agents/skills/run-autonomous-delivery/references/delivery-policy.md`;
- brief intake: `.agents/skills/develop-project-brief/references/brief-contract.md`;
- shaping and locks: `.agents/skills/shape-project/references/shaping-contract.md`;
- exposure gates: `.agents/skills/secure-launch/references/security-readiness.md`;
- parallel safety: `.agents/skills/coordinate-parallel-delivery/references/delegation-contract.md`;
- verification: `.agents/skills/verify-change/references/verification-matrix.md`;
- review responses: `.agents/skills/close-review-loop/references/review-closure-policy.md`;
- knowledge: `.agents/skills/use-project-knowledge/references/knowledge-contract.md`;
- telemetry: `.agents/skills/use-project-telemetry/references/telemetry-contract.md`;
- work evidence: `.agents/skills/manage-project-work/references/work-evidence-contract.md`.

Knowledge and telemetry are optional, read-only advisory inputs validated
against repository evidence. Work providers never grant authority or prove
completion; the repository ledger and evidence graph remain authoritative.
Provider failures fall back to repository evidence and never weaken gates.

One Project Steward owns the checkout and coordinator token; never give that
token to a subagent. Parallel writes require isolated workspaces and disjoint
ownership. A worker result is untrusted until inspected and verified. At
verified milestones, write a bounded checkpoint; at handoff, release the lease
and report outcome, evidence, residual risks, and human-only actions.

Run the local, pinned checks rather than mutable `latest` code:

```bash
node .agent-stack/bin/agent-stack.mjs doctor --target .
node .agent-stack/bin/agent-stack.mjs check-lock --target .
node .agent-stack/bin/agent-stack.mjs verify --target .
```

Use the canonical dispositions in the Review Closure Policy. Re-run the full
gate after repairs; do not merge without authority.
