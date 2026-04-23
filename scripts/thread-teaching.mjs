import { execFileSync } from "node:child_process";

export const THREAD_TEACHING_MARKER = "<!-- aster:thread-teaching-record -->";
export const THREAD_TEACHING_MARKER_QUERY = "aster:thread-teaching-record";
export const THREAD_TEACHING_SEARCH_QUERIES = [
  THREAD_TEACHING_MARKER_QUERY,
  "Kind Summary",
  "Applies To",
  "Decision",
];
export const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
export const THREAD_TEACHING_KINDS = new Set([
  "approval",
  "lesson",
  "target_norm",
  "selection_feedback",
  "publish_authorization",
  "memory_correction",
]);

const GATE_AUTHORIZING_KINDS = new Set(["approval", "publish_authorization"]);

export function parseThreadTeachingRecordBody(body) {
  if (typeof body !== "string") {
    return null;
  }
  const rawContent = extractThreadTeachingRecordContent(body);
  if (!rawContent) {
    return null;
  }

  const lines = rawContent.split(/\r?\n/);
  let recordId = null;
  let kind = null;
  let summary = null;
  let recordedBy = null;
  let targetRepo = null;
  let subjectLocator = null;
  let objectiveFingerprint = null;
  let expiresAfter = null;
  let currentSection = null;
  const appliesTo = [];
  const invariants = [];
  const notes = [];
  const labels = [];
  const decisions = [];
  const supersedes = [];
  const summaryBuffer = [];

  for (const rawLine of lines) {
    const line = normalizeThreadTeachingLine(rawLine);
    if (!line || /^#{1,6}\s+/.test(line) || /^```/.test(line)) {
      continue;
    }

    const recordIdMatch = line.match(/^record id:\s*(.+)$/i);
    if (recordIdMatch) {
      recordId = normalizeString(recordIdMatch[1]);
      currentSection = null;
      continue;
    }

    const kindMatch = line.match(/^kind:\s*(.+)$/i);
    if (kindMatch) {
      const normalizedKind = normalizeThreadTeachingKind(kindMatch[1]);
      kind = normalizedKind;
      currentSection = null;
      continue;
    }

    const summaryMatch = line.match(/^summary:\s*(.+)$/i);
    if (summaryMatch) {
      summary = normalizeString(summaryMatch[1]);
      currentSection = null;
      continue;
    }

    const recordedByMatch = line.match(/^recorded by:\s*(.+)$/i);
    if (recordedByMatch) {
      recordedBy = normalizeString(recordedByMatch[1]);
      currentSection = null;
      continue;
    }

    const targetRepoMatch = line.match(/^target repo:\s*(.+)$/i);
    if (targetRepoMatch) {
      targetRepo = normalizeString(targetRepoMatch[1]);
      currentSection = null;
      continue;
    }

    const subjectLocatorMatch = line.match(/^subject locator:\s*(.+)$/i);
    if (subjectLocatorMatch) {
      subjectLocator = normalizeString(subjectLocatorMatch[1]);
      currentSection = null;
      continue;
    }

    const objectiveFingerprintMatch = line.match(/^objective fingerprint:\s*(.+)$/i);
    if (objectiveFingerprintMatch) {
      objectiveFingerprint = normalizeString(objectiveFingerprintMatch[1]);
      currentSection = null;
      continue;
    }

    const expiresAfterMatch = line.match(/^expires after:\s*(.+)$/i);
    if (expiresAfterMatch) {
      expiresAfter = normalizeString(expiresAfterMatch[1]);
      currentSection = null;
      continue;
    }

    const supersedesMatch = line.match(/^supersedes:\s*(.*)$/i);
    if (supersedesMatch) {
      if (supersedesMatch[1].trim()) {
        supersedes.push(...splitCsvList(supersedesMatch[1]));
        currentSection = null;
      } else {
        currentSection = "supersedes";
      }
      continue;
    }

    const appliesToMatch = line.match(/^applies(?:\s|-)?to:\s*(.*)$/i);
    if (appliesToMatch) {
      if (appliesToMatch[1].trim()) {
        appliesTo.push(...splitCsvList(appliesToMatch[1]));
        currentSection = null;
      } else {
        currentSection = "applies_to";
      }
      continue;
    }

    const labelMatch = line.match(/^label:\s*(.+)$/i);
    if (labelMatch) {
      labels.push(...splitCsvList(labelMatch[1]));
      currentSection = null;
      continue;
    }

    const noteMatch = line.match(/^note:\s*(.+)$/i);
    if (noteMatch) {
      notes.push(normalizeString(noteMatch[1]));
      currentSection = null;
      continue;
    }

    const invariantMatch = line.match(/^invariant:\s*(.+)$/i);
    if (invariantMatch) {
      invariants.push(normalizeString(invariantMatch[1]));
      currentSection = null;
      continue;
    }

    const decisionMatch = line.match(/^decision:\s*(.+)$/i);
    if (decisionMatch) {
      const decision = parseDecisionEntry(decisionMatch[1]);
      if (decision) {
        decisions.push(decision);
      }
      currentSection = null;
      continue;
    }

    if (/^labels:\s*$/i.test(line)) {
      currentSection = "labels";
      continue;
    }
    if (/^notes:\s*$/i.test(line)) {
      currentSection = "notes";
      continue;
    }
    if (/^invariants:\s*$/i.test(line)) {
      currentSection = "invariants";
      continue;
    }
    if (/^decisions:\s*$/i.test(line)) {
      currentSection = "decisions";
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      const value = bulletMatch[1].trim();
      if (currentSection === "applies_to") {
        appliesTo.push(...splitCsvList(value));
        continue;
      }
      if (currentSection === "labels") {
        labels.push(...splitCsvList(value));
        continue;
      }
      if (currentSection === "notes") {
        notes.push(normalizeString(value));
        continue;
      }
      if (currentSection === "invariants") {
        invariants.push(normalizeString(value));
        continue;
      }
      if (currentSection === "decisions") {
        const decision = parseDecisionEntry(value);
        if (decision) {
          decisions.push(decision);
        }
        continue;
      }
      if (currentSection === "supersedes") {
        supersedes.push(...splitCsvList(value));
        continue;
      }
    }

    summaryBuffer.push(line);
  }

  const normalizedAppliesTo = uniqueStrings([
    ...appliesTo,
    ...decisions.map((decision) => decision.gate_id),
  ]);
  const normalizedKind = kind ?? inferImplicitThreadTeachingKind({
    appliesTo: normalizedAppliesTo,
    decisions,
  });
  const normalizedSummary = summary
    ?? normalizeString(summaryBuffer.join(" "))
    ?? inferImplicitThreadTeachingSummary({
      kind: normalizedKind,
      appliesTo: normalizedAppliesTo,
      decisions,
    });
  if (!normalizedKind || !normalizedSummary) {
    return null;
  }

  return {
    record_id: recordId,
    kind: normalizedKind,
    summary: normalizedSummary,
    recorded_by: recordedBy,
    target_repo: targetRepo,
    subject_locator: subjectLocator,
    objective_fingerprint: objectiveFingerprint,
    expires_after: expiresAfter,
    applies_to: normalizedAppliesTo,
    invariants: uniqueStrings(invariants),
    notes: uniqueStrings(notes),
    labels: uniqueStrings(labels),
    decisions: uniqueDecisions(decisions),
    supersedes: uniqueStrings(supersedes),
  };
}

