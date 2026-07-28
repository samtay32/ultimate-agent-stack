# Security Policy

## Supported Version

Ultimate Agent Stack is pre-1.0. Security fixes are provided for the latest
published version. Upgrade to the newest release before reporting a problem
that may already be resolved.

## Report a Vulnerability Privately

Do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/samtay32/ultimate-agent-stack/security/advisories/new).

Include:

- the affected package version;
- the operating system and Node.js version;
- the smallest safe reproduction;
- the expected and actual behavior;
- the security impact and any known prerequisites.

Do not include live credentials, private repository contents, personal data, or
production secrets. Use harmless fixtures and redacted evidence.

The maintainer will validate the claim against the current code, coordinate a
fix and disclosure when appropriate, and credit the reporter unless anonymity
is requested. No response-time guarantee is offered for this volunteer project.

## Security Boundary

The CLI enforces the controls described in
[docs/TRUST.md](docs/TRUST.md). Those controls are a command and project-file
policy, not an operating-system sandbox. Reports about containment, command
validation, managed-file integrity, evidence redaction, release provenance, or
coordinator isolation are in scope.

Unsafe behavior in an approved project script or permissions granted by an
agent harness may require a fix in that project or harness rather than this
package. Report uncertain cases privately so the boundary can be established
without exposing users.
