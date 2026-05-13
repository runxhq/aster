import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function renderRunxReviewerPacket({
  runxRoot,
  threadStoryRenderer,
  packet,
}) {
  const renderer = threadStoryRenderer ?? await loadRunxThreadStoryRenderer(runxRoot);
  const render = renderer?.buildThreadPullRequestReviewerPacketMarkdown;
  if (typeof render !== "function") {
    throw new Error("runx thread-story renderer must expose buildThreadPullRequestReviewerPacketMarkdown.");
  }
  return `${render(packet).trim()}\n`;
}

export async function loadRunxThreadStoryRenderer(runxRoot) {
  const root = normalizeString(runxRoot);
  if (!root) {
    throw new Error("runx root is required to load the runx thread-story renderer.");
  }
  const modulePath = resolveRunxCoreKnowledgeModulePath(root);
  let module;
  try {
    module = await import(pathToFileURL(modulePath).href);
  } catch (error) {
    throw new Error(
      `unable to load runx core thread-story renderer from ${modulePath}; build runx before running the lane: ${error.message}`,
    );
  }
  if (typeof module.buildThreadPullRequestReviewerPacketMarkdown !== "function") {
    throw new Error(`runx core thread-story renderer is missing in ${modulePath}.`);
  }
  return module;
}

export function resolveRunxCoreKnowledgeModulePath(runxRoot) {
  const root = path.resolve(runxRoot);
  return [
    path.join(root, "packages/core/dist/src/knowledge/index.js"),
    path.join(root, "oss/packages/core/dist/src/knowledge/index.js"),
  ].find((candidate) => fileExists(candidate)) ?? path.join(root, "packages/core/dist/src/knowledge/index.js");
}

function normalizeString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function fileExists(filePath) {
  return path.parse(filePath).base.length > 0 && existsSync(filePath);
}