export function deriveThreadTeachingContext(entries = [], criteria = {}) {
  const normalizedEntries = [...entries]
    .map((entry) => normalizeThreadEntry(entry))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.created_at ?? "") - Date.parse(left.created_at ?? ""));
  const trustedRecords = extractTrustedThreadTeachingRecords(normalizedEntries, criteria);
  const supersededIds = collectSupersededRecordIds(trustedRecords, criteria.now);
  const matchedRecords = trustedRecords
    .map((record) => ({
      ...record,
      status: threadTeachingRecordStatus(record, {
        now: criteria.now,
        supersededIds,
      }),
    }))
    .filter((record) => threadTeachingRecordMatchesCriteria(record, criteria))
    .sort((left, right) => Date.parse(right.recorded_at ?? "") - Date.parse(left.recorded_at ?? ""))
    .slice(0, Number(criteria.limit ?? 8));

  if (matchedRecords.length === 0) {
    return null;
  }

  return {
    derived_at: criteria.now ?? new Date().toISOString(),
    criteria: serializeThreadTeachingCriteria(criteria),
    records: matchedRecords,
    gate_authorizations: buildGateAuthorizations(matchedRecords),
  };
}

export function extractTrustedThreadTeachingRecords(entries = [], criteria = {}) {
  const repo = normalizeString(criteria.repo);
  const threadKind = normalizeString(criteria.threadKind);
  const threadNumber = normalizeInteger(criteria.threadNumber);
  return entries.flatMap((entry) => {
    if (!TRUSTED_ASSOCIATIONS.has(String(entry.author_association ?? "").toUpperCase())) {
      return [];
    }
    const parsed = parseThreadTeachingRecordBody(entry.body);
    if (!parsed) {
      return [];
    }
    return [
      normalizeThreadTeachingRecord(parsed, {
        repo,
        thread_kind: threadKind,
        thread_number: threadNumber,
        source_type: entry.source_type,
        source_url: entry.url,
        author: entry.author,
        author_association: entry.author_association,
        created_at: entry.created_at,
      }),
    ];
  });
}

