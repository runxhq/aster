import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import {
  applyAutomatonPromotions,
  upsertRecentOutcomesSection,
} from "./apply-automaton-promotions.mjs";

test("upsertRecentOutcomesSection prepends and dedupes recent outcomes", () => {
  const initial = "# Target\n\n## Why It Matters\n\ntext\n";
  const once = upsertRecentOutcomesSection(initial, "- 2026-04-16 · `lane` · `completed` · summary");
  const twice = upsertRecentOutcomesSection(once, "- 2026-04-16 · `lane` · `completed` · summary");

  assert.match(once, /## Recent Outcomes/);
  assert.equal((twice.match(/summary/g) ?? []).length, 1);
});

test("applyAutomatonPromotions copies drafts and updates target dossier", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "automaton-promotions-"));
  const repoRoot = path.join(tempRoot, "repo");
  const artifactRoot = path.join(tempRoot, "artifacts");
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });

  const reflectionPath = path.join(artifactRoot, "reflection.md");
  const historyPath = path.join(artifactRoot, "history-entry.md");
  const packetPath = path.join(artifactRoot, "packet.json");
  const summaryPath = path.join(artifactRoot, "summary.json");

  await writeFile(reflectionPath, "# Reflection\n");
  await writeFile(historyPath, "# History\n");
  await writeFile(
    packetPath,
    `${JSON.stringify(
      {
        created_at: "2026-04-16T00:00:00Z",
        lane: "issue-triage",
        status: "completed",
        summary: "README command drift",
        subject: {
          target_repo: "nilstate/automaton",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    summaryPath,
    `${JSON.stringify(
      {
        promotion_outputs: {
          reflection_path: reflectionPath,
          history_path: historyPath,
          packet_path: packetPath,
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await applyAutomatonPromotions({
    repoRoot,
    summary: summaryPath,
  });

  const dossier = await readFile(path.join(repoRoot, "state", "targets", "nilstate-automaton.md"), "utf8");
  assert.equal(result.status, "applied");
  assert.match(dossier, /## Recent Outcomes/);
  assert.match(dossier, /README command drift/);
  assert.match(await readFile(path.join(repoRoot, "reflections", "reflection.md"), "utf8"), /# Reflection/);
  assert.match(await readFile(path.join(repoRoot, "history", "entry.md"), "utf8"), /# History/);
});
