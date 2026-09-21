import { observeTransactionFailure } from "../transaction/transactionDiagnosticState.js";
import { createWorkflowResult } from "../diagnostics/diagnosticContract.js";
import { executeCommand } from "../cli/commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { parseCommandArguments } from "../cli/commandArguments.js";

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, unlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  activeGitOperations,
  indexMatchesTree,
  runReadOnlyGit,
} from "../git/gitRepository.js";
import {
  captureHeadAnchor,
  indexIdentitiesMatch,
  installPreparedIndex,
  readIndexIdentity,
  resumePreparedIndexInstallation,
} from "../transaction/indexInstallation.js";
import {
  MAXIMUM_TRANSACTION_PATH_BYTES,
  advanceTransaction,
  getEvidencePlanInputPath,
  readTransaction,
} from "../transaction/transactionWorkspace.js";
import {
  manifestEnvironment,
  routePreparedEvidence,
} from "./prepareWorkflow.js";
import { authoringProgress } from "./authoringProgress.js";

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertContainedExactPath(attemptDirectory, path, name) {
  const expected = resolve(attemptDirectory, name);
  const relation = relative(attemptDirectory, path);

  if (
    resolve(path) !== expected ||
    relation.length === 0 ||
    relation.startsWith("..")
  ) {
    fail(
      "INVALID_TRANSACTION_ARTIFACT",
      `${name} has an invalid recorded path.`,
    );
  }

  const stat = lstatSync(path);

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(
      "INVALID_TRANSACTION_ARTIFACT",
      `${name} was replaced or is not a file.`,
    );
  }
}

function validatePersistedSnapshot(transaction) {
  const snapshot = transaction.snapshot;

  if (
    snapshot === null ||
    typeof snapshot.path !== "string" ||
    !/^[0-9a-f]{64}$/u.test(snapshot.sha256) ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(snapshot.indexTreeOid) ||
    !Number.isSafeInteger(snapshot.changeUnitCount) ||
    snapshot.changeUnitCount < 1 ||
    typeof snapshot.indexInstallationRequired !== "boolean"
  ) {
    fail(
      "INVALID_TRANSACTION_ARTIFACT",
      "Transaction snapshot facts are invalid.",
    );
  }

  assertContainedExactPath(
    transaction.attemptDirectory,
    snapshot.path,
    "snapshot.json",
  );
  const bytes = readFileSync(snapshot.path);

  if (sha256(bytes) !== snapshot.sha256) {
    fail(
      "INVALID_TRANSACTION_ARTIFACT",
      "snapshot.json digest does not match.",
    );
  }

  let manifest;

  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("INVALID_TRANSACTION_ARTIFACT", "snapshot.json is invalid JSON.", {
      cause: error,
    });
  }

  if (
    manifest.indexTreeOid !== snapshot.indexTreeOid ||
    manifest.changeUnitCount !== snapshot.changeUnitCount ||
    manifest.workflowMode !== transaction.mode ||
    manifest.scopeKind !== transaction.scope?.kind
  ) {
    fail(
      "INVALID_TRANSACTION_ARTIFACT",
      "snapshot.json does not match the persisted transaction facts.",
    );
  }

  return manifest;
}

function assertRepositoryResumePreconditions(transaction) {
  const operations = activeGitOperations(transaction.repositoryRoot);

  if (operations.length > 0) {
    fail(
      "ACTIVE_GIT_OPERATION",
      `Preparation cannot resume during an active ${operations.join(", ")} operation.`,
      { disposition: "rejected" },
    );
  }

  const conflicts = runReadOnlyGit(
    transaction.repositoryRoot,
    "ls-files",
    ["-u", "-z"],
    {
      env: { GIT_OPTIONAL_LOCKS: "0" },
    },
  ).stdout;

  if (conflicts.length > 0) {
    fail(
      "UNRESOLVED_CONFLICTS",
      "Preparation cannot resume while unresolved conflicts remain.",
      { disposition: "rejected" },
    );
  }

  const currentHeadAnchor = captureHeadAnchor(transaction.repositoryRoot);

  if (
    JSON.stringify(currentHeadAnchor) !== JSON.stringify(transaction.headAnchor)
  ) {
    fail("HEAD_DRIFT", "HEAD changed after snapshot creation.", {
      disposition: "rejected",
    });
  }
}

function resultEnvelope(transaction) {
  return createWorkflowResult({
    disposition: "succeeded",
    status: transaction.status ?? "prepared",
    phase: transaction.phase,
    transaction: resolve(transaction.attemptDirectory, "transaction.json"),
    route: transaction.route,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    data: {
      terminalDisposition: transaction.terminalDisposition,
      mode: transaction.mode,
      scope: transaction.scope.summary,
      initialEvidencePlanSha256: transaction.initialEvidencePlan.sha256,
      headAnchor: transaction.headAnchor,
      indexTreeOid: transaction.snapshot.indexTreeOid,
      changeUnitCount: transaction.snapshot.changeUnitCount,
      evidencePlanSha256: transaction.initialEvidencePlan.sha256,
      ...(transaction.route === "concise"
        ? { capsule: transaction.inlineEvidence.capsule }
        : transaction.route === "extended"
          ? {
              extendedReason: transaction.review.extendedReason,
              reviewQueue: transaction.review.queue,
              ...authoringProgress(transaction),
            }
          : {}),
    },
  });
}

