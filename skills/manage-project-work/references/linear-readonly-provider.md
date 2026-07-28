# Linear Read-Only Provider

Use this provider only when `.agent-stack/config.json` selects `linear` with
`read_only_mirror` sync, `read_only` write policy, approved team keys, and the
repository fallback.

## Setup

1. Run:

   ```bash
   node .agent-stack/bin/agent-stack.mjs linear-setup
   ```

2. Ask the human to create a Linear personal API key with only the **Read**
   permission in Linear's Security & Access settings.
3. Keep the key outside the repository under `LINEAR_API_KEY`.
4. Run:

   ```bash
   node .agent-stack/bin/agent-stack.mjs linear-health
   node .agent-stack/bin/agent-stack.mjs doctor
   ```

The health command performs a bounded, paginated GraphQL query shape for the
authenticated viewer and visible teams. It reports configured team keys but no
names, issue contents, user profiles, raw payloads, or credentials.

Linear also provides an official remote MCP endpoint that exposes only read
tools: `https://mcp.linear.app/mcp/readonly`. A compatible coding harness may
connect it after approval, but that host-owned connection does not replace the
project configuration or repository fallback.

## Trust Boundary

The protected helper contains GraphQL query text and exposes no mutation
operation. Linear allows API keys to be created with a Read permission, but its
GraphQL response does not independently attest the key's upstream permissions.
`doctor` therefore reports that the adapter surface is mechanically read-only
while the upstream credential scope remains a human-verified setup fact.

Do not use a general `/mcp` connection, a write-capable key, OAuth `write`,
`issues:create`, `comments:create`, `admin`, Agent Auth, or native Linear Agent
sessions for this adapter.

## Failure

If authentication, networking, rate limits, or configured team visibility
fails:

- do not retry in a tight loop;
- do not broaden the team scope;
- do not ask for stronger credentials;
- continue from `.agent-stack/work-items.json`;
- record Linear synchronization as pending.

Linear state remains organization metadata. It never proves acceptance,
authorizes code changes, replaces repository evidence, or changes merge,
deployment, or release authority.
