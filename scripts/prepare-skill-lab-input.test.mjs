import test from "node:test";
import assert from "node:assert/strict";

import { prepareSkillLabInput } from "./prepare-skill-lab-input.mjs";

test("prepareSkillLabInput normalizes GitHub issue form sections", () => {
  const prepared = prepareSkillLabInput({
    number: 42,
    title: "[skill] Add a collaboration issue recap skill",
    url: "https://github.com/nilstate/aster/issues/42",
    body: [
      "### Objective",
      "",
      "Add a collaboration issue recap skill that turns issue discussion into a bounded approval summary.",
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
    "Add a collaboration issue recap skill that turns issue discussion into a bounded approval summary.",
  );
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
