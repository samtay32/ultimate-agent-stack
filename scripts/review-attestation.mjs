#!/usr/bin/env node

import {
  existsSync,
  linkSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  commandEvidenceValidate,
  commandReceiptsValidate,
} from "../bin/ultimate-agent-stack.mjs";
import {
  CAPABILITY_PREFLIGHT_PAYLOAD_KIND,
  CAPABILITY_PAYLOAD_KIND,
  CODEX_ISOLATED_SESSION_ADAPTER,
  CODEX_NATIVE_ADAPTER,
  REVIEW_PAYLOAD_KIND,
  ReviewAttestationError,
  canonicalPayloadSerialization,
  capabilityPreflightAttestationSha256,
  collectCapabilityAttestationPayload,
  collectCapabilityPreflightPayload,
  collectCodexReviewAttestationPayload,
  inspectCapabilityFinalProjectState,
  inspectFinalProjectState,
  sha256Bytes,
  signReviewAttestation,
  verifyCapabilityAttestation,
  verifyCapabilityPreflightAttestation,
  verifyReviewAttestation,
} from "../lib/review-attestation.mjs";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const OUTER_ONLY_NOTICE =
  "Outer-only review attestation collector; never install or copy this signer into a project.";

function parseArguments(args) {
  const command = args[0];
  if (
    ![
      "collect-sign",
      "capability-preflight-sign",
      "capability-sign",
      "verify",
    ].includes(command)
  ) {
    throw new Error(
      "Usage: review-attestation.mjs collect-sign|capability-preflight-sign|capability-sign|verify [outer-only options]",
    );
  }
  const options = { allowPostReviewPaths: [] };
  const booleanOptions = new Set(["--allow-unavailable"]);
  const repeatedOptions = new Set(["--allow-post-review"]);
  const knownOptions = new Set([
    "--adapter",
    "--trace",
    "--stderr",
    "--target",
    "--candidate",
    "--expected",
    "--capabilities",
    "--preflight",
    "--private-key",
    "--attestation",
    "--keyring",
    "--output",
    ...booleanOptions,
    ...repeatedOptions,
  ]);
  for (let index = 1; index < args.length; index += 1) {
    const name = args[index];
    if (!knownOptions.has(name)) {
      throw new Error(`Unknown option: ${name}`);
    }
    if (booleanOptions.has(name)) {
      options.allowUnavailable = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    index += 1;
    if (repeatedOptions.has(name)) {
      options.allowPostReviewPaths.push(value);
      continue;
    }
    const key = name
      .slice(2)
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (options[key] !== undefined) {
      throw new Error(`${name} may be supplied only once`);
    }
    options[key] = value;
  }
  return { command, options };
}

function requireOptions(options, names) {
  const missing = names.filter(
    (name) => typeof options[name] !== "string" || options[name].length === 0,
  );
  if (missing.length > 0) {
    throw new Error(`Missing required outer-only options: ${missing.join(", ")}`);
  }
}

function inside(root, file) {
  const relation = relative(root, file);
  return (
    relation === "" ||
    (!isAbsolute(relation) &&
      relation !== ".." &&
      !relation.startsWith(`..${sep}`))
  );
}

function externalRealFile(raw, target, label, { privateKey = false } = {}) {
  if (typeof raw !== "string" || raw.length === 0 || !isAbsolute(raw)) {
    throw new Error(`${label} must be an absolute outer-controlled path`);
  }
  if (!existsSync(raw) || lstatSync(raw).isSymbolicLink()) {
    throw new Error(`${label} must be an existing non-symlink file`);
  }
  const file = realpathSync(raw);
  if (!statSync(file).isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
  if (target && inside(realpathSync(resolve(target)), file)) {
    throw new Error(`${label} must remain outside the project`);
  }
  if (
    privateKey &&
    process.platform !== "win32" &&
    (statSync(file).mode & 0o077) !== 0
  ) {
    throw new Error(`${label} must not be group- or world-accessible`);
  }
  return file;
}

function readJsonFile(file, label) {
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value;
}

function optionalExternalBytes(raw, target, label) {
  if (!raw) {
    return Buffer.alloc(0);
  }
  return readFileSync(externalRealFile(raw, target, label));
}

function writeOuterJson(raw, target, value) {
  if (typeof raw !== "string" || raw.length === 0 || !isAbsolute(raw)) {
    throw new Error("output must be an absolute outer-controlled path");
  }
  const output = resolve(raw);
  const canonicalTarget = realpathSync(resolve(target));
  const parent = resolve(dirname(output));
  if (inside(canonicalTarget, output)) {
    throw new Error("attestation output must remain outside the project");
  }
  if (
    !existsSync(parent) ||
    lstatSync(parent).isSymbolicLink() ||
    !statSync(parent).isDirectory()
  ) {
    throw new Error(
      "attestation output parent must be an existing non-symlink directory",
    );
  }
  const realParent = realpathSync(parent);
  if (inside(canonicalTarget, realParent)) {
    throw new Error("attestation output must remain outside the project");
  }
  const temporary = resolve(
    realParent,
    `.${output.split(sep).at(-1)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    writeFileSync(
      temporary,
      `${canonicalPayloadSerialization(value)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    try {
      linkSync(temporary, output);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(
          "attestation output already exists; evidence files are never overwritten",
        );
      }
      throw error;
    }
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary);
    }
  }
  return output;
}

