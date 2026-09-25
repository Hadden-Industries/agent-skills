import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { createWorkflowResult } from "../diagnostics/diagnosticContract.js";
import {
  executeCommand,
  diagnosticWriterFor,
} from "../cli/commandExecution.js";
import { parseCommandArguments } from "../cli/commandArguments.js";

import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import crossSpawn from "cross-spawn";

import { captureCheckProcessOutput } from "../checks/checkOutputCapture.js";
import { selectedWorktreeMatchesPreparedTree } from "../checks/checkWorkspace.js";
import {
  validateCheckCommand,
  validateCheckContext,
} from "../checks/checkReceipt.js";
import { readTransactionOwnedFile } from "../message/canonicalMessageState.js";
import {
  advanceTransaction,
  readTransaction,
  updateTransaction,
} from "../transaction/transactionWorkspace.js";
import {
  assertRecordedChildInactive,
  captureChildIdentity,
} from "../transaction/transactionRecovery.js";

const ACTIVE_CHECK_PHASES = new Set([
  "evidence-ready",
  "review-pending",
  "authoring-pending",
  "message-ready",
]);
const MAXIMUM_CHECK_TIMEOUT_MILLISECONDS = 24 * 60 * 60 * 1000;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readSnapshot(transactionPath, transaction) {
  const input = readTransactionOwnedFile({
    transactionPath,
    artifactName: "snapshot.json",
    maximumBytes: 8 * 1024 * 1024,
    label: "Recorded snapshot",
    allowPathReplacement: false,
  });

  if (
    resolve(input.path) !== resolve(transaction.snapshot.path) ||
    sha256(input.bytes) !== transaction.snapshot.sha256
  ) {
    fail(
      "SNAPSHOT_ARTIFACT_MISMATCH",
      "The fixed snapshot no longer matches its transaction identity.",
    );
  }

  try {
    return JSON.parse(STRICT_UTF8_DECODER.decode(input.bytes));
  } catch (error) {
    fail("SNAPSHOT_ARTIFACT_INVALID", "Snapshot JSON is invalid.", {
      cause: error,
    });
  }
}

function normalizeWorkingDirectory(repositoryRoot, requestedDirectory) {
  const context = {
    kind: "current-worktree",
    repositoryRelativeWorkingDirectory: requestedDirectory,
  };

  try {
    validateCheckContext(context);
  } catch (error) {
    fail(
      "CHECK_CONTEXT_INVALID",
      "The check working directory must be a repository-relative directory.",
      { cause: error },
    );
  }

  const candidate = resolve(repositoryRoot, requestedDirectory);
  const stat = lstatSync(candidate);

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(
      "CHECK_CONTEXT_INVALID",
      "Check working directory must be a real directory within the repository.",
    );
  }

  const actual = realpathSync(candidate);
  const repositoryRelative = relative(repositoryRoot, actual);

  if (
    repositoryRelative === ".." ||
    repositoryRelative.startsWith(
      `..${process.platform === "win32" ? "\\" : "/"}`,
    ) ||
    isAbsolute(repositoryRelative)
  ) {
    fail(
      "CHECK_CONTEXT_INVALID",
      "Check working directory resolves outside the repository.",
    );
  }

  return {
    path: actual,
    context: {
      kind: "current-worktree",
      repositoryRelativeWorkingDirectory:
        repositoryRelative === ""
          ? "."
          : repositoryRelative.replaceAll("\\", "/"),
    },
  };
}

function nextReceiptId(transaction) {
  const ordinal = transaction.checkAttempts.length + 1;

  if (ordinal > 999_999) {
    fail(
      "CHECK_ATTEMPT_LIMIT_REACHED",
      "A transaction cannot record more than 999,999 check attempts.",
    );
  }

  return `C${String(ordinal).padStart(6, "0")}`;
}

function replaceAttempt(transactionPath, receiptId, transform) {
  const transaction = readTransaction(transactionPath);
  const index = transaction.checkAttempts.findIndex(
    (attempt) => attempt.receiptId === receiptId,
  );

  if (index < 0) {
    fail(
      "CHECK_RECEIPT_NOT_FOUND",
      `Check receipt ${receiptId} is not part of this transaction.`,
    );
  }

  const checkAttempts = [...transaction.checkAttempts];

  checkAttempts[index] = transform(checkAttempts[index]);
  return updateTransaction(transactionPath, transaction.phase, {
    ...transaction,
    checkAttempts,
  });
}

