import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import {
  deriveEvidenceProjections,
  renderLatestBatchMarkdown,
} from "./derive-evidence-projections.mjs";

test("deriveEvidenceProjections rebuilds projection state from artifacts and suppresses duplicate projections", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-evidence-projections-"));
  const repoRoot = path.join(tempRoot, "repo");
  const stateInputPath = path.join(tempRoot, "previous-state.json");
  const statePath = path.join(repoRoot, "state", "evidence-projections.json");
  await mkdir(path.join(repoRoot, "state"), { recursive: true });

  await writeFile(
    stateInputPath,
    `${JSON.stringify({
      generated_at: "2026-04-19T00:00:00Z",
      source: {
        type: "github_actions_artifacts",
        repo: "runxhq/aster",
        artifact_prefixes: ["issue-triage-", "skill-lab-"],
        artifact_limit: 200,
      },
      stats: {
        tracked_artifacts: 1,
        newly_processed_artifacts: 0,
        applied_summaries: 0,
        suppressed_summaries: 0,
        skipped_artifacts: 0,
        errors: 0,
      },
      artifacts: [
        {
          artifact_id: 100,
          name: "issue-triage-pr-10",
          created_at: "2026-04-19T00:00:00Z",
          updated_at: "2026-04-19T00:05:00Z",
          workflow_run_id: 9000,
          summaries: [],
        },
      ],
      projection_groups: [],
    }, null, 2)}\n`,
  );

  const report = await deriveEvidenceProjections(
    {
      repoRoot,
      repo: "runxhq/aster",
      stateInput: stateInputPath,
      output: statePath,
      downloadRoot: path.join(tempRoot, "downloads"),
      now: "2026-04-20T08:30:00Z",
      workflowRunId: "24704064892",
      workflowRunUrl: "https://github.com/runxhq/aster/actions/runs/24704064892",
    },
    {
      listArtifacts: async () => ([
        {
          id: 100,
          name: "issue-triage-pr-10",
          created_at: "2026-04-19T00:00:00Z",
          updated_at: "2026-04-19T00:05:00Z",
          expired: false,
          workflow_run: { id: 9000, head_branch: "main", head_sha: "aaa111" },
        },
        {
          id: 101,
          name: "issue-triage-issue-11",
          created_at: "2026-04-20T01:00:00Z",
          updated_at: "2026-04-20T01:05:00Z",
          expired: false,
          workflow_run: { id: 9001, head_branch: "main", head_sha: "bbb222" },
        },
        {
          id: 102,
          name: "issue-triage-issue-11-rerun",
          created_at: "2026-04-20T02:00:00Z",
          updated_at: "2026-04-20T02:05:00Z",
          expired: false,
          workflow_run: { id: 9002, head_branch: "main", head_sha: "ccc333" },
        },
        {
          id: 103,
          name: "skill-lab-12",
          created_at: "2026-04-20T03:00:00Z",
          updated_at: "2026-04-20T03:05:00Z",
          expired: false,
          workflow_run: { id: 9003, head_branch: "main", head_sha: "ddd444" },
        },
      ]),
      downloadArtifact: async ({ artifact, outputDir }) => {
        if (artifact.id === 103) {
          await writeFile(path.join(outputDir, "README.txt"), "no summary here\n");
          return;
        }

        const promotionsDir = path.join(outputDir, "promotions");
        await mkdir(promotionsDir, { recursive: true });

        const packet = artifact.id === 100
          ? {
              created_at: "2026-04-19T00:00:00Z",
              lane: "issue-triage",
              status: "success",
              harness_receipt_refs: [{ type: "harness_receipt", uri: "runx:harness_receipt:rcpt_100" }],
              summary: "older proof record",
              objective_fingerprint: "pr:runxhq-runx-10",
              subject: {
                locator: "runxhq/runx#pr/10",
                target_repo: "runxhq/runx",
              },
            }
          : {
              created_at: artifact.id === 101 ? "2026-04-20T01:00:00Z" : "2026-04-20T02:00:00Z",
              lane: "issue-triage",
              status: "success",
              harness_receipt_refs: [{
                type: "harness_receipt",
                uri: `runx:harness_receipt:${artifact.id === 101 ? "rcpt_101" : "rcpt_102"}`,
              }],
              summary: artifact.id === 101 ? "clarified issue routing (first pass)" : "clarified issue routing (final pass)",
              objective_fingerprint: "issue:runxhq-runx-11",
              subject: {
                locator: "runxhq/runx#issue/11",
                target_repo: "runxhq/runx",
              },
            };

        const baseName = artifact.id === 100
          ? "2026-04-19-issue-triage-runxhq-runx-pr-10-proof"
          : artifact.id === 101
            ? "2026-04-20-issue-triage-runxhq-runx-issue-11-first-pass"
            : "2026-04-20-issue-triage-runxhq-runx-issue-11-final-pass";
        const reflectionPath = path.join(promotionsDir, `${baseName}.md`);
        const historyPath = path.join(promotionsDir, `history-${baseName}.md`);
        const packetPath = path.join(promotionsDir, `${baseName}.json`);

        await writeFile(reflectionPath, `# Reflection ${artifact.id}\n`);
        await writeFile(historyPath, `# History ${artifact.id}\n`);
        await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`);
        await writeFile(
          path.join(outputDir, "core-summary.json"),
          `${JSON.stringify({
            lane: "issue-triage",
            promotion_outputs: {
              reflection_path: `/home/runner/work/aster/aster/.artifacts/issue-triage/pr/promotions/${path.basename(reflectionPath)}`,
              history_path: `/home/runner/work/aster/aster/.artifacts/issue-triage/pr/promotions/${path.basename(historyPath)}`,
              packet_path: `/home/runner/work/aster/aster/.artifacts/issue-triage/pr/promotions/${path.basename(packetPath)}`,
            },
          }, null, 2)}\n`,
        );
      },
    },
  );

  const dossier = await readFile(path.join(repoRoot, "state", "targets", "runxhq-runx.md"), "utf8");
  const selectedReflection = await readFile(
    path.join(repoRoot, "reflections", "2026-04-20-issue-triage-runxhq-runx-issue-11-final-pass.md"),
    "utf8",
  );
  const selectedHistory = await readFile(
    path.join(repoRoot, "history", "2026-04-20-issue-triage-runxhq-runx-issue-11-final-pass.md"),
    "utf8",
  );

  assert.equal(report.scanned_artifacts, 4);
  assert.equal(report.candidate_artifacts, 3);
  assert.equal(report.rebuilt_artifacts, 3);
  assert.equal(report.replayed_projection_groups, 2);
  assert.equal(report.applied.length, 1);
  assert.equal(report.applied[0].artifact_id, 102);
  assert.equal(report.suppressed.length, 1);
  assert.equal(report.suppressed[0].artifact_id, 101);
  assert.equal(report.suppressed[0].suppression_reason, "superseded_by_newer_projection");
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].reason, "no_core_summary");
  assert.equal(report.state.stats.tracked_artifacts, 3);
  assert.equal(report.state.stats.newly_processed_artifacts, 2);
  assert.equal(report.state.stats.applied_summaries, 1);
  assert.equal(report.state.stats.suppressed_summaries, 1);
  assert.equal(report.state.stats.skipped_artifacts, 1);
  assert.equal(report.state.artifacts[1].summaries[0].objective_fingerprint, "issue:runxhq-runx-11");
  assert.match(report.state.artifacts[1].summaries[0].projection_key, /issue:runxhq-runx-11/);
  assert.equal(report.state.artifacts[1].summaries[0].promotion_scope, "public");
  assert.deepEqual(report.state.artifacts[1].summaries[0].harness_receipt_refs, [{
    type: "harness_receipt",
    uri: "runx:harness_receipt:rcpt_101",
  }]);
  assert.equal(report.latest_batch.workflow_run_id, "24704064892");
  assert.deepEqual(report.latest_batch.touched_targets, ["runxhq/runx"]);
  assert.equal(report.latest_batch.skipped_reasons.no_core_summary, 1);
  assert.match(dossier, /rcpt_102/);
  assert.match(dossier, /clarified issue routing \(final pass\)/);
  assert.doesNotMatch(dossier, /rcpt_101/);
  assert.match(selectedReflection, /# Reflection 102/);
  assert.match(selectedHistory, /# History 102/);
});

test("deriveEvidenceProjections keeps generic low-signal summaries in state only", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aster-evidence-projections-state-only-"));
  const repoRoot = path.join(tempRoot, "repo");
  const statePath = path.join(repoRoot, "state", "evidence-projections.json");
  await mkdir(path.join(repoRoot, "state"), { recursive: true });

  const report = await deriveEvidenceProjections(
    {
      repoRoot,
      repo: "runxhq/aster",
      output: statePath,
      downloadRoot: path.join(tempRoot, "downloads"),
      now: "2026-04-21T00:00:00Z",
    },
    {
      listArtifacts: async () => ([
        {
          id: 201,
          name: "issue-triage-pr-88",
          created_at: "2026-04-21T00:00:00Z",
          updated_at: "2026-04-21T00:01:00Z",
          expired: false,
          workflow_run: { id: 9100, head_branch: "main", head_sha: "eee555" },
        },
      ]),
      downloadArtifact: async ({ outputDir }) => {
        const promotionsDir = path.join(outputDir, "promotions");
        await mkdir(promotionsDir, { recursive: true });

        const reflectionPath = path.join(promotionsDir, "2026-04-21-issue-triage-pr-88.md");
        const historyPath = path.join(promotionsDir, "history-2026-04-21-issue-triage-pr-88.md");
        const packetPath = path.join(promotionsDir, "2026-04-21-issue-triage-pr-88.json");

        await writeFile(reflectionPath, "# Reflection 201\n");
        await writeFile(historyPath, "# History 201\n");
        await writeFile(
          packetPath,
          `${JSON.stringify(
            {
              created_at: "2026-04-21T00:00:00Z",
              lane: "issue-triage",
              status: "success",
              harness_receipt_refs: [{ type: "harness_receipt", uri: "runx:harness_receipt:rcpt_201" }],
              summary: "lane finished with needs_agent",
              subject: {
                locator: "runxhq/aster#pr/88",
                target_repo: "runxhq/aster",
              },
            },
            null,
            2,
          )}\n`,
        );
        await writeFile(
          path.join(outputDir, "core-summary.json"),
          `${JSON.stringify({
            lane: "issue-triage",
            promotion_outputs: {
              reflection_path: reflectionPath,
              history_path: historyPath,
              packet_path: packetPath,
            },
          }, null, 2)}\n`,
        );
      },
    },
  );

  assert.equal(report.replayed_projection_groups, 1);
  assert.equal(report.state.artifacts[0].summaries[0].promotion_scope, "state_only");
  assert.equal(report.latest_batch.public_projection_groups, 0);
  assert.equal(report.latest_batch.state_only_projection_groups, 1);
  await assert.rejects(
    readFile(path.join(repoRoot, "reflections", "2026-04-21-issue-triage-pr-88.md"), "utf8"),
  );
  await assert.rejects(
    readFile(path.join(repoRoot, "history", "2026-04-21-issue-triage-pr-88.md"), "utf8"),
  );
  await assert.rejects(
    readFile(path.join(repoRoot, "state", "targets", "runxhq-aster.md"), "utf8"),
  );
});

test("renderLatestBatchMarkdown formats the current derive batch for the rolling PR body", () => {
  const markdown = renderLatestBatchMarkdown({
    generated_at: "2026-04-21T04:29:28.856Z",
    workflow_run_id: "24704064892",
    workflow_run_url: "https://github.com/runxhq/aster/actions/runs/24704064892",
    scanned_artifacts: 86,
    new_artifacts: 4,
    rebuilt_artifacts: 86,
    replayed_projection_groups: 23,
    applied_summaries: 7,
    suppressed_summaries: 2,
    public_projection_groups: 4,
    state_only_projection_groups: 3,
    skipped_artifacts: 1,
    error_count: 0,
    touched_targets: ["runxhq/aster", "runxhq/runx"],
    skipped_reasons: {
      no_core_summary: 1,
    },
    error_samples: [],
  });

  assert.match(markdown, /## Latest Batch/);
  assert.match(markdown, /24704064892/);
  assert.match(markdown, /Touched Targets/);
  assert.match(markdown, /runxhq\/runx/);
  assert.match(markdown, /Skip Reasons/);
  assert.match(markdown, /Public projection summaries/);
  assert.match(markdown, /State-only summaries/);
});
