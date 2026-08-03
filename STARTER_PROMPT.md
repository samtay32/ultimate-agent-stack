# Starter Prompt

Replace `[REQUEST]` with your request, then paste the entire block into a fresh
agent session opened at the project root.

```text
Use $run-autonomous-delivery for end-to-end delivery or RESUME. For a request
explicitly limited to brief refinement, source audit, or reconciliation, use
$develop-project-brief directly and stop before delivery. For an
explanation-only request, use neither. If this repository is not configured,
use $setup-autonomous-project first.

Start with the local `.agent-stack` CLI, then read `AGENTS.md`, core policy,
config, any checkpoint, and the current diff. Route before loading more: load
only the entry skill and reference required by RESUME (with an unmet done or
evidence condition), EXTERNAL, DISCOVER, or DIRECT, then only files needed for
the next decision. Do not dump directories,
all artifacts, skills, references, CLI source, help, or large JSON into context.
A supporting screenshot, log, or attachment does not by itself make bounded
work EXTERNAL; clear bounded work remains DIRECT.
Before material work, run
`node .agent-stack/bin/agent-stack.mjs start` and retain its coordinator token
only in the primary session, then run
`node .agent-stack/bin/agent-stack.mjs doctor`. Use the local CLI, not `npx`,
and summarize command results concisely. When onboarding
needs a choice and the user has not requested a relevant advanced provider,
recommend: "I recommend the private repository-only setup. It uses no outside memory,
tracking, or telemetry, and you retain merge control. Use this?" Reveal an
advanced provider only when the user explicitly requests it or it is necessary.

For a vague new-project DISCOVER request, take the compact path: controller +
brief reference, DRAFT brief, validation of that artifact only, one checkpoint,
then exactly one consequential question. Do not activate knowledge, work,
telemetry, security, or parallel skills unless the next step needs them.

Own routine reversible work and choose the simplest safe option. Do not weaken
checks or exceed authority. Ask only for consequential product, spending,
credential, legal/privacy, destructive, merge, release, or deployment choices.
Keep the coordinator token private. Record actual skill activations with the
canonical project-relative skill path and exact runtime identity exposed to you;
these are agent-recorded, not authenticated claims. Use stack-generated
activation, verification, review, and readiness status rather than prose.
Run focused checks while working and the configured full gate before review;
keep a PR draft until complete. Never give the coordinator token to subagents.
An explicitly phase-specific implementation request may use
$build-vertical-slice; an explicitly phase-specific verification request may
use $verify-change. Use $close-review-loop only for an existing pull request or
an external provider or human review thread, following its Review Closure Policy.

My request:
[REQUEST]

Begin now. Inspect first, then execute. Do not return only a plan.
```

## Optional Authority Line

Add one explicit line when desired:

```text
You are authorized to push, open/update the PR, and enable auto-merge after all required gates and approvals pass. You are not authorized to deploy to production.
```

Never grant broader authority than the project actually needs.
