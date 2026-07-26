# Review Closure Policy

## Finding Threshold

Fix by default:

- all Critical and Major findings;
- Minor findings affecting correctness, security, privacy, reliability, data integrity, API/schema compatibility, accessibility, observability, deployment safety, or required test coverage;
- repeated low-severity findings that reveal one systemic cause.

Rebut or defer with evidence:

- false positives contradicted by code, tests, or authoritative docs;
- style-only, preference-only, or speculative refactors outside repository standards;
- duplicate findings closed by the same change;
- generated, vendored, or intentionally frozen code;
- valid adjacent improvements outside locked scope, only when current delivery remains safe.

Never silently ignore a finding. Severity labels inform triage; they do not override evidence.

## Response Format

```text
Disposition: fixed | rebutted | deferred | decision-needed
Evidence: <commit, test, code location, documentation, or issue>
Reason: <one concise explanation>
Risk: <remaining risk or none>
```

## CodeRabbit Commands

- `@coderabbitai review`: incremental review after a verified fix batch.
- `@coderabbitai full review`: full review after a major rebase, large rewrite, or uncertain coverage.
- `@coderabbitai pause` / `@coderabbitai resume`: control automatic reviews during noisy intermediate work.
- `@coderabbitai resolve`: resolve CodeRabbit's open threads only after verifying closure.
- `@coderabbitai approve`: resolve CodeRabbit threads and approve only when request-changes workflow is enabled and all actionable issues are closed.

Check current CodeRabbit documentation before relying on command semantics; integrations evolve.

## Production-Grade Closure

"Zero issues" means zero unresolved **actionable production risk**, not zero comments. A PR can close with informational or preference suggestions only when each has an explicit evidence-backed disposition.

Required independent gates remain:

- local deterministic verification;
- repository CI/status checks;
- branch protection and required human review;
- conversation resolution;
- final-revision evidence.

CodeRabbit cannot waive repository policy or authorize merge.
