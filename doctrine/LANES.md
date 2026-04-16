---
title: Automaton Lanes
updated: 2026-04-16
visibility: public
---

# Automaton Lanes

The operator works through bounded lanes.

## Active Lanes

- `issue-supervisor`: triage a GitHub issue, decide whether planning or a worker should start, and publish a public operator comment.
- `pr-triage`: review a live PR snapshot and publish the next maintainer-grade unblock.
- `skill-learning`: turn a repeated need into a governed skill proposal.
- `skill-contribution`: prepare and optionally publish a portable `SKILL.md` into another repo.
- `skill-contribution-watch`: watch upstream contribution state and publish public proof when the status changes.
- `runx-dogfood`: run bounded `runx` lanes against the repo to surface missing boundaries and evidence quality.

## Transitional Lanes

- `sourcey-refresh`: maintain the working docs surface while `site/` replaces Sourcey as the intended public face.
- `docs-pages`: deploy the separate public site during migration from the old docs-first surface.

Every lane must:

- consume a bounded context bundle
- emit receipts or artifact references
- leave history and reflection updates to the promotion layer

