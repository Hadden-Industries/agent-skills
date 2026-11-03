import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand, diagnosticWriterFor } from "./commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { readMessageInput } from "./standardInput.js";
import { MAXIMUM_CANONICAL_MESSAGE_BYTES } from "../message/approvedMessage.js";
import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { commitProposalWorkflow } from "../workflow/commitProposalWorkflow.js";
import {
  createCommitWorkflow,
  retrySignatureVerificationWorkflow,
} from "../workflow/createCommitWorkflow.js";

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

const TRANSACTION_ONLY_FLAGS = [
  "execution",
  "acknowledge-failed-check",
  "retain-review-artifacts",
  "retain-process-logs",
];

function parseProposalArguments(flags, format) {
  if (flags.has("transaction")) {
    fail(
      "CONFLICTING_ARGUMENT",
      "--proposal and --transaction are alternatives.",
    );
  }

  const unsupported = TRANSACTION_ONLY_FLAGS.find((name) => flags.has(name));

  if (unsupported) {
    fail(
      "TRANSACTION_ARGUMENT_WITH_PROPOSAL",
      `--${unsupported} applies only to a disk-storage transaction.`,
    );
  }

  const messageSha256 = flags.get("message-sha256") ?? null;

  if (flags.has("message") === flags.has("message-stdin")) {
    fail(
      "MESSAGE_INPUT_REQUIRED",
      "A proposal commit takes exactly one of --message or --message-stdin.",
    );
  }

  if (messageSha256 !== null && !/^[0-9a-f]{64}$/u.test(messageSha256)) {
    fail(
      "INVALID_MESSAGE_SHA256",
      "--message-sha256 must be 64 lowercase hex.",
    );
  }

  return {
    proposal: flags.get("proposal"),
    format,
    approvedSubject: flags.get("message") ?? null,
    messageFromStandardInput: flags.get("message-stdin") === true,
    expectedMessageSha256: messageSha256,
    verificationPolicyOverride: flags.get("verification") ?? null,
  };
}

function parseArguments(argv, command) {
  const flags = parseCommandArguments(command, argv).values;
  const format = flags.get("format") ?? "json";
  if (!["json", "text"].includes(format))
    fail("INVALID_FORMAT", "--format must be json or text.");
  if (flags.has("proposal")) return parseProposalArguments(flags, format);
  if (flags.has("message-stdin") || flags.has("message-sha256"))
    fail(
      "PROPOSAL_ARGUMENT_WITH_TRANSACTION",
      "--message-stdin and --message-sha256 apply only to --proposal.",
    );
  const transactionPath = flags.get("transaction");
  if (!transactionPath)
    fail("TRANSACTION_REQUIRED", "--transaction is required.");
  return {
    transactionPath,
    format,
    execution: flags.get("execution") ?? "auto",
    approvedSubject: flags.get("message") ?? null,
    acknowledgedFailedCheckIds: flags.get("acknowledge-failed-check") ?? [],
    retainReviewArtifacts: flags.get("retain-review-artifacts") === true,
    retainProcessLogs: flags.get("retain-process-logs") === true,
    verificationPolicyOverride: flags.get("verification") ?? null,
  };
}
async function commitProposal(options, { cwd, stdin }) {
  const { messageFromStandardInput, ...proposalOptions } = options;

  return commitProposalWorkflow({
    ...proposalOptions,
    messageBytes: messageFromStandardInput
      ? await readMessageInput(stdin, MAXIMUM_CANONICAL_MESSAGE_BYTES)
      : null,
    cwd,
  });
}

export async function runCreateCommitCommand(
  argv,
  {
    cwd = process.cwd(),
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  return executeCommand(argv, {
    parse: (arguments_) => parseArguments(arguments_, "workflow commit"),
    includeProcessDiagnostics: true,
    execute: (options) =>
      options.proposal !== undefined
        ? commitProposal(options, { cwd, stdin })
        : createCommitWorkflow({
            ...options,
            retainProcessLogs:
              options.format !== "text" || options.retainProcessLogs,
            diagnosticWriter: diagnosticWriterFor(options.format, stderr),
          }),
    failureState: (options) =>
      options?.proposal === undefined
        ? observeTransactionFailure(options)
        : { commitState: "absent", publicationState: "not-requested" },
    stdout,
  });
}
export async function runRetryVerificationCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    parse: (arguments_) => parseArguments(arguments_, "workflow verify"),
    includeProcessDiagnostics: true,
    execute: retrySignatureVerificationWorkflow,
    failureState: observeTransactionFailure,
    stdout,
  });
}