function appendAttempt(transactionPath, transaction, attempt) {
  return updateTransaction(transactionPath, transaction.phase, {
    ...transaction,
    checkAttempts: [...transaction.checkAttempts, attempt],
  });
}

function assertRetryContract(transaction, retryAfterAttempt) {
  const latest = transaction.checkAttempts.at(-1) ?? null;

  if (latest !== null && latest.launchState !== "completed") {
    fail(
      "CHECK_RECOVERY_REQUIRED",
      `Check ${latest.receiptId} has no durable outcome; confirm no child remains live before retrying.`,
      {
        disposition: "outcome-unknown",
        details: { receiptId: latest.receiptId },
      },
    );
  }

  if (retryAfterAttempt === null) {
    if (
      latest?.completion?.outcome === "unknown" &&
      latest.resolution !== null
    ) {
      fail(
        "CHECK_RETRY_LINK_REQUIRED",
        `A retry must name the resolved unknown receipt ${latest.receiptId}.`,
      );
    }

    return;
  }

  if (
    latest === null ||
    latest.receiptId !== retryAfterAttempt ||
    latest.completion?.outcome !== "unknown" ||
    latest.resolution === null
  ) {
    fail(
      "CHECK_RETRY_INVALID",
      "A retry may name only the latest explicitly resolved unknown check.",
    );
  }
}

function checkRecoveryResult({
  transactionPath,
  transaction,
  status,
  code,
  recoveryRequired,
  disposition,
}) {
  const attempt = transaction.checkAttempts.at(-1);

  return createWorkflowResult({
    disposition,
    status,
    phase: transaction.phase,
    transaction: resolve(transactionPath),
    route: transaction.route,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired,
    code,
    recovery: {
      kind: recoveryRequired ? "inspect-state" : "human-decision",
      automatic: false,
      requiredInputs: [
        recoveryRequired
          ? "confirmation that the recorded child is inactive"
          : "explicit authorization to retry the recorded check",
      ],
      commands: [],
    },
    data: {
      terminalDisposition: transaction.terminalDisposition,
      receiptId: attempt.receiptId,
      retryRequired: !recoveryRequired,
    },
  });
}

export function recoverCheckAttempt({
  transactionPath,
  resolution = null,
  processInspector = undefined,
  indexLockInspector = undefined,
  now = () => new Date().toISOString(),
}) {
  let transaction = readTransaction(transactionPath);
  const attempt = transaction.checkAttempts.at(-1) ?? null;

  if (
    attempt === null ||
    !new Set(["launching", "running"]).has(attempt.launchState)
  ) {
    return null;
  }

  if (resolution === null) {
    return checkRecoveryResult({
      transactionPath,
      transaction,
      status: "check-outcome-unknown",
      code: "CHECK_OUTCOME_UNKNOWN",
      recoveryRequired: true,
      disposition: "outcome-unknown",
    });
  }

  if (resolution !== "confirmed-no-live-child") {
    fail(
      "CHECK_RECOVERY_RESOLUTION_INVALID",
      "An interrupted check accepts only confirmed-no-live-child resolution.",
    );
  }

  try {
    // Recovery never sends a signal. It only checks the recorded identity and
    // repository lock before accepting the user's explicit no-live-child fact.
    assertRecordedChildInactive({
      repositoryRoot: transaction.repositoryRoot,
      childIdentity: attempt.childIdentity,
      processInspector,
      indexLockInspector,
    });
  } catch (error) {
    fail(
      "CHECK_CHILD_STILL_LIVE",
      "The interrupted check cannot be resolved until the child is confirmed stopped.",
      {
        cause: error,
        disposition: "outcome-unknown",
        details: { receiptId: attempt.receiptId, recoveryRequired: true },
      },
    );
  }

  const finishedAt = now();

  if (
    typeof finishedAt !== "string" ||
    !Number.isFinite(Date.parse(finishedAt))
  ) {
    fail(
      "CHECK_CLOCK_INVALID",
      "Check recovery clock returned an invalid time.",
    );
  }

  transaction = replaceAttempt(
    transactionPath,
    attempt.receiptId,
    (current) => ({
      ...current,
      launchState: "completed",
      completion: {
        finishedAt,
        durationMilliseconds: Math.max(
          0,
          Date.parse(finishedAt) - Date.parse(current.startedAt),
        ),
        outcome: "unknown",
        exitCode: null,
        signal: null,
        launchError: null,
      },
      resolution: {
        kind: "confirmed-no-live-child",
        resolvedAt: finishedAt,
      },
    }),
  );

  return checkRecoveryResult({
    transactionPath,
    transaction,
    status: "check-recovery-resolved",
    code: "CHECK_RETRY_REQUIRED",
    recoveryRequired: false,
    disposition: "rejected",
  });
}

