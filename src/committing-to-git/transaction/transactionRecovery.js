import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { runGit } from "../git/gitRepository.js";
import { recoverCanonicalMessageReplacement } from "../message/canonicalMessageState.js";
import { inspectCommitObject } from "../report/commitReport.js";
import {
  advanceTransaction,
  readTransaction,
  updateTransaction,
} from "./transactionWorkspace.js";

const FULL_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ATTEMPT_PATTERN =
  /^committing-to-git-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PRECOMMIT_PHASES = new Set([
  "allocated",
  "snapshot-created",
  "evidence-ready",
  "review-pending",
  "message-ready",
]);
const TERMINAL_PHASES = new Set([
  "reported",
  "published",
  "stopped",
  "abandoned",
  "superseded",
]);
const WINDOWS_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

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

function assertContained(parent, child, { allowSame = false } = {}) {
  const path = relative(parent, child);

  if (
    (!allowSame && path === "") ||
    path === ".." ||
    path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(path)
  ) {
    throw new Error(`Recovery target escapes its transaction: ${child}`);
  }
}

function validateAttemptDirectory(transaction) {
  const attempt = resolve(transaction.attemptDirectory);

  if (!ATTEMPT_PATTERN.test(basename(attempt))) {
    throw new Error(
      "Transaction attempt directory does not contain its UUID handle.",
    );
  }

  const stat = lstatSync(attempt);

  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    !samePath(realpathSync(attempt), attempt)
  ) {
    throw new Error("Transaction attempt directory was replaced.");
  }

  return attempt;
}

function observeRef(root, headAnchor) {
  const observationPoint =
    headAnchor.headKind === "detached" ? "HEAD" : headAnchor.targetRef;
  const result = runGit(["rev-parse", "--verify", observationPoint], {
    cwd: root,
    allowFailure: true,
    env: {
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_NO_LAZY_FETCH: "1",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });

  if (result.status !== 0) {
    return {
      observationPoint,
      oid: null,
      status: result.status,
    };
  }

  const oid = result.stdout.toString("utf8").trim();

  if (!FULL_OID_PATTERN.test(oid)) {
    throw new Error(
      "Git returned a non-full object ID while observing recovery.",
    );
  }

  return { observationPoint, oid, status: 0 };
}

function stableObservation(left, right) {
  return (
    left.observationPoint === right.observationPoint &&
    left.oid === right.oid &&
    left.status === right.status
  );
}

function baselineOid(headAnchor) {
  return headAnchor.expectedParentOids[0] ?? null;
}

function compareCandidate({ root, oid, commit, message }) {
  const object = inspectCommitObject(root, oid);
  const comparison = {
    parentMatches:
      JSON.stringify(object.parents) ===
      JSON.stringify(commit.headAnchor.expectedParentOids),
    treeMatches: object.treeOid === commit.expectedTreeOid,
    messageMatches: object.messageBytes.equals(message.bytes),
    signatureHeaderPresent: object.signed,
    actualParents: object.parents,
    actualTreeOid: object.treeOid,
    actualMessageSha256: sha256(object.messageBytes),
    signatureHeaders: object.signatureHeaders,
  };

  return {
    object,
    comparison,
    structurallyMatches:
      comparison.parentMatches &&
      comparison.treeMatches &&
      comparison.messageMatches,
  };
}

function processStartIdentity(pid) {
  if (process.platform === "win32") {
    return null;
  }

  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closingName = stat.lastIndexOf(") ");
    const fields = stat.slice(closingName + 2).split(" ");
    return fields[19] ?? null;
  } catch {
    return null;
  }
}

export function captureChildIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) {
    return null;
  }

  return { pid, startIdentity: processStartIdentity(pid) };
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "EPERM") {
      return true;
    }

    return false;
  }
}

function indexLockPath(root) {
  const result = runGit(
    ["rev-parse", "--path-format=absolute", "--git-path", "index.lock"],
    {
      cwd: root,
      allowFailure: true,
    },
  );

  return result.status === 0
    ? result.stdout.toString("utf8").trim()
    : join(root, ".git", "index.lock");
}

function assertConfirmedNoLiveChild(
  transaction,
  before,
  after,
  { processInspector, indexLockInspector },
) {
  if (!stableObservation(before, after)) {
    throw new Error(
      "The observed ref changed while confirming child termination.",
    );
  }

  const childIdentity = transaction.commit.childIdentity;

  if (childIdentity && processInspector.exists(childIdentity.pid)) {
    const currentIdentity = processInspector.startIdentity(childIdentity.pid);
    const reused =
      childIdentity.startIdentity !== null &&
      currentIdentity !== null &&
      currentIdentity !== childIdentity.startIdentity;

    throw new Error(
      reused
        ? "The recorded process ID has been reused; recovery remains conservative."
        : "The recorded Git/signing/hook child is still live.",
    );
  }

  if (indexLockInspector(transaction.repositoryRoot)) {
    throw new Error("An index lock contradicts the no-live-child assertion.");
  }
}

