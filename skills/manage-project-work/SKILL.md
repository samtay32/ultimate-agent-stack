---
name: manage-project-work
description: Plan, update, or inspect project work through the configured work provider while preserving a portable repository ledger and evidence graph. Use when turning intent into work items, choosing the next bounded slice, recording progress or blockers, linking requirements to implementation and verification, reconciling external work tracking, or explaining what evidence supports completion.
---

# Manage Project Work

Use one provider-neutral work vocabulary. The configured provider may organize
work, but it does not expand execution, merge, deployment, or release authority.

## Workflow

1. Read `.agent-stack/config.json`, `.agent-stack/work-items.json`,
   `.agent-stack/evidence-graph.json`, and
   [references/work-evidence-contract.md](references/work-evidence-contract.md).
2. Run:

   ```bash
   node .agent-stack/bin/agent-stack.mjs work validate
   node .agent-stack/bin/agent-stack.mjs evidence validate
   ```

   Stop and repair malformed repository state before relying on it.
3. Convert the current intent into the smallest work item that has a bounded
   objective, explicit acceptance criteria, path scope, exclusions,
   dependencies, and canonical status. A backlog item may remain ledger-only
   while it is being shaped; add its matching `work_item` evidence node before
   advancing it beyond `backlog`.
4. Reuse stable work and evidence identifiers. Never create a second item for
   the same objective merely because an external provider uses another ID.
5. Choose work only from `ready` items whose dependencies are `done`. If no
   item is ready, report the blocker or shape the missing decision first.
6. Keep the repository ledger current at verified transitions. Record external
   objects as references; do not copy their full descriptions, comments, users,
   or attachments into repository state.
7. Add evidence nodes and controlled relations only when the referenced
   evidence exists. A planned check is not verified evidence.
8. Before marking work `done`, confirm every acceptance criterion has a
   repository or approved-provider evidence path and the normal verification
   and review gates passed.
9. Revalidate both files and include their results in the handoff.

## Hard Boundaries

- Repository work tracking is the fully supported default.
- A work provider never grants authority to edit code, mutate remote work,
  merge, deploy, release, or change project scope.
- Do not invent a status, priority, node kind, node state, or edge relation.
- Do not store credentials, raw telemetry, personal data, prompt transcripts,
  or remote payloads in either repository file.
- Do not infer completion from a provider status alone.
- Do not silently broaden scope, select unready work, or loop without a bounded
  campaign contract.
- When an optional provider is unavailable, continue from repository state and
  record that synchronization remains pending.
