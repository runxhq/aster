---
title: Hosted Flows
description: The concrete GitHub workflows that make automaton a live runx dogfood target.
---

# Hosted Flows

## `docs-pages`

Builds and deploys the Sourcey site from committed docs sources. This keeps the
public documentation live even when the external caller bridge is offline.

## `sourcey-refresh`

Runs the `runx` `sourcey` skill against this repo, auto-approves the bounded
docs plan, validates the resulting docs source with a fresh Sourcey build, and
opens a draft PR.

## `issue-supervisor`

Listens for every normal issue except `[skill]` proposals. The workflow:

1. runs `support-triage`
2. prepares one explicit supervisor decision from the triage output
3. optionally runs `objective-decompose` when triage approves a planning lane
4. posts the supervisor comment back to the issue
5. starts one or more isolated `issue-to-pr` workers only when triage
   explicitly approves build
6. lets scafld carry the spec, audit, review, and archive lifecycle
7. opens one draft PR per approved worker branch

## `pr-triage`

Builds a live PR snapshot, runs it through `github-triage`, and posts a
maintainer comment back to the PR. Comment dedupe prevents repeated posts for
the same head SHA.

## `skill-learning`

Listens for issues whose title begins with `[skill]`, runs
`objective-to-skill`, materializes the result under `docs/skill-proposals/`,
and opens a draft PR with the generated proposal.
