#!/usr/bin/env node

import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_RESPONSE_BYTES = 128 * 1024;
const IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,99}$/i;
const NUMERIC_ID = /^[1-9]\d{0,18}$/;
const PROVIDER_ENDPOINTS = Object.freeze({
  posthog: Object.freeze({
    us: "https://us.posthog.com",
    eu: "https://eu.posthog.com",
  }),
  sentry: Object.freeze({
    global: "https://sentry.io",
    us: "https://us.sentry.io",
    de: "https://de.sentry.io",
  }),
  "new-relic": Object.freeze({
    us: "https://api.newrelic.com/graphql",
    eu: "https://api.eu.newrelic.com/graphql",
  }),
});
const CREDENTIAL_ENVIRONMENTS = Object.freeze({
  posthog: "POSTHOG_PERSONAL_API_KEY",
  sentry: "SENTRY_AUTH_TOKEN",
  "new-relic": "NEW_RELIC_USER_KEY",
});

async function readBoundedResponse(response, maximumBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength &&
    /^\d{1,16}$/.test(declaredLength) &&
    Number(declaredLength) > maximumBytes
  ) {
    return { ok: false, text: "", bytes: 0 };
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    return { ok: true, text: "", bytes: 0 };
  }
  const reader = response.body.getReader();
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
        await reader.cancel();
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

function boundedProviderFailure(provider, error, status = undefined) {
  return {
    ok: false,
    provider,
    access: "read_only",
    adapter_surface_read_only: true,
    credential_scope_verified: false,
    ...(Number.isInteger(status) && status >= 100 && status <= 599
      ? { status }
      : {}),
    error,
  };
}

function providerEndpoint(provider, region) {
  const endpoint = PROVIDER_ENDPOINTS[provider]?.[region];
  if (!endpoint) {
    throw new Error("provider region is not approved");
  }
  return endpoint;
}

function validCredential(value) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 8_192 &&
    !/[\r\n\0]/.test(value)
  );
}

async function boundedJsonRequest({
  provider,
  url,
  token,
  headers = {},
  method = "GET",
  body,
  fetchImpl,
  signal,
}) {
  if (!validCredential(token)) {
    return {
      ok: false,
      failure: boundedProviderFailure(
        provider,
        `${CREDENTIAL_ENVIRONMENTS[provider]} is missing or invalid`,
      ),
    };
  }
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: "error",
      signal,
    });
    const capture = await readBoundedResponse(response);
    if (!capture.ok) {
      return {
        ok: false,
        failure: boundedProviderFailure(
          provider,
          `${provider} health response exceeded the bounded capture limit`,
          response.status,
        ),
      };
    }
    let payload;
    try {
      payload = JSON.parse(capture.text);
    } catch {
      return {
        ok: false,
        failure: boundedProviderFailure(
          provider,
          `${provider} returned invalid JSON`,
          response.status,
        ),
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        failure: boundedProviderFailure(
          provider,
          `${provider} health request failed`,
          response.status,
        ),
      };
    }
    return { ok: true, payload };
  } catch (error) {
    return {
      ok: false,
      failure: boundedProviderFailure(
        provider,
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? `${provider} health request timed out`
          : `${provider} health request failed`,
      ),
    };
  }
}

async function posthogHealth({
  token,
  region,
  projectId,
  fetchImpl = fetch,
  signal = AbortSignal.timeout(15_000),
} = {}) {
  if (
    !NUMERIC_ID.test(String(projectId ?? "")) ||
    !Number.isSafeInteger(Number(projectId))
  ) {
    throw new Error("PostHog project ID must be a positive numeric identifier");
  }
  const endpoint = providerEndpoint("posthog", region);
  const request = await boundedJsonRequest({
    provider: "posthog",
    url: `${endpoint}/api/projects/${encodeURIComponent(projectId)}/insights/?basic=true&limit=1`,
    token,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    fetchImpl,
    signal,
  });
  if (!request.ok) {
    return request.failure;
  }
  const { payload } = request;
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !Number.isInteger(payload.count) ||
    payload.count < 0 ||
    !Array.isArray(payload.results) ||
    payload.results.length > 1
  ) {
    return boundedProviderFailure(
      "posthog",
      "posthog health response was malformed",
    );
  }
  return {
    ok: true,
    provider: "posthog",
    role: "product",
    region,
    access: "read_only",
    live_check: "project-insight-metadata",
    adapter_surface_read_only: true,
    credential_scope_verified: false,
    scope_verified: true,
    project_id: String(projectId),
    saved_insight_count: payload.count,
    raw_payload_retained: false,
  };
}

