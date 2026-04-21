import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectWorkerValidationIssues,
  loadVerificationProfileCatalogSync,
  resolveVerificationPlan,
} from "./aster-v1-contracts.mjs";
import { assertMatchesRunxControlSchema } from "./runx-control-schemas.mjs";
import { evaluateGeneratedPr } from "./evaluate-generated-pr.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const decision = JSON.parse(await readFile(path.resolve(options.decision), "utf8"));
  const rawWorkerRequests = asArray(decision?.triage_decision?.worker_requests)
    .map(asRecord)
    .filter(Boolean);
  const verificationCatalog = loadVerificationProfileCatalogSync(repoRoot);
  const workerValidation = collectWorkerValidationIssues(rawWorkerRequests, {
    defaultRepo: options.defaultRepo,
    catalog: verificationCatalog,
  });

  await mkdir(path.resolve(options.artifactRoot), { recursive: true });
  await mkdir(path.resolve(options.workRoot), { recursive: true });

  if (rawWorkerRequests.length === 0) {
    await writeOutput(options.output, {
      status: "noop",
      reason: "no worker requests",
      worker_count: 0,
      workers: [],
    });
    return;
  }

  if (workerValidation.issues.length > 0) {
    await writeOutput(options.output, {
      status: "blocked",
      reason: "worker_requests_failed_prerelease_v1_policy",
      worker_count: 0,
      workers: [],
      errors: workerValidation.issues,
    });
    process.exitCode = 1;
    return;
  }

  const workers = [];
  let hasFailure = false;
  for (let index = 0; index < workerValidation.accepted.length; index += 1) {
    const workerRequest = workerValidation.accepted[index];
    try {
      workers.push(await runWorker({ options, workerRequest, index, verificationCatalog }));
    } catch (error) {
      hasFailure = true;
      workers.push({
        worker: firstString(workerRequest.worker) ?? "issue-to-pr",
        target_repo: firstString(asRecord(workerRequest.issue_to_pr_request)?.target_repo) ?? options.defaultRepo,
        status: "failure",
        error: serializeError(error),
      });
    }
  }

  await writeOutput(options.output, {
    status: hasFailure ? "failure" : "completed",
    worker_count: workers.length,
    workers,
  });

  if (hasFailure) {
    process.exitCode = 1;
  }
}

