import { parseCommandArguments } from "../cli/commandArguments.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { createWorkflowResult } from "../diagnostics/diagnosticContract.js";
import { executeCommand } from "../cli/commandExecution.js";
import {
  observeTransactionFailure,
  transactionDiagnosticState,
} from "../transaction/transactionDiagnosticState.js";

import { resolve } from "node:path";

import { recoverCanonicalMessageReplacement } from "../message/canonicalMessageState.js";
import {
  compactTerminalTransaction,
  purgeTransaction,
  recoverCommitOutcome,
} from "../transaction/transactionRecovery.js";
import { readTransaction } from "../transaction/transactionWorkspace.js";
import {
  completeRecordedCommit,
  readRecordedReport,
} from "./createCommitWorkflow.js";
import { recoverDraftPromotion } from "./promoteDraftWorkflow.js";
import { recoverPublicationOutcome } from "./publishWorkflow.js";
import { recoverCheckAttempt } from "./runCheckWorkflow.js";

const RESOLUTIONS = new Set([null, "confirmed-no-live-child"]);

function invalid(code, message) {
  throw new WorkflowDiagnosticError(code, message);
}

export async function recoverTransactionWorkflow({
  transactionPath,
  resolution = null,
  verificationPolicyOverride = null,
  retainReviewArtifacts = false,
  retainProcessLogs = false,
  checkProcessInspector = undefined,
  checkIndexLockInspector = undefined,
  now = () => new Date().toISOString(),
}) {
  if (!RESOLUTIONS.has(resolution)) {
    invalid(
      "INVALID_RECOVERY_RESOLUTION",
      "Recovery resolution must be confirmed-no-live-child when supplied.",
    );
  }

  recoverCanonicalMessageReplacement(transactionPath);
  const transaction = readTransaction(transactionPath);

  if (
    transaction.mode === "draft" &&
    transaction.snapshot?.promotion !== undefined &&
    transaction.snapshot.promotion !== null
  ) {
    return recoverDraftPromotion({ transactionPath });
  }

  if (transaction.phase === "publication-pending") {
    return recoverPublicationOutcome({ transactionPath, resolution });
  }

  if (transaction.phase === "reported") {
    return readRecordedReport(transactionPath);
  }

  if (transaction.phase === "commit-pending") {
    const recovery = recoverCommitOutcome({ transactionPath, resolution });

    if (recovery.status !== "matching-commit-observed") {
      return recovery;
    }

    try {
      return await completeRecordedCommit({
        transactionPath,
        verificationPolicyOverride,
        retainReviewArtifacts,
        retainProcessLogs,
      });
    } catch {
      let current = transaction;
      try {
        current = readTransaction(transactionPath);
      } catch {
        // The completed observation remains true if later journal I/O fails.
      }

      return createWorkflowResult({
        disposition: "completed-with-failure",
        status: "commit-blocked",
        phase: current.phase,
        transaction: resolve(transactionPath),
        route: current.route,
        commitState: "created",
        publicationState: "not-requested",
        publicationAllowed: false,
        recoveryRequired: true,
        code: "COMMIT_CONTINUATION_FAILED",
        message:
          "The commit exists, but verification or reporting could not finish. Inspect the retained transaction before continuing.",
        recovery: {
          kind: "inspect-state",
          automatic: false,
          requiredInputs: [],
          commands: [
            {
              arguments: [
                "workflow",
                "recover",
                "--transaction",
                resolve(transactionPath),
              ],
            },
          ],
        },
        data: {
          commitOid: recovery.commitOid,
          terminalDisposition: current.terminalDisposition,
        },
      });
    }
  }

  // Commit and publication journals take precedence because they may already
  // represent repository or remote mutation. Active checks are recoverable
  // only while the transaction is still in a precommit phase.
  const checkRecovery = recoverCheckAttempt({
    transactionPath,
    resolution,
    processInspector: checkProcessInspector,
    indexLockInspector: checkIndexLockInspector,
    now,
  });

  if (checkRecovery !== null) {
    return checkRecovery;
  }

  if (
    new Set(["stopped", "abandoned", "superseded", "published"]).has(
      transaction.phase,
    )
  ) {
    return createWorkflowResult({
      disposition: "succeeded",
      status: transaction.status,
      ...transactionDiagnosticState(transaction, transactionPath),
      data: {
        commitOid: transaction.commit?.commitOid ?? null,
        terminalDisposition: transaction.terminalDisposition,
      },
    });
  }

  invalid(
    "RECOVERY_NOT_REQUIRED",
    `Transaction phase ${transaction.phase} has no irreversible journal to recover.`,
    1,
  );
}

function parseArguments(argv, command) {
  const flags = parseCommandArguments(command, argv).values;
  const format = flags.get("format") ?? "json";
  if (!["json", "text"].includes(format))
    invalid("INVALID_FORMAT", "--format must be json or text.");
  const transactionPath = flags.get("transaction");
  if (!transactionPath)
    invalid("TRANSACTION_REQUIRED", "--transaction is required.");
  return {
    transactionPath,
    format,
    retainProcessLogs: command === "workflow recover" && format !== "text",
    resolution: flags.get("resolution") ?? null,
    purge: flags.get("purge") === true,
  };
}
export async function runRecoverTransactionCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    parse: (arguments_) => parseArguments(arguments_, "workflow recover"),
    includeProcessDiagnostics: true,
    execute: recoverTransactionWorkflow,
    failureState: observeTransactionFailure,
    stdout,
  });
}
export async function runCleanupTransactionCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    parse: (arguments_) => parseArguments(arguments_, "workflow cleanup"),
    execute: (options) =>
      options.purge
        ? purgeTransaction(options)
        : compactTerminalTransaction(options),
    failureState: observeTransactionFailure,
    stdout,
  });
}
