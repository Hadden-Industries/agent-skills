import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  delimiter,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import {
  canonicalJsonBytes,
  consumeExternalModelLaunch,
  sha256Hex,
} from "./runtime.js";

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const DIRECT_WINDOWS_EXECUTABLE_EXTENSIONS = new Set([".com", ".exe"]);
const APP_SERVER_ARGUMENTS = Object.freeze([
  "-c",
  'cli_auth_credentials_store="file"',
  "app-server",
]);
const POLICY_KEYS = Object.freeze([
  "capabilities",
  "effort",
  "instructions",
  "isolation",
  "model",
  "provider",
  "schemaVersion",
]);
const CAPABILITY_KEYS = Object.freeze([
  "network",
  "providerFacilities",
  "tools",
  "webSearch",
]);
const ISOLATION_KEYS = Object.freeze([
  "environment",
  "instructionSources",
  "persistence",
  "runtimeWorkspaceRoots",
  "sandbox",
  "workingDirectory",
]);
const ENVIRONMENT_KEYS = Object.freeze(["secretSources", "values"]);
const INSTRUCTION_KEYS = Object.freeze(["base", "developer"]);
const RUNTIME_FAILURE_CLASSES = new Set([
  "authorization-rejected",
  "capability-rejected",
  "controller-failed",
  "launch-failed",
  "preflight-rejected",
  "protocol-failed",
  "provider-failed",
  "timed-out",
]);

function fail(message) {
  throw new TypeError(message);
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a plain object`);
  }
}

function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((name, index) => name !== wanted[index])
  ) {
    fail(`${label} contains missing or unknown members`);
  }
}

function assertNonemptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a nonempty string`);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function immutableCanonicalSnapshot(value) {
  return deepFreeze(JSON.parse(textDecoder.decode(canonicalJsonBytes(value))));
}

class CodexSessionError extends Error {
  constructor(failureClass, code, message) {
    super(message);
    this.name = "CodexSessionError";
    this.failureClass = failureClass;
    this.code = code;
  }
}

function sessionError(failureClass, code, message) {
  return new CodexSessionError(failureClass, code, message);
}

function safeError(error) {
  const name =
    typeof error?.name === "string" && error.name.length > 0
      ? error.name
      : "Error";
  const code =
    typeof error?.code === "string" && error.code.length > 0
      ? error.code
      : null;
  const message =
    typeof error?.message === "string" && error.message.length > 0
      ? error.message
      : "Codex App Server operation failed";
  return { name, code, message };
}

function assertStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    fail(`${label} must be an array of nonempty strings`);
  }
}

function assertPolicy(policy) {
  assertExactKeys(policy, POLICY_KEYS, "policy");
  if (policy.schemaVersion !== 1) {
    fail("policy.schemaVersion is unsupported");
  }
  if (policy.provider !== "openai") {
    fail("policy.provider must be openai");
  }
  assertNonemptyString(policy.model, "policy.model");
  assertNonemptyString(policy.effort, "policy.effort");
  assertExactKeys(policy.instructions, INSTRUCTION_KEYS, "policy.instructions");
  assertNonemptyString(policy.instructions.base, "policy.instructions.base");
  assertNonemptyString(
    policy.instructions.developer,
    "policy.instructions.developer",
  );

  assertExactKeys(policy.capabilities, CAPABILITY_KEYS, "policy.capabilities");
  if (
    typeof policy.capabilities.network !== "boolean" ||
    typeof policy.capabilities.webSearch !== "boolean"
  ) {
    fail("policy capability switches must be boolean");
  }
  assertStringArray(policy.capabilities.tools, "policy.capabilities.tools");
  assertStringArray(
    policy.capabilities.providerFacilities,
    "policy.capabilities.providerFacilities",
  );

  assertExactKeys(policy.isolation, ISOLATION_KEYS, "policy.isolation");
  if (!isAbsolute(policy.isolation.workingDirectory)) {
    fail("policy.isolation.workingDirectory must be absolute");
  }
  if (
    policy.isolation.sandbox !== "read-only" &&
    policy.isolation.sandbox !== "workspace-write"
  ) {
    fail("policy.isolation.sandbox is unsupported");
  }
  if (policy.isolation.persistence !== false) {
    fail("policy.isolation.persistence must be false");
  }
  assertStringArray(
    policy.isolation.runtimeWorkspaceRoots,
    "policy.isolation.runtimeWorkspaceRoots",
  );
  if (
    policy.isolation.runtimeWorkspaceRoots.some((root) => !isAbsolute(root))
  ) {
    fail("policy runtime workspace roots must be absolute");
  }
  assertStringArray(
    policy.isolation.instructionSources,
    "policy.isolation.instructionSources",
  );
  if (policy.isolation.instructionSources.length !== 0) {
    fail("policy instruction sources must be empty");
  }

  assertExactKeys(
    policy.isolation.environment,
    ENVIRONMENT_KEYS,
    "policy.isolation.environment",
  );
  if (policy.isolation.environment.secretSources.length !== 0) {
    fail("policy secret sources must be empty");
  }
  assertPlainObject(
    policy.isolation.environment.values,
    "policy.isolation.environment.values",
  );
  const environmentNames = new Set();
  for (const [name, value] of Object.entries(
    policy.isolation.environment.values,
  )) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      fail(`policy environment name is invalid: ${name}`);
    }
    if (typeof value !== "string") {
      fail(`policy environment ${name} must be a string`);
    }
    const normalized = name.toUpperCase();
    if (process.platform === "win32" && environmentNames.has(normalized)) {
      fail(`policy environment contains case-colliding name ${name}`);
    }
    environmentNames.add(normalized);
    if (normalized === "OPENAI_API_KEY" || normalized === "CODEX_HOME") {
      fail(`policy environment must not provide ${normalized}`);
    }
  }

  canonicalJsonBytes(policy);
}

async function isRegularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function resolveExecutable(command, environment) {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    const selected = isAbsolute(command) ? command : resolve(command);
    await access(selected);
    return realpath(selected);
  }

  const pathValue = environment.PATH ?? environment.Path ?? environment.path;
  assertNonemptyString(pathValue, "environment.PATH");
  const extensions =
    process.platform === "win32" && extname(command) === ""
      ? (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
      : [""];

  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      if (await isRegularFile(candidate)) {
        return realpath(candidate);
      }
    }
  }

  const error = new Error(`executable not found: ${command}`);
  error.code = "ENOENT";
  throw error;
}

async function fingerprintFile(path) {
  const bytes = await readFile(path);
  return {
    path,
    byteLength: bytes.byteLength,
    sha256: sha256Hex(bytes),
  };
}

function assertDirectWindowsExecutable(executablePath) {
  if (
    process.platform === "win32" &&
    !DIRECT_WINDOWS_EXECUTABLE_EXTENSIONS.has(
      extname(executablePath).toLowerCase(),
    )
  ) {
    fail(
      "Codex App Server requires a direct Windows executable (.exe or .com); wrappers and scripts cannot provide reliable child-process lifecycle evidence. Pass an absolute native executable with --codex-command.",
    );
  }
}

async function boundPrefixFiles(prefixArguments) {
  const files = [];
  for (const [argumentIndex, argument] of prefixArguments.entries()) {
    if (isAbsolute(argument) && (await isRegularFile(argument))) {
      const path = await realpath(argument);
      files.push({ argumentIndex, ...(await fingerprintFile(path)) });
    }
  }
  return files;
}

async function collectProcess(child) {
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (bytes) => stdout.push(Buffer.from(bytes)));
  child.stderr.on("data", (bytes) => stderr.push(Buffer.from(bytes)));

  const outcome = await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
  const stdoutBytes = Buffer.concat(stdout);
  const stderrBytes = Buffer.concat(stderr);

  if (outcome.code !== 0) {
    const error = new Error(
      `Codex command failed with exit code ${outcome.code}: ${stderrBytes.toString("utf8")}`,
    );
    error.code = "CODEX_COMMAND_FAILED";
    error.exitCode = outcome.code;
    error.exitSignal = outcome.signal;
    throw error;
  }
  return { stdoutBytes, stderrBytes };
}

async function runCaptured(command, arguments_, environment) {
  const child = spawn(command, arguments_, {
    env: environment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return collectProcess(child);
}

async function schemaFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await schemaFiles(root, path)));
    } else if (entry.isFile()) {
      const bytes = await readFile(path);
      files.push({
        path: relative(root, path).replaceAll("\\", "/"),
        byteLength: bytes.byteLength,
        sha256: sha256Hex(bytes),
      });
    } else {
      fail(`schema bundle contains a non-file entry: ${path}`);
    }
  }
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

