# Ultimate Agent Stack — Gemini CLI Adapter

Read and follow `AGENTS.md`, `.agent-stack/core-policy.json`,
`.agent-stack/config.json`, and only the route-relevant skills under
`.agents/skills/`.
Project-specific instructions remain authoritative.

Follow the route-aware workflow-loading contract in `AGENTS.md`. End-to-end
delivery and RESUME use `$run-autonomous-delivery`; a request explicitly limited
to brief refinement, source audit, or reconciliation uses
`$develop-project-brief` directly and stops before delivery. Explanation-only
work loads neither. The delivery controller owns implementation and verification
quality gates without requiring nested native phase activations. Requests
explicitly limited to implementation or verification may use
`$build-vertical-slice` or `$verify-change` directly.

After each actual native activation or hash-bound skill read, record it with the
local `evidence activate` command described in `AGENTS.md` as soon as this
session owns the checkout through `start`. Use one stable run ID and the exact
harness/model identifier Gemini exposes, plus a canonical project-relative
installed skill path (never an absolute path). Never record an activation before
it occurs or without the coordinator token and repository-write authority. The
receipt is agent-recorded and does not authenticate that identity. For read-only
work, do not mutate the repository; report that the receipt was not persisted.

Use `evidence activation-status --run RUN --require SKILL` for exact-run
receipt-derived activation and `review status --run RUN` for local pre-PR
readiness. Never replace these artifacts with skill names or approval prose;
unavailable review evidence remains blocked. Keep live evaluation request plus
context at or below 2 KiB, without repository dumps or expected skill names.

Apply `$use-project-knowledge` with the configured provider and repository
fallback. Apply
`$coordinate-parallel-delivery` to choose serial or bounded native subagent
execution. The primary agent owns every assignment, authority boundary,
monitoring decision, integration, verification step, and worker cleanup.

Use `uas-researcher` only for independent read-only research or review. Parallel
writes require a separately verified isolated workspace; otherwise keep write
work serial. Never require the user to manage subagents.
