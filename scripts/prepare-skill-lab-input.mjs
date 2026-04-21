import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const issue = JSON.parse(await readFile(path.resolve(options.input), "utf8"));
  const prepared = prepareSkillLabInput(issue);

  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(prepared, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`);
}

export function prepareSkillLabInput(issue = {}) {
  const rawTitle = normalizeString(issue.title) ?? "Untitled skill proposal";
  const rawBody = normalizeString(issue.body) ?? "";
  const sectionExtraction = extractNamedSections(rawBody);
  const objective = firstNonEmpty(
    normalizeString(sectionExtraction.sections.objective),
    stripSkillPrefix(rawTitle),
    rawTitle,
  );

  const whyItMatters = normalizeString(sectionExtraction.sections.why_it_matters);
  const constraints = normalizeString(sectionExtraction.sections.constraints);
  const evidence = normalizeString(sectionExtraction.sections.evidence);
  const notes = normalizeString(sectionExtraction.notes);

  const projectContextParts = [
    "Source Issue",
    formatBulletList([
      `title: ${rawTitle}`,
      issue.url ? `url: ${issue.url}` : null,
    ]),
    whyItMatters ? `Why It Matters\n${whyItMatters}` : null,
    constraints ? `Constraints\n${constraints}` : null,
    evidence ? `Evidence\n${evidence}` : null,
    notes ? `Additional Notes\n${notes}` : null,
  ].filter(Boolean);

  return {
    source_issue: {
      number: issue.number ?? null,
      title: rawTitle,
      url: normalizeString(issue.url) ?? null,
    },
    raw_title: rawTitle,
    objective,
    project_context: projectContextParts.join("\n\n"),
    sections: {
      objective: objective,
      why_it_matters: whyItMatters,
      constraints,
      evidence,
      additional_notes: notes,
    },
  };
}

function extractNamedSections(body) {
  const recognizedKeys = new Set(["objective", "why_it_matters", "constraints", "evidence"]);
  const sections = {
    objective: "",
    why_it_matters: "",
    constraints: "",
    evidence: "",
  };
  const notes = [];
  let activeKey = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const heading = matchHeading(line);

    if (heading) {
      const key = normalizeSectionName(heading.label);
      if (key && recognizedKeys.has(key)) {
        activeKey = key;
        if (heading.inlineValue) {
          appendLine(sections, key, heading.inlineValue);
        }
        continue;
      }
      activeKey = null;
    }

    if (activeKey) {
      appendLine(sections, activeKey, line);
      continue;
    }

    if (line.trim().length > 0) {
      notes.push(line);
    }
  }

  return {
    sections: Object.fromEntries(
      Object.entries(sections).map(([key, value]) => [key, normalizeBlock(value)]),
    ),
    notes: normalizeNotes(notes),
  };
}

function appendLine(target, key, line) {
  const nextValue = target[key].length > 0 ? `${target[key]}\n${line}` : line;
  target[key] = nextValue;
}

function matchHeading(line) {
  const markdownMatch = line.match(/^#{1,6}\s+(.+?)\s*$/);
  if (markdownMatch) {
    return {
      label: markdownMatch[1],
      inlineValue: "",
    };
  }

  const labelOnlyMatch = line.match(/^([A-Za-z][A-Za-z0-9 /-]{1,40}):\s*$/);
  if (labelOnlyMatch) {
    return {
      label: labelOnlyMatch[1],
      inlineValue: "",
    };
  }

  const inlineMatch = line.match(/^([A-Za-z][A-Za-z0-9 /-]{1,40}):\s+(.+)$/);
  if (inlineMatch) {
    return {
      label: inlineMatch[1],
      inlineValue: inlineMatch[2],
    };
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
    case "why":
    case "why it matters":
    case "motivation":
      return "why_it_matters";
    case "constraints":
      return "constraints";
    case "evidence":
      return "evidence";
    default:
      return null;
  }
}

function normalizeNotes(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return null;
  }
  return normalizeBlock(lines.join("\n"));
}

function normalizeBlock(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stripSkillPrefix(value) {
  const trimmed = normalizeString(value);
  if (!trimmed) {
    return null;
  }
  const stripped = trimmed.replace(/^\[skill\]\s*/i, "").trim();
  return stripped.length > 0 ? stripped : null;
}

function formatBulletList(items) {
  return items
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join("\n");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      options.input = requireValue(argv, ++index, token);
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

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
