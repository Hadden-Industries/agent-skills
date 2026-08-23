import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAXIMUM_CONCISE_RESULT_BYTES,
  createInlineEvidenceCapsule,
  createScopeSynopsis,
} from "../../src/committing-to-git/inspection/inlineEvidenceCapsule.js";
import {
  canonicalizeEvidencePlan,
  createReviewCatalog,
  materializeDeletionPackets,
  materializeInventoryPackets,
  reviseReviewCatalog,
  verifyReviewReceipt,
  writeReviewPacketQueue,
} from "../../src/committing-to-git/inspection/reviewCatalog.js";
import { MAXIMUM_PACKET_BYTES } from "../../src/committing-to-git/inspection/streamingPacketWriter.js";
import {
  commitAll,
  createRepositoryFixture,
  git,
  writeRepositoryFile,
} from "./harness.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function changeUnit(index, overrides = {}) {
  const ordinal = String(index).padStart(6, "0");
  const path = `src/parser/file-${ordinal}.js`;

  return {
    id: `F${ordinal}`,
    kind: "modified",
    sourcePath: null,
    destinationPath: path,
    sourcePathBytesBase64: null,
    destinationPathBytesBase64: Buffer.from(path).toString("base64"),
    displayPath: path,
    oldMode: "100644",
    newMode: "100644",
    oldOid: "1".repeat(40),
    newOid: "2".repeat(40),
    renameClassification: null,
    lineStatistics: "eager",
    binary: false,
    additions: 1,
    deletions: 1,
    ...overrides,
  };
}

function manifest(unitCount, overrides = {}) {
  const changeUnits = Array.from({ length: unitCount }, (_, index) =>
    changeUnit(index + 1),
  );

  return {
    schemaVersion: 2,
    repositoryRoot: "C:/repo",
    headOid: "a".repeat(40),
    indexTreeOid: "b".repeat(40),
    changeUnitCount: changeUnits.length,
    changeUnits,
    statistics: {
      files: changeUnits.length,
      additions: changeUnits.length,
      deletions: changeUnits.length,
      binaryFiles: 0,
    },
    warnings: [],
    ...overrides,
  };
}

function group(policy, basisKind, selection = { all: true }, note = null) {
  return {
    selection,
    policy,
    basis: { kind: basisKind, note },
  };
}

function planFor(testManifest, groups) {
  return canonicalizeEvidencePlan({ manifest: testManifest, groups });
}

function withGroupEvidence(testManifest, evidencePlan, evidenceByGroup) {
  return {
    ...testManifest,
    evidenceByGroupId: Object.fromEntries(
      Object.entries(evidenceByGroup).map(([id, value]) => [
        id,
        Buffer.isBuffer(value) ? value : Buffer.from(value),
      ]),
    ),
    manifestSha256: evidencePlan.manifestSha256,
  };
}

test("reuse evidence remains concise for one, twelve, and one thousand units", () => {
  for (const unitCount of [1, 12, 1_000]) {
    const testManifest = manifest(unitCount);
    const evidencePlan = planFor(testManifest, [
      group("reuse", "authored-current-task"),
    ]);
    const result = createInlineEvidenceCapsule({
      manifest: testManifest,
      evidencePlan,
    });

    assert.equal(result.route, "concise");
    assert.equal(result.extendedReason, null);
    assert.equal(result.capsule.changeUnitCount, unitCount);
    assert.ok(result.capsule.byteCount <= MAXIMUM_CONCISE_RESULT_BYTES);
    assert.deepEqual(result.capsule.unresolved, []);
    assert.equal(
      result.capsule.evidence.every(
        ({ policy, patchText, patchComplete }) =>
          policy === "reuse" && patchText === null && patchComplete === true,
      ),
      true,
    );
  }
});

