import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export const APPROVAL_CONTEXT_MARKER = "<!-- aster:approval-context -->";

const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const entries = options.mode === "issue"
    ? loadIssueThreadEntries(options)
    : loadPullRequestThreadEntries(options);
  const approvalContext = deriveApprovalContext(entries, {
    objectiveFingerprint: options.objectiveFingerprint,
    appliesTo: options.appliesTo,
    now: options.now,
  });
  const output = approvalContext ?? {};
  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

export function deriveApprovalContext(entries = [], criteria = {}) {
  const rankedEntries = [...entries]
    .map(normalizeThreadEntry)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.created_at ?? "") - Date.parse(left.created_at ?? ""));

  for (const entry of rankedEntries) {
    if (!TRUSTED_ASSOCIATIONS.has(String(entry.author_association ?? "").toUpperCase())) {
      continue;
    }
    const parsed = parseApprovalContextBody(entry.body);
    if (!parsed || !approvalContextMatchesCriteria(parsed, criteria)) {
      continue;
    }
    return {
      source: entry.source_type,
      source_url: entry.url ?? null,
      rationale: parsed.rationale,
      approved_by: parsed.approved_by ?? entry.author ?? null,
      operator_notes: parsed.operator_notes,
      shared_invariants: parsed.shared_invariants,
      applies_to: parsed.applies_to,
      objective_fingerprint: parsed.objective_fingerprint,
      expires_after: parsed.expires_after,
      matched_from: {
        author: entry.author ?? null,
        author_association: entry.author_association ?? null,
        created_at: entry.created_at ?? null,
      },
    };
  }
  return null;
}

export function parseApprovalContextBody(body) {
  if (typeof body !== "string") {
    return null;
  }
  const markerIndex = body.indexOf(APPROVAL_CONTEXT_MARKER);
  if (markerIndex === -1) {
    return null;
  }
  const rawContent = body.slice(markerIndex + APPROVAL_CONTEXT_MARKER.length);
  const lines = rawContent.split(/\r?\n/);
  let rationale = null;
  let approvedBy = null;
  let objectiveFingerprint = null;
  let expiresAfter = null;
  let currentSection = null;
  const operatorNotes = [];
  const sharedInvariants = [];
  const appliesTo = [];
  const rationaleBuffer = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      continue;
    }
    const rationaleMatch = line.match(/^rationale:\s*(.+)$/i);
    if (rationaleMatch) {
      rationale = rationaleMatch[1].trim();
      currentSection = null;
      continue;
    }
    const approvedByMatch = line.match(/^approved by:\s*(.+)$/i);
    if (approvedByMatch) {
      approvedBy = approvedByMatch[1].trim();
      currentSection = null;
      continue;
    }
    const objectiveFingerprintMatch = line.match(/^objective fingerprint:\s*(.+)$/i);
    if (objectiveFingerprintMatch) {
      objectiveFingerprint = objectiveFingerprintMatch[1].trim();
      currentSection = null;
      continue;
    }
    const expiresAfterMatch = line.match(/^expires after:\s*(.+)$/i);
    if (expiresAfterMatch) {
      expiresAfter = expiresAfterMatch[1].trim();
      currentSection = null;
      continue;
    }
    const invariantMatch = line.match(/^invariant:\s*(.+)$/i);
    if (invariantMatch) {
      sharedInvariants.push(invariantMatch[1].trim());
      currentSection = null;
      continue;
    }
    const appliesToMatch = line.match(/^applies(?:\s|-)?to:\s*(.*)$/i);
    if (appliesToMatch) {
      if (appliesToMatch[1].trim()) {
        appliesTo.push(...splitCsvList(appliesToMatch[1]));
        currentSection = null;
      } else {
        currentSection = "applies_to";
      }
      continue;
    }
    const noteMatch = line.match(/^note:\s*(.+)$/i);
    if (noteMatch) {
      operatorNotes.push(noteMatch[1].trim());
      currentSection = null;
      continue;
    }
    if (/^invariants:\s*$/i.test(line)) {
      currentSection = "invariants";
      continue;
    }
    if (/^notes:\s*$/i.test(line)) {
      currentSection = "notes";
      continue;
    }
    if (/^gates:\s*$/i.test(line)) {
      currentSection = "applies_to";
      continue;
    }
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch && currentSection === "invariants") {
      sharedInvariants.push(bulletMatch[1].trim());
      continue;
    }
    if (bulletMatch && currentSection === "applies_to") {
      appliesTo.push(...splitCsvList(bulletMatch[1]));
      continue;
    }
    if (bulletMatch && currentSection === "notes") {
      operatorNotes.push(bulletMatch[1].trim());
      continue;
    }
    if (!rationale) {
      rationaleBuffer.push(line);
    }
  }

  if (!rationale && rationaleBuffer.length > 0) {
    rationale = rationaleBuffer.join(" ");
  }

  const normalizedNotes = uniqueStrings(operatorNotes);
  const normalizedInvariants = uniqueStrings(sharedInvariants);
  const normalizedAppliesTo = uniqueStrings(appliesTo);
  if (
    !rationale
    && !approvedBy
    && !normalizeString(objectiveFingerprint)
    && !normalizeString(expiresAfter)
    && normalizedNotes.length === 0
    && normalizedInvariants.length === 0
    && normalizedAppliesTo.length === 0
  ) {
    return null;
  }
  return {
    rationale,
    approved_by: approvedBy,
    operator_notes: normalizedNotes,
    shared_invariants: normalizedInvariants,
    applies_to: normalizedAppliesTo,
    objective_fingerprint: normalizeString(objectiveFingerprint),
    expires_after: normalizeString(expiresAfter),
  };
}

