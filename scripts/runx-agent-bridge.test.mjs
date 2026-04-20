import test from "node:test";
import assert from "node:assert/strict";

import {
  approvalContextAllowsGate,
  gateSelectorMatches,
} from "./runx-agent-bridge.mjs";

test("gateSelectorMatches supports exact and wildcard gate selectors", () => {
  assert.equal(gateSelectorMatches("issue-triage.plan", "issue-triage.plan"), true);
  assert.equal(gateSelectorMatches("issue-triage.*", "issue-triage.plan"), true);
  assert.equal(gateSelectorMatches("issue-triage.*", "fix-pr.review"), false);
});

test("approvalContextAllowsGate auto-approves only explicitly scoped gates", () => {
  const approvalContext = {
    applies_to: ["issue-triage.plan", "fix-pr.review"],
    decisions: [
      {
        gate_id: "issue-triage.build",
      },
    ],
  };

  assert.equal(approvalContextAllowsGate(approvalContext, { id: "issue-triage.plan" }), true);
  assert.equal(approvalContextAllowsGate(approvalContext, { id: "issue-triage.build" }), true);
  assert.equal(approvalContextAllowsGate(approvalContext, { id: "docs-pr.publish" }), false);
});
