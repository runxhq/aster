import { createHash } from "node:crypto";

export const ISSUE_TRIAGE_MARKER = "<!-- aster:runx-issue-triage -->";

export function stripIssueTriageMarker(body) {
  return String(body ?? "")
    .split("\n")
    .filter((line, index, lines) => {
      if (line.trim() !== ISSUE_TRIAGE_MARKER) {
        return true;
      }
      return lines.slice(0, index).some((entry) => entry.trim().length > 0);
    })
    .join("\n")
    .trim();
}

export function buildIssueFingerprintLine(fingerprint) {
  return `Issue Fingerprint: ${fingerprint}`;
}

export function buildHeadShaLine(sha) {
  return `Head SHA: ${sha}`;
}

export function buildIssueTriageComment({ body, fingerprint, sha }) {
  const parts = [
    ISSUE_TRIAGE_MARKER,
    stripIssueTriageMarker(body),
  ].filter(Boolean);
  if (fingerprint) {
    parts.push(buildIssueFingerprintLine(fingerprint));
  }
  if (sha) {
    parts.push(buildHeadShaLine(sha));
  }
  return `${parts.join("\n\n").trim()}\n`;
}

export function parseIssueTriageCommentMetadata(body) {
  const text = String(body ?? "");
  const fingerprintMatch = text.match(/Issue Fingerprint:\s*([a-f0-9]{8,64})/i);
  const shaMatch = text.match(/Head SHA:\s*([a-f0-9]{7,64})/i);
  return {
    has_marker: text.includes(ISSUE_TRIAGE_MARKER),
    fingerprint: fingerprintMatch?.[1] ?? null,
    sha: shaMatch?.[1] ?? null,
  };
}

export function computeIssueFingerprint({ title, body }) {
  const hash = createHash("sha256");
  hash.update(String(title ?? "").trim());
  hash.update("\n---\n");
  hash.update(String(body ?? "").trim());
  return hash.digest("hex").slice(0, 16);
}
