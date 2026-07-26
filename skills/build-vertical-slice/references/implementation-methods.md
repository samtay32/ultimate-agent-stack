# Implementation Methods

## Red-Green Discipline

For behavior changes:

1. choose the public seam agreed in the delivery artifact;
2. add the smallest failing example;
3. confirm the failure represents the missing behavior;
4. implement only enough to pass;
5. refactor while all affected tests are green.

Avoid tests coupled to private call sequences unless behavior cannot be observed otherwise.

## Debugging Discipline

Build one fast, deterministic reproduction matching the user's symptom. Then:

1. minimize the case;
2. list three to five falsifiable hypotheses;
3. instrument one variable;
4. disprove or confirm;
5. fix the root cause;
6. preserve a regression test;
7. remove temporary instrumentation;
8. record a short cause and prevention note when operationally useful.

## Changeability Heuristics

- Prefer a deep module with a small public interface.
- Keep related logic close enough to understand without repository-wide archaeology.
- Introduce an abstraction after two real adapters or variants demonstrate the seam.
- Make side effects explicit.
- Keep retries in the durable orchestration or integration boundary.
- Design deletion: a feature should be removable without untangling unrelated code.

## Migration Discipline

For schema, API, queue, or state changes:

- establish backward-compatible expansion;
- make writes idempotent;
- backfill observably;
- switch reads deliberately;
- verify old/new overlap;
- remove the old path only after evidence and rollback window;
- document data repair and partial-failure behavior.
