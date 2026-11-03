import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand } from "./commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import {
  compactTerminalTransaction,
  purgeTransaction,
} from "../transaction/transactionRecovery.js";
import { recoverTransactionWorkflow } from "../workflow/recoverTransactionWorkflow.js";

function invalid(code, message) {
  throw new WorkflowDiagnosticError(code, message);
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
