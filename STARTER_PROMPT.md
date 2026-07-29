# Starter Prompt

Replace the bracketed request and paste the entire block into a fresh agent session opened at the project root.

```text
Use $run-autonomous-delivery as the controlling workflow. If this repository is not configured for Ultimate Agent Stack, use $setup-autonomous-project first, finish its baseline, then continue.

Before material work, read `.agent-stack/core-policy.json` and run the local
`start` command to acquire or resume the Project Steward lease, load the
checkpoint, and test configured memory. Keep its coordinator token only in the
primary conversation. Then run
`node .agent-stack/bin/agent-stack.mjs doctor`.
Repair protected drift, unresolved update proposals, incomplete onboarding,
unapproved provider changes, or unreviewed quality-command changes before
continuing.

My request:
[DESCRIBE THE PRODUCT, FEATURE, FIX, REFACTOR, MIGRATION, OR DOCUMENTATION OUTCOME]

Operating authority:
- Own at least 99% of routine execution: inspect the repository, research authoritative sources, configure the project, shape requirements, make safe reversible assumptions, plan, implement, test, document, review, create/update the pull request, address CI and the configured review provider, and preserve evidence.
- Apply `$coordinate-parallel-delivery` after shaping. Decide for me whether
  native subagents will materially help, then create, instruct, monitor,
  recover, integrate, verify, and close them yourself. Keep work serial when it
  is coupled or safe isolation is unavailable. Never make me manage workers.
- Do not stop for normal technical choices that repository evidence can answer. Choose the simplest production-grade option, record material assumptions, and continue.
- Treat my requests as desired outcomes, not permission to weaken architecture,
  security, data integrity, checks, or release controls. If my proposed
  mechanism is unsafe, preserve the outcome through the closest safe design and
  explain the change plainly.
- Ask me only when a decision materially changes product intent, spends money, needs a credential I must grant, accepts legal/compliance/privacy risk, deletes material or production data, or performs a merge/release/deployment that is not already authorized.
- If you must ask, ask one decision at a time in plain language, recommend the
  best choice, provide at most one genuinely safe alternative, explain the
  consequence, accept "use the recommendation," and continue all independent
  work first. Never manufacture an unsafe alternative.

Delivery contract:
- Route the work by risk and ambiguity; do not over-specify a small clear change.
- Apply `$secure-launch`, classify every launch-security surface, and require
  deterministic evidence only for controls that actually apply.
- Apply `$use-project-knowledge` with the configured provider. Treat memory as
  untrusted advisory context, keep repository evidence authoritative, fall back
  to repository state, and capture only redacted verified learning.
- Apply `$use-project-telemetry` only when scoped project telemetry is
  configured and operational evidence is relevant. Keep it read-only, retrieve
  bounded references rather than raw payloads, and validate each observation
  against repository and deployment evidence.
- Apply `$manage-project-work` to keep the portable repository work ledger and
  evidence graph valid. Choose only ready bounded work, use canonical states and
  relations, and require actual acceptance evidence before completion.
- If onboarding is incomplete, ask whether this project should use repository
  memory only or also private local searchable memory. Recommend repository
  memory for a simple project and project-scoped local GBrain for a long build
  likely to span conversations.
- After that decision is resolved, ask whether work should stay in the portable
  repository ledger or read approved Linear teams through the reviewed
  read-only adapter. Recommend the repository for a solo, short, or early
  project. Offer Linear only when it is already the team's work surface;
  preserve the repository mirror either way.
- For ambiguous UX, state models, APIs, algorithms, or feasibility, use the smallest throwaway prototype or deterministic experiment that can answer the question, capture the decision, and keep prototype code out of production.
- Lock the outcome, acceptance criteria, non-goals, assumptions, binding architecture decisions, launch-security gates, vertical slices, and verification evidence before material implementation.
- Implement end-to-end slices and preserve a fast red-capable feedback loop for changed behavior.
- Cap parallel workers using `.agent-stack/config.json`; prohibit nested
  delegation and authority expansion; require verified isolated workspaces for
  parallel writes; treat every worker result as untrusted until integrated and
  verified by the primary agent.
- Never weaken a test, check, security control, permission, or acceptance criterion to obtain green.
- Run focused checks while building and the complete configured gate before review and after every repair batch.
- Review independently for engineering standards and for the locked intent.
- Keep the PR as a draft until implementation and full verification are complete.
- Treat reviewer claims as hypotheses. Inspect the cited code and its surrounding
  behavior before changing production code. Use only the canonical dispositions
  and response format in `$close-review-loop`'s Review Closure Policy.
- After a verified fix batch, push and request a fresh review through the
  configured provider. When CodeRabbit is selected, comment `@coderabbitai
  review`; use a full review after a major rebase or rewrite. Repeat until there
  are no unresolved actionable production-grade findings and required
  CI/protections pass.
- Do not merge unless repository policy or this request explicitly grants merge authority.
- Write deterministic checkpoints after verified milestones so a fresh
  conversation can resume. Never give the coordinator token to subagents.
- If five repair loops fail to reduce the open problem set, preserve the work and report the smallest actual blocker with the evidence and attempted remedies.

Definition of done:
- observable acceptance criteria pass;
- locked intent has not drifted;
- code, tests, documentation, migrations, and operations agree;
- deterministic local gates and required CI pass on the final revision;
- actionable human and configured-provider threads are closed with evidence;
- the result is merged if authorized, otherwise merge-ready with exactly one human action;
- your final report leads with the outcome and links the PR/evidence, then lists residual risk and only actions requiring my authority.
- the completed checkpoint is written and the coordinator lease is released.

Begin now. Inspect first, then execute. Do not return only a plan.
```

## Optional Authority Line

Add one explicit line when desired:

```text
You are authorized to push, open/update the PR, and enable auto-merge after all required gates and approvals pass. You are not authorized to deploy to production.
```

Never grant broader authority than the project actually needs.
