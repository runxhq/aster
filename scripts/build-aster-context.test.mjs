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
  assert.equal(bundle.objective_fingerprint, null);
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

test("buildContextBundle and prompt carry thread teaching context", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aster-thread-teaching-"));
  const threadTeachingContextPath = path.join(tempDir, "thread-teaching-context.json");

  await writeFile(
    threadTeachingContextPath,
    `${JSON.stringify({
      records: [
        {
          record_id: "record-1",
          kind: "approval",
          summary: "Stay inside the bounded issue-to-plan surface.",
          recorded_by: "kam",
          source_type: "issue_comment",
          source_url: "https://github.com/nilstate/aster/issues/42#issuecomment-2",
          objective_fingerprint: "issue:runx-42",
          applies_to: ["issue-triage.plan"],
          invariants: [
            "Do not open a PR until triage explicitly approves build.",
          ],
          notes: [
            "Cite the prior thread teaching back to the maintainer when reusing it.",
          ],
          labels: ["triage"],
          decisions: [
            {
              gate_id: "issue-triage.plan",
              decision: "allow",
              reason: "Planning is approved; build is still gated.",
            },
          ],
          supersedes: [],
          repo: "nilstate/aster",
          thread_kind: "issue",
          thread_number: 42,
          author: "kam",
          author_association: "OWNER",
          recorded_at: "2026-04-20T01:00:00Z",
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
      objectiveFingerprint: "issue:runx-42",
      threadTeachingContextFile: threadTeachingContextPath,
      threadTeachingAppliesTo: [
        "issue-triage.plan",
      ],
    });

    assert.equal(bundle.thread_teaching_context?.records[0]?.source_type, "issue_comment");
    assert.equal(bundle.objective_fingerprint, "issue:runx-42");
    assert.equal(bundle.thread_teaching_context?.records[0]?.recorded_by, "kam");
    assert.deepEqual(bundle.thread_teaching_context?.records[0]?.invariants, [
      "Do not open a PR until triage explicitly approves build.",
    ]);
    assert.deepEqual(bundle.thread_teaching_context?.records[0]?.notes, [
      "Cite the prior thread teaching back to the maintainer when reusing it.",
    ]);
    assert.deepEqual(bundle.thread_teaching_context?.records[0]?.decisions, [
      {
        gate_id: "issue-triage.plan",
        decision: "allow",
        reason: "Planning is approved; build is still gated.",
      },
    ]);

    const prompt = renderContextPrompt(bundle);
    assert.match(prompt, /Stay inside the bounded issue-to-plan surface/);
    assert.match(prompt, /issue-triage\.plan/);
    assert.match(prompt, /## Active Thread Teaching/);
    assert.match(prompt, /objective_fingerprint: `issue:runx-42`/);
    assert.match(prompt, /Do not open a PR until triage explicitly approves build/);
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

test("renderContextPrompt strips machine status comment bodies from issue-ledger snapshots", () => {
  const prompt = renderContextPrompt({
    generated_at: "2026-04-21T00:00:00Z",
    lane: "skill-lab",
    subject: {
      kind: "github_issue",
      locator: "nilstate/aster#issue/110",
      repo: "nilstate/aster",
      target_repo: "nilstate/aster",
      issue_number: "110",
      pr_number: null,
      issue_url: "https://github.com/nilstate/aster/issues/110",
    },
    doctrine: [],
    state: {
      control: null,
      priorities: null,
      capabilities: null,
      target: null,
      target_summary: null,
    },
    history: [],
    reflections: [],
    artifact_signals: [],
    snapshot: {
      kind: "runx.aster-issue-ledger.v2",
      generated_at: "2026-04-21T00:00:00Z",
      repo: "nilstate/aster",
      issue: {
        number: 110,
        title: "[skill] Collaboration subject distillation",
      },
      comments: [
        {
          id: 1,
          body: "Hard-cut the contract to subject_locator, subject_memory, and publication_target.",
          is_machine_status_comment: false,
        },
      ],
      machine_status_comments: [
        {
          id: 2,
          body: "Opened draft PR for this run: https://github.com/nilstate/aster/pull/111",
          created_at: "2026-04-21T07:25:06Z",
          url: "https://github.com/nilstate/aster/issues/110#issuecomment-2",
          is_machine_status_comment: true,
        },
      ],
      trusted_human_comments: [],
      amendments: [],
      comment_summary: {
        total_count: 2,
        substantive_count: 1,
        machine_status_count: 1,
        latest_machine_status_comment_at: "2026-04-21T07:25:06Z",
        latest_machine_status_comment_url: "https://github.com/nilstate/aster/issues/110#issuecomment-2",
      },
      amendment_summary: {
        trusted_human_comment_count: 0,
        included_count: 0,
        omitted_count: 0,
        latest_trusted_human_comment_at: null,
        latest_trusted_human_comment_url: null,
      },
      ledger_revision: "deadbeefcafebabe",
      ledger_body: "# Issue Ledger",
    },
  });

  assert.match(prompt, /machine_status_count\": 1/);
  assert.doesNotMatch(prompt, /Opened draft PR for this run/);
  assert.match(prompt, /Hard-cut the contract to subject_locator, subject_memory, and publication_target/);
});