export async function inspectCodexAppServerToolchain({
  command,
  prefixArguments,
  scratchRoot,
  environment,
}) {
  assertNonemptyString(command, "command");
  if (
    !Array.isArray(prefixArguments) ||
    prefixArguments.some(
      (argument) => typeof argument !== "string" || argument.length === 0,
    )
  ) {
    fail("prefixArguments must be an array of nonempty strings");
  }
  assertNonemptyString(scratchRoot, "scratchRoot");
  if (!isAbsolute(scratchRoot)) {
    fail("scratchRoot must be absolute");
  }
  assertPlainObject(environment, "environment");
  const environmentNames = new Set();
  for (const [name, value] of Object.entries(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || typeof value !== "string") {
      fail("toolchain environment must contain only named string values");
    }
    const normalized = process.platform === "win32" ? name.toUpperCase() : name;
    if (environmentNames.has(normalized)) {
      fail(`toolchain environment contains case-colliding name ${name}`);
    }
    environmentNames.add(normalized);
  }
  const boundPrefixArguments = Object.freeze([...prefixArguments]);
  const boundEnvironment = immutableCanonicalSnapshot(environment);

  const executablePath = await resolveExecutable(command, boundEnvironment);
  assertDirectWindowsExecutable(executablePath);
  const executable = await fingerprintFile(executablePath);
  const prefixFiles = await boundPrefixFiles(boundPrefixArguments);
  const { stdoutBytes } = await runCaptured(
    executablePath,
    [...boundPrefixArguments, "--version"],
    boundEnvironment,
  );
  const version = textDecoder.decode(stdoutBytes).trim();
  assertNonemptyString(version, "Codex version output");

  await mkdir(scratchRoot, { mode: 0o700 });
  const schemaRoot = join(scratchRoot, "schema");
  await runCaptured(
    executablePath,
    [
      ...boundPrefixArguments,
      "app-server",
      "generate-json-schema",
      "--out",
      schemaRoot,
    ],
    boundEnvironment,
  );
  const schemaManifest = await schemaFiles(schemaRoot);
  if (schemaManifest.length === 0) {
    fail("Codex generated an empty App Server schema bundle");
  }

  return deepFreeze({
    schemaVersion: 1,
    provider: "openai",
    transport: "codex-app-server",
    command: executable,
    prefixArguments: [...boundPrefixArguments],
    boundPrefixFiles: prefixFiles,
    version,
    protocol: "app-server-v2",
    schemaManifest,
    schemaSha256: sha256Hex(canonicalJsonBytes(schemaManifest)),
  });
}

async function writeCanonicalExclusive(path, value) {
  await writeFile(path, canonicalJsonBytes(value), { flag: "wx", mode: 0o600 });
}

async function openPreflightEvidence(destination, toolchain, policy) {
  await mkdir(destination, { mode: 0o700 });
  await writeCanonicalExclusive(join(destination, "toolchain.json"), toolchain);
  await writeCanonicalExclusive(join(destination, "policy.json"), policy);

  const paths = {
    transcript: join(destination, "transcript.jsonl"),
    events: join(destination, "events.jsonl"),
    stderr: join(destination, "stderr.log"),
  };
  const handles = {
    transcript: await open(paths.transcript, "wx", 0o600),
    events: await open(paths.events, "wx", 0o600),
    stderr: await open(paths.stderr, "wx", 0o600),
  };
  const pending = new Map(
    Object.keys(handles).map((name) => [name, Promise.resolve()]),
  );
  let closed = false;

  async function append(name, bytes) {
    if (closed) {
      fail("preflight evidence is closed");
    }
    const retained = Buffer.from(bytes);
    const operation = pending
      .get(name)
      .then(() => handles[name].write(retained, 0, retained.byteLength, null));
    pending.set(name, operation);
    await operation;
  }

  return {
    async appendTranscript(bytes) {
      await append("transcript", bytes);
    },
    async appendEvent(event) {
      await append(
        "events",
        Buffer.concat([canonicalJsonBytes(event), Buffer.from("\n", "utf8")]),
      );
    },
    appendStderr(bytes) {
      return append("stderr", bytes);
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      const errors = [];
      for (const name of Object.keys(handles)) {
        try {
          await pending.get(name);
          await handles[name].sync();
          await handles[name].close();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "failed to close preflight evidence");
      }
    },
    async writeTerminal(result) {
      if (!closed) {
        fail("preflight streams must close before terminal evidence");
      }
      await writeCanonicalExclusive(
        join(destination, "preflight.json"),
        result,
      );
    },
  };
}

function authenticationRedactionRecord(message, { malformed = false } = {}) {
  const record = {
    evaluationRedaction: {
      method: "account/read",
      redacted: true,
      schemaVersion: 1,
    },
    id:
      message === null || !["number", "string"].includes(typeof message?.id)
        ? null
        : message.id,
  };
  if (malformed) {
    return { ...record, malformed: true };
  }
  if (
    message?.result !== null &&
    typeof message?.result === "object" &&
    !Array.isArray(message.result)
  ) {
    return {
      ...record,
      result: {
        account:
          message.result.account === null
            ? null
            : {
                type:
                  typeof message.result.account?.type === "string"
                    ? message.result.account.type
                    : null,
              },
        requiresOpenaiAuth:
          typeof message.result.requiresOpenaiAuth === "boolean"
            ? message.result.requiresOpenaiAuth
            : null,
      },
    };
  }
  return {
    ...record,
    error: {
      code: ["number", "string"].includes(typeof message?.error?.code)
        ? message.error.code
        : null,
      message: "authentication response redacted",
    },
  };
}

function retainedServerLine(record, message, requestMethod) {
  if (requestMethod !== "account/read") {
    return record.lineBytes;
  }
  return Buffer.concat([
    canonicalJsonBytes(authenticationRedactionRecord(message)),
    record.delimiterBytes,
  ]);
}

function retainedMalformedServerLine(record, authenticationPending) {
  if (!authenticationPending) {
    return record.lineBytes;
  }
  return Buffer.concat([
    canonicalJsonBytes(
      authenticationRedactionRecord(null, { malformed: true }),
    ),
    record.delimiterBytes,
  ]);
}

function responseError(message, requestMethod) {
  const error = sessionError(
    "protocol-failed",
    "JSON_RPC_ERROR",
    `Codex App Server ${requestMethod} returned a JSON-RPC error`,
  );
  error.rpcError = message.error;
  return error;
}

function isAlreadyEphemeralError(error) {
  return /thread is not persisted and cannot be deleted/iu.test(
    error?.rpcError?.message ?? "",
  );
}

async function* readJsonlRecords(stream) {
  let pending = Buffer.alloc(0);
  for await (const chunk of stream) {
    pending =
      pending.byteLength === 0
        ? Buffer.from(chunk)
        : Buffer.concat([pending, Buffer.from(chunk)]);
    let newlineIndex = pending.indexOf(0x0a);
    while (newlineIndex >= 0) {
      const hasCarriageReturn =
        newlineIndex > 0 && pending[newlineIndex - 1] === 0x0d;
      const contentEnd = hasCarriageReturn ? newlineIndex - 1 : newlineIndex;
      yield {
        delimiterBytes: Buffer.from(
          pending.subarray(contentEnd, newlineIndex + 1),
        ),
        jsonBytes: Buffer.from(pending.subarray(0, contentEnd)),
        lineBytes: Buffer.from(pending.subarray(0, newlineIndex + 1)),
      };
      pending = pending.subarray(newlineIndex + 1);
      newlineIndex = pending.indexOf(0x0a);
    }
  }
  if (pending.byteLength > 0) {
    yield {
      delimiterBytes: Buffer.alloc(0),
      jsonBytes: Buffer.from(pending),
      lineBytes: Buffer.from(pending),
    };
  }
}

class JsonlRpcClient {
  constructor({ child, evidence, onNotification, onServerRequest }) {
    this.child = child;
    this.evidence = evidence;
    this.onNotification = onNotification;
    this.onServerRequest = onServerRequest;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.resolvedIds = new Set();
    this.protocolError = null;
    this.eventIndex = 0;
    this.nativeMessageIndex = 0;
    this.notifications = [];
    this.notificationWaiters = new Set();
    this.writePending = Promise.resolve();
    this.stderrPending = Promise.resolve();
    this.exitObserved = false;
    this.closeObserved = false;
    this.exitCode = null;
    this.exitSignal = null;
    this.readerClosed = false;
    this.spawnError = null;

    child.once("error", (error) => {
      this.spawnError = sessionError(
        "launch-failed",
        typeof error?.code === "string" ? error.code : "SPAWN_FAILED",
        "Codex App Server process could not be started",
      );
      this.#failProtocol(this.spawnError);
    });

    this.exitPromise = new Promise((resolvePromise) => {
      child.once("exit", (code, signal) => {
        this.exitObserved = true;
        this.exitCode = code;
        this.exitSignal = signal;
        resolvePromise({ code, signal });
      });
    });
    this.closePromise = new Promise((resolvePromise) => {
      child.once("close", (code, signal) => {
        this.closeObserved = true;
        this.exitCode = code;
        this.exitSignal = signal;
        resolvePromise({ code, signal });
      });
    });
    child.stderr.on("data", (bytes) => {
      const retained = Buffer.from(bytes);
      this.stderrPending = this.stderrPending.then(() =>
        evidence.appendStderr(retained),
      );
    });

    this.readerPromise = this.#readMessages();
  }

