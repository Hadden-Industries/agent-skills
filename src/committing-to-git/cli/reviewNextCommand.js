import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand } from "./commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { FORMATS, reviewNextWorkflow } from "../workflow/reviewNextWorkflow.js";

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

export function parseReviewNextArguments(argv) {
  const { values } = parseCommandArguments("workflow review-next", argv);

  if (!values.has("transaction")) {
    fail(
      "MISSING_ARGUMENT",
      "--transaction is required for workflow review-next.",
    );
  }

  const format = values.get("format") ?? "json";

  if (!FORMATS.has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  return {
    transactionPath: values.get("transaction"),
    cursor: values.get("cursor") ?? null,
    format,
  };
}

export async function runReviewNextCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    failureState: observeTransactionFailure,
    parse: parseReviewNextArguments,
    execute: reviewNextWorkflow,
    stdout,
  });
}
