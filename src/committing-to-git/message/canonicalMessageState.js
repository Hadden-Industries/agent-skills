import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

import { MAXIMUM_CANONICAL_MESSAGE_BYTES } from "./approvedMessage.js";
import {
  advanceTransaction,
  readTransaction,
  updateTransaction,
} from "../transaction/transactionWorkspace.js";

const MESSAGE_DIRECTORY_NAME = "message";
const CURRENT_SLOT = "current";
const CANDIDATE_SLOT = "candidate";
const PREVIOUS_SLOT = "previous";
const PENDING_JOURNAL_NAME = "message-replacement.pending.json";
const MESSAGE_FILE_NAME = "message.txt";
const VALIDATION_FILE_NAME = "validation.json";
const STATE_FILE_NAME = "state.json";
const MAXIMUM_VALIDATION_BYTES = 80 * 1024;
const MAXIMUM_JOURNAL_BYTES = 16 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const WINDOWS_RENAME_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const MAXIMUM_WINDOWS_RENAME_ATTEMPTS = 4;
const MESSAGE_SOURCES = new Set([
  "approved-subject",
  "checked-file",
  "finalized-extended",
]);

export class CanonicalMessageError extends Error {
  constructor(code, message, { exitCode = 2, details = {} } = {}) {
    super(message);
    this.name = "CanonicalMessageError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function fail(code, message, options) {
  throw new CanonicalMessageError(code, message, options);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function flushDirectory(path) {
  if (process.platform === "win32") {
    return;
  }

  const descriptor = openSync(path, fsConstants.O_RDONLY);

  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function assertContained(attemptDirectory, path) {
  const contained = relative(attemptDirectory, path);

  if (
    contained === "" ||
    contained === ".." ||
    contained.startsWith(`..${sep}`) ||
    isAbsolute(contained)
  ) {
    fail(
      "MESSAGE_ARTIFACT_ESCAPES_TRANSACTION",
      `Derived message artifact escapes its transaction: ${path}`,
    );
  }
}

function artifactPath(transaction, name) {
  const path = join(transaction.attemptDirectory, name);

  assertContained(transaction.attemptDirectory, path);
  return path;
}

function ensureDirectory(path, label) {
  const stat = lstatSync(path);

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(
      "MESSAGE_ARTIFACT_REPLACED",
      `${label} was replaced or is not a directory: ${path}`,
    );
  }

  if (realpathSync(path) !== resolve(path)) {
    fail(
      "MESSAGE_ARTIFACT_REPLACED",
      `${label} no longer resolves to its recorded path: ${path}`,
    );
  }
}

function ensureMessageDirectory(transaction) {
  const path = artifactPath(transaction, MESSAGE_DIRECTORY_NAME);

  if (!existsSync(path)) {
    mkdirSync(path, { mode: 0o700 });
    flushDirectory(transaction.attemptDirectory);
  }

  ensureDirectory(path, "Canonical message directory");
  return path;
}

function statIdentity(stat) {
  const device = String(stat.dev);
  const inode = String(stat.ino);

  return {
    available: inode !== "0",
    device,
    inode,
    byteCount: Number(stat.size),
    modifiedNanoseconds:
      stat.mtimeNs === undefined
        ? String(Math.trunc(Number(stat.mtimeMs) * 1_000_000))
        : String(stat.mtimeNs),
  };
}

function sameIdentity(left, right) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.byteCount === right.byteCount &&
    left.modifiedNanoseconds === right.modifiedNanoseconds
  );
}

function openReadOnlyNoFollow(path) {
  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW;
  return openSync(path, fsConstants.O_RDONLY + noFollow);
}

