---
name: run-autonomous-delivery
description: Orchestrate a software request from raw intent through a verified pull request and review closure. Use for any end-to-end request to build, change, resume, or deliver software, including vague greenfield ideas and elaborate supplied plans; for DISCOVER or EXTERNAL intake, activate develop-project-brief under this controller before shaping. Do not activate for explanation-only questions, requests explicitly limited to brief refinement, source audit, or reconciliation, or requests that forbid repository inspection and changes.
---

# Run Autonomous Delivery

Own the delivery loop. Keep the human at intent and authority boundaries, not
in routine engineering. Read [Delivery Policy](references/delivery-policy.md)
for tiers, authority, durable state, recovery, and convergence. Load each later
phase skill and reference only when that phase becomes the immediate next step.
This controller owns routine implementation and verification.

## Done means

Acceptance and locked intent agree; code, docs, focused checks, and the full
gate agree; a real separate reviewer returned an inspectable exact-commit
result; the PR is current and required CI/protections pass; review feedback has
a canonical disposition; residual risks and human-only actions are stated.

## Delivery loop

1. **Recover ownership.** Enter through `start` and retain its coordinator token.
   Never write against another active steward. Read project instructions,
   config, a valid checkpoint, branch, and diff. Read locked artifacts and
   evidence only when needed. Run the pinned local
   `node .agent-stack/bin/agent-stack.mjs doctor`; never use `npx` or mutable
   latest code. Repair setup drift before material work.

2. **Route intake** using the first match: **RESUME** a non-complete checkpoint
   or active lock with an unmet done or evidence condition; **EXTERNAL** when
   substantial supplied material defines intent; **DISCOVER** vague,
   contradictory, exploratory, or greenfield intent; otherwise **DIRECT** clear
   bounded testable work. A supporting screenshot, log, or attachment does not
   change clear work to EXTERNAL, and clear bounded work remains DIRECT in a new
   repository. Completed state does not hijack a new request.

   EXTERNAL and DISCOVER apply `$develop-project-brief`; preserve supplied
   sources and reconcile them with repository reality. A request explicitly
   limited to brief refinement, source audit, or reconciliation invokes that
   skill directly and stops before delivery. Explanation-only work invokes
   neither. DIRECT uses a proportionate micro-brief and needs no BRIEF.

   For vague DISCOVER, read only this controller, the brief skill, and
   `../develop-project-brief/references/brief-contract.md`; create and validate
   the DRAFT, record the controller and brief activation receipts using the
   exact recipe in `AGENTS.md`, ask one consequential question, and end the
   turn. Do not inspect CLI source or help. Do not checkpoint or run
   activation/readiness status, print a full diff, or re-read receipt output. Use only
   `git diff --check` and concise `git status --short` if needed. Keep DISCOVER
   serial; optional provider, knowledge, telemetry, work, and parallel skills
   load only when the selected route's immediate next decision needs them.

3. **Shape and secure.** Use `$shape-project` and its
   [shaping contract](../shape-project/references/shaping-contract.md) for an
   approved EXTERNAL/DISCOVER brief or proportionate DIRECT T2+ work. On any
   intake route, apply `$secure-launch` and its
   [security readiness](../secure-launch/references/security-readiness.md) when
   work touches authentication, uploads, personal data, paid APIs, deployment,
   or other material exposure. Record it as not applicable only for offline or
   no-exposure work.
   Artifact status is only `DRAFT` or `APPROVED`; lock state is protected CLI
   state.
   A failed or rejected guard never authorizes editing prerequisites. For
   promoted EXTERNAL/DISCOVER work, lock all five contracts explicitly:

   ```bash
   node .agent-stack/bin/agent-stack.mjs lock \
     --artifact .agent-stack/artifacts/DELIVERY.md \
     --artifact .agent-stack/artifacts/ARCHITECTURE.md \
     --artifact .agent-stack/artifacts/SECURITY.md \
     --artifact .agent-stack/artifacts/VERIFICATION.md \
     --artifact .agent-stack/artifacts/DECISIONS.md
   ```

   DIRECT T0/T1 work uses the configured smaller bare `lock` selection.

