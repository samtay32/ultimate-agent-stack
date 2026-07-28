# Review, Knowledge, Work, and Telemetry Adapters

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
| `github-human` | Current-head `APPROVED` review from an explicitly allowed GitHub `User` login other than the pull-request author, with no unresolved current provider threads | Required selection fails closed; self, bot, stale, dismissed, unlisted, or comment-only reviews never count |

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

For the guided local path:

```bash
node .agent-stack/bin/agent-stack.mjs memory-setup --harness codex
node .agent-stack/bin/agent-stack.mjs memory-health
```

The first command returns an agent-executable plan; it does not silently perform
a global installation. The local adapter uses checkout-scoped PGLite and a
restricted MCP launcher. It starts without embeddings, so external model keys
remain a separate decision. The health command verifies containment of the
active database path, runs GBrain doctor, and reads the brain identity.

`checkpoint` always writes the authoritative repository handoff. When local
GBrain is healthy, it mirrors that bounded handoff to a fixed searchable page.
`start` retrieves that page and reports mismatch or failure while continuing
with repository fallback. Organization-scoped remote brains require separate
identity and authorization verification; a local check never attests remote
scope.

## Telemetry Providers

Telemetry is an optional multi-provider capability because product analytics,
errors, service observability, and AI traces answer different questions. The
portable baseline is an empty provider list and repository evidence fallback.
Ultimate Agent Stack sends no usage telemetry.

Every configured telemetry provider must:

- be registered by reviewed package code rather than an arbitrary project
  command;
- use `approved_providers` external-data policy;
- begin with read-only project-scoped access;
- keep credentials outside repository configuration and evidence;
- return bounded normalized references rather than raw payloads;
- remain optional and fall back to repository evidence;
- never authorize provider mutation, code changes, merge, deploy, rollback, or
  release.

The shared observation receipt and failure behavior live in
[`use-project-telemetry`](../skills/use-project-telemetry/references/telemetry-contract.md).
Provider-specific operations belong in progressively disclosed references and
must not enlarge the core tool surface.

## Work Providers

The repository provider is always available. It stores normalized work in
`.agent-stack/work-items.json` and bounded evidence relationships in
`.agent-stack/evidence-graph.json`. Both files have shipped JSON Schemas and
dependency-free CLI validation.

Only one work provider may organize canonical work at a time. A reviewed
external provider must map its vocabulary to the fixed work contract, preserve
the repository fallback, and emit receipts for every external operation.
Provider state never grants execution, merge, deployment, or release authority,
and `done` still requires the complete linked evidence set: acceptance,
implementation, verification, and review evidence. Repository or
approved-provider acceptance is one required component, not completion proof by
itself.

The shared vocabulary and receipt live in
[`manage-project-work`](../skills/manage-project-work/references/work-evidence-contract.md).

### Linear adapter

Linear is the first optional implementation of the neutral work contract. It is
selected only after the onboarding question and requires:

- `approved_providers` external-data policy;
- one or more explicit uppercase team keys;
- `read_only_mirror` synchronization;
- `read_only` provider policy by default;
- a `LINEAR_API_KEY` created in Linear with only the Read permission;
- the portable repository ledger and evidence graph as fallback.

The protected helper contains one bounded, paginated GraphQL query shape for
viewer identity and visible team keys. It has no mutation operation.
`linear-health`, `doctor`, and `start` report availability without recording
the credential, user profile, team names, issue contents, or raw response.

After a second explicit onboarding decision, the reviewed adapter can enable
only `issue_create`, or `issue_create` plus `evidence_comment`. These operations
use separate team-restricted credentials, require the active coordinator token,
an authority source, and an explicit external-write confirmation, and produce
validated repository receipts. They do not expose arbitrary GraphQL or issue
editing, status, assignment, deletion, project, cycle, label, attachment, or
administrative mutations.

Linear's official read-only MCP endpoint,
`https://mcp.linear.app/mcp/readonly`, may be connected by compatible harnesses
after approval. A host-owned MCP connection does not alter project policy.
Native Linear Agent sessions and Agent Auth remain deferred. Provider writes
are never automatic and campaign mode never triggers them.

See the
[`Linear read-only provider reference`](../skills/manage-project-work/references/linear-readonly-provider.md)
and
[`Linear receipted-writes reference`](../skills/manage-project-work/references/linear-receipted-writes.md).

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
