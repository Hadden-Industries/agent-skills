import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  readCanonicalMessage,
  recoverCanonicalMessageReplacement,
  replaceCanonicalMessage,
} from "../../src/committing-to-git/message/canonicalMessageState.js";
import { validateApprovedMessage } from "../../src/committing-to-git/message/approvedMessage.js";
import {
  advanceTransaction,
  createTransactionWorkspace,
  readTransaction,
  updateTransaction,
} from "../../src/committing-to-git/transaction/transactionWorkspace.js";
import { createRepositoryFixture } from "./harness.mjs";

const FULL_OID = "a".repeat(40);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function manifestFixture() {
  const path = "src/parser.js";

  return {
    schemaVersion: 3,
    indexTreeOid: FULL_OID,
    changeUnitCount: 1,
    changeUnits: [
      {
        id: "F000001",
        kind: "modified",
        sourcePath: null,
        destinationPath: path,
        sourcePathBytesBase64: null,
        destinationPathBytesBase64: Buffer.from(path).toString("base64"),
      },
    ],
  };
}

function validationFor(bytes, { route = "concise" } = {}) {
  return validateApprovedMessage({
    manifest: manifestFixture(),
    route,
    bytes,
    repositoryTypePolicy: { allowedTypes: null },
    messageSource:
      route === "concise" ? "checked-file" : "structured-finalizer",
    ...(route === "extended"
      ? {
          structuredContent: {
            evidenceGroups: [
              {
                selection: { all: true },
                policy: "reuse",
                basis: { kind: "authored-current-task", note: null },
              },
            ],
            sharedRationales: [],
            fileNotes: [],
            mode: "detailed",
          },
        }
      : {}),
  });
}

function createMessageTransaction(t, { route = "concise" } = {}) {
  const fixture = createRepositoryFixture(t, `canonical-${route}-`);
  const workspace = createTransactionWorkspace({
    repositoryRoot: fixture.repo,
    temporaryRoot: fixture.scratch,
  });
  const allocated = updateTransaction(workspace.transactionPath, "allocated", {
    ...workspace.transaction,
    mode: "actual",
    scope: { kind: "staged" },
    headAnchor: {
      headKind: "attached",
      targetRef: "refs/heads/main",
      expectedParentOids: [FULL_OID],
    },
    initialEvidencePlan: { sha256: "b".repeat(64) },
    snapshot: {
      path: join(workspace.attemptDirectory, "snapshot.json"),
      sha256: "c".repeat(64),
      indexTreeOid: FULL_OID,
      changeUnitCount: 1,
    },
  });
  const snapshotCreated = advanceTransaction(
    workspace.transactionPath,
    "allocated",
    { ...allocated, phase: "snapshot-created" },
  );

  if (route === "concise") {
    advanceTransaction(workspace.transactionPath, "snapshot-created", {
      ...snapshotCreated,
      phase: "evidence-ready",
      status: "prepared",
      route,
      inlineEvidence: {
        capsuleSha256: "d".repeat(64),
        manifestSha256: "e".repeat(64),
        evidencePlanSha256: "f".repeat(64),
        capsule: { schemaVersion: 1 },
      },
      review: null,
    });
  } else {
    advanceTransaction(workspace.transactionPath, "snapshot-created", {
      ...snapshotCreated,
      phase: "authoring-pending",
      status: "authoring-pending",
      route,
      inlineEvidence: null,
      review: {
        catalogPath: join(workspace.attemptDirectory, "catalog.json"),
        catalogSha256: "d".repeat(64),
        evidencePlanPath: join(workspace.attemptDirectory, "plan.json"),
        evidencePlanSha256: "e".repeat(64),
        extendedReason: "review-policy",
        deliveryPacketIds: [],
        queue: null,
        receipt: {
          schemaVersion: 1,
          catalogSha256: "d".repeat(64),
          evidencePlanSha256: "e".repeat(64),
          requiredPacketsReviewed: true,
          additionalPacketIds: [],
        },
        semanticStructureRequired: false,
        structuredMessageMode: "detailed",
        traversal: null,
      },
    });
  }

  return { ...fixture, ...workspace };
}

function replacement(transactionPath, subject, options = {}) {
  const bytes = Buffer.from(`${subject}\n`, "utf8");

  return replaceCanonicalMessage({
    transactionPath,
    bytes,
    validation: validationFor(bytes, {
      route: options.source === "finalized-extended" ? "extended" : "concise",
    }),
    source: options.source ?? "checked-file",
    ...(options.failureInjector
      ? { failureInjector: options.failureInjector }
      : {}),
  });
}

test("canonical replacement keeps one exact current revision", (t) => {
  const fixture = createMessageTransaction(t);
  const first = replacement(
    fixture.transactionPath,
    "fix(parser): Prevent malformed token acceptance",
  );
  const second = replacement(
    fixture.transactionPath,
    "fix(parser): Reject malformed token acceptance",
  );
  const current = readCanonicalMessage(fixture.transactionPath);
  const messageDirectory = join(fixture.attemptDirectory, "message");

  assert.equal(first.messageRevision, 1);
  assert.equal(second.messageRevision, 2);
  assert.equal(current.messageRevision, 2);
  assert.equal(current.messageSource, "checked-file");
  assert.equal(
    current.bytes.toString("utf8"),
    "fix(parser): Reject malformed token acceptance\n",
  );
  assert.match(current.messageSha256, SHA256_PATTERN);
  assert.deepEqual(readdirSync(messageDirectory), ["current"]);
  assert.deepEqual(
    readTransaction(fixture.transactionPath).message,
    current.transactionState,
  );
});

