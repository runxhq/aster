import test from "node:test";
import assert from "node:assert/strict";

import { prepareSkillLabInput } from "./prepare-skill-lab-input.mjs";

test("prepareSkillLabInput normalizes GitHub issue form sections", () => {
  const prepared = prepareSkillLabInput({
    repo: "nilstate/aster",
    ledger_revision: "deadbeefcafebabe",
    number: 42,
    title: "[skill] Add an issue-ledger recap skill",
    url: "https://github.com/nilstate/aster/issues/42",
    body: [
      "### Objective",
      "",
      "Add an issue-ledger recap skill that turns issue discussion into a bounded approval summary.",
      "",
      "### Why It Matters",
      "",
      "The operator should learn from reviewed issue decisions instead of prompt sprawl.",
      "",
      "### Constraints",
      "",
      "- proposal only",
      "- no direct GitHub mutation",
      "",
      "### Evidence",
      "",
      "- state/thread-teaching.json",
      "- docs/philosophy.md",
    ].join("\n"),
  });

  assert.equal(
    prepared.objective,
    "Add an issue-ledger recap skill that turns issue discussion into a bounded approval summary.",
  );
  assert.equal(prepared.source_issue.repo, "nilstate/aster");
  assert.equal(prepared.source_issue.ledger_revision, "deadbeefcafebabe");
  assert.match(prepared.project_context, /Why It Matters/);
  assert.match(prepared.project_context, /proposal only/);
  assert.equal(prepared.sections.evidence, "- state/thread-teaching.json\n- docs/philosophy.md");
});

test("prepareSkillLabInput strips skill prefix and keeps freeform notes", () => {
  const prepared = prepareSkillLabInput({
    title: "[skill] Add a thread-teaching recap formatter",
    body: [
      "Create a governed runx skill proposal for a formatter that turns thread-teaching rows into a compact maintainer recap.",
      "",
      "Constraints:",
      "- proposal only",
      "- markdown/json output only",
      "",
      "Evidence:",
      "- derive-thread-teaching exists",
    ].join("\n"),
  });

  assert.equal(prepared.objective, "Add a thread-teaching recap formatter");
  assert.match(prepared.project_context, /Additional Notes/);
  assert.match(prepared.project_context, /compact maintainer recap/);
  assert.equal(prepared.sections.constraints, "- proposal only\n- markdown/json output only");
});

test("prepareSkillLabInput includes issue-ledger amendments in project context", () => {
  const prepared = prepareSkillLabInput({
    issue: {
      number: 110,
      title: "[skill] Add an issue-ledger distillation skill",
      body: [
        "Objective: Add an issue-ledger distillation skill",
        "",
        "Why It Matters:",
        "Teach aster through the work issue itself.",
      ].join("\n"),
      url: "https://github.com/nilstate/aster/issues/110",
    },
    amendments: [
      {
        author: "kam",
        created_at: "2026-04-21T08:00:00Z",
        url: "https://github.com/nilstate/aster/issues/110#issuecomment-1",
        body: "Keep the first pass proposal-only and preserve the work-issue ledger model.",
      },
      {
        author: "kam",
        created_at: "2026-04-21T08:05:00Z",
        url: "https://github.com/nilstate/aster/issues/110#issuecomment-2",
        thread_teaching_record: {
          kind: "approval",
          summary: "One draft refresh is approved.",
        },
      },
    ],
  });

  assert.match(prepared.project_context, /Maintainer Amendments/);
  assert.match(prepared.project_context, /Keep the first pass proposal-only/);
  assert.match(prepared.project_context, /structured teaching: approval/);
});

test("prepareSkillLabInput filters machine status comments and preserves teaching records", () => {
  const prepared = prepareSkillLabInput({
    issue: {
      number: 110,
      title: "[skill] Add a collaboration issue distillation skill",
      body: "Objective: Distill a collaboration subject",
    },
    amendments: [
      {
        author: "kam",
        created_at: "2026-04-21T07:25:06Z",
        body: "Opened draft PR for this run: https://github.com/nilstate/aster/pull/111",
        is_machine_status_comment: true,
      },
      {
        author: "kam",
        created_at: "2026-04-21T12:24:06Z",
        body: "Hard-cut the contract to subject_locator, subject_memory, and publication_target.",
      },
      {
        author: "kam",
        created_at: "2026-04-21T12:30:59Z",
        thread_teaching_record: {
          kind: "publish_authorization",
          summary: "Refresh the single rolling draft PR from the same work ledger.",
        },
      },
    ],
  });

  assert.equal(prepared.amendments.length, 2);
  assert.equal(prepared.amendments[0]?.body, "Hard-cut the contract to subject_locator, subject_memory, and publication_target.");
  assert.equal(prepared.amendments[1]?.thread_teaching_record?.kind, "publish_authorization");
  assert.doesNotMatch(prepared.project_context, /Opened draft PR for this run/);
  assert.match(prepared.sections.maintainer_amendments ?? "", /publish_authorization/);
});
