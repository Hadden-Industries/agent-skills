// Validation for agent-authored post-commit evidence artifacts.
import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCheckEvidence,
  validatePublicationArtifact,
  validateVerificationArtifact,
} from "../../src/committing-to-git/report/commitReport.js";

test("check evidence requires helper-witnessed argv, context, result, and authorization facts", () => {
  const output = {
    stdout: {
      totalByteCount: 0,
      sha256: "0".repeat(64),
      truncated: false,
    },
    stderr: {
      totalByteCount: 0,
      sha256: "0".repeat(64),
      truncated: false,
    },
  };
  const receipt = {
    receiptId: "C000001",
    label: "Focused Node tests",
    command: { executable: "npm", arguments: ["test"] },
    context: {
      kind: "current-worktree",
      repositoryRelativeWorkingDirectory: ".",
    },
    outcome: "passed",
    exitCode: 0,
    signal: null,
    durationMilliseconds: 125,
    selectedScopeStable: true,
    failureAcknowledged: null,
    output,
  };

  assert.doesNotThrow(() =>
    validateCheckEvidence({
      schemaVersion: 2,
      attemptCount: 1,
      receipts: [receipt],
    }),
  );
  assert.throws(
    () =>
      validateCheckEvidence({
        schemaVersion: 2,
        attemptCount: 1,
        receipts: [
          {
            ...receipt,
            outcome: "failed",
            exitCode: 7,
            failureAcknowledged: null,
          },
        ],
      }),
    /result.*authorization/iu,
  );
});

test("publication artifacts distinguish blocked, witnessed, observed, rejected, and unknown states", () => {
  const commitOid = "1".repeat(40);
  const attemptId = "123e4567-e89b-42d3-a456-426614174000";
  const base = {
    schemaVersion: 2,
    attemptId,
    retryOf: null,
    commitOid,
    remote: "origin",
    destination: "refs/heads/main",
    refspec: `${commitOid}:refs/heads/main`,
    exitCode: null,
    transcript: null,
    observation: null,
    resolution: null,
    retryPermitted: false,
    reason: null,
  };

  assert.doesNotThrow(() =>
    validatePublicationArtifact({ status: "not-requested" }),
  );
  assert.doesNotThrow(() =>
    validatePublicationArtifact({
      status: "blocked",
      reason: "verification-policy-blocked",
    }),
  );
  assert.doesNotThrow(() =>
    validatePublicationArtifact({
      ...base,
      status: "succeeded",
      exitCode: 0,
      transcript: {},
    }),
  );
  assert.doesNotThrow(() =>
    validatePublicationArtifact({
      ...base,
      status: "observed-matching",
      observation: { status: "observed", observedOid: commitOid },
    }),
  );
  assert.doesNotThrow(() =>
    validatePublicationArtifact({
      ...base,
      status: "rejected",
      exitCode: 1,
      reason: "git-push-rejected",
    }),
  );
  assert.doesNotThrow(() =>
    validatePublicationArtifact({
      ...base,
      status: "unknown",
      reason: "remote-outcome-unresolved",
    }),
  );
  assert.doesNotThrow(() =>
    validatePublicationArtifact({
      schemaVersion: 1,
      status: "pushed",
      commitOid: "1".repeat(40),
      remote: "origin",
      destination: "refs/heads/main",
      refspec: `${"1".repeat(40)}:refs/heads/main`,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    }),
  );
  assert.throws(
    () =>
      validatePublicationArtifact({
        ...base,
        status: "succeeded",
        exitCode: 0,
      }),
    /publication/iu,
  );
  assert.throws(
    () =>
      validatePublicationArtifact({
        status: "pushed",
        detail: "I think it worked",
      }),
    /publication/iu,
  );
});

test("verification artifacts are structurally bound to one commit", () => {
  const commitOid = "1".repeat(40);
  const artifact = {
    schemaVersion: 2,
    commitOid,
    initialPolicy: "required",
    finalPolicy: "advisory",
    attempts: [
      {
        status: "unavailable",
        reason: "trust-store-unreadable",
        backend: "ssh",
        identity: null,
        timestamp: "2026-08-23T12:00:00.000Z",
      },
    ],
    effectiveAttempt: 0,
    blocksPush: false,
  };

  assert.doesNotThrow(() => validateVerificationArtifact(artifact, commitOid));
  assert.throws(
    () => validateVerificationArtifact(artifact, "2".repeat(40)),
    /different commit/u,
  );
  assert.throws(
    () =>
      validateVerificationArtifact(
        { ...artifact, finalPolicy: "sometimes" },
        commitOid,
      ),
    /verification artifact/iu,
  );
  assert.throws(
    () =>
      validateVerificationArtifact(
        {
          ...artifact,
          attempts: [
            {
              status: "verified",
              reason: null,
              backend: "ssh",
              identity: {
                signer: "Test Signer <test@example.invalid>",
                primaryKeyFingerprint: "3".repeat(40),
                signingSubkeyFingerprint: null,
              },
              timestamp: "2026-08-23T12:01:00.000Z",
            },
          ],
        },
        commitOid,
      ),
    /verification artifact/iu,
  );
});
