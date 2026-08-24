import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

import {
  MAXIMUM_CANONICAL_MESSAGE_BYTES,
  validateApprovedMessage,
} from "../message/approvedMessage.js";
import {
  CanonicalMessageError,
  cleanupTransactionOwnedInput,
  readTransactionOwnedFile,
  replaceCanonicalMessage,
} from "../message/canonicalMessageState.js";
import { MAXIMUM_INITIAL_JSON_INPUT_BYTES } from "../transaction/transactionWorkspace.js";

export const MAXIMUM_MESSAGE_RESULT_BYTES = 80 * 1024;

const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const MESSAGE_INPUT_NAME = "message-input.txt";
const SNAPSHOT_NAME = "snapshot.json";
const FORMATS = new Set(["json", "text"]);

export class MessageWorkflowError extends Error {
  constructor(code, message, { exitCode = 2, details = {} } = {}) {
    super(message);
    this.name = "MessageWorkflowError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function fail(code, message, options) {
  throw new MessageWorkflowError(code, message, options);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeJson(bytes, label) {
  let text;

  try {
    text = STRICT_UTF8_DECODER.decode(bytes);
  } catch {
    fail("INVALID_JSON_UTF8", `${label} must contain strict UTF-8 JSON.`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    fail("INVALID_JSON_INPUT", `${label} is invalid JSON: ${error.message}`);
  }
}

function sameHeadAnchor(manifest, headAnchor) {
  if (headAnchor.headKind === "unborn") {
    return (
      manifest.headOid === null && headAnchor.expectedParentOids.length === 0
    );
  }

  return (
    typeof manifest.headOid === "string" &&
    headAnchor.expectedParentOids.length === 1 &&
    headAnchor.expectedParentOids[0] === manifest.headOid
  );
}

export function readExactRecordedSnapshot(transactionPath) {
  const opened = readTransactionOwnedFile({
    transactionPath,
    artifactName: SNAPSHOT_NAME,
    maximumBytes: MAXIMUM_INITIAL_JSON_INPUT_BYTES,
    label: "Recorded snapshot",
    allowPathReplacement: false,
  });
  const { transaction, bytes } = opened;
  const expectedPath = resolve(transaction.attemptDirectory, SNAPSHOT_NAME);

  if (resolve(transaction.snapshot?.path ?? "") !== expectedPath) {
    fail(
      "SNAPSHOT_PATH_MISMATCH",
      "The transaction snapshot does not use its fixed transaction-local path.",
    );
  }

  if (sha256(bytes) !== transaction.snapshot.sha256) {
    fail(
      "SNAPSHOT_CHANGED",
      "The recorded snapshot bytes changed after preparation.",
    );
  }

  const manifest = decodeJson(bytes, "Recorded snapshot");

  if (
    resolve(manifest.repositoryRoot) !== resolve(transaction.repositoryRoot) ||
    manifest.indexTreeOid !== transaction.snapshot.indexTreeOid ||
    manifest.changeUnitCount !== transaction.snapshot.changeUnitCount ||
    !Array.isArray(manifest.changeUnits) ||
    manifest.changeUnitCount !== manifest.changeUnits.length ||
    !sameHeadAnchor(manifest, transaction.headAnchor)
  ) {
    fail(
      "SNAPSHOT_ANCHOR_MISMATCH",
      "The recorded snapshot does not match the transaction repository, HEAD, tree, and inventory anchors.",
    );
  }

  return {
    transaction,
    manifest: { ...manifest, manifestSha256: transaction.snapshot.sha256 },
    bytes,
  };
}

function resultBytes(result) {
  return Buffer.byteLength(`${JSON.stringify(result)}\n`, "utf8");
}

export function assertMessageResultBudget(result) {
  const byteCount = resultBytes(result);

  if (byteCount > MAXIMUM_MESSAGE_RESULT_BYTES) {
    fail(
      "MESSAGE_RESULT_BUDGET_EXCEEDED",
      `Message result is ${byteCount} bytes; maximum is ${MAXIMUM_MESSAGE_RESULT_BYTES}.`,
      { details: { byteCount, maximumBytes: MAXIMUM_MESSAGE_RESULT_BYTES } },
    );
  }

  return result;
}

function commonResult(transactionPath, route, status, phase) {
  return {
    schemaVersion: 1,
    status,
    phase,
    terminalDisposition: null,
    route,
    transaction: resolve(transactionPath),
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
  };
}

function checkedResult({ transactionPath, canonical, validation, warnings }) {
  return {
    ...commonResult(
      transactionPath,
      "concise",
      "message-ready",
      "message-ready",
    ),
    messageSource: "checked-file",
    messageRevision: canonical.messageRevision,
    messageSha256: canonical.messageSha256,
    presentationWarnings: validation.presentationWarnings,
    ...(warnings.length === 0 ? {} : { cleanupWarnings: warnings }),
    displayText: canonical.displayText,
  };
}

function prospectiveCheckedResult({
  transactionPath,
  revision,
  validation,
  displayText,
  inputPath,
}) {
  return checkedResult({
    transactionPath,
    canonical: {
      messageRevision: revision,
      messageSha256: validation.messageSha256,
      displayText,
    },
    validation,
    warnings: [
      {
        code: "MESSAGE_INPUT_CLEANUP_FAILED",
        message:
          "The fixed input was retained because cleanup could not prove safe same-object removal.",
        path: inputPath,
      },
    ],
  });
}

function assertCheckTransaction(transaction, transactionPath) {
  if (
    transaction.route !== "concise" ||
    !new Set(["evidence-ready", "message-ready"]).has(transaction.phase) ||
    transaction.commit !== null
  ) {
    fail(
      "MESSAGE_CHECK_NOT_ALLOWED",
      `Message checking requires a precommit concise evidence-ready or message-ready transaction, not ${transaction.route ?? "unrouted"}/${transaction.phase}.`,
      { details: { transaction: resolve(transactionPath) } },
    );
  }
}

export function checkMessageWorkflow({
  transactionPath,
  afterInputOpen,
  forceCleanupIdentityUnavailable = false,
} = {}) {
  if (typeof transactionPath !== "string" || transactionPath.length === 0) {
    fail("MISSING_ARGUMENT", "--transaction is required for message check.");
  }

  const opened = readTransactionOwnedFile({
    transactionPath,
    artifactName: MESSAGE_INPUT_NAME,
    maximumBytes: MAXIMUM_CANONICAL_MESSAGE_BYTES,
    label: "Fixed canonical message input",
    afterOpen: afterInputOpen,
    allowPathReplacement: true,
  });

  assertCheckTransaction(opened.transaction, transactionPath);
  const { transaction, manifest } = readExactRecordedSnapshot(transactionPath);

  assertCheckTransaction(transaction, transactionPath);
  const validation = validateApprovedMessage({
    manifest,
    route: "concise",
    bytes: opened.bytes,
    repositoryTypePolicy: transaction.repositoryTypePolicy,
    messageSource: "checked-file",
  });
  const nextRevision = (transaction.message?.revision ?? 0) + 1;

  // Preflight the largest cleanup-warning form before changing durable state.
  assertMessageResultBudget(
    prospectiveCheckedResult({
      transactionPath,
      revision: nextRevision,
      validation,
      displayText: validation.displayText,
      inputPath: opened.path,
    }),
  );

  const canonical = replaceCanonicalMessage({
    transactionPath,
    bytes: opened.bytes,
    validation,
    source: "checked-file",
  });
  const cleanup = cleanupTransactionOwnedInput({
    path: opened.path,
    identity: opened.identity,
    forceIdentityUnavailable: forceCleanupIdentityUnavailable,
  });
  const result = checkedResult({
    transactionPath,
    canonical,
    validation,
    warnings: cleanup.warning === null ? [] : [cleanup.warning],
  });

  return assertMessageResultBudget(result);
}

export function parseMessageWorkflowArguments(argv, command) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];

    if (!new Set(["--transaction", "--format"]).has(token)) {
      fail("UNKNOWN_ARGUMENT", `Unknown message ${command} flag ${token}.`);
    }

    if (value === undefined || value.length === 0) {
      fail("INVALID_ARGUMENT", `${token} requires a non-empty value.`);
    }

    if (values.has(token)) {
      fail("DUPLICATE_ARGUMENT", `${token} may be supplied only once.`);
    }

    values.set(token, value);
  }

