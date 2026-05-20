import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  gateSelectorMatches,
  normalizeThreadTeachingContext,
  threadTeachingContextAllowsGate,
} from "./thread-teaching.mjs";

const execFileAsync = promisify(execFile);
const RUNX_AGENT_PAUSE_STATUS = "needs_agent";
const SKILL_ADMIN_ACTIONS = new Set(["add", "inspect", "publish", "search"]);
export { gateSelectorMatches } from "./thread-teaching.mjs";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runxBinary = resolveRunxBinary(options.runxRoot);
  const receiptDir = path.resolve(options.receiptDir ?? ".artifacts/runx-bridge");
  const traceDir = path.resolve(options.traceDir ?? path.join(receiptDir, "provider-trace"));
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aster-runx-bridge-"));
  const approvedGates = new Set([
    ...splitCsv(process.env.RUNX_APPROVED_GATES),
    ...options.approve,
  ]);
  const provider = options.provider ?? process.env.RUNX_CALLER_PROVIDER ?? "openai";
  const model = options.model ?? process.env.RUNX_CALLER_MODEL ?? "gpt-5.4";
  const reasoningEffort =
    options.reasoningEffort ?? process.env.RUNX_CALLER_REASONING_EFFORT ?? "xhigh";
  const maxTurns = Number(options.maxTurns ?? process.env.RUNX_CALLER_MAX_TURNS ?? "8");
  const contextText = await loadCallerContext(options.contextFile);
  const threadTeachingContext = await loadThreadTeachingContext(options.threadTeachingContextPath);
  const gateDecisionRecords = [];

  if (options.runxArgs.length === 0) {
    throw new Error("No runx command was provided. Pass the runx invocation after --.");
  }
  assertRustNativeRunxCommand(options.runxArgs);

  await mkdir(receiptDir, { recursive: true });
  await mkdir(traceDir, { recursive: true });

  const baseRunArgs = [...options.runxArgs];
  let runArgs = [...baseRunArgs];
  let latestExitCode = 0;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const invocation = await runRunx({
      runxBinary,
      receiptDir,
      runArgs,
      workdir: options.workdir,
    });

    latestExitCode = invocation.exitCode;

    if (!invocation.stdout.trim()) {
      throw new Error(invocation.stderr.trim() || "runx returned no JSON output.");
    }

    const report = JSON.parse(invocation.stdout);
    await assertCanonicalBridgeReport(report, { runArgs, receiptDir });
    if (options.outputPath) {
      await writeFile(path.resolve(options.outputPath), JSON.stringify(report, null, 2));
    }

    if (!isRunxAgentPauseStatus(report.status)) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exit(latestExitCode);
    }

    const answers = {};
    const approvals = {};

    for (const request of report.requests ?? []) {
      if (request.kind === "approval") {
        const gateId = String(request.gate?.id ?? "");
        const approvalMechanism = options.approveAll
          ? "approve_all"
          : setHasGateMatch(approvedGates, gateId)
            ? "explicit_gate_match"
            : threadTeachingContextAllowsGate(threadTeachingContext, request.gate)
              ? "thread_teaching_context"
              : null;
        if (approvalMechanism) {
          approvals[gateId] = true;
          gateDecisionRecords.push(buildGateDecisionRecord({
            gate: request.gate,
            threadTeachingContext,
            approvalMechanism,
          }));
          continue;
        }
        throw new Error(`Unapproved gate '${gateId}' encountered. Add --approve ${gateId} or set RUNX_APPROVED_GATES.`);
      }

      if (request.kind === "agent_act") {
        answers[request.id] = await resolveAgentAct({
          provider,
          model,
          reasoningEffort,
          contextText,
          request,
          traceDir,
        });
        continue;
      }

      throw new Error(`Unsupported runx resolution request kind: ${request.kind}`);
    }

    await writeGateDecisionRecords(options.gateDecisionsPath, gateDecisionRecords);
    const answersPath = path.join(tempDir, `answers-turn-${turn + 1}.json`);
    await writeFile(
      answersPath,
      `${JSON.stringify(compactAnswersPayload(answers, approvals), null, 2)}\n`,
    );
    runArgs = buildSkillResumeRunArgs(baseRunArgs, requireRunId(report), answersPath);
    assertRustNativeRunxCommand(runArgs);
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
    if (token === "--context-file") {
      options.contextFile = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--thread-teaching-context") {
      options.threadTeachingContextPath = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--gate-decisions") {
      options.gateDecisionsPath = requireValue(argv, ++index, token);
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

export function resolveRunxBinary(runxRoot) {
  const directRoot = path.resolve(runxRoot);
  const candidates = [
    path.join(directRoot, "crates", "target", "release", "runx"),
    path.join(directRoot, "crates", "target", "debug", "runx"),
    path.join(directRoot, "oss", "crates", "target", "release", "runx"),
    path.join(directRoot, "oss", "crates", "target", "debug", "runx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Unable to resolve Rust runx binary from ${runxRoot}. Expected crates/target/{release,debug}/runx or oss/crates/target/{release,debug}/runx.`,
  );
}

export function assertRustNativeRunxCommand(runArgs) {
  assertNoDeprecatedRunxShape(runArgs);
  const command = firstNonFlagToken(runArgs);
  const nativeCommands = new Set([
    "connect",
    "config",
    "doctor",
    "harness",
    "history",
    "init",
    "kernel",
    "list",
    "mcp",
    "new",
    "policy",
    "registry",
    "tool",
  ]);
  if (command && nativeCommands.has(command)) {
    return;
  }
  if (command === "skill" && isRustNativeSkillRunCommand(runArgs)) {
    return;
  }
  throw new Error(
    `runx command '${command ?? "(none)"}' is not accepted by the Rust-native Aster bridge.`,
  );
}

export function buildSkillResumeRunArgs(runArgs, runId, answersPath) {
  const baseRunArgs = stripSkillResumeFlags(runArgs);
  assertRustNativeRunxCommand(baseRunArgs);
  if (firstNonFlagToken(baseRunArgs) !== "skill") {
    throw new Error("runx needs_agent pause can only be resumed by rerunning a runx skill <path> command.");
  }
  return [
    ...baseRunArgs,
    "--run-id",
    requireNonEmptyString(runId, "run_id"),
    "--answers",
    requireNonEmptyString(answersPath, "answersPath"),
  ];
}

export function isRunxAgentPauseStatus(status) {
  return status === RUNX_AGENT_PAUSE_STATUS;
}

export async function assertCanonicalBridgeReport(report, { runArgs = [], receiptDir } = {}) {
  if (!isPlainObject(report)) {
    throw new Error("runx bridge report must be a JSON object.");
  }
  if (firstNonFlagToken(runArgs) !== "skill") {
    return report;
  }
  assertNoLegacyBridgeFields(report);
  if (report.schema !== "runx.skill_run.v1") {
    throw new Error("runx skill bridge report must use schema runx.skill_run.v1.");
  }
  if (isRunxAgentPauseStatus(report.status)) {
    requireNonEmptyString(report.run_id, "run_id");
    if (!Array.isArray(report.requests) || report.requests.length === 0) {
      throw new Error("runx needs_agent report must include resolution requests.");
    }
    return report;
  }
  if (report.status !== "sealed") {
    throw new Error("runx skill bridge terminal report must have status sealed.");
  }
  const receiptId = requireNonEmptyString(report.receipt_id, "receipt_id");
  requireNonEmptyString(report.run_id, "run_id");
  if (!isPlainObject(report.closure)) {
    throw new Error("runx sealed skill report must include a closure object.");
  }
  if (isPlainObject(report.receipt)) {
    assertCanonicalHarnessReceipt(report.receipt, receiptId);
  }
  if (receiptDir) {
    const receipt = await readCanonicalHarnessReceipt(receiptDir, receiptId);
    if (receipt.id !== receiptId) {
      throw new Error("runx sealed skill report receipt_id does not match the stored receipt.");
    }
  }
  return report;
}

function assertCanonicalHarnessReceipt(receipt, expectedReceiptId) {
  assertNoLegacyBridgeFields(receipt);
  if (receipt.schema !== "runx.harness_receipt.v1") {
    throw new Error("runx sealed skill receipt must use schema runx.harness_receipt.v1.");
  }
  if (expectedReceiptId && receipt.id !== expectedReceiptId) {
    throw new Error("runx sealed skill embedded receipt id does not match receipt_id.");
  }
  if (receipt.harness?.state !== "sealed") {
    throw new Error("runx sealed skill receipt harness state must be sealed.");
  }
  if (!isPlainObject(receipt.seal)) {
    throw new Error("runx sealed skill receipt must include a seal object.");
  }
}

async function readCanonicalHarnessReceipt(receiptDir, receiptId) {
  const receiptPath = path.join(path.resolve(receiptDir), `${receiptId}.json`);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch (error) {
    throw new Error(`runx sealed skill receipt was not readable at ${receiptPath}: ${error.message}`);
  }
  assertCanonicalHarnessReceipt(parsed, receiptId);
  return parsed;
}

function assertNoLegacyBridgeFields(value, pathLabel = "report") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoLegacyBridgeFields(entry, `${pathLabel}.${index}`));
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const key of Object.keys(value)) {
    if ([
      "runId",
      "receiptId",
      "outcome",
      "effect",
      "issue_to_pr_outcome",
      "verification_report",
      "verificationReport",
      "target_effect",
      "targetEffect",
    ].includes(key)) {
      throw new Error(`runx bridge report contains retired field ${pathLabel}.${key}.`);
    }
    assertNoLegacyBridgeFields(value[key], `${pathLabel}.${key}`);
  }
}

