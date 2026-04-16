---
title: Evolution
description: The intended evolutionary path for automaton as a governed self-improving repo.
---

# Evolution

`automaton` should not jump from "demo repo" to "full autonomous maintainer."

It should evolve through stages that are easy to inspect and hard to fake.

Each stage should preserve the same doctrine:

- keep actions bounded
- keep approvals visible
- keep repo identity honest
- turn repeated work into durable skill and docs improvements

## Stage 1: Observable

At the first stage, `automaton` proves that the system can observe itself and
emit credible receipts.

Signals at this stage:

- live docs exist
- proving-ground runs emit artifacts
- hosted workflows are inspectable
- the repo narrative matches reality

## Stage 2: Responsive

At the second stage, `automaton` stops being a passive demo surface and starts
responding to inbound work.

Signals at this stage:

- issues receive triage replies
- approved bounded issues escalate into one or more repo-scoped
  `issue-to-pr` workers through `issue-triage`
- PRs receive review comments through `issue-triage`
- the repo shows real input-to-output loops

## Stage 3: Self-Improving

At the third stage, `automaton` begins improving its own instructions, docs,
and operating surfaces through governed PRs.

Signals at this stage:

- Sourcey docs refresh against the live repo
- bounded repo fixes land through draft PRs
- recurring failures become concrete backlog items
- the repo becomes easier for future runs to understand

This stage matters because self-improvement is where most systems become vague.
`automaton` should do the opposite: the more it changes itself, the more
inspectable its reasoning trail should become.

## Stage 4: Skill-Accreting

At the fourth stage, repeated operator work stops living only in comments and
starts becoming skill proposals.

Signals at this stage:

- new skill ideas arrive through issues
- `objective-to-skill` produces proposal PRs
- proposals reference concrete receipts and repeated operator needs
- the system gets more capable without skipping governance

This is the real compounding layer. A healthy `automaton` should not only solve
tasks. It should convert repeated classes of work into clearer future
capability.

## Stage 5: Ecosystem-Useful

The long-term goal is that `automaton` becomes useful beyond itself.

Signals at this stage:

- it helps triage community-facing work
- it produces operator briefs and release-facing summaries
- it improves its own repo while demonstrating practices others can copy
- it serves as the public proof that `runx` can govern gradual evolution

## Current posture

Right now `automaton` is between Stage 1 and Stage 2:

- the live repo and docs surface exist
- hosted lanes are real
- issue-triage, issue-to-PR workers, and skill-lab are
  being exercised
- the evolutionary story is now explicit instead of implied

That is the right posture. The repo should describe the current stage honestly
while making the next stage concrete.

The next pass should move the repo deeper into Stage 2 and early Stage 3:

- make issue and PR loops reliable under real load
- keep Sourcey docs aligned with the repo's real behavior
- use repeated failures to harden skills rather than only patch workflows
- let new proposals emerge from recurring evidence, not aspirational wishlists