function assertSnapshotIndexState(transaction, manifest) {
  const snapshot = transaction.snapshot;

  if (snapshot.preparedIndexPath) {
    const preparedIdentity = readIndexIdentity(snapshot.preparedIndexPath);

    if (
      !indexIdentitiesMatch(preparedIdentity, snapshot.preparedIndexIdentity)
    ) {
      fail(
        "PREPARED_INDEX_DRIFT",
        "The transaction-local prepared index changed before resume.",
        { disposition: "rejected" },
      );
    }

    if (
      !indexMatchesTree(
        transaction.repositoryRoot,
        snapshot.indexTreeOid,
        manifestEnvironment(manifest),
      )
    ) {
      fail(
        "PREPARED_INDEX_DRIFT",
        "The transaction-local prepared index no longer matches the snapshot tree.",
        { disposition: "rejected" },
      );
    }
  }

  if (
    (snapshot.indexInstallationRequired || !snapshot.preparedIndexPath) &&
    !indexMatchesTree(transaction.repositoryRoot, snapshot.indexTreeOid)
  ) {
    fail("INDEX_DRIFT", "The real index changed after snapshot creation.", {
      disposition: "rejected",
    });
  }
}

function removeConsumedEvidencePlanInput(transactionPath) {
  const evidencePlanInputPath = getEvidencePlanInputPath(transactionPath);

  if (existsSync(evidencePlanInputPath)) {
    unlinkSync(evidencePlanInputPath);
  }
}

async function finishEvidenceRouting({
  transactionPath,
  transaction,
  manifest,
}) {
  const completed = await routePreparedEvidence({
    transactionPath,
    transaction,
    manifest,
    root: transaction.repositoryRoot,
  });

  removeConsumedEvidencePlanInput(transactionPath);

  return resultEnvelope(completed);
}

export async function resumePreparationWorkflow({ transactionPath }) {
  if (
    typeof transactionPath !== "string" ||
    transactionPath.length === 0 ||
    Buffer.byteLength(transactionPath, "utf8") > MAXIMUM_TRANSACTION_PATH_BYTES
  ) {
    fail(
      "INVALID_TRANSACTION_PATH",
      `Transaction path must be at most ${MAXIMUM_TRANSACTION_PATH_BYTES} UTF-8 bytes.`,
    );
  }

  let transaction = readTransaction(transactionPath);

  if (
    new Set(["evidence-ready", "review-pending", "authoring-pending"]).has(
      transaction.phase,
    )
  ) {
    validatePersistedSnapshot(transaction);
    removeConsumedEvidencePlanInput(transactionPath);
    return resultEnvelope(transaction);
  }

  if (transaction.phase === "snapshot-created") {
    const manifest = validatePersistedSnapshot(transaction);
    assertRepositoryResumePreconditions(transaction);
    assertSnapshotIndexState(transaction, manifest);
    return finishEvidenceRouting({ transactionPath, transaction, manifest });
  }

  if (transaction.phase !== "allocated") {
    fail(
      "RESUME_NOT_ALLOWED",
      `Preparation cannot resume from phase ${transaction.phase}.`,
      {
        disposition: "rejected",
        details: { transaction: resolve(transactionPath) },
      },
    );
  }

  const manifest = validatePersistedSnapshot(transaction);
  assertRepositoryResumePreconditions(transaction);
  const snapshot = transaction.snapshot;

  if (snapshot.indexInstallationRequired) {
    let installation;

    try {
      const journalPath = join(
        transaction.attemptDirectory,
        "index-installation.json",
      );

      if (existsSync(journalPath)) {
        installation = resumePreparedIndexInstallation({
          root: transaction.repositoryRoot,
          transactionPath,
        });
      } else {
        installation = installPreparedIndex({
          root: transaction.repositoryRoot,
          transactionPath,
          originalIndexIdentity: snapshot.originalIndexIdentity,
          preparedIndexPath: snapshot.preparedIndexPath,
          preparedIndexIdentity: snapshot.preparedIndexIdentity,
        });
      }
    } catch (error) {
      fail(
        "INDEX_INSTALLATION_INTERRUPTED",
        "Prepared index installation resume failed. Inspect the retained transaction before another installation.",
        {
          disposition: "rejected",
          cause: error,
          state: {
            transaction: resolve(transactionPath),
            phase: "allocated",
            commitState: "absent",
            publicationState: "not-requested",
            recoveryRequired: true,
          },
        },
      );
    }

    if (
      installation.status !== "installed" ||
      installation.preparedIndexTreeOid !== snapshot.indexTreeOid
    ) {
      fail(
        "INDEX_INSTALLATION_MISMATCH",
        "Resumed index installation does not match the persisted snapshot.",
        { disposition: "rejected" },
      );
    }
  }

  assertSnapshotIndexState(transaction, manifest);

  transaction = advanceTransaction(transactionPath, "allocated", {
    ...transaction,
    phase: "snapshot-created",
  });

  return finishEvidenceRouting({ transactionPath, transaction, manifest });
}

export function parseResumeArguments(argv) {
  const { values } = parseCommandArguments("workflow resume", argv);

  if (!values.has("transaction")) {
    fail("MISSING_TRANSACTION", "--transaction is required.");
  }

  const format = values.get("format") ?? "json";

  if (!new Set(["json", "text"]).has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  return { transactionPath: values.get("transaction"), format };
}

export async function runResumePreparationCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  return executeCommand(argv, {
    failureState: observeTransactionFailure,
    parse: parseResumeArguments,
    execute: resumePreparationWorkflow,
    stdout,
  });
}
