import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  renderRunxReviewerPacket,
  resolveRunxCoreKnowledgeModulePath,
} from "./runx-thread-story.mjs";

test("resolveRunxCoreKnowledgeModulePath supports nested oss runx checkouts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aster-runx-root-"));
  const modulePath = path.join(root, "oss/packages/core/dist/src/knowledge/index.js");
  await mkdir(path.dirname(modulePath), { recursive: true });
  await writeFile(path.join(root, "oss/package.json"), "{\"type\":\"module\"}\n");
  await writeFile(
    modulePath,
    "export function buildThreadPullRequestReviewerPacketMarkdown(packet) { return `rendered ${packet.title}`; }\n",
  );

  assert.equal(resolveRunxCoreKnowledgeModulePath(root), modulePath);
  const rendered = await renderRunxReviewerPacket({
    runxRoot: root,
    packet: {
      title: "Nested checkout",
    },
  });
  assert.equal(rendered, "rendered Nested checkout\n");
});
