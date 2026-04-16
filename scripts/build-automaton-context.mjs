import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const bundle = await buildContextBundle(options);
  const prompt = renderContextPrompt(bundle);

  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(bundle, null, 2)}\n`);
  }
  if (options.promptOutput) {
    await writeFile(path.resolve(options.promptOutput), `${prompt}\n`);
  }

  if (!options.output && !options.promptOutput) {
    process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
  }
}

export async function buildContextBundle(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const artifactRoot = path.resolve(repoRoot, options.artifactRoot ?? ".artifacts");
  const repo = options.repo ?? "nilstate/automaton";
  const targetRepo = options.targetRepo ?? repo;
  const targetSlug = slugifyRepoLike(targetRepo);
  const snapshot = await readOptionalJson(options.snapshot ? path.resolve(options.snapshot) : undefined);
  const doctrine = await readMarkdownDirectory(path.join(repoRoot, "doctrine"), {
    limit: 8,
    includeContent: true,
    repoRoot,
  });
  const history = await readMarkdownDirectory(path.join(repoRoot, "history"), {
    limit: Number(options.maxHistory ?? 4),
    includeContent: false,
    repoRoot,
  });
  const reflections = await readMarkdownDirectory(path.join(repoRoot, "reflections"), {
    limit: Number(options.maxReflections ?? 4),
    includeContent: false,
    repoRoot,
  });
  const priorities = await readMarkdownDocument(path.join(repoRoot, "state", "priorities.md"), repoRoot);
  const capabilities = await readMarkdownDocument(path.join(repoRoot, "state", "capabilities.md"), repoRoot);
  const target = await readMarkdownDocument(
    path.join(repoRoot, "state", "targets", `${targetSlug}.md`),
    repoRoot,
  );
  const artifactSignals = await collectArtifactSignals(artifactRoot, repoRoot, {
    limit: Number(options.maxArtifacts ?? 8),
  });

  return {
    generated_at: new Date().toISOString(),
    lane: options.lane ?? "unknown",
    subject: {
      kind: options.subjectKind ?? "repository",
      locator: options.subjectLocator ?? targetRepo,
      repo,
      target_repo: targetRepo,
      issue_number: options.issueNumber ?? null,
      pr_number: options.prNumber ?? null,
      issue_url: options.issueUrl ?? null,
    },
    doctrine,
    state: {
      priorities,
      capabilities,
      target,
    },
    history,
    reflections,
    artifact_signals: artifactSignals,
    snapshot,
  };
}

export function renderContextPrompt(bundle) {
  const lines = [
    "# Automaton Context Bundle",
    "",
    `- lane: \`${bundle.lane}\``,
    `- subject_kind: \`${bundle.subject.kind}\``,
    `- subject_locator: \`${bundle.subject.locator}\``,
    `- repo: \`${bundle.subject.repo}\``,
  ];

  if (bundle.subject.target_repo) {
    lines.push(`- target_repo: \`${bundle.subject.target_repo}\``);
  }
  if (bundle.subject.issue_number) {
    lines.push(`- issue_number: \`${bundle.subject.issue_number}\``);
  }
  if (bundle.subject.pr_number) {
    lines.push(`- pr_number: \`${bundle.subject.pr_number}\``);
  }

  lines.push(
    "",
    "Use doctrine as constitutional guidance.",
    "Use state, history, reflections, and artifact signals as derived context.",
    "If the live request envelope conflicts with derived context, trust the live envelope and receipts.",
  );

  if (bundle.doctrine.length > 0) {
    lines.push("", "## Doctrine");
    for (const doc of bundle.doctrine) {
      lines.push("", `### ${doc.title}`);
      lines.push("", trimForPrompt(doc.content ?? doc.excerpt, 2200));
    }
  }

  const stateDocs = [
    ["Current Priorities", bundle.state.priorities],
    ["Capability Map", bundle.state.capabilities],
    ["Target Dossier", bundle.state.target],
  ].filter(([, value]) => Boolean(value));

  if (stateDocs.length > 0) {
    lines.push("", "## Current State");
    for (const [label, doc] of stateDocs) {
      lines.push("", `### ${label}`);
      lines.push("", trimForPrompt(doc.content ?? doc.excerpt, 2000));
    }
  }

  if (bundle.history.length > 0) {
    lines.push("", "## Recent History");
    for (const entry of bundle.history) {
      lines.push(`- ${entry.title}: ${trimInline(entry.excerpt, 240)}`);
    }
  }

  if (bundle.reflections.length > 0) {
    lines.push("", "## Recent Reflections");
    for (const entry of bundle.reflections) {
      lines.push(`- ${entry.title}: ${trimInline(entry.excerpt, 240)}`);
    }
  }

  if (bundle.artifact_signals.length > 0) {
    lines.push("", "## Recent Artifact Signals");
    for (const signal of bundle.artifact_signals) {
      const parts = [`- \`${signal.path}\``];
      if (signal.status) {
        parts.push(`[${signal.status}]`);
      }
      if (signal.summary) {
        parts.push(signal.summary);
      }
      lines.push(parts.join(" "));
    }
  }

  if (bundle.snapshot) {
    lines.push("", "## Supplied Snapshot", "", trimForPrompt(JSON.stringify(bundle.snapshot, null, 2), 2400));
  }

  return lines.join("\n").trim();
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo-root") {
      options.repoRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--artifact-root") {
      options.artifactRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--lane") {
      options.lane = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--subject-kind") {
      options.subjectKind = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--subject-locator") {
      options.subjectLocator = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--target-repo") {
      options.targetRepo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-number") {
      options.issueNumber = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--pr-number") {
      options.prNumber = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-url") {
      options.issueUrl = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--snapshot") {
      options.snapshot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--max-history") {
      options.maxHistory = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--max-reflections") {
      options.maxReflections = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--max-artifacts") {
      options.maxArtifacts = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--prompt-output") {
      options.promptOutput = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
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

