import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand } from "./commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { resumePreparationWorkflow } from "../workflow/resumePreparationWorkflow.js";

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

export function parseResumeArguments(argv) {
  const { values } = parseCommandArguments("workflow resume", argv);

  if (!values.has("transaction")) {
    fail("MISSING_TRANSACTION", "--transaction is required.");
  }

  const format = values.get("format") ?? "json";

  if (!new Set(["json", "text"]).has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  return { transactionPath: values.get("transaction"), format };
}

export async function runResumePreparationCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    failureState: observeTransactionFailure,
    parse: parseResumeArguments,
    execute: resumePreparationWorkflow,
    stdout,
  });
}
