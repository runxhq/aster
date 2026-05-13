import { readFile, writeFile } from "node:fs/promises";

import {
  collectWorkerValidationIssues,
  isPrereleaseEligibleTargetRepo,
  loadVerificationProfileCatalogSync,
  normalizeWorkspaceChangePlanRequest as validateWorkspaceChangePlanRequest,
} from "./aster-v1-contracts.mjs";

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = JSON.parse(await readFile(options.input, "utf8"));
  const output = prepareIssueTriageDecision(report, options);

  if (options.output) {
    await writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  }
}

export function prepareIssueTriageDecision(report, options = {}) {
  const triage = extractTriageReport(report);
  const changeSet = extractChangeSet(report);
  const defaultRepo = firstString(options.defaultRepo);
  const verificationCatalog = loadVerificationProfileCatalogSync(options.repoRoot);
  const recommendedLane = firstString(triage.recommended_lane) ?? "manual-triage";
  const commenceDecision = normalizeEnum(
    triage.commence_decision,
    triage.needs_human ? "needs_human" : "approve",
    ["approve", "hold", "reject", "needs_human"],
  );
  const actionDecision = normalizeEnum(
    triage.action_decision,
    defaultActionDecision({ commenceDecision, recommendedLane }),
    ["proceed_to_build", "proceed_to_plan", "request_review", "stop"],
  );
  const reviewTarget = normalizeEnum(
    triage.review_target,
    actionDecision === "request_review" ? "thread" : "none",
    ["thread", "outbox_entry", "issue", "draft_pr", "none"],
  );
  const boundaryNotes = [];
  const rawWorkspaceChangePlanRequest = collectWorkspaceChangePlanRequest(triage, changeSet);
  let workspaceChangePlanRequest;
  if (rawWorkspaceChangePlanRequest) {
    try {
      workspaceChangePlanRequest = validateWorkspaceChangePlanRequest(rawWorkspaceChangePlanRequest, {
        targetRepo: defaultRepo,
      });
    } catch (error) {
      boundaryNotes.push(error.message);
    }
  }
  const proposedWorkerRequests = collectProposedWorkerRequests(triage, changeSet);
  const workerValidation = collectWorkerValidationIssues(proposedWorkerRequests, {
    defaultRepo,
    catalog: verificationCatalog,
  });
  boundaryNotes.push(...workerValidation.issues);
  if (
    actionDecision === "proceed_to_plan"
    && defaultRepo
    && !isPrereleaseEligibleTargetRepo(defaultRepo)
  ) {
    boundaryNotes.push(`target repo '${defaultRepo}' is outside prerelease v1 scope; planning stays comment-only.`);
  }
  const shouldStartPlanner =
    commenceDecision === "approve"
    && actionDecision === "proceed_to_plan"
    && boundaryNotes.length === 0
    && Boolean(workspaceChangePlanRequest);
  const shouldStartWorker =
    commenceDecision === "approve"
    && actionDecision === "proceed_to_build"
    && workerValidation.issues.length === 0
    && workerValidation.accepted.length > 0;
  const workerRequests = shouldStartWorker ? workerValidation.accepted : [];
  const commentTarget = resolveCommentTarget(reviewTarget);
  const commentBody = buildTriageComment({
    triage,
    commenceDecision,
    actionDecision,
    recommendedLane,
    reviewTarget,
    commentTarget,
    shouldStartPlanner,
    workerCount: workerRequests.length,
    boundaryNotes,
  });

  return {
    mode: workerRequests.length > 0 ? "issue-to-pr" : shouldStartPlanner ? "plan" : "comment",
    triage_report: triage,
    change_set: changeSet,
    workspace_change_plan_request: workspaceChangePlanRequest,
    issue_to_pr_request: workerRequests[0]?.issue_to_pr_request,
    comment_body: commentBody,
    triage_decision: {
      commence_decision: commenceDecision,
      action_decision: actionDecision,
      recommended_lane: recommendedLane,
      review_target: reviewTarget,
      comment_target: commentTarget,
      should_post_comment: commentBody.length > 0,
      should_start_planner: shouldStartPlanner,
      should_start_worker: workerRequests.length > 0,
      workspace_change_plan_request: workspaceChangePlanRequest,
      worker_requests: workerRequests,
    },
  };
}

