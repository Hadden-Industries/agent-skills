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
    schemaVersion: 1,
    commitOid,
    initialPolicy: "required",
    finalPolicy: "advisory",
    overridden: true,
    signature: {
      status: "unavailable",
      reason: "trust-store-unreadable",
      signer: null,
      fingerprint: null,
    },
    integrityOnly: { status: "not-run" },
    signatureVerified: false,
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
});
