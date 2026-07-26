# Maintenance Policy

## Upstream Disposition

For each monitored source:

| Decision | Meaning |
|---|---|
| `adopt` | The pattern is compatible, licensed, directly useful, and can be implemented with its constraints intact. |
| `adapt` | The principle is useful, but the implementation must be rewritten for this package's portable and guarded architecture. |
| `defer` | Potentially useful, but not justified by current users, evidence, or complexity. |
| `reject` | Conflicts with safety, simplicity, licensing, portability, or the product contract. |

Record the exact compared commits and evidence. A newer commit is not evidence
that it belongs in the package. Never run install scripts or arbitrary
repository code merely to inspect a source.

## Versioning

- Patch: compatible bug fix, documentation correction, safety hardening without
  interface incompatibility, or source-pin review with no user workflow change.
- Minor: new compatible command, skill, harness adapter, or workflow capability.
- Major: removed/renamed command, incompatible config or manifest change, or
  upgrade behavior requiring manual migration for normal users.

Keep `package.json`, `.codex-plugin/plugin.json`, the copied CLI fallback
version, documentation, and release notes synchronized.

## Upgrade Compatibility

The upgrade engine creates missing files but never overwrites an existing file
whose bytes differ from the new package source. Every differing file gets a
proposal under `.agent-stack/update-proposals/<version>/`, regardless of
project-editable manifest claims. Removed package files become recorded
orphans; they are never deleted automatically.

Protected mechanical policy and the installed CLI cannot be adopted in a
customized state. Reconcile them to the reviewed package proposal exactly.

## Release Checklist

1. Scope and working tree are understood; unrelated user changes are preserved.
2. Package name ownership and actual repository metadata are confirmed.
3. The user has chosen a public license; `UNLICENSED` blocks publication.
4. No secret, local cache, test artifact, or unrelated file appears in the
   tarball.
5. Lint, unit tests, skill validation, plugin validation, Markdown validation,
   and packed-install smoke tests pass.
6. Package and plugin versions agree and the changelog explains upgrade impact.
7. The one-time first-release bootstrap is owner-authenticated with 2FA, or
   stage-only GitHub trusted publishing is configured for the exact repository
   and workflow; no long-lived npm token is added.
8. The human explicitly authorizes the named package version. Merge, release,
   and publication remain separate authority actions unless repository policy
   already grants them.

## Conversational Maintenance

Translate requests such as “add this repo,” “make it skip the annoying check,”
or “publish the update” into outcome, compatibility, safety, and authority
questions. In plain language, recommend one safe default, offer at most one
genuinely safe alternative, and ask only the decision that genuinely requires
the owner. Never manufacture an unsafe alternative. Complete all independent
inspection and validation first.
