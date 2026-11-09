import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand, diagnosticWriterFor } from "./commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { publishWorkflow } from "../workflow/publishWorkflow.js";
import {
  observeMemoryPublication,
  prepareMemoryPublication,
  publishMemoryProposal,
} from "../workflow/memoryPublicationWorkflow.js";

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}
function parseArguments(argv) {
  const flags = parseCommandArguments("workflow publish", argv).values;
  const format = flags.get("format") ?? "json";
  if (!["json", "text"].includes(format))
    fail("INVALID_FORMAT", "--format must be json or text.");
  const modes = [
    "transaction",
    "commit-oid",
    "publication-proposal",
    "observe-publication",
  ].filter((name) => flags.has(name));
  if (modes.length !== 1)
    fail(
      "INVALID_ARGUMENT",
      "Supply exactly one of --transaction, --commit-oid, --publication-proposal or --observe-publication.",
    );
  const mode = modes[0];
  const tokenMode = ["publication-proposal", "observe-publication"].includes(
    mode,
  );
  if (
    (mode !== "transaction" && flags.has("retry-after-attempt")) ||
    (mode !== "commit-oid" && flags.has("verification")) ||
    (tokenMode && (flags.has("remote") || flags.has("destination")))
  ) {
    fail(
      "INVALID_ARGUMENT",
      "Memory tokens already bind their endpoint and signature policy; disk retry tokens cannot be used on memory routes.",
    );
  }
  for (const required of tokenMode ? [] : ["remote", "destination"]) {
    if (!flags.get(required))
      fail("INVALID_ARGUMENT", `--${required} is required.`);
  }
  return {
    transactionPath: flags.get("transaction"),
    mode,
    commitOid: flags.get("commit-oid"),
    publicationProposal:
      flags.get("publication-proposal") ?? flags.get("observe-publication"),
    verificationPolicy: flags.get("verification") ?? "required",
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
    execute: (options) => {
      const operation = {
        transaction: publishWorkflow,
        "commit-oid": prepareMemoryPublication,
        "publication-proposal": publishMemoryProposal,
        "observe-publication": observeMemoryPublication,
      }[options.mode];
      return operation({
        ...options,
        diagnosticWriter: diagnosticWriterFor(options.format, stderr),
      });
    },
    failureState: observeTransactionFailure,
    stdout,
  });
}