  if (!values.has("--transaction")) {
    fail(
      "MISSING_ARGUMENT",
      `--transaction is required for message ${command}.`,
    );
  }

  const format = values.get("--format") ?? "json";

  if (!FORMATS.has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  return { transactionPath: values.get("--transaction"), format };
}

export function messageErrorResult(error, transactionPath = null) {
  return {
    schemaVersion: 1,
    status: error.exitCode === 1 ? "evidence-required" : "invalid",
    phase: error.details?.phase ?? null,
    terminalDisposition: null,
    transaction:
      error.details?.transaction ??
      (typeof transactionPath === "string" ? resolve(transactionPath) : null),
    route: error.details?.route ?? null,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: error.details?.recoveryRequired ?? false,
    code: error.code,
    message: error.message,
    ...Object.fromEntries(
      Object.entries(error.details ?? {}).filter(
        ([key]) =>
          !new Set(["phase", "transaction", "route", "recoveryRequired"]).has(
            key,
          ),
      ),
    ),
  };
}

export function asMessageWorkflowError(caught, fallbackCode) {
  if (caught instanceof MessageWorkflowError) {
    return caught;
  }

  if (
    caught instanceof CanonicalMessageError ||
    (typeof caught?.code === "string" && caught.code.length > 0)
  ) {
    return new MessageWorkflowError(caught.code, caught.message, {
      exitCode: caught.exitCode ?? 2,
      details: caught.details ?? {},
    });
  }

  return new MessageWorkflowError(fallbackCode, caught.message);
}

export async function runCheckMessageCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  let options = null;

  try {
    options = parseMessageWorkflowArguments(argv, "check");
    const result = checkMessageWorkflow(options);
    stdout.write(
      options.format === "text"
        ? result.displayText
        : `${JSON.stringify(result)}\n`,
    );
    return 0;
  } catch (caught) {
    const error = asMessageWorkflowError(caught, "MESSAGE_CHECK_FAILED");
    const result = assertMessageResultBudget(
      messageErrorResult(error, options?.transactionPath),
    );

    // Validation failures always remain one machine-readable JSON value even
    // when a caller requested text for successful display.
    stdout.write(`${JSON.stringify(result)}\n`);
    return error.exitCode;
  }
}
