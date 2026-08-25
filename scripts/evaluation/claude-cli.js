import { spawn } from "node:child_process";
import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { TextDecoder } from "node:util";

import {
  canonicalJsonBytes,
  consumeExternalModelLaunch,
  sha256Hex,
} from "./runtime.js";

/**
 * @typedef {object} ClaudeProviderAdapter
 * @property {"anthropic"} provider
 * @property {(context: object) => Promise<object>} execute
 */

const PINNED_VERSION = "2.1.233";
const AUTH_ARGUMENTS = Object.freeze(["auth", "status", "--json"]);
const TOOL_ALLOWLIST = "WebSearch,WebFetch";
const FAILURE_CLASSES = new Set([
  "capability-rejected",
  "controller-failed",
  "launch-failed",
  "preflight-rejected",
  "protocol-failed",
  "provider-failed",
  "timed-out",
]);
const CODE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".ps1"]);
const CAPABILITY_PROFILE = immutable({
  schemaVersion: 1,
  version: PINNED_VERSION,
  authentication: {
    command: AUTH_ARGUMENTS,
    safeModePreservesOauthKeychain: true,
  },
  invocation: {
    safeMode: true,
    slashCommands: false,
    sessionPersistence: false,
    chrome: false,
    promptSuggestions: false,
    permissionMode: "dontAsk",
    inputFormat: "text",
    outputFormat: "stream-json",
    verbose: true,
    strictMcpConfig: true,
    disallowedTools: ["mcp__*"],
    maxTurns: 1,
    fallbackModel: false,
    systemPromptMode: "append-file",
  },
});

class ClaudeSessionError extends Error {
  constructor(failureClass, code, message) {
    super(message);
    this.name = "ClaudeSessionError";
    this.failureClass = failureClass;
    this.code = code;
  }
}

function fail(message) {
  throw new TypeError(message);
}

function sessionError(failureClass, code, message) {
  return new ClaudeSessionError(failureClass, code, message);
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a plain object`);
  }
}

function assertExactKeys(value, keys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${label} has an invalid field set`);
  }
}

function assertNonemptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a nonempty string`);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function sameCanonical(left, right) {
  try {
    return canonicalJsonBytes(left).equals(canonicalJsonBytes(right));
  } catch {
    return false;
  }
}

function assertEnvironment(environment) {
  assertPlainObject(environment, "environment");
  const folded = new Set();
  for (const [name, value] of Object.entries(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      fail(`environment name is invalid: ${name}`);
    }
    if (typeof value !== "string") {
      fail(`environment value must be a string: ${name}`);
    }
    const normalized = name.toUpperCase();
    if (folded.has(normalized)) {
      fail(`environment contains a case-insensitive collision: ${name}`);
    }
    folded.add(normalized);
  }
  return Object.freeze({ ...environment });
}

function assertArguments(prefixArguments) {
  if (
    !Array.isArray(prefixArguments) ||
    prefixArguments.some(
      (argument) => typeof argument !== "string" || argument.length === 0,
    )
  ) {
    fail("prefixArguments must contain only nonempty strings");
  }
  return Object.freeze([...prefixArguments]);
}

function safeClosureNotStarted() {
  return {
    status: "safe",
    exitStatus: "not-started",
    exitCode: null,
    exitSignal: null,
    stdioStatus: "not-opened",
    protocolStatus: "not-applicable",
    terminationActions: [],
    descendantStatus: "none-observed",
  };
}

function safeClosure({ exitCode, exitSignal, terminationActions = [] }) {
  return {
    status: "safe",
    exitStatus: "observed",
    exitCode,
    exitSignal,
    stdioStatus: "closed",
    protocolStatus: "not-applicable",
    terminationActions,
    descendantStatus: "none-observed",
  };
}

function unsafeClosure({ exitCode, exitSignal, terminationActions }) {
  return {
    status: "unsafe",
    reasonCode: "shutdown-ambiguous",
    diagnostics: {
      directExitObserved: exitCode !== undefined || exitSignal !== undefined,
      exitCode: exitCode ?? null,
      exitSignal: exitSignal ?? null,
      stdioStatus: "open",
      terminationActions,
    },
  };
}

function errorRecord(error) {
  return {
    name: typeof error?.name === "string" ? error.name : "Error",
    code:
      typeof error?.code === "string" ? error.code : "CLAUDE_SESSION_FAILED",
    message:
      typeof error?.message === "string"
        ? error.message
        : "Claude session failed",
  };
}

function emptyUsage() {
  return {
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
  };
}

function failedResult(
  error,
  closure,
  nativeUsage = null,
  normalizedUsage = emptyUsage(),
) {
  const failureClass = FAILURE_CLASSES.has(error?.failureClass)
    ? error.failureClass
    : "provider-failed";
  return {
    status: "failed",
    failureClass,
    error: errorRecord(error),
    nativeUsage,
    normalizedUsage,
    closure,
    suiteResult: null,
  };
}

function completedResult({
  closure,
  nativeUsage,
  normalizedUsage,
  suiteResult,
}) {
  return {
    status: "completed",
    failureClass: null,
    error: null,
    nativeUsage,
    normalizedUsage,
    closure,
    suiteResult,
  };
}

function waitForEvent(emitter, eventName) {
  return new Promise((resolvePromise) => {
    emitter.once(eventName, (...values) => resolvePromise(values));
  });
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

async function withDeadline(promise, timeoutMs, onTimeout) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout();
      } finally {
        reject(
          sessionError("timed-out", "TIMEOUT", "Claude command timed out"),
        );
      }
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function readStream(stream, onChunk) {
  const chunks = [];
  for await (const chunk of stream) {
    const retained = Buffer.from(chunk);
    chunks.push(retained);
    if (onChunk !== undefined) {
      await onChunk(retained);
    }
  }
  return Buffer.concat(chunks);
}

async function terminateChild(child, exitPromise, closePromise) {
  const terminationActions = [];
  if (child.exitCode === null && child.signalCode === null) {
    terminationActions.push("interrupt");
    child.kill("SIGINT");
  }
  if (
    (await Promise.race([
      exitPromise.then(() => true),
      delay(75).then(() => false),
    ])) === false
  ) {
    terminationActions.push("terminate");
    child.kill("SIGTERM");
  }
  if (
    (await Promise.race([
      exitPromise.then(() => true),
      delay(75).then(() => false),
    ])) === false
  ) {
    terminationActions.push("kill");
    child.kill("SIGKILL");
  }
  const exitObserved = await Promise.race([
    exitPromise.then(([exitCode, exitSignal]) => ({ exitCode, exitSignal })),
    delay(150).then(() => null),
  ]);
  const closeObserved = await Promise.race([
    closePromise.then(() => true),
    delay(150).then(() => false),
  ]);
  if (exitObserved !== null && closeObserved) {
    return safeClosure({ ...exitObserved, terminationActions });
  }
  return unsafeClosure({
    exitCode: exitObserved?.exitCode,
    exitSignal: exitObserved?.exitSignal,
    terminationActions,
  });
}

async function runCapturedCommand({
  command,
  arguments: commandArguments,
  cwd,
  environment,
  timeoutMs,
  signal,
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    fail("timeoutMs must be a positive safe integer");
  }
  if (signal?.aborted) {
    throw sessionError("timed-out", "ABORTED", "Claude command was aborted");
  }
  let child;
  try {
    child = spawn(command, commandArguments, {
      cwd,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    throw sessionError("launch-failed", "SPAWN_FAILED", error.message);
  }
  const errorPromise = waitForEvent(child, "error").then(([error]) => {
    throw sessionError("launch-failed", "SPAWN_FAILED", error.message);
  });
  const exitPromise = waitForEvent(child, "exit");
  const closePromise = waitForEvent(child, "close");
  const stdoutPromise = readStream(child.stdout);
  const stderrPromise = readStream(child.stderr);
  const abortListener = () => child.kill("SIGINT");
  signal?.addEventListener("abort", abortListener, { once: true });
  try {
    const outcome = await withDeadline(
      Promise.race([
        Promise.all([closePromise, stdoutPromise, stderrPromise]),
        errorPromise,
      ]),
      timeoutMs,
      () => child.kill("SIGINT"),
    );
    const [[exitCode, exitSignal], stdout, stderr] = outcome;
    return {
      stdout,
      stderr,
      closure: safeClosure({ exitCode, exitSignal }),
    };
  } catch (error) {
    const closure = await terminateChild(child, exitPromise, closePromise);
    error.closure = closure;
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortListener);
  }
}

async function fingerprintFile(path) {
  const canonicalPath = await realpath(path);
  const bytes = await readFile(canonicalPath);
  return {
    path: canonicalPath,
    byteLength: bytes.byteLength,
    sha256: sha256Hex(bytes),
  };
}

async function fingerprintPrefixFiles(prefixArguments) {
  const files = [];
  for (const argument of prefixArguments) {
    if (!CODE_EXTENSIONS.has(extname(argument).toLowerCase())) {
      continue;
    }
    try {
      const metadata = await stat(argument);
      if (metadata.isFile()) {
        files.push(await fingerprintFile(argument));
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return files;
}

function parseVersion(stdout) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(stdout).trim();
  const match = text.match(/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$|\s*\()/u);
  if (match === null) {
    throw sessionError(
      "preflight-rejected",
      "INVALID_VERSION",
      "Claude Code returned an invalid version",
    );
  }
  if (match[1] !== PINNED_VERSION) {
    throw sessionError(
      "preflight-rejected",
      "UNSUPPORTED_VERSION",
      `Claude Code ${match[1]} is not the reviewed ${PINNED_VERSION} version`,
    );
  }
  return match[1];
}

/**
 * Fingerprint one Claude executable and select its reviewed static profile.
 *
 * @param {{command: string, prefixArguments: string[], environment: Record<string, string>}} options
 * @returns {Promise<Readonly<Record<string, unknown>>>}
 */
export async function inspectClaudeCliToolchain({
  command,
  prefixArguments,
  environment,
}) {
  assertNonemptyString(command, "command");
  const boundArguments = assertArguments(prefixArguments);
  const boundEnvironment = assertEnvironment(environment);
  const commandIdentity = await fingerprintFile(command);
  const versionProbe = await runCapturedCommand({
    command: commandIdentity.path,
    arguments: [...boundArguments, "--version"],
    environment: boundEnvironment,
    timeoutMs: 5_000,
  });
  if (versionProbe.closure.exitCode !== 0) {
    throw sessionError(
      "preflight-rejected",
      "VERSION_PROBE_FAILED",
      "Claude Code version probe failed",
    );
  }
  const version = parseVersion(versionProbe.stdout);
  const helpProbe = await runCapturedCommand({
    command: commandIdentity.path,
    arguments: [...boundArguments, "--help"],
    environment: boundEnvironment,
    timeoutMs: 5_000,
  });
  if (helpProbe.closure.exitCode !== 0) {
    throw sessionError(
      "preflight-rejected",
      "HELP_PROBE_FAILED",
      "Claude Code help probe failed",
    );
  }
  return immutable({
    schemaVersion: 1,
    provider: "anthropic",
    transport: "claude-cli",
    version,
    command: commandIdentity,
    prefixArguments: boundArguments,
    boundPrefixFiles: await fingerprintPrefixFiles(boundArguments),
    help: {
      byteLength: helpProbe.stdout.byteLength,
      sha256: sha256Hex(helpProbe.stdout),
    },
    capabilityProfile: CAPABILITY_PROFILE,
  });
}

function authenticationResult(native, closure) {
  assertPlainObject(native, "Claude auth status");
  if (typeof native.loggedIn !== "boolean") {
    throw sessionError(
      "preflight-rejected",
      "INVALID_AUTH_STATUS",
      "Claude auth status omitted loggedIn",
    );
  }
  const authMode =
    native.loggedIn && native.authMethod === "oauth"
      ? "oauth-keychain"
      : native.loggedIn && typeof native.authMethod === "string"
        ? native.authMethod
        : null;
  const apiProvider =
    native.loggedIn && typeof native.apiProvider === "string"
      ? native.apiProvider
      : null;
  if (native.loggedIn && (authMode === null || apiProvider === null)) {
    throw sessionError(
      "preflight-rejected",
      "INVALID_AUTH_STATUS",
      "Claude auth status omitted the authentication mode",
    );
  }
  return immutable({
    schemaVersion: 1,
    provider: "anthropic",
    status: native.loggedIn ? "authenticated" : "unauthenticated",
    authMode,
    apiProvider,
    modelTurns: 0,
    closure,
  });
}

/**
 * Run the zero-model authentication probe and retain only a redacted summary.
 *
 * @param {{toolchain: object, environment: Record<string, string>, timeoutMs: number, signal?: AbortSignal}} options
 * @returns {Promise<Readonly<Record<string, unknown>>>}
 */
export async function preflightClaudeAuth({
  toolchain,
  environment,
  timeoutMs,
  signal,
}) {
  assertToolchainShape(toolchain);
  const boundEnvironment = assertEnvironment(environment);
  const operation = await runCapturedCommand({
    command: toolchain.command.path,
    arguments: [...toolchain.prefixArguments, ...AUTH_ARGUMENTS],
    environment: boundEnvironment,
    timeoutMs,
    signal,
  });
  if (operation.closure.exitCode !== 0) {
    throw sessionError(
      "preflight-rejected",
      "AUTH_PROBE_FAILED",
      "Claude auth status failed",
    );
  }
  let native;
  try {
    native = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(operation.stdout),
    );
  } catch {
    throw sessionError(
      "preflight-rejected",
      "INVALID_AUTH_STATUS",
      "Claude auth status returned invalid JSON",
    );
  }
  return authenticationResult(native, operation.closure);
}

function assertToolchainShape(toolchain) {
  assertPlainObject(toolchain, "toolchain");
  if (
    toolchain.schemaVersion !== 1 ||
    toolchain.provider !== "anthropic" ||
    toolchain.transport !== "claude-cli" ||
    toolchain.version !== PINNED_VERSION ||
    !sameCanonical(toolchain.capabilityProfile, CAPABILITY_PROFILE)
  ) {
    throw sessionError(
      "preflight-rejected",
      "UNSUPPORTED_TOOLCHAIN",
      "Claude toolchain does not match the reviewed capability profile",
    );
  }
  assertPlainObject(toolchain.command, "toolchain command");
  assertNonemptyString(toolchain.command.path, "toolchain command path");
  assertArguments(toolchain.prefixArguments);
}

function assertIsolation(transmission) {
  assertPlainObject(transmission.isolation, "isolation");
  if (
    transmission.isolation.persistence !== false ||
    transmission.isolation.stableHome !== null ||
    !isAbsolute(transmission.isolation.workingDirectory)
  ) {
    throw sessionError(
      "capability-rejected",
      "ISOLATION_UNREPRESENTABLE",
      "Claude requires a fresh absolute non-persistent working directory",
    );
  }
  assertPlainObject(
    transmission.isolation.environment,
    "isolation environment",
  );
  if (
    !Array.isArray(transmission.isolation.environment.secretSources) ||
    transmission.isolation.environment.secretSources.length !== 0
  ) {
    throw sessionError(
      "capability-rejected",
      "SECRET_ENVIRONMENT_FORBIDDEN",
      "Claude OAuth evaluation does not accept secret environment sources",
    );
  }
  for (const name of Object.keys(transmission.isolation.environment.values)) {
    if (/^(?:ANTHROPIC|CLAUDE)/iu.test(name)) {
      throw sessionError(
        "capability-rejected",
        "SECRET_ENVIRONMENT_FORBIDDEN",
        "Claude authentication environment names are forbidden",
      );
    }
  }
  return assertEnvironment(transmission.isolation.environment.values);
}

function assertCapabilities(transmission) {
  const expected = {
    network: true,
    webSearch: true,
    tools: ["WebSearch", "WebFetch"],
    providerFacilities: [],
  };
  if (!sameCanonical(transmission.capabilities, expected)) {
    throw sessionError(
      "capability-rejected",
      "CAPABILITY_UNREPRESENTABLE",
      "Claude capability request does not match the reviewed tool profile",
    );
  }
}

async function assertFreshWorkingDirectory(path) {
  const entries = await readdir(path);
  if (entries.length !== 0) {
    throw sessionError(
      "capability-rejected",
      "WORKING_DIRECTORY_NOT_EMPTY",
      "Claude working directory must be empty",
    );
  }
  let cursor = resolve(path);
  while (true) {
    try {
      await access(resolve(cursor, ".git"));
      throw sessionError(
        "capability-rejected",
        "REPOSITORY_WORKING_DIRECTORY",
        "Claude working directory must not be inside a repository",
      );
    } catch (error) {
      if (error instanceof ClaudeSessionError) {
        throw error;
      }
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      return;
    }
    cursor = parent;
  }
}

function assertController(controller, transmission) {
  assertExactKeys(
    controller,
    [
      "initialInput",
      "maxTurns",
      "onApprovalRequest",
      "onTurnCompleted",
      "schemaVersion",
    ],
    "controller",
  );
  if (
    controller.schemaVersion !== 1 ||
    controller.maxTurns !== 1 ||
    transmission.continuationPolicy.maxTurns !== 1 ||
    !Object.isFrozen(controller) ||
    !Object.isFrozen(controller.initialInput) ||
    controller.initialInput.length !== 1 ||
    typeof controller.onTurnCompleted !== "function" ||
    typeof controller.onApprovalRequest !== "function"
  ) {
    throw sessionError(
      "capability-rejected",
      "CONTROLLER_UNREPRESENTABLE",
      "Claude accepts only an immutable one-turn controller",
    );
  }
  const item = controller.initialInput[0];
  assertExactKeys(item, ["text", "type"], "controller initial input");
  if (
    !Object.isFrozen(item) ||
    item.type !== "text" ||
    typeof item.text !== "string" ||
    item.text.length === 0
  ) {
    throw sessionError(
      "capability-rejected",
      "CONTROLLER_UNREPRESENTABLE",
      "Claude initial input must contain one immutable text item",
    );
  }
  return item.text;
}

function inputById(transmission, id) {
  const found = transmission.harnessControlledInputs.find(
    (input) => input.id === id,
  );
  if (found === undefined) {
    throw sessionError(
      "preflight-rejected",
      "INPUT_BINDING_INVALID",
      `Claude input binding is missing: ${id}`,
    );
  }
  return found;
}

async function assertInputFile(transmission, id, path) {
  assertNonemptyString(path, `input path ${id}`);
  const expected = inputById(transmission, id);
  const bytes = await readFile(path);
  if (
    bytes.byteLength !== expected.byteLength ||
    sha256Hex(bytes) !== expected.sha256
  ) {
    throw sessionError(
      "preflight-rejected",
      "INPUT_DRIFT",
      `Claude input bytes drifted: ${id}`,
    );
  }
}

function assertRequest(context) {
  assertExactKeys(
    context,
    ["evidence", "launchCapability", "request", "signal", "transmission"],
    "Claude adapter context",
  );
  assertExactKeys(
    context.request,
    [
      "authentication",
      "controller",
      "inputIds",
      "inputPaths",
      "maxBudgetUsd",
      "timeoutMs",
      "toolchain",
    ],
    "Claude adapter request",
  );
  assertExactKeys(
    context.request.inputIds,
    ["instructions", "mcpConfig", "prompt"],
    "Claude input IDs",
  );
  assertExactKeys(
    context.request.inputPaths,
    ["instructions", "mcpConfig", "prompt"],
    "Claude input paths",
  );
  if (!/^\d+(?:\.\d+)?$/u.test(context.request.maxBudgetUsd)) {
    fail("maxBudgetUsd must be a nonnegative decimal string");
  }
  if (
    context.transmission.provider !== "anthropic" ||
    context.transmission.transport !== "claude-cli" ||
    !sameCanonical(context.request.toolchain, context.transmission.toolchain)
  ) {
    throw sessionError(
      "preflight-rejected",
      "REQUEST_BINDING_INVALID",
      "Claude request does not match the packet",
    );
  }
}

function parseJsonl(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw sessionError(
      "protocol-failed",
      "INVALID_UTF8",
      "Claude stream is not valid UTF-8",
    );
  }
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    throw sessionError(
      "protocol-failed",
      "INVALID_JSONL",
      "Claude stream contains an empty frame",
    );
  }
  return lines.map((line) => {
    try {
      const event = JSON.parse(line);
      assertPlainObject(event, "Claude stream event");
      return event;
    } catch (error) {
      if (error instanceof ClaudeSessionError) {
        throw error;
      }
      throw sessionError(
        "protocol-failed",
        "INVALID_JSONL",
        "Claude stream contains invalid JSON",
      );
    }
  });
}

function usageFromResult(result) {
  assertPlainObject(result.usage, "Claude result usage");
  const inputTokens = result.usage.input_tokens;
  const cachedInputTokens = result.usage.cache_read_input_tokens;
  const outputTokens = result.usage.output_tokens;
  const costUsd = result.total_cost_usd;
  for (const [label, value] of Object.entries({
    inputTokens,
    cachedInputTokens,
    outputTokens,
    costUsd,
  })) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw sessionError(
        "protocol-failed",
        "INVALID_USAGE",
        `Claude result has invalid ${label}`,
      );
    }
  }
  return {
    nativeUsage: immutable({
      usage: result.usage,
      modelUsage: result.modelUsage ?? null,
      total_cost_usd: costUsd,
    }),
    normalizedUsage: {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd,
    },
  };
}

function authoritativeResult(events) {
  const results = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === "result");
  if (results.length !== 1 || results[0].index !== events.length - 1) {
    throw sessionError(
      "protocol-failed",
      "INVALID_RESULT_COUNT",
      "Claude stream must end with exactly one result event",
    );
  }
  const { event, index } = results[0];
  if (event.is_error === true || event.subtype !== "success") {
    throw sessionError(
      "provider-failed",
      "PROVIDER_ERROR",
      typeof event.result === "string"
        ? event.result
        : "Claude provider failed",
    );
  }
  if (typeof event.result !== "string" || event.result.length === 0) {
    throw sessionError(
      "protocol-failed",
      "EMPTY_FINAL_RESULT",
      "Claude returned an empty final result",
    );
  }
  return { event, index };
}

function validateDecision(decision) {
  assertPlainObject(decision, "controller decision");
  if (decision.action === "complete") {
    assertExactKeys(decision, ["action", "suiteResult"], "complete decision");
    return decision;
  }
  if (decision.action === "reject") {
    assertExactKeys(
      decision,
      ["action", "failureClass", "reason"],
      "reject decision",
    );
    if (
      !FAILURE_CLASSES.has(decision.failureClass) ||
      typeof decision.reason !== "string" ||
      decision.reason.length === 0
    ) {
      throw sessionError(
        "controller-failed",
        "INVALID_CONTROLLER_DECISION",
        "Claude controller returned an invalid rejection",
      );
    }
    throw sessionError(
      decision.failureClass,
      "CONTROLLER_REJECTED",
      decision.reason,
    );
  }
  throw sessionError(
    "controller-failed",
    "INVALID_CONTROLLER_DECISION",
    "Claude one-turn controller must complete or reject",
  );
}

async function executeModel(context, environment, prompt) {
  const { request, transmission } = context;
  await consumeExternalModelLaunch(context.launchCapability, {
    provider: transmission.provider,
    model: transmission.model,
    effort: transmission.effort,
    transmissionSha256: sha256Hex(canonicalJsonBytes(transmission)),
  });
  const argumentsList = [
    ...request.toolchain.prefixArguments,
    "-p",
    "--safe-mode",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--no-chrome",
    "--prompt-suggestions",
    "false",
    "--permission-mode",
    "dontAsk",
    "--tools",
    TOOL_ALLOWLIST,
    "--allowedTools",
    TOOL_ALLOWLIST,
    "--disallowedTools",
    "mcp__*",
    "--mcp-config",
    request.inputPaths.mcpConfig,
    "--strict-mcp-config",
    "--input-format",
    "text",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    transmission.model,
    "--effort",
    transmission.effort,
    "--max-turns",
    "1",
    "--max-budget-usd",
    request.maxBudgetUsd,
    "--append-system-prompt-file",
    request.inputPaths.instructions,
  ];
  await context.evidence.appendNormalizedEvent({
    schemaVersion: 1,
    provider: "anthropic",
    type: "process-launch",
    command: request.toolchain.command.path,
    arguments: argumentsList,
    cwd: transmission.isolation.workingDirectory,
    environmentNames: Object.keys(environment).sort(),
  });
  let child;
  try {
    child = spawn(request.toolchain.command.path, argumentsList, {
      cwd: transmission.isolation.workingDirectory,
      env: environment,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    const failure = sessionError(
      "launch-failed",
      "SPAWN_FAILED",
      error.message,
    );
    failure.closure = safeClosureNotStarted();
    throw failure;
  }
  const exitPromise = waitForEvent(child, "exit");
  const closePromise = waitForEvent(child, "close");
  const errorPromise = waitForEvent(child, "error").then(([error]) => {
    throw sessionError("launch-failed", "SPAWN_FAILED", error.message);
  });
  const stdoutPromise = readStream(child.stdout, (bytes) =>
    context.evidence.appendTranscript(bytes),
  );
  const stderrPromise = readStream(child.stderr, (bytes) =>
    context.evidence.appendStderr(bytes),
  );
  child.stdin.end(prompt, "utf8");
  let timer;
  let abortListener;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          sessionError("timed-out", "TIMEOUT", "Claude model turn timed out"),
        ),
      request.timeoutMs,
    );
    abortListener = () =>
      reject(
        sessionError("timed-out", "ABORTED", "Claude model turn was aborted"),
      );
    context.signal?.addEventListener("abort", abortListener, { once: true });
  });
  try {
    const [[exitCode, exitSignal], stdout] = await Promise.race([
      Promise.all([closePromise, stdoutPromise, stderrPromise]),
      errorPromise,
      timeoutPromise,
    ]);
    const closure = safeClosure({ exitCode, exitSignal });
    if (exitCode !== 0) {
      const error = sessionError(
        "provider-failed",
        "NONZERO_EXIT",
        `Claude exited with code ${exitCode}`,
      );
      error.closure = closure;
      throw error;
    }
    return { stdout, closure };
  } catch (error) {
    if (error.closure === undefined) {
      error.closure = await terminateChild(child, exitPromise, closePromise);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener("abort", abortListener);
  }
}

async function runAdapter(context) {
  assertRequest(context);
  assertToolchainShape(context.request.toolchain);
  assertCapabilities(context.transmission);
  const environment = assertIsolation(context.transmission);
  const prompt = assertController(
    context.request.controller,
    context.transmission,
  );
  await assertFreshWorkingDirectory(
    context.transmission.isolation.workingDirectory,
  );
  const currentToolchain = await inspectClaudeCliToolchain({
    command: context.request.toolchain.command.path,
    prefixArguments: context.request.toolchain.prefixArguments,
    environment,
  });
  if (!sameCanonical(currentToolchain, context.request.toolchain)) {
    throw sessionError(
      "preflight-rejected",
      "TOOLCHAIN_DRIFT",
      "Claude executable, version, prefix file, help, or capability profile drifted",
    );
  }
  const currentAuthentication = await preflightClaudeAuth({
    toolchain: currentToolchain,
    environment,
    timeoutMs: context.request.timeoutMs,
    signal: context.signal,
  });
  if (
    currentAuthentication.status !== "authenticated" ||
    currentAuthentication.authMode !== "oauth-keychain" ||
    !sameCanonical(currentAuthentication, context.request.authentication)
  ) {
    throw sessionError(
      "preflight-rejected",
      "AUTHENTICATION_DRIFT",
      "Claude OAuth/keychain authentication changed after preparation",
    );
  }
  await assertInputFile(
    context.transmission,
    context.request.inputIds.prompt,
    context.request.inputPaths.prompt,
  );
  await assertInputFile(
    context.transmission,
    context.request.inputIds.instructions,
    context.request.inputPaths.instructions,
  );
  await assertInputFile(
    context.transmission,
    context.request.inputIds.mcpConfig,
    context.request.inputPaths.mcpConfig,
  );
  const operation = await executeModel(context, environment, prompt);
  const events = parseJsonl(operation.stdout);
  for (const [nativeEventIndex, event] of events.entries()) {
    await context.evidence.appendNormalizedEvent({
      schemaVersion: 1,
      provider: "anthropic",
      type: "native-event",
      nativeEventIndex,
      nativeType: typeof event.type === "string" ? event.type : null,
    });
  }
  const authoritative = authoritativeResult(events);
  const usage = usageFromResult(authoritative.event);
  const turnEvent = immutable({
    turnIndex: 1,
    status: "completed",
    finalAnswer: authoritative.event.result,
    nativeUsage: usage.nativeUsage,
    nativeEventRange: { first: 0, last: authoritative.index },
  });
  await context.evidence.appendNormalizedEvent({
    schemaVersion: 1,
    provider: "anthropic",
    type: "turn-completed",
    ...turnEvent,
  });
  let decision;
  try {
    decision = validateDecision(
      await context.request.controller.onTurnCompleted(turnEvent),
    );
  } catch (error) {
    if (error instanceof ClaudeSessionError) {
      error.closure = operation.closure;
      error.nativeUsage = usage.nativeUsage;
      error.normalizedUsage = usage.normalizedUsage;
      throw error;
    }
    const failure = sessionError(
      "controller-failed",
      "CONTROLLER_FAILED",
      "Claude controller failed while handling completion",
    );
    failure.closure = operation.closure;
    failure.nativeUsage = usage.nativeUsage;
    failure.normalizedUsage = usage.normalizedUsage;
    throw failure;
  }
  await context.evidence.appendNormalizedEvent({
    schemaVersion: 1,
    provider: "anthropic",
    type: "controller-decision",
    action: "complete",
    turnIndex: 1,
  });
  await context.evidence.writeFinal(
    Buffer.from(authoritative.event.result, "utf8"),
  );
  return completedResult({
    closure: operation.closure,
    nativeUsage: usage.nativeUsage,
    normalizedUsage: usage.normalizedUsage,
    suiteResult: decision.suiteResult,
  });
}

/** @type {Readonly<ClaudeProviderAdapter>} */
export const claudeCliAdapter = Object.freeze({
  provider: "anthropic",
  async execute(context) {
    try {
      return await runAdapter(context);
    } catch (error) {
      return failedResult(
        error,
        error?.closure ?? safeClosureNotStarted(),
        error?.nativeUsage ?? null,
        error?.normalizedUsage ?? emptyUsage(),
      );
    }
  },
});
