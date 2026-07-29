import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateReviewReceipt,
  resolveReviewSelection,
  resolveContext,
} from "../scripts/review-receipt.mjs";

const HEAD = "a".repeat(40);
const OLD_HEAD = "b".repeat(40);
const PR_AUTHOR = { login: "pull-request-author", __typename: "User" };

function review({
  commit = HEAD,
  state = "COMMENTED",
  login = "coderabbitai[bot]",
  type =
    login.toLowerCase().includes("coderabbit") ||
    login.toLowerCase().includes("qodo")
      ? "Bot"
      : "User",
} = {}) {
  return {
    author: { login, __typename: type },
    commit: { oid: commit },
    state,
  };
}

const QODO_REVIEW_URL =
  "https://github.com/owner/repository/pull/12#issuecomment-1";

function qodoCompletion(commit = HEAD, reviewUrl = QODO_REVIEW_URL) {
  return {
    author: { login: "qodo-code-review[bot]", __typename: "Bot" },
    body:
      `[Code review](${reviewUrl}) ` +
      `by qodo was updated up to the latest commit https://github.com/owner/repository/commit/${commit}`,
  };
}

function qodoUnifiedReview(commit = HEAD) {
  return {
    author: { login: "qodo-code-review[bot]", __typename: "Bot" },
    url: QODO_REVIEW_URL,
    body:
      "<h3>Code Review by Qodo</h3>\n" +
      `<details><summary>Results up to commit ${commit.slice(0, 7)}</summary>`,
  };
}

function thread({
  login = "coderabbitai",
  resolved = false,
  outdated = false,
  type =
    login.toLowerCase().includes("coderabbit") ||
    login.toLowerCase().includes("qodo")
      ? "Bot"
      : "User",
} = {}) {
  return {
    isResolved: resolved,
    isOutdated: outdated,
    comments: { nodes: [{ author: { login, __typename: type } }] },
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

test("accepts completed exact-head Qodo unified review evidence", () => {
  const result = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "qodo",
    reviews: [
      review({
        commit: OLD_HEAD,
        login: "qodo-code-review[bot]",
      }),
    ],
    comments: [qodoUnifiedReview(), qodoCompletion()],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.detail.review_states, ["UNIFIED_COMMENT"]);
});

test("accepts Qodo exact-head review plus completed unified evidence", () => {
  const result = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "qodo",
    reviews: [review({ login: "qodo-code-review[bot]" })],
    comments: [qodoUnifiedReview(), qodoCompletion()],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.detail.review_states, ["COMMENTED"]);
});

test("Qodo processing, summaries, and partial evidence never count", () => {
  const processing = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "qodo",
    comments: [
      {
        author: { login: "qodo-code-review[bot]", __typename: "Bot" },
        body: "Qodo agents are working on the review.",
      },
      {
        author: { login: "qodo-code-review[bot]", __typename: "Bot" },
        body: "<h3>PR Summary by Qodo</h3>",
      },
    ],
  });
  const completionOnly = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "qodo",
    comments: [qodoCompletion()],
  });
  const unifiedOnly = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "qodo",
    comments: [qodoUnifiedReview()],
  });
  const mismatchedReviewLink = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "qodo",
    comments: [
      qodoUnifiedReview(),
      qodoCompletion(
        HEAD,
        "https://github.com/owner/repository/pull/12#issuecomment-2",
      ),
    ],
  });

  assert.equal(processing.ok, false);
  assert.equal(completionOnly.ok, false);
  assert.equal(unifiedOnly.ok, false);
  assert.equal(mismatchedReviewLink.ok, false);
});

test("rejects stale, impersonated, unresolved, and truncated Qodo evidence", () => {
  const stale = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "qodo",
    reviews: [
      review({
        commit: OLD_HEAD,
        login: "qodo-code-review[bot]",
      }),
    ],
    comments: [qodoUnifiedReview(OLD_HEAD), qodoCompletion(OLD_HEAD)],
  });
  const impersonated = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "qodo",
    comments: [
      {
        ...qodoUnifiedReview(),
        author: { login: "qodo-code-review", __typename: "User" },
      },
      {
        ...qodoCompletion(),
        author: { login: "qodo-code-review", __typename: "User" },
      },
    ],
  });
  const unresolved = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "qodo",
    comments: [qodoUnifiedReview(), qodoCompletion()],
    threads: [thread({ login: "qodo-code-review[bot]" })],
  });
  const truncated = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "qodo",
    comments: [qodoUnifiedReview(), qodoCompletion()],
    truncated: ["comments"],
  });

  assert.equal(stale.ok, false);
  assert.match(stale.message, /stale or incomplete/);
  assert.equal(impersonated.ok, false);
  assert.equal(unresolved.ok, false);
  assert.match(unresolved.message, /1 unresolved/);
  assert.equal(truncated.ok, false);
  assert.match(truncated.message, /safety limit/);
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

