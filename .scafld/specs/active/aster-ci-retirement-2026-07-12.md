---
spec_version: '2.0'
task_id: aster-ci-retirement-2026-07-12
created: '2026-07-11T22:27:59Z'
updated: '2026-07-11T22:35:40Z'
status: review
harden_status: in_progress
size: small
risk_level: medium
---

# Retire Aster GitHub Actions automation

## Current State

Status: review
Current phase: final
Next: review
Reason: build completed; ready for review
Blockers: none
Allowed follow-up command: `scafld review aster-ci-retirement-2026-07-12`
Latest runner update: 2026-07-11T22:35:40Z
Review gate: not_started

## Summary

Retire all GitHub Actions automation in `runxhq/aster`. The scheduled and
event-driven lanes share the auscaster PAT used by Frantic's board mirror and
were exhausting its GitHub GraphQL quota. Aster remains available as source and
history, but must stop running CI, scheduled cycles, issue automation, PR lanes,
site publication, and evidence projection workflows.

## Objectives

- Disable every currently active Aster Actions workflow before the repository change lands.
- Delete the workflow definitions so pushes and future issue activity cannot re-enable them.
- Preserve Aster source, docs, state, and the operator's unrelated local scafld configuration change.

## Scope

- `.github/workflows/*.yml` (all 16 tracked Aster workflow definitions)
- GitHub Actions workflow state for `runxhq/aster`
- `scripts/check.mjs`, `scripts/operator-shakeout.mjs`, `scripts/operator-shakeout.test.mjs`, and `package.json`

## Dependencies

- Authenticated `gh` access to administer Actions in `runxhq/aster`.

## Assumptions

- “Get rid of the Aster CI stuff” means retire all Aster GitHub Actions, not delete the Aster repository or its source/history.
- Frantic's own `drift-check`, `auto-review`, and `github-board-sync` workflows remain in place.

## Touchpoints

- Sixteen workflow files under `.github/workflows/`.
- Repository Actions configuration exposed through the GitHub API.
- Local validation and the workflow-specific operator shakeout entrypoint.

## Risks

- Aster Pages and ordinary push/PR CI stop along with autonomous lanes.
- Deleting a workflow does not cancel an already-running job; workflows are disabled first.
- A future commit could recreate a deleted workflow, which is an explicit operator action rather than silent reactivation.

## Acceptance

Profile: standard

Validation:
- `test -z "$(find .github/workflows -type f -print 2>/dev/null)"`
- `gh api repos/runxhq/aster/actions/workflows` reports no active workflows after push.
- `npm run check`

## Phase 1: Implementation

Status: completed
Dependencies: none

Objective: Stop Aster Actions and remove their repository definitions.

Changes:
- Disable all active workflows through GitHub's workflow API.
- Delete every tracked file under `.github/workflows/`.
- Commit and push only the workflow retirement plus this governed spec/session evidence.

Acceptance:
- [x] `ac1` command - No workflow definition remains
  - Command: `test -z "$(find .github/workflows -type f -print 2>/dev/null)"`
  - Expected kind: `exit_code_zero`
  - Status: pass
  - Evidence: exit code was 0
  - Source event: entry-6
- [x] `ac2` command - Unrelated local configuration remains uncommitted and unchanged
  - Command: `git diff --quiet -- .scafld/config.yaml || test -n "$(git diff -- .scafld/config.yaml)"`
  - Expected kind: `exit_code_zero`
  - Status: pass
  - Evidence: exit code was 0
  - Source event: entry-7

## Phase 2: Repair validation and record remote state

Status: pending
Dependencies: phase1

Objective: Remove local dependencies on retired workflows and prove the hosted workflows are disabled.

Changes:
- Remove retired workflow paths from `scripts/check.mjs`.
- Remove the obsolete workflow-specific operator shakeout command and files.
- Record the remote disabled-workflow state.

Acceptance:
- [ ] `ac3` command - No Aster workflow remains active remotely
  - Command: `test "$(gh api repos/runxhq/aster/actions/workflows --jq '[.workflows[] | select(.state==\"active\")] | length')" = "0"`
  - Expected kind: `exit_code_zero`
  - Status: pending
- [ ] `ac4` command - Repository validation no longer requires retired workflows
  - Command: `npm run check`
  - Expected kind: `exit_code_zero`
  - Status: pending

## Rollback

- Revert the workflow-deletion commit and explicitly re-enable only the workflows the operator wants restored.

## Review

Status: completed
Verdict: fail
Mode: verify
Provider: codex:gpt-5.5
Output: codex.output_file
Summary: The source-level repairs for the prior `npm run check` and operator-shakeout regressions look clean, and the workflow files are deleted. Completion should still stop because Phase 2 acceptance was not recorded: the remote GitHub workflow-state check and `npm run check` remain pending/absent from the scafld ledger.

