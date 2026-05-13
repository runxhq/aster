import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLanePrBody,
  buildLaneReviewerPacketInput,
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
    targetRepo: "runxhq/aster",
  });
  const fixPlan = buildPublishPlan({
    lane: "fix-pr",
    requestTitle: "Fix activity ordering",
    sourceId: "fix-pr-202",
    targetRepo: "runxhq/aster",
  });

  assert.match(docsPlan.branch, /^runx\/docs-pr-/);
  assert.match(docsPlan.title, /^\[runx\] docs-pr:/);
  assert.match(fixPlan.branch, /^runx\/fix-pr-/);
  assert.match(fixPlan.commitMessage, /^fix:/);
});

test("buildLaneReviewerPacketInput preserves source context, guardrails, and validation", () => {
  const packet = buildLaneReviewerPacketInput({
    lane: "docs-pr",
    requestTitle: "Clarify deploy docs",
    requestBody: "Tighten the Pages deployment explanation.",
    sourceId: "docs-pr-101",
    workIssueRepo: "runxhq/aster",
    workIssueNumber: "222",
    workIssueUrl: "https://github.com/runxhq/aster/issues/222",
    ledgerRevision: "deadbeefcafebabe",
    targetRepo: "runxhq/aster",
    branch: "runx/docs-pr-docs-pr-101",
    taskId: "docs-pr-clarify-deploy-docs",
    verificationProfile: "aster.site-ci",
    bootstrapCommands: ["npm --prefix site ci"],
    validationCommands: ["npm run site:ci"],
  });

  assert.equal(packet.source.label, "Source thread");
  assert.equal(packet.source.uri, "https://github.com/runxhq/aster/issues/222");
  assert.equal(packet.issue.label, "runxhq/aster#222");
  assert.equal(packet.targetRepo, "runxhq/aster");
  assert.equal(packet.branch, "runx/docs-pr-docs-pr-101");
  assert.match(packet.summary, /docs-pr/);
  assert.match(packet.sourceContext.join("\n"), /Request context:/);
  assert.match(packet.sourceContext.join("\n"), /Ledger revision: deadbeefcafebabe/);
  assert.match(packet.validation.join("\n"), /Verification profile: aster\.site-ci/);
  assert.match(packet.validation.join("\n"), /Bootstrap: npm --prefix site ci/);
  assert.match(packet.validation.join("\n"), /Proof: npm run site:ci/);
  assert.match(packet.reviewContext.join("\n"), /source issue is the living ledger/i);
  assert.match(packet.nextAction, /Human reviewer/);
  assert.match(packet.rollback, /same work issue/);
  assert.deepEqual(packet.scope, packet.risks);
});

test("buildLanePrBody delegates reviewer packet rendering to runx core helper", async () => {
  let capturedPacket = null;
  const body = await buildLanePrBody({
    lane: "fix-pr",
    requestTitle: "Fix activity ordering",
    requestBody: "Newest activity should appear first.",
    sourceId: "fix-pr-202",
    workIssueRepo: "runxhq/aster",
    workIssueNumber: "333",
    workIssueUrl: "https://github.com/runxhq/aster/issues/333",
    ledgerRevision: "abc123",
    targetRepo: "runxhq/aster",
    branch: "runx/fix-pr-fix-pr-202",
    taskId: "fix-pr-fix-activity-ordering",
    verificationProfile: "aster.check",
    bootstrapCommands: [],
    validationCommands: ["npm run check"],
    threadStoryRenderer: {
      buildThreadPullRequestReviewerPacketMarkdown(packet) {
        capturedPacket = packet;
        return [
          "## Source Context",
          `Source: [${packet.source.label}](${packet.source.uri})`,
          "",
          "## Human Merge Gate",
          packet.nextAction,
        ].join("\n");
      },
    },
  });

  assert.match(body, /Source: \[Source thread\]\(https:\/\/github\.com\/runxhq\/aster\/issues\/333\)/);
  assert.match(body, /Human Merge Gate/);
  assert.equal(body.endsWith("\n"), true);
  assert.equal(capturedPacket.targetRepo, "runxhq/aster");
  assert.match(capturedPacket.scope.join("\n"), /bounded bugfix/);
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
