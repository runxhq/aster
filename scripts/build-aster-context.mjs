import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildGateAuthorizations,
  normalizeThreadTeachingContext,
  threadTeachingRecordMatchesCriteria,
} from "./thread-teaching.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const bundle = await buildContextBundle(options);
  const prompt = renderContextPrompt(bundle);

  if (options.output) {
    await writeFile(path.resolve(options.output), `${JSON.stringify(bundle, null, 2)}\n`);
  }
  if (options.promptOutput) {
    await writeFile(path.resolve(options.promptOutput), `${prompt}\n`);
  }

  if (!options.output && !options.promptOutput) {
    process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
  }
}

export async function buildContextBundle(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const artifactRoot = path.resolve(repoRoot, options.artifactRoot ?? ".artifacts");
  const repo = options.repo ?? "nilstate/aster";
  const targetRepo = options.targetRepo ?? repo;
  const targetSlug = slugifyRepoLike(targetRepo);
  const snapshot = await readOptionalJson(options.snapshot ? path.resolve(options.snapshot) : undefined);
  const suppliedThreadTeachingContext = await readOptionalJson(
    options.threadTeachingContextFile ? path.resolve(options.threadTeachingContextFile) : undefined,
  );
  const doctrine = await readMarkdownDirectory(path.join(repoRoot, "doctrine"), {
    limit: 8,
    includeContent: true,
    repoRoot,
  });
  const history = await readMarkdownDirectory(path.join(repoRoot, "history"), {
    limit: Number(options.maxHistory ?? 4),
    includeContent: false,
    repoRoot,
  });
  const reflections = await readMarkdownDirectory(path.join(repoRoot, "reflections"), {
    limit: Number(options.maxReflections ?? 4),
    includeContent: true,
    repoRoot,
  });
  const control = await readOptionalJson(path.join(repoRoot, "state", "aster-control.json"));
  const priorities = await readMarkdownDocument(path.join(repoRoot, "state", "priorities.md"), repoRoot);
  const capabilities = await readMarkdownDocument(path.join(repoRoot, "state", "capabilities.md"), repoRoot);
  const target = await readMarkdownDocument(
    path.join(repoRoot, "state", "targets", `${targetSlug}.md`),
    repoRoot,
  );
  const threadTeachingState = await readOptionalJson(path.join(repoRoot, "state", "thread-teaching.json"));
  const targetSummary = target ? summarizeTargetDoc(target) : null;
  const artifactSignals = await collectArtifactSignals(artifactRoot, repoRoot, {
    limit: Number(options.maxArtifacts ?? 8),
  });
  const threadTeachingCriteria = {
    objectiveFingerprint: options.objectiveFingerprint,
    recordKinds: options.threadTeachingRecordKinds,
    targetRepo,
    subjectLocator: options.subjectLocator ?? targetRepo,
    labels: options.threadTeachingLabels,
    appliesTo: uniqueStrings([
      ...(Array.isArray(options.threadTeachingAppliesTo) ? options.threadTeachingAppliesTo : []),
      options.lane ? `${options.lane}.*` : null,
      options.lane,
    ]),
    now: options.now,
  };

  return {
    generated_at: new Date().toISOString(),
    lane: options.lane ?? "unknown",
    objective_fingerprint: firstString(options.objectiveFingerprint) || null,
    subject: {
      kind: options.subjectKind ?? "repository",
      locator: options.subjectLocator ?? targetRepo,
      repo,
      target_repo: targetRepo,
      issue_number: options.issueNumber ?? null,
      pr_number: options.prNumber ?? null,
      issue_url: options.issueUrl ?? null,
    },
    thread_teaching_context: buildThreadTeachingContext(
      suppliedThreadTeachingContext,
      threadTeachingCriteria,
    ),
    thread_teaching: buildDerivedThreadTeaching({
      threadTeachingState,
      targetRepo,
      criteria: threadTeachingCriteria,
    }),
    doctrine,
    state: {
      control,
      priorities,
      capabilities,
      target,
      target_summary: targetSummary,
    },
    history,
    reflections: reflections.map((entry) => ({
      ...entry,
      is_relevant: isRelevantContextDoc(entry, {
        locator: options.subjectLocator ?? targetRepo,
        target_repo: targetRepo,
      }),
    })),
    artifact_signals: artifactSignals,
    snapshot,
  };
}

