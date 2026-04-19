import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const defaultRunner = (command, args) => execFileSync(command, args, { encoding: "utf8" });
const rollbackMarker = "<!-- aster:rollback -->";

export async function rollbackRun(argv = process.argv.slice(2), runner = defaultRunner) {
  const options = parseArgs(argv);
  const plan = buildRollbackPlan(options);

  if (plan.status !== "ready") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return plan;
  }

  if (options.mode === "issue-comment") {
    runner("gh", [
      "issue",
      "comment",
      options.issue,
      "--repo",
      options.repo,
      "--body",
      plan.body,
    ]);
    const result = { status: "posted", mode: options.mode };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }

  if (options.mode === "pr-comment") {
    runner("gh", [
      "pr",
      "comment",
      options.pr,
      "--repo",
      options.repo,
      "--body",
      plan.body,
    ]);
    const result = { status: "posted", mode: options.mode };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }

  const report = JSON.parse(
    runner("gh", [
      "pr",
      "view",
      options.pr,
      "--repo",
      options.repo,
      "--json",
      "state,headRefName",
    ]),
  );
  if (String(report.state ?? "").toUpperCase() !== "OPEN") {
    const result = { status: "noop", reason: "pull_request_already_closed" };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (!String(report.headRefName ?? "").startsWith("runx/") && !options.force) {
    throw new Error("generated-pr rollback requires a runx/* branch unless --force is set.");
  }

  runner("gh", [
    "pr",
    "close",
    options.pr,
    "--repo",
    options.repo,
    "--comment",
    plan.body,
  ]);
  const result = { status: "closed", mode: options.mode };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function buildRollbackPlan(options) {
  if (options.mode === "issue-comment" && !options.issue) {
    return { status: "invalid", reason: "issue_required" };
  }
  if ((options.mode === "pr-comment" || options.mode === "generated-pr") && !options.pr) {
    return { status: "invalid", reason: "pr_required" };
  }

  const lines = [
    rollbackMarker,
    "## Correction",
    "",
    "This action supersedes earlier aster output.",
    "",
    `- Mode: \`${options.mode}\``,
    `- Reason: ${options.reason}`,
  ];
  if (options.commentId) {
    lines.push(`- Superseded comment id: \`${options.commentId}\``);
  }
  if (options.replacementBody) {
    lines.push("", "### Corrected guidance", "", options.replacementBody.trim());
  }

  return {
    status: "ready",
    body: `${lines.join("\n")}\n`,
  };
}

function parseArgs(argv) {
  const options = {};
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
    if (token === "--comment-id") {
      options.commentId = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--reason") {
      options.reason = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--replacement-body") {
      options.replacementBody = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--force") {
      options.force = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!["issue-comment", "pr-comment", "generated-pr"].includes(options.mode)) {
    throw new Error("--mode must be `issue-comment`, `pr-comment`, or `generated-pr`.");
  }
  if (!options.repo || !options.reason) {
    throw new Error("--repo and --reason are required.");
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
  await rollbackRun();
}
