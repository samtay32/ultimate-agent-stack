import assert from "node:assert/strict";
import test from "node:test";

import {
  newRelicHealth,
  posthogHealth,
  sentryHealth,
} from "../scripts/telemetry-readonly.mjs";

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

test("PostHog health uses fixed read-only metadata and retains no insight payload", async () => {
  const calls = [];
  const result = await posthogHealth({
    token: "phx_test_personal_key",
    region: "us",
    projectId: "12345",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        count: 7,
        results: [
          {
            id: 1,
            name: "contains user@example.com",
            result: [{ person: { email: "user@example.com" } }],
          },
        ],
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved_insight_count, 7);
  assert.equal(result.raw_payload_retained, false);
  assert.doesNotMatch(JSON.stringify(result), /user@example\.com/);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://us.posthog.com/api/projects/12345/insights/?basic=true&limit=1",
  );
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
});

test("Sentry health verifies configured organization and project identity", async () => {
  const result = await sentryHealth({
    token: "sentry_test_auth_token",
    region: "de",
    organization: "acme",
    project: "web-app",
    fetchImpl: async (url, options) => {
      assert.equal(
        url,
        "https://de.sentry.io/api/0/projects/acme/web-app/",
      );
      assert.equal(options.method, "GET");
      return jsonResponse({
        slug: "web-app",
        organization: { slug: "acme", name: "Private organization name" },
        hasAccess: true,
        status: "active",
        options: { securityToken: "must-not-escape" },
      });
    },
  });

  assert.deepEqual(result, {
    ok: true,
    provider: "sentry",
    role: "errors",
    region: "de",
    access: "read_only",
    live_check: "project-identity",
    adapter_surface_read_only: true,
    credential_scope_verified: false,
    scope_verified: true,
    organization: "acme",
    project: "web-app",
    project_status: "active",
    raw_payload_retained: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /must-not-escape|Private/);
});

test("Sentry health fails closed on a project identity mismatch", async () => {
  const result = await sentryHealth({
    token: "sentry_test_auth_token",
    region: "global",
    organization: "acme",
    project: "web-app",
    fetchImpl: async () =>
      jsonResponse({
        slug: "another-project",
        organization: { slug: "acme" },
        hasAccess: true,
      }),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /identity or access/);
});

test("New Relic health sends one fixed account query and retains no account name", async () => {
  const result = await newRelicHealth({
    token: "new_relic_test_user_key",
    region: "eu",
    accountId: "98765",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.eu.newrelic.com/graphql");
      assert.equal(options.method, "POST");
      assert.equal(options.headers["API-Key"], "new_relic_test_user_key");
      const body = JSON.parse(options.body);
      assert.deepEqual(body.variables, { accountId: 98765 });
      assert.match(body.query, /query UltimateAgentStackTelemetryHealth/);
      assert.doesNotMatch(body.query, /\bmutation\b/i);
      return jsonResponse({
        data: { actor: { account: { name: "Confidential account" } } },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.account_id, "98765");
  assert.equal(result.raw_payload_retained, false);
  assert.doesNotMatch(JSON.stringify(result), /Confidential/);
});

test("telemetry health bounds responses and never echoes credentials", async () => {
  const token = "phx_super_secret_test_value";
  const oversized = await posthogHealth({
    token,
    region: "eu",
    projectId: "42",
    fetchImpl: async () =>
      new Response("x".repeat(129 * 1024), {
        headers: { "content-type": "application/json" },
      }),
  });
  const unauthorized = await newRelicHealth({
    token,
    region: "us",
    accountId: "42",
    fetchImpl: async () =>
      jsonResponse({ errors: [{ message: token }] }, { status: 401 }),
  });

  assert.equal(oversized.ok, false);
  assert.match(oversized.error, /bounded capture limit/);
  assert.equal(unauthorized.ok, false);
  assert.doesNotMatch(JSON.stringify([oversized, unauthorized]), /super_secret/);
});

test("telemetry health rejects custom endpoints and malformed scopes", async () => {
  await assert.rejects(
    () =>
      posthogHealth({
        token: "phx_test_personal_key",
        region: "http://localhost:3000",
        projectId: "1",
      }),
    /region is not approved/,
  );
  await assert.rejects(
    () =>
      sentryHealth({
        token: "sentry_test_auth_token",
        region: "us",
        organization: "../outside",
        project: "app",
      }),
    /organization slug is invalid/,
  );
  await assert.rejects(
    () =>
      newRelicHealth({
        token: "new_relic_test_user_key",
        region: "us",
        accountId: "1 OR 1=1",
      }),
    /positive numeric identifier/,
  );
});