function readStablePath(
  path,
  { maximumBytes, label, afterOpen = null, allowPathReplacement = false },
) {
  let initial;

  try {
    initial = lstatSync(path, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      fail("MESSAGE_INPUT_MISSING", `${label} does not exist: ${path}`);
    }
    throw error;
  }

  if (initial.isSymbolicLink() || !initial.isFile()) {
    fail(
      "MESSAGE_INPUT_NOT_REGULAR",
      `${label} must be a non-link regular file: ${path}`,
    );
  }

  if (initial.size > BigInt(maximumBytes)) {
    fail("MESSAGE_INPUT_TOO_LARGE", `${label} exceeds ${maximumBytes} bytes.`, {
      details: { maximumBytes },
    });
  }

  const descriptor = openReadOnlyNoFollow(path);

  try {
    const before = fstatSync(descriptor, { bigint: true });
    const initialIdentity = statIdentity(initial);
    const openedIdentity = statIdentity(before);

    if (!before.isFile() || !sameIdentity(initialIdentity, openedIdentity)) {
      fail(
        "MESSAGE_INPUT_CHANGED",
        `${label} changed before its fixed path could be opened safely.`,
      );
    }

    afterOpen?.({ descriptor, identity: openedIdentity, path });
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const finalIdentity = statIdentity(after);

    if (
      !after.isFile() ||
      !sameIdentity(openedIdentity, finalIdentity) ||
      bytes.length > maximumBytes
    ) {
      fail(
        "MESSAGE_INPUT_CHANGED",
        `${label} changed while its opened handle was being read.`,
      );
    }

    if (!allowPathReplacement) {
      const pathStat = lstatSync(path, { bigint: true });

      if (
        pathStat.isSymbolicLink() ||
        !pathStat.isFile() ||
        !sameIdentity(finalIdentity, statIdentity(pathStat))
      ) {
        fail(
          "MESSAGE_INPUT_CHANGED",
          `${label} path changed while its opened handle was being read.`,
        );
      }
    }

    return { bytes, identity: finalIdentity, path };
  } finally {
    closeSync(descriptor);
  }
}

export function readTransactionOwnedFile({
  transactionPath,
  artifactName,
  maximumBytes,
  label,
  afterOpen,
  allowPathReplacement = true,
}) {
  const transaction = readTransaction(transactionPath);
  const path = artifactPath(transaction, artifactName);

  return {
    transaction,
    ...readStablePath(path, {
      maximumBytes,
      label,
      afterOpen,
      allowPathReplacement,
    }),
  };
}

function warning(code, message, path) {
  return { code, message, path };
}

export function cleanupTransactionOwnedInput({
  path,
  identity,
  forceIdentityUnavailable = false,
}) {
  if (forceIdentityUnavailable || identity.available !== true) {
    return {
      removed: false,
      warning: warning(
        "MESSAGE_INPUT_IDENTITY_UNAVAILABLE",
        "The fixed input was retained because same-object identity is unavailable on this filesystem.",
        path,
      ),
    };
  }

  let descriptor;

  try {
    descriptor = openReadOnlyNoFollow(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { removed: true, warning: null };
    }

    return {
      removed: false,
      warning: warning(
        "MESSAGE_INPUT_CLEANUP_FAILED",
        `The fixed input was retained because it could not be reopened safely: ${error.message}`,
        path,
      ),
    };
  }

  try {
    const opened = fstatSync(descriptor, { bigint: true });

    if (!opened.isFile() || !sameIdentity(identity, statIdentity(opened))) {
      return {
        removed: false,
        warning: warning(
          "MESSAGE_INPUT_REPLACED",
          "The fixed input was retained because its directory entry no longer identifies the opened object.",
          path,
        ),
      };
    }
  } finally {
    closeSync(descriptor);
  }

  try {
    const finalPathStat = lstatSync(path, { bigint: true });

    if (
      finalPathStat.isSymbolicLink() ||
      !finalPathStat.isFile() ||
      !sameIdentity(identity, statIdentity(finalPathStat))
    ) {
      return {
        removed: false,
        warning: warning(
          "MESSAGE_INPUT_REPLACED",
          "The fixed input was retained because it changed during cleanup.",
          path,
        ),
      };
    }

    unlinkSync(path);
    flushDirectory(dirname(path));
    return { removed: true, warning: null };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { removed: true, warning: null };
    }

    return {
      removed: false,
      warning: warning(
        "MESSAGE_INPUT_CLEANUP_FAILED",
        `The fixed input was retained because cleanup failed: ${error.message}`,
        path,
      ),
    };
  }
}

