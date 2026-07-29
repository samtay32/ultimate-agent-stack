# External Intake and Existing-Code Reconciliation

## Preserve the Source

Read every supplied PRD, transcript, chat export, outline, notes file, or design
folder completely. Treat it as user-supplied evidence, not automatically locked
truth. Do not edit it unless the user explicitly asks.

For a repository source, record its project-relative path and SHA-256. For a
paste, attachment, or outside path, default to a redacted structured summary,
source kind, locator, and hash or retrieval reference. Copy source material
into the repository only when relevant, authorized, and safe to retain.

Never persist:

- credentials or credential-like values;
- raw private conversation history when a summary is sufficient;
- unrelated personal or licensed content;
- unbounded provider responses.

## Audit

Map the source into the shaping kernel:

- why, user, and outcome;
- capabilities;
- constraints and non-goals;
- assumptions;
- acceptance evidence;
- risk, rollout, and rollback.

Then test it for:

- internal contradictions;
- missing or non-falsifiable acceptance criteria;
- unsafe mechanisms;
- over-scoping;
- speculative implementation presented as intent;
- demo behavior presented as production behavior;
- requirements that sound complete but cannot be tested.

Show a concise kept, tightened, rejected, and deferred summary. Ask no generic
discovery question when the source already answers it.

## Reconcile with Repository Reality

When code exists, inspect actual behavior, architecture, schemas, migrations,
tests, project policy, and currently locked decisions. Classify each material
source claim as:

1. already implemented;
2. compatible addition;
3. material conflict requiring product-owner direction;
4. mistaken source assumption demonstrated by repository evidence.

Do not silently choose the source over working repository truth or vice versa.
A deliberate product change may override existing behavior after authority and
promotion; a mistaken assumption should be tightened with evidence.

Keep repository changes limited to the working brief until material conflicts
are resolved. Never overwrite existing architecture or requirements merely to
make the supplied source appear consistent.
