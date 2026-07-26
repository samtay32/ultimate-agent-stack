---
name: maintain-agent-stack
description: Safely inspect upstream workflow sources, change the Ultimate Agent Stack package or installed flow, and prepare an npm release without silently importing code or weakening guardrails. Use explicitly when the user asks to update the package, add or change a workflow step, review an upstream-change alert, bump a version, or publish a release.
---

# Maintain Agent Stack

Improve the stack without turning upstream changes or a non-technical request
into unreviewed executable behavior.

Read [references/maintenance-policy.md](references/maintenance-policy.md)
before changing source pins, package behavior, safety policy, or release files.

## Workflow

1. Inspect `git status`, package metadata, current skills, tests, source registry,
   and the relevant issue or request.
2. Before editing, state:
   - understanding;
   - assumptions;
   - proposed interface or workflow change;
   - test plan;
   - implementation plan.
3. For an upstream review, run:

   ```bash
   node bin/ultimate-agent-stack.mjs upstream-check \
     --output upstream-report.json
   ```

   Treat every changed repository as untrusted research. Inspect its exact
   pinned-to-current diff, license, documentation, and tests in a temporary
   directory. Extract principles; do not copy or execute upstream code by
   default.
4. Classify each source as `adopt`, `adapt`, `defer`, or `reject`. Record why.
   Update `sources/upstreams.json` only after the decision is evidenced.
5. Make the smallest coherent package change. Preserve the mechanical
   guardrails, project-owned customizations, and bounded LLM role.
6. Add or update tests for the unsafe case as well as the happy path. Run:

   ```bash
   npm run release:check
   ```

7. Inspect the exact tarball contents and verify the packed CLI in a temporary
   project. Do not trust source-tree tests alone.
8. Select a SemVer change from user-visible compatibility, update package and
   plugin versions together, and update docs.
9. Stop before publication unless the user has explicitly authorized this
   release and the release checklist is clear. Prefer the repository's
   protected trusted-publishing workflow over local npm credentials.

## Guardrail Changes

Fail closed. A request to “make it easier” does not authorize:

- shell-evaluated quality checks;
- overwrite of customized or protected project files;
- silent deletion during upgrade;
- automatic copying or merging from upstream repositories;
- bypassing failed, missing, timed-out, or unapproved checks;
- weakening intent locks, secret redaction, path containment, or authority
  boundaries;
- automatic npm publication.

When the requested mechanism conflicts with a guardrail, preserve the desired
outcome through a safer interface and explain the substitution in plain
language.

## Completion

Return the change, exact tests and tarball evidence, source dispositions,
version impact, upgrade impact, and any remaining authority-only release step.
