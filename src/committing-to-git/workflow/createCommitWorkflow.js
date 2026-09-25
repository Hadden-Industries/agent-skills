import {
  executeCommand,
  diagnosticWriterFor,
} from "../cli/commandExecution.js";
import { messageAuthoringRecovery } from "./authoringProgress.js";
import { parseCommandArguments } from "../cli/commandArguments.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import {
  createWorkflowResult,
  createWorkflowWarning,
} from "../diagnostics/diagnosticContract.js";
import {
  observeTransactionFailure,
  transactionDiagnosticState,
} from "../transaction/transactionDiagnosticState.js";

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
import { TextDecoder } from "node:util";

import {
  analyzeCheckCommitReadiness,
  summarizeCheckReceipts,
} from "../checks/checkReceipt.js";
import { verifySnapshotAgainstRepository } from "../snapshot/verifySnapshot.js";
import { captureGitProcessTranscript } from "../git/gitProcessTranscript.js";
import {
  canUseDirectSubjectTransport,
  validateApprovedMessage,
} from "../message/approvedMessage.js";
import {
  readCanonicalMessage,
  readTransactionOwnedFile,
  recoverCanonicalMessageReplacement,
  replaceCanonicalMessage,
} from "../message/canonicalMessageState.js";
import {
  MAXIMUM_REPORT_RESULT_BYTES,
  collectCommitReport,
  collectWorkspaceSummary,
  compactWorkspaceSummary,
  renderCommitReport,
} from "../report/commitReport.js";
import {
  applyVerificationPolicy,
  verifyCommitSignature,
} from "../signature/commitSignature.js";
import {
  signatureTrustDiagnostic,
  inspectSignatureRequirements,
} from "../signature/signaturePreflight.js";
import {
  compactTerminalTransaction,
  recoverCommitOutcome,
  captureChildIdentity,
} from "../transaction/transactionRecovery.js";
import {
  advanceTransaction,
  readTransaction,
  updateTransaction,
} from "../transaction/transactionWorkspace.js";

export const MAXIMUM_COMMIT_RESULT_BYTES = MAXIMUM_REPORT_RESULT_BYTES;

