---
name: run-autonomous-delivery
description: Orchestrate a software request from raw intent through a verified pull request and review closure. Use explicitly for end-to-end autonomous delivery of a product, feature, bug fix, refactor, migration, or documentation change after the repository has the Ultimate Agent Stack.
---

# Run Autonomous Delivery

Own the execution loop. Keep the human at the intent and authority boundaries, not in the middle of routine engineering.

## Definition of Done

Do not say "done" until all applicable conditions hold:

- the acceptance contract is satisfied;
- locked intent has not drifted;
- implementation and documentation agree;
- focused and full required checks pass;
- the diff has been reviewed independently from correctness and intent perspectives;
- the pull request is current with its base;
- required CI and GitHub protections pass;
- every actionable configured-provider or human review thread is fixed, rebutted with evidence, explicitly deferred by authorized scope, or resolved;
- residual risks and manual authority steps are stated.

## Delivery Loop

1. **Recover context and ownership.** Enter through `start`, or use the
   coordinator token returned by the `start` command that invoked this skill.
   If another active Project Steward owns the checkout, do not write from this
   conversation. Read project instructions, `.agent-stack/config.json`, any
   valid `.agent-stack/CHECKPOINT.md`, locked artifacts, current diff, branch,
   task/issue, and latest evidence. Apply
   `$use-project-knowledge` with the configured provider. Continue valid work;
   do not restart finished phases.
   If scoped project telemetry is configured and the request concerns
   production behavior, apply `$use-project-telemetry`. Keep access read-only
   and retain only a bounded observation receipt. Telemetry is advisory and
   cannot authorize a change or weaken repository verification.
   Apply `$manage-project-work` using the configured work provider. Validate the
   portable repository ledger and evidence graph, select only ready, bounded
   work, and tie completion to actual acceptance evidence rather than a
   provider status.
   Run `node .agent-stack/bin/agent-stack.mjs doctor` before material work. If
   protected files drifted, proposals remain unresolved, or quality commands
   changed without review, repair setup before proceeding.
2. **Route by scale.** Use [references/delivery-policy.md](references/delivery-policy.md). Small clear work gets a micro-brief. New systems, migrations, ambiguous UX, and high-risk changes get proportionate shaping.
3. **Shape, secure, and lock.** Invoke `$shape-project` when intent or
   acceptance is not already locked. Apply `$secure-launch` to classify
   exposure and derive only applicable launch gates. Discover answers from the
   repository and authoritative sources before asking. Lock with:

   ```bash
   node .agent-stack/bin/agent-stack.mjs lock
   ```

4. **Choose the execution strategy.** Apply
   `$coordinate-parallel-delivery`. The primary agent decides whether work stays
   serial or uses bounded native subagents, owns every assignment and
   integration, and never makes the user manage workers.
5. **Plan vertical slices.** Each slice must be user-observable or operationally demonstrable, independently verifiable, small enough for one focused context, and explicit about blockers.
6. **Implement.** Apply `$build-vertical-slice` one slice at a time. Keep the repository runnable. Do not mix unrelated cleanup into the change.
7. **Verify.** Apply `$verify-change`; run focused checks during development and the deterministic full gate before review.
8. **Review adversarially.** Review two axes independently:
   - standards: correctness, security, reliability, performance, maintainability, operations;
   - intent: acceptance criteria, non-goals, UX, migrations, documentation, compatibility.
9. **Open or update the PR.** Use a draft while material work remains. Include intent, decisions, test evidence, migration/rollback notes, screenshots or recordings when visual behavior changed, and known risks.
10. **Close feedback.** Apply `$close-review-loop` with the configured review
    provider. Repair in bounded batches, re-run the full gate, push, re-trigger
    review when the provider supports it, and repeat until the closure contract
    is met.
11. **Checkpoint and preserve learning.** After verified milestones, use
    `checkpoint --coordinator-token TOKEN` to record the objective, concise
    summary, completed work, decisions, next steps, blockers, and existing
    evidence paths. This repository handoff—not raw chat—is the continuity
    record. Apply `$use-project-knowledge` after the final gate.
    Capture only redacted, provenance-backed verified learning. Record reusable
    procedures as non-executable skill candidates.
12. **Hand off.** Write the completed checkpoint, release the coordinator
    lease, then state the outcome, PR, evidence, decisions, residual risks, and
    only actions requiring human authority.

Before any destructive, irreversible, credential, financial, deployment,
merge, or publication action, pause and obtain explicit human confirmation.
The answer "use the recommendation" never authorizes one of these high-impact
operations.

## Control Rules

- Make reasonable, reversible, evidence-backed implementation choices without interrupting the user.
- Ask one consequential question at a time for a new or ambiguous project.
  Recommend the safest default in plain language, provide at most one genuinely
  safe alternative when useful, explain the consequence, and accept "use the
  recommendation." Do not ask the user to choose frameworks, commands, or
  implementation details the repository can answer.
- A non-technical instruction does not authorize weakening checks, security,
  data safety, architecture constraints, or release controls. Preserve the
  requested outcome through a safe mechanism.
- One repair loop must produce new evidence. Stop after five non-converging repair loops and report the smallest blocking decision with attempted remedies.
- Never weaken tests, checks, permissions, or acceptance criteria to manufacture green.
- Never hide pre-existing failures. Prove they predate the change and record them separately.
- Let `$coordinate-parallel-delivery` choose the strategy. Parallel work is
  bounded, non-recursive, authority-preserving, isolated for writes, and always
  integrated by the primary agent. Fall back to serial work when any condition
  is unavailable.
- Treat tokens, elapsed time, and tool calls as costs. Optimize verified outcomes, not agent activity.
- Persist decisions and evidence in the repository so a fresh session can resume.
- Keep work-item and evidence-graph references current at verified transitions;
  do not copy remote payloads into repository state.
- Never give the coordinator token to a subagent. A subagent is a bounded
  worker behind the Project Steward, not another coordinator.
