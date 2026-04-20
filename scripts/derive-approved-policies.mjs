import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  deriveApprovalContext,
  loadIssueThreadEntries,
  loadPullRequestThreadEntries,
} from "./derive-approval-context.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");
const APPROVAL_SEARCH_QUERY = "aster:approval-context";

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const existing = options.output && existsSync(path.resolve(options.output))
    ? JSON.parse(await readFile(path.resolve(options.output), "utf8"))
    : null;
  const report = await deriveApprovedPolicies({
    repoRoot: options.repoRoot,
    repos: options.repos,
    searchLimit: options.searchLimit,
    now: options.now,
  });
  const outputReport = existing && Array.isArray(report.errors) && report.errors.length > 0 && report.policies.length === 0
    ? {
        ...existing,
        refresh_attempted_at: report.generated_at,
        refresh_errors: report.errors,
      }
    : report;

  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(outputReport, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(outputReport, null, 2)}\n`);
}

export async function deriveApprovedPolicies(
  {
    repoRoot = defaultRepoRoot,
    repos = [],
    searchLimit = 20,
    now,
  } = {},
  helpers = {},
) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const trackedRepos = repos.length > 0
    ? uniqueStrings(repos)
    : await loadTrackedRepos(resolvedRepoRoot);
  const searchThreads = helpers.searchThreads ?? defaultSearchThreads;
  const loadIssueEntries = helpers.loadIssueEntries ?? loadIssueThreadEntries;
  const loadPullRequestEntries = helpers.loadPullRequestEntries ?? loadPullRequestThreadEntries;
  const derivedAt = now ?? new Date().toISOString();

  const policies = [];
  const errors = [];
  for (const repo of trackedRepos) {
    try {
      const threadHits = mergeApprovalThreadHits(
        searchThreads(repo, { match: "body", limit: searchLimit }),
        searchThreads(repo, { match: "comments", limit: searchLimit }),
      );
      const repoPolicies = buildApprovedPolicyEntries({
        repo,
        threads: threadHits,
        loadIssueEntries,
        loadPullRequestEntries,
        now: derivedAt,
      });
      policies.push(...repoPolicies);
    } catch (error) {
      errors.push({
        repo,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    generated_at: derivedAt,
    source: {
      type: "github_search",
      marker: APPROVAL_SEARCH_QUERY,
      repos: trackedRepos,
      search_limit: searchLimit,
    },
    errors,
    policies: policies.sort((left, right) =>
      Date.parse(String(right.approval_context?.matched_from?.created_at ?? ""))
      - Date.parse(String(left.approval_context?.matched_from?.created_at ?? ""))
    ),
  };
}

export function buildApprovedPolicyEntries({
  repo,
  threads = [],
  loadIssueEntries = loadIssueThreadEntries,
  loadPullRequestEntries = loadPullRequestThreadEntries,
  now,
}) {
  const entries = [];
  for (const thread of Array.isArray(threads) ? threads : []) {
    const loader = thread.kind === "pr" ? loadPullRequestEntries : loadIssueEntries;
    const approvalContext = deriveApprovalContext(
      loader({
        repo,
        issue: thread.kind === "issue" ? String(thread.number) : undefined,
        pr: thread.kind === "pr" ? String(thread.number) : undefined,
      }),
      { now },
    );
    if (!approvalContext) {
      continue;
    }
    const expired = isExpired(approvalContext.expires_after, now);
    entries.push({
      policy_id: `${repo}#${thread.kind}/${thread.number}@${approvalContext.matched_from?.created_at ?? "unknown"}`,
      repo,
      thread: `${repo}#${thread.kind}/${thread.number}`,
      thread_kind: thread.kind,
      thread_number: Number(thread.number),
      thread_title: thread.title ?? null,
      thread_url: thread.url ?? null,
      state: thread.state ?? null,
      status: expired ? "expired" : "active",
      approval_context: approvalContext,
    });
  }
  return entries;
}

export function mergeApprovalThreadHits(...collections) {
  const deduped = new Map();
  for (const collection of collections) {
    for (const thread of Array.isArray(collection) ? collection : []) {
      const kind = thread.kind === "pr" ? "pr" : "issue";
      const key = `${kind}:${thread.number}`;
      const existing = deduped.get(key);
      if (!existing || Date.parse(String(thread.updatedAt ?? "")) > Date.parse(String(existing.updatedAt ?? ""))) {
        deduped.set(key, {
          kind,
          number: Number(thread.number),
          title: thread.title ?? null,
          url: thread.url ?? null,
          state: thread.state ?? null,
          updatedAt: thread.updatedAt ?? null,
        });
      }
    }
  }
  return [...deduped.values()].sort(
    (left, right) => Date.parse(String(right.updatedAt ?? "")) - Date.parse(String(left.updatedAt ?? "")),
  );
}

async function loadTrackedRepos(repoRoot) {
  const controlPath = path.join(repoRoot, "state", "aster-control.json");
  if (existsSync(controlPath)) {
    const control = JSON.parse(await readFile(controlPath, "utf8"));
    const repos = uniqueStrings(
      Array.isArray(control?.targets)
        ? control.targets.map((entry) => entry?.repo)
        : [],
    );
    if (repos.length > 0) {
      return repos;
    }
  }

  const targetsDir = path.join(repoRoot, "state", "targets");
  if (!existsSync(targetsDir)) {
    return [];
  }
  const entries = await readdir(targetsDir, { withFileTypes: true });
  const repos = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const raw = await readFile(path.join(targetsDir, entry.name), "utf8");
    const locatorMatch = raw.match(/subject_locator:\s*([^\n]+)/i);
    if (locatorMatch?.[1]?.trim()) {
      repos.push(locatorMatch[1].trim());
      continue;
    }
    const titleMatch = raw.match(/Target Dossier\s+—\s+([^\n]+)/i);
    if (titleMatch?.[1]?.trim()) {
      repos.push(titleMatch[1].trim());
    }
  }
  return uniqueStrings(repos);
}

function defaultSearchThreads(repo, { match, limit }) {
  const args = [
    "search",
    "issues",
    APPROVAL_SEARCH_QUERY,
    "--repo",
    repo,
    "--match",
    match,
    "--json",
    "number,isPullRequest,state,title,updatedAt,url",
    "--limit",
    String(limit),
    "--sort",
    "updated",
    "--include-prs",
  ];
  const parsed = JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));
  return Array.isArray(parsed)
    ? parsed.map((entry) => ({
        ...entry,
        kind: entry.isPullRequest ? "pr" : "issue",
      }))
    : [];
}

function isExpired(expiresAfter, now) {
  const expiresAtMs = Date.parse(String(expiresAfter ?? ""));
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  const nowMs = now ? Date.parse(now) : Date.now();
  return Number.isFinite(nowMs) ? nowMs > expiresAtMs : false;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = typeof value === "string" && value.trim() ? value.trim() : null;
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    repos: [],
    searchLimit: 20,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo-root") {
      options.repoRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--repo") {
      options.repos.push(requireValue(argv, ++index, token));
      continue;
    }
    if (token === "--search-limit") {
      options.searchLimit = Number(requireValue(argv, ++index, token));
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--now") {
      options.now = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
