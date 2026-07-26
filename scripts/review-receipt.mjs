#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const REVIEW_PAGE_LIMIT = 100;
const PASSING_REVIEW_STATES = new Set(["APPROVED", "COMMENTED"]);
const RATE_LIMIT_PATTERN =
  /\b(rate limit|review limit|review quota|reviews? remaining|refill)\b/i;

function normalizeLogin(login) {
  return String(login ?? "")
    .toLowerCase()
    .replace(/\[bot\]$/, "");
}

function isCodeRabbit(login) {
  return normalizeLogin(login) === "coderabbitai";
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
}) {
  if (typeof headOid !== "string" || headOid.length === 0) {
    return failure("GitHub did not return the pull request head commit.");
  }
  if (truncated.length > 0) {
    return failure(
      `GitHub evidence exceeded the ${REVIEW_PAGE_LIMIT}-item safety limit.`,
      { truncated },
    );
  }

  const codeRabbitReviews = reviews.filter((review) =>
    isCodeRabbit(review.author?.login),
  );
  const currentReviews = codeRabbitReviews.filter(
    (review) => review.commit?.oid === headOid,
  );
  const requestedChanges = currentReviews.filter(
    (review) => review.state === "CHANGES_REQUESTED",
  );
  if (requestedChanges.length > 0) {
    return failure(
      "CodeRabbit requested changes on the current pull request revision.",
      { current_review_states: currentReviews.map((review) => review.state) },
    );
  }

  const unresolvedThreads = threads.filter((thread) => {
    const author = thread.comments?.nodes?.[0]?.author?.login;
    return (
      isCodeRabbit(author) &&
      thread.isResolved !== true &&
      thread.isOutdated !== true
    );
  });
  if (unresolvedThreads.length > 0) {
    return failure(
      `CodeRabbit has ${unresolvedThreads.length} unresolved current review thread(s).`,
      { unresolved_threads: unresolvedThreads.length },
    );
  }

  const passingReviews = currentReviews.filter((review) =>
    PASSING_REVIEW_STATES.has(review.state),
  );
  if (passingReviews.length === 0) {
    const rateLimited = comments.some(
      (comment) =>
        isCodeRabbit(comment.author?.login) &&
        RATE_LIMIT_PATTERN.test(comment.body ?? ""),
    );
    if (rateLimited) {
      return failure(
        "CodeRabbit reported a review limit and has not reviewed the current revision.",
      );
    }
    if (codeRabbitReviews.length > 0) {
      return failure(
        "The latest CodeRabbit review is stale; request a review of the current revision.",
        {
          reviewed_commits: codeRabbitReviews
            .map((review) => review.commit?.oid)
            .filter(Boolean),
        },
      );
    }
    return failure(
      "No actual CodeRabbit review was submitted for the current revision.",
    );
  }

  return {
    ok: true,
    message: `CodeRabbit reviewed current commit ${headOid.slice(0, 12)} with no unresolved current threads.`,
    detail: {
      reviewed_commit: headOid,
      review_states: passingReviews.map((review) => review.state),
    },
  };
}

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--repo" && argument !== "--pr") {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  return parsed;
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
  return { owner, name, pullRequest, token };
}

async function fetchReviewEvidence({ owner, name, pullRequest, token }) {
  const query = `
    query ReviewReceipt($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          headRefOid
          reviews(first: ${REVIEW_PAGE_LIMIT}) {
            nodes {
              author { login }
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
                nodes { author { login } }
              }
            }
            pageInfo { hasNextPage }
          }
          comments(first: ${REVIEW_PAGE_LIMIT}) {
            nodes {
              author { login }
              body
              createdAt
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
    const evidence = await fetchReviewEvidence(context);
    const result = evaluateReviewReceipt(evidence);
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
  main,
  normalizeLogin,
  resolveContext,
};
