import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateReviewReceipt,
  resolveContext,
} from "../scripts/review-receipt.mjs";

const HEAD = "a".repeat(40);
const OLD_HEAD = "b".repeat(40);

function review({
  commit = HEAD,
  state = "COMMENTED",
  login = "coderabbitai[bot]",
} = {}) {
  return {
    author: { login },
    commit: { oid: commit },
    state,
  };
}

function thread({
  login = "coderabbitai",
  resolved = false,
  outdated = false,
} = {}) {
  return {
    isResolved: resolved,
    isOutdated: outdated,
    comments: { nodes: [{ author: { login } }] },
  };
}

test("accepts a current CodeRabbit review with no unresolved threads", () => {
  const result = evaluateReviewReceipt({
    headOid: HEAD,
    reviews: [review()],
  });

  assert.equal(result.ok, true);
  assert.equal(result.detail.reviewed_commit, HEAD);
});

test("rejects a missing review", () => {
  const result = evaluateReviewReceipt({ headOid: HEAD });

  assert.equal(result.ok, false);
  assert.match(result.message, /No actual CodeRabbit review/);
});

test("rejects a stale review after a new push", () => {
  const result = evaluateReviewReceipt({
    headOid: HEAD,
    reviews: [review({ commit: OLD_HEAD })],
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /stale/);
});

test("a rate-limit comment never counts as a review", () => {
  const result = evaluateReviewReceipt({
    headOid: HEAD,
    comments: [
      {
        author: { login: "coderabbitai[bot]" },
        body: "Review limit reached. Refill in 30 minutes.",
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /review limit/);
});

test("rejects requested changes and unresolved current threads", () => {
  const requestedChanges = evaluateReviewReceipt({
    headOid: HEAD,
    reviews: [review({ state: "CHANGES_REQUESTED" })],
  });
  const unresolved = evaluateReviewReceipt({
    headOid: HEAD,
    reviews: [review()],
    threads: [thread()],
  });

  assert.equal(requestedChanges.ok, false);
  assert.match(requestedChanges.message, /requested changes/);
  assert.equal(unresolved.ok, false);
  assert.match(unresolved.message, /1 unresolved/);
});

test("ignores resolved, outdated, and non-CodeRabbit threads", () => {
  const result = evaluateReviewReceipt({
    headOid: HEAD,
    reviews: [review()],
    threads: [
      thread({ resolved: true }),
      thread({ outdated: true }),
      thread({ login: "human-reviewer" }),
    ],
  });

  assert.equal(result.ok, true);
});

test("fails closed when any evidence connection is truncated", () => {
  const result = evaluateReviewReceipt({
    headOid: HEAD,
    reviews: [review()],
    truncated: ["reviewThreads"],
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /safety limit/);
});

test("resolves workflow and explicit CLI context without exposing token", () => {
  const explicit = resolveContext(
    ["--repo", "owner/repository", "--pr", "12"],
    { GITHUB_TOKEN: "secret-token" },
  );

  assert.deepEqual(explicit, {
    owner: "owner",
    name: "repository",
    pullRequest: 12,
    token: "secret-token",
  });
  assert.throws(
    () => resolveContext([], { GITHUB_TOKEN: "secret-token" }),
    /owner\/repository/,
  );
});