async function sentryHealth({
  token,
  region,
  organization,
  project,
  fetchImpl = fetch,
  signal = AbortSignal.timeout(15_000),
} = {}) {
  if (!IDENTIFIER.test(String(organization ?? ""))) {
    throw new Error("Sentry organization slug is invalid");
  }
  if (!IDENTIFIER.test(String(project ?? ""))) {
    throw new Error("Sentry project slug is invalid");
  }
  const endpoint = providerEndpoint("sentry", region);
  const request = await boundedJsonRequest({
    provider: "sentry",
    url: `${endpoint}/api/0/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/`,
    token,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    fetchImpl,
    signal,
  });
  if (!request.ok) {
    return request.failure;
  }
  const { payload } = request;
  const responseOrganization = payload?.organization?.slug;
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.slug !== project ||
    responseOrganization !== organization ||
    typeof payload.hasAccess !== "boolean" ||
    !payload.hasAccess
  ) {
    return boundedProviderFailure(
      "sentry",
      "sentry project identity or access did not match configuration",
    );
  }
  return {
    ok: true,
    provider: "sentry",
    role: "errors",
    region,
    access: "read_only",
    live_check: "project-identity",
    adapter_surface_read_only: true,
    credential_scope_verified: false,
    scope_verified: true,
    organization,
    project,
    project_status:
      typeof payload.status === "string" && IDENTIFIER.test(payload.status)
        ? payload.status
        : "unknown",
    raw_payload_retained: false,
  };
}

async function newRelicHealth({
  token,
  region,
  accountId,
  fetchImpl = fetch,
  signal = AbortSignal.timeout(15_000),
} = {}) {
  const numericAccountId = Number(accountId);
  if (
    !NUMERIC_ID.test(String(accountId ?? "")) ||
    !Number.isSafeInteger(numericAccountId) ||
    numericAccountId <= 0
  ) {
    throw new Error("New Relic account ID must be a positive numeric identifier");
  }
  const endpoint = providerEndpoint("new-relic", region);
  const request = await boundedJsonRequest({
    provider: "new-relic",
    url: endpoint,
    token,
    method: "POST",
    headers: {
      Accept: "application/json",
      "API-Key": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: [
        "query UltimateAgentStackTelemetryHealth($accountId: Int!) {",
        "  actor {",
        "    account(id: $accountId) { name }",
        "  }",
        "}",
      ].join("\n"),
      variables: { accountId: numericAccountId },
    }),
    fetchImpl,
    signal,
  });
  if (!request.ok) {
    return request.failure;
  }
  const { payload } = request;
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    return boundedProviderFailure(
      "new-relic",
      "new-relic GraphQL returned one or more errors",
    );
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof payload.data?.actor?.account?.name !== "string" ||
    payload.data.actor.account.name.length === 0
  ) {
    return boundedProviderFailure(
      "new-relic",
      "new-relic account identity was not accessible",
    );
  }
  return {
    ok: true,
    provider: "new-relic",
    role: "service",
    region,
    access: "read_only",
    live_check: "account-identity",
    adapter_surface_read_only: true,
    credential_scope_verified: false,
    scope_verified: true,
    account_id: String(accountId),
    raw_payload_retained: false,
  };
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (
      ![
        "--provider",
        "--region",
        "--project",
        "--organization",
        "--account",
      ].includes(name)
    ) {
      throw new Error(`unknown option: ${name}`);
    }
    const value = args[index + 1];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${name} requires a value`);
    }
    if (Object.hasOwn(options, name)) {
      throw new Error(`${name} may be provided only once`);
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

async function execute(command, args, environment = process.env) {
  if (command !== "health") {
    throw new Error("telemetry-readonly command must be health");
  }
  const options = parseOptions(args);
  const provider = options["--provider"];
  const region = options["--region"];
  if (!Object.hasOwn(PROVIDER_ENDPOINTS, provider)) {
    throw new Error("provider must be posthog, sentry, or new-relic");
  }
  const token = environment[CREDENTIAL_ENVIRONMENTS[provider]];
  if (provider === "posthog") {
    return posthogHealth({
      token,
      region,
      projectId: options["--project"],
    });
  }
  if (provider === "sentry") {
    return sentryHealth({
      token,
      region,
      organization: options["--organization"],
      project: options["--project"],
    });
  }
  return newRelicHealth({
    token,
    region,
    accountId: options["--account"],
  });
}

async function main(args = process.argv.slice(2)) {
  try {
    const [command, ...options] = args;
    const result = await execute(command, options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "telemetry helper failed",
      })}\n`,
    );
    return 2;
  }
}

const scriptPath = fileURLToPath(import.meta.url);
const isEntryPoint =
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(resolve(process.argv[1])) === realpathSync(scriptPath);
if (isEntryPoint) {
  process.exitCode = await main();
}

export {
  CREDENTIAL_ENVIRONMENTS,
  MAX_RESPONSE_BYTES,
  PROVIDER_ENDPOINTS,
  execute,
  newRelicHealth,
  posthogHealth,
  readBoundedResponse,
  sentryHealth,
};
