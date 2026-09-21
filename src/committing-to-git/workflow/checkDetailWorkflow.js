import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { createWorkflowResult } from "../diagnostics/diagnosticContract.js";
import { executeCommand } from "../cli/commandExecution.js";
import { parseCommandArguments } from "../cli/commandArguments.js";

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { readTransaction } from "../transaction/transactionWorkspace.js";

export const CHECK_DETAIL_PAGE_BYTES = 16 * 1024;

const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const RECEIPT_ID_PATTERN = /^C[0-9]{6}$/u;

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function identity(stat) {
  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    size: Number(stat.size),
  };
}

function sameIdentity(left, right) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size
  );
}

function contentFor(bytes) {
  try {
    return {
      encoding: "utf8",
      value: STRICT_UTF8_DECODER.decode(bytes),
    };
  } catch {
    return {
      encoding: "base64",
      value: bytes.toString("base64"),
    };
  }
}

function emptyDetail({
  transactionPath,
  transaction,
  receiptId,
  stream,
  segment,
}) {
  const content = { encoding: "utf8", value: "" };

  return detailResult({
    transactionPath,
    transaction,
    receiptId,
    stream,
    segment,
    offset: 0,
    nextOffset: 0,
    complete: true,
    byteCount: 0,
    segmentByteCount: 0,
    pageSha256: sha256(Buffer.alloc(0)),
    content,
  });
}

function detailResult({
  transactionPath,
  transaction,
  receiptId,
  stream,
  segment,
  offset,
  nextOffset,
  complete,
  byteCount,
  segmentByteCount,
  pageSha256,
  content,
}) {
  return createWorkflowResult({
    disposition: "succeeded",
    status: "check-detail",
    phase: transaction.phase,
    transaction: resolve(transactionPath),
    route: transaction.route,
    commitState: transaction.commit?.commitOid ? "created" : "absent",
    publicationState: "not-requested",
    publicationAllowed: transaction.report?.publicationAllowed ?? false,
    recoveryRequired: false,
    data: {
      terminalDisposition: transaction.terminalDisposition,
      receiptId,
      stream,
      segment,
      offset,
      nextOffset,
      complete,
      byteCount,
      segmentByteCount,
      pageSha256,
      content,
    },
  });
}

function readBoundSegment({
  transaction,
  receiptId,
  stream,
  segment,
  recordedPath,
  recordedByteCount,
  recordedSha256,
}) {
  const expectedPath = join(
    resolve(transaction.attemptDirectory),
    "process-logs",
    `check-${receiptId}-${stream}-${segment}.bin`,
  );

  if (resolve(recordedPath) !== expectedPath) {
    fail(
      "CHECK_DETAIL_ARTIFACT_CHANGED",
      "The retained output path is not the helper-owned path for this receipt.",
      { disposition: "rejected" },
    );
  }

  let initial;

  try {
    initial = lstatSync(expectedPath, { bigint: true });
  } catch (error) {
    fail(
      "CHECK_DETAIL_UNAVAILABLE",
      "The retained output segment is unavailable.",
      { disposition: "rejected", cause: error },
    );
  }

  if (
    initial.isSymbolicLink() ||
    !initial.isFile() ||
    realpathSync(expectedPath) !== resolve(expectedPath)
  ) {
    fail(
      "CHECK_DETAIL_ARTIFACT_CHANGED",
      "The retained output segment was replaced or is not a regular file.",
      { disposition: "rejected" },
    );
  }

  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW;
  let descriptor;

  try {
    descriptor = openSync(expectedPath, fsConstants.O_RDONLY + noFollow);
  } catch (error) {
    fail(
      "CHECK_DETAIL_UNAVAILABLE",
      "The retained output segment cannot be opened.",
      { disposition: "rejected", cause: error },
    );
  }

  try {
    const before = fstatSync(descriptor, { bigint: true });
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const final = lstatSync(expectedPath, { bigint: true });

    if (
      !before.isFile() ||
      !after.isFile() ||
      final.isSymbolicLink() ||
      !final.isFile() ||
      !sameIdentity(identity(initial), identity(before)) ||
      !sameIdentity(identity(before), identity(after)) ||
      !sameIdentity(identity(after), identity(final)) ||
      bytes.length !== recordedByteCount ||
      sha256(bytes) !== recordedSha256
    ) {
      fail(
        "CHECK_DETAIL_ARTIFACT_CHANGED",
        "The retained output segment no longer matches its witnessed receipt.",
        { disposition: "rejected" },
      );
    }

    return bytes;
  } catch (error) {
    if (error instanceof WorkflowDiagnosticError) {
      throw error;
    }

    fail(
      "CHECK_DETAIL_ARTIFACT_CHANGED",
      "The retained output segment changed while it was read.",
      { disposition: "rejected", cause: error },
    );
  } finally {
    closeSync(descriptor);
  }
}

