import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildContextBundle,
  renderContextPrompt,
  slugifyRepoLike,
} from "./build-automaton-context.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("slugifyRepoLike normalizes repo locators", () => {
  assert.equal(slugifyRepoLike("nilstate/automaton"), "nilstate-automaton");
});

test("buildContextBundle loads doctrine, state, and target dossier", async () => {
  const bundle = await buildContextBundle({
    repoRoot,
    lane: "issue-triage",
    subjectKind: "github_issue",
    subjectLocator: "nilstate/automaton#issue/42",
    repo: "nilstate/automaton",
    targetRepo: "nilstate/automaton",
  });

  assert.equal(bundle.lane, "issue-triage");
  assert.equal(bundle.subject.kind, "github_issue");
  assert.equal(bundle.state.target?.title, "Target Dossier — nilstate/automaton");
  assert.ok(bundle.doctrine.some((doc) => doc.title === "Automaton Thesis"));
  assert.ok(bundle.history.length >= 1);
  assert.ok(bundle.reflections.length >= 1);
});

test("renderContextPrompt includes doctrine and state sections", async () => {
  const bundle = await buildContextBundle({
    repoRoot,
    lane: "issue-triage",
    subjectKind: "github_pull_request",
    subjectLocator: "nilstate/automaton#pr/7",
    repo: "nilstate/automaton",
    targetRepo: "nilstate/runx",
  });

  const prompt = renderContextPrompt(bundle);
  assert.match(prompt, /# Automaton Context Bundle/);
  assert.match(prompt, /## Doctrine/);
  assert.match(prompt, /## Current State/);
  assert.match(prompt, /Target Dossier/);
});
