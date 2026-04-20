import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  buildContextBundle,
  renderContextPrompt,
  slugifyRepoLike,
} from "./build-aster-context.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("slugifyRepoLike normalizes repo locators", () => {
  assert.equal(slugifyRepoLike("nilstate/aster"), "nilstate-aster");
});

test("buildContextBundle loads doctrine, state, and target dossier", async () => {
  const bundle = await buildContextBundle({
    repoRoot,
    lane: "issue-triage",
    subjectKind: "github_issue",
    subjectLocator: "nilstate/aster#issue/42",
    repo: "nilstate/aster",
    targetRepo: "nilstate/aster",
  });

  assert.equal(bundle.lane, "issue-triage");
  assert.equal(bundle.subject.kind, "github_issue");
  assert.ok(bundle.state.control);
  assert.equal(bundle.state.target?.title, "Target Dossier — nilstate/aster");
  assert.ok(bundle.state.target_summary?.default_lanes.includes("issue-triage"));
  assert.ok(bundle.state.target_summary?.current_opportunities.length >= 1);
  assert.ok(bundle.doctrine.some((doc) => doc.title === "Aster Thesis"));
  assert.ok(bundle.history.length >= 1);
  assert.ok(bundle.reflections.length >= 1);
});

test("renderContextPrompt includes doctrine and state sections", async () => {
  const bundle = await buildContextBundle({
    repoRoot,
    lane: "issue-triage",
    subjectKind: "github_pull_request",
    subjectLocator: "nilstate/aster#pr/7",
    repo: "nilstate/aster",
    targetRepo: "nilstate/runx",
  });

  const prompt = renderContextPrompt(bundle);
  assert.match(prompt, /# Aster Context Bundle/);
  assert.match(prompt, /## Doctrine/);
  assert.match(prompt, /## Current State/);
  assert.match(prompt, /### Live Control/);
  assert.match(prompt, /### Target Summary/);
  assert.match(prompt, /Target Dossier/);
});

test("buildContextBundle and prompt carry explicit approval context", async () => {
  const bundle = await buildContextBundle({
    repoRoot,
    lane: "docs-pr",
    subjectKind: "repository",
    subjectLocator: "nilstate/aster",
    repo: "nilstate/aster",
    targetRepo: "nilstate/aster",
    approvalSource: "issue_comment",
    approvalSourceUrl: "https://github.com/nilstate/aster/issues/42#issuecomment-1",
    approvalRationale: "Keep the change bounded to the docs surface and preserve the public governance story.",
    approvalNotes: ["Prefer explicit review notes over hidden operator intuition."],
    approvalInvariants: ["Do not widen authority beyond the current lane."],
    approvedBy: "kam",
  });

  assert.equal(bundle.approval_context?.source, "issue_comment");
  assert.deepEqual(bundle.approval_context?.shared_invariants, ["Do not widen authority beyond the current lane."]);

  const prompt = renderContextPrompt(bundle);
  assert.match(prompt, /## Active Approval Context/);
  assert.match(prompt, /issue_comment/);
  assert.match(prompt, /Do not widen authority beyond the current lane/);
  assert.match(prompt, /Prefer explicit review notes over hidden operator intuition/);
});

test("buildContextBundle merges file-derived approval context with explicit overrides", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aster-approval-context-"));
  const approvalContextPath = path.join(tempDir, "approval-context.json");

  await writeFile(
    approvalContextPath,
    `${JSON.stringify({
      source: "issue_comment",
      source_url: "https://github.com/nilstate/aster/issues/42#issuecomment-2",
      rationale: "Stay inside the bounded issue-to-plan surface.",
      approved_by: "kam",
      operator_notes: [
        "Cite the prior approval context back to the maintainer when reusing it.",
      ],
      shared_invariants: [
        "Do not open a PR until triage explicitly approves build.",
      ],
      decisions: [
        {
          gate_id: "issue-triage.plan",
          reason: "Planning is approved; build is still gated.",
        },
      ],
    }, null, 2)}\n`,
  );

  try {
    const bundle = await buildContextBundle({
      repoRoot,
      lane: "issue-triage",
      subjectKind: "github_issue",
      subjectLocator: "nilstate/aster#issue/42",
      repo: "nilstate/aster",
      targetRepo: "nilstate/aster",
      approvalContextFile: approvalContextPath,
      approvalNotes: [
        "Reflect any reused approval context into the receipt packet.",
      ],
    });

    assert.equal(bundle.approval_context?.source, "issue_comment");
    assert.equal(bundle.approval_context?.approved_by, "kam");
    assert.deepEqual(bundle.approval_context?.shared_invariants, [
      "Do not open a PR until triage explicitly approves build.",
    ]);
    assert.deepEqual(bundle.approval_context?.operator_notes, [
      "Cite the prior approval context back to the maintainer when reusing it.",
      "Reflect any reused approval context into the receipt packet.",
    ]);
    assert.deepEqual(bundle.approval_context?.decisions, [
      {
        gate_id: "issue-triage.plan",
        reason: "Planning is approved; build is still gated.",
      },
    ]);

    const prompt = renderContextPrompt(bundle);
    assert.match(prompt, /Stay inside the bounded issue-to-plan surface/);
    assert.match(prompt, /issue-triage\.plan/);
    assert.match(prompt, /Reflect any reused approval context into the receipt packet/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("renderContextPrompt surfaces authority and dispatch state from control records", () => {
  const prompt = renderContextPrompt({
    generated_at: "2026-04-17T00:00:00Z",
    lane: "issue-triage",
    subject: {
      kind: "github_issue",
      locator: "nilstate/runx#issue/42",
      repo: "nilstate/aster",
      target_repo: "nilstate/runx",
      issue_number: "42",
      pr_number: null,
      issue_url: null,
    },
    doctrine: [],
    state: {
      control: {
        targets: [
          {
            target_id: "nilstate-runx",
            repo: "nilstate/runx",
            state: "active",
            lifecycle: {
              last_evaluated_at: "2026-04-17T00:00:00Z",
              last_selected_at: "2026-04-17T00:00:00Z",
              last_dispatched_at: "2026-04-17T00:00:00Z",
              last_cycle_id: "cycle-20260417000000",
              last_cycle_status: "dispatched",
              last_transition_reason: "highest_non_vetoed_score",
              evaluated_count: 4,
              selected_count: 2,
              dispatched_count: 1,
            },
          },
        ],
        priorities: [],
        cycle_records: [
          {
            cycle_id: "cycle-20260417000000",
            priority_ids: [],
            selected_priority_id: null,
            status: "dispatched",
            reason: "highest_non_vetoed_score",
            selected_bucket: "thesis_work",
            budget_snapshot: {
              window_size: 10,
              current_counts: {
                thesis_work: 1,
                context_improvement: 0,
                runtime_proof_work: 0,
              },
              projected_counts: {
                thesis_work: 2,
                context_improvement: 0,
                runtime_proof_work: 0,
              },
              target_mix: {
                thesis_work: 0.7,
                context_improvement: 0.2,
                runtime_proof_work: 0.1,
              },
            },
            authority: {
              scope: "public_triage",
              approval_mode: "workflow_gate",
              requires_human_approval: true,
              policy_basis: "issue_triage_public_routing_with_workflow_gates",
              target_repo: "nilstate/runx",
            },
            dispatch: {
              status: "dispatched",
              workflow: "issue-triage.yml",
              ref: "main",
              target_repo: "nilstate/runx",
              subject_locator: "nilstate/runx#issue/42",
              score: 0.82,
              inputs: {
                target_repo: "nilstate/runx",
                issue_number: "42",
              },
            },
            generated_at: "2026-04-17T00:00:00Z",
          },
        ],
      },
      priorities: null,
      capabilities: null,
      target: null,
      target_summary: null,
    },
    history: [],
    reflections: [],
    artifact_signals: [],
    snapshot: null,
  });

  assert.match(prompt, /latest authority scope: `public_triage`/);
  assert.match(prompt, /latest approval mode: `workflow_gate`/);
  assert.match(prompt, /latest dispatch status: `dispatched`/);
  assert.match(prompt, /selected target dispatches: `1`/);
});
