import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { extractSkillProposalPayload } from "./write-skill-proposal.mjs";

const residuePatterns = [
  {
    id: "supplied_decomposition",
    pattern: /\bsupplied decomposition\b/i,
    message: "Replace builder residue like 'supplied decomposition' with maintainer-facing proposal language.",
  },
  {
    id: "unresolved_placeholder",
    pattern: /\bUNRESOLVED_[A-Z0-9_]+\b/,
    message: "Do not leak unresolved placeholder tokens into a first-party proposal.",
  },
  {
    id: "issue_number_contract",
    pattern: /\bcurrent issue #\d+\b/i,
    message: "Do not anchor the core skill contract to one current issue number.",
  },
  {
    id: "adapter_surface_leak",
    pattern: /\bcurrent issue-ledger adapter surface\b/i,
    message: "Keep adapter discussion out of the core proposal unless it is genuinely contract-shaping.",
  },
];

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = JSON.parse(await readFile(path.resolve(options.resultJson), "utf8"));
  const issuePacket = options.issuePacket
    ? JSON.parse(await readFile(path.resolve(options.issuePacket), "utf8"))
    : null;
  const catalogEntries = options.catalogFile
    ? await readCatalogEntries(path.resolve(options.catalogFile))
    : [];

  const evaluation = evaluateSkillProposalQuality({ report, issuePacket, catalogEntries });
  const serialized = `${JSON.stringify(evaluation, null, 2)}\n`;
  if (options.output) {
    await writeFile(path.resolve(options.output), serialized);
  }
  process.stdout.write(serialized);
}

export function evaluateSkillProposalQuality({ report, issuePacket = null, catalogEntries = [] }) {
  const payload = extractSkillProposalPayload(report);
  const skillSpec = isRecord(payload?.skill_spec) ? payload.skill_spec : {};
  const acceptanceChecks = Array.isArray(payload?.acceptance_checks) ? payload.acceptance_checks : [];
  const painPoints = normalizeList(payload?.pain_points);
  const maintainerDecisions = normalizeList(payload?.maintainer_decisions);
  const catalogFitText = collectText(payload?.catalog_fit).join("\n").trim();
  const openQuestions = Array.isArray(payload?.execution_plan?.open_questions_left_out_of_scope)
    ? payload.execution_plan.open_questions_left_out_of_scope.filter(Boolean)
    : [];
  const proposalText = [
    ...collectText(skillSpec),
    ...collectText(payload?.pain_points),
    ...collectText(payload?.catalog_fit),
    ...collectText(payload?.maintainer_decisions),
    ...collectText(payload?.execution_plan),
    ...collectText(payload?.harness_fixture),
  ].join("\n");
  const residueHits = residuePatterns
    .filter(({ pattern }) => pattern.test(proposalText))
    .map(({ id, message }) => ({ id, message }));
  const placeholderFree = !/\b(?:UNRESOLVED_[A-Z0-9_]+|TBD|placeholder)\b/i.test(proposalText);
  const catalogMentions = new Set(
    catalogEntries.filter((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(catalogFitText)),
  );
  const checks = {
    proposal_named: Boolean(firstNonEmptyString(skillSpec.name)),
    first_party_shape: Boolean(
      firstNonEmptyString(skillSpec.summary, skillSpec.description, skillSpec.objective)
      && acceptanceChecks.length >= 3
    ),
    pain_points_explicit: painPoints.length > 0,
    catalog_fit_explicit: catalogFitText.length > 0,
    catalog_overlap_explained: catalogEntries.length === 0
      ? catalogFitText.length > 0
      : catalogMentions.size > 0,
    maintainer_decisions_explicit: maintainerDecisions.length > 0 || openQuestions.length === 0,
    builder_residue_free: residueHits.length === 0,
    placeholder_free: placeholderFree,
  };
  const findings = [];

  if (!checks.pain_points_explicit) {
    findings.push({
      id: "pain_points_missing",
      summary: "Name the concrete operator or maintainer pain points this skill resolves.",
    });
  }
  if (!checks.catalog_fit_explicit) {
    findings.push({
      id: "catalog_fit_missing",
      summary: "Explain where this proposal fits against the current runx catalog.",
    });
  } else if (!checks.catalog_overlap_explained) {
    findings.push({
      id: "catalog_overlap_unexplained",
      summary: "Name the adjacent current runx skills or chains and explain the boundary clearly.",
    });
  }
  if (!checks.maintainer_decisions_explicit) {
    findings.push({
      id: "maintainer_decisions_missing",
      summary: "Convert open questions into explicit maintainer decisions instead of leaving planning residue.",
    });
  }
  for (const residueHit of residueHits) {
    findings.push({
      id: residueHit.id,
      summary: residueHit.message,
    });
  }
  if (!checks.placeholder_free) {
    findings.push({
      id: "placeholder_leak",
      summary: "Remove placeholder targets and unresolved tokens from the surfaced proposal packet.",
    });
  }

  const passed = Object.values(checks).filter(Boolean).length;
  return {
    schema: "runx.skill_proposal_eval.v1",
    status: findings.length === 0 ? "pass" : "needs_review",
    checks,
    score: Math.round((passed / Object.keys(checks).length) * 1000) / 1000,
    metrics: {
      acceptance_check_count: acceptanceChecks.length,
      pain_point_count: painPoints.length,
      maintainer_decision_count: maintainerDecisions.length,
      catalog_mentions: [...catalogMentions],
      residue_hit_count: residueHits.length,
      request_objective: firstNonEmptyString(issuePacket?.sections?.objective, issuePacket?.objective),
    },
    findings,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--result-json") {
      options.resultJson = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-packet") {
      options.issuePacket = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--catalog-file") {
      options.catalogFile = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.resultJson) {
    throw new Error("--result-json is required.");
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

async function readCatalogEntries(file) {
  let raw;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => firstNonEmptyString(entry?.skill_id))
    .filter(Boolean)
    .map((entry) => entry.includes("/") ? entry.split("/").at(-1) : entry);
}

function normalizeList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      if (isRecord(entry)) {
        return firstNonEmptyString(entry.summary, entry.problem, entry.question, entry.title, JSON.stringify(entry));
      }
      return null;
    })
    .filter(Boolean);
}

function collectText(value) {
  if (value == null) {
    return [];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectText(entry));
  }
  if (isRecord(value)) {
    return Object.values(value).flatMap((entry) => collectText(entry));
  }
  return [];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  return null;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
