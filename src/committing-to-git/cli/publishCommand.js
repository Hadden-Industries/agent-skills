import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand, diagnosticWriterFor } from "./commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { publishWorkflow } from "../workflow/publishWorkflow.js";

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

function parseArguments(argv) {
  const flags = parseCommandArguments("workflow publish", argv).values;
  const format = flags.get("format") ?? "json";
  if (!["json", "text"].includes(format))
    fail("INVALID_FORMAT", "--format must be json or text.");
  for (const required of ["transaction", "remote", "destination"]) {
    if (!flags.get(required))
      fail("INVALID_ARGUMENT", `--${required} is required.`);
  }
  return {
    transactionPath: flags.get("transaction"),
    remote: flags.get("remote"),
    destination: flags.get("destination"),
    retryAfterAttempt: flags.get("retry-after-attempt") ?? null,
    format,
  };
}
export async function runPublishCommand(
  argv,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  return executeCommand(argv, {
    parse: parseArguments,
    includeProcessDiagnostics: true,
    execute: (options) =>
      publishWorkflow({
        ...options,
        diagnosticWriter: diagnosticWriterFor(options.format, stderr),
      }),
    failureState: observeTransactionFailure,
    stdout,
  });
}