function assertNoDeprecatedRunxShape(runArgs) {
  const commandIndex = firstNonFlagTokenIndex(runArgs);
  const command = commandIndex < 0 ? null : String(runArgs[commandIndex]);
  if (command === "skill" && runArgs[commandIndex + 1] === "run") {
    throw new Error("Deprecated skill subcommands are not accepted by the Rust-native Aster bridge.");
  }
  for (const token of runArgs) {
    const value = String(token);
    if (value === "--receipt" || value.startsWith("--receipt=")) {
      throw new Error("Deprecated receipt flags are not accepted by the Rust-native Aster bridge.");
    }
    if (value === "--receiptDir" || value.startsWith("--receiptDir=")) {
      throw new Error("Deprecated receipt flags are not accepted by the Rust-native Aster bridge.");
    }
  }
}

function isRustNativeSkillRunCommand(runArgs) {
  const commandIndex = firstNonFlagTokenIndex(runArgs);
  if (commandIndex < 0) {
    return false;
  }
  const skillRef = runArgs[commandIndex + 1];
  if (typeof skillRef !== "string" || !skillRef || skillRef.startsWith("-")) {
    return false;
  }
  return !SKILL_ADMIN_ACTIONS.has(skillRef) && isPathLikeSkillRef(skillRef);
}

