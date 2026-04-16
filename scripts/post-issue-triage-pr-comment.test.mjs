import test from "node:test";
import assert from "node:assert/strict";

import { buildCommentPlan } from "./post-issue-triage-pr-comment.mjs";

test("buildCommentPlan noops for bot-authored dependency update PRs", () => {
  const plan = buildCommentPlan({
    options: {
      repo: "astral-sh/uv",
      pr: "18991",
      sha: "981d08a",
    },
    body: "Automaton triage",
    runner() {
      return JSON.stringify({
        title: "Update Rust crate similar to v3",
        author: { login: "app/renovate" },
        headRefName: "renovate/similar-3.x",
        labels: [{ name: "internal" }, { name: "build:artifacts" }],
        comments: [],
      });
    },
  });

  assert.equal(plan.status, "noop");
  assert.match(plan.reasons.join(","), /bot_authored_pull_request/);
  assert.match(plan.reasons.join(","), /dependency_update_pull_request/);
});

test("buildCommentPlan includes marker and sha for eligible PRs", () => {
  const plan = buildCommentPlan({
    options: {
      repo: "vercel/next.js",
      pr: "101",
      sha: "abc1234",
    },
    body: "Useful bounded comment",
    runner() {
      return JSON.stringify({
        title: "docs: fix broken example",
        author: { login: "outside-dev" },
        headRefName: "docs/fix-example",
        labels: [{ name: "documentation" }],
        comments: [],
      });
    },
  });

  assert.equal(plan.status, "ready");
  assert.match(plan.comment_body, /automaton:runx-issue-triage/);
  assert.match(plan.comment_body, /Head SHA: abc1234/);
});

test("buildCommentPlan noops when the exact marker and head sha already exist", () => {
  const plan = buildCommentPlan({
    options: {
      repo: "vercel/next.js",
      pr: "101",
      sha: "abc1234",
    },
    body: "Useful bounded comment",
    runner() {
      return JSON.stringify({
        title: "docs: fix broken example",
        author: { login: "outside-dev" },
        headRefName: "docs/fix-example",
        labels: [{ name: "documentation" }],
        comments: [
          {
            body: "<!-- automaton:runx-issue-triage -->\nUseful bounded comment\n\nHead SHA: abc1234",
          },
        ],
      });
    },
  });

  assert.equal(plan.status, "noop");
  assert.equal(plan.reason, "comment already exists");
});
