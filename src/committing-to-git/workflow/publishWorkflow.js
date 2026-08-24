import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { captureGitProcessTranscript } from "../git/gitProcessTranscript.js";
import { runReadOnlyGit, streamGit } from "../git/gitRepository.js";
import {
  MAXIMUM_REPORT_RESULT_BYTES,
  augmentReportWithPublication,
  compactWorkspaceSummary,
  renderCommitReport,
} from "../report/commitReport.js";
import {
  acquireTransactionStateLock,
  assertRecordedChildInactive,
  captureChildIdentity,
  releaseTransactionStateLock,
} from "../transaction/transactionRecovery.js";
import {
  advanceTransaction,
  readTransaction,
  updateTransaction,
} from "../transaction/transactionWorkspace.js";

const FULL_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REMOTE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const MAXIMUM_REMOTE_OBSERVATION_BYTES = 64 * 1024;
const MAXIMUM_PUSH_CLASSIFICATION_BYTES = 64 * 1024;

export class PublishWorkflowError extends Error {
  constructor(code, message, { exitCode = 2, details = {} } = {}) {
    super(message);
    this.name = "PublishWorkflowError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function fail(code, message, options) {
  throw new PublishWorkflowError(code, message, options);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);

    return code <= 0x1f || code === 0x7f;
  });
}

