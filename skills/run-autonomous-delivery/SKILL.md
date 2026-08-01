---
name: run-autonomous-delivery
description: Orchestrate a software request from raw intent through a verified pull request and review closure. Use for any end-to-end request to build, change, resume, or deliver software, including vague greenfield ideas and elaborate supplied plans; for DISCOVER or EXTERNAL intake, activate develop-project-brief under this controller before shaping. Do not activate for explanation-only questions, requests explicitly limited to brief refinement, source audit, or reconciliation, or requests that forbid repository inspection and changes.
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
   Use campaign mode only when the user approved a multi-item delivery
   objective. Respect its iteration bound, process one selected item at a time,
   and never let campaign advancement trigger provider writes.
   Run `node .agent-stack/bin/agent-stack.mjs doctor` before material work. If
   protected files drifted, proposals remain unresolved, or quality commands
   changed without review, repair setup before proceeding.
2. **Route intake before scale.** Use
   [references/delivery-policy.md](references/delivery-policy.md) and apply the
   first matching route:
   - **RESUME:** a valid non-complete checkpoint exists, or an active locked
     contract has an unmet done or evidence condition. Verify it and continue
     from the first unmet condition. A completed checkpoint and fully satisfied
     lock do not swallow a new request. Do not restart discovery or reopen
     closed decisions.
   - **EXTERNAL:** substantial supplied material defines product intent or an
     existing plan. Apply `$develop-project-brief`; read the source completely,
     preserve it unchanged, audit it, and reconcile it with repository reality.
     A supporting screenshot, log, or attachment for a clear bounded request
     does not select this route.
   - **DISCOVER:** intent is vague, contradictory, explicitly exploratory, or
     is a greenfield product or system idea that needs intent development.
     Apply `$develop-project-brief`; create an early unlocked draft and
     collaborate one consequential question at a time. Clear bounded work
     remains DIRECT even in a new or empty repository.
   - **DIRECT:** the request is clear, bounded, testable, and compatible with
     repository policy. Keep the existing micro-brief or compact shaping path.
     Do not require `BRIEF.md`.
   A request explicitly limited to brief refinement, source audit, or
   reconciliation invokes `$develop-project-brief` directly instead of this
   controller and stops before delivery. Explanation-only work invokes neither
   skill.
3. **Shape, secure, and lock.** For an approved working brief, invoke
   `$shape-project` to promote it into the canonical delivery, architecture,
   security, verification, and decision contracts. Invoke `$shape-project`
   directly for proportionate DIRECT work when needed. If the user requested
   only a brief, stop after its approval without starting implementation.
   Apply `$secure-launch` to classify exposure and derive only applicable
   launch gates. Discover answers from the repository and authoritative
   sources before asking. Read closed product decisions before proposing an
   alternative. After EXTERNAL or DISCOVER promotion, lock all five canonical
   contracts explicitly:

   ```bash
   node .agent-stack/bin/agent-stack.mjs lock \
     --artifact .agent-stack/artifacts/DELIVERY.md \
     --artifact .agent-stack/artifacts/ARCHITECTURE.md \
     --artifact .agent-stack/artifacts/SECURITY.md \
     --artifact .agent-stack/artifacts/VERIFICATION.md \
     --artifact .agent-stack/artifacts/DECISIONS.md
   ```

   For proportionate DIRECT T0/T1 work, the bare `lock` command keeps the
   configured smaller artifact selection.

4. **Choose the execution strategy.** Apply
   `$coordinate-parallel-delivery`. The primary agent decides whether work stays
   serial or uses bounded native subagents, owns every assignment and
   integration, and never makes the user manage workers.
5. **Plan vertical slices.** Each slice must be user-observable or operationally demonstrable, independently verifiable, small enough for one focused context, and explicit about blockers.
6. **Implement.** Own implementation in this controller one slice at a time.
   Preserve the `$build-vertical-slice` quality contract: each slice is
   demonstrable, focused checks pass, the repository remains runnable, and
   docs or migrations stay current. End-to-end delivery does not require a
   nested native activation of that phase skill. A request explicitly limited
   to implementation may invoke `$build-vertical-slice` directly.
7. **Verify.** Own verification in this controller. Run focused checks during
   development and the deterministic full gate before review, and produce the
   `$verify-change` evidence matrix with its binary readiness result.
   End-to-end delivery does not require a nested native activation of that
   phase skill. A request explicitly limited to verification may invoke
   `$verify-change` directly.
8. **Review adversarially.** Review two axes independently:
   - standards: correctness, security, reliability, performance, maintainability, operations;
   - intent: acceptance criteria, non-goals, UX, migrations, documentation, compatibility.
   This independent pre-PR review does not activate `$close-review-loop`.
   It is complete only after a real separate reviewer returns an inspectable
   result for the exact commit. Primary-agent self-review is not independent.
   If reviewer dispatch or result collection fails, preserve the tested work,
   keep review and PR readiness blocked, and report the limitation without
   manufacturing approval evidence.
9. **Open or update the PR.** Use a draft while material work remains. Include intent, decisions, test evidence, migration/rollback notes, screenshots or recordings when visual behavior changed, and known risks.
10. **Close feedback.** Apply `$close-review-loop` with the configured review
    provider only for an existing pull request or an external provider or human
    review thread. Repair in bounded batches, re-run the full gate, push,
    re-trigger review when the provider supports it, and repeat until the
    closure contract is met.
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
- A question asking the user to accept a recommendation ends the turn. Never
  continue as if the agent's own recommendation were approval.
- A prior explicit instruction such as "use the recommendation" is approval for
  that recommendation and should not trigger the same question again.
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
- Preserve user-supplied sources unchanged. Persist only bounded redacted
  provenance and claim dispositions unless a repository copy is both needed
  and authorized.
- Artifact status is only `DRAFT` or `APPROVED`; lock state exists only in the
  protected CLI state. A rejected guard does not authorize editing its
  prerequisites. Claims that something was added, fully read, reviewed,
  locked, or made ready require the corresponding path and command/result
  evidence.
- Keep work-item and evidence-graph references current at verified transitions;
  do not copy remote payloads into repository state.
- Never give the coordinator token to a subagent. A subagent is a bounded
  worker behind the Project Steward, not another coordinator.