function isPathLikeSkillRef(skillRef) {
  return (
    skillRef === "." ||
    skillRef === ".." ||
    skillRef.startsWith("./") ||
    skillRef.startsWith("../") ||
    path.isAbsolute(skillRef) ||
    skillRef.includes("/") ||
    skillRef.toLowerCase().endsWith(".md")
  );
}

function stripSkillResumeFlags(runArgs) {
  const stripped = [];
  for (let index = 0; index < runArgs.length; index += 1) {
    const token = String(runArgs[index]);
    if (token === "--run-id" || token === "--answers") {
      index += 1;
      continue;
    }
    if (token.startsWith("--run-id=") || token.startsWith("--answers=")) {
      continue;
    }
    stripped.push(runArgs[index]);
  }
  return stripped;
}

function firstNonFlagToken(runArgs) {
  const index = firstNonFlagTokenIndex(runArgs);
  return index < 0 ? null : String(runArgs[index]);
}

function firstNonFlagTokenIndex(runArgs) {
  for (let index = 0; index < runArgs.length; index += 1) {
    const token = runArgs[index];
    const value = String(token);
    if (!value.startsWith("-")) {
      return index;
    }
  }
  return -1;
}

function requireRunId(report) {
  return requireNonEmptyString(report?.run_id, "run_id");
}

