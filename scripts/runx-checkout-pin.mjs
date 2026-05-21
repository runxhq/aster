import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PIN_PATH = "state/runx-oss-pin.json";
const DEFAULT_REPOSITORY = "runxhq/runx";
const FULL_SHA_RE = /^[0-9a-f]{40}$/iu;

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const options = parseArgs(argv.slice(1));

  if (command === "resolve") {
    const resolved = await resolveRunxCheckout({
      pinPath: options.pinFile ?? DEFAULT_PIN_PATH,
      env: process.env,
    });
    writeGithubOutputs(resolved);
    process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
    return;
  }

  if (command === "assert") {
    const checkoutPath = requireOption(options.checkoutPath, "--checkout-path");
    const expectedHead = options.expectedHead ?? "";
    const expectedRef = options.expectedRef ?? "";
    const actualHead = readGitHead(checkoutPath);
    assertRunxCheckoutHead({ actualHead, expectedHead, expectedRef, checkoutPath });
    process.stdout.write(`runx checkout ${checkoutPath} is at ${actualHead}\n`);
    return;
  }

  throw new Error("usage: scripts/runx-checkout-pin.mjs <resolve|assert>");
}

export async function resolveRunxCheckout({
  pinPath = DEFAULT_PIN_PATH,
  env = process.env,
} = {}) {
  const pin = await loadPin(pinPath);
  const envRepository = normalizeOptional(env.RUNX_REPOSITORY);
  const envRef = normalizeOptional(env.RUNX_REF);
  const repository = normalizeRequired(envRepository ?? pin.repository ?? DEFAULT_REPOSITORY, "runx repository");
  const ref = normalizeRequired(envRef ?? pin.ref, "runx ref");
  assertFullSha(ref, "runx ref");
  const expectedHead = resolveExpectedHead({
    ref,
    expectedHead: envRef ? env.RUNX_EXPECTED_HEAD : pin.expected_head,
  });

  return {
    repository,
    ref,
    expected_head: expectedHead,
    ref_source: envRef ? "RUNX_REF" : pinPath,
    pin_path: pinPath,
  };
}

export function resolveExpectedHead({ ref, expectedHead }) {
  const normalizedExpectedHead = normalizeOptional(expectedHead);
  if (normalizedExpectedHead) {
    assertFullSha(normalizedExpectedHead, "expected_head");
    return normalizedExpectedHead.toLowerCase();
  }
  const normalizedRef = normalizeOptional(ref);
  if (normalizedRef && FULL_SHA_RE.test(normalizedRef)) {
    return normalizedRef.toLowerCase();
  }
  return "";
}

export function assertRunxCheckoutHead({
  actualHead,
  expectedHead = "",
  expectedRef = "",
  checkoutPath = "runx checkout",
} = {}) {
  const normalizedActual = normalizeRequired(actualHead, "actual runx HEAD").toLowerCase();
  assertFullSha(normalizedActual, "actual runx HEAD");
  const normalizedExpected = resolveExpectedHead({ ref: expectedRef, expectedHead });
  if (normalizedExpected && normalizedActual !== normalizedExpected) {
    throw new Error(
      `runx checkout at ${checkoutPath} is ${normalizedActual}, expected ${normalizedExpected}.`,
    );
  }
}

async function loadPin(pinPath) {
  let raw;
  try {
    raw = await readFile(path.resolve(pinPath), "utf8");
  } catch (error) {
    throw new Error(`Unable to read runx checkout pin at ${pinPath}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid runx checkout pin JSON at ${pinPath}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Runx checkout pin at ${pinPath} must be a JSON object.`);
  }
  if (parsed.schema !== "runx.aster_runx_oss_pin.v1") {
    throw new Error(`Runx checkout pin at ${pinPath} must use schema runx.aster_runx_oss_pin.v1.`);
  }
  return parsed;
}

function writeGithubOutputs(outputs) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  appendFileSync(outputPath, `${lines.join("\n")}\n`);
}

function readGitHead(checkoutPath) {
  try {
    return execFileSync("git", ["-C", path.resolve(checkoutPath), "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(`Unable to read runx checkout HEAD at ${checkoutPath}: ${error.stderr || error.message}`);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--pin-file") {
      options.pinFile = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--checkout-path") {
      options.checkoutPath = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--expected-head") {
      options.expectedHead = requireMaybeEmptyValue(argv, ++index, token);
      continue;
    }
    if (token === "--expected-ref") {
      options.expectedRef = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
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

function requireMaybeEmptyValue(argv, index, flag) {
  if (index >= argv.length) {
    throw new Error(`${flag} requires a value.`);
  }
  return argv[index];
}

function requireOption(value, flag) {
  if (!value) {
    throw new Error(`${flag} is required.`);
  }
  return value;
}

function normalizeRequired(value, label) {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  if (/\s/u.test(normalized)) {
    throw new Error(`${label} must not contain whitespace.`);
  }
  return normalized;
}

function normalizeOptional(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function assertFullSha(value, label) {
  if (!FULL_SHA_RE.test(value)) {
    throw new Error(`${label} must be a 40-character git SHA.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
