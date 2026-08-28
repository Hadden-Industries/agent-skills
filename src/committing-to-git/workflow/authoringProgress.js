import { resolve } from "node:path";

import { semanticContentContract } from "../message/semanticContentContract.js";

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