function atomicWrite(path, bytes) {
  const candidate = join(dirname(path), `.publication-${randomUUID()}.tmp`);
  const descriptor = openSync(
    candidate,
    fsConstants.O_WRONLY + fsConstants.O_CREAT + fsConstants.O_EXCL,
    0o600,
  );

  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }

  try {
    const current = lstatSync(path);

    if (current.isSymbolicLink() || !current.isFile()) {
      fail("REPORT_PATH_REPLACED", "Persisted report path was replaced.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  renameSync(candidate, path);
}

function transcriptFacts(transcript) {
  return {
    path: transcript.path,
    status: transcript.status,
    signal: transcript.signal,
    totalByteCount: transcript.totalByteCount,
    stdoutByteCount: transcript.stdoutByteCount,
    stderrByteCount: transcript.stderrByteCount,
    stdoutSha256: transcript.stdoutSha256,
    stderrSha256: transcript.stderrSha256,
    sha256: transcript.sha256,
    completionSha256: transcript.completionSha256,
    retainRecommended: transcript.retainRecommended,
  };
}

function classifyPushCompletion(transcript, destination) {
  if (
    transcript.status === 0 &&
    transcript.signal === null &&
    transcript.launchError === null
  ) {
    return "witnessed-success";
  }

  if (
    transcript.signal !== null ||
    transcript.launchError !== null ||
    !transcript.capturedStdoutComplete
  ) {
    return "unknown";
  }

  const records = transcript.capturedStdout
    .toString("utf8")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("!\t"));
  const knownRejection =
    records.length === 1 &&
    records[0].split("\t")[1]?.endsWith(`:${destination}`) &&
    /\[(?:rejected|remote rejected)\]/u.test(records[0]);

  return knownRejection ? "known-rejection" : "unknown";
}

function latestAttempt(transaction) {
  return transaction.publicationAttempts.at(-1) ?? null;
}

function updateAttempt(transactionPath, attemptId, transform) {
  const transaction = readTransaction(transactionPath);
  const index = transaction.publicationAttempts.findIndex(
    (attempt) => attempt.attemptId === attemptId,
  );

  if (index < 0 || index !== transaction.publicationAttempts.length - 1) {
    fail(
      "PUBLICATION_ATTEMPT_STALE",
      "Only the latest publication attempt may acquire new journal facts.",
      { exitCode: 4 },
    );
  }

  const attempts = transaction.publicationAttempts.map((attempt, offset) =>
    offset === index ? transform(attempt) : attempt,
  );

  return updateTransaction(transactionPath, transaction.phase, {
    ...transaction,
    publicationAttempts: attempts,
  });
}

function validateDestination(
  root,
  remote,
  destination,
  readOnlyRunner = runReadOnlyGit,
) {
  if (
    typeof remote !== "string" ||
    !REMOTE_NAME_PATTERN.test(remote) ||
    containsControlCharacter(remote)
  ) {
    fail(
      "PUBLICATION_REMOTE_INVALID",
      "--remote must name one configured non-option Git remote.",
    );
  }

  if (
    typeof destination !== "string" ||
    !destination.startsWith("refs/heads/") ||
    containsControlCharacter(destination)
  ) {
    fail(
      "PUBLICATION_DESTINATION_INVALID",
      "--destination must be a full refs/heads/... branch ref.",
    );
  }

  const remotes = readOnlyRunner(root, "remote-names")
    .stdout.toString("utf8")
    .split(/\r?\n/u)
    .filter(Boolean);

  if (!remotes.includes(remote)) {
    fail(
      "PUBLICATION_REMOTE_UNKNOWN",
      `Configured Git remote ${JSON.stringify(remote)} does not exist.`,
    );
  }

  const refCheck = readOnlyRunner(root, "check-ref-format", [destination], {
    allowFailure: true,
  });

  if (refCheck.status !== 0) {
    fail(
      "PUBLICATION_DESTINATION_INVALID",
      "--destination is not a valid full branch ref.",
    );
  }
}

function assertPublicationAllowed(transaction) {
  if (
    transaction.commit?.commitOid === null ||
    transaction.commit?.commitOid === undefined ||
    !FULL_OID_PATTERN.test(transaction.commit.commitOid) ||
    transaction.commit.comparison === null ||
    !transaction.commit.comparison.parentMatches ||
    !transaction.commit.comparison.treeMatches ||
    !transaction.commit.comparison.messageMatches ||
    !transaction.commit.comparison.signatureHeaderPresent ||
    transaction.verification?.blocksPush !== false ||
    transaction.report?.publicationAllowed !== true
  ) {
    fail(
      "PUBLICATION_BLOCKED",
      "The recorded commit comparison, signature header, verification policy, or report blocks publication.",
      { exitCode: 3 },
    );
  }
}

function readPersistedReport(transaction) {
  let stat;

  try {
    stat = lstatSync(transaction.report.jsonPath);
  } catch (error) {
    fail(
      "REPORT_ARTIFACT_MISMATCH",
      `The persisted report cannot be inspected: ${error.message}`,
      { exitCode: 3 },
    );
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(
      "REPORT_ARTIFACT_MISMATCH",
      "The persisted report path was replaced or is not regular.",
      { exitCode: 3 },
    );
  }

  const bytes = readFileSync(transaction.report.jsonPath);

  if (sha256(bytes) !== transaction.report.jsonSha256) {
    fail(
      "REPORT_ARTIFACT_MISMATCH",
      "The persisted report no longer matches its transaction digest.",
      { exitCode: 3 },
    );
  }

  return JSON.parse(bytes.toString("utf8"));
}

function currentReportFilesMatch(transaction, reportBytes, textBytes) {
  if (
    transaction.report.jsonSha256 !== sha256(reportBytes) ||
    transaction.report.textSha256 !== sha256(textBytes)
  ) {
    return false;
  }

  try {
    const textStat = lstatSync(transaction.report.textPath);

    return (
      !textStat.isSymbolicLink() &&
      textStat.isFile() &&
      sha256(readFileSync(transaction.report.textPath)) ===
        transaction.report.textSha256
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function publicationArtifact(attempt, status = attempt.status) {
  return {
    schemaVersion: 2,
    status,
    attemptId: attempt.attemptId,
    retryOf: attempt.retryOf,
    commitOid: attempt.commitOid,
    remote: attempt.remote,
    destination: attempt.destination,
    refspec: attempt.refspec,
    exitCode: attempt.completion?.exitCode ?? null,
    transcript: attempt.transcript,
    observation: attempt.observation,
    resolution: attempt.resolution,
    retryPermitted: attempt.retryPermitted,
    reason: attempt.reason,
  };
}

function resultModel(transactionPath, transaction, publication, report, text) {
  const publicationState =
    publication.status === "succeeded"
      ? "succeeded"
      : publication.status === "observed-matching"
        ? "observed-matching"
        : publication.status === "rejected"
          ? "rejected"
          : publication.status === "blocked"
            ? "blocked"
            : "unknown";
  const exitCode =
    publicationState === "succeeded" || publicationState === "observed-matching"
      ? 0
      : publicationState === "rejected"
        ? 1
        : publicationState === "blocked"
          ? 3
          : 4;

  return {
    schemaVersion: 1,
    status:
      exitCode === 0
        ? "published"
        : exitCode === 1
          ? "rejected"
          : exitCode === 3
            ? "commit-blocked"
            : "outcome-unknown",
    phase: transaction.phase,
    terminalDisposition: transaction.terminalDisposition,
    transaction: resolve(transactionPath),
    route: transaction.route,
    commitState: "created",
    commitOid: transaction.commit.commitOid,
    publicationState,
    publicationAllowed: transaction.report.publicationAllowed,
    recoveryRequired: exitCode === 4,
    publication,
    report,
    displayText: text,
    exitCode,
  };
}

function boundedAugmentedModel(transactionPath, transaction, publication) {
  const prior = readPersistedReport(transaction);
  let report = augmentReportWithPublication(prior, publication);
  let displayText = renderCommitReport(report);
  let result = resultModel(
    transactionPath,
    transaction,
    publication,
    report,
    displayText,
  );

  if (Buffer.byteLength(JSON.stringify(result)) > MAXIMUM_REPORT_RESULT_BYTES) {
    report = {
      ...report,
      workspace: compactWorkspaceSummary(report.workspace),
    };
    displayText = renderCommitReport(report);
    result = resultModel(
      transactionPath,
      transaction,
      publication,
      report,
      displayText,
    );
  }

  if (Buffer.byteLength(JSON.stringify(result)) > MAXIMUM_REPORT_RESULT_BYTES) {
    fail(
      "PUBLICATION_RESULT_BUDGET_EXCEEDED",
      "Publication result exceeds the serialized report budget.",
      { exitCode: publication.status === "unknown" ? 4 : 3 },
    );
  }

  return { report, displayText, result };
}

function persistPublicationReport({
  transactionPath,
  publication,
  targetPhase,
  targetStatus,
  terminalDisposition,
}) {
  const transaction = readTransaction(transactionPath);
  const projectedTransaction = {
    ...transaction,
    phase: targetPhase,
    status: targetStatus,
    terminalDisposition,
  };
  const bounded = boundedAugmentedModel(
    transactionPath,
    projectedTransaction,
    publication,
  );
  const reportBytes = canonicalBytes(bounded.report);
  const textBytes = Buffer.from(bounded.displayText, "utf8");
  let jsonPath = transaction.report.jsonPath;
  let textPath = transaction.report.textPath;

  if (!currentReportFilesMatch(transaction, reportBytes, textBytes)) {
    const reportRevision = randomUUID();
    const reportDirectory = dirname(transaction.report.jsonPath);

    jsonPath = join(
      reportDirectory,
      `report-publication-${reportRevision}.json`,
    );
    textPath = join(
      reportDirectory,
      `report-publication-${reportRevision}.txt`,
    );

    // Publish immutable replacements before switching the transaction pointer
    // so an interruption can leave only an unreferenced complete pair, never a
    // transaction whose digest names partially replaced report bytes.
    atomicWrite(jsonPath, reportBytes);
    atomicWrite(textPath, textBytes);
  }
  const next = {
    ...projectedTransaction,
    report: {
      ...transaction.report,
      jsonPath,
      jsonSha256: sha256(reportBytes),
      textPath,
      textSha256: sha256(textBytes),
    },
  };

  if (targetPhase === transaction.phase) {
    updateTransaction(transactionPath, transaction.phase, next);
  } else {
    advanceTransaction(transactionPath, transaction.phase, next);
  }

  return bounded.result;
}

function finalizeAttempt(transactionPath, attemptId, status, reason = null) {
  const updated = updateAttempt(transactionPath, attemptId, (attempt) => ({
    ...attempt,
    status,
    reason,
  }));
  const attempt = latestAttempt(updated);
  const publication = publicationArtifact(attempt);

  if (status === "succeeded") {
    return persistPublicationReport({
      transactionPath,
      publication,
      targetPhase: "published",
      targetStatus: "published",
      terminalDisposition: "published",
    });
  }

  if (status === "observed-matching") {
    return persistPublicationReport({
      transactionPath,
      publication,
      targetPhase: "published",
      targetStatus: "recovered",
      terminalDisposition: "published",
    });
  }

  return persistPublicationReport({
    transactionPath,
    publication,
    targetPhase: "reported",
    targetStatus: "reported",
    terminalDisposition: "local-commit-recorded",
  });
}

function persistUnknownAttempt(transactionPath, attemptId, reason) {
  const updated = updateAttempt(transactionPath, attemptId, (attempt) => ({
    ...attempt,
    status: "unknown",
    reason,
  }));

  return persistPublicationReport({
    transactionPath,
    publication: publicationArtifact(latestAttempt(updated)),
    targetPhase: "publication-pending",
    targetStatus: "outcome-unknown",
    terminalDisposition: null,
  });
}

function newAttempt({ transaction, remote, destination, retryOf }) {
  const commitOid = transaction.commit.commitOid;

  return {
    schemaVersion: 1,
    attemptId: randomUUID(),
    retryOf,
    status: "pending",
    launchState: "not-started",
    childIdentity: null,
    commitOid,
    remote,
    destination,
    refspec: `${commitOid}:${destination}`,
    startedAt: new Date().toISOString(),
    completion: null,
    transcript: null,
    observation: null,
    resolution: null,
    retryPermitted: false,
    reason: null,
  };
}

function appendAttempt(transactionPath, transaction, attempt) {
  const next = {
    ...transaction,
    phase: "publication-pending",
    status: "outcome-unknown",
    terminalDisposition: null,
    publicationAttempts: [...transaction.publicationAttempts, attempt],
  };

  return transaction.phase === "reported"
    ? advanceTransaction(transactionPath, "reported", next)
    : updateTransaction(transactionPath, "publication-pending", next);
}

function validateRetry(transaction, retryAfterAttempt, remote, destination) {
  const prior = latestAttempt(transaction);

  if (
    transaction.phase !== "publication-pending" ||
    prior === null ||
    prior.attemptId !== retryAfterAttempt ||
    prior.retryPermitted !== true ||
    prior.resolution?.kind !== "confirmed-no-live-child" ||
    prior.remote !== remote ||
    prior.destination !== destination ||
    prior.commitOid !== transaction.commit.commitOid
  ) {
    fail(
      "PUBLICATION_RETRY_NOT_PERMITTED",
      "The retry token does not bind the latest resolved unknown publication attempt.",
      { exitCode: 4 },
    );
  }

  try {
    assertRecordedChildInactive({
      repositoryRoot: transaction.repositoryRoot,
      childIdentity: prior.childIdentity,
    });
  } catch (error) {
    fail(
      "PUBLICATION_RETRY_NOT_PERMITTED",
      `The resolved publication child state no longer permits retry: ${error.message}`,
      { exitCode: 4 },
    );
  }

  return prior;
}

export async function publishWorkflow({
  transactionPath,
  remote,
  destination,
  retryAfterAttempt = null,
  environment = process.env,
  processLauncher = spawn,
  diagnosticWriter = process.stderr,
  readOnlyRunner = runReadOnlyGit,
  failureInjector = () => {},
}) {
  let lock;

  try {
    lock = acquireTransactionStateLock({
      transactionPath,
      operation: "publication",
    });
  } catch (error) {
    if (error.code === "TRANSACTION_STATE_CONFLICT") {
      fail("PUBLICATION_STATE_CONFLICT", error.message, { exitCode: 1 });
    }

    throw error;
  }

  let journaledAttemptId = null;

  try {
    let transaction = readTransaction(transactionPath);

    if (transaction.phase === "published") {
      if (retryAfterAttempt !== null) {
        fail(
          "PUBLICATION_RETRY_NOT_PERMITTED",
          "A historical retry token cannot be reused after publication completed.",
          { exitCode: 4 },
        );
      }

      const attempt = latestAttempt(transaction);
      const publication = publicationArtifact(attempt);
      const report = readPersistedReport(transaction);
      return resultModel(
        transactionPath,
        transaction,
        publication,
        report,
        renderCommitReport(report),
      );
    }

    if (
      retryAfterAttempt !== null &&
      !UUID_V4_PATTERN.test(retryAfterAttempt)
    ) {
      fail(
        "PUBLICATION_RETRY_INVALID",
        "--retry-after-attempt must be the exact helper UUID.",
      );
    }

    if (retryAfterAttempt === null && transaction.phase !== "reported") {
      fail(
        "PUBLICATION_RECOVERY_REQUIRED",
        "A pending publication must be recovered and explicitly resolved before retry.",
        { exitCode: 4 },
      );
    }

    if (retryAfterAttempt !== null && transaction.phase === "reported") {
      fail(
        "PUBLICATION_RETRY_UNEXPECTED",
        "--retry-after-attempt is not accepted for an ordinary reported transaction.",
      );
    }

    assertPublicationAllowed(transaction);
    validateDestination(
      transaction.repositoryRoot,
      remote,
      destination,
      readOnlyRunner,
    );
    const retryOf =
      retryAfterAttempt === null
        ? null
        : validateRetry(transaction, retryAfterAttempt, remote, destination)
            .attemptId;
    const attempt = newAttempt({
      transaction,
      remote,
      destination,
      retryOf,
    });

    transaction = appendAttempt(transactionPath, transaction, attempt);
    journaledAttemptId = attempt.attemptId;
    failureInjector("after-publication-journal");
    transaction = updateAttempt(
      transactionPath,
      attempt.attemptId,
      (current) => ({ ...current, launchState: "launching" }),
    );
    failureInjector("after-launching-before-spawn");
    let child;

    try {
      child = processLauncher(
        "git",
        ["push", "--porcelain", "--", remote, attempt.refspec],
        {
          cwd: transaction.repositoryRoot,
          env: {
            ...environment,
            GIT_PAGER: "cat",
            PAGER: "cat",
            NO_COLOR: "1",
          },
          windowsHide: true,
          stdio: ["inherit", "pipe", "pipe"],
        },
      );
    } catch (error) {
      updateAttempt(transactionPath, attempt.attemptId, (current) => ({
        ...current,
        status: "rejected",
        launchState: "completed",
        completion: {
          exitCode: null,
          signal: null,
          transcriptCompletionSha256: null,
          nonLaunchGuaranteed: true,
          launchError: { code: error.code ?? null, message: error.message },
          outcome: "not-launched",
        },
        reason: "not-launched",
      }));
      return finalizeAttempt(
        transactionPath,
        attempt.attemptId,
        "rejected",
        "not-launched",
      );
    }

    const childIdentity = captureChildIdentity(child.pid);

    if (childIdentity !== null) {
      updateAttempt(transactionPath, attempt.attemptId, (current) => ({
        ...current,
        launchState: "running",
        childIdentity,
      }));
    }

    const transcript = await captureGitProcessTranscript({
      transactionPath,
      operation: "push",
      instanceId: attempt.attemptId,
      child,
      stdoutCaptureLimit: MAXIMUM_PUSH_CLASSIFICATION_BYTES,
      diagnosticWriter,
    });

    if (transcript.launchError !== null && childIdentity === null) {
      throw new Error(
        `Push launcher emitted an asynchronous error without a child identity: ${transcript.launchError.message}`,
      );
    }

    const pushOutcome = classifyPushCompletion(transcript, destination);

    updateAttempt(transactionPath, attempt.attemptId, (current) => ({
      ...current,
      launchState: "completed",
      completion: {
        exitCode: transcript.status,
        signal: transcript.signal,
        transcriptCompletionSha256: transcript.completionSha256,
        nonLaunchGuaranteed: false,
        launchError: transcript.launchError,
        outcome: pushOutcome,
      },
      transcript: transcriptFacts(transcript),
    }));
    failureInjector("after-push-completion-before-report");

    return pushOutcome === "witnessed-success"
      ? finalizeAttempt(transactionPath, attempt.attemptId, "succeeded")
      : pushOutcome === "known-rejection"
        ? finalizeAttempt(
            transactionPath,
            attempt.attemptId,
            "rejected",
            "git-push-rejected",
          )
        : persistUnknownAttempt(
            transactionPath,
            attempt.attemptId,
            "push-transport-outcome-unknown",
          );
  } catch (error) {
    if (journaledAttemptId === null || error instanceof PublishWorkflowError) {
      throw error;
    }

    const transaction = readTransaction(transactionPath);
    const attempt = latestAttempt(transaction);

    if (attempt?.attemptId !== journaledAttemptId) {
      throw error;
    }

    if (attempt.launchState === "not-started") {
      return finalizeAttempt(
        transactionPath,
        attempt.attemptId,
        "rejected",
        "not-launched",
      );
    }

    if (attempt.launchState === "completed") {
      if (attempt.completion?.outcome === "witnessed-success") {
        return finalizeAttempt(transactionPath, attempt.attemptId, "succeeded");
      }

      if (
        new Set(["known-rejection", "not-launched"]).has(
          attempt.completion?.outcome,
        )
      ) {
        return finalizeAttempt(
          transactionPath,
          attempt.attemptId,
          "rejected",
          attempt.completion.outcome === "not-launched"
            ? "not-launched"
            : "git-push-rejected",
        );
      }
    }

    return persistUnknownAttempt(
      transactionPath,
      attempt.attemptId,
      error.message,
    );
  } finally {
    releaseTransactionStateLock(lock);
  }
}

export async function observePublicationDestination(
  root,
  remote,
  destination,
  { stream = streamGit, now = () => new Date().toISOString() } = {},
) {
  let stdout = Buffer.alloc(0);
  let stdoutOverflow = false;
  const result = await stream(
    "ls-remote",
    ["--refs", "--exit-code", "--", remote, destination],
    {
      cwd: root,
      allowFailure: true,
      onStdout(chunk) {
        const remaining = Math.max(
          0,
          MAXIMUM_REMOTE_OBSERVATION_BYTES - stdout.length,
        );

        stdout = Buffer.concat([stdout, chunk.subarray(0, remaining)]);
        stdoutOverflow ||= chunk.length > remaining;
      },
    },
  );
  const base = {
    observedAt: now(),
    observedOid: null,
    exitCode: result.status,
    stdoutSha256: result.stdoutSha256,
    stderrSha256: result.stderrSha256,
    commandDigest: sha256(
      Buffer.from(
        JSON.stringify({
          operation: "ls-remote",
          remote,
          destination,
          status: result.status,
          stdoutSha256: result.stdoutSha256,
          stderrSha256: result.stderrSha256,
        }),
      ),
    ),
    reason: null,
  };

  if (stdoutOverflow) {
    return {
      ...base,
      status: "unavailable",
      reason: "remote-response-too-large",
    };
  }

  if (result.status === 2 && stdout.length === 0) {
    return { ...base, status: "absent" };
  }

  if (result.status !== 0) {
    return { ...base, status: "unavailable", reason: "remote-query-failed" };
  }

  const lines = stdout.toString("utf8").split(/\r?\n/u).filter(Boolean);
  const matches = lines.map((line) => {
    const separator = line.indexOf("\t");

    return separator > 0
      ? { oid: line.slice(0, separator), ref: line.slice(separator + 1) }
      : null;
  });

  if (
    matches.length !== 1 ||
    matches[0] === null ||
    matches[0].ref !== destination ||
    !FULL_OID_PATTERN.test(matches[0].oid)
  ) {
    return {
      ...base,
      status: "unavailable",
      reason: "remote-response-ambiguous",
    };
  }

  return { ...base, status: "observed", observedOid: matches[0].oid };
}

function observationJournal(attempt) {
  const emptyDigest = sha256(Buffer.alloc(0));

  return {
    status: "querying",
    observedAt: new Date().toISOString(),
    observedOid: null,
    exitCode: null,
    stdoutSha256: emptyDigest,
    stderrSha256: emptyDigest,
    commandDigest: sha256(
      Buffer.from(
        JSON.stringify({
          operation: "ls-remote",
          remote: attempt.remote,
          destination: attempt.destination,
        }),
      ),
    ),
    reason: "remote-query-journaled",
  };
}

function interruptedObservation(observation, reason) {
  return {
    ...observation,
    status: "unavailable",
    reason,
  };
}

export async function recoverPublicationOutcome({
  transactionPath,
  resolution = null,
  remoteObserver = observePublicationDestination,
  processInspector,
  indexLockInspector,
}) {
  if (resolution !== null && resolution !== "confirmed-no-live-child") {
    fail(
      "PUBLICATION_RESOLUTION_INVALID",
      "Publication recovery accepts only confirmed-no-live-child.",
      { exitCode: 4 },
    );
  }

  let lock;

  try {
    lock = acquireTransactionStateLock({
      transactionPath,
      operation: "publication-recovery",
    });
  } catch (error) {
    if (error.code === "TRANSACTION_STATE_CONFLICT") {
      fail("PUBLICATION_STATE_CONFLICT", error.message, { exitCode: 4 });
    }

    throw error;
  }

  try {
    let transaction = readTransaction(transactionPath);

    if (transaction.phase !== "publication-pending") {
      fail(
        "PUBLICATION_RECOVERY_NOT_REQUIRED",
        "Publication recovery requires the pending publication phase.",
        { exitCode: 1 },
      );
    }

    let attempt = latestAttempt(transaction);

    if (attempt.launchState === "not-started") {
      return finalizeAttempt(
        transactionPath,
        attempt.attemptId,
        "rejected",
        "not-launched",
      );
    }

    if (attempt.launchState === "completed") {
      if (attempt.completion?.outcome === "witnessed-success") {
        return finalizeAttempt(transactionPath, attempt.attemptId, "succeeded");
      }

      if (
        new Set(["known-rejection", "not-launched"]).has(
          attempt.completion?.outcome,
        )
      ) {
        return finalizeAttempt(
          transactionPath,
          attempt.attemptId,
          "rejected",
          attempt.completion.outcome === "not-launched"
            ? "not-launched"
            : "git-push-rejected",
        );
      }
    }

    if (attempt.observation === null) {
      transaction = updateAttempt(
        transactionPath,
        attempt.attemptId,
        (current) => ({
          ...current,
          observation: observationJournal(current),
        }),
      );
      attempt = latestAttempt(transaction);
      let observation;

      try {
        observation = await remoteObserver(
          transaction.repositoryRoot,
          attempt.remote,
          attempt.destination,
        );
      } catch (error) {
        observation = interruptedObservation(
          attempt.observation,
          `remote-query-failed:${error.message}`,
        );
      }

      transaction = updateAttempt(
        transactionPath,
        attempt.attemptId,
        (current) => ({ ...current, observation }),
      );
      attempt = latestAttempt(transaction);
    } else if (attempt.observation.status === "querying") {
      transaction = updateAttempt(
        transactionPath,
        attempt.attemptId,
        (current) => ({
          ...current,
          observation: interruptedObservation(
            current.observation,
            "remote-query-interrupted",
          ),
        }),
      );
      attempt = latestAttempt(transaction);
    }

    if (
      attempt.observation.status === "observed" &&
      attempt.observation.observedOid === attempt.commitOid
    ) {
      return finalizeAttempt(
        transactionPath,
        attempt.attemptId,
        "observed-matching",
      );
    }

    if (
      resolution === "confirmed-no-live-child" &&
      attempt.resolution === null
    ) {
      try {
        assertRecordedChildInactive({
          repositoryRoot: transaction.repositoryRoot,
          childIdentity: attempt.childIdentity,
          ...(processInspector ? { processInspector } : {}),
          ...(indexLockInspector ? { indexLockInspector } : {}),
        });
      } catch (error) {
        fail(
          "PUBLICATION_RESOLUTION_CONTRADICTED",
          `No-live-child confirmation is contradicted: ${error.message}`,
          { exitCode: 4 },
        );
      }
      transaction = updateAttempt(
        transactionPath,
        attempt.attemptId,
        (current) => ({
          ...current,
          resolution: {
            kind: resolution,
            assertedAt: new Date().toISOString(),
            observationDigest: current.observation.commandDigest,
          },
          retryPermitted: true,
        }),
      );
      attempt = latestAttempt(transaction);
    }

    return persistUnknownAttempt(
      transactionPath,
      attempt.attemptId,
      attempt.reason ?? "remote-outcome-unresolved",
    );
  } finally {
    releaseTransactionStateLock(lock);
  }
}

function parseFlags(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token?.startsWith("--")) {
      fail("INVALID_ARGUMENT", `Unexpected argument ${JSON.stringify(token)}.`);
    }

    const name = token.slice(2);
    const value = argv[index + 1];

    if (values.has(name)) {
      fail("DUPLICATE_ARGUMENT", `--${name} may be supplied only once.`);
    }

    if (value === undefined || value.startsWith("--")) {
      fail("INVALID_ARGUMENT", `--${name} requires a value.`);
    }

    values.set(name, value);
    index += 1;
  }

  return values;
}

function commandOutput(result, format) {
  return format === "text" ? result.displayText : `${JSON.stringify(result)}\n`;
}

export async function runPublishCommand(
  argv,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  let format = "json";

  try {
    const flags = parseFlags(argv);
    const allowed = new Set([
      "transaction",
      "remote",
      "destination",
      "retry-after-attempt",
      "format",
    ]);

    for (const name of flags.keys()) {
      if (!allowed.has(name)) {
        fail("UNKNOWN_ARGUMENT", `Unknown workflow publish flag --${name}.`);
      }
    }

    format = flags.get("format") ?? "json";

    if (!new Set(["json", "text"]).has(format)) {
      fail("INVALID_FORMAT", "--format must be json or text.");
    }

    for (const required of ["transaction", "remote", "destination"]) {
      if (!flags.get(required)) {
        fail("INVALID_ARGUMENT", `--${required} is required.`);
      }
    }

    const result = await publishWorkflow({
      transactionPath: flags.get("transaction"),
      remote: flags.get("remote"),
      destination: flags.get("destination"),
      retryAfterAttempt: flags.get("retry-after-attempt") ?? null,
    });

    stdout.write(commandOutput(result, format));
    return result.exitCode;
  } catch (caught) {
    const error =
      caught instanceof PublishWorkflowError
        ? caught
        : new PublishWorkflowError(
            "PUBLICATION_WORKFLOW_FAILED",
            caught.message,
          );
    const result = {
      schemaVersion: 1,
      status: error.exitCode === 4 ? "outcome-unknown" : "invalid",
      code: error.code,
      message: error.message,
      displayText: `Status: ${error.exitCode === 4 ? "outcome-unknown" : "invalid"}\nCode: ${error.code}\nMessage: ${error.message}\n`,
      exitCode: error.exitCode,
      ...error.details,
    };

    stderr.write(`${error.code}: ${error.message}\n`);
    stdout.write(commandOutput(result, format));
    return error.exitCode;
  }
}
