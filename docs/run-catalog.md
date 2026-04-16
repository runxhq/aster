# Run Catalog

This is the live run catalog for `automaton`.

## Live Mutation And Comment Lanes

### `sourcey-refresh`

- trigger: scheduled and manual workflow dispatch
- command: `runx skill <runx>/skills/sourcey --project <repo>`
- purpose: let `runx` inspect the real repo, author or revise the Sourcey docs
  source bundle, and open a draft PR with the resulting changes
- approvals: `sourcey.discovery.approval`
- output: docs-source diff, receipts, uploaded workflow artifact, draft PR

### `issue-triage`

- trigger: GitHub issues except `[skill]` proposals, plus PR `opened`,
  `reopened`, `ready_for_review`, and `synchronize`
- issue command chain:
  1. `support-triage`
  2. `issue-triage`
  3. optional `objective-decompose`
  4. optional `issue-to-pr` worker fanout
  5. draft PR publication per worker
- PR command: `runx skill <runx>/skills/github-triage --runner respond`
- purpose: make issue and PR routing public before mutation, start bounded
  workers only after the triage gate approves build, and keep PR review legible
- output: triage comment, triage decision artifact, optional archived scafld
  specs, changed repo files, receipts, draft PRs, issue backlink comments, and
  posted PR comments

### `skill-lab`

- trigger: GitHub issues whose title begins with `[skill]`
- command: `runx skill <runx>/skills/objective-to-skill`
- purpose: turn a proposed new capability into a concrete skill package
  proposal, materialize it under `docs/skill-proposals/`, and open a draft PR
- output: proposal markdown, raw packet JSON, receipts, draft PR

### `skill-upstream`

- trigger: manual workflow dispatch
- command: `node scripts/prepare-skill-upstream.mjs` followed by
  `node scripts/validate-skill-upstream.mjs`
- purpose: add a portable upstream `SKILL.md` to a target repo without adding
  runx-specific binding files
- first target: `nilstate/icey-cli`
- output: target `SKILL.md`, contribution artifact packet, PR body, optional
  draft PR, public evidence row

### `merge-watch`

- trigger: scheduled and manual workflow dispatch
- command: `node scripts/merge-watch.mjs`
- purpose: observe upstream PR state after a portable `SKILL.md` contribution
  and hand accepted skills to runx registry binding
- first target: `nilstate/icey-cli#2`
- output: `skill_upstream_state.json`, proof-wall event, and
  `registry_binding_request.json` after upstream merge

## Continuous Support Lanes

### `docs-pages`

- trigger: push to `main` affecting docs sources, or manual dispatch
- command: `npx sourcey build --config docs/sourcey.config.ts`
- purpose: publish the public Sourcey documentation site
- output: GitHub Pages deployment from `.sourcey/runx-docs`

### `proving-ground`

- trigger: scheduled and manual workflow dispatch
- purpose: keep broader receipt and envelope visibility across the catalog even
  when live mutation lanes are unavailable
- current profile:
  - `evolve-introspect`
  - `sourcey`
  - optional broader research/content lanes when the checked-out `runx` ref
    includes them

## Next Lanes

These are still missing or intentionally deferred:

- `content-pipeline` opening operator-update PRs from repo evidence
- `market-intelligence` producing weekly ecosystem briefs
- `improve-skill` fed from failed proving-ground receipts
- `ecosystem-vuln-scan` once the repo exposes a meaningful package surface
- `moltbook-presence` once public posting credentials and approval routing exist
