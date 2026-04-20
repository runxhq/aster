import { DEMO_ASTER_FEED } from "./demo-activity.js";

const apiBaseUrl = (process.env.RUNX_PUBLIC_EVIDENCE_API_BASE_URL || "https://api.runx.ai").replace(/\/+$/, "");

export async function readActivityModel({ limit = 48 } = {}) {
  const feed = await readAsterFeed(limit);
  const mainFeed = [];
  const opsFeed = [];

  for (const item of feed) {
    if (feedChannelForItem(item) === "main") {
      mainFeed.push(normalizeFeedItem(item));
    } else {
      opsFeed.push(normalizeFeedItem(item));
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    mainFeed,
    opsFeed,
    liveCount: [...mainFeed, ...opsFeed].filter((item) => !item.isDemo).length,
    demoCount: [...mainFeed, ...opsFeed].filter((item) => item.isDemo).length,
    mode:
      [...mainFeed, ...opsFeed].length === 0
        ? "empty"
        : [...mainFeed, ...opsFeed].every((item) => item.isDemo)
          ? "demo"
          : [...mainFeed, ...opsFeed].some((item) => item.isDemo)
            ? "mixed"
            : "live",
  };
}

async function readAsterFeed(limit) {
  try {
    const response = await fetch(`${apiBaseUrl}/v1/feed?lane=aster&limit=${limit}`, {
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) {
      return DEMO_ASTER_FEED.slice(0, limit);
    }
    const payload = await response.json();
    const deduped = dedupeFeedItems(Array.isArray(payload.feed) ? payload.feed : []);
    return deduped.length > 0 ? deduped : DEMO_ASTER_FEED.slice(0, limit);
  } catch {
    return DEMO_ASTER_FEED.slice(0, limit);
  }
}

function dedupeFeedItems(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = [
      item.run_id ?? "",
      item.workflow ?? "",
      item.url ?? "",
      item.title ?? "",
      item.timestamp ?? "",
    ].join("::");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function normalizeFeedItem(item) {
  const metadata = recordMetadata(item.metadata);
  const workflow = stringMetadata(metadata, "workflow") ?? item.workflow ?? "aster";
  const channel = feedChannelForItem(item);
  const proofLane = stringMetadata(metadata, "lane") ?? workflow;
  const repo = normalizeAsterAlias(item.repo ?? stringMetadata(metadata, "target_repo") ?? item.target ?? "");
  const reference = item.receipt_id
    ? `/r/${item.receipt_id.slice(-8)}`
    : item.run_id
      ? `run ${item.run_id}`
      : repo || "public event";

  return {
    id: item.id ?? `${workflow}:${item.run_id ?? item.timestamp ?? item.title}`,
    title: normalizeAsterAlias(item.title ?? workflow),
    summary: normalizeAsterAlias(item.summary ?? `${workflow} finished with ${item.status ?? "unknown"}.`),
    status: feedStatus(item.status),
    workflow,
    channel,
    proofLane,
    repo,
    timestamp: formatTimestamp(item.timestamp),
    timestampIso: item.timestamp,
    url: normalizeAsterAlias(item.url) ?? null,
    reference,
    artifactUrl: normalizeAsterAlias(stringMetadata(metadata, "artifact_url")),
    commitShort: stringMetadata(metadata, "commit_short") ?? shortCommit(item.commit),
    failureReason: normalizeAsterAlias(stringMetadata(metadata, "failure_reason")),
    isDemo: booleanMetadata(metadata, "demo_seed"),
    demoLabel: normalizeAsterAlias(stringMetadata(metadata, "demo_label")),
    demoNotice: normalizeAsterAlias(stringMetadata(metadata, "demo_notice")),
    };
}

export function feedChannelForItem(item) {
  const metadata = recordMetadata(item.metadata);
  const declared = stringMetadata(metadata, "feed_channel");
  if (declared === "main" || declared === "ops") {
    return declared;
  }

  const workflow = (item.workflow ?? "").toLowerCase();
  if (["issue-triage", "docs-pr", "fix-pr", "skill-upstream", "merge-watch", "market-brief", "trust-audit", "rollback"].includes(workflow)
      && String(item.status ?? "").toLowerCase() === "success") {
    return "main";
  }
  return "ops";
}

function feedStatus(status) {
  const normalized = String(status ?? "").toLowerCase();
  if (["success", "completed", "merged", "published"].includes(normalized)) {
    return "ok";
  }
  if (["pending", "running", "queued", "waiting"].includes(normalized)) {
    return "partial";
  }
  return "fail";
}

function recordMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringMetadata(metadata, key) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function shortCommit(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 12) : null;
}

function booleanMetadata(metadata, key) {
  return metadata[key] === true;
}

function normalizeAsterAlias(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value ?? null;
  }
  return value;
}

function formatTimestamp(value) {
  const timestamp = Date.parse(String(value ?? ""));
  if (Number.isNaN(timestamp)) {
    return String(value ?? "");
  }
  return new Intl.DateTimeFormat("en-AU", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}