async function runWorker({ options, workerRequest, index, verificationCatalog }) {
  const workerNumber = String(index + 1).padStart(2, "0");
  const issueToPrRequest = asRecord(workerRequest.issue_to_pr_request);
  if (!issueToPrRequest) {
    throw new Error(`worker ${workerNumber} is missing issue_to_pr_request.`);
  }
  if (firstString(workerRequest.worker) !== "issue-to-pr") {
    throw new Error(`worker ${workerNumber} has unsupported type '${workerRequest.worker}'.`);
  }

  const targetRepo = firstString(issueToPrRequest.target_repo) ?? options.defaultRepo;
  const verificationPlan = resolveVerificationPlan({
    catalog: verificationCatalog,
    targetRepo,
    issueToPrRequest,
  });
  const workerKey = `worker-${workerNumber}`;
  const branchName = firstString(issueToPrRequest.branch)
    ?? `runx/issue-${options.issueNumber}-${slug(`${targetRepo}-${workerNumber}`)}`;
  const taskId = normalizeTaskId(
    firstString(issueToPrRequest.task_id) ?? `issue-${options.issueNumber}-${workerKey}`,
  );
  const issueTitle = firstString(issueToPrRequest.issue_title) ?? options.issueTitle;
  const issueBody = sanitizeIssueBody(firstString(issueToPrRequest.issue_body) ?? options.issueBody);
  const artifactDir = path.resolve(options.artifactRoot, workerKey);
  const workDir = path.resolve(options.workRoot, workerKey);

  await rm(artifactDir, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });

  const cleanup = await prepareWorkspace({
    targetRepo,
    defaultRepo: options.defaultRepo,
    workDir,
  });

  try {
    const resultPath = path.join(artifactDir, "result.json");
    const receiptDir = path.join(artifactDir, "receipts");
    const traceDir = path.join(artifactDir, "provider-trace");
    const skillPath = resolveRunxSkillPath(options.runxRoot, "issue-to-pr");
    const repoSnapshot = buildRepoSnapshot(workDir, targetRepo);
    const repoSnapshotPath = path.join(artifactDir, "repo-snapshot.json");
    await writeFile(repoSnapshotPath, `${JSON.stringify(repoSnapshot, null, 2)}\n`);
    const inlineRepoSnapshot = buildInlineRepoSnapshot(repoSnapshot);
    const coreArgs = [
      path.join(repoRoot, "scripts", "aster-core.mjs"),
      "--lane",
      "issue-to-pr-worker",
      "--runx-root",
      path.resolve(options.runxRoot),
      "--artifact-root",
      artifactDir,
      "--workdir",
      workDir,
      "--subject-kind",
      "github_issue",
      "--subject-locator",
      `${targetRepo}#issue/${options.issueNumber}`,
      "--repo",
      options.defaultRepo,
      "--target-repo",
      targetRepo,
      "--issue-number",
      options.issueNumber,
      "--issue-url",
      options.issueUrl,
      "--snapshot",
      repoSnapshotPath,
      "--receipt-dir",
      receiptDir,
      "--trace-dir",
      traceDir,
      "--output",
      resultPath,
    ];
    const startRunxArgs = [
      "skill",
      skillPath,
      "--fixture",
      workDir,
      "--task_id",
      taskId,
      "--issue_title",
      issueTitle,
      "--issue_body",
      issueBody,
      "--source",
      firstString(issueToPrRequest.source) ?? "github_issue",
      "--source_id",
      firstString(issueToPrRequest.source_id) ?? options.issueNumber,
      "--source_url",
      firstString(issueToPrRequest.source_url) ?? options.issueUrl,
      "--target_repo",
      targetRepo,
      "--repo_snapshot",
      JSON.stringify(inlineRepoSnapshot),
      "--repo_snapshot_path",
      repoSnapshotPath,
      "--repo_context",
      buildRepoContextSummary(repoSnapshot),
      "--size",
      firstString(issueToPrRequest.size) ?? "micro",
      "--risk",
      firstString(issueToPrRequest.risk) ?? "low",
      "--phase",
      firstString(issueToPrRequest.phase) ?? "phase1",
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
      path.join(artifactDir, "verification-report.json"),
      `${JSON.stringify(verificationReport, null, 2)}\n`,
    );
    if (bootstrapCommands.error) {
      throw bootstrapCommands.error;
    }
    if (verificationCommands.error) {
      throw verificationCommands.error;
    }

    const bootstrapCommandList = verificationPlan.bootstrap_commands;
    const validationCommands = verificationPlan.commands;
    const prBodyPath = path.join(artifactDir, "pr-body.md");
    await writeFile(
      prBodyPath,
      buildPrBody({
        issueNumber: options.issueNumber,
        issueUrl: options.issueUrl,
        targetRepo,
        taskId,
        workerNumber,
        bootstrapCommands: bootstrapCommandList,
        validationCommands,
        verificationProfile: verificationPlan.profile_id,
      }),
    );

    const publishJson = run(process.execPath, [
      path.join(repoRoot, "scripts", "publish-runx-pr.mjs"),
      "--repo",
      targetRepo,
      "--issue-repo",
      options.defaultRepo,
      "--branch",
      branchName,
      "--title",
      `[runx] resolve issue #${options.issueNumber} (${workerNumber})`,
      "--commit-message",
      `feat(issue): resolve #${options.issueNumber} (${workerNumber})`,
      "--body-file",
      prBodyPath,
      "--lane",
      "issue-triage",
      "--issue-number",
      options.issueNumber,
    ], { cwd: workDir });
    await writeFile(path.join(artifactDir, "publish.json"), `${publishJson}\n`);
    const publish = JSON.parse(publishJson);
    const prEval = evaluateGeneratedPr({
      publish,
      body: await readFile(prBodyPath, "utf8"),
      validation: JSON.parse(await readFile(path.join(artifactDir, "verification-report.json"), "utf8")),
    });
    await writeFile(path.join(artifactDir, "pr-eval.json"), `${JSON.stringify(prEval, null, 2)}\n`);

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
      worker: workerRequest.worker,
      target_repo: targetRepo,
      branch: branchName,
      task_id: taskId,
      status: "completed",
      verification_profile: verificationPlan.profile_id,
      bootstrap_commands: bootstrapCommandList,
      validation_commands: validationCommands,
      publish,
    };
  } finally {
    try {
      await cleanup();
    } catch (error) {
      console.error(`cleanup failed for ${workerKey}: ${error.message}`);
    }
  }
}

