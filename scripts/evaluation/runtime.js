import { createHash } from "node:crypto";
import { access, lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";

/**
 * @typedef {"openai" | "anthropic" | "google"} EvaluationProvider
 */

/**
 * @typedef {object} ReleaseDisposition
 * @property {"safe" | "unsafe"} status
 */

/**
 * @typedef {object} AdapterResult
 * @property {"completed" | "failed"} status
 * @property {string | null} failureClass
 * @property {Record<string, unknown> | null} error
 * @property {unknown} nativeUsage
 * @property {{inputTokens: number | null, cachedInputTokens: number | null, outputTokens: number | null, totalTokens: number | null, costUsd: number | null}} normalizedUsage
 * @property {ReleaseDisposition} closure
 * @property {unknown} suiteResult
 */

/**
 * @typedef {object} EvidenceSink
 * @property {(bytes: Uint8Array) => Promise<void>} appendTranscript
 * @property {(event: object) => Promise<void>} appendNormalizedEvent
 * @property {(bytes: Uint8Array) => Promise<void>} appendStderr
 * @property {(bytes: Uint8Array) => Promise<void>} writeFinal
 * @property {(artifact: {relativePath: string, mediaType: string, bytes: Uint8Array}) => Promise<void>} writeSuiteArtifact
 */

/**
 * @typedef {object} ProviderAdapter
 * @property {EvaluationProvider} provider
 * @property {(context: {launchCapability: object, transmission: object, evidence: EvidenceSink, request: object, signal?: AbortSignal}) => Promise<AdapterResult>} execute
 */

/**
 * @typedef {object} PreparedEvidenceReference
 * @property {1} schemaVersion
 * @property {string} preparedSession
 * @property {string} transmissionSha256
 * @property {{packet: string, inputManifest: string, inputs: string[]}} artifacts
 */

const PACKET_KEYS = Object.freeze([
  "canonicalization",
  "digestAlgorithm",
  "schemaVersion",
  "transmission",
  "transmissionSha256",
]);
const TRANSMISSION_KEYS = Object.freeze([
  "capabilityReconciliation",
  "capabilities",
  "continuationPolicy",
  "effort",
  "harnessControlledInputs",
  "isolation",
  "model",
  "provider",
  "runtimeFingerprint",
  "session",
  "suite",
  "toolchain",
  "transport",
]);
const REQUIRED_TRANSMISSION_KEYS = Object.freeze(
  TRANSMISSION_KEYS.filter((name) => name !== "capabilityReconciliation"),
);
const CAPABILITY_RECONCILIATION_KEYS = Object.freeze([
  "receipt",
  "receiptSha256",
  "schemaVersion",
]);
const INPUT_KEYS = Object.freeze([
  "byteLength",
  "content",
  "encoding",
  "id",
  "mediaType",
  "role",
  "sha256",
]);
const SESSION_KEYS = Object.freeze([
  "arm",
  "caseId",
  "metadata",
  "preparedSessionId",
  "repetition",
  "sequence",
  "suiteArtifacts",
]);
const SUITE_ARTIFACT_KEYS = Object.freeze(["mediaType", "relativePath"]);
const PROVIDER_TRANSPORT = Object.freeze({
  anthropic: "claude-cli",
  google: "antigravity-cli",
  openai: "codex-app-server",
});
const INPUT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const LOWERCASE_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const PREPARED_SESSION_ID_PATTERN = /^[0-9a-f]{32}$/u;
const MEDIA_TYPES = new Set([
  "application/json",
  "application/octet-stream",
  "text/markdown",
  "text/plain",
]);
const INPUT_EXTENSIONS = Object.freeze({
  "application/json": "json",
  "application/octet-stream": "bin",
  "text/markdown": "md",
  "text/plain": "txt",
});
const AUTHORIZATION_KEYS = Object.freeze([
  "allowExternalModel",
  "decision",
  "effort",
  "model",
  "provider",
  "schemaVersion",
  "statement",
  "transmissionSha256",
]);
const LAUNCH_EXPECTATION_KEYS = Object.freeze([
  "effort",
  "model",
  "provider",
  "transmissionSha256",
]);
const PREPARATION_INPUT_KEYS = Object.freeze(["bytes", "id", "mediaType"]);
const MANIFEST_KEYS = Object.freeze(["inputs", "schemaVersion"]);
const MANIFEST_INPUT_KEYS = Object.freeze([
  "byteLength",
  "id",
  "mediaType",
  "relativePath",
  "sha256",
]);
const ADAPTER_RESULT_KEYS = Object.freeze([
  "closure",
  "error",
  "failureClass",
  "nativeUsage",
  "normalizedUsage",
  "status",
  "suiteResult",
]);
const NORMALIZED_USAGE_KEYS = Object.freeze([
  "cachedInputTokens",
  "costUsd",
  "inputTokens",
  "outputTokens",
  "totalTokens",
]);
const SAFE_RELEASE_KEYS = Object.freeze([
  "descendantStatus",
  "exitCode",
  "exitSignal",
  "exitStatus",
  "protocolStatus",
  "status",
  "stdioStatus",
  "terminationActions",
]);
const UNSAFE_RELEASE_KEYS = Object.freeze([
  "diagnostics",
  "reasonCode",
  "status",
]);
const EXECUTION_FAILURE_CLASSES = new Set([
  "authorization-rejected",
  "capability-rejected",
  "controller-failed",
  "launch-failed",
  "preflight-rejected",
  "protocol-failed",
  "provider-failed",
  "timed-out",
]);
const UNSAFE_RELEASE_REASONS = new Set([
  "callback-failed",
  "descendant-suspected",
  "protocol-open",
  "shutdown-ambiguous",
  "stdio-open",
]);
const TERMINATION_ACTIONS = new Set(["interrupt", "kill", "terminate"]);
const SUITE_WRITE_KEYS = Object.freeze(["bytes", "mediaType", "relativePath"]);
const RESERVED_EXECUTION_TARGETS = Object.freeze([
  "attempt.json",
  "authorization.json",
  "metrics.json",
  "run.json",
  "timing.json",
]);
const SENSITIVE_MEMBER_NAMES = new Set([
  "accesstoken",
  "accountemail",
  "apikey",
  "authorization",
  "bearer",
  "email",
  "loginurl",
  "password",
  "refreshtoken",
  "secret",
]);
const launchCapabilities = new WeakMap();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export const EXTERNAL_MODEL_AUTHORIZATION_STATEMENT =
  "I authorize exactly one external model session for this provider, model, effort, and transmission SHA-256.";

function fail(message) {
  throw new TypeError(message);
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a plain object`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain object`);
  }
}

