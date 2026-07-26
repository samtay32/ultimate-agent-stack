# Architecture

## System in One Sentence

Ultimate Agent Stack is a repository-owned control loop: it turns intent into a locked contract, executes verifiable slices, gathers independent evidence, and repairs review findings until policy—not agent confidence—says the change is ready.

## Control Flow

```mermaid
flowchart TD
    U["Human supplies intent and authority"] --> E["Explicit entry skill"]
    E --> S{"Stack configured?"}
    S -- "No" --> SET["Setup: inspect, preserve, detect, baseline"]
    SET --> R
    S -- "Yes" --> R{"Route by risk and ambiguity"}
    R -->|T0-T1| M["Micro-brief"]
    R -->|T2| C["Compact PRD + architecture spine"]
    R -->|T3-T4| F["Research + full contract + approvals"]
    C --> P{"Runnable uncertainty?"}
    F --> P
    M --> L
    P -- "Yes" --> PRO["Throwaway prototype or experiment"]
    P -- "No" --> L["Lock artifacts by SHA-256"]
    PRO --> L
    L --> V["Implement one vertical slice"]
    V --> Q["Focused feedback loop"]
    Q -->|Fail| V
    Q -->|Pass| N{"More slices?"}
    N -- "Yes" --> V
    N -- "No" --> G["Full deterministic gate"]
    G -->|Fail| V
    G -->|Pass| A["Independent standards + intent review"]
    A -->|Finding| V
    A -->|Clear| PR["Draft PR + evidence"]
    PR --> CI["Required CI + GitHub protections"]
    PR --> CR["CodeRabbit review"]
    CI --> D{"Actionable issue?"}
    CR --> D
    D -- "Yes" --> B["Fix/rebut/defer with evidence"]
    B --> G
    D -- "No" --> AUTH{"Merge authority?"}
    AUTH -- "Granted" --> DONE["Merge or enable policy-approved auto-merge"]
    AUTH -- "Not granted" --> READY["Merge-ready; one human action"]
```

## Component Architecture

```mermaid
flowchart LR
    subgraph Intent["Intent plane"]
        SP["Starter prompt"]
        SH["shape-project"]
        AR["DELIVERY / ARCHITECTURE / DECISIONS"]
    end

    subgraph Execution["Execution plane"]
        RD["run-autonomous-delivery"]
        PD["coordinate-parallel-delivery"]
        NA["Native harness subagents"]
        BV["build-vertical-slice"]
        REPO["Project code and docs"]
    end

    subgraph Evidence["Evidence plane"]
        CLI["agent-stack.mjs"]
        LOCK["SHA-256 intent lock"]
        CHECKS["Project-native checks"]
        RUNS["Bounded local evidence"]
    end

    subgraph Release["Review and release plane"]
        VC["verify-change"]
        RL["close-review-loop"]
        GH["GitHub CI / protections"]
        CR["CodeRabbit"]
    end

    SP --> RD
    RD --> SH --> AR
    AR --> LOCK
    RD --> PD
    PD -->|serial| BV
    PD -->|bounded delegation| NA --> BV
    BV --> REPO
    REPO --> CLI --> CHECKS --> RUNS
    LOCK --> VC
    RUNS --> VC --> RL
    RL --> GH
    RL --> CR
    GH --> RL
    CR --> RL
```

## Five Planes

1. **Intent plane** — separates user outcome, capabilities, constraints, non-goals, assumptions, and acceptance. It scales from a micro-brief to a full product/migration contract.
2. **Execution plane** — builds one vertical slice at a time. It uses the repository's own language, framework, and tools rather than imposing a product stack.
3. **Evidence plane** — provides deterministic setup, check discovery, fail-closed verification, bounded logs, and artifact hashes. It deliberately contains no LLM decision logic.
4. **Review plane** — independently checks engineering standards and locked intent, then uses GitHub and CodeRabbit as additional adversarial surfaces.
5. **Authority plane** — limits interruptions without pretending authority does not exist. Reversible engineering is agent-owned; credentials, cost, legal risk, destructive production actions, and unauthorized releases remain human-owned.

## Durable State

| State | Owner | Purpose |
|---|---|---|
| `AGENTS.md` | Repository | Always-on project rules and authority boundaries |
| `.agent-stack/config.json` | Repository | Actual command arrays and automation policy |
| `.agent-stack/core-policy.json` | Package | Protected mechanical safety rules |
| `.agent-stack/installation.json` | CLI | Managed hashes, customizations, and update proposals |
| `DELIVERY.md` | Delivery | Outcome, capabilities, acceptance, non-goals |
| `ARCHITECTURE.md` | Delivery | Binding architecture decisions only |
| `DECISIONS.md` | Delivery | Audited changes to intent or architecture |
| `VERIFICATION.md` | Delivery | Requirement-to-evidence coverage |
| `SECURITY.md` | Delivery | Classified exposure and applicable launch gates |
| `DELEGATION.md` | Primary agent | Execution strategy, worker assignments, and dispositions |
| `.agent-stack/state.json` | CLI | Active hashes and lock history |
| `.agent-stack/runs/` | Local evidence | Bounded command results; ignored by default |
| Pull request | GitHub | Reviewable outcome, evidence, and disposition ledger |

## Why It Adapts

The workflow branches on risk, ambiguity, blast radius, and reversibility—not framework or industry. Project-specific behavior lives in `AGENTS.md`, configured command arrays, locked artifacts, and tests. The same control loop can therefore govern a website, CLI, API, data pipeline, mobile app, infrastructure repository, document-only project, or brownfield system.

It is not literally universal: a project without executable checks, a required unavailable service, missing credentials, or an unresolved product decision cannot be truthfully declared ready. The system turns those into explicit blockers rather than hidden failure.

## Parallelism

The configured default is adaptive: the primary agent chooses the lowest
capability level that safely helps the current request.

| Level | Execution |
|---|---|
| C0 | Primary agent works serially |
| C1 | Native workers perform parallel read-only research or review in the shared checkout |
| C2 | Native workers perform disjoint writes in verified isolated worktrees/workspaces |

The primary agent always owns decomposition, worker prompts, monitoring,
recovery, integration, verification, and cleanup. Worker count is capped;
nested delegation and authority expansion are forbidden; a branch alone is not
write isolation. The strategy falls back to serial work when tasks are coupled,
the expected saving is small, or the harness cannot prove the required
capability.

This is a portable coordination protocol with native read-only worker adapters
for Codex, Claude Code, Gemini CLI, and OpenCode. Grok, Cursor, and other
harnesses can use a proven native delegation surface or the serial fallback. It
is not a bundled agent framework, always-running supervisor, tmux dependency,
or cross-vendor CLI launcher.

## Package and Upgrade Boundary

The npm package is a distribution vehicle, not a remote orchestration service.
The current primary coding agent is the coordinator. `init`
copies the portable policy, skills, artifacts, and dependency-free CLI into the
project. The project then remains runnable from repository-owned files.

Every shipped file is recorded with its package-source hash and last accepted
project hash. `upgrade` creates a versioned proposal for every existing file
whose bytes differ from the new package source; project-editable manifest
claims never authorize an overwrite. Package removals become recorded orphans
rather than automatic deletions. The package CLI verifies protected policy and
CLI bytes against its canonical source, and protected files cannot be adopted
in a customized state.

Pinned upstream repositories sit outside this path. The scheduled monitor may
open a review issue, but only the explicit maintenance workflow can translate a
reviewed principle into original package code.
