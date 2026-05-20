import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const issue = JSON.parse(await readFile(path.resolve(options.input), "utf8"));
  const prepared = prepareWorkIssueRequest(issue, {
    lane: options.lane,
  });

  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(prepared, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`);
}

export function prepareWorkIssueRequest(issue = {}, options = {}) {
  const sourceIssue = issue?.issue && typeof issue.issue === "object" ? issue.issue : issue;
  const amendments = Array.isArray(issue?.amendments)
    ? issue.amendments
    : Array.isArray(issue?.trusted_human_comments)
      ? issue.trusted_human_comments
      : [];
  const rawTitle = normalizeString(sourceIssue.title) ?? "Untitled work thread";
  const rawBody = normalizeString(sourceIssue.body) ?? "";
  const sections = extractNamedSections(rawBody);
  const sourceRepo = normalizeString(issue?.repo) ?? normalizeString(options.defaultSourceRepo) ?? null;
  const requestTitle = firstNonEmpty(
    normalizeString(sections.objective),
    stripWorkPrefix(rawTitle),
    rawTitle,
  );
  const targetRepo = firstNonEmpty(
    normalizeString(sections.target_repo),
    normalizeString(options.defaultTargetRepo),
  );
  const requestBodyParts = [
    "Source Issue",
    formatBulletList([
      `title: ${rawTitle}`,
      sourceRepo ? `repo: ${sourceRepo}` : null,
      sourceIssue.url ? `url: ${sourceIssue.url}` : null,
      normalizeString(issue?.ledger_revision) ? `ledger revision: ${normalizeString(issue.ledger_revision)}` : null,
      options.lane ? `lane: ${options.lane}` : null,
    ]),
    sections.acceptance ? `Acceptance Criteria\n${sections.acceptance}` : null,
    sections.context ? `Context\n${sections.context}` : null,
    sections.safety ? `Safety Constraints\n${sections.safety}` : null,
    sections.evidence ? `Evidence\n${sections.evidence}` : null,
    amendments.length > 0 ? `Maintainer Amendments\n${formatAmendments(amendments)}` : null,
    sections.notes ? `Additional Notes\n${sections.notes}` : null,
  ].filter(Boolean);

  return {
    source_issue: {
      repo: sourceRepo,
      number: sourceIssue.number ?? null,
      title: rawTitle,
      url: normalizeString(sourceIssue.url) ?? null,
      ledger_revision: normalizeString(issue?.ledger_revision) ?? null,
    },
    lane: normalizeString(options.lane) ?? null,
    request_title: requestTitle,
    request_body: requestBodyParts.join("\n\n"),
    target_repo: targetRepo,
    target_ref: normalizeString(sections.target_ref) ?? normalizeString(options.defaultTargetRef) ?? "main",
    workflow: normalizeString(sections.workflow) ?? normalizeString(options.defaultWorkflow) ?? "operator-bringup",
    mode: normalizeIssueMode(sections.mode) ?? "requested",
    candidate_path: normalizeString(sections.candidate_path) ?? "SKILL.md",
    force: normalizeBoolean(sections.force) ?? false,
    sections: {
      objective: normalizeString(sections.objective) ?? requestTitle,
      target_repo: targetRepo,
      target_ref: normalizeString(sections.target_ref) ?? null,
      workflow: normalizeString(sections.workflow) ?? null,
      mode: normalizeIssueMode(sections.mode) ?? null,
      candidate_path: normalizeString(sections.candidate_path) ?? null,
      force: normalizeBoolean(sections.force),
      acceptance: normalizeString(sections.acceptance) ?? null,
      context: normalizeString(sections.context) ?? null,
      safety: normalizeString(sections.safety) ?? null,
      evidence: normalizeString(sections.evidence) ?? null,
      additional_notes: normalizeString(sections.notes) ?? null,
    },
  };
}

function extractNamedSections(body) {
  const sectionMap = {
    objective: "",
    target_repo: "",
    target_ref: "",
    workflow: "",
    mode: "",
    candidate_path: "",
    force: "",
    acceptance: "",
    context: "",
    safety: "",
    evidence: "",
  };
  const notes = [];
  let activeKey = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const heading = matchHeading(line);
    if (heading) {
      const key = normalizeSectionName(heading.label);
      if (key && key in sectionMap) {
        activeKey = key;
        if (heading.inlineValue) {
          appendLine(sectionMap, key, heading.inlineValue);
        }
        continue;
      }
      activeKey = null;
    }

    if (activeKey) {
      appendLine(sectionMap, activeKey, line);
      continue;
    }

    if (line.trim().length > 0) {
      notes.push(line);
    }
  }

  return {
    ...Object.fromEntries(
      Object.entries(sectionMap).map(([key, value]) => [key, normalizeBlock(value)]),
    ),
    notes: normalizeBlock(notes.join("\n")),
  };
}

function matchHeading(line) {
  const markdownMatch = line.match(/^#{1,6}\s+(.+?)\s*$/);
  if (markdownMatch) {
    return { label: markdownMatch[1], inlineValue: "" };
  }
  const labelOnlyMatch = line.match(/^([A-Za-z][A-Za-z0-9 /_-]{1,60}):\s*$/);
  if (labelOnlyMatch) {
    return { label: labelOnlyMatch[1], inlineValue: "" };
  }
  const inlineMatch = line.match(/^([A-Za-z][A-Za-z0-9 /_-]{1,60}):\s+(.+)$/);
  if (inlineMatch) {
    return { label: inlineMatch[1], inlineValue: inlineMatch[2] };
  }
  return null;
}

function normalizeSectionName(value) {
  const normalized = normalizeString(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  switch (normalized) {
    case "objective":
      return "objective";
    case "target repo":
    case "repo":
      return "target_repo";
    case "target ref":
    case "ref":
      return "target_ref";
    case "workflow":
      return "workflow";
    case "mode":
      return "mode";
    case "candidate path":
    case "path":
      return "candidate_path";
    case "force":
      return "force";
    case "acceptance":
    case "acceptance criteria":
      return "acceptance";
    case "context":
      return "context";
    case "safety":
    case "safety constraints":
    case "constraints":
      return "safety";
    case "evidence":
      return "evidence";
    default:
      return null;
  }
}

function appendLine(target, key, line) {
  target[key] = target[key].length > 0 ? `${target[key]}\n${line}` : line;
}

function formatBulletList(items) {
  return items
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join("\n");
}

function formatAmendments(amendments) {
  return amendments
    .map((amendment) => {
      const summary = amendment.thread_teaching_record
        ? `structured teaching: ${amendment.thread_teaching_record.kind} — ${amendment.thread_teaching_record.summary}`
        : normalizeString(amendment.body);
      if (!summary) {
        return null;
      }
      const header = [
        normalizeString(amendment.author) ?? "unknown",
        firstNonEmpty(amendment.updated_at, amendment.created_at),
        normalizeString(amendment.url),
      ].filter(Boolean).join(" | ");
      return [`- ${header}`, `  ${summary}`].join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeIssueMode(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  return ["requested", "auto"].includes(normalized) ? normalized : null;
}

function normalizeBoolean(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["true", "yes", "y", "1"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "n", "0"].includes(normalized)) {
    return false;
  }
  return null;
}

function stripWorkPrefix(value) {
  const trimmed = normalizeString(value);
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/^\[(issue-to-pr|improvement|docs|fix|upstream|skill)\]\s*/i, "").trim();
}

function normalizeBlock(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      options.input = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--lane") {
      options.lane = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--default-target-repo") {
      options.defaultTargetRepo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--default-target-ref") {
      options.defaultTargetRef = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--default-workflow") {
      options.defaultWorkflow = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--default-source-repo") {
      options.defaultSourceRepo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.input) {
    throw new Error("--input is required.");
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
