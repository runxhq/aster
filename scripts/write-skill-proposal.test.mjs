import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSkillProposalMarkdown,
  extractSkillProposalPayload,
} from "./write-skill-proposal.mjs";

test("buildSkillProposalMarkdown renders a reader-facing proposal without transcript residue", () => {
  const markdown = buildSkillProposalMarkdown({
    title: "Add an issue-ledger recap skill",
    issueUrl: "https://github.com/nilstate/aster/issues/42",
    jsonPath: "/tmp/issue-ledger-recap.json",
    payload: {
      skill_spec: {
        skill_name: "issue-ledger-recap",
        summary: "Summarize approval issue threads into a reusable packet.",
        objective: "Distill a bounded collaboration subject into a rebuildable approval packet.",
        kind: "composite_skill",
        status: "proposed",
        governance: {
          mutating: false,
          public_write_allowed: false,
        },
        invariants: [
          "Preserve receipts.",
        ],
        inputs: [
          {
            name: "subject_locator",
            type: "string",
            required: true,
            description: "Portable locator.",
          },
        ],
        outputs: [
          {
            name: "followup_packet",
            type: "object",
            description: "One bounded next-action packet.",
          },
        ],
      },
      pain_points: [
        "Maintainers lose the thread of review decisions when work moves between comments and draft PRs.",
      ],
      catalog_fit: {
        adjacent_skills: ["issue-triage", "skill-lab"],
        why_new: "Neither adjacent skill emits one bounded review packet from the living work ledger.",
      },
      maintainer_decisions: [
        {
          question: "Should the first version stop at a review packet?",
          options: ["yes", "no, also scaffold the skill"],
          why: "Keeps the first cut small and inspectable.",
        },
      ],
      execution_plan: {
        runner: "chain",
      },
      findings: [
        {
          claim: "The issue thread is the living ledger.",
          source: "issue body",
        },
      ],
      recommended_flow: [
        {
          step: "Read the living ledger.",
          basis: "Keeps the issue canonical.",
        },
      ],
      sources: [
        {
          title: "Issue #42",
          locator: "https://github.com/nilstate/aster/issues/42",
          notes: "Primary request",
        },
      ],
      risks: [
        {
          risk: "Provider lock-in",
          mitigation: "Keep portable nouns in the core contract.",
        },
      ],
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
  assert.doesNotMatch(markdown, /## Work Ledger/);
  assert.doesNotMatch(markdown, /## Maintainer Amendments/);
  assert.doesNotMatch(markdown, /## Original Request/);
  assert.doesNotMatch(markdown, /## Raw Packet/);
  assert.doesNotMatch(markdown, /Later maintainer amendments on the living ledger take precedence/);
  assert.doesNotMatch(markdown, /Hard-cut the contract to subject_locator/);
  assert.doesNotMatch(markdown, /Refresh the single rolling draft PR from the same work ledger/);
  assert.match(markdown, /## Thesis/);
  assert.match(markdown, /## Job To Be Done/);
  assert.match(markdown, /## Why This Matters/);
  assert.match(markdown, /Issue review should train the operator\./);
  assert.match(markdown, /## Contract/);
  assert.match(markdown, /## Governance/);
  assert.match(markdown, /mutating: false/);
  assert.match(markdown, /## Findings/);
  assert.match(markdown, /The issue thread is the living ledger\./);
  assert.match(markdown, /## Pain Points/);
  assert.match(markdown, /Maintainers lose the thread of review decisions/);
  assert.match(markdown, /## Catalog Fit/);
  assert.match(markdown, /issue-triage, skill-lab/);
  assert.match(markdown, /## Open Decisions/);
  assert.match(markdown, /Should the first version stop at a review packet\?/);
  assert.match(markdown, /## Implementation Shape/);
  assert.match(markdown, /Read the living ledger\./);
  assert.match(markdown, /## Boundaries/);
  assert.match(markdown, /proposal only/);
  assert.match(markdown, /Provider lock-in/);
  assert.match(markdown, /## Acceptance Checks/);
  assert.match(markdown, /`ac-fixture-passes`: fixture passes/);
  assert.match(markdown, /## Provenance/);
  assert.match(markdown, /Work issue: `nilstate\/aster#42`/);
  assert.match(markdown, /Ledger revision: `deadbeefcafebabe`/);
  assert.match(markdown, /Trusted maintainer amendments considered: 2/);
  assert.match(markdown, /Evidence note: - state\/thread-teaching\.json/);
  assert.match(markdown, /Machine-readable packet: \[issue-ledger-recap\.json\]/);
  assert.doesNotMatch(markdown, /\[object Object\]/);
  assert.match(markdown, /description: "Summarize approval issue threads into a reusable packet\."/);
});

test("extractSkillProposalPayload reads nested execution stdout payloads", () => {
  const payload = extractSkillProposalPayload({
    execution: {
      stdout: JSON.stringify({
        skill_spec: {
          name: "issue-ledger-followup",
        },
        execution_plan: {
          runner: "chain",
        },
      }),
    },
  });

  assert.equal(payload.skill_spec?.name, "issue-ledger-followup");
  assert.equal(payload.execution_plan?.runner, "chain");
});
