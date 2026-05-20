import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const contextBundle = JSON.parse(await readFile(path.resolve(options.context), "utf8"));
  const runResult = JSON.parse(await readFile(path.resolve(options.runResult), "utf8"));
  const drafts = buildPromotionDrafts({
    lane: options.lane,
    contextBundle,
    runResult,
    now: options.now ? new Date(options.now) : new Date(),
  });
  const written = await writePromotionDrafts({
    outputDir: path.resolve(options.outputDir),
    drafts,
  });

  const summary = {
    lane: options.lane,
    status: drafts.packet.status,
    summary: drafts.packet.summary,
    outputs: written,
  };

  if (options.summaryOutput) {
    await writeFile(path.resolve(options.summaryOutput), `${JSON.stringify(summary, null, 2)}\n`);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

export function buildPromotionDrafts({ lane, contextBundle, runResult, now = new Date() }) {
  const signal = extractRunSignal(runResult);
  const proposal = extractProposalDetails(runResult);
  const date = toDateStamp(now);
  const subjectLabel = String(contextBundle?.subject?.locator ?? contextBundle?.subject?.target_repo ?? "subject");
  const subjectSlug = slugify(subjectLabel);
  const summarySlug = slugify(signal.summary).slice(0, 48) || lane;
  const baseName = `${date}-${lane}-${subjectSlug}-${summarySlug}`.replace(/-+/g, "-");
  const harnessReceiptRefs = extractHarnessReceiptRefs(runResult);

  const packet = {
    created_at: now.toISOString(),
    lane,
    status: runResult?.status ?? "unknown",
    harness_receipt_refs: harnessReceiptRefs,
    summary: signal.summary,
    feed_channel: feedChannelForLane(lane, runResult?.status ?? "unknown"),
    main_feed_eligible: isMainFeedEligible(lane, runResult?.status ?? "unknown"),
    objective_fingerprint: firstString(contextBundle?.objective_fingerprint) || null,
    subject: contextBundle?.subject ?? {},
    thread_teaching_context: contextBundle?.thread_teaching_context ?? null,
    gate_decisions: Array.isArray(contextBundle?.gate_decisions) ? contextBundle.gate_decisions : [],
    signal,
    proposal,
  };

  return {
    packet,
    reflection: {
      filename: `${baseName}.md`,
      content: buildReflectionDraft({ date, lane, contextBundle, packet }),
    },
    history: {
      filename: `${baseName}.md`,
      content: buildHistoryDraft({ date, lane, contextBundle, packet }),
    },
    packetJson: {
      filename: `${baseName}.json`,
      content: `${JSON.stringify(packet, null, 2)}\n`,
    },
  };
}

export async function writePromotionDrafts({ outputDir, drafts }) {
  await mkdir(outputDir, { recursive: true });
  const reflectionPath = path.join(outputDir, drafts.reflection.filename);
  const historyPath = path.join(outputDir, `history-${drafts.history.filename}`);
  const packetPath = path.join(outputDir, drafts.packetJson.filename);

  await writeFile(reflectionPath, drafts.reflection.content);
  await writeFile(historyPath, drafts.history.content);
  await writeFile(packetPath, drafts.packetJson.content);

  return {
    reflection_path: reflectionPath,
    history_path: historyPath,
    packet_path: packetPath,
  };
}

function extractHarnessReceiptRefs(runResult) {
  if (Array.isArray(runResult?.harness_receipt_refs)) {
    return runResult.harness_receipt_refs
      .map(normalizeHarnessReceiptRef)
      .filter(Boolean);
  }
  const receiptId = firstString(runResult?.id) && runResult?.schema === "runx.harness_receipt.v1"
    ? firstString(runResult.id)
    : firstString(runResult?.receipt_id) ?? firstString(runResult?.receipt?.id);
  return receiptId
    ? [{ type: "harness_receipt", uri: `runx:harness_receipt:${receiptId}` }]
    : [];
}

function normalizeHarnessReceiptRef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const uri = firstString(value.uri);
  const locator = firstString(value.locator);
  if (!uri && !locator) {
    return null;
  }
  return {
    type: firstString(value.type) || "harness_receipt",
    ...(uri ? { uri } : {}),
    ...(locator ? { locator } : {}),
  };
}

