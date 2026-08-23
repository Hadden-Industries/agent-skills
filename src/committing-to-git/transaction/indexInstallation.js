import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  readOnlyGitText,
  resolveHead,
  runReadOnlyGit,
  writeIndexTree,
} from "../git/gitRepository.js";
import { readTransaction } from "./transactionWorkspace.js";

const JOURNAL_FILE = "index-installation.json";
const MAXIMUM_JOURNAL_BYTES = 1024 * 1024;
const FULL_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ALLOWED_JOURNAL_STATUSES = new Set(["pending", "installed"]);

function samePath(left, right) {
  const leftPath = resolve(left);
  const rightPath = resolve(right);

  return process.platform === "win32"
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath;
}

function assertContainedPath(parent, candidate, label) {
  const relation = relative(parent, candidate);

  if (
    relation.length === 0 ||
    relation === ".." ||
    relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(relation)
  ) {
    throw new Error(`${label} must be contained by the transaction attempt.`);
  }
}

function statIdentity(stat) {
  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    mode: Number(stat.mode),
    modifiedTimeMilliseconds: Number(stat.mtimeMs),
    changeTimeMilliseconds: Number(stat.ctimeMs),
  };
}

function stableIdentityMatches(left, right) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.modifiedTimeMilliseconds === right.modifiedTimeMilliseconds &&
    left.changeTimeMilliseconds === right.changeTimeMilliseconds
  );
}

function openReadOnlyNoFollow(path) {
  return openSync(path, fsConstants.O_RDONLY + (fsConstants.O_NOFOLLOW ?? 0));
}

