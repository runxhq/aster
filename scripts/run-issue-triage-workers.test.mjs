import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVerificationReport,
  buildInlineRepoSnapshot,
  findExistingGeneratedIssuePr,
  isRetryableBridgeFailure,
  normalizeTaskId,
  sanitizeIssueBody,
} from "./run-issue-triage-workers.mjs";

test("normalizeTaskId converts mixed separators into kebab-case", () => {
  assert.equal(normalizeTaskId("GitHub_Issue-5"), "github-issue-5");
});

test("normalizeTaskId falls back when the candidate has no usable characters", () => {
  assert.equal(normalizeTaskId("___"), "issue-task");
});

test("normalizeTaskId preserves existing kebab ids", () => {
  assert.equal(normalizeTaskId("issue-5-worker-01"), "issue-5-worker-01");
});

test("sanitizeIssueBody removes retry markers and preserves the request body", () => {
  const input = [
    "Update docs/flows.md and docs/operations.md.",
    "",
    "_Retry marker: rerun after first hosted failure._",
    "",
    "Keep the change docs-only.",
  ].join("\n");

  assert.equal(
    sanitizeIssueBody(input),
    ["Update docs/flows.md and docs/operations.md.", "", "Keep the change docs-only."].join("\n"),
  );
});

test("isRetryableBridgeFailure recognizes transient transport resets", () => {
  assert.equal(
    isRetryableBridgeFailure(new Error("Error: read ECONNRESET")),
    true,
  );
});

test("isRetryableBridgeFailure ignores non-transport failures", () => {
  assert.equal(
    isRetryableBridgeFailure(new Error("spec validation failed")),
    false,
  );
});

test("buildInlineRepoSnapshot keeps the prompt payload compact", () => {
  const snapshot = buildInlineRepoSnapshot({
    target_repo: "nilstate/aster",
    git: { branch: null, head: "abc123" },
    top_level_entries: Array.from({ length: 20 }, (_, index) => ({
      name: `entry-${index}`,
      kind: "file",
      extra: "ignored",
    })),
    notable_paths: Array.from({ length: 20 }, (_, index) => `path-${index}`),
    manifests: {
      "package.json": {
        name: "aster",
        private: true,
        scripts: Array.from({ length: 20 }, (_, index) => `script-${index}`),
      },
    },
    submodules: Array.from({ length: 10 }, (_, index) => `sub-${index}`),
    readme_excerpt: "this should not be forwarded inline",
  });

  assert.equal(snapshot.top_level_entries.length, 12);
  assert.equal(snapshot.notable_paths.length, 12);
  assert.equal(snapshot.manifests["package.json"].scripts.length, 8);
  assert.equal(snapshot.submodules.length, 6);
  assert.equal("readme_excerpt" in snapshot, false);
});

test("buildVerificationReport emits the canonical verification report shape", () => {
  const report = buildVerificationReport({
    reportId: "verification-101",
    targetRepo: "nilstate/aster",
    verificationProfile: "aster.site-ci",
    status: "pass",
    bootstrapCommands: [
      {
        command: "npm --prefix site ci",
        status: "pass",
        exit_code: 0,
        summary: "command completed successfully",
      },
    ],
    commands: [
      {
        command: "npm run site:ci",
        status: "pass",
        exit_code: 0,
        summary: "command completed successfully",
      },
    ],
    executedAt: "2026-04-17T00:00:00Z",
  });

  assert.equal(report.report_id, "verification-101");
  assert.equal(report.status, "pass");
  assert.equal(report.bootstrap_commands[0].command, "npm --prefix site ci");
  assert.equal(report.commands[0].command, "npm run site:ci");
});

test("findExistingGeneratedIssuePr reuses the most recent open generated PR for the same issue", () => {
  const result = findExistingGeneratedIssuePr({
    repo: "nilstate/aster",
    issueNumber: "12",
    runner(command, args) {
      assert.equal(command, "gh");
      assert.deepEqual(args, [
        "pr",
        "list",
        "--repo",
        "nilstate/aster",
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,title,url,headRefName,isDraft,updatedAt",
      ]);
      return JSON.stringify([
        {
          number: 40,
          title: "[runx] resolve issue #9 (01)",
          url: "https://github.com/nilstate/aster/pull/40",
          headRefName: "runx/issue-9-nilstate-aster-01",
          isDraft: true,
          updatedAt: "2026-04-21T04:00:00Z",
        },
        {
          number: 41,
          title: "[runx] resolve issue #12 (01)",
          url: "https://github.com/nilstate/aster/pull/41",
          headRefName: "runx/issue-12-nilstate-aster-01",
          isDraft: true,
          updatedAt: "2026-04-21T04:01:00Z",
        },
        {
          number: 42,
          title: "[runx] resolve issue #12 (02)",
          url: "https://github.com/nilstate/aster/pull/42",
          headRefName: "runx/issue-12-nilstate-aster-02",
          isDraft: true,
          updatedAt: "2026-04-21T04:05:00Z",
        },
      ]);
    },
  });

  assert.equal(result?.number, 42);
  assert.equal(result?.url, "https://github.com/nilstate/aster/pull/42");
});
