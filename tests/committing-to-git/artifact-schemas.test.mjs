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
  const messageState = {
    schemaVersion: 1,
    revision: 2,
    sha256: "a".repeat(64),
    source: "checked-file",
    byteCount: 40,
    stateSha256: "b".repeat(64),
    validationSha256: "c".repeat(64),
    slot: "message/current",
  };

  assert.deepEqual(schemaErrors(transaction, transactionSchema), []);
  assert.deepEqual(schemaErrors(scope, scopeSchema), []);
  assert.deepEqual(
    schemaErrors(messageState, transactionSchema.$defs.messageState),
    [],
  );

  const historicalSlot = { ...messageState, slot: "message/revision-2" };
  assert.match(
    schemaErrors(historicalSlot, transactionSchema.$defs.messageState).join(
      "\n",
    ),
    /slot|oneOf/u,
  );

  const pendingCommit = {
    ...structuredClone(transaction),
    phase: "commit-pending",
    mode: "actual",
    status: "outcome-unknown",
    route: "concise",
    headAnchor: {
      headKind: "attached",
      targetRef: "refs/heads/main",
      expectedParentOids: ["1".repeat(40)],
    },
    message: messageState,
    commit: {
      status: "pending",
      launchState: "launching",
      childIdentity: null,
      headAnchor: {
        headKind: "attached",
        targetRef: "refs/heads/main",
        expectedParentOids: ["1".repeat(40)],
      },
      expectedTreeOid: "2".repeat(40),
      messageSha256: "a".repeat(64),
      messageByteCount: 40,
      checks: {
        value: { schemaVersion: 1, checks: [] },
        sha256: "b".repeat(64),
        externalPath: null,
      },
      startedAt: "2026-08-23T12:00:00.000Z",
      completion: null,
      transcript: null,
      commitOid: null,
      comparison: null,
      observationProvenance: null,
      recoveryObservations: null,
      recoveryResolution: null,
    },
  };

  assert.deepEqual(schemaErrors(pendingCommit, transactionSchema), []);
  const sha256PendingCommit = structuredClone(pendingCommit);

  sha256PendingCommit.headAnchor.expectedParentOids = ["1".repeat(64)];
  sha256PendingCommit.commit.headAnchor.expectedParentOids = ["1".repeat(64)];
  sha256PendingCommit.commit.expectedTreeOid = "2".repeat(64);
  assert.deepEqual(schemaErrors(sha256PendingCommit, transactionSchema), []);

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

  const incompleteEvidenceState = {
    ...structuredClone(transaction),
    phase: "evidence-ready",
    status: "prepared",
  };
  assert.match(
    schemaErrors(incompleteEvidenceState, transactionSchema).join("\n"),
    /route|inlineEvidence|oneOf/u,
  );

  const incompleteReviewState = {
    ...structuredClone(transaction),
    phase: "review-pending",
    status: "review-pending",
  };
  assert.match(
    schemaErrors(incompleteReviewState, transactionSchema).join("\n"),
    /route|review|oneOf/u,
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
    temporaryObjectDirectory: null,
    objectAlternates: [],
    sourceIndexIdentity: {
      state: "file",
      byteCount: 128,
      sha256: "a".repeat(64),
    },
    promotionBlocker: null,
    diffPolicy: {
      renameScore: 50,
      copyDetection: false,
      renameLimit: 0,
      externalDiff: false,
      textconv: false,
      rename: {
        mode: "eager",
        maximumCandidatePairs: 40_000,
        addedCandidates: 0,
        deletedCandidates: 0,
        candidatePairs: 0,
      },
      lineStatistics: {
        mode: "eager",
        maximumEagerBytes: 64 * 1024 * 1024,
        eligibleBlobBytes: 128,
      },
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
        renameClassification: null,
        lineStatistics: "eager",
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
    schemaVersion: 2,
    authoringState: "complete",
    review: {
      schemaVersion: 1,
      catalogSha256: "a".repeat(64),
      evidencePlanSha256: "b".repeat(64),
      requiredPacketsReviewed: true,
      additionalPacketIds: [],
    },
    evidenceGroups: [
      {
        selection: { all: true },
        policy: "reuse",
        basis: { kind: "authored-current-task", note: null },
      },
    ],
    subject: {
      type: "fix",
      scope: "parser",
      description: "Prevent invalid input",
    },
    sharedRationales: [],
    userExperienceChanges: [],
    mode: "detailed",
    fileNotes: [],
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
    schemaVersion: 2,
    commitOid: "6".repeat(40),
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
      messageSha256: "9".repeat(64),
      signed: true,
      signatureHeaders: ["gpgsig"],
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
  const approvedValidation = {
    schemaVersion: 1,
    valid: true,
    route: "concise",
    messageSource: "checked-file",
    byteCount: 35,
    messageSha256: "9".repeat(64),
    displayText: "fix(parser): Prevent invalid input\n",
    subject: {
      text: "fix(parser): Prevent invalid input",
      type: "fix",
      scope: "parser",
      description: "Prevent invalid input",
      scalarLength: 34,
    },
    sections: {
      rationale: { present: false, entryCount: 0 },
      userExperience: { present: false, entryCount: 0 },
      fileChanges: { present: false, entryCount: 0 },
    },
    files: {
      expectedCount: 1,
      listedCount: 0,
      setMatches: true,
      orderValid: true,
      unique: true,
    },
    presentationWarnings: { count: 0, samples: [], sha256: null },
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
    schemaErrors(
      approvedValidation,
      schema("commitMessageValidation.schema.json"),
    ),
    [],
  );

  const draftContent = {
    ...structuredClone(content),
    authoringState: "draft",
    subject: null,
    recommendedMode: "detailed",
  };
  draftContent.review.requiredPacketsReviewed = false;
  assert.deepEqual(
    schemaErrors(draftContent, schema("commitMessageContent.schema.json")),
    [],
  );

  const incompleteCompleteContent = structuredClone(content);
  incompleteCompleteContent.subject = null;
  assert.match(
    schemaErrors(
      incompleteCompleteContent,
      schema("commitMessageContent.schema.json"),
    ).join("\n"),
    /subject|oneOf/u,
  );

  const unreviewedCompleteContent = structuredClone(content);
  unreviewedCompleteContent.review.requiredPacketsReviewed = false;
  assert.match(
    schemaErrors(
      unreviewedCompleteContent,
      schema("commitMessageContent.schema.json"),
    ).join("\n"),
    /requiredPacketsReviewed|oneOf/u,
  );

  const oldContent = {
    subject: content.subject,
    rationale: [],
    userExperienceChanges: [],
    mode: "detailed",
    changeEntries: [],
  };
  assert.match(
    schemaErrors(oldContent, schema("commitMessageContent.schema.json")).join(
      "\n",
    ),
    /oneOf|schemaVersion/u,
  );
  assert.deepEqual(
    schemaErrors(ledger, schema("inspectionLedger.schema.json")),
    [],
  );
  assert.deepEqual(
    schemaErrors(verification, schema("signatureVerification.schema.json")),
    [],
  );
  const mismatchedVerificationIdentity = structuredClone(verification);

  mismatchedVerificationIdentity.attempts = [
    {
      status: "verified",
      reason: null,
      backend: "ssh",
      identity: {
        signer: "Test Signer <test@example.invalid>",
        primaryKeyFingerprint: "7".repeat(40),
        signingSubkeyFingerprint: null,
      },
      timestamp: "2026-08-23T12:01:00.000Z",
    },
  ];
  assert.match(
    schemaErrors(
      mismatchedVerificationIdentity,
      schema("signatureVerification.schema.json"),
    ).join("\n"),
    /oneOf|identity|backend/u,
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

test("proportional review schemas bind concise evidence, immutable packets, and one receipt", () => {
  const range = { first: "F000001", last: "F000012" };
  const evidencePlan = {
    schemaVersion: 1,
    manifestSha256: "a".repeat(64),
    groups: [
      {
        id: "E000001",
        selection: { all: true },
        policy: "message",
        basis: { kind: "user-grounded", note: "Reported warning" },
        changeUnitRanges: [range],
        changeUnitCount: 12,
      },
    ],
    evidencePlanSha256: "d".repeat(64),
  };
  const capsule = {
    schemaVersion: 1,
    manifestSha256: "a".repeat(64),
    evidencePlanSha256: "d".repeat(64),
    changeUnitCount: 12,
    scopeSynopsis: "12 parser changes with no unexplained anomalies",
    evidence: [
      {
        policy: "message",
        selectionSummary: "all 12 change units",
        basisKind: "user-grounded",
        basisNote: "Reported warning",
        patchText: "diff --git a/parser.js b/parser.js\n",
        patchComplete: true,
      },
    ],
    unresolved: [],
    byteCount: 1024,
  };
  const packet = {
    id: "S000001",
    kind: "scope-synopsis",
    artifact: `packets/${"b".repeat(64)}.packet`,
    byteCount: 512,
    lineCount: 12,
    sha256: "b".repeat(64),
    rawArtifact: `raw/${"c".repeat(64)}.bin`,
    rawByteStart: 0,
    rawByteEnd: 128,
    rawByteCount: 128,
    rawSha256: "c".repeat(64),
    encoding: "utf-8",
    changeUnitRanges: [range],
    changeUnitCount: 12,
  };
  const catalog = {
    schemaVersion: 1,
    indexTreeOid: "1".repeat(40),
    manifestSha256: "a".repeat(64),
    evidencePlanSha256: "d".repeat(64),
    evidenceGroups: [
      {
        id: "E000001",
        policy: "message",
        changeUnitRanges: [range],
        changeUnitCount: 12,
        requiredTextPatchRanges: [range],
        requiredTextPatchCount: 12,
      },
    ],
    inlineCoverage: { scopeSynopsis: false, evidenceGroupIds: [] },
    packets: [packet],
    requiredSynopsisPacketIds: ["S000001"],
    exactInventoryPacketIds: [],
    fullPatchPacketIds: [],
    deletions: [],
    storage: {
      kind: "base-plus-revisions",
      baseIndexArtifact: "base-packet-index.json",
      baseIndexSha256: "e".repeat(64),
      revisionCount: 0,
      currentRevisionArtifact: null,
    },
    catalogSha256: "f".repeat(64),
  };
  const queue = {
    schemaVersion: 1,
    kind: "initial",
    catalogSha256: "f".repeat(64),
    evidencePlanSha256: "d".repeat(64),
    requiredPacketCount: 1,
    pageCount: 1,
    firstPage: {
      artifact: "queues/initial-ffffffffffff-Q000001.json",
      sha256: "9".repeat(64),
      byteCount: 512,
      packetCount: 1,
    },
  };
  const receipt = {
    schemaVersion: 1,
    catalogSha256: "f".repeat(64),
    evidencePlanSha256: "d".repeat(64),
    requiredPacketsReviewed: true,
    additionalPacketIds: [],
  };

  assert.deepEqual(
    schemaErrors(capsule, schema("inlineEvidenceCapsule.schema.json")),
    [],
  );
  assert.deepEqual(
    schemaErrors(evidencePlan, schema("reviewEvidencePlan.schema.json")),
    [],
  );
  assert.deepEqual(
    schemaErrors(catalog, schema("reviewCatalog.schema.json")),
    [],
  );
  assert.deepEqual(
    schemaErrors(queue, schema("reviewPacketQueue.schema.json")),
    [],
  );
  assert.deepEqual(
    schemaErrors(receipt, schema("reviewReceipt.schema.json")),
    [],
  );

  const incomplete = structuredClone(capsule);
  incomplete.evidence[0].patchComplete = false;
  assert.match(
    schemaErrors(incomplete, schema("inlineEvidenceCapsule.schema.json")).join(
      "\n",
    ),
    /patchComplete/u,
  );

  const missingMessagePatch = structuredClone(capsule);
  missingMessagePatch.evidence[0].patchText = null;
  assert.match(
    schemaErrors(
      missingMessagePatch,
      schema("inlineEvidenceCapsule.schema.json"),
    ).join("\n"),
    /patchText|oneOf/u,
  );

  const emptySelectionPlan = structuredClone(evidencePlan);
  emptySelectionPlan.groups[0].selection = {};
  assert.match(
    schemaErrors(
      emptySelectionPlan,
      schema("reviewEvidencePlan.schema.json"),
    ).join("\n"),
    /selection|minProperties|oneOf/u,
  );

  const oversizedQueuePage = structuredClone(queue);
  oversizedQueuePage.firstPage.byteCount = 16 * 1024 + 1;
  assert.match(
    schemaErrors(
      oversizedQueuePage,
      schema("reviewPacketQueue.schema.json"),
    ).join("\n"),
    /byteCount|maximum/u,
  );
});
