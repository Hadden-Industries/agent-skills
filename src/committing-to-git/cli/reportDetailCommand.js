import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand } from "./commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { reportDetailWorkflow } from "../workflow/reportDetailWorkflow.js";

function fail(code, message, disposition = "invalid-input", cause) {
  throw new WorkflowDiagnosticError(code, message, { disposition, cause });
}

function parseArguments(argv) {
  const flags = parseCommandArguments("workflow report-detail", argv).values;
  const format = flags.get("format") ?? "json";
  if (!["json", "text"].includes(format))
    fail("INVALID_FORMAT", "--format must be json or text.");
  const transactionPath = flags.get("transaction");
  if (!transactionPath)
    fail("TRANSACTION_REQUIRED", "--transaction is required.");
  const section = flags.get("section") ?? "workspace";
  if (!["workspace", "report", "diagnostics"].includes(section))
    fail(
      "INVALID_DETAIL_SECTION",
      "--section must be workspace, report or diagnostics.",
    );
  return {
    transactionPath,
    section,
    cursor: flags.get("cursor") ?? null,
    refresh: flags.get("refresh") === true,
    format,
  };
}
export async function runReportDetailCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    parse: parseArguments,
    execute: reportDetailWorkflow,
    failureState: observeTransactionFailure,
    stdout,
  });
}
