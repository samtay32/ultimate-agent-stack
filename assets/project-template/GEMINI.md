# Ultimate Agent Stack — Gemini CLI Adapter

Read and follow `AGENTS.md`, `.agent-stack/core-policy.json`,
`.agent-stack/config.json`, and the relevant skills under `.agents/skills/`.
Project-specific instructions remain authoritative.

Use `$run-autonomous-delivery` as the controlling workflow. Apply
`$use-project-knowledge` with the configured provider and repository fallback.
Apply
`$coordinate-parallel-delivery` to choose serial or bounded native subagent
execution. The primary agent owns every assignment, authority boundary,
monitoring decision, integration, verification step, and worker cleanup.

Use `uas-researcher` only for independent read-only research or review. Parallel
writes require a separately verified isolated workspace; otherwise keep write
work serial. Never require the user to manage subagents.