function assertUnicodeScalarString(value, label) {
  if (typeof value !== "string") {
    fail(`${label} must be a string`);
  }

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (
        !Number.isInteger(nextCodeUnit) ||
        nextCodeUnit < 0xdc00 ||
        nextCodeUnit > 0xdfff
      ) {
        fail(`${label} contains a lone high surrogate`);
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail(`${label} contains a lone low surrogate`);
    }
  }
}

function canonicalize(value, ancestors, label) {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        fail(`${label} must contain only finite numbers`);
      }
      return JSON.stringify(value);
    case "string":
      assertUnicodeScalarString(value, label);
      return JSON.stringify(value);
    case "object":
      break;
    default:
      fail(`${label} contains an unsupported ${typeof value} value`);
  }

  if (ancestors.has(value)) {
    fail(`${label} contains a cycle`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    fail(`${label} contains a symbol-named member`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const names = Object.getOwnPropertyNames(value);
      if (names.length !== value.length + 1 || !names.includes("length")) {
        fail(`${label} must be a dense array without extra properties`);
      }

      const items = [];
      for (let index = 0; index < value.length; index += 1) {
        const name = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) {
          fail(`${label} must be a dense data-property array`);
        }
        items.push(
          canonicalize(descriptor.value, ancestors, `${label}[${index}]`),
        );
      }
      return `[${items.join(",")}]`;
    }

    assertPlainObject(value, label);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.keys(descriptors).sort();
    const members = [];

    for (const name of names) {
      assertUnicodeScalarString(name, `${label} member name`);
      const descriptor = descriptors[name];
      if (!("value" in descriptor) || descriptor.enumerable !== true) {
        fail(`${label}.${name} must be an enumerable data property`);
      }
      members.push(
        `${JSON.stringify(name)}:${canonicalize(descriptor.value, ancestors, `${label}.${name}`)}`,
      );
    }

    return `{${members.join(",")}}`;
  } finally {
    ancestors.delete(value);
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

function assertAllowedKeys(value, allowed, required, label) {
  assertPlainObject(value, label);
  const keys = Object.keys(value);
  const allowedSet = new Set(allowed);

  if (keys.some((key) => !allowedSet.has(key))) {
    fail(`${label} contains an unknown member`);
  }
  if (required.some((key) => !Object.hasOwn(value, key))) {
    fail(`${label} is missing a required member`);
  }
}

function assertNonemptyString(value, label) {
  assertUnicodeScalarString(value, label);
  if (value.length === 0) {
    fail(`${label} must not be empty`);
  }
}

function assertPositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} must be a positive safe integer`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest`);
  }
}

function decodeInputContent(input, label) {
  if (input.encoding === "utf8") {
    if (input.mediaType === "application/octet-stream") {
      fail(`${label} binary input must use base64 encoding`);
    }
    assertUnicodeScalarString(input.content, `${label}.content`);
    return Buffer.from(input.content, "utf8");
  }

  if (input.encoding === "base64") {
    if (input.mediaType !== "application/octet-stream") {
      fail(`${label} base64 encoding is reserved for binary input`);
    }
    assertNonemptyString(input.content, `${label}.content`);
    const bytes = Buffer.from(input.content, "base64");
    if (bytes.toString("base64") !== input.content) {
      fail(`${label}.content must be canonical base64`);
    }
    return bytes;
  }

  fail(`${label}.encoding is unsupported`);
}

function assertInputRecord(input, index) {
  const label = `transmission.harnessControlledInputs[${index}]`;
  assertExactKeys(input, INPUT_KEYS, label);
  if (typeof input.id !== "string" || !INPUT_ID_PATTERN.test(input.id)) {
    fail(`${label}.id is invalid`);
  }
  if (
    typeof input.role !== "string" ||
    !LOWERCASE_ID_PATTERN.test(input.role)
  ) {
    fail(`${label}.role is invalid`);
  }
  if (!MEDIA_TYPES.has(input.mediaType)) {
    fail(`${label}.mediaType is unsupported`);
  }
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0) {
    fail(`${label}.byteLength must be a nonnegative safe integer`);
  }
  assertSha256(input.sha256, `${label}.sha256`);

  const bytes = decodeInputContent(input, label);
  if (bytes.byteLength !== input.byteLength) {
    fail(`${label}.byteLength does not match its content`);
  }
  if (sha256Hex(bytes) !== input.sha256) {
    fail(`${label}.sha256 does not match its content`);
  }
}

