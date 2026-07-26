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

## Provider Selection

Read `.agent-stack/config.json`. Use only the selected review provider. Built-in
review remains part of delivery but cannot satisfy a production profile's
external-review requirement.

## Production-Grade Closure

"Zero issues" means zero unresolved **actionable production risk**, not zero comments. A PR can close with informational or preference suggestions only when each has an explicit evidence-backed disposition.

Required independent gates remain:

- local deterministic verification;
- repository CI/status checks;
- branch protection and required human review;
- conversation resolution;
- final-revision evidence.

No review provider can waive repository policy or authorize merge.

An actual qualifying review submission tied to the current PR head is required
when configuration requires external review. A walkthrough, summary, reaction,
successful status, chat response, or rate-limit/quota message is not review
evidence. Every fix push invalidates the previous receipt and requires a fresh
provider review.
