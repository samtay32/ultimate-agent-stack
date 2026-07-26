# Delivery Policy

## Scale Router

| Tier | Typical work | Required shaping |
|---|---|---|
| T0 | Explanation, typo, comments, no behavior change | Goal, files, done condition |
| T1 | Clear bug, chore, small refactor, bounded docs | Micro-brief: outcome, constraints, acceptance, non-goals |
| T2 | Bounded feature or integration | Compact PRD, architecture spine, vertical slices, verification matrix |
| T3 | New product/system, migration, ambiguous UX, multi-service change | Full PRD, targeted research, prototype when useful, architecture decisions, rollout/rollback, readiness review |
| T4 | Safety-critical, regulated, irreversible, material financial or privacy risk | T3 plus named human/specialist approvals; the agent prepares evidence but cannot self-authorize |

Escalate a tier when failure cost, ambiguity, blast radius, reversibility, or external coupling increases. Ceremony follows risk, not line count.

## Authority Model

Agent-owned:

- repository discovery;
- routine assumptions that are reversible and consistent with existing policy;
- design alternatives and recommendations;
- implementation, tests, docs, migrations, local checks, and repair loops;
- branch, commit, push, and PR actions when the user asked for end-to-end delivery and repository policy allows them;
- evidence collection and reviewer responses.

Human-owned unless pre-authorized:

- product choices with materially different user outcomes;
- production credentials or secret disclosure;
- purchases and billing;
- legal, compliance, licensing, or policy acceptance;
- destructive production/data actions;
- public release or merge when policy requires approval;
- accepting material residual risk.

## Durable State

Use repository artifacts rather than chat memory:

- `DELIVERY.md`: current locked outcome and acceptance;
- `ARCHITECTURE.md`: binding decisions only;
- `DECISIONS.md`: dated changes and reasons;
- `VERIFICATION.md`: requirement-to-evidence matrix;
- `.agent-stack/state.json`: hashes and machine state;
- `.agent-stack/runs/`: bounded check evidence.

## Recovery

On a resumed session:

1. read instructions and state;
2. inspect git branch, diff, recent commits, PR, and evidence;
3. verify artifact lock;
4. identify the first unmet done condition;
5. continue there.

Do not redo completed work merely because conversational history is unavailable.

## Bounded Convergence

Each repair cycle must:

1. identify a falsifiable cause;
2. change one coherent cause or batch;
3. produce new test/review evidence;
4. reduce the open actionable set.

After five cycles without measurable progress, stop the loop, preserve work, and report the blocking decision or external dependency.
