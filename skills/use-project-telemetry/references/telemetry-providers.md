# Reviewed Telemetry Providers

## Shipped Connection Surface

The project-local CLI installs one protected helper with three fixed live
checks:

| Provider | Role | Configuration | Fixed operation |
|---|---|---|---|
| PostHog | `product` | `posthog@us:12345` or `posthog@eu:12345` | Read basic metadata for at most one saved insight while verifying access to the numeric project |
| Sentry | `errors` | `sentry@us:org/project`, `sentry@de:org/project`, or `sentry@global:org/project` | Read the exact organization/project identity |
| New Relic | `service` | `new-relic@us:12345` or `new-relic@eu:12345` | Run one named NerdGraph account-identity query |

Run:

```bash
node .agent-stack/bin/agent-stack.mjs telemetry-setup --target .
node .agent-stack/bin/agent-stack.mjs telemetry-health --target .
```

`telemetry-setup` is guidance only. It never opens an OAuth flow, creates a
credential, modifies provider state, or writes a secret. `telemetry-health`
tests every configured connection and returns normalized identity and
availability fields. It retains no remote response body.

## Credential Boundaries

| Provider | Environment | Minimum requested access | Important limitation |
|---|---|---|---|
| PostHog | `POSTHOG_PERSONAL_API_KEY` | `insight:read` | The CLI checks its own read-only surface; inspect the key in PostHog to confirm no extra scopes |
| Sentry | `SENTRY_AUTH_TOKEN` | `project:read` | The token must be limited to the intended organization/project by its upstream access |
| New Relic | `NEW_RELIC_USER_KEY` | Account query access | User keys inherit user roles and are not intrinsically read-only; use a narrowly authorized user |

Never place these values in `.agent-stack/config.json`, shell transcripts,
checkpoints, reports, receipts, the evidence graph, or generated instructions.
If a credential has broader access than needed, replace it before using the
adapter.

## Observation Boundary

Connection health is not a product conclusion. The shipped helper deliberately
does not expose arbitrary HogQL, NRQL, GraphQL, events, sessions, recordings,
logs, stack traces, prompts, feature flags, alerts, incidents, configuration,
or mutations.

For an actual delivery observation:

1. start with a human-approved saved query, issue, trace, dashboard, or release
   reference inside the configured project;
2. use only a separately reviewed read-only provider operation or approved
   harness connection that returns a bounded aggregate;
3. retain the reference, window, filters, limitations, and a redacted summary;
4. validate the observation against repository and deployment evidence;
5. stop with `decision-needed` if the question requires raw personal data,
   broader scope, new instrumentation, or a provider mutation.

Do not convert the health helper into an arbitrary query proxy.

## Upstream References

- [PostHog OpenAPI schema](https://eu.posthog.com/api/schema/swagger-ui/)
- [Sentry project retrieval and `project:read`](https://docs.sentry.io/api/projects/retrieve-a-project/)
- [New Relic NerdGraph account queries](https://docs.newrelic.com/docs/apis/nerdgraph/get-started/nerdgraph-explorer/)
- [New Relic API key types](https://docs.newrelic.com/docs/apis/intro-apis/new-relic-api-keys/)
- [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/)

OpenTelemetry is intentionally not configured as a provider here. It is a
vendor-neutral instrumentation and transport layer. Selecting a backend,
changing instrumentation, or routing production data remains a separate
architecture decision.