  #rejectPending(error) {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
    for (const waiter of this.notificationWaiters) {
      waiter.reject(error);
    }
    this.notificationWaiters.clear();
  }

  #failProtocol(error) {
    if (this.protocolError === null) {
      this.protocolError = error;
      this.#rejectPending(error);
    }
  }

  async #readMessages() {
    try {
      for await (const record of readJsonlRecords(this.child.stdout)) {
        let message;
        try {
          message = JSON.parse(textDecoder.decode(record.jsonBytes));
        } catch {
          await this.evidence.appendTranscript(
            retainedMalformedServerLine(
              record,
              [...this.pending.values()].some(
                ({ method }) => method === "account/read",
              ),
            ),
          );
          throw sessionError(
            "protocol-failed",
            "MALFORMED_JSON",
            "Codex App Server emitted malformed JSON",
          );
        }
        await this.#handleServerMessage(message, record);
      }

      this.readerClosed = true;
      const outcome = await this.closePromise;
      await this.stderrPending;
      if (outcome.code !== 0) {
        throw sessionError(
          "provider-failed",
          "NONZERO_EXIT",
          `Codex App Server exited with code ${outcome.code}`,
        );
      }
      if (this.pending.size > 0 || this.notificationWaiters.size > 0) {
        throw sessionError(
          "protocol-failed",
          "PREMATURE_EOF",
          "Codex App Server closed with requests still pending",
        );
      }
    } catch (error) {
      this.readerClosed = true;
      this.#failProtocol(error);
    }
  }

  async #handleServerMessage(message, record) {
    const nativeEventIndex = this.nativeMessageIndex;
    this.nativeMessageIndex += 1;
    if (
      message === null ||
      typeof message !== "object" ||
      Array.isArray(message)
    ) {
      await this.evidence.appendTranscript(record.lineBytes);
      throw sessionError(
        "protocol-failed",
        "INVALID_MESSAGE",
        "Codex App Server emitted a non-object JSON-RPC message",
      );
    }

    if (Object.hasOwn(message, "id") && typeof message.method === "string") {
      await this.evidence.appendTranscript(record.lineBytes);
      let response;
      try {
        response = await this.onServerRequest({
          method: message.method,
          params: message.params ?? {},
          nativeEventIndex,
        });
      } catch (error) {
        if (error instanceof CodexSessionError) {
          throw error;
        }
        throw sessionError(
          "controller-failed",
          "SERVER_REQUEST_REJECTED",
          error.message,
        );
      }
      await this.respond(message.id, response);
      return;
    }

    if (Object.hasOwn(message, "id")) {
      const pending = this.pending.get(message.id);
      const requestMethod = pending?.method ?? null;
      await this.evidence.appendTranscript(
        retainedServerLine(record, message, requestMethod),
      );
      if (pending === undefined) {
        const code = this.resolvedIds.has(message.id)
          ? "DUPLICATE_RESPONSE_ID"
          : "UNKNOWN_RESPONSE_ID";
        throw sessionError(
          "protocol-failed",
          code,
          `Codex App Server emitted ${code.toLowerCase().replaceAll("_", " ")}`,
        );
      }
      this.pending.delete(message.id);
      this.resolvedIds.add(message.id);
      if (Object.hasOwn(message, "error")) {
        pending.reject(responseError(message, requestMethod));
      } else if (!Object.hasOwn(message, "result")) {
        pending.reject(
          sessionError(
            "protocol-failed",
            "MISSING_RESPONSE_RESULT",
            `Codex App Server ${requestMethod} response has no result`,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string") {
      await this.evidence.appendTranscript(record.lineBytes);
      const event = {
        eventIndex: this.eventIndex,
        method: message.method,
        nativeEventIndex,
        params: message.params ?? {},
      };
      this.eventIndex += 1;
      this.notifications.push(event);
      await this.evidence.appendEvent({
        ...event,
        params: normalizedNotificationParams(event),
      });
      await this.onNotification(event);
      for (const waiter of [...this.notificationWaiters]) {
        if (waiter.predicate(event)) {
          this.notificationWaiters.delete(waiter);
          waiter.resolve(event);
        }
      }
      return;
    }

    await this.evidence.appendTranscript(record.lineBytes);
    throw sessionError(
      "protocol-failed",
      "INVALID_MESSAGE",
      "Codex App Server emitted an unrecognized JSON-RPC message",
    );
  }

  async #write(message) {
    if (this.protocolError !== null) {
      throw this.protocolError;
    }
    const bytes = Buffer.concat([
      canonicalJsonBytes(message),
      Buffer.from("\n", "utf8"),
    ]);
    const operation = this.writePending.then(async () => {
      await this.evidence.appendTranscript(bytes);
      await new Promise((resolvePromise, rejectPromise) => {
        this.child.stdin.write(bytes, (error) => {
          if (error) {
            rejectPromise(error);
          } else {
            resolvePromise();
          }
        });
      });
    });
    this.writePending = operation;
    return operation;
  }

  async request(method, params) {
    if (this.protocolError !== null) {
      throw this.protocolError;
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    let resolveRequest;
    let rejectRequest;
    const result = new Promise((resolvePromise, rejectPromise) => {
      resolveRequest = resolvePromise;
      rejectRequest = rejectPromise;
    });
    const settledResult = result.then(
      (value) => ({ status: "fulfilled", value }),
      (error) => ({ error, status: "rejected" }),
    );
    this.pending.set(id, {
      method,
      resolve: resolveRequest,
      reject: rejectRequest,
    });
    return this.#write({ id, method, params })
      .catch((error) => {
        this.pending.delete(id);
        rejectRequest(error);
      })
      .then(() => settledResult)
      .then((outcome) => {
        if (outcome.status === "rejected") {
          throw outcome.error;
        }
        return outcome.value;
      });
  }

  notify(method, params = {}) {
    return this.#write({ method, params });
  }

  respond(id, result) {
    return this.#write({ id, result });
  }

  waitForNotification(predicate, startIndex = 0) {
    for (const event of this.notifications.slice(startIndex)) {
      if (predicate(event)) {
        return Promise.resolve(event);
      }
    }
    if (this.protocolError !== null) {
      return Promise.reject(this.protocolError);
    }
    return new Promise((resolvePromise, rejectPromise) => {
      this.notificationWaiters.add({
        predicate,
        resolve: resolvePromise,
        reject: rejectPromise,
      });
    });
  }

  async appendHarnessEvent(method, params) {
    const event = {
      eventIndex: this.eventIndex,
      method,
      nativeEventIndex: this.nativeMessageIndex,
      params,
    };
    this.eventIndex += 1;
    await this.evidence.appendEvent(event);
    return event;
  }

  async shutdown({ timeoutMs = 1_000 } = {}) {
    const terminationActions = [];
    if (!this.child.stdin.destroyed) {
      this.child.stdin.end();
    }
    let closed = await settleWithin(this.closePromise, timeoutMs);
    if (!closed) {
      terminationActions.push("terminate");
      this.child.kill();
      closed = await settleWithin(this.closePromise, timeoutMs);
    }
    await settleWithin(this.readerPromise, timeoutMs);
    await settleWithin(this.stderrPending, timeoutMs);

    if (
      !closed ||
      !this.exitObserved ||
      !this.closeObserved ||
      !this.readerClosed
    ) {
      return {
        status: "unsafe",
        reasonCode: "shutdown-ambiguous",
        diagnostics: {
          closeObserved: this.closeObserved,
          exitObserved: this.exitObserved,
          readerClosed: this.readerClosed,
        },
      };
    }

    return {
      status: "safe",
      exitStatus: "observed",
      exitCode: this.exitCode,
      exitSignal: this.exitSignal,
      stdioStatus: "closed",
      protocolStatus: "closed",
      terminationActions,
      descendantStatus: "none-observed",
    };
  }
}

async function settleWithin(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolvePromise) => {
    timer = setTimeout(() => resolvePromise(false), timeoutMs);
  });
  const settled = Promise.resolve(promise).then(
    () => true,
    () => true,
  );
  const result = await Promise.race([settled, timeout]);
  clearTimeout(timer);
  return result;
}

