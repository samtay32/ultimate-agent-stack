# Delivery Policy

## Intake Router

Apply the first matching route. Origin length is not a router signal by itself.

| Route | Evidence | Action |
|---|---|---|
| RESUME | Valid non-complete checkpoint or active lock with an unmet done or evidence condition | Verify state and continue the first unmet condition without reopening closed decisions |
| EXTERNAL | Substantial supplied material defines product intent or an existing plan | Apply `develop-project-brief`; preserve, audit, and reconcile the source |
| DISCOVER | Vague, contradictory, or explicitly exploratory intent, including a greenfield product or system idea that needs intent development | Apply `develop-project-brief`; write an early DRAFT and ask one consequential question at a time |
| DIRECT | Clear, bounded, testable request compatible with repository policy | Use the existing micro-brief or compact shaping path; no BRIEF is required |

A completed checkpoint and a fully satisfied active lock do not hijack a new
request. A supporting screenshot, log, or attachment for an otherwise clear
bounded request does not make it EXTERNAL, and clear bounded work remains DIRECT
in a new or empty repository. A new request that conflicts with an active lock
is a proposed locked-intent change: surface it, record authority, unlock with an
audit reason when authorized, and reshape.

## Execution Skill Routing

`run-autonomous-delivery` is the required controller activation for end-to-end
delivery and RESUME. The controller owns implementation and verification
quality gates, so an otherwise correct end-to-end run does not require nested
native activation of `$build-vertical-slice` or `$verify-change`. Those skills
remain available as direct entry points when a request is explicitly limited to
implementation or verification, respectively.

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

- `BRIEF.md`: optional unlocked EXTERNAL/DISCOVER source and audit record;
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
Do not reopen a closed product decision merely because a new conversation began.

## Bounded Convergence

Each repair cycle must:

1. identify a falsifiable cause;
2. change one coherent cause or batch;
3. produce new test/review evidence;
4. reduce the open actionable set.

After five cycles without measurable progress, stop the loop, preserve work, and report the blocking decision or external dependency.
