import assert from "node:assert/strict";
import test from "node:test";

import {
  LINEAR_GRAPHQL_ENDPOINT,
  linearHealth,
  uniqueTeamKeys,
} from "../scripts/linear-readonly.mjs";

const TEST_KEY = "lin_api_test_value_never_logged";

test("Linear health performs one bounded query without exposing mutation tools", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(
      JSON.stringify({
        data: {
          viewer: { id: "viewer-id" },
          teams: {
            nodes: [{ key: "ENG" }, { key: "OPS" }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-requests-remaining": "2499",
        },
      },
    );
  };

  const result = await linearHealth({
    apiKey: TEST_KEY,
    teamKeys: ["ENG"],
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.adapter_surface_read_only, true);
  assert.equal(result.credential_scope_verified, false);
  assert.deepEqual(result.visible_configured_team_keys, ["ENG"]);
  assert.equal(captured.url, LINEAR_GRAPHQL_ENDPOINT);
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.Authorization, TEST_KEY);
  assert.doesNotMatch(captured.options.body, /mutation/i);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TEST_KEY));
});

test("Linear health fails closed for hidden teams and GraphQL errors", async () => {
  const hiddenTeam = await linearHealth({
    apiKey: TEST_KEY,
    teamKeys: ["ENG", "OPS"],
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: {
            viewer: { id: "viewer-id" },
            teams: {
              nodes: [{ key: "ENG" }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
        { status: 200 },
      ),
  });
  assert.equal(hiddenTeam.ok, false);
  assert.deepEqual(hiddenTeam.missing_team_keys, ["OPS"]);

  const graphqlError = await linearHealth({
    apiKey: TEST_KEY,
    teamKeys: ["ENG"],
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          errors: [
            {
              message: `credential ${TEST_KEY} was rejected`,
            },
          ],
        }),
        { status: 200 },
      ),
  });
  assert.equal(graphqlError.ok, false);
  assert.equal(
    graphqlError.error,
    "Linear GraphQL returned one or more errors",
  );
  assert.doesNotMatch(JSON.stringify(graphqlError), new RegExp(TEST_KEY));
});

test("Linear health bounds response capture and validates team scope", async () => {
  const oversized = await linearHealth({
    apiKey: TEST_KEY,
    teamKeys: ["ENG"],
    fetchImpl: async () =>
      new Response(`"${"x".repeat(300_000)}"`, { status: 200 }),
  });
  assert.equal(oversized.ok, false);
  assert.match(oversized.error, /bounded capture limit/);

  assert.deepEqual(uniqueTeamKeys(["ENG", "ENG", "OPS"]), ["ENG", "OPS"]);
  assert.throws(() => uniqueTeamKeys([]), /1-20 uppercase/);
  assert.throws(() => uniqueTeamKeys(["../ENG"]), /1-20 uppercase/);
});

test("Linear health paginates within a hard bound", async () => {
  const requests = [];
  const result = await linearHealth({
    apiKey: TEST_KEY,
    teamKeys: ["OPS"],
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      return new Response(
        JSON.stringify({
          data: {
            viewer: { id: "viewer-id" },
            teams:
              request.variables.after === null
                ? {
                    nodes: [{ key: "ENG" }],
                    pageInfo: {
                      hasNextPage: true,
                      endCursor: "next-page",
                    },
                  }
                : {
                    nodes: [{ key: "OPS" }],
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null,
                    },
                  },
          },
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.pages_read, 2);
  assert.deepEqual(result.visible_configured_team_keys, ["OPS"]);
  assert.deepEqual(
    requests.map((request) => request.variables.after),
    [null, "next-page"],
  );
  assert.ok(requests.every((request) => !/mutation/i.test(request.query)));
});

test("Linear health rejects malformed or unbounded pagination", async () => {
  const malformed = await linearHealth({
    apiKey: TEST_KEY,
    teamKeys: ["ENG"],
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: {
            viewer: { id: "viewer-id" },
            teams: {
              nodes: [],
              pageInfo: { hasNextPage: true, endCursor: null },
            },
          },
        }),
        { status: 200 },
      ),
  });
  assert.equal(malformed.ok, false);
  assert.match(malformed.error, /invalid pagination cursor/);

  let page = 0;
  const unbounded = await linearHealth({
    apiKey: TEST_KEY,
    teamKeys: ["ENG"],
    fetchImpl: async () => {
      page += 1;
      return new Response(
        JSON.stringify({
          data: {
            viewer: { id: "viewer-id" },
            teams: {
              nodes: [],
              pageInfo: {
                hasNextPage: true,
                endCursor: `page-${page}`,
              },
            },
          },
        }),
        { status: 200 },
      );
    },
  });
  assert.equal(unbounded.ok, false);
  assert.equal(page, 10);
  assert.match(unbounded.error, /bounded pagination limit/);
});