export async function prepareWorkspace({ targetRepo, defaultRepo, workDir }) {
  if (targetRepo === defaultRepo) {
    run("git", ["worktree", "add", "--force", "--detach", workDir, "HEAD"], { cwd: repoRoot });
    return async () => {
      run("git", ["worktree", "remove", "--force", workDir], { cwd: repoRoot });
    };
  }

  run("gh", ["repo", "clone", targetRepo, workDir, "--", "--depth", "1"], { cwd: repoRoot });
  return async () => {
    await rm(workDir, { recursive: true, force: true });
  };
}

export function buildRepoSnapshot(workDir, targetRepo) {
  const snapshot = {
    target_repo: targetRepo,
    cwd: workDir,
    git: buildGitSnapshot(workDir),
    top_level_entries: listEntries(workDir),
    notable_paths: collectNotablePaths(workDir),
    readme_excerpt: readTextExcerpt(path.join(workDir, "README.md"), 2000),
    manifests: buildManifestSnapshot(workDir),
    submodules: readGitSubmoduleStatus(workDir),
  };
  return snapshot;
}

export function buildInlineRepoSnapshot(snapshot) {
  const topLevelEntries = Array.isArray(snapshot.top_level_entries)
    ? snapshot.top_level_entries.slice(0, 12).map((entry) => ({
        name: entry.name,
        kind: entry.kind,
      }))
    : [];
  const manifests = {};

  for (const [manifestPath, manifest] of Object.entries(snapshot.manifests ?? {})) {
    manifests[manifestPath] = {
      name: manifest?.name ?? null,
      private: manifest?.private ?? null,
      scripts: Array.isArray(manifest?.scripts) ? manifest.scripts.slice(0, 8) : [],
      excerpt: typeof manifest?.excerpt === "string" ? manifest.excerpt.slice(0, 240) : undefined,
      parse_error: manifest?.parse_error === true ? true : undefined,
    };
  }

  return {
    target_repo: snapshot.target_repo,
    git: snapshot.git,
    top_level_entries: topLevelEntries,
    notable_paths: Array.isArray(snapshot.notable_paths) ? snapshot.notable_paths.slice(0, 12) : [],
    manifests,
    submodules: Array.isArray(snapshot.submodules) ? snapshot.submodules.slice(0, 6) : [],
  };
}

function buildGitSnapshot(workDir) {
  const branch = safeRun("git", ["branch", "--show-current"], { cwd: workDir });
  const head = safeRun("git", ["rev-parse", "HEAD"], { cwd: workDir });
  return {
    branch: branch || null,
    head: head || null,
  };
}

function listEntries(rootDir, maxEntries = 24) {
  if (!existsSync(rootDir)) {
    return [];
  }
  return readdirSync(rootDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, maxEntries)
    .map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
    }));
}

function collectNotablePaths(rootDir) {
  const candidates = [
    "README.md",
    "package.json",
    "Makefile",
    ".ai/config.yaml",
    "api/package.json",
    "app/package.json",
    "api/Gemfile",
    "api/README.md",
    "app/README.md",
    "mcp/package.json",
  ];

  return candidates.filter((relativePath) => existsSync(path.join(rootDir, relativePath)));
}

function buildManifestSnapshot(rootDir) {
  const manifests = {};
  const packagePaths = ["package.json", "api/package.json", "app/package.json", "mcp/package.json"];
  for (const relativePath of packagePaths) {
    const absolutePath = path.join(rootDir, relativePath);
    if (!existsSync(absolutePath)) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(absolutePath, "utf8"));
      manifests[relativePath] = {
        name: typeof parsed.name === "string" ? parsed.name : null,
        private: typeof parsed.private === "boolean" ? parsed.private : null,
        scripts: isRecord(parsed.scripts) ? Object.keys(parsed.scripts).sort().slice(0, 20) : [],
      };
    } catch {
      manifests[relativePath] = { parse_error: true };
    }
  }

  const gemfilePath = path.join(rootDir, "api", "Gemfile");
  if (existsSync(gemfilePath)) {
    manifests["api/Gemfile"] = {
      excerpt: readTextExcerpt(gemfilePath, 800),
    };
  }

  return manifests;
}

function readGitSubmoduleStatus(workDir) {
  const gitmodulesPath = path.join(workDir, ".gitmodules");
  if (!existsSync(gitmodulesPath)) {
    return [];
  }
  const status = safeRun("git", ["submodule", "status"], { cwd: workDir });
  if (!status) {
    return [];
  }
  return status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function readTextExcerpt(filePath, maxChars) {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return null;
    }
    return readFileSync(filePath, "utf8")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxChars);
  } catch {
    return null;
  }
}

