import test from "node:test";
import assert from "node:assert/strict";

import {
  THREAD_TEACHING_MARKER,
  deriveThreadTeachingContext,
  parseThreadTeachingRecordBody,
  threadTeachingContextAllowsGate,
  threadTeachingRecordMatchesCriteria,
} from "./thread-teaching.mjs";

test("parseThreadTeachingRecordBody extracts generic thread-teaching fields", () => {
  const parsed = parseThreadTeachingRecordBody([
    THREAD_TEACHING_MARKER,
    "Kind: publish_authorization",
    "Summary: Human reviewed the request and approved one draft docs PR.",
    "Recorded By: kam",
    "Target Repo: nilstate/runx",
    "Subject Locator: nilstate/runx",
    "Objective Fingerprint: issue:docs-42",
    "Applies To: docs-pr.publish",
    "Label: docs, publish",
    "Invariant: Do not widen into runtime changes.",
    "Notes:",
    "- Keep the PR draft-only.",
    "Decisions:",
    "- docs-pr.publish = allow | bounded publication is approved",
  ].join("\n"));

  assert.equal(parsed?.kind, "publish_authorization");
  assert.equal(parsed?.summary, "Human reviewed the request and approved one draft docs PR.");
  assert.equal(parsed?.recorded_by, "kam");
  assert.equal(parsed?.target_repo, "nilstate/runx");
  assert.equal(parsed?.subject_locator, "nilstate/runx");
  assert.equal(parsed?.objective_fingerprint, "issue:docs-42");
  assert.deepEqual(parsed?.applies_to, ["docs-pr.publish"]);
  assert.deepEqual(parsed?.labels, ["docs", "publish"]);
  assert.deepEqual(parsed?.invariants, ["Do not widen into runtime changes."]);
  assert.deepEqual(parsed?.notes, ["Keep the PR draft-only."]);
  assert.deepEqual(parsed?.decisions, [
    {
      gate_id: "docs-pr.publish",
      decision: "allow",
      reason: "bounded publication is approved",
    },
  ]);
});

test("parseThreadTeachingRecordBody accepts the work issue form block", () => {
  const parsed = parseThreadTeachingRecordBody([
    "### Thread Teaching Record",
    "",
    THREAD_TEACHING_MARKER,
    "Kind: approval",
    "Summary: Planning may proceed for this issue.",
    "Recorded By: kam",
    "Target Repo: nilstate/runx",
    "Subject Locator: nilstate/runx#issue/42",
    "Applies To: issue-triage.plan",
    "Decision: issue-triage.plan = allow | planning is approved",
    "",
    "### Optional Rationale",
    "",
    "Bound the work before any build lane starts.",
  ].join("\n"));

  assert.equal(parsed?.kind, "approval");
  assert.equal(parsed?.summary, "Planning may proceed for this issue.");
  assert.equal(parsed?.target_repo, "nilstate/runx");
  assert.deepEqual(parsed?.applies_to, ["issue-triage.plan"]);
});

test("parseThreadTeachingRecordBody accepts a plain field block without the marker", () => {
  const parsed = parseThreadTeachingRecordBody([
    "Kind: lesson",
    "Summary: Keep the work issue as the living ledger.",
    "Recorded By: kam",
    "Target Repo: nilstate/runx",
  ].join("\n"));

  assert.equal(parsed?.kind, "lesson");
  assert.equal(parsed?.summary, "Keep the work issue as the living ledger.");
  assert.equal(parsed?.recorded_by, "kam");
  assert.equal(parsed?.target_repo, "nilstate/runx");
});

test("parseThreadTeachingRecordBody infers a gate approval from Applies To and Decision lines", () => {
  const parsed = parseThreadTeachingRecordBody([
    "Applies To: skill-lab.publish",
    "",
    "Decision: skill-lab.publish = allow | the decision-brief proposal is approved to refresh one draft PR from this same work ledger",
  ].join("\n"));

  assert.equal(parsed?.kind, "publish_authorization");
  assert.equal(parsed?.summary, "Trusted thread reply authorized skill-lab.publish=allow.");
  assert.deepEqual(parsed?.applies_to, ["skill-lab.publish"]);
  assert.deepEqual(parsed?.decisions, [
    {
      gate_id: "skill-lab.publish",
      decision: "allow",
      reason: "the decision-brief proposal is approved to refresh one draft PR from this same work ledger",
    },
  ]);
});

