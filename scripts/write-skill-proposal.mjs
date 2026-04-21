import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await materializeSkillProposal(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function materializeSkillProposal(options) {
  const report = JSON.parse(await readFile(options.input, "utf8"));
  const payload = JSON.parse(report.execution.stdout);
  const issuePacket = options.issuePacket
    ? JSON.parse(await readFile(path.resolve(options.issuePacket), "utf8"))
    : null;
  const skillName = payload.skill_spec?.name ?? slugify(options.title);
  const slug = slugify(skillName);
  const outputDir = path.resolve(options.outputDir ?? "docs/skill-proposals");
  const markdownPath = path.join(outputDir, `${slug}.md`);
  const jsonPath = path.join(outputDir, `${slug}.json`);

  await mkdir(outputDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(
    markdownPath,
    `${buildSkillProposalMarkdown({
      payload,
      title: options.title,
      issueUrl: issuePacket?.source_issue?.url ?? options.issueUrl,
      issuePacket,
      jsonPath,
    })}\n`,
  );

  return {
    status: "written",
    markdown_path: markdownPath,
    json_path: jsonPath,
  };
}

export function buildSkillProposalMarkdown({ payload, title, issueUrl, issuePacket, jsonPath }) {
  const proposalTitle = payload.skill_spec?.name ?? title;
  const proposalDescription =
    payload.skill_spec?.description
    ?? payload.skill_spec?.summary
    ?? "Generated skill proposal.";
  const acceptanceChecks = formatAcceptanceChecks(payload.acceptance_checks);
  const effectiveObjective =
    firstNonEmptyString(payload.skill_spec?.objective, payload.skill_spec?.summary, title)
    ?? "Generated skill proposal objective not supplied.";

  const sourceSections = issuePacket?.sections ?? {};
  const maintainerAmendments = Array.isArray(issuePacket?.amendments) ? issuePacket.amendments : [];
  const workIssueRepo = firstNonEmptyString(issuePacket?.source_issue?.repo);
  const workIssueNumber = normalizeWorkIssueNumber(issuePacket?.source_issue?.number);
  const workIssueRef = workIssueRepo && workIssueNumber
    ? `${workIssueRepo}#${workIssueNumber}`
    : null;
  const ledgerRevision = firstNonEmptyString(issuePacket?.source_issue?.ledger_revision);
  const lines = [
    "---",
    `title: ${yamlString(proposalTitle)}`,
    `description: ${yamlString(proposalDescription)}`,
    "---",
    "",
    `# ${proposalTitle}`,
    "",
    "## Work Ledger",
    "",
    workIssueRef ? `- Work issue: \`${workIssueRef}\`` : null,
    `- Work issue URL: ${issueUrl ?? "n/a"}`,
    ledgerRevision ? `- Ledger revision: \`${ledgerRevision}\`` : null,
    "- Maintainer amendments stay on the same work issue thread.",
    "- Draft PR refresh requires `skill-lab.publish` authorization on the same work issue.",
    "",
  ];

  if (maintainerAmendments.length > 0) {
    lines.push(
      "## Maintainer Amendments",
      "",
      "Later maintainer amendments on the living ledger take precedence over stale original wording when they conflict.",
      "",
      ...formatMaintainerAmendments(maintainerAmendments),
      "",
    );
  }

  lines.push(
    "## Objective",
    "",
    effectiveObjective,
    "",
  );

  if (
    sourceSections.objective &&
    normalizeComparableText(sourceSections.objective) !== normalizeComparableText(effectiveObjective)
  ) {
    lines.push("## Original Request", "", sourceSections.objective, "");
  }

  if (sourceSections.why_it_matters) {
    lines.push("## Why It Matters", "", sourceSections.why_it_matters, "");
  }
  if (sourceSections.constraints) {
    lines.push("## Constraints", "", sourceSections.constraints, "");
  }
  if (sourceSections.evidence) {
    lines.push("## Evidence", "", sourceSections.evidence, "");
  }
  if (sourceSections.additional_notes) {
    lines.push("## Additional Notes", "", sourceSections.additional_notes, "");
  }

  lines.push(
    "## Skill Contract",
    "",
    `- name: \`${payload.skill_spec?.name ?? "unknown"}\``,
    `- description: ${payload.skill_spec?.description ?? payload.skill_spec?.summary ?? "n/a"}`,
    "",
    "## Execution Plan",
    "",
    "```json",
    JSON.stringify(payload.execution_plan ?? {}, null, 2),
    "```",
    "",
    "## Harness Fixtures",
    "",
    "```json",
    JSON.stringify(payload.harness_fixture ?? [], null, 2),
    "```",
    "",
    "## Acceptance Checks",
    "",
    ...acceptanceChecks,
    "",
    "## Raw Packet",
    "",
    `See [${path.basename(jsonPath)}](./${path.basename(jsonPath)}).`,
    "",
  );

  return lines.join("\n");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      options.input = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--title") {
      options.title = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-url") {
      options.issueUrl = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-packet") {
      options.issuePacket = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output-dir") {
      options.outputDir = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.input || !options.title || !options.issueUrl) {
    throw new Error("--input, --title, and --issue-url are required.");
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

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function formatAcceptanceChecks(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return ["- none supplied"];
  }
  return value.map((item) => {
    if (typeof item === "string") {
      return `- ${item}`;
    }
    if (item && typeof item === "object") {
      const id = typeof item.id === "string" ? `\`${item.id}\`` : null;
      const summary = firstNonEmptyString(item.assertion, item.summary, item.question);
      if (id && summary) {
        return `- ${id}: ${summary}`;
      }
      if (summary) {
        return `- ${summary}`;
      }
      return `- ${JSON.stringify(item)}`;
    }
    return `- ${String(item)}`;
  });
}

function formatMaintainerAmendments(amendments) {
  return [...amendments]
    .reverse()
    .flatMap((amendment, index) => {
      const header = [
        `### Amendment ${index + 1}`,
        "",
        amendment.recorded_at ? `- recorded_at: ${amendment.recorded_at}` : null,
        amendment.author ? `- author: ${amendment.author}` : null,
        amendment.url ? `- url: ${amendment.url}` : null,
        amendment.thread_teaching_record
          ? `- structured_teaching: ${amendment.thread_teaching_record.kind} — ${amendment.thread_teaching_record.summary}`
          : null,
        "",
      ].filter(Boolean);
      const body = amendment.thread_teaching_record
        ? formatThreadTeachingRecord(amendment.thread_teaching_record)
        : firstNonEmptyString(amendment.body);
      return body ? [...header, body, ""] : header;
    });
}

function formatThreadTeachingRecord(record) {
  const lines = [];
  const appliesTo = Array.isArray(record?.applies_to) ? record.applies_to.filter(Boolean) : [];
  const decisions = Array.isArray(record?.decisions) ? record.decisions : [];
  if (appliesTo.length > 0) {
    lines.push(`Applies to: ${appliesTo.join(", ")}`);
  }
  if (decisions.length > 0) {
    lines.push("Decisions:");
    for (const decision of decisions) {
      if (!decision || typeof decision !== "object") {
        continue;
      }
      const gateId = firstNonEmptyString(decision.gate_id) ?? "unknown";
      const outcome = firstNonEmptyString(decision.decision) ?? "unknown";
      const reason = firstNonEmptyString(decision.reason);
      lines.push(`- ${gateId} = ${outcome}${reason ? ` | ${reason}` : ""}`);
    }
  }
  return lines.join("\n");
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function normalizeComparableText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWorkIssueNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