export function renderContextPrompt(bundle) {
  const lines = [
    "# Aster Context Bundle",
    "",
    `- lane: \`${bundle.lane}\``,
    `- subject_kind: \`${bundle.subject.kind}\``,
    `- subject_locator: \`${bundle.subject.locator}\``,
    `- repo: \`${bundle.subject.repo}\``,
  ];

  if (bundle.subject.target_repo) {
    lines.push(`- target_repo: \`${bundle.subject.target_repo}\``);
  }
  if (bundle.subject.issue_number) {
    lines.push(`- issue_number: \`${bundle.subject.issue_number}\``);
  }
  if (bundle.subject.pr_number) {
    lines.push(`- pr_number: \`${bundle.subject.pr_number}\``);
  }
  if (bundle.objective_fingerprint) {
    lines.push(`- objective_fingerprint: \`${bundle.objective_fingerprint}\``);
  }

  lines.push(
    "",
    "Use doctrine as constitutional guidance.",
    "Use state, history, reflections, and artifact signals as derived context.",
    "If the live request envelope conflicts with derived context, trust the live envelope and receipts.",
  );

  if (bundle.thread_teaching_context) {
    lines.push(
      "",
      "## Active Thread Teaching",
      "",
      "Treat this as explicit human teaching for the current run. It narrows the action, teaches future runs, and does not widen authority beyond lane policy.",
    );
    const threadTeachingLines = renderThreadTeachingContextLines(bundle.thread_teaching_context);
    if (threadTeachingLines.length > 0) {
      lines.push(...threadTeachingLines);
    }
  }

  if (bundle.thread_teaching?.matched_records?.length > 0) {
    lines.push(
      "",
      "## Derived Thread Teaching",
      "",
      "These are rebuildable precedents derived from trusted issue and PR thread evidence. They help with consistency; they do not outrank live thread context or lane policy.",
    );
    lines.push(...renderDerivedThreadTeachingLines(bundle.thread_teaching));
  }

  if (bundle.doctrine.length > 0) {
    lines.push("", "## Doctrine");
    for (const doc of sortDoctrineDocs(bundle.doctrine)) {
      lines.push("", `### ${doc.title}`);
      lines.push("", trimDoctrineForPrompt(doc));
    }
  }

  const stateDocs = [
    ["Current Priorities", bundle.state.priorities],
    ["Capability Map", bundle.state.capabilities],
    ["Target Dossier", bundle.state.target],
  ].filter(([, value]) => Boolean(value));

  if (stateDocs.length > 0 || bundle.state.control || bundle.state.target_summary) {
    lines.push("", "## Current State");
    if (bundle.state.control) {
      lines.push("", "### Live Control", "");
      lines.push(...renderControlSummaryLines(bundle.state.control));
    }
    if (bundle.state.target_summary) {
      lines.push("", "### Target Summary", "");
      lines.push(...renderTargetSummaryLines(bundle.state.target_summary));
    }
    for (const [label, doc] of stateDocs) {
      lines.push("", `### ${label}`);
      lines.push("", trimForPrompt(doc.content ?? doc.excerpt, 2000));
    }
  }

  if (bundle.history.length > 0) {
    lines.push("", "## Recent History");
    for (const entry of bundle.history) {
      lines.push(`- ${entry.title}: ${trimInline(entry.excerpt, 240)}`);
    }
  }

  if (bundle.reflections.length > 0) {
    lines.push("", "## Recent Reflections");
    for (const entry of bundle.reflections) {
      if (entry.is_relevant && entry.content) {
        lines.push("", `### ${entry.title}`);
        lines.push("", trimForPrompt(entry.content, 1600));
        continue;
      }
      lines.push(`- ${entry.title}: ${trimInline(entry.excerpt, 240)}`);
    }
  }

  if (bundle.artifact_signals.length > 0) {
    lines.push("", "## Recent Artifact Signals");
    for (const signal of bundle.artifact_signals) {
      const parts = [`- \`${signal.path}\``];
      if (signal.status) {
        parts.push(`[${signal.status}]`);
      }
      if (signal.summary) {
        parts.push(signal.summary);
      }
      lines.push(parts.join(" "));
    }
  }

  if (bundle.snapshot) {
    lines.push("", "## Supplied Snapshot", "", trimForPrompt(JSON.stringify(bundle.snapshot, null, 2), 2400));
  }

  return lines.join("\n").trim();
}

