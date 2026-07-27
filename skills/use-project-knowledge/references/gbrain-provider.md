# GBrain Provider

Use GBrain only when `.agent-stack/config.json` selects `gbrain` and the
external-data policy permits approved providers.

## Connect

For a new project-scoped connection, run:

```bash
node .agent-stack/bin/agent-stack.mjs memory-setup \
  --harness DETECTED_HARNESS
```

The returned plan uses a checkout-local `GBRAIN_HOME`, PGLite, and the
restricted `.agent-stack/bin/gbrain-project.mjs` MCP launcher. Verify the
current official GBrain instructions before a missing CLI is installed. A
global CLI installation requires explicit approval. Merge project-scoped MCP
settings into existing configuration; never replace unrelated settings or
create an ambient cross-project connection.

The safe starting configuration uses `--no-embedding` so no external API key
is silently requested or inherited. Adding an embedding provider is a separate
external-data and credential decision. Do not use `--force`.

For an existing remote brain, verify its identity, authorization, and approved
organization scope separately. Do not represent a local project health check
as proof of remote organization isolation. Do not install GBrain's full skill
collection, autonomous agent queue, dream cycle, or updater merely to enable
memory.

Run `memory-health` or `doctor`. The live project check verifies the active
database path is contained by this checkout's GBrain home, runs GBrain's own
doctor, and reads its identity. `start` repeats this check and retrieves the
mirrored checkpoint when one exists. Treat unavailable CLI, MCP,
authentication, scope, stale checkpoint, or platform compatibility as a
fallback condition, not permission to weaken delivery gates.

## Retrieve

- Use raw search for focused context and citation lookup.
- Use synthesized queries only when cross-source synthesis or gap analysis is
  worth the additional model call.
- Restrict queries to the approved project or organization scope.
- Preserve GBrain citations and freshness warnings.
- Validate every decision-affecting result against current repository evidence.

## Capture

Capture only the redacted, verified learning record defined in
`knowledge-contract.md`. The checkpoint command mirrors its validated
repository handoff to the fixed project checkpoint page. Do not enable ambient
message capture. Do not capture raw conversations or source material that
already has an authoritative repository home.

If write scope is absent, preserve the proposal in repository artifacts. If
GBrain is unavailable, continue entirely with the repository provider.
