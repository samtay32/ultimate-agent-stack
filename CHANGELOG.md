# Changelog

All notable changes to Ultimate Agent Stack are documented here.

## 0.2.0 - 2026-07-26

### Added

- A dependency-free review-receipt evaluator that verifies CodeRabbit submitted
  an actual review against the current pull-request head.
- A protected installed-project workflow that rejects missing, stale,
  rate-limited, change-requested, unresolved, or incomplete review evidence.
- A manual receipt re-evaluation path for GitHub's silent review-thread
  resolution case.
- Repository and installed-project workflow synchronization tests.

### Changed

- The repository now uses the assertive CodeRabbit profile instead of falling
  back to organization defaults.
- Every fix push invalidates the prior CodeRabbit receipt and requires another
  review of the new head.
- Receipt workflows execute the evaluator only from the protected default
  branch and use concurrency control to supersede noisy intermediate events.

### Upgrade impact

This is a compatible minor release. Existing projects receive versioned
proposals for changed managed files and the new protected receipt files.
Upgrade does not overwrite an existing differing file; the agent must reconcile
each proposal and rerun project verification.

## 0.1.0 - 2026-07-25

- Initial public release of the guarded, project-adaptive agent workflow.
