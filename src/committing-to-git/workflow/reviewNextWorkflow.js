import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

import {
  createVerifiedReviewReceipt,
  readReviewCatalog,
  readVerifiedReviewPacket,
  requiredReviewPacketIds,
} from "../inspection/reviewCatalog.js";
import {
  readTransaction,
  updateTransaction,
} from "../transaction/transactionWorkspace.js";

const FORMATS = new Set(["json", "text"]);
const MAXIMUM_REVIEW_RESULT_BYTES = 80 * 1024;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

class ReviewNextError extends Error {
  constructor(code, message, { exitCode = 2, details = {} } = {}) {
    super(message);
    this.name = "ReviewNextError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function fail(code, message, options) {
  throw new ReviewNextError(code, message, options);
}

function isContained(parent, candidate) {
  const contained = relative(parent, candidate);

  return (
    contained !== "" &&
    contained !== ".." &&
    !contained.startsWith(`..${sep}`) &&
    !isAbsolute(contained)
  );
}

function readCurrentCatalog(transaction) {
  if (transaction.review === null) {
    fail(
      "REVIEW_STATE_REQUIRED",
      "The transaction has no extended review state.",
    );
  }

  const reviewDirectory = resolve(transaction.attemptDirectory, "review");
  const catalogPath = resolve(transaction.review.catalogPath);

  if (
    !isContained(transaction.attemptDirectory, catalogPath) ||
    !isContained(reviewDirectory, catalogPath)
  ) {
    fail(
      "REVIEW_CATALOG_ESCAPES_TRANSACTION",
      "The current review catalog is outside the fixed review directory.",
    );
  }

  const stat = lstatSync(catalogPath);

  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    realpathSync(catalogPath) !== catalogPath
  ) {
    fail(
      "REVIEW_CATALOG_REPLACED",
      "The current review catalog must remain a non-link regular file.",
    );
  }

  const catalog = readReviewCatalog(catalogPath);

  if (
    catalog.catalogSha256 !== transaction.review.catalogSha256 ||
    catalog.evidencePlanSha256 !== transaction.review.evidencePlanSha256 ||
    catalog.indexTreeOid !== transaction.snapshot.indexTreeOid ||
    catalog.manifestSha256 !== transaction.initialEvidencePlan.manifestSha256
  ) {
    fail(
      "REVIEW_CATALOG_MISMATCH",
      "The current review catalog does not match the transaction snapshot and evidence plan.",
    );
  }

  return catalog;
}

function assertReviewNextTransaction(transaction, transactionPath) {
  if (
    transaction.route !== "extended" ||
    !new Set(["review-pending", "message-ready"]).has(transaction.phase) ||
    transaction.commit !== null
  ) {
    fail(
      "REVIEW_NEXT_NOT_ALLOWED",
      `Packet review requires a precommit extended review-pending transaction, not ${transaction.route ?? "unrouted"}/${transaction.phase}.`,
      {
        exitCode: 1,
        details: { transaction: resolve(transactionPath) },
      },
    );
  }
}

function cursorFor({ catalogSha256, nextIndex, priorPacketSha256 }) {
  const identity = JSON.stringify({
    schemaVersion: 1,
    catalogSha256,
    nextIndex,
    priorPacketSha256,
  });
  const digest = createHash("sha256").update(identity).digest("hex");

  return `review-v1-${digest}`;
}

function assertDeliveryPacketIds(deliveryPacketIds, requiredPacketIds) {
  const deliverySet = new Set(deliveryPacketIds);
  const canonicalDeliveryOrder = requiredPacketIds.filter((id) =>
    deliverySet.has(id),
  );

  if (
    canonicalDeliveryOrder.length !== deliveryPacketIds.length ||
    canonicalDeliveryOrder.some((id, index) => id !== deliveryPacketIds[index])
  ) {
    fail(
      "REVIEW_DELIVERY_MISMATCH",
      "The stored delivery packet set is not an ordered subset of the current catalog requirements.",
    );
  }
}