function expectedBindingsFromPayload(
  payload,
  expected,
  actualState = null,
  preflightAttestation = null,
) {
  const requiredPathsSha256 = sha256Bytes(
    canonicalPayloadSerialization(
      Array.isArray(expected.required_product_paths)
        ? [...expected.required_product_paths].sort()
        : [],
    ),
  );
  const defaultOutcome = [
    CAPABILITY_PREFLIGHT_PAYLOAD_KIND,
    CAPABILITY_PAYLOAD_KIND,
  ].includes(payload.kind)
    ? "unavailable"
    : "succeeded";
  return {
    ...(expected.expected_bindings ?? {}),
    outcome:
      expected.outcome ??
      expected.expected_bindings?.outcome ??
      defaultOutcome,
    batch_id: expected.batch_id,
    project_instance_sha256: expected.project_instance_sha256,
    package_surface_sha256: expected.package_surface_sha256,
    ...(payload.kind === REVIEW_PAYLOAD_KIND &&
    payload.outcome === "succeeded"
      ? {
          primary_session_id: expected.primary_session_id,
          assignment_id: expected.assignment_id,
          work_item_id: expected.work_item_id,
          evidence_node_id: expected.evidence_node_id,
          delivery_baseline_revision:
            expected.delivery_baseline_revision,
          reviewed_revision: expected.reviewed_revision,
          candidate_path: actualState.candidate?.path,
          candidate_bytes_sha256:
            actualState.candidate?.bytes_sha256,
          final_head_revision: actualState.head_revision,
          final_project_state_sha256:
            actualState.project_state_sha256,
        }
      : {}),
    ...(payload.kind === CAPABILITY_PREFLIGHT_PAYLOAD_KIND
      ? {
          capability: "independent-review",
          primary_session_id: expected.primary_session_id,
          delivery_baseline_revision:
            expected.delivery_baseline_revision,
          intended_final_revision:
            expected.intended_final_revision ?? null,
          required_product_paths_sha256:
            requiredPathsSha256,
        }
      : {}),
    ...(payload.kind === CAPABILITY_PAYLOAD_KIND
      ? {
          capability: "independent-review",
          primary_session_id: expected.primary_session_id,
          delivery_baseline_revision:
            expected.delivery_baseline_revision,
          intended_final_revision:
            expected.intended_final_revision ?? null,
          required_product_paths_sha256:
            requiredPathsSha256,
          preflight_sha256:
            preflightAttestation === null
              ? undefined
              : capabilityPreflightAttestationSha256(
                  preflightAttestation,
                ),
          changed_paths_sha256:
            actualState.changed_paths_sha256,
          final_head_revision:
            actualState.finalState.head_revision,
          final_project_state_sha256:
            actualState.finalState.project_state_sha256,
        }
      : {}),
  };
}

