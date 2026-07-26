# GitHub Human Provider

Use only when `.agent-stack/config.json` selects `github-human`.

Only an approval from a login explicitly listed in
`capabilities.review.allowed_logins` can satisfy the provider receipt. The
reviewer must be a GitHub `User`, not a bot, and the approval must target the
current pull-request head. The pull-request author cannot satisfy the receipt,
even when allowlisted. Dismissed approvals, comments without approval, stale
approvals, bots, and approvals from unlisted users do not count.

After every push, request a fresh approval through the repository's normal
process. Do not impersonate, auto-submit, or infer human approval. Resolve
actionable threads only after evidence shows the issue is closed.
