---
title: Hosted Flows
description: The concrete GitHub workflows that make automaton a live runx proving-ground target.
---

# Hosted Flows

## `docs-pages`

Builds and deploys the Sourcey site from committed docs sources. This keeps the
public documentation live even when the external caller bridge is offline.

## `sourcey-refresh`

Runs the `runx` `sourcey` skill against this repo, auto-approves the bounded
docs plan, validates the resulting docs source with a fresh Sourcey build, and
opens a draft PR.

## `issue-triage`

This lane has two entry modes:

1. issue mode listens for every normal issue except `[skill]` proposals, runs
   `support-triage`, prepares one explicit triage decision, optionally runs
   `objective-decompose`, posts the triage comment back to the issue, and
   starts isolated `issue-to-pr` workers only when triage explicitly approves
   build
2. PR mode builds a live PR snapshot, runs it through `github-triage`, and
   posts a maintainer comment back to the PR. Comment dedupe prevents repeated
   posts for the same head SHA

## `skill-lab`

Listens for issues whose title begins with `[skill]`, runs
`objective-to-skill`, materializes the result under `docs/skill-proposals/`,
and opens a draft PR with the generated proposal.

## `skill-upstream`

Runs on manual dispatch for an external target repo. The workflow checks out
the target, prepares a portable upstream `SKILL.md`, validates the contribution
artifacts and public language, uploads the artifact packet, and optionally
opens a draft PR against the target repo.

The first proving-ground target is `nilstate/icey-cli`.