function collectSign(options) {
  requireOptions(options, [
    "adapter",
    "trace",
    "target",
    "expected",
    "privateKey",
    "output",
  ]);
  if (
    ![CODEX_NATIVE_ADAPTER, CODEX_ISOLATED_SESSION_ADAPTER].includes(
      options.adapter,
    )
  ) {
    throw new Error(
      `adapter must equal ${CODEX_NATIVE_ADAPTER} or ${CODEX_ISOLATED_SESSION_ADAPTER}`,
    );
  }
  const trace = readFileSync(
    externalRealFile(options.trace, options.target, "raw trace"),
  );
  const stderr = optionalExternalBytes(
    options.stderr,
    options.target,
    "raw stderr",
  );
  const expected = readJsonFile(
    externalRealFile(options.expected, options.target, "expected bindings"),
    "expected bindings",
  );
  const privateKeyFile = externalRealFile(
    options.privateKey,
    options.target,
    "private signing key",
    { privateKey: true },
  );
  const payload = collectCodexReviewAttestationPayload({
    rawJsonl: trace,
    stderr,
    target: options.target,
    candidatePath: options.candidate ?? null,
    expected,
    allowedPostReviewPaths: options.allowPostReviewPaths,
    allowUnavailable: options.allowUnavailable === true,
    adapter: options.adapter,
  });
  const attestation = signReviewAttestation(
    payload,
    readFileSync(privateKeyFile),
  );
  const output = writeOuterJson(options.output, options.target, attestation);
  return {
    ok: true,
    outer_only: true,
    notice: OUTER_ONLY_NOTICE,
    outcome: payload.outcome,
    adapter: options.adapter,
    attestation: output,
    key_id: attestation.signature.key_id,
    final_project_state_sha256:
      payload.final_state.project_state_sha256,
  };
}

function capabilityPreflightSign(options) {
  requireOptions(options, [
    "target",
    "expected",
    "capabilities",
    "privateKey",
    "output",
  ]);
  const expected = readJsonFile(
    externalRealFile(options.expected, options.target, "expected bindings"),
    "expected bindings",
  );
  const capabilities = readJsonFile(
    externalRealFile(
      options.capabilities,
      options.target,
      "capability proof",
    ),
    "capability proof",
  );
  const privateKeyFile = externalRealFile(
    options.privateKey,
    options.target,
    "private signing key",
    { privateKey: true },
  );
  const payload = collectCapabilityPreflightPayload({
    target: options.target,
    expected,
    capabilities,
  });
  const attestation = signReviewAttestation(
    payload,
    readFileSync(privateKeyFile),
  );
  const output = writeOuterJson(options.output, options.target, attestation);
  return {
    ok: true,
    outer_only: true,
    notice: OUTER_ONLY_NOTICE,
    outcome: "unavailable",
    capability: "independent-review",
    phase: "preflight",
    attestation: output,
    key_id: attestation.signature.key_id,
    preflight_sha256:
      capabilityPreflightAttestationSha256(attestation),
    baseline_project_state_sha256:
      payload.baseline_state.project_state_sha256,
  };
}

function capabilitySign(options) {
  requireOptions(options, [
    "target",
    "expected",
    "preflight",
    "keyring",
    "privateKey",
    "output",
  ]);
  const expected = readJsonFile(
    externalRealFile(options.expected, options.target, "expected bindings"),
    "expected bindings",
  );
  const preflight = readJsonFile(
    externalRealFile(
      options.preflight,
      options.target,
      "signed capability preflight",
    ),
    "signed capability preflight",
  );
  const keyring = readJsonFile(
    externalRealFile(
      options.keyring,
      options.target,
      "trusted outer keyring",
    ),
    "trusted outer keyring",
  );
  const privateKeyFile = externalRealFile(
    options.privateKey,
    options.target,
    "private signing key",
    { privateKey: true },
  );
  const payload = collectCapabilityAttestationPayload({
    target: options.target,
    expected,
    preflightAttestation: preflight,
    preflightKeyring: keyring,
  });
  const attestation = signReviewAttestation(
    payload,
    readFileSync(privateKeyFile),
  );
  const output = writeOuterJson(options.output, options.target, attestation);
  return {
    ok: true,
    outer_only: true,
    notice: OUTER_ONLY_NOTICE,
    outcome: "unavailable",
    capability: "independent-review",
    phase: "post-run",
    preflight_sha256: payload.preflight_sha256,
    attestation: output,
    key_id: attestation.signature.key_id,
    final_project_state_sha256:
      payload.final_state.project_state_sha256,
  };
}

