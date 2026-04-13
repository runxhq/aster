import test from "node:test";
import assert from "node:assert/strict";

import {
  isRetryableBridgeFailure,
  normalizeTaskId,
  sanitizeIssueBody,
} from "./run-issue-supervisor-workers.mjs";

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