test("complete inline result size selects concise at the boundary and extended one byte below it", () => {
  const testManifest = manifest(1);
  const evidencePlan = planFor(testManifest, [
    group("message", "user-grounded", { all: true }, "Reported warning"),
  ]);
  const groupId = evidencePlan.groups[0].id;
  const evidenceManifest = withGroupEvidence(testManifest, evidencePlan, {
    [groupId]: "diff --git a/file b/file\n+fixed warning\n",
  });
  const unconstrained = createInlineEvidenceCapsule({
    manifest: evidenceManifest,
    evidencePlan,
    maximumResultBytes: 1024 * 1024,
  });
  const exact = createInlineEvidenceCapsule({
    manifest: evidenceManifest,
    evidencePlan,
    maximumResultBytes: unconstrained.capsule.byteCount,
  });
  const over = createInlineEvidenceCapsule({
    manifest: evidenceManifest,
    evidencePlan,
    maximumResultBytes: unconstrained.capsule.byteCount - 1,
  });

  assert.equal(exact.route, "concise");
  assert.equal(exact.capsule.evidence[0].patchComplete, true);
  assert.match(exact.capsule.evidence[0].patchText, /fixed warning/u);
  assert.equal(over.route, "extended");
  assert.equal(over.capsule, null);
  assert.equal(over.extendedReason, "required-evidence-over-budget");
});

test("invalid UTF-8 required evidence never becomes replacement-decoded complete text", () => {
  const testManifest = manifest(1);
  const evidencePlan = planFor(testManifest, [
    group("message", "user-grounded"),
  ]);
  const evidenceManifest = withGroupEvidence(testManifest, evidencePlan, {
    [evidencePlan.groups[0].id]: Buffer.from([0x61, 0xff, 0x62]),
  });
  const result = createInlineEvidenceCapsule({
    manifest: evidenceManifest,
    evidencePlan,
  });

  assert.equal(result.route, "extended");
  assert.equal(result.capsule, null);
  assert.equal(result.extendedReason, "invalid-evidence-encoding");
  assert.doesNotMatch(JSON.stringify(result), /�/u);
});

test("review and unknown-preexisting evidence select extended independent of file count", () => {
  const reviewedManifest = manifest(1);
  const evidencePlan = planFor(reviewedManifest, [
    group("review", "unknown-preexisting"),
  ]);
  const result = createInlineEvidenceCapsule({
    manifest: reviewedManifest,
    evidencePlan,
  });

  assert.equal(result.route, "extended");
  assert.equal(result.extendedReason, "review-policy");
  assert.equal(result.capsule, null);
});

test("a mandatory bulk synopsis that cannot fit selects its named extended reason", () => {
  const testManifest = manifest(1_000, {
    scopeSynopsis: "mandatory-synopsis-fact\n".repeat(2_000),
  });
  const evidencePlan = planFor(testManifest, [
    group("reuse", "generated-derived"),
  ]);
  const result = createInlineEvidenceCapsule({
    manifest: testManifest,
    evidencePlan,
  });

  assert.equal(result.route, "extended");
  assert.equal(result.extendedReason, "scope-synopsis-over-budget");
  assert.equal(result.capsule, null);
});

