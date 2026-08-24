import { runGit } from "../git/gitRepository.js";

const POLICIES = new Set(["required", "advisory", "skipped"]);
const STATUSES = new Set(["verified", "failed", "unavailable", "skipped"]);
const FULL_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const FULL_OPENPGP_FINGERPRINT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const FULL_SSH_FINGERPRINT = /^SHA256:[A-Za-z0-9+/=_-]+$/u;

function assertPolicy(policy, label) {
  if (!POLICIES.has(policy)) {
    throw new Error(`${label} must be required, advisory, or skipped.`);
  }
}

function sshIdentity(output) {
  const match =
    /Good "git" signature for (?<principal>.+?) with \S+ key (?<keyFingerprint>SHA256:\S+)/u.exec(
      output,
    );

  return match
    ? {
        principal: match.groups.principal,
        keyFingerprint: match.groups.keyFingerprint,
      }
    : null;
}

function openPgpIdentity(output) {
  const goodSignature = /\[GNUPG:\] GOODSIG \S+ (?<signer>.+)$/mu.exec(output);
  const validSignature = /\[GNUPG:\] VALIDSIG (?<fields>.+)$/mu.exec(output);

  if (!goodSignature || !validSignature) {
    return null;
  }

  const fields = validSignature.groups.fields.trim().split(/\s+/u);
  const signingFingerprint = fields[0] ?? null;
  const reportedPrimary = fields.length >= 10 ? fields.at(-1) : null;
  const primaryKeyFingerprint =
    reportedPrimary && FULL_OPENPGP_FINGERPRINT.test(reportedPrimary)
      ? reportedPrimary
      : signingFingerprint;

  if (
    !primaryKeyFingerprint ||
    !FULL_OPENPGP_FINGERPRINT.test(primaryKeyFingerprint)
  ) {
    return null;
  }

  return {
    signer: goodSignature.groups.signer,
    primaryKeyFingerprint,
    signingSubkeyFingerprint:
      signingFingerprint &&
      FULL_OPENPGP_FINGERPRINT.test(signingFingerprint) &&
      signingFingerprint.toLowerCase() !== primaryKeyFingerprint.toLowerCase()
        ? signingFingerprint
        : null,
  };
}

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

function identityMatchesBackend(backend, identity) {
  if (backend === "ssh") {
    return (
      hasExactKeys(identity, ["principal", "keyFingerprint"]) &&
      typeof identity.principal === "string" &&
      identity.principal.length > 0 &&
      typeof identity.keyFingerprint === "string" &&
      FULL_SSH_FINGERPRINT.test(identity.keyFingerprint)
    );
  }

  if (backend === "openpgp") {
    return (
      hasExactKeys(identity, [
        "signer",
        "primaryKeyFingerprint",
        "signingSubkeyFingerprint",
      ]) &&
      typeof identity.signer === "string" &&
      identity.signer.length > 0 &&
      typeof identity.primaryKeyFingerprint === "string" &&
      FULL_OPENPGP_FINGERPRINT.test(identity.primaryKeyFingerprint) &&
      (identity.signingSubkeyFingerprint === null ||
        (typeof identity.signingSubkeyFingerprint === "string" &&
          FULL_OPENPGP_FINGERPRINT.test(identity.signingSubkeyFingerprint)))
    );
  }

  return false;
}

function trustStoreIsUnreadable(output) {
  return (
    /allowed[ -]?(?:signers|keys)|allowedSignersFile/iu.test(output) &&
    /permission denied|access is denied|could not open|cannot open|unable to open|no such file|not found/iu.test(
      output,
    )
  );
}

export function classifySignatureVerification(
  result,
  { backend = null, timestamp = new Date().toISOString() } = {},
) {
  const stdout = Buffer.from(result.stdout ?? Buffer.alloc(0)).toString("utf8");
  const stderr = Buffer.from(result.stderr ?? Buffer.alloc(0)).toString("utf8");
  const output = `${stdout}\n${stderr}`.trim();
  const observedSshIdentity = sshIdentity(output);
  const observedOpenPgpIdentity = openPgpIdentity(output);
  const observedBackend = observedSshIdentity
    ? "ssh"
    : observedOpenPgpIdentity
      ? "openpgp"
      : backend;
  const identity = observedSshIdentity ?? observedOpenPgpIdentity;

  if (result.status === 0 && identity !== null) {
    return {
      status: "verified",
      reason: null,
      backend: observedBackend,
      identity,
      timestamp,
    };
  }

  const unavailable = trustStoreIsUnreadable(output);

  return {
    status: unavailable ? "unavailable" : "failed",
    reason: unavailable ? "trust-store-unreadable" : "verification-failed",
    backend: unavailable ? "ssh" : observedBackend,
    identity: null,
    timestamp,
  };
}

