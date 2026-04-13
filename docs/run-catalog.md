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

### `issue-supervisor`

- trigger: GitHub issues except `[skill]` proposals
- command chain:
  1. `support-triage`
  2. `issue-supervisor`
  3. optional `objective-decompose`
  4. optional `issue-to-pr` worker fanout
  5. draft PR publication per worker
- purpose: make issue routing public before mutation and start one or more
  bounded workers only after the supervisor gate approves build
- output: triage comment, supervisor decision artifact, optional archived scafld
  specs, changed repo files, receipts, draft PRs, issue backlink comments

### `pr-triage`

- trigger: PR `opened`, `reopened`, and `ready_for_review`
- command: `runx skill <runx>/skills/github-triage --runner respond`
- purpose: inspect the live PR snapshot and post one high-signal maintainer
  comment back onto the PR
- output: response packet, posted PR comment, receipts

### `skill-learning`

- trigger: GitHub issues whose title begins with `[skill]`
- command: `runx skill <runx>/skills/objective-to-skill`
- purpose: turn a proposed new capability into a concrete skill package
  proposal, materialize it under `docs/skill-proposals/`, and open a draft PR
- output: proposal markdown, raw packet JSON, receipts, draft PR

## Continuous Support Lanes

### `docs-pages`

- trigger: push to `main` affecting docs sources, or manual dispatch
- command: `npx sourcey build --config docs/sourcey.config.ts`
- purpose: publish the public Sourcey documentation site
- output: GitHub Pages deployment from `.sourcey/runx-docs`

### `runx-dogfood`

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
- `improve-skill` fed from failed dogfood receipts
- `ecosystem-vuln-scan` once the repo exposes a meaningful package surface
- `moltbook-presence` once public posting credentials and approval routing exist
