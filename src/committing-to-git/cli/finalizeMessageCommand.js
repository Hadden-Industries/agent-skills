import { executeCommand } from "./commandExecution.js";
import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { parseMessageWorkflowArguments } from "./checkMessageCommand.js";
import { finalizeMessageWorkflow } from "../workflow/finalizeMessageWorkflow.js";

export async function runFinalizeMessageCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    failureState: observeTransactionFailure,
    parse: (arguments_) =>
      parseMessageWorkflowArguments(arguments_, "finalize"),
    execute: finalizeMessageWorkflow,
    stdout,
  });
}
