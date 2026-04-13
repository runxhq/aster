---
title: Operating Model
description: The governance doctrine that determines how automaton routes work, applies changes, and learns over time.
---

# Operating Model

`automaton` is the public repo that `runx` should improve gradually over time.

The governing rule is simple: recommendation first, mutation second.

Another rule is just as important: triage before execution.

Issues should not jump straight into mutation. They should first become a
public triage artifact with a suggested reply, a rationale, and one explicit
next lane.

A third rule is what keeps the repo credible over time: capability should grow
by becoming more explicit.

If the system needs more sophistication, that should show up as better docs,
sharper skill context, stronger typed packets, and clearer approvals, not as
more hidden magic.

## Phases

### 1. Observe

`runx` reads the real repo and emits typed artifacts:

- repo introspection
- docs-site discovery
- operator update drafts
- skill trust reports

At this phase, `automaton` is only collecting signal.

### 2. Propose

The next layer turns those observations into bounded proposals:

- one evolve objective
- one docs-site plan
- one operator update draft
- one trust report or safety note

Every proposal must fit in a receipt and be reviewable by a human.

That proposal layer now has explicit front doors:

- `support-triage` for issues
- `github-triage` for PRs
- `objective-to-skill` for new capability proposals
- `sourcey` for docs-site regeneration

This proposal phase is where `automaton` defends itself against vague
automation. If a task cannot be expressed as a bounded proposal with a clear
artifact, the repo should not pretend it is ready for automatic execution.

### 3. Approve

Public or mutating work stays gated:

- repo writes require explicit approval
- public posts require explicit approval
- PR creation requires explicit approval

In practice, `automaton` uses three approval shapes:

1. issue or PR intake plus triage: the repo gets a public, typed routing
   decision before mutation
2. workflow-level gate: only specific workflows auto-approve named `runx` gates
3. PR review: the generated branch still lands through normal GitHub review

This repo exists to prove governed automation, not to bypass it.

Approval should therefore remain meaningful. The system should not dilute human
review into a ceremonial checkbox after the fact.

### 4. Apply

Once the repo and hosted control plane are ready, `automaton` graduates from
draft-only to bounded local patches and then to PR publication.

That progression should be gradual:

1. introspection and draft packets
2. patch plans with approval
3. local patch application in isolated branches
4. PR publication after review

`automaton` now uses that progression concretely:

- `docs-pages` publishes the static Sourcey site from committed docs sources
- `sourcey-refresh` opens a PR with `runx`-authored docs/config updates
- `issue-to-pr` turns a triaged bounded issue into a scafld-governed draft PR
- `pr-triage` comments on open PRs with a runx-authored maintainer response
- `skill-learning` turns a skill proposal issue into a concrete skill-design PR

The key test at this phase is not only "did the run finish." The real test is
"did the repo end up with a public artifact that a maintainer would actually
want to inspect and use."

## Safety Defaults

- one run should end in a bounded artifact
- every mutating step should be visible in receipts
- external claims should stay grounded in repo evidence unless a research source
  is explicitly supplied
- approvals should remain first-class and human-visible
- repo identity docs should describe the real current stage, not an aspirational
  future as if it already exists
- repeated failure modes should feed skill or context hardening, not endless
  blind retries

## Missing Pieces

These are still explicit gaps rather than hidden assumptions:

- model-provider secret management and rotation
- replay and dedupe for repeated issue or PR events
- a merge policy for automatically generated PRs
- first-class evals for comment quality and PR usefulness
- a rollback lane when a generated PR or comment proves harmful
