import { resolve } from "node:path";

import { semanticContentContract } from "../message/semanticContentContract.js";

/** Recover message authoring only when the durable phase permits that operation. */
export function messageAuthoringRecovery(transaction, transactionPath) {
  const handle = resolve(transactionPath);
  const concise =
    transaction.route === "concise" && transaction.phase === "evidence-ready";
  const extended =
    transaction.route === "extended" &&
    ["review-pending", "authoring-pending"].includes(transaction.phase);
  if (!concise && !extended) {
    return {
      details: { nextAction: "inspect-state" },
      recovery: {
        kind: "inspect-state",
        automatic: false,
        requiredInputs: [handle],
        commands: [],
      },
    };
  }
  const progress = concise
    ? {
        nextAction: "author-message",
        messagePath: resolve(transaction.attemptDirectory, "message-input.txt"),
        contentPath: null,
      }
    : authoringProgress(transaction);
  const command =
    progress.nextAction === "review-next"
      ? ["workflow", "review-next"]
      : progress.nextAction === "author-content"
        ? ["message", "finalize"]
        : ["message", "check"];
  const arguments_ = [...command, "--transaction", handle];
  if (
    progress.nextAction === "review-next" &&
    progress.reviewProgress.nextCursor !== null
  )
    arguments_.push("--cursor", progress.reviewProgress.nextCursor);
  return {
    details: progress,
    recovery: {
      kind:
        progress.nextAction === "review-next"
          ? "satisfy-prerequisite"
          : "correct-input",
      automatic: false,
      requiredInputs: [
        progress.contentPath ??
          progress.messagePath ??
          "review the delivered evidence",
      ],
      commands: [{ arguments: arguments_ }],
    },
  };
}

export function authoringProgress(transaction) {
  if (
    transaction?.review === null ||
    !Array.isArray(transaction?.review?.deliveryPacketIds)
  ) {
    throw new Error("Authoring progress requires extended review state.");
  }

  const requiredPacketCount = transaction.review.deliveryPacketIds.length;
  const traversal = transaction.review.traversal;
  const receiptComplete =
    transaction.review.receipt?.requiredPacketsReviewed === true;
  const deliveredPacketCount =
    traversal?.deliveredPacketCount ??
    (receiptComplete ? requiredPacketCount : 0);
  const complete =
    receiptComplete && deliveredPacketCount === requiredPacketCount;
  const structuredContentRequired =
    complete && transaction.review.semanticStructureRequired === true;

  return {
    reviewRequired: !complete,
    reviewProgress: {
      deliveredPacketCount,
      requiredPacketCount,
      complete,
      nextCursor: traversal?.nextCursor ?? null,
    },
    nextAction: complete
      ? structuredContentRequired
        ? "author-content"
        : "author-message"
      : "review-next",
    contentPath: structuredContentRequired
      ? resolve(transaction.attemptDirectory, "content.json")
      : null,
    contentContract: structuredContentRequired
      ? semanticContentContract(transaction.review.structuredMessageMode)
      : null,
    messagePath:
      complete && !structuredContentRequired
        ? resolve(transaction.attemptDirectory, "message-input.txt")
        : null,
  };
}
