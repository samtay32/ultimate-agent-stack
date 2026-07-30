import { spawnSync } from "node:child_process";
import {
  KeyObject,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
  isAbsolute,
  parse,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";

const REVIEW_ATTESTATION_KIND = "uas.review-attestation/v1";
const REVIEW_PAYLOAD_KIND = "uas.review-attestation-payload/v1";
const CAPABILITY_PAYLOAD_KIND = "uas.capability-attestation-payload/v1";
const CAPABILITY_PREFLIGHT_PAYLOAD_KIND =
  "uas.capability-preflight-payload/v1";
const KEYRING_KIND = "uas.review-attestation-keyring/v1";
const REVIEW_RESULT_KIND = "uas.independent-review-result/v1";
const CODEX_NATIVE_ADAPTER = "codex-native-v1";
const CODEX_ISOLATED_SESSION_ADAPTER = "codex-isolated-session-v1";
const CAPABILITY_ADAPTER = "capability-preflight-v1";
const REVIEW_CANDIDATE_PATH =
  /^\.agent-stack\/review-receipts\/[a-f0-9]{64}\.json$/;
const SHA256_RECEIPT = /^sha256:[a-f0-9]{64}$/;
const GIT_COMMIT = /^[a-f0-9]{40,64}$/;
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/;
const CAPABILITY_MECHANISMS = Object.freeze([
  "external-provider",
  "human",
  "isolated-session",
  "native-subagent",
]);
const POST_REVIEW_PACKAGING_PATHS = Object.freeze([
  ".agent-stack/artifacts/PRE_PR_REVIEW.md",
  ".agent-stack/evidence-graph.json",
  ".agent-stack/work-items.json",
]);
const TERMINAL_WORKER_STATES = new Set([
  "completed",
  "done",
  "finished",
  "passed",
  "success",
  "succeeded",
]);
const SPAWN_TOOL_NAMES = new Set(["spawn", "spawn_agent"]);
const WAIT_TOOL_NAMES = new Set(["wait", "wait_agent"]);
const MAX_TRACE_BYTES = 32 * 1024 * 1024;
const MAX_CANDIDATE_BYTES = 1024 * 1024;
const REVIEW_RECEIPT_KEYS = new Set([
  "schema_version",
  "receipt_id",
  "assignment_id",
  "work_item_id",
  "evidence_node_id",
  "mechanism",
  "harness",
  "reviewer_id",
  "base_revision",
  "reviewed_revision",
  "delivery_baseline",
  "standards_verdict",
  "intent_verdict",
  "reviewer_result_sha256",
  "provenance_sha256",
  "read_only",
  "external_actions",
  "started_at",
  "completed_at",
  "result",
]);

class ReviewAttestationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ReviewAttestationError";
    this.details = details;
  }
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalValue(value, path = "$") {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ReviewAttestationError(
        `Canonical payload contains a non-finite number at ${path}`,
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      canonicalValue(item, `${path}[${index}]`),
    );
  }
  if (!plainObject(value)) {
    throw new ReviewAttestationError(
      `Canonical payload contains a non-JSON object at ${path}`,
    );
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => {
        if (value[key] === undefined) {
          throw new ReviewAttestationError(
            `Canonical payload contains undefined at ${path}.${key}`,
          );
        }
        return [key, canonicalValue(value[key], `${path}.${key}`)];
      }),
  );
}

function canonicalPayloadSerialization(value) {
  return JSON.stringify(canonicalValue(value));
}

