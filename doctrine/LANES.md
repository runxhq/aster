---
title: Automaton Lanes
updated: 2026-04-16
visibility: public
---

# Automaton Lanes

The operator works through bounded lanes.

## Active Lanes

- `issue-triage`: triage a GitHub issue, decide whether planning or a worker should start, and publish a public operator comment.
- `fix-pr`: fix one bounded bug in one bounded repo surface.
- `docs-pr`: improve docs or repo explanation.
- `skill-lab`: validate a skill against real automaton work and record whether it is actually useful.
- `skill-recon`: investigate whether a skill should exist at all.
- `skill-upstream`: contribute a portable `SKILL.md` upstream into another repo.
- `merge-watch`: observe upstream contribution state and publish public proof when the status changes.
- `trust-audit`: publish a public evaluation of a skill, lane, or target.
- `market-brief`: publish market intelligence on the agent ecosystem.
- `proving-ground`: run bounded `runx` lanes against the repo to surface missing boundaries and evidence quality.

## Transitional Lanes

- `sourcey-refresh`: maintain the working docs surface while `site/` replaces Sourcey as the intended public face.
- `docs-pages`: deploy the separate public site during migration from the old docs-first surface.

Every lane must:

- consume a bounded context bundle
- emit receipts or artifact references
- leave history and reflection updates to the promotion layer
