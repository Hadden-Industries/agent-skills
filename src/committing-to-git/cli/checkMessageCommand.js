import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand } from "./commandExecution.js";
import { readMessageInput } from "./standardInput.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { MAXIMUM_CANONICAL_MESSAGE_BYTES } from "../message/approvedMessage.js";
import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import {
  FORMATS,
  checkMessageWorkflow,
} from "../workflow/checkMessageWorkflow.js";
import { checkProposalMessageWorkflow } from "../workflow/checkProposalMessageWorkflow.js";

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

export function parseMessageWorkflowArguments(argv, command) {
  const { values } = parseCommandArguments(`message ${command}`, argv);
  const format = values.get("format") ?? "json";

  if (!FORMATS.has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  if (values.has("proposal")) {
    if (values.has("transaction")) {
      fail(
        "CONFLICTING_ARGUMENT",
        "--proposal and --transaction are alternatives.",
      );
    }

    return { proposal: values.get("proposal"), format };
  }

  if (!values.has("transaction")) {
    fail(
      "MISSING_ARGUMENT",
      `--transaction is required for message ${command}.`,
    );
  }

  return { transactionPath: values.get("transaction"), format };
}

export async function runCheckMessageCommand(
  argv,
  { cwd = process.cwd(), stdin = process.stdin, stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    failureState: (options) =>
      options?.proposal === undefined
        ? observeTransactionFailure(options)
        : { commitState: "absent", publicationState: "not-requested" },
    parse: (arguments_) => parseMessageWorkflowArguments(arguments_, "check"),
    execute: async (options) =>
      options.proposal === undefined
        ? checkMessageWorkflow(options)
        : checkProposalMessageWorkflow({
            proposal: options.proposal,
            messageBytes: await readMessageInput(
              stdin,
              MAXIMUM_CANONICAL_MESSAGE_BYTES,
            ),
            cwd,
          }),
    stdout,
  });
}
