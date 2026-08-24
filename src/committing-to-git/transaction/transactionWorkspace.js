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
const SSH_FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/=_-]+$/u;
const OPENPGP_FINGERPRINT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const MESSAGE_SOURCES = new Set([
  "approved-subject",
  "checked-file",
  "finalized-extended",
]);
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
    new Set([
      "review-pending",
      "commit-pending",
      "stopped",
      "abandoned",
      "superseded",
    ]),
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

function validateMessageState(message) {
  if (message === null) {
    return;
  }

  assertExactKeys(
    message,
    [
      "schemaVersion",
      "revision",
      "sha256",
      "source",
      "byteCount",
      "stateSha256",
      "validationSha256",
      "slot",
    ],
    "Canonical message state",
  );

  if (
    message.schemaVersion !== 1 ||
    !Number.isSafeInteger(message.revision) ||
    message.revision < 1 ||
    !SHA256_PATTERN.test(message.sha256) ||
    !MESSAGE_SOURCES.has(message.source) ||
    !Number.isSafeInteger(message.byteCount) ||
    message.byteCount < 1 ||
    !SHA256_PATTERN.test(message.stateSha256) ||
    !SHA256_PATTERN.test(message.validationSha256) ||
    message.slot !== "message/current"
  ) {
    throw new Error("Canonical message state is invalid.");
  }
}

function validateSignaturePreflight(preflight) {
  if (preflight === null) {
    return;
  }

  assertExactKeys(preflight, ["backend", "trustSource"], "Signature preflight");

  if (!new Set([null, "ssh", "openpgp"]).has(preflight.backend)) {
    throw new Error("Signature preflight backend is invalid.");
  }

  if (preflight.backend !== "ssh") {
    if (preflight.trustSource !== null) {
      throw new Error(
        "Only SSH preflight may record an allowed-signers source.",
      );
    }

    return;
  }

  assertExactKeys(
    preflight.trustSource,
    ["configured", "origin", "path", "readable"],
    "SSH trust source",
  );

  if (
    typeof preflight.trustSource.configured !== "boolean" ||
    typeof preflight.trustSource.readable !== "boolean" ||
    (preflight.trustSource.origin !== null &&
      typeof preflight.trustSource.origin !== "string") ||
    (preflight.trustSource.path !== null &&
      typeof preflight.trustSource.path !== "string") ||
    (preflight.trustSource.configured &&
      (!preflight.trustSource.origin || !preflight.trustSource.path)) ||
    (!preflight.trustSource.configured &&
      (preflight.trustSource.origin !== null ||
        preflight.trustSource.path !== null ||
        preflight.trustSource.readable))
  ) {
    throw new Error("SSH trust-source preflight is invalid.");
  }
}

