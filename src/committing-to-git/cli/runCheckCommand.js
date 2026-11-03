import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand, diagnosticWriterFor } from "./commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import {
  MAXIMUM_CHECK_TIMEOUT_MILLISECONDS,
  runCheckWorkflow,
} from "../workflow/runCheckWorkflow.js";

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

function parseArguments(argv) {
  const { values: flags, childArguments: commandArguments } =
    parseCommandArguments("workflow check", argv);
  if (!flags.has("transaction")) {
    fail(
      "CHECK_TRANSACTION_REQUIRED",
      "workflow check requires --transaction <transaction.json>.",
    );
  }
  if (commandArguments.length === 0 || commandArguments[0] === "") {
    fail(
      "CHECK_COMMAND_REQUIRED",
      "workflow check requires -- followed by an executable and argument vector.",
    );
  }

  const timeoutText = flags.get("timeout-ms") ?? null;
  const timeoutMilliseconds = timeoutText === null ? null : Number(timeoutText);

  if (
    timeoutMilliseconds !== null &&
    (!Number.isSafeInteger(timeoutMilliseconds) ||
      timeoutMilliseconds < 1 ||
      timeoutMilliseconds > MAXIMUM_CHECK_TIMEOUT_MILLISECONDS)
  ) {
    fail(
      "CHECK_TIMEOUT_INVALID",
      "Check timeout must be an integer from 1 through 86,400,000 milliseconds.",
    );
  }

  const format = flags.get("format") ?? "json";

  if (!new Set(["json", "text"]).has(format)) {
    fail("CHECK_FORMAT_INVALID", "Check output format must be json or text.");
  }

  return {
    transactionPath: flags.get("transaction") ?? null,
    label: flags.get("label") ?? "Repository check",
    retryAfterAttempt: flags.get("retry-after-attempt") ?? null,
    workingDirectory: flags.get("working-directory") ?? ".",
    timeoutMilliseconds,
    format,
    command: {
      executable: commandArguments[0],
      arguments: commandArguments.slice(1),
    },
  };
}
export async function runCheckWorkflowCommand(
  argv,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  return executeCommand(argv, {
    failureState: observeTransactionFailure,
    parse: parseArguments,
    execute: (options) =>
      runCheckWorkflow({
        ...options,
        diagnosticWriter: diagnosticWriterFor(options.format, stderr),
      }),
    stdout,
  });
}
