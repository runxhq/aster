import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIssueLedgerPacket,
  computeIssueLedgerRevision,
  isMachineStatusComment,
  isTrustedHumanComment,
} from "./issue-ledger.mjs";

test("buildIssueLedgerPacket renders a living issue ledger from trusted human comments", () => {
  const packet = buildIssueLedgerPacket({
    repo: "nilstate/aster",
    issue: {
      number: 110,
      title: "[skill] Add an issue-ledger distillation skill",
      body: "Objective: Add a skill.\n\nWhy It Matters:\nTeach aster through the issue ledger.",
      html_url: "https://github.com/nilstate/aster/issues/110",
      user: { login: "kam" },
      author_association: "OWNER",
    },
    comments: [
      {
        id: 1,
        body: "Please keep the first pass proposal-only.",
        html_url: "https://github.com/nilstate/aster/issues/110#issuecomment-1",
        created_at: "2026-04-21T08:00:00Z",
        user: { login: "kam", type: "User" },
        author_association: "OWNER",
      },
      {
        id: 2,
        body: "Thanks, following.",
        html_url: "https://github.com/nilstate/aster/issues/110#issuecomment-2",
        created_at: "2026-04-21T08:05:00Z",
        user: { login: "someone", type: "User" },
        author_association: "NONE",
      },
      {
        id: 3,
        body: [
          "<!-- aster:thread-teaching-record -->",
          "Kind: approval",
          "Summary: One skill proposal draft PR refresh is approved.",
          "Recorded By: kam",
          "Applies To: skill-lab.*",
          "Decision: skill-lab.publish = allow | draft PR refresh is approved",
        ].join("\n"),
        html_url: "https://github.com/nilstate/aster/issues/110#issuecomment-3",
        created_at: "2026-04-21T08:10:00Z",
        user: { login: "kam", type: "User" },
        author_association: "OWNER",
      },
    ],
  });

  assert.equal(packet.trusted_human_comments.length, 2);
  assert.equal(packet.amendments.length, 2);
  assert.match(packet.ledger_body, /Original Request/);
  assert.match(packet.ledger_body, /Maintainer Amendments/);
  assert.match(packet.ledger_body, /Please keep the first pass proposal-only/);
  assert.match(packet.ledger_body, /Structured teaching record captured separately/);
});

test("computeIssueLedgerRevision changes when trusted human amendments change", () => {
  const issue = {
    title: "docs: clarify workflow",
    body: "Base request",
  };
  const first = computeIssueLedgerRevision({
    issue,
    comments: [{ id: "1", author: "kam", body: "First note", created_at: "2026-04-21T00:00:00Z" }],
  });
  const second = computeIssueLedgerRevision({
    issue,
    comments: [{ id: "1", author: "kam", body: "Second note", created_at: "2026-04-21T00:00:00Z" }],
  });

  assert.notEqual(first, second);
});

test("isTrustedHumanComment rejects bots and untrusted associations", () => {
  assert.equal(
    isTrustedHumanComment({
      author_association: "OWNER",
      is_bot: false,
    }),
    true,
  );
  assert.equal(
    isTrustedHumanComment({
      author_association: "NONE",
      is_bot: false,
    }),
    false,
  );
  assert.equal(
    isTrustedHumanComment({
      author_association: "OWNER",
      is_bot: true,
    }),
    false,
  );
});

test("buildIssueLedgerPacket excludes machine status comments from trusted amendments", () => {
  const packet = buildIssueLedgerPacket({
    repo: "nilstate/aster",
    issue: {
      number: 110,
      title: "[skill] Add a collaboration issue distillation skill",
      body: "Objective: Add a skill.",
    },
    comments: [
      {
        id: 1,
        body: "Opened draft PR for this run: https://github.com/nilstate/aster/pull/111",
        created_at: "2026-04-21T07:25:06Z",
        user: { login: "kam", type: "User" },
        author_association: "OWNER",
      },
      {
        id: 2,
        body: "Hard-cut the contract to subject_locator, subject_memory, and publication_target.",
        created_at: "2026-04-21T12:24:06Z",
        user: { login: "kam", type: "User" },
        author_association: "OWNER",
      },
    ],
  });

  assert.equal(packet.comments.length, 2);
  assert.equal(packet.trusted_human_comments.length, 1);
  assert.equal(packet.amendments.length, 1);
  assert.match(packet.ledger_body, /Hard-cut the contract/);
  assert.doesNotMatch(packet.ledger_body, /Opened draft PR for this run/);
});

test("isMachineStatusComment detects machine-authored issue status surfaces", () => {
  assert.equal(
    isMachineStatusComment({
      body: "<!-- aster:runx-skill-lab -->\n## runx skill lab",
    }),
    true,
  );
  assert.equal(
    isMachineStatusComment({
      body: "Opened draft PR for this run: https://github.com/nilstate/aster/pull/111",
    }),
    true,
  );
  assert.equal(
    isMachineStatusComment({
      body: "Hard-cut the contract to subject_locator, subject_memory, and publication_target.",
    }),
    false,
  );
});
