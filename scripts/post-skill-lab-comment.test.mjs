import test from "node:test";
import assert from "node:assert/strict";

import { buildSkillLabComment, SKILL_LAB_MARKER } from "./post-skill-lab-comment.mjs";

test("buildSkillLabComment renders the rolling issue status comment", () => {
  const comment = buildSkillLabComment({
    objective: "Add an issue-ledger distillation skill",
    runUrl: "https://github.com/nilstate/aster/actions/runs/123",
    ledgerRevision: "deadbeefcafebabe",
    workflowStatus: "success",
    publish: {
      status: "published",
      pr_number: 111,
      pr_url: "https://github.com/nilstate/aster/pull/111",
    },
    result: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "issue-ledger-followup",
            kind: "composite-skill",
            status: "proposed",
            summary: "Turn one living work issue ledger into the next high-signal machine update or maintainer handoff packet.",
          },
          acceptance_checks: [{ id: "ac-1" }, { id: "ac-2" }],
        }),
      },
    },
  });

  assert.match(comment, new RegExp(SKILL_LAB_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(comment, /Proposal: `issue-ledger-followup`/);
  assert.match(comment, /Summary: Turn one living work issue ledger/);
  assert.match(comment, /Draft PR: \[#111\]/);
  assert.match(comment, /Ledger revision: `deadbeefcafebabe`/);
  assert.match(comment, /## Changed in this refresh/);
  assert.match(comment, /Acceptance checks surfaced: `2`/);
  assert.match(comment, /Reply in this work issue with maintainer amendments/);
});

test("buildSkillLabComment surfaces proposal quality review gaps", () => {
  const comment = buildSkillLabComment({
    objective: "Add a decision brief skill",
    workflowStatus: "success",
    quality: {
      status: "needs_review",
      score: 0.625,
      findings: [
        { summary: "Name the concrete operator or maintainer pain points this skill resolves." },
        { summary: "Explain where this proposal fits against the current runx catalog." },
      ],
    },
    publish: {
      status: "not_requested",
      reason: "skill proposal quality needs review before publication",
    },
    result: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "decision-brief",
            summary: "Read one work ledger and return one decision packet.",
          },
          acceptance_checks: [{ id: "ac-1" }],
        }),
      },
    },
  });

  assert.match(comment, /Status: `proposal_quality_needs_review`/);
  assert.match(comment, /Proposal quality: `needs_review` score=`0\.625`/);
  assert.match(comment, /Quality gap: Name the concrete operator or maintainer pain points/);
  assert.match(comment, /Quality gap: Explain where this proposal fits against the current runx catalog/);
  assert.match(comment, /Draft PR publication stays blocked until the proposal quality gaps are resolved/);
});

test("buildSkillLabComment reports a failed run consistently", () => {
  const comment = buildSkillLabComment({
    objective: "Add an issue-ledger distillation skill",
    workflowStatus: "failure",
  });

  assert.match(comment, /Status: `run_failed`/);
});

test("buildSkillLabComment reports proposal_refreshed when publish is not requested", () => {
  const comment = buildSkillLabComment({
    objective: "Add an issue-ledger distillation skill",
    workflowStatus: "success",
    publish: {
      status: "not_requested",
    },
    result: {
      execution: {
        stdout: JSON.stringify({
          skill_spec: {
            skill_name: "issue-ledger-followup",
            summary: "Turn one living work issue ledger into the next high-signal machine update or maintainer handoff packet.",
          },
          acceptance_checks: [{ id: "ac-1" }],
        }),
      },
    },
  });

  assert.match(comment, /Status: `proposal_refreshed`/);
  assert.match(comment, /Publication remains gated until a trusted reply on this work issue authorizes `skill-lab\.publish`/);
  assert.match(comment, /`Applies To:` \+ `Decision:` lines or a full thread-teaching record/);
});
