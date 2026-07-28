# Telemetry Contract

## Roles

A project may configure more than one provider because the roles are
complementary:

| Role | Question |
|---|---|
| `product` | What are users doing and where do workflows fail? |
| `errors` | Which production exceptions or regressions are occurring? |
| `service` | Why is an application slow, unavailable, or unhealthy? |
| `ai` | Which model, retrieval, prompt, or tool step failed? |

OpenTelemetry is a vendor-neutral instrumentation and transport boundary, not
the repository source of truth. Querying a backend still requires a reviewed
provider adapter. Every adapter covered by this contract is read-only.

## Observation Receipt

Retain only a bounded normalized receipt:

```json
{
  "provider": "reviewed-provider-name",
  "role": "product | errors | service | ai",
  "scope": {
    "organization": "non-secret stable identifier",
    "project": "non-secret stable identifier"
  },
  "question": "bounded question answered",
  "window": {
    "start": "ISO-8601 timestamp or release reference",
    "end": "ISO-8601 timestamp or release reference"
  },
  "summary": "redacted factual observation",
  "source_reference": "saved query, issue, trace, or dashboard identifier",
  "retrieved_at": "ISO-8601 timestamp",
  "limitations": ["sampling, missing data, ambiguity, or known bias"],
  "repository_validation": ["path, test, commit, PR, or release evidence"],
  "disposition": "confirmed | contradicted | decision-needed"
}
```

Do not place authentication material, raw events, recordings, full stack-trace
payloads, user identifiers, prompts, or session transcripts in the receipt.

## Evidence Rules

- A provider-generated explanation is not proof.
- An increase after a release is not automatically caused by that release.
- A missing event may mean missing instrumentation rather than missing user
  behavior.
- Aggregate evidence should disclose its time window, filters, sampling, and
  comparison baseline.
- A fix is complete only when repository verification and the configured
  delivery gates pass. Post-release telemetry is additional evidence when the
  acceptance contract requires it.

## Failure and Rollback

When a provider is unavailable, unauthorized, out of scope, malformed, or too
broad:

1. record no remote payload;
2. explain the bounded failure;
3. continue with repository evidence;
4. never switch providers or broaden scope silently;
5. remove the provider through a reviewed configuration change if rollback is
   required.