export function normalizeThreadTeachingRecord(record, metadata = {}) {
  const normalizedRecord = {
    record_id: normalizeString(record?.record_id)
      || buildThreadTeachingRecordId(record, metadata),
    kind: normalizeThreadTeachingKind(record?.kind),
    summary: normalizeString(record?.summary),
    recorded_by: normalizeString(record?.recorded_by) || normalizeString(metadata.author),
    target_repo: normalizeString(record?.target_repo),
    subject_locator: normalizeString(record?.subject_locator),
    objective_fingerprint: normalizeString(record?.objective_fingerprint),
    expires_after: normalizeString(record?.expires_after),
    applies_to: uniqueStrings(record?.applies_to),
    invariants: uniqueStrings(record?.invariants),
    notes: uniqueStrings(record?.notes),
    labels: uniqueStrings(record?.labels),
    decisions: uniqueDecisions(record?.decisions),
    supersedes: uniqueStrings(record?.supersedes),
    repo: normalizeString(metadata.repo),
    thread_kind: normalizeString(metadata.thread_kind),
    thread_number: normalizeInteger(metadata.thread_number),
    source_type: normalizeString(record?.source_type) || normalizeString(metadata.source_type),
    source_url: normalizeString(record?.source_url) || normalizeString(metadata.source_url),
    author: normalizeString(metadata.author),
    author_association: normalizeString(metadata.author_association),
    recorded_at: normalizeString(record?.recorded_at) || normalizeString(metadata.created_at),
  };

  if (!normalizedRecord.kind || !normalizedRecord.summary) {
    return null;
  }
  return normalizedRecord;
}

export function normalizeThreadTeachingContext(value) {
  const record = isPlainObject(value) ? value : {};
  const records = Array.isArray(record.records)
    ? record.records
      .map((entry) => normalizeThreadTeachingRecord(entry, entry))
      .filter(Boolean)
    : [];
  const gateAuthorizations = Array.isArray(record.gate_authorizations)
    ? record.gate_authorizations
      .map((entry) => normalizeGateAuthorization(entry))
      .filter(Boolean)
    : buildGateAuthorizations(records);

  if (records.length === 0 && gateAuthorizations.length === 0) {
    return null;
  }

  return {
    derived_at: normalizeString(record.derived_at),
    criteria: isPlainObject(record.criteria) ? serializeThreadTeachingCriteria(record.criteria) : {},
    records,
    gate_authorizations: gateAuthorizations,
  };
}

