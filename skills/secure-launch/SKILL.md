---
name: secure-launch
description: Derive and verify proportionate security, privacy, abuse, cost, and supply-chain gates before a software project is launched or materially exposed. Use for public applications, authentication, multi-tenant data, personal or regulated data, uploads, webhooks, paid APIs, production deployment, or an explicit launch/security-readiness review.
---

# Secure Launch

Make launch security conditional on real exposure. Do not impose web controls on
an offline tool or accept a generic scanner result as proof.

Read [references/security-readiness.md](references/security-readiness.md) before
setting gates or declaring readiness.

## Workflow

1. Inspect architecture, deployment, data flows, authentication, dependencies,
   external APIs, logs, secrets, and existing security tests.
2. Classify every surface in `.agent-stack/artifacts/SECURITY.md` as
   `applies`, `not-applicable`, or `unknown`, with repository evidence.
3. Resolve `unknown` from code and authoritative documentation. Ask the user
   only for product, legal, data-use, credential, spending, or risk acceptance
   that cannot be inferred safely.
4. Derive only the applicable controls from the reference matrix. Prefer
   deterministic negative tests at authorization and data boundaries.
5. Implement missing controls without changing product scope. Record commands,
   artifacts, expected denial behavior, and results in the security artifact
   and verification matrix.
6. Run project-native checks and the full configured gate. Treat static or
   AI-assisted scanners as supplemental findings that require reproduction or
   code-level evidence.
7. Return `READY` only when every applicable gate passes and no material
   security, privacy, abuse, cost, or supply-chain risk is merely assumed away.

## Guardrails

- Treat CORS as a browser response-sharing policy, not authentication,
  authorization, or a complete CSRF defense.
- Require row-level security only when the selected datastore and access model
  use it; always test object- and tenant-level authorization at the application
  boundary.
- Require CAPTCHA only for an abuse-prone public interaction when proportionate.
- Never copy secrets into prompts, artifacts, evidence, logs, or pull requests.
- Never make a vendor-specific AI scanner mandatory. Use an available,
  authoritative tool only as defense in depth.
- Leave legal, regulatory, license, and material privacy acceptance to the
  human while preparing the evidence and safest recommendation.

## Exit Contract

Return the classified risk surfaces, required gates, evidence, failed or
untested boundaries, residual risk, and a binary `READY` or `NEEDS WORK`
decision.
