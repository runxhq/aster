import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const artifactDir = path.resolve(process.argv[2] ?? ".artifacts/proving-ground");
const entries = (await readdir(artifactDir))
  .filter((entry) => entry.endsWith(".json"))
  .sort();

const reports = [];

for (const entry of entries) {
  const payload = JSON.parse(await readFile(path.join(artifactDir, entry), "utf8"));
  const name = entry.replace(/\.json$/, "");
  const requests = Array.isArray(payload.requests) ? payload.requests : [];
  reports.push({
    name,
    status: payload.status ?? "unknown",
    requestIds: requests.map((request) => request.id).filter((value) => typeof value === "string"),
    requestSkills: requests
      .map((request) =>
        request?.kind === "cognitive_work" && typeof request.work?.envelope?.skill === "string"
          ? request.work.envelope.skill
          : undefined,
      )
      .filter((value) => typeof value === "string"),
    currentContext: requests
      .flatMap((request) =>
        request?.kind === "cognitive_work" && Array.isArray(request.work?.envelope?.current_context)
          ? request.work.envelope.current_context.map((artifact) => artifact.type).filter((value) => typeof value === "string")
          : [],
      ),
  });
}

const statusCounts = new Map();
for (const report of reports) {
  statusCounts.set(report.status, (statusCounts.get(report.status) ?? 0) + 1);
}

const lines = [
  "# Aster Proving Ground Summary",
  "",
  `- Generated: ${new Date().toISOString()}`,
  `- Artifact dir: \`${artifactDir}\``,
  `- Runs: ${reports.length}`,
  `- Status counts: ${Array.from(statusCounts.entries()).map(([status, count]) => `${status}=${count}`).join(", ")}`,
  "",
];

for (const report of reports) {
  lines.push(`## ${report.name}`);
  lines.push("");
  lines.push(`- status: \`${report.status}\``);
  if (report.requestIds.length > 0) {
    lines.push(`- requests: ${report.requestIds.map((value) => `\`${value}\``).join(", ")}`);
  }
  if (report.requestSkills.length > 0) {
    lines.push(`- boundary skills: ${report.requestSkills.map((value) => `\`${value}\``).join(", ")}`);
  }
  if (report.currentContext.length > 0) {
    lines.push(`- current context: ${report.currentContext.map((value) => `\`${value}\``).join(", ")}`);
  }
  lines.push("");
}

process.stdout.write(lines.join("\n"));