export function threadTeachingRecordMatchesCriteria(record, criteria = {}) {
  if (!record || typeof record !== "object") {
    return false;
  }
  const includeInactive = criteria.includeInactive === true;
  if (!includeInactive) {
    const status = normalizeString(record.status);
    if (status && status !== "active") {
      return false;
    }
    if (!status && isExpiredThreadTeachingRecord(record, criteria.now)) {
      return false;
    }
  }

  const requiredKinds = uniqueStrings(criteria.recordKinds).map((entry) => entry.toLowerCase());
  if (requiredKinds.length > 0 && !requiredKinds.includes(String(record.kind ?? "").toLowerCase())) {
    return false;
  }

  const expectedObjectiveFingerprint = normalizeString(criteria.objectiveFingerprint);
  if (expectedObjectiveFingerprint && normalizeString(record.objective_fingerprint)) {
    if (record.objective_fingerprint !== expectedObjectiveFingerprint) {
      return false;
    }
  }

  const expectedTargetRepo = normalizeString(criteria.targetRepo);
  if (expectedTargetRepo && normalizeString(record.target_repo)) {
    if (record.target_repo !== expectedTargetRepo) {
      return false;
    }
  }

  const expectedSubjectLocator = normalizeString(criteria.subjectLocator);
  if (expectedSubjectLocator && normalizeString(record.subject_locator)) {
    if (
      !gateSelectorMatches(record.subject_locator, expectedSubjectLocator)
      && !gateSelectorMatches(expectedSubjectLocator, record.subject_locator)
    ) {
      return false;
    }
  }

  const requiredAppliesTo = uniqueStrings(criteria.appliesTo);
  const declaredAppliesTo = uniqueStrings(record.applies_to);
  if (requiredAppliesTo.length > 0 && declaredAppliesTo.length > 0) {
    const hasOverlap = declaredAppliesTo.some((declared) =>
      requiredAppliesTo.some((required) =>
        gateSelectorMatches(declared, required) || gateSelectorMatches(required, declared)
      )
    );
    if (!hasOverlap) {
      return false;
    }
  }

  const requiredLabels = uniqueStrings(criteria.labels);
  const declaredLabels = uniqueStrings(record.labels);
  if (requiredLabels.length > 0 && declaredLabels.length > 0) {
    const hasSharedLabel = declaredLabels.some((label) => requiredLabels.includes(label));
    if (!hasSharedLabel) {
      return false;
    }
  }

  return true;
}

export function threadTeachingRecordStatus(record, { now, supersededIds = new Set() } = {}) {
  if (supersededIds.has(record?.record_id)) {
    return "superseded";
  }
  if (isExpiredThreadTeachingRecord(record, now)) {
    return "expired";
  }
  return "active";
}

export function isExpiredThreadTeachingRecord(record, now) {
  const expiresAfter = normalizeString(record?.expires_after);
  if (!expiresAfter) {
    return false;
  }
  const expiresAtMs = Date.parse(expiresAfter);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  const nowMs = now ? Date.parse(now) : Date.now();
  if (!Number.isFinite(nowMs)) {
    return false;
  }
  return nowMs > expiresAtMs;
}

export function buildGateAuthorizations(records = []) {
  const authorizations = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (!GATE_AUTHORIZING_KINDS.has(record?.kind)) {
      continue;
    }
    for (const selector of uniqueStrings(record.applies_to)) {
      authorizations.push(normalizeGateAuthorization({
        selector,
        decision: "allow",
        reason: record.summary,
        record_id: record.record_id,
        kind: record.kind,
        source_type: record.source_type,
        source_url: record.source_url,
        recorded_by: record.recorded_by,
        recorded_at: record.recorded_at,
      }));
    }
    for (const decision of uniqueDecisions(record.decisions)) {
      authorizations.push(normalizeGateAuthorization({
        selector: decision.gate_id,
        decision: decision.decision,
        reason: decision.reason ?? record.summary,
        record_id: record.record_id,
        kind: record.kind,
        source_type: record.source_type,
        source_url: record.source_url,
        recorded_by: record.recorded_by,
        recorded_at: record.recorded_at,
      }));
    }
  }
  return authorizations.filter(Boolean);
}

