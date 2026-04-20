import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPromotionDrafts,
  extractRunSignal,
} from "./promote-aster-state.mjs";

test("extractRunSignal prefers triage summaries from execution stdout", () => {
  const signal = extractRunSignal({
    status: "completed",
    execution: {
      stdout: JSON.stringify({
        triage_report: {
          summary: "README command drift",
          recommended_lane: "issue-to-pr",
        },
      }),
    },
  });

  assert.equal(signal.summary, "README command drift");
  assert.equal(signal.recommended_lane, "issue-to-pr");
});

test("buildPromotionDrafts creates reflection and history drafts", () => {
  const drafts = buildPromotionDrafts({
    lane: "issue-triage",
    now: new Date("2026-04-16T00:00:00Z"),
    contextBundle: {
      subject: {
        locator: "nilstate/aster#issue/101",
      },
      approval_context: {
        source: "issue_comment",
        source_url: "https://github.com/nilstate/aster/issues/101#issuecomment-1",
        rationale: "Keep the action reviewable and bounded.",
        approved_by: "kam",
        operator_notes: ["Prefer a draft PR over a direct mutation."],
        shared_invariants: ["Do not widen scope beyond docs."],
      },
      approval_decisions: [
        {
          gate_id: "gate.alpha",
          gate_reason: "public PR creation requires review",
        },
      ],
    },
    runResult: {
      status: "completed",
      receipt: {
        id: "rcpt_123",
      },
      execution: {
        stdout: JSON.stringify({
          triage_report: {
            summary: "README command drift",
          },
        }),
      },
    },
  });

  assert.match(drafts.reflection.filename, /^2026-04-16-issue-triage-/);
  assert.match(drafts.reflection.content, /## What Happened/);
  assert.match(drafts.reflection.content, /rcpt_123/);
  assert.match(drafts.reflection.content, /## Approval Context/);
  assert.match(drafts.reflection.content, /Prefer a draft PR over a direct mutation/);
  assert.match(drafts.reflection.content, /gate\.alpha/);
  assert.match(drafts.history.content, /receipt_id: rcpt_123/);
  assert.match(drafts.history.content, /README command drift/);
  assert.equal(drafts.packet.approval_context?.approved_by, "kam");
  assert.equal(drafts.packet.approval_decisions[0]?.gate_id, "gate.alpha");
  assert.equal(drafts.packet.receipt_id, "rcpt_123");
});