export function buildRepoContextSummary(snapshot) {
  const parts = [];
  if (snapshot.target_repo) {
    parts.push(`target_repo=${snapshot.target_repo}`);
  }
  if (snapshot.git?.branch || snapshot.git?.head) {
    parts.push(`git=${snapshot.git.branch ?? "detached"}@${(snapshot.git.head ?? "").slice(0, 12)}`);
  }
  if (Array.isArray(snapshot.notable_paths) && snapshot.notable_paths.length > 0) {
    parts.push(`paths=${snapshot.notable_paths.join(", ")}`);
  }
  const rootManifest = snapshot.manifests?.["package.json"];
  if (rootManifest?.scripts?.length > 0) {
    parts.push(`root_scripts=${rootManifest.scripts.join(", ")}`);
  }
  const appManifest = snapshot.manifests?.["app/package.json"];
  if (appManifest?.scripts?.length > 0) {
    parts.push(`app_scripts=${appManifest.scripts.join(", ")}`);
  }
  if (Array.isArray(snapshot.submodules) && snapshot.submodules.length > 0) {
    parts.push(`submodules=${snapshot.submodules.join(" | ")}`);
  }
  return parts.join(" ; ");
}

function buildPrBody({
  issueNumber,
  issueUrl,
  targetRepo,
  taskId,
  workerNumber,
  bootstrapCommands,
  validationCommands,
  verificationProfile,
}) {
  const bootstrapSection = bootstrapCommands.length > 0
    ? bootstrapCommands.map((command) => `- \`${command}\``).join("\n")
    : "- no bootstrap command was declared";
  const validationSection = validationCommands.length > 0
    ? validationCommands.map((command) => `- \`${command}\``).join("\n")
    : "- no repo-specific validation command was declared";
  return `## Summary

This draft PR was opened by the \`aster\` issue triage lane.

- Source issue: #${issueNumber}
- Issue URL: ${issueUrl}
- Target repo: \`${targetRepo}\`
- Worker: \`${workerNumber}\`
- Lane: \`support-triage -> issue-triage -> issue-to-pr worker\`
- scafld task: \`${taskId}\`

## Validation

- verification profile: \`${verificationProfile}\`
### Bootstrap
${bootstrapSection}
### Proof
${validationSection}
- scafld review completed before PR publication
- receipts uploaded with this workflow run
`;
}

async function writeOutput(outputPath, payload) {
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  if (outputPath) {
    await writeFile(path.resolve(outputPath), serialized);
  } else {
    process.stdout.write(serialized);
  }
}

