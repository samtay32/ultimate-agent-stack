---
name: shape-project
description: Convert an ambiguous software idea or change into a proportionate, testable, lockable delivery contract. Use when requirements, user behavior, architecture boundaries, migration semantics, or success criteria are unclear before implementation.
---

# Shape Project

Resolve decisions that would otherwise cause rework. Do not turn every task into a large specification.

## Procedure

1. Inspect the repository, domain documentation, relevant code, issue history, and authoritative external docs.
   Apply `$use-project-knowledge` first when configured memory may contain a
   relevant decision, incident, or analogous project.
2. Read `.agent-stack/artifacts/DECISIONS.md` and any locked decision
   references before proposing alternatives. Do not reopen a closed product
   decision without product-owner instruction.
3. If `$develop-project-brief` produced an approved working brief, validate its
   provenance, source-claim ledger, promotion checklist, and
   `Material open conflicts: NO`. Promote its binding content into
   `DELIVERY.md`, `ARCHITECTURE.md`, `SECURITY.md`, `VERIFICATION.md`, and
   `DECISIONS.md`. Make the decision log canonical; the brief remains a source
   and audit record.
4. Classify the work using [references/shaping-contract.md](references/shaping-contract.md).
5. Write the smallest sufficient artifact:
   - direct change: a micro-brief in `.agent-stack/artifacts/DELIVERY.md`;
   - bounded feature: compact PRD, architecture spine, and acceptance table;
   - product/system/migration: full artifacts with traceable requirement IDs, non-goals, risks, rollout, and rollback.
6. Separate:
   - problem and user outcome;
   - observable capabilities;
   - implementation constraints;
   - assumptions;
   - non-goals;
   - acceptance evidence.
7. Research facts instead of asking the user. For remaining ambiguity:
   - make a reversible default and record it;
   - ask one high-impact question only if alternatives materially change product intent or risk;
   - state it in plain language, recommend one choice, provide at most one
     genuinely safe alternative, explain the consequence, and accept "use the
     recommendation."
8. Use a throwaway prototype when runnable behavior answers a question more cheaply than prose:
   - UI: produce meaningfully different variants and expose a fast selector;
   - logic: use a terminal/state-machine harness;
   - keep persistence, polish, and production architecture out;
   - capture decisions, then discard or isolate prototype code.
9. Derive vertical slices and a verification matrix.
10. Remove placeholders and contradictions. Set selected final artifacts to
    `Status: APPROVED` and `Material open conflicts: NO` only when those
    declarations are truthful. Lock before implementation.

Only `DRAFT` and `APPROVED` are valid artifact status values. Promotion leaves
an approved working brief `APPROVED`; it does not mark it `PROMOTED`. Mechanical
lock state comes only from the protected `lock` command and must be confirmed
with `check-lock` before it is reported.

## Quality Bar

- Requirements describe observable behavior and have stable IDs where cross-file traceability matters.
- Success criteria are measurable and technology-agnostic.
- Architecture records only invariants that independent implementers might choose incompatibly.
- Every important decision states what it binds, what failure it prevents, and the governing rule.
- Each slice is independently demonstrable; avoid horizontal "build all models, then all APIs" plans.
- Non-goals are explicit.
- Test seams are public or user-observable, not implementation trivia.
- No stale code snippets or speculative file paths masquerade as requirements.

Do not implement while a material intent conflict remains. Save the evidence and surface the smallest decision needed.