test("one hundred successful revisions retain constant-space storage", (t) => {
  const fixture = createMessageTransaction(t);

  for (let revision = 1; revision <= 100; revision += 1) {
    replacement(
      fixture.transactionPath,
      `fix(parser): Preserve parser contract ${revision}`,
    );
  }

  const current = readCanonicalMessage(fixture.transactionPath);
  const messageDirectory = join(fixture.attemptDirectory, "message");

  assert.equal(current.messageRevision, 100);
  assert.deepEqual(readdirSync(messageDirectory), ["current"]);
  assert.equal(
    readdirSync(fixture.attemptDirectory).some((name) =>
      /message.*(?:revision|[0-9]{6})/iu.test(name),
    ),
    false,
  );
});

test("a failed candidate preserves the last valid revision", (t) => {
  const fixture = createMessageTransaction(t);
  const first = replacement(
    fixture.transactionPath,
    "fix(parser): Preserve parser behavior",
  );
  const bytes = Buffer.from("fix(parser): Reject invalid input\n");
  const validation = validationFor(bytes);
  validation.messageSha256 = "0".repeat(64);

  assert.throws(
    () =>
      replaceCanonicalMessage({
        transactionPath: fixture.transactionPath,
        bytes,
        validation,
        source: "checked-file",
      }),
    /validation.*message/iu,
  );
  assert.equal(
    readCanonicalMessage(fixture.transactionPath).messageSha256,
    first.messageSha256,
  );
  assert.equal(readTransaction(fixture.transactionPath).message.revision, 1);
});

test("interruption recovery exposes exactly one durable revision", (t) => {
  const rollbackPoints = new Set([
    "before-candidate-flush",
    "after-candidate-flush",
    "before-journal-flush",
  ]);
  const points = [
    ...rollbackPoints,
    "after-journal-flush",
    "before-current-to-previous",
    "after-current-to-previous",
    "before-candidate-to-current",
    "after-candidate-to-current",
    "before-transaction-advance",
    "after-transaction-advance",
    "before-remnant-cleanup",
    "after-remnant-cleanup",
  ];

  for (const point of points) {
    const fixture = createMessageTransaction(t);
    const first = replacement(
      fixture.transactionPath,
      "fix(parser): Preserve parser behavior",
    );
    let injected = false;

    assert.throws(
      () =>
        replacement(
          fixture.transactionPath,
          "fix(parser): Reject malformed parser input",
          {
            failureInjector(candidate) {
              if (candidate === point) {
                injected = true;
                throw new Error(`interrupted at ${point}`);
              }
            },
          },
        ),
      new RegExp(point, "u"),
    );
    assert.equal(injected, true, point);

    const recovered = recoverCanonicalMessageReplacement(
      fixture.transactionPath,
    );
    const expectedRevision = rollbackPoints.has(point) ? 1 : 2;

    assert.equal(recovered.messageRevision, expectedRevision, point);
    assert.equal(
      readTransaction(fixture.transactionPath).message.revision,
      expectedRevision,
      point,
    );
    assert.deepEqual(
      readdirSync(join(fixture.attemptDirectory, "message")),
      ["current"],
      point,
    );
    assert.equal(
      existsSync(
        join(fixture.attemptDirectory, "message-replacement.pending.json"),
      ),
      false,
      point,
    );
    assert.equal(
      recovered.messageSha256 === first.messageSha256,
      rollbackPoints.has(point),
      point,
    );
  }
});

test("recovery restores the prior revision when a journaled candidate is corrupt", (t) => {
  const fixture = createMessageTransaction(t);
  const first = replacement(
    fixture.transactionPath,
    "fix(parser): Preserve parser behavior",
  );

  assert.throws(
    () =>
      replacement(
        fixture.transactionPath,
        "fix(parser): Reject malformed parser input",
        {
          failureInjector(point) {
            if (point === "after-journal-flush") {
              throw new Error("interrupt after durable journal");
            }
          },
        },
      ),
    /durable journal/u,
  );
  writeFileSync(
    join(fixture.attemptDirectory, "message", "candidate", "message.txt"),
    "corrupt\n",
  );

  const recovered = recoverCanonicalMessageReplacement(fixture.transactionPath);

  assert.equal(recovered.messageRevision, 1);
  assert.equal(recovered.messageSha256, first.messageSha256);
  assert.equal(readFileSync(recovered.messagePath).equals(first.bytes), true);
});

test("checked and finalized routes share the same replacement boundary", (t) => {
  const concise = createMessageTransaction(t);
  const extended = createMessageTransaction(t, { route: "extended" });
  const checked = replacement(
    concise.transactionPath,
    "fix(parser): Preserve checked input",
  );
  const finalized = replacement(
    extended.transactionPath,
    "fix(parser): Preserve finalized input",
    { source: "finalized-extended" },
  );

  assert.equal(checked.messageSource, "checked-file");
  assert.equal(finalized.messageSource, "finalized-extended");
  assert.equal(readTransaction(concise.transactionPath).phase, "message-ready");
  assert.equal(
    readTransaction(extended.transactionPath).phase,
    "message-ready",
  );
});
