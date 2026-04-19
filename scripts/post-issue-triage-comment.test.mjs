import test from "node:test";
import assert from "node:assert/strict";

import { buildIssueCommentPlan } from "./post-issue-triage-comment.mjs";

test("buildIssueCommentPlan passes a bounded structured issue comment", () => {
  const plan = buildIssueCommentPlan({
    options: {
      repo: "vercel/next.js",
      issue: "42",
      fingerprint: "abc12345deadbeef",
    },
    body: [
      "Thanks for the report.",
      "",
      "- Please narrow this to one failing command in the docs.",
      "- Share the exact command and actual output so the next step is reproducible.",
    ].join("\n"),
    comments: [],
  });

  assert.equal(plan.status, "ready");
  assert.match(plan.comment_body, /aster:runx-issue-triage/);
});

test("buildIssueCommentPlan noops on thin issue comments", () => {
  const plan = buildIssueCommentPlan({
    options: {
      repo: "vercel/next.js",
      issue: "42",
      fingerprint: "abc12345deadbeef",
    },
    body: "Looks good.",
    comments: [],
  });

  assert.equal(plan.status, "noop");
  assert.equal(plan.reason, "comment_quality_needs_review");
});
