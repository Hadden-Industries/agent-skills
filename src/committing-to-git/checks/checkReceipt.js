import { isAbsolute, join, resolve } from "node:path";

const FULL_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const RECEIPT_ID_PATTERN = /^C[0-9]{6}$/u;
const LAUNCH_STATES = new Set(["launching", "running", "completed"]);
const OUTCOMES = new Set([
  "passed",
  "failed",
  "launch-error",
  "signaled",
  "timed-out",
  "unknown",
]);
const MAXIMUM_LABEL_BYTES = 256;
const MAXIMUM_COMMAND_BYTES = 32 * 1024;
const MAXIMUM_ARGUMENTS = 256;
const REPORTABLE_OUTCOMES = new Set([
  "passed",
  "failed",
  "signaled",
  "timed-out",
]);

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

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validateCheckCommand(command) {
  assertExactKeys(command, ["executable", "arguments"], "Check command");

  if (
    typeof command.executable !== "string" ||
    command.executable.trim() !== command.executable ||
    command.executable.length === 0 ||
    /[\0\r\n;&|<>`]|\$\(/u.test(command.executable)
  ) {
    throw new Error(
      "Check command executable token must be one literal executable or path, not shell syntax.",
    );
  }

  if (
    !Array.isArray(command.arguments) ||
    command.arguments.length > MAXIMUM_ARGUMENTS ||
    command.arguments.some(
      (argument) => typeof argument !== "string" || argument.includes("\0"),
    ) ||
    Buffer.byteLength(
      JSON.stringify([command.executable, ...command.arguments]),
      "utf8",
    ) > MAXIMUM_COMMAND_BYTES
  ) {
    throw new Error(
      "Check command arguments must be a bounded literal argument vector.",
    );
  }
}

export function validateCheckContext(context) {
  assertExactKeys(
    context,
    ["kind", "repositoryRelativeWorkingDirectory"],
    "Check context",
  );

  const directory = context.repositoryRelativeWorkingDirectory;

  if (
    context.kind !== "current-worktree" ||
    typeof directory !== "string" ||
    directory.length === 0 ||
    directory.includes("\0") ||
    isAbsolute(directory) ||
    directory.split(/[\\/]/u).some((component) => component === "..")
  ) {
    throw new Error(
      "Check context must be current-worktree with a contained repository-relative working directory.",
    );
  }
}

function validateSubject(subject, transaction) {
  assertExactKeys(
    subject,
    ["manifestSha256", "headAnchor", "preparedTreeOid"],
    "Check subject",
  );

  if (
    !SHA256_PATTERN.test(subject.manifestSha256) ||
    !FULL_OID_PATTERN.test(subject.preparedTreeOid) ||
    subject.manifestSha256 !== transaction.snapshot?.sha256 ||
    subject.preparedTreeOid !== transaction.snapshot?.indexTreeOid ||
    JSON.stringify(subject.headAnchor) !==
      JSON.stringify(transaction.headAnchor)
  ) {
    throw new Error(
      "Check receipt does not match the prepared transaction subject.",
    );
  }
}

function validateChildIdentity(identity) {
  if (identity === null) {
    return;
  }

  assertExactKeys(identity, ["pid", "startIdentity"], "Check child identity");

  if (
    !Number.isSafeInteger(identity.pid) ||
    identity.pid < 1 ||
    (identity.startIdentity !== null &&
      typeof identity.startIdentity !== "string")
  ) {
    throw new Error("Check child identity is invalid.");
  }
}

function validateWorkspaceObservation(observation, label) {
  if (observation === null) {
    return;
  }

  assertExactKeys(observation, ["matches", "pathCount", "observedAt"], label);

  if (
    typeof observation.matches !== "boolean" ||
    !Number.isSafeInteger(observation.pathCount) ||
    observation.pathCount < 0 ||
    !validTimestamp(observation.observedAt)
  ) {
    throw new Error(`${label} is invalid.`);
  }
}

function validateWorkspace(workspace) {
  assertExactKeys(workspace, ["before", "after"], "Check workspace");
  validateWorkspaceObservation(workspace.before, "Check workspace before");
  validateWorkspaceObservation(workspace.after, "Check workspace after");

  if (workspace.before === null || workspace.before.matches !== true) {
    throw new Error(
      "A check may launch only after the selected scope matches its prepared tree.",
    );
  }
}

function validateOutputChannel(channel, label, expectedPaths) {
  assertExactKeys(
    channel,
    [
      "totalByteCount",
      "sha256",
      "headPath",
      "headByteCount",
      "headSha256",
      "tailPath",
      "tailByteCount",
      "tailSha256",
      "truncated",
    ],
    label,
  );

  if (
    !Number.isSafeInteger(channel.totalByteCount) ||
    channel.totalByteCount < 0 ||
    !SHA256_PATTERN.test(channel.sha256) ||
    (channel.headPath !== null && !isAbsolute(channel.headPath)) ||
    !Number.isSafeInteger(channel.headByteCount) ||
    channel.headByteCount < 0 ||
    (channel.headSha256 !== null && !SHA256_PATTERN.test(channel.headSha256)) ||
    (channel.tailPath !== null && !isAbsolute(channel.tailPath)) ||
    !Number.isSafeInteger(channel.tailByteCount) ||
    channel.tailByteCount < 0 ||
    (channel.tailSha256 !== null && !SHA256_PATTERN.test(channel.tailSha256)) ||
    typeof channel.truncated !== "boolean"
  ) {
    throw new Error(`${label} is invalid.`);
  }

  for (const segment of ["head", "tail"]) {
    const path = channel[`${segment}Path`];
    const byteCount = channel[`${segment}ByteCount`];
    const digest = channel[`${segment}Sha256`];

    if (
      (byteCount === 0 && (path !== null || digest !== null)) ||
      (byteCount > 0 &&
        (path === null ||
          digest === null ||
          resolve(path) !== expectedPaths[segment]))
    ) {
      throw new Error(
        `${label} ${segment} segment is not bound to its transaction path and digest.`,
      );
    }
  }
}

function validateOutput(output, attempt, transaction) {
  if (output === null) {
    return;
  }

  assertExactKeys(
    output,
    ["schemaVersion", "stdout", "stderr"],
    "Check output",
  );

  if (output.schemaVersion !== 1) {
    throw new Error("Check output schemaVersion must be 1.");
  }

  const directory = join(resolve(transaction.attemptDirectory), "process-logs");

  for (const channel of ["stdout", "stderr"]) {
    validateOutputChannel(output[channel], `Check ${channel} output`, {
      head: join(directory, `check-${attempt.receiptId}-${channel}-head.bin`),
      tail: join(directory, `check-${attempt.receiptId}-${channel}-tail.bin`),
    });
  }
}

function validateCompletion(completion) {
  if (completion === null) {
    return;
  }

  assertExactKeys(
    completion,
    [
      "finishedAt",
      "durationMilliseconds",
      "outcome",
      "exitCode",
      "signal",
      "launchError",
    ],
    "Check completion",
  );

  if (
    !validTimestamp(completion.finishedAt) ||
    !Number.isSafeInteger(completion.durationMilliseconds) ||
    completion.durationMilliseconds < 0 ||
    !OUTCOMES.has(completion.outcome) ||
    (completion.exitCode !== null && !Number.isInteger(completion.exitCode)) ||
    (completion.signal !== null && typeof completion.signal !== "string") ||
    (completion.launchError !== null &&
      (typeof completion.launchError !== "object" ||
        Array.isArray(completion.launchError)))
  ) {
    throw new Error("Check completion is invalid.");
  }

  const outcomeShapeIsValid =
    (completion.outcome === "passed" &&
      completion.exitCode === 0 &&
      completion.signal === null &&
      completion.launchError === null) ||
    (completion.outcome === "failed" &&
      completion.exitCode !== null &&
      completion.exitCode !== 0 &&
      completion.signal === null &&
      completion.launchError === null) ||
    (completion.outcome === "launch-error" &&
      completion.exitCode === null &&
      completion.signal === null &&
      completion.launchError !== null) ||
    (completion.outcome === "signaled" &&
      completion.exitCode === null &&
      completion.signal !== null &&
      completion.launchError === null) ||
    (completion.outcome === "timed-out" &&
      completion.exitCode === null &&
      completion.launchError === null) ||
    (completion.outcome === "unknown" &&
      completion.exitCode === null &&
      completion.signal === null &&
      completion.launchError === null);

  if (!outcomeShapeIsValid) {
    throw new Error("Check completion outcome contradicts its process facts.");
  }
}

function validateResolution(resolution) {
  if (resolution === null) {
    return;
  }

  assertExactKeys(
    resolution,
    ["kind", "resolvedAt"],
    "Check recovery resolution",
  );

  if (
    resolution.kind !== "confirmed-no-live-child" ||
    !validTimestamp(resolution.resolvedAt)
  ) {
    throw new Error("Check recovery resolution is invalid.");
  }
}

export function validateCheckAttempt(attempt, transaction) {
  assertExactKeys(
    attempt,
    [
      "schemaVersion",
      "receiptId",
      "retryOf",
      "label",
      "command",
      "context",
      "subject",
      "launchState",
      "childIdentity",
      "startedAt",
      "completion",
      "workspace",
      "output",
      "resolution",
    ],
    "Check attempt",
  );

  if (
    attempt.schemaVersion !== 1 ||
    !RECEIPT_ID_PATTERN.test(attempt.receiptId) ||
    (attempt.retryOf !== null && !RECEIPT_ID_PATTERN.test(attempt.retryOf)) ||
    typeof attempt.label !== "string" ||
    attempt.label.trim() !== attempt.label ||
    attempt.label.length === 0 ||
    /[\0\r\n]/u.test(attempt.label) ||
    Buffer.byteLength(attempt.label, "utf8") > MAXIMUM_LABEL_BYTES ||
    !LAUNCH_STATES.has(attempt.launchState) ||
    !validTimestamp(attempt.startedAt)
  ) {
    throw new Error("Check attempt contains invalid identity or launch facts.");
  }

  validateCheckCommand(attempt.command);
  validateCheckContext(attempt.context);
  validateSubject(attempt.subject, transaction);
  validateChildIdentity(attempt.childIdentity);
  validateCompletion(attempt.completion);
  validateWorkspace(attempt.workspace);
  validateOutput(attempt.output, attempt, transaction);
  validateResolution(attempt.resolution);

  if (
    (attempt.launchState === "launching" &&
      (attempt.childIdentity !== null ||
        attempt.completion !== null ||
        attempt.output !== null ||
        attempt.workspace.after !== null ||
        attempt.resolution !== null)) ||
    (attempt.launchState === "running" &&
      (attempt.childIdentity === null ||
        attempt.completion !== null ||
        attempt.workspace.after !== null ||
        attempt.resolution !== null)) ||
    (attempt.launchState === "completed" && attempt.completion === null) ||
    (attempt.completion !== null &&
      !new Set(["launch-error", "unknown"]).has(attempt.completion.outcome) &&
      (attempt.childIdentity === null ||
        attempt.output === null ||
        attempt.workspace.after === null)) ||
    (attempt.completion?.outcome === "unknown" &&
      attempt.resolution === null) ||
    (attempt.resolution !== null && attempt.completion?.outcome !== "unknown")
  ) {
    throw new Error("Check launch state and outcome are inconsistent.");
  }
}

export function validateCheckAttempts(checkAttempts, transaction) {
  if (!Array.isArray(checkAttempts)) {
    throw new Error("Transaction checkAttempts must be an array.");
  }

  for (const [index, attempt] of checkAttempts.entries()) {
    const expectedId = `C${String(index + 1).padStart(6, "0")}`;

    if (attempt?.receiptId !== expectedId) {
      throw new Error(
        "Check receipt IDs must form deterministic append-only history.",
      );
    }
  }

  for (const [index, attempt] of checkAttempts.entries()) {
    validateCheckAttempt(attempt, transaction);

    if (attempt.retryOf !== null) {
      const prior = checkAttempts[index - 1];

      if (
        prior === undefined ||
        attempt.retryOf !== prior.receiptId ||
        prior.completion?.outcome !== "unknown" ||
        prior.resolution === null
      ) {
        throw new Error(
          "Check retry links must name the immediately earlier resolved unknown attempt.",
        );
      }
    }

    if (
      index < checkAttempts.length - 1 &&
      attempt.launchState !== "completed"
    ) {
      throw new Error(
        "Only the latest check attempt may have an unresolved launch state.",
      );
    }

    if (
      attempt.completion?.outcome === "unknown" &&
      index < checkAttempts.length - 1 &&
      checkAttempts[index + 1].retryOf !== attempt.receiptId
    ) {
      throw new Error(
        "A resolved unknown check must be followed immediately by its linked retry.",
      );
    }
  }
}

export function completedCheckReceipts(checkAttempts) {
  return checkAttempts.filter(
    (attempt) =>
      attempt.launchState === "completed" &&
      REPORTABLE_OUTCOMES.has(attempt.completion?.outcome) &&
      attempt.workspace.before.matches &&
      attempt.workspace.after?.matches,
  );
}

export function analyzeCheckCommitReadiness(
  checkAttempts,
  acknowledgedFailedCheckIds,
) {
  const acknowledgements = Array.isArray(acknowledgedFailedCheckIds)
    ? acknowledgedFailedCheckIds
    : [];
  const uniqueAcknowledgements = new Set(acknowledgements);
  const receipts = completedCheckReceipts(checkAttempts);
  const failedReceiptIds = receipts
    .filter((attempt) => attempt.completion.outcome !== "passed")
    .map((attempt) => attempt.receiptId);
  const failedReceiptSet = new Set(failedReceiptIds);

  return {
    activeAttemptIds: checkAttempts
      .filter((attempt) => attempt.launchState !== "completed")
      .map((attempt) => attempt.receiptId),
    retryRequiredIds: checkAttempts
      .filter(
        (attempt, index) =>
          attempt.completion?.outcome === "unknown" &&
          checkAttempts[index + 1]?.retryOf !== attempt.receiptId,
      )
      .map((attempt) => attempt.receiptId),
    failedReceiptIds,
    missingAcknowledgementIds: failedReceiptIds.filter(
      (receiptId) => !uniqueAcknowledgements.has(receiptId),
    ),
    invalidAcknowledgementIds: [...uniqueAcknowledgements].filter(
      (receiptId) => !failedReceiptSet.has(receiptId),
    ),
    duplicateAcknowledgementIds: acknowledgements.filter(
      (receiptId, index) => acknowledgements.indexOf(receiptId) !== index,
    ),
  };
}

function reportOutputChannel(channel) {
  return {
    totalByteCount: channel.totalByteCount,
    sha256: channel.sha256,
    truncated: channel.truncated,
  };
}

export function summarizeCheckReceipts(
  checkAttempts,
  acknowledgedFailedCheckIds = [],
) {
  const acknowledged = new Set(acknowledgedFailedCheckIds);
  const receipts = completedCheckReceipts(checkAttempts).map((attempt) => ({
    receiptId: attempt.receiptId,
    label: attempt.label,
    command: attempt.command,
    context: attempt.context,
    outcome: attempt.completion.outcome,
    exitCode: attempt.completion.exitCode,
    signal: attempt.completion.signal,
    durationMilliseconds: attempt.completion.durationMilliseconds,
    selectedScopeStable: true,
    failureAcknowledged:
      attempt.completion.outcome === "passed"
        ? null
        : acknowledged.has(attempt.receiptId),
    output: {
      stdout: reportOutputChannel(attempt.output.stdout),
      stderr: reportOutputChannel(attempt.output.stderr),
    },
  }));

  // Attempt count remains visible even when an interrupted or launch-error
  // attempt cannot truthfully be represented as passed or failed evidence.
  return {
    schemaVersion: 2,
    attemptCount: checkAttempts.length,
    receipts,
  };
}
