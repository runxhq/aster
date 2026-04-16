import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPromotionDrafts,
  extractRunSignal,
} from "./promote-automaton-state.mjs";

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
        locator: "nilstate/automaton#issue/101",
      },
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
  assert.match(drafts.history.content, /README command drift/);
  assert.equal(drafts.packet.receipt_id, "rcpt_123");
});