async function readMarkdownDirectory(dirPath, options = {}) {
  if (!existsSync(dirPath)) {
    return [];
  }
  const entries = (await readdir(dirPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const limit = options.limit ?? entries.length;
  const docs = [];
  for (const entry of entries.slice(0, limit)) {
    const doc = await readMarkdownDocument(
      path.join(dirPath, entry),
      options.repoRoot ?? defaultRepoRoot,
      options.includeContent,
    );
    if (doc) {
      docs.push(doc);
    }
  }
  return docs;
}

async function readMarkdownDocument(filePath, repoRoot, includeContent = true) {
  if (!existsSync(filePath)) {
    return null;
  }
  const raw = await readFile(filePath, "utf8");
  const { frontmatter, content } = splitFrontmatter(raw);
  const title = frontmatter.title ?? extractHeading(content) ?? path.basename(filePath, ".md");
  return {
    path: path.relative(repoRoot, filePath).replaceAll(path.sep, "/"),
    title,
    date: frontmatter.date ?? frontmatter.updated ?? null,
    excerpt: trimInline(stripMarkdown(content), 360),
    content: includeContent ? content.trim() : undefined,
    frontmatter,
  };
}

function splitFrontmatter(raw) {
  if (!raw.startsWith("---\n")) {
    return { frontmatter: {}, content: raw };
  }
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontmatter: {}, content: raw };
  }
  const frontmatterBlock = raw.slice(4, end);
  const content = raw.slice(end + 5);
  const frontmatter = {};
  for (const line of frontmatterBlock.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) {
      frontmatter[key] = value;
    }
  }
  return { frontmatter, content };
}

function extractHeading(content) {
  for (const line of content.split("\n")) {
    if (line.startsWith("# ")) {
      return line.slice(2).trim();
    }
  }
  return "";
}

function stripMarkdown(content) {
  return content
    .replace(/^#+\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{2,}/g, " ")
    .trim();
}

async function collectArtifactSignals(rootDir, repoRoot, options = {}) {
  if (!existsSync(rootDir)) {
    return [];
  }
  const discovered = [];
  await walkJsonFiles(rootDir, async (filePath) => {
    const metadata = await stat(filePath);
    discovered.push({
      filePath,
      modifiedAt: metadata.mtime.toISOString(),
      size: metadata.size,
    });
  });

  const filtered = discovered
    .filter((entry) => entry.size <= 512 * 1024)
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
    .slice(0, options.limit ?? 8);

  const signals = [];
  for (const entry of filtered) {
    const payload = await readOptionalJson(entry.filePath);
    signals.push({
      path: path.relative(repoRoot, entry.filePath).replaceAll(path.sep, "/"),
      modified_at: entry.modifiedAt,
      status: firstString(
        payload?.status
        ?? payload?.publish?.status
        ?? payload?.conclusion
        ?? payload?.mode,
      ),
      summary: firstString(
        payload?.summary
        ?? payload?.objective_summary
        ?? payload?.reason
        ?? payload?.publish?.title
        ?? payload?.publish?.url
        ?? payload?.error,
      ),
    });
  }
  return signals;
}

async function walkJsonFiles(rootDir, visit) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (["provider-trace", "receipts", "workspaces", "node_modules"].includes(entry.name)) {
        continue;
      }
      await walkJsonFiles(absolute, visit);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      await visit(absolute);
    }
  }
}

async function readOptionalJson(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function slugifyRepoLike(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function trimInline(value, limit) {
  const collapsed = String(value ?? "").replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) {
    return collapsed;
  }
  return `${collapsed.slice(0, limit - 3)}...`;
}

function trimForPrompt(value, limit) {
  const normalized = String(value ?? "").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