function parseArgs(argv) {
  const options = {
    threadTeachingRecordKinds: [],
    threadTeachingLabels: [],
    threadTeachingAppliesTo: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo-root") {
      options.repoRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--artifact-root") {
      options.artifactRoot = requireValue(argv, ++index, token);
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
    if (token === "--thread-teaching-context-file") {
      options.threadTeachingContextFile = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--thread-teaching-record-kind") {
      options.threadTeachingRecordKinds.push(requireValue(argv, ++index, token));
      continue;
    }
    if (token === "--thread-teaching-label") {
      options.threadTeachingLabels.push(requireValue(argv, ++index, token));
      continue;
    }
    if (token === "--objective-fingerprint") {
      options.objectiveFingerprint = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--thread-teaching-applies-to") {
      options.threadTeachingAppliesTo.push(requireValue(argv, ++index, token));
      continue;
    }
    if (token === "--now") {
      options.now = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--snapshot") {
      options.snapshot = requireValue(argv, ++index, token);
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
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--prompt-output") {
      options.promptOutput = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

function buildThreadTeachingContext(suppliedContext = null, criteria = {}) {
  const normalizedContext = normalizeThreadTeachingContext(
    suppliedContext?.thread_teaching_context ?? suppliedContext,
  );
  if (!normalizedContext) {
    return null;
  }
  const records = normalizedContext.records
    .filter((record) => threadTeachingRecordMatchesCriteria(record, criteria))
    .slice(0, 8);
  if (records.length === 0) {
    return null;
  }
  return {
    derived_at: firstString(normalizedContext.derived_at) || null,
    criteria: normalizedContext.criteria ?? {},
    records,
    gate_authorizations: buildGateAuthorizations(records),
  };
}

function buildDerivedThreadTeaching({ threadTeachingState, targetRepo, criteria }) {
  const records = Array.isArray(threadTeachingState?.records) ? threadTeachingState.records : [];
  const matchedRecords = records
    .filter((entry) => firstString(entry?.repo) === firstString(targetRepo))
    .filter((entry) => threadTeachingRecordMatchesCriteria(entry?.thread_teaching_record, criteria))
    .sort((left, right) =>
      Date.parse(firstString(right?.thread_teaching_record?.recorded_at) || "")
      - Date.parse(firstString(left?.thread_teaching_record?.recorded_at) || "")
    )
    .slice(0, 4)
    .map((entry) => ({
      repo: firstString(entry?.repo),
      thread: firstString(entry?.thread),
      thread_title: firstString(entry?.thread_title),
      thread_url: firstString(entry?.thread_url),
      status: firstString(entry?.status) || "active",
      thread_teaching_record: entry?.thread_teaching_record ?? null,
    }));

  if (matchedRecords.length === 0) {
    return null;
  }

  return {
    generated_at: firstString(threadTeachingState?.generated_at),
    source: threadTeachingState?.source ?? null,
    matched_records: matchedRecords,
  };
}

function renderThreadTeachingContextLines(threadTeachingContext) {
  const lines = [];
  if (threadTeachingContext.derived_at) {
    lines.push(`- derived_at: \`${threadTeachingContext.derived_at}\``);
  }
  for (const record of threadTeachingContext.records ?? []) {
    lines.push(`- \`${record.kind}\`: ${record.summary}`);
    if (record.source_url) {
      lines.push(`  - source_url: ${record.source_url}`);
    }
    if (record.recorded_by) {
      lines.push(`  - recorded_by: \`${record.recorded_by}\``);
    }
    if (record.objective_fingerprint) {
      lines.push(`  - objective_fingerprint: \`${record.objective_fingerprint}\``);
    }
    if (Array.isArray(record.applies_to) && record.applies_to.length > 0) {
      lines.push(`  - applies_to: ${record.applies_to.map((entry) => `\`${entry}\``).join(", ")}`);
    }
    for (const invariant of record.invariants ?? []) {
      lines.push(`  - invariant: ${invariant}`);
    }
    for (const note of record.notes ?? []) {
      lines.push(`  - note: ${note}`);
    }
    for (const decision of record.decisions ?? []) {
      lines.push(`  - decision: \`${firstString(decision?.gate_id)}\` = \`${firstString(decision?.decision)}\``);
    }
  }
  return lines;
}

function renderDerivedThreadTeachingLines(threadTeaching) {
  const lines = [];
  if (threadTeaching.generated_at) {
    lines.push(`- derived_at: \`${threadTeaching.generated_at}\``);
  }
  for (const recordEntry of threadTeaching.matched_records ?? []) {
    const threadLabel = recordEntry.thread ? `\`${recordEntry.thread}\`` : "`thread`";
    const title = firstString(recordEntry.thread_title) || "thread-teaching precedent";
    lines.push(`- ${threadLabel}: ${title}`);
    if (recordEntry.thread_url) {
      lines.push(`  - source_url: ${recordEntry.thread_url}`);
    }
    const threadTeachingLines = renderThreadTeachingContextLines({
      records: [recordEntry.thread_teaching_record ?? {}],
    });
    for (const line of threadTeachingLines.slice(0, 6)) {
      lines.push(`  ${line}`);
    }
  }
  return lines;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    const normalized = firstString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

async function readMarkdownDirectory(dirPath, options = {}) {
  if (!existsSync(dirPath)) {
    return [];
  }
  const entries = (await readdir(dirPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const limit = options.limit ?? entries.length;
  const docs = [];
  for (const entry of entries.slice(0, limit)) {
    const doc = await readMarkdownDocument(
      path.join(dirPath, entry),
      options.repoRoot ?? defaultRepoRoot,
      options.includeContent,
    );
    if (doc) {
      docs.push(doc);
    }
  }
  return docs;
}

async function readMarkdownDocument(filePath, repoRoot, includeContent = true) {
  if (!existsSync(filePath)) {
    return null;
  }
  const raw = await readFile(filePath, "utf8");
  const { frontmatter, content } = splitFrontmatter(raw);
  const title = frontmatter.title ?? extractHeading(content) ?? path.basename(filePath, ".md");
  return {
    path: path.relative(repoRoot, filePath).replaceAll(path.sep, "/"),
    title,
    date: frontmatter.date ?? frontmatter.updated ?? null,
    excerpt: trimInline(stripMarkdown(content), 360),
    content: includeContent ? content.trim() : undefined,
    frontmatter,
  };
}

function summarizeTargetDoc(doc) {
  const content = doc.content ?? "";
  return {
    subject_locator: firstString(doc.frontmatter?.subject_locator) || null,
    default_lanes: parseSectionCodeList(content, "Default Lanes"),
    current_opportunities: parseCurrentOpportunities(content),
    recent_outcomes: parseRecentOutcomes(content),
    trust_notes: parseSectionBullets(content, "Trust Notes"),
  };
}

function renderTargetSummaryLines(summary) {
  const lines = [];
  if (summary.default_lanes.length > 0) {
    lines.push(`- Default lanes: ${summary.default_lanes.map((lane) => `\`${lane}\``).join(", ")}`);
  }
  if (summary.current_opportunities.length > 0) {
    lines.push("- Current opportunities:");
    for (const entry of summary.current_opportunities.slice(0, 4)) {
      const laneLabel = entry.lane ? `\`${entry.lane}\`` : "general";
      lines.push(`  - ${laneLabel}: ${entry.summary}`);
    }
  }
  if (summary.recent_outcomes.length > 0) {
    lines.push("- Recent outcomes:");
    for (const outcome of summary.recent_outcomes.slice(0, 3)) {
      const receipt = outcome.receipt_id ? ` receipt=\`${outcome.receipt_id}\`` : "";
      lines.push(`  - \`${outcome.lane}\` -> \`${outcome.status}\`${receipt}: ${outcome.summary}`);
    }
  }
  if (summary.trust_notes.length > 0) {
    lines.push("- Trust notes:");
    for (const note of summary.trust_notes.slice(0, 3)) {
      lines.push(`  - ${note}`);
    }
  }
  return lines;
}

function renderControlSummaryLines(control) {
  const latestCycle = Array.isArray(control?.cycle_records) ? control.cycle_records.at(-1) : null;
  const priorityCount = Array.isArray(control?.priorities) ? control.priorities.length : 0;
  const lines = [`- persisted priorities: \`${priorityCount}\``];
  if (!latestCycle) {
    lines.push("- latest cycle: none");
    return lines;
  }
  lines.push(`- latest cycle status: \`${firstString(latestCycle.status) || "unknown"}\``);
  lines.push(`- latest cycle reason: ${firstString(latestCycle.reason) || "unknown"}`);
  if (latestCycle.selected_bucket) {
    lines.push(`- latest cycle bucket: \`${latestCycle.selected_bucket}\``);
  }
  if (latestCycle.authority?.scope) {
    lines.push(`- latest authority scope: \`${firstString(latestCycle.authority.scope) || "none"}\``);
  }
  if (latestCycle.authority?.approval_mode) {
    lines.push(`- latest approval mode: \`${firstString(latestCycle.authority.approval_mode) || "none"}\``);
  }
  if (latestCycle.dispatch?.status) {
    lines.push(`- latest dispatch status: \`${firstString(latestCycle.dispatch.status) || "no_dispatch"}\``);
  }
  if (latestCycle.dispatch?.target_repo) {
    lines.push(`- latest dispatch target: \`${firstString(latestCycle.dispatch.target_repo)}\``);
  }
  lines.push(`- latest cycle generated_at: \`${firstString(latestCycle.generated_at) || "unknown"}\``);

  const selectedTarget = Array.isArray(control?.targets)
    ? control.targets.find((entry) => firstString(entry?.repo) === firstString(latestCycle.dispatch?.target_repo))
    : null;
  if (selectedTarget?.lifecycle) {
    lines.push(`- selected target evaluations: \`${Number(selectedTarget.lifecycle.evaluated_count ?? 0)}\``);
    lines.push(`- selected target selections: \`${Number(selectedTarget.lifecycle.selected_count ?? 0)}\``);
    lines.push(`- selected target dispatches: \`${Number(selectedTarget.lifecycle.dispatched_count ?? 0)}\``);
  }
  return lines;
}

function splitFrontmatter(raw) {
  if (!raw.startsWith("---\n")) {
    return { frontmatter: {}, content: raw };
  }
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontmatter: {}, content: raw };
  }
  const frontmatterBlock = raw.slice(4, end);
  const content = raw.slice(end + 5);
  const frontmatter = {};
  for (const line of frontmatterBlock.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) {
      frontmatter[key] = value;
    }
  }
  return { frontmatter, content };
}

