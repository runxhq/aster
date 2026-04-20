import test from "node:test";
import assert from "node:assert/strict";

import {
  APPROVAL_CONTEXT_MARKER,
  approvalContextMatchesCriteria,
  deriveApprovalContext,
  parseApprovalContextBody,
} from "./derive-approval-context.mjs";

test("parseApprovalContextBody extracts rationale, invariants, and notes", () => {
  const parsed = parseApprovalContextBody([
    "some unrelated thread text",
    APPROVAL_CONTEXT_MARKER,
    "Rationale: Keep this bounded to one docs-only draft PR.",
    "Applies To: issue-triage.plan, issue-triage.build",
    "Objective Fingerprint: issue:docs-42",
    "Expires After: 2026-04-27T00:00:00Z",
    "Invariants:",
    "- Do not touch runtime code.",
    "- Leave the result draft-only.",
    "Notes:",
    "- Prefer editing existing docs over adding abstraction.",
  ].join("\n"));

  assert.equal(parsed?.rationale, "Keep this bounded to one docs-only draft PR.");
  assert.deepEqual(parsed?.shared_invariants, [
    "Do not touch runtime code.",
    "Leave the result draft-only.",
  ]);
  assert.deepEqual(parsed?.operator_notes, [
    "Prefer editing existing docs over adding abstraction.",
  ]);
  assert.deepEqual(parsed?.applies_to, ["issue-triage.plan", "issue-triage.build"]);
  assert.equal(parsed?.objective_fingerprint, "issue:docs-42");
  assert.equal(parsed?.expires_after, "2026-04-27T00:00:00Z");
});

test("deriveApprovalContext picks the latest trusted maintainer context that matches the current run", () => {
  const context = deriveApprovalContext([
    {
      source_type: "issue_comment",
      author: "random-user",
      author_association: "NONE",
      body: `${APPROVAL_CONTEXT_MARKER}\nRationale: Ignore this.`,
      url: "https://example.com/1",
      created_at: "2026-04-20T00:00:00Z",
    },
    {
      source_type: "issue_comment",
      author: "kam",
      author_association: "OWNER",
      body: `${APPROVAL_CONTEXT_MARKER}\nRationale: Keep it narrow.\nApplies To: issue-triage.plan\nObjective Fingerprint: issue:runx-42\nInvariant: No runtime changes.`,
      url: "https://example.com/2",
      created_at: "2026-04-20T01:00:00Z",
    },
    {
      source_type: "pull_request_review",
      author: "kam",
      author_association: "OWNER",
      body: `${APPROVAL_CONTEXT_MARKER}\nKeep the comment focused on one concrete unblock.\nApplies To: fix-pr.review\nObjective Fingerprint: pr:head-1\nNotes:\n- Do not restate the whole thread.`,
      url: "https://example.com/3",
      created_at: "2026-04-20T02:00:00Z",
    },
  ], {
    objectiveFingerprint: "issue:runx-42",
    appliesTo: ["issue-triage.plan"],
    now: "2026-04-20T03:00:00Z",
  });

  assert.equal(context?.source, "issue_comment");
  assert.equal(context?.source_url, "https://example.com/2");
  assert.equal(context?.approved_by, "kam");
  assert.equal(context?.rationale, "Keep it narrow.");
  assert.deepEqual(context?.shared_invariants, ["No runtime changes."]);
  assert.deepEqual(context?.applies_to, ["issue-triage.plan"]);
});

test("approvalContextMatchesCriteria rejects expired or mismatched approval guidance", () => {
  const context = parseApprovalContextBody([
    APPROVAL_CONTEXT_MARKER,
    "Rationale: Keep it bounded.",
    "Applies To:",
    "- issue-triage.plan",
    "- issue-triage.build",
    "Objective Fingerprint: issue:runx-42",
    "Expires After: 2026-04-21T00:00:00Z",
  ].join("\n"));

  assert.equal(approvalContextMatchesCriteria(context, {
    objectiveFingerprint: "issue:runx-42",
    appliesTo: ["issue-triage.plan"],
    now: "2026-04-20T00:00:00Z",
  }), true);
  assert.equal(approvalContextMatchesCriteria(context, {
    objectiveFingerprint: "issue:runx-999",
    appliesTo: ["issue-triage.plan"],
    now: "2026-04-20T00:00:00Z",
  }), false);
  assert.equal(approvalContextMatchesCriteria(context, {
    objectiveFingerprint: "issue:runx-42",
    appliesTo: ["fix-pr.review"],
    now: "2026-04-20T00:00:00Z",
  }), false);
  assert.equal(approvalContextMatchesCriteria(context, {
    objectiveFingerprint: "issue:runx-42",
    appliesTo: ["issue-triage.plan"],
    now: "2026-04-22T00:00:00Z",
  }), false);
});
