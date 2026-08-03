---
name: verify-change
description: Prove a software change satisfies its acceptance contract with deterministic checks and risk-based evidence. Use after implementation, before a pull request, after review fixes, or when diagnosing whether a change is actually production-ready.
---

# Verify Change

Evidence, not confidence, decides readiness.

## Verification Procedure

1. Read the locked intent, canonical closed decisions in
   `.agent-stack/artifacts/DECISIONS.md`, diff, configured checks, deployment
   surface, `.agent-stack/artifacts/SECURITY.md`, and prior evidence. Verify the
   implementation preserved each governing closed decision or followed an
   audited unlock/change/relock record.
2. Build a requirement-to-evidence matrix using [references/verification-matrix.md](references/verification-matrix.md).
   Apply `$secure-launch` when any classified security surface applies or
   remains unknown.
3. Run the narrowest feedback loop first. When diagnosing, reproduce the exact symptom before changing code.
4. Run the complete deterministic gate:

   ```bash
   node .agent-stack/bin/agent-stack.mjs check-lock
   node .agent-stack/bin/agent-stack.mjs verify
   ```

   Keep the resulting bounded receipts through the current checkpoint and
   handoff. Do not delete evidence merely because a duplicate `latest.json`
   summary exists.

5. Perform independent reviews:
   - **standards:** correctness, data loss, security, privacy, concurrency, performance, reliability, observability, maintainability;
   - **intent:** every requirement, non-goal, compatibility promise, migration, UX state, and operational outcome.
   A local reviewer result may be retained as structured `agent-recorded` audit
   evidence for the exact commit, but it cannot prove distinct delegation or
   satisfy independent review. Failed spawn, empty wait, missing result,
   self-review, or handwritten approval prose is a blocker; so is every local
   passed receipt for the mechanical independence gate. `review status --run
   RUN` therefore remains blocked for local receipts. Only the protected GitHub
   review receipt establishes mechanical independence; keep that path separate.
   Distinct physical-agent provenance remains unauthenticated.
6. For visual changes, inspect rendered output at meaningful sizes and include screenshots or recordings.
7. For integrations, test timeouts, malformed input, retries, idempotency, partial failure, and authentication boundaries where applicable.
8. Classify every failure:
   - introduced by this change: fix before proceeding;
   - pre-existing and proven on the base revision: record separately; fix if necessary for safe delivery;
   - flaky: reproduce and stabilize or quarantine only under an existing documented policy.
9. Re-run the affected check after every fix and the full gate after the batch.

## Forbidden Shortcuts

- deleting or loosening a test because it fails;
- replacing a real check with a mock that cannot detect the regression;
- ignoring a failure because the diff is small;
- treating build success as behavior proof;
- declaring a warning "pre-existing" without base-revision evidence;
- relying on an LLM reviewer as the sole correctness gate;
- silently skipping unavailable tools.
- claiming a test was added, a review was closed, or an artifact was locked
  without matching repository and command evidence.
- using free-form model text, an expected skill name, or an unsupported
  activation string in place of receipt-derived status;
- exceeding the portable live-evaluation prompt budget: request plus context
  must stay at or below 2 KiB (target about 512 input tokens), without repository
  dumps or expected skill names.

## Exit Contract

Return:

- evidence file path;
- checks executed and results;
- acceptance criteria covered;
- review findings and dispositions;
- untested surfaces and why;
- rollback or monitoring evidence when applicable;
- a binary ready/not-ready decision.

If evidence is incomplete, the change is not ready.