const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const VERIFICATION_POLICIES = new Set(["required", "advisory", "skipped"]);
const STORAGE_OVERRIDE_NAMES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_QUARANTINE_PATH",
  "GIT_NAMESPACE",
];

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertNoGitStorageOverrides(environment) {
  const active = STORAGE_OVERRIDE_NAMES.filter(
    (name) => environment[name] !== undefined && environment[name] !== "",
  );

  if (active.length > 0) {
    fail(
      "GIT_STORAGE_OVERRIDE_REJECTED",
      `Commit refuses Git storage overrides: ${active.join(", ")}.`,
    );
  }
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

function directMessage(
  transactionPath,
  transaction,
  manifest,
  approvedSubject,
) {
  if (
    typeof approvedSubject !== "string" ||
    !canUseDirectSubjectTransport(approvedSubject)
  ) {
    fail(
      "MESSAGE_REQUIRES_CHECKED_FILE",
      "This message must be supplied through the fixed message-input.txt check route.",
      {
        state: {
          transaction: resolve(transactionPath),
          phase: transaction.phase,
          route: transaction.route,
          commitState: "absent",
          publicationState: "not-requested",
        },
        ...messageAuthoringRecovery(transaction, transactionPath),
      },
    );
  }

  const bytes = Buffer.from(`${approvedSubject}\n`, "utf8");
  const validation = validateApprovedMessage({
    manifest,
    route: "concise",
    bytes,
    repositoryTypePolicy: transaction.repositoryTypePolicy,
    messageSource: "approved-subject",
  });

  return replaceCanonicalMessage({
    transactionPath,
    bytes,
    validation,
    source: "approved-subject",
  });
}

function selectCanonicalMessage({
  transactionPath,
  transaction,
  manifest,
  approvedSubject,
}) {
  recoverCanonicalMessageReplacement(transactionPath);
  transaction = readTransaction(transactionPath);

  if (
    transaction.phase === "evidence-ready" &&
    transaction.route === "concise"
  ) {
    return directMessage(
      transactionPath,
      transaction,
      manifest,
      approvedSubject,
    );
  }

  if (transaction.phase === "message-ready") {
    if (approvedSubject !== null && approvedSubject !== undefined) {
      fail(
        "MESSAGE_ALREADY_RECORDED",
        "A message-ready transaction must use its recorded canonical bytes.",
      );
    }

    const message = readCanonicalMessage(transactionPath);

    if (message === null) {
      fail("CANONICAL_MESSAGE_MISSING", "The canonical message slot is empty.");
    }

    return message;
  }

  fail(
    "COMMIT_PHASE_INVALID",
    `Transaction phase ${transaction.phase} cannot create a commit.`,
    {
      disposition: "unmet-prerequisite",
      state: transactionDiagnosticState(transaction, transactionPath),
      ...messageAuthoringRecovery(transaction, transactionPath),
    },
  );
}

function preflightCommitVerification({
  transactionPath,
  transaction,
  finalPolicy,
  signaturePreflightInspector,
}) {
  if (finalPolicy === "skipped") {
    return transaction;
  }

  if (transaction.signaturePreflight?.backend === null) {
    const signaturePreflight = signaturePreflightInspector(
      transaction.repositoryRoot,
    );

    transaction = updateTransaction(transactionPath, transaction.phase, {
      ...transaction,
      signaturePreflight,
    });
  }

  if (
    finalPolicy === "required" &&
    transaction.signaturePreflight?.backend === "ssh" &&
    transaction.signaturePreflight.trustSource?.state !== "readable"
  ) {
    throw signatureTrustDiagnostic(transaction.signaturePreflight.trustSource, {
      verificationPolicy: finalPolicy,
      state: transactionDiagnosticState(transaction, transactionPath),
    });
  }

  return transaction;
}

function authorizeCheckReceipts(
  transactionPath,
  transaction,
  acknowledgedFailedCheckIds,
) {
  const readiness = analyzeCheckCommitReadiness(
    transaction.checkAttempts,
    acknowledgedFailedCheckIds,
  );

  if (readiness.activeAttemptIds.length > 0) {
    fail(
      "CHECK_RECOVERY_REQUIRED",
      `Check ${readiness.activeAttemptIds.at(-1)} has no durable outcome; recover it before committing.`,
      {
        disposition: "outcome-unknown",
        details: {
          receiptIds: readiness.activeAttemptIds,
          recoveryRequired: true,
        },
      },
    );
  }

  if (readiness.retryRequiredIds.length > 0) {
    fail(
      "CHECK_RETRY_REQUIRED",
      `Recovered check ${readiness.retryRequiredIds.at(-1)} has an unknown outcome and requires a linked retry before committing.`,
      {
        disposition: "unmet-prerequisite",
        details: { receiptIds: readiness.retryRequiredIds },
      },
    );
  }

  if (
    readiness.invalidAcknowledgementIds.length > 0 ||
    readiness.duplicateAcknowledgementIds.length > 0
  ) {
    fail(
      "FAILED_CHECK_ACKNOWLEDGEMENT_INVALID",
      "Failed-check acknowledgements must name each current non-passing witnessed receipt exactly once.",
      {
        details: {
          invalidReceiptIds: readiness.invalidAcknowledgementIds,
          duplicateReceiptIds: readiness.duplicateAcknowledgementIds,
          requiredReceiptIds: readiness.failedReceiptIds,
        },
      },
    );
  }

  if (readiness.missingAcknowledgementIds.length > 0) {
    fail(
      "FAILED_CHECK_ACKNOWLEDGEMENT_REQUIRED",
      "Exact commit authorization must acknowledge every non-passing receipt. Review the listed receipt IDs; retain explicitly approved acknowledgement arguments to reveal any remaining IDs on the next invocation.",
      {
        disposition: "unmet-prerequisite",
        state: {
          transaction: transactionPath,
          phase: transaction.phase,
          route: transaction.route,
          commitState:
            transaction.commit === null
              ? "absent"
              : transaction.commit.commitOid
                ? "created"
                : "unknown",
          publicationState: "not-requested",
        },
        recovery: {
          kind: "human-decision",
          automatic: false,
          requiredInputs: [
            "exact commit authorization",
            "explicit acknowledgement of every listed non-passing receipt ID",
          ],
          commands: [],
        },
        details: {
          receiptIds: readiness.missingAcknowledgementIds.slice(0, 32),
          missingReceiptCount: readiness.missingAcknowledgementIds.length,
          omittedReceiptCount: Math.max(
            0,
            readiness.missingAcknowledgementIds.length - 32,
          ),
          action: "request-exact-commit-and-failed-check-approval",
        },
      },
    );
  }

  // Store acknowledgement IDs in receipt order so equivalent CLI ordering
  // cannot produce different transaction or report bytes.
  return readiness.failedReceiptIds;
}

function transcriptFacts(transcript) {
  return {
    schemaVersion: transcript.schemaVersion,
    path: transcript.path,
    status: transcript.status,
    signal: transcript.signal,
    launchError: transcript.launchError,
    recordCount: transcript.recordCount,
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

function updateCommitJournal(transactionPath, transform) {
  const current = readTransaction(transactionPath);

  return updateTransaction(transactionPath, "commit-pending", {
    ...current,
    commit: transform(current.commit),
  });
}

function atomicWrite(path, bytes) {
  const candidate = join(dirname(path), `.report-${randomUUID()}.tmp`);
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

  if (lstatSafe(path)?.isSymbolicLink()) {
    fail(
      "REPORT_PATH_REPLACED",
      `Report output was replaced by a link: ${path}`,
    );
  }

  renameSync(candidate, path);
}

function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function verificationAttemptFor({
  transaction,
  finalPolicy,
  signatureVerifier,
}) {
  if (finalPolicy === "skipped") {
    return null;
  }

  if (
    finalPolicy === "advisory" &&
    transaction.signaturePreflight?.backend === "ssh" &&
    transaction.signaturePreflight.trustSource?.state !== "readable"
  ) {
    return {
      status: "unavailable",
      reason: "trust-store-unreadable",
      backend: "ssh",
      identity: null,
      timestamp: new Date().toISOString(),
    };
  }

  return signatureVerifier(
    transaction.repositoryRoot,
    transaction.commit.commitOid,
    {
      backend: transaction.signaturePreflight?.backend ?? null,
    },
  );
}

function verificationDiagnostics(verification) {
  const effectiveVerification =
    verification.attempts[verification.effectiveAttempt];
  return verification.finalPolicy === "advisory" &&
    effectiveVerification.status !== "verified"
    ? [
        createWorkflowWarning({
          code: "SIGNATURE_VERIFICATION_ADVISORY",
          message:
            "The commit is signed, but signature trust was not verified under the advisory policy.",
          documentation: "references/signature-recovery.md",
          details: [
            {
              kind: "prerequisite",
              policy: verification.finalPolicy,
              status: effectiveVerification.status,
            },
          ],
        }),
      ]
    : [];
}

function reportResult(
  transactionPath,
  transaction,
  report,
  displayText,
  exitCode,
  cleanup,
) {
  return createWorkflowResult({
    disposition: exitCode === 0 ? "succeeded" : "completed-with-failure",
    code: exitCode === 0 ? null : "COMMIT_POLICY_BLOCKED",
    message:
      exitCode === 0
        ? null
        : "The commit exists, but comparison or signature policy blocks publication.",
    status: exitCode === 0 ? "reported" : "commit-blocked",
    phase: transaction.phase,
    transaction: resolve(transactionPath),
    route: transaction.route,
    commitState: "created",
    publicationState:
      report.publication.status === "blocked" ? "blocked" : "not-requested",
    publicationAllowed: transaction.report.publicationAllowed,
    recoveryRequired: false,
    warnings: [
      ...(cleanup?.warnings ?? []),
      ...verificationDiagnostics(report.verification),
    ],
    recovery: {
      kind: exitCode === 0 ? "none" : "inspect-state",
      automatic: false,
      requiredInputs: [],
      commands: [],
    },
    data: {
      terminalDisposition: transaction.terminalDisposition,
      commitOid: transaction.commit.commitOid,
      report,
      displayText,
      cleanup,
    },
  });
}

export function readRecordedReport(transactionPath) {
  const transaction = readTransaction(transactionPath);

  if (transaction.phase !== "reported" || transaction.report === null) {
    fail(
      "REPORT_NOT_RECORDED",
      "Transaction does not contain a final local report.",
    );
  }

  const report = JSON.parse(readFileSync(transaction.report.jsonPath, "utf8"));
  const displayText = readFileSync(transaction.report.textPath, "utf8");
  const exitCode = transaction.status === "reported" ? 0 : 3;

  return reportResult(
    transactionPath,
    transaction,
    report,
    displayText,
    exitCode,
    null,
  );
}

export async function completeRecordedCommit({
  transactionPath,
  verificationPolicyOverride = null,
  retainReviewArtifacts = false,
  retainProcessLogs = false,
  signatureVerifier = verifyCommitSignature,
  failureInjector = () => {},
}) {
  let transaction = readTransaction(transactionPath);

  if (
    transaction.phase !== "commit-pending" ||
    transaction.commit?.commitOid === null ||
    transaction.commit?.comparison === null
  ) {
    fail(
      "COMMIT_NOT_READY_FOR_REPORT",
      "A matching recorded commit is required before verification and reporting.",
      {
        disposition: "unmet-prerequisite",
        state: transactionDiagnosticState(transaction, transactionPath),
      },
    );
  }

  const finalPolicy =
    verificationPolicyOverride ??
    transaction.verification?.finalPolicy ??
    transaction.verificationPolicy;

  if (!VERIFICATION_POLICIES.has(finalPolicy)) {
    fail(
      "INVALID_VERIFICATION_POLICY",
      "Verification override must be required, advisory, or skipped.",
    );
  }

  failureInjector("during-verification");
  const attempt = verificationAttemptFor({
    transaction,
    finalPolicy,
    signatureVerifier,
  });
  const verification = applyVerificationPolicy({
    commitOid: transaction.commit.commitOid,
    initialPolicy: transaction.verificationPolicy,
    finalPolicy,
    verificationAttempt: attempt,
    previousVerification: transaction.verification,
  });

  transaction = updateCommitJournal(transactionPath, (commit) => commit);
  transaction = updateTransaction(transactionPath, "commit-pending", {
    ...transaction,
    verification,
  });
  failureInjector("after-verification-before-report");
  const manifest = readSnapshot(transactionPath, transaction);
  const message = readCanonicalMessage(transactionPath);
  const workspaceSummary = await collectWorkspaceSummary(
    transaction.repositoryRoot,
    { scope: transaction.scope },
  );
  const checks = summarizeCheckReceipts(
    transaction.checkAttempts,
    transaction.commit.acknowledgedFailedCheckIds,
  );
  let report = collectCommitReport({
    root: transaction.repositoryRoot,
    commitOid: transaction.commit.commitOid,
    manifest,
    approvedMessage: message.bytes,
    verification,
    checks,
    headAnchor: transaction.headAnchor,
    workspaceSummary,
  });
  let displayText = renderCommitReport(report);

  if (
    Buffer.byteLength(
      JSON.stringify({
        transaction: resolve(transactionPath),
        report,
        displayText,
      }),
    ) > MAXIMUM_REPORT_RESULT_BYTES
  ) {
    report = {
      ...report,
      workspace: compactWorkspaceSummary(report.workspace),
    };
    displayText = renderCommitReport(report);
  }

  const reportBytes = canonicalJsonBytes(report);
  const textBytes = Buffer.from(displayText, "utf8");

  if (reportBytes.length + textBytes.length > MAXIMUM_COMMIT_RESULT_BYTES) {
    fail(
      "REPORT_RESULT_BUDGET_EXCEEDED",
      "The commit exists, but its final result exceeds the bounded report budget.",
      {
        disposition: "completed-with-failure",
        state: transactionDiagnosticState(transaction, transactionPath),
      },
    );
  }

  failureInjector("during-report-writing");
  const jsonPath = join(transaction.attemptDirectory, "report.json");
  const textPath = join(transaction.attemptDirectory, "report.txt");

  atomicWrite(jsonPath, reportBytes);
  atomicWrite(textPath, textBytes);
  const comparisonMatches =
    report.commit.parentMatches &&
    report.commit.treeMatches &&
    report.commit.messageMatches &&
    report.commit.signed;
  const publicationAllowed = comparisonMatches && !verification.blocksPush;
  const blocked = !publicationAllowed;
  transaction = advanceTransaction(transactionPath, "commit-pending", {
    ...transaction,
    phase: "reported",
    status: blocked ? "commit-blocked" : "reported",
    terminalDisposition: "local-commit-recorded",
    report: {
      schemaVersion: 1,
      jsonPath,
      jsonSha256: sha256(reportBytes),
      textPath,
      textSha256: sha256(textBytes),
      comparisonMatches,
      publicationAllowed,
    },
  });

  let cleanup;

  try {
    failureInjector("after-report-writing-before-compaction");
    cleanup = compactTerminalTransaction({
      transactionPath,
      retainReviewArtifacts,
      retainProcessLogs,
    });
  } catch {
    cleanup = createWorkflowResult({
      disposition: "succeeded",
      status: "cleaned",
      ...transactionDiagnosticState(transaction, transactionPath),
      warnings: [
        createWorkflowWarning({
          code: "COMPACTION_INCOMPLETE",
          message:
            "The commit report is retained, but optional artifact compaction could not finish.",
          details: [
            { kind: "prerequisite", path: transaction.attemptDirectory },
          ],
        }),
      ],
      data: { completed: [] },
    });
  }

  let result = reportResult(
    transactionPath,
    transaction,
    report,
    displayText,
    blocked ? 3 : 0,
    cleanup,
  );

  if (Buffer.byteLength(JSON.stringify(result)) > MAXIMUM_REPORT_RESULT_BYTES) {
    report = {
      ...report,
      workspace: compactWorkspaceSummary(report.workspace),
    };
    displayText = renderCommitReport(report);
    const compactReportBytes = canonicalJsonBytes(report);
    const compactTextBytes = Buffer.from(displayText, "utf8");

    atomicWrite(jsonPath, compactReportBytes);
    atomicWrite(textPath, compactTextBytes);
    transaction = updateTransaction(transactionPath, "reported", {
      ...transaction,
      report: {
        ...transaction.report,
        jsonSha256: sha256(compactReportBytes),
        textSha256: sha256(compactTextBytes),
      },
    });
    result = reportResult(
      transactionPath,
      transaction,
      report,
      displayText,
      blocked ? 3 : 0,
      cleanup,
    );
  }

  if (Buffer.byteLength(JSON.stringify(result)) > MAXIMUM_REPORT_RESULT_BYTES) {
    fail(
      "REPORT_RESULT_BUDGET_EXCEEDED",
      "The complete serialized commit result exceeds the bounded report budget.",
      { disposition: "completed-with-failure" },
    );
  }

  return result;
}

function incompleteKnownCommitResult(transactionPath, recovery) {
  const transaction = readTransaction(transactionPath);
  return createWorkflowResult({
    disposition: "completed-with-failure",
    status: "commit-blocked",
    phase: transaction.phase,
    transaction: resolve(transactionPath),
    route: transaction.route,
    commitState: "created",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: true,
    code: "COMMIT_CONTINUATION_REQUIRED",
    message:
      "The commit exists; its verification or report needs recovery from the recorded transaction.",
    recovery: {
      kind: "continue",
      automatic: false,
      requiredInputs: [],
      commands: [
        {
          arguments: ["workflow", "recover", "--transaction", transactionPath],
        },
      ],
    },
    data: {
      terminalDisposition: transaction.terminalDisposition,
      commitOid: transaction.commit?.commitOid ?? recovery.commitOid ?? null,
    },
  });
}

/** Retain the last observed facts when the journal cannot establish a final outcome. */
function uncertainCommitResult(transactionPath, transaction) {
  const knownCommit = Boolean(transaction.commit?.commitOid);
  return createWorkflowResult({
    disposition: knownCommit ? "completed-with-failure" : "outcome-unknown",
    status: knownCommit ? "commit-blocked" : "outcome-unknown",
    phase: transaction.phase,
    transaction: resolve(transactionPath),
    route: transaction.route,
    commitState: transaction.commit?.commitOid ? "created" : "unknown",
    publicationState: "not-requested",
    recoveryRequired: true,
    code: "COMMIT_RECOVERY_FAILED",
    message: knownCommit
      ? "The commit was created, but subsequent recovery failed. Inspect the retained transaction; do not recreate the commit."
      : "Commit outcome recovery failed. Inspect the retained transaction before any further mutation.",
    recovery: {
      kind: "inspect-state",
      automatic: false,
      requiredInputs: [],
      commands: [
        {
          arguments: ["workflow", "recover", "--transaction", transactionPath],
        },
      ],
    },
    data: {
      terminalDisposition: transaction.terminalDisposition,
      commitOid: transaction.commit?.commitOid ?? null,
    },
  });
}

export async function createCommitWorkflow({
  transactionPath,
  approvedSubject = null,
  acknowledgedFailedCheckIds = [],
  retainReviewArtifacts = false,
  retainProcessLogs = false,
  verificationPolicyOverride = null,
  environment = process.env,
  processLauncher = spawn,
  diagnosticWriter = process.stderr,
  signatureVerifier = verifyCommitSignature,
  signaturePreflightInspector = inspectSignatureRequirements,
  failureInjector = () => {},
}) {
  assertNoGitStorageOverrides(environment);
  let transaction = readTransaction(transactionPath);

  if (transaction.mode !== "actual") {
    fail(
      "DRAFT_REQUIRES_PROMOTION",
      "A draft transaction must be promoted before commit creation.",
    );
  }

  const canonicalFailedCheckAcknowledgements = authorizeCheckReceipts(
    transactionPath,
    transaction,
    acknowledgedFailedCheckIds,
  );

  if (
    verificationPolicyOverride !== null &&
    !VERIFICATION_POLICIES.has(verificationPolicyOverride)
  ) {
    fail(
      "INVALID_VERIFICATION_POLICY",
      "Verification override must be required, advisory, or skipped.",
    );
  }

  const finalPolicy =
    verificationPolicyOverride ?? transaction.verificationPolicy;

  transaction = preflightCommitVerification({
    transactionPath,
    transaction,
    finalPolicy,
    signaturePreflightInspector,
  });

  const manifest = readSnapshot(transactionPath, transaction);
  const message = selectCanonicalMessage({
    transactionPath,
    transaction,
    manifest,
    approvedSubject,
  });

  transaction = readTransaction(transactionPath);
  failureInjector("before-snapshot-verification");
  const snapshotVerification = verifySnapshotAgainstRepository({
    root: transaction.repositoryRoot,
    manifest,
    headAnchor: transaction.headAnchor,
    useRealIndex: transaction.snapshot.promotion?.status === "installed",
  });

  if (!snapshotVerification.valid) {
    const stopped = advanceTransaction(transactionPath, transaction.phase, {
      ...transaction,
      phase: "stopped",
      status: "stopped",
      terminalDisposition: "no-commit-stopped",
    });
    return createWorkflowResult({
      disposition: "rejected",
      status: "stopped",
      phase: stopped.phase,
      transaction: resolve(transactionPath),
      route: stopped.route,
      commitState: "absent",
      publicationState: "not-requested",
      publicationAllowed: false,
      recoveryRequired: false,
      code: "SNAPSHOT_DRIFT",
      message:
        "The selected snapshot changed; review the drift before preparing another transaction.",
      recovery: {
        kind: "inspect-state",
        automatic: false,
        requiredInputs: [],
        commands: [],
      },
      data: {
        terminalDisposition: stopped.terminalDisposition,
        snapshotVerification,
      },
    });
  }

  const startedAt = new Date().toISOString();
  const commit = {
    status: "pending",
    launchState: "not-started",
    childIdentity: null,
    headAnchor: transaction.headAnchor,
    expectedTreeOid: transaction.snapshot.indexTreeOid,
    messageSha256: message.messageSha256,
    messageByteCount: message.byteCount,
    acknowledgedFailedCheckIds: canonicalFailedCheckAcknowledgements,
    startedAt,
    completion: null,
    transcript: null,
    commitOid: null,
    comparison: null,
    observationProvenance: null,
    recoveryObservations: null,
    recoveryResolution: null,
  };
  advanceTransaction(transactionPath, "message-ready", {
    ...transaction,
    phase: "commit-pending",
    status: "outcome-unknown",
    terminalDisposition: null,
    commit,
  });
  try {
    failureInjector("after-pending-journal-before-git");
    transaction = updateCommitJournal(transactionPath, (journal) => ({
      ...journal,
      launchState: "launching",
    }));
    failureInjector("after-launching-before-spawn");
    let child;

    try {
      child = processLauncher(
        "git",
        ["commit", "--cleanup=verbatim", "-S", "-F", message.messagePath],
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
      updateCommitJournal(transactionPath, (journal) => ({
        ...journal,
        launchState: "completed",
        completion: {
          exitCode: null,
          signal: null,
          transcriptCompletionSha256: null,
          nonLaunchGuaranteed: true,
          launchError: { code: error.code ?? null, message: error.message },
        },
      }));
      throw error;
    }

    const childIdentity = captureChildIdentity(child.pid);

    if (childIdentity !== null) {
      transaction = updateCommitJournal(transactionPath, (journal) => ({
        ...journal,
        launchState: "running",
        childIdentity,
      }));
    }

    const transcript = await captureGitProcessTranscript({
      transactionPath,
      operation: "commit",
      child,
      diagnosticWriter,
    });

    if (transcript.launchError !== null && childIdentity === null) {
      throw new Error(
        `Commit launcher emitted an asynchronous error without a child identity: ${transcript.launchError.message}`,
      );
    }

    transaction = updateCommitJournal(transactionPath, (journal) => ({
      ...journal,
      launchState: "completed",
      transcript: transcriptFacts(transcript),
      completion: {
        exitCode: transcript.status,
        signal: transcript.signal,
        transcriptCompletionSha256: transcript.completionSha256,
        nonLaunchGuaranteed: false,
        launchError: transcript.launchError,
      },
    }));
    failureInjector("after-head-update-before-oid");
    const recovery = recoverCommitOutcome({
      transactionPath,
      witnessCompletedChild: true,
    });

    if (
      !new Set(["matching-commit-observed", "created-commit-observed"]).has(
        recovery.status,
      )
    ) {
      return recovery;
    }

    transaction = updateCommitJournal(transactionPath, (journal) => ({
      ...journal,
      status: "created",
      observationProvenance: "witnessed",
    }));
    failureInjector("after-oid-before-verification");
    return await completeRecordedCommit({
      transactionPath,
      verificationPolicyOverride,
      retainReviewArtifacts,
      retainProcessLogs,
      signatureVerifier,
      failureInjector,
    });
  } catch {
    let current;
    try {
      current = readTransaction(transactionPath);
    } catch {
      return uncertainCommitResult(transactionPath, transaction);
    }

    if (current.phase === "reported") {
      return readRecordedReport(transactionPath);
    }

    let recovery;

    try {
      recovery = recoverCommitOutcome({ transactionPath });
    } catch {
      return uncertainCommitResult(transactionPath, current);
    }

    return recovery.status === "matching-commit-observed"
      ? incompleteKnownCommitResult(transactionPath, recovery)
      : recovery;
  }
}

export function retrySignatureVerificationWorkflow({
  transactionPath,
  verificationPolicyOverride = null,
  signatureVerifier = verifyCommitSignature,
}) {
  let transaction = readTransaction(transactionPath);

  if (
    transaction.phase !== "reported" ||
    transaction.commit?.commitOid === null
  ) {
    fail(
      "VERIFICATION_RETRY_NOT_ALLOWED",
      "Verification retry requires one already reported commit.",
      { disposition: "unmet-prerequisite" },
    );
  }

  const previous = transaction.verification;
  const finalPolicy =
    verificationPolicyOverride ??
    previous.finalPolicy ??
    transaction.verificationPolicy;
  const attempt = verificationAttemptFor({
    transaction,
    finalPolicy,
    signatureVerifier,
  });
  const verification = applyVerificationPolicy({
    commitOid: transaction.commit.commitOid,
    initialPolicy: transaction.verificationPolicy,
    finalPolicy,
    verificationAttempt: attempt,
    previousVerification: previous,
  });
  const priorReport = JSON.parse(
    readFileSync(transaction.report.jsonPath, "utf8"),
  );
  const report = { ...priorReport, verification };
  const displayText = renderCommitReport(report);
  const publicationAllowed =
    transaction.commit.comparison.parentMatches &&
    transaction.commit.comparison.treeMatches &&
    transaction.commit.comparison.messageMatches &&
    transaction.commit.comparison.signatureHeaderPresent &&
    !verification.blocksPush;
  const reportBytes = canonicalJsonBytes(report);
  const textBytes = Buffer.from(displayText, "utf8");

  atomicWrite(transaction.report.jsonPath, reportBytes);
  atomicWrite(transaction.report.textPath, textBytes);
  transaction = updateTransaction(transactionPath, "reported", {
    ...transaction,
    status: publicationAllowed ? "reported" : "commit-blocked",
    verification,
    report: {
      ...transaction.report,
      jsonSha256: sha256(reportBytes),
      textSha256: sha256(textBytes),
      publicationAllowed,
    },
  });

  const effective = verification.attempts[verification.effectiveAttempt];
  return createWorkflowResult({
    disposition: publicationAllowed ? "succeeded" : "completed-with-failure",
    code: publicationAllowed ? null : "SIGNATURE_VERIFICATION_BLOCKED",
    message: publicationAllowed
      ? null
      : "Signature verification policy blocks publication of the recorded commit.",
    status: publicationAllowed ? "verified" : "commit-blocked",
    phase: transaction.phase,
    transaction: resolve(transactionPath),
    route: transaction.route,
    commitState: "created",
    publicationState: transactionDiagnosticState(transaction, transactionPath)
      .publicationState,
    publicationAllowed,
    warnings: verificationDiagnostics(verification),
    recoveryRequired: false,
    recovery: {
      kind: publicationAllowed ? "none" : "satisfy-prerequisite",
      automatic: false,
      requiredInputs: publicationAllowed
        ? []
        : ["signature verification capability or authorized policy decision"],
      commands: [],
    },
    data: {
      terminalDisposition: transaction.terminalDisposition,
      commitOid: transaction.commit.commitOid,
      verification,
      displayText:
        `Verification for ${transaction.commit.commitOid}: ${effective.status}` +
        `${effective.reason ? ` (${effective.reason})` : ""}\n`,
    },
  });
}

function parseArguments(argv, command) {
  const flags = parseCommandArguments(command, argv).values;
  const format = flags.get("format") ?? "json";
  if (!["json", "text"].includes(format))
    fail("INVALID_FORMAT", "--format must be json or text.");
  const transactionPath = flags.get("transaction");
  if (!transactionPath)
    fail("TRANSACTION_REQUIRED", "--transaction is required.");
  return {
    transactionPath,
    format,
    approvedSubject: flags.get("message") ?? null,
    acknowledgedFailedCheckIds: flags.get("acknowledge-failed-check") ?? [],
    retainReviewArtifacts: flags.get("retain-review-artifacts") === true,
    retainProcessLogs: flags.get("retain-process-logs") === true,
    verificationPolicyOverride: flags.get("verification") ?? null,
  };
}
export async function runCreateCommitCommand(
  argv,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  return executeCommand(argv, {
    parse: (arguments_) => parseArguments(arguments_, "workflow commit"),
    includeProcessDiagnostics: true,
    execute: (options) =>
      createCommitWorkflow({
        ...options,
        retainProcessLogs:
          options.format !== "text" || options.retainProcessLogs,
        diagnosticWriter: diagnosticWriterFor(options.format, stderr),
      }),
    failureState: observeTransactionFailure,
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