function resultEnvelope(transaction, status, exitCode, details = {}) {
  return {
    schemaVersion: 1,
    status,
    phase: transaction.phase,
    terminalDisposition: transaction.terminalDisposition,
    transaction: join(transaction.attemptDirectory, "transaction.json"),
    route: transaction.route,
    commitState:
      transaction.commit?.commitOid === null || transaction.commit === null
        ? "absent"
        : "created",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: exitCode === 4,
    exitCode,
    ...details,
  };
}

export function recoverCommitOutcome({
  transactionPath,
  resolution = null,
  witnessCompletedChild = false,
  refObserver = observeRef,
  processInspector = {
    exists: processExists,
    startIdentity: processStartIdentity,
  },
  indexLockInspector = (root) => existsSync(indexLockPath(root)),
  now = () => new Date().toISOString(),
}) {
  recoverCanonicalMessageReplacement(transactionPath);
  let transaction = readTransaction(transactionPath);

  if (transaction.phase !== "commit-pending" || transaction.commit === null) {
    throw new Error("Commit recovery requires one pending commit journal.");
  }

  const before = refObserver(
    transaction.repositoryRoot,
    transaction.commit.headAnchor,
  );
  const candidateOid = transaction.commit.commitOid ?? before.oid;
  let candidate = null;

  if (
    candidateOid !== null &&
    candidateOid !== baselineOid(transaction.commit.headAnchor)
  ) {
    try {
      candidate = compareCandidate({
        root: transaction.repositoryRoot,
        oid: candidateOid,
        commit: transaction.commit,
        message: recoverCanonicalMessageReplacement(transactionPath),
      });
    } catch {
      candidate = null;
    }
  }

  const after = refObserver(
    transaction.repositoryRoot,
    transaction.commit.headAnchor,
  );
  const observations = { before, after };

  if (!stableObservation(before, after)) {
    transaction = updateTransaction(transactionPath, "commit-pending", {
      ...transaction,
      commit: { ...transaction.commit, recoveryObservations: observations },
    });
    return resultEnvelope(transaction, "outcome-unknown", 4, {
      code: "COMMIT_REF_UNSTABLE",
      observations,
    });
  }

  const witnessedCreatedCommit =
    witnessCompletedChild &&
    transaction.commit.launchState === "completed" &&
    transaction.commit.completion?.exitCode === 0;

  if (
    candidate !== null &&
    (candidate.structurallyMatches || witnessedCreatedCommit) &&
    after.oid === candidateOid
  ) {
    const status = candidate.structurallyMatches
      ? "matching-commit-observed"
      : "created-commit-observed";
    transaction = updateTransaction(transactionPath, "commit-pending", {
      ...transaction,
      commit: {
        ...transaction.commit,
        status: "created",
        commitOid: candidateOid,
        comparison: candidate.comparison,
        observationProvenance: witnessCompletedChild
          ? "witnessed"
          : "recovered",
        recoveryObservations: observations,
      },
    });
    return resultEnvelope(transaction, status, 0, {
      commitOid: candidateOid,
      commit: {
        treeMatches: candidate.comparison.treeMatches,
        messageMatches: candidate.comparison.messageMatches,
        parentMatches: candidate.comparison.parentMatches,
        signatureHeaderPresent: candidate.comparison.signatureHeaderPresent,
      },
      gitCommitInvocations: 0,
    });
  }

  const atBaseline = after.oid === baselineOid(transaction.commit.headAnchor);
  const knownNonCreatingCompletion =
    transaction.commit.launchState === "completed" &&
    (transaction.commit.completion?.nonLaunchGuaranteed === true ||
      (Number.isInteger(transaction.commit.completion?.exitCode) &&
        transaction.commit.completion.exitCode !== 0));
  const durableNonLaunch = transaction.commit.launchState === "not-started";

  if (atBaseline && resolution === "confirmed-no-live-child") {
    assertConfirmedNoLiveChild(transaction, before, after, {
      processInspector,
      indexLockInspector,
    });
    updateTransaction(transactionPath, "commit-pending", {
      ...transaction,
      commit: {
        ...transaction.commit,
        recoveryResolution: {
          resolution,
          assertedAt: now(),
          observations,
        },
      },
    });
  } else if (resolution !== null) {
    throw new Error(
      "Recovery resolution is invalid or contradicts the observed ref.",
    );
  }

  if (
    atBaseline &&
    (durableNonLaunch ||
      knownNonCreatingCompletion ||
      resolution === "confirmed-no-live-child")
  ) {
    transaction = advanceTransaction(transactionPath, "commit-pending", {
      ...readTransaction(transactionPath),
      phase: "stopped",
      status: "stopped",
      terminalDisposition: "no-commit-stopped",
      commit: {
        ...readTransaction(transactionPath).commit,
        recoveryObservations: observations,
      },
    });
    return resultEnvelope(transaction, "stopped", 1, {
      code: "COMMIT_NOT_CREATED",
      observations,
    });
  }

  transaction = updateTransaction(transactionPath, "commit-pending", {
    ...readTransaction(transactionPath),
    commit: {
      ...readTransaction(transactionPath).commit,
      recoveryObservations: observations,
    },
  });
  return resultEnvelope(transaction, "outcome-unknown", 4, {
    code:
      candidate === null
        ? "COMMIT_OUTCOME_UNKNOWN"
        : "COMMIT_OUTCOME_AMBIGUOUS",
    observations,
  });
}

