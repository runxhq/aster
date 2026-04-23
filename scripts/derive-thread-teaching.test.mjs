import test from "node:test";
import assert from "node:assert/strict";

import {
  buildThreadTeachingEntries,
  deriveThreadTeaching,
} from "./derive-thread-teaching.mjs";

test("buildThreadTeachingEntries normalizes thread records into derived rows", () => {
  const report = buildThreadTeachingEntries({
    repo: "nilstate/runx",
    threads: [
      {
        kind: "issue",
        number: 42,
        title: "Bounded docs publish",
        url: "https://github.com/nilstate/runx/issues/42",
        state: "open",
      },
    ],
    loadIssueEntries: () => [
      {
        source_type: "issue_comment",
        author: "kam",
        author_association: "OWNER",
        body: [
          "<!-- aster:thread-teaching-record -->",
          "Kind: publish_authorization",
          "Summary: One bounded docs PR may be published.",
          "Applies To: docs-pr.publish",
          "Target Repo: nilstate/runx",
        ].join("\n"),
        url: "https://github.com/nilstate/runx/issues/42#issuecomment-1",
        created_at: "2026-04-20T01:00:00Z",
      },
    ],
    now: "2026-04-20T03:00:00Z",
  });

  assert.equal(report.records.length, 1);
  assert.equal(report.records[0].thread, "nilstate/runx#issue/42");
  assert.equal(report.records[0].status, "active");
  assert.equal(report.records[0].thread_teaching_record?.kind, "publish_authorization");
  assert.equal(report.teaching_rows[0]?.record_kind, "publish_authorization");
});

test("buildThreadTeachingEntries accepts markerless gate comments", () => {
  const report = buildThreadTeachingEntries({
    repo: "nilstate/runx",
    threads: [
      {
        kind: "issue",
        number: 43,
        title: "Bounded docs publish",
        url: "https://github.com/nilstate/runx/issues/43",
        state: "open",
      },
    ],
    loadIssueEntries: () => [
      {
        source_type: "issue_comment",
        author: "kam",
        author_association: "OWNER",
        body: [
          "Applies To: docs-pr.publish",
          "Decision: docs-pr.publish = allow | bounded draft publication is approved",
        ].join("\n"),
        url: "https://github.com/nilstate/runx/issues/43#issuecomment-1",
        created_at: "2026-04-20T01:00:00Z",
      },
    ],
    now: "2026-04-20T03:00:00Z",
  });

  assert.equal(report.records.length, 1);
  assert.equal(report.records[0].thread_teaching_record?.kind, "publish_authorization");
  assert.equal(report.teaching_rows[0]?.decisions[0]?.gate_id, "docs-pr.publish");
});

test("deriveThreadTeaching emits rebuildable state and teaching rows", async () => {
  const report = await deriveThreadTeaching({
    repos: ["nilstate/runx"],
    searchLimit: 5,
    now: "2026-04-20T03:00:00Z",
  }, {
    searchThreads: () => [
      {
        kind: "issue",
        number: 42,
        title: "Bounded docs publish",
        url: "https://github.com/nilstate/runx/issues/42",
        state: "open",
      },
    ],
    loadIssueEntries: () => [
      {
        source_type: "issue_comment",
        author: "kam",
        author_association: "OWNER",
        body: [
          "<!-- aster:thread-teaching-record -->",
          "Kind: lesson",
          "Summary: Prefer draft PRs over direct mutation.",
          "Target Repo: nilstate/runx",
        ].join("\n"),
        url: "https://github.com/nilstate/runx/issues/42#issuecomment-1",
        created_at: "2026-04-20T01:00:00Z",
      },
    ],
    loadPullRequestEntries: () => [],
  });

  assert.equal(report.errors.length, 0);
  assert.equal(report.records.length, 1);
  assert.equal(report.teaching_rows.length, 1);
  assert.equal(report.records[0].thread_teaching_record?.summary, "Prefer draft PRs over direct mutation.");
  assert.deepEqual(report.source.queries, [
    "aster:thread-teaching-record",
    "Kind Summary",
    "Applies To",
    "Decision",
  ]);
});
