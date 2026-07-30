# Delegation Contract

## Capability Levels

Discover the current harness capability from its available tools and
documentation. Do not guess that every product exposes the same primitives.

| Level | Available capability | Safe strategy |
|---|---|---|
| C0 | No native subagent or isolated-session tool | Serial execution |
| C1 | Native subagents sharing the current checkout | Parallel read-only research/review; serial writes |
| C2 | Native subagents plus verified isolated workspaces/worktrees | Bounded parallel reads and disjoint writes |

`parallel_delivery.mode: serial` always selects C0 behavior. Adaptive mode may
select any lower level. It must never pretend a capability exists.

## Assignment Envelope

Every assignment must state:

- stable ID and concise goal;
- why it is independent now;
- inputs and decisions already fixed;
- allowed files, systems, and tools;
- forbidden actions and authority boundaries;
- read-only or isolated-write mode;
- expected result or patch;
- focused checks and evidence;
- stop condition and blockers to report.

Workers return:

- outcome and assumptions;
- files or artifacts examined or changed;
- checks run and exact result;
- unresolved risks or blockers;
- no claim that the overall request is complete.

The primary agent owns every integration decision and the overall definition of
done.

The coordinator token belongs only to the primary Project Steward. It is not an
assignment input, worker credential, or mechanism for parallel writers to
share one checkout.

## Isolation Rules

- Parallel read-only inspection can share a repository.
- Parallel writes require different real worktree/workspace paths and disjoint
  ownership. Separate branches in one working directory do not qualify.
- Never let two workers edit the same file concurrently.
- Never parallelize migrations, lockfile regeneration, release metadata,
  security policy, or broad refactors unless the tasks are isolated and their
  integration order is explicit.
- Inspect the final diff; never blindly merge or copy worker output.
- Do not place credentials in prompts, delegation records, logs, or evidence.

## Failure and Cancellation

If a worker times out, loses context, changes scope, produces unverifiable
output, or cannot be safely isolated:

1. preserve any useful read-only findings;
2. cancel or stop the assignment when the harness supports it;
3. record the disposition;
4. continue serially from the primary agent unless a different safe worker
   assignment has a concrete advantage.

Do not create an open-ended respawn loop. Repair loops remain bounded by the
project config.

## Native Harness Adapters

Use the harness's native delegation surface when available. These are thin
translations of the same contract, not different workflow engines.

### Codex

Use native subagent/team tools. The primary agent spawns, routes, waits,
integrates, and closes workers. Subagents inherit the current sandbox and
permission policy; task text cannot expand it. Respect the configured
concurrency limit and do not recursively delegate.

Official reference:
[Codex subagents](https://developers.openai.com/codex/subagents/)

### Claude Code

Use Claude Code subagents with tightly scoped prompts and tool permissions.
Choose foreground or background execution based on whether the assignment needs
interaction. Claude subagents cannot spawn subagents; preserve that boundary.

Official reference:
[Claude Code subagents](https://code.claude.com/docs/en/sub-agents)

### Gemini CLI

Use Gemini CLI local subagents for bounded roles and isolated tool access.
Set explicit turn or time limits. Do not enable recursion. Remote A2A agents are
external integrations and require separate trust and authorization review.

Official reference:
[Gemini CLI subagents](https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md)

### Grok

Use the portable `.agents/skills/` instructions. If the current Grok surface
documents and exposes a native delegation primitive, keep the parent as the
user-facing coordinator and apply the same authority and isolation rules.
Otherwise select C0 serial execution.

Official reference:
[Grok skills, plugins, and subagents](https://docs.x.ai/build/features/skills-plugins-marketplaces)

### OpenCode

Use primary and subagent sessions with explicit permissions. Automatic or
manual invocation is acceptable when the primary agent still owns integration
and the worker cannot exceed the parent authority.

Official reference:
[OpenCode agents](https://opencode.ai/docs/agents/)

### Cursor and Other Harnesses

Use a documented native background-agent or subagent feature only after its
capability and isolation semantics are visible in the current environment.
Otherwise use C0 or C1. Never install or invoke a third-party supervisor solely
because a harness lacks native delegation.