function requireNonEmptyString(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`runx needs_agent resume is missing ${label}.`);
  }
  return normalized;
}

async function runRunx({ runxBinary, receiptDir, runArgs, workdir }) {
  const { RUNX_JS_BIN, RUNX_NPM_PACKAGE, ...baseEnv } = process.env;
  try {
    const { stdout, stderr } = await execFileAsync(
      runxBinary,
      [
        ...runArgs,
        "--non-interactive",
        "--json",
        "--receipt-dir",
        receiptDir,
      ],
      {
        cwd: workdir ? path.resolve(workdir) : process.cwd(),
        env: {
          ...baseEnv,
          RUNX_RUST_CLI: "1",
          RUNX_RUST_HARNESS: "1",
        },
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

async function resolveAgentAct({
  provider,
  model,
  reasoningEffort,
  contextText,
  request,
  traceDir,
}) {
  if (provider !== "openai") {
    throw new Error(`Unsupported provider '${provider}'.`);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for runx agent act resolution.");
  }

  const requestId = sanitizeTraceName(request.id);
  const expectedOutputs = request.invocation.envelope.output ?? {};
  let previousFailure;
  let lastTransportError;
  const maxAttempts = Number(process.env.RUNX_CALLER_MAX_ATTEMPTS ?? "2");
  const requestTimeoutMs = Number(process.env.RUNX_CALLER_REQUEST_TIMEOUT_MS ?? "1200000");

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptStartedAt = new Date().toISOString();
    const messages = buildInputMessages(request, expectedOutputs, previousFailure, contextText);
    const payload = buildResponsesPayload({ model, messages, reasoningEffort });

    let response;
    let requestPayload = payload;
    let requestApi = "responses";
    let initialFailure;
    try {
      response = await runProviderRequestWithTrace({
        requestId,
        attempt,
        maxAttempts,
        requestApi,
        traceDir,
        startedAt: attemptStartedAt,
        timeoutMs: requestTimeoutMs,
        expectedOutputs,
        requestPayload: payload,
        url: "https://api.openai.com/v1/responses",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": `${requestId}-${attempt}`.slice(0, 128),
        },
      });
    } catch (error) {
      lastTransportError = error;
      await writeAttemptTraceFile({
        traceDir,
        requestId,
        attempt,
        requestApi,
        request: payload,
        response: null,
        rawResponse: null,
        transportError: serializeError(error),
      });
      if (attempt < maxAttempts && isRetryableTransportError(error)) {
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      throw error;
    }

    let raw = response.body;
    let parsed = safeJsonParse(raw);

    if (shouldFallbackToChatCompletions({ response, parsed })) {
      initialFailure = {
        api: requestApi,
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        raw,
      };
      requestApi = "chat_completions";
      requestPayload = buildChatCompletionsPayload({ model, messages });
      try {
        response = await runProviderRequestWithTrace({
          requestId,
          attempt,
          maxAttempts,
          requestApi,
          traceDir,
          startedAt: attemptStartedAt,
          timeoutMs: requestTimeoutMs,
          expectedOutputs,
          requestPayload,
          url: "https://api.openai.com/v1/chat/completions",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-Client-Request-Id": `${requestId}-${attempt}-fallback`.slice(0, 128),
          },
        });
      } catch (error) {
        lastTransportError = error;
        await writeAttemptTraceFile({
          traceDir,
          requestId,
          attempt,
          requestApi,
          request: requestPayload,
          response: null,
          rawResponse: null,
          initialFailure,
          transportError: serializeError(error),
        });
        if (attempt < maxAttempts && isRetryableTransportError(error)) {
          await sleep(backoffDelayMs(attempt));
          continue;
        }
        throw error;
      }
      raw = response.body;
      parsed = safeJsonParse(raw);
    }

    await writeAttemptTraceFile({
      traceDir,
      requestId,
      attempt,
      requestApi,
      request: requestPayload,
      response: parsed,
      rawResponse: raw,
      initialFailure,
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      await writeLiveTraceState({
        traceDir,
        requestId,
        snapshot: buildLiveTraceState({
          requestId,
          attempt,
          maxAttempts,
          requestApi,
          status: "http_error",
          timeoutMs: requestTimeoutMs,
          startedAt: attemptStartedAt,
          heartbeatAt: new Date().toISOString(),
          expectedOutputs,
          note: truncate(raw, 800),
          responseStatus: response.statusCode,
        }),
      });
      throw new Error(
        `OpenAI request failed: ${response.statusCode} ${response.statusMessage}\n${truncate(raw, 4000)}`,
      );
    }

    const outputTexts = extractOutputTextCandidates(parsed);
    if (outputTexts.length === 0) {
      previousFailure = `The response did not include output_text. Raw response: ${truncate(raw, 1200)}`;
      const liveStatus = attempt < maxAttempts ? "retrying_invalid_response" : "failed";
      await writeLiveTraceState({
        traceDir,
        requestId,
        snapshot: buildLiveTraceState({
          requestId,
          attempt,
          maxAttempts,
          requestApi,
          status: liveStatus,
          timeoutMs: requestTimeoutMs,
          startedAt: attemptStartedAt,
          heartbeatAt: new Date().toISOString(),
          expectedOutputs,
          note: previousFailure,
        }),
      });
      continue;
    }

    let candidateFailure;
    for (const outputText of outputTexts) {
      const parsedOutput = safeJsonParse(outputText);
      if (!isPlainObject(parsedOutput)) {
        candidateFailure =
          `The response was not a JSON object. Raw output text: ${truncate(outputText, 1200)}`;
        continue;
      }

      const validationError = validateResolution(parsedOutput, expectedOutputs);
      if (!validationError) {
        await writeLiveTraceState({
          traceDir,
          requestId,
          snapshot: buildLiveTraceState({
            requestId,
            attempt,
            maxAttempts,
            requestApi,
            status: "completed",
            timeoutMs: requestTimeoutMs,
            startedAt: attemptStartedAt,
            heartbeatAt: new Date().toISOString(),
            expectedOutputs,
            note: "resolution accepted",
          }),
        });
        return parsedOutput;
      }

      candidateFailure = validationError;
    }

    previousFailure = candidateFailure;
    const liveStatus = attempt < maxAttempts ? "retrying_invalid_response" : "failed";
    await writeLiveTraceState({
      traceDir,
      requestId,
      snapshot: buildLiveTraceState({
        requestId,
        attempt,
        maxAttempts,
        requestApi,
        status: liveStatus,
        timeoutMs: requestTimeoutMs,
        startedAt: attemptStartedAt,
        heartbeatAt: new Date().toISOString(),
        expectedOutputs,
        note: previousFailure,
      }),
    });
  }

  if (lastTransportError && !previousFailure) {
    throw lastTransportError;
  }

  throw new Error(
    `OpenAI response for ${request.id} did not satisfy the expected output contract after ${maxAttempts} attempts: ${previousFailure}`,
  );
}

function buildResponsesPayload({ model, messages, reasoningEffort }) {
  return {
    model,
    input: messages,
    reasoning: {
      effort: reasoningEffort,
    },
    text: {
      format: {
        type: "json_object",
      },
    },
  };
}

function buildChatCompletionsPayload({ model, messages }) {
  return {
    model,
    messages,
    response_format: {
      type: "json_object",
    },
  };
}

function postJson(url, { headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearDeadline();
      handler(value);
    };
    const request = https.request(
      url,
      {
        method: "POST",
        headers,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          finish(resolve, {
            statusCode: response.statusCode ?? 0,
            statusMessage: response.statusMessage ?? "",
            body: raw,
          });
        });
        response.on("error", (error) => finish(reject, error));
      },
    );

    const clearDeadline = armWallClockTimeout(timeoutMs, () => {
      const error = new Error(`OpenAI request timed out after ${timeoutMs}ms.`);
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.on("error", (error) => finish(reject, error));
    request.write(body);
    request.end();
  });
}

export function armWallClockTimeout(timeoutMs, onTimeout) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return () => {};
  }
  const timer = setTimeout(onTimeout, timeoutMs);
  return () => clearTimeout(timer);
}

