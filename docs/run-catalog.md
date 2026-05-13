# Run Catalog

This is the live lane catalog for `aster`.

`runx` owns the product surface: skills and skill chains.

`aster` is the proving ground that runs selected `runx` capabilities live as
lanes against real repo work.

## Live Mutation And Comment Lanes

### `issue-triage`

- trigger: GitHub issues except dedicated `[skill]`, `[fix]`, `[docs]`, and
  `[upstream]` work issues, trusted maintainer issue comments on those work
  issues, plus PR `opened`, `reopened`, `ready_for_review`, and `synchronize`
- runx skills and chains:
  1. `intake`
  2. `issue-triage`
  3. optional `work-plan`
  4. optional `issue-to-pr` worker fanout
  5. draft PR publication per worker
- PR command: `runx skill <runx>/skills/issue-triage --runner respond`
- purpose: make issue and PR routing public before mutation, start bounded
  workers only after thread teaching authorizes build, keep PR review legible,
  treat the work issue as the living ledger for amendments and machine updates,
  and dedupe repeated issue or PR events before public output
- output: triage comment, triage decision artifact, optional archived scafld
  specs, promotion packet drafts inside uploaded artifacts, receipts, draft PRs,
  issue backlink comments, posted PR comments, comment evals, generated-PR
  evals, active thread-teaching context, and the bounded issue-ledger packet
- boundary: generated derived-state PRs such as evidence-projection refreshes
  are blocked from PR-mode `issue-triage`; they remain review surfaces only

### `skill-lab`

- trigger: GitHub issues whose title begins with `[skill]`, plus trusted
  maintainer issue comments on those work issues
- runx chain: `skill-lab`
- purpose: turn a proposed new capability into a concrete skill package
  proposal, materialize it under `docs/skill-proposals/`, keep one rolling
  machine comment on the same work issue, and refresh one draft PR only after
  the same thread authorizes `skill-lab.publish`
- output: proposal markdown, raw packet JSON, receipts, promotion packet
  drafts inside uploaded artifacts, optional draft PR, rolling issue status
  comment, and the bounded issue-ledger packet

### `evidence-projection-derive`

- trigger: scheduled every six hours, plus manual dispatch
- command: `node scripts/derive-evidence-projections.mjs`
- purpose: rebuild `state/evidence-projections.json` from uploaded GitHub
  Actions artifacts instead of mutating repo-owned memory inline during
  issue-triage, promote only durable or teaching-bearing rows into
  repo-owned `history/`, `reflections/`, and target dossier recent outcomes,
  and suppress repeated retries onto one latest projection per bounded
  objective
- output: rolling draft PR, projection state file, artifact-derive report,
  latest-batch summary files, and uploaded derive artifacts
- review surface: the branch is reset from `main` and rebuilt on every run, so
  the PR stays one rolling derived review surface rather than an append-only
  queue of branch-local merges
- note: generic low-signal completions remain in state-only projection for
  runtime context and training
- note: pure `state/evidence-projections.json` compaction with zero public
  projection deltas is treated as a semantic noop rather than a new rolling PR

### `fix-pr`

- trigger: GitHub issues whose title begins with `[fix]`, trusted maintainer
  issue comments on those work issues, plus manual workflow dispatch for
  explicit reruns
- command: `node scripts/run-governed-pr-lane.mjs --lane fix-pr`
- purpose: turn one bounded bugfix request into a validated draft `runx/*` PR
  outside issue-triage worker fanout while keeping one rolling machine update
  on the same work issue
- gate: requires the same work issue thread to authorize `fix-pr.publish`
- output: normalized request packet, verification report, receipts, rolling
  work-issue status comment, change-surface policy, optional draft PR,
  generated-PR eval when a draft PR is refreshed, and live provider-trace
  heartbeat files while hosted caller work is in flight

### `docs-pr`

- trigger: GitHub issues whose title begins with `[docs]`, trusted maintainer
  issue comments on those work issues, plus manual workflow dispatch for
  explicit reruns
- command: `node scripts/run-governed-pr-lane.mjs --lane docs-pr`
- purpose: turn one bounded docs or explanation request into a validated draft
  `runx/*` PR while constraining the mutation to docs-only scope and keeping
  one rolling machine update on the same work issue
- gate: requires the same work issue thread to authorize `docs-pr.publish`
- output: normalized request packet, verification report, receipts, rolling
  work-issue status comment, change-surface policy, optional draft PR,
  generated-PR eval when a draft PR is refreshed, and live provider-trace
  heartbeat files while hosted caller work is in flight

### `skill-upstream`

- trigger: GitHub issues whose title begins with `[upstream]`, trusted
  maintainer issue comments on those work issues, plus manual workflow dispatch
  for explicit reruns
- command: `node scripts/prepare-skill-upstream.mjs` followed by
  `node scripts/validate-skill-upstream.mjs`
- purpose: add a portable upstream `SKILL.md` to a target repo without adding
  runx-specific binding files while keeping the proposal and publish state on
  one work issue ledger
- gate: the same work issue thread authorizes `skill-upstream.publish`
- first target: `nilstate/icey-cli`
- output: target `SKILL.md`, contribution artifact packet, PR body, rolling
  work-issue status comment, optional draft PR, public evidence row

### `merge-watch`

- trigger: scheduled and manual workflow dispatch
- command: `node scripts/merge-watch.mjs`
- purpose: observe upstream PR state after a portable `SKILL.md` contribution
  and hand accepted skills to runx registry binding
- first target: `nilstate/icey-cli#2`
- output: `skill_upstream_state.json`, proof-wall event, and
  `registry_binding_request.json` after upstream merge

## Continuous Support Lanes

### `site-pages`

- trigger: push to `main` affecting docs sources, or manual dispatch
- command: `npm run site:build`
- purpose: publish the public `aster.runx.ai` site
- output: GitHub Pages deployment from `site/dist`

### `proving-ground`

- trigger: scheduled and manual workflow dispatch
- purpose: keep broader receipt and envelope visibility across the catalog even
  when live mutation lanes are unavailable
- current runx profile:
  - `evolve-introspect`
  - `sourcey`
  - optional broader research/content lanes when the checked-out `runx` ref
    includes them

### `generated-pr-policy`

- trigger: generated `runx/*` PR events, plus manual dispatch
- command: `node scripts/enforce-generated-pr-policy.mjs`
- purpose: keep generated PRs draft-only and explicitly human-reviewed
- output: policy-enforcement artifact plus any corrective PR body/comment update
- note: publication now also carries a change-surface policy describing which
  repo surfaces the generated branch touched

### `rollback`

- trigger: manual workflow dispatch
- command: `node scripts/rollback-run.mjs`
- purpose: publish a corrective comment or close a generated PR when a prior
  aster output was wrong
- output: rollback artifact plus the public correction or closure action

## Next Lanes

These are still missing or intentionally deferred:

- `prior-art` for explicit skill research packets before adoption work starts
- `trust-audit` for public evaluation of lanes, targets, and skills
- `market-brief` for periodic ecosystem briefs with explicit source sets
