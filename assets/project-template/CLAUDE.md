# Ultimate Agent Stack

@AGENTS.md

For an end-to-end build, change, resume, or delivery request, use the native
`Skill` tool to invoke `run-autonomous-delivery` before any other tool. When
that controller owns implementation and verification quality gates; it does
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
The receipt is agent-recorded evidence and must never be created before the
native `Skill` call or without the coordinator token and repository-write
authority. For read-only work, do not mutate the repository; report that the
receipt was not persisted.