export function approvalContextMatchesCriteria(context, criteria = {}) {
  if (!context || typeof context !== "object") {
    return false;
  }
  if (isExpiredApprovalContext(context, criteria.now)) {
    return false;
  }
  const expectedObjectiveFingerprint = normalizeString(criteria.objectiveFingerprint);
  if (expectedObjectiveFingerprint && normalizeString(context.objective_fingerprint)) {
    if (context.objective_fingerprint !== expectedObjectiveFingerprint) {
      return false;
    }
  }
  const requiredAppliesTo = uniqueStrings(criteria.appliesTo);
  const declaredAppliesTo = uniqueStrings(context.applies_to);
  if (requiredAppliesTo.length > 0 && declaredAppliesTo.length > 0) {
    const hasOverlap = declaredAppliesTo.some((declared) =>
      requiredAppliesTo.some((required) =>
        gatePatternMatches(declared, required) || gatePatternMatches(required, declared)
      )
    );
    if (!hasOverlap) {
      return false;
    }
  }
  return true;
}

export function loadIssueThreadEntries(options) {
  const issue = readGithubJson([
    "api",
    `repos/${options.repo}/issues/${options.issue}`,
  ]);
  const comments = readGithubPaginatedJson([
    `repos/${options.repo}/issues/${options.issue}/comments?per_page=100`,
  ]);
  return [
    {
      source_type: "issue_body",
      author: issue.user?.login,
      author_association: issue.author_association,
      body: issue.body,
      url: issue.html_url,
      created_at: issue.created_at,
    },
    ...comments.map((comment) => ({
      source_type: "issue_comment",
      author: comment.user?.login,
      author_association: comment.author_association,
      body: comment.body,
      url: comment.html_url,
      created_at: comment.created_at,
    })),
  ];
}

export function loadPullRequestThreadEntries(options) {
  const prIssue = readGithubJson([
    "api",
    `repos/${options.repo}/issues/${options.pr}`,
  ]);
  const issueComments = readGithubPaginatedJson([
    `repos/${options.repo}/issues/${options.pr}/comments?per_page=100`,
  ]);
  const reviews = readGithubPaginatedJson([
    `repos/${options.repo}/pulls/${options.pr}/reviews?per_page=100`,
  ]);
  const reviewComments = readGithubPaginatedJson([
    `repos/${options.repo}/pulls/${options.pr}/comments?per_page=100`,
  ]);
  return [
    {
      source_type: "pull_request_body",
      author: prIssue.user?.login,
      author_association: prIssue.author_association,
      body: prIssue.body,
      url: prIssue.html_url,
      created_at: prIssue.created_at,
    },
    ...issueComments.map((comment) => ({
      source_type: "issue_comment",
      author: comment.user?.login,
      author_association: comment.author_association,
      body: comment.body,
      url: comment.html_url,
      created_at: comment.created_at,
    })),
    ...reviews.map((review) => ({
      source_type: "pull_request_review",
      author: review.user?.login,
      author_association: review.author_association,
      body: review.body,
      url: review.html_url,
      created_at: review.submitted_at ?? review.submittedAt ?? review.created_at,
    })),
    ...reviewComments.map((comment) => ({
      source_type: "pull_request_review_comment",
      author: comment.user?.login,
      author_association: comment.author_association,
      body: comment.body,
      url: comment.html_url,
      created_at: comment.created_at,
    })),
  ];
}

function normalizeThreadEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  return {
    source_type: normalizeString(entry.source_type),
    author: normalizeString(entry.author),
    author_association: normalizeString(entry.author_association),
    body: typeof entry.body === "string" ? entry.body : "",
    url: normalizeString(entry.url),
    created_at: normalizeString(entry.created_at),
  };
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

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function splitCsvList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isExpiredApprovalContext(context, now) {
  const expiresAfter = normalizeString(context?.expires_after);
  if (!expiresAfter) {
    return false;
  }
  const expiresAtMs = Date.parse(expiresAfter);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  const nowMs = now ? Date.parse(now) : Date.now();
  if (!Number.isFinite(nowMs)) {
    return false;
  }
  return nowMs > expiresAtMs;
}

function gatePatternMatches(pattern, candidate) {
  const normalizedPattern = normalizeString(pattern);
  const normalizedCandidate = normalizeString(candidate);
  if (!normalizedPattern || !normalizedCandidate) {
    return false;
  }
  if (normalizedPattern === normalizedCandidate) {
    return true;
  }
  const escaped = normalizedPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(normalizedCandidate);
}

function parseArgs(argv) {
  const options = {
    appliesTo: [],
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
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--objective-fingerprint") {
      options.objectiveFingerprint = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--applies-to") {
      options.appliesTo.push(requireValue(argv, ++index, token));
      continue;
    }
    if (token === "--now") {
      options.now = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.mode || !["issue", "pr"].includes(options.mode)) {
    throw new Error("--mode must be `issue` or `pr`.");
  }
  if (!options.repo) {
    throw new Error("--repo is required.");
  }
  if (options.mode === "issue" && !options.issue) {
    throw new Error("--issue is required for issue mode.");
  }
  if (options.mode === "pr" && !options.pr) {
    throw new Error("--pr is required for pr mode.");
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
