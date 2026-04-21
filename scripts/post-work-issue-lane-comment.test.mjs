import test from "node:test";
import assert from "node:assert/strict";

import { buildWorkIssueLaneComment } from "./post-work-issue-lane-comment.mjs";

test("buildWorkIssueLaneComment renders a rolling work-lane status comment", () => {
  const comment = buildWorkIssueLaneComment({
    lane: "docs-pr",
    requestTitle: "Clarify the docs-pr flow.",
    targetRepo: "nilstate/aster",
    runUrl: "https://github.com/nilstate/aster/actions/runs/321",
    ledgerRevision: "deadbeefcafebabe",
    publish: {
      status: "published",
      pr_number: 120,
      pr_url: "https://github.com/nilstate/aster/pull/120",
    },
    workflowStatus: "success",
  });

  assert.match(comment, /aster:runx-work-lane:docs-pr/);
  assert.match(comment, /Draft PR: \[#120\]/);
  assert.match(comment, /Ledger revision: `deadbeefcafebabe`/);
  assert.match(comment, /Trusted maintainer replies rerun the lane/);
});

test("buildWorkIssueLaneComment uses proposal_refreshed for non-published upstream runs", () => {
  const comment = buildWorkIssueLaneComment({
    lane: "skill-upstream",
    requestTitle: "Add a portable SKILL.md",
    targetRepo: "nilstate/icey-cli",
    publish: {
      status: "not_requested",
    },
    workflowStatus: "success",
  });

  assert.match(comment, /Status: `proposal_refreshed`/);
  assert.match(comment, /Publish gate: authorize `skill-upstream\.publish` on this issue to refresh the draft PR/);
});
