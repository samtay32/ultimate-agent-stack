# Agent Handoff

This repository uses Ultimate Agent Stack.

## Start

1. Read `AGENTS.md`, `.agent-stack/core-policy.json`,
   `.agent-stack/config.json`, any valid `.agent-stack/CHECKPOINT.md`, and
   locked artifacts under `.agent-stack/artifacts/`, the current diff, and
   relevant tests and project documentation.
2. Acquire or resume the one Project Steward lease and load continuity:

   ```bash
   node .agent-stack/bin/agent-stack.mjs start \
     --idea "Describe the user's current request"
   ```

   Keep the returned coordinator token in the primary conversation only. If
   another active coordinator owns this checkout, do not write from this
   conversation.
3. Run:

   ```bash
   node .agent-stack/bin/agent-stack.mjs doctor --target .
   node .agent-stack/bin/agent-stack.mjs capabilities
   ```

   If onboarding is pending or provider choices changed, inspect the repository.
   First offer one combined recommendation only when its constraints fit and
   the user has not requested a relevant advanced provider:

   > I recommend the private repository-only setup. It uses no outside memory,
   > tracking, or telemetry, and you retain merge control. Use this?

   Approval means run `configure --preset simple` and do not ask separate
   memory, work, telemetry, review-provider, data-policy, or merge-authority
   questions. Reveal only a relevant advanced choice when repository evidence
   requires it, the user requests it, or a real requirement cannot be met
   locally.
4. When an advanced memory decision is actually required, explain that
   repository checkpoints remain authoritative. If project-scoped local GBrain
   is approved, run:

   ```bash
   node .agent-stack/bin/agent-stack.mjs memory-setup --harness HARNESS
   ```

   Follow its guarded plan, merge rather than overwrite harness configuration,
   then confirm the live result with `doctor`.
5. If checks were newly detected or changed, inspect their definitions in the
   project manifests. Reject direct shell interpreters or destructive
   executables in command arrays; package scripts may invoke a shell, so inspect
   their script bodies before approval. Then run:

   ```bash
   node .agent-stack/bin/agent-stack.mjs approve-checks \
     --reason "Inspected project-native quality command definitions"
   ```

6. Use `$run-autonomous-delivery` for the user's request. Route intake in this
   order: RESUME, EXTERNAL, DISCOVER, DIRECT. RESUME requires a valid
   non-complete checkpoint or an active lock with an unmet done/evidence
   condition. Apply `$develop-project-brief` only for substantial material that
   defines intent/an existing plan or for genuine discovery. A supporting
   screenshot, log, or attachment does not override DIRECT, and clear bounded
   work remains DIRECT in a new or empty repository. Completed state does not
   hijack a new request. Valid continuity resumes without reopening closed
   decisions. The controller routes execution
   through `$coordinate-parallel-delivery`, which may use bounded native
   subagents when doing so is both safe and useful.
7. The primary agent manages every worker and returns one integrated result.
   The user never has to supervise subagents. Parallel writers require verified
   isolated workspaces; otherwise keep write work serial.
8. Apply `$use-project-knowledge` with the configured provider and repository
   fallback.
9. Apply `$use-project-telemetry` only when scoped telemetry is configured and
   the request requires relevant production or operational evidence. Run
   `telemetry-health` first. Keep access read-only, retain bounded references
   instead of raw payloads, and fall back to repository evidence when a
   provider is unavailable or out of scope.
10. Apply `$manage-project-work`. Validate the repository work ledger and
    evidence graph, choose only ready bounded work, and link completion to real
    acceptance evidence. A provider status alone never proves completion.
11. For EXTERNAL intake, read the supplied source completely, preserve it
    unchanged, and reconcile it against repository reality. For DISCOVER
    intake, write an early unlocked DRAFT and ask one consequential question at
    a time. Recommend one safe default, offer at most one genuinely safe
    alternative, and explain the practical consequence.
12. Own routine research, design, implementation, tests, documentation, and
    review closure. Do not return only a plan. A local independent review
    requires a real separate reviewer ID and returned result tied to the exact
    reviewed revision. Link the schema-valid receipt from a verified review
    node and run `evidence validate` plus `receipts validate`. Failed spawn,
    empty wait, self-review, or unsupported prose leaves review and PR readiness
    incomplete.
13. After verified milestones, write a deterministic checkpoint with
    `checkpoint --coordinator-token TOKEN`. At the final handoff, write the
    completed checkpoint and run
    `coordinator release --coordinator-token TOKEN`.

## User Protection

The user describes desired outcomes. Do not interpret a non-technical request
as permission to weaken architecture, checks, security, data safety, or release
policy. If their requested implementation would break a locked constraint,
explain the issue in plain language and recommend a safe way to achieve the
underlying outcome.

## Update

When the user asks to update the stack, run:

```bash
npx -y ultimate-agent-stack@latest upgrade
```

Reconcile every proposal under `.agent-stack/update-proposals/`. Never replace
customized project policy blindly. After each reconciliation, run
`adopt-managed`, then `doctor` and `verify`.
