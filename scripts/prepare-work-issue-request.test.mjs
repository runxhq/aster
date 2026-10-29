import test from "node:test";
import assert from "node:assert/strict";

import { prepareWorkIssueRequest } from "./prepare-work-issue-request.mjs";

test("prepareWorkIssueRequest normalizes one work issue into a governed PR request", () => {
  const prepared = prepareWorkIssueRequest({
    repo: "runxhq/aster",
    issue: {
      number: 14,
      title: "[issue-to-pr] Clarify the docs-pr flow",
      url: "https://github.com/runxhq/aster/issues/14",
      body: [
        "### Target Repo",
        "",
        "runxhq/aster",
        "",
        "### Objective",
        "",
        "Clarify the docs-pr flow.",
        "",
        "### Acceptance Criteria",
        "",
        "- Explain that the work issue is the ledger.",
        "",
        "### Context",
        "",
        "- docs/flows.md",
        "",
        "### Safety Constraints",
        "",
        "- Keep the change docs-only.",
      ].join("\n"),
    },
    amendments: [
      {
        author: "kam",
        created_at: "2026-04-21T10:00:00Z",
        url: "https://github.com/runxhq/aster/issues/14#issuecomment-1",
        body: "Also mention that replies on the same issue should retrigger the lane.",
      },
    ],
    ledger_revision: "deadbeefcafebabe",
  }, { lane: "docs-pr" });

  assert.equal(prepared.request_title, "Clarify the docs-pr flow.");
  assert.equal(prepared.target_repo, "runxhq/aster");
  assert.equal(prepared.source_issue.repo, "runxhq/aster");
  assert.match(prepared.request_body, /Acceptance Criteria/);
  assert.match(prepared.request_body, /Maintainer Amendments/);
  assert.match(prepared.request_body, /retrigger the lane/);
  assert.equal(prepared.source_issue.ledger_revision, "deadbeefcafebabe");
});

test("prepareWorkIssueRequest exposes upstream-specific optional fields", () => {
  const prepared = prepareWorkIssueRequest({
    repo: "runxhq/aster",
    issue: {
      number: 18,
      title: "[upstream] Add SKILL.md to icey-cli",
      body: [
        "Target Repo: auscaster/icey-server",
        "Target Ref: main",
        "Workflow: operator-bringup",
        "Mode: auto",
        "Candidate Path: SKILL.md",
        "Force: yes",
      ].join("\n"),
    },
  }, { lane: "skill-upstream" });

  assert.equal(prepared.target_repo, "auscaster/icey-server");
  assert.equal(prepared.workflow, "operator-bringup");
  assert.equal(prepared.mode, "auto");
  assert.equal(prepared.candidate_path, "SKILL.md");
  assert.equal(prepared.force, true);
});

test("prepareWorkIssueRequest falls back to workflow defaults when the issue omits target fields", () => {
  const prepared = prepareWorkIssueRequest({
    repo: "runxhq/aster",
    issue: {
      number: 20,
      title: "[issue-to-pr] Tighten the README wording",
      body: "Objective: Tighten the README wording.\n\nAcceptance Criteria:\n- Keep the change docs-only.",
    },
    ledger_revision: "abc123def456",
  }, {
    lane: "docs-pr",
    defaultTargetRepo: "runxhq/aster",
    defaultTargetRef: "main",
  });

  assert.equal(prepared.target_repo, "runxhq/aster");
  assert.equal(prepared.target_ref, "main");
  assert.match(prepared.request_body, /ledger revision/i);
});
