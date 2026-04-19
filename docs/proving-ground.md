---
title: Proving-Ground Story
description: Why aster exists as a public proving-ground surface and how that loop should work.
---

# Proving-Ground Story

`aster` exists so `runx` can test itself on a real public target instead
of a private benchmark or a staged demo.

The repo matters because it forces the system to confront real operating
conditions:

- incomplete issue descriptions
- ambiguous routing decisions
- repo context that is useful but never perfect
- public artifacts that can be inspected by anyone

That pressure is the point. A proving-ground loop is not only about proving that a lane
can succeed. It is about exposing where skill context is thin, where research
is under-specified, and where governance needs to be sharper.

## The loop

1. a real issue, PR, or schedule trigger enters the repo
2. a hosted workflow packages that trigger into a bounded `runx` invocation
3. `runx` pauses at each `agent-step`
4. an external caller bridge answers those steps without privileged shortcuts
5. the workflow resumes the run, records receipts, and applies the resulting
   bounded output
6. changes land as a draft PR or a posted PR comment, not as a hidden mutation

## Why this matters

- the repo becomes a public proof surface for governed automation
- every lane emits receipts instead of just claiming it worked
- failures can feed back into skill hardening instead of being buried
- project evaluators can inspect the whole system from issue intake to PR
- `aster` can develop a visible evolutionary history rather than a static
  showcase narrative

## The intended proving-ground trajectory

The proving-ground story should grow in layers:

1. observe the repo honestly
2. answer and route inbound issues
3. turn bounded work into PRs
4. review PRs with useful operator feedback
5. propose new skills when repeated work patterns appear
6. contribute portable `SKILL.md` files to upstream repos that benefit from
   the learned workflow
7. gradually improve the repo and the governing system together

That last point matters most. `aster` is not only a destination for `runx`
workflows. It is the public record of how those workflows become trustworthy.

The proving-ground loop should therefore improve two things at once:

- the `aster` repo itself
- the quality of the `runx` skills and flows acting on it
