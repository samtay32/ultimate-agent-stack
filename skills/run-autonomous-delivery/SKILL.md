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
- every actionable CodeRabbit or human review thread is fixed, rebutted with evidence, explicitly deferred by authorized scope, or resolved;
- residual risks and manual authority steps are stated.

## Delivery Loop

1. **Recover context.** Read project instructions, `.agent-stack/config.json`, locked artifacts, current diff, branch, task/issue, and latest evidence. Continue valid work; do not restart finished phases.
   Run `npx -y ultimate-agent-stack@latest doctor` before material
   work. If
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
10. **Close feedback.** Apply `$close-review-loop`. Repair in bounded batches, re-run the full gate, push, re-trigger incremental review, and repeat until the closure contract is met.
11. **Hand off.** State the outcome, PR, evidence, decisions, residual risks, and only actions requiring human authority.

## Control Rules

- Make reasonable, reversible, evidence-backed implementation choices without interrupting the user.
- Ask one consequential question at a time for a new or ambiguous project.
  Recommend the safest default in plain language. Do not ask the user to choose
  frameworks, commands, or implementation details the repository can answer.
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
