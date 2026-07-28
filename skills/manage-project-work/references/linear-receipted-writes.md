# Linear Receipted Writes

Linear writes are optional and disabled by default. The repository ledger is
still the portable work contract and the evidence graph still determines what
is believed complete.

## Allowed Operations

Only these reviewed operations may be enabled:

- `issue_create`: create one Linear issue from one validated repository work
  item.
- `evidence_comment`: add a generated, bounded evidence summary to an already
  linked Linear issue.

The adapter does not expose arbitrary GraphQL, issue editing, status changes,
assignment, deletion, archiving, projects, cycles, labels, attachments, or
administrative mutations.

## Required Authority

Every write requires all of the following:

1. Linear is the approved work provider.
2. The exact operation is enabled in approved project configuration.
3. The external-data policy is `approved_providers`.
4. The active Project Steward supplies its current coordinator token.
5. The caller supplies `--confirm-external-write`.
6. The caller records a bounded `--authority-source` that identifies the human
   approval or repository policy authorizing this write.
7. The work ledger and evidence graph validate before the request.

Provider access never grants delivery, merge, deployment, or release authority.

## Least-Privilege Credentials

Keep three credentials separate:

- `LINEAR_API_KEY`: Read permission, restricted to approved teams.
- `LINEAR_CREATE_API_KEY`: Create issues permission, restricted to approved
  teams.
- `LINEAR_COMMENT_API_KEY`: Create comments permission, restricted to approved
  teams.

Create only the credentials needed for the enabled operations. Never grant
general Write or Admin permission to these adapters. Credentials stay in the
process environment and never enter configuration, arguments, receipts,
checkpoints, or evidence.

## Idempotency and Recovery

The repository stores a random, non-secret idempotency namespace in approved
configuration. The adapter combines it with the work item and operation to
derive stable UUIDs for Linear issue and comment creation.

Before creating an issue, the read-only adapter checks for that UUID. After an
ambiguous timeout or failure, it checks again. A retry therefore reconciles the
same provider object instead of creating a duplicate.

Evidence-comment UUIDs also include the validated evidence snapshot. Repeating
the same evidence is a no-op; changed evidence creates a new receipted comment.

## Receipts

Each attempt writes one bounded atomic JSON receipt under
`.agent-stack/provider-receipts/`. Receipts contain:

- provider and operation;
- repository work item;
- remote UUID or issue identifier;
- redacted before and after state;
- authority source;
- stable idempotency key;
- UTC time and result.

Receipts never contain issue bodies, comment bodies, raw provider responses,
profiles, credentials, or attachment data. A successful issue link is also
recorded in the work item's `external_refs`.

If the remote write succeeds but the local process stops before recording the
receipt, rerun the same command. The stable UUID lets the read-only adapter
reconcile the existing object and repair repository state.
