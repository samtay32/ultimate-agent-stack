#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ISSUE_TITLE = "[upstream-watch] Source changes need review";

function markdownCell(value) {
  return String(value ?? "n/a")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, " ")
    .slice(0, 500);
}

function buildIssueBody(report) {
  const changed = Array.isArray(report.changed) ? report.changed : [];
  const errors = Array.isArray(report.errors) ? report.errors : [];
  const rows = [
    "| Source | Status | Pinned | Remote |",
    "|---|---|---|---|",
  ];
  for (const item of [...changed, ...errors]) {
    rows.push(
      `| ${markdownCell(item.id)} | ${markdownCell(item.status)} | ${markdownCell(
        item.pinned_commit,
      )} | ${markdownCell(item.remote_commit ?? item.error)} |`,
    );
  }
  return [
    "The read-only upstream monitor found changes or lookup errors.",
    "",
    ...rows,
    "",
    "Safety policy:",
    "",
    "- Treat upstream repositories as untrusted research inputs.",
    "- Do not copy, merge, install, or publish anything automatically.",
    "- Use `$maintain-agent-stack` to inspect the diff, license, tests, and relevance.",
    "- Update a pinned commit only after recording an explicit adoption or rejection.",
    "",
    `Checked at: ${report.checked_at ?? "unknown"}`,
  ].join("\n");
}

function parseRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value ?? "")) {
    throw new Error("GITHUB_REPOSITORY must have the form owner/repository");
  }
  return value;
}

async function githubRequest(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 2_000);
    throw new Error(`GitHub API ${response.status}: ${detail}`);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function publishUpstreamIssue(report) {
  const changed = Array.isArray(report.changed) ? report.changed : [];
  const errors = Array.isArray(report.errors) ? report.errors : [];
  if (changed.length === 0 && errors.length === 0) {
    return { ok: true, action: "none", detail: "all monitored sources current" };
  }

  const repository = parseRepository(process.env.GITHUB_REPOSITORY);
  const [owner, repo] = repository.split("/");
  const openIssues = await githubRequest(
    `/repos/${owner}/${repo}/issues?state=open&per_page=100`,
  );
  const existing = openIssues.find(
    (issue) => !issue.pull_request && issue.title === ISSUE_TITLE,
  );
  const body = buildIssueBody(report);

  if (existing) {
    await githubRequest(
      `/repos/${owner}/${repo}/issues/${existing.number}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      },
    );
    return {
      ok: true,
      action: "commented",
      issue_number: existing.number,
      url: existing.html_url,
    };
  }

  const created = await githubRequest(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: ISSUE_TITLE, body }),
  });
  return {
    ok: true,
    action: "created",
    issue_number: created.number,
    url: created.html_url,
  };
}

async function main(argv = process.argv.slice(2)) {
  const file = resolve(argv[0] ?? "upstream-report.json");
  if (!existsSync(file)) {
    throw new Error(`Missing upstream report: ${file}`);
  }
  const report = JSON.parse(readFileSync(file, "utf8"));
  const result = await publishUpstreamIssue(report);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isEntryPoint =
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  ISSUE_TITLE,
  buildIssueBody,
  markdownCell,
  parseRepository,
  publishUpstreamIssue,
};
