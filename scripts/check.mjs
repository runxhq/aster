import { access } from "node:fs/promises";
import path from "node:path";

const required = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CONVENTIONS.md",
  "docs/operating-model.md",
  "docs/run-catalog.md",
  "docs/backlog.md",
  "docs/sourcey.config.ts",
  "docs/introduction.md",
  "docs/dogfood.md",
  "docs/evolution.md",
  "docs/operating-model.md",
  "docs/flows.md",
  "docs/operations.md",
  "scripts/runx-dogfood.sh",
  "scripts/runx-agent-bridge.mjs",
  "scripts/sourcey-wrapper.sh",
  "scripts/prepare-issue-supervisor-decision.mjs",
  "scripts/run-issue-supervisor-plan.mjs",
  "scripts/post-issue-supervisor-comment.mjs",
  "scripts/run-issue-supervisor-workers.mjs",
  "scripts/publish-runx-pr.mjs",
  ".github/workflows/ci.yml",
  ".github/workflows/runx-dogfood.yml",
  ".github/workflows/docs-pages.yml",
  ".github/workflows/sourcey-refresh.yml",
  ".github/workflows/issue-supervisor.yml",
  ".github/workflows/pr-triage.yml",
  ".github/workflows/skill-learning.yml",
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
