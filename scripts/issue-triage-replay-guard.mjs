import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  computeIssueFingerprint,
  parseIssueTriageCommentMetadata,
} from "./issue-triage-markers.mjs";

const defaultRunner = (command, args) => execFileSync(command, args, { encoding: "utf8" });

export async function issueTriageReplayGuard(argv = process.argv.slice(2), runner = defaultRunner) {
  const options = parseArgs(argv);
  const plan = buildReplayGuardPlan({
    ...options,
    comments: loadComments(options, runner),
    operator_memory_branch: buildOperatorMemoryBranch(options),
    has_open_operator_memory_pr: hasOpenOperatorMemoryPr(options, runner),
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

export function buildReplayGuardPlan({
  mode,
  issue,
  pr,
  title,
  body,
  sha,
  comments = [],
  operator_memory_branch,
  has_open_operator_memory_pr = false,
}) {
  if (has_open_operator_memory_pr) {
    return {
      status: "skip",
      reason: "open_operator_memory_pr",
      operator_memory_branch,
    };
  }

  if (mode === "issue") {
    const fingerprint = computeIssueFingerprint({ title, body });
    const existing = comments.find((comment) => {
      const metadata = parseIssueTriageCommentMetadata(comment?.body);
      return metadata.has_marker && metadata.fingerprint === fingerprint;
    });
    if (existing) {
      return {
        status: "skip",
        reason: "duplicate_issue_fingerprint",
        fingerprint,
        operator_memory_branch,
      };
    }
    return {
      status: "run",
      fingerprint,
      operator_memory_branch,
      issue,
    };
  }

  const existing = comments.find((comment) => {
    const metadata = parseIssueTriageCommentMetadata(comment?.body);
    return metadata.has_marker && metadata.sha === sha;
  });
  if (existing) {
    return {
      status: "skip",
      reason: "duplicate_pr_head_sha",
      sha,
      operator_memory_branch,
    };
  }

  return {
    status: "run",
    sha,
    operator_memory_branch,
    pr,
  };
}

function loadComments(options, runner) {
  if (options.mode === "issue") {
    const issue = JSON.parse(
      runner("gh", [
        "issue",
        "view",
        options.issue,
        "--repo",
        options.repo,
        "--json",
        "comments",
      ]),
    );
    return issue.comments ?? [];
  }

  const pr = JSON.parse(
    runner("gh", [
      "pr",
      "view",
      options.pr,
      "--repo",
      options.repo,
      "--json",
      "comments",
    ]),
  );
  return pr.comments ?? [];
}

function hasOpenOperatorMemoryPr(options, runner) {
  const listing = JSON.parse(
    runner("gh", [
      "pr",
      "list",
      "--repo",
      options.asterRepo,
      "--head",
      buildOperatorMemoryBranch(options),
      "--state",
      "open",
      "--json",
      "number",
    ]),
  );
  return Array.isArray(listing) && listing.length > 0;
}

function buildOperatorMemoryBranch(options) {
  const targetSlug = slugifyRepoLike(options.repo);
  if (options.mode === "issue") {
    return `runx/operator-memory-issue-triage-${targetSlug}-issue-${options.issue}`;
  }
  return `runx/operator-memory-issue-triage-${targetSlug}-pr-${options.pr}`;
}

function parseArgs(argv) {
  const options = {
    asterRepo: process.env.GITHUB_REPOSITORY || "nilstate/aster",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--mode") {
      options.mode = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue") {
      options.issue = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--pr") {
      options.pr = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--title") {
      options.title = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--body") {
      options.body = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--sha") {
      options.sha = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--aster-repo") {
      options.asterRepo = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!["issue", "pr"].includes(options.mode)) {
    throw new Error("--mode must be `issue` or `pr`.");
  }
  if (!options.repo) {
    throw new Error("--repo is required.");
  }
  if (options.mode === "issue" && (!options.issue || !options.title)) {
    throw new Error("--issue and --title are required for issue mode.");
  }
  if (options.mode === "pr" && (!options.pr || !options.sha)) {
    throw new Error("--pr and --sha are required for pr mode.");
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

function slugifyRepoLike(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await issueTriageReplayGuard();
}