export function normalizeGateAuthorization(value) {
  const selector = normalizeString(value?.selector) || normalizeString(value?.gate_id);
  const decision = normalizeDecision(value?.decision);
  if (!selector || !decision) {
    return null;
  }
  return {
    selector,
    decision,
    reason: normalizeString(value?.reason),
    record_id: normalizeString(value?.record_id),
    kind: normalizeThreadTeachingKind(value?.kind),
    source_type: normalizeString(value?.source_type),
    source_url: normalizeString(value?.source_url),
    recorded_by: normalizeString(value?.recorded_by),
    recorded_at: normalizeString(value?.recorded_at),
  };
}

export function threadTeachingContextAllowsGate(context, gate) {
  const gateId = normalizeString(typeof gate === "string" ? gate : gate?.id);
  if (!gateId) {
    return false;
  }
  const authorizations = Array.isArray(context?.gate_authorizations)
    ? context.gate_authorizations.map((entry) => normalizeGateAuthorization(entry)).filter(Boolean)
    : buildGateAuthorizations(context?.records ?? []);
  for (const authorization of authorizations) {
    if (!gateSelectorMatches(authorization.selector, gateId)) {
      continue;
    }
    return authorization.decision === "allow";
  }
  return false;
}

export function buildThreadTeachingRow({
  repo,
  thread,
  threadKind,
  threadNumber,
  threadTitle,
  threadUrl,
  threadState,
  record,
  status,
  generatedAt,
}) {
  return {
    kind: "runx.aster-thread-teaching-row.v1",
    generated_at: generatedAt,
    repo,
    thread,
    thread_kind: threadKind,
    thread_number: Number(threadNumber),
    thread_title: threadTitle ?? null,
    thread_url: threadUrl ?? null,
    thread_state: threadState ?? null,
    record_id: record.record_id,
    record_kind: record.kind,
    status,
    recorded_at: record.recorded_at ?? null,
    recorded_by: record.recorded_by ?? null,
    source_type: record.source_type ?? null,
    source_url: record.source_url ?? null,
    target_repo: record.target_repo ?? null,
    subject_locator: record.subject_locator ?? null,
    objective_fingerprint: record.objective_fingerprint ?? null,
    summary: record.summary,
    applies_to: record.applies_to ?? [],
    labels: record.labels ?? [],
    invariants: record.invariants ?? [],
    notes: record.notes ?? [],
    decisions: (record.decisions ?? []).map((decision) => ({
      gate_id: decision.gate_id,
      decision: decision.decision,
      reason: decision.reason ?? null,
    })),
    supersedes: record.supersedes ?? [],
  };
}

export function loadIssueThreadEntries(options) {
  const issue = readGithubJson([
    "api",
    `repos/${options.repo}/issues/${options.issue}`,
  ]);
  const comments = readGithubPaginatedJson([
    `repos/${options.repo}/issues/${options.issue}/comments?per_page=100`,
  ]);
  return [
    {
      source_type: "issue_body",
      author: issue.user?.login,
      author_association: issue.author_association,
      body: issue.body,
      url: issue.html_url,
      created_at: issue.created_at,
    },
    ...comments.map((comment) => ({
      source_type: "issue_comment",
      author: comment.user?.login,
      author_association: comment.author_association,
      body: comment.body,
      url: comment.html_url,
      created_at: comment.created_at,
    })),
  ];
}

