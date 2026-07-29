# Sources, Synthesis, and Tradeoffs

Initial synthesis research was completed July 25, 2026 and expanded with
GBrain on July 26, 2026. Repository commit IDs below pin the analyzed state.
The package synthesizes patterns; it does not copy third-party source files.

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
| [garrytan/gbrain](https://github.com/garrytan/gbrain) | `3fafb69b077e` | Long-lived knowledge retrieval, synthesis, provenance, graph traversal, gap analysis, MCP access, and skill evaluation | Optional provider-neutral knowledge adapter, repository fallback, scoped retrieval receipts, verified capture, and evaluated skill candidates | Full skill-pack installation, ambient capture, Minions queue, dream/autopilot cycles, self-updater, or memory as delivery authority |

### Firstmate Review on July 25, 2026

The weekly check found two commits between pinned `34213e66a8c6` and remote
`c64ad1c42550534d56ff381cadc9072195a92357`. The reviewed change adds and tests
a Kimi CLI/tmux harness adapter. Disposition: **defer**. It is useful to
Firstmate users but does not improve this package's portable setup, safety,
verification, or release interfaces. The pin remains unchanged; no upstream
code or instructions were copied or executed.

### Parallel Delivery Decision on July 26, 2026

The useful Firstmate principle—one liaison owning a bounded crew—has now been
implemented as original package policy rather than by adopting Firstmate's
runtime. The new coordinator uses native Codex, Claude Code, Gemini CLI, or
OpenCode subagents when available, caps workers, forbids recursive
delegation and authority expansion, requires verified isolation for parallel
writes, persists dispositions, and falls back to serial work. Other harnesses
may delegate only when their current native surface is proven. The Kimi/tmux
adapter remains deferred because it solves Firstmate-specific process control,
not this package's portable contract.

### GBrain Decision on July 26, 2026

GBrain is adopted as an optional knowledge provider, not a runtime dependency or
orchestrator. Ultimate Agent Stack keeps repository instructions, locked
artifacts, current code, tests, and authoritative sources as truth. GBrain
retrieval is scoped, provenance-preserving, and untrusted until validated;
capture is limited to redacted verified learning. Provider failure falls back
to repository state. Its complete skill collection, ambient message capture,
agent queue, dream cycle, and updater remain outside the package.

### Graph, Loop, Work, and Telemetry Decision on July 28, 2026

The useful pattern across the reviewed graph/loop material is a bounded control
loop over portable state: choose one eligible work item, act, attach evidence,
verify, review, and either advance or stop. Ultimate Agent Stack implements
that pattern through the repository work contract, evidence graph, bounded
campaign state, and explicit provider receipts. It does not adopt an unbounded
agent runtime, a provider-owned canonical backlog, or a graph database.

Linear is the first optional work adapter because it can map cleanly to the
portable work-item contract. Read access is team-scoped; the only optional
writes are receipted issue creation and evidence comments behind separate
credentials and authority checks. Native Linear Agent sessions and Agent Auth
remain deferred until adoption demonstrates a need.

Telemetry is a complementary evidence capability, not work orchestration.
PostHog, Sentry, and New Relic are reviewed as replaceable product, error, and
service adapters. The initial implementation verifies only fixed
project/account identity and availability through a protected helper. It does
not expose arbitrary provider query languages or copy raw payloads. Provider
native sessions, automatic agent/session capture, and telemetry-specific Agent
Auth remain deferred.

OpenTelemetry is kept at the instrumentation and transport boundary. Its
vendor-neutral Collector supports replacing or combining backends, but adding
or changing production instrumentation is a separate project decision rather
than an Ultimate Agent Stack default.

### Flexible Intake Decision on July 29, 2026

Milestone 1 reuses the scale-adaptive and provenance lessons already pinned in
the repository matrix. It adds original package logic rather than importing a
third-party workflow:

- **Adopted:** one focused `develop-project-brief` skill behind the existing
  Project Steward; ordered RESUME, EXTERNAL, DISCOVER, and DIRECT routing;
  an optional unlocked working brief for exploratory or supplied material; a
  stable source-claim ledger using `kept`, `tightened`, `rejected`, and
  `deferred`; repository reconciliation; and canonical closed decisions that
  are not reopened without product-owner instruction.
- **Tightened:** the lock now rejects declared DRAFT state, declared material
  open conflicts, and unresolved placeholders. This proves the selected bytes
  satisfy those declared markers, not that an agent understood every semantic
  contradiction or authenticated the person who approved the brief.
- **Rejected:** separate brainstorming/import/reconciliation personas,
  mandatory discovery for clear bounded work, a BRIEF requirement for every
  typo or bug, silently editing an outside source, treating a polished source as
  truth, copying secrets or raw private chats, and duplicating the existing
  delivery, evidence, lock, or checkpoint state machines.
- **Deferred:** the Definition of Done and guided user-acceptance expansion,
  provider-neutral launch readiness, CLI modularization, and optional specialist
  packs remain later milestones. They require Milestone 1 dogfooding evidence
  before expanding the core.

For a repository source, the brief records its path and hash. For pasted,
attached, or private material, it records a bounded redacted provenance summary
unless an authorized project copy is appropriate. Every load-bearing source
claim must remain traceable through its disposition and destination; neither
normalization nor reconciliation authorizes silently rewriting the source.

Primary technical references:

- [Linear GraphQL API](https://linear.app/developers/graphql)
- [Linear OAuth scopes](https://linear.app/developers/oauth-2-0-authentication)
- [Linear read-only MCP](https://linear.app/docs/mcp)
- [PostHog OpenAPI schema](https://eu.posthog.com/api/schema/swagger-ui/)
- [Sentry project retrieval](https://docs.sentry.io/api/projects/retrieve-a-project/)
- [Sentry API permissions](https://docs.sentry.io/api/permissions/)
- [New Relic NerdGraph account queries](https://docs.newrelic.com/docs/apis/nerdgraph/get-started/nerdgraph-explorer/)
- [New Relic API keys](https://docs.newrelic.com/docs/apis/intro-apis/new-relic-api-keys/)
- [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/)

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
| [Every company should have a Brain](https://www.youtube.com/watch?v=eBUyTS7SzV4) | Skill files as workers, resolver as org chart, deterministic versus latent compute, company library plus librarian, compounding verified learning, and explicit stale-memory/bad-skill failure modes | Guided provider-neutral knowledge plane, repository authority, provenance and contradiction checks, verified capture, and non-executable skill candidates |

## Current Platform and Review Documentation

- [OpenAI Codex customization](https://learn.chatgpt.com/docs/customization/overview): `AGENTS.md` for durable project guidance, skills for reusable workflows, progressive disclosure, MCP for external tools, subagents only when useful.
- [OpenAI build skills](https://learn.chatgpt.com/docs/build-skills): skill format and project/global locations.
- [OpenAI plugins](https://learn.chatgpt.com/docs/plugins): plugin distribution and supported surfaces.
- [Anthropic Agent Skills best practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices): concise skill metadata, progressive disclosure, scripts for deterministic work, and forward testing.
- [Cursor rules](https://docs.cursor.com/context/rules-for-ai) and [commands](https://docs.cursor.com/en/agent/chat/commands): root `AGENTS.md`, project rules, and reusable command adapters.
- [Grok skills and plugins](https://docs.x.ai/build/features/skills-plugins-marketplaces): `.grok/skills`, plugin discovery, Claude compatibility, and `.agents/skills` compatibility.
- [Codex subagents](https://developers.openai.com/codex/subagents/), [Claude Code subagents](https://code.claude.com/docs/en/sub-agents), [Gemini CLI subagents](https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md), and [OpenCode agents](https://opencode.ai/docs/agents/): native delegation capabilities differ, so one portable assignment contract must degrade safely rather than pretend every harness is identical.
- [CodeRabbit configuration](https://docs.coderabbit.ai/reference/configuration) and [commands](https://docs.coderabbit.ai/guides/commands): current schema, review controls, and re-review commands.
- [GBrain README](https://github.com/garrytan/gbrain): current local/MCP
  connection surface, raw and synthesized retrieval, capture, provenance, access
  scopes, skill optimization, and optional autonomous features.
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

### Adaptive coordination versus agent swarm

Parallel agents can shorten independent research or changes. They also add
merge conflicts, duplicated context, and integration failure. The default is
one primary liaison choosing adaptively: serial for coupled or small work,
shared-checkout parallelism for read-only work, and verified isolated
workspaces for disjoint writes. The coordinator—not the user—owns integration.

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
