import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  runCommandPhase,
  runRunxBridgeWithRetry,
  sanitizeIssueBody,
} from "./run-issue-triage-workers.mjs";
import { renderRunxReviewerPacket } from "./runx-thread-story.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await runGovernedPrLane(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function runGovernedPrLane(options) {
  if (!options.threadTeachingContextFile || !options.requestFile) {
    throw new Error(`${options.lane} requires --request-file and --thread-teaching-context-file.`);
  }
  const preparedRequest = JSON.parse(await readFile(path.resolve(options.requestFile), "utf8"));
  const verificationCatalog = loadVerificationProfileCatalogSync(repoRoot);
  const requestTitle = String(preparedRequest.request_title ?? "").trim();
  const requestBody = String(preparedRequest.request_body ?? "").trim();
  const targetRepo = String(preparedRequest.target_repo ?? options.defaultRepo ?? "").trim();
  const workIssueRepo = String(preparedRequest?.source_issue?.repo ?? options.defaultRepo ?? "").trim();
  const workIssueNumber = preparedRequest?.source_issue?.number ?? null;
  const workIssueUrl = preparedRequest?.source_issue?.url ?? null;
  const ledgerRevision = preparedRequest?.source_issue?.ledger_revision ?? null;
  if (!requestTitle) {
    throw new Error(`${options.lane} request is missing request_title.`);
  }
  if (!requestBody) {
    throw new Error(`${options.lane} request is missing request_body.`);
  }
  if (!targetRepo) {
    throw new Error(`${options.lane} request is missing target_repo.`);
  }
  const sourceId = options.sourceId
    ?? (workIssueNumber ? `issue-${workIssueNumber}` : `${options.lane}-${normalizeTaskId(requestTitle)}`);
  const laneRequest = normalizeIssueToPrRequest({
    issue_title: requestTitle,
    issue_body: buildLaneRequestBody(options.lane, requestBody),
    source: "github_issue",
    source_id: sourceId,
    source_url: workIssueUrl ?? null,
    target_repo: targetRepo,
    branch: options.branch ?? buildBranchName(options.lane, requestTitle),
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
    const taskId = normalizeTaskId(`${options.lane}-${requestTitle}`);
    const executionLane = options.lane;
    const threadLocator = buildThreadLocator({
      sourceUrl: laneRequest.source_url,
      source: laneRequest.source,
      sourceId: laneRequest.source_id,
      repo: workIssueRepo || targetRepo,
      issueNumber: workIssueNumber,
    });
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
      "--thread-teaching-context-file",
      path.resolve(options.threadTeachingContextFile),
      "--thread-teaching-record-kind",
      "approval",
      "--thread-teaching-record-kind",
      "publish_authorization",
      "--thread-teaching-applies-to",
      `${options.lane}.publish`,
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
      "--thread_title",
      laneRequest.issue_title,
      "--thread_body",
      laneRequest.issue_body,
      "--thread_locator",
      threadLocator,
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
      "--scafld_bin",
      options.scafldBin,
    ];

    await runRunxBridgeWithRetry({
      bridgeArgs: coreArgs,
      startRunxArgs,
      resultPath,
      cwd: workDir,
    });

    const bootstrapCommands = runCommandPhase(verificationPlan.bootstrap_commands, { cwd: workDir });
    const verificationCommands = bootstrapCommands.error
      ? {
          status: "skipped",
          commands: [],
          error: null,
        }
      : runCommandPhase(verificationPlan.commands, { cwd: workDir });
    const verificationReport = buildVerificationReport({
      reportId: `verification-${taskId}`,
      targetRepo,
      verificationProfile: verificationPlan.profile_id,
      status: bootstrapCommands.error ? "fail" : verificationCommands.status,
      bootstrapCommands: bootstrapCommands.commands,
      commands: verificationCommands.commands,
    });
    await writeFile(
      path.join(artifactRoot, "verification-report.json"),
      `${JSON.stringify(verificationReport, null, 2)}\n`,
    );
    if (bootstrapCommands.error) {
      throw bootstrapCommands.error;
    }
    if (verificationCommands.error) {
      throw verificationCommands.error;
    }

    const publishPlan = buildPublishPlan({
      lane: options.lane,
      requestTitle,
      sourceId,
      targetRepo,
    });
    const prBodyPath = path.join(artifactRoot, "pr-body.md");
    const prBody = await buildLanePrBody({
      lane: options.lane,
      requestTitle,
      requestBody,
      sourceId,
      workIssueRepo,
      workIssueNumber,
      workIssueUrl,
      ledgerRevision,
      targetRepo,
      branch: publishPlan.branch,
      taskId,
      verificationProfile: verificationPlan.profile_id,
      bootstrapCommands: verificationPlan.bootstrap_commands,
      validationCommands: verificationPlan.commands,
      runxRoot: options.runxRoot,
    });
    await writeFile(prBodyPath, prBody);

    let publish = buildSkippedPublish({
      lane: options.lane,
      reason: options.publishReason,
    });
    let prEval = null;
    if (options.publish !== false) {
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
      publish = JSON.parse(publishJson);
      prEval = evaluateGeneratedPr({
        publish,
        body: prBody,
        validation: verificationReport,
      });
      await writeFile(path.join(artifactRoot, "pr-eval.json"), `${JSON.stringify(prEval, null, 2)}\n`);
    }
    await writeFile(path.join(artifactRoot, "publish.json"), `${JSON.stringify(publish, null, 2)}\n`);

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
      request_title: requestTitle,
      request_body: requestBody,
      target_repo: targetRepo,
      source_id: sourceId,
      work_issue: {
        repo: workIssueRepo || null,
        number: workIssueNumber,
        url: workIssueUrl,
        ledger_revision: ledgerRevision,
      },
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

export function buildSkippedPublish({ lane, reason } = {}) {
  const gateId = `${String(lane ?? "").trim()}.publish`;
  return {
    status: "not_requested",
    reason: normalizeString(reason) ?? `${gateId} gate not granted yet`,
  };
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

export async function buildLanePrBody(options) {
  return renderRunxReviewerPacket({
    runxRoot: options.runxRoot,
    threadStoryRenderer: options.threadStoryRenderer,
    packet: buildLaneReviewerPacketInput(options),
  });
}

export function buildLaneReviewerPacketInput({
  lane,
  requestTitle,
  requestBody,
  sourceId,
  workIssueRepo,
  workIssueNumber,
  workIssueUrl,
  ledgerRevision,
  targetRepo,
  branch,
  taskId,
  verificationProfile,
  bootstrapCommands,
  validationCommands,
}) {
  const bootstrap = Array.isArray(bootstrapCommands) ? bootstrapCommands : [];
  const proof = Array.isArray(validationCommands) ? validationCommands : [];
  const intent = lane === "docs-pr"
    ? "Aster opened this draft PR through the `docs-pr` lane to make one bounded explanation or docs improvement."
    : "Aster opened this draft PR through the `fix-pr` lane to make one bounded bugfix in one repo surface.";
  const sourceContext = [
    `Request: ${requestTitle}`,
    `Lane: ${lane}`,
    `Task id: ${taskId}`,
    `Source id: ${sourceId}`,
    `Target repo: ${targetRepo}`,
    workIssueNumber ? `Work issue: ${workIssueRepo ?? targetRepo}#${workIssueNumber}` : null,
    ledgerRevision ? `Ledger revision: ${ledgerRevision}` : null,
    requestBody?.trim() ? `Request context:\n${requestBody.trim()}` : null,
  ].filter(Boolean);
  const validation = [
    `Verification profile: ${verificationProfile}`,
    ...(bootstrap.length > 0
      ? bootstrap.map((command) => `Bootstrap: ${command}`)
      : ["Bootstrap: no bootstrap command was declared"]),
    ...proof.map((command) => `Proof: ${command}`),
  ];
  const reviewContext = [
    "The source issue is the living ledger; trusted maintainer amendments on that issue are authoritative for reruns.",
    "scafld review completed before PR publication.",
    "Receipts uploaded with this workflow run.",
    "Generated PR policy keeps this PR draft-only until a human reviewer merges it.",
  ];
  return {
    title: `[runx] ${lane}: ${requestTitle}`,
    summary: intent,
    sourceContext,
    source: workIssueUrl ? {
      label: "Source thread",
      uri: workIssueUrl,
    } : undefined,
    issue: workIssueUrl ? {
      label: workIssueNumber ? `${workIssueRepo ?? targetRepo}#${workIssueNumber}` : "Work issue",
      uri: workIssueUrl,
    } : undefined,
    targetRepo,
    branch,
    status: "draft",
    scope: laneConstraints(lane),
    checks: [
      "Change surface policy is evaluated during publication.",
      "Generated PR evaluation runs after publication.",
      "The PR is a review surface only; merge remains a human gate.",
    ],
    validation,
    reviewContext,
    risks: laneConstraints(lane),
    rollback: "Close or revert this runx/* branch and rerun the same work issue after amending the source ledger.",
    handoffReference: taskId,
    nextAction: "Human reviewer: inspect the source issue ledger, validation evidence, and diff; merge only if the bounded change is correct.",
    maxChars: 900,
  };
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

function defaultSize() {
  return "small";
}

function buildBranchName(lane, requestTitle) {
  return `runx/${lane}-${normalizeTaskId(requestTitle)}`;
}

function buildThreadLocator({ sourceUrl, source, sourceId, repo, issueNumber }) {
  const urlLocator = gitHubIssueLocatorFromUrl(sourceUrl);
  if (urlLocator) {
    return urlLocator;
  }
  const normalizedRepo = normalizeString(repo);
  const normalizedIssue = normalizeString(issueNumber);
  if (normalizedRepo && normalizedIssue) {
    return `github://${normalizedRepo}/issues/${normalizedIssue}`;
  }
  return [normalizeString(source) ?? "thread", normalizeString(sourceId) ?? "unknown"].join(":");
}

function gitHubIssueLocatorFromUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/(\d+)\/?$/i);
  return match ? `github://${match[1]}/issues/${match[2]}` : null;
}

function parseArgs(argv) {
  const options = {
    publish: true,
  };
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
    if (token === "--request-file") {
      options.requestFile = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--source-id") {
      options.sourceId = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--thread-teaching-context-file") {
      options.threadTeachingContextFile = requireValue(argv, ++index, token);
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
    if (token === "--publish") {
      options.publish = parseBooleanish(requireValue(argv, ++index, token), token);
      continue;
    }
    if (token === "--publish-reason") {
      options.publishReason = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--scafld-bin") {
      options.scafldBin = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  for (const required of [
    "lane",
    "runxRoot",
    "defaultRepo",
    "requestFile",
    "scafldBin",
    "threadTeachingContextFile",
  ]) {
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

function parseBooleanish(value, flag) {
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  throw new Error(`${flag} must be true or false.`);
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
