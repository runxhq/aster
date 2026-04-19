import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadVerificationProfileCatalogSync,
  normalizeIssueToPrRequest,
  resolveVerificationPlan,
} from "./aster-v1-contracts.mjs";
import { evaluateGeneratedPr } from "./evaluate-generated-pr.mjs";
import {
  buildInlineRepoSnapshot,
  buildRepoContextSummary,
  buildRepoSnapshot,
  buildVerificationReport,
  normalizeTaskId,
  prepareWorkspace,
  resolveRunxSkillPath,
  runRunxBridgeWithRetry,
  runVerificationCommands,
  sanitizeIssueBody,
} from "./run-issue-triage-workers.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await runGovernedPrLane(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function runGovernedPrLane(options) {
  const verificationCatalog = loadVerificationProfileCatalogSync(repoRoot);
  const targetRepo = options.targetRepo ?? options.defaultRepo;
  const sourceId = options.sourceId ?? `${options.lane}-${normalizeTaskId(options.requestTitle)}`;
  const laneRequest = normalizeIssueToPrRequest({
    issue_title: options.requestTitle,
    issue_body: buildLaneRequestBody(options.lane, options.requestBody),
    source: options.source ?? "workflow_dispatch",
    source_id: sourceId,
    source_url: options.sourceUrl ?? null,
    target_repo: targetRepo,
    branch: options.branch ?? buildBranchName(options.lane, options.requestTitle),
    size: options.size ?? defaultSize(options.lane),
    risk: options.risk ?? "low",
    phase: options.phase ?? "phase1",
  }, {
    defaultRepo: targetRepo,
    catalog: verificationCatalog,
  });
  const verificationPlan = resolveVerificationPlan({
    catalog: verificationCatalog,
    targetRepo,
    issueToPrRequest: laneRequest,
  });
  const artifactRoot = path.resolve(options.artifactRoot ?? `.artifacts/${options.lane}`);
  const workRoot = path.resolve(options.workRoot ?? `.artifacts/${options.lane}-workspaces`);
  const workDir = path.join(workRoot, options.lane);

  await rm(artifactRoot, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(workRoot, { recursive: true });

  const cleanup = await prepareWorkspace({
    targetRepo,
    defaultRepo: options.defaultRepo,
    workDir,
  });

  try {
    const resultPath = path.join(artifactRoot, "result.json");
    const receiptDir = path.join(artifactRoot, "receipts");
    const traceDir = path.join(artifactRoot, "provider-trace");
    const repoSnapshot = buildRepoSnapshot(workDir, targetRepo);
    const repoSnapshotPath = path.join(artifactRoot, "repo-snapshot.json");
    const inlineRepoSnapshot = buildInlineRepoSnapshot(repoSnapshot);
    const taskId = normalizeTaskId(`${options.lane}-${options.requestTitle}`);
    const executionLane = options.lane;
    await writeFile(repoSnapshotPath, `${JSON.stringify(repoSnapshot, null, 2)}\n`);

    const coreArgs = [
      path.join(repoRoot, "scripts", "aster-core.mjs"),
      "--lane",
      executionLane,
      "--runx-root",
      path.resolve(options.runxRoot),
      "--artifact-root",
      artifactRoot,
      "--workdir",
      workDir,
      "--subject-kind",
      "github_repository",
      "--subject-locator",
      targetRepo,
      "--repo",
      options.defaultRepo,
      "--target-repo",
      targetRepo,
      "--snapshot",
      repoSnapshotPath,
      "--receipt-dir",
      receiptDir,
      "--trace-dir",
      traceDir,
      "--output",
      resultPath,
    ];
    const skillPath = resolveRunxSkillPath(options.runxRoot, "issue-to-pr");
    const startRunxArgs = [
      "skill",
      skillPath,
      "--fixture",
      workDir,
      "--task_id",
      taskId,
      "--issue_title",
      laneRequest.issue_title,
      "--issue_body",
      laneRequest.issue_body,
      "--source",
      laneRequest.source,
      "--source_id",
      laneRequest.source_id,
      "--source_url",
      laneRequest.source_url ?? "",
      "--target_repo",
      targetRepo,
      "--repo_snapshot",
      JSON.stringify(inlineRepoSnapshot),
      "--repo_snapshot_path",
      repoSnapshotPath,
      "--repo_context",
      buildRepoContextSummary(repoSnapshot),
      "--size",
      laneRequest.size,
      "--risk",
      laneRequest.risk,
      "--phase",
      laneRequest.phase,
      "--scafld_bin",
      options.scafldBin,
    ];

    await runRunxBridgeWithRetry({
      bridgeArgs: coreArgs,
      startRunxArgs,
      resultPath,
      cwd: workDir,
    });

    const verificationCommands = runVerificationCommands(verificationPlan.commands, { cwd: workDir });
    const verificationReport = buildVerificationReport({
      reportId: `verification-${taskId}`,
      targetRepo,
      verificationProfile: verificationPlan.profile_id,
      status: verificationCommands.status,
      commands: verificationCommands.commands,
    });
    await writeFile(
      path.join(artifactRoot, "verification-report.json"),
      `${JSON.stringify(verificationReport, null, 2)}\n`,
    );
    if (verificationCommands.error) {
      throw verificationCommands.error;
    }

    const publishPlan = buildPublishPlan({
      lane: options.lane,
      requestTitle: options.requestTitle,
      sourceId,
      targetRepo,
    });
    const prBodyPath = path.join(artifactRoot, "pr-body.md");
    const prBody = buildLanePrBody({
      lane: options.lane,
      requestTitle: options.requestTitle,
      requestBody: options.requestBody,
      sourceId,
      sourceUrl: options.sourceUrl,
      targetRepo,
      taskId,
      verificationProfile: verificationPlan.profile_id,
      validationCommands: verificationPlan.commands,
    });
    await writeFile(prBodyPath, prBody);

    const publishJson = run("node", [
      path.join(repoRoot, "scripts", "publish-runx-pr.mjs"),
      "--repo",
      targetRepo,
      "--branch",
      publishPlan.branch,
      "--title",
      publishPlan.title,
      "--commit-message",
      publishPlan.commitMessage,
      "--body-file",
      prBodyPath,
      "--lane",
      options.lane,
    ], { cwd: workDir });
    await writeFile(path.join(artifactRoot, "publish.json"), `${publishJson}\n`);
    const publish = JSON.parse(publishJson);
    const prEval = evaluateGeneratedPr({
      publish,
      body: prBody,
      validation: verificationReport,
    });
    await writeFile(path.join(artifactRoot, "pr-eval.json"), `${JSON.stringify(prEval, null, 2)}\n`);

    if (publish.status === "published" && targetRepo === options.defaultRepo) {
      run("gh", [
        "workflow",
        "run",
        "issue-triage.yml",
        "--repo",
        targetRepo,
        "-f",
        `pr_number=${publish.pr_number}`,
      ]);
    }

    return {
      status: "completed",
      lane: options.lane,
      target_repo: targetRepo,
      verification_profile: verificationPlan.profile_id,
      publish,
      pr_eval: prEval,
      artifact_root: artifactRoot,
    };
  } finally {
    try {
      await cleanup();
    } catch (error) {
      console.error(`cleanup failed for ${options.lane}: ${error.message}`);
    }
  }
}

