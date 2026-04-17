import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const libDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(libDir, "../../..");

marked.setOptions({
  headerIds: false,
  mangle: false,
});

/**
 * @typedef {Object} RepoDoc
 * @property {string} path
 * @property {string} title
 * @property {string} excerpt
 * @property {string} content
 * @property {string} html
 * @property {Record<string, string>} frontmatter
 */

/**
 * @param {string} relativePath
 * @returns {Promise<RepoDoc | null>}
 */
export async function readRepoDoc(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return null;
  }
  const raw = await readFile(absolutePath, "utf8");
  const { frontmatter, content } = splitFrontmatter(raw);
  const title = frontmatter.title ?? extractHeading(content) ?? path.basename(relativePath, ".md");
  const excerpt = trimInline(stripMarkdown(content), 220);
  /** @type {RepoDoc} */
  const doc = {
    path: relativePath.replaceAll(path.sep, "/"),
    title,
    excerpt,
    content: content.trim(),
    html: marked.parse(content),
    frontmatter,
  };
  return doc;
}

export async function readJsonFile(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return null;
  }
  try {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {string} relativeDir
 * @param {{ limit?: number }} [options]
 * @returns {Promise<RepoDoc[]>}
 */
export async function listRepoDocs(relativeDir, options = {}) {
  const absoluteDir = path.resolve(repoRoot, relativeDir);
  if (!existsSync(absoluteDir)) {
    return [];
  }
  const entries = (await readdir(absoluteDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  /** @type {RepoDoc[]} */
  const docs = [];
  for (const entry of entries.slice(0, options.limit ?? entries.length)) {
    const doc = await readRepoDoc(path.join(relativeDir, entry));
    if (doc) {
      docs.push(doc);
    }
  }
  return docs;
}

export async function readPublicModel() {
  const [
    thesis,
    mission,
    examples,
    conduct,
    voice,
    epistemology,
    authority,
    evolution,
    priorities,
    capabilities,
    runCatalog,
    history,
    reflections,
    targets,
  ] =
    await Promise.all([
      readRepoDoc("doctrine/MATON.md"),
      readRepoDoc("doctrine/MISSION.md"),
      readRepoDoc("doctrine/EXAMPLES.md"),
      readRepoDoc("doctrine/CONDUCT.md"),
      readRepoDoc("doctrine/VOICE.md"),
      readRepoDoc("doctrine/EPISTEMOLOGY.md"),
      readRepoDoc("doctrine/AUTHORITY.md"),
      readRepoDoc("doctrine/EVOLUTION.md"),
      readRepoDoc("state/priorities.md"),
      readRepoDoc("state/capabilities.md"),
      readRepoDoc("docs/run-catalog.md"),
      listRepoDocs("history", { limit: 8 }),
      listRepoDocs("reflections", { limit: 8 }),
      listRepoDocs("state/targets", { limit: 24 }),
    ]);

  return {
    thesis,
    mission,
    examples,
    conduct,
    voice,
    epistemology,
    authority,
    evolution,
    constitution: [mission, examples, conduct, voice, epistemology, authority, evolution].filter(Boolean),
    priorities,
    capabilities,
    runCatalog,
    history,
    reflections,
    targets,
  };
}

export async function readMatonControl() {
  return readJsonFile("state/maton-control.json");
}

export function targetHref(doc) {
  return `/targets/${path.basename(doc.path, ".md")}/`;
}

export function doctrineHref(doc) {
  return `/doctrine/${path.basename(doc.path, ".md").toLowerCase()}/`;
}

export async function listDoctrineDocs() {
  const docs = await Promise.all(doctrineOrder.map((relativePath) => readRepoDoc(relativePath)));
  /** @type {RepoDoc[]} */
  const concreteDocs = docs.filter((doc) => doc !== null);
  return concreteDocs;
}

function splitFrontmatter(raw) {
  if (!raw.startsWith("---\n")) {
    return { frontmatter: {}, content: raw };
  }
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontmatter: {}, content: raw };
  }
  const frontmatter = {};
  for (const line of raw.slice(4, end).split("\n")) {
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
  return {
    frontmatter,
    content: raw.slice(end + 5),
  };
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

function trimInline(value, limit) {
  const collapsed = String(value ?? "").replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) {
    return collapsed;
  }
  return `${collapsed.slice(0, limit - 3)}...`;
}

const doctrineOrder = [
  "doctrine/MATON.md",
  "doctrine/MISSION.md",
  "doctrine/EXAMPLES.md",
  "doctrine/CONDUCT.md",
  "doctrine/VOICE.md",
  "doctrine/EPISTEMOLOGY.md",
  "doctrine/AUTHORITY.md",
  "doctrine/EVOLUTION.md",
];
