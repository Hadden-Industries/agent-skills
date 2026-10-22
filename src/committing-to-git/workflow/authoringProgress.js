import { resolve } from "node:path";

import { semanticContentContract } from "../message/semanticContentContract.js";
import { scaffoldMessageContent } from "../message/commitMessageRenderer.js";
import { readTransactionOwnedFile } from "../message/canonicalMessageState.js";

function worksheetMatchesTemplate(transaction, template) {
  const expected = Buffer.from(`${JSON.stringify(template, null, 2)}\n`);
  try {
    const opened = readTransactionOwnedFile({
      transactionPath: resolve(
        transaction.attemptDirectory,
        "transaction.json",
      ),
      artifactName: "content.json",
      maximumBytes: expected.length,
      label: "Unedited semantic worksheet",
      allowPathReplacement: false,
    });
    return opened.bytes.equals(expected);
  } catch {
    // An edited, missing or unsafe worksheet cannot be replaced by a blank draft.
    // The ordinary authoring/finalization path supplies the relevant diagnostic.
    return false;
  }
}

/** Fixed checked-text input for a prepared concise transaction. */
export function checkedMessageAuthoring(transaction) {
  return {
    nextAction: "author-message",
    messagePath: resolve(transaction.attemptDirectory, "message-input.txt"),
    contentPath: null,
  };
}

/** Recover message authoring only when the durable phase permits that operation. */
export function messageAuthoringRecovery(
  transaction,
  transactionPath,
  { structuredInventory = false } = {},
) {
  const handle = resolve(transactionPath);
  const concise =
    transaction.route === "concise" && transaction.phase === "evidence-ready";
  const extended =
    transaction.route === "extended" &&
    ["review-pending", "authoring-pending", "message-ready"].includes(
      transaction.phase,
    );
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
    ? checkedMessageAuthoring(transaction)
    : authoringProgress(transaction);
  if (structuredInventory && concise) {
    return {
      details: { ...progress, nextAction: "extend-semantic-structure" },
      recovery: {
        kind: "correct-input",
        automatic: false,
        requiredInputs: [handle],
        commands: [
          {
            arguments: [
              "workflow",
              "extend",
              "--transaction",
              handle,
              "--reason",
              "semantic-structure-required",
            ],
          },
        ],
      },
    };
  }
  const alternative = structuredInventory ? progress.structuredAuthoring : null;
  const command = alternative
    ? ["message", "finalize"]
    : progress.nextAction === "review-next"
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
        alternative?.contentPath ??
          progress.contentPath ??
          progress.messagePath ??
          "review the delivered evidence",
      ],
      commands: [{ arguments: arguments_ }],
    },
  };
}

/** Describe the default route and, after complete evidence, the admitted semantic choice. */
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
  const templateRequested =
    structuredContentRequired && transaction.messageFormat === "detailed";
  const originalEvidenceCurrent =
    transaction.initialEvidencePlan.sha256 ===
    transaction.review.evidencePlanSha256;
  const template =
    complete && originalEvidenceCurrent
      ? scaffoldMessageContent(
          transaction.review.structuredMessageMode,
          transaction.initialEvidencePlan,
        )
      : null;
  const templateFits =
    template !== null &&
    Buffer.byteLength(JSON.stringify(template)) <= 16 * 1024;
  const templateAvailable =
    templateFits && worksheetMatchesTemplate(transaction, template);

  return {
    ...(transaction.review.preparationEvidence && originalEvidenceCurrent
      ? { capsule: transaction.review.preparationEvidence.capsule }
      : {}),
    ...(!templateRequested
      ? {}
      : {
          contentTemplate: templateAvailable ? template : null,
          contentTemplateOmittedReason: templateAvailable
            ? null
            : originalEvidenceCurrent
              ? templateFits
                ? "Read and preserve the existing contentPath; an unedited worksheet could not be confirmed."
                : "Read the fixed contentPath; the complete template exceeds the 16 KiB inline budget."
              : "Evidence was revised; continue with the authored contentPath instead of the original preparation template.",
        }),
    reviewRequired: !complete,
    ...(complete &&
    ["authoring-pending", "message-ready"].includes(transaction.phase)
      ? {
          structuredAuthoring: {
            nextAction: "author-content",
            contentPath: resolve(transaction.attemptDirectory, "content.json"),
            mode: transaction.review.structuredMessageMode,
            contentContract: semanticContentContract(
              transaction.review.structuredMessageMode,
            ),
            contentTemplate: templateAvailable ? template : null,
            contentTemplateOmittedReason: templateAvailable
              ? null
              : "Read and preserve the existing worksheet; a complete unedited inline template is unavailable.",
            arguments: [
              "message",
              "finalize",
              "--transaction",
              resolve(transaction.attemptDirectory, "transaction.json"),
            ],
          },
        }
      : {}),
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
