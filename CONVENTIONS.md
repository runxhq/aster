# Coding Conventions & Standards

**Purpose:** Single source of truth for code style and development patterns.

**Scope:** Applies to all code in this repository.

**See also:**
- [AGENTS.md](AGENTS.md) — High-level invariants and AI agent policies
- [CLAUDE.md](CLAUDE.md) — Claude-specific integration guide
- [.ai/README.md](.ai/README.md) — Task planning and execution workflows

**Relationship to AGENTS files:**
- `AGENTS.md` and this document define global invariants and conventions.
- The `.ai/` system must respect the invariants and conventions defined here.

---

## Tech Stack & Versions

```yaml
runtime: "Node.js 20+"
docs: "Sourcey static site"
automation: "GitHub Actions + runx + scafld"
scripts: "ES modules under scripts/"
```

---

## Architecture Principles

### Repo Shape

- `docs/` contains Sourcey docs sources and generated proposal artifacts
- `scripts/` contains small automation helpers; prefer reusable scripts over
  opaque inline shell in workflows
- `.github/workflows/` contains hosted lanes; each workflow should map to one
  clear automation story
- `.ai/` contains scafld governance state

---

## Code Style

### General Rules

- Match existing style; keep diffs focused and local.
- Avoid renames/moves unless required by the task.
- **Never** include secrets or internal paths in code, logs, or diffs.
- Prefer small scripts with explicit inputs and outputs.
- Keep GitHub workflow shell blocks short; move real logic into `scripts/`.

### Imports & Aliasing

- Use explicit named imports over namespace imports
- Don't alias imports to different symbols (confuses readers)
- Import by canonical names; update call sites if renaming

---

## Error Handling

- Scripts should fail fast with a concrete message.
- Workflow-facing scripts should print JSON when they are returning structured
  data that a later step consumes.
- When a workflow can safely no-op, return a clear no-op message instead of a
  partial mutation.

---

## Testing Patterns

### Principles

- Validate pragmatically: prefer fast, high-signal checks over exhaustive runs during iteration
- Broaden before merging or when risk is high
- Add tests when there is an obvious adjacent pattern or when asked

### Test Types

- repo checks: file-presence and contract validation
- docs build: Sourcey static build
- hosted validation: workflow artifacts, receipts, and PR/comment side effects

### Commands

```bash
npm run check
npm run docs:build
RUNX_ROOT=/home/kam/dev/runx bash scripts/proving-ground.sh
```

### Rules

- **Tests-first when possible:** Reproduce with a targeted/failing test, then patch, then re-run
- For non-trivial changes: add/adjust the closest, smallest-scoped test
- Keep test runs targeted unless risk warrants broader coverage
- **Do NOT change snapshots/golden files** without noting why

---

## Dependencies

**Prefer:**
- Built-in language/framework utilities
- Well-maintained, widely-used packages
- Packages that keep hosted automation deterministic
- `npx` or CLI invocation for one-off docs tooling when a local dependency is not
  otherwise needed

---

## Refactoring Policy

**Prefer:**
- Targeted refactors that strengthen boundaries
- Improve naming or extract interfaces to enable the best solution
- Reshape modules when it materially improves correctness/maintainability

**Avoid:**
- Superficial fixes that entrench poor workflow boundaries
- Renames/moves unless required by the task
- Unrelated refactors bundled with feature work

**Keep changes coherent and reversible.**

### Pre-commit Checks

**Before committing, ensure:**
- [ ] Code compiles/builds
- [ ] Tests pass (at least targeted tests)
- [ ] Linters pass (if configured)
- [ ] No secrets or credentials in diff
- [ ] No debug code (console.log, print statements, etc.)

---

## What Not to Do

**Forbidden:**
- Invent behavior or requirements (ask instead)
- Add legacy/fallback code paths
- Silently change routing, auth, or persistence semantics
- Derive behavior from implicit assumptions or hidden fallbacks
- Place concerns in the wrong layer
- Leave "temporary" runtime code in production paths
- Hardcode secrets or internal paths
- Bypass established error handling patterns
- Add test-only logic to production code
- Commit without explicit user permission (AI agents)