function completionOutcomeFacts(capture) {
  return {
    exitCode: new Set(["signaled", "timed-out", "launch-error"]).has(
      capture.outcome,
    )
      ? null
      : capture.exitCode,
    signal: capture.outcome === "launch-error" ? null : capture.signal,
    launchError: capture.launchError,
  };
}

function receiptSummary(attempt) {
  return {
    receiptId: attempt.receiptId,
    label: attempt.label,
    command: attempt.command,
    context: attempt.context.kind,
    outcome: attempt.completion.outcome,
    exitCode: attempt.completion.exitCode,
    signal: attempt.completion.signal,
    durationMilliseconds: attempt.completion.durationMilliseconds,
    selectedScopeStable:
      attempt.workspace.before.matches &&
      attempt.workspace.after?.matches === true,
  };
}

function resultFor({
  transactionPath,
  transaction,
  attempt,
  code,
  disposition,
}) {
  const receipt = receiptSummary(attempt);
  return createWorkflowResult({
    disposition,
    status:
      code === null
        ? "check-passed"
        : code === "CHECK_SCOPE_DRIFT"
          ? "stopped"
          : "check-failed",
    phase: transaction.phase,
    transaction: resolve(transactionPath),
    route: transaction.route,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    code,
    data: {
      terminalDisposition: transaction.terminalDisposition,
      receipt,
    },
  });
}

