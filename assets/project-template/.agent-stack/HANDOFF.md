# Agent Handoff

This repository uses Ultimate Agent Stack.

## Start

1. Read `AGENTS.md`, `.agent-stack/core-policy.json`,
   `.agent-stack/config.json`, and relevant existing project documentation.
2. Run:

   ```bash
   node .agent-stack/bin/agent-stack.mjs doctor --target .
   ```

3. If checks were newly detected or changed, inspect their definitions in the
   project manifests. Reject shell or destructive checks. Then run:

   ```bash
   node .agent-stack/bin/agent-stack.mjs approve-checks \
     --reason "Inspected project-native quality command definitions"
   ```

4. Use `$run-autonomous-delivery` for the user's request.
5. For a new or ambiguous project, inspect first and then ask one consequential
   question at a time. Recommend a safe default with each question.
6. Own routine research, design, implementation, tests, documentation, and
   review closure. Do not return only a plan.

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
