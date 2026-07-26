# Setup Contract

## Portable Core

Install these repository-owned files first:

- `AGENTS.md`: durable project rules, architecture constraints, real commands, and authority boundaries.
- `.agent-stack/config.json`: machine-readable checks and autonomy policy.
- `.agent-stack/artifacts/`: delivery, architecture, decisions, and verification contracts.
- `.agent-stack/bin/agent-stack.mjs`: deterministic detection, lock, doctor, and verification CLI.
- `.agent-stack/core-policy.json`: protected mechanical safety rules.
- `.github/pull_request_template.md`: evidence-oriented PR contract.
- `.coderabbit.yaml`: review defaults.

The setup command is non-destructive. When a destination exists, it preserves
the file and writes a proposed copy under
`.agent-stack/update-proposals/<version>/`. The agent must reconcile it
deliberately and record the result with `adopt-managed`. Upgrades replace only
files that still match their last accepted hash; they never silently delete a
file removed by a newer package.

## Harness Adapters

The skills use the Agent Skills directory format. Copy or install the skill directories at the harness-supported project location:

- Codex: `.agents/skills/`; Codex plugins can package the same `skills/` directory.
- Claude Code: `.claude/skills/`.
- Grok: `.grok/skills/`; Grok also reads `.agents/skills/` and Claude-compatible locations.
- Cursor: rely on root `AGENTS.md`; add small `.cursor/rules/*.mdc` or `.cursor/commands/*.md` adapters only if the current Cursor version does not discover the skills directly.

Do not duplicate the entire workflow into each harness rule. Keep `AGENTS.md`, `.agent-stack/`, and the skill source canonical; adapters should only point to them.

## Trust Boundaries

- Project instructions and hooks are executable influence. Review them before trusting a repository.
- Never copy secrets into instructions, artifacts, evidence, prompts, or PRs.
- Do not auto-approve package installation scripts from unknown sources.
- Inspect quality-command argument arrays before `approve-checks`. The CLI
  rejects direct shell and known destructive executables. Package-manager
  scripts may invoke their platform shell, so the exact delegated script
  definition is fingerprinted and must be reapproved after it changes.
- Verification receives a scrubbed environment. Project checks are still
  executable project code; use the agent harness's OS or container sandbox for
  an untrusted repository.
- Do not grant broad shell, network, or write permissions merely to suppress prompts.
- Keep external publishing, billing, production deployment, data deletion, and credential grants behind explicit policy.

## Baseline Gate

A baseline is valid only if:

1. the command exists in the project's declared toolchain;
2. it is non-interactive under `CI=1`;
3. it returns nonzero on a known failing fixture or negative test;
4. it covers product behavior, not only stack metadata;
5. its output is captured as evidence without leaking secrets.
