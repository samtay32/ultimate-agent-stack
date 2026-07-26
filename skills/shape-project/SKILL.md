---
name: shape-project
description: Convert an ambiguous software idea or change into a proportionate, testable, lockable delivery contract. Use when requirements, user behavior, architecture boundaries, migration semantics, or success criteria are unclear before implementation.
---

# Shape Project

Resolve decisions that would otherwise cause rework. Do not turn every task into a large specification.

## Procedure

1. Inspect the repository, domain documentation, relevant code, issue history, and authoritative external docs.
2. Classify the work using [references/shaping-contract.md](references/shaping-contract.md).
3. Write the smallest sufficient artifact:
   - direct change: a micro-brief in `.agent-stack/artifacts/DELIVERY.md`;
   - bounded feature: compact PRD, architecture spine, and acceptance table;
   - product/system/migration: full artifacts with traceable requirement IDs, non-goals, risks, rollout, and rollback.
4. Separate:
   - problem and user outcome;
   - observable capabilities;
   - implementation constraints;
   - assumptions;
   - non-goals;
   - acceptance evidence.
5. Research facts instead of asking the user. For remaining ambiguity:
   - make a reversible default and record it;
   - ask one high-impact question only if alternatives materially change product intent or risk;
   - recommend a choice and explain the consequence.
6. Use a throwaway prototype when runnable behavior answers a question more cheaply than prose:
   - UI: produce meaningfully different variants and expose a fast selector;
   - logic: use a terminal/state-machine harness;
   - keep persistence, polish, and production architecture out;
   - capture decisions, then discard or isolate prototype code.
7. Derive vertical slices and a verification matrix.
8. Remove placeholders and contradictions. Lock the artifact before implementation.

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
