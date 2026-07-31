# Ultimate Agent Stack

@AGENTS.md

For an end-to-end build, change, resume, or delivery request, use the native
`Skill` tool to invoke `run-autonomous-delivery` before any other tool. When
that workflow enters implementation or verification, invoke
`build-vertical-slice` or `verify-change` before acting in that phase. Invoke
`develop-project-brief` directly only for a request explicitly limited to brief
refinement, source audit, or reconciliation. Explanation-only requests invoke
none of these skills. Reading this file or `AGENTS.md` does not count as skill
activation.
