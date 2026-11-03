import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand } from "./commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { promoteDraftWorkflow } from "../workflow/promoteDraftWorkflow.js";

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

function parseArguments(argv) {
  const { values } = parseCommandArguments("workflow promote", argv);

  const format = values.get("format") ?? "json";

  if (!new Set(["json", "text"]).has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  if (!values.get("transaction")) {
    fail("TRANSACTION_REQUIRED", "--transaction is required.");
  }

  return { transactionPath: values.get("transaction"), format };
}

export async function runPromoteDraftCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    failureState: observeTransactionFailure,
    parse: parseArguments,
    execute: promoteDraftWorkflow,
    stdout,
  });
}
