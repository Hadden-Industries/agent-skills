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
  PreparationError,
  manifestEnvironment,
  routePreparedEvidence,
} from "./prepareWorkflow.js";

function fail(code, message, { exitCode = 2, details = {} } = {}) {
  throw new PreparationError(code, message, { exitCode, details });
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
    fail(
      "INVALID_TRANSACTION_ARTIFACT",
      `snapshot.json is invalid JSON: ${error.message}`,
    );
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
      { exitCode: 1 },
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
      { exitCode: 1 },
    );
  }

  const currentHeadAnchor = captureHeadAnchor(transaction.repositoryRoot);

  if (
    JSON.stringify(currentHeadAnchor) !== JSON.stringify(transaction.headAnchor)
  ) {
    fail("HEAD_DRIFT", "HEAD changed after snapshot creation.", {
      exitCode: 1,
    });
  }
}

function resultEnvelope(transaction) {
  return {
    schemaVersion: 1,
    status: transaction.status ?? "prepared",
    phase: transaction.phase,
    terminalDisposition: transaction.terminalDisposition,
    transaction: resolve(transaction.attemptDirectory, "transaction.json"),
    route: transaction.route,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
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
          }
        : {}),
  };
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
        { exitCode: 1 },
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
        { exitCode: 1 },
      );
    }
  }

  if (
    (snapshot.indexInstallationRequired || !snapshot.preparedIndexPath) &&
    !indexMatchesTree(transaction.repositoryRoot, snapshot.indexTreeOid)
  ) {
    fail("INDEX_DRIFT", "The real index changed after snapshot creation.", {
      exitCode: 1,
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

  if (new Set(["evidence-ready", "review-pending"]).has(transaction.phase)) {
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
      { exitCode: 1, details: { transaction: resolve(transactionPath) } },
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
        `Prepared index installation resume failed: ${error.message}`,
        {
          exitCode: 1,
          details: {
            transaction: resolve(transactionPath),
            phase: "allocated",
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
        { exitCode: 1 },
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
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];

    if (!new Set(["--transaction", "--format"]).has(token)) {
      fail("UNKNOWN_ARGUMENT", `Unknown workflow resume flag ${token}.`);
    }

    if (value === undefined || value.length === 0) {
      fail("INVALID_ARGUMENT", `${token} requires a non-empty value.`);
    }

    if (values.has(token)) {
      fail("DUPLICATE_ARGUMENT", `${token} may be supplied only once.`);
    }

    values.set(token, value);
  }

  if (!values.has("--transaction")) {
    fail("MISSING_TRANSACTION", "--transaction is required.");
  }

  const format = values.get("--format") ?? "json";

  if (!new Set(["json", "text"]).has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  return { transactionPath: values.get("--transaction"), format };
}

function errorEnvelope(error) {
  return {
    status: error.exitCode === 1 ? "stopped" : "invalid",
    phase: error.details.phase ?? null,
    terminalDisposition: null,
    transaction: error.details.transaction ?? null,
    route: null,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: error.details.recoveryRequired ?? false,
    code: error.code,
    message: error.message,
  };
}

function textResult(result) {
  return [
    `Status: ${result.status}`,
    ...(result.code
      ? [`Code: ${result.code}`, `Message: ${result.message}`]
      : []),
    ...(result.transaction ? [`Transaction: ${result.transaction}`] : []),
    "",
  ].join("\n");
}

export async function runResumePreparationCommand(
  argv,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  let format = "json";

  try {
    const options = parseResumeArguments(argv);
    format = options.format;
    const result = await resumePreparationWorkflow(options);
    stdout.write(
      format === "text" ? textResult(result) : `${JSON.stringify(result)}\n`,
    );
    return 0;
  } catch (caught) {
    const error =
      caught instanceof PreparationError
        ? caught
        : new PreparationError("RESUME_FAILED", caught.message);
    const result = errorEnvelope(error);

    stderr.write(`${error.code}: ${error.message}\n`);
    stdout.write(
      format === "text" ? textResult(result) : `${JSON.stringify(result)}\n`,
    );
    return error.exitCode;
  }
}