function validateCommitJournal(commit) {
  if (commit === null) {
    return;
  }

  assertExactKeys(
    commit,
    [
      "status",
      "launchState",
      "childIdentity",
      "headAnchor",
      "expectedTreeOid",
      "messageSha256",
      "messageByteCount",
      "checks",
      "startedAt",
      "completion",
      "transcript",
      "commitOid",
      "comparison",
      "observationProvenance",
      "recoveryObservations",
      "recoveryResolution",
    ],
    "Commit journal",
  );
  validateHeadAnchor(commit.headAnchor);

  if (
    !new Set(["pending", "created"]).has(commit.status) ||
    !new Set(["not-started", "launching", "running", "completed"]).has(
      commit.launchState,
    ) ||
    !FULL_OID_PATTERN.test(commit.expectedTreeOid) ||
    !SHA256_PATTERN.test(commit.messageSha256) ||
    !Number.isSafeInteger(commit.messageByteCount) ||
    commit.messageByteCount < 1 ||
    typeof commit.startedAt !== "string" ||
    !Number.isFinite(Date.parse(commit.startedAt)) ||
    (commit.commitOid !== null && !FULL_OID_PATTERN.test(commit.commitOid)) ||
    !new Set([null, "witnessed", "recovered"]).has(commit.observationProvenance)
  ) {
    throw new Error(
      "Commit journal contains invalid identity or launch facts.",
    );
  }

  if (commit.childIdentity !== null) {
    assertExactKeys(
      commit.childIdentity,
      ["pid", "startIdentity"],
      "Commit child identity",
    );

    if (
      !Number.isSafeInteger(commit.childIdentity.pid) ||
      commit.childIdentity.pid < 1 ||
      (commit.childIdentity.startIdentity !== null &&
        typeof commit.childIdentity.startIdentity !== "string")
    ) {
      throw new Error("Commit child identity is invalid.");
    }
  }

  assertExactKeys(
    commit.checks,
    ["value", "sha256", "externalPath"],
    "Commit checks capsule",
  );

  if (
    !SHA256_PATTERN.test(commit.checks.sha256) ||
    (commit.checks.externalPath !== null &&
      !isAbsolute(commit.checks.externalPath)) ||
    commit.checks.value?.schemaVersion !== 1 ||
    !Array.isArray(commit.checks.value?.checks)
  ) {
    throw new Error("Commit checks capsule is invalid.");
  }

  if (commit.completion !== null) {
    assertExactKeys(
      commit.completion,
      [
        "exitCode",
        "signal",
        "transcriptCompletionSha256",
        "nonLaunchGuaranteed",
        "launchError",
      ],
      "Commit completion",
    );

    if (
      (commit.completion.exitCode !== null &&
        !Number.isInteger(commit.completion.exitCode)) ||
      (commit.completion.signal !== null &&
        typeof commit.completion.signal !== "string") ||
      (commit.completion.transcriptCompletionSha256 !== null &&
        !SHA256_PATTERN.test(commit.completion.transcriptCompletionSha256)) ||
      typeof commit.completion.nonLaunchGuaranteed !== "boolean" ||
      (commit.completion.launchError !== null &&
        (typeof commit.completion.launchError !== "object" ||
          Array.isArray(commit.completion.launchError)))
    ) {
      throw new Error("Commit completion is invalid.");
    }
  }

  for (const field of [
    "transcript",
    "comparison",
    "recoveryObservations",
    "recoveryResolution",
  ]) {
    if (
      commit[field] !== null &&
      (typeof commit[field] !== "object" || Array.isArray(commit[field]))
    ) {
      throw new Error(`Commit journal ${field} must be an object or null.`);
    }
  }
}

function validateVerificationHistory(verification) {
  if (verification === null) {
    return;
  }

  assertExactKeys(
    verification,
    [
      "schemaVersion",
      "commitOid",
      "initialPolicy",
      "finalPolicy",
      "attempts",
      "effectiveAttempt",
      "blocksPush",
    ],
    "Verification history",
  );

  if (
    verification.schemaVersion !== 2 ||
    !FULL_OID_PATTERN.test(verification.commitOid) ||
    !new Set(["required", "advisory", "skipped"]).has(
      verification.initialPolicy,
    ) ||
    !new Set(["required", "advisory", "skipped"]).has(
      verification.finalPolicy,
    ) ||
    !Array.isArray(verification.attempts) ||
    verification.attempts.length < 1 ||
    !Number.isSafeInteger(verification.effectiveAttempt) ||
    verification.effectiveAttempt < 0 ||
    verification.effectiveAttempt >= verification.attempts.length ||
    typeof verification.blocksPush !== "boolean"
  ) {
    throw new Error("Verification history is invalid.");
  }

  for (const attempt of verification.attempts) {
    assertExactKeys(
      attempt,
      ["status", "reason", "backend", "identity", "timestamp"],
      "Signature verification attempt",
    );

    if (
      !new Set(["verified", "failed", "unavailable", "skipped"]).has(
        attempt.status,
      ) ||
      !new Set(["ssh", "openpgp", null]).has(attempt.backend) ||
      (attempt.reason !== null && typeof attempt.reason !== "string") ||
      typeof attempt.timestamp !== "string" ||
      !Number.isFinite(Date.parse(attempt.timestamp))
    ) {
      throw new Error("Signature verification attempt is invalid.");
    }

    if (attempt.status !== "verified") {
      if (
        attempt.identity !== null ||
        (attempt.status === "skipped" && attempt.backend !== null)
      ) {
        throw new Error("Signature verification attempt is invalid.");
      }

      continue;
    }

    const sshIdentity =
      attempt.backend === "ssh" &&
      attempt.identity !== null &&
      typeof attempt.identity === "object" &&
      !Array.isArray(attempt.identity) &&
      Object.keys(attempt.identity).length === 2 &&
      Object.hasOwn(attempt.identity, "principal") &&
      Object.hasOwn(attempt.identity, "keyFingerprint") &&
      typeof attempt.identity.principal === "string" &&
      attempt.identity.principal.length > 0 &&
      typeof attempt.identity.keyFingerprint === "string" &&
      SSH_FINGERPRINT_PATTERN.test(attempt.identity.keyFingerprint);
    const openPgpIdentity =
      attempt.backend === "openpgp" &&
      attempt.identity !== null &&
      typeof attempt.identity === "object" &&
      !Array.isArray(attempt.identity) &&
      Object.keys(attempt.identity).length === 3 &&
      Object.hasOwn(attempt.identity, "signer") &&
      Object.hasOwn(attempt.identity, "primaryKeyFingerprint") &&
      Object.hasOwn(attempt.identity, "signingSubkeyFingerprint") &&
      typeof attempt.identity.signer === "string" &&
      attempt.identity.signer.length > 0 &&
      typeof attempt.identity.primaryKeyFingerprint === "string" &&
      OPENPGP_FINGERPRINT_PATTERN.test(
        attempt.identity.primaryKeyFingerprint,
      ) &&
      (attempt.identity.signingSubkeyFingerprint === null ||
        (typeof attempt.identity.signingSubkeyFingerprint === "string" &&
          OPENPGP_FINGERPRINT_PATTERN.test(
            attempt.identity.signingSubkeyFingerprint,
          )));

    if (!sshIdentity && !openPgpIdentity) {
      throw new Error(
        "Verified signature attempts require a backend-specific identity.",
      );
    }
  }
}

