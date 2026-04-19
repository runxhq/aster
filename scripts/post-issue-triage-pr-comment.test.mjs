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
    body: "Aster triage",
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
    body: [
      "Thanks for pushing this.",
      "",
      "- Please add one repro or validation note that shows the docs example now passes.",
      "- If that already exists elsewhere in the thread, link it instead of repeating the whole review.",
    ].join("\n"),
    runner() {
      return JSON.stringify({
        title: "docs: fix broken example",
        author: { login: "outside-dev" },
        authorAssociation: "CONTRIBUTOR",
        headRefName: "docs/fix-example",
        labels: [{ name: "documentation" }],
        comments: [],
        reviews: [],
      });
    },
  });

  assert.equal(plan.status, "ready");
  assert.match(plan.comment_body, /aster:runx-issue-triage/);
  assert.match(plan.comment_body, /Head SHA: abc1234/);
});

test("buildCommentPlan noops when the exact marker and head sha already exist", () => {
  const plan = buildCommentPlan({
    options: {
      repo: "vercel/next.js",
      pr: "101",
      sha: "abc1234",
    },
    body: [
      "Thanks for pushing this.",
      "",
      "- Please add one repro or validation note that shows the docs example now passes.",
      "- If that already exists elsewhere in the thread, link it instead of repeating the whole review.",
    ].join("\n"),
    runner() {
      return JSON.stringify({
        title: "docs: fix broken example",
        author: { login: "outside-dev" },
        authorAssociation: "CONTRIBUTOR",
        headRefName: "docs/fix-example",
        labels: [{ name: "documentation" }],
        comments: [
          {
            body: "<!-- aster:runx-issue-triage -->\nUseful bounded comment\n\nHead SHA: abc1234",
          },
        ],
        reviews: [],
      });
    },
  });

  assert.equal(plan.status, "noop");
  assert.equal(plan.reason, "comment already exists");
});

test("buildCommentPlan noops when a human PR has no welcome signal", () => {
  const plan = buildCommentPlan({
    options: {
      repo: "vercel/next.js",
      pr: "102",
      sha: "abc9999",
    },
    body: [
      "Thanks for pushing this.",
      "",
      "- Please add one repro or validation note that shows the docs example now passes.",
      "- If that already exists elsewhere in the thread, link it instead of repeating the whole review.",
    ].join("\n"),
    runner() {
      return JSON.stringify({
        title: "docs: fix typo",
        author: { login: "first-timer" },
        authorAssociation: "NONE",
        headRefName: "docs/fix-typo",
        labels: [{ name: "documentation" }],
        comments: [],
        reviews: [],
      });
    },
  });

  assert.equal(plan.status, "noop");
  assert.match(plan.reasons.join(","), /comment_without_welcome_signal/);
});

test("buildCommentPlan noops on thin comments even for eligible PRs", () => {
  const plan = buildCommentPlan({
    options: {
      repo: "vercel/next.js",
      pr: "103",
      sha: "abc7777",
    },
    body: "Looks good.",
    runner(command, args) {
      if (args[0] === "api") {
        return JSON.stringify({ authorAssociation: "CONTRIBUTOR" });
      }
      return JSON.stringify({
        title: "docs: fix example",
        author: { login: "outside-dev" },
        headRefName: "docs/fix-example",
        labels: [{ name: "documentation" }],
        comments: [],
        reviews: [],
      });
    },
  });

  assert.equal(plan.status, "noop");
  assert.equal(plan.reason, "comment_quality_needs_review");
});
