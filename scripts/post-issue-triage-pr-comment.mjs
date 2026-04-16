import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { evaluatePublicCommentOpportunity } from "./public-work-policy.mjs";

const marker = "<!-- automaton:runx-issue-triage -->";
const defaultRunner = (command, args) => execFileSync(command, args, { encoding: "utf8" });

export async function postIssueTriagePrComment(argv = process.argv.slice(2), runner = defaultRunner) {
  const options = parseArgs(argv);
  const body = (await readFile(options.bodyFile, "utf8")).trim();
  const plan = buildCommentPlan({ options, body, runner });
  if (plan.status !== "ready") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return plan;
  }

  runner(
    "gh",
    [
      "pr",
      "comment",
      options.pr,
      "--repo",
      options.repo,
      "--body",
      plan.comment_body,
    ],
  );

  const result = {
    status: "posted",
    sha: options.sha,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function buildCommentPlan({ options, body, runner = defaultRunner }) {
  const report = JSON.parse(
    runner(
      "gh",
      [
        "pr",
        "view",
        options.pr,
        "--repo",
        options.repo,
        "--json",
        "title,author,headRefName,labels,comments,reviews",
      ],
    ),
  );
  const issueMetadata = JSON.parse(
    runner(
      "gh",
      [
        "api",
        `repos/${options.repo}/issues/${options.pr}`,
        "--jq",
        "{ authorAssociation: .author_association }",
      ],
    ),
  );
  const publicCommentPolicy = evaluatePublicCommentOpportunity({
    source: "github_pull_request",
    lane: "issue-triage",
    authorLogin: report.author?.login,
    authorAssociation: issueMetadata.authorAssociation,
    title: report.title,
    labels: (report.labels ?? []).map((label) => label.name),
    headRefName: report.headRefName,
    commentsCount: (report.comments ?? []).length,
    reviewCommentsCount: (report.reviews ?? []).length,
  });
  if (publicCommentPolicy.blocked) {
    return {
      status: "noop",
      reason: publicCommentPolicy.reasons[0],
      reasons: publicCommentPolicy.reasons,
    };
  }

  const shaMarker = `Head SHA: ${options.sha}`;
  const existing = (report.comments ?? []).find(
    (comment) =>
      typeof comment.body === "string" &&
      comment.body.includes(marker) &&
      comment.body.includes(shaMarker),
  );
  if (existing) {
    return {
      status: "noop",
      reason: "comment already exists",
    };
  }

  return {
    status: "ready",
    comment_body: `${marker}\n${body}\n\n${shaMarker}`,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--pr") {
      options.pr = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--body-file") {
      options.bodyFile = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--sha") {
      options.sha = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.repo || !options.pr || !options.bodyFile || !options.sha) {
    throw new Error("--repo, --pr, --body-file, and --sha are required.");
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
  await postIssueTriagePrComment();
}
