import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildContextBundle, renderContextPrompt } from "./build-aster-context.mjs";
import { buildPromotionDrafts, writePromotionDrafts } from "./promote-aster-state.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const outputs = await runAsterCore(options);
  process.stdout.write(`${JSON.stringify(outputs, null, 2)}\n`);
}

export async function runAsterCore(options) {
  if (!options.runxArgs?.length) {
    throw new Error("aster-core requires a runx invocation after --.");
  }

  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const artifactRoot = path.resolve(options.artifactRoot);
  const receiptDir = path.resolve(options.receiptDir ?? path.join(artifactRoot, "receipts"));
  const traceDir = path.resolve(options.traceDir ?? path.join(artifactRoot, "provider-trace"));
  const outputPath = path.resolve(options.output ?? path.join(artifactRoot, "result.json"));
  const contextJsonPath = path.resolve(options.contextJson ?? path.join(artifactRoot, "context.json"));
  const contextPromptPath = path.resolve(options.contextPrompt ?? path.join(artifactRoot, "context.md"));
  const promotionsDir = path.resolve(options.promotionsDir ?? path.join(artifactRoot, "promotions"));
  const summaryPath = path.resolve(options.summaryOutput ?? path.join(artifactRoot, "core-summary.json"));

  await mkdir(artifactRoot, { recursive: true });
  await mkdir(receiptDir, { recursive: true });
  await mkdir(traceDir, { recursive: true });
  await mkdir(promotionsDir, { recursive: true });

  const contextBundle = await buildContextBundle({
    repoRoot,
    artifactRoot: options.artifactRootForContext ?? ".artifacts",
    lane: options.lane,
    subjectKind: options.subjectKind,
    subjectLocator: options.subjectLocator,
    repo: options.repo,
    targetRepo: options.targetRepo,
    issueNumber: options.issueNumber,
    prNumber: options.prNumber,
    issueUrl: options.issueUrl,
    snapshot: options.snapshot,
    maxHistory: options.maxHistory,
    maxReflections: options.maxReflections,
    maxArtifacts: options.maxArtifacts,
  });
  await writeFile(contextJsonPath, `${JSON.stringify(contextBundle, null, 2)}\n`);
  await writeFile(contextPromptPath, `${renderContextPrompt(contextBundle)}\n`);

  const bridgeArgs = buildBridgeArgs({
    repoRoot,
    runxRoot: options.runxRoot,
    workdir: options.workdir,
    receiptDir,
    traceDir,
    outputPath,
    contextPromptPath,
    approve: options.approve,
    approveAll: options.approveAll,
    model: options.model,
    provider: options.provider,
    maxTurns: options.maxTurns,
    reasoningEffort: options.reasoningEffort,
    runxArgs: options.runxArgs,
  });

  let bridgeError;
  try {
    execFileSync(process.execPath, bridgeArgs, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });
  } catch (error) {
    bridgeError = error;
  }

  if (!existsSync(outputPath)) {
    throw bridgeError ?? new Error(`run result not written to ${outputPath}`);
  }

  const runResult = JSON.parse(await readFile(outputPath, "utf8"));
  const drafts = buildPromotionDrafts({
    lane: options.lane,
    contextBundle,
    runResult,
  });
  const promotionOutputs = await writePromotionDrafts({
    outputDir: promotionsDir,
    drafts,
  });

  const summary = {
    lane: options.lane,
    status: runResult.status ?? "unknown",
    result_path: outputPath,
    context_json_path: contextJsonPath,
    context_prompt_path: contextPromptPath,
    receipt_dir: receiptDir,
    trace_dir: traceDir,
    promotion_outputs: promotionOutputs,
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  if (bridgeError) {
    throw bridgeError;
  }
  return summary;
}

export function buildBridgeArgs({
  repoRoot,
  runxRoot,
  workdir,
  receiptDir,
  traceDir,
  outputPath,
  contextPromptPath,
  approve = [],
  approveAll = false,
  model,
  provider,
  maxTurns,
  reasoningEffort,
  runxArgs,
}) {
  const args = [
    path.join(repoRoot, "scripts", "runx-agent-bridge.mjs"),
    "--runx-root",
    path.resolve(runxRoot),
    "--receipt-dir",
    path.resolve(receiptDir),
    "--trace-dir",
    path.resolve(traceDir),
    "--output",
    path.resolve(outputPath),
    "--context-file",
    path.resolve(contextPromptPath),
  ];

  if (workdir) {
    args.push("--workdir", path.resolve(workdir));
  }
  if (model) {
    args.push("--model", model);
  }
  if (provider) {
    args.push("--provider", provider);
  }
  if (maxTurns) {
    args.push("--max-turns", String(maxTurns));
  }
  if (reasoningEffort) {
    args.push("--reasoning-effort", reasoningEffort);
  }
  for (const gate of approve) {
    args.push("--approve", gate);
  }
  if (approveAll) {
    args.push("--approve-all");
  }
  args.push("--", ...runxArgs);
  return args;
}

function parseArgs(argv) {
  const options = {
    approve: [],
    runxArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      options.runxArgs = argv.slice(index + 1);
      break;
    }
    if (token === "--repo-root") {
      options.repoRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--runx-root") {
      options.runxRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--artifact-root") {
      options.artifactRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--artifact-root-for-context") {
      options.artifactRootForContext = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--summary-output") {
      options.summaryOutput = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--receipt-dir") {
      options.receiptDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--trace-dir") {
      options.traceDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--promotions-dir") {
      options.promotionsDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--context-json") {
      options.contextJson = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--context-prompt") {
      options.contextPrompt = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--lane") {
      options.lane = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--subject-kind") {
      options.subjectKind = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--subject-locator") {
      options.subjectLocator = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--target-repo") {
      options.targetRepo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-number") {
      options.issueNumber = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--pr-number") {
      options.prNumber = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-url") {
      options.issueUrl = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--snapshot") {
      options.snapshot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--workdir") {
      options.workdir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--approve") {
      options.approve.push(requireValue(argv, ++index, token));
      continue;
    }
    if (token === "--approve-all") {
      options.approveAll = true;
      continue;
    }
    if (token === "--model") {
      options.model = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--provider") {
      options.provider = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--max-turns") {
      options.maxTurns = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--reasoning-effort") {
      options.reasoningEffort = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--max-history") {
      options.maxHistory = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--max-reflections") {
      options.maxReflections = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--max-artifacts") {
      options.maxArtifacts = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.runxRoot || !options.artifactRoot || !options.lane) {
    throw new Error("--runx-root, --artifact-root, and --lane are required.");
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
