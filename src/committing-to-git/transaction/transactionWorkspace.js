import { randomUUID as systemRandomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

export const MAXIMUM_TRANSACTION_PATH_BYTES = 2 * 1024;
export const MAXIMUM_INITIAL_JSON_INPUT_BYTES = 8 * 1024 * 1024;
export const MAXIMUM_BASIS_NOTE_BYTES = 512;

const TRANSACTION_FILE = "transaction.json";
const MAXIMUM_ALLOCATION_ATTEMPTS = 16;
const MAXIMUM_WINDOWS_RENAME_ATTEMPTS = 4;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FULL_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const TYPE_TOKEN_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;
const WINDOWS_RENAME_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const EXTENDED_REASONS = new Set([
  "review-policy",
  "required-evidence-over-budget",
  "scope-synopsis-over-budget",
  "invalid-evidence-encoding",
  "required-object-unavailable",
  "unresolved-anomaly",
  "evidence-uncertainty",
  "semantic-structure-required",
]);

const PHASES = new Set([
  "allocated",
  "snapshot-created",
  "evidence-ready",
  "review-pending",
  "message-ready",
  "commit-pending",
  "reported",
  "publication-pending",
  "published",
  "stopped",
  "abandoned",
  "superseded",
]);
const STATUSES = new Set([
  "prepared",
  "review-pending",
  "message-ready",
  "evidence-required",
  "promoted",
  "reported",
  "published",
  "commit-blocked",
  "outcome-unknown",
  "recovered",
  "cleaned",
  "stopped",
  "invalid",
]);
const TERMINAL_DISPOSITIONS = new Set([
  "no-commit-stopped",
  "local-commit-recorded",
  "published",
  "abandoned",
  "superseded",
]);
const REQUIRED_TRANSACTION_KEYS = [
  "schemaVersion",
  "phase",
  "repositoryRoot",
  "attemptDirectory",
  "mode",
  "status",
  "terminalDisposition",
  "scope",
  "headAnchor",
  "repositoryTypePolicy",
  "initialEvidencePlan",
  "route",
  "verificationPolicy",
  "signaturePreflight",
  "snapshot",
  "inlineEvidence",
  "review",
  "message",
  "commit",
  "verification",
  "report",
  "publicationAttempts",
];
const STATE_COMBINATIONS = new Set(
  [
    ["allocated", null, null],
    ["snapshot-created", null, null],
    ["evidence-ready", "prepared", null],
    ["evidence-ready", "promoted", null],
    ["review-pending", "review-pending", null],
    ["review-pending", "evidence-required", null],
    ["message-ready", "message-ready", null],
    ["message-ready", "promoted", null],
    ["commit-pending", "outcome-unknown", null],
    ["reported", "reported", "local-commit-recorded"],
    ["reported", "commit-blocked", "local-commit-recorded"],
    ["reported", "recovered", "local-commit-recorded"],
    ["publication-pending", "outcome-unknown", null],
    ["published", "published", "published"],
    ["published", "recovered", "published"],
    ["stopped", "stopped", "no-commit-stopped"],
    ["stopped", "invalid", "no-commit-stopped"],
    ["stopped", "cleaned", "no-commit-stopped"],
    ["stopped", "recovered", "no-commit-stopped"],
    ["abandoned", "stopped", "abandoned"],
    ["abandoned", "cleaned", "abandoned"],
    ["superseded", "stopped", "superseded"],
    ["superseded", "cleaned", "superseded"],
  ].map((combination) => JSON.stringify(combination)),
);
const PHASE_TRANSITIONS = new Map([
  [
    "allocated",
    new Set(["snapshot-created", "stopped", "abandoned", "superseded"]),
  ],
  [
    "snapshot-created",
    new Set([
      "evidence-ready",
      "review-pending",
      "stopped",
      "abandoned",
      "superseded",
    ]),
  ],
  [
    "evidence-ready",
    new Set([
      "review-pending",
      "message-ready",
      "commit-pending",
      "stopped",
      "abandoned",
      "superseded",
    ]),
  ],
  [
    "review-pending",
    new Set(["message-ready", "stopped", "abandoned", "superseded"]),
  ],
  [
    "message-ready",
    new Set(["commit-pending", "stopped", "abandoned", "superseded"]),
  ],
  ["commit-pending", new Set(["reported", "stopped"])],
  ["reported", new Set(["publication-pending", "published"])],
  ["publication-pending", new Set(["reported", "published"])],
  ["published", new Set()],
  ["stopped", new Set()],
  ["abandoned", new Set()],
  ["superseded", new Set()],
]);
const TERMINAL_PHASES = new Set([
  "reported",
  "published",
  "stopped",
  "abandoned",
  "superseded",
]);

function transactionStateKey(transaction) {
  return JSON.stringify([
    transaction.phase,
    transaction.status,
    transaction.terminalDisposition,
  ]);
}

function assertExactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();

  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} contains missing or unknown members.`);
  }
}

function validateHeadAnchor(headAnchor) {
  if (headAnchor === null) {
    return;
  }

  assertExactKeys(
    headAnchor,
    ["headKind", "targetRef", "expectedParentOids"],
    "Head anchor",
  );

  if (!new Set(["unborn", "attached", "detached"]).has(headAnchor.headKind)) {
    throw new Error(
      `Unknown head anchor kind ${JSON.stringify(headAnchor.headKind)}.`,
    );
  }

  if (
    !Array.isArray(headAnchor.expectedParentOids) ||
    headAnchor.expectedParentOids.some(
      (oid) => typeof oid !== "string" || !FULL_OID_PATTERN.test(oid),
    )
  ) {
    throw new Error("Head anchor parent IDs must be full opaque object IDs.");
  }

  if (headAnchor.headKind === "unborn") {
    if (
      typeof headAnchor.targetRef !== "string" ||
      !headAnchor.targetRef.startsWith("refs/heads/") ||
      headAnchor.expectedParentOids.length !== 0
    ) {
      throw new Error(
        "An unborn head anchor requires a full branch ref and no parents.",
      );
    }

    return;
  }

  if (headAnchor.expectedParentOids.length !== 1) {
    throw new Error(`${headAnchor.headKind} head anchor requires one parent.`);
  }

  if (headAnchor.headKind === "attached") {
    if (
      typeof headAnchor.targetRef !== "string" ||
      !headAnchor.targetRef.startsWith("refs/heads/")
    ) {
      throw new Error("An attached head anchor requires a full branch ref.");
    }

    return;
  }

  if (headAnchor.targetRef !== null) {
    throw new Error("A detached head anchor requires a null target ref.");
  }
}

function validateRepositoryTypePolicy(policy) {
  assertExactKeys(policy, ["allowedTypes"], "Repository type policy");

  if (policy.allowedTypes === null) {
    return;
  }

  if (
    !Array.isArray(policy.allowedTypes) ||
    policy.allowedTypes.length > 64 ||
    new Set(policy.allowedTypes).size !== policy.allowedTypes.length ||
    policy.allowedTypes.some(
      (type) => typeof type !== "string" || !TYPE_TOKEN_PATTERN.test(type),
    )
  ) {
    throw new Error(
      "Repository allowed types must be unique lowercase tokens.",
    );
  }
}

function validateInlineEvidence(inlineEvidence) {
  if (inlineEvidence === null) {
    return;
  }

  assertExactKeys(
    inlineEvidence,
    ["capsuleSha256", "manifestSha256", "evidencePlanSha256", "capsule"],
    "Inline evidence",
  );

  for (const field of [
    "capsuleSha256",
    "manifestSha256",
    "evidencePlanSha256",
  ]) {
    if (!SHA256_PATTERN.test(inlineEvidence[field])) {
      throw new Error(`Inline evidence ${field} must be a SHA-256 digest.`);
    }
  }

  if (
    inlineEvidence.capsule === null ||
    typeof inlineEvidence.capsule !== "object" ||
    Array.isArray(inlineEvidence.capsule)
  ) {
    throw new Error("Inline evidence capsule must be an object.");
  }
}

function validateReviewState(review) {
  if (review === null) {
    return;
  }

  const required = [
    "catalogPath",
    "catalogSha256",
    "evidencePlanPath",
    "evidencePlanSha256",
    "extendedReason",
    "queue",
    "receipt",
    "semanticStructureRequired",
  ];
  const optional =
    review.coveredCapsuleSha256 === undefined ? [] : ["coveredCapsuleSha256"];

  assertExactKeys(review, [...required, ...optional], "Review state");

  if (
    typeof review.catalogPath !== "string" ||
    review.catalogPath.length === 0 ||
    typeof review.evidencePlanPath !== "string" ||
    review.evidencePlanPath.length === 0 ||
    !SHA256_PATTERN.test(review.catalogSha256) ||
    !SHA256_PATTERN.test(review.evidencePlanSha256) ||
    (review.coveredCapsuleSha256 !== undefined &&
      !SHA256_PATTERN.test(review.coveredCapsuleSha256)) ||
    !EXTENDED_REASONS.has(review.extendedReason) ||
    typeof review.semanticStructureRequired !== "boolean"
  ) {
    throw new Error(
      "Review state contains invalid identities or routing facts.",
    );
  }

  for (const field of ["queue", "receipt"]) {
    if (
      review[field] !== null &&
      (typeof review[field] !== "object" || Array.isArray(review[field]))
    ) {
      throw new Error(`Review state ${field} must be an object or null.`);
    }
  }
}

export function validateTransaction(transaction) {
  assertExactKeys(transaction, REQUIRED_TRANSACTION_KEYS, "Transaction");

  if (transaction.schemaVersion !== 1) {
    throw new Error("Transaction schemaVersion must be 1.");
  }

  if (!PHASES.has(transaction.phase)) {
    throw new Error(
      `Unknown transaction phase ${JSON.stringify(transaction.phase)}.`,
    );
  }

  if (!isAbsolute(transaction.repositoryRoot)) {
    throw new Error("Transaction repositoryRoot must be absolute.");
  }

  if (!isAbsolute(transaction.attemptDirectory)) {
    throw new Error("Transaction attemptDirectory must be absolute.");
  }

  if (!new Set([null, "actual", "draft"]).has(transaction.mode)) {
    throw new Error(
      `Unknown transaction mode ${JSON.stringify(transaction.mode)}.`,
    );
  }

  if (transaction.status !== null && !STATUSES.has(transaction.status)) {
    throw new Error(
      `Unknown transaction status ${JSON.stringify(transaction.status)}.`,
    );
  }

  if (
    transaction.terminalDisposition !== null &&
    !TERMINAL_DISPOSITIONS.has(transaction.terminalDisposition)
  ) {
    throw new Error(
      `Unknown terminal disposition ${JSON.stringify(transaction.terminalDisposition)}.`,
    );
  }

  if (!STATE_COMBINATIONS.has(transactionStateKey(transaction))) {
    throw new Error(
      "Transaction phase, status, and terminal disposition form an impossible combination.",
    );
  }

  if (!new Set([null, "concise", "extended"]).has(transaction.route)) {
    throw new Error(
      `Unknown transaction route ${JSON.stringify(transaction.route)}.`,
    );
  }

  if (
    !new Set(["required", "advisory", "skipped"]).has(
      transaction.verificationPolicy,
    )
  ) {
    throw new Error("Transaction verification policy is invalid.");
  }

  validateRepositoryTypePolicy(transaction.repositoryTypePolicy);
  validateHeadAnchor(transaction.headAnchor);
  validateInlineEvidence(transaction.inlineEvidence);
  validateReviewState(transaction.review);

  if (
    transaction.phase === "evidence-ready" &&
    (transaction.route !== "concise" ||
      transaction.inlineEvidence === null ||
      transaction.review !== null)
  ) {
    throw new Error(
      "An evidence-ready transaction requires concise inline evidence only.",
    );
  }

  if (
    transaction.phase === "review-pending" &&
    (transaction.route !== "extended" ||
      transaction.inlineEvidence !== null ||
      transaction.review === null)
  ) {
    throw new Error(
      "A review-pending transaction requires extended review state only.",
    );
  }

  if (!Array.isArray(transaction.publicationAttempts)) {
    throw new Error("Transaction publicationAttempts must be an array.");
  }

  for (const field of [
    "scope",
    "initialEvidencePlan",
    "signaturePreflight",
    "snapshot",
    "inlineEvidence",
    "review",
    "message",
    "commit",
    "verification",
    "report",
  ]) {
    const value = transaction[field];

    if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
      throw new Error(`Transaction ${field} must be an object or null.`);
    }
  }

  return transaction;
}

function initialTransaction(repositoryRoot, attemptDirectory) {
  return {
    schemaVersion: 1,
    phase: "allocated",
    repositoryRoot,
    attemptDirectory,
    mode: null,
    status: null,
    terminalDisposition: null,
    scope: null,
    headAnchor: null,
    repositoryTypePolicy: { allowedTypes: null },
    initialEvidencePlan: null,
    route: null,
    verificationPolicy: "required",
    signaturePreflight: null,
    snapshot: null,
    inlineEvidence: null,
    review: null,
    message: null,
    commit: null,
    verification: null,
    report: null,
    publicationAttempts: [],
  };
}

function openReadOnlyNoFollow(path) {
  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW;

  return openSync(path, fsConstants.O_RDONLY + noFollow);
}

function fileIdentity(stat) {
  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    byteCount: Number(stat.size),
  };
}

function identitiesMatch(left, right) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.byteCount === right.byteCount
  );
}

function readStableRegularFile(path) {
  const fd = openReadOnlyNoFollow(path);

  try {
    const before = fstatSync(fd, { bigint: true });

    if (!before.isFile()) {
      throw new Error(`Expected a regular file at ${path}.`);
    }

    const payload = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    const pathStat = lstatSync(path, { bigint: true });

    if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
      throw new Error(
        `Transaction path was replaced or is not a regular file: ${path}`,
      );
    }

    if (
      !identitiesMatch(fileIdentity(before), fileIdentity(after)) ||
      !identitiesMatch(fileIdentity(after), fileIdentity(pathStat))
    ) {
      throw new Error(
        `Transaction path changed while it was being read: ${path}`,
      );
    }

    return payload;
  } finally {
    closeSync(fd);
  }
}

function flushDirectory(path) {
  // Windows does not expose a portable directory-fsync contract. Stable
  // non-following file/path identity checks and the protected user temp root
  // provide the available boundary there; POSIX gets the stronger flush.
  if (process.platform === "win32") {
    return;
  }

  const fd = openSync(path, fsConstants.O_RDONLY);

  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeNewFile(path, payload) {
  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW;
  const fd = openSync(
    path,
    fsConstants.O_WRONLY + fsConstants.O_CREAT + fsConstants.O_EXCL + noFollow,
    0o600,
  );

  try {
    writeFileSync(fd, payload);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  flushDirectory(dirname(path));
}

function writeNewJson(path, value) {
  writeNewFile(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

function replaceJsonAtomically(path, value) {
  const directory = dirname(path);
  const candidatePath = join(
    directory,
    `.transaction-${systemRandomUUID()}.tmp`,
  );

  writeNewJson(candidatePath, value);

  let attempt = 0;

  while (true) {
    attempt += 1;

    try {
      renameSync(candidatePath, path);
      flushDirectory(directory);
      return;
    } catch (error) {
      const retryable =
        process.platform === "win32" &&
        WINDOWS_RENAME_RETRY_CODES.has(error.code) &&
        attempt < MAXIMUM_WINDOWS_RENAME_ATTEMPTS;

      if (!retryable) {
        // The current transaction remains authoritative. The contained
        // candidate is deliberately retained for exact-path recovery.
        throw error;
      }
    }
  }
}

function ensureDirectory(path, label) {
  const stat = lstatSync(path);

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} was replaced or is not a directory: ${path}`);
  }

  if (realpathSync(path) !== path) {
    throw new Error(`${label} does not resolve to its recorded path: ${path}`);
  }
}