function writeNewFile(path, bytes) {
  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW;
  const descriptor = openSync(
    path,
    fsConstants.O_WRONLY + fsConstants.O_CREAT + fsConstants.O_EXCL + noFollow,
    0o600,
  );

  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function writeTransactionOwnedJsonCreateOnly({
  transactionPath,
  artifactName,
  value,
}) {
  const transaction = readTransaction(transactionPath);
  const path = artifactPath(transaction, artifactName);

  writeNewFile(path, canonicalJsonBytes(value));
  flushDirectory(transaction.attemptDirectory);
  return path;
}

export function ensureTransactionOwnedJson({
  transactionPath,
  artifactName,
  value,
  maximumBytes = 8 * 1024 * 1024,
}) {
  const transaction = readTransaction(transactionPath);
  const path = artifactPath(transaction, artifactName);
  const bytes = canonicalJsonBytes(value);

  if (bytes.length > maximumBytes) {
    fail(
      "MESSAGE_ARTIFACT_TOO_LARGE",
      `${artifactName} exceeds ${maximumBytes} bytes.`,
    );
  }

  if (existsSync(path)) {
    const current = readStablePath(path, {
      maximumBytes,
      label: `Fixed ${artifactName}`,
      allowPathReplacement: false,
    }).bytes;

    if (!current.equals(bytes)) {
      fail(
        "MESSAGE_ARTIFACT_COLLISION",
        `Fixed ${artifactName} already exists with conflicting bytes.`,
      );
    }

    return path;
  }

  try {
    writeNewFile(path, bytes);
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }

    const current = readStablePath(path, {
      maximumBytes,
      label: `Fixed ${artifactName}`,
      allowPathReplacement: false,
    }).bytes;

    if (!current.equals(bytes)) {
      fail(
        "MESSAGE_ARTIFACT_COLLISION",
        `Fixed ${artifactName} was concurrently created with conflicting bytes.`,
      );
    }
  }

  flushDirectory(transaction.attemptDirectory);
  return path;
}

function currentPathMatches(path, identity) {
  let descriptor;

  try {
    descriptor = openReadOnlyNoFollow(path);
    const stat = fstatSync(descriptor, { bigint: true });
    return stat.isFile() && sameIdentity(identity, statIdentity(stat));
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

export function replaceTransactionOwnedJson({
  transactionPath,
  artifactName,
  value,
  expectedIdentity = null,
}) {
  const transaction = readTransaction(transactionPath);
  const path = artifactPath(transaction, artifactName);

  if (expectedIdentity && !currentPathMatches(path, expectedIdentity)) {
    fail(
      "MESSAGE_INPUT_REPLACED",
      `The fixed ${artifactName} changed before normalized content could be persisted.`,
    );
  }

  const candidatePath = artifactPath(
    transaction,
    `.${artifactName}-${randomUUID()}.tmp`,
  );
  writeNewFile(candidatePath, canonicalJsonBytes(value));
  let attempt = 0;

  while (true) {
    attempt += 1;

    try {
      renameSync(candidatePath, path);
      flushDirectory(transaction.attemptDirectory);
      return path;
    } catch (error) {
      const retryable =
        process.platform === "win32" &&
        WINDOWS_RENAME_RETRY_CODES.has(error.code) &&
        attempt < MAXIMUM_WINDOWS_RENAME_ATTEMPTS;

      if (!retryable) {
        throw error;
      }
    }
  }
}

function slotPaths(messageDirectory, slot) {
  const directory = join(messageDirectory, slot);

  return {
    directory,
    messagePath: join(directory, MESSAGE_FILE_NAME),
    validationPath: join(directory, VALIDATION_FILE_NAME),
    statePath: join(directory, STATE_FILE_NAME),
  };
}

function assertExactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("CANONICAL_MESSAGE_CORRUPT", `${label} must be an object.`);
  }

  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      "CANONICAL_MESSAGE_CORRUPT",
      `${label} contains missing or unknown members.`,
    );
  }
}

function assertValidationMatches(bytes, validation, source) {
  if (
    validation === null ||
    typeof validation !== "object" ||
    Array.isArray(validation) ||
    validation.valid !== true
  ) {
    fail(
      "MESSAGE_VALIDATION_MISMATCH",
      "Canonical message replacement requires one successful validation object.",
    );
  }

  const digest = sha256(bytes);
  const expectedValidationSource =
    source === "finalized-extended" ? "structured-finalizer" : source;

  if (
    validation.messageSha256 !== digest ||
    validation.byteCount !== bytes.length ||
    validation.displayText !== bytes.toString("utf8") ||
    validation.messageSource !== expectedValidationSource
  ) {
    fail(
      "MESSAGE_VALIDATION_MISMATCH",
      "Canonical validation does not describe the exact replacement message bytes.",
    );
  }
}

