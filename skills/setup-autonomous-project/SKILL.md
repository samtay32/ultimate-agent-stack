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

   For a local, private, or straightforward project that does not require an
   existing external provider or production-specific review policy, and when
   the user has not requested a relevant advanced provider, make one combined
   recommendation:

   > I recommend the private repository-only setup. It uses no outside memory,
   > tracking, or telemetry, and you retain merge control. Use this?

   This one confirmation selects repository memory, repository work tracking,
   no telemetry, built-in review, local-only data, routine agent-owned
   execution, and human-controlled merge authority. After approval, use:

   ```bash
   node .agent-stack/bin/agent-stack.mjs configure \
     --preset simple \
     --reason "Approved the recommended simple project configuration"
   ```

   Do not then ask separate questions about GBrain, Linear, telemetry, review
   providers, data policy, or merge authority. The CLI records the
   conversational approval reason; it does not cryptographically authenticate
   who approved it.

   Reveal an advanced choice only when the repository already uses it and that
   evidence makes it relevant, the user explicitly requests it, or a real
   requirement cannot be met locally. Ask only the relevant consequential
   question, not a provider tour.

   For optional memory, explain repository checkpoints remain authoritative.
   Recommend project-scoped local GBrain only for a long-running build when the
   user wants private searchable cross-conversation memory.

   For optional work tracking, offer Linear only when the team already uses it
   and can create a Read-permission key for approved team keys. Recommend
   read-only. Ask separately about receipted issue creation or evidence comments
   only after Linear itself is selected; every write remains least-privilege,
   explicitly confirmed, coordinator-bound, authority-recorded, and receipted.

   For telemetry, offer only an existing configured PostHog, Sentry, or New
   Relic project that is needed for a concrete operational question. Never
   install instrumentation merely because an adapter exists.

   Always initialize and validate `.agent-stack/work-items.json` and
   `.agent-stack/evidence-graph.json`. If Linear is approved, configure
   `--work linear` with repeated `--linear-team KEY` and
   `--external-data approved_providers`, run `linear-setup`, wait for the human
   credential step, then verify with `linear-health` and `doctor`. Add repeated
   `--linear-write` values only for the operations the user approved. Never
   select or connect it implicitly.

   For advanced configuration, use:

   ```bash
   node .agent-stack/bin/agent-stack.mjs configure \
     --profile PROFILE \
     --review REVIEW_PROVIDER \
     --knowledge KNOWLEDGE_PROVIDER \
     --knowledge-scope SCOPE \
     --work WORK_PROVIDER \
     --linear-team LINEAR_TEAM_KEY \
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
   node .agent-stack/bin/agent-stack.mjs doctor
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
- Never install analytics merely because a provider is supported. Detect and
  recommend an existing project service; adding new instrumentation is a
  separate product, privacy, and deployment decision.

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
- optional telemetry is disabled or scoped read-only with repository evidence
  fallback;
- the repository work ledger and evidence graph validate and remain usable
  without an external provider;
- secret, billing, account, or deployment inputs are the only remaining user work.
