#!/usr/bin/env node

import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_TEAM_PAGES = 10;
const TEAM_KEY = /^[A-Z][A-Z0-9]{0,9}$/;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function uniqueTeamKeys(values) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.length > 20 ||
    !values.every((value) => TEAM_KEY.test(value))
  ) {
    throw new Error(
      "team keys must contain 1-20 uppercase Linear team identifiers",
    );
  }
  return [...new Set(values)];
}

function boundedRateLimit(headers) {
  const result = {};
  for (const [header, key] of [
    ["x-ratelimit-requests-limit", "limit"],
    ["x-ratelimit-requests-remaining", "remaining"],
    ["x-ratelimit-requests-reset", "reset"],
  ]) {
    const value = headers.get(header);
    if (value && /^\d{1,16}$/.test(value)) {
      result[key] = value;
    }
  }
  return result;
}

function linearEntityMissing(payload, field) {
  return (
    payload?.data?.[field] === null &&
    Array.isArray(payload.errors) &&
    payload.errors.length > 0 &&
    payload.errors.every(
      (error) =>
        (typeof error?.message === "string" &&
          /\b(?:entity )?not found\b|\bdoes not exist\b/i.test(
            error.message,
          )) ||
        (typeof error?.extensions?.code === "string" &&
          /^(?:ENTITY_)?NOT_FOUND$/i.test(error.extensions.code)),
    )
  );
}

async function readBoundedResponse(response, maximumBytes) {
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

async function linearHealth({
  apiKey,
  teamKeys,
  fetchImpl = fetch,
  signal = AbortSignal.timeout(15_000),
} = {}) {
  const configuredTeamKeys = uniqueTeamKeys(teamKeys);
  if (typeof apiKey !== "string" || apiKey.length < 20) {
    return {
      ok: false,
      provider: "linear",
      access: "read_only",
      error: "LINEAR_API_KEY is missing or invalid",
    };
  }
  try {
    const visibleTeamKeys = new Set();
    let after = null;
    let viewerAuthenticated = false;
    let rateLimit = {};
    let totalResponseBytes = 0;
    let pagesRead = 0;
    for (; pagesRead < MAX_TEAM_PAGES; pagesRead += 1) {
      const response = await fetchImpl(LINEAR_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: [
            "query UltimateAgentStackLinearHealth($after: String) {",
            "  viewer { id }",
            "  teams(first: 50, after: $after) {",
            "    nodes { key }",
            "    pageInfo { hasNextPage endCursor }",
            "  }",
            "}",
          ].join("\n"),
          variables: { after },
        }),
        redirect: "error",
        signal,
      });
      const capture = await readBoundedResponse(
        response,
        MAX_RESPONSE_BYTES - totalResponseBytes,
      );
      if (!capture.ok) {
        return {
          ok: false,
          provider: "linear",
          access: "read_only",
          status: response.status,
          error: "Linear health response exceeded the bounded capture limit",
        };
      }
      const text = capture.text;
      totalResponseBytes += capture.bytes;
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        return {
          ok: false,
          provider: "linear",
          access: "read_only",
          status: response.status,
          error: "Linear returned invalid JSON",
        };
      }
      if (
        !response.ok ||
        (Array.isArray(payload.errors) && payload.errors.length > 0)
      ) {
        return {
          ok: false,
          provider: "linear",
          access: "read_only",
          status: response.status,
          error: Array.isArray(payload.errors)
            ? "Linear GraphQL returned one or more errors"
            : "Linear health request failed",
          rate_limit: boundedRateLimit(response.headers),
        };
      }
      const teams = payload.data?.teams;
      if (
        !Array.isArray(teams?.nodes) ||
        typeof teams?.pageInfo?.hasNextPage !== "boolean"
      ) {
        return {
          ok: false,
          provider: "linear",
          access: "read_only",
          status: response.status,
          error: "Linear health response has an invalid team connection",
        };
      }
      for (const team of teams.nodes) {
        if (typeof team?.key === "string" && TEAM_KEY.test(team.key)) {
          visibleTeamKeys.add(team.key);
        }
      }
      viewerAuthenticated ||=
        typeof payload.data?.viewer?.id === "string" &&
        payload.data.viewer.id.length > 0;
      rateLimit = boundedRateLimit(response.headers);
      if (
        viewerAuthenticated &&
        configuredTeamKeys.every((key) => visibleTeamKeys.has(key))
      ) {
        after = null;
        break;
      }
      if (!teams.pageInfo.hasNextPage) {
        after = null;
        break;
      }
      if (
        typeof teams.pageInfo.endCursor !== "string" ||
        teams.pageInfo.endCursor.length === 0 ||
        teams.pageInfo.endCursor.length > 2_048
      ) {
        return {
          ok: false,
          provider: "linear",
          access: "read_only",
          status: response.status,
          error: "Linear health response has an invalid pagination cursor",
        };
      }
      after = teams.pageInfo.endCursor;
    }
    if (after !== null) {
      return {
        ok: false,
        provider: "linear",
        access: "read_only",
        error: "Linear team visibility exceeded the bounded pagination limit",
      };
    }
    const missingTeamKeys = configuredTeamKeys.filter(
      (key) => !visibleTeamKeys.has(key),
    );
    return {
      ok: viewerAuthenticated && missingTeamKeys.length === 0,
      provider: "linear",
      live_check: "graphql-query",
      access: "read_only",
      adapter_surface_read_only: true,
      credential_scope_verified: false,
      viewer_authenticated: viewerAuthenticated,
      configured_team_keys: configuredTeamKeys,
      visible_configured_team_keys: configuredTeamKeys.filter((key) =>
        visibleTeamKeys.has(key),
      ),
      missing_team_keys: missingTeamKeys,
      visible_team_count: visibleTeamKeys.size,
      pages_read: pagesRead + 1,
      rate_limit: rateLimit,
      ...(viewerAuthenticated && missingTeamKeys.length === 0
        ? {}
        : {
            error: viewerAuthenticated
              ? "one or more configured Linear teams are not visible"
              : "Linear viewer identity is missing",
          }),
    };
  } catch (error) {
    return {
      ok: false,
      provider: "linear",
      access: "read_only",
      error:
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "Linear health request timed out"
          : "Linear health request failed",
    };
  }
}