function asBytes(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return Buffer.from(String(value), "utf8");
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(asBytes(value)).digest("hex")}`;
}

function reviewReceiptId(receipt) {
  if (!plainObject(receipt)) {
    throw new ReviewAttestationError(
      "Review receipt content must be an object",
    );
  }
  const canonical = { ...receipt };
  delete canonical.receipt_id;
  return createHash("sha256")
    .update(canonicalPayloadSerialization(canonical), "utf8")
    .digest("hex");
}

function reviewProvenanceSha256(events) {
  if (!plainObject(events)) {
    throw new ReviewAttestationError(
      "Review provenance events must be an object",
    );
  }
  const eventSet = {
    spawn_event_sha256: events.spawn_event_sha256 ?? null,
    spawn_returned_worker_id:
      events.spawn_returned_worker_id ?? null,
    wait_event_sha256: events.wait_event_sha256 ?? null,
    wait_target_worker_id: events.wait_target_worker_id ?? null,
    final_result_event_sha256:
      events.final_result_event_sha256 ?? null,
    reviewer_result_bytes_sha256:
      events.reviewer_result_bytes_sha256 ?? null,
    trace_bundle_sha256: events.trace_bundle_sha256 ?? null,
    stderr_sha256: events.stderr_sha256 ?? null,
  };
  return sha256Bytes(canonicalPayloadSerialization(eventSet));
}

function publicKeyObject(key) {
  if (key instanceof KeyObject) {
    if (key.type === "public") {
      if (key.asymmetricKeyType !== "ed25519") {
        throw new ReviewAttestationError(
          "Review attester key must be Ed25519",
        );
      }
      return key;
    }
    if (key.type === "private") {
      const derived = createPublicKey(key);
      if (derived.asymmetricKeyType !== "ed25519") {
        throw new ReviewAttestationError(
          "Review attester key must be Ed25519",
        );
      }
      return derived;
    }
    throw new ReviewAttestationError(
      "Review attester key must be public or private",
    );
  }
  let candidate;
  try {
    candidate = createPublicKey(key);
  } catch {
    candidate = createPublicKey(createPrivateKey(key));
  }
  if (candidate.asymmetricKeyType !== "ed25519") {
    throw new ReviewAttestationError("Review attester key must be Ed25519");
  }
  return candidate;
}

function privateKeyObject(key) {
  if (key instanceof KeyObject) {
    if (
      key.type !== "private" ||
      key.asymmetricKeyType !== "ed25519"
    ) {
      throw new ReviewAttestationError(
        "Review signing key must be a private Ed25519 key",
      );
    }
    return key;
  }
  const candidate = createPrivateKey(key);
  if (candidate.asymmetricKeyType !== "ed25519") {
    throw new ReviewAttestationError("Review signing key must be Ed25519");
  }
  return candidate;
}

function ed25519KeyId(publicOrPrivateKey) {
  const der = publicKeyObject(publicOrPrivateKey).export({
    type: "spki",
    format: "der",
  });
  return sha256Bytes(der);
}

function isUtcTimestamp(value) {
  return (
    typeof value === "string" &&
    value.endsWith("Z") &&
    Number.isFinite(Date.parse(value))
  );
}

function validateReviewAttestationKeyring(
  keyring,
  { now = new Date() } = {},
) {
  const errors = [];
  const keys = new Map();
  if (!plainObject(keyring)) {
    return {
      ok: false,
      errors: ["review attestation keyring must be an object"],
      keys,
    };
  }
  if (keyring.schema_version !== 1) {
    errors.push("review attestation keyring schema_version must equal 1");
  }
  if (keyring.kind !== KEYRING_KIND) {
    errors.push(`review attestation keyring kind must equal ${KEYRING_KIND}`);
  }
  if (!Array.isArray(keyring.keys) || keyring.keys.length === 0) {
    errors.push("review attestation keyring must contain at least one key");
  } else if (keyring.keys.length > 100) {
    errors.push("review attestation keyring may contain at most 100 keys");
  }
  for (const [index, entry] of (keyring.keys ?? []).slice(0, 101).entries()) {
    const label = `review attestation keyring keys[${index}]`;
    if (!plainObject(entry)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (entry.algorithm !== "Ed25519") {
      errors.push(`${label}.algorithm must equal Ed25519`);
    }
    if (
      typeof entry.public_key_spki_base64 !== "string" ||
      entry.public_key_spki_base64.length === 0
    ) {
      errors.push(`${label}.public_key_spki_base64 is required`);
      continue;
    }
    let publicKey;
    try {
      const der = Buffer.from(entry.public_key_spki_base64, "base64");
      if (
        der.length === 0 ||
        der.toString("base64") !== entry.public_key_spki_base64
      ) {
        throw new Error("non-canonical base64");
      }
      publicKey = createPublicKey({
        key: der,
        type: "spki",
        format: "der",
      });
      if (publicKey.asymmetricKeyType !== "ed25519") {
        throw new Error("not Ed25519");
      }
    } catch (error) {
      errors.push(`${label} contains an invalid Ed25519 SPKI key: ${error.message}`);
      continue;
    }
    const actualKeyId = ed25519KeyId(publicKey);
    if (entry.key_id !== actualKeyId) {
      errors.push(`${label}.key_id does not match its public key`);
    }
    if (!["active", "revoked"].includes(entry.status)) {
      errors.push(`${label}.status must equal active or revoked`);
    }
    for (const timestamp of ["not_before", "not_after"]) {
      if (
        entry[timestamp] !== null &&
        entry[timestamp] !== undefined &&
        !isUtcTimestamp(entry[timestamp])
      ) {
        errors.push(`${label}.${timestamp} must be null or a UTC timestamp`);
      }
    }
    if (
      isUtcTimestamp(entry.not_before) &&
      isUtcTimestamp(entry.not_after) &&
      Date.parse(entry.not_after) < Date.parse(entry.not_before)
    ) {
      errors.push(`${label}.not_after must not precede not_before`);
    }
    if (keys.has(actualKeyId)) {
      errors.push(`review attestation keyring duplicates key ${actualKeyId}`);
    } else {
      keys.set(actualKeyId, { ...entry, publicKey });
    }
  }
  const currentTime = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(currentTime)) {
    errors.push("review attestation validation time is invalid");
  }
  return { ok: errors.length === 0, errors, keys };
}

function validateHash(errors, value, label) {
  if (!SHA256_RECEIPT.test(value ?? "")) {
    errors.push(`${label} must be a sha256 receipt`);
  }
}

function validateIdentifier(errors, value, label) {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !IDENTIFIER.test(value)
  ) {
    errors.push(`${label} must be a bounded identifier`);
  }
}

function validateFinalState(
  errors,
  state,
  label = "payload.final_state",
  { requireProductReviewedPath = false } = {},
) {
  if (!plainObject(state)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!GIT_COMMIT.test(state.head_revision ?? "")) {
    errors.push(`${label}.head_revision must be a full Git object ID`);
  }
  if (!/^[a-f0-9]{40,64}$/.test(state.git_tree_oid ?? "")) {
    errors.push(`${label}.git_tree_oid must be a full Git tree object ID`);
  }
  if (!["sha1", "sha256"].includes(state.git_object_format)) {
    errors.push(`${label}.git_object_format must equal sha1 or sha256`);
  }
  validateHash(
    errors,
    state.git_tree_manifest_sha256,
    `${label}.git_tree_manifest_sha256`,
  );
  validateHash(
    errors,
    state.project_state_sha256,
    `${label}.project_state_sha256`,
  );
  if (state.clean !== true) {
    errors.push(`${label}.clean must equal true`);
  }
  if (
    !Array.isArray(state.post_review_paths) ||
    !state.post_review_paths.every(
      (path) => typeof path === "string" && path.length > 0,
    )
  ) {
    errors.push(`${label}.post_review_paths must be a string array`);
  }
  validateHash(
    errors,
    state.post_review_paths_sha256,
    `${label}.post_review_paths_sha256`,
  );
  if (
    !Array.isArray(state.reviewed_paths) ||
    !state.reviewed_paths.every(
      (path) => typeof path === "string" && path.length > 0,
    )
  ) {
    errors.push(`${label}.reviewed_paths must be a string array`);
  }
  validateHash(
    errors,
    state.reviewed_paths_sha256,
    `${label}.reviewed_paths_sha256`,
  );
  if (
    requireProductReviewedPath &&
    Array.isArray(state.reviewed_paths) &&
    !state.reviewed_paths.some((path) => !path.startsWith(".agent-stack/"))
  ) {
    errors.push(
      `${label}.reviewed_paths must contain at least one product path`,
    );
  }
}

function validatePayloadMetadata(payload) {
  const errors = [];
  if (!plainObject(payload)) {
    return ["review attestation payload must be an object"];
  }
  if (payload.schema_version !== 1) {
    errors.push("review attestation payload schema_version must equal 1");
  }
  if (
    ![
      REVIEW_PAYLOAD_KIND,
      CAPABILITY_PAYLOAD_KIND,
      CAPABILITY_PREFLIGHT_PAYLOAD_KIND,
    ].includes(payload.kind)
  ) {
    errors.push("review attestation payload kind is not canonical");
  }
  validateIdentifier(errors, payload.batch_id, "payload.batch_id");
  validateHash(
    errors,
    payload.project_instance_sha256,
    "payload.project_instance_sha256",
  );
  validateHash(
    errors,
    payload.package_surface_sha256,
    "payload.package_surface_sha256",
  );
  if (!plainObject(payload.collector)) {
    errors.push("payload.collector must be an object");
  } else {
    validateIdentifier(errors, payload.collector.id, "payload.collector.id");
    if (
      typeof payload.collector.version !== "string" ||
      payload.collector.version.length === 0 ||
      payload.collector.version.length > 100
    ) {
      errors.push("payload.collector.version must be a bounded string");
    }
    if (
      ![
        CODEX_NATIVE_ADAPTER,
        CODEX_ISOLATED_SESSION_ADAPTER,
        CAPABILITY_ADAPTER,
      ].includes(payload.collector.adapter)
    ) {
      errors.push("payload.collector.adapter is not canonical");
    }
    validateHash(
      errors,
      payload.collector.adapter_sha256,
      "payload.collector.adapter_sha256",
    );
  }
  return errors;
}

function validateCommonPayload(payload) {
  const errors = validatePayloadMetadata(payload);
  if (!plainObject(payload)) {
    return errors;
  }
  validateFinalState(errors, payload.final_state, "payload.final_state", {
    requireProductReviewedPath:
      payload.kind === REVIEW_PAYLOAD_KIND && payload.outcome === "succeeded",
  });
  if (!isUtcTimestamp(payload.completed_at)) {
    errors.push("payload.completed_at must be a UTC timestamp");
  }
  return errors;
}

function validateReviewPayload(payload) {
  const errors = validateCommonPayload(payload);
  if (!plainObject(payload) || payload.kind !== REVIEW_PAYLOAD_KIND) {
    return errors;
  }
  if (!["succeeded", "unavailable"].includes(payload.outcome)) {
    errors.push("review payload outcome must equal succeeded or unavailable");
  }
  if (!plainObject(payload.harness)) {
    errors.push("payload.harness must be an object");
  } else {
    for (const key of ["name", "version", "primary_session_id"]) {
      if (
        typeof payload.harness[key] !== "string" ||
        payload.harness[key].length === 0 ||
        payload.harness[key].length > 256
      ) {
        errors.push(`payload.harness.${key} must be a bounded string`);
      }
    }
  }
  if (!plainObject(payload.assignment)) {
    errors.push("payload.assignment must be an object");
  } else {
    for (const [key, label] of [
      ["id", "payload.assignment.id"],
      ["work_item_id", "payload.assignment.work_item_id"],
      ["evidence_node_id", "payload.assignment.evidence_node_id"],
    ]) {
      validateIdentifier(errors, payload.assignment[key], label);
    }
    for (const key of [
      "delivery_baseline_revision",
      "reviewed_revision",
    ]) {
      if (!GIT_COMMIT.test(payload.assignment[key] ?? "")) {
        errors.push(`payload.assignment.${key} must be a full Git object ID`);
      }
    }
  }
  if (!plainObject(payload.events)) {
    errors.push("payload.events must be an object");
  } else {
    validateHash(
      errors,
      payload.events.trace_bundle_sha256,
      "payload.events.trace_bundle_sha256",
    );
    validateHash(
      errors,
      payload.events.stderr_sha256,
      "payload.events.stderr_sha256",
    );
    validateHash(
      errors,
      payload.events.provenance_sha256,
      "payload.events.provenance_sha256",
    );
    if (
      SHA256_RECEIPT.test(payload.events.provenance_sha256 ?? "") &&
      payload.events.provenance_sha256 !==
        reviewProvenanceSha256(payload.events)
    ) {
      errors.push(
        "payload.events.provenance_sha256 must bind the exact event hash and ID set",
      );
    }
  }
  if (!isUtcTimestamp(payload.started_at)) {
    errors.push("payload.started_at must be a UTC timestamp");
  }
  if (
    isUtcTimestamp(payload.started_at) &&
    isUtcTimestamp(payload.completed_at) &&
    Date.parse(payload.completed_at) < Date.parse(payload.started_at)
  ) {
    errors.push("payload.completed_at must not precede started_at");
  }
  if (payload.outcome === "succeeded") {
    const reviewerId = payload.harness?.reviewer_session_id;
    if (
      typeof reviewerId !== "string" ||
      reviewerId.length === 0 ||
      reviewerId.length > 256
    ) {
      errors.push(
        "successful review payload requires a bounded reviewer_session_id",
      );
    }
    if (reviewerId === payload.harness?.primary_session_id) {
      errors.push("reviewer_session_id must differ from primary_session_id");
    }
    for (const key of [
      "spawn_event_sha256",
      "wait_event_sha256",
      "final_result_event_sha256",
      "reviewer_result_bytes_sha256",
    ]) {
      validateHash(errors, payload.events?.[key], `payload.events.${key}`);
    }
    for (const key of [
      "spawn_returned_worker_id",
      "wait_target_worker_id",
    ]) {
      if (
        typeof payload.events?.[key] !== "string" ||
        payload.events[key].length === 0
      ) {
        errors.push(`payload.events.${key} is required`);
      }
    }
    if (
      reviewerId &&
      (payload.events?.spawn_returned_worker_id !== reviewerId ||
        payload.events?.wait_target_worker_id !== reviewerId)
    ) {
      errors.push("spawn, wait, and reviewer session IDs must match exactly");
    }
    if (
      payload.verdicts?.standards !== "passed" ||
      payload.verdicts?.intent !== "passed"
    ) {
      errors.push("successful review payload requires both passed verdicts");
    }
    if (
      payload.boundary?.read_only !== true ||
      payload.boundary?.external_actions !== false
    ) {
      errors.push(
        "successful review payload requires a read-only no-external-action boundary",
      );
    }
    if (!plainObject(payload.candidate)) {
      errors.push("successful review payload requires a candidate binding");
    } else {
      if (!REVIEW_CANDIDATE_PATH.test(payload.candidate.path ?? "")) {
        errors.push("payload.candidate.path is not canonical");
      }
      validateHash(
        errors,
        payload.candidate.bytes_sha256,
        "payload.candidate.bytes_sha256",
      );
      if (!/^[a-f0-9]{40,64}$/.test(payload.candidate.git_blob_oid ?? "")) {
        errors.push("payload.candidate.git_blob_oid must be a full Git blob ID");
      }
    }
    if (payload.unavailable !== null) {
      errors.push("successful review payload unavailable must equal null");
    }
  } else if (payload.outcome === "unavailable") {
    if (payload.harness?.reviewer_session_id !== null) {
      errors.push(
        "unavailable review payload reviewer_session_id must equal null",
      );
    }
    if (payload.verdicts !== null || payload.boundary !== null) {
      errors.push(
        "unavailable review payload verdicts and boundary must equal null",
      );
    }
    if (!plainObject(payload.unavailable)) {
      errors.push("unavailable review payload requires unavailable evidence");
    } else {
      validateIdentifier(
        errors,
        payload.unavailable.reason_code,
        "payload.unavailable.reason_code",
      );
      for (const key of [
        "failed_spawn_observed",
        "empty_wait_observed",
      ]) {
        if (typeof payload.unavailable[key] !== "boolean") {
          errors.push(`payload.unavailable.${key} must be boolean`);
        }
      }
    }
  }
  return errors;
}

function validateCapabilityIdentity(payload, errors, label) {
  if (
    payload.outcome !== "unavailable" ||
    payload.capability !== "independent-review"
  ) {
    errors.push(
      `${label} must attest unavailable independent-review capability`,
    );
  }
  if (!plainObject(payload.harness)) {
    errors.push(`${label}.harness must be an object`);
  } else if (
    typeof payload.harness.primary_session_id !== "string" ||
    payload.harness.primary_session_id.length === 0 ||
    payload.harness.primary_session_id.length > 256
  ) {
    errors.push(
      `${label}.harness.primary_session_id must be a bounded string`,
    );
  }
  if (!plainObject(payload.assignment)) {
    errors.push(`${label}.assignment must be an object`);
    return;
  }
  if (
    !GIT_COMMIT.test(
      payload.assignment.delivery_baseline_revision ?? "",
    )
  ) {
    errors.push(
      `${label}.assignment.delivery_baseline_revision must be a full Git object ID`,
    );
  }
  if (
    payload.assignment.intended_final_revision !== null &&
    !GIT_COMMIT.test(
      payload.assignment.intended_final_revision ?? "",
    )
  ) {
    errors.push(
      `${label}.assignment.intended_final_revision must be null or a full Git object ID`,
    );
  }
  const paths = payload.assignment.required_product_paths;
  if (
    !Array.isArray(paths) ||
    !paths.every(
      (path) =>
        typeof path === "string" &&
        path.length > 0 &&
        !path.startsWith(".agent-stack/"),
    ) ||
    new Set(paths).size !== paths?.length ||
    JSON.stringify([...(paths ?? [])].sort()) !== JSON.stringify(paths)
  ) {
    errors.push(
      `${label}.assignment.required_product_paths must be a sorted unique product-path array`,
    );
  } else {
    for (const path of paths) {
      try {
        safeRelativeProjectPath(path, "required product path");
      } catch (error) {
        errors.push(`${label}.assignment: ${error.message}`);
      }
    }
  }
  validateHash(
    errors,
    payload.assignment.required_product_paths_sha256,
    `${label}.assignment.required_product_paths_sha256`,
  );
  if (
    Array.isArray(paths) &&
    payload.assignment.required_product_paths_sha256 !==
      sha256Bytes(canonicalPayloadSerialization(paths))
  ) {
    errors.push(
      `${label}.assignment.required_product_paths_sha256 does not match its path list`,
    );
  }
}

function validateDisabledCapabilities(payload, errors, label) {
  if (!plainObject(payload.capabilities)) {
    errors.push(`${label}.capabilities must be an object`);
    return;
  }
  const actualKeys = Object.keys(payload.capabilities).sort();
  if (
    JSON.stringify(actualKeys) !== JSON.stringify(CAPABILITY_MECHANISMS)
  ) {
    errors.push(
      `${label}.capabilities must contain exactly: ${CAPABILITY_MECHANISMS.join(", ")}`,
    );
  }
  for (const mechanism of CAPABILITY_MECHANISMS) {
    const proof = payload.capabilities[mechanism];
    const proofLabel = `${label}.capabilities.${mechanism}`;
    if (!plainObject(proof)) {
      errors.push(`${proofLabel} must be an object`);
      continue;
    }
    if (proof.state !== "disabled") {
      errors.push(`${proofLabel}.state must equal disabled`);
    }
    if (
      typeof proof.proof_kind !== "string" ||
      proof.proof_kind.length === 0 ||
      proof.proof_kind.length > 100
    ) {
      errors.push(`${proofLabel}.proof_kind must be a bounded string`);
    }
    if (proof.applied_before_session !== true) {
      errors.push(`${proofLabel}.applied_before_session must equal true`);
    }
    validateIdentifier(
      errors,
      proof.reason_code,
      `${proofLabel}.reason_code`,
    );
    validateHash(
      errors,
      proof.proof_sha256,
      `${proofLabel}.proof_sha256`,
    );
  }
}

function validateCapabilityPreflightPayload(payload) {
  const errors = validatePayloadMetadata(payload);
  if (
    !plainObject(payload) ||
    payload.kind !== CAPABILITY_PREFLIGHT_PAYLOAD_KIND
  ) {
    return errors;
  }
  validateCapabilityIdentity(payload, errors, "capability preflight");
  if (payload.collector?.adapter !== CAPABILITY_ADAPTER) {
    errors.push(
      `capability preflight collector.adapter must equal ${CAPABILITY_ADAPTER}`,
    );
  }
  validateDisabledCapabilities(payload, errors, "capability preflight");
  if (!isUtcTimestamp(payload.checked_at)) {
    errors.push(
      "capability preflight checked_at must be a UTC timestamp",
    );
  }
  if (!plainObject(payload.baseline_state)) {
    errors.push("capability preflight baseline_state must be an object");
  } else {
    const state = payload.baseline_state;
    if (!GIT_COMMIT.test(state.head_revision ?? "")) {
      errors.push(
        "capability preflight baseline_state.head_revision must be a full Git object ID",
      );
    }
    if (!/^[a-f0-9]{40,64}$/.test(state.git_tree_oid ?? "")) {
      errors.push(
        "capability preflight baseline_state.git_tree_oid must be a full Git tree object ID",
      );
    }
    if (!["sha1", "sha256"].includes(state.git_object_format)) {
      errors.push(
        "capability preflight baseline_state.git_object_format must equal sha1 or sha256",
      );
    }
    validateHash(
      errors,
      state.git_tree_manifest_sha256,
      "capability preflight baseline_state.git_tree_manifest_sha256",
    );
    validateHash(
      errors,
      state.project_state_sha256,
      "capability preflight baseline_state.project_state_sha256",
    );
    if (state.clean !== true) {
      errors.push(
        "capability preflight baseline_state.clean must equal true",
      );
    }
    if (
      payload.assignment?.delivery_baseline_revision !==
      state.head_revision
    ) {
      errors.push(
        "capability preflight baseline state must equal the delivery baseline revision",
      );
    }
  }
  return errors;
}

function validateCapabilityPayload(payload) {
  const errors = validateCommonPayload(payload);
  if (!plainObject(payload) || payload.kind !== CAPABILITY_PAYLOAD_KIND) {
    return errors;
  }
  validateCapabilityIdentity(payload, errors, "capability payload");
  if (payload.collector?.adapter !== CAPABILITY_ADAPTER) {
    errors.push(
      `capability payload collector.adapter must equal ${CAPABILITY_ADAPTER}`,
    );
  }
  validateHash(
    errors,
    payload.preflight_sha256,
    "capability payload preflight_sha256",
  );
  validateHash(
    errors,
    payload.preflight_key_id,
    "capability payload preflight_key_id",
  );
  if (!isUtcTimestamp(payload.checked_at)) {
    errors.push("capability payload checked_at must be a UTC timestamp");
  }
  if (!isUtcTimestamp(payload.session_started_at)) {
    errors.push(
      "capability payload session_started_at must be a UTC timestamp",
    );
  }
  if (
    isUtcTimestamp(payload.checked_at) &&
    isUtcTimestamp(payload.session_started_at) &&
    Date.parse(payload.checked_at) >=
      Date.parse(payload.session_started_at)
  ) {
    errors.push(
      "capability payload checked_at must precede session_started_at",
    );
  }
  if (
    isUtcTimestamp(payload.session_started_at) &&
    isUtcTimestamp(payload.completed_at) &&
    Date.parse(payload.session_started_at) >
      Date.parse(payload.completed_at)
  ) {
    errors.push(
      "capability payload session_started_at must not follow completed_at",
    );
  }
  if (payload.baseline_ancestor !== true) {
    errors.push("capability payload baseline_ancestor must equal true");
  }
  const changedPaths = payload.changed_paths;
  if (
    !Array.isArray(changedPaths) ||
    !changedPaths.every(
      (path) => typeof path === "string" && path.length > 0,
    ) ||
    new Set(changedPaths).size !== changedPaths?.length ||
    JSON.stringify([...(changedPaths ?? [])].sort()) !==
      JSON.stringify(changedPaths)
  ) {
    errors.push(
      "capability payload changed_paths must be a sorted unique path array",
    );
  } else {
    for (const path of changedPaths) {
      try {
        safeRelativeProjectPath(path, "changed path");
      } catch (error) {
        errors.push(`capability payload: ${error.message}`);
      }
    }
    if (
      !changedPaths.some((path) => !path.startsWith(".agent-stack/"))
    ) {
      errors.push(
        "capability payload changed_paths must contain a product path",
      );
    }
  }
  validateHash(
    errors,
    payload.changed_paths_sha256,
    "capability payload changed_paths_sha256",
  );
  if (
    Array.isArray(changedPaths) &&
    payload.changed_paths_sha256 !==
      sha256Bytes(canonicalPayloadSerialization(changedPaths))
  ) {
    errors.push(
      "capability payload changed_paths_sha256 does not match its path list",
    );
  }
  for (const required of payload.assignment?.required_product_paths ?? []) {
    if (!changedPaths?.includes(required)) {
      errors.push(
        `capability payload changed_paths is missing required product path: ${required}`,
      );
    }
  }
  if (
    payload.final_state?.head_revision ===
    payload.assignment?.delivery_baseline_revision
  ) {
    errors.push(
      "capability payload final revision must differ from the delivery baseline",
    );
  }
  if (
    payload.assignment?.intended_final_revision !== null &&
    payload.assignment?.intended_final_revision !==
      payload.final_state?.head_revision
  ) {
    errors.push(
      "capability payload final revision does not match the intended final revision",
    );
  }
  return errors;
}

function payloadErrors(payload) {
  if (payload?.kind === REVIEW_PAYLOAD_KIND) {
    return validateReviewPayload(payload);
  }
  if (payload?.kind === CAPABILITY_PAYLOAD_KIND) {
    return validateCapabilityPayload(payload);
  }
  if (payload?.kind === CAPABILITY_PREFLIGHT_PAYLOAD_KIND) {
    return validateCapabilityPreflightPayload(payload);
  }
  return validateCommonPayload(payload);
}

function signReviewAttestation(payload, privateKey) {
  const errors = payloadErrors(payload);
  if (errors.length > 0) {
    throw new ReviewAttestationError(
      "Refusing to sign an invalid review attestation payload",
      errors,
    );
  }
  const key = privateKeyObject(privateKey);
  const serialized = canonicalPayloadSerialization(payload);
  const signature = signBytes(null, Buffer.from(serialized, "utf8"), key);
  return {
    schema_version: 1,
    kind: REVIEW_ATTESTATION_KIND,
    payload: canonicalValue(payload),
    signature: {
      algorithm: "Ed25519",
      key_id: ed25519KeyId(key),
      value_base64: signature.toString("base64"),
    },
  };
}

function capabilityPreflightAttestationSha256(attestation) {
  return sha256Bytes(canonicalPayloadSerialization(attestation));
}

function bindingValue(payload, key) {
  const bindings = {
    outcome: payload.outcome,
    batch_id: payload.batch_id,
    project_instance_sha256: payload.project_instance_sha256,
    package_surface_sha256: payload.package_surface_sha256,
    primary_session_id: payload.harness?.primary_session_id,
    reviewer_session_id: payload.harness?.reviewer_session_id,
    assignment_id: payload.assignment?.id,
    work_item_id: payload.assignment?.work_item_id,
    evidence_node_id: payload.assignment?.evidence_node_id,
    delivery_baseline_revision:
      payload.assignment?.delivery_baseline_revision,
    reviewed_revision: payload.assignment?.reviewed_revision,
    intended_final_revision:
      payload.assignment?.intended_final_revision,
    required_product_paths_sha256:
      payload.assignment?.required_product_paths_sha256,
    candidate_path: payload.candidate?.path,
    candidate_bytes_sha256: payload.candidate?.bytes_sha256,
    provenance_sha256: payload.events?.provenance_sha256,
    preflight_sha256: payload.preflight_sha256,
    preflight_key_id: payload.preflight_key_id,
    changed_paths_sha256: payload.changed_paths_sha256,
    final_head_revision: payload.final_state?.head_revision,
    final_project_state_sha256:
      payload.final_state?.project_state_sha256,
    capability: payload.capability,
  };
  return bindings[key];
}

function verifySignedEnvelope(
  attestation,
  keyring,
  expectedBindings = {},
  { now = new Date(), expectedKind = null } = {},
) {
  const errors = [];
  if (!plainObject(attestation)) {
    return {
      ok: false,
      errors: ["review attestation must be an object"],
      payload: null,
      key_id: null,
    };
  }
  if (attestation.schema_version !== 1) {
    errors.push("review attestation schema_version must equal 1");
  }
  if (attestation.kind !== REVIEW_ATTESTATION_KIND) {
    errors.push(`review attestation kind must equal ${REVIEW_ATTESTATION_KIND}`);
  }
  errors.push(...payloadErrors(attestation.payload));
  if (expectedKind && attestation.payload?.kind !== expectedKind) {
    errors.push(`attestation payload kind must equal ${expectedKind}`);
  }
  if (!plainObject(attestation.signature)) {
    errors.push("review attestation signature must be an object");
  } else {
    if (attestation.signature.algorithm !== "Ed25519") {
      errors.push("review attestation signature algorithm must equal Ed25519");
    }
    if (!SHA256_RECEIPT.test(attestation.signature.key_id ?? "")) {
      errors.push("review attestation signature key_id is invalid");
    }
    if (
      typeof attestation.signature.value_base64 !== "string" ||
      attestation.signature.value_base64.length === 0
    ) {
      errors.push("review attestation signature value_base64 is required");
    }
  }
  const keyringValidation = validateReviewAttestationKeyring(keyring, { now });
  errors.push(...keyringValidation.errors);
  const key = keyringValidation.keys.get(attestation.signature?.key_id);
  if (!key) {
    errors.push("review attestation was not signed by a trusted key");
  } else {
    const currentTime = now instanceof Date ? now.getTime() : Date.parse(now);
    if (key.status !== "active") {
      errors.push("review attestation signing key is revoked");
    }
    if (
      isUtcTimestamp(key.not_before) &&
      currentTime < Date.parse(key.not_before)
    ) {
      errors.push("review attestation signing key is not active yet");
    }
    if (
      isUtcTimestamp(key.not_after) &&
      currentTime > Date.parse(key.not_after)
    ) {
      errors.push("review attestation signing key is expired");
    }
    try {
      const signature = Buffer.from(
        attestation.signature?.value_base64 ?? "",
        "base64",
      );
      if (
        signature.length === 0 ||
        signature.toString("base64") !==
          attestation.signature?.value_base64
      ) {
        throw new Error("non-canonical base64");
      }
      const verified = verifyBytes(
        null,
        Buffer.from(
          canonicalPayloadSerialization(attestation.payload),
          "utf8",
        ),
        key.publicKey,
        signature,
      );
      if (!verified) {
        errors.push("review attestation signature verification failed");
      }
    } catch (error) {
      errors.push(`review attestation signature is invalid: ${error.message}`);
    }
  }
  const allowedBindings = new Set([
    "outcome",
    "batch_id",
    "project_instance_sha256",
    "package_surface_sha256",
    "primary_session_id",
    "reviewer_session_id",
    "assignment_id",
    "work_item_id",
    "evidence_node_id",
    "delivery_baseline_revision",
    "reviewed_revision",
    "intended_final_revision",
    "required_product_paths_sha256",
    "candidate_path",
    "candidate_bytes_sha256",
    "provenance_sha256",
    "preflight_sha256",
    "preflight_key_id",
    "changed_paths_sha256",
    "final_head_revision",
    "final_project_state_sha256",
    "capability",
  ]);
  for (const [binding, expected] of Object.entries(expectedBindings ?? {})) {
    if (!allowedBindings.has(binding)) {
      errors.push(`unknown expected review attestation binding: ${binding}`);
      continue;
    }
    if (bindingValue(attestation.payload ?? {}, binding) !== expected) {
      errors.push(`review attestation binding mismatch: ${binding}`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    payload: attestation.payload ?? null,
    key_id: attestation.signature?.key_id ?? null,
  };
}

function verifyReviewAttestation(
  attestation,
  keyring,
  expectedBindings = {},
  options = {},
) {
  return verifySignedEnvelope(attestation, keyring, expectedBindings, {
    ...options,
    expectedKind: REVIEW_PAYLOAD_KIND,
  });
}

function verifyCapabilityAttestation(
  attestation,
  keyring,
  expectedBindings = {},
  options = {},
) {
  return verifySignedEnvelope(attestation, keyring, expectedBindings, {
    ...options,
    expectedKind: CAPABILITY_PAYLOAD_KIND,
  });
}

function verifyCapabilityPreflightAttestation(
  attestation,
  keyring,
  expectedBindings = {},
  options = {},
) {
  return verifySignedEnvelope(attestation, keyring, expectedBindings, {
    ...options,
    expectedKind: CAPABILITY_PREFLIGHT_PAYLOAD_KIND,
  });
}

function traceRecords(rawJsonl) {
  const raw = asBytes(rawJsonl);
  if (raw.length === 0) {
    throw new ReviewAttestationError("Codex trace is empty");
  }
  if (raw.length > MAX_TRACE_BYTES) {
    throw new ReviewAttestationError(
      `Codex trace exceeds ${MAX_TRACE_BYTES} bytes`,
    );
  }
  const records = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const newline = raw.indexOf(0x0a, cursor);
    const end = newline === -1 ? raw.length : newline + 1;
    const exactBytes = raw.subarray(cursor, end);
    const jsonBytes =
      exactBytes.at(-1) === 0x0a
        ? exactBytes.subarray(0, exactBytes.length - 1)
        : exactBytes;
    const text = jsonBytes.toString("utf8").trim();
    if (text.length > 0) {
      let value;
      try {
        value = JSON.parse(text);
      } catch (error) {
        throw new ReviewAttestationError(
          `Codex trace line ${records.length + 1} is invalid JSON: ${error.message}`,
        );
      }
      records.push({
        value,
        bytes: Buffer.from(exactBytes),
        line: records.length + 1,
      });
    }
    cursor = end;
  }
  return { raw, records };
}

function completedCollaborationItem(record) {
  return (
    record.value?.type === "item.completed" &&
    record.value?.item?.type === "collab_tool_call" &&
    record.value.item.status === "completed"
  );
}

function candidateIds(item) {
  const ids = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.trim().length > 0) {
      ids.add(value.trim());
    }
  };
  for (const key of [
    "worker_id",
    "agent_id",
    "thread_id",
    "receiver_thread_id",
  ]) {
    add(item?.[key]);
    add(item?.result?.[key]);
  }
  for (const value of item?.receiver_thread_ids ?? []) {
    add(value);
  }
  for (const value of item?.result?.receiver_thread_ids ?? []) {
    add(value);
  }
  for (const value of Object.keys(item?.agents_states ?? {})) {
    add(value);
  }
  for (const value of Object.keys(item?.result?.agents_states ?? {})) {
    add(value);
  }
  return [...ids];
}

function promptMatchesExpected(prompt, expected) {
  if (typeof prompt !== "string" || prompt.length === 0) {
    return false;
  }
  return [
    expected.assignment_id,
    expected.delivery_baseline_revision,
    expected.reviewed_revision,
  ].every((value) => typeof value === "string" && prompt.includes(value));
}

function stateForWorker(item, workerId) {
  return (
    item?.agents_states?.[workerId] ??
    item?.result?.agents_states?.[workerId] ??
    null
  );
}

function finalResultFromState(state, item) {
  for (const candidate of [
    state?.final_result,
    state?.result,
    state?.output,
    state?.message,
    state?.text,
    item?.final_result,
    item?.result?.final_result,
  ]) {
    if (
      typeof candidate === "string" ||
      plainObject(candidate) ||
      Array.isArray(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

function structuredReviewerResult(result) {
  if (plainObject(result)) {
    return result;
  }
  if (typeof result !== "string") {
    throw new ReviewAttestationError(
      "Reviewer final result must be a structured JSON object",
    );
  }
  try {
    const parsed = JSON.parse(result);
    if (!plainObject(parsed)) {
      throw new Error("result is not an object");
    }
    return parsed;
  } catch (error) {
    throw new ReviewAttestationError(
      `Reviewer final result must be JSON: ${error.message}`,
    );
  }
}

function validateReviewerResult(result, expected, reviewerId) {
  const errors = [];
  if (result.schema_version !== 1 || result.kind !== REVIEW_RESULT_KIND) {
    errors.push(`reviewer result must be ${REVIEW_RESULT_KIND} schema 1`);
  }
  for (const [resultKey, expectedKey] of [
    ["assignment_id", "assignment_id"],
    ["work_item_id", "work_item_id"],
    ["evidence_node_id", "evidence_node_id"],
    ["delivery_baseline_revision", "delivery_baseline_revision"],
    ["reviewed_revision", "reviewed_revision"],
  ]) {
    if (result[resultKey] !== expected[expectedKey]) {
      errors.push(`reviewer result binding mismatch: ${resultKey}`);
    }
  }
  if (result.reviewer_id !== reviewerId) {
    errors.push("reviewer result reviewer_id does not match the worker");
  }
  if (
    result.standards_verdict !== "passed" ||
    result.intent_verdict !== "passed"
  ) {
    errors.push("reviewer result requires passed standards and intent verdicts");
  }
  if (result.read_only !== true || result.external_actions !== false) {
    errors.push(
      "reviewer result must retain a read-only no-external-action boundary",
    );
  }
  if (errors.length > 0) {
    throw new ReviewAttestationError(
      "Reviewer final result failed validation",
      errors,
    );
  }
}

function reviewEventEvidence({
  adapter,
  trace,
  stderr,
  spawn,
  wait,
  final,
  reviewerId,
  result,
}) {
  const resultBytes = Buffer.from(
    canonicalPayloadSerialization(result),
    "utf8",
  );
  const events = {
    spawn_event_sha256: sha256Bytes(spawn.bytes),
    spawn_returned_worker_id: reviewerId,
    wait_event_sha256: sha256Bytes(wait.bytes),
    wait_target_worker_id: reviewerId,
    final_result_event_sha256: sha256Bytes(final.bytes),
    reviewer_result_bytes_sha256: sha256Bytes(resultBytes),
    trace_bundle_sha256: sha256Bytes(trace.raw),
    stderr_sha256: sha256Bytes(stderr),
  };
  return {
    adapter,
    reviewer_id: reviewerId,
    reviewer_result: result,
    reviewer_result_bytes: resultBytes,
    events: {
      ...events,
      provenance_sha256: reviewProvenanceSha256(events),
    },
  };
}

function unavailableNativeEvidence(trace, stderr) {
  const waits = trace.records.filter(
    (record) =>
      completedCollaborationItem(record) &&
      WAIT_TOOL_NAMES.has(record.value.item.tool),
  );
  const emptyWaitObserved = waits.some(
    (record) => candidateIds(record.value.item).length === 0,
  );
  const failedSpawnObserved =
    /collab(?:oration)?\s+spawn\s+failed|spawn[^\n]*failed/i.test(stderr);
  const events = {
    spawn_event_sha256: null,
    spawn_returned_worker_id: null,
    wait_event_sha256:
      waits.length > 0 ? sha256Bytes(waits[0].bytes) : null,
    wait_target_worker_id: null,
    final_result_event_sha256: null,
    reviewer_result_bytes_sha256: null,
    trace_bundle_sha256: sha256Bytes(trace.raw),
    stderr_sha256: sha256Bytes(stderr),
  };
  return {
    adapter: CODEX_NATIVE_ADAPTER,
    outcome: "unavailable",
    unavailable: {
      reason_code: failedSpawnObserved
        ? "native-spawn-failed"
        : "native-spawn-missing",
      failed_spawn_observed: failedSpawnObserved,
      empty_wait_observed: emptyWaitObserved,
    },
    events: {
      ...events,
      provenance_sha256: reviewProvenanceSha256(events),
    },
  };
}

function parseCodexNativeReviewJsonl(
  rawJsonl,
  expected,
  { stderr = "", allowUnavailable = false } = {},
) {
  const trace = traceRecords(rawJsonl);
  const stderrText = String(stderr ?? "");
  const spawnRecords = trace.records.filter(
    (record) =>
      completedCollaborationItem(record) &&
      SPAWN_TOOL_NAMES.has(record.value.item.tool) &&
      promptMatchesExpected(record.value.item.prompt, expected),
  );
  const successfulSpawns = spawnRecords
    .map((record) => ({
      record,
      ids: candidateIds(record.value.item),
    }))
    .filter(
      ({ record, ids }) =>
        ids.length === 1 &&
        record.value.item.result?.ok !== false &&
        record.value.item.result?.status !== "failed",
    );
  if (successfulSpawns.length === 0) {
    if (allowUnavailable) {
      return unavailableNativeEvidence(trace, stderrText);
    }
    throw new ReviewAttestationError(
      "Codex native review has no successful nonempty spawn event",
    );
  }
  if (successfulSpawns.length !== 1) {
    throw new ReviewAttestationError(
      "Codex native review requires exactly one matching successful spawn",
    );
  }
  const spawn = successfulSpawns[0].record;
  const reviewerId = successfulSpawns[0].ids[0];
  if (
    expected.reviewer_session_id &&
    reviewerId !== expected.reviewer_session_id
  ) {
    throw new ReviewAttestationError(
      "Codex native spawn returned an unexpected reviewer ID",
    );
  }
  if (reviewerId === expected.primary_session_id) {
    throw new ReviewAttestationError(
      "Codex native reviewer ID must differ from the primary session",
    );
  }
  const waits = trace.records.filter((record) => {
    if (
      !completedCollaborationItem(record) ||
      !WAIT_TOOL_NAMES.has(record.value.item.tool)
    ) {
      return false;
    }
    const ids = candidateIds(record.value.item);
    return ids.length === 1 && ids[0] === reviewerId;
  });
  if (waits.length !== 1) {
    throw new ReviewAttestationError(
      "Codex native review requires one wait targeting the exact spawned reviewer",
    );
  }
  const wait = waits[0];
  if (spawn.line >= wait.line) {
    throw new ReviewAttestationError(
      "Codex native wait must occur after the successful spawn",
    );
  }
  const state = stateForWorker(wait.value.item, reviewerId);
  if (
    !plainObject(state) ||
    !TERMINAL_WORKER_STATES.has(String(state.status ?? "").toLowerCase())
  ) {
    throw new ReviewAttestationError(
      "Codex native wait did not return a terminal reviewer state",
    );
  }
  const rawResult = finalResultFromState(state, wait.value.item);
  const result = structuredReviewerResult(rawResult);
  validateReviewerResult(result, expected, reviewerId);
  return {
    outcome: "succeeded",
    ...reviewEventEvidence({
      adapter: CODEX_NATIVE_ADAPTER,
      trace,
      stderr: stderrText,
      spawn,
      wait,
      final: wait,
      reviewerId,
      result,
    }),
  };
}

function isolatedRecord(record, type) {
  return record.value?.type === type && record.value?.status === "completed";
}

function parseCodexIsolatedSessionJsonl(
  rawJsonl,
  expected,
  { stderr = "" } = {},
) {
  const trace = traceRecords(rawJsonl);
  const launches = trace.records.filter((record) =>
    isolatedRecord(record, "uas.outer.review.launch.completed"),
  );
  if (launches.length !== 1) {
    throw new ReviewAttestationError(
      "Isolated review requires exactly one completed outer launch",
    );
  }
  const launch = launches[0];
  const launchValue = launch.value;
  const reviewerId = launchValue.session_id;
  if (
    typeof reviewerId !== "string" ||
    reviewerId.length === 0 ||
    reviewerId === expected.primary_session_id
  ) {
    throw new ReviewAttestationError(
      "Isolated review requires a nonempty distinct session ID",
    );
  }
  for (const [actual, expectedValue, label] of [
    [launchValue.assignment_id, expected.assignment_id, "assignment_id"],
    [
      launchValue.delivery_baseline_revision,
      expected.delivery_baseline_revision,
      "delivery_baseline_revision",
    ],
    [
      launchValue.reviewed_revision,
      expected.reviewed_revision,
      "reviewed_revision",
    ],
  ]) {
    if (actual !== expectedValue) {
      throw new ReviewAttestationError(
        `Isolated review launch binding mismatch: ${label}`,
      );
    }
  }
  if (
    launchValue.read_only !== true ||
    launchValue.network_access !== "disabled" ||
    launchValue.external_actions !== false
  ) {
    throw new ReviewAttestationError(
      "Isolated review launch must be read-only, network-disabled, and external-action-free",
    );
  }
  const waits = trace.records.filter(
    (record) =>
      isolatedRecord(record, "uas.outer.review.wait.completed") &&
      record.value.session_id === reviewerId,
  );
  if (
    waits.length !== 1 ||
    waits[0].value.exit_status !== 0 ||
    waits[0].value.signal !== null
  ) {
    throw new ReviewAttestationError(
      "Isolated review requires one exact-session wait with exit 0 and no signal",
    );
  }
  const finals = trace.records.filter(
    (record) =>
      isolatedRecord(record, "uas.outer.review.result.completed") &&
      record.value.session_id === reviewerId,
  );
  if (finals.length !== 1) {
    throw new ReviewAttestationError(
      "Isolated review requires one exact-session terminal result",
    );
  }
  if (
    launch.line >= waits[0].line ||
    waits[0].line >= finals[0].line
  ) {
    throw new ReviewAttestationError(
      "Isolated review requires launch before wait before terminal result",
    );
  }
  const result = structuredReviewerResult(finals[0].value.result);
  validateReviewerResult(result, expected, reviewerId);
  return {
    outcome: "succeeded",
    ...reviewEventEvidence({
      adapter: CODEX_ISOLATED_SESSION_ADAPTER,
      trace,
      stderr: String(stderr ?? ""),
      spawn: launch,
      wait: waits[0],
      final: finals[0],
      reviewerId,
      result,
    }),
  };
}

function safeRelativeProjectPath(raw, label) {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.includes("\0") ||
    raw.includes("\\") ||
    isAbsolute(raw)
  ) {
    throw new ReviewAttestationError(`${label} must be a safe relative path`);
  }
  const normalized = posix.normalize(raw);
  if (
    normalized !== raw ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    throw new ReviewAttestationError(`${label} must be a canonical relative path`);
  }
  return normalized;
}

function projectFileWithoutSymlinks(target, raw, label) {
  const canonicalTarget = realpathSync(target);
  const safe = safeRelativeProjectPath(raw, label);
  const candidate = resolve(canonicalTarget, ...safe.split("/"));
  const relation = relative(canonicalTarget, candidate);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new ReviewAttestationError(`${label} escapes the project root`);
  }
  let cursor = canonicalTarget;
  for (const component of relation.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, component);
    if (!existsSync(cursor)) {
      throw new ReviewAttestationError(`${label} does not exist: ${safe}`);
    }
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new ReviewAttestationError(`${label} crosses a symlink: ${safe}`);
    }
  }
  return candidate;
}

function hardenedGitEnvironment() {
  const environment = {};
  for (const name of [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "LANG",
    "LC_ALL",
    "TMP",
    "TEMP",
    "TMPDIR",
  ]) {
    if (typeof process.env[name] === "string") {
      environment[name] = process.env[name];
    }
  }
  return {
    ...environment,
    HOME: tmpdir(),
    USERPROFILE: tmpdir(),
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "",
    GIT_TERMINAL_PROMPT: "0",
    PAGER: "",
  };
}

function hardenedGit(target, args, { binary = false } = {}) {
  const result = spawnSync(
    "git",
    [
      "--no-replace-objects",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "-c",
      "diff.external=",
      "-c",
      "core.pager=",
      "-c",
      "pager.diff=false",
      "-c",
      "pager.status=false",
      "-c",
      "submodule.recurse=false",
      "-C",
      target,
      ...args,
    ],
    {
      encoding: binary ? null : "utf8",
      shell: false,
      timeout: 20_000,
      env: hardenedGitEnvironment(),
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new ReviewAttestationError(
      `Hardened Git inspection failed: git ${args.join(" ")}`,
      [String(result.stderr ?? "").trim()].filter(Boolean),
    );
  }
  return result.stdout;
}

function directoryIdentity(target) {
  const canonical = realpathSync(resolve(target));
  const stats = statSync(canonical, { bigint: true });
  if (!stats.isDirectory()) {
    throw new ReviewAttestationError(
      "Review attestation target must resolve to a directory",
    );
  }
  return {
    canonical,
    device: stats.dev,
    inode: stats.ino,
  };
}

function sameNonzeroFilesystemIdentity(left, right) {
  return (
    left.inode !== 0n &&
    right.inode !== 0n &&
    left.device === right.device &&
    left.inode === right.inode
  );
}

function sameDirectory(left, right) {
  const leftIdentity = directoryIdentity(left);
  const rightIdentity = directoryIdentity(right);
  if (leftIdentity.canonical === rightIdentity.canonical) {
    return true;
  }
  if (process.platform !== "win32") {
    return false;
  }
  return sameNonzeroFilesystemIdentity(leftIdentity, rightIdentity);
}

function postReviewAllowlist(candidatePath, requested) {
  const fixed = [
    ...POST_REVIEW_PACKAGING_PATHS,
    ...(candidatePath ? [candidatePath] : []),
  ];
  for (const entry of requested) {
    const safe = safeRelativeProjectPath(entry, "allowed post-review path");
    if (!fixed.includes(safe)) {
      throw new ReviewAttestationError(
        `Post-review path is not in the fixed packaging allowlist: ${safe}`,
      );
    }
  }
  return new Set(fixed);
}

function inspectCandidate(target, candidatePath) {
  if (!REVIEW_CANDIDATE_PATH.test(candidatePath ?? "")) {
    throw new ReviewAttestationError(
      "Candidate path must name a canonical project review receipt",
    );
  }
  const file = projectFileWithoutSymlinks(
    target,
    candidatePath,
    "review candidate",
  );
  if (!statSync(file).isFile()) {
    throw new ReviewAttestationError("Review candidate must be a real file");
  }
  const bytes = readFileSync(file);
  if (bytes.length === 0 || bytes.length > MAX_CANDIDATE_BYTES) {
    throw new ReviewAttestationError(
      `Review candidate must contain 1..${MAX_CANDIDATE_BYTES} bytes`,
    );
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new ReviewAttestationError(
      `Review candidate is invalid JSON: ${error.message}`,
    );
  }
  if (!plainObject(value)) {
    throw new ReviewAttestationError("Review candidate must contain an object");
  }
  const listing = hardenedGit(
    target,
    ["ls-tree", "-z", "HEAD", "--", candidatePath],
    { binary: true },
  );
  const fields = listing
    .subarray(0, Math.max(0, listing.length - 1))
    .toString("utf8")
    .match(/^([0-9]{6}) blob ([a-f0-9]{40,64})\t(.+)$/);
  if (!fields || fields[1] !== "100644" || fields[3] !== candidatePath) {
    throw new ReviewAttestationError(
      "Review candidate must be a committed regular file at final HEAD",
    );
  }
  const blob = hardenedGit(target, ["cat-file", "blob", fields[2]], {
    binary: true,
  });
  if (!blob.equals(bytes)) {
    throw new ReviewAttestationError(
      "Review candidate working bytes differ from the committed Git blob",
    );
  }
  return {
    path: candidatePath,
    bytes_sha256: sha256Bytes(bytes),
    git_blob_oid: fields[2],
    value,
  };
}

function inspectFinalProjectState(
  target,
  {
    candidatePath = null,
    baselineRevision = null,
    reviewedRevision = null,
    allowedPostReviewPaths = [],
  } = {},
) {
  const canonicalTarget = realpathSync(resolve(target));
  const root = parse(canonicalTarget).root;
  if (
    sameDirectory(canonicalTarget, root) ||
    sameDirectory(canonicalTarget, homedir())
  ) {
    throw new ReviewAttestationError(
      "Refusing broad project target for review attestation",
    );
  }
  const topLevel = hardenedGit(
    canonicalTarget,
    ["rev-parse", "--show-toplevel"],
  ).trim();
  if (!sameDirectory(topLevel, canonicalTarget)) {
    throw new ReviewAttestationError(
      "Review attestation target must be the exact Git worktree root",
    );
  }
  const objectFormat = hardenedGit(
    canonicalTarget,
    ["rev-parse", "--show-object-format"],
  ).trim();
  const headRevision = hardenedGit(
    canonicalTarget,
    ["rev-parse", "--verify", "HEAD^{commit}"],
  ).trim();
  const gitTreeOid = hardenedGit(
    canonicalTarget,
    ["rev-parse", "--verify", "HEAD^{tree}"],
  ).trim();
  const status = hardenedGit(
    canonicalTarget,
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ],
    { binary: true },
  );
  if (status.length !== 0) {
    throw new ReviewAttestationError(
      "Final review-attested project state must be clean",
    );
  }
  if (baselineRevision) {
    if (!GIT_COMMIT.test(baselineRevision)) {
      throw new ReviewAttestationError(
        "Delivery baseline revision must be a full Git object ID",
      );
    }
    hardenedGit(canonicalTarget, [
      "cat-file",
      "-e",
      `${baselineRevision}^{commit}`,
    ]);
  }
  let postReviewPaths = [];
  let reviewedPaths = [];
  if (reviewedRevision) {
    if (!GIT_COMMIT.test(reviewedRevision)) {
      throw new ReviewAttestationError(
        "Reviewed revision must be a full Git object ID",
      );
    }
    hardenedGit(canonicalTarget, [
      "cat-file",
      "-e",
      `${reviewedRevision}^{commit}`,
    ]);
    if (baselineRevision) {
      hardenedGit(canonicalTarget, [
        "merge-base",
        "--is-ancestor",
        baselineRevision,
        reviewedRevision,
      ]);
      const reviewed = hardenedGit(
        canonicalTarget,
        [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "--name-only",
          "-z",
          baselineRevision,
          reviewedRevision,
          "--",
        ],
        { binary: true },
      );
      reviewedPaths = reviewed
        .toString("utf8")
        .split("\0")
        .filter(Boolean)
        .sort();
      if (
        !reviewedPaths.some((path) => !path.startsWith(".agent-stack/"))
      ) {
        throw new ReviewAttestationError(
          "Reviewed revision contains no product change from the delivery baseline",
        );
      }
    }
    hardenedGit(canonicalTarget, [
      "merge-base",
      "--is-ancestor",
      reviewedRevision,
      headRevision,
    ]);
    const changed = hardenedGit(
      canonicalTarget,
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--name-only",
        "-z",
        reviewedRevision,
        headRevision,
        "--",
      ],
      { binary: true },
    );
    postReviewPaths = changed
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .sort();
    const allowed = postReviewAllowlist(
      candidatePath,
      allowedPostReviewPaths,
    );
    const forbidden = postReviewPaths.filter((path) => !allowed.has(path));
    if (forbidden.length > 0) {
      throw new ReviewAttestationError(
        `Product or control paths changed after review: ${forbidden.join(", ")}`,
      );
    }
  }
  const candidate = candidatePath
    ? inspectCandidate(canonicalTarget, candidatePath)
    : null;
  const treeManifest = hardenedGit(
    canonicalTarget,
    ["ls-tree", "-r", "-z", "--full-tree", "HEAD"],
    { binary: true },
  );
  const state = {
    head_revision: headRevision,
    git_tree_oid: gitTreeOid,
    git_object_format: objectFormat,
    git_tree_manifest_sha256: sha256Bytes(treeManifest),
    clean: true,
    reviewed_paths: reviewedPaths,
    reviewed_paths_sha256: sha256Bytes(
      canonicalPayloadSerialization(reviewedPaths),
    ),
    post_review_paths: postReviewPaths,
    post_review_paths_sha256: sha256Bytes(
      canonicalPayloadSerialization(postReviewPaths),
    ),
    candidate:
      candidate === null
        ? null
        : {
            path: candidate.path,
            bytes_sha256: candidate.bytes_sha256,
            git_blob_oid: candidate.git_blob_oid,
          },
  };
  return {
    ...state,
    project_state_sha256: sha256Bytes(canonicalPayloadSerialization(state)),
    candidate_value: candidate?.value ?? null,
  };
}

function expectedMetadata(expected, adapter) {
  const required = [
    "batch_id",
    "project_instance_sha256",
    "package_surface_sha256",
    "collector_id",
    "collector_version",
    "adapter_sha256",
    "harness_name",
    "harness_version",
    "primary_session_id",
    "assignment_id",
    "work_item_id",
    "evidence_node_id",
    "delivery_baseline_revision",
    "reviewed_revision",
  ];
  for (const key of required) {
    if (typeof expected?.[key] !== "string" || expected[key].length === 0) {
      throw new ReviewAttestationError(`Expected binding is missing: ${key}`);
    }
  }
  return {
    batch_id: expected.batch_id,
    project_instance_sha256: expected.project_instance_sha256,
    package_surface_sha256: expected.package_surface_sha256,
    collector: {
      id: expected.collector_id,
      version: expected.collector_version,
      adapter,
      adapter_sha256: expected.adapter_sha256,
    },
  };
}

function candidateMatchesExpected(candidate, expected, reviewEvidence) {
  const errors = [];
  const unexpectedKeys = Object.keys(candidate).filter(
    (key) => !REVIEW_RECEIPT_KEYS.has(key),
  );
  if (unexpectedKeys.length > 0) {
    errors.push(
      `review candidate contains unknown keys: ${unexpectedKeys.sort().join(", ")}`,
    );
  }
  if (candidate.schema_version !== 1) {
    errors.push("review candidate schema_version must equal 1");
  }
  let canonicalReceiptId = null;
  try {
    canonicalReceiptId = reviewReceiptId(candidate);
  } catch (error) {
    errors.push(error.message);
  }
  if (
    typeof candidate.receipt_id !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.receipt_id)
  ) {
    errors.push("review candidate receipt_id must be a sha256 hex digest");
  } else if (candidate.receipt_id !== canonicalReceiptId) {
    errors.push(
      "review candidate receipt_id does not match canonical receipt content",
    );
  }
  for (const [candidateKey, expectedKey] of [
    ["assignment_id", "assignment_id"],
    ["work_item_id", "work_item_id"],
    ["evidence_node_id", "evidence_node_id"],
    ["base_revision", "delivery_baseline_revision"],
    ["reviewed_revision", "reviewed_revision"],
  ]) {
    if (candidate[candidateKey] !== expected[expectedKey]) {
      errors.push(`review candidate binding mismatch: ${candidateKey}`);
    }
  }
  if (candidate.reviewer_id !== reviewEvidence.reviewer_id) {
    errors.push("review candidate reviewer_id does not match raw evidence");
  }
  const mechanism =
    reviewEvidence.adapter === CODEX_NATIVE_ADAPTER
      ? "native-subagent"
      : reviewEvidence.adapter === CODEX_ISOLATED_SESSION_ADAPTER
        ? "isolated-session"
        : null;
  if (candidate.mechanism !== mechanism) {
    errors.push("review candidate mechanism does not match collector adapter");
  }
  if (candidate.harness !== reviewEvidence.adapter) {
    errors.push("review candidate harness does not match collector adapter");
  }
  if (
    candidate.delivery_baseline !==
    `.agent-stack/artifacts/DELIVERY.md@${expected.delivery_baseline_revision}`
  ) {
    errors.push("review candidate delivery_baseline is not exact");
  }
  if (
    candidate.standards_verdict !== "passed" ||
    candidate.intent_verdict !== "passed" ||
    candidate.result !== "succeeded"
  ) {
    errors.push("review candidate does not contain a successful two-axis result");
  }
  if (
    candidate.reviewer_result_sha256 !==
    reviewEvidence.events.reviewer_result_bytes_sha256
  ) {
    errors.push("review candidate reviewer_result_sha256 does not match raw result");
  }
  if (
    candidate.provenance_sha256 !==
    reviewEvidence.events.provenance_sha256
  ) {
    errors.push(
      "review candidate provenance_sha256 does not bind the exact raw event set",
    );
  }
  if (
    candidate.read_only !== true ||
    candidate.external_actions !== false
  ) {
    errors.push(
      "review candidate must retain the read-only no-external-action boundary",
    );
  }
  if (
    candidate.started_at !== reviewEvidence.reviewer_result?.started_at ||
    candidate.completed_at !== reviewEvidence.reviewer_result?.completed_at
  ) {
    errors.push("review candidate timestamps do not match the raw result");
  }
  if (errors.length > 0) {
    throw new ReviewAttestationError(
      "Review candidate failed outer evidence binding",
      errors,
    );
  }
}

function collectCodexReviewAttestationPayload({
  rawJsonl,
  stderr = "",
  target,
  candidatePath = null,
  expected,
  allowedPostReviewPaths = [],
  allowUnavailable = false,
  adapter = CODEX_NATIVE_ADAPTER,
}) {
  const reviewEvidence =
    adapter === CODEX_ISOLATED_SESSION_ADAPTER
      ? parseCodexIsolatedSessionJsonl(rawJsonl, expected, { stderr })
      : adapter === CODEX_NATIVE_ADAPTER
        ? parseCodexNativeReviewJsonl(rawJsonl, expected, {
            stderr,
            allowUnavailable,
          })
        : (() => {
            throw new ReviewAttestationError(
              `Unsupported Codex review adapter: ${adapter}`,
            );
          })();
  const finalState = inspectFinalProjectState(target, {
    candidatePath,
    baselineRevision: expected.delivery_baseline_revision,
    reviewedRevision:
      reviewEvidence.outcome === "succeeded"
        ? expected.reviewed_revision
        : null,
    allowedPostReviewPaths,
  });
  const metadata = expectedMetadata(expected, reviewEvidence.adapter);
  if (reviewEvidence.outcome === "succeeded") {
    if (!candidatePath || !finalState.candidate_value) {
      throw new ReviewAttestationError(
        "Successful review attestation requires a committed candidate receipt",
      );
    }
    candidateMatchesExpected(
      finalState.candidate_value,
      expected,
      reviewEvidence,
    );
    if (
      finalState.candidate_value.receipt_id !==
      candidatePath
        .slice(candidatePath.lastIndexOf("/") + 1)
        .slice(0, -5)
    ) {
      throw new ReviewAttestationError(
        "Review candidate file name must match its canonical receipt_id",
      );
    }
  }
  const startedAt =
    reviewEvidence.reviewer_result?.started_at ?? expected.started_at;
  const completedAt =
    reviewEvidence.reviewer_result?.completed_at ?? expected.completed_at;
  if (!isUtcTimestamp(startedAt) || !isUtcTimestamp(completedAt)) {
    throw new ReviewAttestationError(
      "Expected or reviewer timestamps must be UTC timestamps",
    );
  }
  return {
    schema_version: 1,
    kind: REVIEW_PAYLOAD_KIND,
    outcome: reviewEvidence.outcome,
    ...metadata,
    harness: {
      name: expected.harness_name,
      version: expected.harness_version,
      primary_session_id: expected.primary_session_id,
      reviewer_session_id: reviewEvidence.reviewer_id ?? null,
    },
    assignment: {
      id: expected.assignment_id,
      work_item_id: expected.work_item_id,
      evidence_node_id: expected.evidence_node_id,
      delivery_baseline_revision: expected.delivery_baseline_revision,
      reviewed_revision: expected.reviewed_revision,
    },
    events: reviewEvidence.events,
    verdicts:
      reviewEvidence.outcome === "succeeded"
        ? { standards: "passed", intent: "passed" }
        : null,
    boundary:
      reviewEvidence.outcome === "succeeded"
        ? { read_only: true, external_actions: false }
        : null,
    candidate:
      finalState.candidate === null
        ? null
        : {
            path: finalState.candidate.path,
            bytes_sha256: finalState.candidate.bytes_sha256,
            git_blob_oid: finalState.candidate.git_blob_oid,
          },
    final_state: {
      head_revision: finalState.head_revision,
      git_tree_oid: finalState.git_tree_oid,
      git_object_format: finalState.git_object_format,
      git_tree_manifest_sha256: finalState.git_tree_manifest_sha256,
      project_state_sha256: finalState.project_state_sha256,
      clean: finalState.clean,
      reviewed_paths: finalState.reviewed_paths,
      reviewed_paths_sha256: finalState.reviewed_paths_sha256,
      post_review_paths: finalState.post_review_paths,
      post_review_paths_sha256: finalState.post_review_paths_sha256,
    },
    unavailable: reviewEvidence.unavailable ?? null,
    started_at: startedAt,
    completed_at: completedAt,
  };
}

function collectCodexIsolatedSessionAttestationPayload(options) {
  return collectCodexReviewAttestationPayload({
    ...options,
    adapter: CODEX_ISOLATED_SESSION_ADAPTER,
    allowUnavailable: false,
  });
}

function capabilityMetadata(expected) {
  for (const key of [
    "batch_id",
    "project_instance_sha256",
    "package_surface_sha256",
    "collector_id",
    "collector_version",
    "adapter_sha256",
  ]) {
    if (typeof expected?.[key] !== "string" || expected[key].length === 0) {
      throw new ReviewAttestationError(
        `Expected capability binding is missing: ${key}`,
      );
    }
  }
  return {
    batch_id: expected.batch_id,
    project_instance_sha256: expected.project_instance_sha256,
    package_surface_sha256: expected.package_surface_sha256,
    collector: {
      id: expected.collector_id,
      version: expected.collector_version,
      adapter: CAPABILITY_ADAPTER,
      adapter_sha256: expected.adapter_sha256,
    },
  };
}

function normalizedRequiredProductPaths(paths = []) {
  if (!Array.isArray(paths)) {
    throw new ReviewAttestationError(
      "required_product_paths must be an array",
    );
  }
  const normalized = paths.map((path) =>
    safeRelativeProjectPath(path, "required product path"),
  );
  if (
    normalized.some((path) => path.startsWith(".agent-stack/")) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new ReviewAttestationError(
      "required_product_paths must be unique product paths",
    );
  }
  return normalized.sort();
}

function baselineStateFromInspection(state) {
  return {
    head_revision: state.head_revision,
    git_tree_oid: state.git_tree_oid,
    git_object_format: state.git_object_format,
    git_tree_manifest_sha256: state.git_tree_manifest_sha256,
    project_state_sha256: state.project_state_sha256,
    clean: state.clean,
  };
}

function finalStateFromInspection(state) {
  return {
    head_revision: state.head_revision,
    git_tree_oid: state.git_tree_oid,
    git_object_format: state.git_object_format,
    git_tree_manifest_sha256: state.git_tree_manifest_sha256,
    project_state_sha256: state.project_state_sha256,
    clean: state.clean,
    reviewed_paths: state.reviewed_paths,
    reviewed_paths_sha256: state.reviewed_paths_sha256,
    post_review_paths: state.post_review_paths,
    post_review_paths_sha256: state.post_review_paths_sha256,
  };
}

function inspectCapabilityFinalProjectState(target, baselineRevision) {
  if (!GIT_COMMIT.test(baselineRevision ?? "")) {
    throw new ReviewAttestationError(
      "Capability delivery baseline must be a full Git object ID",
    );
  }
  const finalState = inspectFinalProjectState(target);
  hardenedGit(target, [
    "cat-file",
    "-e",
    `${baselineRevision}^{commit}`,
  ]);
  hardenedGit(target, [
    "merge-base",
    "--is-ancestor",
    baselineRevision,
    finalState.head_revision,
  ]);
  if (finalState.head_revision === baselineRevision) {
    throw new ReviewAttestationError(
      "Capability final revision must differ from its delivery baseline",
    );
  }
  const changed = hardenedGit(
    target,
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--name-only",
      "-z",
      baselineRevision,
      finalState.head_revision,
      "--",
    ],
    { binary: true },
  );
  const changedPaths = changed
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => safeRelativeProjectPath(path, "changed path"))
    .sort();
  if (
    changedPaths.length === 0 ||
    !changedPaths.some((path) => !path.startsWith(".agent-stack/"))
  ) {
    throw new ReviewAttestationError(
      "Capability final revision must contain a product change from the delivery baseline",
    );
  }
  return {
    finalState,
    baseline_ancestor: true,
    changed_paths: changedPaths,
    changed_paths_sha256: sha256Bytes(
      canonicalPayloadSerialization(changedPaths),
    ),
  };
}

function collectCapabilityPreflightPayload({
  target,
  expected,
  capabilities,
}) {
  const baselineInspection = inspectFinalProjectState(target);
  const metadata = capabilityMetadata(expected);
  if (
    typeof expected.primary_session_id !== "string" ||
    expected.primary_session_id.length === 0
  ) {
    throw new ReviewAttestationError(
      "Expected capability binding is missing: primary_session_id",
    );
  }
  if (
    expected.delivery_baseline_revision !==
    baselineInspection.head_revision
  ) {
    throw new ReviewAttestationError(
      "Capability preflight delivery baseline must equal current HEAD",
    );
  }
  const requiredProductPaths = normalizedRequiredProductPaths(
    expected.required_product_paths ?? [],
  );
  const intendedFinalRevision =
    expected.intended_final_revision ?? null;
  const payload = {
    schema_version: 1,
    kind: CAPABILITY_PREFLIGHT_PAYLOAD_KIND,
    outcome: "unavailable",
    capability: "independent-review",
    ...metadata,
    harness: {
      primary_session_id: expected.primary_session_id,
    },
    assignment: {
      delivery_baseline_revision:
        expected.delivery_baseline_revision,
      intended_final_revision: intendedFinalRevision,
      required_product_paths: requiredProductPaths,
      required_product_paths_sha256: sha256Bytes(
        canonicalPayloadSerialization(requiredProductPaths),
      ),
    },
    capabilities: canonicalValue(capabilities),
    checked_at: expected.checked_at,
    baseline_state: baselineStateFromInspection(baselineInspection),
  };
  const errors = validateCapabilityPreflightPayload(payload);
  if (errors.length > 0) {
    throw new ReviewAttestationError(
      "Capability preflight payload is invalid",
      errors,
    );
  }
  return payload;
}

function collectCapabilityAttestationPayload({
  target,
  expected,
  preflightAttestation,
  preflightKeyring,
}) {
  const metadata = capabilityMetadata(expected);
  const expectedPreflightBindings = {
    outcome: "unavailable",
    batch_id: expected.batch_id,
    project_instance_sha256: expected.project_instance_sha256,
    package_surface_sha256: expected.package_surface_sha256,
    primary_session_id: expected.primary_session_id,
    delivery_baseline_revision:
      expected.delivery_baseline_revision,
    capability: "independent-review",
    ...(Object.hasOwn(expected, "intended_final_revision")
      ? {
          intended_final_revision:
            expected.intended_final_revision ?? null,
        }
      : {}),
    ...(Object.hasOwn(expected, "required_product_paths")
      ? {
          required_product_paths_sha256: sha256Bytes(
            canonicalPayloadSerialization(
              normalizedRequiredProductPaths(
                expected.required_product_paths,
              ),
            ),
          ),
        }
      : {}),
  };
  const preflightVerification =
    verifyCapabilityPreflightAttestation(
      preflightAttestation,
      preflightKeyring,
      expectedPreflightBindings,
      { now: preflightAttestation?.payload?.checked_at },
    );
  if (!preflightVerification.ok) {
    throw new ReviewAttestationError(
      "Capability preflight attestation failed verification",
      preflightVerification.errors,
    );
  }
  const preflight = preflightVerification.payload;
  const execution = inspectCapabilityFinalProjectState(
    target,
    preflight.assignment.delivery_baseline_revision,
  );
  for (const required of preflight.assignment.required_product_paths) {
    if (!execution.changed_paths.includes(required)) {
      throw new ReviewAttestationError(
        `Capability final change is missing required product path: ${required}`,
      );
    }
  }
  if (
    preflight.assignment.intended_final_revision !== null &&
    preflight.assignment.intended_final_revision !==
      execution.finalState.head_revision
  ) {
    throw new ReviewAttestationError(
      "Capability final HEAD differs from the preflight intended final revision",
    );
  }
  if (
    !isUtcTimestamp(expected.session_started_at) ||
    !isUtcTimestamp(expected.completed_at)
  ) {
    throw new ReviewAttestationError(
      "Capability session and completion timestamps must be UTC timestamps",
    );
  }
  const payload = {
    schema_version: 1,
    kind: CAPABILITY_PAYLOAD_KIND,
    outcome: "unavailable",
    capability: "independent-review",
    ...metadata,
    harness: canonicalValue(preflight.harness),
    assignment: canonicalValue(preflight.assignment),
    preflight_sha256:
      capabilityPreflightAttestationSha256(preflightAttestation),
    preflight_key_id: preflightAttestation.signature.key_id,
    checked_at: preflight.checked_at,
    session_started_at: expected.session_started_at,
    baseline_ancestor: execution.baseline_ancestor,
    changed_paths: execution.changed_paths,
    changed_paths_sha256: execution.changed_paths_sha256,
    final_state: finalStateFromInspection(execution.finalState),
    completed_at: expected.completed_at,
  };
  const errors = validateCapabilityPayload(payload);
  if (errors.length > 0) {
    throw new ReviewAttestationError(
      "Capability attestation payload is invalid",
      errors,
    );
  }
  return payload;
}

export {
  CAPABILITY_ADAPTER,
  CAPABILITY_MECHANISMS,
  CAPABILITY_PAYLOAD_KIND,
  CAPABILITY_PREFLIGHT_PAYLOAD_KIND,
  CODEX_ISOLATED_SESSION_ADAPTER,
  CODEX_NATIVE_ADAPTER,
  KEYRING_KIND,
  POST_REVIEW_PACKAGING_PATHS,
  REVIEW_ATTESTATION_KIND,
  REVIEW_PAYLOAD_KIND,
  REVIEW_RESULT_KIND,
  ReviewAttestationError,
  canonicalPayloadSerialization,
  capabilityPreflightAttestationSha256,
  collectCapabilityAttestationPayload,
  collectCapabilityPreflightPayload,
  collectCodexIsolatedSessionAttestationPayload,
  collectCodexReviewAttestationPayload,
  ed25519KeyId,
  inspectFinalProjectState,
  inspectCapabilityFinalProjectState,
  parseCodexIsolatedSessionJsonl,
  parseCodexNativeReviewJsonl,
  reviewProvenanceSha256,
  reviewReceiptId,
  sameNonzeroFilesystemIdentity,
  sha256Bytes,
  signReviewAttestation,
  validateReviewAttestationKeyring,
  verifyCapabilityAttestation,
  verifyCapabilityPreflightAttestation,
  verifyReviewAttestation,
};
