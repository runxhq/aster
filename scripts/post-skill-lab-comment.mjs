import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

export const SKILL_LAB_MARKER = "<!-- aster:runx-skill-lab -->";

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const publish = await readOptionalJson(options.publishJson);
  const result = await readOptionalJson(options.resultJson);
  const quality = await readOptionalJson(options.qualityJson);
  const commentBody = buildSkillLabComment({
    objective: options.objective,
    runUrl: options.runUrl,
    publish,
    result,
    quality,
    ledgerRevision: options.ledgerRevision,
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
  const existing = (issue.comments ?? []).find(
    (comment) => typeof comment.body === "string" && comment.body.includes(SKILL_LAB_MARKER),
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

export function buildSkillLabComment({ objective, runUrl, publish, result, quality, ledgerRevision, workflowStatus }) {
  const proposal = extractSkillProposalSummary(result);
  const lines = [
    SKILL_LAB_MARKER,
    "## runx skill lab",
    "",
    `- Objective: \`${String(objective ?? "Untitled skill proposal").trim()}\``,
    `- Status: \`${resolveSkillLabStatus({ publish, quality, workflowStatus })}\``,
  ];

  if (proposal?.name) {
    const proposalMeta = [
      proposal.kind ? `kind=\`${proposal.kind}\`` : null,
      proposal.status ? `status=\`${proposal.status}\`` : null,
    ].filter(Boolean);
    lines.push(`- Proposal: \`${proposal.name}\`${proposalMeta.length > 0 ? ` (${proposalMeta.join(", ")})` : ""}`);
  }
  if (proposal?.summary) {
    lines.push(`- Summary: ${proposal.summary}`);
  }
  if (publish?.status === "published") {
    lines.push(`- Draft PR: [#${publish.pr_number}](${publish.pr_url})`);
  }
  if (ledgerRevision) {
    lines.push(`- Ledger revision: \`${ledgerRevision}\``);
  }
  if (quality?.status) {
    const score = typeof quality.score === "number" ? ` score=\`${quality.score}\`` : "";
    lines.push(`- Proposal quality: \`${quality.status}\`${score}`);
  }
  if (runUrl) {
    lines.push(`- Workflow run: ${runUrl}`);
  }

  const refreshLines = buildRefreshSummary({ publish, proposal, quality, workflowStatus });
  if (refreshLines.length > 0) {
    lines.push("", "## Changed in this refresh", "", ...refreshLines);
  }

  lines.push(
    "",
    "Reply in this work issue with maintainer amendments, constraints, or teaching notes and skill-lab will refresh the same proposal from the same work ledger.",
  );

  return `${lines.join("\n").trim()}\n`;
}

function resolveSkillLabStatus({ publish, quality, workflowStatus }) {
  if (workflowStatus && workflowStatus !== "success") {
    return "run_failed";
  }
  if (quality?.status === "needs_review") {
    return "proposal_quality_needs_review";
  }
  if (!publish || typeof publish !== "object") {
    return "proposal_refreshed";
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
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw);
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
    if (token === "--objective") {
      options.objective = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--run-url") {
      options.runUrl = requireValue(argv, ++index, token);
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
    if (token === "--quality-json") {
      options.qualityJson = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--ledger-revision") {
      options.ledgerRevision = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--workflow-status") {
      options.workflowStatus = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.repo || !options.issue || !options.objective) {
    throw new Error("--repo, --issue, and --objective are required.");
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

function extractSkillProposalSummary(result) {
  const payload = extractSkillProposalPayload(result);
  if (!payload) {
    return null;
  }

  const skillSpec = isRecord(payload.skill_spec) ? payload.skill_spec : {};
  const acceptanceChecks = Array.isArray(payload.acceptance_checks) ? payload.acceptance_checks : [];

  return {
    name: firstNonEmptyString(skillSpec.name, skillSpec.skill_name),
    kind: firstNonEmptyString(skillSpec.kind),
    status: firstNonEmptyString(skillSpec.status),
    summary: firstNonEmptyString(skillSpec.summary, skillSpec.description, skillSpec.objective),
    acceptanceCheckCount: acceptanceChecks.length,
  };
}

function buildRefreshSummary({ publish, proposal, quality, workflowStatus }) {
  if (workflowStatus && workflowStatus !== "success") {
    return ["- The run failed before proposal refresh completed."];
  }

  const lines = [];
  if (proposal?.summary) {
    lines.push("- Surfaced the substantive proposal payload from the latest design run instead of a slug-only status stub.");
  }
  if (proposal?.acceptanceCheckCount) {
    lines.push(`- Acceptance checks surfaced: \`${proposal.acceptanceCheckCount}\`.`);
  }
  if (quality?.status === "pass") {
    lines.push("- Proposal quality passed the human-grade first-party, catalog-worthiness, implementation, and provenance checks.");
  }
  if (quality?.status === "needs_review") {
    lines.push("- Proposal quality still needs review before this reads like a first-party runx skill proposal.");
    const findings = Array.isArray(quality.findings) ? quality.findings.slice(0, 3) : [];
    for (const finding of findings) {
      const summary = firstNonEmptyString(finding?.summary, finding?.message);
      if (summary) {
        lines.push(`- Quality gap: ${summary}`);
      }
    }
  }
  if (quality?.status === "needs_review") {
    lines.push("- Draft PR publication stays blocked until the proposal quality gaps are resolved, even if `skill-lab.publish` is authorized.");
  } else if (!publish || publish.status === "missing" || publish.status === "not_requested") {
    lines.push("- Publication remains gated until a trusted reply on this work issue authorizes `skill-lab.publish` with `Applies To:` + `Decision:` lines or a full thread-teaching record.");
  }
  return lines;
}

function extractSkillProposalPayload(result) {
  if (!isRecord(result)) {
    return null;
  }
  if (looksLikeSkillProposalPayload(result)) {
    return result;
  }
  const stdout = firstNonEmptyString(result.execution?.stdout);
  const parsed = tryParseJson(stdout);
  return looksLikeSkillProposalPayload(parsed) ? parsed : null;
}

function looksLikeSkillProposalPayload(value) {
  return Boolean(
    isRecord(value)
    && (
      value.skill_spec
      || value.execution_plan
      || value.harness_fixture
      || value.acceptance_checks
    ),
  );
}

function tryParseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
