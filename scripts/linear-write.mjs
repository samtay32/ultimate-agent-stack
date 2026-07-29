#!/usr/bin/env node

import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";
const MAX_INPUT_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SECRET_LIKE =
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]|\b(?:gh[pousr]|npm|sk)-?[A-Za-z0-9_]{20,}\b)/i;

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (
    actual.length !== expected.size ||
    actual.some((key) => !expected.has(key))
  ) {
    throw new Error(`${label} contains unsupported fields`);
  }
  return value;
}

function boundedText(value, label, maximum) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim().length === 0 ||
    value.length > maximum ||
    /[\0]/.test(value) ||
    SECRET_LIKE.test(value)
  ) {
    throw new Error(`${label} is invalid or contains credential-like text`);
  }
  return value;
}

async function readBoundedStream(stream, maximumBytes) {
  if (!stream) {
    return { ok: true, text: "", bytes: 0 };
  }
  if (typeof stream.getReader !== "function") {
    if (typeof stream[Symbol.asyncIterator] !== "function") {
      return { ok: false, text: "", bytes: 0 };
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of stream) {
      if (
        !(chunk instanceof Uint8Array) &&
        typeof chunk !== "string"
      ) {
        return { ok: false, text: "", bytes: 0 };
      }
      const value =
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        return { ok: false, text: "", bytes };
      }
      chunks.push(value);
    }
    return {
      ok: true,
      text: Buffer.concat(chunks, bytes).toString("utf8"),
      bytes,
    };
  }
  const reader = stream.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!(value instanceof Uint8Array)) {
        return { ok: false, text: "", bytes: 0 };
      }
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The bounded failure below remains authoritative.
        }
        return { ok: false, text: "", bytes };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return {
    ok: true,
    text: Buffer.concat(chunks, bytes).toString("utf8"),
    bytes,
  };
}

async function readInput(stream = process.stdin) {
  const capture = await readBoundedStream(stream, MAX_INPUT_BYTES);
  if (!capture.ok) {
    throw new Error("Linear write input exceeded the bounded limit");
  }
  try {
    return JSON.parse(capture.text);
  } catch {
    throw new Error("Linear write input must be valid JSON");
  }
}

function operationRequest(command, input) {
  if (command === "issue-create") {
    const value = exactObject(
      input,
      ["issue_id", "team_id", "title", "description"],
      "issue-create input",
    );
    if (!UUID.test(value.issue_id) || !UUID.test(value.team_id)) {
      throw new Error("issue-create identifiers must be UUIDs");
    }
    return {
      credential: "LINEAR_CREATE_API_KEY",
      query: [
        "mutation UltimateAgentStackIssueCreate($input: IssueCreateInput!) {",
        "  issueCreate(input: $input) {",
        "    success",
        "    issue { id identifier }",
        "  }",
        "}",
      ].join("\n"),
      variables: {
        input: {
          id: value.issue_id,
          teamId: value.team_id,
          title: boundedText(value.title, "issue title", 200),
          description: boundedText(
            value.description,
            "issue description",
            12_000,
          ),
        },
      },
      responseField: "issueCreate",
      entityField: "issue",
    };
  }
  if (command === "evidence-comment") {
    const value = exactObject(
      input,
      ["comment_id", "issue_id", "body"],
      "evidence-comment input",
    );
    if (!UUID.test(value.comment_id) || !UUID.test(value.issue_id)) {
      throw new Error("evidence-comment identifiers must be UUIDs");
    }
    return {
      credential: "LINEAR_COMMENT_API_KEY",
      query: [
        "mutation UltimateAgentStackEvidenceComment($input: CommentCreateInput!) {",
        "  commentCreate(input: $input) {",
        "    success",
        "    comment { id }",
        "  }",
        "}",
      ].join("\n"),
      variables: {
        input: {
          id: value.comment_id,
          issueId: value.issue_id,
          body: boundedText(value.body, "comment body", 8_000),
        },
      },
      responseField: "commentCreate",
      entityField: "comment",
    };
  }
  throw new Error("Linear write command must be issue-create or evidence-comment");
}

async function performLinearWrite({
  command,
  input,
  apiKey,
  credentialSource,
  fetchImpl = fetch,
  signal = AbortSignal.timeout(15_000),
} = {}) {
  let request;
  try {
    request = operationRequest(command, input);
  } catch (error) {
    return {
      ok: false,
      provider: "linear",
      operation: command ?? "invalid",
      error: error.message,
    };
  }
  const resolvedApiKey =
    apiKey ??
    (credentialSource && typeof credentialSource === "object"
      ? credentialSource[request.credential]
      : undefined);
  if (
    typeof resolvedApiKey !== "string" ||
    resolvedApiKey.length < 20
  ) {
    return {
      ok: false,
      provider: "linear",
      operation: command,
      error: `${request.credential} is missing or invalid`,
    };
  }
  try {
    const response = await fetchImpl(LINEAR_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: resolvedApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: request.query,
        variables: request.variables,
      }),
      redirect: "error",
      signal,
    });
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength &&
      /^\d{1,16}$/.test(declaredLength) &&
      Number(declaredLength) > MAX_RESPONSE_BYTES
    ) {
      return {
        ok: false,
        provider: "linear",
        operation: command,
        error: "Linear write response exceeded the bounded capture limit",
      };
    }
    const capture = await readBoundedStream(response.body, MAX_RESPONSE_BYTES);
    if (!capture.ok) {
      return {
        ok: false,
        provider: "linear",
        operation: command,
        error: "Linear write response exceeded the bounded capture limit",
      };
    }
    let payload;
    try {
      payload = JSON.parse(capture.text);
    } catch {
      return {
        ok: false,
        provider: "linear",
        operation: command,
        error: "Linear returned invalid JSON",
      };
    }
    const operation = payload.data?.[request.responseField];
    if (
      !response.ok ||
      (Array.isArray(payload.errors) && payload.errors.length > 0) ||
      operation?.success !== true ||
      typeof operation?.[request.entityField]?.id !== "string" ||
      !UUID.test(operation[request.entityField].id)
    ) {
      return {
        ok: false,
        provider: "linear",
        operation: command,
        status: response.status,
        error: Array.isArray(payload.errors)
          ? "Linear GraphQL returned one or more errors"
          : "Linear write request failed",
      };
    }
    const entity = operation[request.entityField];
    return {
      ok: true,
      provider: "linear",
      operation: command,
      provider_id: entity.id,
      ...(command === "issue-create" &&
      typeof entity.identifier === "string" &&
      /^[A-Z][A-Z0-9]{0,9}-\d{1,10}$/.test(entity.identifier)
        ? { provider_identifier: entity.identifier }
        : {}),
    };
  } catch (error) {
    return {
      ok: false,
      provider: "linear",
      operation: command,
      error:
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "Linear write request timed out"
          : "Linear write request failed",
    };
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) {
    throw new Error("Linear write helper accepts exactly one operation");
  }
  const command = argv[0];
  const input = await readInput();
  return performLinearWrite({
    command,
    input,
    credentialSource: process.env,
  });
}

const isEntryPoint =
  process.argv[1] &&
  existsSync(resolve(process.argv[1])) &&
  realpathSync(resolve(process.argv[1])) ===
    realpathSync(fileURLToPath(import.meta.url));

if (isEntryPoint) {
  try {
    const result = await main();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: error.message })}\n`,
    );
    process.exitCode = 2;
  }
}

export {
  LINEAR_GRAPHQL_ENDPOINT,
  operationRequest,
  performLinearWrite,
  readInput,
};
