# Operating Model

`automaton` is the public repo that `runx` should improve gradually over time.

The governing rule is simple: recommendation first, mutation second.

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

### 3. Approve

Public or mutating work stays gated:

- repo writes require explicit approval
- public posts require explicit approval
- PR creation requires explicit approval

This repo exists to prove governed automation, not to bypass it.

### 4. Apply

Once the repo and hosted control plane are ready, `automaton` graduates from
draft-only to bounded local patches and then to PR publication.

That progression should be gradual:

1. introspection and draft packets
2. patch plans with approval
3. local patch application in isolated branches
4. PR publication after review

## Safety Defaults

- one run should end in a bounded artifact
- every mutating step should be visible in receipts
- external claims should stay grounded in repo evidence unless a research source
  is explicitly supplied
- approvals should remain first-class and human-visible

