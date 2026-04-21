import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await readOptionalJson(options.resultJson);
  const publish = await readOptionalJson(options.publishJson);
  const commentBody = buildWorkIssueLaneComment({
    lane: options.lane,
    requestTitle: options.requestTitle ?? result?.request_title,
    targetRepo: options.targetRepo ?? result?.target_repo,
    runUrl: options.runUrl,
    ledgerRevision: options.ledgerRevision ?? result?.work_issue?.ledger_revision,
    publish: publish ?? result?.publish,
    workflowStatus: options.workflowStatus,
  });

  const issue = JSON.parse(
    execFileSync(
      "gh",
      [
        "issue",
        "view",
        options.issue,
        "--repo",
        options.repo,
        "--json",
        "comments",
      ],
      { encoding: "utf8" },
    ),
  );
  const marker = laneMarker(options.lane);
  const existing = (issue.comments ?? []).find(
    (comment) => typeof comment.body === "string" && comment.body.includes(marker),
  );
  const existingCommentId = resolveIssueCommentId(existing);

  if (existing?.body?.trim() === commentBody.trim()) {
    process.stdout.write(`${JSON.stringify({ status: "noop", reason: "comment already up to date" }, null, 2)}\n`);
    return;
  }

  if (existingCommentId) {
    execFileSync(
      "gh",
      [
        "api",
        "--method",
        "PATCH",
        `repos/${options.repo}/issues/comments/${existingCommentId}`,
        "-f",
        `body=${commentBody}`,
      ],
      { stdio: "inherit" },
    );
    process.stdout.write(`${JSON.stringify({ status: "updated", comment_id: existingCommentId }, null, 2)}\n`);
    return;
  }

  execFileSync(
    "gh",
    [
      "issue",
      "comment",
      options.issue,
      "--repo",
      options.repo,
      "--body",
      commentBody,
    ],
    { stdio: "inherit" },
  );
  process.stdout.write(`${JSON.stringify({ status: "posted" }, null, 2)}\n`);
}

export function buildWorkIssueLaneComment({
  lane,
  requestTitle,
  targetRepo,
  runUrl,
  ledgerRevision,
  publish,
  workflowStatus,
}) {
  const gateId = `${String(lane).trim()}.publish`;
  const lines = [
    laneMarker(lane),
    `## runx ${lane}`,
    "",
    requestTitle ? `- Request: \`${String(requestTitle).trim()}\`` : null,
    targetRepo ? `- Target repo: \`${String(targetRepo).trim()}\`` : null,
    `- Status: \`${resolveLaneStatus({ publish, workflowStatus })}\``,
    publish?.status === "published" ? `- Draft PR: [#${publish.pr_number}](${publish.pr_url})` : null,
    publish?.status !== "published" ? `- Publish gate: authorize \`${gateId}\` on this issue to refresh the draft PR` : null,
    ledgerRevision ? `- Ledger revision: \`${ledgerRevision}\`` : null,
    runUrl ? `- Workflow run: ${runUrl}` : null,
    "",
    "Reply in this work issue with maintainer amendments, constraints, or teaching notes.",
    "Trusted maintainer replies rerun the lane from the same work ledger.",
  ].filter(Boolean);
  return `${lines.join("\n").trim()}\n`;
}

function laneMarker(lane) {
  return `<!-- aster:runx-work-lane:${String(lane).trim()} -->`;
}

function resolveLaneStatus({ publish, workflowStatus }) {
  if (workflowStatus && workflowStatus !== "success") {
    return "run_failed";
  }
  if (!publish || typeof publish !== "object") {
    return "run_completed";
  }
  if (publish.status === "published") {
    return "draft_pr_refreshed";
  }
  if (publish.status === "missing" || publish.status === "not_requested") {
    return "proposal_refreshed";
  }
  return String(publish.status ?? "run_completed");
}

async function readOptionalJson(file) {
  if (!file) {
    return null;
  }
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue") {
      options.issue = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--lane") {
      options.lane = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--request-title") {
      options.requestTitle = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--target-repo") {
      options.targetRepo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--run-url") {
      options.runUrl = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--ledger-revision") {
      options.ledgerRevision = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--publish-json") {
      options.publishJson = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--result-json") {
      options.resultJson = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--workflow-status") {
      options.workflowStatus = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.repo || !options.issue || !options.lane) {
    throw new Error("--repo, --issue, and --lane are required.");
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

function resolveIssueCommentId(comment) {
  if (!comment || typeof comment !== "object") {
    return undefined;
  }
  if (typeof comment.databaseId === "number") {
    return String(comment.databaseId);
  }
  if (typeof comment.url === "string") {
    const match = comment.url.match(/issuecomment-(\d+)$/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
