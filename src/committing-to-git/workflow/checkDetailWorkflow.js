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

class CheckDetailError extends Error {
  constructor(code, message, { exitCode = 2, details = {} } = {}) {
    super(message);
    this.name = "CheckDetailError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function fail(code, message, options) {
  throw new CheckDetailError(code, message, options);
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
  const result = {
    schemaVersion: 1,
    status: "check-detail",
    phase: transaction.phase,
    terminalDisposition: transaction.terminalDisposition,
    transaction: resolve(transactionPath),
    route: transaction.route,
    commitState: transaction.commit?.commitOid ? "created" : "absent",
    publicationState: "not-requested",
    publicationAllowed: transaction.report?.publicationAllowed ?? false,
    recoveryRequired: false,
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
    exitCode: 0,
  };

  return {
    ...result,
    displayText: [
      `Receipt: ${receiptId}`,
      `Segment: ${stream}/${segment}`,
      `Bytes: ${offset}-${nextOffset} of ${segmentByteCount}`,
      `Complete: ${complete ? "yes" : "no"}`,
      `Content (${content.encoding}, JSON string): ${JSON.stringify(content.value)}`,
      "",
    ].join("\n"),
  };
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
      { exitCode: 1 },
    );
  }

  let initial;

  try {
    initial = lstatSync(expectedPath, { bigint: true });
  } catch (error) {
    fail(
      "CHECK_DETAIL_UNAVAILABLE",
      `The retained output segment is unavailable: ${error.code ?? error.message}.`,
      { exitCode: 1 },
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
      { exitCode: 1 },
    );
  }

  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW;
  let descriptor;

  try {
    descriptor = openSync(expectedPath, fsConstants.O_RDONLY + noFollow);
  } catch (error) {
    fail(
      "CHECK_DETAIL_UNAVAILABLE",
      `The retained output segment cannot be opened: ${error.code ?? error.message}.`,
      { exitCode: 1 },
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
        { exitCode: 1 },
      );
    }

    return bytes;
  } catch (error) {
    if (error instanceof CheckDetailError) {
      throw error;
    }

    fail(
      "CHECK_DETAIL_ARTIFACT_CHANGED",
      `The retained output segment changed while it was read: ${error.message}.`,
      { exitCode: 1 },
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
      { exitCode: 1 },
    );
  }

  if (attempt.output === null) {
    fail(
      "CHECK_DETAIL_UNAVAILABLE",
      `Receipt ${receiptId} has no retained process output.`,
      { exitCode: 1 },
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

function parseFlags(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];

    if (
      typeof token !== "string" ||
      !token.startsWith("--") ||
      typeof value !== "string"
    ) {
      fail(
        "CHECK_DETAIL_ARGUMENTS_INVALID",
        "workflow check-detail options require --name value pairs.",
      );
    }

    const name = token.slice(2);

    if (
      !new Set([
        "transaction",
        "receipt",
        "stream",
        "segment",
        "offset",
        "format",
      ]).has(name) ||
      values.has(name)
    ) {
      fail(
        "CHECK_DETAIL_ARGUMENTS_INVALID",
        `Unknown or repeated workflow check-detail option: ${token}.`,
      );
    }

    values.set(name, value);
  }

  return values;
}

function invalidResult(error, transactionPath) {
  const result = {
    schemaVersion: 1,
    status: "invalid",
    phase: null,
    terminalDisposition: null,
    transaction:
      typeof transactionPath === "string" ? resolve(transactionPath) : null,
    route: null,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    code: error.code ?? "CHECK_DETAIL_FAILED",
    message: error.message,
    ...error.details,
    exitCode: error.exitCode ?? 2,
  };

  return {
    ...result,
    displayText: `Status: invalid\nCode: ${result.code}\nMessage: ${result.message}\n`,
  };
}

export function runCheckDetailCommand(
  argv,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  let flags = null;

  try {
    flags = parseFlags(argv);
    const format = flags.get("format") ?? "json";

    if (!new Set(["json", "text"]).has(format)) {
      fail(
        "CHECK_DETAIL_FORMAT_INVALID",
        "Check detail output format must be json or text.",
      );
    }

    const transactionPath = flags.get("transaction");

    if (typeof transactionPath !== "string") {
      fail(
        "CHECK_DETAIL_TRANSACTION_REQUIRED",
        "workflow check-detail requires --transaction <transaction.json>.",
      );
    }

    const offsetText = flags.get("offset") ?? "0";
    const offset = Number(offsetText);
    const result = checkDetailWorkflow({
      transactionPath,
      receiptId: flags.get("receipt") ?? null,
      stream: flags.get("stream") ?? null,
      segment: flags.get("segment") ?? null,
      offset,
    });

    stdout.write(
      format === "text" ? result.displayText : `${JSON.stringify(result)}\n`,
    );
    return result.exitCode;
  } catch (caught) {
    const error =
      caught instanceof CheckDetailError
        ? caught
        : new CheckDetailError("CHECK_DETAIL_FAILED", caught.message);
    const result = invalidResult(error, flags?.get("transaction") ?? null);
    const format = flags?.get("format") ?? "json";

    stderr.write(`${result.code}: ${result.message}\n`);
    stdout.write(
      format === "text" ? result.displayText : `${JSON.stringify(result)}\n`,
    );
    return result.exitCode;
  }
}