function validateTreeNoLinks(root, path = root) {
  const stat = lstatSync(path);

  if (stat.isSymbolicLink()) {
    throw new Error(`Cleanup refuses a link or reparse target: ${path}`);
  }

  if (!stat.isDirectory()) {
    return;
  }

  for (const name of readdirSync(path)) {
    const child = join(path, name);

    assertContained(root, child);
    validateTreeNoLinks(root, child);
  }
}

function cleanupIdentity(path) {
  const stat = lstatSync(path, { bigint: true });

  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    kind: stat.isDirectory() ? "directory" : "file",
  };
}

function sameCleanupIdentity(left, right) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.kind === right.kind
  );
}

function removeWithRetry(path, options, operation = rmSync) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      operation(path, options);
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !WINDOWS_RETRY_CODES.has(error.code) ||
        attempt === 4
      ) {
        throw error;
      }
    }
  }
}

function removeOwnedTarget(attempt, path, removeOperation) {
  assertContained(attempt, path);

  if (!existsSync(path)) {
    return false;
  }

  const before = cleanupIdentity(path);
  validateTreeNoLinks(path);
  const after = cleanupIdentity(path);

  if (!sameCleanupIdentity(before, after)) {
    throw new Error(`Cleanup target changed before deletion: ${path}`);
  }

  const directory = lstatSync(path).isDirectory();

  removeWithRetry(
    path,
    directory ? { recursive: true } : undefined,
    removeOperation,
  );
  return true;
}

export function compactTerminalTransaction({
  transactionPath,
  retainReviewArtifacts = false,
  retainProcessLogs = false,
  removeOperation = rmSync,
}) {
  const transaction = readTransaction(transactionPath);
  const attempt = validateAttemptDirectory(transaction);

  if (
    !TERMINAL_PHASES.has(transaction.phase) ||
    transaction.status === "outcome-unknown" ||
    transaction.phase === "publication-pending"
  ) {
    throw new Error("Cannot compact a pending or unknown transaction.");
  }

  const names = [
    "preparation-index",
    "temporary-index",
    "draft-objects",
    "message-input.txt",
    "content.json",
    "evidence-plan-input.json",
  ];

  if (!retainReviewArtifacts) {
    names.push("review", "inspection");
  }

  if (
    !retainProcessLogs &&
    transaction.commit?.completion?.exitCode === 0 &&
    transaction.commit?.comparison !== null
  ) {
    names.push("process-logs");
  }

  const completed = [];
  const failed = [];

  for (const name of names) {
    const path = join(attempt, name);

    try {
      if (removeOwnedTarget(attempt, path, removeOperation)) {
        completed.push(path);
      }
    } catch (error) {
      failed.push({
        path,
        code: error.code ?? "CLEANUP_FAILED",
        message: error.message,
      });
    }
  }

  return {
    schemaVersion: 1,
    status: failed.length === 0 ? "cleaned" : "warning",
    completed,
    failed,
  };
}

export function purgeTransaction({ transactionPath }) {
  let transaction = readTransaction(transactionPath);
  const attempt = validateAttemptDirectory(transaction);

  if (
    transaction.phase === "commit-pending" ||
    transaction.phase === "publication-pending" ||
    transaction.status === "outcome-unknown"
  ) {
    throw new Error("Cannot purge a pending or unknown mutation.");
  }

  if (PRECOMMIT_PHASES.has(transaction.phase)) {
    transaction = advanceTransaction(transactionPath, transaction.phase, {
      ...transaction,
      phase: "abandoned",
      status: "stopped",
      terminalDisposition: "abandoned",
    });
  } else if (!TERMINAL_PHASES.has(transaction.phase)) {
    throw new Error("Transaction is not safe to purge.");
  }

  const capsule = Buffer.from(`${JSON.stringify(transaction)}\n`, "utf8");
  const formerPath = attempt;

  const before = cleanupIdentity(attempt);
  validateTreeNoLinks(attempt);
  const after = cleanupIdentity(attempt);

  if (!sameCleanupIdentity(before, after)) {
    throw new Error("Transaction attempt changed before purge.");
  }

  removeWithRetry(attempt, { recursive: true });

  return {
    schemaVersion: 1,
    status: "purged",
    formerPath,
    finalCapsuleSha256: sha256(capsule),
    completed: [formerPath],
    failed: [],
  };
}
