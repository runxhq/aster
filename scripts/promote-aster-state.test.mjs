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
      objective_fingerprint: "issue:aster-101",
      subject: {
        locator: "nilstate/aster#issue/101",
      },
      thread_teaching_context: {
        records: [
          {
            kind: "approval",
            summary: "Keep the action reviewable and bounded.",
            source_url: "https://github.com/nilstate/aster/issues/101#issuecomment-1",
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
  assert.match(drafts.reflection.content, /## Thread Teaching/);
  assert.match(drafts.reflection.content, /Prefer a draft PR over a direct mutation/);
  assert.match(drafts.reflection.content, /gate\.alpha/);
  assert.match(drafts.history.content, /receipt_id: rcpt_123/);
  assert.match(drafts.history.content, /objective_fingerprint: issue:aster-101/);
  assert.match(drafts.history.content, /README command drift/);
  assert.equal(drafts.packet.thread_teaching_context?.records[0]?.recorded_by, "kam");
  assert.equal(drafts.packet.gate_decisions[0]?.gate_id, "gate.alpha");
  assert.equal(drafts.packet.receipt_id, "rcpt_123");
  assert.equal(drafts.packet.objective_fingerprint, "issue:aster-101");
});