function assertTraversal(traversal, catalog, deliveryPacketIds) {
  if (traversal === null) {
    return;
  }

  if (
    traversal.catalogSha256 !== catalog.catalogSha256 ||
    traversal.deliveredPacketCount > deliveryPacketIds.length ||
    traversal.complete !==
      (traversal.deliveredPacketCount === deliveryPacketIds.length)
  ) {
    fail(
      "REVIEW_TRAVERSAL_MISMATCH",
      "The stored review traversal does not match the current catalog.",
    );
  }
}

function deliverySelection({ traversal, cursor, requiredPacketIds }) {
  if (requiredPacketIds.length === 0) {
    fail(
      "REVIEW_PACKETS_EMPTY",
      "The current review has no packets to deliver.",
    );
  }

  if (traversal === null) {
    if (cursor !== null) {
      fail(
        "REVIEW_CURSOR_INVALID",
        "The first review packet must be requested without a cursor.",
      );
    }

    return { packetIndex: 0, replay: false };
  }

  // Repeating the cursor that caused the most recent delivery replays the
  // same immutable packet and progress. This makes a lost response safe to
  // retry without silently advancing the agent past unread evidence.
  if (cursor === traversal.lastRequestCursor) {
    return {
      packetIndex: traversal.deliveredPacketCount - 1,
      replay: true,
    };
  }

  if (!traversal.complete && cursor === traversal.nextCursor) {
    return {
      packetIndex: traversal.deliveredPacketCount,
      replay: false,
    };
  }

  fail(
    "REVIEW_CURSOR_INVALID",
    "The review cursor is stale, unknown, or does not belong to the next packet.",
  );
}

function assertResultBudget(result) {
  const byteCount = Buffer.byteLength(`${JSON.stringify(result)}\n`, "utf8");

  if (byteCount > MAXIMUM_REVIEW_RESULT_BYTES) {
    fail(
      "REVIEW_RESULT_BUDGET_EXCEEDED",
      `Review result is ${byteCount} bytes; maximum is ${MAXIMUM_REVIEW_RESULT_BYTES}.`,
      { details: { byteCount, maximumBytes: MAXIMUM_REVIEW_RESULT_BYTES } },
    );
  }

  return result;
}

function reviewResult({
  transaction,
  transactionPath,
  packet,
  content,
  traversal,
  requiredPacketCount,
}) {
  return assertResultBudget({
    schemaVersion: 1,
    status: transaction.status,
    phase: transaction.phase,
    terminalDisposition: transaction.terminalDisposition,
    transaction: resolve(transactionPath),
    route: transaction.route,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    packet: {
      id: packet.id,
      kind: packet.kind,
      sha256: packet.sha256,
      byteCount: packet.byteCount,
      content,
    },
    reviewProgress: {
      deliveredPacketCount: traversal.deliveredPacketCount,
      requiredPacketCount,
      complete: traversal.complete,
      nextCursor: traversal.nextCursor,
    },
  });
}