export function buildInputMessages(request, expectedOutputs, previousFailure, contextText) {
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
  ];

  if (contextText) {
    messages.push({
      role: "system",
      content: [
        "Use this operator context bundle as additional guidance for the task.",
        "Treat doctrine as constitutional guidance.",
        "Treat state, history, reflections, and artifact summaries as derived context that must yield to fresher evidence in the request envelope.",
        "",
        contextText,
      ].join("\n"),
    });
  }

  messages.push(
    {
      role: "user",
      content: JSON.stringify(
        {
          request_id: request.id,
          source_type: request.invocation.source_type,
          agent: request.invocation.agent,
          task: request.invocation.task,
          envelope: request.invocation.envelope,
        },
        null,
        2,
      ),
    },
  );

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

export function extractOutputTextCandidates(response) {
  const ranked = [[], [], []];

  if (typeof response.output_text === "string" && response.output_text.trim()) {
    ranked[0].push(response.output_text.trim());
  }

  const choices = Array.isArray(response.choices) ? response.choices : [];
  for (const choice of choices) {
    const content = choice?.message?.content;
    if (typeof content === "string" && content.trim()) {
      ranked[0].push(content.trim());
    }
  }

  const outputItems = Array.isArray(response.output) ? response.output : [];
  for (const item of outputItems) {
    const content = Array.isArray(item?.content) ? item.content : [];
    const texts = content
      .map((block) => (typeof block?.text === "string" ? block.text.trim() : ""))
      .filter(Boolean);

    if (texts.length === 0) {
      continue;
    }

    if (item?.type === "message" && item?.role === "assistant" && item?.phase === "final_answer") {
      ranked[0].push(...texts);
      continue;
    }

    if (item?.type === "message" && item?.role === "assistant") {
      ranked[1].push(...texts);
      continue;
    }

    ranked[2].push(...texts);
  }

  const seen = new Set();
  const candidates = [];
  for (const group of ranked) {
    for (const text of group.reverse()) {
      if (seen.has(text)) {
        continue;
      }
      seen.add(text);
      candidates.push(text);
    }
  }
  return candidates;
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

async function loadCallerContext(contextFile) {
  const candidate = contextFile ?? process.env.RUNX_CALLER_CONTEXT_FILE;
  if (!candidate) {
    return "";
  }
  const resolved = path.resolve(candidate);
  const content = await readFile(resolved, "utf8");
  return content.trim();
}

async function loadThreadTeachingContext(threadTeachingContextPath) {
  if (!threadTeachingContextPath) {
    return null;
  }
  const resolved = path.resolve(threadTeachingContextPath);
  if (!existsSync(resolved)) {
    return null;
  }
  const parsed = JSON.parse(await readFile(resolved, "utf8"));
  return normalizeThreadTeachingContext(parsed);
}

export function threadTeachingAllowsGate(threadTeachingContext, gate) {
  return threadTeachingContextAllowsGate(threadTeachingContext, gate);
}

export function inferTraceHeartbeatIntervalMs(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return 15000;
  }
  return Math.max(5000, Math.min(15000, Math.floor(timeoutMs / 6)));
}

