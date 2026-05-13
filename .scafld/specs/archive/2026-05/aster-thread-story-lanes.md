---
spec_version: '2.0'
task_id: aster-thread-story-lanes
created: '2026-05-13T16:41:40Z'
updated: '2026-05-13T17:04:10Z'
status: completed
harden_status: passed
size: small
risk_level: medium
---

# Aster thread story issue-to-PR lanes

## Current State

Status: completed
Current phase: final
Next: done
Reason: task completed
Blockers: none
Allowed follow-up command: `none`
Latest runner update: 2026-05-13T17:04:10Z
Review gate: pass

## Summary

Make Aster's governed `fix-pr` and `docs-pr` issue-to-PR lanes consume runx
core's thread-story reviewer packet instead of rendering a bespoke PR story in
Aster. Aster should keep local policy only: lane constraints, target selection,
publication gates, and hosted workflow routing. Also bring the hosted issue
intake path up to the current runx contracts: `intake` for issue routing and
`thread_title`/`thread_body`/`thread_locator` for `issue-to-pr`.

## Objectives

- Keep Aster as a thin proving-ground operator over runx core issue-to-PR
  storytelling.
- Render generated PR bodies through runx core's reusable reviewer packet shape
  while preserving Aster lane guardrails and verification evidence.
- Remove stale or confusing public docs references to old `request-triage`
  terminology where the modern runx `intake` story is intended.
- Update live Aster workflow/runtime calls so current runx can actually execute
  the flow without legacy skill paths or issue-to-pr argument names.
- Align Aster's scafld size contract with current runx `small`/`medium`/`large`
  sizing.
- Keep hosted workflow behavior idempotent and human-gated.

## Scope

- In scope:
  - `scripts/run-governed-pr-lane.mjs` PR body construction for `fix-pr` and
    `docs-pr`.
  - `scripts/runx-thread-story.mjs` as the thin Aster loader for the runx core
    renderer.
  - `.github/workflows/issue-triage.yml` skill invocation from `request-triage`
    to `intake`.
  - `scripts/prepare-issue-triage-decision.mjs` support for current
    `thread_change_request` intake output.
  - `scripts/run-issue-triage-workers.mjs` invocation of latest `issue-to-pr`
    thread-shaped inputs.
  - `scripts/aster-v1-contracts.mjs` and schema mirrors for current scafld size
    values.
  - `scripts/run-governed-pr-lane.test.mjs` coverage for the new shape.
  - Public lane docs in `docs/flows.md`, `docs/run-catalog.md`, and adjacent
    operating docs where they describe the old skill names.
- Out of scope:
  - GitHub workflow trigger names or publication authorization policy changes.
  - Aster evidence projection state rewrites.
  - New mutation lanes or background jobs.
  - Any secrets, tokens, or hosted environment changes.

## Dependencies

- Runx checkout passed as `--runx-root`, built before the lane runs in hosted
  workflows.
- Runx core export `@runxhq/core/knowledge` / built file
  `packages/core/dist/src/knowledge/index.js`.
- Existing Aster verification profile catalog and generated PR policy checks.

## Assumptions

- Hosted workflows continue to build runx before invoking
  `scripts/run-governed-pr-lane.mjs`.
- Tests can inject the runx thread-story renderer to avoid coupling Aster unit
  tests to an external checkout.
- The workflow name `issue-triage` may remain as hosted infrastructure, but docs
  should describe the runx skill story as `intake` where that is the modern
  concept.

## Touchpoints

- `scripts/run-governed-pr-lane.mjs`
- `scripts/run-governed-pr-lane.test.mjs`
- `docs/flows.md`
- `docs/run-catalog.md`
- `docs/operating-model.md`
- Possibly `docs/evolution.md` if it repeats the stale skill story.

## Risks

- Dynamically importing runx core from `--runx-root` can fail if workflows stop
  building runx first. The error should be explicit and actionable.
- Moving the PR body renderer to runx core must not drop lane-specific guardrails,
  source issue links, verification commands, or the human merge gate.
- Docs renames must not imply a workflow rename that has not happened.

## Acceptance

Profile: standard

Validation:
- `node --test scripts/prepare-issue-triage-decision.test.mjs scripts/run-governed-pr-lane.test.mjs scripts/runx-thread-story.test.mjs scripts/aster-core.test.mjs scripts/run-issue-triage-workers.test.mjs scripts/aster-v1-contracts.test.mjs`
- `npm run check`
- `git diff --check`

## Phase 1: Implementation

Status: completed
Dependencies: none

Objective: Complete the requested change.

Changes:
- Refactor governed PR body creation to build a runx reviewer packet input and render it through the runx core thread-story helper.
- Keep lane constraints as Aster-owned context passed into the runx core renderer; do not duplicate the renderer in Aster.
- Change hosted issue intake from `request-triage` to `intake` and pass current thread-shaped inputs.
- Accept `thread_change_request` from intake and normalize it into Aster's worker validation envelope.
- Invoke `issue-to-pr` with `thread_title`, `thread_body`, and `thread_locator`, not removed legacy issue/source arguments.
- Remove `micro` from Aster's current issue-to-PR size contract.
- Update tests to assert the packet input includes source context, request body, verification, review context, risks/guardrails, rollback, and human merge next action.
- Update public docs to use the current `intake` story for issue intake while preserving hosted workflow names.

Acceptance:
- [x] `ac1` command - Governed lane unit tests pass
  - Command: `node --test scripts/prepare-issue-triage-decision.test.mjs scripts/run-governed-pr-lane.test.mjs scripts/runx-thread-story.test.mjs scripts/aster-core.test.mjs scripts/run-issue-triage-workers.test.mjs scripts/aster-v1-contracts.test.mjs`
  - Expected kind: `exit_code_zero`
  - Status: pass
  - Evidence: exit code was 0
  - Source event: entry-6
