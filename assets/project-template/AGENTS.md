# Project Agent Contract

## Mission and precedence

Deliver the simplest production-grade change from intent through verified review
closure. Humans retain strategic and irreversible authority. Project-specific
instructions outrank this generic contract.

Before meaningful work, read this file, `.agent-stack/core-policy.json`,
`.agent-stack/config.json`, any valid checkpoint, and the current diff. Then
load only the route, source, test, and reference needed for the next decision.
Do not dump directories, artifacts, all skills, CLI source, or command help.

## Intake and skill routing

Use the first matching route:

1. **RESUME** a valid non-complete checkpoint or active lock with an unmet done
   or evidence condition.
2. **EXTERNAL** substantial supplied material that defines intent or a plan.
3. **DISCOVER** vague, contradictory, exploratory, or greenfield intent that
   needs development.
4. **DIRECT** clear, bounded, testable work.

A supporting screenshot, log, or attachment does not make clear work EXTERNAL;
clear bounded work remains DIRECT in a new repository. Completed state does not
hijack a new request. Preserve supplied sources unchanged and reconcile claims
with repository reality.

End-to-end delivery and RESUME use `$run-autonomous-delivery`; EXTERNAL and
DISCOVER then use `$develop-project-brief`. A request explicitly limited to
brief refinement, source audit, or reconciliation uses only
`$develop-project-brief`. Explanation-only work uses neither. An explicitly
phase-specific implementation uses `$build-vertical-slice`; explicitly
phase-specific verification uses `$verify-change`. The controller owns routine
implementation and verification without requiring nested native phase
activations. `$close-review-loop` applies only to an existing pull request or
provider/human review thread. Optional knowledge, telemetry, work, and parallel
skills load only when the selected route's immediate next decision needs them;
DISCOVER brief work stays serial.

When the harness supports native skills, invoke the applicable skill before
acting. Otherwise hash-bound read the same installed `SKILL.md`. If the harness
can do neither safely, report the capability limitation and do not force a
substitute. A prompt that names a skill is not activation. Receipts distinguish
`native` from `file-read`; never mislabel either. Use a canonical project-relative
installed path, exact exposed harness/model identities, and one stable event ID
per actual activation so retries are idempotent. Never persist without checkout
ownership and repository-write authority; keep read-only traces outside project
state.

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

Activation readiness comes from `evidence activation-status --run RUN
--require SKILL`, not prose. A local independent review uses `review record`
with the same run, exact clean Git head, distinct nonempty reviewer identity,
and a bounded structured result under `.agent-stack/runs/reviews/`; an
unavailable reviewer uses `review unavailable`. `review status` and stack
`status` derive readiness. Missing, failed, empty, stale, altered, wrong-run,
wrong-commit, dirty-tree, unavailable, or same-agent evidence keeps independent
review and PR readiness false. A separate reviewer must return an inspectable
result; self-review is not independent, so its readiness stays blocked. Local receipts are separate from
protected GitHub reviews and do not authenticate physical identity.

Keep live evaluation prompts and serialized context at or below 2 KiB. Paid
live-model tests are not part of deterministic package validation.

## Delivery and authority

Before a meaningful change, provide a proportionate design note: understanding,
assumptions, observable behavior, tests, and implementation. Build vertical,
demonstrable slices; keep side effects and failure behavior explicit; update
documentation; preserve unrelated changes. Never add dependencies,
infrastructure, or services without need, or weaken tests, permissions,
security, or acceptance criteria to obtain green.

Proceed on routine reversible evidence-backed choices. Ask before choices that
materially change product intent, spend money, create accounts, expose secrets,
accept legal/privacy/security risk, delete material data, or perform an
unauthorized merge, deployment, release, or publication. Recommend one safe
default, offer at most one genuinely safe alternative, explain the practical
consequence, then ask and end the turn. A question asking for
acceptance ends the turn. A prior explicit instruction such as "use the
recommendation" is approval for that recommendation, but never for an
irreversible action. Read closed decisions before proposing changes; binding
changes require product-owner authority and the audited unlock/change/relock
path.

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
