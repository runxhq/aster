import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
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
