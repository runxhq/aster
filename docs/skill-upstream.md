---
title: Skill Upstream
description: The upstream SKILL.md contribution lane from candidate artifact to draft PR.
---

# Skill Upstream

`skill-upstream` is the public upstream loop for portable `SKILL.md`
files. It is separate from `skill-lab`.

`skill-lab` decides what should be learned and produces a candidate
artifact. `skill-upstream` takes a candidate and opens a maintainer-facing
PR to the repo that benefits from the file.

## Boundary

What goes upstream:

- `SKILL.md`
- plain markdown instructions
- repo-specific workflows, commands, validation expectations, and safety notes
- a restrained optional compatibility note

What stays in runx:

- `x.yaml`
- auth and scope policy
- harnesses
- receipts
- registry trust tier
- install and run commands

The upstream PR should never require runx. The file must be useful as project
documentation and as portable agent context.

## Execution Contract

The lane writes these artifacts under `.artifacts/skill-upstream/`:

- `skill_opportunity.json`
- `prior_art_report.json`
- `skill_candidate.json`
- `contribution_packet.json`
- `public_feed_event.json`
- `pr-body.md`

The shared schema is `schemas/skill-upstream-artifacts.schema.json`.

## Workflow

The hosted workflow is `.github/workflows/skill-upstream.yml`.

Normal entry is a work issue whose title begins with `[upstream]`.
Trusted maintainer replies on that same issue rerun the lane from the
refreshed work ledger. Manual dispatch with `issue_number` still exists for an
explicit rerun, but it is no longer the normal maintainer entry path.

The issue body names the target repo and optional target ref, workflow, mode,
candidate path, and force flag. That same issue thread is the living ledger for
the whole contribution: initial context, maintainer amendments, publish
authorization, and rolling machine updates all stay in one place.

The workflow checks out `aster`, checks out the target repo, prepares the
portable skill contribution, validates the public-language and artifact gates,
and refreshes the rolling issue status comment. Publication fails closed unless
that same work issue thread authorizes `skill-upstream.publish` for the target
repo; without the gate the run stays proposal-only and can be rerun after the
issue is amended.

## Watch Lane

After a contribution PR exists, `merge-watch` owns the post-merge
state transition. It reads the GitHub PR state, status checks, changed files,
merge commit, and upstream `SKILL.md` blob metadata.

The lane writes these artifacts under `.artifacts/merge-watch/`:

- `skill_upstream_state.json`
- `public_feed_event.json`
- `registry_binding_request.json` when the PR reaches `accepted_upstream`

The watcher is read-only against the external repo. It does not argue with
maintainers and it does not add `x.yaml` upstream. Its job is to turn upstream
state into a clean internal handoff: `accepted_upstream`,
`rejected_upstream`, or `stale_upstream`.

The hosted workflow is `.github/workflows/merge-watch.yml`.

## Proving-Ground Target

The first target is `nilstate/icey-cli` because it has a concrete operator
surface:

- C++ server build
- bundled web UI build
- browser smoke path
- Docker demo
- release artifacts
- package-manager publication
- pinned `nilstate/icey` dependency through `ICEY_VERSION`

That makes it a strong first proof for a portable upstream `SKILL.md`: the
file can describe real workflows without needing runx-specific execution
metadata.

## Public Language Rules

Use contribution language:

- portable skill
- upstream skill
- compatible tooling
- verification
- provenance

Do not use strategy language in public PRs or generated files:

- adoption
- wedge
- funnel
- conversion
- target account
- growth loop
- trojan horse

## PR Pitch References

The upstream PR body should explain why `SKILL.md` is a credible format, not
just why this repo could use one.

Reference these public sources:

- Agent Skills specification: `https://agentskills.io/specification`
- Agent Skills overview: `https://agentskills.io/`
- Anthropic public skills repository: `https://github.com/anthropics/skills`
- Claude Skills overview: `https://claude.com/docs/skills/overview`

Do not call the format an "Anthropic RFC" unless a canonical RFC URL is present
in the source material. The stronger phrasing is: "The Agent Skills format was
originally developed by Anthropic and is documented as an open specification."

## Local Proving-Ground

From the `aster` repo:

```bash
node scripts/prepare-skill-upstream.mjs \
  --target-repo-dir /home/kam/dev/icey-cli \
  --target-repo nilstate/icey-cli \
  --output-dir .artifacts/skill-upstream/icey-cli \
  --workflow operator-bringup \
  --mode requested

node scripts/validate-skill-upstream.mjs \
  --target-repo-dir /home/kam/dev/icey-cli \
  --artifacts-dir .artifacts/skill-upstream/icey-cli
```

Watch the merged upstream PR and produce the binding handoff:

```bash
node scripts/merge-watch.mjs \
  --repo nilstate/icey-cli \
  --pr 2 \
  --candidate-path SKILL.md \
  --registry-owner nilstate \
  --artifacts-dir .artifacts/merge-watch/icey-cli
```

Publish only after reviewing the generated `SKILL.md` and PR body:

```bash
(
  cd /home/kam/dev/icey-cli
  node /home/kam/dev/aster/scripts/publish-runx-pr.mjs \
    --repo nilstate/icey-cli \
    --branch runx/add-skill-md \
    --title "Add portable SKILL.md" \
    --commit-message "docs: add portable SKILL.md" \
    --body-file /home/kam/dev/aster/.artifacts/skill-upstream/icey-cli/pr-body.md
)
```