export function buildTriageComment({
  triage,
  commenceDecision,
  actionDecision,
  recommendedLane,
  reviewTarget,
  commentTarget,
  shouldStartPlanner = false,
  workerCount = 0,
  boundaryNotes = [],
}) {
  const lines = [
    "## runx issue triage",
    "",
    `- Commence: \`${commenceDecision}\``,
    `- Next lane: \`${recommendedLane}\``,
    `- Action: \`${actionDecision}\``,
  ];

  if (reviewTarget !== "none") {
    lines.push(`- Review target: \`${reviewTarget}\``);
  }
  if (commentTarget !== "none" && commentTarget !== reviewTarget) {
    lines.push(`- Comment surface: \`${commentTarget}\``);
    lines.push("- No draft PR exists yet, and no publishable outbox entry exists, so the triage comment is posted on the issue first.");
  }
  if (workerCount > 0) {
    lines.push(`- Worker fanout: \`${workerCount}\``);
  }
  if (shouldStartPlanner) {
    lines.push("- Planning lane: `work-plan`");
  }

  const narrative = firstString(
    actionDecision === "request_review" ? triage.review_comment : undefined,
  )
    ?? firstString(triage.suggested_reply)
    ?? firstString(triage.review_comment)
    ?? `runx classified this request as ${recommendedLane} and did not open a worker yet.`;

  lines.push("");
  lines.push(narrative);

  const rationale = firstString(triage.rationale);
  if (rationale) {
    lines.push("");
    lines.push(`Rationale: ${rationale}`);
  }

  const operatorNotes = Array.isArray(triage.operator_notes)
    ? triage.operator_notes.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];
  if (operatorNotes.length > 0) {
    lines.push("");
    lines.push("Operator notes:");
    for (const note of operatorNotes) {
      lines.push(`- ${note.trim()}`);
    }
  }

  if (boundaryNotes.length > 0) {
    lines.push("");
    lines.push("Boundary notes:");
    for (const note of boundaryNotes) {
      lines.push(`- ${note}`);
    }
  }

  lines.push("");
  lines.push("Reply in this issue with corrections, scope changes, or explicit teaching notes to rerun the same work ledger.");

  return lines.join("\n").trim();
}

function extractTriageReport(report) {
  if (asRecord(report)?.triage_report) {
    return asRecord(report.triage_report) ?? {};
  }
  const payload = extractExecutionPayload(report);
  if (payload && payload.triage_report) {
    return asRecord(payload.triage_report) ?? {};
  }
  return {};
}

function extractChangeSet(report) {
  if (asRecord(report)?.change_set) {
    return asRecord(report.change_set);
  }
  const payload = extractExecutionPayload(report);
  if (payload && payload.change_set) {
    return asRecord(payload.change_set);
  }
  return undefined;
}

function extractExecutionPayload(report) {
  const stdout = firstString(asRecord(report)?.execution?.stdout);
  if (!stdout) {
    return undefined;
  }
  try {
    return asRecord(JSON.parse(stdout));
  } catch {
    return undefined;
  }
}

function defaultActionDecision({ commenceDecision, recommendedLane }) {
  if (commenceDecision !== "approve") {
    return "stop";
  }
  if (recommendedLane === "work-plan") {
    return "proceed_to_plan";
  }
  if (recommendedLane === "issue-to-pr" || recommendedLane === "multi-repo-issue-to-pr") {
    return "proceed_to_build";
  }
  if (recommendedLane === "reply-only") {
    return "stop";
  }
  return "request_review";
}

function resolveCommentTarget(reviewTarget) {
  if (reviewTarget === "thread" || reviewTarget === "issue") {
    return "issue";
  }
  if (reviewTarget === "outbox_entry" || reviewTarget === "draft_pr") {
    return "issue";
  }
  return "none";
}

function collectProposedWorkerRequests(triage, changeSet) {
  const explicitRequests = Array.isArray(triage.worker_requests)
    ? triage.worker_requests
    : [];
  const normalizedExplicit = explicitRequests
    .map(normalizeWorkerRequest)
    .filter(Boolean);
  if (normalizedExplicit.length > 0) {
    return normalizedExplicit;
  }

  const issueToPrRequests = Array.isArray(triage.issue_to_pr_requests)
    ? triage.issue_to_pr_requests
    : [];
  const normalizedIssueToPr = issueToPrRequests
    .map((request) => normalizeWorkerRequest({ worker: "issue-to-pr", issue_to_pr_request: request }))
    .filter(Boolean);
  if (normalizedIssueToPr.length > 0) {
    return normalizedIssueToPr;
  }

  const singleRequest = asRecord(triage.issue_to_pr_request);
  if (singleRequest) {
    return [
      {
        worker: "issue-to-pr",
        issue_to_pr_request: singleRequest,
      },
    ];
  }

  const threadChangeRequest = asRecord(triage.thread_change_request);
  if (threadChangeRequest) {
    return [
      {
        worker: "issue-to-pr",
        issue_to_pr_request: coerceThreadChangeRequest(threadChangeRequest, changeSet),
      },
    ];
  }

  const derived = buildFallbackIssueToPrRequest(triage, changeSet);
  if (derived) {
    return [
      {
        worker: "issue-to-pr",
        issue_to_pr_request: derived,
      },
    ];
  }

  return [];
}

