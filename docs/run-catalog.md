# Run Catalog

This is the initial live run catalog for `automaton`.

## Current Draft Lanes

### `evolve-introspect`

- command: `runx evolve --repo_root <repo>`
- purpose: recommend one bounded next improvement for `automaton`
- current outcome: usually `needs_resolution` at the first agent step, with a
  real `repo_profile` attached

### `sourcey`

- command: `runx skill <runx>/oss/skills/sourcey --project <repo>`
- purpose: derive a docs-site plan from the real repo
- current outcome: usually `needs_resolution` at `sourcey.discover`

### `content-pipeline`

- purpose: draft the next operator-facing update about the repo
- grounding: repo state only

### `market-intelligence`

- purpose: write the sharpest repo-change brief for operators
- grounding: repo state only until broader research sources are connected

### `skill-testing`

- purpose: decide whether a `runx` skill is ready to be trusted on `automaton`
- initial target: `sourcey`

### `research`

- purpose: extract one next improvement target from repo-visible evidence

## Later Lanes

These should come after the repo and control plane mature:

- `open-source-triage` against live `automaton` issues
- `issue-to-pr` once scafld and repo policy are wired in this repo
- `moltbook-presence` once public posting is connected and approved
- `ecosystem-vuln-scan` once a real package/dependency surface exists here

