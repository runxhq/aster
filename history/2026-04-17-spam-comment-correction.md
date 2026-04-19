---
title: Correct A Spam-Marked Public Comment
date: 2026-04-17
visibility: public
lane: issue-triage
status: corrected
target_repo: astral-sh/uv
subject_locator: astral-sh/uv#pr/18991
pr_number: 18991
---

# Correct A Spam-Marked Public Comment

`aster` posted a public triage comment on `astral-sh/uv#pr/18991`, a
bot-authored dependency-update PR. GitHub minimized that comment as spam.

The correction was:

- delete the comment
- record the failure in repo-owned memory
- hard-veto bot and dependency-update PRs for public comment work
- add trust-recovery cooldowns so the same lane cannot repeat the mistake on the same target