function validateRepositoryPath(repositoryRoot) {
  ensureDirectory(repositoryRoot, "Recorded repository root");

  if (!existsSync(join(repositoryRoot, ".git"))) {
    throw new Error(
      `Recorded repository root is no longer a Git working tree: ${repositoryRoot}`,
    );
  }
}

function assertOwnedPath(attemptDirectory, path) {
  const pathRelative = relative(attemptDirectory, path);

  if (
    pathRelative === "" ||
    pathRelative === ".." ||
    pathRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(pathRelative)
  ) {
    throw new Error(
      `Derived transaction artifact escapes its attempt: ${path}`,
    );
  }
}

export function allocateAttemptDirectory({
  temporaryRoot,
  randomUuid = systemRandomUUID,
  createDirectory = mkdirSync,
  maximumAttempts = MAXIMUM_ALLOCATION_ATTEMPTS,
}) {
  const absoluteTemporaryRoot = resolve(temporaryRoot);

  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new Error("maximumAttempts must be a positive integer.");
  }

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const uuid = randomUuid();

    if (typeof uuid !== "string" || !UUID_V4_PATTERN.test(uuid)) {
      throw new Error("Transaction allocation requires a genuine UUIDv4.");
    }

    const attemptDirectory = join(
      absoluteTemporaryRoot,
      `committing-to-git-${uuid}`,
    );
    const transactionPath = join(attemptDirectory, TRANSACTION_FILE);

    if (
      Buffer.byteLength(transactionPath, "utf8") >
      MAXIMUM_TRANSACTION_PATH_BYTES
    ) {
      throw new Error(
        "The absolute transaction.json handle exceeds 2,048 UTF-8 bytes.",
      );
    }

    try {
      // Deliberately omit `recursive`: this is one exclusive creation of the
      // UUID directory, with no precheck or parent/discovery machinery.
      createDirectory(attemptDirectory, { mode: 0o700 });
      return { attemptDirectory, transactionPath };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }

  throw new Error(
    `Unable to allocate a transaction workspace after ${maximumAttempts} collision attempts.`,
  );
}