async function linearResolveTeam({
  apiKey,
  teamKey,
  fetchImpl = fetch,
  signal = AbortSignal.timeout(15_000),
} = {}) {
  const configuredTeamKey = uniqueTeamKeys([teamKey])[0];
  if (typeof apiKey !== "string" || apiKey.length < 20) {
    return {
      ok: false,
      provider: "linear",
      operation: "resolve-team",
      error: "LINEAR_API_KEY is missing or invalid",
    };
  }
  let after = null;
  let totalResponseBytes = 0;
  try {
    for (let page = 0; page < MAX_TEAM_PAGES; page += 1) {
      const response = await fetchImpl(LINEAR_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: [
            "query UltimateAgentStackLinearTeam($after: String) {",
            "  teams(first: 50, after: $after) {",
            "    nodes { id key }",
            "    pageInfo { hasNextPage endCursor }",
            "  }",
            "}",
          ].join("\n"),
          variables: { after },
        }),
        redirect: "error",
        signal,
      });
      const capture = await readBoundedResponse(
        response,
        MAX_RESPONSE_BYTES - totalResponseBytes,
      );
      if (!capture.ok) {
        return {
          ok: false,
          provider: "linear",
          operation: "resolve-team",
          error: "Linear team lookup exceeded the bounded capture limit",
        };
      }
      totalResponseBytes += capture.bytes;
      let payload;
      try {
        payload = JSON.parse(capture.text);
      } catch {
        return {
          ok: false,
          provider: "linear",
          operation: "resolve-team",
          error: "Linear returned invalid JSON",
        };
      }
      const teams = payload.data?.teams;
      if (
        !response.ok ||
        (Array.isArray(payload.errors) && payload.errors.length > 0) ||
        !Array.isArray(teams?.nodes) ||
        typeof teams?.pageInfo?.hasNextPage !== "boolean"
      ) {
        return {
          ok: false,
          provider: "linear",
          operation: "resolve-team",
          error: Array.isArray(payload.errors)
            ? "Linear GraphQL returned one or more errors"
            : "Linear team lookup failed",
        };
      }
      const match = teams.nodes.find(
        (team) => team?.key === configuredTeamKey && UUID.test(team?.id),
      );
      if (match) {
        return {
          ok: true,
          provider: "linear",
          operation: "resolve-team",
          team_key: configuredTeamKey,
          provider_id: match.id,
        };
      }
      if (!teams.pageInfo.hasNextPage) {
        return {
          ok: false,
          provider: "linear",
          operation: "resolve-team",
          team_key: configuredTeamKey,
          error: "Configured Linear team is not visible",
        };
      }
      if (
        typeof teams.pageInfo.endCursor !== "string" ||
        teams.pageInfo.endCursor.length === 0 ||
        teams.pageInfo.endCursor.length > 2_048
      ) {
        return {
          ok: false,
          provider: "linear",
          operation: "resolve-team",
          error: "Linear team lookup returned an invalid pagination cursor",
        };
      }
      after = teams.pageInfo.endCursor;
    }
    return {
      ok: false,
      provider: "linear",
      operation: "resolve-team",
      error: "Linear team lookup exceeded the bounded pagination limit",
    };
  } catch (error) {
    return {
      ok: false,
      provider: "linear",
      operation: "resolve-team",
      error:
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "Linear team lookup timed out"
          : "Linear team lookup failed",
    };
  }
}