function createOperationDeadline(timeoutMs, parentSignal) {
  const controller = new AbortController();
  const timeoutError = sessionError(
    "timed-out",
    "ETIMEDOUT",
    "Codex App Server operation exceeded its deadline",
  );
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  const abortFromParent = () => {
    controller.abort(
      sessionError(
        "timed-out",
        "ABORTED",
        "Codex App Server operation was aborted",
      ),
    );
  };
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  if (parentSignal?.aborted) {
    abortFromParent();
  }

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function awaitWithAbort(promise, signal) {
  if (signal.aborted) {
    throw signal.reason;
  }
  let onAbort;
  const aborted = new Promise((_resolvePromise, rejectPromise) => {
    onAbort = () => rejectPromise(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function requestDuringCleanup(client, method, params, timeoutMs) {
  const deadline = createOperationDeadline(Math.min(timeoutMs, 1_000));
  try {
    return await awaitWithAbort(
      client.request(method, params),
      deadline.signal,
    );
  } finally {
    deadline.dispose();
  }
}

function notStartedClosure() {
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

function authenticationSummary(result) {
  if (
    result === null ||
    typeof result !== "object" ||
    typeof result.requiresOpenaiAuth !== "boolean" ||
    !(result.account === null || typeof result.account === "object")
  ) {
    throw sessionError(
      "preflight-rejected",
      "INVALID_AUTH_RESPONSE",
      "Codex App Server returned an invalid authentication summary",
    );
  }
  const accountType =
    result.account === null || typeof result.account.type !== "string"
      ? null
      : result.account.type;
  return {
    accountType,
    requiresOpenaiAuth: result.requiresOpenaiAuth,
  };
}

function assertAuthenticated(summary) {
  if (summary.requiresOpenaiAuth && summary.accountType === null) {
    throw sessionError(
      "preflight-rejected",
      "AUTHENTICATION_REQUIRED",
      "Codex App Server has no OpenAI authentication",
    );
  }
}

function inspectCapabilities(models, providerCapabilities, policy) {
  if (!Array.isArray(models?.data)) {
    throw sessionError(
      "preflight-rejected",
      "INVALID_MODEL_CATALOG",
      "Codex App Server returned an invalid model catalog",
    );
  }
  const model = models.data.find(
    (candidate) =>
      candidate?.model === policy.model || candidate?.id === policy.model,
  );
  if (model === undefined) {
    throw sessionError(
      "preflight-rejected",
      "MODEL_UNAVAILABLE",
      `Codex model is unavailable: ${policy.model}`,
    );
  }
  const efforts = model.supportedReasoningEfforts;
  if (
    !Array.isArray(efforts) ||
    !efforts.some(({ reasoningEffort }) => reasoningEffort === policy.effort)
  ) {
    throw sessionError(
      "preflight-rejected",
      "EFFORT_UNAVAILABLE",
      `Codex reasoning effort is unavailable: ${policy.effort}`,
    );
  }
  if (
    providerCapabilities === null ||
    typeof providerCapabilities !== "object" ||
    Array.isArray(providerCapabilities) ||
    typeof providerCapabilities.webSearch !== "boolean" ||
    typeof providerCapabilities.imageGeneration !== "boolean" ||
    typeof providerCapabilities.namespaceTools !== "boolean"
  ) {
    throw sessionError(
      "protocol-failed",
      "INVALID_PROVIDER_CAPABILITIES",
      "Codex App Server returned invalid provider capability availability",
    );
  }
  const requestsImageGeneration =
    policy.capabilities.providerFacilities.includes("image-generation");
  const requestsNamespaceTools = policy.capabilities.tools.some((tool) =>
    tool.includes("namespace"),
  );
  if (
    (policy.capabilities.webSearch && !providerCapabilities.webSearch) ||
    (requestsImageGeneration && !providerCapabilities.imageGeneration) ||
    (requestsNamespaceTools && !providerCapabilities.namespaceTools)
  ) {
    throw sessionError(
      "capability-rejected",
      "PROVIDER_CAPABILITY_UNAVAILABLE",
      "Codex provider does not offer a requested capability",
    );
  }
  return {
    model: policy.model,
    effort: policy.effort,
    provider: policy.provider,
    imageGeneration: providerCapabilities.imageGeneration,
    namespaceTools: providerCapabilities.namespaceTools,
    webSearch: providerCapabilities.webSearch,
  };
}

function assertHookIsolation(result, policy) {
  if (
    !Array.isArray(result?.data) ||
    result.data.length !== policy.isolation.runtimeWorkspaceRoots.length
  ) {
    throw sessionError(
      "capability-rejected",
      "INVALID_HOOK_STATE",
      "Codex hook state is invalid",
    );
  }
  for (const [index, entry] of result.data.entries()) {
    if (
      typeof entry?.cwd !== "string" ||
      resolve(entry.cwd) !==
        resolve(policy.isolation.runtimeWorkspaceRoots[index]) ||
      !Array.isArray(entry.errors) ||
      entry.errors.length !== 0 ||
      !Array.isArray(entry.warnings) ||
      entry.warnings.length !== 0 ||
      !Array.isArray(entry.hooks) ||
      entry.hooks.some(
        (hook) =>
          hook === null ||
          typeof hook !== "object" ||
          Array.isArray(hook) ||
          typeof hook.enabled !== "boolean",
      )
    ) {
      throw sessionError(
        "protocol-failed",
        "INVALID_HOOK_STATE",
        "Codex hook state is invalid",
      );
    }
    if (entry.hooks.some(({ enabled }) => enabled)) {
      throw sessionError(
        "capability-rejected",
        "HOOK_SOURCE_PRESENT",
        "Codex discovered an enabled hook",
      );
    }
  }
}

function threadStartParams(policy) {
  return {
    allowProviderModelFallback: false,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    baseInstructions: policy.instructions.base,
    cwd: policy.isolation.workingDirectory,
    developerInstructions: policy.instructions.developer,
    dynamicTools: [],
    environments: [],
    ephemeral: true,
    model: policy.model,
    modelProvider: policy.provider,
    runtimeWorkspaceRoots: [],
    sandbox: "read-only",
    selectedCapabilityRoots: [],
  };
}

function assertThreadIsolation(result, policy) {
  if (
    result?.approvalPolicy !== "on-request" ||
    result?.approvalsReviewer !== "user" ||
    typeof result?.cwd !== "string" ||
    resolve(result?.cwd ?? "") !== resolve(policy.isolation.workingDirectory) ||
    result?.model !== policy.model ||
    result?.modelProvider !== policy.provider ||
    result?.reasoningEffort !== null ||
    result?.activePermissionProfile !== null ||
    result?.thread?.ephemeral !== true ||
    typeof result?.thread?.id !== "string" ||
    typeof result?.thread?.cwd !== "string" ||
    resolve(result?.thread?.cwd ?? "") !==
      resolve(policy.isolation.workingDirectory) ||
    result?.thread?.modelProvider !== policy.provider ||
    !Array.isArray(result?.thread?.turns) ||
    result.thread.turns.length !== 0 ||
    result?.multiAgentMode !== "explicitRequestOnly" ||
    !Array.isArray(result?.instructionSources) ||
    result.instructionSources.length !== 0 ||
    result?.sandbox?.type !== "readOnly" ||
    result?.sandbox?.networkAccess !== false ||
    !Array.isArray(result?.runtimeWorkspaceRoots) ||
    result.runtimeWorkspaceRoots.length !== 0
  ) {
    throw sessionError(
      "capability-rejected",
      "THREAD_ISOLATION_MISMATCH",
      "Codex thread did not preserve the requested isolated runtime",
    );
  }
}

function assertNotificationCapabilities(event, policy) {
  const status = event.params?.status;
  const activeMcpServer =
    event.method === "mcpServer/status/changed" &&
    !(
      typeof status === "string" &&
      ["disabled", "shutdown", "stopped"].includes(status.toLowerCase())
    );
  const itemType = event.params?.item?.type;
  const unrequestedItem =
    (itemType === "webSearch" && !policy.capabilities.webSearch) ||
    (itemType === "imageGeneration" &&
      !policy.capabilities.providerFacilities.includes("image-generation")) ||
    ["collabAgentToolCall", "dynamicToolCall", "mcpToolCall"].includes(
      itemType,
    ) ||
    (["commandExecution", "fileChange"].includes(itemType) &&
      policy.capabilities.tools.length === 0);
  if (activeMcpServer || unrequestedItem) {
    throw sessionError(
      "capability-rejected",
      "EXTERNAL_CAPABILITY_EVENT",
      "Codex emitted an unrequested external-capability event",
    );
  }
}

function normalizedNotificationParams(event) {
  const text = (value) => (typeof value === "string" ? value : null);
  if (event.method === "server/notice") {
    return { category: text(event.params?.category) };
  }
  if (event.method === "item/completed") {
    return {
      itemId: text(event.params?.item?.id),
      itemType: text(event.params?.item?.type),
      phase: text(event.params?.item?.phase),
      threadId: text(event.params?.threadId),
      turnId: text(event.params?.turnId),
    };
  }
  if (event.method === "thread/tokenUsage/updated") {
    return {
      threadId: text(event.params?.threadId),
      turnId: text(event.params?.turnId),
    };
  }
  if (event.method === "turn/completed") {
    return {
      status: text(event.params?.turn?.status),
      threadId: text(event.params?.threadId),
      turnId: text(event.params?.turn?.id),
    };
  }
  if (event.method === "mcpServer/status/changed") {
    return {
      name: text(event.params?.name),
      status: text(event.params?.status),
    };
  }
  return null;
}

function classifyFailure(error, fallback = "provider-failed") {
  return typeof error?.failureClass === "string"
    ? error.failureClass
    : fallback;
}

function failedPreflight(error, closure, partial = {}) {
  return {
    schemaVersion: 1,
    status: "failed",
    failureClass: classifyFailure(error),
    error: safeError(error),
    modelTurns: 0,
    authentication: partial.authentication ?? null,
    capabilities: partial.capabilities ?? null,
    isolation: partial.isolation ?? null,
    cleanup: partial.cleanup ?? null,
    closure,
  };
}

function completedPreflight({
  authentication,
  capabilities,
  isolation,
  cleanup,
  closure,
}) {
  return {
    schemaVersion: 1,
    status: "completed",
    failureClass: null,
    error: null,
    modelTurns: 0,
    authentication,
    capabilities,
    isolation,
    cleanup,
    closure,
  };
}

async function inspectCurrentToolchain(toolchain, environment) {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "codex-app-server-current-"),
  );
  try {
    return await inspectCodexAppServerToolchain({
      command: toolchain.command.path,
      prefixArguments: toolchain.prefixArguments,
      scratchRoot: join(temporaryRoot, "inspection"),
      environment,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function assertToolchainCurrent(expected, actual) {
  if (!canonicalJsonBytes(expected).equals(canonicalJsonBytes(actual))) {
    throw sessionError(
      "preflight-rejected",
      "TOOLCHAIN_DRIFT",
      "Codex executable, version, prefix file, or protocol schema drifted",
    );
  }
}

function assertHomeContext(context, expectedRole) {
  try {
    assertExactKeys(
      context,
      ["environment", "path", "registerChild", "role"],
      "evaluation home context",
    );
    if (
      context.role !== expectedRole ||
      !isAbsolute(context.path) ||
      typeof context.registerChild !== "function" ||
      !Object.isFrozen(context) ||
      !Object.isFrozen(context.environment)
    ) {
      throw new TypeError("evaluation home identity is invalid");
    }
    assertExactKeys(
      context.environment,
      ["CODEX_HOME"],
      "evaluation home environment",
    );
    if (
      typeof context.environment.CODEX_HOME !== "string" ||
      resolve(context.environment.CODEX_HOME) !== resolve(context.path)
    ) {
      throw new TypeError("evaluation home CODEX_HOME is invalid");
    }
  } catch (error) {
    throw sessionError(
      "preflight-rejected",
      "HOME_CONTEXT_MISMATCH",
      error.message,
    );
  }
}

function isolatedSpawnEnvironment(policy, context) {
  const environment = {
    ...policy.isolation.environment.values,
    ...context.environment,
  };
  const expectedNames = [
    ...Object.keys(policy.isolation.environment.values),
    "CODEX_HOME",
  ];
  const normalizeName =
    process.platform === "win32"
      ? (name) => name.toUpperCase()
      : (name) => name;
  const expected = expectedNames.map(normalizeName).sort();
  const actual = Object.keys(environment).map(normalizeName).sort();

  // The App Server protocol does not echo arbitrary environment values.
  // Prove the closed positive-name set at the spawn boundary instead.
  if (
    expected.length !== actual.length ||
    expected.some((name, index) => name !== actual[index]) ||
    actual.includes("OPENAI_API_KEY")
  ) {
    throw sessionError(
      "capability-rejected",
      "ENVIRONMENT_MISMATCH",
      "Codex App Server environment does not match the positive-name policy",
    );
  }

  return environment;
}

async function establishIsolatedThread({
  context,
  policy,
  request,
  onThreadStarted,
}) {
  const initialized = await request("initialize", {
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
    },
    clientInfo: {
      name: "unified-skill-evaluation-runtime",
      title: "Unified Skill Evaluation Runtime",
      version: "1.0.0",
    },
  });
  if (
    typeof initialized?.codexHome !== "string" ||
    resolve(initialized.codexHome) !== resolve(context.path)
  ) {
    throw sessionError(
      "capability-rejected",
      "CODEX_HOME_MISMATCH",
      "Codex App Server did not use the supplied stable home",
    );
  }
  await request("initialized", {}, { notification: true });

  const account = await request("account/read", { refreshToken: false });
  const authentication = authenticationSummary(account);
  assertAuthenticated(authentication);

  const [models, providerCapabilities] = await Promise.all([
    request("model/list", {
      cursor: null,
      includeHidden: true,
      limit: null,
    }),
    request("modelProvider/capabilities/read", {}),
  ]);
  const capabilities = inspectCapabilities(
    models,
    providerCapabilities,
    policy,
  );

  const hooks = await request("hooks/list", {
    cwds: policy.isolation.runtimeWorkspaceRoots,
  });
  assertHookIsolation(hooks, policy);

  const threadStart = await request("thread/start", threadStartParams(policy));
  if (typeof threadStart.thread?.id !== "string") {
    throw sessionError(
      "protocol-failed",
      "MISSING_THREAD_ID",
      "Codex thread/start response has no thread id",
    );
  }
  onThreadStarted(threadStart.thread.id);
  assertThreadIsolation(threadStart, policy);

  return {
    authentication,
    capabilities,
    isolation: {
      codexHome: context.path,
      workingDirectory: policy.isolation.workingDirectory,
      runtimeWorkspaceRoots: policy.isolation.runtimeWorkspaceRoots,
      sandbox: policy.isolation.sandbox,
      network: policy.capabilities.network,
      tools: policy.capabilities.tools,
      webSearch: policy.capabilities.webSearch,
      instructionSources: policy.isolation.instructionSources,
      persistence: policy.isolation.persistence,
      preflightThread: {
        instructionSources: [],
        multiAgentMode: threadStart.multiAgentMode,
        network: false,
        runtimeWorkspaceRoots: [],
        sandbox: "read-only",
      },
    },
    threadId: threadStart.thread.id,
  };
}

async function runPreflightOperation({
  context,
  toolchain,
  policy,
  evidence,
  timeoutMs,
  signal,
}) {
  const partial = {
    authentication: null,
    capabilities: null,
    isolation: null,
    cleanup: null,
  };
  let client;
  let threadId = null;
  let cleanupAttempted = false;
  let operationError = null;
  let closure = notStartedClosure();
  const deadline = createOperationDeadline(timeoutMs, signal);

  const request = (method, params, options = {}) =>
    awaitWithAbort(
      options.notification === true
        ? client.notify(method, params)
        : client.request(method, params),
      deadline.signal,
    );

  try {
    assertHomeContext(context, "preflight");
    const environment = isolatedSpawnEnvironment(policy, context);
    const child = spawn(
      toolchain.command.path,
      [...toolchain.prefixArguments, ...APP_SERVER_ARGUMENTS],
      {
        cwd: policy.isolation.workingDirectory,
        env: environment,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    context.registerChild(child);
    client = new JsonlRpcClient({
      child,
      evidence,
      async onNotification(event) {
        assertNotificationCapabilities(event, policy);
      },
      async onServerRequest({ method }) {
        throw sessionError(
          "controller-failed",
          "UNEXPECTED_SERVER_REQUEST",
          `preflight cannot answer server request ${method}`,
        );
      },
    });

    const established = await establishIsolatedThread({
      context,
      policy,
      request,
      onThreadStarted(startedThreadId) {
        threadId = startedThreadId;
      },
    });
    partial.authentication = established.authentication;
    partial.capabilities = established.capabilities;
    partial.isolation = established.isolation;
    threadId = established.threadId;

    try {
      cleanupAttempted = true;
      await request("thread/delete", { threadId });
      partial.cleanup = { status: "deleted", threadId };
      threadId = null;
    } catch (cleanupError) {
      if (isAlreadyEphemeralError(cleanupError)) {
        partial.cleanup = { status: "already-ephemeral", threadId };
        threadId = null;
      } else {
        throw cleanupError;
      }
    }
  } catch (error) {
    operationError = error;
  }

  if (threadId !== null && client !== undefined && cleanupAttempted === false) {
    try {
      await requestDuringCleanup(
        client,
        "thread/delete",
        { threadId },
        timeoutMs,
      );
      partial.cleanup = { status: "deleted", threadId };
    } catch (cleanupError) {
      if (isAlreadyEphemeralError(cleanupError)) {
        partial.cleanup = { status: "already-ephemeral", threadId };
      } else if (operationError === null) {
        operationError = cleanupError;
      }
    }
  }

  if (client !== undefined) {
    closure = await client.shutdown();
  }
  deadline.dispose();
  if (closure.status === "unsafe" && operationError === null) {
    operationError = sessionError(
      "provider-failed",
      "SHUTDOWN_AMBIGUOUS",
      "Codex App Server shutdown could not be confirmed",
    );
  }

  const value =
    operationError === null
      ? completedPreflight({ ...partial, closure })
      : failedPreflight(operationError, closure, partial);
  return { value, release: closure };
}

export async function preflightCodexAppServer({
  toolchain,
  policy,
  withHome,
  evidenceDestination,
  timeoutMs,
  signal,
}) {
  assertPlainObject(toolchain, "toolchain");
  assertPolicy(policy);
  if (typeof withHome !== "function") {
    fail("withHome must be a function");
  }
  if (!isAbsolute(evidenceDestination)) {
    fail("evidenceDestination must be absolute");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    fail("timeoutMs must be a positive safe integer");
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    fail("signal must be an AbortSignal");
  }
  const boundToolchain = immutableCanonicalSnapshot(toolchain);
  const boundPolicy = immutableCanonicalSnapshot(policy);

  const evidence = await openPreflightEvidence(
    evidenceDestination,
    boundToolchain,
    boundPolicy,
  );
  let result;
  let homeOutcome = null;
  try {
    if (signal?.aborted) {
      throw sessionError(
        "timed-out",
        "ABORTED",
        "Codex App Server preflight was aborted",
      );
    }
    const current = await inspectCurrentToolchain(
      boundToolchain,
      boundPolicy.isolation.environment.values,
    );
    assertToolchainCurrent(boundToolchain, current);

    result = await withHome(async (context) => {
      homeOutcome = await runPreflightOperation({
        context,
        toolchain: boundToolchain,
        policy: boundPolicy,
        evidence,
        timeoutMs,
        signal,
      });
      return homeOutcome;
    });
  } catch (error) {
    if (homeOutcome?.release?.status === "unsafe") {
      result = homeOutcome.value;
    } else if (homeOutcome !== null) {
      result = failedPreflight(error, homeOutcome.release, {
        authentication: homeOutcome.value.authentication,
        capabilities: homeOutcome.value.capabilities,
        isolation: homeOutcome.value.isolation,
        cleanup: homeOutcome.value.cleanup,
      });
    } else {
      result = failedPreflight(error, notStartedClosure());
    }
  }

  await evidence.close();
  const frozen = deepFreeze(result);
  await evidence.writeTerminal(frozen);
  return frozen;
}

function executionEvidenceBridge(evidence) {
  assertPlainObject(evidence, "execution evidence");
  for (const name of [
    "appendTranscript",
    "appendNormalizedEvent",
    "appendStderr",
    "writeFinal",
  ]) {
    if (typeof evidence[name] !== "function") {
      fail(`execution evidence.${name} must be a function`);
    }
  }

  return {
    appendTranscript(bytes) {
      return evidence.appendTranscript(bytes);
    },
    appendEvent(event) {
      return evidence.appendNormalizedEvent(event);
    },
    appendStderr(bytes) {
      return evidence.appendStderr(bytes);
    },
    writeFinal(bytes) {
      return evidence.writeFinal(bytes);
    },
  };
}

function assertController(controller, continuationPolicy) {
  assertExactKeys(
    continuationPolicy,
    ["allowedTransitions", "controllerSha256", "maxTurns", "templates"],
    "continuationPolicy",
  );
  if (
    typeof continuationPolicy.controllerSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(continuationPolicy.controllerSha256) ||
    !Array.isArray(continuationPolicy.allowedTransitions) ||
    !Array.isArray(continuationPolicy.templates)
  ) {
    fail("continuationPolicy is malformed");
  }
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
  if (controller.schemaVersion !== 1) {
    fail("controller.schemaVersion is unsupported");
  }
  if (
    !Number.isSafeInteger(controller.maxTurns) ||
    controller.maxTurns <= 0 ||
    controller.maxTurns > 32 ||
    controller.maxTurns !== continuationPolicy.maxTurns
  ) {
    fail("controller.maxTurns does not match the bounded continuation policy");
  }
  assertTextInput(controller.initialInput, "controller.initialInput");
  if (
    typeof controller.onTurnCompleted !== "function" ||
    typeof controller.onApprovalRequest !== "function"
  ) {
    fail("controller callbacks must be functions");
  }
  if (
    !Object.isFrozen(controller) ||
    !Object.isFrozen(controller.initialInput)
  ) {
    fail("controller and its initial input must be frozen");
  }
  if (controller.initialInput.some((item) => !Object.isFrozen(item))) {
    fail("controller initial input items must be frozen");
  }
}

function assertTextInput(input, label) {
  if (!Array.isArray(input) || input.length === 0) {
    fail(`${label} must be a nonempty array`);
  }
  for (const [index, item] of input.entries()) {
    assertExactKeys(item, ["text", "type"], `${label}[${index}]`);
    if (item.type !== "text") {
      fail(`${label}[${index}].type must be text`);
    }
    assertNonemptyString(item.text, `${label}[${index}].text`);
  }
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

function assertPacketControlledInputs(transmission, policy, controller) {
  const base = packetTextInputs(transmission, "base");
  const developer = packetTextInputs(transmission, "developer");
  const users = packetTextInputs(transmission, "user");
  const continuations = packetTextInputs(transmission, "continuation");
  if (
    base.length !== 1 ||
    base[0].content !== policy.instructions.base ||
    developer.length !== 1 ||
    developer[0].content !== policy.instructions.developer
  ) {
    fail("execution instructions do not match packet-bound instruction bytes");
  }
  const expectedUserInput = users.map(({ content }) => ({
    type: "text",
    text: content,
  }));
  if (
    !canonicalJsonBytes(expectedUserInput).equals(
      canonicalJsonBytes(controller.initialInput),
    )
  ) {
    fail("controller initial input does not match packet-bound user bytes");
  }
  const templateInput = transmission.continuationPolicy.templates.flatMap(
    (template, index) => {
      if (template.input === undefined) {
        return [];
      }
      assertTextInput(
        template.input,
        `transmission.continuationPolicy.templates[${index}].input`,
      );
      return template.input;
    },
  );
  if (
    !canonicalJsonBytes(continuations.map(({ content }) => content)).equals(
      canonicalJsonBytes(templateInput.map(({ text }) => text)),
    )
  ) {
    fail("continuation templates do not match packet-bound continuation bytes");
  }
}

function assertExecutionBinding(transmission, request) {
  assertExactKeys(
    request,
    ["controller", "policy", "timeoutMs", "toolchain", "withHome"],
    "Codex adapter request",
  );
  assertPolicy(request.policy);
  if (typeof request.withHome !== "function") {
    fail("Codex adapter request.withHome must be a function");
  }
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
    fail("Codex adapter request.timeoutMs must be a positive safe integer");
  }
  if (
    transmission.provider !== request.policy.provider ||
    transmission.model !== request.policy.model ||
    transmission.effort !== request.policy.effort ||
    transmission.transport !== "codex-app-server" ||
    !canonicalJsonBytes(transmission.toolchain).equals(
      canonicalJsonBytes(request.toolchain),
    ) ||
    !canonicalJsonBytes(transmission.capabilities).equals(
      canonicalJsonBytes(request.policy.capabilities),
    ) ||
    !canonicalJsonBytes(transmission.isolation).equals(
      canonicalJsonBytes(request.policy.isolation),
    )
  ) {
    fail("Codex adapter request does not match its transmission");
  }
  assertController(request.controller, transmission.continuationPolicy);
  assertPacketControlledInputs(
    transmission,
    request.policy,
    request.controller,
  );
}

function turnSandboxPolicy(policy) {
  if (policy.isolation.sandbox === "read-only") {
    return {
      type: "readOnly",
      networkAccess: policy.capabilities.network,
    };
  }
  return {
    type: "workspaceWrite",
    writableRoots: [policy.isolation.workingDirectory],
    networkAccess: policy.capabilities.network,
    excludeSlashTmp: true,
    excludeTmpdirEnvVar: true,
  };
}

function turnStartParams({ policy, threadId, input }) {
  return {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    cwd: policy.isolation.workingDirectory,
    effort: policy.effort,
    environments: [],
    input,
    model: policy.model,
    runtimeWorkspaceRoots: policy.isolation.runtimeWorkspaceRoots,
    sandboxPolicy: turnSandboxPolicy(policy),
    threadId,
  };
}

function authoritativeFinalAnswer(turn, itemEvents) {
  const items = [
    ...(Array.isArray(turn?.items) ? turn.items : []),
    ...itemEvents
      .filter(({ turnId }) => turnId === turn?.id)
      .map(({ item }) => item),
  ];
  const finals = items.filter(
    (item) => item?.type === "agentMessage" && item.phase === "final_answer",
  );
  const answer = finals.at(-1)?.text;
  if (typeof answer !== "string" || answer.length === 0) {
    throw sessionError(
      "protocol-failed",
      "MISSING_FINAL_AGENT_ITEM",
      "completed Codex turn has no authoritative final agent item",
    );
  }
  return answer;
}

function normalizeUsage(nativeUsage) {
  if (nativeUsage === null) {
    return {
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    };
  }
  for (const name of [
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "totalTokens",
  ]) {
    if (!Number.isSafeInteger(nativeUsage[name]) || nativeUsage[name] < 0) {
      throw sessionError(
        "protocol-failed",
        "INVALID_TOKEN_USAGE",
        "Codex emitted invalid token usage",
      );
    }
  }
  if (
    nativeUsage.inputTokens + nativeUsage.outputTokens !==
    nativeUsage.totalTokens
  ) {
    throw sessionError(
      "protocol-failed",
      "INVALID_TOKEN_USAGE",
      "Codex token totals are inconsistent",
    );
  }
  return {
    inputTokens: nativeUsage.inputTokens,
    cachedInputTokens: nativeUsage.cachedInputTokens,
    outputTokens: nativeUsage.outputTokens,
    totalTokens: nativeUsage.totalTokens,
    costUsd: null,
  };
}

function normalizeTurnStatus(status) {
  if (["completed", "failed", "cancelled"].includes(status)) {
    return status;
  }
  throw sessionError(
    "protocol-failed",
    "INVALID_TURN_STATUS",
    `Codex emitted unsupported turn status ${status ?? "missing"}`,
  );
}

function normalizeApprovalRequest(
  { method, params, nativeEventIndex },
  turnIndex,
) {
  if (method === "item/commandExecution/requestApproval") {
    if (
      typeof params.cwd !== "string" ||
      !isAbsolute(params.cwd) ||
      typeof params.command !== "string" ||
      params.command.length === 0 ||
      !(
        params.networkApprovalContext === null ||
        typeof params.networkApprovalContext === "object"
      ) ||
      !(
        params.additionalPermissions === null ||
        typeof params.additionalPermissions === "object"
      )
    ) {
      throw sessionError(
        "controller-failed",
        "UNREPRESENTABLE_APPROVAL",
        "Codex command approval cannot be represented by the controller port",
      );
    }
    return immutableCanonicalSnapshot({
      turnIndex,
      kind: params.networkApprovalContext === null ? "command" : "network",
      cwd: params.cwd,
      command: params.command,
      permissions: params.additionalPermissions,
      nativeEventIndex,
    });
  }

  if (method === "item/permissions/requestApproval") {
    if (
      typeof params.cwd !== "string" ||
      !isAbsolute(params.cwd) ||
      params.permissions === null ||
      typeof params.permissions !== "object" ||
      Array.isArray(params.permissions)
    ) {
      throw sessionError(
        "controller-failed",
        "UNREPRESENTABLE_APPROVAL",
        "Codex permission approval cannot be represented by the controller port",
      );
    }
    const names = Object.keys(params.permissions);
    if (names.some((name) => !["fileSystem", "network"].includes(name))) {
      throw sessionError(
        "controller-failed",
        "UNREPRESENTABLE_APPROVAL",
        "Codex permission approval contains an external capability",
      );
    }
    const kind =
      params.permissions.network?.enabled === true ? "network" : "filesystem";
    return immutableCanonicalSnapshot({
      turnIndex,
      kind,
      cwd: params.cwd,
      command: null,
      permissions: params.permissions,
      nativeEventIndex,
    });
  }

  throw sessionError(
    "controller-failed",
    "UNREPRESENTABLE_APPROVAL",
    `unsupported Codex server request ${method}`,
  );
}

function approvalProtocolResponse(method, event, decision) {
  assertPlainObject(decision, "approval decision");
  if (decision.decision === "deny") {
    assertExactKeys(decision, ["decision", "reason"], "approval decision");
    assertNonemptyString(decision.reason, "approval decision.reason");
    immutableCanonicalSnapshot(decision);
    return method === "item/commandExecution/requestApproval"
      ? { decision: "decline" }
      : { permissions: {}, scope: "turn", strictAutoReview: false };
  }
  if (decision.decision === "allow") {
    assertExactKeys(
      decision,
      ["decision", "permissions", "reason", "scope"],
      "approval decision",
    );
    if (decision.scope !== "turn") {
      fail("approval decision.scope must be turn");
    }
    assertNonemptyString(decision.reason, "approval decision.reason");
    const approved = immutableCanonicalSnapshot(decision);
    if (
      !canonicalJsonBytes(approved.permissions).equals(
        canonicalJsonBytes(event.permissions),
      )
    ) {
      fail("approval decision permissions do not match the request");
    }
    return method === "item/commandExecution/requestApproval"
      ? { decision: "accept" }
      : {
          permissions: approved.permissions,
          scope: "turn",
          strictAutoReview: false,
        };
  }
  fail("approval decision is malformed");
}

function continuationIsAllowed(decision, continuationPolicy) {
  const allowed = continuationPolicy.allowedTransitions.some((entry) =>
    typeof entry === "string"
      ? entry === decision.transitionId
      : entry?.transitionId === decision.transitionId ||
        entry?.id === decision.transitionId,
  );
  if (!allowed) {
    return false;
  }
  const template = continuationPolicy.templates.find(
    (entry) =>
      entry?.transitionId === decision.transitionId ||
      entry?.id === decision.transitionId,
  );
  return (
    template === undefined ||
    template.input === undefined ||
    canonicalJsonBytes(template.input).equals(
      canonicalJsonBytes(decision.input),
    )
  );
}

function validateTurnDecision(decision, turnIndex, transmission) {
  assertPlainObject(decision, "turn decision");
  if (decision.action === "complete") {
    assertExactKeys(decision, ["action", "suiteResult"], "turn decision");
    canonicalJsonBytes(decision.suiteResult);
    return immutableCanonicalSnapshot(decision);
  }
  if (decision.action === "continue") {
    assertExactKeys(
      decision,
      ["action", "input", "transitionId"],
      "turn decision",
    );
    assertNonemptyString(decision.transitionId, "turn decision.transitionId");
    assertTextInput(decision.input, "turn decision.input");
    if (
      turnIndex >= transmission.continuationPolicy.maxTurns ||
      !continuationIsAllowed(decision, transmission.continuationPolicy)
    ) {
      fail("turn continuation is not authorized by continuationPolicy");
    }
    return immutableCanonicalSnapshot(decision);
  }
  if (decision.action === "reject") {
    assertExactKeys(
      decision,
      ["action", "failureClass", "reason"],
      "turn decision",
    );
    if (!RUNTIME_FAILURE_CLASSES.has(decision.failureClass)) {
      fail("turn decision.failureClass is unsupported");
    }
    assertNonemptyString(decision.reason, "turn decision.reason");
    return immutableCanonicalSnapshot(decision);
  }
  fail("turn decision action is malformed");
}

function failedAdapterResult(
  error,
  closure,
  nativeUsage = null,
  normalizedUsage = normalizeUsage(null),
) {
  return {
    status: "failed",
    failureClass: classifyFailure(error),
    error: safeError(error),
    nativeUsage,
    normalizedUsage,
    closure,
    suiteResult: null,
  };
}

function completedAdapterResult({
  nativeUsage,
  normalizedUsage,
  closure,
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

async function runExecutionOperation({
  context,
  transmission,
  evidence,
  request: adapterRequest,
  launchCapability,
  signal,
}) {
  const { controller, policy, timeoutMs, toolchain } = adapterRequest;
  let client;
  let threadId = null;
  let activeTurnId = null;
  let operationError = null;
  let controllerCompleted = false;
  let suiteResult = null;
  let nativeUsage = null;
  let normalizedUsage = normalizeUsage(null);
  let closure = notStartedClosure();
  const protocolActions = [];
  const itemEvents = [];
  let currentTurnIndex = 0;
  const deadline = createOperationDeadline(timeoutMs, signal);

  try {
    assertHomeContext(context, "execution");
    const environment = isolatedSpawnEnvironment(policy, context);
    await consumeExternalModelLaunch(launchCapability, {
      provider: transmission.provider,
      model: transmission.model,
      effort: transmission.effort,
      transmissionSha256: sha256Hex(canonicalJsonBytes(transmission)),
    });
    const child = spawn(
      toolchain.command.path,
      [...toolchain.prefixArguments, ...APP_SERVER_ARGUMENTS],
      {
        cwd: policy.isolation.workingDirectory,
        env: environment,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    context.registerChild(child);

    let notificationFailure = null;
    client = new JsonlRpcClient({
      child,
      evidence,
      async onNotification(event) {
        try {
          assertNotificationCapabilities(event, policy);
        } catch {
          notificationFailure = sessionError(
            "capability-rejected",
            "EXTERNAL_CAPABILITY_EVENT",
            "Codex emitted an unrequested external-capability event",
          );
          throw notificationFailure;
        }
        if (event.method === "item/completed") {
          itemEvents.push(event.params);
        } else if (event.method === "thread/tokenUsage/updated") {
          nativeUsage = event.params?.tokenUsage?.total ?? null;
          normalizedUsage = normalizeUsage(nativeUsage);
        }
      },
      async onServerRequest(serverRequest) {
        if (notificationFailure !== null) {
          throw notificationFailure;
        }
        const event = normalizeApprovalRequest(serverRequest, currentTurnIndex);
        await client.appendHarnessEvent("controller/approval-request", event);
        let decision;
        try {
          decision = await awaitWithAbort(
            Promise.resolve(controller.onApprovalRequest(event)),
            deadline.signal,
          );
          return approvalProtocolResponse(
            serverRequest.method,
            event,
            decision,
          );
        } catch (error) {
          if (error instanceof CodexSessionError) {
            throw error;
          }
          throw sessionError(
            "controller-failed",
            "APPROVAL_CONTROLLER_FAILED",
            error.message,
          );
        }
      },
    });

    const protocolRequest = (method, params, options = {}) =>
      awaitWithAbort(
        options.notification === true
          ? client.notify(method, params)
          : client.request(method, params),
        deadline.signal,
      );
    const established = await establishIsolatedThread({
      context,
      policy,
      request: protocolRequest,
      onThreadStarted(startedThreadId) {
        threadId = startedThreadId;
      },
    });
    threadId = established.threadId;

    let input = controller.initialInput;
    for (let turnIndex = 1; turnIndex <= controller.maxTurns; turnIndex += 1) {
      currentTurnIndex = turnIndex;
      const notificationStart = client.notifications.length;
      const nativeEventStart = client.nativeMessageIndex;
      const started = await protocolRequest(
        "turn/start",
        turnStartParams({ policy, threadId, input }),
      );
      activeTurnId = started?.turn?.id ?? null;
      if (typeof activeTurnId !== "string") {
        throw sessionError(
          "protocol-failed",
          "MISSING_TURN_ID",
          "Codex turn/start response has no turn id",
        );
      }

      const completed = await awaitWithAbort(
        client.waitForNotification(
          (event) =>
            event.method === "turn/completed" &&
            event.params?.threadId === threadId &&
            event.params?.turn?.id === activeTurnId,
          notificationStart,
        ),
        deadline.signal,
      );
      activeTurnId = null;
      const turn = completed.params.turn;
      const status = normalizeTurnStatus(turn.status);
      const finalAnswer =
        status === "completed"
          ? authoritativeFinalAnswer(turn, itemEvents)
          : null;
      const completionEvent = immutableCanonicalSnapshot({
        turnIndex,
        status,
        finalAnswer,
        nativeUsage,
        nativeEventRange: {
          first: nativeEventStart,
          last: completed.nativeEventIndex,
        },
      });
      await client.appendHarnessEvent(
        "controller/turn-completed",
        completionEvent,
      );
      let decision;
      try {
        decision = validateTurnDecision(
          await awaitWithAbort(
            Promise.resolve(controller.onTurnCompleted(completionEvent)),
            deadline.signal,
          ),
          turnIndex,
          transmission,
        );
      } catch (error) {
        throw sessionError(
          "controller-failed",
          "TURN_CONTROLLER_FAILED",
          error.message,
        );
      }

      if (decision.action === "complete") {
        controllerCompleted = true;
        suiteResult = decision.suiteResult;
        await evidence.writeFinal(Buffer.from(finalAnswer ?? "", "utf8"));
        break;
      }
      if (decision.action === "reject") {
        throw sessionError(
          decision.failureClass,
          "CONTROLLER_REJECTED",
          decision.reason,
        );
      }
      await client.appendHarnessEvent("controller/continuation", {
        input: decision.input,
        transitionId: decision.transitionId,
        turnIndex,
      });
      input = decision.input;
    }

    if (!controllerCompleted) {
      throw sessionError(
        "controller-failed",
        "TURN_LIMIT_EXHAUSTED",
        "controller exhausted maxTurns without completing or rejecting",
      );
    }
  } catch (error) {
    operationError = error;
  }

  if (activeTurnId !== null && client !== undefined) {
    try {
      await requestDuringCleanup(
        client,
        "turn/interrupt",
        {
          threadId,
          turnId: activeTurnId,
        },
        timeoutMs,
      );
      protocolActions.push("interrupt");
      activeTurnId = null;
    } catch (interruptError) {
      if (operationError === null) {
        operationError = interruptError;
      }
    }
  }
  if (threadId !== null && client !== undefined) {
    try {
      await requestDuringCleanup(
        client,
        "thread/delete",
        { threadId },
        timeoutMs,
      );
    } catch (cleanupError) {
      if (!isAlreadyEphemeralError(cleanupError) && operationError === null) {
        operationError = cleanupError;
      }
    }
  }
  if (client !== undefined) {
    closure = await client.shutdown({ timeoutMs: Math.min(timeoutMs, 1_000) });
    if (closure.status === "safe" && protocolActions.length > 0) {
      closure = {
        ...closure,
        terminationActions: [...protocolActions, ...closure.terminationActions],
      };
    }
  }
  deadline.dispose();

  if (closure.status === "unsafe" && operationError === null) {
    operationError = sessionError(
      "provider-failed",
      "SHUTDOWN_AMBIGUOUS",
      "Codex App Server shutdown could not be confirmed",
    );
  }
  const value =
    operationError === null
      ? completedAdapterResult({
          nativeUsage,
          normalizedUsage,
          closure,
          suiteResult,
        })
      : failedAdapterResult(
          operationError,
          closure,
          nativeUsage,
          normalizedUsage,
        );
  return { value, release: closure };
}

export const codexAppServerAdapter = Object.freeze({
  provider: "openai",
  async execute(context) {
    assertExactKeys(
      context,
      ["evidence", "launchCapability", "request", "signal", "transmission"],
      "Codex adapter context",
    );
    assertExecutionBinding(context.transmission, context.request);
    const request = Object.freeze({
      ...context.request,
      policy: immutableCanonicalSnapshot(context.request.policy),
      toolchain: context.transmission.toolchain,
    });
    if (context.signal?.aborted) {
      throw sessionError(
        "timed-out",
        "ABORTED",
        "Codex App Server execution was aborted before launch",
      );
    }
    const evidence = executionEvidenceBridge(context.evidence);

    const current = await inspectCurrentToolchain(
      request.toolchain,
      request.policy.isolation.environment.values,
    );
    assertToolchainCurrent(request.toolchain, current);

    let homeOutcome = null;
    try {
      return await request.withHome(async (homeContext) => {
        homeOutcome = await runExecutionOperation({
          context: homeContext,
          transmission: context.transmission,
          evidence,
          request,
          launchCapability: context.launchCapability,
          signal: context.signal,
        });
        return homeOutcome;
      });
    } catch (error) {
      if (homeOutcome?.release?.status === "unsafe") {
        return homeOutcome.value;
      }
      if (homeOutcome !== null) {
        return failedAdapterResult(
          error,
          homeOutcome.release,
          homeOutcome.value.nativeUsage,
          homeOutcome.value.normalizedUsage,
        );
      }
      throw error;
    }
  },
});
