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

test("transaction and scope schemas expose the strict preparation contracts", () => {
  const transaction = {
    schemaVersion: 1,
    phase: "allocated",
    repositoryRoot: "C:/repo",
    attemptDirectory:
      "C:/temp/committing-to-git-123e4567-e89b-42d3-a456-426614174000",
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
  const scope = {
    schemaVersion: 2,
    includePaths: ["Dockerfile"],
    includePathPrefixes: ["src/parser/"],
    excludePaths: ["src/parser/generated.lock"],
    excludePathPrefixes: [],
    includePathBytesBase64: [],
    excludePathBytesBase64: [],
  };

  const transactionSchema = schema("commitTransaction.schema.json");
  const scopeSchema = schema("commitScope.schema.json");

  assert.deepEqual(schemaErrors(transaction, transactionSchema), []);
  assert.deepEqual(schemaErrors(scope, scopeSchema), []);

  const unknownPhase = structuredClone(transaction);
  unknownPhase.phase = "invented";
  assert.match(
    schemaErrors(unknownPhase, transactionSchema).join("\n"),
    /phase/u,
  );

  const impossibleState = structuredClone(transaction);
  impossibleState.status = "published";
  impossibleState.terminalDisposition = "published";
  assert.match(
    schemaErrors(impossibleState, transactionSchema).join("\n"),
    /state|oneOf/u,
  );

  const invalidDetachedAnchor = structuredClone(transaction);
  invalidDetachedAnchor.headAnchor = {
    headKind: "detached",
    targetRef: "refs/heads/main",
    expectedParentOids: ["a".repeat(40)],
  };
  assert.match(
    schemaErrors(invalidDetachedAnchor, transactionSchema).join("\n"),
    /headAnchor|oneOf/u,
  );

  const unknownTransactionMember = structuredClone(transaction);
  unknownTransactionMember.registry = "latest";
  assert.match(
    schemaErrors(unknownTransactionMember, transactionSchema).join("\n"),
    /registry/u,
  );

  const invalidPrefix = structuredClone(scope);
  invalidPrefix.includePathPrefixes = ["src/parser"];
  assert.match(
    schemaErrors(invalidPrefix, scopeSchema).join("\n"),
    /Prefixes/u,
  );

  const unknownScopeMember = structuredClone(scope);
  unknownScopeMember.glob = "src/**";
  assert.match(
    schemaErrors(unknownScopeMember, scopeSchema).join("\n"),
    /glob/u,
  );
});

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
    schemaVersion: 2,
    indexTreeOid: "2".repeat(40),
    reviewPatchSha256: "5".repeat(64),
    reviewPatchBytes: 128,
    summarizedDeletionCount: 1,
    summarizedTextDeletionLines: 24,
    expandedDeletions: [
      {
        changeUnitId: "F000002",
        oldOid: "7".repeat(40),
        byteCount: 96,
        sha256: "8".repeat(64),
        unitIds: ["F000002-D000001"],
      },
    ],
    unitCount: 2,
    reviewedCount: 2,
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
      {
        id: "F000002-D000001",
        kind: "deleted-content",
        changeUnitId: "F000002",
        artifact: "deletions/F000002/D000001.deleted",
        byteStart: 0,
        byteEnd: 96,
        byteCount: 96,
        lineCount: 6,
        sha256: "8".repeat(64),
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
