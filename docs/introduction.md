---
title: Introduction
description: What automaton is, what it is not, and why it exists as the public runx target.
---

# automaton

`automaton` is the public repo where `runx` is supposed to prove that governed
automation can be useful, legible, and cumulative.

It is not meant to be a vague demo repo.

It is also not meant to be a secretly self-modifying agent.

It is meant to be a visible software organism with a slow, reviewable
evolutionary path.

The governing philosophy is simple:

- legibility over spectacle
- bounded action over vague autonomy
- receipts over claims
- skill accretion over prompt sprawl

That doctrine is expanded in [philosophy.md](./philosophy.md). This page stays
focused on what the repo exists to prove.

## Core claim

The core claim of `automaton` is:

1. real issues can be triaged in public
2. bounded issues can become draft PRs
3. PRs can receive useful operator comments
4. new capabilities can begin as governed skill proposals
5. every step can emit receipts instead of hand-wavy claims

That claim only matters if the repo remains inspectable. `automaton` should get
more capable without becoming more mysterious.

## What belongs here

The docs in this repo should describe:

- the intention of `automaton`
- the architecture and memory boundary between `automaton` and `runx`
- the real live flows running against this repo
- the governance boundaries around self-improvement
- the current evolutionary stage and the next stage

The docs in the `runx` repo should describe:

- the `runx` engine
- skill packaging and execution contracts
- platform and hosted control-plane concepts
- framework-level deployment and administration guidance

## Success criteria

`automaton` is succeeding when the public repo shows a believable trail of
bounded improvement:

- issues do not disappear into a queue; they receive triage
- bounded improvements become PRs instead of endless planning
- repo docs stay aligned with the live system
- skill proposals feed future automation instead of staying as backlog vapor
- evaluators can inspect the full trail from trigger to receipt to PR or comment

It is also succeeding when the repo becomes easier for the next run to
understand. Better docs, sharper context, safer skill boundaries, and clearer
governance all count as real progress.

This repo is intentionally small so the full loop stays inspectable: trigger,
workflow, `runx` packet, bridge output, artifacts, git diff, and final public
result.

For the execution shape behind that loop, see
[architecture.md](./architecture.md).
