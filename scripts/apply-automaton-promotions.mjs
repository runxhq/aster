import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { slugifyRepoLike } from "./build-automaton-context.mjs";

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await applyAutomatonPromotions(options);

  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(result, null, 2)}\n`);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function applyAutomatonPromotions(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const summary = JSON.parse(await readFile(path.resolve(options.summary), "utf8"));
  const packet = JSON.parse(
    await readFile(path.resolve(summary?.promotion_outputs?.packet_path), "utf8"),
  );

  const reflectionSource = path.resolve(summary?.promotion_outputs?.reflection_path);
  const historySource = path.resolve(summary?.promotion_outputs?.history_path);
  const reflectionTarget = path.join(repoRoot, "reflections", path.basename(reflectionSource));
  const historyTarget = path.join(
    repoRoot,
    "history",
    path.basename(historySource).replace(/^history-/, ""),
  );

  await mkdir(path.dirname(reflectionTarget), { recursive: true });
  await mkdir(path.dirname(historyTarget), { recursive: true });
  await copyIfChanged(reflectionSource, reflectionTarget);
  await copyIfChanged(historySource, historyTarget);

  const targetRepo = firstString(packet?.subject?.target_repo)
    || firstString(packet?.subject?.repo)
    || "nilstate/automaton";
  const targetSlug = slugifyRepoLike(targetRepo);
  const targetDossierPath = path.join(repoRoot, "state", "targets", `${targetSlug}.md`);
  const targetUpdated = await updateTargetRecentOutcomes({
    dossierPath: targetDossierPath,
    packet,
  });

  return {
    status: "applied",
    reflection_path: reflectionTarget,
    history_path: historyTarget,
    target_dossier_path: targetDossierPath,
    target_updated: targetUpdated,
  };
}

async function copyIfChanged(source, target) {
  const sourceContent = await readFile(source, "utf8");
  let targetContent = "";
  try {
    targetContent = await readFile(target, "utf8");
  } catch {
    targetContent = "";
  }

  if (sourceContent === targetContent) {
    return false;
  }

  await copyFile(source, target);
  return true;
}

async function updateTargetRecentOutcomes({ dossierPath, packet }) {
  let content = "";
  try {
    content = await readFile(dossierPath, "utf8");
  } catch {
    content = createTargetDossier(packet);
  }

  const outcomeLine = buildOutcomeLine(packet);
  const next = upsertRecentOutcomesSection(content, outcomeLine);
  if (next === content) {
    return false;
  }

  await mkdir(path.dirname(dossierPath), { recursive: true });
  await writeFile(dossierPath, next);
  return true;
}

function createTargetDossier(packet) {
  const targetRepo = firstString(packet?.subject?.target_repo)
    || firstString(packet?.subject?.repo)
    || "unknown/target";
  return `${[
    "---",
    `title: Target Dossier — ${targetRepo}`,
    `updated: ${packet?.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)}`,
    "visibility: public",
    "subject_kind: github_repository",
    `subject_locator: ${targetRepo}`,
    "---",
    "",
    `# ${targetRepo}`,
    "",
    "## Why It Matters",
    "",
    "Target dossier created from operator promotion output.",
    "",
  ].join("\n")}\n`;
}

export function upsertRecentOutcomesSection(content, outcomeLine) {
  const heading = "## Recent Outcomes";
  const sectionMatch = content.match(/## Recent Outcomes\n([\s\S]*?)(?=\n## |\s*$)/);
  const existingLines = sectionMatch
    ? sectionMatch[1]
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

  const deduped = [outcomeLine, ...existingLines.filter((line) => line !== outcomeLine)].slice(0, 5);
  const section = `${heading}\n\n${deduped.join("\n")}\n`;

  if (sectionMatch) {
    return content.replace(sectionMatch[0], section.trimEnd());
  }

  const trimmed = content.trimEnd();
  return `${trimmed}\n\n${section}`;
}

function buildOutcomeLine(packet) {
  const date = firstString(packet?.created_at).slice(0, 10) || new Date().toISOString().slice(0, 10);
  const lane = firstString(packet?.lane) || "unknown-lane";
  const status = firstString(packet?.status) || "unknown";
  const summary = firstString(packet?.summary) || "operator run completed";
  return `- ${date} · \`${lane}\` · \`${status}\` · ${summary}`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--summary") {
      options.summary = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--repo-root") {
      options.repoRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.summary || !options.repoRoot) {
    throw new Error("--summary and --repo-root are required.");
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

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
