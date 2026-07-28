# Work and Evidence Contract

## Repository State

Two portable JSON files survive provider changes:

- `.agent-stack/work-items.json` stores normalized work.
- `.agent-stack/evidence-graph.json` indexes why work is believed complete.

Their JSON Schemas live in `.agent-stack/contracts/`. The protected local CLI
performs the dependency-free validation used by `doctor`.

The repository provider is the default. A future external provider may become
the chosen work surface, but the normalized repository copy remains a fallback
and must be sufficient to continue safely.

## Work Item

Every item has:

- one stable lowercase `id`;
- a plain-language `title` and bounded `objective`;
- one canonical `status`;
- one canonical `priority`;
- testable `acceptance_criteria`;
- included paths and explicit exclusions;
- dependency identifiers;
- evidence-node identifiers;
- bounded external references;
- a UTC update timestamp or `null` for the empty starter ledger.

Canonical statuses:

`backlog | ready | in_progress | blocked | in_review | done | cancelled`

Canonical priorities:

`urgent | high | normal | low`

Provider labels never replace these values. Adapters map their vocabulary to the
contract and fail closed when the mapping is ambiguous.

## Evidence Graph

The graph is a reference index, not a second database and not a substitute for
the referenced artifact.

Canonical node kinds:

`intent | requirement | decision | work_item | file | test | commit |
pull_request | review | release | telemetry | checkpoint`

Canonical node states:

`planned | active | verified | failed | superseded`

Canonical edge relations:

`requires | implements | verifies | reviews | releases | observes | blocks |
depends_on | supersedes`

Every edge must connect existing nodes. Every external node retains only a
provider name, bounded reference, short redacted summary, and state. A link,
status, or provider-generated conclusion is not proof by itself.

Completion evidence points toward the work item it supports:

- implementation `implements` the work item;
- a check `verifies` the work item;
- independent review `reviews` the work item;
- a release `releases` the work item;
- bounded production evidence `observes` the work item.

Every `evidence_refs` entry must have one of those edges to its work item.
Backlog items may remain ledger-only while they are being shaped. Every item
beyond `backlog` requires a matching `work_item` node. Dependency edges
(`depends_on`, `requires`, and `blocks`) and work-item `depends_on` identifiers
are machine-checked and must remain acyclic.

## Completion Rule

A work item may become `done` only when:

1. every acceptance criterion has a concrete evidence path;
2. referenced implementation and tests exist;
3. required checks and review passed for the relevant revision;
4. any unresolved decision or blocker is represented honestly;
5. provider state does not contradict repository evidence.

## Provider Receipt

Every external read or write produces a bounded receipt:

```json
{
  "provider": "reviewed-provider",
  "operation": "bounded-operation",
  "work_item_id": "stable-work-id",
  "provider_reference": "bounded remote identifier",
  "before": "redacted state or null",
  "after": "redacted state or null",
  "authority_source": "repository policy or explicit approval reference",
  "idempotency_key": "stable retry key",
  "performed_at": "ISO-8601 UTC timestamp",
  "result": "succeeded | not-needed | failed | decision-needed"
}
```

Never store an access token, raw response, full comment history, user profile,
attachment, or personal field in a receipt.
