import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLanePrBody,
  buildLaneRequestBody,
  buildPublishPlan,
  buildSkippedPublish,
} from "./run-governed-pr-lane.mjs";

test("buildLaneRequestBody appends docs-pr constraints", () => {
  const body = buildLaneRequestBody("docs-pr", "Clarify the deploy docs.");

  assert.match(body, /Clarify the deploy docs\./);
  assert.match(body, /Keep the change docs-only/);
  assert.match(body, /Do not widen into feature work/);
});

test("buildLaneRequestBody appends fix-pr constraints", () => {
  const body = buildLaneRequestBody("fix-pr", "Fix the activity feed ordering bug.");

  assert.match(body, /Fix the activity feed ordering bug\./);
  assert.match(body, /one bounded bugfix/);
  assert.match(body, /Only update docs when they are needed/);
});

test("buildPublishPlan derives lane-specific titles and branches", () => {
  const docsPlan = buildPublishPlan({
    lane: "docs-pr",
    requestTitle: "Clarify deploy docs",
    sourceId: "docs-pr-101",
    targetRepo: "nilstate/aster",
  });
  const fixPlan = buildPublishPlan({
    lane: "fix-pr",
    requestTitle: "Fix activity ordering",
    sourceId: "fix-pr-202",
    targetRepo: "nilstate/aster",
  });

  assert.match(docsPlan.branch, /^runx\/docs-pr-/);
  assert.match(docsPlan.title, /^\[runx\] docs-pr:/);
  assert.match(fixPlan.branch, /^runx\/fix-pr-/);
  assert.match(fixPlan.commitMessage, /^fix:/);
});

test("buildLanePrBody includes lane guardrails and validation", () => {
  const body = buildLanePrBody({
    lane: "docs-pr",
    requestTitle: "Clarify deploy docs",
    requestBody: "Tighten the Pages deployment explanation.",
    sourceId: "docs-pr-101",
    workIssueRepo: "nilstate/aster",
    workIssueNumber: "222",
    workIssueUrl: "https://github.com/nilstate/aster/issues/222",
    ledgerRevision: "deadbeefcafebabe",
    targetRepo: "nilstate/aster",
    taskId: "docs-pr-clarify-deploy-docs",
    verificationProfile: "aster.site-ci",
    bootstrapCommands: ["npm --prefix site ci"],
    validationCommands: ["npm run site:ci"],
  });

  assert.match(body, /This draft PR was opened by the `aster` docs-pr lane/);
  assert.match(body, /verification profile: `aster\.site-ci`/);
  assert.match(body, /`npm --prefix site ci`/);
  assert.match(body, /`npm run site:ci`/);
  assert.match(body, /Work issue: `nilstate\/aster#222`/);
  assert.match(body, /Ledger revision: `deadbeefcafebabe`/);
  assert.match(body, /Lane Guardrails/);
});

test("buildSkippedPublish records a proposal-only governed lane run", () => {
  const publish = buildSkippedPublish({
    lane: "fix-pr",
  });

  assert.deepEqual(publish, {
    status: "not_requested",
    reason: "fix-pr.publish gate not granted yet",
  });
});