function parseSectionCodeList(content, heading) {
  const section = matchSection(content, heading);
  if (!section) {
    return [];
  }
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => {
      const match = line.match(/`([^`]+)`/);
      return match ? match[1] : line.replace(/^-+\s*/, "").trim();
    })
    .filter(Boolean);
}

function parseSectionBullets(content, heading) {
  const section = matchSection(content, heading);
  if (!section) {
    return [];
  }
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-+\s*/, "").trim());
}

function parseCurrentOpportunities(content) {
  const section = matchSection(content, "Current Opportunities");
  if (!section) {
    return [];
  }
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => {
      const laneMatch = line.match(/^- `([^`]+)`:\s*(.+)$/);
      if (laneMatch) {
        return {
          lane: laneMatch[1],
          summary: laneMatch[2].trim(),
        };
      }
      return {
        lane: null,
        summary: line.replace(/^-+\s*/, "").trim(),
      };
    });
}

function parseRecentOutcomes(content) {
  const section = matchSection(content, "Recent Outcomes");
  if (!section) {
    return [];
  }
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => {
      const withReceipt = line.match(/^- ([0-9-]+) · `([^`]+)` · `([^`]+)` · `([^`]+)` · (.+)$/);
      if (withReceipt) {
        const [, date, lane, status, receipt_id, summary] = withReceipt;
        return { date, lane, status, receipt_id, summary };
      }
      const withoutReceipt = line.match(/^- ([0-9-]+) · `([^`]+)` · `([^`]+)` · (.+)$/);
      if (!withoutReceipt) {
        return null;
      }
      const [, date, lane, status, summary] = withoutReceipt;
      return { date, lane, status, receipt_id: null, summary };
    })
    .filter(Boolean);
}

function matchSection(content, heading) {
  const pattern = new RegExp(`## ${escapeRegExp(heading)}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(pattern);
  return match ? match[1].trim() : "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractHeading(content) {
  for (const line of content.split("\n")) {
    if (line.startsWith("# ")) {
      return line.slice(2).trim();
    }
  }
  return "";
}

