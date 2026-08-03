Before material delivery, read `AGENTS.md`, `.agent-stack/core-policy.json`,
`.agent-stack/config.json`, any valid checkpoint, and the current diff. Run the
local CLI `start` to acquire the Project Steward lease/token, then `doctor`.
Load only route-relevant artifacts; use configured knowledge only when the next
decision needs it. Deliver through implementation, deterministic verification,
and a review-ready pull request. For consequential choices, recommend one safe
choice and at most one useful alternative. Make routine reversible decisions,
stop only at the authority boundaries in `AGENTS.md`, and never claim completion
without evidence.