test("GitHub human review ignores unrelated top-level comment pagination", () => {
  const result = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "github-human",
    allowedLogins: ["trusted-owner"],
    pullRequestAuthor: PR_AUTHOR,
    reviews: [
      review({
        state: "APPROVED",
        login: "trusted-owner",
      }),
    ],
    truncated: ["comments"],
  });

  assert.equal(result.ok, true);
});

test("GitHub human review requires a current approval from an allowed login", () => {
  const approved = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "github-human",
    allowedLogins: ["trusted-owner"],
    pullRequestAuthor: PR_AUTHOR,
    reviews: [review({ state: "APPROVED", login: "Trusted-Owner" })],
  });
  const commentOnly = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "github-human",
    allowedLogins: ["trusted-owner"],
    pullRequestAuthor: PR_AUTHOR,
    reviews: [review({ state: "COMMENTED", login: "trusted-owner" })],
  });
  const unlisted = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "github-human",
    allowedLogins: ["trusted-owner"],
    pullRequestAuthor: PR_AUTHOR,
    reviews: [review({ state: "APPROVED", login: "other-reviewer" })],
  });
  const listedBot = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "github-human",
    allowedLogins: ["trusted-owner"],
    pullRequestAuthor: PR_AUTHOR,
    reviews: [
      review({
        state: "APPROVED",
        login: "trusted-owner",
        type: "Bot",
      }),
    ],
  });

  assert.equal(approved.ok, true);
  assert.equal(commentOnly.ok, false);
  assert.equal(unlisted.ok, false);
  assert.equal(listedBot.ok, false);
});

test("GitHub human review rejects the pull request author's approval", () => {
  const selfApproval = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "github-human",
    allowedLogins: ["pull-request-author", "trusted-owner"],
    pullRequestAuthor: PR_AUTHOR,
    reviews: [
      review({
        state: "APPROVED",
        login: "pull-request-author",
      }),
    ],
  });
  const missingAuthor = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "github-human",
    allowedLogins: ["trusted-owner"],
    reviews: [review({ state: "APPROVED", login: "trusted-owner" })],
  });

  assert.equal(selfApproval.ok, false);
  assert.match(selfApproval.message, /No actual/);
  assert.equal(missingAuthor.ok, false);
  assert.match(missingAuthor.message, /pull request author/);
});

test("built-in review does not manufacture an external receipt requirement", () => {
  const result = evaluateReviewReceipt({
    headOid: HEAD,
    provider: "builtin",
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /not required/);
});

test("provider configuration fails closed on incomplete or downgraded policy", () => {
  const directory = mkdtempSync(join(tmpdir(), "review-selection-test-"));
  const configFile = join(directory, "config.json");
  try {
    const config = {
      onboarding: {
        status: "complete",
        project_profile: "production",
      },
      capabilities: {
        review: {
          provider: "coderabbit",
          required_for_release: true,
          current_revision_required: true,
          allowed_logins: [],
        },
      },
    };
    writeFileSync(configFile, JSON.stringify(config), "utf8");
    assert.deepEqual(resolveReviewSelection({ config: configFile }), {
      provider: "coderabbit",
      required: true,
      allowedLogins: [],
    });

    delete config.capabilities.review.current_revision_required;
    writeFileSync(configFile, JSON.stringify(config), "utf8");
    assert.throws(
      () => resolveReviewSelection({ config: configFile }),
      /current pull request revision/,
    );

    config.capabilities.review.current_revision_required = false;
    writeFileSync(configFile, JSON.stringify(config), "utf8");
    assert.throws(
      () => resolveReviewSelection({ config: configFile }),
      /current pull request revision/,
    );

    config.capabilities.review.current_revision_required = true;
    config.capabilities.review.required_for_release = false;
    writeFileSync(configFile, JSON.stringify(config), "utf8");
    assert.throws(
      () => resolveReviewSelection({ config: configFile }),
      /does not match/,
    );

    config.capabilities.review.provider = "builtin";
    writeFileSync(configFile, JSON.stringify(config), "utf8");
    assert.throws(
      () => resolveReviewSelection({ config: configFile }),
      /Production configuration/,
    );

    config.onboarding.project_profile = "standard";
    writeFileSync(configFile, JSON.stringify(config), "utf8");
    assert.deepEqual(resolveContext(["--config", configFile], {}), {
      skip: true,
      review: {
        provider: "builtin",
        required: false,
        allowedLogins: [],
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    review: {
      provider: "coderabbit",
      required: true,
      allowedLogins: [],
    },
  });
  assert.throws(
    () => resolveContext([], { GITHUB_TOKEN: "secret-token" }),
    /owner\/repository/,
  );
});