function validateAttempt(attempt) {
  if (
    attempt === null ||
    typeof attempt !== "object" ||
    Array.isArray(attempt) ||
    !STATUSES.has(attempt.status) ||
    !new Set(["ssh", "openpgp", null]).has(attempt.backend) ||
    (attempt.reason !== null && typeof attempt.reason !== "string") ||
    (attempt.identity !== null &&
      (typeof attempt.identity !== "object" ||
        Array.isArray(attempt.identity))) ||
    typeof attempt.timestamp !== "string" ||
    !Number.isFinite(Date.parse(attempt.timestamp))
  ) {
    throw new Error("Signature verification attempt is invalid.");
  }

  if (
    attempt.status === "verified" &&
    !identityMatchesBackend(attempt.backend, attempt.identity)
  ) {
    throw new Error(
      "Verified signature attempts require a backend-specific identity.",
    );
  }

  if (attempt.status !== "verified" && attempt.identity !== null) {
    throw new Error("Unverified signature attempts cannot retain an identity.");
  }

  if (
    attempt.status === "skipped" &&
    (attempt.backend !== null || attempt.identity !== null)
  ) {
    throw new Error("Skipped signature attempts cannot name a backend.");
  }

  return {
    status: attempt.status,
    reason: attempt.reason,
    backend: attempt.backend,
    identity:
      attempt.identity === null ? null : structuredClone(attempt.identity),
    timestamp: attempt.timestamp,
  };
}

export function applyVerificationPolicy({
  commitOid,
  initialPolicy,
  finalPolicy,
  verificationAttempt,
  previousVerification = null,
  timestamp = new Date().toISOString(),
}) {
  if (!FULL_OID_PATTERN.test(commitOid)) {
    throw new Error("Verified commit must be a full 40- or 64-hex object ID.");
  }

  assertPolicy(initialPolicy, "Initial verification policy");
  assertPolicy(finalPolicy, "Final verification policy");

  let attempts = [];

  if (previousVerification !== null) {
    if (
      previousVerification.schemaVersion !== 2 ||
      previousVerification.commitOid.toLowerCase() !==
        commitOid.toLowerCase() ||
      previousVerification.initialPolicy !== initialPolicy ||
      !Array.isArray(previousVerification.attempts)
    ) {
      throw new Error(
        "Previous verification does not belong to this commit policy.",
      );
    }

    attempts = previousVerification.attempts.map(validateAttempt);
  }

  const selectedAttempt =
    finalPolicy === "skipped"
      ? {
          status: "skipped",
          reason: "user-policy",
          backend: null,
          identity: null,
          timestamp,
        }
      : verificationAttempt;

  if (
    selectedAttempt?.commitOid !== undefined &&
    (typeof selectedAttempt.commitOid !== "string" ||
      selectedAttempt.commitOid.toLowerCase() !== commitOid.toLowerCase())
  ) {
    throw new Error("Verifier result belongs to a different commit.");
  }

  const attemptWithoutBinding =
    selectedAttempt?.commitOid === undefined
      ? selectedAttempt
      : Object.fromEntries(
          Object.entries(selectedAttempt).filter(
            ([key]) => key !== "commitOid",
          ),
        );

  attempts.push(validateAttempt(attemptWithoutBinding));
  const effectiveAttempt = attempts.length - 1;
  const effective = attempts[effectiveAttempt];

  return {
    schemaVersion: 2,
    commitOid,
    initialPolicy,
    finalPolicy,
    attempts,
    effectiveAttempt,
    blocksPush: finalPolicy === "required" && effective.status !== "verified",
  };
}

export function verifyCommitSignature(
  root,
  commitOid,
  {
    backend = null,
    timestamp = new Date().toISOString(),
    invoke = runGit,
  } = {},
) {
  if (!FULL_OID_PATTERN.test(commitOid)) {
    throw new Error(
      "Signature verification requires an exact full commit OID.",
    );
  }

  const result = invoke(["verify-commit", "--raw", commitOid], {
    cwd: root,
    allowFailure: true,
  });

  return classifySignatureVerification(result, { backend, timestamp });
}
