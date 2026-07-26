# Sources, Synthesis, and Tradeoffs

Research completed July 25, 2026. Repository commit IDs below pin the analyzed state. The package synthesizes patterns; it does not copy third-party source files.

## Primary Repository Matrix

| Source | Analyzed revision | Strongest contribution | Adopted | Deliberately not adopted |
|---|---:|---|---|---|
| [kunchenguid/firstmate](https://github.com/kunchenguid/firstmate) | `34213e66a8c6` | One liaison, isolated worktrees, event-driven supervision, restart-proof state, explicit project modes | One controlling workflow, durable repository state, isolation as an option, ship/scout distinction in spirit | Mandatory coordinator/worker swarm, task-queue runtime, supervisor as a baseline dependency |
| [kunchenguid/lavish-axi](https://github.com/kunchenguid/lavish-axi) | `50b0facb61b5` | High-fidelity HTML planning artifacts with annotations and structured human decisions | Use visual artifacts when text fidelity is too low; preserve the product design system | Mandatory HTML planning, extra Node dependency, or visual ceremony for small work |
| [kunchenguid/no-mistakes](https://github.com/kunchenguid/no-mistakes) | `e279099c51a6` | Fail-closed pre-push pipeline, disposable worktree, independent reviewer/fixer, evidence over confidence | Locked intent, full local gate, independent standards/intent review, explicit finding disposition, never lose work | Requiring a Git proxy remote or its complete runtime for every repository |
| [kunchenguid/axi](https://github.com/kunchenguid/axi) | `d5aa171665bb` | Agent-oriented CLI principles: compact defaults, structured errors, idempotent mutations, bounded output, contextual next steps | JSON command arrays, bounded/redacted evidence, loud errors, deterministic exit codes, helpful next actions | A new CLI wrapper for every tool or unverified universal token-savings claims |
| [github/spec-kit](https://github.com/github/spec-kit) | `c0fe0e43cd72` | Constitution → specify → clarify → plan → tasks → analyze → implement; traceable requirements and checklists | Stable capability IDs, measurable outcomes, non-goals, constitution/project policy, vertical tasks, consistency/readiness checks | Full specification ceremony for small changes; unsandboxed workflow interpolation; spec as a substitute for runnable evidence |
| [mattpocock/skills](https://github.com/mattpocock/skills) | `ed37663cc5fb` | Grill-with-docs, prototype, spec, tickets, TDD, debugging, codebase design, independent review | Research before questions, one high-impact clarification, fidelity ladder, public test seams, tracer slices, two review axes, deep-module heuristics | Large questioning sessions by default; keeping prototype code; one workflow regardless of context size |
| [bmad-code-org/bmad-method](https://github.com/bmad-code-org/bmad-method) | `bb45db4aa449` | Scale-adaptive flow, readiness review, architecture spine, dev-auto repair loop | Tiered shaping, binding architecture decisions, requirement traceability, bounded repair loops, "bad spec loops back" behavior | Persona/party-mode machinery, large document catalogs, separate agents for every role, framework-wide installation |

### Firstmate Review on July 25, 2026

The weekly check found two commits between pinned `34213e66a8c6` and remote
`c64ad1c42550534d56ff381cadc9072195a92357`. The reviewed change adds and tests
a Kimi CLI/tmux harness adapter. Disposition: **defer**. It is useful to
Firstmate users but does not improve this package's portable setup, safety,
verification, or release interfaces. The pin remains unchanged; no upstream
code or instructions were copied or executed.

## Related Kunchenguid Repository Review

The linked profile was reviewed for related original work rather than treating every fork as a new design source.

| Source | Revision | Relevant lesson | Stack decision |
|---|---:|---|---|
| [treehouse](https://github.com/kunchenguid/treehouse) | `c0b7f685d451` | Reusable, leased, recoverable isolated worktrees | Recommended for parallel/conflict-prone work; optional for ordinary serial delivery |
| [gnhf](https://github.com/kunchenguid/gnhf) | `1d0673920f3e` | Small committed autonomous iterations with runtime/token caps and failure rollback | Long-running mode must be bounded, verifiable, and resumable; not the default |
| [gh-axi](https://github.com/kunchenguid/gh-axi) | `fe384b3af00d` | Compact GitHub state and structured actions | Optional ergonomic layer; plain `gh` or connector remains supported |
| [chrome-devtools-axi](https://github.com/kunchenguid/chrome-devtools-axi) | `aa162e87f189` | Combined browser operations and token-bounded snapshots | Supports the case for agent-oriented interfaces; no mandatory browser wrapper |
| [agent-browser-axi](https://github.com/kunchenguid/agent-browser-axi) | `cd66cd4df888` | Accessibility snapshot normalization | Visual/web work must use observable browser evidence when applicable |
| [quota-axi](https://github.com/kunchenguid/quota-axi) | `a9ca3e16a413` | Local-first quota visibility and explicit timeouts | Outcome/cost monitoring is useful; quota tools remain optional |
| [tasks-axi](https://github.com/kunchenguid/tasks-axi) | `ce322417a186` | Idempotent, compact, durable task state | Repository artifacts are the default durable state; external backlog CLI is optional |
| [rough-cut-axi](https://github.com/kunchenguid/rough-cut-axi) | `701d6db5b65c` | Plain-file truth plus human/agent decision queue | Reinforces explicit artifacts and safe structured edits beyond coding |
| [mcp-compressor](https://github.com/kunchenguid/mcp-compressor) | `11d557805206` | Tool-schema context can dominate agent cost | Keep tools lazy and task-relevant; no mandatory compressor |
| [acpx](https://github.com/kunchenguid/acpx) | `1a9fdabfd7a6` | Structured agent protocol and persistent sessions; alpha warning | Structured delegation is preferable to PTY scraping, but not a baseline dependency |
| [superpowers-bench](https://github.com/kunchenguid/superpowers-bench) | `6a0e877e7464` | Skill discovery must be measured, not assumed | Two entry skills are explicit; implicit skills have narrow trigger descriptions |
| [ProgramBench](https://github.com/kunchenguid/ProgramBench) | `2bb8e8459ac9` | Behavioral reproduction can be evaluated against executable tests | Acceptance needs black-box behavioral evidence where practical |
| [harness-exam](https://github.com/kunchenguid/harness-exam) | `c0eff7e6a989` | Harness behavior deserves evaluation | Clean-repository and fail/pass fixtures are part of package validation |

## Supplied Video Analysis

| Video | Key evidence | Applied result |
|---|---|---|
| [The AI Token Game](https://www.youtube.com/watch?v=sxUPsyNwGgs) | Token consumption is not productivity; compare outcomes to cost; generous quotas are useful but unlimited loops are not | Scale routing, bounded outputs, explicit repair cap, outcome/evidence metrics |
| [L8 Principal's Agentic Engineering Workflow](https://www.youtube.com/watch?v=iQyg-KypKAA) | Minimal global instructions, project memory, progressive skills, high-fidelity planning, independent validation, human attention at start/end, optional worktrees | Small `AGENTS.md`, focused skills, optional visual planning/isolation, agent-owned middle |
| [Don't waste time on specs: /prototype instead](https://www.youtube.com/watch?v=n0VhIVtviC0) | Use a fidelity ladder; prototype UI/state questions; make multiple real variants; prototype is disposable primary-source evidence | Prototype trigger in shaping; decisions captured before production implementation |
| [mattpocock/skills: complete workflow](https://www.youtube.com/watch?v=M6mYodf0dJM) | Grill → prototype when needed → direct implement or spec/tickets → TDD → independent standards/spec review | Explicit orchestrator, scale-based branch, vertical slices, two-axis review |

## Current Platform and Review Documentation

- [OpenAI Codex customization](https://learn.chatgpt.com/docs/customization/overview): `AGENTS.md` for durable project guidance, skills for reusable workflows, progressive disclosure, MCP for external tools, subagents only when useful.
- [OpenAI build skills](https://learn.chatgpt.com/docs/build-skills): skill format and project/global locations.
- [OpenAI plugins](https://learn.chatgpt.com/docs/plugins): plugin distribution and supported surfaces.
- [Anthropic Agent Skills best practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices): concise skill metadata, progressive disclosure, scripts for deterministic work, and forward testing.
- [Cursor rules](https://docs.cursor.com/context/rules-for-ai) and [commands](https://docs.cursor.com/en/agent/chat/commands): root `AGENTS.md`, project rules, and reusable command adapters.
- [Grok skills and plugins](https://docs.x.ai/build/features/skills-plugins-marketplaces): `.grok/skills`, plugin discovery, Claude compatibility, and `.agents/skills` compatibility.
- [CodeRabbit configuration](https://docs.coderabbit.ai/reference/configuration) and [commands](https://docs.coderabbit.ai/guides/commands): current schema, review controls, and re-review commands.
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches): required status checks, approvals, conversation resolution, and merge controls.

## Core Tradeoffs

### Autonomy versus authority

The stack maximizes execution autonomy without forging credentials, spending money, accepting legal risk, deleting production data, or silently publishing. This is less theatrical than "fully autonomous," but it is the boundary that makes 99% automation trustworthy.

### Evidence versus speed

Tests, locked intent, review, and CI cost time. They prevent the much larger cost of confident wrong delivery. Small tasks use a micro-brief so the evidence burden remains proportionate.

### Portable core versus maximum harness optimization

`AGENTS.md`, Agent Skills, plain Markdown artifacts, JSON config, and a
dependency-free Node.js CLI travel well and can be distributed through npm.
Harness-specific hooks and custom orchestrators could automate more, but would
increase trust surface, drift, and lock-in. They remain adapters.

### Serial default versus agent swarm

Parallel agents can shorten independent research or changes. They also add merge conflicts, duplicated context, and integration failure. The default is one liaison and serial slices; parallelism requires isolation and a named integration owner.

### Manual review trigger versus every-push review

CodeRabbit automatic incremental review is disabled. The agent requests review only after a verified batch. This trades a little latency for lower noise, lower review cost, and clearer evidence.

### Universal intent versus honest coverage

The detector recognizes common JavaScript, Python, Go, Rust, Java, .NET, Ruby, Swift, Terraform, and Docker Compose surfaces. Niche stacks require the agent to add their actual commands. The system fails closed rather than claiming an unknown project is green.

## Exclusions

The package intentionally does not introduce:

- an always-running agent supervisor;
- Redis, queues, databases, or cloud control planes;
- autonomous release authority;
- LLM-based quality scoring;
- an unbounded "work until perfect" loop;
- mandatory prototypes or full PRDs;
- mandatory multi-agent orchestration;
- a global permission bypass;
- silently installed third-party skills;
- replacement of project-native CI and tests.
