import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { TextDecoder } from "node:util";

import {
  activeGitOperations,
  indexMatchesTree,
  readOnlyGitText,
  runReadOnlyGit,
  writeIndexTree,
} from "../git/gitRepository.js";
import {
  sha256Bytes,
  stableJsonBytes,
} from "../inspection/inlineEvidenceCapsule.js";
import { readReviewCatalog } from "../inspection/reviewCatalog.js";
import {
  readCanonicalMessage,
  readTransactionOwnedFile,
} from "../message/canonicalMessageState.js";
import {
  captureStagedSourceIdentity,
  preparePromotionIndex,
} from "../snapshot/commitSnapshot.js";
import {
  captureHeadAnchor,
  indexIdentitiesMatch,
  installPreparedIndex,
  readIndexIdentity,
  recoverIndexInstallation,
  resumePreparedIndexInstallation,
} from "../transaction/indexInstallation.js";
import {
  readTransaction,
  updateTransaction,
} from "../transaction/transactionWorkspace.js";
import {
  PreparationError,
  manifestEnvironment,
  preflightVerificationPolicy,
} from "./prepareWorkflow.js";

const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const FULL_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const PROMOTABLE_STATES = new Set([
  JSON.stringify(["evidence-ready", "prepared"]),
  JSON.stringify(["message-ready", "message-ready"]),
]);

