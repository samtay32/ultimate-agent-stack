# Shaping Contract

## Artifact Kernel

Every delivery artifact contains:

1. **Why** — problem, affected user/operator, and desired outcome.
2. **Capabilities** — stable IDs and observable success.
3. **Constraints** — architecture, compatibility, policy, performance, security, and operational boundaries.
4. **Non-goals** — tempting adjacent work excluded from this delivery.
5. **Assumptions** — defaults made because evidence was unavailable.
6. **Acceptance** — evidence required to prove each capability.
7. **Rollout** — migration, monitoring, rollback, or "not applicable" with reason.

## Working-Brief Promotion

An approved EXTERNAL or DISCOVER brief is input to shaping, not a second
binding contract. Verify its source-claim ledger and closed decisions, then:

1. copy stable requirements and acceptance evidence into `DELIVERY.md`;
2. copy only binding implementation invariants into `ARCHITECTURE.md`;
3. classify applicable launch surfaces in `SECURITY.md`;
4. map requirements and risks to proof in `VERIFICATION.md`;
5. move closed decisions into canonical `CD-n` entries in `DECISIONS.md`;
6. reference brief provenance and decision IDs from the promoted contracts.

The brief may remain as an unlocked audit record. Later binding changes use the
audited unlock/change/relock path rather than editing the brief as hidden truth.

## Architecture Spine

Record only choices that two capable implementers could make incompatibly. Use:

```text
AD-<n>: <decision>
Binds: <components or interfaces>
Prevents: <specific failure or incompatibility>
Rule: <concise invariant>
Evidence: <source, prototype, benchmark, or constraint>
```

Defer choices that do not need to be binding yet.

## Clarification Test

Before asking the user:

1. Can the repository answer it?
2. Can authoritative documentation answer it?
3. Is one option the established project convention?
4. Is a reversible default safe?
5. Would a prototype answer it more reliably?

Ask only if all answers are no and the alternatives materially affect intent or
risk. Ask one decision at a time in plain language. Present one clearly labeled
recommendation and at most one genuinely safe alternative, explain the
practical consequence, and allow the user to answer "use the recommendation."
If no safe alternative exists, say so rather than manufacturing one.

When an excellent supplied source already resolves the material choices, ask
zero generic questions. When a source conflicts with repository reality, ask
only the smallest product or risk decision needed to resolve that conflict.

## Prototype Trigger

Prototype when uncertainty concerns:

- visual hierarchy or interaction feel;
- workflow state transitions;
- a risky external API behavior;
- performance feasibility;
- an algorithm whose edge behavior is hard to reason about.

Do not prototype when a direct test or documentation lookup can answer the question. Mark prototype code disposable and keep it outside the production path.

## Slice Test

A valid slice:

- produces a user-visible or operator-visible outcome;
- includes all necessary layers for that outcome;
- has one primary verification seam;
- can be reviewed and reverted coherently;
- fits one focused implementation context;
- declares blockers and compatibility requirements.
