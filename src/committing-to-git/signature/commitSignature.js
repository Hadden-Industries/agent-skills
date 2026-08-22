import { runGit } from "../git/gitRepository.js";

const POLICIES = new Set(["required", "advisory", "skipped"]);

function assertPolicy(policy, label) {
  if (!POLICIES.has(policy)) {
    throw new Error(`${label} must be required, advisory, or skipped.`);
  }
}

export function applyVerificationPolicy({
  commitOid,
  initialPolicy,
  finalPolicy,
  verificationAttempt,
  integrityOnlyAttempt = { status: "not-run" },
}) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(commitOid)) {
    throw new Error("Verified commit must be a full 40- or 64-hex object ID.");
  }

  assertPolicy(initialPolicy, "Initial verification policy");
  assertPolicy(finalPolicy, "Final verification policy");

  const signature =
    finalPolicy === "skipped"
      ? {
          status: "skipped",
          reason: "user-policy",
          signer: null,
          fingerprint: null,
        }
      : verificationAttempt;
  const signatureVerified = signature.status === "verified";

  return {
    schemaVersion: 1,
    commitOid,
    initialPolicy,
    finalPolicy,
    overridden: initialPolicy !== finalPolicy,
    signature,
    integrityOnly: integrityOnlyAttempt,
    signatureVerified,
    blocksPush: finalPolicy === "required" && !signatureVerified,
  };
}

function signerDetails(output) {
  const ssh =
    /Good "git" signature for (?<signer>.+?) with (?<key>\S+) key (?<fingerprint>SHA256:\S+)/u.exec(
      output,
    );

  if (ssh) {
    return {
      signer: ssh.groups.signer,
      fingerprint: ssh.groups.fingerprint,
      keyType: ssh.groups.key,
    };
  }

  const goodSignature = /\[GNUPG:\] GOODSIG \S+ (?<signer>.+)$/mu.exec(output);
  const validSignature = /\[GNUPG:\] VALIDSIG (?<fields>.+)$/mu.exec(output);
  const validFields = validSignature?.groups.fields.trim().split(/\s+/u) ?? [];
  const fingerprint =
    validFields.length >= 10 ? validFields.at(-1) : (validFields[0] ?? null);

  return goodSignature || validSignature
    ? {
        signer: goodSignature?.groups.signer ?? null,
        fingerprint,
        keyType: "OpenPGP",
      }
    : { signer: null, fingerprint: null, keyType: null };
}

export function classifySignatureVerification(result) {
  const stdout = result.stdout?.toString("utf8") ?? "";
  const stderr = result.stderr?.toString("utf8") ?? "";
  const output = `${stdout}\n${stderr}`.trim();
  const details = signerDetails(output);

  if (result.status === 0) {
    return {
      status: "verified",
      reason: null,
      signer: details.signer,
      fingerprint: details.fingerprint,
      keyType: details.keyType,
      verifierOutput: output,
    };
  }

  const trustStoreUnreadable =
    /allowed[ -]?signers|allowedSignersFile/iu.test(output) &&
    /permission denied|access is denied|could not open|cannot open|no such file|not found/iu.test(
      output,
    );

  return {
    status: trustStoreUnreadable ? "unavailable" : "failed",
    reason: trustStoreUnreadable
      ? "trust-store-unreadable"
      : "verification-failed",
    signer: null,
    fingerprint: null,
    keyType: null,
    verifierOutput: output,
  };
}

export function verifyCommitSignature(root, commitOid) {
  return classifySignatureVerification(
    runGit(["verify-commit", "--raw", commitOid], {
      cwd: root,
      allowFailure: true,
    }),
  );
}