function stripMarkdown(content) {
  return content
    .replace(/^#+\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{2,}/g, " ")
    .trim();
}

async function collectArtifactSignals(rootDir, repoRoot, options = {}) {
  if (!existsSync(rootDir)) {
    return [];
  }
  const discovered = [];
  await walkJsonFiles(rootDir, async (filePath) => {
    const metadata = await stat(filePath);
    discovered.push({
      filePath,
      modifiedAt: metadata.mtime.toISOString(),
      size: metadata.size,
    });
  });

  const filtered = discovered
    .filter((entry) => entry.size <= 512 * 1024)
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
    .slice(0, options.limit ?? 8);

  const signals = [];
  for (const entry of filtered) {
    const payload = await readOptionalJson(entry.filePath);
    signals.push({
      path: path.relative(repoRoot, entry.filePath).replaceAll(path.sep, "/"),
      modified_at: entry.modifiedAt,
      status: firstString(
        payload?.status
        ?? payload?.publish?.status
        ?? payload?.conclusion
        ?? payload?.mode,
      ),
      summary: firstString(
        payload?.summary
        ?? payload?.objective_summary
        ?? payload?.reason
        ?? payload?.publish?.title
        ?? payload?.publish?.url
        ?? payload?.error,
      ),
    });
  }
  return signals;
}

async function walkJsonFiles(rootDir, visit) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (["provider-trace", "receipts", "workspaces", "node_modules"].includes(entry.name)) {
        continue;
      }
      await walkJsonFiles(absolute, visit);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      await visit(absolute);
    }
  }
}

