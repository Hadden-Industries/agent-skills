// Validation for agent-authored post-commit evidence artifacts.
import assert from "node:assert/strict";
import test from "node:test";

import {
  validateChecksArtifact,
  validatePublicationArtifact,
  validateVerificationArtifact,
} from "../../src/committing-to-git/report/commitReport.js";

test("check artifacts use exact result and execution-context vocabularies", () => {
  assert.doesNotThrow(() =>
    validateChecksArtifact({
      schemaVersion: 1,
      checks: [
        {
          label: "Focused Node tests",
          status: "passed",
          context: "current working tree",
        },
      ],
    }),
  );
  assert.throws(
    () =>
      validateChecksArtifact({
        schemaVersion: 1,
        checks: [
          {
            label: "Focused Node tests",
            status: "probably passed",
            context: "somewhere",
          },
        ],
      }),
    /status|context/u,
  );
});

test("publication artifacts distinguish not-requested, pushed, and failed", () => {
  assert.doesNotThrow(() =>
    validatePublicationArtifact({ status: "not-requested" }),
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
