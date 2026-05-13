import test from "node:test";
import assert from "node:assert/strict";

import { buildBridgeArgs } from "./aster-core.mjs";

test("buildBridgeArgs forwards context and approvals to the shared bridge", () => {
  const args = buildBridgeArgs({
    repoRoot: "/repo",
    runxRoot: "/runx",
    receiptDir: "/artifacts/receipts",
    traceDir: "/artifacts/trace",
    outputPath: "/artifacts/result.json",
    contextPromptPath: "/artifacts/context.md",
    threadTeachingContextPath: "/artifacts/thread-teaching-context.json",
    gateDecisionsPath: "/artifacts/receipts/gate-decisions.json",
    approve: ["gate.alpha"],
    runxArgs: ["skill", "/runx/skills/intake"],
  });

  assert.deepEqual(args.slice(0, 15), [
    "/repo/scripts/runx-agent-bridge.mjs",
    "--runx-root",
    "/runx",
    "--receipt-dir",
    "/artifacts/receipts",
    "--trace-dir",
    "/artifacts/trace",
    "--output",
    "/artifacts/result.json",
    "--context-file",
    "/artifacts/context.md",
    "--thread-teaching-context",
    "/artifacts/thread-teaching-context.json",
    "--gate-decisions",
    "/artifacts/receipts/gate-decisions.json",
  ]);
  assert.ok(args.includes("--approve"));
  assert.ok(args.includes("gate.alpha"));
  assert.deepEqual(args.slice(-3), ["--", "skill", "/runx/skills/intake"]);
});
