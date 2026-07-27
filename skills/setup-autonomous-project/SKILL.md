---
name: setup-autonomous-project
description: Configure a new or existing repository for high-autonomy software delivery. Use explicitly when the user asks to install, bootstrap, configure, or repair the Ultimate Agent Stack; add project instructions and quality gates; or prepare a repository so an agent can handle almost all routine work.
---

# Setup Autonomous Project

Configure the repository without erasing its conventions. Setup is complete only when the agent can identify the project, run real checks, preserve durable instructions, and explain any remaining authority-only inputs.

## Workflow

1. Inspect before changing anything.
   - Read root and nested instruction files, manifests, lockfiles, CI, tests, deployment files, and `git status`.
   - Treat existing content as authoritative. Never replace a project policy or configuration merely to install this stack.
2. Install the current package into the repository:

   ```bash
   npx -y ultimate-agent-stack@latest init
   ```

3. Reconcile, do not overwrite.
   - If setup reports a pending reconciliation, inspect its proposal under `.agent-stack/update-proposals/`.
   - Merge the proposed material into the existing file with the smallest coherent edit.
   - Keep project-specific architecture, terminology, risk rules, and commands.
   - Do not weaken an existing gate.
   - Record the reconciliation:

     ```bash
     node .agent-stack/bin/agent-stack.mjs adopt-managed \
       --path PATH \
       --reason "Explain what was preserved and adopted"
     ```

4. Detect capabilities and complete guided onboarding:

   ```bash
   node .agent-stack/bin/agent-stack.mjs capabilities
   ```

   Infer the safest project profile from repository evidence. Ask only choices
   that materially affect release protection, external data, provider access, or
   authority. Ask one at a time in plain language; recommend one option, offer
   at most one genuinely safe alternative, and explain the consequence. Record
   the approved choices.

   Always ask the memory choice in plain language:

   > Should this project remember progress only in its repository files, or
   > also use a private local searchable memory for easier continuation across
   > conversations?

   Recommend repository memory for a short or simple project. Recommend
   project-scoped local GBrain for a long-running build likely to span
   conversations. Explain that GBrain is optional, the repository checkpoint
   remains authoritative, and work still resumes when GBrain is unavailable.

   For a local prototype or straightforward project that does not require
   production release protection, external data, external memory, or delegated
   merge authority, recommend the simple setup. After the user approves that
   recommendation, use:

   ```bash
   node .agent-stack/bin/agent-stack.mjs configure \
     --preset simple \
     --reason "Approved the recommended simple project configuration"
   ```

   This preset retains the complete safety installation and selects standard,
   built-in review, repository knowledge, local-only data, agent-owned routine
   execution, and human-controlled merge authority. Do not use it when the
   repository evidence requires production review or an external provider.

   For advanced configuration, use:

   ```bash
   node .agent-stack/bin/agent-stack.mjs configure \
     --profile PROFILE \
     --review REVIEW_PROVIDER \
     --knowledge KNOWLEDGE_PROVIDER \
     --knowledge-scope SCOPE \
     --external-data POLICY \
     --reason "Record the user's approved project and provider choices"
   ```

   Add `--reviewer LOGIN` for each allowed GitHub human reviewer. Do not ask the
   user about knowledge scope unless GBrain is selected; default to `project`.
   Use `organization` only with explicit external-data approval. Do not ask the
   user to name a technical provider when the repository and availability
   evidence support a recommendation.

   When project-scoped GBrain is approved, obtain the guarded setup plan:

   ```bash
   node .agent-stack/bin/agent-stack.mjs memory-setup \
     --harness DETECTED_HARNESS
   ```

   Verify the current official GBrain installation instructions, obtain
   explicit approval before a missing global CLI is installed, then execute
   the plan. Use its project-local home and restricted launcher. Merge MCP
   configuration into existing project settings; never replace them. Do not
   install GBrain's autonomous queue, complete skill pack, dream cycle, or
   updater merely to provide memory.
5. Detect the real command surface:

   ```bash
   node .agent-stack/bin/agent-stack.mjs detect --write
   npx -y ultimate-agent-stack@latest doctor
   ```

   Inspect every configured argument array and any delegated package-script
   definition. Reject direct shells, destructive, or unrelated commands. Then
   record approval:

   ```bash
   node .agent-stack/bin/agent-stack.mjs approve-checks \
     --reason "Inspected project-native quality command definitions"
   ```

   Add missing test, lint, type, build, migration, or security tooling only when
   standard for the detected stack and proportionate to the project.
6. Run the baseline:

   ```bash
   node .agent-stack/bin/agent-stack.mjs verify
   ```

   Fix setup-caused failures. Record genuinely pre-existing failures with evidence; never relabel them as passing.
7. Apply `$secure-launch`. Classify every risk surface in
   `.agent-stack/artifacts/SECURITY.md`, record not-applicable surfaces with
   evidence, and add only the proportionate deterministic gates.
8. Adapt harnesses only after the portable core works. Read [references/setup-contract.md](references/setup-contract.md) for supported locations and trust boundaries.
9. Finish with a concise handoff containing the detected stack, configured
   providers, commands, gates, preserved conflicts, missing credentials or
   services, and the exact starter prompt. Start the Project Steward lease,
   write the first deterministic checkpoint, and retain its token only in the
   primary conversation.

## Autonomy Rules

- Do routine discovery, configuration, dependency setup, test execution, and documentation without asking the user.
- The npm CLI is non-interactive. The coding agent owns the conversation and
  uses the CLI only to validate and persist approved choices.
- Ask only when a choice changes product intent, spends money, exposes data, grants credentials, accepts legal/compliance risk, deletes material data, or publishes externally without prior authority.
- Prefer existing package managers and pinned dependencies. Do not install arbitrary community skills or global tools silently.
- Treat the user as the source of desired outcomes, not as a technical safety
  approver. If a requested mechanism would weaken a guardrail, recommend the
  closest safe implementation and continue what is safe.
- A green self-check is not a substitute for project tests. If no real project check exists, setup remains incomplete.
- Never claim universal compatibility. Report the detected and actually tested environment.

## Completion Contract

Setup is done when:

- project instructions are present and reconciled;
- guided onboarding is complete and provider choices have a current approval
  hash;
- `.agent-stack/config.json` contains real project checks;
- required artifacts and GitHub templates exist or preserved equivalents are documented;
- `doctor` passes all applicable checks;
- baseline verification has evidence;
- launch-security surfaces are classified and applicable gates have evidence;
- a required review provider is available, while optional knowledge has a
  verified repository fallback;
- secret, billing, account, or deployment inputs are the only remaining user work.
