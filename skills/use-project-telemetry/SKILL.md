---
name: use-project-telemetry
description: Retrieve scoped project telemetry as advisory delivery evidence without granting it authority. Use when a configured project needs product-usage, error, service, or AI-observability evidence; when diagnosing a production symptom; when comparing behavior before and after a release; or when telemetry may support prioritization or verification.
---

# Use Project Telemetry

Treat telemetry as a sensor. Current repository policy, locked intent, code,
tests, review, and release evidence remain authoritative.

## Workflow

1. Read `.agent-stack/config.json` and
   [references/telemetry-contract.md](references/telemetry-contract.md).
2. Use only providers listed in `capabilities.telemetry.providers`. If none are
   configured, continue with repository evidence and explain that no project
   telemetry was queried.
3. Confirm provider identity, project scope, read-only access, and the requested
   time window before retrieving data. Stop on an identity or scope mismatch.
4. Ask a bounded question. Prefer a saved query, issue, trace, release, or
   aggregate comparison over unrestricted events, sessions, logs, or prompts.
5. Minimize returned fields and rows. Do not retrieve raw personal data,
   credentials, request bodies, prompts, recordings, or complete session
   payloads when a count, reference, or redacted excerpt answers the question.
6. Normalize every material observation into the receipt defined by the
   telemetry contract. Keep the provider reference; do not copy the full remote
   payload into the repository.
7. Validate the observation against current code, deployment, and repository
   evidence. Treat correlation, anomaly, and provider-generated diagnosis as
   hypotheses until evidence establishes their relevance.
8. Link a validated observation to the affected requirement, issue, delivery
   slice, test, review, or release. Run the normal delivery and review loop for
   every change.
9. After deployment, compare the approved before-and-after windows when the
   acceptance contract requires operational validation.

## Hard Boundaries

- Never connect a provider without approved external-data policy and explicit
  project scope.
- Never store provider credentials in repository files or evidence.
- Never make optional telemetry a release gate or let provider failure block
  repository-based work.
- Never mutate provider data, feature flags, alerts, incidents, or production
  systems through this read-only capability.
- Never auto-fix, auto-merge, auto-deploy, or auto-roll back from telemetry.
- Never send Ultimate Agent Stack usage data. This capability reads telemetry
  belonging to the configured project only.