function buildFallbackIssueToPrRequest(triage, changeSet) {
  const recommendedLane = firstString(triage?.recommended_lane);
  if (recommendedLane !== "issue-to-pr" && recommendedLane !== "multi-repo-issue-to-pr") {
    return undefined;
  }

  const source = asRecord(changeSet?.source);
  const sourceId = firstString(source?.id);
  const issueTitle = firstString(triage?.summary) ?? firstString(changeSet?.summary);
  if (!sourceId || !issueTitle) {
    return undefined;
  }

  return {
    task_id: `issue-${sourceId}`,
    issue_title: issueTitle,
    source: firstString(source?.type) ?? "github_issue",
    source_id: sourceId,
    source_url: firstString(source?.url),
  };
}

function coerceThreadChangeRequest(request, changeSet) {
  const source = asRecord(changeSet?.source);
  const threadLocator = firstString(request.thread_locator) ?? firstString(changeSet?.thread_locator);
  const sourceId = firstString(source?.id)
    ?? issueNumberFromThreadLocator(threadLocator)
    ?? firstString(request.task_id)
    ?? firstString(changeSet?.change_set_id)
    ?? "thread";
  return pruneUndefined({
    task_id: firstString(request.task_id) ?? `issue-${sourceId}`,
    issue_title: firstString(request.thread_title) ?? firstString(changeSet?.summary) ?? "Thread change request",
    issue_body: firstString(request.thread_body) ?? "",
    source: firstString(source?.type) ?? "github_issue",
    source_id: sourceId,
    source_url: firstString(source?.url) ?? githubIssueUrlFromThreadLocator(threadLocator),
    target_repo: firstString(request.target_repo),
    size: firstString(request.size),
    risk: firstString(request.risk),
  });
}

function issueNumberFromThreadLocator(value) {
  const locator = firstString(value);
  if (!locator) {
    return undefined;
  }
  const githubMatch = locator.match(/^github:\/\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/(\d+)$/i);
  return githubMatch ? githubMatch[1] : undefined;
}

function githubIssueUrlFromThreadLocator(value) {
  const locator = firstString(value);
  if (!locator) {
    return undefined;
  }
  const githubMatch = locator.match(/^github:\/\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/(\d+)$/i);
  return githubMatch ? `https://github.com/${githubMatch[1]}/issues/${githubMatch[2]}` : undefined;
}

function collectWorkspaceChangePlanRequest(triage, changeSet) {
  const explicit = asRecord(triage.workspace_change_plan_request);
  if (explicit) {
    return coerceWorkspaceChangePlanRequest(explicit, changeSet);
  }

  const compatibility = asRecord(triage.objective_request);
  if (!compatibility) {
    return undefined;
  }

  return coerceWorkspaceChangePlanRequest(
    {
      change_set_id: firstString(changeSet?.change_set_id),
      objective: firstString(compatibility.objective),
      project_context: firstString(compatibility.project_context),
      target_surfaces: Array.isArray(changeSet?.target_surfaces) ? changeSet.target_surfaces : undefined,
      shared_invariants: Array.isArray(changeSet?.shared_invariants) ? changeSet.shared_invariants : undefined,
      success_criteria: Array.isArray(changeSet?.success_criteria) ? changeSet.success_criteria : undefined,
    },
    changeSet,
  );
}

function coerceWorkspaceChangePlanRequest(value, changeSet) {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    change_set_id: firstString(record.change_set_id) ?? firstString(changeSet?.change_set_id),
    objective: firstString(record.objective),
    project_context: firstString(record.project_context),
    target_surfaces: Array.isArray(record.target_surfaces)
      ? record.target_surfaces
      : Array.isArray(changeSet?.target_surfaces)
        ? changeSet.target_surfaces
        : [],
    shared_invariants: Array.isArray(record.shared_invariants)
      ? record.shared_invariants
      : Array.isArray(changeSet?.shared_invariants)
        ? changeSet.shared_invariants
        : [],
    success_criteria: Array.isArray(record.success_criteria)
      ? record.success_criteria
      : Array.isArray(changeSet?.success_criteria)
        ? changeSet.success_criteria
        : [],
  };
}

function normalizeWorkerRequest(value) {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const issueToPrRequest = asRecord(record.issue_to_pr_request);
  if (issueToPrRequest) {
    return {
      worker: firstString(record.worker) ?? "issue-to-pr",
      issue_to_pr_request: issueToPrRequest,
    };
  }
  if (firstString(record.worker) === "issue-to-pr" && asRecord(record.request)) {
    return {
      worker: "issue-to-pr",
      issue_to_pr_request: asRecord(record.request),
    };
  }
  return undefined;
}

function normalizeEnum(value, fallback, allowed) {
  const candidate = firstString(value);
  return candidate && allowed.includes(candidate) ? candidate : fallback;
}

function pruneUndefined(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      options.input = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--default-repo") {
      options.defaultRepo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--repo-root") {
      options.repoRoot = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.input) {
    throw new Error("--input is required.");
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

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
