# Ultimate Agent Stack — Gemini CLI Adapter

Read and follow `AGENTS.md`, `.agent-stack/core-policy.json`,
`.agent-stack/config.json`, and the relevant skills under `.agents/skills/`.
Project-specific instructions remain authoritative.

Follow the route-aware workflow-loading contract in `AGENTS.md`. End-to-end
delivery and RESUME use `$run-autonomous-delivery`; a request explicitly limited
to brief refinement, source audit, or reconciliation uses
`$develop-project-brief` directly and stops before delivery. Explanation-only
work loads neither.

Apply `$use-project-knowledge` with the configured provider and repository
fallback. Apply
`$coordinate-parallel-delivery` to choose serial or bounded native subagent
execution. The primary agent owns every assignment, authority boundary,
monitoring decision, integration, verification step, and worker cleanup.

Use `uas-researcher` only for independent read-only research or review. Parallel
writes require a separately verified isolated workspace; otherwise keep write
work serial. Never require the user to manage subagents.
