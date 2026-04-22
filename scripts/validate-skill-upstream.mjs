import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const options = parseArgs(process.argv.slice(2));
const targetRoot = path.resolve(options.targetRepoDir);
const artifactsDir = path.resolve(options.artifactsDir);
const skillPath = path.join(targetRoot, options.candidatePath);

const skill = await readRequired(skillPath);
const prBody = await readRequired(path.join(artifactsDir, "pr-body.md"));
const opportunity = await readJson("skill_opportunity.json");
const research = await readJson("prior_art_report.json");
const candidate = await readJson("skill_candidate.json");
const contribution = await readJson("contribution_packet.json");
const feedEvent = await readJson("public_feed_event.json");

const checks = [
  ["skill frontmatter exists", /^---\n[\s\S]+?\n---\n/.test(skill)],
  ["skill has evidence section", heading(skill, "Evidence Sources")],
  ["skill has workflow section", heading(skill, "Workflow")],
  ["skill has safe operating rules", heading(skill, "Safe Operating Rules")],
  ["skill keeps runx optional", /runx can optionally pair it/i.test(skill) && !/runx add|curl\s+runx\.ai|npm\s+i\s+-g\s+runx/i.test(skill)],
  ["skill public language is clean", !hasForbiddenPublicLanguage(skill)],
  ["PR body public language is clean", !hasForbiddenPublicLanguage(prBody)],
  ["PR body cites Agent Skills specification", /https:\/\/agentskills\.io\/specification/.test(prBody)],
  ["PR body cites Anthropic skills repository", /https:\/\/github\.com\/anthropics\/skills/.test(prBody)],
  ["PR body cites Claude Skills overview", /https:\/\/claude\.com\/docs\/skills\/overview/.test(prBody)],
  ["opportunity schema", opportunity.schema === "runx.skill_opportunity.v1" && opportunity.state === "discovered"],
  ["research schema", research.schema === "runx.prior_art_report.v1" && Array.isArray(research.findings) && research.findings.length > 0],
  ["candidate schema", candidate.schema === "runx.skill_candidate.v1" && candidate.skill?.portable === true && candidate.skill?.requires_runx === false],
  ["contribution schema", contribution.schema === "runx.skill_upstream.v1" && contribution.state === "contribution_ready"],
  ["only portable SKILL.md changes declared", Array.isArray(contribution.changes) && contribution.changes.length === 1 && contribution.changes[0]?.path === options.candidatePath],
  ["feed event schema", feedEvent.lane === "skill-upstream" && feedEvent.metadata?.state === "contribution_ready"],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length > 0) {
  for (const [name] of failed) {
    console.error(`failed: ${name}`);
  }
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  status: "valid",
  target_repo_dir: targetRoot,
  candidate_path: options.candidatePath,
  checks_total: checks.length,
  checks_passed: checks.length,
}, null, 2)}\n`);

async function readJson(fileName) {
  return JSON.parse(await readRequired(path.join(artifactsDir, fileName)));
}

async function readRequired(file) {
  try {
    await stat(file);
  } catch {
    throw new Error(`Missing required contribution artifact: ${file}`);
  }
  return readFile(file, "utf8");
}

function heading(markdown, name) {
  return new RegExp(`^##\\s+${escapeRegExp(name)}\\s*$`, "m").test(markdown);
}

function hasForbiddenPublicLanguage(text) {
  return [
    /\badoption\b/i,
    /\bwedge\b/i,
    /\bfunnel\b/i,
    /\bconversion\b/i,
    /\btarget account\b/i,
    /\bgrowth loop\b/i,
    /\btrojan horse\b/i,
  ].some((pattern) => pattern.test(text));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(argv) {
  const parsed = {
    artifactsDir: ".artifacts/skill-upstream",
    candidatePath: "SKILL.md",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--target-repo-dir") {
      parsed.targetRepoDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--artifacts-dir") {
      parsed.artifactsDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--candidate-path") {
      parsed.candidatePath = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!parsed.targetRepoDir) {
    throw new Error("--target-repo-dir is required.");
  }
  if (path.isAbsolute(parsed.candidatePath) || parsed.candidatePath.includes("..")) {
    throw new Error("--candidate-path must be relative and confined to the target repo.");
  }
  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}
