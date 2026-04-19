import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");

const allowedRunxImportPrefixes = [
  "@runx-tokens",
  "@runx-ui",
];

const forbiddenRunxTargets = [
  "api",
  "auth",
  "db",
  "worker",
  "agent-runner",
  "receipts-store",
  "mcp-hosted",
  "aster",
];

export async function assertAsterSiteSharedSurface(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const siteRoot = path.join(repoRoot, "site");
  const astroConfigPath = path.join(siteRoot, "astro.config.mjs");
  const violations = [];

  const astroConfig = await readFile(astroConfigPath, "utf8");
  if (!astroConfig.includes('path.join(runxPackagesPath, "tokens"')) {
    violations.push("site/astro.config.mjs must alias the shared runx tokens package explicitly.");
  }
  if (!astroConfig.includes('path.join(runxPackagesPath, "ui"')) {
    violations.push("site/astro.config.mjs must alias the shared runx ui package explicitly.");
  }
  for (const target of forbiddenRunxTargets) {
    if (astroConfig.includes(`path.join(runxPackagesPath, "${target}"`)) {
      violations.push(`site/astro.config.mjs must not alias runx internal package '${target}'.`);
    }
  }
  if (astroConfig.includes("apps/web")) {
    violations.push("site/astro.config.mjs must not alias runx app code.");
  }

  const siteFiles = await collectSiteSourceFiles(path.join(siteRoot, "src"));
  for (const filePath of siteFiles) {
    const source = await readFile(filePath, "utf8");
    for (const specifier of parseImportSpecifiers(source)) {
      const violation = describeForbiddenSpecifier(specifier);
      if (violation) {
        violations.push(`${path.relative(repoRoot, filePath)} imports '${specifier}': ${violation}`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(violations.join("\n"));
  }

  return true;
}

async function collectSiteSourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSiteSourceFiles(entryPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!/\.(astro|[cm]?[jt]sx?)$/u.test(entry.name)) {
      continue;
    }
    files.push(entryPath);
  }
  return files;
}

function parseImportSpecifiers(source) {
  const specifiers = new Set();
  for (const match of source.matchAll(/(?:import|export)\s+(?:[^"'`]*?\sfrom\s*)?["']([^"']+)["']/gu)) {
    specifiers.add(match[1]);
  }
  for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/gu)) {
    specifiers.add(match[1]);
  }
  return Array.from(specifiers);
}

function describeForbiddenSpecifier(specifier) {
  if (specifier.startsWith("@runx") || specifier.startsWith("@runx-")) {
    const allowed = allowedRunxImportPrefixes.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`));
    if (!allowed) {
      return "only the shared @runx-tokens and @runx-ui surfaces are allowed.";
    }
  }

  if (/runx\/cloud\/apps\/web/u.test(specifier)) {
    return "runx web app code is not a shared surface.";
  }

  if (new RegExp(`runx(?:/cloud)?/packages/(?:${forbiddenRunxTargets.join("|")})(?:/|$)`, "u").test(specifier)) {
    return "runx runtime internals are not part of the shared site surface.";
  }

  return "";
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await assertAsterSiteSharedSurface();
  process.stdout.write("aster site shared surface check passed\n");
}