function parseArgs(argv) {
  const options = {
    artifactRoot: ".artifacts/issue-triage/workers",
    workRoot: ".artifacts/issue-triage/workspaces",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--decision") {
      options.decision = requireValue(argv, ++index, token);
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
    if (token === "--issue-number") {
      options.issueNumber = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-title") {
      options.issueTitle = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-body") {
      options.issueBody = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue-url") {
      options.issueUrl = requireValue(argv, ++index, token);
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
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--scafld-bin") {
      options.scafldBin = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  for (const required of ["decision", "runxRoot", "defaultRepo", "issueNumber", "issueTitle", "issueBody", "issueUrl", "scafldBin"]) {
    if (!options[required]) {
      throw new Error(`--${required.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)} is required.`);
    }
  }

  return options;
}

export function resolveRunxSkillPath(runxRoot, relativeSkillPath) {
  const directPath = path.resolve(runxRoot, "skills", relativeSkillPath);
  if (existsSync(directPath)) {
    return directPath;
  }
  const nestedPath = path.resolve(runxRoot, "oss", "skills", relativeSkillPath);
  if (existsSync(nestedPath)) {
    return nestedPath;
  }
  throw new Error(`Could not resolve runx skill path for ${relativeSkillPath} under ${runxRoot}.`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export async function runRunxBridgeWithRetry({ bridgeArgs, startRunxArgs, resultPath, cwd }) {
  const maxAttempts = Number(process.env.RUNX_BRIDGE_MAX_ATTEMPTS ?? "3");
  let runxArgs = [...startRunxArgs];
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      run(process.execPath, [...bridgeArgs, "--", ...runxArgs], { cwd });
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableBridgeFailure(error) || attempt === maxAttempts) {
        throw error;
      }

      const resumedRunId = readBridgeRunId(resultPath);
      runxArgs = resumedRunId ? ["resume", resumedRunId] : [...startRunxArgs];
    }
  }

  throw lastError;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function normalizeTaskId(value) {
  return slug(value) || "issue-task";
}

export function sanitizeIssueBody(value) {
  const body = firstString(value);
  if (!body) {
    return "";
  }
  return body
    .split("\n")
    .filter((line) => !/^_Retry marker:/i.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isRetryableBridgeFailure(error) {
  const text = [error?.message, error?.stdout, error?.stderr]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join("\n");

  return /(ECONNRESET|ETIMEDOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED)/.test(text);
}

export function buildVerificationReport({
  reportId,
  targetRepo,
  verificationProfile,
  status,
  bootstrapCommands,
  commands,
  executedAt = new Date().toISOString(),
  receiptId,
}) {
  const normalizedStatus = normalizeVerificationStatus(status, bootstrapCommands, commands);
  const report = {
    report_id: reportId,
    target_repo: targetRepo,
    verification_profile: verificationProfile,
    status: normalizedStatus,
    bootstrap_commands: bootstrapCommands.map((command) => ({
      command: command.command,
      status: command.status,
      exit_code: command.exit_code ?? null,
      summary: command.summary,
    })),
    commands: commands.map((command) => ({
      command: command.command,
      status: command.status,
      exit_code: command.exit_code ?? null,
      summary: command.summary,
    })),
    summary: summarizeVerificationOutcome(normalizedStatus, bootstrapCommands, commands),
    executed_at: executedAt,
  };
  if (receiptId) {
    report.receipt_id = receiptId;
  }
  return assertMatchesRunxControlSchema("verification_report", report, {
    label: "verification_report",
  });
}

export function runCommandPhase(commands, options = {}) {
  const results = [];
  for (const command of commands) {
    try {
      run("bash", ["-lc", command], options);
      results.push({
        command,
        status: "pass",
        exit_code: 0,
        summary: "command completed successfully",
      });
    } catch (error) {
      const commandError = serializeCommandError(error);
      results.push({
        command,
        status: "fail",
        exit_code: commandError.exitCode,
        summary: commandError.summary,
      });
      return {
        status: "fail",
        commands: results,
        error,
      };
    }
  }

  return {
    status: results.length === 0 ? "skipped" : "pass",
    commands: results,
    error: null,
  };
}

function normalizeVerificationStatus(status, bootstrapCommands, commands) {
  if (status === "pending" || status === "pass" || status === "fail" || status === "skipped") {
    return status;
  }
  if (bootstrapCommands.some((command) => command.status === "fail")) {
    return "fail";
  }
  if (commands.some((command) => command.status === "fail")) {
    return "fail";
  }
  if (bootstrapCommands.length === 0 && commands.length === 0) {
    return "skipped";
  }
  return "pass";
}

function summarizeVerificationOutcome(status, bootstrapCommands, commands) {
  const bootstrapPassed = bootstrapCommands.filter((command) => command.status === "pass").length;
  const bootstrapFailed = bootstrapCommands.filter((command) => command.status === "fail").length;
  const passed = commands.filter((command) => command.status === "pass").length;
  const failed = commands.filter((command) => command.status === "fail").length;

  if (status === "skipped" && bootstrapCommands.length === 0 && commands.length === 0) {
    return "No bootstrap or verification commands were declared.";
  }
  if (bootstrapFailed > 0) {
    return `${bootstrapPassed} bootstrap command(s) passed; ${bootstrapFailed} failed. Verification commands were not executed.`;
  }
  if (status === "fail") {
    return `${bootstrapPassed} bootstrap command(s) passed; ${passed} verification command(s) passed; ${failed} failed.`;
  }
  return `${bootstrapPassed} bootstrap command(s) passed; ${passed} verification command(s) passed.`;
}

function serializeCommandError(error) {
  const exitCode = Number.isInteger(error?.status)
    ? error.status
    : Number.isInteger(error?.code)
      ? error.code
      : null;
  const stderr = firstString(error?.stderr);
  const message = firstString(error?.message);
  return {
    exitCode,
    summary: stderr ?? message ?? "command failed",
  };
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function readBridgeRunId(resultPath) {
  if (!existsSync(resultPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(resultPath, "utf8"));
    return firstString(parsed?.run_id);
  } catch {
    return undefined;
  }
}

function serializeError(error) {
  if (!error || typeof error !== "object") {
    return {
      message: String(error),
    };
  }

  return {
    name: firstString(error.name) ?? "Error",
    message: firstString(error.message) ?? "Unknown error",
    stack: firstString(error.stack),
  };
}

function safeRun(command, args, options = {}) {
  try {
    return run(command, args, options);
  } catch {
    return "";
  }
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
