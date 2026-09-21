import { resolve } from "node:path";
import { readTransaction } from "./transactionWorkspace.js";

/** Durable domain facts; a failed admission never proves absence of a mutation. */
export function transactionDiagnosticState(transaction, transactionPath) {
  const publication = transaction.publicationAttempts.at(-1);
  return {
    transaction: resolve(transactionPath),
    phase: transaction.phase,
    route: transaction.route,
    commitState: transaction.commit?.commitOid
      ? "created"
      : transaction.phase === "commit-pending"
        ? "unknown"
        : "absent",
    commitOid: transaction.commit?.commitOid ?? null,
    publicationState:
      publication === undefined
        ? transaction.report?.publicationAllowed === false
          ? "blocked"
          : "not-requested"
        : ["succeeded", "observed-matching"].includes(publication.status)
          ? "published"
          : ["rejected", "blocked"].includes(publication.status)
            ? publication.status
            : "unknown",
    publicationAllowed: transaction.report?.publicationAllowed ?? false,
    recoveryRequired:
      ["commit-pending", "publication-pending"].includes(transaction.phase) ||
      (Boolean(transaction.snapshot?.promotion) &&
        transaction.snapshot.promotion.status !== "installed"),
  };
}

/** Observe after failure without changing state, recovering, or retrying anything. */
export function observeTransactionFailure(options) {
  if (typeof options?.transactionPath !== "string") return {};
  try {
    return transactionDiagnosticState(
      readTransaction(options.transactionPath),
      options.transactionPath,
    );
  } catch {
    return {};
  }
}
