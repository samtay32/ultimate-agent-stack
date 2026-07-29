#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const REVIEW_PAGE_LIMIT = 100;
const PASSING_REVIEW_STATES = new Set(["APPROVED", "COMMENTED"]);
const RATE_LIMIT_PATTERN =
  /\b(rate limit|review limit|review quota|reviews? remaining|refill)\b/i;
const QODO_REVIEW_TITLE_PATTERN = /\bCode Review by Qodo\b/i;
const QODO_PROCESSING_PATTERN =
  /\b(?:agents?\s+(?:are|is)|Qodo\s+is)\s+(?:still\s+)?working\b|\bprocessing\b/i;
const QODO_CLEAN_COMPLETION_PATTERNS = [
  /(?:<h[1-6]\b[^>]*>|^\s*#{1,6}\s+)\s*(?:great[\s,:!.\u2013\u2014-]*)?no\s+(?:material\s+)?issues?\s+(?:were\s+)?found\b/im,
  /\b(?:found\s+no|no)\s+material\s+issues?(?:\s+(?:that\s+)?(?:require|requiring)\s+review)?\b/i,
];

function normalizeLogin(login) {
  return String(login ?? "")
    .toLowerCase()
    .replace(/\[bot\]$/, "");
}

function isCodeRabbit(login) {
  return normalizeLogin(login) === "coderabbitai";
}

function isQodo(login) {
  return normalizeLogin(login) === "qodo-code-review";
}

function escapedPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function qodoExactHeadMatches(body, headOid) {
  const fullCommit = escapedPattern(headOid);
  return new RegExp(
    `(?:\\b(?:Review updated until commit|Results up to commit)\\s+(?:https:\\/\\/github\\.com\\/[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+\\/commit\\/)?|https:\\/\\/github\\.com\\/[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+\\/commit\\/)${fullCommit}(?:\\b|$)`,
    "i",
  ).test(body);
}

function qodoCompletionMatches(comment, headOid, unifiedReviewUrl = undefined) {
  if (!isQodo(comment.author?.login) || comment.author?.__typename !== "Bot") {
    return false;
  }
  const commitPattern = escapedPattern(headOid);
  const body = comment.body ?? "";
  const legacyCompletion =
    new RegExp(
      `\\bCode review\\b[\\s\\S]*\\bupdated up to the latest commit\\b[\\s\\S]*\\/commit\\/${commitPattern}(?:\\b|$)`,
      "i",
    ).test(body) &&
    (unifiedReviewUrl === undefined || body.includes(unifiedReviewUrl));
  const currentCleanCompletion =
    QODO_REVIEW_TITLE_PATTERN.test(body) &&
    !QODO_PROCESSING_PATTERN.test(body) &&
    QODO_CLEAN_COMPLETION_PATTERNS.some((pattern) => pattern.test(body)) &&
    qodoExactHeadMatches(body, headOid);
  return legacyCompletion || currentCleanCompletion;
}

function qodoUnifiedReviewMatches(comment, headOid) {
  if (!isQodo(comment.author?.login) || comment.author?.__typename !== "Bot") {
    return false;
  }
  const body = comment.body ?? "";
  return (
    QODO_REVIEW_TITLE_PATTERN.test(body) &&
    qodoExactHeadMatches(body, headOid)
  );
}

function reviewerPolicy(
  provider,
  allowedLogins = [],
  excludedLogin = undefined,
) {
  if (provider === "coderabbit") {
    return {
      label: "CodeRabbit",
      matches: (author) => isCodeRabbit(author?.login),
      passingStates: PASSING_REVIEW_STATES,
    };
  }
  if (provider === "qodo") {
    return {
      label: "Qodo",
      matches: (author) =>
        author?.__typename === "Bot" && isQodo(author?.login),
      passingStates: PASSING_REVIEW_STATES,
    };
  }
  if (provider === "github-human") {
    const allowed = new Set(allowedLogins.map(normalizeLogin));
    const excluded = normalizeLogin(excludedLogin);
    if (allowed.size === 0) {
      throw new Error(
        "github-human review requires at least one allowed GitHub login.",
      );
    }
    return {
      label: "An allowed GitHub human reviewer",
      matches: (author) => {
        const login = normalizeLogin(author?.login);
        return (
          author?.__typename === "User" &&
          allowed.has(login) &&
          login !== excluded
        );
      },
      passingStates: new Set(["APPROVED"]),
    };
  }
  if (provider === "builtin") {
    return {
      label: "Built-in review",
      matches: () => false,
      passingStates: new Set(),
    };
  }
  throw new Error(`Unsupported review provider: ${provider}`);
}

function failure(message, detail = {}) {
  return { ok: false, message, detail };
}

function evaluateReviewReceipt({
  headOid,
  reviews = [],
  threads = [],
  comments = [],
  truncated = [],
  provider = "coderabbit",
  allowedLogins = [],
  pullRequestAuthor = undefined,
}) {
  if (
    provider === "github-human" &&
    normalizeLogin(pullRequestAuthor?.login).length === 0
  ) {
    return failure(
      "GitHub did not return the pull request author required for independent human review.",
    );
  }
  const policy = reviewerPolicy(
    provider,
    allowedLogins,
    provider === "github-human" ? pullRequestAuthor.login : undefined,
  );
  if (provider === "builtin") {
    return {
      ok: true,
      message:
        "External review receipt is not required by the selected project profile.",
      detail: { provider },
    };
  }
  if (typeof headOid !== "string" || headOid.length === 0) {
    return failure("GitHub did not return the pull request head commit.");
  }
  const relevantTruncation =
    provider === "coderabbit" || provider === "qodo"
      ? truncated
      : truncated.filter((connection) => connection !== "comments");
  if (relevantTruncation.length > 0) {
    return failure(
      `GitHub evidence exceeded the ${REVIEW_PAGE_LIMIT}-item safety limit.`,
      { truncated: relevantTruncation },
    );
  }

  const providerReviews = reviews.filter((review) =>
    policy.matches(review.author),
  );
  const currentReviews = providerReviews.filter(
    (review) => review.commit?.oid === headOid,
  );
  const requestedChanges = currentReviews.filter(
    (review) => review.state === "CHANGES_REQUESTED",
  );
  if (requestedChanges.length > 0) {
    return failure(
      `${policy.label} requested changes on the current pull request revision.`,
      { current_review_states: currentReviews.map((review) => review.state) },
    );
  }

  const unresolvedThreads = threads.filter((thread) => {
    const author = thread.comments?.nodes?.[0]?.author;
    return (
      policy.matches(author) &&
      thread.isResolved !== true &&
      thread.isOutdated !== true
    );
  });
  if (unresolvedThreads.length > 0) {
    return failure(
      `${policy.label} has ${unresolvedThreads.length} unresolved current review thread(s).`,
      { unresolved_threads: unresolvedThreads.length },
    );
  }

  const passingReviews = currentReviews.filter((review) =>
    policy.passingStates.has(review.state),
  );
  if (provider === "qodo") {
    const unifiedReview = comments.find((comment) =>
      qodoUnifiedReviewMatches(comment, headOid),
    );
    const completion = comments.find((comment) =>
      qodoCompletionMatches(comment, headOid, unifiedReview?.url),
    );
    if (!completion || !unifiedReview) {
      if (providerReviews.length > 0) {
        return failure(
          "The latest Qodo review evidence is stale or incomplete; request a review of the current revision.",
          {
            reviewed_commits: providerReviews
              .map((review) => review.commit?.oid)
              .filter(Boolean),
            exact_head_completion: Boolean(completion),
            exact_head_unified_review: Boolean(unifiedReview),
          },
        );
      }
      return failure(
        "No completed Qodo review was submitted for the current revision.",
        {
          exact_head_completion: Boolean(completion),
          exact_head_unified_review: Boolean(unifiedReview),
        },
      );
    }
    return {
      ok: true,
      message: `Qodo reviewed current commit ${headOid.slice(0, 12)} with no unresolved current threads.`,
      detail: {
        provider,
        reviewed_commit: headOid,
        review_states:
          passingReviews.length > 0
            ? passingReviews.map((review) => review.state)
            : ["UNIFIED_COMMENT"],
      },
    };
  }
  if (passingReviews.length === 0) {
    const rateLimited = provider === "coderabbit" && comments.some(
      (comment) =>
        isCodeRabbit(comment.author?.login) &&
        RATE_LIMIT_PATTERN.test(comment.body ?? ""),
    );
    if (rateLimited) {
      return failure(
        "CodeRabbit reported a review limit and has not reviewed the current revision.",
      );
    }
    if (providerReviews.length > 0) {
      return failure(
        `The latest ${policy.label} review is stale; request a review of the current revision.`,
        {
          reviewed_commits: providerReviews
            .map((review) => review.commit?.oid)
            .filter(Boolean),
        },
      );
    }
    return failure(
      `No actual ${policy.label} review was submitted for the current revision.`,
    );
  }

  return {
    ok: true,
    message: `${policy.label} reviewed current commit ${headOid.slice(0, 12)} with no unresolved current threads.`,
    detail: {
      provider,
      reviewed_commit: headOid,
      review_states: passingReviews.map((review) => review.state),
    },
  };
}

function parseArguments(argv) {
  const parsed = { reviewers: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      argument !== "--repo" &&
      argument !== "--pr" &&
      argument !== "--provider" &&
      argument !== "--config" &&
      argument !== "--reviewer"
    ) {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    if (argument === "--reviewer") {
      parsed.reviewers.push(value);
    } else {
      parsed[argument.slice(2)] = value;
    }
    index += 1;
  }
  return parsed;
}

function resolveReviewSelection(options) {
  if (!options.config) {
    return {
      provider: options.provider ?? "coderabbit",
      required: true,
      allowedLogins: options.reviewers,
    };
  }
  let config;
  try {
    config = JSON.parse(readFileSync(resolve(options.config), "utf8"));
  } catch (error) {
    throw new Error(`Unable to read review configuration: ${error.message}`);
  }
  const review = config.capabilities?.review;
  if (!review || typeof review !== "object") {
    throw new Error("Review configuration is missing capabilities.review.");
  }
  if (config.onboarding?.status !== "complete") {
    throw new Error("Guided onboarding is not complete.");
  }
  if (!["experimental", "standard", "production"].includes(
    config.onboarding?.project_profile,
  )) {
    throw new Error("Review configuration has an invalid project profile.");
  }
  if (!["builtin", "coderabbit", "github-human"].includes(review.provider)) {
    throw new Error("Review configuration has an unsupported provider.");
  }
  const required = review.provider !== "builtin";
  if (review.required_for_release !== required) {
    throw new Error(
      "Review configuration does not match the provider's required receipt policy.",
    );
  }
  if (
    config.onboarding.project_profile === "production" &&
    review.provider === "builtin"
  ) {
    throw new Error(
      "Production configuration requires an external review provider.",
    );
  }
  if (review.current_revision_required !== true) {
    throw new Error(
      "Review configuration must require the current pull request revision.",
    );
  }
  return {
    provider: review.provider,
    required,
    allowedLogins: review.allowed_logins ?? [],
  };
}

function loadEvent(path) {
  if (!path) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read the GitHub event payload: ${error.message}`);
  }
}

function resolveContext(argv, environment) {
  const options = parseArguments(argv);
  const review = resolveReviewSelection(options);
  if (!review.required) {
    return { skip: true, review };
  }
  const event = loadEvent(environment.GITHUB_EVENT_PATH);
  const repository =
    options.repo ??
    environment.GITHUB_REPOSITORY ??
    event.repository?.full_name;
  const pullRequest = Number(options.pr ?? event.pull_request?.number);

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("A valid owner/repository is required.");
  }
  if (!Number.isSafeInteger(pullRequest) || pullRequest < 1) {
    throw new Error("A positive pull request number is required.");
  }
  const token = environment.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required.");
  }

  const [owner, name] = repository.split("/");
  return { owner, name, pullRequest, token, review };
}

async function fetchReviewEvidence({ owner, name, pullRequest, token }) {
  const query = `
    query ReviewReceipt($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          author { login __typename }
          headRefOid
          reviews(first: ${REVIEW_PAGE_LIMIT}) {
            nodes {
              author { login __typename }
              commit { oid }
              state
              submittedAt
            }
            pageInfo { hasNextPage }
          }
          reviewThreads(first: ${REVIEW_PAGE_LIMIT}) {
            nodes {
              isOutdated
              isResolved
              comments(first: 1) {
                nodes { author { login __typename } }
              }
            }
            pageInfo { hasNextPage }
          }
          comments(first: ${REVIEW_PAGE_LIMIT}) {
            nodes {
              author { login __typename }
              body
              createdAt
              updatedAt
              url
            }
            pageInfo { hasNextPage }
          }
        }
      }
    }
  `;
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "ultimate-agent-stack-review-receipt",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({
      query,
      variables: { owner, name, number: pullRequest },
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub GraphQL returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(
      `GitHub GraphQL failed: ${payload.errors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }
  const pullRequestData = payload.data?.repository?.pullRequest;
  if (!pullRequestData) {
    throw new Error("GitHub did not return the requested pull request.");
  }

  const truncated = [];
  for (const connection of ["reviews", "reviewThreads", "comments"]) {
    if (pullRequestData[connection]?.pageInfo?.hasNextPage) {
      truncated.push(connection);
    }
  }
  return {
    pullRequestAuthor: pullRequestData.author,
    headOid: pullRequestData.headRefOid,
    reviews: pullRequestData.reviews?.nodes ?? [],
    threads: pullRequestData.reviewThreads?.nodes ?? [],
    comments: pullRequestData.comments?.nodes ?? [],
    truncated,
  };
}

async function main(
  argv = process.argv.slice(2),
  environment = process.env,
) {
  try {
    const context = resolveContext(argv, environment);
    if (context.skip) {
      process.stdout.write(
        "External review receipt is not required by the selected project profile.\n",
      );
      return 0;
    }
    const evidence = await fetchReviewEvidence(context);
    const result = evaluateReviewReceipt({
      ...evidence,
      provider: context.review.provider,
      allowedLogins: context.review.allowedLogins,
    });
    const output = result.ok ? process.stdout : process.stderr;
    output.write(`${result.message}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Review receipt failed closed: ${error.message}\n`);
    return 1;
  }
}

const isEntryPoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  process.exitCode = await main();
}

export {
  evaluateReviewReceipt,
  fetchReviewEvidence,
  isCodeRabbit,
  isQodo,
  main,
  normalizeLogin,
  qodoCompletionMatches,
  qodoUnifiedReviewMatches,
  reviewerPolicy,
  resolveReviewSelection,
  resolveContext,
};