function transactionMessageState(state, stateSha256) {
  return {
    schemaVersion: 1,
    revision: state.messageRevision,
    sha256: state.messageSha256,
    source: state.messageSource,
    byteCount: state.byteCount,
    stateSha256,
    validationSha256: state.validationSha256,
    slot: "message/current",
  };
}

function writeCandidate({
  messageDirectory,
  bytes,
  validation,
  source,
  revision,
  failureInjector,
}) {
  const paths = slotPaths(messageDirectory, CANDIDATE_SLOT);

  if (existsSync(paths.directory)) {
    fail(
      "MESSAGE_REPLACEMENT_OCCUPIED",
      "The fixed candidate slot is occupied; recover the pending replacement first.",
    );
  }

  mkdirSync(paths.directory, { mode: 0o700 });
  writeNewFile(paths.messagePath, bytes);
  const validationBytes = canonicalJsonBytes(validation);

  if (validationBytes.length > MAXIMUM_VALIDATION_BYTES) {
    fail(
      "MESSAGE_VALIDATION_TOO_LARGE",
      `Canonical validation exceeds ${MAXIMUM_VALIDATION_BYTES} bytes.`,
    );
  }

  writeNewFile(paths.validationPath, validationBytes);
  const state = {
    schemaVersion: 1,
    messageRevision: revision,
    messageSha256: sha256(bytes),
    messageSource: source,
    byteCount: bytes.length,
    validationSha256: sha256(validationBytes),
  };
  const stateBytes = canonicalJsonBytes(state);

  writeNewFile(paths.statePath, stateBytes);
  failureInjector("before-candidate-flush");
  flushDirectory(paths.directory);
  flushDirectory(messageDirectory);
  failureInjector("after-candidate-flush");

  return {
    ...state,
    stateSha256: sha256(stateBytes),
    transactionState: transactionMessageState(state, sha256(stateBytes)),
  };
}

function readSlot(messageDirectory, slot) {
  const paths = slotPaths(messageDirectory, slot);

  if (!existsSync(paths.directory)) {
    return null;
  }

  ensureDirectory(paths.directory, `Canonical message ${slot} slot`);
  const message = readStablePath(paths.messagePath, {
    maximumBytes: MAXIMUM_CANONICAL_MESSAGE_BYTES,
    label: `Canonical message ${slot} body`,
    allowPathReplacement: false,
  }).bytes;
  const validationBytes = readStablePath(paths.validationPath, {
    maximumBytes: MAXIMUM_VALIDATION_BYTES,
    label: `Canonical message ${slot} validation`,
    allowPathReplacement: false,
  }).bytes;
  const stateBytes = readStablePath(paths.statePath, {
    maximumBytes: MAXIMUM_JOURNAL_BYTES,
    label: `Canonical message ${slot} state`,
    allowPathReplacement: false,
  }).bytes;
  let validation;
  let state;

  try {
    validation = JSON.parse(STRICT_UTF8_DECODER.decode(validationBytes));
    state = JSON.parse(STRICT_UTF8_DECODER.decode(stateBytes));
  } catch (error) {
    fail(
      "CANONICAL_MESSAGE_CORRUPT",
      `Canonical message ${slot} JSON is invalid: ${error.message}`,
    );
  }

  assertExactKeys(
    state,
    [
      "schemaVersion",
      "messageRevision",
      "messageSha256",
      "messageSource",
      "byteCount",
      "validationSha256",
    ],
    `Canonical message ${slot} state`,
  );

  if (
    state.schemaVersion !== 1 ||
    !Number.isSafeInteger(state.messageRevision) ||
    state.messageRevision < 1 ||
    !SHA256_PATTERN.test(state.messageSha256) ||
    !MESSAGE_SOURCES.has(state.messageSource) ||
    state.byteCount !== message.length ||
    state.messageSha256 !== sha256(message) ||
    !SHA256_PATTERN.test(state.validationSha256) ||
    state.validationSha256 !== sha256(validationBytes)
  ) {
    fail(
      "CANONICAL_MESSAGE_CORRUPT",
      `Canonical message ${slot} state does not match its artifacts.`,
    );
  }

  assertValidationMatches(message, validation, state.messageSource);
  const stateSha256 = sha256(stateBytes);

  return {
    ...state,
    bytes: message,
    displayText: message.toString("utf8"),
    validation,
    stateSha256,
    transactionState: transactionMessageState(state, stateSha256),
    ...paths,
  };
}

