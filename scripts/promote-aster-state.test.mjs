import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPromotionDrafts,
  extractRunSignal,
} from "./promote-aster-state.mjs";

test("extractRunSignal prefers intake summaries from sealed payloads", () => {
  const signal = extractRunSignal({
    schema: "runx.skill_run.v1",
    status: "sealed",
    payload: {
      intake_report: {
        summary: "README command drift",
        recommended_lane: "issue-to-pr",
      },
    },
  });

  assert.equal(signal.summary, "README command drift");
  assert.equal(signal.recommended_lane, "issue-to-pr");
});

test("extractRunSignal falls back to skill proposal summary when triage data is absent", () => {
  const signal = extractRunSignal({
    schema: "runx.skill_run.v1",
    status: "sealed",
    payload: {
      skill_spec: {
        name: "issue-ledger-followup",
        summary: "Emit one bounded next-action packet from the living issue ledger.",
        objective: "Keep the issue as the living ledger.",
      },
    },
  });

  assert.equal(signal.summary, "Emit one bounded next-action packet from the living issue ledger.");
  assert.equal(signal.objective_summary, "Keep the issue as the living ledger.");
});

test("buildPromotionDrafts creates reflection and history drafts", () => {
  const drafts = buildPromotionDrafts({
    lane: "issue-triage",
    now: new Date("2026-04-16T00:00:00Z"),
    contextBundle: {
      objective_fingerprint: "issue:aster-101",
      subject: {
        locator: "runxhq/aster#issue/101",
      },
      thread_teaching_context: {
        records: [
          {
            kind: "approval",
            summary: "Keep the action reviewable and bounded.",
            source_url: "https://github.com/runxhq/aster/issues/101#issuecomment-1",
            recorded_by: "kam",
            notes: ["Prefer a draft PR over a direct mutation."],
            invariants: ["Do not widen scope beyond docs."],
          },
        ],
      },
      gate_decisions: [
        {
          gate_id: "gate.alpha",
          authorization_reason: "public PR creation requires review",
        },
      ],
    },
    runResult: {
      schema: "runx.skill_run.v1",
      status: "sealed",
      receipt_id: "hrn_rcpt_123",
      payload: {
        skill_spec: {
          name: "issue-ledger-followup",
          kind: "skill",
          status: "proposed",
          summary: "Emit one bounded next-action packet from the living issue ledger.",
          objective: "Keep the issue as the living ledger.",
        },
        findings: [
          {
            claim: "The issue thread is canonical.",
          },
        ],
        recommended_flow: [
          {
            step: "Read the issue thread first.",
          },
        ],
        acceptance_checks: [
          {
            id: "ac-one-packet",
            assertion: "emit one packet",
          },
        ],
        risks: [
          {
            risk: "Thin stub output",
          },
        ],
        intake_report: {
          summary: "README command drift",
        },
      },
    },
  });

  assert.match(drafts.reflection.filename, /^2026-04-16-issue-triage-/);
  assert.match(drafts.reflection.content, /## What Happened/);
  assert.match(drafts.reflection.content, /runx:harness_receipt:hrn_rcpt_123/);
  assert.match(drafts.reflection.content, /## Thread Teaching/);
  assert.match(drafts.reflection.content, /Prefer a draft PR over a direct mutation/);
  assert.match(drafts.reflection.content, /gate\.alpha/);
  assert.match(drafts.reflection.content, /## Proposal Objective/);
  assert.match(drafts.reflection.content, /Keep the issue as the living ledger/);
  assert.match(drafts.reflection.content, /## Findings/);
  assert.match(drafts.reflection.content, /The issue thread is canonical/);
  assert.match(drafts.reflection.content, /## Recommended Flow/);
  assert.match(drafts.reflection.content, /Read the issue thread first/);
  assert.match(drafts.reflection.content, /## Acceptance Checks/);
  assert.match(drafts.reflection.content, /`ac-one-packet`: emit one packet/);
  assert.match(drafts.reflection.content, /## Risks/);
  assert.match(drafts.reflection.content, /Thin stub output/);
  assert.match(drafts.history.content, /harness_receipt_ref: runx:harness_receipt:hrn_rcpt_123/);
  assert.match(drafts.history.content, /objective_fingerprint: issue:aster-101/);
  assert.match(drafts.history.content, /README command drift/);
  assert.equal(drafts.packet.proposal?.name, "issue-ledger-followup");
  assert.equal(drafts.packet.thread_teaching_context?.records[0]?.recorded_by, "kam");
  assert.equal(drafts.packet.gate_decisions[0]?.gate_id, "gate.alpha");
  assert.deepEqual(drafts.packet.harness_receipt_refs, [{
    type: "harness_receipt",
    uri: "runx:harness_receipt:hrn_rcpt_123",
  }]);
  assert.equal(drafts.packet.objective_fingerprint, "issue:aster-101");
});
