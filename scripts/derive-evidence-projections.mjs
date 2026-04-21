import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyAsterPromotions, resolvePromotionOutputs } from "./apply-aster-promotions.mjs";
import { slugifyRepoLike } from "./build-aster-context.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");
const defaultArtifactPrefixes = ["issue-triage-", "skill-lab-"];

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await deriveEvidenceProjections(options);
  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(report.state, null, 2)}\n`);
  }
  if (options.reportOutput) {
    await writeFile(path.resolve(options.reportOutput), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.latestBatchOutput) {
    await writeFile(path.resolve(options.latestBatchOutput), `${JSON.stringify(report.latest_batch, null, 2)}\n`);
  }
  if (options.latestBatchMarkdownOutput) {
    await writeFile(path.resolve(options.latestBatchMarkdownOutput), `${renderLatestBatchMarkdown(report.latest_batch)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

export async function deriveEvidenceProjections(options = {}, helpers = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const repo = String(options.repo ?? process.env.GITHUB_REPOSITORY ?? "nilstate/aster");
  const statePath = path.resolve(options.output ?? path.join(repoRoot, "state", "evidence-projections.json"));
  const stateInputPath = path.resolve(options.stateInput ?? statePath);
  const downloadRoot = path.resolve(
    options.downloadRoot ?? path.join(repoRoot, ".artifacts", "evidence-projection-derive", "downloads"),
  );
  const artifactPrefixes = uniqueStrings(options.artifactPrefixes ?? defaultArtifactPrefixes);
  const limit = Number(options.limit ?? 200);
  const generatedAt = options.now ?? new Date().toISOString();
  const previousState = await readProjectionState(stateInputPath, {
    repo,
    artifactPrefixes,
    generatedAt,
    limit,
  });
  const trackedArtifactIds = new Set(
    normalizeCollection(previousState.artifacts).map((entry) => Number(entry?.artifact_id)).filter(Number.isFinite),
  );

  const listArtifacts = helpers.listArtifacts ?? defaultListArtifacts;
  const downloadArtifact = helpers.downloadArtifact ?? defaultDownloadArtifact;
  const findSummaryFiles = helpers.findSummaryFiles ?? defaultFindSummaryFiles;

  await mkdir(downloadRoot, { recursive: true });

  const listedArtifacts = normalizeCollection(await listArtifacts({ repo, limit }))
    .filter((artifact) => matchesArtifactPrefix(artifact?.name, artifactPrefixes))
    .filter((artifact) => !artifact?.expired)
    .sort(compareArtifactsByCreation);
  const newArtifactIds = new Set(
    listedArtifacts
      .map((artifact) => Number(artifact?.id))
      .filter(Number.isFinite)
      .filter((artifactId) => !trackedArtifactIds.has(artifactId)),
  );

  const processedArtifacts = [];
  const allCandidates = [];
  const skipped = [];
  const errors = [];
  let newlyProcessedArtifacts = 0;

  for (const artifact of listedArtifacts) {
    const artifactId = Number(artifact?.id);
    const isNewArtifact = newArtifactIds.has(artifactId);
    const unpackDir = path.join(downloadRoot, String(artifact.id));
    await rm(unpackDir, { recursive: true, force: true });
    await mkdir(unpackDir, { recursive: true });

    try {
      await downloadArtifact({
        repo,
        artifact,
        outputDir: unpackDir,
      });
      const summaryFiles = await findSummaryFiles(unpackDir);
      if (summaryFiles.length === 0) {
        if (isNewArtifact) {
          skipped.push({
            artifact_id: artifactId,
            name: String(artifact.name ?? ""),
            reason: "no_core_summary",
          });
        }
        continue;
      }

      const artifactCandidates = [];
      let failed = false;
      for (const summaryPath of summaryFiles.sort()) {
        try {
          const candidate = await buildProjectionCandidate({
            artifact,
            repoRoot,
            summaryPath,
          });
          artifactCandidates.push(candidate);
          allCandidates.push(candidate);
        } catch (error) {
          failed = true;
          errors.push({
            artifact_id: artifactId,
            name: String(artifact.name ?? ""),
            summary_path: path.relative(unpackDir, summaryPath).replaceAll(path.sep, "/"),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (!failed) {
        processedArtifacts.push(buildProcessedArtifactRecord(artifact, artifactCandidates));
        if (isNewArtifact) {
          newlyProcessedArtifacts += 1;
        }
      }
    } catch (error) {
      errors.push({
        artifact_id: artifactId,
        name: String(artifact.name ?? ""),
        summary_path: null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const selection = selectProjectionCandidates(allCandidates);
  await replaySelectedPromotions({
    repoRoot,
    candidates: selection.selected,
  });

  const applied = selection.selected
    .filter((candidate) => newArtifactIds.has(candidate.artifact_id))
    .map(buildAppliedSummaryReportRecord);
  const suppressed = selection.suppressed
    .filter((candidate) => newArtifactIds.has(candidate.artifact_id))
    .map(buildSuppressedSummaryReportRecord);

  const state = {
    generated_at: generatedAt,
    source: {
      type: "github_actions_artifacts",
      repo,
      artifact_prefixes: artifactPrefixes,
      artifact_limit: limit,
    },
    stats: {
      tracked_artifacts: processedArtifacts.length,
      newly_processed_artifacts: newlyProcessedArtifacts,
      applied_summaries: applied.length,
      suppressed_summaries: suppressed.length,
      skipped_artifacts: skipped.length,
      errors: errors.length,
    },
    artifacts: processedArtifacts.sort(compareStateArtifactsByCreation),
    projection_groups: selection.groups.map((group) => ({
      projection_key: group.projection_key,
      lane: group.lane,
      subject_locator: group.subject_locator,
      target_repo: group.target_repo,
      objective_fingerprint: group.objective_fingerprint,
      selected_artifact_id: group.selected_artifact_id,
      selected_receipt_id: group.selected_receipt_id,
      selected_summary: group.selected_summary,
      suppressed_artifact_ids: group.suppressed_artifact_ids,
    })),
  };

  const latestBatch = buildLatestBatchSummary({
    generatedAt,
    workflowRunId: firstString(options.workflowRunId) || null,
    workflowRunUrl: firstString(options.workflowRunUrl) || null,
    scannedArtifacts: listedArtifacts.length,
    newArtifacts: newArtifactIds.size,
    rebuiltArtifacts: processedArtifacts.length,
    replayedProjectionGroups: selection.groups.length,
    applied,
    suppressed,
    skipped,
    errors,
  });

  return {
    generated_at: generatedAt,
    repo,
    scanned_artifacts: listedArtifacts.length,
    candidate_artifacts: newArtifactIds.size,
    rebuilt_artifacts: processedArtifacts.length,
    replayed_projection_groups: selection.groups.length,
    applied,
    suppressed,
    skipped,
    errors,
    latest_batch: latestBatch,
    state,
  };
}

async function buildProjectionCandidate({ artifact, repoRoot, summaryPath }) {
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  const promotionOutputs = resolvePromotionOutputs(summary?.promotion_outputs, summaryPath);
  const packet = JSON.parse(await readFile(promotionOutputs.packet_path, "utf8"));
  const reflectionPath = path.relative(repoRoot, path.join(repoRoot, "reflections", path.basename(promotionOutputs.reflection_path))).replaceAll(path.sep, "/");
  const historyPath = path.relative(
    repoRoot,
    path.join(repoRoot, "history", path.basename(promotionOutputs.history_path).replace(/^history-/, "")),
  ).replaceAll(path.sep, "/");
  const targetRepo = firstString(packet?.subject?.target_repo)
    || firstString(packet?.subject?.repo)
    || "nilstate/aster";
  const targetDossierPath = path.join("state", "targets", `${slugifyRepoLike(targetRepo)}.md`).replaceAll(path.sep, "/");
  const subjectLocator = firstString(packet?.subject?.locator) || null;
  const objectiveFingerprint = firstString(packet?.objective_fingerprint) || null;

  return {
    artifact_id: Number(artifact.id),
    artifact_name: String(artifact.name ?? ""),
    artifact_created_at: firstString(artifact.created_at),
    artifact_updated_at: firstString(artifact.updated_at),
    workflow_run_id: numberOrNull(artifact.workflow_run?.id),
    head_branch: firstString(artifact.workflow_run?.head_branch) || null,
    head_sha: firstString(artifact.workflow_run?.head_sha) || null,
    summary_path: path.resolve(summaryPath),
    lane: firstString(packet?.lane),
    status: firstString(packet?.status),
    receipt_id: firstString(packet?.receipt_id) || null,
    summary: firstString(packet?.summary),
    packet_created_at: firstString(packet?.created_at),
    subject_locator: subjectLocator,
    target_repo: targetRepo,
    objective_fingerprint: objectiveFingerprint,
    projection_key: buildProjectionKey(packet),
    reflection_path: reflectionPath,
    history_path: historyPath,
    target_dossier_path: targetDossierPath,
  };
}

export function selectProjectionCandidates(candidates) {
  const grouped = new Map();
  for (const candidate of normalizeCollection(candidates)) {
    const projectionKey = firstString(candidate?.projection_key) || "unknown";
    const current = grouped.get(projectionKey) ?? [];
    current.push(candidate);
    grouped.set(projectionKey, current);
  }

  const selected = [];
  const suppressed = [];
  const groups = [];

  for (const [projectionKey, entries] of grouped.entries()) {
    const ordered = [...entries].sort(compareProjectionCandidatePreference);
    const winner = ordered[0];
    const suppressedEntries = ordered.slice(1);
    selected.push(winner);
    suppressed.push(
      ...suppressedEntries.map((entry) => ({
        ...entry,
        suppression_reason: "superseded_by_newer_projection",
        superseded_by_artifact_id: winner.artifact_id,
        superseded_by_receipt_id: winner.receipt_id,
      })),
    );
    groups.push({
      projection_key: projectionKey,
      lane: winner.lane,
      subject_locator: winner.subject_locator,
      target_repo: winner.target_repo,
      objective_fingerprint: winner.objective_fingerprint,
      selected_artifact_id: winner.artifact_id,
      selected_receipt_id: winner.receipt_id,
      selected_summary: winner.summary,
      suppressed_artifact_ids: suppressedEntries.map((entry) => entry.artifact_id),
    });
  }

  return {
    selected: selected.sort(compareProjectionCandidateChronology),
    suppressed,
    groups: groups.sort((left, right) => left.projection_key.localeCompare(right.projection_key)),
  };
}

async function replaySelectedPromotions({ repoRoot, candidates }) {
  for (const candidate of normalizeCollection(candidates).sort(compareProjectionCandidateChronology)) {
    await applyAsterPromotions({
      repoRoot,
      summary: candidate.summary_path,
    });
  }
}

function buildProcessedArtifactRecord(artifact, candidates) {
  return {
    artifact_id: Number(artifact.id),
    name: String(artifact.name ?? ""),
    created_at: firstString(artifact.created_at),
    updated_at: firstString(artifact.updated_at),
    workflow_run_id: numberOrNull(artifact.workflow_run?.id),
    head_branch: firstString(artifact.workflow_run?.head_branch) || null,
    head_sha: firstString(artifact.workflow_run?.head_sha) || null,
    summaries: normalizeCollection(candidates).map((entry) => ({
      lane: entry.lane,
      status: entry.status,
      receipt_id: entry.receipt_id,
      summary: entry.summary,
      packet_created_at: entry.packet_created_at,
      subject_locator: entry.subject_locator,
      target_repo: entry.target_repo,
      objective_fingerprint: entry.objective_fingerprint,
      projection_key: entry.projection_key,
      reflection_path: entry.reflection_path,
      history_path: entry.history_path,
      target_dossier_path: entry.target_dossier_path,
    })),
  };
}

function buildAppliedSummaryReportRecord(candidate) {
  return {
    artifact_id: candidate.artifact_id,
    artifact_name: candidate.artifact_name,
    workflow_run_id: candidate.workflow_run_id,
    artifact_created_at: candidate.artifact_created_at,
    lane: candidate.lane,
    status: candidate.status,
    receipt_id: candidate.receipt_id,
    summary: candidate.summary,
    packet_created_at: candidate.packet_created_at,
    subject_locator: candidate.subject_locator,
    target_repo: candidate.target_repo,
    objective_fingerprint: candidate.objective_fingerprint,
    projection_key: candidate.projection_key,
    reflection_path: candidate.reflection_path,
    history_path: candidate.history_path,
    target_dossier_path: candidate.target_dossier_path,
  };
}

function buildSuppressedSummaryReportRecord(candidate) {
  return {
    artifact_id: candidate.artifact_id,
    artifact_name: candidate.artifact_name,
    workflow_run_id: candidate.workflow_run_id,
    lane: candidate.lane,
    status: candidate.status,
    receipt_id: candidate.receipt_id,
    summary: candidate.summary,
    packet_created_at: candidate.packet_created_at,
    subject_locator: candidate.subject_locator,
    target_repo: candidate.target_repo,
    objective_fingerprint: candidate.objective_fingerprint,
    projection_key: candidate.projection_key,
    suppression_reason: candidate.suppression_reason,
    superseded_by_artifact_id: candidate.superseded_by_artifact_id,
    superseded_by_receipt_id: candidate.superseded_by_receipt_id,
  };
}

function buildLatestBatchSummary({
  generatedAt,
  workflowRunId,
  workflowRunUrl,
  scannedArtifacts,
  newArtifacts,
  rebuiltArtifacts,
  replayedProjectionGroups,
  applied,
  suppressed,
  skipped,
  errors,
}) {
  return {
    generated_at: generatedAt,
    workflow_run_id: workflowRunId,
    workflow_run_url: workflowRunUrl,
    scanned_artifacts: scannedArtifacts,
    new_artifacts: newArtifacts,
    rebuilt_artifacts: rebuiltArtifacts,
    replayed_projection_groups: replayedProjectionGroups,
    applied_summaries: normalizeCollection(applied).length,
    suppressed_summaries: normalizeCollection(suppressed).length,
    skipped_artifacts: normalizeCollection(skipped).length,
    error_count: normalizeCollection(errors).length,
    touched_targets: uniqueStrings(
      normalizeCollection(applied)
        .map((entry) => firstString(entry?.target_repo))
        .filter(Boolean),
    ),
    applied_projection_keys: uniqueStrings(
      normalizeCollection(applied).map((entry) => firstString(entry?.projection_key)).filter(Boolean),
    ),
    suppressed_projection_keys: uniqueStrings(
      normalizeCollection(suppressed).map((entry) => firstString(entry?.projection_key)).filter(Boolean),
    ),
    skipped_reasons: summarizeReasonCounts(skipped, "reason"),
    error_samples: normalizeCollection(errors).slice(0, 5).map((entry) => ({
      artifact_id: numberOrNull(entry?.artifact_id),
      name: firstString(entry?.name) || null,
      message: firstString(entry?.message) || null,
    })),
  };
}

export function renderLatestBatchMarkdown(summary) {
  const lines = [
    "## Latest Batch",
    "",
    `- Generated at: \`${firstString(summary?.generated_at) || "unknown"}\``,
  ];

  if (firstString(summary?.workflow_run_id)) {
    const runUrl = firstString(summary?.workflow_run_url);
    if (runUrl) {
      lines.push(`- Workflow run: [\`${summary.workflow_run_id}\`](${runUrl})`);
    } else {
      lines.push(`- Workflow run: \`${summary.workflow_run_id}\``);
    }
  }

  lines.push(
    `- Scanned artifact bundles: \`${Number(summary?.scanned_artifacts ?? 0)}\``,
    `- New artifact bundles: \`${Number(summary?.new_artifacts ?? 0)}\``,
    `- Rebuilt artifact bundles: \`${Number(summary?.rebuilt_artifacts ?? 0)}\``,
    `- Replayed projection groups: \`${Number(summary?.replayed_projection_groups ?? 0)}\``,
    `- Newly applied summaries: \`${Number(summary?.applied_summaries ?? 0)}\``,
    `- Newly suppressed summaries: \`${Number(summary?.suppressed_summaries ?? 0)}\``,
    `- Skipped artifacts: \`${Number(summary?.skipped_artifacts ?? 0)}\``,
    `- Errors: \`${Number(summary?.error_count ?? 0)}\``,
  );

  const touchedTargets = normalizeCollection(summary?.touched_targets);
  if (touchedTargets.length > 0) {
    lines.push("", "### Touched Targets", "");
    for (const target of touchedTargets) {
      lines.push(`- \`${target}\``);
    }
  }

  const skippedReasons = asRecord(summary?.skipped_reasons);
  if (Object.keys(skippedReasons).length > 0) {
    lines.push("", "### Skip Reasons", "");
    for (const [reason, count] of Object.entries(skippedReasons).sort((left, right) => left[0].localeCompare(right[0]))) {
      lines.push(`- \`${reason}\`: ${count}`);
    }
  }

  const errorSamples = normalizeCollection(summary?.error_samples);
  if (errorSamples.length > 0) {
    lines.push("", "### Error Samples", "");
    for (const entry of errorSamples) {
      const label = entry?.name ? `\`${entry.name}\`` : "`artifact`";
      const message = firstString(entry?.message) || "unknown error";
      lines.push(`- ${label}: ${message}`);
    }
  }

  return lines.join("\n").trimEnd();
}

async function readProjectionState(filePath, fallback) {
  if (!existsSync(filePath)) {
    return {
      generated_at: fallback.generatedAt,
      source: {
        type: "github_actions_artifacts",
        repo: fallback.repo,
        artifact_prefixes: fallback.artifactPrefixes,
        artifact_limit: fallback.limit,
      },
      stats: {
        tracked_artifacts: 0,
        newly_processed_artifacts: 0,
        applied_summaries: 0,
        suppressed_summaries: 0,
        skipped_artifacts: 0,
        errors: 0,
      },
      artifacts: [],
      projection_groups: [],
    };
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function defaultListArtifacts({ repo, limit }) {
  const pageSize = 100;
  const artifacts = [];
  let page = 1;

  while (artifacts.length < limit) {
    const remaining = limit - artifacts.length;
    const currentPageSize = Math.min(pageSize, remaining);
    const payload = JSON.parse(
      execFileSync(
        "gh",
        ["api", `repos/${repo}/actions/artifacts?per_page=${currentPageSize}&page=${page}`],
        { encoding: "utf8" },
      ),
    );
    const pageArtifacts = normalizeCollection(payload?.artifacts);
    if (pageArtifacts.length === 0) {
      break;
    }
    artifacts.push(...pageArtifacts);
    if (pageArtifacts.length < currentPageSize) {
      break;
    }
    page += 1;
  }

  return artifacts.slice(0, limit);
}

export async function defaultDownloadArtifact({ repo, artifact, outputDir }) {
  const zipBuffer = execFileSync(
    "gh",
    ["api", `repos/${repo}/actions/artifacts/${artifact.id}/zip`],
    {
      encoding: "buffer",
      maxBuffer: 1024 * 1024 * 50,
    },
  );
  const zipPath = path.join(outputDir, `${artifact.id}.zip`);
  await writeFile(zipPath, zipBuffer);
  execFileSync("unzip", ["-q", zipPath, "-d", outputDir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  await rm(zipPath, { force: true });
}

export async function defaultFindSummaryFiles(rootDir) {
  return findFilesByBasename(rootDir, "core-summary.json");
}

async function findFilesByBasename(rootDir, basename) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findFilesByBasename(fullPath, basename));
      continue;
    }
    if (entry.isFile() && entry.name === basename) {
      matches.push(fullPath);
    }
  }
  return matches;
}

function buildProjectionKey(packet) {
  const lane = firstString(packet?.lane) || "unknown-lane";
  const subjectLocator = firstString(packet?.subject?.locator);
  const objectiveFingerprint = firstString(packet?.objective_fingerprint);
  if (objectiveFingerprint && subjectLocator) {
    return `${lane}::${subjectLocator}::${objectiveFingerprint}`;
  }
  if (subjectLocator && (subjectLocator.includes("#issue/") || subjectLocator.includes("#pr/"))) {
    return `${lane}::${subjectLocator}`;
  }
  const targetRepo = firstString(packet?.subject?.target_repo)
    || firstString(packet?.subject?.repo);
  const summary = normalizeProjectionSummary(firstString(packet?.summary));
  if (subjectLocator) {
    return `${lane}::${subjectLocator}::${summary || "summary"}`;
  }
  if (targetRepo) {
    return `${lane}::${targetRepo}::${summary || "summary"}`;
  }
  return `${lane}::summary::${summary || "unknown"}`;
}

function normalizeProjectionSummary(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

function compareProjectionCandidatePreference(left, right) {
  const packetComparison = compareDateDesc(left?.packet_created_at, right?.packet_created_at);
  if (packetComparison !== 0) {
    return packetComparison;
  }
  const artifactComparison = compareDateDesc(left?.artifact_created_at, right?.artifact_created_at);
  if (artifactComparison !== 0) {
    return artifactComparison;
  }
  return Number(right?.artifact_id ?? 0) - Number(left?.artifact_id ?? 0);
}

function compareProjectionCandidateChronology(left, right) {
  const packetComparison = compareDateAsc(left?.packet_created_at, right?.packet_created_at);
  if (packetComparison !== 0) {
    return packetComparison;
  }
  const artifactComparison = compareDateAsc(left?.artifact_created_at, right?.artifact_created_at);
  if (artifactComparison !== 0) {
    return artifactComparison;
  }
  return Number(left?.artifact_id ?? 0) - Number(right?.artifact_id ?? 0);
}

function compareArtifactsByCreation(left, right) {
  const createdComparison = compareDateAsc(left?.created_at, right?.created_at);
  if (createdComparison !== 0) {
    return createdComparison;
  }
  return Number(left?.id ?? 0) - Number(right?.id ?? 0);
}

function compareStateArtifactsByCreation(left, right) {
  const createdComparison = compareDateAsc(left?.created_at, right?.created_at);
  if (createdComparison !== 0) {
    return createdComparison;
  }
  return Number(left?.artifact_id ?? 0) - Number(right?.artifact_id ?? 0);
}

function compareDateAsc(left, right) {
  const leftValue = Date.parse(String(left ?? ""));
  const rightValue = Date.parse(String(right ?? ""));
  if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue !== rightValue) {
    return leftValue - rightValue;
  }
  if (Number.isFinite(leftValue) && !Number.isFinite(rightValue)) {
    return -1;
  }
  if (!Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
    return 1;
  }
  return 0;
}

function compareDateDesc(left, right) {
  return compareDateAsc(right, left);
}

function summarizeReasonCounts(entries, field) {
  const counts = {};
  for (const entry of normalizeCollection(entries)) {
    const reason = firstString(entry?.[field]);
    if (!reason) {
      continue;
    }
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

function matchesArtifactPrefix(name, prefixes) {
  const normalized = String(name ?? "");
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

function normalizeCollection(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of normalizeCollection(values)) {
    const normalized = firstString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    artifactPrefixes: [...defaultArtifactPrefixes],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo-root") {
      options.repoRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--state-input") {
      options.stateInput = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--report-output") {
      options.reportOutput = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--latest-batch-output") {
      options.latestBatchOutput = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--latest-batch-markdown-output") {
      options.latestBatchMarkdownOutput = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--download-root") {
      options.downloadRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--artifact-prefix") {
      options.artifactPrefixes.push(requireValue(argv, ++index, token));
      continue;
    }
    if (token === "--limit") {
      options.limit = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--now") {
      options.now = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--workflow-run-id") {
      options.workflowRunId = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--workflow-run-url") {
      options.workflowRunUrl = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
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
