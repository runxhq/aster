import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInlineRepoSnapshot,
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
    target_repo: "nilstate/automaton",
    git: { branch: null, head: "abc123" },
    top_level_entries: Array.from({ length: 20 }, (_, index) => ({
      name: `entry-${index}`,
      kind: "file",
      extra: "ignored",
    })),
    notable_paths: Array.from({ length: 20 }, (_, index) => `path-${index}`),
    manifests: {
      "package.json": {
        name: "automaton",
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
