import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LINEAR_GRAPHQL_ENDPOINT,
  operationRequest,
  performLinearWrite,
} from "../scripts/linear-write.mjs";

const TEST_KEY = "lin_api_test_value_never_logged";
const ISSUE_ID = "123e4567-e89b-52d3-a456-426614174000";
const TEAM_ID = "123e4567-e89b-52d3-a456-426614174001";
const COMMENT_ID = "123e4567-e89b-52d3-a456-426614174002";
const LINEAR_WRITE_HELPER = fileURLToPath(
  new URL("../scripts/linear-write.mjs", import.meta.url),
);

test("Linear issue creation exposes only the fixed mutation shape", async () => {
  let captured;
  const result = await performLinearWrite({
    command: "issue-create",
    input: {
      issue_id: ISSUE_ID,
      team_id: TEAM_ID,
      title: "Bounded project work",
      description: "Acceptance criteria are recorded in the repository.",
    },
    apiKey: TEST_KEY,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(
        JSON.stringify({
          data: {
            issueCreate: {
              success: true,
              issue: { id: ISSUE_ID, identifier: "ENG-42" },
            },
          },
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider_id, ISSUE_ID);
  assert.equal(result.provider_identifier, "ENG-42");
  assert.equal(captured.url, LINEAR_GRAPHQL_ENDPOINT);
  assert.equal(captured.options.headers.Authorization, TEST_KEY);
  const request = JSON.parse(captured.options.body);
  assert.match(request.query, /issueCreate/);
  assert.doesNotMatch(request.query, /issueUpdate|issueDelete|archive/i);
  assert.deepEqual(Object.keys(request.variables.input).sort(), [
    "description",
    "id",
    "teamId",
    "title",
  ]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TEST_KEY));
});

test("Linear evidence comments expose only comment creation", async () => {
  let request;
  const result = await performLinearWrite({
    command: "evidence-comment",
    input: {
      comment_id: COMMENT_ID,
      issue_id: ISSUE_ID,
      body: "Verified evidence: test/feature.test.mjs",
    },
    apiKey: TEST_KEY,
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          data: {
            commentCreate: {
              success: true,
              comment: { id: COMMENT_ID },
            },
          },
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider_id, COMMENT_ID);
  assert.match(request.query, /commentCreate/);
  assert.doesNotMatch(request.query, /commentUpdate|commentDelete/i);
  assert.deepEqual(Object.keys(request.variables.input).sort(), [
    "body",
    "id",
    "issueId",
  ]);
});

test("Linear writes reject unsupported fields, credentials, and operations", () => {
  assert.throws(
    () =>
      operationRequest("issue-create", {
        issue_id: ISSUE_ID,
        team_id: TEAM_ID,
        title: "Task",
        description: "Safe",
        stateId: "forbidden",
      }),
    /unsupported fields/,
  );
  assert.throws(
    () =>
      operationRequest("evidence-comment", {
        comment_id: COMMENT_ID,
        issue_id: ISSUE_ID,
        body: "api_key=supersecretvalue",
      }),
    /credential-like/,
  );
  assert.throws(
    () => operationRequest("issue-update", {}),
    /must be issue-create or evidence-comment/,
  );
});

test("Linear writes fail closed without surfacing provider errors", async () => {
  const graphqlError = await performLinearWrite({
    command: "issue-create",
    input: {
      issue_id: ISSUE_ID,
      team_id: TEAM_ID,
      title: "Bounded project work",
      description: "Safe description",
    },
    apiKey: TEST_KEY,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          errors: [{ message: `credential ${TEST_KEY} was rejected` }],
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

  const oversized = await performLinearWrite({
    command: "evidence-comment",
    input: {
      comment_id: COMMENT_ID,
      issue_id: ISSUE_ID,
      body: "Safe evidence",
    },
    apiKey: TEST_KEY,
    fetchImpl: async () =>
      new Response(`"${"x".repeat(70_000)}"`, { status: 200 }),
  });
  assert.equal(oversized.ok, false);
  assert.match(oversized.error, /bounded capture limit/);
});

test("Linear write entrypoint preserves structured failures and exits nonzero", () => {
  const invalid = spawnSync(
    process.execPath,
    [LINEAR_WRITE_HELPER, "issue-create"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        LINEAR_CREATE_API_KEY: TEST_KEY,
      },
      input: JSON.stringify({
        issue_id: ISSUE_ID,
        team_id: TEAM_ID,
        title: "Bounded project work",
        description: "Safe description",
        unsupported: true,
      }),
      shell: false,
    },
  );
  assert.equal(invalid.status, 1, invalid.stderr);
  assert.equal(invalid.stderr, "");
  assert.deepEqual(JSON.parse(invalid.stdout), {
    ok: false,
    provider: "linear",
    operation: "issue-create",
    error: "issue-create input contains unsupported fields",
  });

  const missingCredential = spawnSync(
    process.execPath,
    [LINEAR_WRITE_HELPER, "evidence-comment"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        LINEAR_COMMENT_API_KEY: "",
      },
      input: JSON.stringify({
        comment_id: COMMENT_ID,
        issue_id: ISSUE_ID,
        body: "Verified evidence",
      }),
      shell: false,
    },
  );
  assert.equal(missingCredential.status, 1, missingCredential.stderr);
  assert.equal(missingCredential.stderr, "");
  assert.deepEqual(JSON.parse(missingCredential.stdout), {
    ok: false,
    provider: "linear",
    operation: "evidence-comment",
    error: "LINEAR_COMMENT_API_KEY is missing or invalid",
  });
});
