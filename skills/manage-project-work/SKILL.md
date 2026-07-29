---
name: manage-project-work
description: Plan, update, inspect, or check provider-write readiness for actual project work while preserving a portable repository ledger and evidence graph. Use when turning intent into work items, choosing the next bounded slice, recording progress or blockers, linking requirements to implementation and verification, reconciling external work tracking, reporting or diagramming what repository evidence supports a real work item, or starting/refusing a bounded campaign. Do not activate for explanation-only questions or coordinator-lease disputes; answer a requested concept directly, and let run-autonomous-delivery enforce the active-writer lease during delivery.
---

# Manage Project Work

Use one provider-neutral work vocabulary. The configured provider may organize
work, but it does not expand execution, merge, deployment, or release authority.

## Workflow

1. Read `.agent-stack/config.json`, `.agent-stack/work-items.json`,
   `.agent-stack/evidence-graph.json`, and
   [references/work-evidence-contract.md](references/work-evidence-contract.md).
   If the configured provider is Linear, also read
   [references/linear-readonly-provider.md](references/linear-readonly-provider.md).
   If receipted writes are enabled, also read
   [references/linear-receipted-writes.md](references/linear-receipted-writes.md).
2. Run:

   ```bash
   node .agent-stack/bin/agent-stack.mjs work validate
   node .agent-stack/bin/agent-stack.mjs evidence validate
   node .agent-stack/bin/agent-stack.mjs receipts validate
   ```

   Stop and repair malformed repository state before relying on it.
   When Linear is configured, also run `linear-health`. If it is unhealthy,
   continue from repository state and mark synchronization pending.
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
10. When a human-readable map helps, run `evidence report`. Use JSON for a
    compact coverage summary or bounded Mermaid for a diagram. Never describe
    the derived report as stronger proof than its referenced artifacts.

## Bounded Campaigns

Use campaign mode only when several already-shaped work items should be
delivered sequentially:

1. Start with an objective, an explicit 1–25 iteration bound, and the active
   coordinator token.
   If the user requests an unbounded campaign or omits the bound, refuse the
   unbounded loop and ask one plain-language question for a finite bound.
   Recommend the smallest useful bound from the shaped ready work, with five
   iterations as the default ceiling when repository evidence does not support
   a smaller number. End the response with the direct question: "How many
   iterations should this campaign run? I recommend no more than five." Do not
   start until the user chooses.
2. Ask `campaign next` to select one `ready` item whose dependencies are
   `done`.
3. Finish the selected item through normal evidence and review gates.
4. Call `campaign next` again. It returns the same item while work remains
   active, stops at the bound, and returns `decision-needed` when no safe item
   is eligible.

Campaign commands update repository state only. Never synchronize an external
provider implicitly.

## Hard Boundaries

- Repository work tracking is the fully supported default.
- A work provider never grants authority to edit code, mutate remote work,
  merge, deploy, release, or change project scope.
- A configured write operation still requires the active coordinator token,
  explicit external-write confirmation, and a recorded authority source.
- Do not invent a status, priority, node kind, node state, or edge relation.
- Do not store credentials, raw telemetry, personal data, prompt transcripts,
  or remote payloads in either repository file.
- Do not infer completion from a provider status alone.
- Do not silently broaden scope, select unready work, or loop without a bounded
  campaign contract.
- When an optional provider is unavailable, continue from repository state and
  record that synchronization remains pending.