function formatHarnessReceiptRef(ref) {
  return firstString(ref?.uri) || firstString(ref?.locator) || "runx:harness_receipt:unknown";
}

export function extractRunSignal(runResult) {
  const parsed = extractExecutionPayload(runResult);
  const triage = asRecord(parsed?.triage_report);
  const skillSpec = asRecord(parsed?.skill_spec);
  const changeSet = asRecord(parsed?.change_set);
  const workspaceChangePlan = asRecord(parsed?.workspace_change_plan);

  const summary =
    firstString(triage?.summary)
    || firstString(skillSpec?.summary)
    || firstString(skillSpec?.description)
    || firstString(parsed?.objective_summary)
    || firstString(skillSpec?.objective)
    || firstString(skillSpec?.name)
    || firstString(changeSet?.summary)
    || firstString(workspaceChangePlan?.change_set_id)
    || `lane finished with ${runResult?.status ?? "unknown"}`;

  return {
    summary,
    recommended_lane: firstString(triage?.recommended_lane) || null,
    suggested_reply: firstString(triage?.suggested_reply) || null,
    objective_summary: firstString(parsed?.objective_summary) || firstString(skillSpec?.objective) || null,
  };
}

function buildReflectionDraft({ date, lane, contextBundle, packet }) {
  const subject = contextBundle?.subject ?? {};
  const lines = [
    "---",
    `title: ${humanizeTitle(lane)} — ${packet.summary}`,
    `date: ${date}`,
    "visibility: public",
    `lane: ${lane}`,
    `status: ${packet.status}`,
    `feed_channel: ${packet.feed_channel}`,
    `main_feed_eligible: ${String(packet.main_feed_eligible)}`,
  ];

  if (packet.harness_receipt_refs.length > 0) {
    lines.push(`harness_receipt_ref: ${formatHarnessReceiptRef(packet.harness_receipt_refs[0])}`);
  }
  if (packet.objective_fingerprint) {
    lines.push(`objective_fingerprint: ${packet.objective_fingerprint}`);
  }
  if (subject.kind) {
    lines.push(`subject_kind: ${subject.kind}`);
  }
  if (subject.locator) {
    lines.push(`subject_locator: ${subject.locator}`);
  }
  if (subject.target_repo) {
    lines.push(`target_repo: ${subject.target_repo}`);
  }
  if (subject.issue_number) {
    lines.push(`issue_number: ${subject.issue_number}`);
  }
  if (subject.pr_number) {
    lines.push(`pr_number: ${subject.pr_number}`);
  }
  lines.push("---", "", `# ${humanizeTitle(lane)} — ${packet.summary}`, "");
  lines.push("## What Happened", "");
  lines.push(`- Lane: \`${lane}\``);
  lines.push(`- Subject: \`${contextBundle?.subject?.locator ?? "unknown"}\``);
  lines.push(`- Status: \`${packet.status}\``);
  if (packet.harness_receipt_refs.length > 0) {
    lines.push(`- Harness receipt: \`${formatHarnessReceiptRef(packet.harness_receipt_refs[0])}\``);
  }
  if (packet.objective_fingerprint) {
    lines.push(`- Objective Fingerprint: \`${packet.objective_fingerprint}\``);
  }

  appendThreadTeachingLines(lines, packet);

  lines.push("", "## Signals", "");
  lines.push(`- Summary: ${packet.summary}`);
  if (packet.proposal?.name) {
    lines.push(`- Proposal name: \`${packet.proposal.name}\``);
  }
  if (packet.proposal?.kind) {
    lines.push(`- Proposal kind: \`${packet.proposal.kind}\``);
  }
  if (packet.proposal?.status) {
    lines.push(`- Proposal status: \`${packet.proposal.status}\``);
  }
  if (packet.signal.objective_summary) {
    lines.push(`- Objective: ${packet.signal.objective_summary}`);
  }
  if (packet.signal.recommended_lane) {
    lines.push(`- Recommended next lane: \`${packet.signal.recommended_lane}\``);
  }
  if (packet.signal.suggested_reply) {
    lines.push(`- Suggested reply: ${packet.signal.suggested_reply}`);
  }
  if (packet.proposal?.summary) {
    lines.push(`- Contract summary: ${packet.proposal.summary}`);
  }

  appendProposalLines(lines, packet.proposal);

  lines.push("", "## Promotion Notes", "");
  lines.push("- This reflection draft is derived from the run result and bounded context bundle.");
  lines.push("- Promote into `state/` only after the underlying evidence is reviewed and worth retaining.");
  lines.push("- Promote into `history/` only if the event is part of the public evolutionary trail.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function buildHistoryDraft({ date, lane, contextBundle, packet }) {
  const subject = contextBundle?.subject ?? {};
  const title = `${humanizeTitle(lane)} — ${packet.summary}`;
  const lines = [
    "---",
    `title: ${title}`,
    `date: ${date}`,
    "visibility: public",
    `lane: ${lane}`,
    `status: ${packet.status}`,
    `feed_channel: ${packet.feed_channel}`,
    `main_feed_eligible: ${String(packet.main_feed_eligible)}`,
  ];
  if (subject.kind) {
    lines.push(`subject_kind: ${subject.kind}`);
  }
  if (subject.locator) {
    lines.push(`subject_locator: ${subject.locator}`);
  }
  if (subject.target_repo) {
    lines.push(`target_repo: ${subject.target_repo}`);
  }
  if (subject.issue_number) {
    lines.push(`issue_number: ${subject.issue_number}`);
  }
  if (subject.pr_number) {
    lines.push(`pr_number: ${subject.pr_number}`);
  }
  if (packet.harness_receipt_refs.length > 0) {
    lines.push(`harness_receipt_ref: ${formatHarnessReceiptRef(packet.harness_receipt_refs[0])}`);
  }
  if (packet.objective_fingerprint) {
    lines.push(`objective_fingerprint: ${packet.objective_fingerprint}`);
  }
  lines.push(
    "---",
    "",
    `# ${title}`,
    "",
    `A \`${lane}\` run against \`${contextBundle?.subject?.locator ?? "unknown"}\` finished with \`${packet.status}\`.`,
    "",
    `Summary: ${packet.summary}`,
  );
  if (packet.harness_receipt_refs.length > 0) {
    lines.push("", `Harness receipt reference: \`${formatHarnessReceiptRef(packet.harness_receipt_refs[0])}\`.`);
  }
  if (packet.objective_fingerprint) {
    lines.push("", `Objective fingerprint: \`${packet.objective_fingerprint}\`.`);
  }
  if (packet.proposal?.summary) {
    lines.push("", `Contract summary: ${packet.proposal.summary}`);
  }
  appendThreadTeachingLines(lines, packet);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function extractProposalDetails(runResult) {
  const parsed = extractExecutionPayload(runResult);
  const skillSpec = asRecord(parsed?.skill_spec);
  if (!skillSpec) {
    return null;
  }

  return {
    name: firstString(skillSpec?.name) || null,
    kind: firstString(skillSpec?.kind) || null,
    status: firstString(skillSpec?.status) || null,
    summary: firstString(skillSpec?.summary) || firstString(skillSpec?.description) || null,
    objective: firstString(skillSpec?.objective) || null,
    invariants: Array.isArray(skillSpec?.invariants) ? skillSpec.invariants.filter((item) => firstString(item)) : [],
    acceptance_checks: Array.isArray(parsed?.acceptance_checks) ? parsed.acceptance_checks : [],
    findings: Array.isArray(parsed?.findings) ? parsed.findings : [],
    recommended_flow: Array.isArray(parsed?.recommended_flow) ? parsed.recommended_flow : [],
    risks: Array.isArray(parsed?.risks) ? parsed.risks : [],
    sources: Array.isArray(parsed?.sources) ? parsed.sources : [],
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--lane") {
      options.lane = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--context") {
      options.context = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--run-result") {
      options.runResult = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output-dir") {
      options.outputDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--summary-output") {
      options.summaryOutput = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--now") {
      options.now = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.lane || !options.context || !options.runResult || !options.outputDir) {
    throw new Error("--lane, --context, --run-result, and --output-dir are required.");
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

function appendThreadTeachingLines(lines, packet) {
  if (!packet?.thread_teaching_context && (!Array.isArray(packet?.gate_decisions) || packet.gate_decisions.length === 0)) {
    return;
  }
  lines.push("", "## Thread Teaching", "");
  for (const record of packet?.thread_teaching_context?.records ?? []) {
    lines.push(`- \`${record.kind}\`: ${record.summary}`);
    if (record.source_url) {
      lines.push(`- Source URL: ${record.source_url}`);
    }
    if (record.recorded_by) {
      lines.push(`- Recorded by: \`${record.recorded_by}\``);
    }
    for (const invariant of record.invariants ?? []) {
      lines.push(`- Invariant: ${invariant}`);
    }
    for (const note of record.notes ?? []) {
      lines.push(`- Note: ${note}`);
    }
  }
  const decisions = Array.isArray(packet?.gate_decisions) ? packet.gate_decisions : [];
  for (const decision of decisions) {
    const gateId = firstString(decision?.gate_id);
    const gateReason = firstString(decision?.authorization_reason) || firstString(decision?.gate_reason);
    lines.push(`- Gate decision: \`${gateId || "unknown-gate"}\`${gateReason ? ` · ${gateReason}` : ""}`);
  }
  lines.push("- Thread teaching narrows the run, records human teaching, and does not widen authority beyond lane policy.");
}

function appendProposalLines(lines, proposal) {
  if (!proposal) {
    return;
  }

  if (proposal.objective) {
    lines.push("", "## Proposal Objective", "", proposal.objective);
  }

  if (Array.isArray(proposal.findings) && proposal.findings.length > 0) {
    lines.push("", "## Findings", "");
    for (const finding of proposal.findings) {
      const claim = firstString(finding?.claim) || JSON.stringify(finding);
      lines.push(`- ${claim}`);
    }
  }

  if (Array.isArray(proposal.recommended_flow) && proposal.recommended_flow.length > 0) {
    lines.push("", "## Recommended Flow", "");
    for (const item of proposal.recommended_flow) {
      const step = firstString(item?.step) || JSON.stringify(item);
      const basis = firstString(item?.details) || firstString(item?.basis);
      lines.push(`- ${step}`);
      if (basis) {
        lines.push(`  ${basis}`);
      }
    }
  }

  if (Array.isArray(proposal.acceptance_checks) && proposal.acceptance_checks.length > 0) {
    lines.push("", "## Acceptance Checks", "");
    for (const check of proposal.acceptance_checks) {
      const id = firstString(check?.id);
      const assertion = firstString(check?.assertion) || firstString(check?.summary);
      if (id && assertion) {
        lines.push(`- \`${id}\`: ${assertion}`);
        continue;
      }
      if (assertion) {
        lines.push(`- ${assertion}`);
      }
    }
  }

  if (Array.isArray(proposal.risks) && proposal.risks.length > 0) {
    lines.push("", "## Risks", "");
    for (const risk of proposal.risks) {
      const summary = firstString(risk?.risk) || JSON.stringify(risk);
      lines.push(`- ${summary}`);
    }
  }
}

function extractExecutionPayload(runResult) {
  const stdout = firstString(runResult?.execution?.stdout);
  return tryParseJson(stdout);
}

function tryParseJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function toDateStamp(value) {
  return value.toISOString().slice(0, 10);
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function humanizeTitle(value) {
  return String(value ?? "")
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function feedChannelForLane(lane, status) {
  return isMainFeedEligible(lane, status) ? "main" : "ops";
}

function isMainFeedEligible(lane, status) {
  const normalizedLane = String(lane ?? "").trim();
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  if (!["success", "completed", "merged", "published"].includes(normalizedStatus)) {
    return false;
  }
  return [
    "issue-triage",
    "docs-pr",
    "fix-pr",
    "skill-upstream",
    "merge-watch",
    "market-brief",
    "trust-audit",
  ].includes(normalizedLane);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