function validateAttestedLocalReview(target, payload, actualState) {
  const expectedCandidate = actualState.candidate_value;
  const validateTrustedAttestation = (candidate, context) =>
    context.receipt_path === payload.candidate.path &&
    context.node_id === payload.assignment.evidence_node_id &&
    candidate.receipt_id === expectedCandidate.receipt_id &&
    candidate.assignment_id === payload.assignment.id &&
    candidate.work_item_id === payload.assignment.work_item_id &&
    candidate.evidence_node_id === payload.assignment.evidence_node_id &&
    canonicalPayloadSerialization(candidate) ===
      canonicalPayloadSerialization(expectedCandidate);
  const reviewOptions = { validateTrustedAttestation };
  const evidence = commandEvidenceValidate(target, reviewOptions);
  const receipts = commandReceiptsValidate(target, reviewOptions);
  return {
    ok: evidence.ok === true && receipts.ok === true,
    evidence,
    receipts,
    errors: [
      ...evidence.errors.map(
        (error) => `local evidence validation: ${error}`,
      ),
      ...receipts.errors.map(
        (error) => `local receipt validation: ${error}`,
      ),
    ],
  };
}

function verifyOuter(options) {
  requireOptions(options, [
    "target",
    "expected",
    "attestation",
    "keyring",
  ]);
  const attestation = readJsonFile(
    externalRealFile(
      options.attestation,
      options.target,
      "signed attestation",
    ),
    "signed attestation",
  );
  const keyring = readJsonFile(
    externalRealFile(
      options.keyring,
      options.target,
      "trusted outer keyring",
    ),
    "trusted outer keyring",
  );
  const expected = readJsonFile(
    externalRealFile(options.expected, options.target, "expected bindings"),
    "expected bindings",
  );
  const payload = attestation.payload ?? {};
  let actualState = null;
  let preflight = null;
  let preflightVerification = null;
  if (payload.kind === REVIEW_PAYLOAD_KIND) {
    actualState = inspectFinalProjectState(options.target, {
      candidatePath: payload.candidate?.path,
      baselineRevision:
        payload.assignment?.delivery_baseline_revision,
      reviewedRevision:
        payload.outcome === "succeeded"
          ? payload.assignment?.reviewed_revision
          : null,
      allowedPostReviewPaths: options.allowPostReviewPaths,
    });
  } else if (payload.kind === CAPABILITY_PAYLOAD_KIND) {
    if (!options.preflight) {
      throw new Error(
        "post-run capability verification requires --preflight",
      );
    }
    preflight = readJsonFile(
      externalRealFile(
        options.preflight,
        options.target,
        "signed capability preflight",
      ),
      "signed capability preflight",
    );
    preflightVerification =
      verifyCapabilityPreflightAttestation(
        preflight,
        keyring,
        expectedBindingsFromPayload(
          preflight.payload ?? {},
          expected,
        ),
        { now: preflight.payload?.checked_at },
      );
    actualState = inspectCapabilityFinalProjectState(
      options.target,
      expected.delivery_baseline_revision,
    );
  }
  const bindings = expectedBindingsFromPayload(
    payload,
    expected,
    actualState,
    preflight,
  );
  let result;
  if (payload.kind === CAPABILITY_PREFLIGHT_PAYLOAD_KIND) {
    result = verifyCapabilityPreflightAttestation(
      attestation,
      keyring,
      bindings,
      { now: payload.checked_at },
    );
  } else if (payload.kind === CAPABILITY_PAYLOAD_KIND) {
    result = verifyCapabilityAttestation(
      attestation,
      keyring,
      bindings,
      { now: payload.completed_at },
    );
    const chainErrors = [];
    if (!preflightVerification.ok) {
      chainErrors.push(
        ...preflightVerification.errors.map(
          (error) => `capability preflight: ${error}`,
        ),
      );
    }
    if (
      payload.preflight_key_id !==
      preflight?.signature?.key_id
    ) {
      chainErrors.push(
        "capability preflight key ID does not match the post-run attestation",
      );
    }
    for (const [postRunValue, preflightValue, label] of [
      [
        payload.batch_id,
        preflight?.payload?.batch_id,
        "batch ID",
      ],
      [
        payload.project_instance_sha256,
        preflight?.payload?.project_instance_sha256,
        "project instance",
      ],
      [
        payload.package_surface_sha256,
        preflight?.payload?.package_surface_sha256,
        "package surface",
      ],
      [
        payload.harness?.primary_session_id,
        preflight?.payload?.harness?.primary_session_id,
        "primary session",
      ],
      [
        payload.assignment?.delivery_baseline_revision,
        preflight?.payload?.assignment?.delivery_baseline_revision,
        "delivery baseline",
      ],
      [
        payload.assignment?.intended_final_revision,
        preflight?.payload?.assignment?.intended_final_revision,
        "intended final revision",
      ],
      [
        payload.assignment?.required_product_paths_sha256,
        preflight?.payload?.assignment?.required_product_paths_sha256,
        "required product paths",
      ],
      [
        payload.checked_at,
        preflight?.payload?.checked_at,
        "preflight check time",
      ],
    ]) {
      if (postRunValue !== preflightValue) {
        chainErrors.push(
          `capability preflight ${label} does not match the post-run attestation`,
        );
      }
    }
    const checkedAt = Date.parse(preflight?.payload?.checked_at);
    const sessionStartedAt = Date.parse(payload.session_started_at);
    const completedAt = Date.parse(payload.completed_at);
    if (
      !Number.isFinite(checkedAt) ||
      !Number.isFinite(sessionStartedAt) ||
      !Number.isFinite(completedAt) ||
      checkedAt >= sessionStartedAt ||
      sessionStartedAt > completedAt
    ) {
      chainErrors.push(
        "capability chain requires preflight checked_at before session_started_at at or before completed_at",
      );
    }
    result = {
      ...result,
      ok: result.ok && chainErrors.length === 0,
      errors: [...result.errors, ...chainErrors],
    };
  } else {
    result = verifyReviewAttestation(attestation, keyring, bindings, {
      now: payload.completed_at,
    });
  }
  let localReview = null;
  if (
    result.ok &&
    payload.kind === REVIEW_PAYLOAD_KIND &&
    payload.outcome === "succeeded"
  ) {
    localReview = validateAttestedLocalReview(
      options.target,
      result.payload,
      actualState,
    );
    if (!localReview.ok) {
      result = {
        ...result,
        ok: false,
        errors: [...result.errors, ...localReview.errors],
      };
    }
  }
  return {
    ...result,
    outer_only: true,
    notice: OUTER_ONLY_NOTICE,
    attestation: realpathSync(options.attestation),
    trusted_keyring: realpathSync(options.keyring),
    local_review_validation:
      localReview === null
        ? null
        : {
            ok: localReview.ok,
            evidence_ok: localReview.evidence.ok,
            receipts_ok: localReview.receipts.ok,
          },
  };
}

function main(args = process.argv.slice(2)) {
  const { command, options } = parseArguments(args);
  const result =
    command === "collect-sign"
      ? collectSign(options)
      : command === "capability-preflight-sign"
        ? capabilityPreflightSign(options)
      : command === "capability-sign"
        ? capabilitySign(options)
        : verifyOuter(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 2;
  }
}

const isEntryPoint =
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(SCRIPT_FILE);

if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          ok: false,
          outer_only: true,
          notice: OUTER_ONLY_NOTICE,
          error: error.message,
          details:
            error instanceof ReviewAttestationError ? error.details : [],
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}

export {
  OUTER_ONLY_NOTICE,
  capabilitySign,
  capabilityPreflightSign,
  collectSign,
  main,
  parseArguments,
  verifyOuter,
};
