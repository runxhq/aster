---
title: Hosted Flows
description: The concrete GitHub workflows that make aster a live runx proving-ground target.
---

# Hosted Flows

## `site-pages`

Builds and deploys `aster.runx.ai` from repo-owned operator content. This
keeps the public site live even when the external caller bridge is offline.

## `issue-triage`

This lane has two entry modes:

1. issue mode listens for every normal issue except `[skill]` proposals, runs
   `support-triage`, prepares one explicit triage decision, optionally runs
   `objective-decompose`, posts the triage comment back to the issue, and
   starts isolated `issue-to-pr` workers only when triage explicitly approves
   build. Replay guard blocks duplicate reruns for the same issue fingerprint
2. PR mode builds a live PR snapshot, runs it through `github-triage`, and
   posts a maintainer comment back to the PR. Public-value and replay gates
   block low-signal or duplicate comments for the same head SHA

## `fix-pr`

Runs on manual dispatch for one bounded bugfix request. The workflow checks out
the target repo, normalizes the request into the governed issue-to-PR contract,
runs the repo through the shared worker path, validates with the target's
verification profile, and opens a draft `runx/*` PR plus receipts.

## `docs-pr`

Runs on manual dispatch for one bounded docs or explanation request. The
workflow uses the same governed PR runner as `fix-pr`, but tightens the request
to docs-only changes before validation and draft PR publication.

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

## `merge-watch`

Runs on schedule or manual dispatch, checks whether an upstream `SKILL.md`
contribution has moved, and emits the updated state plus any registry-binding
request packet.

## `proving-ground`

Runs bounded `runx` catalog calls against the repo to surface receipt,
governance, and evidence-quality drift.

## `generated-pr-policy`

Runs on generated `runx/*` pull requests and enforces the draft-only,
human-reviewed merge policy in the PR body and draft state.

## `rollback`

Runs only on manual dispatch and posts a corrective public comment or closes a
generated PR when an earlier aster output must be superseded.
