import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand } from "./commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { checkDetailWorkflow } from "../workflow/checkDetailWorkflow.js";

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

function parseArguments(argv) {
  const flags = parseCommandArguments("workflow check-detail", argv).values;
  const format = flags.get("format") ?? "json";
  if (!["json", "text"].includes(format))
    fail(
      "CHECK_DETAIL_FORMAT_INVALID",
      "Check detail output format must be json or text.",
    );
  const transactionPath = flags.get("transaction");
  if (typeof transactionPath !== "string")
    fail(
      "CHECK_DETAIL_TRANSACTION_REQUIRED",
      "workflow check-detail requires --transaction <transaction.json>.",
    );
  return {
    transactionPath,
    format,
    receiptId: flags.get("receipt") ?? null,
    stream: flags.get("stream") ?? null,
    segment: flags.get("segment") ?? null,
    offset: Number(flags.get("offset") ?? "0"),
  };
}
export async function runCheckDetailCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    failureState: observeTransactionFailure,
    parse: parseArguments,
    execute: checkDetailWorkflow,
    stdout,
  });
}
