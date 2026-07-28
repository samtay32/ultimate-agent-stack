# Behavioral Evaluations

Ultimate Agent Stack ships instructions that influence how a coding agent
selects skills and behaves. CLI unit tests can prove file containment, hashes,
configuration, and release controls. They cannot prove that a model activates
the right skill, avoids a false activation, or respects an authority boundary.

The evaluation design keeps those claims separate.

| Evidence layer | What it proves | What it does not prove |
|---|---|---|
| Contract gate | The scenario catalog is valid, covers every required case, references real skills, contains a false-activation case, and is bound to the current behavior surface | That any model passed the scenarios |
| Live run | The named harness and model produced the recorded activation, action, question, and outcome observations for the current surface hash | Behavior of another harness, model, version, prompt, or tool environment |

## Scenario Set

[`evals/scenarios.json`](../evals/scenarios.json) contains user-like requests
without `$skill-name` answers embedded in them.

| Category | Risk being tested |
|---|---|
| Direct | An explicit setup or delivery request selects the correct entry skill |
| Indirect | A plain-language outcome request still selects the correct skill |
| Incomplete | Missing product intent causes shaping and one useful question before writes |
| Negative | An explanation-only request does not start delivery or setup |
| Edge | Pressure to delete tests or bypass review does not weaken the gate |
| Authority | Preparing a release does not silently authorize merge or publication |
| Continuity | A second conversation does not write through another active coordinator |
| Existing project | Setup reconciles project-owned instructions and CI instead of overwriting them |

Every scenario defines:

- skills that must and must not activate;
- whether a clarifying question is required, forbidden, or allowed;
- actions that must not be performed;
- observable outcome tags required for a pass.

The negative case makes false activation a first-class failure. Adding more
positive examples cannot compensate for an agent starting work when it should
not.

## Deterministic Contract Gate

Run:

```bash
npm run eval:contracts
```

This command:

1. validates all scenario and expectation fields;
2. reads the actual skill frontmatter and rejects unknown skill names;
3. requires all eight categories and at least one false-activation case;
4. rejects prompts that disclose a `$skill-name` command;
5. prints a SHA-256 hash over the behavioral surface.

The behavioral surface includes skills and their references, entry prompts,
installed project instructions, native harness adapters, core policy, plugin
behavior metadata, and the scenario catalog. The package version is excluded,
and text line endings are normalized, so a metadata-only release or equivalent
Windows checkout does not invalidate otherwise identical evidence.

`npm run release:check` runs this contract gate. Passing it is necessary but is
not behavioral proof.

## Record a Real Harness Run

Create a blank record:

```bash
npm run eval:scaffold > /safe/temporary/path/uas-run.json
```

For each scenario, give the real harness the exact `request` plus `context` in
an isolated disposable project appropriate to that case. Do not show the
`expected` block to the agent. Record:

- `activated_skills` from the harness trace or explicit skill loading record;
- `asked_clarifying_question` from the actual response;
- `performed_actions`, meaning actions that occurred, not actions merely
  proposed or refused;
- `outcome_tags` only when the observable outcome occurred;
- a concise evidence summary and a transcript, trace, or run identifier.

Then evaluate it:

```bash
npm run eval:behavior -- --input /safe/temporary/path/uas-run.json
```

The evaluator fails when a required scenario is missing, a forbidden skill
activates, a required skill does not activate, a question rule is violated, a
forbidden action occurs, an outcome is absent, or the behavior-surface hash is
stale.

The evaluator validates the recorded observations against the contract and
includes each evidence source in its output. It cannot authenticate that a
collector described a run truthfully. A reviewer must be able to inspect the
named trace or transcript. Placeholder harness identities and scaffold evidence
are rejected.

Run records can contain model output or operational details. Redact secrets and
private project data before attaching evidence to a pull request. Do not commit
raw transcripts merely to make a gate green.

## Release Readiness

When a pull request changes the behavior-surface hash:

1. run the deterministic contract gate;
2. run all scenarios through at least one real supported harness;
3. evaluate the record;
4. attach the evaluator output and identify the exact harness, harness version,
   model, and model version or alias;
5. state which supported harnesses were not tested.

A release with an unchanged behavior-surface hash may cite the previous live
result. A release with changed skills, entry prompts, adapters, project policy,
or scenarios needs new live evidence.

This is intentionally not an ambient model call inside ordinary CI. Such a call
would add credentials, cost, nondeterminism, provider dependence, and a risk of
treating flaky output as a deterministic safety control. A future provider
adapter may automate collection, but it must still emit the same portable run
record and identify its exact scope.
