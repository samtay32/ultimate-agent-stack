# CodeRabbit Provider

Use only when `.agent-stack/config.json` selects `coderabbit`.

- `@coderabbitai review`: request an incremental review after a verified fix
  batch.
- `@coderabbitai full review`: request a full review after a major rebase, large
  rewrite, or uncertain coverage.
- `@coderabbitai pause` / `@coderabbitai resume`: control automatic reviews
  during noisy intermediate work.
- `@coderabbitai resolve`: resolve CodeRabbit threads only after verifying
  closure.
- `@coderabbitai approve`: use only when the repository enables that workflow
  and all actionable issues are closed.

Check current official documentation before relying on command semantics. Do not
spam triggers while a review is running. A rate or quota limit is a blocker:
wait for capacity, then request a review of the final head again. A summary,
walkthrough, reaction, or rate-limit comment is not a review receipt.
