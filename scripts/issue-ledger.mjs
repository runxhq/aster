import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { parseThreadTeachingRecordBody, TRUSTED_ASSOCIATIONS } from "./thread-teaching.mjs";

const DEFAULT_MAX_AMENDMENTS = 12;
const MACHINE_STATUS_MARKERS = [
  "<!-- aster:runx-skill-lab -->",
  "<!-- aster:runx-issue-triage -->",
  "<!-- aster:runx-work-lane:",
];
const MACHINE_STATUS_PATTERNS = [
  /^Opened draft PR for this run:\s+https:\/\/github\.com\//i,
];

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const packet = buildIssueLedgerPacket({
    repo: options.repo,
    issue: loadIssue(options),
    comments: loadIssueComments(options),
    maxAmendments: options.maxAmendments,
  });

  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(packet, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
}

export function buildIssueLedgerPacket({ repo, issue, comments = [], maxAmendments = DEFAULT_MAX_AMENDMENTS }) {
  const normalizedIssue = normalizeIssue(issue);
  const normalizedComments = comments.map(normalizeIssueComment).filter(Boolean);
  const substantiveComments = normalizedComments.filter((comment) => comment.is_machine_status_comment !== true);
  const machineStatusComments = normalizedComments.filter((comment) => comment.is_machine_status_comment === true);
  const trustedHumanComments = substantiveComments.filter(
    (comment) => isTrustedHumanComment(comment) && comment.is_machine_status_comment !== true,
  );
  const amendmentLimit = Math.max(1, Number(maxAmendments ?? DEFAULT_MAX_AMENDMENTS));
  const amendments = trustedHumanComments.slice(-amendmentLimit);
  const omittedCount = Math.max(0, trustedHumanComments.length - amendments.length);
  const ledgerRevision = computeIssueLedgerRevision({
    issue: normalizedIssue,
    comments: trustedHumanComments,
  });

  return {
    kind: "runx.aster-issue-ledger.v2",
    generated_at: new Date().toISOString(),
    repo,
    issue: normalizedIssue,
    comments: substantiveComments,
    machine_status_comments: machineStatusComments,
    comment_summary: {
      total_count: normalizedComments.length,
      substantive_count: substantiveComments.length,
      machine_status_count: machineStatusComments.length,
      latest_machine_status_comment_at: firstNonEmpty(
        machineStatusComments.at(-1)?.updated_at,
        machineStatusComments.at(-1)?.created_at,
      ) ?? null,
      latest_machine_status_comment_url: machineStatusComments.at(-1)?.url ?? null,
    },
    trusted_human_comments: trustedHumanComments,
    amendments,
    amendment_summary: {
      trusted_human_comment_count: trustedHumanComments.length,
      included_count: amendments.length,
      omitted_count: omittedCount,
      latest_trusted_human_comment_at: firstNonEmpty(
        trustedHumanComments.at(-1)?.updated_at,
        trustedHumanComments.at(-1)?.created_at,
      ) ?? null,
      latest_trusted_human_comment_url: trustedHumanComments.at(-1)?.url ?? null,
    },
    ledger_revision: ledgerRevision,
    ledger_body: renderIssueLedgerBody({
      issue: normalizedIssue,
      amendments,
      omittedCount,
    }),
  };
}

