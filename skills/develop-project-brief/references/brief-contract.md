# Working Brief Contract

## Purpose

`BRIEF.md` is the flexible intake artifact for DISCOVER and EXTERNAL modes. It
is intentionally unlocked while intent evolves. It does not replace
`DELIVERY.md`, `ARCHITECTURE.md`, `SECURITY.md`, `VERIFICATION.md`, or the
canonical decision log.

DIRECT work does not need `BRIEF.md`. RESUME reads the already locked contract
and checkpoint instead of restarting intake. A supporting screenshot, log, or
attachment for clear bounded work is evidence for DIRECT rather than product
intent for EXTERNAL. Clear bounded work remains DIRECT in a new or empty
repository.

## Required Header

Use exact top-level fields:

```text
Status: DRAFT | APPROVED
Intake mode: DISCOVER | EXTERNAL
Material open conflicts: YES | NO
```

Use DRAFT until the product owner accepts the brief for promotion. Use NO for
material conflicts only when no unresolved contradiction or consequential
decision can change the current delivery outcome or risk.

### Readiness versus approval

An explicit request from an authorized product owner for an approved brief
counts as acceptance once consequential gaps are closed; produce the
APPROVED-ONLY result without asking for acceptance again. Otherwise, a
gap-free request limited to source audit or producing a DRAFT or working brief
may finish with `Status: DRAFT` and `Material open conflicts: NO`. Complete
every readiness item except product-owner approval, report the DRAFT as ready
for later approval, and stop without an approval question. Pending optional
approval is future work, not a blocker or residual question. Source
completeness alone never grants approval, and a DRAFT cannot be promoted until
the product owner explicitly accepts it.

The CLI mechanically requires every selected lock artifact to contain exactly
one visible `Status: APPROVED` and `Material open conflicts: NO` declaration.
Missing, duplicate, unknown, DRAFT, or open-conflict declarations fail closed.
It does not understand the truth of prose, authenticate the approver, or
discover an omitted conflict.

## Content Kernel

The brief records, proportionately:

1. source and provenance;
2. problem, users, and outcome;
3. one falsifiable product standard;
4. approaches, tradeoffs, and recommendation;
5. observable capabilities and acceptance evidence;
6. constraints, non-goals, and assumptions;
7. closed and open consequential decisions;
8. contradictions and unresolved gaps;
9. demo/stub versus production behavior;
10. source-claim dispositions;
11. promotion readiness.

## Source-Claim Ledger

Give each load-bearing source claim a stable `SRC-n` identifier and record:

- source locator or hash;
- normalized claim;
- exactly one disposition: `kept`, `tightened`, `rejected`, or `deferred`;
- destination requirement or decision ID;
- concise rationale.

Do not imply that a long or polished source is correct. Account for its
load-bearing claims without copying secrets or unrelated content.

## Closed Decisions

Give decisions stable `CD-n` identifiers. Record the decision, alternatives it
forecloses, evidence or authority, and this governing instruction:

```text
Do not reopen without product-owner instruction.
```

During promotion, move the binding record into `DECISIONS.md` and reference its
ID from final contracts. Do not keep two independently editable binding copies.

## Promotion

An approved brief may be promoted only when:

- provenance is safe and sufficient;
- source claims are accounted for;
- capabilities and evidence are testable;
- consequential questions are closed;
- material conflicts are resolved or explicitly routed to the product owner;
- closed decisions are ready for the canonical log.

Promotion records a conversational decision. The artifact lock later proves
the bytes of selected final contracts have not drifted; neither mechanism
proves the legal identity of the person who approved the brief.