export function buildLiveTraceState({
  requestId,
  attempt,
  maxAttempts,
  requestApi,
  status,
  timeoutMs,
  startedAt,
  heartbeatAt,
  expectedOutputs,
  note = null,
  responseStatus = null,
}) {
  const resolvedStartedAt = normalizeTimestamp(startedAt) ?? heartbeatAt ?? new Date().toISOString();
  const resolvedHeartbeatAt = normalizeTimestamp(heartbeatAt) ?? new Date().toISOString();
  const elapsedMs = Math.max(
    0,
    Date.parse(resolvedHeartbeatAt) - Date.parse(resolvedStartedAt),
  );
  return {
    kind: "aster.provider-trace-live.v1",
    request_id: requestId,
    attempt,
    max_attempts: maxAttempts,
    request_api: requestApi,
    status,
    timeout_ms: timeoutMs,
    expected_output_keys: Object.keys(expectedOutputs ?? {}),
    started_at: resolvedStartedAt,
    updated_at: resolvedHeartbeatAt,
    elapsed_ms: elapsedMs,
    response_status: responseStatus,
    note,
  };
}

function buildGateDecisionRecord({ gate, threadTeachingContext, approvalMechanism }) {
  const matchingAuthorization = (threadTeachingContext?.gate_authorizations ?? []).find((authorization) =>
    gateSelectorMatches(normalizeString(authorization?.selector), normalizeString(gate?.id))
  );
  const sourceRecord = (threadTeachingContext?.records ?? []).find((record) =>
    normalizeString(record?.record_id) === normalizeString(matchingAuthorization?.record_id)
  );
  return {
    gate_id: normalizeString(gate?.id) || "unknown-gate",
    gate_reason: normalizeString(gate?.reason),
    gate_type: normalizeString(gate?.type),
    resolved_at: new Date().toISOString(),
    decision: "approved",
    approval_mechanism: approvalMechanism ?? "explicit_gate_match",
    authorization_selector: matchingAuthorization?.selector ?? null,
    authorization_reason: matchingAuthorization?.reason ?? sourceRecord?.summary ?? null,
    teaching_record_id: matchingAuthorization?.record_id ?? sourceRecord?.record_id ?? null,
    teaching_kind: sourceRecord?.kind ?? matchingAuthorization?.kind ?? null,
    source_type: sourceRecord?.source_type ?? matchingAuthorization?.source_type ?? null,
    source_url: sourceRecord?.source_url ?? matchingAuthorization?.source_url ?? null,
    recorded_by: sourceRecord?.recorded_by ?? matchingAuthorization?.recorded_by ?? null,
    target_repo: sourceRecord?.target_repo ?? null,
    subject_locator: sourceRecord?.subject_locator ?? null,
    objective_fingerprint: sourceRecord?.objective_fingerprint ?? null,
    applies_to: sourceRecord?.applies_to ?? [],
    labels: sourceRecord?.labels ?? [],
    invariants: sourceRecord?.invariants ?? [],
    notes: sourceRecord?.notes ?? [],
  };
}

