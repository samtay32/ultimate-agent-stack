---
name: verify-change
description: Prove a software change satisfies its acceptance contract with deterministic checks and risk-based evidence. Use after implementation, before a pull request, after review fixes, or when diagnosing whether a change is actually production-ready.
---

# Verify Change

Evidence, not confidence, decides readiness.

## Verification Procedure

1. Read the locked intent, diff, configured checks, deployment surface,
   `.agent-stack/artifacts/SECURITY.md`, and prior evidence.
2. Build a requirement-to-evidence matrix using [references/verification-matrix.md](references/verification-matrix.md).
   Apply `$secure-launch` when any classified security surface applies or
   remains unknown.
3. Run the narrowest feedback loop first. When diagnosing, reproduce the exact symptom before changing code.
4. Run the complete deterministic gate:

   ```bash
   node .agent-stack/bin/agent-stack.mjs check-lock
   node .agent-stack/bin/agent-stack.mjs verify
   ```

5. Perform independent reviews:
   - **standards:** correctness, data loss, security, privacy, concurrency, performance, reliability, observability, maintainability;
   - **intent:** every requirement, non-goal, compatibility promise, migration, UX state, and operational outcome.
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
