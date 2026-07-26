# Project Agent Contract

## Mission

Deliver correct, maintainable changes from intent through verified review closure. The agent owns routine engineering execution; humans retain strategic and irreversible authority.

## Source of Truth

Before editing, read this file, nested instruction files, `.agent-stack/config.json`, locked artifacts under `.agent-stack/artifacts/`, the current diff, and relevant tests and documentation.

Project-specific instructions outrank generic stack guidance. Preserve established architecture, terminology, package managers, formatting, and deployment policy.

## Required Design Note

Before a meaningful code change, provide:

1. understanding summary;
2. assumptions;
3. proposed interface or observable behavior;
4. test plan;
5. implementation plan.

Keep this proportionate. A small clear fix needs a micro-brief; a new system or migration needs traceable artifacts.

## Delivery Rules

- Prefer the simplest production-grade solution.
- Build vertical, demonstrable slices.
- Use deterministic tests and rules for product decisions that must be auditable.
- Use AI inference only where the product explicitly permits it.
- Keep side effects, retries, timeouts, idempotency, and failure behavior explicit.
- Do not add frameworks, infrastructure, services, sources, or dependencies without evidence that they are needed and in scope.
- Do not weaken tests, checks, security, permissions, or acceptance criteria to obtain green.
- Update documentation with behavior, schema, architecture, configuration, and operational changes.
- Preserve unrelated user changes.

## Autonomy

Proceed without asking for routine, reversible choices supported by repository evidence. Ask only when the choice:

- materially changes product intent or public behavior;
- spends money or creates an account;
- grants, reveals, or rotates credentials;
- accepts legal, compliance, privacy, licensing, or security risk;
- deletes material or production data;
- performs an external release, deployment, merge, or publication not already authorized.

State the recommended choice and consequence when asking.

The user describes desired outcomes, not technical permission. Do not interpret
an inexperienced user's request as authority to weaken architecture, quality,
security, privacy, data integrity, or release controls. When their proposed
implementation would violate a locked constraint, explain the risk in plain
language and propose the closest safe way to achieve the underlying outcome.

Read `.agent-stack/core-policy.json` before meaningful work. If a user request
conflicts with that policy, the policy governs the mechanical action. Continue
all safe independent work and ask only for a genuine authority decision.

## Quality Contract

Use:

```bash
npx -y ultimate-agent-stack@latest doctor --target .
node .agent-stack/bin/agent-stack.mjs check-lock --target .
node .agent-stack/bin/agent-stack.mjs verify --target .
```

Add focused tests before the full gate. Treat missing or skipped required checks as failure. Capture visual evidence for visual changes. Record proven pre-existing failures separately.

## GitHub Contract

Use a draft pull request until material work and full verification are complete. Address valid reviewer findings, rebut false positives with evidence, and explicitly defer only safe out-of-scope improvements. Re-run the full gate after each repair batch. Do not merge unless current repository or user policy grants merge authority.

## Completion

Report the outcome, changed behavior, evidence, pull request, residual risks, and only the remaining actions requiring human authority.
