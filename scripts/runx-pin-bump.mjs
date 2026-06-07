import { appendFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PIN_PATH = "state/runx-oss-pin.json";
const FULL_SHA_RE = /^[0-9a-f]{40}$/iu;

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    appendFileSync(outputPath, `${name}=${value}\n`);
  }
}

async function main() {
  const candidate = (process.argv[2] ?? "").trim().toLowerCase();
  if (!FULL_SHA_RE.test(candidate)) {
    throw new Error(`candidate ref must be a 40-character git SHA, got: ${candidate || "(empty)"}`);
  }

  const raw = await readFile(path.resolve(PIN_PATH), "utf8");
  const pin = JSON.parse(raw);
  const current = (pin.ref ?? "").toLowerCase();

  if (current === candidate) {
    process.stdout.write(`pin already at ${candidate}; nothing to bump\n`);
    setOutput("changed", "false");
    setOutput("current", current);
    return;
  }

  const updated = {
    ...pin,
    ref: candidate,
    expected_head: candidate,
    note: `Auto-bumped to runxhq/runx main HEAD ${candidate} (latest green ci.yml).`,
  };
  await writeFile(path.resolve(PIN_PATH), `${JSON.stringify(updated, null, 2)}\n`, "utf8");

  process.stdout.write(`bumped runx pin ${current || "(none)"} -> ${candidate}\n`);
  setOutput("changed", "true");
  setOutput("old", current);
  setOutput("new", candidate);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