function assertSuiteArtifacts(value) {
  if (!Array.isArray(value)) {
    fail("transmission.session.suiteArtifacts must be an array");
  }

  const paths = new Set();
  for (const [index, artifact] of value.entries()) {
    const label = `transmission.session.suiteArtifacts[${index}]`;
    assertExactKeys(artifact, SUITE_ARTIFACT_KEYS, label);
    assertNonemptyString(artifact.relativePath, `${label}.relativePath`);
    assertNonemptyString(artifact.mediaType, `${label}.mediaType`);
    const normalized = artifact.relativePath.replaceAll("\\", "/");
    if (
      normalized !== artifact.relativePath ||
      normalized.startsWith("/") ||
      normalized
        .split("/")
        .some((part) => part === "" || part === "." || part === "..")
    ) {
      fail(`${label}.relativePath must be a traversal-free relative path`);
    }
    if (
      normalized === "packet.json" ||
      normalized === "authorization.json" ||
      normalized === "attempt.json" ||
      normalized === "metrics.json" ||
      normalized === "timing.json" ||
      normalized === "run.json" ||
      normalized.startsWith("inputs/") ||
      normalized.startsWith("outputs/")
    ) {
      fail(`${label}.relativePath collides with common evidence`);
    }
    if (paths.has(normalized)) {
      fail("transmission.session.suiteArtifacts contains a duplicate path");
    }
    paths.add(normalized);
  }
}

function assertSession(session) {
  assertAllowedKeys(
    session,
    SESSION_KEYS,
    ["preparedSessionId", "suiteArtifacts"],
    "transmission.session",
  );
  if (
    typeof session.preparedSessionId !== "string" ||
    !PREPARED_SESSION_ID_PATTERN.test(session.preparedSessionId)
  ) {
    fail(
      "transmission.session.preparedSessionId must be 128-bit lowercase hex",
    );
  }
  if (Object.hasOwn(session, "arm")) {
    assertNonemptyString(session.arm, "transmission.session.arm");
  }
  if (Object.hasOwn(session, "caseId")) {
    const { caseId } = session;
    if (!(
      (typeof caseId === "string" && caseId.length > 0) ||
      (Number.isSafeInteger(caseId) && caseId >= 0)
    )) {
      fail(
        "transmission.session.caseId must be a nonempty string or safe integer",
      );
    }
  }
  for (const name of ["repetition", "sequence"]) {
    if (Object.hasOwn(session, name)) {
      assertPositiveSafeInteger(session[name], `transmission.session.${name}`);
    }
  }
  assertSuiteArtifacts(session.suiteArtifacts);
}

function assertCapabilityReconciliation(value, transmission) {
  assertExactKeys(
    value,
    CAPABILITY_RECONCILIATION_KEYS,
    "transmission.capabilityReconciliation",
  );
  if (value.schemaVersion !== 1) {
    fail("transmission capability reconciliation schema is unsupported");
  }
  assertPlainObject(
    value.receipt,
    "transmission.capabilityReconciliation.receipt",
  );
  assertSha256(
    value.receiptSha256,
    "transmission.capabilityReconciliation.receiptSha256",
  );
  if (value.receiptSha256 !== sha256Hex(canonicalJsonBytes(value.receipt))) {
    fail("transmission capability reconciliation receipt digest is invalid");
  }
  if (value.receipt.suite !== transmission.suite) {
    fail("transmission capability reconciliation suite does not match");
  }
  assertPlainObject(
    value.receipt.runtimeCapabilities,
    "transmission capability reconciliation runtime capabilities",
  );
  if (
    !canonicalJsonBytes(value.receipt.runtimeCapabilities).equals(
      canonicalJsonBytes(transmission.capabilities),
    )
  ) {
    fail(
      "reconciled runtime capabilities do not match transmission capabilities",
    );
  }
}