function validatePublicationAttempt(attempt) {
  assertExactKeys(
    attempt,
    [
      "schemaVersion",
      "attemptId",
      "retryOf",
      "status",
      "launchState",
      "childIdentity",
      "commitOid",
      "remote",
      "destination",
      "refspec",
      "startedAt",
      "completion",
      "transcript",
      "observation",
      "resolution",
      "retryPermitted",
      "reason",
    ],
    "Publication attempt",
  );

  if (
    attempt.schemaVersion !== 1 ||
    !UUID_V4_PATTERN.test(attempt.attemptId) ||
    (attempt.retryOf !== null && !UUID_V4_PATTERN.test(attempt.retryOf)) ||
    !new Set([
      "pending",
      "unknown",
      "rejected",
      "succeeded",
      "observed-matching",
    ]).has(attempt.status) ||
    !new Set(["not-started", "launching", "running", "completed"]).has(
      attempt.launchState,
    ) ||
    !FULL_OID_PATTERN.test(attempt.commitOid) ||
    typeof attempt.remote !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(attempt.remote) ||
    typeof attempt.destination !== "string" ||
    !attempt.destination.startsWith("refs/heads/") ||
    attempt.refspec !== `${attempt.commitOid}:${attempt.destination}` ||
    typeof attempt.startedAt !== "string" ||
    !Number.isFinite(Date.parse(attempt.startedAt)) ||
    typeof attempt.retryPermitted !== "boolean" ||
    (attempt.reason !== null && typeof attempt.reason !== "string")
  ) {
    throw new Error("Publication attempt contains invalid identity facts.");
  }

  if (attempt.childIdentity !== null) {
    assertExactKeys(
      attempt.childIdentity,
      ["pid", "startIdentity"],
      "Publication child identity",
    );

    if (
      !Number.isSafeInteger(attempt.childIdentity.pid) ||
      attempt.childIdentity.pid < 1 ||
      (attempt.childIdentity.startIdentity !== null &&
        typeof attempt.childIdentity.startIdentity !== "string")
    ) {
      throw new Error("Publication child identity is invalid.");
    }
  }

  if (attempt.completion !== null) {
    assertExactKeys(
      attempt.completion,
      [
        "exitCode",
        "signal",
        "transcriptCompletionSha256",
        "nonLaunchGuaranteed",
        "launchError",
        "outcome",
      ],
      "Publication completion",
    );

    if (
      (attempt.completion.exitCode !== null &&
        !Number.isInteger(attempt.completion.exitCode)) ||
      (attempt.completion.signal !== null &&
        typeof attempt.completion.signal !== "string") ||
      (attempt.completion.transcriptCompletionSha256 !== null &&
        !SHA256_PATTERN.test(attempt.completion.transcriptCompletionSha256)) ||
      typeof attempt.completion.nonLaunchGuaranteed !== "boolean" ||
      (attempt.completion.launchError !== null &&
        (typeof attempt.completion.launchError !== "object" ||
          Array.isArray(attempt.completion.launchError))) ||
      !new Set([
        "not-launched",
        "witnessed-success",
        "known-rejection",
        "unknown",
      ]).has(attempt.completion.outcome)
    ) {
      throw new Error("Publication completion is invalid.");
    }
  }

  if (attempt.observation !== null) {
    assertExactKeys(
      attempt.observation,
      [
        "status",
        "observedAt",
        "observedOid",
        "exitCode",
        "stdoutSha256",
        "stderrSha256",
        "commandDigest",
        "reason",
      ],
      "Publication observation",
    );

    if (
      !new Set(["querying", "observed", "absent", "unavailable"]).has(
        attempt.observation.status,
      ) ||
      typeof attempt.observation.observedAt !== "string" ||
      !Number.isFinite(Date.parse(attempt.observation.observedAt)) ||
      (attempt.observation.observedOid !== null &&
        !FULL_OID_PATTERN.test(attempt.observation.observedOid)) ||
      (attempt.observation.exitCode !== null &&
        !Number.isInteger(attempt.observation.exitCode)) ||
      !SHA256_PATTERN.test(attempt.observation.stdoutSha256) ||
      !SHA256_PATTERN.test(attempt.observation.stderrSha256) ||
      !SHA256_PATTERN.test(attempt.observation.commandDigest) ||
      (attempt.observation.reason !== null &&
        typeof attempt.observation.reason !== "string") ||
      (attempt.observation.status === "observed" &&
        (attempt.observation.observedOid === null ||
          attempt.observation.exitCode !== 0)) ||
      (attempt.observation.status === "absent" &&
        (attempt.observation.observedOid !== null ||
          attempt.observation.exitCode !== 2)) ||
      (attempt.observation.status === "unavailable" &&
        (attempt.observation.observedOid !== null ||
          attempt.observation.reason === null)) ||
      (attempt.observation.status === "querying" &&
        (attempt.observation.observedOid !== null ||
          attempt.observation.exitCode !== null ||
          attempt.observation.reason === null))
    ) {
      throw new Error("Publication observation is invalid.");
    }
  }

  if (attempt.resolution !== null) {
    assertExactKeys(
      attempt.resolution,
      ["kind", "assertedAt", "observationDigest"],
      "Publication resolution",
    );

    if (
      attempt.resolution.kind !== "confirmed-no-live-child" ||
      typeof attempt.resolution.assertedAt !== "string" ||
      !Number.isFinite(Date.parse(attempt.resolution.assertedAt)) ||
      !SHA256_PATTERN.test(attempt.resolution.observationDigest) ||
      attempt.observation === null ||
      attempt.resolution.observationDigest !== attempt.observation.commandDigest
    ) {
      throw new Error("Publication resolution is invalid.");
    }
  }

  if (
    attempt.retryPermitted !== (attempt.resolution !== null) ||
    (attempt.retryPermitted && attempt.status !== "unknown")
  ) {
    throw new Error(
      "Publication retry permission requires an observation and resolution.",
    );
  }

  for (const field of ["transcript", "completion"]) {
    if (
      attempt[field] !== null &&
      (typeof attempt[field] !== "object" || Array.isArray(attempt[field]))
    ) {
      throw new Error(`Publication ${field} must be an object or null.`);
    }
  }

  if (attempt.transcript !== null) {
    assertExactKeys(
      attempt.transcript,
      [
        "path",
        "status",
        "signal",
        "totalByteCount",
        "stdoutByteCount",
        "stderrByteCount",
        "stdoutSha256",
        "stderrSha256",
        "sha256",
        "completionSha256",
        "retainRecommended",
      ],
      "Publication transcript",
    );

    if (
      typeof attempt.transcript.path !== "string" ||
      attempt.transcript.path.length === 0 ||
      (attempt.transcript.status !== null &&
        !Number.isInteger(attempt.transcript.status)) ||
      (attempt.transcript.signal !== null &&
        typeof attempt.transcript.signal !== "string") ||
      !Number.isSafeInteger(attempt.transcript.totalByteCount) ||
      attempt.transcript.totalByteCount < 0 ||
      !Number.isSafeInteger(attempt.transcript.stdoutByteCount) ||
      attempt.transcript.stdoutByteCount < 0 ||
      !Number.isSafeInteger(attempt.transcript.stderrByteCount) ||
      attempt.transcript.stderrByteCount < 0 ||
      !SHA256_PATTERN.test(attempt.transcript.stdoutSha256) ||
      !SHA256_PATTERN.test(attempt.transcript.stderrSha256) ||
      !SHA256_PATTERN.test(attempt.transcript.sha256) ||
      !SHA256_PATTERN.test(attempt.transcript.completionSha256) ||
      typeof attempt.transcript.retainRecommended !== "boolean" ||
      attempt.transcript.totalByteCount !==
        attempt.transcript.stdoutByteCount + attempt.transcript.stderrByteCount
    ) {
      throw new Error("Publication transcript is invalid.");
    }
  }

  if (
    (attempt.launchState === "not-started" &&
      (attempt.childIdentity !== null ||
        attempt.completion !== null ||
        attempt.transcript !== null)) ||
    (attempt.launchState === "launching" &&
      (attempt.completion !== null || attempt.transcript !== null)) ||
    (attempt.launchState === "running" &&
      (attempt.childIdentity === null ||
        attempt.completion !== null ||
        attempt.transcript !== null)) ||
    (attempt.launchState === "completed" && attempt.completion === null) ||
    (attempt.completion?.outcome === "not-launched" &&
      attempt.completion.nonLaunchGuaranteed !== true) ||
    (attempt.completion?.outcome === "witnessed-success" &&
      (attempt.completion.exitCode !== 0 || attempt.transcript === null)) ||
    (attempt.completion?.outcome === "known-rejection" &&
      (attempt.completion.exitCode === null ||
        attempt.completion.exitCode === 0 ||
        attempt.transcript === null)) ||
    (attempt.status === "succeeded" &&
      (attempt.launchState !== "completed" ||
        attempt.completion?.outcome !== "witnessed-success")) ||
    (attempt.status === "observed-matching" &&
      (attempt.observation?.status !== "observed" ||
        attempt.observation.observedOid !== attempt.commitOid))
  ) {
    throw new Error("Publication launch state and outcome are inconsistent.");
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
  validateMessageState(transaction.message);
  validateSignaturePreflight(transaction.signaturePreflight);
  validateCommitJournal(transaction.commit);
  validateVerificationHistory(transaction.verification);

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

  if (transaction.phase === "message-ready" && transaction.message === null) {
    throw new Error(
      "A message-ready transaction requires one canonical message state.",
    );
  }

  if (
    new Set(["allocated", "snapshot-created", "evidence-ready"]).has(
      transaction.phase,
    ) &&
    transaction.message !== null
  ) {
    throw new Error(
      `Transaction phase ${transaction.phase} cannot retain a canonical message.`,
    );
  }

  if (transaction.message !== null) {
    const sourceMatchesRoute =
      (transaction.route === "concise" &&
        new Set(["approved-subject", "checked-file"]).has(
          transaction.message.source,
        )) ||
      (transaction.route === "extended" &&
        transaction.message.source === "finalized-extended");

    if (!sourceMatchesRoute) {
      throw new Error(
        "Canonical message source does not match the transaction route.",
      );
    }
  }

  if (!Array.isArray(transaction.publicationAttempts)) {
    throw new Error("Transaction publicationAttempts must be an array.");
  }

  const publicationIds = new Set();

  for (const attempt of transaction.publicationAttempts) {
    validatePublicationAttempt(attempt);

    if (
      publicationIds.has(attempt.attemptId) ||
      (attempt.retryOf !== null && !publicationIds.has(attempt.retryOf))
    ) {
      throw new Error(
        "Publication attempt IDs and retry links must form append-only history.",
      );
    }

    publicationIds.add(attempt.attemptId);
  }

  const latestPublication = transaction.publicationAttempts.at(-1) ?? null;

  for (const attempt of transaction.publicationAttempts) {
    if (attempt.commitOid !== transaction.commit?.commitOid) {
      throw new Error(
        "Every publication attempt must bind the transaction commit OID.",
      );
    }
  }

  if (
    transaction.phase === "publication-pending" &&
    latestPublication === null
  ) {
    throw new Error(
      "A publication-pending transaction requires a journaled publication attempt.",
    );
  }

  if (
    transaction.phase === "published" &&
    (latestPublication === null ||
      !new Set(["succeeded", "observed-matching"]).has(
        latestPublication.status,
      ))
  ) {
    throw new Error(
      "A published transaction requires a successful or observed-matching attempt.",
    );
  }

  if (
    transaction.phase === "reported" &&
    latestPublication !== null &&
    latestPublication.status !== "rejected"
  ) {
    throw new Error(
      "A reported transaction may retain only a latest known rejected publication attempt.",
    );
  }

  if (transaction.phase === "commit-pending" && transaction.commit === null) {
    throw new Error(
      "A commit-pending transaction requires its commit journal.",
    );
  }

  if (
    transaction.phase === "reported" &&
    (transaction.commit === null ||
      transaction.commit.commitOid === null ||
      transaction.commit.comparison === null ||
      transaction.verification === null ||
      transaction.report === null)
  ) {
    throw new Error(
      "A reported transaction requires commit, comparison, verification, and report facts.",
    );
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
