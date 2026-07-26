---
name: build-vertical-slice
description: Implement one complete, testable software slice while preserving a locked acceptance contract. Use for feature work, fixes, refactors, migrations, or operational changes after intent is clear and before full-system verification.
---

# Build Vertical Slice

Produce the smallest end-to-end increment that proves user or operator value.

## Before Editing

1. Read project instructions, the locked delivery artifact, relevant modules, nearby tests, and current diff.
2. State the slice outcome, public test seam, files likely affected, risks, and focused verification command.
3. Check the artifact lock:

   ```bash
   node .agent-stack/bin/agent-stack.mjs check-lock
   ```

If implementation requires changing intent, stop editing, record the discovery, unlock with a reason, and reshape.

## Build Loop

1. Add or identify a test that can fail for the missing behavior. For behavior changes, see it fail for the right reason.
2. Implement the simplest complete path through the system.
3. Make the focused test pass.
4. Refactor only while green. Prefer a deep module with a small interface over layers of forwarding abstractions.
5. Update user, API, schema, migration, operational, or architecture documentation in the same slice.
6. Run nearby lint, type, and test checks.
7. Inspect the diff for unrelated changes and accidental generated or secret files.

## Special Cases

- **Bug:** reproduce the exact reported symptom with a fast deterministic loop; form falsifiable hypotheses; change one variable; add a regression test.
- **Migration:** use expand-contract when old and new versions can overlap; define rollback, backfill, compatibility, and idempotency.
- **Refactor:** preserve behavior with characterization tests; separate mechanical moves from semantic changes.
- **UI:** verify empty, loading, error, keyboard, responsive, and accessibility states; capture visual evidence.
- **External API:** confirm current official behavior; bound retries and timeouts; make idempotency and partial failure explicit.
- **Security-sensitive:** model trust boundaries and abuse cases; do not log secrets or sensitive payloads.

Read [references/implementation-methods.md](references/implementation-methods.md) for TDD, debugging, changeability, and migration rules.

## Exit Contract

The slice is complete when its behavior is demonstrable, focused checks pass, docs and migrations are current, the lock still matches, and the repository remains runnable. Full-suite and review closure belong to `$verify-change` and `$close-review-loop`.