async function readOptionalJson(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function slugifyRepoLike(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isRelevantContextDoc(entry, subject) {
  return firstString(entry?.frontmatter?.subject_locator) === firstString(subject.locator)
    || firstString(entry?.frontmatter?.target_repo) === firstString(subject.target_repo);
}

function sortDoctrineDocs(docs) {
  const priority = {
    "doctrine/ASTER.md": 0,
    "doctrine/MISSION.md": 1,
    "doctrine/EXAMPLES.md": 2,
    "doctrine/CONDUCT.md": 3,
    "doctrine/VOICE.md": 4,
    "doctrine/EPISTEMOLOGY.md": 5,
    "doctrine/AUTHORITY.md": 6,
    "doctrine/EVOLUTION.md": 7,
  };
  return [...docs].sort((left, right) => {
    return (priority[left.path] ?? 100) - (priority[right.path] ?? 100);
  });
}

function trimDoctrineForPrompt(doc) {
  const preferences = {
    "doctrine/ASTER.md": ["What It Must Become", "What It Must Never Become", "Success Condition"],
    "doctrine/MISSION.md": ["What Must Be Proven", "Highest-Value Proof", "Mission Questions"],
    "doctrine/EXAMPLES.md": ["Good Public Comment", "Bad Public Comment", "Good `no_op`", "Mission Contrast"],
    "doctrine/CONDUCT.md": ["People First", "Attention Is Expensive", "Public Attention Rules"],
    "doctrine/VOICE.md": ["Public Identity", "Voice Rules", "Permanence Test"],
    "doctrine/EPISTEMOLOGY.md": ["Receipts Before Memory", "Canonical And Derived", "Public Truthfulness"],
    "doctrine/AUTHORITY.md": ["Default Posture", "Allowed Without Fresh Human Approval", "Forbidden"],
    "doctrine/EVOLUTION.md": ["Order Of Improvement", "What May Change Automatically", "Failure Response"],
  };
  return trimSectionAware(doc.content ?? doc.excerpt, 2800, preferences[doc.path] ?? []);
}

function trimSectionAware(content, limit, preferredHeadings = []) {
  const normalized = String(content ?? "").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  const lines = normalized.split("\n");
  const intro = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      current = {
        heading: line.slice(3).trim(),
        lines: [line],
      };
      sections.push(current);
      continue;
    }
    if (!current) {
      intro.push(line);
      continue;
    }
    current.lines.push(line);
  }

  const chosen = [];
  if (intro.length > 0) {
    chosen.push(intro.join("\n").trim());
  }

  for (const preferred of preferredHeadings) {
    const match = sections.find((section) => section.heading === preferred);
    if (!match) {
      continue;
    }
    const block = match.lines.join("\n").trim();
    if (block && !chosen.includes(block)) {
      chosen.push(block);
    }
  }

  for (const section of sections) {
    const block = section.lines.join("\n").trim();
    if (!block || chosen.includes(block)) {
      continue;
    }
    chosen.push(block);
    if (chosen.join("\n\n").length >= limit) {
      break;
    }
  }

  const collapsed = chosen.join("\n\n").trim();
  if (collapsed.length <= limit) {
    return collapsed;
  }
  return `${collapsed.slice(0, limit - 3)}...`;
}

function trimInline(value, limit) {
  const collapsed = String(value ?? "").replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) {
    return collapsed;
  }
  return `${collapsed.slice(0, limit - 3)}...`;
}

function trimForPrompt(value, limit) {
  const normalized = String(value ?? "").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
