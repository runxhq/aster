import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";

const runxPackagesPath = resolveRunxPackagesPath();
const runxTokensPath = path.join(runxPackagesPath, "tokens", "dist");
const runxUiPath = path.join(runxPackagesPath, "ui", "src");

function resolveRunxPackagesPath() {
  const configuredPath = process.env.RUNX_PACKAGES_PATH;
  if (configuredPath) {
    const absoluteConfiguredPath = path.resolve(configuredPath);
    if (!fs.existsSync(absoluteConfiguredPath)) {
      throw new Error(`RUNX_PACKAGES_PATH does not exist: ${absoluteConfiguredPath}`);
    }
    return absoluteConfiguredPath;
  }

  const searchRoots = enumerateAncestorDirs(fileURLToPath(new URL(".", import.meta.url)));
  const relativeCandidates = [
    path.join(".runx", "runx", "packages"),
    path.join("runx", "packages"),
    path.join("runx", "cloud", "packages"),
  ];

  for (const root of searchRoots) {
    for (const relativePath of relativeCandidates) {
      const candidate = path.join(root, relativePath);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    `Could not resolve runx packages from ${searchRoots[0]}. Checked ${relativeCandidates.join(", ")} while walking to filesystem root.`,
  );
}

function enumerateAncestorDirs(startDir) {
  const roots = [];
  let current = path.resolve(startDir);
  while (true) {
    roots.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return roots;
}

export default defineConfig({
  site: "https://aster.runx.ai",
  output: "static",
  vite: {
    resolve: {
      alias: {
        "@runx-tokens": runxTokensPath,
        "@runx-ui": runxUiPath,
      },
    },
    server: {
      fs: {
        allow: [runxPackagesPath],
      },
    },
  },
});
