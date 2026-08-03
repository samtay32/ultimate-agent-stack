# Ultimate Agent Stack

@AGENTS.md

For an end-to-end build, change, resume, or delivery request, use the native
`Skill` tool to invoke `run-autonomous-delivery` before any other tool. That
controller owns implementation and verification quality gates; it does
not require nested native activation of `build-vertical-slice` or
`verify-change`. A request explicitly limited to implementation may invoke
`build-vertical-slice` directly, and a request explicitly limited to
verification may invoke `verify-change` directly. Invoke
`develop-project-brief` directly only for a request explicitly limited to brief
refinement, source audit, or reconciliation. Explanation-only requests invoke
none of these skills. Reading this file or `AGENTS.md` does not count as skill
activation.

After each actual native activation, record it with the local `evidence
activate` command described in `AGENTS.md` as soon as this session owns the
checkout through `start`. Use one stable run ID for this Claude Code session.
Use the canonical project-relative installed skill path, plus the exact runtime
model identifier Claude exposes (not a guessed model family). The receipt is
agent-recorded evidence and must never be created before the native `Skill` call
or without the coordinator token and repository-write authority; it does not
authenticate the claimed identity. For read-only work, do not mutate the
repository; report that the receipt was not persisted.
Because this adapter requires an actual native `Skill` invocation, record
`--mode native` with the actual installed `.claude` or `.agents` path used; do
not copy the common `.agents` file-read mode unless the skill was only hash-read.

When the selected route reaches verification or readiness, use `evidence
activation-status --run RUN --require SKILL` for receipt-derived activation and
`review status --run RUN` for local pre-PR readiness. Do not run either during
the initial one-question DISCOVER draft. Never
replace those artifacts with skill names or approval prose; unavailable review
evidence remains blocked. Keep live evaluation request plus context at or below
2 KiB, without repository dumps or expected skill names.
