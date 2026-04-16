import { readFile, writeFile } from "node:fs/promises";

const options = parseArgs(process.argv.slice(2));
const report = JSON.parse(await readFile(options.input, "utf8"));
const payload = JSON.parse(report.execution.stdout);
const body =
  payload.response_draft?.body ??
  payload.publish_packet?.body;

if (!body) {
  throw new Error("Could not find response_draft.body or publish_packet.body in the run output.");
}

const comment = [
  "<!-- automaton:runx-issue-triage -->",
  body.trim(),
].join("\n\n");

if (options.output) {
  await writeFile(options.output, `${comment}\n`);
} else {
  process.stdout.write(`${comment}\n`);
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
