# Risk-Adaptive Security Readiness

## Baseline for Every Project

- Inventory direct and transitive dependencies, licenses, provenance, and known
  vulnerabilities using the native package manager where practical.
- Scan tracked and packaged output for credentials, private keys, local paths,
  caches, generated evidence, and unrelated files.
- Keep production secrets outside code, client bundles, prompts, logs,
  artifacts, and verification evidence.
- Validate untrusted input at the server or trusted execution boundary and
  return errors that do not expose internals or sensitive data.
- Use least-privilege credentials and document rollback or recovery for
  material writes.

## Conditional Matrix

| Surface | Required evidence when it applies |
|---|---|
| Public network service | TLS at the public edge; appropriate security headers; bounded request size/time; abuse and rate-limit behavior; generic external errors |
| Browser session or cookie authentication | CSRF defense for state changes; secure cookie attributes; session expiry/revocation; CORS limited to required origins but never treated as authorization |
| Authentication | Negative tests for invalid credentials, account enumeration, expired/replayed verification or reset links, brute-force controls, and logout/revocation |
| Authorization | Denial tests for another user's objects, roles, administrative actions, and identifiers supplied directly by a caller |
| Multi-tenant data | Cross-tenant read/write denial tests at every public seam; datastore policy tests such as RLS only when that datastore is used; least-privilege service roles |
| Personal or regulated data | Data inventory, purpose/minimization, retention/deletion, access/export expectations, log redaction, breach surface, and human legal/compliance acceptance |
| Public forms | Server validation, bounded input, spam/automation controls proportionate to observed abuse, and safe error behavior |
| File uploads | Type and size enforcement, storage isolation, unsafe-content handling, filename/path safety, and authorized download tests |
| Webhooks | Signature verification, replay resistance, timestamp tolerance, idempotency, and secret rotation |
| Paid or metered APIs | Hard budget or usage cap where supported, per-user limits, alerts, timeout/retry bounds, idempotency, and safe degradation |
| Database writes | Constraints, authorization, transaction behavior, migration/rollback, backup/recovery, and injection-resistant parameterization |
| Third-party integrations | Minimal scopes, timeout/retry/circuit behavior, credential isolation, revocation, and vendor failure handling |
| AI features | Prompt and tool input boundaries, data disclosure controls, output validation before side effects, spend caps, and deterministic authorization outside the model |

## Evidence Rules

Prefer a deterministic automated denial test at the public seam. Use integration
tests, schema or policy tests, static analysis, rendered configuration
inspection, and exact manual reproduction only when stronger evidence is not
practical.

An AI-assisted review may propose findings. Reproduce each material finding or
trace it to exact code and configuration before treating it as evidence. A
clean scanner result never proves business-logic authorization, tenant
isolation, privacy compliance, or safe cost behavior.
