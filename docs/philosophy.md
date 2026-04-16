---
title: Philosophy
description: The doctrine that defines what automaton is trying to prove and how it should behave.
---

# Philosophy

`automaton` is meant to be a publicly governed software organism.

That wording matters.

It is not meant to be a theatrical "autonomous agent" that produces impressive
claims while hiding the real operating model. It is meant to be a repo that
improves itself gradually, with visible boundaries, visible receipts, and
visible human judgment.

## Core belief

The core belief behind `automaton` is that useful automation should become more
legible as it becomes more capable.

If the system gets more powerful while becoming harder to inspect, it is moving
in the wrong direction.

If the system gets more helpful while becoming easier to audit, it is moving in
the right direction.

## Principles

### 1. Legibility over spectacle

`automaton` should prefer a boring, inspectable trail over a dramatic demo.

That means:

- a triage comment is better than a hidden routing decision
- a draft PR is better than a silent mutation
- a receipt bundle is better than a narrated claim that "the agent handled it"

### 2. Bounded action over vague autonomy

The system should act on work that fits into a bounded lane with a clear
artifact.

That means:

- route issues before attempting mutation
- turn work into drafts before pretending it is merge-ready
- reject flows that depend on hand-wavy operator intuition or missing context

### 3. Skill accretion over prompt sprawl

Repeated work should become explicit skills, not remain hidden in longer and
longer prompts.

That means:

- recurring review patterns should become governed flows
- repeated operator judgment should become proposal material
- future capability should be packaged, tested, and documented

### 4. Receipts over claims

Every meaningful step should emit evidence that another maintainer can inspect.

That means:

- runs should preserve inputs, outputs, approvals, and errors
- public comments should trace back to a bounded run
- failed lanes should improve the system instead of being quietly retried until
  they disappear

### 5. Governance over convenience

`automaton` should become more useful without quietly discarding approval and
review boundaries.

That means:

- triage remains a first-class public artifact
- PR creation remains a review surface, not an entitlement
- learning new skills remains governed proposal work before it becomes
  automation

### 6. Evolution over reinvention

`automaton` should improve by accumulating trusted capabilities, context, and
docs, not by rebranding every run as a fresh start.

That means:

- the repo narrative should track the real current stage
- docs should become sharper as the repo learns
- each new lane should strengthen the system's memory rather than reset it

## Anti-goals

`automaton` should explicitly avoid four failure modes:

- agent theater: impressive narration with weak operational evidence
- hidden self-modification: silent repo changes without a public review surface
- benchmark fakery: staged inputs that do not resemble real maintainer work
- context drift: skills acting beyond the evidence actually available in the
  repo or supplied research

## What this means in practice

The philosophy is only real if it changes repo behavior.

That is why the current live lanes map directly to the doctrine:

- `support-triage` makes issue routing public before mutation
- `issue-triage` decides whether planning or a worker may start at all
- `issue-to-pr` converts bounded approved work into reviewable draft PRs
- `github-triage` makes PR review guidance visible and attributable
- `sourcey` keeps the repo's public explanation aligned with the live system
- `objective-to-skill` turns repeated needs into governed capability proposals

The long-term story is not "automaton became autonomous."

The long-term story is "automaton became more useful while staying legible,
reviewable, and cumulative."
