import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  THREAD_TEACHING_SEARCH_QUERIES,
  buildThreadTeachingRow,
  extractTrustedThreadTeachingRecords,
  threadTeachingRecordStatus,
  loadIssueThreadEntries,
  loadPullRequestThreadEntries,
  mergeThreadTeachingThreadHits,
} from "./thread-teaching.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await deriveThreadTeaching({
    repoRoot: options.repoRoot,
    repos: options.repos,
    searchLimit: options.searchLimit,
    now: options.now,
  });
  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

export async function deriveThreadTeaching(
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
  const searchQueries = helpers.searchQueries ?? THREAD_TEACHING_SEARCH_QUERIES;
  const generatedAt = now ?? new Date().toISOString();

  const records = [];
  const teachingRows = [];
  const errors = [];

  for (const repo of trackedRepos) {
    try {
      const threadHits = mergeThreadTeachingThreadHits(
        ...searchQueries.flatMap((query) => [
          searchThreads(repo, { query, match: "body", limit: searchLimit }),
          searchThreads(repo, { query, match: "comments", limit: searchLimit }),
        ]),
      );
      const repoEntries = buildThreadTeachingEntries({
        repo,
        threads: threadHits,
        loadIssueEntries,
        loadPullRequestEntries,
        now: generatedAt,
      });
      records.push(...repoEntries.records);
      teachingRows.push(...repoEntries.teaching_rows.map((row) => ({
        ...row,
        generated_at: generatedAt,
      })));
    } catch (error) {
      errors.push({
        repo,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    generated_at: generatedAt,
    source: {
      type: "github_search",
      queries: searchQueries,
      repos: trackedRepos,
      search_limit: searchLimit,
    },
    errors,
    records: records.sort((left, right) =>
      Date.parse(String(right.thread_teaching_record?.recorded_at ?? ""))
      - Date.parse(String(left.thread_teaching_record?.recorded_at ?? ""))
    ),
    teaching_rows: teachingRows.sort((left, right) =>
      Date.parse(String(right.recorded_at ?? "")) - Date.parse(String(left.recorded_at ?? ""))
    ),
  };
}

export function buildThreadTeachingEntries({
  repo,
  threads = [],
  loadIssueEntries = loadIssueThreadEntries,
  loadPullRequestEntries = loadPullRequestThreadEntries,
  now,
}) {
  const records = [];
  const teachingRows = [];
  for (const thread of Array.isArray(threads) ? threads : []) {
    const loader = thread.kind === "pr" ? loadPullRequestEntries : loadIssueEntries;
    const threadRecords = extractTrustedThreadTeachingRecords(
      loader({
        repo,
        issue: thread.kind === "issue" ? String(thread.number) : undefined,
        pr: thread.kind === "pr" ? String(thread.number) : undefined,
      }),
      {
        repo,
        threadKind: thread.kind,
        threadNumber: thread.number,
      },
    );
    const supersededIds = collectSupersededRecordIds(threadRecords, now);
    for (const record of threadRecords) {
      const status = threadTeachingRecordStatus(record, {
        now,
        supersededIds,
      });
      const threadLocator = `${repo}#${thread.kind}/${thread.number}`;
      records.push({
        record_id: record.record_id,
        repo,
        thread: threadLocator,
        thread_kind: thread.kind,
        thread_number: Number(thread.number),
        thread_title: thread.title ?? null,
        thread_url: thread.url ?? null,
        thread_state: thread.state ?? null,
        status,
        thread_teaching_record: {
          ...record,
          status,
        },
      });
      teachingRows.push(buildThreadTeachingRow({
        repo,
        thread: threadLocator,
        threadKind: thread.kind,
        threadNumber: thread.number,
        threadTitle: thread.title ?? null,
        threadUrl: thread.url ?? null,
        threadState: thread.state ?? null,
        record,
        status,
      }));
    }
  }
  return {
    records,
    teaching_rows: teachingRows,
  };
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

function defaultSearchThreads(repo, { query, match, limit }) {
  const args = [
    "search",
    "issues",
    query,
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

function collectSupersededRecordIds(records = [], now) {
  const supersededIds = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    if (record.kind !== "memory_correction" || threadTeachingRecordStatus(record, { now }) !== "active") {
      continue;
    }
    for (const recordId of record.supersedes ?? []) {
      supersededIds.add(recordId);
    }
  }
  return supersededIds;
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
      options.searchLimit = Number.parseInt(requireValue(argv, ++index, token), 10);
      continue;
    }
    if (token === "--now") {
      options.now = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
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

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
