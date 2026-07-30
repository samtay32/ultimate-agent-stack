# Owner Release Guide

The agent prepares and verifies releases. The owner performs only npm account,
2FA, and final publication approvals.

## Fixed Public Identity

- Package: `ultimate-agent-stack`
- Repository: `https://github.com/samtay32/ultimate-agent-stack`
- License: MIT

MIT is intentionally permissive so people may use, modify, and redistribute
the stack while retaining the copyright and license notice.

## Why the First Release Is Different

npm cannot attach a trusted publisher or staged-publishing policy until the
package exists. Version `0.1.0` therefore needs one controlled bootstrap
publication. Every later release uses short-lived GitHub OIDC credentials and
npm staging.

The package-level `prepublishOnly` guard rejects an accidental direct
`npm publish` unless the exact package/version and release mode are supplied.
An npm owner can deliberately bypass local lifecycle scripts, so registry
account protections, 2FA, trusted publishing, and the protected workflow remain
the authoritative boundary.

## First-Release Bootstrap

Before the owner step, the agent must:

1. verify that the package name is still unclaimed;
2. confirm the source is committed and pushed to the public repository on
   `main`;
3. confirm the bootstrap machine has Node.js 22+ and npm 10.8+;
4. run every release, skill, plugin, Markdown, packed-install, archive, secret,
   adversarial safety, and behavioral-scenario contract check;
5. when the behavior-surface hash changed, run the documented representative
   smoke matrix through at least one real supported harness and attach its
   evidence with the exact harness and model identity;
6. inspect the exact `0.1.0` tarball and confirm the MIT license and repository
   metadata;
7. stop and report the exact hash and remaining owner step.

For a cross-harness flexible-intake compatibility claim, step 5 requires the
current minimum smoke matrix on at least two distinct primary supported
harnesses. Record them separately and list every untested scenario and harness.
No named harness is privileged by this release rule.

The owner then:

1. signs in to the npm account that will own the package;
2. enables two-factor authentication for authorization and publishing;
3. from the clean verified repository, runs:

   ```bash
   npm login --auth-type=web
   NPM_RELEASE_MODE=bootstrap \
   PUBLISH_CONFIRM=ultimate-agent-stack@0.1.0 \
   npm publish --access public
   npm logout
   ```

   Complete npm's browser and 2FA prompts. Never paste the password, recovery
   codes, or authenticator code into chat.

4. verifies `ultimate-agent-stack@0.1.0` on npm.

No long-lived npm token is created or stored in GitHub.

## Immediately After Bootstrap

The owner and agent configure:

1. npm trusted publishing for GitHub owner `samtay32`, repository
   `ultimate-agent-stack`, workflow `.github/workflows/publish.yml`, with
   **stage-only** maximum security;
2. the GitHub `npm` environment with the owner as required reviewer;
3. npm account and package publishing protections so 2FA remains required.

Current npm references:

- [Trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [Staged publishing](https://docs.npmjs.com/staged-publishing/)
- [Two-factor authentication](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)

## Every Later Release

The agent:

1. classifies the SemVer change and synchronizes npm, plugin, CLI, lockfile, and
   documentation versions;
2. runs the complete release and adversarial gate, including behavioral
   scenario contracts;
3. runs `npm run eval:contracts`. If the behavior-surface hash changed, runs
   the documented representative smoke matrix through the claim-scoped
   minimum number of real supported harnesses and attaches the smoke evidence
   to the pull request;
4. commits and pushes the reviewed source to `main`;
5. starts **Publish npm package** with the exact
   `ultimate-agent-stack@VERSION` input.

The flexible-intake Milestone 1 release contains 28 deterministic scenarios and
13 skills. Its cross-harness compatibility claim requires the four-case smoke
matrix from `BEHAVIORAL_EVALS.md` on at least two distinct primary supported
harnesses. This does not claim that the other scenarios ran live. The behavior
surface still includes shipped artifact templates, so changed behavior needs
fresh smoke evidence.

A primary supported harness is a supported coding-agent surface acting as the
user-facing Project Steward, not a subagent or provider adapter. Any supported
harness may count when a fresh ordinary CLI session in a temporary project
retains its exact version, model, request, output, file diff, and test result;
no vendor is privileged. The representative smoke does not require a custom
runner, network sandbox, signing key, or full-catalog evaluator record.

Deterministic unit tests prove the scenario schema, evaluator, package, and
guardrails. They do not prove that a model selected the right skill or followed
it. The live record supplies that separate behavioral evidence. A result
applies only to the named harness and model; it must not be generalized to
untested providers. A metadata-only release may cite the prior live result when
the behavior-surface hash is unchanged.

The owner approves the protected GitHub `npm` environment. GitHub uses
short-lived OIDC credentials to run `npm stage publish`. The owner then reviews
and approves the staged version through npm with 2FA. Publication never happens
silently.

After staging succeeds, the protected workflow creates a draft GitHub Release
bound to the exact staged commit. The hourly **Sync GitHub release** workflow
checks npm's public registry, package digest, publish attestation, SLSA
repository/workflow/branch identity, and provenance commit. Only then does it
publish the matching draft and mark the npm `latest` version as GitHub's latest
release. It may also be run manually for immediate synchronization after npm
approval.

The synchronization fails closed if a tag or draft points at a different
commit, npm cannot cryptographically verify the registry signature and
provenance, or attestation claims are inconsistent. A public historical version
without attestations is left as a draft without blocking later verified
releases. Synchronization never approves an npm stage and never publishes a
package.

The release job requires Node.js 22.14+ and npm 11.15+. Project users need
Node.js 22+.

## Project Upgrade

Tell the agent:

```text
Safely update Ultimate Agent Stack in this project. Inspect the registry
version and provenance, run the exact reviewed version, reconcile every
proposal, and verify the protected package files and project checks.
```

An upgrade never overwrites an existing differing managed file. It writes a
versioned proposal for the agent to reconcile and records removed package files
as orphans without deleting them.

The flexible-intake update adds the managed `develop-project-brief` skill and
the unlocked `.agent-stack/artifacts/BRIEF.md` template. A new destination is
installed normally; a pre-existing differing path is preserved for explicit
reconciliation. Existing completed configuration and active locks remain
valid, and direct small work does not add the working brief to the default lock
set. New or incomplete simple onboarding uses one combined repository-only
recommendation; advanced provider questions remain conditional on repository
evidence, an explicit request, or a requirement that cannot be met locally.
