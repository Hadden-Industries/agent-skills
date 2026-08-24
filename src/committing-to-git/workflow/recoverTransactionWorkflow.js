import { resolve } from "node:path";

import { recoverCanonicalMessageReplacement } from "../message/canonicalMessageState.js";
import {
  compactTerminalTransaction,
  purgeTransaction,
  recoverCommitOutcome,
} from "../transaction/transactionRecovery.js";
import { readTransaction } from "../transaction/transactionWorkspace.js";
import {
  CommitWorkflowError,
  completeRecordedCommit,
  readRecordedReport,
} from "./createCommitWorkflow.js";
import { recoverDraftPromotion } from "./promoteDraftWorkflow.js";
import { recoverPublicationOutcome } from "./publishWorkflow.js";

const RESOLUTIONS = new Set([null, "confirmed-no-live-child"]);

function invalid(code, message, exitCode = 2) {
  throw new CommitWorkflowError(code, message, { exitCode });
}

export async function recoverTransactionWorkflow({
  transactionPath,
  resolution = null,
  verificationPolicyOverride = null,
  retainReviewArtifacts = false,
  retainProcessLogs = false,
}) {
  if (!RESOLUTIONS.has(resolution)) {
    invalid(
      "INVALID_RECOVERY_RESOLUTION",
      "Recovery resolution must be confirmed-no-live-child when supplied.",
    );
  }

  recoverCanonicalMessageReplacement(transactionPath);
  const transaction = readTransaction(transactionPath);

  if (
    transaction.mode === "draft" &&
    transaction.snapshot?.promotion !== undefined &&
    transaction.snapshot.promotion !== null
  ) {
    return recoverDraftPromotion({ transactionPath });
  }

  if (transaction.phase === "publication-pending") {
    return recoverPublicationOutcome({ transactionPath, resolution });
  }

  if (transaction.phase === "reported") {
    return readRecordedReport(transactionPath);
  }

  if (transaction.phase === "commit-pending") {
    const recovery = recoverCommitOutcome({ transactionPath, resolution });

    if (recovery.status !== "matching-commit-observed") {
      return recovery;
    }

    try {
      return await completeRecordedCommit({
        transactionPath,
        verificationPolicyOverride,
        retainReviewArtifacts,
        retainProcessLogs,
      });
    } catch (error) {
      const current = readTransaction(transactionPath);

      return {
        schemaVersion: 1,
        status: "commit-blocked",
        phase: current.phase,
        terminalDisposition: current.terminalDisposition,
        transaction: resolve(transactionPath),
        route: current.route,
        commitState: "created",
        commitOid: current.commit.commitOid,
        publicationState: "not-requested",
        publicationAllowed: false,
        recoveryRequired: true,
        code: error.code ?? "COMMIT_CONTINUATION_FAILED",
        message: error.message,
        exitCode: 3,
      };
    }
  }

  if (
    new Set(["stopped", "abandoned", "superseded", "published"]).has(
      transaction.phase,
    )
  ) {
    const publicationState =
      transaction.phase === "published"
        ? transaction.publicationAttempts.at(-1)?.status === "succeeded"
          ? "succeeded"
          : "observed-matching"
        : "not-requested";

    return {
      schemaVersion: 1,
      status: transaction.status,
      phase: transaction.phase,
      terminalDisposition: transaction.terminalDisposition,
      transaction: resolve(transactionPath),
      route: transaction.route,
      commitState: transaction.commit?.commitOid ? "created" : "absent",
      commitOid: transaction.commit?.commitOid ?? null,
      publicationState,
      publicationAllowed: transaction.report?.publicationAllowed ?? false,
      recoveryRequired: false,
      exitCode: transaction.phase === "stopped" ? 1 : 0,
    };
  }

  invalid(
    "RECOVERY_NOT_REQUIRED",
    `Transaction phase ${transaction.phase} has no irreversible journal to recover.`,
    1,
  );
}

function parseFlags(argv, booleanFlags = new Set()) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token?.startsWith("--")) {
      invalid(
        "INVALID_ARGUMENT",
        `Unexpected argument ${JSON.stringify(token)}.`,
      );
    }

    const name = token.slice(2);

    if (values.has(name)) {
      invalid("DUPLICATE_ARGUMENT", `--${name} may be supplied only once.`);
    }

    if (booleanFlags.has(name)) {
      values.set(name, true);
      continue;
    }

    const value = argv[index + 1];

    if (value === undefined || value.startsWith("--")) {
      invalid("INVALID_ARGUMENT", `--${name} requires a value.`);
    }

    values.set(name, value);
    index += 1;
  }

  return values;
}

function output(result, format) {
  return format === "text"
    ? (result.displayText ??
        `Status: ${result.status}\nCode: ${result.code ?? "none"}\n`)
    : `${JSON.stringify(result)}\n`;
}

export async function runRecoverTransactionCommand(
  argv,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  let format = "json";

  try {
    const flags = parseFlags(argv);
    const allowed = new Set(["transaction", "resolution", "format"]);

    for (const name of flags.keys()) {
      if (!allowed.has(name)) {
        invalid("UNKNOWN_ARGUMENT", `Unknown workflow recover flag --${name}.`);
      }
    }

    format = flags.get("format") ?? "json";
    const transactionPath = flags.get("transaction");

    if (!transactionPath) {
      invalid("TRANSACTION_REQUIRED", "--transaction is required.");
    }

    const result = await recoverTransactionWorkflow({
      transactionPath,
      resolution: flags.get("resolution") ?? null,
    });

    stdout.write(output(result, format));
    return result.exitCode;
  } catch (caught) {
    const error =
      caught instanceof CommitWorkflowError
        ? caught
        : new CommitWorkflowError("RECOVERY_WORKFLOW_FAILED", caught.message);
    const result = {
      status: error.exitCode === 4 ? "outcome-unknown" : "invalid",
      code: error.code,
      message: error.message,
      exitCode: error.exitCode,
    };

    stderr.write(`${error.code}: ${error.message}\n`);
    stdout.write(output(result, format));
    return error.exitCode;
  }
}

export function runCleanupTransactionCommand(
  argv,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  let format = "json";

  try {
    const flags = parseFlags(argv, new Set(["purge"]));
    const allowed = new Set(["transaction", "purge", "format"]);

    for (const name of flags.keys()) {
      if (!allowed.has(name)) {
        invalid("UNKNOWN_ARGUMENT", `Unknown workflow cleanup flag --${name}.`);
      }
    }

    format = flags.get("format") ?? "json";
    const transactionPath = flags.get("transaction");

    if (!transactionPath) {
      invalid("TRANSACTION_REQUIRED", "--transaction is required.");
    }

    const result = flags.get("purge")
      ? purgeTransaction({ transactionPath })
      : compactTerminalTransaction({ transactionPath });

    stdout.write(output({ ...result, exitCode: 0 }, format));
    return 0;
  } catch (caught) {
    const error =
      caught instanceof CommitWorkflowError
        ? caught
        : new CommitWorkflowError("CLEANUP_WORKFLOW_FAILED", caught.message);

    stderr.write(`${error.code}: ${error.message}\n`);
    stdout.write(
      output(
        {
          status: "invalid",
          code: error.code,
          message: error.message,
          exitCode: 2,
        },
        format,
      ),
    );
    return 2;
  }
}
