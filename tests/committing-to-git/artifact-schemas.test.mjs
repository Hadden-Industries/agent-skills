import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import { schemaErrors } from "../helpers/json-schema.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEMA_DIR = join(REPO_ROOT, "src", "committing-to-git", "schema");

function schema(name) {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, name), "utf8"));
}

test("workflow artifact schemas accept representative cross-script payloads", () => {
  const snapshot = {
    schemaVersion: 2,
    workflowMode: "actual",
    scopeKind: "staged",
    sourceIndex: "real",
    repositoryRoot: "C:/repo",
    headOid: "1".repeat(40),
    indexTreeOid: "2".repeat(40),
    indexFile: null,
    diffPolicy: {
      renameScore: 50,
      copyDetection: false,
      renameLimit: 1000,
      externalDiff: false,
      textconv: false,
    },
    changeUnitCount: 1,
    changeUnits: [
      {
        id: "F000001",
        kind: "modified",
        sourcePath: null,
        destinationPath: "src/file.js",
        path: "src/file.js",
        sourcePathBytesBase64: null,
        destinationPathBytesBase64: "c3JjL2ZpbGUuanM=",
        displayPath: "src/file.js",
        oldMode: "100644",
        newMode: "100644",
        oldOid: "3".repeat(40),
        newOid: "4".repeat(40),
        similarity: null,
        binary: false,
        additions: 1,
        deletions: 0,
        stageablePaths: [],
        inspectionUnitIds: [],
      },
    ],
    statistics: { files: 1, additions: 1, deletions: 0, binaryFiles: 0 },
    warnings: [],
  };
  const content = {
    subject: {
      type: "fix",
      scope: "parser",
      description: "Prevent invalid input",
    },
    rationale: [],
    userExperienceChanges: [],
    mode: "detailed",
    changeEntries: [
      {
        changeUnitId: "F000001",
        reasons: ["Reject invalid input before parsing"],
      },
    ],
  };
  const ledger = {
    schemaVersion: 1,
    indexTreeOid: "2".repeat(40),
    sourcePatchSha256: "5".repeat(64),
    sourcePatchBytes: 128,
    unitCount: 1,
    reviewedCount: 1,
    complete: true,
    units: [
      {
        id: "C000001",
        kind: "text-patch",
        artifact: "chunks/C000001.patch",
        byteStart: 0,
        byteEnd: 128,
        byteCount: 128,
        lineCount: 8,
        sha256: "5".repeat(64),
        status: "reviewed",
      },
    ],
  };
  const verification = {
    schemaVersion: 1,
    commitOid: "6".repeat(40),
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
  const report = {
    schemaVersion: 1,
    commit: {
      oid: "6".repeat(40),
      parents: ["1".repeat(40)],
      treeOid: "2".repeat(40),
      author: { name: "Test", email: "test@example.invalid" },
      committer: { name: "Test", email: "test@example.invalid" },
      subject: "fix(parser): Prevent invalid input",
      message: "fix(parser): Prevent invalid input\n",
      signed: true,
      branch: "main",
      shortOid: "6".repeat(12),
      treeMatches: true,
      messageMatches: true,
      parentMatches: true,
    },
    statistics: {
      files: 1,
      additions: 1,
      deletions: 0,
      binaryFiles: 0,
      kinds: { modified: 1 },
    },
    verification,
    checks: { schemaVersion: 1, checks: [] },
    publication: { status: "not-requested" },
    workspace: { staged: [], unstaged: [], untracked: [], conflicted: [] },
  };
  const publication = {
    schemaVersion: 1,
    status: "pushed",
    commitOid: "6".repeat(40),
    remote: "origin",
    destination: "refs/heads/main",
    refspec: `${"6".repeat(40)}:refs/heads/main`,
    exitCode: 0,
    stdout: "To example.invalid/repository\n",
    stderr: "",
  };

  assert.deepEqual(
    schemaErrors(snapshot, schema("commitSnapshot.schema.json")),
    [],
  );

  const copyDetectionSnapshot = structuredClone(snapshot);

  copyDetectionSnapshot.diffPolicy.copyDetection = true;
  assert.match(
    schemaErrors(
      copyDetectionSnapshot,
      schema("commitSnapshot.schema.json"),
    ).join("\n"),
    /copyDetection/u,
  );

  const copyDetectedSnapshot = structuredClone(snapshot);

  copyDetectedSnapshot.changeUnits[0].kind = "copied";
  assert.match(
    schemaErrors(
      copyDetectedSnapshot,
      schema("commitSnapshot.schema.json"),
    ).join("\n"),
    /kind/u,
  );
  assert.deepEqual(
    schemaErrors(content, schema("commitMessageContent.schema.json")),
    [],
  );
  assert.deepEqual(
    schemaErrors(ledger, schema("inspectionLedger.schema.json")),
    [],
  );
  assert.deepEqual(
    schemaErrors(verification, schema("signatureVerification.schema.json")),
    [],
  );
  assert.deepEqual(
    schemaErrors(report, schema("postCommitReport.schema.json")),
    [],
  );
  assert.deepEqual(
    schemaErrors(publication, schema("publicationResult.schema.json")),
    [],
  );
});