export class PromotionError extends Error {
  constructor(code, message, { exitCode = 2, details = {} } = {}) {
    super(message);
    this.name = "PromotionError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function fail(code, message, options) {
  throw new PromotionError(code, message, options);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);

  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function realIndexPath(root) {
  const gitPath = readOnlyGitText(root, "git-path", ["index"]).trim();

  return resolve(isAbsolute(gitPath) ? gitPath : join(root, gitPath));
}

function readDraftManifest(transactionPath, transaction) {
  const input = readTransactionOwnedFile({
    transactionPath,
    artifactName: "snapshot.json",
    maximumBytes: 8 * 1024 * 1024,
    label: "Recorded snapshot",
    allowPathReplacement: false,
  });

  if (
    !samePath(input.path, transaction.snapshot?.path ?? "") ||
    sha256(input.bytes) !== transaction.snapshot?.sha256
  ) {
    fail(
      "SNAPSHOT_ARTIFACT_MISMATCH",
      "The draft snapshot no longer matches its transaction identity.",
    );
  }

  let manifest;

  try {
    manifest = JSON.parse(STRICT_UTF8_DECODER.decode(input.bytes));
  } catch (error) {
    fail(
      "SNAPSHOT_ARTIFACT_INVALID",
      `The draft snapshot is not canonical UTF-8 JSON: ${error.message}`,
    );
  }

  if (
    manifest?.schemaVersion !== 2 ||
    manifest.workflowMode !== "draft" ||
    manifest.sourceIndex !== "temporary" ||
    !FULL_OID_PATTERN.test(manifest.indexTreeOid ?? "") ||
    !samePath(manifest.repositoryRoot ?? "", transaction.repositoryRoot) ||
    manifest.scopeKind !== transaction.scope?.kind ||
    manifest.indexTreeOid !== transaction.snapshot.indexTreeOid ||
    manifest.changeUnitCount !== transaction.snapshot.changeUnitCount ||
    !samePath(
      manifest.indexFile ?? "",
      transaction.snapshot.preparedIndexPath,
    ) ||
    !samePath(
      manifest.temporaryObjectDirectory ?? "",
      transaction.snapshot.temporaryObjectDirectory,
    )
  ) {
    fail(
      "DRAFT_SNAPSHOT_INVALID",
      "The transaction and its draft snapshot do not describe one promotable scope and tree.",
    );
  }

  return manifest;
}

function portableIdentityMatches(portable, identity) {
  if (portable?.state === "absent") {
    return identity.state === "absent";
  }

  return (
    portable?.state === "file" &&
    identity.state === "file" &&
    portable.byteCount === identity.byteCount &&
    portable.sha256 === identity.sha256
  );
}

function recordedPaths(transaction) {
  const encoded = transaction.scope?.expandedPathBytesBase64;

  if (!Array.isArray(encoded)) {
    fail(
      "DRAFT_SCOPE_INVALID",
      "The draft transaction does not contain its normalized literal path scope.",
    );
  }

  try {
    return encoded.map((value) => {
      const bytes = Buffer.from(value, "base64");

      if (
        typeof value !== "string" ||
        bytes.length === 0 ||
        bytes.includes(0) ||
        bytes.toString("base64") !== value
      ) {
        throw new Error("non-canonical base64 path");
      }

      return bytes;
    });
  } catch (error) {
    fail(
      "DRAFT_SCOPE_INVALID",
      `The recorded literal path scope is invalid: ${error.message}`,
    );
  }
}

function stagedStatePresent(root) {
  return (
    runReadOnlyGit(root, "diff", [
      "--cached",
      "--name-only",
      "-z",
      "--no-renames",
      "--",
    ]).stdout.length > 0
  );
}

function assertDraftArtifacts(transaction, manifest) {
  let matches;

  try {
    matches =
      indexIdentitiesMatch(
        readIndexIdentity(transaction.snapshot.preparedIndexPath),
        transaction.snapshot.preparedIndexIdentity,
      ) &&
      indexMatchesTree(
        transaction.repositoryRoot,
        manifest.indexTreeOid,
        manifestEnvironment(manifest),
      );
  } catch {
    matches = false;
  }

  if (!matches) {
    fail(
      "DRAFT_SNAPSHOT_DRIFT",
      "The attempt-local draft index or object tree no longer matches the reviewed snapshot.",
      { exitCode: 1 },
    );
  }
}

function assertReviewedState(transactionPath, transaction) {
  const reviewedManifestSha256 = transaction.snapshot.sha256;

  if (transaction.route === "concise") {
    const inlineEvidence = transaction.inlineEvidence;

    if (
      inlineEvidence.manifestSha256 !== reviewedManifestSha256 ||
      inlineEvidence.evidencePlanSha256 !==
        transaction.initialEvidencePlan.sha256 ||
      inlineEvidence.capsuleSha256 !==
        sha256Bytes(stableJsonBytes(inlineEvidence.capsule))
    ) {
      fail(
        "PROMOTION_EVIDENCE_ARTIFACT_INVALID",
        "The concise evidence capsule no longer matches its recorded hashes.",
        {
          details: {
            recordedManifestSha256: inlineEvidence.manifestSha256,
            actualManifestSha256: reviewedManifestSha256,
            recordedEvidencePlanSha256: inlineEvidence.evidencePlanSha256,
            actualEvidencePlanSha256: transaction.initialEvidencePlan.sha256,
            recordedCapsuleSha256: inlineEvidence.capsuleSha256,
            actualCapsuleSha256: sha256Bytes(
              stableJsonBytes(inlineEvidence.capsule),
            ),
          },
        },
      );
    }
  } else {
    let catalog;

    try {
      catalog = readReviewCatalog(transaction.review.catalogPath);
    } catch (error) {
      fail(
        "PROMOTION_EVIDENCE_ARTIFACT_INVALID",
        `The extended review catalog cannot be reused: ${error.message}`,
      );
    }

    if (
      catalog.catalogSha256 !== transaction.review.catalogSha256 ||
      catalog.manifestSha256 !== reviewedManifestSha256
    ) {
      fail(
        "PROMOTION_EVIDENCE_ARTIFACT_INVALID",
        "The extended review catalog no longer matches the draft manifest.",
        {
          details: {
            recordedCatalogSha256: transaction.review.catalogSha256,
            actualCatalogSha256: catalog.catalogSha256,
            recordedManifestSha256: catalog.manifestSha256,
            actualManifestSha256: reviewedManifestSha256,
          },
        },
      );
    }
  }

  if (transaction.phase === "message-ready") {
    let message;

    try {
      message = readCanonicalMessage(transactionPath);
    } catch (error) {
      fail(
        "PROMOTION_MESSAGE_ARTIFACT_INVALID",
        `The canonical message cannot be reused: ${error.message}`,
      );
    }

    if (!sameValue(message.transactionState, transaction.message)) {
      fail(
        "PROMOTION_MESSAGE_ARTIFACT_INVALID",
        "The canonical message no longer matches its transaction hashes.",
      );
    }
  }
}

function assertRepositoryPreconditions(transaction, manifest) {
  const root = transaction.repositoryRoot;
  const currentHeadAnchor = captureHeadAnchor(root);

  if (!sameValue(currentHeadAnchor, transaction.headAnchor)) {
    fail(
      "PROMOTION_HEAD_DRIFT",
      "HEAD no longer matches the complete draft anchor.",
      {
        exitCode: 1,
        details: {
          expectedHeadAnchor: transaction.headAnchor,
          actualHeadAnchor: currentHeadAnchor,
        },
      },
    );
  }

  const conflicts = runReadOnlyGit(root, "ls-files", ["-u", "-z"]).stdout;

  if (conflicts.length > 0) {
    fail(
      "PROMOTION_UNRESOLVED_CONFLICTS",
      "Draft promotion is blocked while unresolved conflicts remain.",
      { exitCode: 1 },
    );
  }

  const operations = activeGitOperations(root);

  if (operations.length > 0) {
    fail(
      "PROMOTION_ACTIVE_GIT_OPERATION",
      `Draft promotion is blocked during an active ${operations.join(", ")} operation.`,
      { exitCode: 1, details: { activeOperations: operations } },
    );
  }

  const currentIndexIdentity = readIndexIdentity(realIndexPath(root));
  const stagedSourceIdentity =
    manifest.scopeKind === "staged" ? captureStagedSourceIdentity(root) : null;

  const installedPromotionIndexObserved =
    transaction.snapshot.promotion !== undefined &&
    transaction.snapshot.promotion !== null &&
    indexIdentitiesMatch(
      currentIndexIdentity,
      transaction.snapshot.promotion.preparedIndexIdentity,
    );

  if (
    manifest.scopeKind === "paths" &&
    stagedStatePresent(root) &&
    !installedPromotionIndexObserved
  ) {
    fail(
      "PROMOTION_BLOCKED_STAGED_STATE",
      "Path draft promotion requires the unrelated real staged state to be absent.",
      {
        exitCode: 1,
        details: {
          promotionBlocker: transaction.scope.promotionBlocker ?? null,
        },
      },
    );
  }

  if (
    manifest.scopeKind === "staged" &&
    !portableIdentityMatches(manifest.sourceIndexIdentity, stagedSourceIdentity)
  ) {
    fail(
      "PROMOTION_STAGED_SOURCE_DRIFT",
      "The real staged index no longer has the draft's recorded source digest.",
      {
        exitCode: 1,
        details: {
          expectedSourceIndexIdentity: manifest.sourceIndexIdentity,
          actualSourceIndexIdentity: stagedSourceIdentity,
        },
      },
    );
  }

  return { currentHeadAnchor, currentIndexIdentity };
}

function promotionObservation(recovery) {
  return {
    status: recovery.status,
    resumeAllowed: recovery.resumeAllowed,
    recoveryRequired: recovery.recoveryRequired,
    currentIndexIdentity: recovery.currentIndexIdentity,
    preparedIndexTreeOid: recovery.preparedIndexTreeOid,
    headAnchor: recovery.headAnchor,
  };
}

function promotionRecord({
  status,
  headAnchor,
  indexTreeOid,
  originalIndexIdentity,
  preparedIndexPath,
  preparedIndexIdentity,
  installedIndexIdentity = null,
  recoveryObservation = null,
}) {
  return {
    schemaVersion: 1,
    status,
    headAnchor,
    indexTreeOid,
    originalIndexIdentity,
    preparedIndexPath,
    preparedIndexIdentity,
    installedIndexIdentity,
    recoveryObservation,
  };
}

function updatePromotionRecord(
  transactionPath,
  transaction,
  { signaturePreflight = transaction.signaturePreflight, promotion },
) {
  return updateTransaction(transactionPath, transaction.phase, {
    ...transaction,
    signaturePreflight,
    snapshot: { ...transaction.snapshot, promotion },
  });
}

function finalizePromotion({
  transactionPath,
  signaturePreflight,
  installation,
}) {
  const current = readTransaction(transactionPath);
  const actualHeadAnchor = captureHeadAnchor(current.repositoryRoot);
  const actualTreeOid = writeIndexTree(current.repositoryRoot);

  if (
    actualTreeOid !== current.snapshot.indexTreeOid ||
    !sameValue(actualHeadAnchor, current.headAnchor) ||
    installation.preparedIndexTreeOid !== current.snapshot.indexTreeOid ||
    !sameValue(installation.headAnchor, current.headAnchor)
  ) {
    fail(
      "PROMOTION_INSTALLATION_DRIFT",
      "The installed real index does not match the draft tree and head anchor.",
      { exitCode: 1, details: { recoveryRequired: true } },
    );
  }

  const installedIndexIdentity = readIndexIdentity(
    realIndexPath(current.repositoryRoot),
  );
  const promotion = {
    ...current.snapshot.promotion,
    status: "installed",
    installedIndexIdentity,
  };

  return updateTransaction(transactionPath, current.phase, {
    ...current,
    mode: "actual",
    status: "promoted",
    signaturePreflight,
    snapshot: { ...current.snapshot, promotion },
  });
}

function successEnvelope(transaction) {
  return {
    schemaVersion: 1,
    status: "promoted",
    phase: transaction.phase,
    terminalDisposition: transaction.terminalDisposition,
    transaction: resolve(transaction.attemptDirectory, "transaction.json"),
    route: transaction.route,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    mode: transaction.mode,
    headAnchor: transaction.headAnchor,
    indexTreeOid: transaction.snapshot.indexTreeOid,
    changeUnitCount: transaction.snapshot.changeUnitCount,
    ...(transaction.route === "concise"
      ? { capsule: transaction.inlineEvidence.capsule }
      : {
          reviewCatalogSha256: transaction.review?.catalogSha256 ?? null,
          messageSha256: transaction.message?.sha256 ?? null,
        }),
  };
}

function assertPromotableTransaction(transaction) {
  if (
    transaction.mode !== "draft" ||
    !PROMOTABLE_STATES.has(
      JSON.stringify([transaction.phase, transaction.status]),
    )
  ) {
    fail(
      "PROMOTION_STATE_INVALID",
      "Only an active evidence-ready or message-ready draft can be promoted.",
      { exitCode: 1 },
    );
  }
}

function persistRecoveryObservation({
  transactionPath,
  transaction,
  recovery,
}) {
  const promotion = {
    ...transaction.snapshot.promotion,
    status: "recovery-observed",
    recoveryObservation: promotionObservation(recovery),
  };

  return updatePromotionRecord(transactionPath, transaction, { promotion });
}

export function recoverDraftPromotion({ transactionPath }) {
  const canonicalTransactionPath = resolve(transactionPath);
  const transaction = readTransaction(canonicalTransactionPath);
  assertPromotableTransaction(transaction);

  if (
    transaction.snapshot?.promotion === undefined ||
    transaction.snapshot.promotion === null
  ) {
    fail(
      "PROMOTION_RECOVERY_NOT_REQUIRED",
      "The draft transaction has no journaled promotion to recover.",
      { exitCode: 1 },
    );
  }

  const recovery = recoverIndexInstallation({
    root: transaction.repositoryRoot,
    transactionPath: canonicalTransactionPath,
  });
  persistRecoveryObservation({
    transactionPath: canonicalTransactionPath,
    transaction,
    recovery,
  });

  return {
    schemaVersion: 1,
    status: "recovery-observed",
    phase: transaction.phase,
    terminalDisposition: transaction.terminalDisposition,
    transaction: canonicalTransactionPath,
    route: transaction.route,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: recovery.status === "ambiguous",
    recoveryStatus: recovery.status,
    resumeAllowed: recovery.resumeAllowed,
    retryAllowed: recovery.resumeAllowed,
    exitCode: 1,
  };
}

function continuePreparedPromotion({
  transactionPath,
  transaction,
  manifest,
  signaturePreflight,
  indexFailureInjector,
}) {
  const promotion = transaction.snapshot.promotion;

  if (
    promotion.indexTreeOid !== manifest.indexTreeOid ||
    !sameValue(promotion.headAnchor, transaction.headAnchor) ||
    !samePath(
      promotion.preparedIndexPath ?? "",
      join(transaction.attemptDirectory, "promotion-index"),
    ) ||
    !indexIdentitiesMatch(
      readIndexIdentity(promotion.preparedIndexPath),
      promotion.preparedIndexIdentity,
    ) ||
    !indexMatchesTree(transaction.repositoryRoot, promotion.indexTreeOid, {
      GIT_INDEX_FILE: promotion.preparedIndexPath,
    })
  ) {
    fail(
      "PROMOTION_PREPARED_STATE_DRIFT",
      "The prepared promotion index no longer matches its recorded identity and tree.",
      { exitCode: 1, details: { recoveryRequired: true } },
    );
  }

  const journalExists = existsSync(
    join(transaction.attemptDirectory, "index-installation.json"),
  );

  if (journalExists && promotion.recoveryObservation === null) {
    const recovery = recoverIndexInstallation({
      root: transaction.repositoryRoot,
      transactionPath,
    });
    persistRecoveryObservation({ transactionPath, transaction, recovery });
    fail(
      "PROMOTION_RECOVERY_OBSERVED",
      "The interrupted index installation was observed without replay; retry promotion only from this recorded result.",
      {
        exitCode: 1,
        details: {
          recoveryRequired: recovery.status === "ambiguous",
          recoveryStatus: recovery.status,
          resumeAllowed: recovery.resumeAllowed,
          retryAllowed: recovery.resumeAllowed,
        },
      },
    );
  }

  let installation;

  if (promotion.recoveryObservation !== null) {
    const recovery = recoverIndexInstallation({
      root: transaction.repositoryRoot,
      transactionPath,
    });

    if (recovery.status === "ambiguous" || recovery.resumeAllowed !== true) {
      fail(
        "PROMOTION_INDEX_STATE_AMBIGUOUS",
        "The real index matches neither recorded side of the promotion installation.",
        { exitCode: 1, details: { recoveryRequired: true } },
      );
    }

    installation = resumePreparedIndexInstallation({
      root: transaction.repositoryRoot,
      transactionPath,
    });
  } else {
    try {
      installation = installPreparedIndex({
        root: transaction.repositoryRoot,
        transactionPath,
        originalIndexIdentity: promotion.originalIndexIdentity,
        preparedIndexPath: promotion.preparedIndexPath,
        preparedIndexIdentity: promotion.preparedIndexIdentity,
        ...(indexFailureInjector
          ? { failureInjector: indexFailureInjector }
          : {}),
      });
    } catch (error) {
      let recovery = null;

      try {
        recovery = recoverIndexInstallation({
          root: transaction.repositoryRoot,
          transactionPath,
        });
        persistRecoveryObservation({
          transactionPath,
          transaction: readTransaction(transactionPath),
          recovery,
        });
      } catch {
        // A failure before the durable journal leaves no installation to observe.
      }

      const interrupted = new PromotionError(
        "PROMOTION_INDEX_INSTALLATION_INTERRUPTED",
        `Draft promotion index installation did not finish: ${error.message}`,
        {
          exitCode: 1,
          details: {
            recoveryRequired: true,
            recoveryStatus: recovery?.status ?? "not-started",
            resumeAllowed: recovery?.resumeAllowed ?? false,
          },
        },
      );
      interrupted.cause = error;
      throw interrupted;
    }
  }

  if (installation.status !== "installed") {
    fail(
      "PROMOTION_INDEX_INSTALLATION_INCOMPLETE",
      "The journaled real-index installation is not complete.",
      { exitCode: 1, details: { recoveryRequired: true } },
    );
  }

  return finalizePromotion({
    transactionPath,
    signaturePreflight,
    installation,
  });
}

export function promoteDraftWorkflow({
  transactionPath,
  signaturePreflightInspector,
  indexFailureInjector,
}) {
  if (typeof transactionPath !== "string" || transactionPath.length === 0) {
    fail("TRANSACTION_REQUIRED", "A transaction path is required.");
  }

  const canonicalTransactionPath = resolve(transactionPath);
  let transaction = readTransaction(canonicalTransactionPath);
  assertPromotableTransaction(transaction);
  const manifest = readDraftManifest(canonicalTransactionPath, transaction);
  assertDraftArtifacts(transaction, manifest);
  assertReviewedState(canonicalTransactionPath, transaction);
  assertRepositoryPreconditions(transaction, manifest);

  let signaturePreflight;

  try {
    signaturePreflight = preflightVerificationPolicy({
      root: transaction.repositoryRoot,
      verificationPolicy: transaction.verificationPolicy,
      ...(signaturePreflightInspector ? { signaturePreflightInspector } : {}),
    });
  } catch (error) {
    if (error instanceof PreparationError) {
      throw new PromotionError(error.code, error.message, {
        exitCode: error.exitCode,
        details: error.details,
      });
    }

    throw error;
  }

  const checked = assertRepositoryPreconditions(transaction, manifest);

  if (transaction.snapshot.promotion) {
    const promoted = continuePreparedPromotion({
      transactionPath: canonicalTransactionPath,
      transaction,
      manifest,
      signaturePreflight,
      indexFailureInjector,
    });

    return successEnvelope(promoted);
  }

  if (manifest.scopeKind === "staged") {
    const actualTreeOid = writeIndexTree(transaction.repositoryRoot);

    if (actualTreeOid !== manifest.indexTreeOid) {
      fail(
        "PROMOTION_STAGED_SOURCE_DRIFT",
        "The real staged tree no longer equals the draft tree.",
        { exitCode: 1 },
      );
    }

    assertRepositoryPreconditions(transaction, manifest);
    const identity = readIndexIdentity(
      realIndexPath(transaction.repositoryRoot),
    );
    const installed = updateTransaction(
      canonicalTransactionPath,
      transaction.phase,
      {
        ...transaction,
        mode: "actual",
        status: "promoted",
        signaturePreflight,
        snapshot: {
          ...transaction.snapshot,
          promotion: promotionRecord({
            status: "installed",
            headAnchor: transaction.headAnchor,
            indexTreeOid: actualTreeOid,
            originalIndexIdentity: identity,
            preparedIndexPath: null,
            preparedIndexIdentity: identity,
            installedIndexIdentity: identity,
          }),
        },
      },
    );

    return successEnvelope(installed);
  }

  const preparedIndexPath = join(
    transaction.attemptDirectory,
    "promotion-index",
  );
  let prepared;

  try {
    prepared = preparePromotionIndex({
      root: transaction.repositoryRoot,
      scopeKind: manifest.scopeKind,
      scopePaths:
        manifest.scopeKind === "paths" ? recordedPaths(transaction) : [],
      headOid: manifest.headOid,
      preparedIndexPath,
    });
  } catch (error) {
    const drift = new PromotionError(
      "PROMOTION_TREE_DRIFT",
      `The current selected content cannot recreate the reviewed draft tree: ${error.message}`,
      { exitCode: 1 },
    );
    drift.cause = error;
    throw drift;
  }

  if (prepared.indexTreeOid !== manifest.indexTreeOid) {
    fail(
      "PROMOTION_TREE_DRIFT",
      "The current selected content no longer recreates the reviewed draft tree.",
      {
        exitCode: 1,
        details: {
          expectedTreeOid: manifest.indexTreeOid,
          actualTreeOid: prepared.indexTreeOid,
        },
      },
    );
  }

  const afterPreparation = assertRepositoryPreconditions(transaction, manifest);

  if (
    !indexIdentitiesMatch(
      checked.currentIndexIdentity,
      afterPreparation.currentIndexIdentity,
    )
  ) {
    fail(
      "PROMOTION_INDEX_DRIFT",
      "The real index changed while the promotion tree was prepared.",
      { exitCode: 1 },
    );
  }

  const pendingPromotion = promotionRecord({
    status: "prepared",
    headAnchor: transaction.headAnchor,
    indexTreeOid: prepared.indexTreeOid,
    originalIndexIdentity: afterPreparation.currentIndexIdentity,
    preparedIndexPath: prepared.preparedIndexPath,
    preparedIndexIdentity: prepared.preparedIndexIdentity,
  });
  transaction = updatePromotionRecord(canonicalTransactionPath, transaction, {
    signaturePreflight,
    promotion: pendingPromotion,
  });
  const promoted = continuePreparedPromotion({
    transactionPath: canonicalTransactionPath,
    transaction,
    manifest,
    signaturePreflight,
    indexFailureInjector,
  });

  return successEnvelope(promoted);
}

function parseArguments(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token?.startsWith("--")) {
      fail("INVALID_ARGUMENT", `Unexpected argument ${JSON.stringify(token)}.`);
    }