export function createTransactionWorkspace({
  repositoryRoot,
  temporaryRoot = tmpdir(),
}) {
  const normalizedRepositoryRoot = realpathSync(resolve(repositoryRoot));
  const normalizedTemporaryRoot = realpathSync(resolve(temporaryRoot));

  validateRepositoryPath(normalizedRepositoryRoot);
  ensureDirectory(normalizedTemporaryRoot, "Temporary root");

  const { attemptDirectory, transactionPath } = allocateAttemptDirectory({
    temporaryRoot: normalizedTemporaryRoot,
  });

  // On POSIX the requested modes are enforceable. On Windows they do not
  // establish an ACL guarantee; the attempt instead inherits the protected
  // user temporary directory and every later read rejects reparse changes.
  ensureDirectory(attemptDirectory, "Transaction attempt directory");
  const transaction = initialTransaction(
    normalizedRepositoryRoot,
    attemptDirectory,
  );

  validateTransaction(transaction);
  writeNewJson(transactionPath, transaction);

  return { attemptDirectory, transactionPath, transaction };
}

export function readTransaction(transactionPath) {
  const absoluteTransactionPath = resolve(transactionPath);

  if (basename(absoluteTransactionPath) !== TRANSACTION_FILE) {
    throw new Error("Transaction handle must name transaction.json.");
  }

  if (
    Buffer.byteLength(absoluteTransactionPath, "utf8") >
    MAXIMUM_TRANSACTION_PATH_BYTES
  ) {
    throw new Error("Transaction handle exceeds 2,048 UTF-8 bytes.");
  }

  const payload = readStableRegularFile(absoluteTransactionPath);
  let transaction;

  try {
    transaction = JSON.parse(payload.toString("utf8"));
  } catch (error) {
    throw new Error(`Transaction JSON is invalid: ${error.message}`, {
      cause: error,
    });
  }

  validateTransaction(transaction);

  if (
    resolve(transaction.attemptDirectory) !== dirname(absoluteTransactionPath)
  ) {
    throw new Error(
      "Recorded attempt directory does not contain the supplied transaction path.",
    );
  }

  ensureDirectory(transaction.attemptDirectory, "Recorded attempt directory");
  validateRepositoryPath(transaction.repositoryRoot);

  return transaction;
}

