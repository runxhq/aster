---
title: Operations
description: Secrets, approvals, artifacts, and what still needs hardening.
---

# Operations

## Required secrets

- `OPENAI_API_KEY`: external caller for `runx` `agent-step` requests
- `RUNX_CALLER_MODEL` (optional repo variable): pinned model snapshot for the
  hosted bridge
- `RUNX_REPOSITORY_PAT` (optional secret): GitHub token for private `runx`
  checkout and other cross-repo automation that cannot rely on the default
  workflow token
- `UPSTREAM_CONTRIBUTION_TOKEN` (optional secret): preferred token for
  cross-repo `skill-upstream` PRs when the default workflow token cannot
  write to the target repo. This should be an `auscaster` token when outbound
  upstream PRs should be authored and opened as `@auscaster`.

## Planned Hosted Memory Access

`automaton` should not use a broad shared `RUNX_API_KEY` for memory access.

The planned model is:

- one dedicated `runx` service principal for `automaton`
- preferred authentication via GitHub OIDC exchange for short-lived tokens
- rotated service token fallback only when OIDC is unavailable
- narrow scopes such as `memory:read`, `memory:write`, `memory:query`,
  `memory:snapshot:publish`, and `receipt:read`
- namespace ACLs that restrict the principal to automaton-owned namespaces

The public site must not use privileged memory credentials from the browser.
It should read public receipts, published public snapshots, or build-time
exports only.

The intended public face is `site/`, not a Sourcey docs surface.

## Approval policy

Approvals stay explicit:

- Sourcey authoring auto-approves only `sourcey.discovery.approval`
- Issue-triage comments first; `objective-decompose` may run when the
  triage gate approves planning, and one or more repo-scoped `issue-to-pr`
  workers start only after the triage gate approves build
- issue triage writes comments only through the dedicated workflow
- Skill-lab opens draft PRs only
- Skill-upstream opens draft PRs only, and upstream changes are limited to
  portable `SKILL.md` unless a maintainer explicitly requests more
- Merge-watch is read-only against upstream repos. It records PR
  state, checks, merge commit, and upstream blob metadata, then emits an
  internal registry-binding request after merge.

## Artifact policy

Every mutating or public lane uploads:

- the final `runx` JSON result
- the receipts directory
- provider traces for each `agent-step`

That makes failures diagnosable and keeps the trust boundary visible.

## Execution Hardening Contract

These are no longer undefined gaps. They are explicit execution requirements.

### Provider auth and key rotation

- hosted memory and other runx control-plane access should prefer OIDC-issued
  short-lived service-principal tokens
- rotated static service tokens are fallback only
- no human refresh token or broad shared admin key is allowed in automation
- provider-facing secrets should have rotation playbooks before lanes widen

### Eval gates

- mutating PR lanes stay draft-first by default
- public-comment lanes should record usefulness and correctness evals
- authority only widens when eval quality is stable and reflected in receipts

### Merge and rollback

- generated PRs are draft by default unless an explicit lane policy says
  otherwise
- merge remains human-reviewed until a separate policy says otherwise
- rollback should happen through a new corrective PR or corrective public
  comment, never by pretending the original mutation did not occur
- every rollback or correction should emit a reflection and a history entry when
  publicly relevant

### Persistent tracking

- upstream contribution state should graduate from artifact-only packets into
  `state/` projections backed by receipts
- hosted receipt indexing and generic memory should make artifact retrieval and
  replay queryable beyond raw workflow bundles

### Readiness rule

Execution may start once:

- the plan/spec layer is closed
- every lane has an approval mode and memory effect
- public surfaces render only promoted or published data
- memory access is principal-scoped rather than key-shared
