import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runxRepoRoot = resolveRunxRepoRoot(options.runxRoot);
  const cliBin = path.join(runxRepoRoot, "packages", "cli", "dist", "index.js");
  const receiptDir = path.resolve(options.receiptDir ?? ".artifacts/runx-bridge");
  const traceDir = path.resolve(options.traceDir ?? path.join(receiptDir, "provider-trace"));
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "automaton-runx-bridge-"));
  const approvedGates = new Set([
    ...splitCsv(process.env.RUNX_APPROVED_GATES),
    ...options.approve,
  ]);
  const provider = options.provider ?? process.env.RUNX_CALLER_PROVIDER ?? "openai";
  const model = options.model ?? process.env.RUNX_CALLER_MODEL ?? "gpt-5.4";
  const reasoningEffort =
    options.reasoningEffort ?? process.env.RUNX_CALLER_REASONING_EFFORT ?? "xhigh";
  const maxTurns = Number(options.maxTurns ?? process.env.RUNX_CALLER_MAX_TURNS ?? "8");

  if (!existsSync(cliBin)) {
    throw new Error(`runx CLI build not found at ${cliBin}`);
  }
  if (options.runxArgs.length === 0) {
    throw new Error("No runx command was provided. Pass the runx invocation after --.");
  }

  await mkdir(receiptDir, { recursive: true });
  await mkdir(traceDir, { recursive: true });

  let runArgs = [...options.runxArgs];
  let latestStdout = "";
  let latestExitCode = 0;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const invocation = await runRunx({
      cliBin,
      receiptDir,
      runArgs,
      workdir: options.workdir,
    });

    latestStdout = invocation.stdout;
    latestExitCode = invocation.exitCode;

    if (!invocation.stdout.trim()) {
      throw new Error(invocation.stderr.trim() || "runx returned no JSON output.");
    }

    const report = JSON.parse(invocation.stdout);
    if (options.outputPath) {
      await writeFile(path.resolve(options.outputPath), JSON.stringify(report, null, 2));
    }

    if (report.status !== "needs_resolution") {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exit(latestExitCode);
    }

    const answers = {};
    const approvals = {};

    for (const request of report.requests ?? []) {
      if (request.kind === "approval") {
        const gateId = String(request.gate?.id ?? "");
        if (options.approveAll || approvedGates.has(gateId)) {
          approvals[gateId] = true;
          continue;
        }
        throw new Error(`Unapproved gate '${gateId}' encountered. Add --approve ${gateId} or set RUNX_APPROVED_GATES.`);
      }

      if (request.kind === "cognitive_work") {
        answers[request.id] = await resolveCognitiveWork({
          provider,
          model,
          reasoningEffort,
          request,
          traceDir,
        });
        continue;
      }

      throw new Error(`Unsupported runx resolution request kind: ${request.kind}`);
    }

    const answersPath = path.join(tempDir, `answers-turn-${turn + 1}.json`);
    await writeFile(
      answersPath,
      `${JSON.stringify(compactAnswersPayload(answers, approvals), null, 2)}\n`,
    );
    runArgs = ["resume", String(report.run_id), "--answers", answersPath];
  }

  throw new Error(`runx bridge exceeded ${maxTurns} turns without reaching completion.`);
}

function parseArgs(argv) {
  const options = {
    approve: [],
    runxArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      options.runxArgs = argv.slice(index + 1);
      break;
    }
    if (token === "--runx-root") {
      options.runxRoot = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--receipt-dir") {
      options.receiptDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--trace-dir") {
      options.traceDir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--workdir") {
      options.workdir = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.outputPath = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--model") {
      options.model = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--provider") {
      options.provider = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--max-turns") {
      options.maxTurns = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--reasoning-effort") {
      options.reasoningEffort = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--approve") {
      options.approve.push(requireValue(argv, ++index, token));
      continue;
    }
    if (token === "--approve-all") {
      options.approveAll = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.runxRoot) {
    throw new Error("--runx-root is required.");
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

function resolveRunxRepoRoot(runxRoot) {
  const directRoot = path.resolve(runxRoot);
  if (existsSync(path.join(directRoot, "packages", "cli", "dist", "index.js"))) {
    return directRoot;
  }
  const nestedRoot = path.join(directRoot, "oss");
  if (existsSync(path.join(nestedRoot, "packages", "cli", "dist", "index.js"))) {
    return nestedRoot;
  }
  throw new Error(
    `Unable to resolve runx repo root from ${runxRoot}. Expected packages/cli/dist/index.js or oss/packages/cli/dist/index.js.`,
  );
}

async function runRunx({ cliBin, receiptDir, runArgs, workdir }) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        cliBin,
        ...runArgs,
        "--non-interactive",
        "--json",
        "--receipt-dir",
        receiptDir,
      ],
      {
        cwd: workdir ? path.resolve(workdir) : process.cwd(),
        env: process.env,
        maxBuffer: 50 * 1024 * 1024,
      },
    );
    return {
      exitCode: 0,
      stdout,
      stderr,
    };
  } catch (error) {
    return {
      exitCode: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
    };
  }
}