async function linearResolveIssue({
  apiKey,
  issueId,
  fetchImpl = fetch,
  signal = AbortSignal.timeout(15_000),
} = {}) {
  if (!UUID.test(issueId)) {
    throw new Error("issue id must be a UUID");
  }
  if (typeof apiKey !== "string" || apiKey.length < 20) {
    return {
      ok: false,
      provider: "linear",
      operation: "resolve-issue",
      error: "LINEAR_API_KEY is missing or invalid",
    };
  }
  try {
    const response = await fetchImpl(LINEAR_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: [
          "query UltimateAgentStackLinearIssue($id: String!) {",
          "  issue(id: $id) { id identifier team { key } }",
          "}",
        ].join("\n"),
        variables: { id: issueId },
      }),
      redirect: "error",
      signal,
    });
    const capture = await readBoundedResponse(response, MAX_RESPONSE_BYTES);
    if (!capture.ok) {
      return {
        ok: false,
        provider: "linear",
        operation: "resolve-issue",
        error: "Linear issue lookup exceeded the bounded capture limit",
      };
    }
    let payload;
    try {
      payload = JSON.parse(capture.text);
    } catch {
      return {
        ok: false,
        provider: "linear",
        operation: "resolve-issue",
        error: "Linear returned invalid JSON",
      };
    }
    if (response.ok && linearEntityMissing(payload, "issue")) {
      return {
        ok: true,
        provider: "linear",
        operation: "resolve-issue",
        found: false,
        provider_id: issueId,
      };
    }
    if (
      !response.ok ||
      (Array.isArray(payload.errors) && payload.errors.length > 0)
    ) {
      return {
        ok: false,
        provider: "linear",
        operation: "resolve-issue",
        error: Array.isArray(payload.errors)
          ? "Linear GraphQL returned one or more errors"
          : "Linear issue lookup failed",
      };
    }
    const issue = payload.data?.issue;
    if (issue === null) {
      return {
        ok: true,
        provider: "linear",
        operation: "resolve-issue",
        found: false,
        provider_id: issueId,
      };
    }
    if (
      !UUID.test(issue?.id) ||
      typeof issue?.identifier !== "string" ||
      !/^[A-Z][A-Z0-9]{0,9}-\d{1,10}$/.test(issue.identifier) ||
      typeof issue?.team?.key !== "string" ||
      !TEAM_KEY.test(issue.team.key)
    ) {
      return {
        ok: false,
        provider: "linear",
        operation: "resolve-issue",
        error: "Linear issue lookup returned an invalid result",
      };
    }
    return {
      ok: true,
      provider: "linear",
      operation: "resolve-issue",
      found: true,
      provider_id: issue.id,
      provider_identifier: issue.identifier,
      team_key: issue.team.key,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "linear",
      operation: "resolve-issue",
      error:
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "Linear issue lookup timed out"
          : "Linear issue lookup failed",
    };
  }
}