export function buildLaneRequestBody(lane, body) {
  const normalized = sanitizeIssueBody(body);
  const constraints = laneConstraints(lane);
  return [normalized, "", "Lane constraints:", ...constraints]
    .filter((line, index, lines) => {
      if (line !== "") {
        return true;
      }
      return index > 0 && lines[index - 1] !== "";
    })
    .join("\n")
    .trim();
}

export function buildPublishPlan({ lane, requestTitle, sourceId, targetRepo }) {
  const slug = normalizeTaskId(`${targetRepo}-${sourceId || requestTitle}`);
  return {
    branch: `runx/${lane}-${slug}`,
    title: `[runx] ${lane}: ${requestTitle}`,
    commitMessage: lane === "docs-pr"
      ? `docs: apply ${lane} change`
      : `fix: apply ${lane} change`,
  };
}

export function buildLanePrBody({
  lane,
  requestTitle,
  requestBody,
  sourceId,
  sourceUrl,
  targetRepo,
  taskId,
  verificationProfile,
  validationCommands,
}) {
  const validationSection = validationCommands.map((command) => `- \`${command}\``).join("\n");
  const intent = lane === "docs-pr"
    ? "This draft PR was opened by the `aster` docs-pr lane to make one bounded explanation/docs improvement."
    : "This draft PR was opened by the `aster` fix-pr lane to make one bounded bugfix in one repo surface.";
  const lines = [
    "## Summary",
    "",
    intent,
    "",
    `- Request: ${requestTitle}`,
    `- Target repo: \`${targetRepo}\``,
    `- Lane: \`${lane}\``,
    `- Task id: \`${taskId}\``,
    `- Source id: \`${sourceId}\``,
  ];
  if (sourceUrl) {
    lines.push(`- Source URL: ${sourceUrl}`);
  }
  if (requestBody?.trim()) {
    lines.push("", "## Request Context", "", requestBody.trim());
  }
  lines.push(
    "",
    "## Validation",
    "",
    `- verification profile: \`${verificationProfile}\``,
    validationSection,
    "- scafld review completed before PR publication",
    "- receipts uploaded with this workflow run",
    "",
    "## Lane Guardrails",
    "",
    ...laneConstraints(lane).map((line) => `- ${line}`),
    "",
  );
  return `${lines.join("\n")}\n`;
}

function laneConstraints(lane) {
  if (lane === "docs-pr") {
    return [
      "Keep the change docs-only unless a tiny mechanical fix is required to keep the docs truthful.",
      "Prefer README, docs, comments, and explanation surfaces over runtime behavior changes.",
      "Do not widen into feature work or unrelated cleanup.",
    ];
  }
  return [
    "Keep the change to one bounded bugfix in one repo surface.",
    "Do not widen into refactors, feature work, or broad cleanup.",
    "Only update docs when they are needed to explain the fix truthfully.",
  ];
}

function defaultSize(lane) {
  return lane === "docs-pr" ? "micro" : "small";
}

function buildBranchName(lane, requestTitle) {
  return `runx/${lane}-${normalizeTaskId(requestTitle)}`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--lane") {
      options.lane = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--runx-root") {
      options.runxRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--default-repo") {
      options.defaultRepo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--target-repo") {
      options.targetRepo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--request-title") {
      options.requestTitle = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--request-body") {
      options.requestBody = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--source") {
      options.source = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--source-id") {
      options.sourceId = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--source-url") {
      options.sourceUrl = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--artifact-root") {
      options.artifactRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--work-root") {
      options.workRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--branch") {
      options.branch = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--size") {
      options.size = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--risk") {
      options.risk = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--phase") {
      options.phase = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--scafld-bin") {
      options.scafldBin = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  for (const required of ["lane", "runxRoot", "defaultRepo", "targetRepo", "requestTitle", "requestBody", "scafldBin"]) {
    if (!options[required]) {
      throw new Error(`--${required.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)} is required.`);
    }
  }
  if (!["fix-pr", "docs-pr"].includes(options.lane)) {
    throw new Error("--lane must be `fix-pr` or `docs-pr`.");
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

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