test("deriveThreadTeachingContext keeps the newest trusted matching records", () => {
  const context = deriveThreadTeachingContext([
    {
      source_type: "issue_comment",
      author: "random-user",
      author_association: "NONE",
      body: `${THREAD_TEACHING_MARKER}\nKind: approval\nSummary: Ignore this.\nApplies To: issue-triage.plan`,
      url: "https://example.com/1",
      created_at: "2026-04-20T00:00:00Z",
    },
    {
      source_type: "issue_comment",
      author: "kam",
      author_association: "OWNER",
      body: [
        THREAD_TEACHING_MARKER,
        "Kind: approval",
        "Summary: Planning is approved for this issue.",
        "Objective Fingerprint: issue:runx-42",
        "Applies To: issue-triage.plan",
        "Decision: issue-triage.plan = allow | planning may start",
      ].join("\n"),
      url: "https://example.com/2",
      created_at: "2026-04-20T01:00:00Z",
    },
    {
      source_type: "issue_comment",
      author: "kam",
      author_association: "OWNER",
      body: [
        THREAD_TEACHING_MARKER,
        "Kind: lesson",
        "Summary: Quote the bounded plan back to the maintainer.",
        "Objective Fingerprint: issue:runx-42",
      ].join("\n"),
      url: "https://example.com/3",
      created_at: "2026-04-20T02:00:00Z",
    },
  ], {
    objectiveFingerprint: "issue:runx-42",
    appliesTo: ["issue-triage.plan"],
    now: "2026-04-20T03:00:00Z",
  });

  assert.equal(context?.records.length, 2);
  assert.equal(context?.records[0]?.kind, "lesson");
  assert.equal(context?.records[1]?.kind, "approval");
  assert.equal(threadTeachingContextAllowsGate(context, { id: "issue-triage.plan" }), true);
  assert.equal(threadTeachingContextAllowsGate(context, { id: "docs-pr.publish" }), false);
});

test("deriveThreadTeachingContext allows a markerless trusted publish approval comment", () => {
  const context = deriveThreadTeachingContext([
    {
      source_type: "issue_comment",
      author: "auscaster",
      author_association: "MEMBER",
      body: [
        "Applies To: skill-lab.publish",
        "",
        "Decision: skill-lab.publish = allow | refresh one draft PR from this same work ledger",
      ].join("\n"),
      url: "https://example.com/4",
      created_at: "2026-04-22T15:36:27Z",
    },
  ], {
    repo: "nilstate/aster",
    threadKind: "issue",
    threadNumber: "115",
    appliesTo: ["skill-lab.publish"],
    now: "2026-04-22T15:40:00Z",
  });

  assert.equal(threadTeachingContextAllowsGate(context, { id: "skill-lab.publish" }), true);
  assert.equal(context?.records[0]?.kind, "publish_authorization");
});

test("threadTeachingRecordMatchesCriteria rejects expired or mismatched records", () => {
  const record = {
    kind: "approval",
    summary: "Keep this bounded.",
    objective_fingerprint: "issue:runx-42",
    applies_to: ["issue-triage.plan"],
    expires_after: "2026-04-21T00:00:00Z",
    status: "active",
  };

  assert.equal(threadTeachingRecordMatchesCriteria(record, {
    objectiveFingerprint: "issue:runx-42",
    appliesTo: ["issue-triage.plan"],
    now: "2026-04-20T00:00:00Z",
  }), true);
  assert.equal(threadTeachingRecordMatchesCriteria(record, {
    objectiveFingerprint: "issue:runx-999",
    appliesTo: ["issue-triage.plan"],
    now: "2026-04-20T00:00:00Z",
  }), false);
  assert.equal(threadTeachingRecordMatchesCriteria(record, {
    objectiveFingerprint: "issue:runx-42",
    appliesTo: ["fix-pr.publish"],
    now: "2026-04-20T00:00:00Z",
  }), false);
  assert.equal(threadTeachingRecordMatchesCriteria({
    ...record,
    status: "expired",
  }, {
    objectiveFingerprint: "issue:runx-42",
    appliesTo: ["issue-triage.plan"],
    now: "2026-04-22T00:00:00Z",
  }), false);
});