    const name = token.slice(2);

    if (!new Set(["transaction", "format"]).has(name)) {
      fail("UNKNOWN_ARGUMENT", `Unknown workflow promote flag --${name}.`);
    }

    if (values.has(name)) {
      fail("DUPLICATE_ARGUMENT", `--${name} may be supplied only once.`);
    }

    const value = argv[index + 1];

    if (value === undefined || value.startsWith("--")) {
      fail("INVALID_ARGUMENT", `--${name} requires a value.`);
    }

    values.set(name, value);
    index += 1;
  }

  const format = values.get("format") ?? "json";

  if (!new Set(["json", "text"]).has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  if (!values.get("transaction")) {
    fail("TRANSACTION_REQUIRED", "--transaction is required.");
  }

  return { transactionPath: values.get("transaction"), format };
}

function errorEnvelope(error, transactionPath = null) {
  let transaction = null;

  if (transactionPath !== null) {
    try {
      transaction = readTransaction(transactionPath);
    } catch {
      // Malformed input has no trustworthy transaction state to report.
    }
  }

  return {
    schemaVersion: 1,
    status:
      error.code === "SIGNATURE_TRUST_ACCESS_REQUIRED"
        ? "capability-required"
        : error.exitCode === 1
          ? "stopped"
          : "invalid",
    phase: error.details.phase ?? transaction?.phase ?? null,
    terminalDisposition:
      error.details.terminalDisposition ??
      transaction?.terminalDisposition ??
      null,
    transaction: error.details.transaction ?? transactionPath,
    route: transaction?.route ?? null,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: error.details.recoveryRequired ?? false,
    code: error.code,
    message: error.message,
    ...(transaction === null ? {} : { mode: transaction.mode }),
    ...Object.fromEntries(
      Object.entries(error.details).filter(
        ([key]) =>
          !new Set([
            "phase",
            "terminalDisposition",
            "transaction",
            "recoveryRequired",
          ]).has(key),
      ),
    ),
  };
}

function textResult(result) {
  const lines = [`Status: ${result.status}`];

  if (result.code) {
    lines.push(`Code: ${result.code}`, `Message: ${result.message}`);
  }

  if (result.transaction) {
    lines.push(`Transaction: ${result.transaction}`);
  }

  if (result.indexTreeOid) {
    lines.push(`Index tree: ${result.indexTreeOid}`);
  }

  return `${lines.join("\n")}\n`;
}

export function runPromoteDraftCommand(
  argv,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  let format = "json";
  let transactionPath = null;

  try {
    const options = parseArguments(argv);
    format = options.format;
    transactionPath = resolve(options.transactionPath);
    const result = promoteDraftWorkflow({ transactionPath });

    stdout.write(
      format === "text" ? textResult(result) : `${JSON.stringify(result)}\n`,
    );
    return 0;
  } catch (caught) {
    const error =
      caught instanceof PromotionError
        ? caught
        : new PromotionError("PROMOTION_FAILED", caught.message);
    const result = errorEnvelope(error, transactionPath);

    stderr.write(`${error.code}: ${error.message}\n`);
    stdout.write(
      format === "text" ? textResult(result) : `${JSON.stringify(result)}\n`,
    );
    return error.exitCode;
  }
}
