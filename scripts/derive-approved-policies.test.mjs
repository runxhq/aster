import test from "node:test";
import assert from "node:assert/strict";

import {
  buildApprovedPolicyEntries,
  mergeApprovalThreadHits,
} from "./derive-approved-policies.mjs";
import { APPROVAL_CONTEXT_MARKER } from "./derive-approval-context.mjs";

test("mergeApprovalThreadHits dedupes issue and PR matches by newest update", () => {
  const merged = mergeApprovalThreadHits(
    [
      { kind: "issue", number: 42, title: "Older issue hit", updatedAt: "2026-04-20T00:00:00Z" },
    ],
    [
      { kind: "issue", number: 42, title: "Newer issue hit", updatedAt: "2026-04-20T02:00:00Z" },
    ],
    [
      { kind: "pr", number: 7, title: "PR hit", updatedAt: "2026-04-20T01:00:00Z" },
    ],
  );

  assert.deepEqual(merged.map((entry) => `${entry.kind}:${entry.number}:${entry.title}`), [
    "issue:42:Newer issue hit",
    "pr:7:PR hit",
  ]);
});

test("buildApprovedPolicyEntries normalizes trusted approval threads into derived policy rows", () => {
  const policies = buildApprovedPolicyEntries({
    repo: "nilstate/runx",
    threads: [
      {
        kind: "issue",
        number: 42,
        title: "Bounded triage approval",
        url: "https://github.com/nilstate/runx/issues/42",
        state: "open",
      },
      {
        kind: "pr",
        number: 7,
        title: "Expired review approval",
        url: "https://github.com/nilstate/runx/pull/7",
        state: "closed",
      },
    ],
    loadIssueEntries: () => [
      {
        source_type: "issue_comment",
        author: "kam",
        author_association: "OWNER",
        body: [
          APPROVAL_CONTEXT_MARKER,
          "Rationale: Keep this gated to plan only.",
          "Applies To: issue-triage.plan",
          "Objective Fingerprint: issue:runx-42",
        ].join("\n"),
        url: "https://github.com/nilstate/runx/issues/42#issuecomment-1",
        created_at: "2026-04-20T01:00:00Z",
      },
    ],
    loadPullRequestEntries: () => [
      {
        source_type: "pull_request_review",
        author: "kam",
        author_association: "OWNER",
        body: [
          APPROVAL_CONTEXT_MARKER,
          "Rationale: Review only.",
          "Applies To: fix-pr.review",
          "Expires After: 2026-04-19T00:00:00Z",
        ].join("\n"),
        url: "https://github.com/nilstate/runx/pull/7#pullrequestreview-1",
        created_at: "2026-04-18T01:00:00Z",
      },
    ],
    now: "2026-04-20T03:00:00Z",
  });

  assert.equal(policies.length, 1);
  assert.equal(policies[0].thread, "nilstate/runx#issue/42");
  assert.equal(policies[0].status, "active");
  assert.equal(policies[0].approval_context?.objective_fingerprint, "issue:runx-42");
  assert.deepEqual(policies[0].approval_context?.applies_to, ["issue-triage.plan"]);
});