4. **Plan and implement vertical slices.** Apply
   `$coordinate-parallel-delivery` only after routing when two independent
   immediate tracks justify it; follow its
   [delegation contract](../coordinate-parallel-delivery/references/delegation-contract.md).
   The primary remains coordinator and integrator. Otherwise stay serial.
   Implement one demonstrable slice at a time, keep the repository runnable,
   and update tests, docs, and migrations. A request explicitly limited to
   implementation may invoke `$build-vertical-slice`; end-to-end delivery does not
   require its nested native activation.

5. **Verify.** Run focused checks, then the deterministic full gate. Produce the
   `$verify-change`
   [evidence matrix](../verify-change/references/verification-matrix.md) and
   binary readiness result. A request explicitly limited to verification may
   invoke `$verify-change`; end-to-end delivery does not require its nested
   native activation. Missing or skipped required checks fail.

6. **Review adversarially.** Review correctness/security/reliability and
   intent/acceptance/compatibility. After tests and an exact clean local commit,
   a locally authorized delivery may attempt one native bounded read-only
   reviewer in a fresh/no-history or demonstrably sanitized session without the
   coordinator token; apply `AGENTS.md` assignment/exclusion rules. If
   capability, dispatch/collection, or isolation is absent, failed, or
   unverifiable, record `review unavailable`; never fabricate. A local result
   is agent-recorded audit evidence only: record the returned reviewer ID/result
   bound to the commit, but it cannot establish independent review or PR
   readiness. Only protected GitHub review establishes that mechanical gate.
   Check `review status --run RUN`; `status --run RUN` remains blocked when the
   selected policy requires external review.

7. **PR and feedback.** Keep a draft while material work remains. Include
   intent, decisions, evidence, migration/rollback notes, visual proof when
   applicable, and risks. Apply `$close-review-loop` only for an existing pull request
   or provider/human review thread, using its
   [Review Closure Policy](../close-review-loop/references/review-closure-policy.md).
   Validate claims, repair bounded batches, run the full gate, push, and repeat.

8. **Checkpoint and hand off.** At verified milestones, checkpoint concise
   decisions, completed work, next steps, blockers, and existing evidence
   paths—not raw chat. After the final gate, preserve only redacted verified
   durable learning when useful. Release the lease and report outcome, PR,
   evidence, risks, and human-only actions.

## Control rules

- Make reversible evidence-backed choices without interruption. Ask one
  consequential question at a time. Recommend one safe default, offer at most
  one genuinely safe alternative, explain the practical consequence, then ask
  and end the turn. A question asking the user to accept a
  recommendation ends the turn; a prior explicit instruction such as "use the
  recommendation" is approval and should not trigger the same question again.
- Pause before destructive, irreversible, credential, financial, deployment,
  merge, release, or publication action unless explicitly authorized.
- Never weaken tests, security, permissions, or acceptance criteria, hide
  pre-existing failures, or claim evidence that does not exist.
- Preserve supplied sources unchanged and locked decisions unless the product
  owner authorizes the audited unlock/change/relock path.
- Never give the coordinator token to a subagent. Delegation is bounded,
  non-recursive, authority-preserving, isolated for writes, and verified by the
  primary. Fall back to serial work if any condition is unavailable.
- Each repair loop must produce new evidence and reduce findings. Stop after
  five non-converging loops and report the blocker.
- Keep live evaluation prompts and serialized context at or below 2 KiB
  (target about 512 input tokens). Do not include repository dumps or expected
  skill names. Paid live tests are outside deterministic package validation.
- Stack enforcement covers stack-generated status, evidence, evaluation, and
  readiness artifacts—not arbitrary model statements or untrusted project code.