export function renderIssueLedgerBody({ issue, amendments = [], omittedCount = 0 }) {
  const lines = [
    "# Issue Ledger",
    "",
    `- title: ${issue.title ?? "Untitled issue"}`,
    issue.url ? `- url: ${issue.url}` : null,
    "",
    "## Original Request",
    "",
    normalizeBlock(issue.body) ?? "_No issue body supplied._",
  ].filter(Boolean);

  if (amendments.length > 0) {
    lines.push("", "## Maintainer Amendments", "");
    if (omittedCount > 0) {
      lines.push(`- Older trusted amendments omitted from this prompt body: ${omittedCount}`);
      lines.push("");
    }
    for (const [index, amendment] of amendments.entries()) {
      lines.push(`### Amendment ${index + 1}`);
      lines.push("");
      lines.push(`- author: ${amendment.author ?? "unknown"}`);
      lines.push(`- recorded_at: ${firstNonEmpty(amendment.updated_at, amendment.created_at) ?? "unknown"}`);
      if (amendment.url) {
        lines.push(`- url: ${amendment.url}`);
      }
      if (amendment.thread_teaching_record) {
        lines.push(`- structured_teaching: ${amendment.thread_teaching_record.kind} — ${amendment.thread_teaching_record.summary}`);
        if ((amendment.thread_teaching_record.applies_to ?? []).length > 0) {
          lines.push(`- applies_to: ${(amendment.thread_teaching_record.applies_to ?? []).join(", ")}`);
        }
      }
      lines.push("");
      lines.push(renderAmendmentBody(amendment));
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

export function computeIssueLedgerRevision({ issue, comments = [] }) {
  const hash = createHash("sha256");
  hash.update(String(issue?.title ?? "").trim());
  hash.update("\n---\n");
  hash.update(String(issue?.body ?? "").trim());
  for (const comment of comments) {
    hash.update("\n===\n");
    hash.update(String(comment.id ?? ""));
    hash.update("\n");
    hash.update(String(comment.author ?? ""));
    hash.update("\n");
    hash.update(String(comment.created_at ?? ""));
    hash.update("\n");
    hash.update(String(comment.updated_at ?? ""));
    hash.update("\n");
    hash.update(String(comment.body ?? "").trim());
  }
  return hash.digest("hex").slice(0, 16);
}

export function isTrustedHumanComment(comment) {
  if (!comment || typeof comment !== "object") {
    return false;
  }
  if (comment.is_bot === true) {
    return false;
  }
  return TRUSTED_ASSOCIATIONS.has(String(comment.author_association ?? "").toUpperCase());
}

export function isMachineStatusComment(comment) {
  const body = String(comment?.body ?? "").trim();
  if (body.length === 0) {
    return false;
  }
  if (MACHINE_STATUS_MARKERS.some((marker) => body.includes(marker))) {
    return true;
  }
  return MACHINE_STATUS_PATTERNS.some((pattern) => pattern.test(body));
}

function renderAmendmentBody(comment) {
  if (comment.thread_teaching_record) {
    const decisions = (comment.thread_teaching_record.decisions ?? [])
      .map((decision) => `${decision.gate_id}=${decision.decision}`)
      .join(", ");
    if (decisions.length > 0) {
      return `Structured teaching record captured separately in active thread-teaching context.\nDecisions: ${decisions}`;
    }
    return "Structured teaching record captured separately in active thread-teaching context.";
  }
  return trimBlock(comment.body, 1400);
}

function normalizeIssue(issue) {
  return {
    number: Number(issue?.number ?? 0),
    title: firstNonEmpty(issue?.title, "Untitled issue"),
    body: typeof issue?.body === "string" ? issue.body : "",
    url: firstNonEmpty(issue?.html_url, issue?.url) ?? null,
    author: firstNonEmpty(issue?.user?.login, issue?.author?.login) ?? null,
    author_association: firstNonEmpty(issue?.author_association, issue?.authorAssociation) ?? null,
    state: firstNonEmpty(issue?.state) ?? null,
    created_at: firstNonEmpty(issue?.created_at, issue?.createdAt) ?? null,
    updated_at: firstNonEmpty(issue?.updated_at, issue?.updatedAt) ?? null,
  };
}

function normalizeIssueComment(comment) {
  if (!comment || typeof comment !== "object") {
    return null;
  }
  const body = typeof comment.body === "string" ? comment.body : "";
  const parsedThreadTeachingRecord = parseThreadTeachingRecordBody(body);
  return {
    id: firstNonEmpty(comment.id, comment.databaseId) ?? null,
    author: firstNonEmpty(comment.user?.login, comment.author?.login) ?? null,
    user_type: firstNonEmpty(comment.user?.type, comment.author?.type) ?? null,
    author_association: firstNonEmpty(comment.author_association, comment.authorAssociation) ?? null,
    body,
    url: firstNonEmpty(comment.html_url, comment.url) ?? null,
    created_at: firstNonEmpty(comment.created_at, comment.createdAt) ?? null,
    updated_at: firstNonEmpty(comment.updated_at, comment.updatedAt) ?? null,
    is_bot: isBotAuthor(comment),
    is_machine_status_comment: isMachineStatusComment(comment),
    is_thread_teaching_record: Boolean(parsedThreadTeachingRecord),
    thread_teaching_record: parsedThreadTeachingRecord,
  };
}

function isBotAuthor(comment) {
  const userType = String(comment?.user?.type ?? comment?.author?.type ?? "").toLowerCase();
  if (userType === "bot") {
    return true;
  }
  const login = String(comment?.user?.login ?? comment?.author?.login ?? "").toLowerCase();
  return login.endsWith("[bot]");
}

function trimBlock(value, maxLength) {
  const normalized = normalizeBlock(value);
  if (!normalized) {
    return "_No comment body supplied._";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeBlock(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function loadIssue(options) {
  return readGithubJson([
    "api",
    `repos/${options.repo}/issues/${options.issue}`,
  ]);
}

function loadIssueComments(options) {
  return readGithubPaginatedJson([
    `repos/${options.repo}/issues/${options.issue}/comments?per_page=100`,
  ]);
}

function readGithubJson(args) {
  return JSON.parse(
    execFileSync("gh", args, {
      encoding: "utf8",
    }),
  );
}

function readGithubPaginatedJson(args) {
  const pages = JSON.parse(
    execFileSync("gh", ["api", "--paginate", "--slurp", ...args], {
      encoding: "utf8",
    }),
  );
  if (!Array.isArray(pages)) {
    return [];
  }
  return pages.flatMap((page) => Array.isArray(page) ? page : [page]);
}

function parseArgs(argv) {
  const options = {
    maxAmendments: DEFAULT_MAX_AMENDMENTS,
  };
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
    if (token === "--max-amendments") {
      options.maxAmendments = Number(requireValue(argv, ++index, token));
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.repo || !options.issue) {
    throw new Error("--repo and --issue are required.");
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

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
