import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIGNATURE_MODULE = join(
  REPO_ROOT,
  "src",
  "committing-to-git",
  "signature",
  "commitSignature.js",
);

test("advisory override unblocks an unavailable trust store without claiming verification", async () => {
  const { applyVerificationPolicy } = await import(
    pathToFileURL(SIGNATURE_MODULE)
  );
  const result = applyVerificationPolicy({
    commitOid: "1".repeat(40),
    initialPolicy: "required",
    finalPolicy: "advisory",
    verificationAttempt: {
      status: "unavailable",
      reason: "trust-store-unreadable",
      signer: null,
      fingerprint: null,
    },
    integrityOnlyAttempt: {
      status: "not-run",
    },
  });

  assert.deepEqual(result, {
    schemaVersion: 1,
    commitOid: "1".repeat(40),
    initialPolicy: "required",
    finalPolicy: "advisory",
    overridden: true,
    signature: {
      status: "unavailable",
      reason: "trust-store-unreadable",
      signer: null,
      fingerprint: null,
    },
    integrityOnly: {
      status: "not-run",
    },
    signatureVerified: false,
    blocksPush: false,
  });
});

test("OpenPGP verification reports the primary VALIDSIG fingerprint", async () => {
  const { classifySignatureVerification } = await import(
    pathToFileURL(SIGNATURE_MODULE)
  );
  const result = classifySignatureVerification({
    status: 0,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(
      [
        "[GNUPG:] NEWSIG",
        "[GNUPG:] GOODSIG 89ABCDEF01234567 Test Signer <test@example.invalid>",
        "[GNUPG:] VALIDSIG 89ABCDEF0123456789ABCDEF0123456789ABCDEF 2026-08-21 1787270400 0 4 0 1 10 00 0123456789ABCDEF0123456789ABCDEF01234567",
      ].join("\n"),
    ),
  });

  assert.equal(result.status, "verified");
  assert.equal(result.signer, "Test Signer <test@example.invalid>");
  assert.equal(result.fingerprint, "0123456789ABCDEF0123456789ABCDEF01234567");
  assert.equal(result.keyType, "OpenPGP");
});

test("SSH verification reports Git's trusted signer and fingerprint", async () => {
  const { classifySignatureVerification } = await import(
    pathToFileURL(SIGNATURE_MODULE)
  );
  const result = classifySignatureVerification({
    status: 0,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(
      'Good "git" signature for signer@example.invalid with ED25519 key SHA256:0123456789abcdef',
    ),
  });

  assert.deepEqual(
    {
      status: result.status,
      signer: result.signer,
      fingerprint: result.fingerprint,
      keyType: result.keyType,
    },
    {
      status: "verified",
      signer: "signer@example.invalid",
      fingerprint: "SHA256:0123456789abcdef",
      keyType: "ED25519",
    },
  );
});

test("Windows allowed-signers access errors are classified as unavailable", async () => {
  const { classifySignatureVerification } = await import(
    pathToFileURL(SIGNATURE_MODULE)
  );
  const result = classifySignatureVerification({
    status: 1,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(
      "error: Could not open allowed signers file G:\\\\keys\\\\allowed_signers: Access is denied",
    ),
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "trust-store-unreadable");
  assert.equal(result.fingerprint, null);
});
