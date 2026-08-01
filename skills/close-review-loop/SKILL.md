---
name: close-review-loop
description: "Drive an existing GitHub pull request and its configured independent review provider through evidence-backed closure. Use only for an existing pull request or an external provider or human review thread: address review comments, wait on CI, re-trigger the selected provider, validate an allowed GitHub human approval, resolve threads, or decide whether the existing change is ready to merge. Do not use for a local pre-PR independent review or as the top-level entry for a new delivery request; run-autonomous-delivery owns work from intent through pull request creation and calls this skill for closure."
---

# Close Review Loop

Close actionable risk, not merely comment count. A review provider is an
adversarial evidence source, not the release authority.

Read [references/review-closure-policy.md](references/review-closure-policy.md) before mutating a pull request.
When selected, also read:

- [references/coderabbit-provider.md](references/coderabbit-provider.md);
- [references/github-human-provider.md](references/github-human-provider.md).

## Procedure

1. Confirm branch, base, intended issue, current diff, locked intent, canonical
   closed decisions, full-gate evidence, and whether the user authorized push,
   PR creation, and merge. A reviewer suggestion does not authorize reopening
   a closed product decision.
2. Rebase or merge the latest base according to repository policy. Re-run the full gate after resolving conflicts.
3. Create or update a draft PR with:
   - outcome and scope;
   - requirement/issue links;
   - material decisions and non-goals;
   - exact verification evidence;
   - migration, rollback, and monitoring notes;
   - screenshots or recordings for visual changes;
   - known risks and explicit deferrals.
4. Read `.agent-stack/config.json` and wait for required CI plus an actual
   configured-provider review of the current head. Query review threads and
   check runs; do not rely on a summary, reaction, status context, or
   rate-limit comment. When installed and required, `review-receipt` must pass.
5. Validate each reviewer claim before acting. Open the cited file and inspect
   the surrounding control flow, data flow, callers, tests, and authoritative
   documentation. Reproduce the claim or run the smallest relevant test when
   practical. Never modify production code merely because a reviewer asserted
   a defect.
6. Normalize findings by root cause. Deduplicate only when the same change
   resolves the same claim.
7. Apply one exact canonical disposition and the response format from
   [references/review-closure-policy.md](references/review-closure-policy.md).
   Do not invent another bucket or substitute a synonym. Use
   `decision-needed` when evidence remains uncertain because resolving it
   crosses an authority boundary.
8. Apply fixes in a coherent batch. Run focused checks, then the full gate. Push once per verified batch.
9. Trigger a new review using the selected provider's contract. For
   CodeRabbit, request an incremental review after every verified push. For an
   allowed GitHub human, request a fresh approval through the repository's
   normal process. A stale review never counts.
10. Reply to findings with the canonical disposition plus fix commit or
    evidence. Resolve a thread only after the issue is actually closed.
11. Repeat until the closure contract holds. Provider-specific convenience
    commands never replace evidence or repository policy.

## Closure Contract

Ready to merge means:

- branch is current enough for repository policy;
- all required status checks pass;
- required human approvals exist;
- required conversations are resolved;
- no open Critical or Major finding remains;
- no open Minor finding affects correctness, security, privacy, reliability, data integrity, compatibility, accessibility, observability, or required tests;
- every remaining suggestion is explicitly rebutted or deferred with evidence;
- final pushed revision has full-gate evidence;
- the configured provider submitted a qualifying review whose commit matches
  the final pushed revision when external review is required;
- the provider-aware `review-receipt` check passes when required;
- merge authority is satisfied.

Do not auto-merge unless repository configuration or the user's current request explicitly grants that authority. If merge is not authorized, finish with a merge-ready PR and one clear human action.