export function loadPullRequestThreadEntries(options) {
  const prIssue = readGithubJson([
    "api",
    `repos/${options.repo}/issues/${options.pr}`,
  ]);
  const issueComments = readGithubPaginatedJson([
    `repos/${options.repo}/issues/${options.pr}/comments?per_page=100`,
  ]);
  const reviews = readGithubPaginatedJson([
    `repos/${options.repo}/pulls/${options.pr}/reviews?per_page=100`,
  ]);
  const reviewComments = readGithubPaginatedJson([
    `repos/${options.repo}/pulls/${options.pr}/comments?per_page=100`,
  ]);
  return [
    {
      source_type: "pull_request_body",
      author: prIssue.user?.login,
      author_association: prIssue.author_association,
      body: prIssue.body,
      url: prIssue.html_url,
      created_at: prIssue.created_at,
    },
    ...issueComments.map((comment) => ({
      source_type: "issue_comment",
      author: comment.user?.login,
      author_association: comment.author_association,
      body: comment.body,
      url: comment.html_url,
      created_at: comment.created_at,
    })),
    ...reviews.map((review) => ({
      source_type: "pull_request_review",
      author: review.user?.login,
      author_association: review.author_association,
      body: review.body,
      url: review.html_url,
      created_at: review.submitted_at ?? review.submittedAt ?? review.created_at,
    })),
    ...reviewComments.map((comment) => ({
      source_type: "pull_request_review_comment",
      author: comment.user?.login,
      author_association: comment.author_association,
      body: comment.body,
      url: comment.html_url,
      created_at: comment.created_at,
    })),
  ];
}

export function mergeThreadTeachingThreadHits(...collections) {
  const deduped = new Map();
  for (const collection of collections) {
    for (const thread of Array.isArray(collection) ? collection : []) {
      const kind = thread.kind === "pr" ? "pr" : "issue";
      const key = `${kind}:${thread.number}`;
      const existing = deduped.get(key);
      if (!existing || Date.parse(String(thread.updatedAt ?? "")) > Date.parse(String(existing.updatedAt ?? ""))) {
        deduped.set(key, {
          kind,
          number: Number(thread.number),
          title: thread.title ?? null,
          url: thread.url ?? null,
          state: thread.state ?? null,
          updatedAt: thread.updatedAt ?? null,
        });
      }
    }
  }
  return [...deduped.values()].sort(
    (left, right) => Date.parse(String(right.updatedAt ?? "")) - Date.parse(String(left.updatedAt ?? "")),
  );
}

function collectSupersededRecordIds(records = [], now) {
  const supersededIds = new Set();
  for (const record of records) {
    if (record.kind !== "memory_correction" || threadTeachingRecordStatus(record, { now }) !== "active") {
      continue;
    }
    for (const recordId of record.supersedes ?? []) {
      supersededIds.add(recordId);
    }
  }
  return supersededIds;
}

function serializeThreadTeachingCriteria(criteria = {}) {
  return {
    record_kinds: uniqueStrings(criteria.recordKinds),
    target_repo: normalizeString(criteria.targetRepo),
    subject_locator: normalizeString(criteria.subjectLocator),
    objective_fingerprint: normalizeString(criteria.objectiveFingerprint),
    applies_to: uniqueStrings(criteria.appliesTo),
    labels: uniqueStrings(criteria.labels),
  };
}

function buildThreadTeachingRecordId(record, metadata) {
  const kind = slugifyToken(record?.kind ?? metadata?.source_type ?? "record");
  const repo = slugifyToken(metadata?.repo ?? "repo");
  const threadKind = slugifyToken(metadata?.thread_kind ?? "thread");
  const threadNumber = slugifyToken(metadata?.thread_number ?? "0");
  const createdAt = slugifyToken(metadata?.created_at ?? "unknown");
  return [repo, threadKind, threadNumber, kind, createdAt].filter(Boolean).join("-");
}

function extractThreadTeachingRecordContent(body) {
  const markerIndex = body.indexOf(THREAD_TEACHING_MARKER);
  if (markerIndex !== -1) {
    return body.slice(markerIndex + THREAD_TEACHING_MARKER.length);
  }
  if (!looksLikeImplicitThreadTeachingRecord(body)) {
    return null;
  }
  return body;
}

function looksLikeImplicitThreadTeachingRecord(body) {
  return String(body ?? "").split(/\r?\n/).some((rawLine) => {
    const line = normalizeThreadTeachingLine(rawLine);
    return Boolean(
      line
      && /^(kind|summary|recorded by|target repo|subject locator|objective fingerprint|expires after|supersedes|applies(?:\s|-)?to|label|labels|note|notes|invariant|invariants|decision|decisions):/i.test(line),
    );
  });
}

