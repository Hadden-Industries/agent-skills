import { spawn } from "node:child_process";
import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { TextDecoder } from "node:util";

import {
  canonicalJsonBytes,
  consumeExternalModelLaunch,
  sha256Hex,
} from "./runtime.js";

const PINNED_VERSION = "1.1.19";
const CODE_EXTENSIONS = new Set([
  ".bat",
  ".bash",
  ".cjs",
  ".cmd",
  ".com",
  ".exe",
  ".fish",
  ".js",
  ".mjs",
  ".ps1",
  ".py",
  ".pyw",
  ".sh",
  ".ts",
  ".zsh",
]);
const FAILURE_CLASSES = new Set([
  "capability-rejected",
  "controller-failed",
  "launch-failed",
  "preflight-rejected",
  "protocol-failed",
  "provider-failed",
  "timed-out",
]);
const MAX_EVENT_BYTES = 16 * 1024 * 1024;
const RESERVED_PREFIX_OPTION_STEMS = Object.freeze([
  "--agent",
  "--allow",
  "--approval",
  "--continue",
  "--conversation",
  "--dangerously",
  "--disable-slash-commands",
  "--effort",
  "--hook",
  "--input-format",
  "--mcp",
  "--model",
  "--network",
  "--output-format",
  "--permission",
  "--plugin",
  "--prompt",
  "--resume",
  "--sandbox",
  "--settings",
  "--skill",
  "--tool",
  "--trust",
  "--web-search",
]);
const EXPECTED_CAPABILITIES = Object.freeze({
  network: false,
  webSearch: false,
  tools: [],
  providerFacilities: ["provider-default-context"],
});
const CAPABILITY_PROFILE = immutable({
  schemaVersion: 1,
  version: PINNED_VERSION,
  authentication: {
    mode: "cached-cli-credentials",
    zeroTurnStatusCommand: null,
  },
  invocation: {
    inputFormat: "stream-json",
    outputFormat: "stream-json",
    sandbox: true,
    slashCommands: false,
    dangerouslySkipPermissions: false,
    permissionMode: "request-review",
    explicitAgent: false,
    processConversationPersistence: true,
    crossProcessConversationPersistence: false,
    observedToolUse: "reject",
    observedSubagentUse: "reject",
  },
});

class AntigravitySessionError extends Error {
  constructor(failureClass, code, message) {
    super(message);
    this.name = "AntigravitySessionError";
    this.failureClass = failureClass;
    this.code = code;
  }
}

function fail(message) {
  throw new TypeError(message);
}

function sessionError(failureClass, code, message) {
  return new AntigravitySessionError(failureClass, code, message);
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
    for (const child of Object.values(value)) deepFreeze(child);
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

function assertReviewedPrefixArguments(prefixArguments) {
  const argumentsList = assertArguments(prefixArguments);
  for (const argument of argumentsList) {
    if (
      CODE_EXTENSIONS.has(extname(argument).toLowerCase()) &&
      !isAbsolute(argument)
    ) {
      fail(`Antigravity prefix executable file must be absolute: ${argument}`);
    }
    const optionName = argument.split("=", 1)[0];
    if (
      argument.startsWith("-p") ||
      RESERVED_PREFIX_OPTION_STEMS.some((stem) => optionName.startsWith(stem))
    ) {
      fail(`Antigravity prefix argument is reserved or forbidden: ${argument}`);
    }
  }
  return argumentsList;
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

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function retainStream(stream, retain) {
  const chunks = [];
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    chunks.push(bytes);
    await retain(bytes);
  }
  return Buffer.concat(chunks);
}

async function runCapturedCommand({
  command,
  arguments: commandArguments,
  environment,
  timeoutMs,
}) {
  let child;
  try {
    child = spawn(command, commandArguments, {
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
  const operation = Promise.all([
    closePromise,
    readStream(child.stdout),
    readStream(child.stderr),
  ]);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        sessionError(
          "timed-out",
          "TIMEOUT",
          "Antigravity inspection timed out",
        ),
      );
    }, timeoutMs);
  });
  try {
    const [[exitCode, exitSignal], stdout, stderr] = await Promise.race([
      operation,
      errorPromise,
      timeout,
    ]);
    return { exitCode, exitSignal, stderr, stdout };
  } catch (error) {
    await terminateChild(child, exitPromise, closePromise);
    throw error;
  } finally {
    clearTimeout(timer);
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
    if (!CODE_EXTENSIONS.has(extname(argument).toLowerCase())) continue;
    try {
      const metadata = await stat(argument);
      if (metadata.isFile()) files.push(await fingerprintFile(argument));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return files;
}

function parseVersion(stdout) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(stdout).trim();
  const match = text.match(/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/u);
  if (match === null) {
    throw sessionError(
      "preflight-rejected",
      "INVALID_VERSION",
      "Antigravity returned an invalid version",
    );
  }
  if (match[1] !== PINNED_VERSION) {
    throw sessionError(
      "preflight-rejected",
      "UNSUPPORTED_VERSION",
      `Antigravity ${match[1]} is not the reviewed ${PINNED_VERSION} version`,
    );
  }
  return match[1];
}