async function resolveCognitiveWork({ provider, model, reasoningEffort, request, traceDir }) {
  if (provider !== "openai") {
    throw new Error(`Unsupported provider '${provider}'.`);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for runx cognitive work.");
  }

  const requestId = sanitizeTraceName(request.id);
  const expectedOutputs = request.work.envelope.expected_outputs ?? {};
  let previousFailure;
  let lastTransportError;
  const maxAttempts = Number(process.env.RUNX_CALLER_MAX_ATTEMPTS ?? "2");

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const payload = {
      model,
      input: buildInputMessages(request, expectedOutputs, previousFailure),
      reasoning: {
        effort: reasoningEffort,
      },
      text: {
        format: {
          type: "json_object",
        },
      },
    };

    let response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": `${requestId}-${attempt}`.slice(0, 128),
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      lastTransportError = error;
      await writeFile(
        path.join(traceDir, `${requestId}-attempt-${attempt}.json`),
        `${JSON.stringify(
          {
            request: payload,
            response: null,
            raw_response: null,
            transport_error: serializeError(error),
          },
          null,
          2,
        )}\n`,
      );
      if (attempt < maxAttempts && isRetryableTransportError(error)) {
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      throw error;
    }

    const raw = await response.text();
    const parsed = safeJsonParse(raw);

    await writeFile(
      path.join(traceDir, `${requestId}-attempt-${attempt}.json`),
      `${JSON.stringify({ request: payload, response: parsed, raw_response: raw }, null, 2)}\n`,
    );

    if (!response.ok) {
      throw new Error(
        `OpenAI request failed: ${response.status} ${response.statusText}\n${truncate(raw, 4000)}`,
      );
    }

    const outputText = extractOutputText(parsed);
    if (!outputText) {
      previousFailure = `The response did not include output_text. Raw response: ${truncate(raw, 1200)}`;
      continue;
    }

    const parsedOutput = safeJsonParse(outputText);
    if (!isPlainObject(parsedOutput)) {
      previousFailure = `The response was not a JSON object. Raw output text: ${truncate(outputText, 1200)}`;
      continue;
    }

    const validationError = validateResolution(parsedOutput, expectedOutputs);
    if (!validationError) {
      return parsedOutput;
    }

    previousFailure = validationError;
  }

  if (lastTransportError && !previousFailure) {
    throw lastTransportError;
  }

  throw new Error(
    `OpenAI response for ${request.id} did not satisfy the expected output contract after ${maxAttempts} attempts: ${previousFailure}`,
  );
}

function buildInputMessages(request, expectedOutputs, previousFailure) {
  const requiredKeys = Object.keys(expectedOutputs);
  const lines = [
    "You are the external caller for a governed runx skill boundary.",
    "Return exactly one JSON object.",
    "Do not wrap the JSON in markdown fences or prose.",
    "Ground every field in the provided inputs and context.",
    "Do not invent repository state, URLs, files, APIs, or evidence that are not present in the envelope.",
    "Keep outputs bounded and practical so the run can continue safely.",
  ];

  if (requiredKeys.length > 0) {
    lines.push(`Required top-level keys: ${requiredKeys.join(", ")}.`);
    lines.push(
      `Expected top-level types: ${requiredKeys
        .map((key) => `${key}=${expectedOutputs[key]}`)
        .join(", ")}.`,
    );
  }

  const messages = [
    {
      role: "system",
      content: lines.join(" "),
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          request_id: request.id,
          source_type: request.work.source_type,
          agent: request.work.agent,
          task: request.work.task,
          envelope: request.work.envelope,
        },
        null,
        2,
      ),
    },
  ];

  if (previousFailure) {
    messages.push({
      role: "user",
      content: `The previous JSON output was invalid for this reason: ${previousFailure}\nReturn a corrected JSON object only.`,
    });
  }

  return messages;
}

function validateResolution(payload, expectedOutputs) {
  for (const [key, declaredType] of Object.entries(expectedOutputs)) {
    if (!(key in payload)) {
      return `Missing required top-level key '${key}'.`;
    }
    const actualValue = payload[key];
    if (!matchesDeclaredType(actualValue, String(declaredType))) {
      return `Top-level key '${key}' must be ${declaredType}, got ${describeValue(actualValue)}.`;
    }
  }
  return undefined;
}

function matchesDeclaredType(value, type) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "json":
      return true;
    case "object":
    default:
      return isPlainObject(value);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function describeValue(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return value;
  }
}

function truncate(value, maxLength) {
  if (typeof value !== "string" || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function extractOutputText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const outputItems = Array.isArray(response.output) ? response.output : [];
  for (const item of outputItems) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      if (typeof block?.text === "string" && block.text.trim()) {
        return block.text;
      }
    }
  }
  return undefined;
}

function compactAnswersPayload(answers, approvals) {
  const payload = {};
  if (Object.keys(answers).length > 0) {
    payload.answers = answers;
  }
  if (Object.keys(approvals).length > 0) {
    payload.approvals = approvals;
  }
  return payload;
}

function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sanitizeTraceName(value) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

function isRetryableTransportError(error) {
  const code = String(error?.cause?.code ?? error?.code ?? "");
  return [
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
  ].includes(code);
}

function serializeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code ?? null,
    cause: error?.cause
      ? {
          name: error.cause.name ?? "Error",
          message: error.cause.message ?? String(error.cause),
          code: error.cause.code ?? null,
        }
      : null,
  };
}

function backoffDelayMs(attempt) {
  return 1000 * attempt;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