async function linearResolveComment({
  apiKey,
  commentId,
  fetchImpl = fetch,
  signal = AbortSignal.timeout(15_000),
} = {}) {
  if (!UUID.test(commentId)) {
    throw new Error("comment id must be a UUID");
  }
  if (typeof apiKey !== "string" || apiKey.length < 20) {
    return {
      ok: false,
      provider: "linear",
      operation: "resolve-comment",
      error: "LINEAR_API_KEY is missing or invalid",
    };
  }
  try {
    const response = await fetchImpl(LINEAR_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: [
          "query UltimateAgentStackLinearComment($id: String!) {",
          "  comment(id: $id) { id issue { id } }",
          "}",
        ].join("\n"),
        variables: { id: commentId },
      }),
      redirect: "error",
      signal,
    });
    const capture = await readBoundedResponse(response, MAX_RESPONSE_BYTES);
    if (!capture.ok) {
      return {
        ok: false,
        provider: "linear",
        operation: "resolve-comment",
        error: "Linear comment lookup exceeded the bounded capture limit",
      };
    }
    let payload;
    try {
      payload = JSON.parse(capture.text);
    } catch {
      return {
        ok: false,
        provider: "linear",
        operation: "resolve-comment",
        error: "Linear returned invalid JSON",
      };
    }
    if (response.ok && linearEntityMissing(payload, "comment")) {
      return {
        ok: true,
        provider: "linear",
        operation: "resolve-comment",
        found: false,
        provider_id: commentId,
      };
    }
    if (
      !response.ok ||
      (Array.isArray(payload.errors) && payload.errors.length > 0)
    ) {
      return {
        ok: false,
        provider: "linear",
        operation: "resolve-comment",
        error: Array.isArray(payload.errors)
          ? "Linear GraphQL returned one or more errors"
          : "Linear comment lookup failed",
      };
    }
    const comment = payload.data?.comment;
    if (comment === null) {
      return {
        ok: true,
        provider: "linear",
        operation: "resolve-comment",
        found: false,
        provider_id: commentId,
      };
    }
    if (!UUID.test(comment?.id) || !UUID.test(comment?.issue?.id)) {
      return {
        ok: false,
        provider: "linear",
        operation: "resolve-comment",
        error: "Linear comment lookup returned an invalid result",
      };
    }
    return {
      ok: true,
      provider: "linear",
      operation: "resolve-comment",
      found: true,
      provider_id: comment.id,
      issue_id: comment.issue.id,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "linear",
      operation: "resolve-comment",
      error:
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "Linear comment lookup timed out"
          : "Linear comment lookup failed",
    };
  }
}

function parseArgs(argv) {
  const teamKeys = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--team" || index + 1 >= argv.length) {
      throw new Error("only repeated --team KEY arguments are supported");
    }
    teamKeys.push(argv[index + 1]);
    index += 1;
  }
  return uniqueTeamKeys(teamKeys);
}

function singleOption(argv, option) {
  if (argv.length !== 2 || argv[0] !== option) {
    throw new Error(`only ${option} VALUE is supported`);
  }
  return argv[1];
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command === "health") {
    return linearHealth({
      apiKey: process.env.LINEAR_API_KEY,
      teamKeys: parseArgs(args),
    });
  }
  if (command === "resolve-team") {
    return linearResolveTeam({
      apiKey: process.env.LINEAR_API_KEY,
      teamKey: singleOption(args, "--team"),
    });
  }
  if (command === "resolve-issue") {
    return linearResolveIssue({
      apiKey: process.env.LINEAR_API_KEY,
      issueId: singleOption(args, "--id"),
    });
  }
  if (command === "resolve-comment") {
    return linearResolveComment({
      apiKey: process.env.LINEAR_API_KEY,
      commentId: singleOption(args, "--id"),
    });
  }
  throw new Error(
    "linear-readonly command must be health, resolve-team, resolve-issue, or resolve-comment",
  );
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
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: error.message })}\n`,
    );
    process.exitCode = 2;
  }
}

export {
  LINEAR_GRAPHQL_ENDPOINT,
  linearHealth,
  linearResolveComment,
  linearResolveIssue,
  linearResolveTeam,
  main,
  uniqueTeamKeys,
};
