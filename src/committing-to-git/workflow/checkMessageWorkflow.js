import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { presentationDiagnostics } from "../message/approvedMessage.js";
import { parseCommandArguments } from "../cli/commandArguments.js";
import { executeCommand } from "../cli/commandExecution.js";
import {
  createWorkflowResult,
  createWorkflowWarning,
} from "../diagnostics/diagnosticContract.js";

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

import {
  MAXIMUM_CANONICAL_MESSAGE_BYTES,
  validateApprovedMessage,
} from "../message/approvedMessage.js";
import {
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

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
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
    fail("INVALID_JSON_INPUT", `${label} is invalid JSON.`, { cause: error });
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

function checkedResult({
  transactionPath,
  route,
  canonical,
  validation,
  warnings,
}) {
  return createWorkflowResult({
    disposition: "succeeded",
    status: "message-ready",
    phase: "message-ready",
    route,
    transaction: resolve(transactionPath),
    commitState: "absent",
    publicationState: "not-requested",
    warnings: [
      ...warnings,
      ...presentationDiagnostics(validation.presentationWarnings),
    ],
    data: {
      terminalDisposition: null,
      messageSource: "checked-file",
      messageRevision: canonical.messageRevision,
      messageSha256: canonical.messageSha256,
      presentationWarnings: validation.presentationWarnings,
      displayText: canonical.displayText,
    },
  });
}

function prospectiveCheckedResult({
  transactionPath,
  revision,
  validation,
  displayText,
  inputPath,
  route,
}) {
  return checkedResult({
    transactionPath,
    route,
    canonical: {
      messageRevision: revision,
      messageSha256: validation.messageSha256,
      displayText,
    },
    validation,
    warnings: [
      createWorkflowWarning({
        code: "MESSAGE_INPUT_CLEANUP_FAILED",
        message:
          "The fixed input was retained because cleanup could not prove safe same-object removal.",
        details: [{ kind: "prerequisite", path: inputPath }],
      }),
    ],
  });
}

function assertCheckTransaction(transaction, transactionPath) {
  const conciseAllowed =
    transaction.route === "concise" &&
    new Set(["evidence-ready", "message-ready"]).has(transaction.phase);
  const receipt = transaction.review?.receipt;
  const extendedAllowed =
    transaction.route === "extended" &&
    new Set(["authoring-pending", "message-ready"]).has(transaction.phase) &&
    transaction.review.semanticStructureRequired === false &&
    receipt?.requiredPacketsReviewed === true &&
    receipt.catalogSha256 === transaction.review.catalogSha256 &&
    receipt.evidencePlanSha256 === transaction.review.evidencePlanSha256;

  if ((!conciseAllowed && !extendedAllowed) || transaction.commit !== null) {
    fail(
      "MESSAGE_CHECK_NOT_ALLOWED",
      `Message checking requires concise evidence or a completed non-semantic extended review, not ${transaction.route ?? "unrouted"}/${transaction.phase}.`,
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
    route: transaction.route,
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
      route: transaction.route,
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
    route: transaction.route,
    canonical,
    validation,
    warnings: cleanup.warning === null ? [] : [cleanup.warning],
  });

  return assertMessageResultBudget(result);
}

export function parseMessageWorkflowArguments(argv, command) {
  const { values } = parseCommandArguments(`message ${command}`, argv);

  if (!values.has("transaction")) {
    fail(
      "MISSING_ARGUMENT",
      `--transaction is required for message ${command}.`,
    );
  }

  const format = values.get("format") ?? "json";

  if (!FORMATS.has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  return { transactionPath: values.get("transaction"), format };
}

export async function runCheckMessageCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    failureState: observeTransactionFailure,
    parse: (arguments_) => parseMessageWorkflowArguments(arguments_, "check"),
    execute: checkMessageWorkflow,
    stdout,
  });
}