function sameTransactionMessage(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function removeSlot(transaction, messageDirectory, slot) {
  const { directory } = slotPaths(messageDirectory, slot);

  assertContained(transaction.attemptDirectory, directory);

  if (!existsSync(directory)) {
    return;
  }

  ensureDirectory(directory, `Canonical message ${slot} slot`);
  rmSync(directory, { recursive: true, force: false });
  flushDirectory(messageDirectory);
}

function renameSlot(messageDirectory, source, destination) {
  const sourcePath = slotPaths(messageDirectory, source).directory;
  const destinationPath = slotPaths(messageDirectory, destination).directory;

  if (existsSync(destinationPath)) {
    fail(
      "MESSAGE_REPLACEMENT_OCCUPIED",
      `Canonical message ${destination} slot is already occupied.`,
    );
  }

  renameSync(sourcePath, destinationPath);
  flushDirectory(messageDirectory);
}

function installTransactionMessage(transactionPath, priorMessage, nextMessage) {
  const current = readTransaction(transactionPath);

  if (sameTransactionMessage(current.message, nextMessage)) {
    return current;
  }

  if (!sameTransactionMessage(current.message, priorMessage)) {
    fail(
      "MESSAGE_TRANSACTION_DRIFT",
      "Transaction message state changed during canonical replacement.",
    );
  }

  if (current.phase === "message-ready") {
    return updateTransaction(transactionPath, "message-ready", {
      ...current,
      phase: "message-ready",
      status: "message-ready",
      message: nextMessage,
    });
  }

  if (!new Set(["evidence-ready", "review-pending"]).has(current.phase)) {
    fail(
      "MESSAGE_REPLACEMENT_NOT_ALLOWED",
      `Canonical message replacement is not allowed in phase ${current.phase}.`,
    );
  }

  return advanceTransaction(transactionPath, current.phase, {
    ...current,
    phase: "message-ready",
    status: "message-ready",
    message: nextMessage,
  });
}

function readJournal(transaction, journalPath) {
  const bytes = readStablePath(journalPath, {
    maximumBytes: MAXIMUM_JOURNAL_BYTES,
    label: "Canonical message replacement journal",
    allowPathReplacement: false,
  }).bytes;
  let journal;

  try {
    journal = JSON.parse(STRICT_UTF8_DECODER.decode(bytes));
  } catch (error) {
    fail(
      "MESSAGE_REPLACEMENT_CORRUPT",
      `Canonical message replacement journal is invalid: ${error.message}`,
    );
  }

  assertExactKeys(
    journal,
    ["schemaVersion", "priorMessage", "nextMessage"],
    "Canonical message replacement journal",
  );

  if (
    journal.schemaVersion !== 1 ||
    (journal.priorMessage !== null &&
      (typeof journal.priorMessage !== "object" ||
        Array.isArray(journal.priorMessage))) ||
    journal.nextMessage === null ||
    typeof journal.nextMessage !== "object" ||
    Array.isArray(journal.nextMessage)
  ) {
    fail(
      "MESSAGE_REPLACEMENT_CORRUPT",
      "Canonical message replacement journal has invalid state references.",
    );
  }

  assertContained(transaction.attemptDirectory, journalPath);
  return journal;
}

function safeSlot(messageDirectory, slot) {
  try {
    return { value: readSlot(messageDirectory, slot), error: null };
  } catch (error) {
    return { value: null, error };
  }
}

function cleanupReplacementRemnants(
  transaction,
  messageDirectory,
  journalPath,
) {
  removeSlot(transaction, messageDirectory, PREVIOUS_SLOT);
  removeSlot(transaction, messageDirectory, CANDIDATE_SLOT);

  if (existsSync(journalPath)) {
    unlinkSync(journalPath);
    flushDirectory(transaction.attemptDirectory);
  }
}

function steadyCanonicalMessage(transaction, messageDirectory) {
  if (transaction.message === null) {
    return null;
  }

  const current = readSlot(messageDirectory, CURRENT_SLOT);

  if (
    current === null ||
    !sameTransactionMessage(current.transactionState, transaction.message)
  ) {
    fail(
      "CANONICAL_MESSAGE_CORRUPT",
      "The transaction does not match its fixed current message slot.",
    );
  }

  return current;
}

export function recoverCanonicalMessageReplacement(transactionPath) {
  let transaction = readTransaction(transactionPath);
  const messageDirectory = ensureMessageDirectory(transaction);
  const journalPath = artifactPath(transaction, PENDING_JOURNAL_NAME);

  if (!existsSync(journalPath)) {
    const current = safeSlot(messageDirectory, CURRENT_SLOT);
    const candidate = safeSlot(messageDirectory, CANDIDATE_SLOT);
    const previous = safeSlot(messageDirectory, PREVIOUS_SLOT);

    if (candidate.value !== null || candidate.error !== null) {
      removeSlot(transaction, messageDirectory, CANDIDATE_SLOT);
    }

    if (previous.value !== null || previous.error !== null) {
      if (
        current.value !== null &&
        sameTransactionMessage(
          current.value.transactionState,
          transaction.message,
        )
      ) {
        removeSlot(transaction, messageDirectory, PREVIOUS_SLOT);
      } else {
        fail(
          "MESSAGE_REPLACEMENT_RECOVERY_REQUIRED",
          "A previous canonical slot remains without a replacement journal.",
        );
      }
    }

    return steadyCanonicalMessage(transaction, messageDirectory);
  }

  const journal = readJournal(transaction, journalPath);
  let current = safeSlot(messageDirectory, CURRENT_SLOT);
  const candidate = safeSlot(messageDirectory, CANDIDATE_SLOT);
  let previous = safeSlot(messageDirectory, PREVIOUS_SLOT);
  const nextMatches = (slot) =>
    slot.value !== null &&
    sameTransactionMessage(slot.value.transactionState, journal.nextMessage);
  const priorMatches = (slot) =>
    slot.value !== null &&
    sameTransactionMessage(slot.value.transactionState, journal.priorMessage);

  if (!nextMatches(current) && nextMatches(candidate)) {
    if (current.value !== null && !priorMatches(current)) {
      fail(
        "MESSAGE_REPLACEMENT_CORRUPT",
        "The current message slot matches neither side of the pending replacement.",
      );
    }

    if (current.value !== null) {
      if (previous.value !== null || previous.error !== null) {
        fail(
          "MESSAGE_REPLACEMENT_CORRUPT",
          "Both current and previous slots are occupied during recovery.",
        );
      }
      renameSlot(messageDirectory, CURRENT_SLOT, PREVIOUS_SLOT);
      previous = safeSlot(messageDirectory, PREVIOUS_SLOT);
    }

    renameSlot(messageDirectory, CANDIDATE_SLOT, CURRENT_SLOT);
    current = safeSlot(messageDirectory, CURRENT_SLOT);
  }

  if (nextMatches(current)) {
    transaction = installTransactionMessage(
      transactionPath,
      journal.priorMessage,
      journal.nextMessage,
    );
    cleanupReplacementRemnants(transaction, messageDirectory, journalPath);
    return steadyCanonicalMessage(transaction, messageDirectory);
  }

  // A missing or corrupt durable candidate cannot replace the last valid
  // current slot. Restore the prior fixed slot and discard only helper-owned
  // replacement remnants.
  if (!priorMatches(current) && priorMatches(previous)) {
    if (current.value !== null || current.error !== null) {
      removeSlot(transaction, messageDirectory, CURRENT_SLOT);
    }
    renameSlot(messageDirectory, PREVIOUS_SLOT, CURRENT_SLOT);
    current = safeSlot(messageDirectory, CURRENT_SLOT);
  }

  if (priorMatches(current)) {
    if (!sameTransactionMessage(transaction.message, journal.priorMessage)) {
      if (transaction.phase !== "message-ready") {
        fail(
          "MESSAGE_REPLACEMENT_CORRUPT",
          "The transaction advanced without a recoverable canonical candidate.",
        );
      }
      transaction = updateTransaction(transactionPath, "message-ready", {
        ...transaction,
        message: journal.priorMessage,
      });
    }
    cleanupReplacementRemnants(transaction, messageDirectory, journalPath);
    return steadyCanonicalMessage(transaction, messageDirectory);
  }

  fail(
    "MESSAGE_REPLACEMENT_CORRUPT",
    "Neither side of the pending canonical message replacement is recoverable.",
  );
}

export function readCanonicalMessage(transactionPath) {
  return recoverCanonicalMessageReplacement(transactionPath);
}

function assertReplacementRoute(transaction, source) {
  if (!MESSAGE_SOURCES.has(source)) {
    fail(
      "MESSAGE_SOURCE_INVALID",
      `Unknown canonical message source ${JSON.stringify(source)}.`,
    );
  }

  const allowed =
    (transaction.route === "concise" &&
      source === "checked-file" &&
      new Set(["evidence-ready", "message-ready"]).has(transaction.phase)) ||
    (transaction.route === "concise" &&
      source === "approved-subject" &&
      transaction.phase === "evidence-ready") ||
    (transaction.route === "extended" &&
      source === "finalized-extended" &&
      new Set(["review-pending", "message-ready"]).has(transaction.phase));

  if (!allowed || transaction.commit !== null) {
    fail(
      "MESSAGE_REPLACEMENT_NOT_ALLOWED",
      `Source ${source} cannot replace a message for ${transaction.route ?? "unrouted"} phase ${transaction.phase}.`,
    );
  }
}

export function replaceCanonicalMessage({
  transactionPath,
  bytes: inputBytes,
  validation,
  source,
  failureInjector = () => {},
}) {
  if (!Buffer.isBuffer(inputBytes) && !(inputBytes instanceof Uint8Array)) {
    fail("MESSAGE_BYTES_REQUIRED", "Canonical replacement requires bytes.");
  }

  const bytes = Buffer.from(inputBytes);

  if (bytes.length === 0 || bytes.length > MAXIMUM_CANONICAL_MESSAGE_BYTES) {
    fail(
      "MESSAGE_DISPLAY_BUDGET_EXCEEDED",
      `Canonical message must contain 1-${MAXIMUM_CANONICAL_MESSAGE_BYTES} bytes.`,
    );
  }

  let transaction = readTransaction(transactionPath);

  assertReplacementRoute(transaction, source);
  assertValidationMatches(bytes, validation, source);
  const prior = recoverCanonicalMessageReplacement(transactionPath);

  transaction = readTransaction(transactionPath);
  assertReplacementRoute(transaction, source);
  const messageDirectory = ensureMessageDirectory(transaction);
  const journalPath = artifactPath(transaction, PENDING_JOURNAL_NAME);

  if (
    existsSync(journalPath) ||
    existsSync(slotPaths(messageDirectory, CANDIDATE_SLOT).directory) ||
    existsSync(slotPaths(messageDirectory, PREVIOUS_SLOT).directory)
  ) {
    fail(
      "MESSAGE_REPLACEMENT_OCCUPIED",
      "Canonical replacement remnants remain after recovery.",
    );
  }

  const candidate = writeCandidate({
    messageDirectory,
    bytes,
    validation,
    source,
    revision: (prior?.messageRevision ?? 0) + 1,
    failureInjector,
  });
  const journal = {
    schemaVersion: 1,
    priorMessage: prior?.transactionState ?? null,
    nextMessage: candidate.transactionState,
  };

  failureInjector("before-journal-flush");
  writeNewFile(journalPath, canonicalJsonBytes(journal));
  flushDirectory(transaction.attemptDirectory);
  failureInjector("after-journal-flush");
  failureInjector("before-current-to-previous");

  if (prior !== null) {
    renameSlot(messageDirectory, CURRENT_SLOT, PREVIOUS_SLOT);
  }

  failureInjector("after-current-to-previous");
  failureInjector("before-candidate-to-current");
  renameSlot(messageDirectory, CANDIDATE_SLOT, CURRENT_SLOT);
  failureInjector("after-candidate-to-current");
  failureInjector("before-transaction-advance");
  transaction = installTransactionMessage(
    transactionPath,
    journal.priorMessage,
    journal.nextMessage,
  );
  failureInjector("after-transaction-advance");
  failureInjector("before-remnant-cleanup");
  cleanupReplacementRemnants(transaction, messageDirectory, journalPath);
  failureInjector("after-remnant-cleanup");

  return steadyCanonicalMessage(transaction, messageDirectory);
}
