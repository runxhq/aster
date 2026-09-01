---
title: "decision-brief"
description: "Read one living work ledger plus trusted amendments and return one bounded maintainer decision packet."
---

# decision-brief

## Thesis

Read one living work ledger plus trusted amendments and return one bounded maintainer decision packet.

## Job To Be Done

Read one living work ledger plus trusted amendments and return one bounded maintainer decision packet.

## Why This Matters

Removes fragmented decision handoff when one unit of work is meant to stay in one living issue, but the next human decision would otherwise be scattered across separate proposal threads or hidden memory.

## Pain Points

- A maintainer can lose the next decision in thread sprawl when one work issue is supposed to remain the single living ledger for that unit of work.
- Without an explicit packet boundary, summaries can drift into hidden-memory behavior instead of preserving references to the issue and trusted amendment comments.
- The current catalog has proposal-shaping and triage capabilities, but not a narrow runtime contract that turns one living ledger into one bounded maintainer handoff.

## Catalog Fit

- adjacent_capabilities:
  - issue-triage: Compared with `issue-triage`, this skill does not route, dedupe, or classify issue work. It assumes one living work ledger already exists and packages the next maintainer decision from that ledger.
  - skill-lab: Compared with `skill-lab`, this is not a proposal-authoring lane. `skill-lab` can shape and review the catalog proposal, but the proposed runtime contract here is narrower: one living ledger in, one decision packet out.
  - review-skill: Compared with `review-skill`, this skill generates the decision packet. `review-skill` remains the quality gate for the resulting proposal or packet.
- why_new_capability: The gap named in issue #115 is a narrow subject-memory-to-decision-packet contract. The request and research both reuse existing skills for synthesis and review, which argues against duplicating those roles. A new first-party capability is justified only for the one-ledger-to-one-packet runtime boundary.

## Contract

- name: `decision-brief`
- kind: `skill`
- description: Read one living work ledger plus trusted amendments and return one bounded maintainer decision packet.

## Boundaries

- Prefer one skill with a small, inspectable surface.
- No provider-locked nouns in the core contract.
- Keep the proposal grounded in the current runx / aster vocabulary.

## Harness

- decision-brief-happy-path
- decision-brief-missing-thread
- decision-brief-refuses-publish-request

## Acceptance Checks

- `one-ledger-in-one-packet-out`: With `thread_locator`, `thread`, and `trusted_amendment_comment_ids` present, the skill succeeds and returns exactly one `decision_packet`.
- `packet-kind-is-bounded`: The returned packet kind is exactly one of `approval_ask`, `blocker_summary`, `open_question_bundle`, or `maintainer_handoff`.
- `maintainer-pain-is-explicit`: For issue #115-style inputs, the packet names the concrete pain as fragmented decision handoff rather than generic summarization.
- `catalog-boundaries-are-explicit`: For this proposal use case, the output distinguishes the new contract from `issue-triage` and `skill-lab` directly.
- `ledger-remains-visible`: The packet preserves references to the living issue ledger and trusted amendments instead of copying the whole thread into hidden memory.
- `review-only-stop-boundary`: The output includes an explicit handoff boundary stating review only, with no publish, repo mutation, or thread posting.
- `missing-required-input-needs-resolution`: If `thread` is missing, the skill returns `needs_resolution` and names the missing input.
- `publish-request-is-rejected`: If a caller supplies an `outbox_entry` that asks for thread posting or publish behavior, the skill returns `needs_resolution` instead of producing publish instructions.

## Open Decisions

- Should `decision-brief` enter the runx catalog as a new first-party skill with a review-only, no-publish contract, or should this stay inside `skill-lab`?
  The request requires an explicit boundary showing why `issue-triage` and `skill-lab` do not already cover the one-ledger-to-one-decision-packet contract.
  options: Adopt `decision-brief` as a new first-party skill. | Reject the new skill and keep this job inside `skill-lab`.

## Provenance

- Work issue: `nilstate/aster#115`
- Source thread: https://github.com/nilstate/aster/issues/115
- Ledger revision: `d6dad1392c8a5b34`
- Trusted maintainer amendments considered: 8. Details remain on the source thread.
- Machine-readable packet: [decision-brief.json](./decision-brief.json).

