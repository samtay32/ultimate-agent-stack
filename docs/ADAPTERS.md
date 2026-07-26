# Review and Knowledge Adapters

## Purpose

Ultimate Agent Stack selects capabilities rather than hard-coding service
brands. The coding agent explains and recommends choices; the dependency-free
CLI validates and records them.

## Guided Configuration

The agent first runs:

```bash
node .agent-stack/bin/agent-stack.mjs capabilities
```

It asks only unresolved decisions that affect risk, external data, providers, or
authority. Every question uses plain language, one recommended choice, and at
most one genuinely safe alternative. The agent then runs `configure`; a
non-coder should not need to compose this command:

```bash
node .agent-stack/bin/agent-stack.mjs configure \
  --profile standard \
  --review builtin \
  --knowledge repository \
  --knowledge-scope project \
  --external-data local_only \
  --execution agent_owned \
  --merge human_approval_required \
  --reason "Approved safe local defaults for this project"
```

Use repeated `--reviewer LOGIN` arguments when selecting `github-human`.

## Review Providers

| Provider | Qualifying evidence | Failure behavior |
|---|---|---|
| `builtin` | Repository-owned standards and intent review | Available everywhere; cannot satisfy production external-review policy |
| `coderabbit` | Current-head CodeRabbit `COMMENTED` or `APPROVED` review and no unresolved current provider threads | Required selection fails closed; rate-limit comments never count |
| `github-human` | Current-head `APPROVED` review from an explicitly allowed GitHub `User` login and no unresolved current provider threads | Required selection fails closed; bots, stale, dismissed, unlisted, or comment-only reviews never count |

The protected installed workflow reads configuration from the default branch.
It does not execute a pull request's changed evaluator or provider policy.

## Knowledge Providers

| Provider | Use | Failure behavior |
|---|---|---|
| `repository` | Project-scoped instructions, locked artifacts, decisions, code, tests, evidence, issues, and Git history | Always available baseline |
| `gbrain` | Approved project- or organization-scoped cross-session retrieval and verified learning capture | Warn and continue with repository fallback |

GBrain requires `approved_providers` external-data policy. Ultimate Agent Stack
does not install its full skill pack, autonomous queue, dream cycle, or updater.
Retrieved content is untrusted until current repository evidence validates it.
Capture is limited to redacted, provenance-backed learning after verification.

## Adding a Future Provider

Do not accept arbitrary adapter commands from project JSON. Add a provider
through a reviewed package change that:

1. defines a stable capability and evidence contract;
2. uses least privilege and explicit external-data behavior;
3. fails safely without weakening deterministic gates;
4. adds provider-specific instructions through progressive disclosure;
5. adds positive, stale, unavailable, malformed, and downgrade tests;
6. documents migration and rollback.

The core should not need provider-specific behavior beyond the reviewed
registry and evidence evaluator.