export function checkDetailWorkflow({
  transactionPath,
  receiptId,
  stream,
  segment,
  offset = 0,
}) {
  if (typeof receiptId !== "string" || !RECEIPT_ID_PATTERN.test(receiptId)) {
    fail(
      "CHECK_DETAIL_RECEIPT_INVALID",
      "Check detail requires a canonical receipt ID such as C000001.",
    );
  }

  if (!new Set(["stdout", "stderr"]).has(stream)) {
    fail(
      "CHECK_DETAIL_STREAM_INVALID",
      "Check detail stream must be stdout or stderr.",
    );
  }

  if (!new Set(["head", "tail"]).has(segment)) {
    fail(
      "CHECK_DETAIL_SEGMENT_INVALID",
      "Check detail segment must be head or tail.",
    );
  }

  if (!Number.isSafeInteger(offset) || offset < 0) {
    fail(
      "CHECK_DETAIL_OFFSET_INVALID",
      "Check detail offset must be a non-negative safe integer.",
    );
  }

  const transaction = readTransaction(transactionPath);
  const attempt = transaction.checkAttempts.find(
    (candidate) => candidate.receiptId === receiptId,
  );

  if (attempt === undefined) {
    fail(
      "CHECK_DETAIL_RECEIPT_NOT_FOUND",
      `Receipt ${receiptId} is not part of this transaction.`,
      { disposition: "rejected" },
    );
  }

  if (attempt.output === null) {
    fail(
      "CHECK_DETAIL_UNAVAILABLE",
      `Receipt ${receiptId} has no retained process output.`,
      { disposition: "rejected" },
    );
  }

  const channel = attempt.output[stream];
  const recordedPath = channel[`${segment}Path`];
  const recordedByteCount = channel[`${segment}ByteCount`];
  const recordedSha256 = channel[`${segment}Sha256`];

  if (recordedByteCount === 0) {
    if (offset !== 0) {
      fail(
        "CHECK_DETAIL_OFFSET_INVALID",
        "Check detail offset exceeds the empty retained segment.",
      );
    }

    return emptyDetail({
      transactionPath,
      transaction,
      receiptId,
      stream,
      segment,
    });
  }

  const bytes = readBoundSegment({
    transaction,
    receiptId,
    stream,
    segment,
    recordedPath,
    recordedByteCount,
    recordedSha256,
  });

  if (offset > bytes.length) {
    fail(
      "CHECK_DETAIL_OFFSET_INVALID",
      "Check detail offset exceeds the retained segment.",
    );
  }

  const page = bytes.subarray(offset, offset + CHECK_DETAIL_PAGE_BYTES);
  const nextOffset = offset + page.length;

  return detailResult({
    transactionPath,
    transaction,
    receiptId,
    stream,
    segment,
    offset,
    nextOffset,
    complete: nextOffset === bytes.length,
    byteCount: page.length,
    segmentByteCount: bytes.length,
    pageSha256: sha256(page),
    content: contentFor(page),
  });
}

function parseArguments(argv) {
  const flags = parseCommandArguments("workflow check-detail", argv).values;
  const format = flags.get("format") ?? "json";
  if (!["json", "text"].includes(format))
    fail(
      "CHECK_DETAIL_FORMAT_INVALID",
      "Check detail output format must be json or text.",
    );
  const transactionPath = flags.get("transaction");
  if (typeof transactionPath !== "string")
    fail(
      "CHECK_DETAIL_TRANSACTION_REQUIRED",
      "workflow check-detail requires --transaction <transaction.json>.",
    );
  return {
    transactionPath,
    format,
    receiptId: flags.get("receipt") ?? null,
    stream: flags.get("stream") ?? null,
    segment: flags.get("segment") ?? null,
    offset: Number(flags.get("offset") ?? "0"),
  };
}
export async function runCheckDetailCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    failureState: observeTransactionFailure,
    parse: parseArguments,
    execute: checkDetailWorkflow,
    stdout,
  });
}