test("bulk synopsis splits a raw-byte trie and counts structural anomalies", () => {
  const units = Array.from({ length: 60 }, (_, index) =>
    changeUnit(index + 1, {
      destinationPath: `${index < 30 ? "src/parser" : "src/formatter"}/file-${index + 1}.js`,
      destinationPathBytesBase64: Buffer.from(
        `${index < 30 ? "src/parser" : "src/formatter"}/file-${index + 1}.js`,
      ).toString("base64"),
    }),
  );

  Object.assign(units[0], {
    destinationPath: "invalid-path",
    destinationPathBytesBase64: Buffer.from([0xff, 0x2f, 0x61]).toString(
      "base64",
    ),
  });
  Object.assign(units[1], {
    kind: "type-changed",
    oldMode: "100644",
    newMode: "120000",
  });
  Object.assign(units[2], {
    kind: "submodule-changed",
    oldMode: "160000",
    newMode: "160000",
  });
  Object.assign(units[3], {
    renameClassification: "exact-rename-ambiguous",
    lineStatistics: "deferred",
    additions: null,
    deletions: null,
  });
  const testManifest = manifest(60, {
    changeUnits: units,
    diffPolicy: {
      rename: {
        mode: "deferred",
        candidatePairs: 50_000,
        maximumCandidatePairs: 40_000,
      },
      lineStatistics: {
        mode: "deferred",
        eligibleBlobBytes: 80 * 1024 * 1024,
        maximumEagerBytes: 64 * 1024 * 1024,
      },
    },
  });
  const synopsis = createScopeSynopsis(testManifest);

  assert.match(synopsis.text, /src\/formatter\//u);
  assert.match(synopsis.text, /src\/parser\//u);
  assert.match(synopsis.text, /Non-UTF-8 paths \(1\)/u);
  assert.match(synopsis.text, /Type or mode changes \(1\)/u);
  assert.match(synopsis.text, /Gitlinks \(1\)/u);
  assert.match(synopsis.text, /Rename ambiguity or deferred detection/u);
  assert.match(synopsis.text, /Deferred line statistics \(1\)/u);
  assert.match(synopsis.text, /eligible blob bytes=83886080/u);
  assert.ok(Buffer.byteLength(synopsis.text, "utf8") <= 8 * 1024);
});

test("extended packets preserve invalid UTF-8 as exact raw bytes and lossless hex", (t) => {
  const fixture = createRepositoryFixture(t, "review-catalog-invalid-utf8-");
  const outputDirectory = join(fixture.scratch, "review");
  const testManifest = manifest(1);
  const evidencePlan = planFor(testManifest, [
    group("review", "unknown-preexisting"),
  ]);
  const invalidBytes = Buffer.from([0x61, 0xff, 0x62, 0x0a]);
  const evidenceManifest = withGroupEvidence(testManifest, evidencePlan, {
    [evidencePlan.groups[0].id]: invalidBytes,
  });
  const catalog = createReviewCatalog({
    manifest: evidenceManifest,
    outputDirectory,
    evidencePlan,
  });
  const packet = catalog.packets.find(({ kind }) => kind === "text-patch");

  assert.equal(packet.encoding, "escaped-hex");
  assert.equal(
    readFileSync(join(outputDirectory, packet.rawArtifact)).equals(
      invalidBytes,
    ),
    true,
  );
  assert.match(
    readFileSync(join(outputDirectory, packet.artifact), "utf8"),
    /61 ff 62 0a/u,
  );
  assert.doesNotMatch(
    readFileSync(join(outputDirectory, packet.artifact), "utf8"),
    /�/u,
  );
});

test("evidence plans preserve authored order and partition one thousand units without ID lists", () => {
  const testManifest = manifest(1_000, {
    changeUnits: [
      ...Array.from({ length: 800 }, (_, index) => changeUnit(index + 1)),
      ...Array.from({ length: 100 }, (_, index) =>
        changeUnit(index + 801, {
          destinationPath: `generated/output-${index + 1}.js`,
          destinationPathBytesBase64: Buffer.from(
            `generated/output-${index + 1}.js`,
          ).toString("base64"),
        }),
      ),
      ...Array.from({ length: 100 }, (_, index) =>
        changeUnit(index + 901, {
          destinationPath: `legacy/unknown-${index + 1}.js`,
          destinationPathBytesBase64: Buffer.from(
            `legacy/unknown-${index + 1}.js`,
          ).toString("base64"),
        }),
      ),
    ],
  });
  const evidencePlan = planFor(testManifest, [
    group("message", "user-grounded", {
      destinationPathPrefixes: ["generated/"],
    }),
    group("review", "unknown-preexisting", {
      destinationPathPrefixes: ["legacy/"],
    }),
    group("reuse", "authored-current-task", { remaining: true }),
  ]);

  assert.deepEqual(
    evidencePlan.groups.map(({ id, policy, changeUnitCount }) => ({
      id,
      policy,
      changeUnitCount,
    })),
    [
      { id: "E000001", policy: "message", changeUnitCount: 100 },
      { id: "E000002", policy: "review", changeUnitCount: 100 },
      { id: "E000003", policy: "reuse", changeUnitCount: 800 },
    ],
  );
  assert.equal(
    evidencePlan.groups.some(({ selection }) => "ids" in selection),
    false,
  );
  assert.match(evidencePlan.manifestSha256, SHA256_PATTERN);
  assert.match(evidencePlan.evidencePlanSha256, SHA256_PATTERN);
});

test("evidence plans reject unmatched, overlapping, omitted, and unsafe reuse selections", () => {
  const testManifest = manifest(2);

  assert.throws(
    () =>
      planFor(testManifest, [
        group("message", "user-grounded", { ids: ["F999999"] }),
        group("reuse", "authored-current-task", { remaining: true }),
      ]),
    /matched no change units/u,
  );
  assert.throws(
    () =>
      planFor(testManifest, [
        group("message", "user-grounded", { all: true }),
        group("review", "unknown-preexisting", { ids: ["F000001"] }),
      ]),
    /overlap/u,
  );
  assert.throws(
    () =>
      planFor(testManifest, [
        group("message", "user-grounded", { ids: ["F000001"] }),
      ]),
    /exhaustive/u,
  );
  assert.throws(
    () => planFor(testManifest, [group("reuse", "user-grounded")]),
    /reuse evidence requires/iu,
  );
  assert.throws(
    () => planFor(testManifest, [group("reuse", "task-lineage")]),
    /specific nonempty note/iu,
  );
  assert.throws(
    () =>
      planFor(testManifest, [
        group("reuse", "task-lineage", { all: true }, "   "),
      ]),
    /specific nonempty note/iu,
  );
  assert.doesNotThrow(() =>
    planFor(testManifest, [
      group(
        "reuse",
        "task-lineage",
        { all: true },
        "Task 4 implementation and focused test record",
      ),
    ]),
  );
});

test("catalog, packet, and queue hashes detect modification and remain bounded", (t) => {
  const fixture = createRepositoryFixture(t, "review-catalog-identity-");
  const outputDirectory = join(fixture.scratch, "review");
  const testManifest = manifest(1);
  const evidencePlan = planFor(testManifest, [
    group("review", "unknown-preexisting"),
  ]);
  const evidenceManifest = withGroupEvidence(testManifest, evidencePlan, {
    [evidencePlan.groups[0].id]: "+changed\n".repeat(5_000),
  });
  const catalog = createReviewCatalog({
    manifest: evidenceManifest,
    outputDirectory,
    evidencePlan,
  });
  const requiredIds = [
    ...catalog.requiredSynopsisPacketIds,
    ...catalog.exactInventoryPacketIds,
    ...catalog.fullPatchPacketIds,
  ];
  const queue = writeReviewPacketQueue({
    catalog,
    packetIds: requiredIds,
    queueKind: "initial",
    outputDirectory,
    maximumPageBytes: 1024,
  });
  const repeatedQueue = writeReviewPacketQueue({
    catalog,
    packetIds: requiredIds,
    queueKind: "initial",
    outputDirectory,
    maximumPageBytes: 1024,
  });

  assert.ok(catalog.packets.length > 1);
  assert.match(catalog.catalogSha256, SHA256_PATTERN);
  assert.ok(queue.pageCount > 1);
  assert.deepEqual(repeatedQueue, queue);
  assert.deepEqual(repeatedQueue.pages, queue.pages);
  assert.ok(queue.pages.every(({ byteCount }) => byteCount <= 1024));
  assert.ok(
    catalog.packets.every(
      ({ byteCount, lineCount }) => byteCount <= 16 * 1024 && lineCount <= 200,
    ),
  );

  const firstPacket = catalog.packets[0];
  const firstPacketPath = join(outputDirectory, firstPacket.artifact);
  writeFileSync(firstPacketPath, "modified after catalog creation\n");
  const receipt = {
    schemaVersion: 1,
    catalogSha256: catalog.catalogSha256,
    evidencePlanSha256: catalog.evidencePlanSha256,
    requiredPacketsReviewed: true,
    additionalPacketIds: [],
  };

  assert.throws(
    () => verifyReviewReceipt({ catalogPath: catalog.catalogPath, receipt }),
    /changed after|digest/u,
  );
});

test("catalog creation resumes from identical immutable partial artifacts", (t) => {
  const fixture = createRepositoryFixture(t, "review-catalog-resume-");
  const outputDirectory = join(fixture.scratch, "review");
  const testManifest = manifest(1);
  const evidencePlan = planFor(testManifest, [
    group("reuse", "authored-current-task"),
  ]);
  const routedManifest = {
    ...testManifest,
    preMaterializedPacketsByGroupId: {},
  };
  const first = createReviewCatalog({
    manifest: routedManifest,
    outputDirectory,
    evidencePlan,
  });
  const resumed = createReviewCatalog({
    manifest: routedManifest,
    outputDirectory,
    evidencePlan,
  });

  assert.equal(resumed.catalogPath, first.catalogPath);
  assert.deepEqual(resumed, first);
});

test("one receipt covers the mandatory set without repeating packet or evidence IDs", (t) => {
  const fixture = createRepositoryFixture(t, "review-catalog-receipt-");
  const outputDirectory = join(fixture.scratch, "review");
  const testManifest = manifest(2);
  const evidencePlan = planFor(testManifest, [
    group("review", "unknown-preexisting"),
  ]);
  const evidenceManifest = withGroupEvidence(testManifest, evidencePlan, {
    [evidencePlan.groups[0].id]: "diff --git a/x b/x\n+reviewed\n",
  });
  const catalog = createReviewCatalog({
    manifest: evidenceManifest,
    outputDirectory,
    evidencePlan,
  });
  const receipt = {
    schemaVersion: 1,
    catalogSha256: catalog.catalogSha256,
    evidencePlanSha256: catalog.evidencePlanSha256,
    requiredPacketsReviewed: true,
    additionalPacketIds: [],
  };
  const coverage = verifyReviewReceipt({
    catalogPath: catalog.catalogPath,
    receipt,
  });

  assert.deepEqual(Object.keys(receipt).sort(), [
    "additionalPacketIds",
    "catalogSha256",
    "evidencePlanSha256",
    "requiredPacketsReviewed",
    "schemaVersion",
  ]);
  assert.equal(coverage.complete, true);
  assert.equal(
    coverage.coveredPacketCount,
    new Set([
      ...catalog.requiredSynopsisPacketIds,
      ...catalog.exactInventoryPacketIds,
      ...catalog.fullPatchPacketIds,
    ]).size,
  );
});

test("plan refinement emits only missing packet identities and no dummy queue", (t) => {
  const fixture = createRepositoryFixture(t, "review-catalog-delta-");
  const outputDirectory = join(fixture.scratch, "review");
  const testManifest = manifest(4);
  const initialPlan = planFor(testManifest, [
    group("message", "user-grounded"),
  ]);
  const initialEvidence = withGroupEvidence(testManifest, initialPlan, {
    [initialPlan.groups[0].id]: "small patch\n",
  });
  const initialCatalog = createReviewCatalog({
    manifest: initialEvidence,
    outputDirectory,
    evidencePlan: initialPlan,
  });
  const initialCoverage = verifyReviewReceipt({
    catalogPath: initialCatalog.catalogPath,
    receipt: {
      schemaVersion: 1,
      catalogSha256: initialCatalog.catalogSha256,
      evidencePlanSha256: initialCatalog.evidencePlanSha256,
      requiredPacketsReviewed: true,
      additionalPacketIds: [],
    },
  });
  const reviewPlan = planFor(testManifest, [
    group("review", "unknown-preexisting", { ids: ["F000001"] }),
    group("message", "user-grounded", { remaining: true }),
  ]);
  const reviewEvidence = withGroupEvidence(testManifest, reviewPlan, {
    [reviewPlan.groups[0].id]: "newly required review patch\n",
    [reviewPlan.groups[1].id]: "small patch\n",
  });
  const prior = { ...initialCatalog, priorCoverage: initialCoverage };
  Object.defineProperty(prior, "catalogPath", {
    value: initialCatalog.catalogPath,
  });
  const unchanged = reviseReviewCatalog({
    manifest: initialEvidence,
    priorCatalog: prior,
    evidencePlan: initialPlan,
  });

  assert.deepEqual(unchanged.evidenceDelta.requiredPacketIds, []);
  assert.equal(unchanged.evidenceDelta.queue, null);

  const { catalog, evidenceDelta } = reviseReviewCatalog({
    manifest: reviewEvidence,
    priorCatalog: prior,
    evidencePlan: reviewPlan,
  });

  assert.ok(evidenceDelta.requiredPacketIds.length > 0);
  assert.equal(
    evidenceDelta.requiredPacketIds.some((id) =>
      initialCoverage.coveredPacketIds.includes(id),
    ),
    false,
  );
  assert.equal(catalog.storage.baseIndexArtifact, "base-packet-index.json");
});

test("a revised plan supersedes an unread queue without treating it as coverage", (t) => {
  const fixture = createRepositoryFixture(t, "review-catalog-superseded-");
  const outputDirectory = join(fixture.scratch, "review");
  const testManifest = manifest(3);
  const evidencePlan = planFor(testManifest, [
    group("review", "unknown-preexisting"),
  ]);
  const evidenceManifest = withGroupEvidence(testManifest, evidencePlan, {
    [evidencePlan.groups[0].id]: "complete review patch\n",
  });
  const catalog = createReviewCatalog({
    manifest: evidenceManifest,
    outputDirectory,
    evidencePlan,
  });
  const requiredPacketIds = [
    ...catalog.requiredSynopsisPacketIds,
    ...catalog.exactInventoryPacketIds,
    ...catalog.fullPatchPacketIds,
  ];
  const unreadQueue = writeReviewPacketQueue({
    catalog,
    packetIds: requiredPacketIds,
    queueKind: "initial",
    outputDirectory,
  });
  const unreadPages = unreadQueue.pages.map(({ artifact }) => artifact);
  const revised = reviseReviewCatalog({
    manifest: evidenceManifest,
    priorCatalog: catalog,
    evidencePlan,
  });

  assert.equal(
    revised.evidenceDelta.requiredPacketCount,
    requiredPacketIds.length,
  );
  assert.deepEqual(revised.evidenceDelta.requiredPacketIds, requiredPacketIds);
  assert.equal(
    revised.evidenceDelta.supersededQueue.catalogSha256,
    catalog.catalogSha256,
  );
  assert.equal(
    revised.evidenceDelta.supersededQueue.removedPageCount,
    unreadPages.length,
  );
  assert.equal(
    unreadPages.every(
      (artifact) => !existsSync(join(outputDirectory, artifact)),
    ),
    true,
  );
  assert.equal(
    existsSync(
      join(
        outputDirectory,
        revised.evidenceDelta.supersededQueue.markerArtifact,
      ),
    ),
    true,
  );
});

test("inventory and deletion expansion add only deliberately selected exact evidence", (t) => {
  const fixture = createRepositoryFixture(t, "review-catalog-expansion-");
  const outputDirectory = join(fixture.scratch, "review");
  const deleted = Buffer.from("historical line\n".repeat(2_000));
  const testManifest = manifest(2, {
    changeUnits: [
      changeUnit(1, {
        kind: "deleted",
        newMode: "000000",
        newOid: "0".repeat(40),
        additions: 0,
        deletions: 2_000,
        deletedContent: deleted,
      }),
      changeUnit(2),
    ],
  });
  const evidencePlan = planFor(testManifest, [
    group("reuse", "authored-current-task"),
  ]);
  const catalog = createReviewCatalog({
    manifest: testManifest,
    outputDirectory,
    evidencePlan,
  });
  const inventoryCatalog = materializeInventoryPackets({
    manifest: testManifest,
    catalog,
    selection: { ids: ["F000001"] },
  });
  const deletionCatalog = materializeDeletionPackets({
    manifest: testManifest,
    catalog: inventoryCatalog,
    changeUnitId: "F000001",
  });

  assert.ok(
    inventoryCatalog.exactInventoryPacketIds.length >
      catalog.exactInventoryPacketIds.length,
  );
  assert.ok(
    deletionCatalog.fullPatchPacketIds.length >
      inventoryCatalog.fullPatchPacketIds.length,
  );
  assert.equal(
    deletionCatalog.packets
      .filter(({ kind }) => kind === "deleted-content")
      .every(
        ({ rawSha256 }) => rawSha256 === deletionCatalog.deletions[0].sha256,
      ),
    true,
  );
});

test("deletion expansion streams the recorded old Git blob into bounded exact packets", async (t) => {
  const fixture = createRepositoryFixture(t, "review-catalog-git-deletion-");
  const outputDirectory = join(fixture.scratch, "review");
  const deleted = Buffer.from("historical large line\n".repeat(40_000));
  const path = "archive/large.txt";

  writeRepositoryFile(fixture.repo, path, deleted);
  commitAll(fixture.repo);
  const oldOid = git(["rev-parse", `HEAD:${path}`], fixture.repo).stdout.trim();
  const testManifest = manifest(1, {
    repositoryRoot: fixture.repo,
    changeUnits: [
      changeUnit(1, {
        kind: "deleted",
        destinationPath: path,
        destinationPathBytesBase64: Buffer.from(path).toString("base64"),
        oldOid,
        newMode: "000000",
        newOid: "0".repeat(40),
        additions: 0,
        deletions: 40_000,
      }),
    ],
  });
  const evidencePlan = planFor(testManifest, [
    group("reuse", "authored-current-task"),
  ]);
  const catalog = createReviewCatalog({
    manifest: testManifest,
    outputDirectory,
    evidencePlan,
  });
  const deletionCatalog = await materializeDeletionPackets({
    manifest: testManifest,
    catalog,
    changeUnitId: "F000001",
  });
  const packets = deletionCatalog.packets.filter(
    ({ kind }) => kind === "deleted-content",
  );
  const rawArtifacts = new Set(packets.map(({ rawArtifact }) => rawArtifact));

  assert.ok(packets.length > 1);
  assert.equal(rawArtifacts.size, 1);
  assert.equal(
    readFileSync(join(outputDirectory, [...rawArtifacts][0])).equals(deleted),
    true,
  );
  assert.equal(
    packets.every(
      ({ artifact, byteCount, lineCount }) =>
        byteCount <= MAXIMUM_PACKET_BYTES &&
        statSync(join(outputDirectory, artifact)).size <=
          MAXIMUM_PACKET_BYTES &&
        lineCount <= 200,
    ),
    true,
  );
  assert.equal(deletionCatalog.deletions[0].byteCount, deleted.length);
});

test("one thousand binary units create bounded synopsis and on-demand inventory without metadata packets", (t) => {
  const fixture = createRepositoryFixture(t, "review-catalog-binary-");
  const outputDirectory = join(fixture.scratch, "review");
  const units = Array.from({ length: 1_000 }, (_, index) =>
    changeUnit(index + 1, {
      destinationPath: `assets/generated-${index + 1}.bin`,
      destinationPathBytesBase64: Buffer.from(
        `assets/generated-${index + 1}.bin`,
      ).toString("base64"),
      binary: true,
      additions: null,
      deletions: null,
    }),
  );
  const testManifest = manifest(1_000, {
    changeUnits: units,
    statistics: {
      files: 1_000,
      additions: 0,
      deletions: 0,
      binaryFiles: 1_000,
    },
  });
  const evidencePlan = planFor(testManifest, [
    group("review", "unknown-preexisting"),
  ]);
  const catalog = createReviewCatalog({
    manifest: testManifest,
    outputDirectory,
    evidencePlan,
  });

  assert.equal(
    catalog.packets.some(({ kind }) => kind === "binary-metadata"),
    false,
  );
  assert.ok(catalog.requiredSynopsisPacketIds.length <= 2);
  assert.ok(catalog.exactInventoryPacketIds.length > 0);
  assert.equal(
    readdirSync(join(outputDirectory, "packets")).length,
    catalog.packets.length,
  );
  assert.equal(existsSync(join(outputDirectory, "inventory.md")), false);
});

test("one hundred unchanged plan revisions share one packet base instead of copying it", (t) => {
  const fixture = createRepositoryFixture(t, "review-catalog-revisions-");
  const outputDirectory = join(fixture.scratch, "review");
  const testManifest = manifest(1_000);
  const evidencePlan = planFor(testManifest, [
    group("review", "unknown-preexisting"),
  ]);
  const evidenceManifest = withGroupEvidence(testManifest, evidencePlan, {
    [evidencePlan.groups[0].id]: "complete shared review patch\n",
  });
  let catalog = createReviewCatalog({
    manifest: evidenceManifest,
    outputDirectory,
    evidencePlan,
  });
  const coverage = verifyReviewReceipt({
    catalogPath: catalog.catalogPath,
    receipt: {
      schemaVersion: 1,
      catalogSha256: catalog.catalogSha256,
      evidencePlanSha256: catalog.evidencePlanSha256,
      requiredPacketsReviewed: true,
      additionalPacketIds: [],
    },
  });
  const initialPacketCount = readdirSync(
    join(outputDirectory, "packets"),
  ).length;
  const baseIndexBytes = statSync(
    join(outputDirectory, "base-packet-index.json"),
  ).size;

  for (let revision = 0; revision < 100; revision += 1) {
    const prior = { ...catalog, priorCoverage: coverage };
    Object.defineProperty(prior, "catalogPath", { value: catalog.catalogPath });
    catalog = reviseReviewCatalog({
      manifest: evidenceManifest,
      priorCatalog: prior,
      evidencePlan,
    }).catalog;
  }

  const revisionFiles = readdirSync(join(outputDirectory, "revisions"));
  const revisionBytes = revisionFiles.reduce(
    (total, name) =>
      total + statSync(join(outputDirectory, "revisions", name)).size,
    0,
  );

  assert.equal(revisionFiles.length, 100);
  assert.equal(
    readdirSync(join(outputDirectory, "packets")).length,
    initialPacketCount,
  );
  assert.ok(revisionBytes < baseIndexBytes * 5);
  assert.equal(catalog.storage.revisionCount, 100);
});