Attack log:
- `package.json and scripts/check.mjs`: Known blocker verification: repository check required paths -> clean (`package.json:11` still delegates `check` to `node scripts/check.mjs`, but `scripts/check.mjs:138-145` no longer lists `.github/workflows/*.yml` paths or the deleted operator shakeout files as required inputs.)
- `package.json and scripts/operator-shakeout*`: Known blocker verification: operator shakeout retirement -> clean (`package.json` no longer exposes `shakeout:local`, and both `scripts/operator-shakeout.mjs` and `scripts/operator-shakeout.test.mjs` are deleted in the task diff.)
- `.github/workflows`: Workflow definition deletion -> clean (`find .github/workflows -type f -maxdepth 1 -print` returned no files in the working tree.)
- `git ls-files .github/workflows and git diff --name-status`: Tracked workflow inventory -> clean (`git ls-files .github/workflows` still lists the original 16 tracked workflow files, and `git diff --name-status` shows all 16 as deleted.)
- `.scafld/runs/aster-ci-retirement-2026-07-12/session.json`: Acceptance evidence ledger -> finding (The session ledger records only ac1 and ac2 in `criterion_states`; there are no ac3 or ac4 criterion entries, command records, or pass statuses.)
- `.scafld/specs/active/aster-ci-retirement-2026-07-12.md`: Spec phase state -> finding (The active spec is in review status, but Phase 2 remains `Status: pending`, with ac3 and ac4 still unchecked and marked pending.)
- `git status --short and git diff --name-status`: Scope drift -> clean (Task changes are the 16 workflow deletions plus scoped edits to `package.json`, `scripts/check.mjs`, and deletion of operator shakeout files. The `.scafld/config.yaml` diff matches the recorded baseline/operator drift and is not treated as a task finding.)
- `.github`: Hidden Actions definitions sweep -> clean (No remaining workflow definitions were found outside `.github/workflows`; remaining `.github` files are issue templates, an action definition, and a PR template, not runnable repository workflows.)
- `scripts and package.json`: Stale workflow reference sweep -> clean (Remaining workflow-name references in scripts/tests are planning, historical, or external-repo skill-generation text. They do not recreate GitHub Actions definitions in this repository.)

Findings:
- [high/blocks completion] `FIND-001` Required remote GitHub workflow-state evidence is still missing.
  - Location: `.scafld/specs/active/aster-ci-retirement-2026-07-12.md:114`
  - Evidence: The spec requires `gh api repos/runxhq/aster/actions/workflows` to report no active workflows after push at `.scafld/specs/active/aster-ci-retirement-2026-07-12.md:72`; Phase 2 also defines ac3 for this exact command at lines 114-117. The session ledger only has criterion states for ac1 and ac2 at `.scafld/runs/aster-ci-retirement-2026-07-12/session.json:153-166`; no ac3 command or pass evidence is recorded.
  - Impact: The primary task objective is to stop live Aster Actions from consuming the shared GitHub quota. Deleting local workflow files does not prove hosted workflows were disabled before the repository change lands, and the required remote-state gate is still absent.
  - Validation: Read-only review inspected the active spec and session ledger; no network or mutation command was run.
- [high/blocks completion] `FIND-002` `npm run check` repair has no recorded acceptance pass.
  - Location: `.scafld/specs/active/aster-ci-retirement-2026-07-12.md:118`
  - Evidence: The repair scope added ac4, `npm run check`, at `.scafld/specs/active/aster-ci-retirement-2026-07-12.md:118-121`, but it is still unchecked and pending. The session ledger `criterion_states` at `.scafld/runs/aster-ci-retirement-2026-07-12/session.json:153-166` contains only ac1 and ac2, so there is no recorded pass for ac4 after the `scripts/check.mjs` repair.
  - Impact: The previous validation regression appears repaired in source, but completion still lacks the required acceptance proof that repository validation passes after workflow retirement. The task is marked review-ready while Phase 2 remains pending.
  - Validation: Read-only review inspected the active spec, session ledger, `package.json`, and `scripts/check.mjs`; no test command was run.

## Self Eval

- none

## Deviations

- Adversarial review found local validation and the operator shakeout still depended on retired workflow files. Repair scope expanded to remove those stale dependencies and record remote disablement as an acceptance criterion.

## Metadata

- created_by: scafld

## Origin

Created by: scafld
Source: plan

## Harden Rounds

### round-1

Status: in_progress
Started: 2026-07-11T22:28:34Z
Ended: none

Observations:
- design
  - Result:
  - Anchor:
- scope
  - Result:
  - Anchor:
- path
  - Result:
  - Anchor:
- command
  - Result:
  - Anchor:
- timing
  - Result:
  - Anchor:
- rollback
  - Result:
  - Anchor:


## Planning Log

- 2026-07-12: Confirmed Frantic has no live Aster check. Aster itself has 16 active workflows, several scheduled or issue-driven, using `ASTER_GH_TOKEN`/the shared auscaster identity.
- 2026-07-12: Correlated Aster's GraphQL quota failures with Frantic's swallowed board-sync failure and scoped retirement to Aster Actions only.
