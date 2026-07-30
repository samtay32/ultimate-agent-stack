# Independent Pre-PR Review

Status: DRAFT
Material open conflicts: YES

## Scope

- Assignment ID:
- Work item ID:
- Delivery baseline:
- Base revision:
- Reviewed revision:
- Review receipt:

## Standards Axis

Pending an independent reviewer result.

## Intent Axis

Pending an independent reviewer result.

## Provenance Gate

Files under `.agent-stack/review-receipts/` are unsigned project-authored
candidates, not authenticated worker proof. This artifact may become `APPROVED`
only after a trusted outer collector validates the actual separate-reviewer
spawn, wait, and returned result, accepts the exact candidate named above, and
the candidate is linked from a verified review node to the exact work item.
The delivery baseline must be
`.agent-stack/artifacts/DELIVERY.md@<Base revision>`. A failed spawn, missing
worker ID, empty wait, self-review, unverifiable summary, or missing trusted
outer attestation leaves this artifact `DRAFT`.
