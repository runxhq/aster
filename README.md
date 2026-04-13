# automaton

`automaton` is the canonical dogfood destination for `runx`.

The repo is intentionally simple and public:

- it is a safe target for governed `runx` runs
- it accumulates real issues, docs, receipts, and PRs over time
- it gives `runx` a place to recommend, draft, review, and eventually apply its
  own improvements under approval

The story is not "an autonomous agent that silently rewrites itself."

The story is:

1. `runx` inspects `automaton`
2. `runx` proposes bounded changes and public updates
3. humans approve the next safe mutation
4. `automaton` improves gradually, with receipts

## Current Mode

Today `automaton` runs in draft-first mode.

- `evolve` inspects the repo and recommends the next bounded move
- `sourcey` derives a docs-site plan from the real repo
- `content-pipeline` and `market-intelligence` draft operator-facing updates
- `skill-testing` evaluates whether key `runx` skills are strong enough to use on
  `automaton`

The live workflow stores JSON reports, pending caller envelopes, and receipts as
workflow artifacts. That gives a real operating signal now, even before every
agent step is wired for unattended completion in CI.

## Layout

- [docs/operating-model.md](./docs/operating-model.md): the governing model for
  gradual self-improvement
- [docs/run-catalog.md](./docs/run-catalog.md): which `runx` lanes operate on
  `automaton` and what they should emit
- [docs/backlog.md](./docs/backlog.md): bounded improvement targets for future
  evolve runs
- [scripts/runx-dogfood.sh](./scripts/runx-dogfood.sh): local and CI driver for
  live dogfood runs

## Local Validation

```bash
node scripts/check.mjs
```

Run the live dogfood lane locally from this repo:

```bash
RUNX_ROOT=/home/kam/dev/runx bash scripts/runx-dogfood.sh
node scripts/summarize-dogfood.mjs .artifacts/runx-dogfood
```

If you have caller answers for a given run, place one JSON file per run name in
`$RUNX_ANSWERS_DIR`:

```text
$RUNX_ANSWERS_DIR/
  evolve-introspect.json
  sourcey.json
  content-pipeline.json
```

The script will pick those up automatically and continue past the normal
`needs_resolution` boundary for that run.