export function reviewNextWorkflow({ transactionPath, cursor = null } = {}) {
  if (typeof transactionPath !== "string" || transactionPath.length === 0) {
    fail(
      "MISSING_ARGUMENT",
      "--transaction is required for workflow review-next.",
    );
  }

  let transaction = readTransaction(transactionPath);

  assertReviewNextTransaction(transaction, transactionPath);
  const catalog = readCurrentCatalog(transaction);
  const requiredPacketIds = requiredReviewPacketIds(catalog);
  // A revised evidence plan records only its uncovered delta for delivery.
  // The final receipt still covers the complete current catalog, combining
  // that delta with coverage verified before the revision was constructed.
  const deliveryPacketIds = transaction.review.deliveryPacketIds;
  const traversal = transaction.review.traversal;

  assertDeliveryPacketIds(deliveryPacketIds, requiredPacketIds);
  assertTraversal(traversal, catalog, deliveryPacketIds);
  const selection = deliverySelection({
    traversal,
    cursor,
    requiredPacketIds: deliveryPacketIds,
  });
  const packetId = deliveryPacketIds[selection.packetIndex];
  const { packet, bytes } = readVerifiedReviewPacket(catalog, packetId);
  let content;

  try {
    content = STRICT_UTF8_DECODER.decode(bytes);
  } catch {
    fail(
      "REVIEW_PACKET_ENCODING_INVALID",
      `Review packet ${packet.id} is not strict UTF-8.`,
    );
  }

  let currentTraversal = traversal;

  if (!selection.replay) {
    const deliveredPacketCount = selection.packetIndex + 1;
    const complete = deliveredPacketCount === deliveryPacketIds.length;
    const nextCursor = complete
      ? null
      : cursorFor({
          catalogSha256: catalog.catalogSha256,
          nextIndex: deliveredPacketCount,
          priorPacketSha256: packet.sha256,
        });

    currentTraversal = {
      schemaVersion: 1,
      catalogSha256: catalog.catalogSha256,
      deliveredPacketCount,
      lastRequestCursor: cursor,
      nextCursor,
      complete,
    };
    const receipt = complete
      ? createVerifiedReviewReceipt({
          catalog,
          // Receipt construction revalidates every current packet locally;
          // only the delta above is exposed again to the reviewing agent.
          reviewedPacketIds: requiredPacketIds,
        })
      : null;

    transaction = updateTransaction(transactionPath, transaction.phase, {
      ...transaction,
      review: {
        ...transaction.review,
        receipt,
        traversal: currentTraversal,
      },
    });
  }

  return reviewResult({
    transaction,
    transactionPath,
    packet,
    content,
    traversal: currentTraversal,
    requiredPacketCount: deliveryPacketIds.length,
  });
}

export function parseReviewNextArguments(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];

    if (!new Set(["--transaction", "--cursor", "--format"]).has(token)) {
      fail("UNKNOWN_ARGUMENT", `Unknown workflow review-next flag ${token}.`);
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
      "--transaction is required for workflow review-next.",
    );
  }

  const format = values.get("--format") ?? "json";

  if (!FORMATS.has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  return {
    transactionPath: values.get("--transaction"),
    cursor: values.get("--cursor") ?? null,
    format,
  };
}

function errorResult(error, transactionPath = null) {
  return {
    schemaVersion: 1,
    status: error.exitCode === 1 ? "stopped" : "invalid",
    phase: error.details?.phase ?? null,
    terminalDisposition: null,
    transaction:
      error.details?.transaction ??
      (typeof transactionPath === "string" ? resolve(transactionPath) : null),
    route: error.details?.route ?? null,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    code: error.code,
    message: error.message,
  };
}

function textResult(result) {
  if (result.packet) {
    return [
      result.packet.content.replace(/\n$/u, ""),
      "",
      `Reviewed: ${result.reviewProgress.deliveredPacketCount}/${result.reviewProgress.requiredPacketCount}`,
      `Next cursor: ${result.reviewProgress.nextCursor ?? "complete"}`,
      "",
    ].join("\n");
  }

  return [
    `Status: ${result.status}`,
    `Code: ${result.code}`,
    `Message: ${result.message}`,
    "",
  ].join("\n");
}

export async function runReviewNextCommand(
  argv,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  let options = null;

  try {
    options = parseReviewNextArguments(argv);
    const result = reviewNextWorkflow(options);

    stdout.write(
      options.format === "text"
        ? textResult(result)
        : `${JSON.stringify(result)}\n`,
    );
    return 0;
  } catch (caught) {
    const error =
      caught instanceof ReviewNextError
        ? caught
        : new ReviewNextError(
            caught.code ?? "REVIEW_NEXT_FAILED",
            caught.message,
          );
    const result = assertResultBudget(
      errorResult(error, options?.transactionPath),
    );

    stderr.write(`${error.code}: ${error.message}\n`);
    stdout.write(
      options?.format === "text"
        ? textResult(result)
        : `${JSON.stringify(result)}\n`,
    );
    return error.exitCode;
  }
}
