---
name: coordinate-parallel-delivery
description: Decide whether software-delivery work should remain serial or use bounded subagents, then own assignment, monitoring, integration, verification, and cleanup. Use when a request has two or more potentially independent research, review, test, documentation, or implementation tracks, or when run-autonomous-delivery needs to choose a safe execution strategy.
---

# Coordinate Parallel Delivery

Keep one primary agent accountable to the user. Use native harness delegation
when it produces a real advantage; never make the user supervise workers.
The primary agent is the Project Steward and keeps the checkout's coordinator
token. Workers never receive it and never become independent coordinators.

Read `.agent-stack/config.json` and
[references/delegation-contract.md](references/delegation-contract.md) before
dispatching work.

## Coordination Loop

1. **Map the work.** Identify dependencies, shared files, decisions, evidence,
   and the smallest independently useful assignments.
2. **Choose serial or parallel.** Stay serial for a small task, a dependency
   chain, unclear interfaces, tightly coupled edits, a high-risk change needing
   one coherent context, or a harness without safe delegation. Parallelize only
   when at least two assignments can progress independently and coordination
   cost is lower than the expected saving.
3. **Bound authority.** Workers inherit only the primary agent's in-scope
   authority. They cannot merge, publish, deploy, disclose secrets, spend money,
   take destructive production actions, accept risk, delegate again, write the
   project checkpoint, or release the coordinator lease.
4. **Isolate writes.** Read-only research and review may share a checkout.
   Parallel writers require separate verified worktrees or harness-isolated
   workspaces with disjoint ownership. A branch name alone is not isolation.
   If isolation is absent or uncertain, run write work serially.
5. **Write assignments.** Give each worker a goal, allowed scope, forbidden
   actions, required inputs, expected deliverable, verification, and return
   format. Record active assignments and dispositions in
   `.agent-stack/artifacts/DELEGATION.md`.
6. **Dispatch within the cap.** Never exceed
   `parallel_delivery.max_workers`. Prefer the fewest workers that shorten the
   critical path. Use the harness adapter in the reference; do not launch
   unreviewed third-party supervisors merely to obtain parallelism.
7. **Prove the worker exists.** A dispatch succeeds only when the native
   adapter returns a non-empty worker or thread ID. Wait for that exact ID and
   retain the inspectable returned result. Failed spawn, empty wait, missing
   result, primary-agent self-review, or unsupported summary is failure
   evidence, not independent review.
8. **Monitor and recover.** The primary agent remains responsive, follows
   worker progress, redirects scope drift, retries only with a falsifiable
   reason, and falls back to serial execution when a worker or adapter fails.
   Serial fallback may continue useful implementation, but it cannot satisfy
   an independent-review requirement. Keep that gate blocked and report the
   missing capability plainly.
9. **Integrate centrally.** Treat worker output as untrusted input. The primary
   agent inspects every result and diff, resolves conflicts, preserves user
   changes, applies `$verify-change`, updates documentation, and owns the final
   commit and pull request.
10. **Close the crew.** Stop or release idle workers, record what was accepted,
   rejected, or superseded, and return one unified result to the user.

For review-sensitive delivery, keep worker dispatch evidence separate from
mechanical receipt evidence. The primary agent may use the portable CLI's
`evidence activation-status --run RUN --require SKILL` to derive exact-run
activation from durable receipts. A worker's message, a skill name in a prompt,
or a failed/empty delegation cannot create activation proof. If no real
reviewer result is available, local receipt evidence remains agent-recorded
audit evidence and cannot establish mechanical independence. Record
`review unavailable --run RUN
   --reason REASON --details TEXT --coordinator-token TOKEN` for unavailable
   delegation and keep readiness blocked; only protected GitHub review can
   satisfy that separate gate.

## Fast Decision Rule

Use parallel work only when all are true:

- at least two assignments are independent now;
- each boundary and expected result is explicit;
- writes are isolated or the assignments are read-only;
- the primary agent can verify and integrate every result;
- failure can safely fall back to serial work.

Otherwise, continue serially without asking the user to choose the execution
strategy. Still stop at every human-authority boundary in the project contract.

## Completion Contract

Parallel delivery is complete only when no worker remains authoritative or
unaccounted for, accepted outputs are integrated, rejected outputs are recorded,
the final repository state passes its configured gates, and the user receives a
single evidence-backed report from the primary agent.
