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
  const harness = payload.harness && typeof payload.harness === "object" ? payload.harness : {};
  const seal = payload.seal && typeof payload.seal === "object" ? payload.seal : {};
  reports.push({
    name,
    schema: typeof payload.schema === "string" ? payload.schema : "unknown",
    status: typeof harness.state === "string" ? harness.state : "unknown",
    disposition: typeof seal.disposition === "string" ? seal.disposition : "unknown",
    receiptId: typeof payload.id === "string" ? payload.id : null,
    harnessId: typeof harness.harness_id === "string" ? harness.harness_id : null,
    acts: Array.isArray(harness.acts)
      ? harness.acts.map((act) => act?.act_id).filter((value) => typeof value === "string")
      : [],
    childReceipts: Array.isArray(harness.child_harness_receipt_refs)
      ? harness.child_harness_receipt_refs.map((ref) => ref?.uri).filter((value) => typeof value === "string")
      : [],
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
  lines.push(`- schema: \`${report.schema}\``);
  lines.push(`- status: \`${report.status}\``);
  lines.push(`- disposition: \`${report.disposition}\``);
  if (report.receiptId) {
    lines.push(`- harness receipt: \`${report.receiptId}\``);
  }
  if (report.harnessId) {
    lines.push(`- harness: \`${report.harnessId}\``);
  }
  if (report.acts.length > 0) {
    lines.push(`- acts: ${report.acts.map((value) => `\`${value}\``).join(", ")}`);
  }
  if (report.childReceipts.length > 0) {
    lines.push(`- child receipts: ${report.childReceipts.map((value) => `\`${value}\``).join(", ")}`);
  }
  lines.push("");
}

process.stdout.write(lines.join("\n"));
