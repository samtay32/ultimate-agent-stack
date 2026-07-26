---
name: close-review-loop
description: Drive a GitHub pull request and CodeRabbit review through evidence-backed closure. Use when creating or updating a PR, addressing review comments, waiting on CI, re-triggering CodeRabbit, resolving threads, or deciding whether a change is ready to merge.
---

# Close Review Loop

Close actionable risk, not merely comment count. CodeRabbit is an adversarial reviewer, not the release authority.

Read [references/review-closure-policy.md](references/review-closure-policy.md) before mutating a pull request.

## Procedure

1. Confirm branch, base, intended issue, current diff, full-gate evidence, and whether the user authorized push, PR creation, and merge.
2. Rebase or merge the latest base according to repository policy. Re-run the full gate after resolving conflicts.
3. Create or update a draft PR with:
   - outcome and scope;
   - requirement/issue links;
   - material decisions and non-goals;
   - exact verification evidence;
   - migration, rollback, and monitoring notes;
   - screenshots or recordings for visual changes;
   - known risks and explicit deferrals.
4. Wait for required CI and an actual CodeRabbit review of the current head.
   Query review threads and check runs; do not rely on a summary, reaction,
   status context, or rate-limit comment. When installed, `review-receipt` must
   pass.
5. Normalize each finding by root cause. Deduplicate only when the same change resolves the same claim.
6. Disposition findings:
   - **fix:** valid and in scope;
   - **rebut:** false positive, with code/test/docs evidence;
   - **defer:** valid but outside the locked scope, with an authorized issue and risk statement;
   - **decision needed:** changes intent, public contract, data safety, security posture, cost, or release authority.
7. Apply fixes in a coherent batch. Run focused checks, then the full gate. Push once per verified batch.
8. Ask CodeRabbit for an incremental review by commenting:

   ```text
   @coderabbitai review
   ```

   Use `@coderabbitai full review` after a major rebase or when review coverage is uncertain. Do not spam triggers while a review is running.
   A rate or quota limit is a blocker: wait for capacity and request the review
   again.
9. Reply to findings with the fix commit or evidence. Resolve a thread only after the issue is actually closed.
10. Repeat until the closure contract holds. Use `@coderabbitai approve` only when CodeRabbit's request-changes workflow is configured and all of its actionable threads are closed.

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
- CodeRabbit submitted a review whose commit matches the final pushed revision;
- the `review-receipt` check passes when the repository provides it;
- merge authority is satisfied.

Do not auto-merge unless repository configuration or the user's current request explicitly grants that authority. If merge is not authorized, finish with a merge-ready PR and one clear human action.