function readStableRegularFile(path, { allowAbsent = false } = {}) {
  let pathStat;

  try {
    pathStat = lstatSync(path);
  } catch (error) {
    if (allowAbsent && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw new Error(`Expected a non-symbolic regular file: ${path}`);
  }

  const descriptor = openReadOnlyNoFollow(path);

  try {
    const before = fstatSync(descriptor);

    if (!before.isFile()) {
      throw new Error(`Expected a regular file after opening: ${path}`);
    }

    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const finalPathStat = lstatSync(path);
    const beforeIdentity = statIdentity(before);
    const afterIdentity = statIdentity(after);
    const finalPathIdentity = statIdentity(finalPathStat);

    if (
      !stableIdentityMatches(beforeIdentity, afterIdentity) ||
      !stableIdentityMatches(afterIdentity, finalPathIdentity) ||
      Number(after.size) !== bytes.length
    ) {
      throw new Error(
        `File changed while its stable identity was read: ${path}`,
      );
    }

    return {
      bytes,
      identity: {
        state: "file",
        byteCount: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        fileIdentity: afterIdentity,
      },
    };
  } finally {
    closeSync(descriptor);
  }
}

function assertIndexIdentity(identity, label) {
  if (identity?.state === "absent" && Object.keys(identity).length === 1) {
    return;
  }

  if (
    identity?.state !== "file" ||
    !Number.isSafeInteger(identity.byteCount) ||
    identity.byteCount < 0 ||
    !/^[0-9a-f]{64}$/u.test(identity.sha256) ||
    identity.fileIdentity === null ||
    typeof identity.fileIdentity !== "object" ||
    Array.isArray(identity.fileIdentity)
  ) {
    throw new Error(`${label} is not a canonical index identity.`);
  }
}

function exactIdentityMatches(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function indexIdentitiesMatch(left, right) {
  assertIndexIdentity(left, "Left index identity");
  assertIndexIdentity(right, "Right index identity");

  if (left.state === "absent" || right.state === "absent") {
    return left.state === right.state;
  }

  return left.byteCount === right.byteCount && left.sha256 === right.sha256;
}

export function readIndexIdentity(indexPath) {
  const stableFile = readStableRegularFile(resolve(indexPath), {
    allowAbsent: true,
  });

  return stableFile?.identity ?? { state: "absent" };
}

function flushDirectory(path) {
  let descriptor;

  try {
    descriptor = openSync(path, fsConstants.O_RDONLY);
    fsyncSync(descriptor);
  } catch (error) {
    if (process.platform !== "win32") {
      throw error;
    }

    // Windows protects the per-user temporary root with ACLs but does not
    // consistently permit opening directories for fsync through Node.
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function writeNewJson(path, value) {
  const descriptor = openSync(
    path,
    fsConstants.O_WRONLY + fsConstants.O_CREAT + fsConstants.O_EXCL,
    0o600,
  );

  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }

  flushDirectory(dirname(path));
}

function replaceJson(path, value) {
  const temporaryPath = join(
    dirname(path),
    `.index-installation-${randomUUID()}.tmp`,
  );

  writeNewJson(temporaryPath, value);

  try {
    renameSync(temporaryPath, path);
    flushDirectory(dirname(path));
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function readJournal(path) {
  const stableFile = readStableRegularFile(path);

  if (stableFile.bytes.length > MAXIMUM_JOURNAL_BYTES) {
    throw new Error(
      `Index installation journal exceeds its byte limit: ${path}`,
    );
  }

  let journal;

  try {
    journal = JSON.parse(stableFile.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(
      `Index installation journal is not valid JSON: ${error.message}`,
      { cause: error },
    );
  }

  validateJournal(journal);
  return journal;
}

function validateJournal(journal) {
  const expectedKeys = [
    "schemaVersion",
    "status",
    "repositoryRoot",
    "transactionPath",
    "indexPath",
    "originalIndexIdentity",
    "preparedIndexIdentity",
    "preparedIndexPath",
    "preparedIndexTreeOid",
    "headAnchor",
  ];

  if (
    journal === null ||
    typeof journal !== "object" ||
    Array.isArray(journal) ||
    JSON.stringify(Object.keys(journal).sort()) !==
      JSON.stringify(expectedKeys.sort()) ||
    journal.schemaVersion !== 1 ||
    !ALLOWED_JOURNAL_STATUSES.has(journal.status) ||
    typeof journal.repositoryRoot !== "string" ||
    typeof journal.transactionPath !== "string" ||
    typeof journal.indexPath !== "string" ||
    typeof journal.preparedIndexPath !== "string" ||
    !FULL_OID_PATTERN.test(journal.preparedIndexTreeOid)
  ) {
    throw new Error("Index installation journal has an invalid shape.");
  }

  assertIndexIdentity(
    journal.originalIndexIdentity,
    "Journal original identity",
  );
  assertIndexIdentity(
    journal.preparedIndexIdentity,
    "Journal prepared identity",
  );

  if (
    journal.headAnchor === null ||
    typeof journal.headAnchor !== "object" ||
    Array.isArray(journal.headAnchor)
  ) {
    throw new Error("Index installation journal has an invalid head anchor.");
  }
}

function resolveRealIndexPath(root) {
  const gitPath = readOnlyGitText(root, "git-path", ["index"]).trim();

  return resolve(isAbsolute(gitPath) ? gitPath : join(root, gitPath));
}

export function captureHeadAnchor(root) {
  const symbolic = runReadOnlyGit(root, "symbolic-head", [], {
    allowFailure: true,
  });
  const headOid = resolveHead(root);

  if (symbolic.status === 0) {
    return {
      headKind: headOid === null ? "unborn" : "attached",
      targetRef: symbolic.stdout.toString("utf8").trim(),
      expectedParentOids: headOid === null ? [] : [headOid],
    };
  }

  if (headOid !== null) {
    return {
      headKind: "detached",
      targetRef: null,
      expectedParentOids: [headOid],
    };
  }

  throw new Error("HEAD is neither a symbolic unborn branch nor a commit.");
}

function validateInvocation({
  root,
  transactionPath,
  originalIndexIdentity,
  preparedIndexPath,
  preparedIndexIdentity,
}) {
  assertIndexIdentity(originalIndexIdentity, "Original index identity");
  assertIndexIdentity(preparedIndexIdentity, "Prepared index identity");

  const transaction = readTransaction(transactionPath);
  const canonicalRoot = realpathSync(root);

  if (!samePath(canonicalRoot, transaction.repositoryRoot)) {
    throw new Error(
      "Index installation root does not match the transaction repository.",
    );
  }

  const canonicalPreparedPath = resolve(preparedIndexPath);
  assertContainedPath(
    transaction.attemptDirectory,
    canonicalPreparedPath,
    "Prepared index path",
  );

  const preparedIndexTreeOid = writeIndexTree(canonicalRoot, {
    GIT_INDEX_FILE: canonicalPreparedPath,
  });
  const stablePrepared = readStableRegularFile(canonicalPreparedPath);

  if (!exactIdentityMatches(stablePrepared.identity, preparedIndexIdentity)) {
    throw new Error("Prepared index identity changed before installation.");
  }

  const canonicalTransactionPath = resolve(transactionPath);
  const journalPath = join(transaction.attemptDirectory, JOURNAL_FILE);
  const indexPath = resolveRealIndexPath(canonicalRoot);

  return {
    transaction,
    canonicalRoot,
    canonicalTransactionPath,
    canonicalPreparedPath,
    preparedIndexTreeOid,
    stablePrepared,
    journalPath,
    indexPath,
  };
}

function assertJournalMatchesInvocation(journal, invocation) {
  if (
    !samePath(journal.repositoryRoot, invocation.canonicalRoot) ||
    !samePath(journal.transactionPath, invocation.canonicalTransactionPath) ||
    !samePath(journal.indexPath, invocation.indexPath) ||
    !samePath(journal.preparedIndexPath, invocation.canonicalPreparedPath)
  ) {
    throw new Error(
      "Existing index installation journal belongs to another operation.",
    );
  }
}

function recoveryFromJournal(journal) {
  const currentIndexIdentity = readIndexIdentity(journal.indexPath);
  const matchesPrepared = indexIdentitiesMatch(
    currentIndexIdentity,
    journal.preparedIndexIdentity,
  );
  const matchesOriginal = indexIdentitiesMatch(
    currentIndexIdentity,
    journal.originalIndexIdentity,
  );

  let status;

  if (journal.status === "installed" && matchesPrepared) {
    status = "installed";
  } else if (matchesPrepared) {
    status = "matching-index-observed";
  } else if (journal.status === "pending" && matchesOriginal) {
    status = "not-installed";
  } else {
    status = "ambiguous";
  }

  return {
    status,
    resumeAllowed: status !== "ambiguous",
    recoveryRequired: journal.status === "pending",
    currentIndexIdentity,
    journalPath: join(dirname(journal.transactionPath), JOURNAL_FILE),
    preparedIndexTreeOid: journal.preparedIndexTreeOid,
    headAnchor: journal.headAnchor,
  };
}

export function recoverIndexInstallation({ root, transactionPath }) {
  const transaction = readTransaction(transactionPath);
  const canonicalRoot = realpathSync(root);

  if (!samePath(canonicalRoot, transaction.repositoryRoot)) {
    throw new Error("Recovery root does not match the transaction repository.");
  }

  const journalPath = join(transaction.attemptDirectory, JOURNAL_FILE);
  const journal = readJournal(journalPath);
  const indexPath = resolveRealIndexPath(canonicalRoot);

  if (
    !samePath(journal.repositoryRoot, canonicalRoot) ||
    !samePath(journal.transactionPath, resolve(transactionPath)) ||
    !samePath(journal.indexPath, indexPath) ||
    !samePath(dirname(journal.preparedIndexPath), transaction.attemptDirectory)
  ) {
    throw new Error("Index installation journal path bindings are invalid.");
  }

  return recoveryFromJournal(journal);
}

function performJournaledReplacement({
  journal,
  journalPath,
  preparedBytes,
  failureInjector,
}) {
  const lockPath = `${journal.indexPath}.lock`;
  let lockDescriptor;
  let lockOwned = false;

  try {
    lockDescriptor = openSync(
      lockPath,
      fsConstants.O_WRONLY + fsConstants.O_CREAT + fsConstants.O_EXCL,
      0o666,
    );
    lockOwned = true;
    writeFileSync(lockDescriptor, preparedBytes);
    fsyncSync(lockDescriptor);
    closeSync(lockDescriptor);
    lockDescriptor = undefined;

    const lockedIdentity = readIndexIdentity(journal.indexPath);
    const lockedHeadAnchor = captureHeadAnchor(journal.repositoryRoot);

    if (
      !indexIdentitiesMatch(lockedIdentity, journal.originalIndexIdentity) ||
      JSON.stringify(lockedHeadAnchor) !== JSON.stringify(journal.headAnchor)
    ) {
      throw new Error(
        "Repository state changed while the prepared index lock was held.",
      );
    }

    renameSync(lockPath, journal.indexPath);
    lockOwned = false;
    failureInjector("after-index-replacement");
    failureInjector("before-installed-state");

    const installedJournal = { ...journal, status: "installed" };
    replaceJson(journalPath, installedJournal);

    return {
      status: "installed",
      resumeAllowed: true,
      recoveryRequired: false,
      journalPath,
      preparedIndexTreeOid: journal.preparedIndexTreeOid,
      headAnchor: journal.headAnchor,
      installedIndexIdentity: readIndexIdentity(journal.indexPath),
    };
  } finally {
    if (lockDescriptor !== undefined) {
      closeSync(lockDescriptor);
    }

    if (lockOwned) {
      rmSync(lockPath, { force: true });
    }
  }
}

export function resumePreparedIndexInstallation({ root, transactionPath }) {
  const transaction = readTransaction(transactionPath);
  const canonicalRoot = realpathSync(root);

  if (!samePath(canonicalRoot, transaction.repositoryRoot)) {
    throw new Error("Resume root does not match the transaction repository.");
  }

  const journalPath = join(transaction.attemptDirectory, JOURNAL_FILE);
  const journal = readJournal(journalPath);
  const indexPath = resolveRealIndexPath(canonicalRoot);

  if (
    !samePath(journal.repositoryRoot, canonicalRoot) ||
    !samePath(journal.transactionPath, resolve(transactionPath)) ||
    !samePath(journal.indexPath, indexPath) ||
    !samePath(dirname(journal.preparedIndexPath), transaction.attemptDirectory)
  ) {
    throw new Error("Index installation journal path bindings are invalid.");
  }

  const recovery = recoveryFromJournal(journal);

  if (recovery.status === "ambiguous") {
    throw new Error("Ambiguous real-index state cannot be resumed.");
  }

  const currentHeadAnchor = captureHeadAnchor(canonicalRoot);

  if (
    JSON.stringify(currentHeadAnchor) !== JSON.stringify(journal.headAnchor)
  ) {
    throw new Error("HEAD changed before index installation resume.");
  }

  if (recovery.status === "installed") {
    return recovery;
  }

  if (recovery.status === "matching-index-observed") {
    replaceJson(journalPath, { ...journal, status: "installed" });
    return {
      ...recovery,
      status: "installed",
      recoveryRequired: false,
      installedIndexIdentity: recovery.currentIndexIdentity,
    };
  }

  if (existsSync(`${journal.indexPath}.lock`)) {
    throw new Error(
      `The repository index lock already exists: ${journal.indexPath}.lock`,
    );
  }

  const prepared = readStableRegularFile(journal.preparedIndexPath);

  if (!exactIdentityMatches(prepared.identity, journal.preparedIndexIdentity)) {
    throw new Error(
      "Prepared index identity changed before installation resume.",
    );
  }

  return performJournaledReplacement({
    journal,
    journalPath,
    preparedBytes: prepared.bytes,
    failureInjector: () => {},
  });
}

export function installPreparedIndex({
  root,
  transactionPath,
  originalIndexIdentity,
  preparedIndexPath,
  preparedIndexIdentity,
  failureInjector = () => {},
}) {
  if (typeof failureInjector !== "function") {
    throw new Error("failureInjector must be a function when supplied.");
  }

  const invocation = validateInvocation({
    root,
    transactionPath,
    originalIndexIdentity,
    preparedIndexPath,
    preparedIndexIdentity,
  });

  if (existsSync(invocation.journalPath)) {
    const journal = readJournal(invocation.journalPath);
    assertJournalMatchesInvocation(journal, invocation);
    return recoveryFromJournal(journal);
  }

  if (existsSync(`${invocation.indexPath}.lock`)) {
    throw new Error(
      `The repository index lock already exists: ${invocation.indexPath}.lock`,
    );
  }

  const currentIdentity = readIndexIdentity(invocation.indexPath);

  if (!exactIdentityMatches(currentIdentity, originalIndexIdentity)) {
    throw new Error("The real index changed before installation could begin.");
  }

  const headAnchor = captureHeadAnchor(invocation.canonicalRoot);
  const preparedIndexTreeOid = invocation.preparedIndexTreeOid;
  const journal = {
    schemaVersion: 1,
    status: "pending",
    repositoryRoot: invocation.canonicalRoot,
    transactionPath: invocation.canonicalTransactionPath,
    indexPath: invocation.indexPath,
    originalIndexIdentity,
    preparedIndexIdentity,
    preparedIndexPath: invocation.canonicalPreparedPath,
    preparedIndexTreeOid,
    headAnchor,
  };

  writeNewJson(invocation.journalPath, journal);
  failureInjector("after-pending-journal");
  failureInjector("before-lock-acquisition");

  return performJournaledReplacement({
    journal,
    journalPath: invocation.journalPath,
    preparedBytes: invocation.stablePrepared.bytes,
    failureInjector,
  });
}
