---
title: Automaton Scoring Policy
updated: 2026-04-16
visibility: public
---

# Automaton Scoring Policy

`automaton` should not run work because it is available.

It should run work because it clears a public-value bar.

## Weighted Thesis Score

Use one weighted score from `0.00` to `1.00`:

- `stranger_value`: `0.24`
- `proof_strength`: `0.24`
- `compounding_value`: `0.19`
- `tractability`: `0.16`
- `novelty`: `0.09`
- `maintenance_efficiency`: `0.08`

The score is:

`sum(weight * metric)`

## Vetoes

Do not act when any veto is active:

- `stranger_value < 0.60`
- `proof_strength < 0.70`
- target has no curated dossier
- lane is not allowed by the target dossier
- cooldown is active for the same lane on the same target
- subject already has an open operator-memory PR
- bot-authored pull requests are vetoed by default
- dependency-update or internal/build-only pull requests do not count as thesis work

When every candidate is vetoed, return `no_op`.

## Selection Threshold

If the top non-vetoed candidate scores below `0.68`, prefer `no_op`.

This keeps the operator selective.

## Cooldowns

Cooldowns are lane-and-target scoped.

- `completed`, `success`, `merged`, `published`: `72h`
- `noop`, `ignored`, `stale`, `silence`: `7d`
- `rejected`, `corrected`: `21d`
- `failed`, `error`: `24h`

## Lane Heuristics

The intended biases are:

- live public issues and PRs usually outrank maintenance work
- maintenance work may clear the bar when it is stale enough and directly improves the public face
- repeated identical work on the same target should decay in novelty and trigger cooldowns
- `automaton` should prefer public proof work over private housekeeping when both are available

## Selection Loop

The cycle is:

1. discover candidate opportunities
   use scheduled target scans and live GitHub events, but only for dossier-backed targets
2. score each candidate mechanically
3. keep the top three as the priority queue
4. select the highest non-vetoed candidate or emit `no_op`
5. dispatch exactly one bounded lane

The selector is part of the operator core. It is not a vague human convention.
