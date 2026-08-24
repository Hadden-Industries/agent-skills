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
const PREFLIGHT_MODULE = join(
  REPO_ROOT,
  "src",
  "committing-to-git",
  "signature",
  "signaturePreflight.js",
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
      backend: "ssh",
      identity: null,
      timestamp: "2026-08-23T12:01:00.000Z",
    },
  });

  assert.deepEqual(result, {
    schemaVersion: 2,
    commitOid: "1".repeat(40),
    initialPolicy: "required",
    finalPolicy: "advisory",
    attempts: [
      {
        status: "unavailable",
        reason: "trust-store-unreadable",
        backend: "ssh",
        identity: null,
        timestamp: "2026-08-23T12:01:00.000Z",
      },
    ],
    effectiveAttempt: 0,
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
  assert.equal(result.backend, "openpgp");
  assert.equal(result.identity.signer, "Test Signer <test@example.invalid>");
  assert.equal(
    result.identity.primaryKeyFingerprint,
    "0123456789ABCDEF0123456789ABCDEF01234567",
  );
  assert.equal(
    result.identity.signingSubkeyFingerprint,
    "89ABCDEF0123456789ABCDEF0123456789ABCDEF",
  );
});

test("OpenPGP verification requires both signer identity and a full fingerprint", async () => {
  const { classifySignatureVerification } = await import(
    pathToFileURL(SIGNATURE_MODULE)
  );
  const result = classifySignatureVerification({
    status: 0,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(
      "[GNUPG:] VALIDSIG 89ABCDEF0123456789ABCDEF0123456789ABCDEF 2026-08-21 1787270400 0 4 0 1 10 00 0123456789ABCDEF0123456789ABCDEF01234567",
    ),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "verification-failed");
  assert.equal(result.identity, null);
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
      backend: result.backend,
      identity: result.identity,
    },
    {
      status: "verified",
      backend: "ssh",
      identity: {
        principal: "signer@example.invalid",
        keyFingerprint: "SHA256:0123456789abcdef",
      },
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
  assert.equal(result.identity, null);
});

test("Git for Windows allowed-keys permission output is trust-store-unreadable", async () => {
  const { classifySignatureVerification } = await import(
    pathToFileURL(SIGNATURE_MODULE)
  );
  const result = classifySignatureVerification({
    status: 1,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(
      "Good signature with ED25519 key SHA256:example\nUnable to open allowed keys file C:/keys/allowed_signers: Permission denied",
    ),
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "trust-store-unreadable");
});

test("allowed-signers diagnostic variants classify missing trust as unavailable", async () => {
  const { classifySignatureVerification } = await import(
    pathToFileURL(SIGNATURE_MODULE)
  );

  for (const diagnostic of [
    "error: allowed signers file C:/keys/missing: No such file or directory",
    "error: allowed-signers file C:/keys/missing could not open",
    "error: allowedSignersFile C:/keys/missing not found",
  ]) {
    const result = classifySignatureVerification({
      status: 1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from(diagnostic),
    });

    assert.equal(result.status, "unavailable", diagnostic);
    assert.equal(result.reason, "trust-store-unreadable", diagnostic);
  }
});

test("SSH preflight preserves config origin and probes the configured path once", async () => {
  const { inspectSignatureRequirements } = await import(
    pathToFileURL(PREFLIGHT_MODULE)
  );
  const probed = [];
  const preflight = inspectSignatureRequirements("C:/repo", {
    runConfig(args) {
      if (args.includes("gpg.format")) {
        return {
          status: 0,
          stdout: Buffer.from("ssh\n"),
          stderr: Buffer.alloc(0),
        };
      }

      return {
        status: 0,
        stdout: Buffer.from(
          "file:C:/Users/example/.gitconfig\tG:/keys/allowed_signers\n",
        ),
        stderr: Buffer.alloc(0),
      };
    },
    probeReadable(path) {
      probed.push(path);
      return true;
    },
  });

  assert.deepEqual(preflight, {
    backend: "ssh",
    trustSource: {
      configured: true,
      origin: "file:C:/Users/example/.gitconfig",
      path: "G:/keys/allowed_signers",
      readable: true,
    },
  });
  assert.deepEqual(probed, ["G:/keys/allowed_signers"]);
});

test("SSH preflight records missing and unreadable trust stores without replacing them", async () => {
  const { inspectSignatureRequirements } = await import(
    pathToFileURL(PREFLIGHT_MODULE)
  );
  const result = inspectSignatureRequirements("C:/repo", {
    runConfig(args) {
      if (args.includes("gpg.format")) {
        return {
          status: 0,
          stdout: Buffer.from("ssh\n"),
          stderr: Buffer.alloc(0),
        };
      }

      return {
        status: 0,
        stdout: Buffer.from("file:.git/config\tC:/missing/allowed_signers\n"),
        stderr: Buffer.alloc(0),
      };
    },
    probeReadable() {
      return false;
    },
  });

  assert.equal(result.backend, "ssh");
  assert.equal(result.trustSource.configured, true);
  assert.equal(result.trustSource.readable, false);
  assert.equal(result.trustSource.path, "C:/missing/allowed_signers");
});

test("OpenPGP preflight does not query or probe an SSH trust path", async () => {
  const { inspectSignatureRequirements } = await import(
    pathToFileURL(PREFLIGHT_MODULE)
  );
  let calls = 0;
  let probes = 0;
  const result = inspectSignatureRequirements("C:/repo", {
    runConfig() {
      calls += 1;
      return {
        status: 1,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      };
    },
    probeReadable() {
      probes += 1;
      return false;
    },
  });

  assert.deepEqual(result, { backend: "openpgp", trustSource: null });
  assert.equal(calls, 1);
  assert.equal(probes, 0);
});

test("verification history rejects a successful result for another commit", async () => {
  const { applyVerificationPolicy } = await import(
    pathToFileURL(SIGNATURE_MODULE)
  );

  assert.throws(
    () =>
      applyVerificationPolicy({
        commitOid: "1".repeat(40),
        initialPolicy: "required",
        finalPolicy: "required",
        verificationAttempt: {
          commitOid: "2".repeat(40),
          status: "verified",
          reason: null,
          backend: "ssh",
          identity: {
            principal: "signer@example.invalid",
            keyFingerprint: "SHA256:example",
          },
          timestamp: "2026-08-23T12:00:00.000Z",
        },
      }),
    /different commit/u,
  );
});

test("verification history rejects an identity from the wrong backend", async () => {
  const { applyVerificationPolicy } = await import(
    pathToFileURL(SIGNATURE_MODULE)
  );

  assert.throws(
    () =>
      applyVerificationPolicy({
        commitOid: "1".repeat(40),
        initialPolicy: "required",
        finalPolicy: "required",
        verificationAttempt: {
          status: "verified",
          reason: null,
          backend: "ssh",
          identity: {
            signer: "Test Signer <test@example.invalid>",
            primaryKeyFingerprint: "2".repeat(40),
            signingSubkeyFingerprint: null,
          },
          timestamp: "2026-08-23T12:00:00.000Z",
        },
      }),
    /backend-specific identity/u,
  );
});

test("verification retry appends an attempt for the same OID", async () => {
  const { applyVerificationPolicy } = await import(
    pathToFileURL(SIGNATURE_MODULE)
  );
  const commitOid = "3".repeat(40);
  const unavailable = applyVerificationPolicy({
    commitOid,
    initialPolicy: "required",
    finalPolicy: "required",
    verificationAttempt: {
      status: "unavailable",
      reason: "trust-store-unreadable",
      backend: "ssh",
      identity: null,
      timestamp: "2026-08-23T12:01:00.000Z",
    },
  });
  const verified = applyVerificationPolicy({
    commitOid,
    initialPolicy: "required",
    finalPolicy: "required",
    previousVerification: unavailable,
    verificationAttempt: {
      status: "verified",
      reason: null,
      backend: "ssh",
      identity: {
        principal: "signer@example.invalid",
        keyFingerprint: "SHA256:example",
      },
      timestamp: "2026-08-23T12:02:00.000Z",
    },
  });

  assert.equal(verified.commitOid, commitOid);
  assert.equal(verified.attempts.length, 2);
  assert.equal(verified.effectiveAttempt, 1);
  assert.equal(verified.blocksPush, false);
  assert.equal(verified.attempts[0].status, "unavailable");
  assert.equal(verified.attempts[1].status, "verified");
});
