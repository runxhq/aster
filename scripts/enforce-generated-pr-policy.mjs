import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { buildGeneratedPrPolicyPlan } from "./generated-pr-policy.mjs";

const defaultRunner = (command, args) => execFileSync(command, args, { encoding: "utf8" });
const policyCommentMarker = "<!-- aster:generated-pr-policy-enforced -->";

export async function enforceGeneratedPrPolicy(argv = process.argv.slice(2), runner = defaultRunner) {
  const options = parseArgs(argv);
  const report = JSON.parse(
    runner("gh", [
      "pr",
      "view",
      options.pr,
      "--repo",
      options.repo,
      "--json",
      "number,title,body,isDraft,headRefName,state,url",
    ]),
  );
  const plan = buildGeneratedPrPolicyPlan(report);

  if (plan.status === "noop" || plan.status === "compliant") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return plan;
  }

  if (plan.actions.includes("patch_body")) {
    runner("gh", [
      "pr",
      "edit",
      options.pr,
      "--repo",
      options.repo,
      "--body",
      plan.next_body,
    ]);
  }
  if (plan.actions.includes("convert_to_draft")) {
    runner("gh", [
      "pr",
      "ready",
      options.pr,
      "--repo",
      options.repo,
      "--undo",
    ]);
  }

  const comment = [
    policyCommentMarker,
    "Generated PR policy was enforced for this branch.",
    "",
    `- Lane: \`${plan.lane}\``,
    `- Actions: ${plan.actions.map((action) => `\`${action}\``).join(", ")}`,
  ].join("\n");
  runner("gh", [
    "pr",
    "comment",
    options.pr,
    "--repo",
    options.repo,
    "--body",
    comment,
  ]);

  const result = {
    ...plan,
    status: "enforced",
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--pr") {
      options.pr = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.repo || !options.pr) {
    throw new Error("--repo and --pr are required.");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await enforceGeneratedPrPolicy();
}