- [x] `ac2` command - Repository check passes
  - Command: `npm run check`
  - Expected kind: `exit_code_zero`
  - Status: pass
  - Evidence: exit code was 0
  - Source event: entry-7
- [x] `ac3` command - Diff has no whitespace errors
  - Command: `git diff --check`
  - Expected kind: `exit_code_zero`
  - Status: pass
  - Evidence: exit code was 0
  - Source event: entry-8

## Rollback

- Revert the script/test/docs changes. Aster will return to its old bespoke PR
  body rendering while runx core remains available.

## Review

Status: completed
Verdict: pass
Mode: verify
Provider: codex
Output: codex.output_file
Summary: The previously recorded blockers appear repaired: the renderer loader now supports the nested runx oss layout, and the hosted issue intake workflow now resolves the intake skill path before using thread-shaped inputs. I found no completion-blocking regression in the task-scoped verification pass. Residual risk: the actual external runx core export cannot be proven from this read-only workspace unless a checked-out runx build with the expected export is present, but the Aster integration path and nested-layout test are now coherent.

Attack log:
- `scripts/runx-thread-story.mjs`: Known blocker verification: renderer loader path -> clean (Inspected scripts/runx-thread-story.mjs and confirmed resolveRunxCoreKnowledgeModulePath now checks both packages/core/dist/src/knowledge/index.js and oss/packages/core/dist/src/knowledge/index.js. The prior hardcoded-root-layout blocker is repaired in code and covered by scripts/runx-thread-story.test.mjs with a nested oss fixture.)
- `.github/workflows/issue-triage.yml`: Known blocker verification: hosted intake skill path -> clean (Inspected .github/workflows/issue-triage.yml and confirmed the issue lane now resolves RUNX_SKILL_ROOT to either root skills/ or nested oss/skills/ before invoking intake.)
- `scripts/run-governed-pr-lane.mjs`: Spec compliance: governed lane issue-to-pr arguments -> clean (Traced scripts/run-governed-pr-lane.mjs and confirmed issue-to-pr invocation now sends thread_title, thread_body, and thread_locator, with legacy issue/source args and phase removed from the runx skill call.)
- `scripts/run-governed-pr-lane.mjs`: Spec compliance: reviewer packet delegation -> clean (Verified buildLanePrBody delegates to renderRunxReviewerPacket and buildLaneReviewerPacketInput includes source context, request body, verification, review context, risks/guardrails, rollback, branch, and human next action.)
- `scripts/run-governed-pr-lane.mjs`: Regression hunt: async callsites -> clean (Searched buildLanePrBody callsites. The publish path awaits it, and the unit test awaits it. No stale synchronous callsite was found.)
- `scripts/aster-v1-contracts.mjs and spec/*.schema.json`: Contract check: size enum/default -> clean (Inspected normalizeIssueToPrRequest and JSON schemas. micro is removed from current issue-to-pr sizing and defaults normalize to small.)
- `.github/workflows/issue-triage.yml and scripts/prepare-issue-triage-decision.mjs`: Hosted issue intake contract -> clean (Inspected workflow invocation and prepare-issue-triage-decision normalization. The workflow calls intake with thread_title/thread_body/thread_locator, and thread_change_request is coerced into the existing Aster worker validation envelope.)
- `docs and task-scoped files`: Docs terminology sweep -> clean (Searched docs, README, scripts, specs, and workflows for request-triage and micro. No request-triage references remain; remaining bug-to-pr strings are historical/test fixture text outside the requested stale intake terminology cleanup.)
- `acceptance commands`: Acceptance evidence policy -> skipped (Review mode is read-only per provider instruction, so I did not rerun tests or build commands. I treated the recorded acceptance evidence as executed and inspected code paths only.)

Findings:
- none

## Self Eval

- none

## Deviations

- none

## Metadata

- created_by: scafld

## Origin

Created by: scafld
Source: plan

## Harden Rounds

### round-1

Status: passed
Started: 2026-05-13T16:43:43Z
Ended: 2026-05-13T16:44:37Z

Checks:
- path audit
  - Grounded in: code:scripts/run-governed-pr-lane.mjs:244
  - Result: passed
  - Evidence: The duplicated PR story is isolated in `buildLanePrBody`, so Aster
- command audit
  - Grounded in: code:scripts/run-governed-pr-lane.test.mjs:40
  - Result: passed
  - Evidence: Existing unit tests already exercise lane request/body helpers and
- scope/migration audit
  - Grounded in: code:.github/workflows/fix-pr.yml:124
  - Result: passed
  - Evidence: Hosted workflows already build runx before invoking the lane, so
- acceptance timing audit
  - Grounded in: code:scripts/check.mjs:1
  - Result: passed
  - Evidence: `npm run check` is available as a repository-level check and the
- rollback/repair audit
  - Grounded in: code:scripts/run-governed-pr-lane.mjs:219
  - Result: passed
  - Evidence: Rollback is a scoped revert of the PR body builder and docs; no
- design challenge
  - Grounded in: code:scripts/run-governed-pr-lane.mjs:244
  - Result: passed
  - Evidence: Keeping another local Markdown renderer in Aster would let the

Questions:
- none


## Planning Log

- Inspected Aster `scripts/run-governed-pr-lane.mjs`,
  `scripts/run-governed-pr-lane.test.mjs`, hosted workflow docs, and runx core
  `packages/core/src/knowledge/thread-story.ts`.
- Found the reusable reviewer packet already lives in runx core; Aster currently
  duplicates that story with a local `buildLanePrBody` renderer.
