import test from "node:test";
import assert from "node:assert/strict";

import { buildSkillProposalMarkdown } from "./write-skill-proposal.mjs";

test("buildSkillProposalMarkdown preserves issue rationale and evidence", () => {
  const markdown = buildSkillProposalMarkdown({
    title: "Add an issue-ledger recap skill",
    issueUrl: "https://github.com/nilstate/aster/issues/42",
    jsonPath: "/tmp/issue-ledger-recap.json",
    payload: {
      skill_spec: {
        name: "issue-ledger-recap",
        summary: "Summarize approval issue threads into a reusable packet.",
        objective: "Distill a bounded collaboration subject into a rebuildable approval packet.",
      },
      execution_plan: {
        runner: "chain",
      },
      harness_fixture: [
        {
          name: "success",
        },
      ],
      acceptance_checks: [
        {
          id: "ac-fixture-passes",
          assertion: "fixture passes",
        },
      ],
    },
    issuePacket: {
      source_issue: {
        repo: "nilstate/aster",
        number: 42,
        ledger_revision: "deadbeefcafebabe",
      },
      sections: {
        objective: "Add an issue-ledger recap skill that turns issue discussion into a bounded approval summary.",
        why_it_matters: "Issue review should train the operator.",
        constraints: "- proposal only",
        evidence: "- state/thread-teaching.json",
        additional_notes: "Prefer bounded review surfaces.",
      },
      amendments: [
        {
          author: "kam",
          recorded_at: "2026-04-21T12:24:06Z",
          body: "Hard-cut the contract to subject_locator, subject_memory, and publication_target.",
          url: "https://github.com/nilstate/aster/issues/42#issuecomment-1",
        },
        {
          author: "kam",
          recorded_at: "2026-04-21T12:30:59Z",
          url: "https://github.com/nilstate/aster/issues/42#issuecomment-2",
          thread_teaching_record: {
            kind: "publish_authorization",
            summary: "Refresh the single rolling draft PR from the same work ledger.",
            applies_to: ["skill-lab.publish"],
            decisions: [
              {
                gate_id: "skill-lab.publish",
                decision: "allow",
                reason: "refresh the existing rolling draft PR",
              },
            ],
          },
        },
      ],
    },
  });

  assert.match(markdown, /^title: "issue-ledger-recap"$/m);
  assert.match(markdown, /## Work Ledger/);
  assert.match(markdown, /Work issue: `nilstate\/aster#42`/);
  assert.match(markdown, /Ledger revision: `deadbeefcafebabe`/);
  assert.match(markdown, /skill-lab\.publish/);
  assert.match(markdown, /## Maintainer Amendments/);
  assert.match(markdown, /Later maintainer amendments on the living ledger take precedence/);
  assert.match(markdown, /Hard-cut the contract to subject_locator/);
  assert.match(markdown, /Refresh the single rolling draft PR from the same work ledger/);
  assert.match(markdown, /## Why It Matters/);
  assert.match(markdown, /Issue review should train the operator\./);
  assert.match(markdown, /## Evidence/);
  assert.match(markdown, /state\/thread-teaching\.json/);
  assert.match(markdown, /## Original Request/);
  assert.match(markdown, /Add an issue-ledger recap skill that turns issue discussion into a bounded approval summary\./);
  assert.match(markdown, /## Objective/);
  assert.match(markdown, /Distill a bounded collaboration subject into a rebuildable approval packet\./);
  assert.match(markdown, /## Acceptance Checks/);
  assert.match(markdown, /`ac-fixture-passes`: fixture passes/);
  assert.doesNotMatch(markdown, /\[object Object\]/);
  assert.match(markdown, /description: "Summarize approval issue threads into a reusable packet\."/);
});