function normalizeThreadTeachingLine(rawLine) {
  return String(rawLine ?? "")
    .replace(/^\s*>\s?/, "")
    .trim();
}

function parseDecisionEntry(value) {
  const match = String(value ?? "").trim().match(/^([^:=]+?)\s*(?:=|:)\s*(allow|deny)(?:\s*(?:\||-)\s*(.+))?$/i);
  if (!match) {
    return null;
  }
  return {
    gate_id: normalizeString(match[1]),
    decision: normalizeDecision(match[2]),
    reason: normalizeString(match[3]),
  };
}

function normalizeThreadTeachingKind(value) {
  const normalized = normalizeString(value)?.toLowerCase() ?? null;
  return THREAD_TEACHING_KINDS.has(normalized) ? normalized : null;
}

function inferImplicitThreadTeachingKind({ appliesTo = [], decisions = [] } = {}) {
  const selectors = uniqueStrings([
    ...appliesTo,
    ...decisions.map((decision) => decision.gate_id),
  ]);
  if (selectors.length === 0) {
    return null;
  }
  return selectors.some((selector) => /\bpublish\b/i.test(selector))
    ? "publish_authorization"
    : "approval";
}

function inferImplicitThreadTeachingSummary({ kind, appliesTo = [], decisions = [] } = {}) {
  const selectors = uniqueStrings([
    ...appliesTo,
    ...decisions.map((decision) => decision.gate_id),
  ]);
  if (decisions.length > 0) {
    const fragments = decisions.map((decision) => `${decision.gate_id}=${decision.decision}`).join(", ");
    if (kind === "publish_authorization") {
      return `Trusted thread reply authorized ${fragments}.`;
    }
    return `Trusted thread reply recorded ${fragments}.`;
  }
  if (selectors.length > 0) {
    if (kind === "publish_authorization") {
      return `Trusted thread reply scoped publish authorization to ${selectors.join(", ")}.`;
    }
    return `Trusted thread reply scoped approval to ${selectors.join(", ")}.`;
  }
  return null;
}

function normalizeDecision(value) {
  const normalized = normalizeString(value)?.toLowerCase() ?? null;
  return ["allow", "deny"].includes(normalized) ? normalized : null;
}

function normalizeThreadEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  return {
    source_type: normalizeString(entry.source_type),
    author: normalizeString(entry.author),
    author_association: normalizeString(entry.author_association),
    body: typeof entry.body === "string" ? entry.body : "",
    url: normalizeString(entry.url),
    created_at: normalizeString(entry.created_at),
  };
}

function readGithubJson(args) {
  return JSON.parse(
    execFileSync("gh", args, {
      encoding: "utf8",
    }),
  );
}

function readGithubPaginatedJson(args) {
  const pages = JSON.parse(
    execFileSync("gh", ["api", "--paginate", "--slurp", ...args], {
      encoding: "utf8",
    }),
  );
  if (!Array.isArray(pages)) {
    return [];
  }
  return pages.flatMap((page) => Array.isArray(page) ? page : [page]);
}

export function gateSelectorMatches(selector, gateId) {
  const normalizedSelector = normalizeString(selector);
  const normalizedGateId = normalizeString(gateId);
  if (!normalizedSelector || !normalizedGateId) {
    return false;
  }
  if (normalizedSelector === normalizedGateId) {
    return true;
  }
  const escaped = normalizedSelector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(normalizedGateId);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function uniqueDecisions(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const gateId = normalizeString(value?.gate_id);
    const decision = normalizeDecision(value?.decision);
    if (!gateId || !decision) {
      continue;
    }
    const key = `${gateId}:${decision}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      gate_id: gateId,
      decision,
      reason: normalizeString(value?.reason),
    });
  }
  return result;
}

function splitCsvList(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function slugifyToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
