# Verification Matrix

Create a compact table before the final gate:

| Requirement or risk | Evidence type | Command or artifact | Expected | Result |
|---|---|---|---|---|
| CAP-1 | Automated behavior test | exact command | observable outcome | pending/pass/fail |
| Compatibility | Contract/migration test | exact command | old and new interoperate | pending/pass/fail |
| Security boundary | Negative test/review | command or threat note | unauthorized path denied | pending/pass/fail |
| Operations | Runbook/telemetry check | artifact | failure visible and reversible | pending/pass/fail |

## Evidence by Change Type

- API: contract tests, malformed input, authentication, authorization, rate/timeout behavior.
- Data: constraints, migrations, backfill, idempotency, rollback, representative volume.
- UI: functional tests, keyboard and screen-reader semantics, responsive/empty/loading/error states, screenshots.
- Worker/queue: retry, timeout, duplicate delivery, cancellation, partial failure.
- Performance: representative benchmark with baseline and threshold.
- Security: trust-boundary review plus negative tests.
- Documentation/config: link/schema validation and a clean-environment smoke test.

## Evidence Strength

Prefer, in order:

1. deterministic automated test at the public seam;
2. reproducible integration or end-to-end command;
3. static analysis or schema validation;
4. rendered visual inspection;
5. manual reproduction with exact steps;
6. reasoned review.

Lower-strength evidence cannot replace a practical higher-strength check without an explicit reason.

## Readiness

Use `READY` only when every required row passes. Use `NEEDS WORK` for fixable missing or failing evidence. Use `BLOCKED` only for an external dependency or authority decision that the agent cannot obtain or safely assume.