async function writeGateDecisionRecords(gateDecisionsPath, gateDecisionRecords) {
  if (!gateDecisionsPath || gateDecisionRecords.length === 0) {
    return;
  }
  const resolved = path.resolve(gateDecisionsPath);
  const deduped = dedupeGateDecisionRecords(gateDecisionRecords);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(deduped, null, 2)}\n`);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringArray(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function dedupeGateDecisionRecords(records) {
  const seen = new Set();
  const deduped = [];
  for (const record of Array.isArray(records) ? records : []) {
    const gateId = normalizeString(record?.gate_id) || "unknown-gate";
    if (seen.has(gateId)) {
      continue;
    }
    seen.add(gateId);
    deduped.push(record);
  }
  return deduped;
}

function setHasGateMatch(values, gateId) {
  for (const value of values) {
    if (gateSelectorMatches(value, gateId)) {
      return true;
    }
  }
  return false;
}

function sanitizeTraceName(value) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

async function writeAttemptTraceFile({
  traceDir,
  requestId,
  attempt,
  requestApi,
  request,
  response,
  rawResponse,
  initialFailure = null,
  transportError = null,
}) {
  await writeFile(
    path.join(traceDir, `${requestId}-attempt-${attempt}.json`),
    `${JSON.stringify(
      {
        request_api: requestApi,
        request,
        response,
        raw_response: rawResponse,
        initial_failure: initialFailure,
        transport_error: transportError,
      },
      null,
      2,
    )}\n`,
  );
}

async function writeLiveTraceState({ traceDir, requestId, snapshot }) {
  const rendered = `${JSON.stringify(snapshot, null, 2)}\n`;
  await writeFile(path.join(traceDir, `${requestId}-live.json`), rendered);
  await writeFile(path.join(traceDir, "latest.json"), rendered);
}

function logBridgeProgress({ requestId, attempt, maxAttempts, requestApi, status, note, elapsedMs }) {
  const suffix = typeof note === "string" && note.trim().length > 0 ? ` ${note.trim()}` : "";
  const elapsed = Number.isFinite(elapsedMs) ? ` elapsed_ms=${elapsedMs}` : "";
  process.stderr.write(
    `[runx-agent-bridge] request=${requestId} attempt=${attempt}/${maxAttempts} api=${requestApi} status=${status}${elapsed}${suffix}\n`,
  );
}

async function runProviderRequestWithTrace({
  requestId,
  attempt,
  maxAttempts,
  requestApi,
  traceDir,
  startedAt,
  timeoutMs,
  expectedOutputs,
  requestPayload,
  url,
  headers,
}) {
  const resolvedStartedAt = normalizeTimestamp(startedAt) ?? new Date().toISOString();
  const heartbeatIntervalMs = inferTraceHeartbeatIntervalMs(timeoutMs);
  const emit = async ({ status, note = null, responseStatus = null, heartbeatAt } = {}) => {
    const snapshot = buildLiveTraceState({
      requestId,
      attempt,
      maxAttempts,
      requestApi,
      status,
      timeoutMs,
      startedAt: resolvedStartedAt,
      heartbeatAt,
      expectedOutputs,
      note,
      responseStatus,
    });
    await writeLiveTraceState({ traceDir, requestId, snapshot });
    return snapshot;
  };

  const startedSnapshot = await emit({
    status: "requesting",
    note: `timeout_ms=${timeoutMs}`,
  });
  logBridgeProgress({
    requestId,
    attempt,
    maxAttempts,
    requestApi,
    status: startedSnapshot.status,
    note: startedSnapshot.note,
    elapsedMs: startedSnapshot.elapsed_ms,
  });

  const heartbeat = setInterval(() => {
    const heartbeatAt = new Date().toISOString();
    const note = `still waiting; heartbeat_interval_ms=${heartbeatIntervalMs}`;
    void emit({
      status: "waiting",
      note,
      heartbeatAt,
    }).then((snapshot) => {
      logBridgeProgress({
        requestId,
        attempt,
        maxAttempts,
        requestApi,
        status: snapshot.status,
        note,
        elapsedMs: snapshot.elapsed_ms,
      });
    }).catch(() => {});
  }, heartbeatIntervalMs);

  try {
    const response = await postJson(url, {
      headers,
      body: JSON.stringify(requestPayload),
      timeoutMs,
    });
    clearInterval(heartbeat);
    const receivedSnapshot = await emit({
      status: response.statusCode >= 200 && response.statusCode < 300 ? "received" : "http_error",
      responseStatus: response.statusCode,
      note: response.statusMessage || null,
    });
    logBridgeProgress({
      requestId,
      attempt,
      maxAttempts,
      requestApi,
      status: receivedSnapshot.status,
      note: receivedSnapshot.note,
      elapsedMs: receivedSnapshot.elapsed_ms,
    });
    return response;
  } catch (error) {
    clearInterval(heartbeat);
    const failedSnapshot = await emit({
      status: "transport_error",
      note: error?.message ?? String(error),
    });
    logBridgeProgress({
      requestId,
      attempt,
      maxAttempts,
      requestApi,
      status: failedSnapshot.status,
      note: failedSnapshot.note,
      elapsedMs: failedSnapshot.elapsed_ms,
    });
    throw error;
  }
}

export function shouldFallbackToChatCompletions({ response, parsed }) {
  if (process.env.RUNX_DISABLE_CHAT_COMPLETIONS_FALLBACK === "true") {
    return false;
  }

  if (response?.statusCode !== 401) {
    return false;
  }

  const message = String(parsed?.error?.message ?? "");
  return /api\.responses\.write|insufficient permissions/i.test(message);
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

function normalizeTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