function fixedArtifactPath(transactionPath, name) {
  const transaction = readTransaction(transactionPath);
  const path = join(transaction.attemptDirectory, name);

  assertOwnedPath(transaction.attemptDirectory, path);
  return path;
}

export function getMessageInputPath(transactionPath) {
  return fixedArtifactPath(transactionPath, "message-input.txt");
}

export function getEvidencePlanInputPath(transactionPath) {
  return fixedArtifactPath(transactionPath, "evidence-plan-input.json");
}

export function getMessageContentPath(transactionPath) {
  return fixedArtifactPath(transactionPath, "content.json");
}

export function advanceTransaction(transactionPath, expectedPhase, nextState) {
  const absoluteTransactionPath = resolve(transactionPath);
  const current = readTransaction(absoluteTransactionPath);

  if (current.phase !== expectedPhase) {
    throw new Error(
      `expected phase ${expectedPhase}, but transaction is ${current.phase}.`,
    );
  }

  if (
    nextState === null ||
    typeof nextState !== "object" ||
    Array.isArray(nextState) ||
    typeof nextState.phase !== "string"
  ) {
    throw new Error("A transaction advance requires a next phase.");
  }

  if (!PHASE_TRANSITIONS.get(current.phase)?.has(nextState.phase)) {
    throw new Error(
      `Invalid transaction transition from ${current.phase} to ${nextState.phase}.`,
    );
  }

  const candidate = { ...current, ...nextState };

  if (
    candidate.repositoryRoot !== current.repositoryRoot ||
    candidate.attemptDirectory !== current.attemptDirectory
  ) {
    throw new Error(
      "A transaction transition cannot replace its recorded paths.",
    );
  }

  validateTransaction(candidate);
  replaceJsonAtomically(absoluteTransactionPath, candidate);

  return readTransaction(absoluteTransactionPath);
}