function assertTransmission(transmission) {
  assertAllowedKeys(
    transmission,
    TRANSMISSION_KEYS,
    REQUIRED_TRANSMISSION_KEYS,
    "transmission",
  );
  if (
    typeof transmission.suite !== "string" ||
    !LOWERCASE_ID_PATTERN.test(transmission.suite)
  ) {
    fail("transmission.suite is invalid");
  }
  if (!Object.hasOwn(PROVIDER_TRANSPORT, transmission.provider)) {
    fail("transmission.provider is unsupported");
  }
  if (transmission.transport !== PROVIDER_TRANSPORT[transmission.provider]) {
    fail("transmission.transport does not match its provider");
  }
  assertNonemptyString(transmission.model, "transmission.model");
  assertNonemptyString(transmission.effort, "transmission.effort");
  assertSession(transmission.session);

  if (!Array.isArray(transmission.harnessControlledInputs)) {
    fail("transmission.harnessControlledInputs must be an array");
  }
  const inputIds = new Set();
  for (const [index, input] of transmission.harnessControlledInputs.entries()) {
    assertInputRecord(input, index);
    if (inputIds.has(input.id)) {
      fail("transmission.harnessControlledInputs contains a duplicate id");
    }
    inputIds.add(input.id);
  }

  for (const name of [
    "toolchain",
    "runtimeFingerprint",
    "capabilities",
    "isolation",
    "continuationPolicy",
  ]) {
    assertPlainObject(transmission[name], `transmission.${name}`);
  }

  if (Object.hasOwn(transmission, "capabilityReconciliation")) {
    assertCapabilityReconciliation(
      transmission.capabilityReconciliation,
      transmission,
    );
  }

  assertPositiveSafeInteger(
    transmission.continuationPolicy.maxTurns,
    "transmission.continuationPolicy.maxTurns",
  );
  if (transmission.continuationPolicy.maxTurns > 32) {
    fail("transmission.continuationPolicy.maxTurns must not exceed 32");
  }

  canonicalJsonBytes(transmission);
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

function assertNoSensitiveStructuredValue(value, label, ancestors = new Set()) {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (ancestors.has(value)) {
    fail(`${label} contains a cycle`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const [index, child] of value.entries()) {
        assertNoSensitiveStructuredValue(
          child,
          `${label}[${index}]`,
          ancestors,
        );
      }
      return;
    }

    assertPlainObject(value, label);
    for (const [name, child] of Object.entries(value)) {
      const normalizedName = name
        .replaceAll(/[^A-Za-z0-9]/gu, "")
        .toLowerCase();
      if (SENSITIVE_MEMBER_NAMES.has(normalizedName)) {
        fail(`${label} contains sensitive member ${name}`);
      }
      assertNoSensitiveStructuredValue(child, `${label}.${name}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function normalizedClock(clock) {
  if (clock === undefined) {
    return Object.freeze({
      now: () => new Date(),
      monotonicNow: () => performance.now(),
    });
  }
  assertPlainObject(clock, "clock");
  if (
    typeof clock.now !== "function" ||
    typeof clock.monotonicNow !== "function"
  ) {
    fail("clock must provide now and monotonicNow functions");
  }
  return clock;
}

function wallTimestamp(clock, label) {
  const value = clock.now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    fail(`${label} clock value must be a valid Date`);
  }
  return value.toISOString();
}

function monotonicTimestamp(clock, label) {
  const value = clock.monotonicNow();
  if (!Number.isFinite(value)) {
    fail(`${label} monotonic clock value must be finite`);
  }
  return value;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function assertPathStillIdentifiesHandle(path, handle, initialStat) {
  const [handleStat, pathStat] = await Promise.all([
    handle.stat({ bigint: true }),
    lstat(path, { bigint: true }),
  ]);
  if (
    !sameIdentity(initialStat, handleStat) ||
    !sameIdentity(handleStat, pathStat) ||
    !pathStat.isFile()
  ) {
    throw new Error(`Evidence artifact identity changed: ${path}`);
  }
}

function preparedSessionPath(preparedSession) {
  if (typeof preparedSession === "string" && preparedSession.length > 0) {
    return preparedSession;
  }
  if (
    preparedSession !== null &&
    typeof preparedSession === "object" &&
    typeof preparedSession.preparedSession === "string" &&
    preparedSession.preparedSession.length > 0
  ) {
    return preparedSession.preparedSession;
  }
  fail("preparedSession must identify a prepared-session directory");
}

function decodeCanonicalJson(bytes, label) {
  if (!(bytes instanceof Uint8Array)) {
    fail(`${label} must be bytes`);
  }

  let text;
  try {
    text = utf8Decoder.decode(bytes);
  } catch {
    fail(`${label} must be valid UTF-8`);
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(`${label} must contain exactly one JSON value`);
  }

  const canonical = canonicalJsonBytes(value);
  if (!Buffer.from(bytes).equals(canonical)) {
    fail(`${label} must use canonical JSON bytes`);
  }
  return value;
}

async function writeHandleBytes(handle, bytes) {
  await handle.writeFile(bytes);
  await handle.sync();
}

async function writeCanonicalExclusive(path, value) {
  const handle = await open(path, "wx", 0o600);
  try {
    await writeHandleBytes(handle, canonicalJsonBytes(value));
  } finally {
    await handle.close();
  }
}

async function writeBytesExclusive(path, bytes) {
  if (!(bytes instanceof Uint8Array)) {
    fail("exclusive artifact writes accept only Uint8Array bytes");
  }
  const handle = await open(path, "wx", 0o600);
  try {
    await writeHandleBytes(handle, bytes);
  } finally {
    await handle.close();
  }
}

async function readPreparedPacket(directory) {
  const bytes = await readFile(join(directory, "packet.json"));
  const packet = decodeCanonicalJson(bytes, "packet.json");
  assertTransmissionPacket(packet);
  return deepFreeze(packet);
}

async function assertPreparedInputs(directory, packet) {
  const manifestBytes = await readFile(
    join(directory, "inputs", "manifest.json"),
  );
  const manifest = decodeCanonicalJson(manifestBytes, "inputs/manifest.json");
  assertExactKeys(manifest, MANIFEST_KEYS, "input manifest");
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.inputs)) {
    fail("input manifest schema is unsupported");
  }
  if (
    manifest.inputs.length !==
    packet.transmission.harnessControlledInputs.length
  ) {
    fail("input manifest count does not match the packet");
  }

  for (const [
    index,
    input,
  ] of packet.transmission.harnessControlledInputs.entries()) {
    const ordinal = String(index + 1).padStart(4, "0");
    const extension = INPUT_EXTENSIONS[input.mediaType];
    const relativePath = `inputs/${ordinal}-${input.id}.${extension}`;
    const manifestInput = manifest.inputs[index];
    assertExactKeys(
      manifestInput,
      MANIFEST_INPUT_KEYS,
      `input manifest entry ${index}`,
    );
    const expectedManifestInput = {
      id: input.id,
      relativePath,
      mediaType: input.mediaType,
      byteLength: input.byteLength,
      sha256: input.sha256,
    };
    if (
      canonicalJsonBytes(manifestInput).compare(
        canonicalJsonBytes(expectedManifestInput),
      ) !== 0
    ) {
      fail(`input manifest entry ${input.id} does not match the packet`);
    }

    const path = join(directory, ...relativePath.split("/"));
    const bytes = await readFile(path);
    if (
      bytes.byteLength !== input.byteLength ||
      sha256Hex(bytes) !== input.sha256
    ) {
      fail(`prepared input ${input.id} does not match the packet`);
    }
  }
}

function assertAuthorization(authorization, packet) {
  assertExactKeys(authorization, AUTHORIZATION_KEYS, "authorization");
  if (
    authorization.schemaVersion !== 1 ||
    authorization.decision !== "authorized" ||
    authorization.statement !== EXTERNAL_MODEL_AUTHORIZATION_STATEMENT ||
    authorization.allowExternalModel !== true
  ) {
    fail("authorization does not grant the exact external model session");
  }

  for (const name of ["provider", "model", "effort", "transmissionSha256"]) {
    const expected =
      name === "transmissionSha256"
        ? packet.transmissionSha256
        : packet.transmission[name];
    if (authorization[name] !== expected) {
      fail(`authorization ${name} does not match the packet`);
    }
  }
}

function failedExecution(failureClass, error) {
  return {
    status: "failed",
    failureClass,
    error: {
      name: typeof error?.name === "string" ? error.name : "Error",
      code: typeof error?.code === "string" ? error.code : null,
      message:
        typeof error?.message === "string"
          ? error.message
          : "Evaluation failed",
    },
    nativeUsage: null,
    normalizedUsage: {
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    },
    closure: {
      status: "safe",
      exitStatus: "not-started",
      exitCode: null,
      exitSignal: null,
      stdioStatus: "not-opened",
      protocolStatus: "not-opened",
      terminationActions: [],
      descendantStatus: "none-observed",
    },
    suiteResult: null,
  };
}

async function openExecutionEvidence(directory) {
  const outputs = join(directory, "outputs");
  await mkdir(outputs, { mode: 0o700 });

  for (const relativePath of RESERVED_EXECUTION_TARGETS) {
    if (await exists(join(directory, relativePath))) {
      const error = new Error(
        `Reserved execution evidence already exists: ${relativePath}`,
      );
      error.code = "EEXIST";
      throw error;
    }
  }

  const paths = {
    events: join(outputs, "events.jsonl"),
    final: join(outputs, "final.md"),
    stderr: join(outputs, "stderr.log"),
    transcript: join(outputs, "transcript.jsonl"),
  };
  const relativePaths = {
    events: "outputs/events.jsonl",
    final: "outputs/final.md",
    stderr: "outputs/stderr.log",
    transcript: "outputs/transcript.jsonl",
  };
  const handles = {};
  const initialStats = {};

  try {
    for (const name of ["transcript", "events", "stderr", "final"]) {
      handles[name] = await open(paths[name], "wx+", 0o600);
      initialStats[name] = await handles[name].stat({ bigint: true });
    }
  } catch (error) {
    await Promise.allSettled(
      Object.values(handles).map((handle) => handle.close()),
    );
    throw error;
  }

  let finalWritten = false;
  let closed = false;
  let suiteDeclarations = null;
  let suitePending = Promise.resolve();
  const suiteWritten = new Set();
  const pending = new Map(
    Object.entries(handles).map(([name]) => [name, Promise.resolve()]),
  );

  function append(name, bytes) {
    if (!(bytes instanceof Uint8Array)) {
      fail(`${name} evidence accepts only Uint8Array bytes`);
    }
    if (closed) {
      fail("evidence streams are closed");
    }

    const retainedBytes = Buffer.from(bytes);
    const operation = pending
      .get(name)
      .then(() => handles[name].write(retainedBytes));
    pending.set(name, operation);
    return operation.then(() => undefined);
  }

  const evidence = Object.freeze({
    appendTranscript(bytes) {
      return append("transcript", bytes);
    },
    appendNormalizedEvent(event) {
      assertNoSensitiveStructuredValue(event, "normalized event");
      const bytes = Buffer.concat([
        canonicalJsonBytes(event),
        Buffer.from("\n"),
      ]);
      return append("events", bytes);
    },
    appendStderr(bytes) {
      return append("stderr", bytes);
    },
    async writeFinal(bytes) {
      if (!(bytes instanceof Uint8Array)) {
        fail("final evidence accepts only Uint8Array bytes");
      }
      if (finalWritten) {
        fail("final evidence can be written only once");
      }
      finalWritten = true;
      await append("final", bytes);
    },
    async writeSuiteArtifact(artifact) {
      assertExactKeys(artifact, SUITE_WRITE_KEYS, "suite artifact");
      if (!(artifact.bytes instanceof Uint8Array)) {
        fail("suite artifact bytes must be a Uint8Array");
      }
      if (suiteDeclarations === null) {
        fail("suite artifact policy is not bound");
      }
      const declaration = suiteDeclarations.get(artifact.relativePath);
      if (
        declaration === undefined ||
        declaration.mediaType !== artifact.mediaType
      ) {
        fail("suite artifact is not declared by the packet");
      }
      const retained = Buffer.from(artifact.bytes);

      const operation = suitePending.then(async () => {
        if (closed) {
          fail("evidence streams are closed");
        }
        if (suiteWritten.has(artifact.relativePath)) {
          fail("suite artifact can be written only once");
        }
        suiteWritten.add(artifact.relativePath);
        const target = join(directory, ...artifact.relativePath.split("/"));
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeBytesExclusive(target, retained);
      });
      suitePending = operation;
      await operation;
    },
  });

  return {
    evidence,
    bindPacket(packet) {
      if (suiteDeclarations !== null) {
        fail("execution evidence packet is already bound");
      }
      suiteDeclarations = new Map(
        packet.transmission.session.suiteArtifacts.map((artifact) => [
          artifact.relativePath,
          artifact,
        ]),
      );
    },
    async close() {
      if (closed) {
        fail("execution evidence is already closed");
      }
      closed = true;
      const errors = [];
      for (const name of Object.keys(handles)) {
        try {
          await pending.get(name);
          await handles[name].sync();
          await assertPathStillIdentifiesHandle(
            paths[name],
            handles[name],
            initialStats[name],
          );
          await handles[name].close();
        } catch (error) {
          errors.push(error);
          try {
            await handles[name].close();
          } catch (closeError) {
            errors.push(closeError);
          }
        }
      }
      try {
        await suitePending;
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "Failed to finalize evidence streams");
      }
      return [...Object.values(relativePaths), ...[...suiteWritten].sort()];
    },
  };
}

function createLaunchCapability(directory, packet) {
  const capability = Object.freeze(Object.create(null));
  launchCapabilities.set(capability, {
    state: "available",
    attemptPath: join(directory, "attempt.json"),
    expectation: Object.freeze({
      provider: packet.transmission.provider,
      model: packet.transmission.model,
      effort: packet.transmission.effort,
      transmissionSha256: packet.transmissionSha256,
    }),
  });
  return capability;
}

function assertNullableNonnegativeNumber(
  value,
  label,
  { integer = true } = {},
) {
  if (value === null) {
    return;
  }
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isSafeInteger(value))
  ) {
    fail(
      `${label} must be null or a nonnegative ${integer ? "safe integer" : "number"}`,
    );
  }
}

function assertNormalizedUsage(usage) {
  assertExactKeys(usage, NORMALIZED_USAGE_KEYS, "normalized usage");
  for (const name of [
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "totalTokens",
  ]) {
    assertNullableNonnegativeNumber(usage[name], `normalized usage.${name}`);
  }
  assertNullableNonnegativeNumber(usage.costUsd, "normalized usage.costUsd", {
    integer: false,
  });

  if (
    usage.inputTokens !== null &&
    usage.outputTokens !== null &&
    usage.totalTokens !== null &&
    usage.inputTokens + usage.outputTokens !== usage.totalTokens
  ) {
    fail(
      "normalized usage totalTokens must equal inputTokens plus outputTokens",
    );
  }
  if (
    usage.cachedInputTokens !== null &&
    usage.inputTokens !== null &&
    usage.cachedInputTokens > usage.inputTokens
  ) {
    fail("normalized usage cachedInputTokens must not exceed inputTokens");
  }
}

function assertReleaseDisposition(closure) {
  assertPlainObject(closure, "release disposition");
  if (closure.status === "safe") {
    assertExactKeys(closure, SAFE_RELEASE_KEYS, "safe release disposition");
    if (
      closure.exitStatus !== "not-started" &&
      closure.exitStatus !== "observed"
    ) {
      fail("safe release disposition exitStatus is invalid");
    }
    if (
      closure.exitCode !== null &&
      (!Number.isSafeInteger(closure.exitCode) || closure.exitCode < 0)
    ) {
      fail("safe release disposition exitCode is invalid");
    }
    if (closure.exitSignal !== null) {
      assertNonemptyString(
        closure.exitSignal,
        "safe release disposition exitSignal",
      );
    }
    if (
      closure.stdioStatus !== "not-opened" &&
      closure.stdioStatus !== "closed"
    ) {
      fail("safe release disposition stdioStatus is invalid");
    }
    if (
      !["not-opened", "closed", "not-applicable"].includes(
        closure.protocolStatus,
      )
    ) {
      fail("safe release disposition protocolStatus is invalid");
    }
    if (!Array.isArray(closure.terminationActions)) {
      fail("safe release disposition terminationActions must be an array");
    }
    for (const action of closure.terminationActions) {
      if (!TERMINATION_ACTIONS.has(action)) {
        fail("safe release disposition contains an invalid termination action");
      }
    }
    if (closure.descendantStatus !== "none-observed") {
      fail("safe release disposition descendantStatus is invalid");
    }
    if (
      closure.exitStatus === "not-started" &&
      (closure.exitCode !== null ||
        closure.exitSignal !== null ||
        closure.stdioStatus !== "not-opened" ||
        closure.protocolStatus === "closed")
    ) {
      fail(
        "not-started release disposition contains contradictory child state",
      );
    }
    return;
  }

  if (closure.status === "unsafe") {
    assertExactKeys(closure, UNSAFE_RELEASE_KEYS, "unsafe release disposition");
    if (!UNSAFE_RELEASE_REASONS.has(closure.reasonCode)) {
      fail("unsafe release disposition reasonCode is invalid");
    }
    assertPlainObject(closure.diagnostics, "unsafe release diagnostics");
    return;
  }

  fail("release disposition status is invalid");
}

function assertAdapterResult(result) {
  assertExactKeys(result, ADAPTER_RESULT_KEYS, "adapter result");
  if (result.status !== "completed" && result.status !== "failed") {
    fail("adapter result status is invalid");
  }
  if (result.status === "completed") {
    if (result.failureClass !== null || result.error !== null) {
      fail("completed adapter result must not contain a failure");
    }
  } else if (!EXECUTION_FAILURE_CLASSES.has(result.failureClass)) {
    fail("failed adapter result must contain a supported failure class");
  }
  assertNormalizedUsage(result.normalizedUsage);
  assertReleaseDisposition(result.closure);
  const structuredResult = {
    closure: result.closure,
    error: result.error,
    nativeUsage: result.nativeUsage,
    normalizedUsage: result.normalizedUsage,
    suiteResult: result.suiteResult,
  };
  assertNoSensitiveStructuredValue(structuredResult, "adapter result");
  canonicalJsonBytes(structuredResult);
}

function validatePreparationInputs(packet, inputs) {
  if (!Array.isArray(inputs)) {
    fail("inputs must be an ordered array");
  }
  const packetInputs = packet.transmission.harnessControlledInputs;
  if (inputs.length !== packetInputs.length) {
    fail("prepared inputs do not match the packet input count");
  }

  return inputs.map((input, index) => {
    const label = `inputs[${index}]`;
    assertExactKeys(input, PREPARATION_INPUT_KEYS, label);
    if (!(input.bytes instanceof Uint8Array)) {
      fail(`${label}.bytes must be a Uint8Array`);
    }

    const expected = packetInputs[index];
    if (input.id !== expected.id || input.mediaType !== expected.mediaType) {
      fail(`${label} identity does not match the packet input`);
    }
    const bytes = Buffer.from(input.bytes);
    if (
      bytes.byteLength !== expected.byteLength ||
      sha256Hex(bytes) !== expected.sha256
    ) {
      fail(`${label} bytes do not match the packet input`);
    }

    const ordinal = String(index + 1).padStart(4, "0");
    const relativePath = `inputs/${ordinal}-${expected.id}.${INPUT_EXTENSIONS[expected.mediaType]}`;
    return Object.freeze({
      bytes,
      manifest: Object.freeze({
        id: expected.id,
        relativePath,
        mediaType: expected.mediaType,
        byteLength: bytes.byteLength,
        sha256: expected.sha256,
      }),
    });
  });
}

async function readStableArtifact(directory, relativePath) {
  const path = join(directory, ...relativePath.split("/"));
  const handle = await open(path, "r");
  try {
    const initial = await handle.stat({ bigint: true });
    await assertPathStillIdentifiesHandle(path, handle, initial);
    const bytes = await handle.readFile();
    await assertPathStillIdentifiesHandle(path, handle, initial);
    return {
      byteLength: bytes.byteLength,
      sha256: sha256Hex(bytes),
    };
  } finally {
    await handle.close();
  }
}

async function finalizedArtifactMap(directory, relativePaths) {
  const artifacts = {};
  for (const relativePath of [...new Set(relativePaths)].sort()) {
    artifacts[relativePath] = await readStableArtifact(directory, relativePath);
  }
  return artifacts;
}

function inputRelativePaths(packet) {
  return packet.transmission.harnessControlledInputs.map((input, index) => {
    const ordinal = String(index + 1).padStart(4, "0");
    return `inputs/${ordinal}-${input.id}.${INPUT_EXTENSIONS[input.mediaType]}`;
  });
}

/**
 * @param {{destination: string, packet: object, inputs: Array<{id: string, mediaType: string, bytes: Uint8Array}>, clock?: object}} options
 * @returns {Promise<PreparedEvidenceReference>}
 */
export async function prepareEvidenceSession({ destination, packet, inputs }) {
  if (typeof destination !== "string" || !isAbsolute(destination)) {
    fail("destination must be an absolute path");
  }
  assertTransmissionPacket(packet);
  const preparedInputs = validatePreparationInputs(packet, inputs);
  const packetBytes = canonicalJsonBytes(packet);
  const manifest = {
    schemaVersion: 1,
    inputs: preparedInputs.map(({ manifest: entry }) => entry),
  };

  await mkdir(destination, { mode: 0o700 });
  await mkdir(join(destination, "inputs"), { mode: 0o700 });
  await writeBytesExclusive(join(destination, "packet.json"), packetBytes);
  for (const { bytes, manifest: entry } of preparedInputs) {
    await writeBytesExclusive(
      join(destination, ...entry.relativePath.split("/")),
      bytes,
    );
  }
  await writeCanonicalExclusive(
    join(destination, "inputs", "manifest.json"),
    manifest,
  );

  return deepFreeze({
    schemaVersion: 1,
    preparedSession: destination,
    transmissionSha256: packet.transmissionSha256,
    artifacts: {
      packet: "packet.json",
      inputManifest: "inputs/manifest.json",
      inputs: preparedInputs.map(({ manifest: entry }) => entry.relativePath),
    },
  });
}

/**
 * @param {unknown} value
 * @returns {Buffer}
 */
export function canonicalJsonBytes(value) {
  return Buffer.from(canonicalize(value, new Set(), "$"), "utf8");
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function sha256Hex(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    fail("sha256Hex accepts only Uint8Array bytes");
  }
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * @param {object} transmission
 * @returns {object}
 */
export function createTransmissionPacket(transmission) {
  assertTransmission(transmission);
  const canonicalTransmission = JSON.parse(
    canonicalJsonBytes(transmission).toString("utf8"),
  );
  const packet = {
    schemaVersion: 1,
    canonicalization: "RFC8785",
    digestAlgorithm: "SHA-256",
    transmission: canonicalTransmission,
    transmissionSha256: sha256Hex(canonicalJsonBytes(canonicalTransmission)),
  };

  assertTransmissionPacket(packet);
  return deepFreeze(packet);
}

/**
 * @param {object} packet
 * @returns {object}
 */
export function assertTransmissionPacket(packet) {
  canonicalJsonBytes(packet);
  assertExactKeys(packet, PACKET_KEYS, "packet");
  if (packet.schemaVersion !== 1) {
    fail("packet.schemaVersion is unsupported");
  }
  if (packet.canonicalization !== "RFC8785") {
    fail("packet.canonicalization is unsupported");
  }
  if (packet.digestAlgorithm !== "SHA-256") {
    fail("packet.digestAlgorithm is unsupported");
  }
  assertTransmission(packet.transmission);
  assertSha256(packet.transmissionSha256, "packet.transmissionSha256");

  const expected = sha256Hex(canonicalJsonBytes(packet.transmission));
  if (packet.transmissionSha256 !== expected) {
    fail("packet transmission digest does not match its canonical bytes");
  }

  return packet;
}

/**
 * @param {object} launchCapability
 * @param {{provider: EvaluationProvider, model: string, effort: string, transmissionSha256: string}} expectation
 * @returns {Promise<void>}
 */
export async function consumeExternalModelLaunch(
  launchCapability,
  expectation,
) {
  const entry = launchCapabilities.get(launchCapability);
  if (entry === undefined || entry.state !== "available") {
    fail("external model launch capability is absent or already consumed");
  }
  entry.state = "consuming";

  try {
    assertExactKeys(expectation, LAUNCH_EXPECTATION_KEYS, "launch expectation");
    for (const name of LAUNCH_EXPECTATION_KEYS) {
      if (expectation[name] !== entry.expectation[name]) {
        fail(`launch expectation ${name} does not match authorization`);
      }
    }
    await writeCanonicalExclusive(entry.attemptPath, {
      schemaVersion: 1,
      ...entry.expectation,
    });
  } finally {
    entry.state = "consumed";
    launchCapabilities.delete(launchCapability);
  }
}

/**
 * @param {{preparedSession: string | PreparedEvidenceReference, allowExternalModelCall: boolean, authorization: object, assertCurrent: (transmission: object) => Promise<void>, adapter: ProviderAdapter, request: object, signal?: AbortSignal, clock?: object}} options
 * @returns {Promise<AdapterResult>}
 */
export async function executeAuthorizedModelSession({
  preparedSession,
  allowExternalModelCall,
  authorization,
  assertCurrent,
  adapter,
  request,
  signal,
  clock,
}) {
  const directory = preparedSessionPath(preparedSession);
  const selectedClock = normalizedClock(clock);
  const startedAt = wallTimestamp(selectedClock, "start");
  const startedMonotonic = monotonicTimestamp(selectedClock, "start");
  const transaction = await openExecutionEvidence(directory);
  let phase = "authorization";
  let capability;
  let packet = null;
  let authorizationWritten = false;
  let result;

  try {
    packet = await readPreparedPacket(directory);
    await assertPreparedInputs(directory, packet);
    transaction.bindPacket(packet);
    if (allowExternalModelCall !== true) {
      fail("allowExternalModelCall must be literally true");
    }
    assertAuthorization(authorization, packet);
    await writeCanonicalExclusive(
      join(directory, "authorization.json"),
      authorization,
    );
    authorizationWritten = true;

    phase = "current-state";
    if (typeof assertCurrent !== "function") {
      fail("assertCurrent must be a function");
    }
    await assertCurrent(packet.transmission);

    phase = "adapter";
    assertPlainObject(adapter, "adapter");
    if (
      adapter.provider !== packet.transmission.provider ||
      typeof adapter.execute !== "function"
    ) {
      fail("adapter does not match the packet provider");
    }

    capability = createLaunchCapability(directory, packet);
    result = await adapter.execute({
      launchCapability: capability,
      transmission: packet.transmission,
      evidence: transaction.evidence,
      request,
      signal,
    });
    if (launchCapabilities.has(capability)) {
      launchCapabilities.delete(capability);
      fail("adapter returned without consuming its launch capability");
    }
    assertAdapterResult(result);
  } catch (error) {
    if (capability !== undefined) {
      launchCapabilities.delete(capability);
    }
    result = failedExecution(
      phase === "authorization"
        ? "authorization-rejected"
        : phase === "current-state"
          ? "preflight-rejected"
          : "provider-failed",
      error,
    );
  }

  assertAdapterResult(result);
  const outputPaths = await transaction.close();
  const finishedMonotonic = monotonicTimestamp(selectedClock, "finish");
  if (finishedMonotonic < startedMonotonic) {
    fail("monotonic duration must not be negative");
  }
  const finishedAt = wallTimestamp(selectedClock, "finish");
  const metrics = {
    schemaVersion: 1,
    nativeUsage: result.nativeUsage,
    normalizedUsage: result.normalizedUsage,
  };
  const timing = {
    schemaVersion: 1,
    startedAt,
    finishedAt,
    durationMs: finishedMonotonic - startedMonotonic,
  };

  await writeCanonicalExclusive(join(directory, "metrics.json"), metrics);
  await writeCanonicalExclusive(join(directory, "timing.json"), timing);

  const artifactPaths = [
    "packet.json",
    "inputs/manifest.json",
    ...outputPaths,
    "metrics.json",
    "timing.json",
  ];
  if (packet !== null) {
    artifactPaths.push(...inputRelativePaths(packet));
  }
  if (authorizationWritten) {
    artifactPaths.push("authorization.json");
  }
  if (await exists(join(directory, "attempt.json"))) {
    artifactPaths.push("attempt.json");
  }

  const run = {
    schemaVersion: 1,
    transmissionSha256: packet?.transmissionSha256 ?? null,
    status: result.status,
    failureClass: result.failureClass,
    error: result.error,
    closure: result.closure,
    suiteResult: result.suiteResult,
    artifacts: await finalizedArtifactMap(directory, artifactPaths),
  };
  await writeCanonicalExclusive(join(directory, "run.json"), run);
  return result;
}