export async function runCheckWorkflow({
  transactionPath,
  label,
  command,
  retryAfterAttempt = null,
  workingDirectory = ".",
  timeoutMilliseconds = null,
  environment = process.env,
  processLauncher = crossSpawn,
  diagnosticWriter = process.stderr,
  now = () => new Date(),
}) {
  try {
    validateCheckCommand(command);
  } catch (error) {
    fail(
      "CHECK_COMMAND_INVALID",
      "Supply one executable and an array of literal arguments, without a shell command string.",
      { cause: error },
    );
  }

  let transaction = readTransaction(transactionPath);

  if (!ACTIVE_CHECK_PHASES.has(transaction.phase)) {
    fail(
      "CHECK_PHASE_INVALID",
      `Transaction phase ${transaction.phase} cannot run a precommit check.`,
    );
  }

  assertRetryContract(transaction, retryAfterAttempt);
  const context = normalizeWorkingDirectory(
    transaction.repositoryRoot,
    workingDirectory,
  );
  const manifest = readSnapshot(transactionPath, transaction);
  const before = await selectedWorktreeMatchesPreparedTree({
    root: transaction.repositoryRoot,
    manifest,
    temporaryDirectory: transaction.attemptDirectory,
  });

  if (!before.matches) {
    const stopped = advanceTransaction(transactionPath, transaction.phase, {
      ...transaction,
      phase: "stopped",
      status: "stopped",
      terminalDisposition: "no-commit-stopped",
    });

    return createWorkflowResult({
      status: "stopped",
      phase: stopped.phase,
      transaction: resolve(transactionPath),
      route: stopped.route,
      commitState: "absent",
      publicationState: "not-requested",
      publicationAllowed: false,
      recoveryRequired: false,
      code: "CHECK_SCOPE_DRIFT",
      disposition: "rejected",
      message: "The selected worktree no longer matches the prepared tree.",
      data: { receipt: null, terminalDisposition: stopped.terminalDisposition },
    });
  }

  const receiptId = nextReceiptId(transaction);
  const started = now();

  if (!(started instanceof Date) || !Number.isFinite(started.getTime())) {
    fail(
      "CHECK_CLOCK_INVALID",
      "Check workflow clock returned an invalid time.",
    );
  }

  const attempt = {
    schemaVersion: 1,
    receiptId,
    retryOf: retryAfterAttempt,
    label,
    command,
    context: context.context,
    subject: {
      manifestSha256: transaction.snapshot.sha256,
      headAnchor: transaction.headAnchor,
      preparedTreeOid: transaction.snapshot.indexTreeOid,
    },
    launchState: "launching",
    childIdentity: null,
    startedAt: started.toISOString(),
    completion: null,
    workspace: { before, after: null },
    output: null,
    resolution: null,
  };

  transaction = appendAttempt(transactionPath, transaction, attempt);
  let child;

  try {
    child = processLauncher(command.executable, command.arguments, {
      cwd: context.path,
      env: environment,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const after = await selectedWorktreeMatchesPreparedTree({
      root: transaction.repositoryRoot,
      manifest,
      temporaryDirectory: transaction.attemptDirectory,
    });
    const finished = now();

    transaction = replaceAttempt(transactionPath, receiptId, (current) => ({
      ...current,
      launchState: "completed",
      completion: {
        finishedAt: finished.toISOString(),
        durationMilliseconds: Math.max(
          0,
          finished.getTime() - started.getTime(),
        ),
        outcome: "launch-error",
        exitCode: null,
        signal: null,
        launchError: {
          code: typeof error.code === "string" ? error.code : null,
          message: error.message,
        },
      },
      workspace: { ...current.workspace, after },
    }));
    diagnosticWriter.write(
      "CHECK_LAUNCH_FAILED: The check executable could not be launched; inspect the recorded receipt.\n",
    );
    return resultFor({
      transactionPath,
      transaction,
      attempt: transaction.checkAttempts.at(-1),
      code: "CHECK_LAUNCH_FAILED",
      disposition: "rejected",
    });
  }

  // Install stream listeners before durable PID recording. A short-lived
  // child may exit immediately, but attaching first prevents its output and
  // close event from being lost while transaction.json is flushed.
  const capturePromise = captureCheckProcessOutput({
    attemptDirectory: transaction.attemptDirectory,
    receiptId,
    child,
    timeoutMilliseconds,
  });
  const childIdentity = captureChildIdentity(child.pid);

  if (childIdentity !== null) {
    transaction = replaceAttempt(transactionPath, receiptId, (current) => ({
      ...current,
      launchState: "running",
      childIdentity,
    }));
  }

  let capture;

  try {
    capture = await capturePromise;
    const after = await selectedWorktreeMatchesPreparedTree({
      root: transaction.repositoryRoot,
      manifest,
      temporaryDirectory: transaction.attemptDirectory,
    });
    const finished = now();
    const processFacts = completionOutcomeFacts(capture);

    transaction = replaceAttempt(transactionPath, receiptId, (current) => ({
      ...current,
      launchState: "completed",
      completion: {
        finishedAt: finished.toISOString(),
        durationMilliseconds: Math.max(
          0,
          finished.getTime() - started.getTime(),
        ),
        outcome: capture.outcome,
        ...processFacts,
      },
      workspace: { ...current.workspace, after },
      output: capture.output,
    }));
  } catch (error) {
    fail(
      "CHECK_OUTCOME_UNKNOWN",
      "The check child may have run, but its terminal receipt could not be recorded. Inspect its journal before considering another execution.",
      {
        disposition: "outcome-unknown",
        cause: error,
        state: {
          transaction: resolve(transactionPath),
          phase: transaction.phase,
          route: transaction.route,
          commitState: "absent",
          publicationState: "not-requested",
          recoveryRequired: true,
        },
        recovery: {
          kind: "inspect-state",
          automatic: false,
          requiredInputs: [],
          commands: [
            {
              arguments: [
                "workflow",
                "recover",
                "--transaction",
                resolve(transactionPath),
              ],
            },
          ],
        },
        details: { receiptId, recoveryRequired: true },
      },
    );
  }

  const completed = transaction.checkAttempts.at(-1);

  if (completed.workspace.after.matches !== true) {
    transaction = advanceTransaction(transactionPath, transaction.phase, {
      ...transaction,
      phase: "stopped",
      status: "stopped",
      terminalDisposition: "no-commit-stopped",
    });

    if (capture.diagnostic.length > 0) {
      diagnosticWriter.write(capture.diagnostic);
    }

    return resultFor({
      transactionPath,
      transaction,
      attempt: completed,
      code: "CHECK_SCOPE_DRIFT",
      disposition: "rejected",
    });
  }

  if (completed.completion.outcome !== "passed") {
    if (capture.diagnostic.length > 0) {
      diagnosticWriter.write(capture.diagnostic);
    }

    const codeByOutcome = {
      failed: "CHECK_FAILED",
      "launch-error": "CHECK_LAUNCH_FAILED",
      signaled: "CHECK_SIGNALED",
      "timed-out": "CHECK_TIMED_OUT",
    };

    return resultFor({
      transactionPath,
      transaction,
      attempt: completed,
      code: codeByOutcome[completed.completion.outcome],
      disposition: "rejected",
    });
  }

  return resultFor({
    transactionPath,
    transaction,
    attempt: completed,
    code: null,
    disposition: "succeeded",
  });
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