export function updateTransaction(transactionPath, expectedPhase, nextState) {
  const absoluteTransactionPath = resolve(transactionPath);
  const current = readTransaction(absoluteTransactionPath);

  if (current.phase !== expectedPhase) {
    throw new Error(
      `expected phase ${expectedPhase}, but transaction is ${current.phase}.`,
    );
  }

  if (
    nextState === null ||
    typeof nextState !== "object" ||
    Array.isArray(nextState) ||
    nextState.phase !== current.phase
  ) {
    throw new Error("A reversible transaction update must preserve phase.");
  }

  const candidate = { ...current, ...nextState };

  if (
    candidate.repositoryRoot !== current.repositoryRoot ||
    candidate.attemptDirectory !== current.attemptDirectory
  ) {
    throw new Error("A transaction update cannot replace its recorded paths.");
  }

  validateTransaction(candidate);
  replaceJsonAtomically(absoluteTransactionPath, candidate);

  return readTransaction(absoluteTransactionPath);
}

function removeContainedDirectory(attemptDirectory, name) {
  const path = join(attemptDirectory, name);

  assertOwnedPath(attemptDirectory, path);

  if (!existsSync(path)) {
    return;
  }

  const stat = lstatSync(path);

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Refusing to compact a replaced helper directory: ${path}`);
  }

  rmSync(path, { recursive: true, force: false });
}

export function compactTransaction(
  transactionPath,
  { retainReviewArtifacts, retainProcessLogs },
) {
  const transaction = readTransaction(transactionPath);

  if (
    transaction.terminalDisposition === null ||
    !TERMINAL_PHASES.has(transaction.phase)
  ) {
    throw new Error("Cannot compact an active transaction.");
  }

  if (!retainReviewArtifacts) {
    removeContainedDirectory(transaction.attemptDirectory, "review");
    removeContainedDirectory(transaction.attemptDirectory, "inspection");
  }

  if (!retainProcessLogs) {
    removeContainedDirectory(transaction.attemptDirectory, "process-logs");
  }

  return readTransaction(transactionPath);
}
