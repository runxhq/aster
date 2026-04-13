import { access } from "node:fs/promises";
import path from "node:path";

const required = [
  "README.md",
  "docs/operating-model.md",
  "docs/run-catalog.md",
  "docs/backlog.md",
  "scripts/runx-dogfood.sh",
  ".github/workflows/ci.yml",
  ".github/workflows/runx-dogfood.yml",
];

for (const relativePath of required) {
  try {
    await access(path.resolve(relativePath));
  } catch {
    console.error(`missing required file: ${relativePath}`);
    process.exit(1);
  }
}

console.log("automaton check passed");

