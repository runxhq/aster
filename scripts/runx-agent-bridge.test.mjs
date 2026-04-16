import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInputMessages,
  extractOutputTextCandidates,
  shouldFallbackToChatCompletions,
} from "./runx-agent-bridge.mjs";

test("shouldFallbackToChatCompletions recognizes missing responses scope", () => {
  assert.equal(
    shouldFallbackToChatCompletions({
      response: { statusCode: 401 },
      parsed: {
        error: {
          message: "Missing scopes: api.responses.write",
        },
      },
    }),
    true,
  );
});

test("shouldFallbackToChatCompletions ignores unrelated failures", () => {
  assert.equal(
    shouldFallbackToChatCompletions({
      response: { statusCode: 400 },
      parsed: {
        error: {
          message: "Bad request",
        },
      },
    }),
    false,
  );
});

test("extractOutputTextCandidates supports chat completion payloads", () => {
  assert.deepEqual(
    extractOutputTextCandidates({
      choices: [
        {
          message: {
            content: "{\"ok\":true}",
          },
        },
      ],
    }),
    ["{\"ok\":true}"],
  );
});

test("buildInputMessages injects operator context when provided", () => {
  const messages = buildInputMessages(
    {
      id: "request-1",
      work: {
        source_type: "skill",
        agent: "external-caller",
        task: "triage",
        envelope: {
          expected_outputs: {
            answer: "string",
          },
        },
      },
    },
    { answer: "string" },
    undefined,
    "## Doctrine\nUse receipts first.",
  );

  assert.equal(messages[1].role, "system");
  assert.match(messages[1].content, /Use this operator context bundle/);
  assert.match(messages[1].content, /Use receipts first/);
});
