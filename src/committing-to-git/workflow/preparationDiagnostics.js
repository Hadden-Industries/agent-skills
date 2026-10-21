/** Read historical preparation failures separately from current effect facts. */
import { readTransaction } from "../transaction/transactionWorkspace.js";
import { createWorkflowResult } from "../diagnostics/diagnosticContract.js";
import { transactionDiagnosticState } from "../transaction/transactionDiagnosticState.js";
import { readProcessDiagnostics } from "./processDiagnostics.js";
import { correctionAdvice } from "./preparationCorrection.js";

/** Project admitted records without recreating errors, inputs or transaction state. */
export function preparationDiagnostics(transaction) {
  return {
    originalDiagnostic: transaction.preparationFailure?.diagnostic ?? null,
    diagnosticAvailability: transaction.preparationFailure
      ? "retained"
      : "not-retained",
    snapshotObservation:
      transaction.preparationFailure?.snapshotObservation ?? null,
    resumeAllowed: false,
    correction: {
      ...correctionAdvice(transaction),
      repositoryDirectory: transaction.repositoryRoot,
      authority:
        "Informational only; fresh preparation and later message approval require current authority.",
      sectionIntent:
        "Carry requested Rationale:, User Experience Changes: and File Changes: into the semantic worksheet; preparation does not retain section intent.",
    },
  };
}

/** Historical inspection may recommend fresh work, never resume the stopped attempt. */
export function preparationCorrectionRecovery(diagnostics) {
  return {
    kind: diagnostics.correction.commands.length
      ? "correct-input"
      : "satisfy-prerequisite",
    automatic: false,
    requiredInputs: diagnostics.correction.requiredInputs,
    commands: diagnostics.correction.commands,
  };
}

/** Aggregate preparation and process domains; the process reader remains process-only. */
export function readWorkflowDiagnostics(options) {
  const processResult = readProcessDiagnostics(options);
  const transaction = readTransaction(options.transactionPath);
  const diagnostics = preparationDiagnostics(transaction);
  return createWorkflowResult({
    disposition: "succeeded",
    status: "diagnostics-read",
    ...transactionDiagnosticState(transaction, options.transactionPath),
    ...(transaction.phase === "stopped"
      ? { recovery: preparationCorrectionRecovery(diagnostics) }
      : {}),
    data: {
      commitOid: transaction.commit?.commitOid ?? null,
      processDiagnostics: processResult.processDiagnostics,
      preparationDiagnostics: diagnostics,
    },
  });
}
