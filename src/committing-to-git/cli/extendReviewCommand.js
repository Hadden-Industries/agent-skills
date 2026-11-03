import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand } from "./commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { extendReviewWorkflow } from "../workflow/extendReviewWorkflow.js";

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

export function parseExtendReviewArguments(argv) {
  const { values } = parseCommandArguments("workflow extend", argv);

  if (!values.has("transaction") || !values.has("reason")) {
    fail(
      "MISSING_ARGUMENT",
      "--transaction and --reason are required for workflow extend.",
    );
  }

  const format = values.get("format") ?? "json";

  if (!new Set(["json", "text"]).has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  return {
    transactionPath: values.get("transaction"),
    reason: values.get("reason"),
    format,
  };
}

export async function runExtendReviewCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    failureState: observeTransactionFailure,
    parse: parseExtendReviewArguments,
    execute: extendReviewWorkflow,
    stdout,
  });
}