/**
 * Fingerprint one Antigravity executable and select its reviewed profile.
 *
 * @param {{command: string, prefixArguments: string[], environment: Record<string, string>}} options
 * @returns {Promise<Readonly<Record<string, unknown>>>}
 */
export async function inspectAntigravityCliToolchain({
  command,
  prefixArguments,
  environment,
}) {
  assertNonemptyString(command, "command");
  if (!isAbsolute(command)) fail("command must be an absolute path");
  const boundArguments = assertReviewedPrefixArguments(prefixArguments);
  const boundEnvironment = assertEnvironment(environment);
  const commandIdentity = await fingerprintFile(command);
  const versionProbe = await runCapturedCommand({
    command: commandIdentity.path,
    arguments: [...boundArguments, "--version"],
    environment: boundEnvironment,
    timeoutMs: 5_000,
  });
  if (versionProbe.exitCode !== 0 || versionProbe.exitSignal !== null) {
    throw sessionError(
      "preflight-rejected",
      "VERSION_PROBE_FAILED",
      "Antigravity version probe failed",
    );
  }
  const version = parseVersion(versionProbe.stdout);
  const helpProbe = await runCapturedCommand({
    command: commandIdentity.path,
    arguments: [...boundArguments, "--help"],
    environment: boundEnvironment,
    timeoutMs: 5_000,
  });
  if (helpProbe.exitCode !== 0 || helpProbe.exitSignal !== null) {
    throw sessionError(
      "preflight-rejected",
      "HELP_PROBE_FAILED",
      "Antigravity help probe failed",
    );
  }
  return immutable({
    schemaVersion: 1,
    provider: "google",
    transport: "antigravity-cli",
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

function safeClosureNotStarted() {
  return {
    status: "safe",
    exitStatus: "not-started",
    exitCode: null,
    exitSignal: null,
    stdioStatus: "not-opened",
    protocolStatus: "not-opened",
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
    protocolStatus: "closed",
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
      typeof error?.code === "string"
        ? error.code
        : "ANTIGRAVITY_SESSION_FAILED",
    message:
      typeof error?.message === "string"
        ? error.message
        : "Antigravity session failed",
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
  return {
    status: "failed",
    failureClass: FAILURE_CLASSES.has(error?.failureClass)
      ? error.failureClass
      : "provider-failed",
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

function assertToolchainShape(toolchain) {
  assertPlainObject(toolchain, "toolchain");
  if (
    toolchain.schemaVersion !== 1 ||
    toolchain.provider !== "google" ||
    toolchain.transport !== "antigravity-cli" ||
    toolchain.version !== PINNED_VERSION ||
    !sameCanonical(toolchain.capabilityProfile, CAPABILITY_PROFILE)
  ) {
    throw sessionError(
      "preflight-rejected",
      "UNSUPPORTED_TOOLCHAIN",
      "Antigravity toolchain does not match the reviewed capability profile",
    );
  }
  assertPlainObject(toolchain.command, "toolchain command");
  assertNonemptyString(toolchain.command.path, "toolchain command path");
  assertReviewedPrefixArguments(toolchain.prefixArguments);
}

function assertCapabilities(transmission) {
  if (!sameCanonical(transmission.capabilities, EXPECTED_CAPABILITIES)) {
    throw sessionError(
      "capability-rejected",
      "CAPABILITY_UNREPRESENTABLE",
      "Antigravity supports only the reviewed policy-evaluation capability profile",
    );
  }
}

function assertIsolation(transmission) {
  const isolation = transmission.isolation;
  assertPlainObject(isolation, "isolation");
  if (
    isolation.sandbox !== "read-only" ||
    isolation.persistence !== false ||
    isolation.stableHome !== null ||
    !isAbsolute(isolation.workingDirectory) ||
    !sameCanonical(isolation.instructionSources, ["packet-bound-user-message"])
  ) {
    throw sessionError(
      "capability-rejected",
      "ISOLATION_UNREPRESENTABLE",
      "Antigravity requires an absolute non-persistent policy workspace",
    );
  }
  assertPlainObject(isolation.environment, "isolation environment");
  if (
    !Array.isArray(isolation.environment.secretSources) ||
    isolation.environment.secretSources.length !== 0
  ) {
    throw sessionError(
      "capability-rejected",
      "SECRET_ENVIRONMENT_FORBIDDEN",
      "Antigravity policy evaluations do not accept secret environment sources",
    );
  }
  for (const name of Object.keys(isolation.environment.values)) {
    if (/^(?:ANTIGRAVITY|GEMINI|GOOGLE)/iu.test(name)) {
      throw sessionError(
        "capability-rejected",
        "SECRET_ENVIRONMENT_FORBIDDEN",
        "Antigravity authentication environment names are forbidden",
      );
    }
  }
  return assertEnvironment(isolation.environment.values);
}

async function assertFreshWorkingDirectory(path) {
  const entries = await readdir(path);
  if (entries.length !== 0) {
    throw sessionError(
      "capability-rejected",
      "WORKING_DIRECTORY_NOT_EMPTY",
      "Antigravity policy working directory must be empty",
    );
  }
  let cursor = resolve(path);
  while (true) {
    try {
      await access(resolve(cursor, ".git"));
      throw sessionError(
        "capability-rejected",
        "REPOSITORY_WORKING_DIRECTORY",
        "Antigravity policy working directory must not be inside a repository",
      );
    } catch (error) {
      if (error instanceof AntigravitySessionError) throw error;
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

function assertTextInput(input, label) {
  if (!Array.isArray(input) || input.length === 0) {
    fail(`${label} must be a nonempty array`);
  }
  for (const [index, item] of input.entries()) {
    assertExactKeys(item, ["text", "type"], `${label}[${index}]`);
    if (item.type !== "text") fail(`${label}[${index}].type must be text`);
    assertNonemptyString(item.text, `${label}[${index}].text`);
  }
}

function assertController(controller, continuationPolicy) {
  assertExactKeys(
    continuationPolicy,
    ["allowedTransitions", "controllerSha256", "maxTurns", "templates"],
    "continuationPolicy",
  );
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
    !Number.isSafeInteger(controller.maxTurns) ||
    controller.maxTurns <= 0 ||
    controller.maxTurns > 32 ||
    controller.maxTurns !== continuationPolicy.maxTurns ||
    typeof controller.onTurnCompleted !== "function" ||
    typeof controller.onApprovalRequest !== "function" ||
    !Object.isFrozen(controller) ||
    !Object.isFrozen(controller.initialInput) ||
    controller.initialInput.some((item) => !Object.isFrozen(item))
  ) {
    throw sessionError(
      "capability-rejected",
      "CONTROLLER_UNREPRESENTABLE",
      "Antigravity controller does not match the bounded continuation policy",
    );
  }
  assertTextInput(controller.initialInput, "controller.initialInput");
}

function packetTextInputs(transmission, role) {
  const records = transmission.harnessControlledInputs.filter(
    (input) => input.role === role,
  );
  for (const input of records) {
    if (
      input.encoding !== "utf8" ||
      !["text/markdown", "text/plain"].includes(input.mediaType)
    ) {
      fail(`packet-bound ${role} input must be UTF-8 text`);
    }
  }
  return records;
}

function assertPacketControlledInputs(transmission, controller) {
  const users = packetTextInputs(transmission, "user");
  const continuations = packetTextInputs(transmission, "continuation");
  const expectedInitial = users.map(({ content }) => ({
    type: "text",
    text: content,
  }));
  if (!sameCanonical(expectedInitial, controller.initialInput)) {
    throw sessionError(
      "preflight-rejected",
      "INPUT_BINDING_INVALID",
      "Antigravity initial input does not match packet-bound user bytes",
    );
  }
  const templateInputs = transmission.continuationPolicy.templates.flatMap(
    (template, index) => {
      assertPlainObject(template, `continuation template ${index}`);
      assertTextInput(template.input, `continuation template ${index}.input`);
      return template.input;
    },
  );
  if (
    !sameCanonical(
      continuations.map(({ content }) => content),
      templateInputs.map(({ text }) => text),
    )
  ) {
    throw sessionError(
      "preflight-rejected",
      "INPUT_BINDING_INVALID",
      "Antigravity continuations do not match packet-bound templates",
    );
  }
}

function assertRequest(context) {
  assertExactKeys(
    context,
    ["evidence", "launchCapability", "request", "signal", "transmission"],
    "Antigravity adapter context",
  );
  assertExactKeys(
    context.request,
    ["controller", "timeoutMs", "toolchain"],
    "Antigravity adapter request",
  );
  if (
    context.transmission.provider !== "google" ||
    context.transmission.transport !== "antigravity-cli" ||
    !sameCanonical(context.request.toolchain, context.transmission.toolchain) ||
    !Number.isSafeInteger(context.request.timeoutMs) ||
    context.request.timeoutMs <= 0
  ) {
    throw sessionError(
      "preflight-rejected",
      "REQUEST_BINDING_INVALID",
      "Antigravity request does not match its packet",
    );
  }
  assertController(
    context.request.controller,
    context.transmission.continuationPolicy,
  );
  assertPacketControlledInputs(
    context.transmission,
    context.request.controller,
  );
}

async function* parseJsonlStream(stream, evidence) {
  let pending = Buffer.alloc(0);
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    await evidence.appendTranscript(bytes);
    pending = Buffer.concat([pending, bytes]);
    if (pending.byteLength > MAX_EVENT_BYTES && !pending.includes(0x0a)) {
      throw sessionError(
        "protocol-failed",
        "EVENT_TOO_LARGE",
        "Antigravity emitted an oversized stream event",
      );
    }
    let newline;
    while ((newline = pending.indexOf(0x0a)) !== -1) {
      const line = pending.subarray(0, newline);
      pending = pending.subarray(newline + 1);
      if (line.byteLength === 0 || line.byteLength > MAX_EVENT_BYTES) {
        throw sessionError(
          "protocol-failed",
          "INVALID_JSONL",
          "Antigravity emitted an invalid stream frame",
        );
      }
      let event;
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(line);
        event = JSON.parse(text);
        assertPlainObject(event, "Antigravity stream event");
      } catch (error) {
        if (error instanceof AntigravitySessionError) throw error;
        throw sessionError(
          "protocol-failed",
          "INVALID_JSONL",
          "Antigravity emitted invalid UTF-8 or JSON",
        );
      }
      yield event;
    }
  }
  if (pending.byteLength !== 0) {
    throw sessionError(
      "protocol-failed",
      "UNTERMINATED_JSONL",
      "Antigravity stream ended with an unterminated frame",
    );
  }
}

function comparablePath(path) {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function validateInit(event, transmission) {
  if (event.event !== "init") {
    throw sessionError(
      "protocol-failed",
      "MISSING_INIT",
      "Antigravity stream did not begin with init",
    );
  }
  assertNonemptyString(event.conversation_id, "init conversation_id");
  assertPlainObject(event.init, "init payload");
  if (
    comparablePath(event.init.cwd) !==
      comparablePath(transmission.isolation.workingDirectory) ||
    event.init.model !== transmission.model ||
    event.init.permission_mode !== "request-review" ||
    Object.hasOwn(event.init, "agent")
  ) {
    throw sessionError(
      "capability-rejected",
      "INIT_CAPABILITY_DRIFT",
      "Antigravity effective model, workspace, agent, or permission mode drifted",
    );
  }
  if (
    !Array.isArray(event.init.tools) ||
    event.init.tools.some(
      (tool) => typeof tool !== "string" || tool.length === 0,
    )
  ) {
    throw sessionError(
      "protocol-failed",
      "INVALID_INIT",
      "Antigravity init contains an invalid tool inventory",
    );
  }
  const externalTools = event.init.tools.filter((tool) =>
    /(?:^|__)(?:mcp|plugin)(?:__|$)/iu.test(tool),
  );
  if (externalTools.length !== 0) {
    throw sessionError(
      "capability-rejected",
      "EXTERNAL_FACILITY_VISIBLE",
      "Antigravity advertised an external plugin or MCP facility",
    );
  }
  return Object.freeze({
    conversationId: event.conversation_id,
    tools: Object.freeze([...event.init.tools]),
  });
}

function validateStep(event, conversationId) {
  if (event.event !== "step_update") return false;
  const step = event.step_update;
  assertPlainObject(step, "step_update payload");
  if (
    step.conversation_id !== conversationId ||
    !Number.isSafeInteger(step.step_index) ||
    step.step_index < 0 ||
    !["ACTIVE", "DONE"].includes(step.state) ||
    !["agent_response", "checkpoint", "user_input", "tool"].includes(
      step.step_type,
    )
  ) {
    throw sessionError(
      "protocol-failed",
      "INVALID_STEP",
      "Antigravity emitted an invalid step update",
    );
  }
  if (
    step.step_type === "tool" ||
    (Object.hasOwn(step, "subagent_info") && step.subagent_info !== null)
  ) {
    throw sessionError(
      "capability-rejected",
      "FORBIDDEN_MODEL_CAPABILITY",
      "Antigravity attempted a tool or subagent step",
    );
  }
  return true;
}

function usageFromResult(result, previousUsage) {
  assertPlainObject(result.usage, "Antigravity result usage");
  const native = result.usage;
  const fields = [
    "input_tokens",
    "output_tokens",
    "thinking_tokens",
    "cache_read_tokens",
    "total_tokens",
  ];
  for (const name of fields) {
    if (!Number.isSafeInteger(native[name]) || native[name] < 0) {
      throw sessionError(
        "protocol-failed",
        "INVALID_USAGE",
        `Antigravity result has invalid ${name}`,
      );
    }
    if (previousUsage !== null && native[name] < previousUsage[name]) {
      throw sessionError(
        "protocol-failed",
        "NONCUMULATIVE_USAGE",
        "Antigravity cumulative usage decreased between turns",
      );
    }
  }
  if (native.input_tokens + native.output_tokens !== native.total_tokens) {
    throw sessionError(
      "protocol-failed",
      "INVALID_USAGE",
      "Antigravity token totals are inconsistent",
    );
  }
  return {
    nativeUsage: immutable({
      durationSeconds: result.duration_seconds,
      numTurns: result.num_turns,
      usage: native,
    }),
    normalizedUsage: {
      inputTokens: native.input_tokens,
      cachedInputTokens: native.cache_read_tokens,
      outputTokens: native.output_tokens,
      totalTokens: native.total_tokens,
      costUsd: null,
    },
  };
}

function validateResult(event, { conversationId, turnIndex, previousUsage }) {
  if (event.event !== "result") {
    throw sessionError(
      "protocol-failed",
      "UNKNOWN_EVENT",
      `Antigravity emitted unsupported event ${String(event.event)}`,
    );
  }
  const result = event.result;
  assertPlainObject(result, "result payload");
  if (
    result.conversation_id !== conversationId ||
    result.num_turns !== turnIndex ||
    typeof result.duration_seconds !== "number" ||
    !Number.isFinite(result.duration_seconds) ||
    result.duration_seconds < 0
  ) {
    throw sessionError(
      "protocol-failed",
      "INVALID_RESULT",
      "Antigravity emitted an invalid terminal result",
    );
  }
  const usage = usageFromResult(result, previousUsage);
  if (result.status !== "SUCCESS") {
    const error = sessionError(
      "provider-failed",
      "PROVIDER_ERROR",
      "Antigravity provider did not complete successfully",
    );
    error.nativeUsage = usage.nativeUsage;
    error.normalizedUsage = usage.normalizedUsage;
    throw error;
  }
  if (typeof result.response !== "string" || result.response.length === 0) {
    throw sessionError(
      "protocol-failed",
      "EMPTY_FINAL_RESULT",
      "Antigravity returned an empty response",
    );
  }
  return { result, ...usage };
}

function continuationIsAllowed(decision, continuationPolicy) {
  if (!continuationPolicy.allowedTransitions.includes(decision.transitionId)) {
    return false;
  }
  const template = continuationPolicy.templates.find(
    ({ transitionId }) => transitionId === decision.transitionId,
  );
  return (
    template !== undefined && sameCanonical(template.input, decision.input)
  );
}

function validateDecision(decision, turnIndex, transmission) {
  assertPlainObject(decision, "controller decision");
  if (decision.action === "complete") {
    assertExactKeys(decision, ["action", "suiteResult"], "complete decision");
    canonicalJsonBytes(decision.suiteResult);
    return immutable(decision);
  }
  if (decision.action === "continue") {
    assertExactKeys(
      decision,
      ["action", "input", "transitionId"],
      "continue decision",
    );
    assertNonemptyString(decision.transitionId, "continue transitionId");
    assertTextInput(decision.input, "continue input");
    if (
      turnIndex >= transmission.continuationPolicy.maxTurns ||
      !continuationIsAllowed(decision, transmission.continuationPolicy)
    ) {
      throw sessionError(
        "controller-failed",
        "UNAUTHORIZED_CONTINUATION",
        "Antigravity continuation is not packet-authorized",
      );
    }
    return immutable(decision);
  }
  if (decision.action === "reject") {
    assertExactKeys(
      decision,
      ["action", "failureClass", "reason"],
      "reject decision",
    );
    if (!FAILURE_CLASSES.has(decision.failureClass)) {
      fail("controller rejection has an unsupported failure class");
    }
    assertNonemptyString(decision.reason, "controller rejection reason");
    throw sessionError(
      decision.failureClass,
      "CONTROLLER_REJECTED",
      decision.reason,
    );
  }
  throw sessionError(
    "controller-failed",
    "INVALID_CONTROLLER_DECISION",
    "Antigravity controller returned an invalid decision",
  );
}

function inputFrame(input) {
  assertTextInput(input, "Antigravity user input");
  return {
    event: "user",
    message: {
      content: input.map(({ type, text }) => ({ type, text })),
    },
  };
}

async function writeInput(child, evidence, input, turnIndex) {
  const bytes = Buffer.concat([
    canonicalJsonBytes(inputFrame(input)),
    Buffer.from("\n", "utf8"),
  ]);
  await new Promise((resolvePromise, reject) => {
    child.stdin.write(bytes, (error) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
  await evidence.appendNormalizedEvent({
    schemaVersion: 1,
    provider: "google",
    type: "user-input",
    turnIndex,
    byteLength: bytes.byteLength,
    sha256: sha256Hex(bytes),
  });
}

async function driveProtocol(context, child) {
  const { controller } = context.request;
  let init = null;
  let eventIndex = -1;
  let turnIndex = 1;
  let turnFirstEvent = 0;
  let previousUsage = null;
  let completed = null;

  await writeInput(child, context.evidence, controller.initialInput, turnIndex);
  for await (const event of parseJsonlStream(child.stdout, context.evidence)) {
    eventIndex += 1;
    if (completed !== null) {
      throw sessionError(
        "protocol-failed",
        "EVENT_AFTER_COMPLETION",
        "Antigravity emitted an event after controller completion",
      );
    }
    const nativeType = typeof event.event === "string" ? event.event : null;
    await context.evidence.appendNormalizedEvent({
      schemaVersion: 1,
      provider: "google",
      type: "native-event",
      nativeEventIndex: eventIndex,
      nativeType,
    });
    if (init === null) {
      init = validateInit(event, context.transmission);
      await context.evidence.appendNormalizedEvent({
        schemaVersion: 1,
        provider: "google",
        type: "init-attestation",
        conversationId: init.conversationId,
        advertisedTools: init.tools,
        permissionMode: "request-review",
        model: context.transmission.model,
      });
      turnFirstEvent = eventIndex + 1;
      continue;
    }
    if (event.event === "init") {
      throw sessionError(
        "protocol-failed",
        "DUPLICATE_INIT",
        "Antigravity emitted more than one init event",
      );
    }
    if (validateStep(event, init.conversationId)) continue;

    const terminal = validateResult(event, {
      conversationId: init.conversationId,
      turnIndex,
      previousUsage,
    });
    previousUsage = terminal.result.usage;
    const turnEvent = immutable({
      turnIndex,
      status: "completed",
      finalAnswer: terminal.result.response,
      nativeUsage: terminal.nativeUsage,
      nativeEventRange: { first: turnFirstEvent, last: eventIndex },
    });
    await context.evidence.appendNormalizedEvent({
      schemaVersion: 1,
      provider: "google",
      type: "turn-completed",
      ...turnEvent,
    });
    let decision;
    try {
      decision = validateDecision(
        await controller.onTurnCompleted(turnEvent),
        turnIndex,
        context.transmission,
      );
    } catch (error) {
      if (error instanceof AntigravitySessionError) {
        error.nativeUsage = terminal.nativeUsage;
        error.normalizedUsage = terminal.normalizedUsage;
        throw error;
      }
      const failure = sessionError(
        "controller-failed",
        "CONTROLLER_FAILED",
        "Antigravity controller failed while handling a completed turn",
      );
      failure.nativeUsage = terminal.nativeUsage;
      failure.normalizedUsage = terminal.normalizedUsage;
      throw failure;
    }
    await context.evidence.appendNormalizedEvent({
      schemaVersion: 1,
      provider: "google",
      type: "controller-decision",
      action: decision.action,
      turnIndex,
      transitionId:
        decision.action === "continue" ? decision.transitionId : null,
    });
    if (decision.action === "complete") {
      completed = {
        finalAnswer: terminal.result.response,
        nativeUsage: terminal.nativeUsage,
        normalizedUsage: terminal.normalizedUsage,
        suiteResult: decision.suiteResult,
      };
      child.stdin.end();
      continue;
    }
    turnIndex += 1;
    turnFirstEvent = eventIndex + 1;
    await writeInput(child, context.evidence, decision.input, turnIndex);
  }
  if (init === null || completed === null) {
    throw sessionError(
      "protocol-failed",
      "INCOMPLETE_PROTOCOL",
      "Antigravity stream closed before controller completion",
    );
  }
  return completed;
}

async function executeModel(context, environment) {
  const { request, transmission } = context;
  await consumeExternalModelLaunch(context.launchCapability, {
    provider: transmission.provider,
    model: transmission.model,
    effort: transmission.effort,
    transmissionSha256: sha256Hex(canonicalJsonBytes(transmission)),
  });
  const argumentsList = [
    ...request.toolchain.prefixArguments,
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--model",
    transmission.model,
    "--effort",
    transmission.effort,
    "--sandbox",
    "--disable-slash-commands",
  ];
  await context.evidence.appendNormalizedEvent({
    schemaVersion: 1,
    provider: "google",
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
  const stderrPromise = retainStream(child.stderr, (bytes) =>
    context.evidence.appendStderr(bytes),
  );
  const protocolPromise = driveProtocol(context, child);
  let timer;
  let abortListener;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          sessionError(
            "timed-out",
            "TIMEOUT",
            "Antigravity model session timed out",
          ),
        ),
      request.timeoutMs,
    );
    abortListener = () =>
      reject(
        sessionError(
          "timed-out",
          "ABORTED",
          "Antigravity model session was aborted",
        ),
      );
    context.signal?.addEventListener("abort", abortListener, { once: true });
  });
  try {
    const [[exitCode, exitSignal], protocol] = await Promise.race([
      Promise.all([closePromise, protocolPromise, stderrPromise]).then(
        ([close, result]) => [close, result],
      ),
      errorPromise,
      timeoutPromise,
    ]);
    const closure = safeClosure({ exitCode, exitSignal });
    if (exitCode !== 0 || exitSignal !== null) {
      const error = sessionError(
        "provider-failed",
        "NONZERO_EXIT",
        `Antigravity exited with code ${String(exitCode)}`,
      );
      error.closure = closure;
      error.nativeUsage = protocol.nativeUsage;
      error.normalizedUsage = protocol.normalizedUsage;
      throw error;
    }
    await context.evidence.writeFinal(
      Buffer.from(protocol.finalAnswer, "utf8"),
    );
    return completedResult({
      closure,
      nativeUsage: protocol.nativeUsage,
      normalizedUsage: protocol.normalizedUsage,
      suiteResult: protocol.suiteResult,
    });
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
  await assertFreshWorkingDirectory(
    context.transmission.isolation.workingDirectory,
  );
  const currentToolchain = await inspectAntigravityCliToolchain({
    command: context.request.toolchain.command.path,
    prefixArguments: context.request.toolchain.prefixArguments,
    environment,
  });
  if (!sameCanonical(currentToolchain, context.request.toolchain)) {
    throw sessionError(
      "preflight-rejected",
      "TOOLCHAIN_DRIFT",
      "Antigravity executable, version, prefix file, help, or capability profile drifted",
    );
  }
  return executeModel(context, environment);
}

export const antigravityCliAdapter = Object.freeze({
  provider: "google",
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
