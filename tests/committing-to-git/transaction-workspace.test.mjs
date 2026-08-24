import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAXIMUM_BASIS_NOTE_BYTES,
  MAXIMUM_INITIAL_JSON_INPUT_BYTES,
  MAXIMUM_TRANSACTION_PATH_BYTES,
  advanceTransaction,
  allocateAttemptDirectory,
  compactTransaction,
  createTransactionWorkspace,
  getEvidencePlanInputPath,
  getMessageContentPath,
  getMessageInputPath,
  readTransaction,
  updateTransaction,
  validateTransaction,
} from "../../src/committing-to-git/transaction/transactionWorkspace.js";
import { createRepositoryFixture, writeJson } from "./harness.mjs";

const FULL_OID = "a".repeat(40);
const PRECOMMIT_TEMPLATE = {
  schemaVersion: 1,
  phase: "allocated",
  repositoryRoot: resolve("."),
  attemptDirectory: resolve("transaction-attempt"),
  mode: "actual",
  status: null,
  terminalDisposition: null,
  scope: { kind: "staged" },
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

function snapshotState(headAnchor) {
  return {
    phase: "snapshot-created",
    mode: "actual",
    scope: { kind: "staged" },
    headAnchor,
    snapshot: { indexTreeOid: FULL_OID },
  };
}

test("transaction workspace owns one UUIDv4 attempt without discovery machinery", (t) => {
  const fixture = createRepositoryFixture(t, "transaction-workspace-");
  const workspace = createTransactionWorkspace({
    repositoryRoot: fixture.repo,
    temporaryRoot: fixture.scratch,
  });

  assert.equal(MAXIMUM_TRANSACTION_PATH_BYTES, 2 * 1024);
  assert.equal(MAXIMUM_INITIAL_JSON_INPUT_BYTES, 8 * 1024 * 1024);
  assert.equal(MAXIMUM_BASIS_NOTE_BYTES, 512);
  assert.match(
    basename(workspace.attemptDirectory),
    /^committing-to-git-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  assert.deepEqual(readdirSync(workspace.attemptDirectory), [
    "transaction.json",
  ]);
  assert.deepEqual(workspace.transaction, {
    schemaVersion: 1,
    phase: "allocated",
    repositoryRoot: resolve(fixture.repo),
    attemptDirectory: workspace.attemptDirectory,
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
  });
  assert.deepEqual(
    readTransaction(workspace.transactionPath),
    workspace.transaction,
  );

  const derivedPaths = [
    workspace.transactionPath,
    getMessageInputPath(workspace.transactionPath),
    getEvidencePlanInputPath(workspace.transactionPath),
    getMessageContentPath(workspace.transactionPath),
  ];

  assert.deepEqual(
    derivedPaths.map((path) => basename(path)),
    [
      "transaction.json",
      "message-input.txt",
      "evidence-plan-input.json",
      "content.json",
    ],
  );
  for (const path of derivedPaths) {
    assert.equal(dirname(path), workspace.attemptDirectory);
    assert.doesNotMatch(relative(workspace.attemptDirectory, path), /^\.\./u);
  }

  if (process.platform !== "win32") {
    assert.equal(statSync(workspace.attemptDirectory).mode % 0o1000, 0o700);
    assert.equal(statSync(workspace.transactionPath).mode % 0o1000, 0o600);
  }
});

test("attempt allocation retries only EEXIST with a fresh UUID", (t) => {
  const fixture = createRepositoryFixture(t, "transaction-collision-");
  const uuids = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
  ];
  const calls = [];

  const allocation = allocateAttemptDirectory({
    temporaryRoot: fixture.scratch,
    randomUuid: () => uuids.shift(),
    createDirectory: (path, options) => {
      calls.push({ path, options });

      if (calls.length === 1) {
        const error = new Error("occupied");
        error.code = "EEXIST";
        throw error;
      }
    },
  });

  assert.equal(
    basename(allocation.attemptDirectory),
    "committing-to-git-00000000-0000-4000-8000-000000000002",
  );
  assert.deepEqual(
    calls.map(({ path, options }) => ({ name: basename(path), options })),
    [
      {
        name: "committing-to-git-00000000-0000-4000-8000-000000000001",
        options: { mode: 0o700 },
      },
      {
        name: "committing-to-git-00000000-0000-4000-8000-000000000002",
        options: { mode: 0o700 },
      },
    ],
  );
});

test("attempt allocation stops on non-collision errors and bounds collisions", (t) => {
  const fixture = createRepositoryFixture(t, "transaction-allocation-stop-");
  const denied = new Error("denied");
  denied.code = "EACCES";
  let deniedCalls = 0;

  assert.throws(
    () =>
      allocateAttemptDirectory({
        temporaryRoot: fixture.scratch,
        randomUuid: () => "00000000-0000-4000-8000-000000000003",
        createDirectory: () => {
          deniedCalls += 1;
          throw denied;
        },
      }),
    (error) => error === denied,
  );
  assert.equal(deniedCalls, 1);

  let collisionCalls = 0;
  assert.throws(
    () =>
      allocateAttemptDirectory({
        temporaryRoot: fixture.scratch,
        randomUuid: () => "00000000-0000-4000-8000-000000000004",
        createDirectory: () => {
          collisionCalls += 1;
          const error = new Error("occupied");
          error.code = "EEXIST";
          throw error;
        },
        maximumAttempts: 4,
      }),
    /4 collision attempts/u,
  );
  assert.equal(collisionCalls, 4);
});

test("transaction handle budget accepts the boundary and rejects one byte over before mkdir", (t) => {
  const fixture = createRepositoryFixture(t, "transaction-handle-bound-");
  const uuid = "00000000-0000-4000-8000-000000000005";
  const attemptName = `committing-to-git-${uuid}`;
  const withoutPadding = join(
    resolve(fixture.scratch),
    attemptName,
    "transaction.json",
  );
  const paddingLength =
    MAXIMUM_TRANSACTION_PATH_BYTES -
    Buffer.byteLength(withoutPadding) -
    Buffer.byteLength(join("a", "b")) +
    2;
  const exactRoot = join(fixture.scratch, "x".repeat(paddingLength));
  const overRoot = join(fixture.scratch, "x".repeat(paddingLength + 1));
  let exactMkdirCalls = 0;

  const exact = allocateAttemptDirectory({
    temporaryRoot: exactRoot,
    randomUuid: () => uuid,
    createDirectory: () => {
      exactMkdirCalls += 1;
    },
  });

  assert.equal(
    Buffer.byteLength(exact.transactionPath),
    MAXIMUM_TRANSACTION_PATH_BYTES,
  );
  assert.equal(exactMkdirCalls, 1);

  let overMkdirCalls = 0;
  assert.throws(
    () =>
      allocateAttemptDirectory({
        temporaryRoot: overRoot,
        randomUuid: () => uuid,
        createDirectory: () => {
          overMkdirCalls += 1;
        },
      }),
    /2,048 UTF-8 bytes/u,
  );
  assert.equal(overMkdirCalls, 0);
});

test("transaction transitions preserve canonical head anchors and reject skips", (t) => {
  const fixture = createRepositoryFixture(t, "transaction-transition-");
  const anchors = [
    {
      headKind: "unborn",
      targetRef: "refs/heads/main",
      expectedParentOids: [],
    },
    {
      headKind: "attached",
      targetRef: "refs/heads/main",
      expectedParentOids: [FULL_OID],
    },
    {
      headKind: "detached",
      targetRef: null,
      expectedParentOids: [FULL_OID],
    },
  ];

  for (const headAnchor of anchors) {
    const workspace = createTransactionWorkspace({
      repositoryRoot: fixture.repo,
      temporaryRoot: fixture.scratch,
    });
    const advanced = advanceTransaction(
      workspace.transactionPath,
      "allocated",
      snapshotState(headAnchor),
    );

    assert.equal(advanced.phase, "snapshot-created");
    assert.deepEqual(advanced.headAnchor, headAnchor);
    assert.deepEqual(readTransaction(workspace.transactionPath), advanced);
    assert.throws(
      () =>
        advanceTransaction(
          workspace.transactionPath,
          "allocated",
          snapshotState(headAnchor),
        ),
      /expected phase allocated.*snapshot-created/u,
    );
    assert.throws(
      () =>
        advanceTransaction(workspace.transactionPath, "snapshot-created", {
          phase: "message-ready",
          status: "message-ready",
        }),
      /transition.*snapshot-created.*message-ready/u,
    );
  }
});

test("reversible preparation facts can be persisted without inventing a phase", (t) => {
  const fixture = createRepositoryFixture(t, "transaction-preparation-facts-");
  const workspace = createTransactionWorkspace({
    repositoryRoot: fixture.repo,
    temporaryRoot: fixture.scratch,
  });
  const current = readTransaction(workspace.transactionPath);
  const prepared = {
    ...current,
    mode: "actual",
    scope: { kind: "full" },
    initialEvidencePlan: { sha256: "a".repeat(64) },
  };

  assert.deepEqual(
    updateTransaction(workspace.transactionPath, "allocated", prepared),
    prepared,
  );
  assert.throws(
    () =>
      updateTransaction(workspace.transactionPath, "allocated", {
        ...prepared,
        phase: "snapshot-created",
      }),
    /must preserve phase/u,
  );
});

test("transaction validation accepts canonical state families and rejects impossible combinations", () => {
  const template = {
    ...structuredClone(PRECOMMIT_TEMPLATE),
    headAnchor: {
      headKind: "attached",
      targetRef: "refs/heads/main",
      expectedParentOids: [FULL_OID],
    },
  };
  const validStates = [
    ["allocated", null, null],
    ["snapshot-created", null, null],
    ["evidence-ready", "prepared", null],
    ["evidence-ready", "promoted", null],
    ["review-pending", "review-pending", null],
    ["review-pending", "evidence-required", null],
    ["message-ready", "message-ready", null],
    ["message-ready", "promoted", null],
    ["commit-pending", "outcome-unknown", null],
    ["reported", "reported", "local-commit-recorded"],
    ["reported", "commit-blocked", "local-commit-recorded"],
    ["publication-pending", "outcome-unknown", null],
    ["published", "published", "published"],
    ["stopped", "stopped", "no-commit-stopped"],
    ["stopped", "invalid", "no-commit-stopped"],
    ["abandoned", "cleaned", "abandoned"],
    ["superseded", "cleaned", "superseded"],
  ];

  for (const [phase, status, terminalDisposition] of validStates) {
    const evidenceState =
      phase === "evidence-ready"
        ? {
            route: "concise",
            inlineEvidence: {
              capsuleSha256: "b".repeat(64),
              manifestSha256: "c".repeat(64),
              evidencePlanSha256: "d".repeat(64),
              capsule: { schemaVersion: 1 },
            },
          }
        : phase === "review-pending"
          ? {
              route: "extended",
              review: {
                catalogPath: "catalog.json",
                catalogSha256: "b".repeat(64),
                evidencePlanPath: "evidence-plan.json",
                evidencePlanSha256: "c".repeat(64),
                extendedReason: "review-policy",
                queue: null,
                receipt: null,
                semanticStructureRequired: false,
              },
            }
          : phase === "message-ready"
            ? {
                route: "concise",
                message: {
                  schemaVersion: 1,
                  revision: 1,
                  sha256: "d".repeat(64),
                  source: "checked-file",
                  byteCount: 32,
                  stateSha256: "e".repeat(64),
                  validationSha256: "f".repeat(64),
                  slot: "message/current",
                },
              }
            : {};

    assert.doesNotThrow(() =>
      validateTransaction({
        ...structuredClone(template),
        phase,
        status,
        terminalDisposition,
        ...evidenceState,
      }),
    );
  }

  assert.throws(
    () =>
      validateTransaction({
        ...structuredClone(template),
        phase: "evidence-ready",
        status: "prepared",
        terminalDisposition: "published",
      }),
    /phase, status, and terminal disposition/u,
  );
  assert.throws(
    () =>
      validateTransaction({
        ...structuredClone(template),
        headAnchor: {
          headKind: "detached",
          targetRef: "refs/heads/main",
          expectedParentOids: [],
        },
      }),
    /detached head anchor/u,
  );
});

test("transaction reads reject replaced recorded paths", (t) => {
  const fixture = createRepositoryFixture(t, "transaction-replaced-path-");
  const attemptReplacement = createTransactionWorkspace({
    repositoryRoot: fixture.repo,
    temporaryRoot: fixture.scratch,
  });
  const changedAttempt = structuredClone(attemptReplacement.transaction);
  changedAttempt.attemptDirectory = join(fixture.scratch, "other-attempt");
  writeJson(attemptReplacement.transactionPath, changedAttempt);

  assert.throws(
    () => readTransaction(attemptReplacement.transactionPath),
    /attempt directory.*transaction path/u,
  );

  const repositoryReplacement = createTransactionWorkspace({
    repositoryRoot: fixture.repo,
    temporaryRoot: fixture.scratch,
  });
  const changedRepository = structuredClone(repositoryReplacement.transaction);
  changedRepository.repositoryRoot = fixture.scratch;
  writeJson(repositoryReplacement.transactionPath, changedRepository);

  assert.throws(
    () => readTransaction(repositoryReplacement.transactionPath),
    /recorded repository root/iu,
  );
});

test("compaction is terminal-only and removes only contained helper artifacts", (t) => {
  const fixture = createRepositoryFixture(t, "transaction-compaction-");
  const workspace = createTransactionWorkspace({
    repositoryRoot: fixture.repo,
    temporaryRoot: fixture.scratch,
  });
  const reviewDirectory = join(workspace.attemptDirectory, "review");
  const processLogDirectory = join(workspace.attemptDirectory, "process-logs");

  mkdirSync(reviewDirectory);
  mkdirSync(processLogDirectory);
  writeFileSync(join(reviewDirectory, "packet.txt"), "review\n");
  writeFileSync(join(processLogDirectory, "git.log"), "log\n");

  assert.throws(
    () =>
      compactTransaction(workspace.transactionPath, {
        retainReviewArtifacts: false,
        retainProcessLogs: false,
      }),
    /active transaction/u,
  );

  advanceTransaction(workspace.transactionPath, "allocated", {
    phase: "stopped",
    status: "stopped",
    terminalDisposition: "no-commit-stopped",
  });
  const compacted = compactTransaction(workspace.transactionPath, {
    retainReviewArtifacts: false,
    retainProcessLogs: false,
  });

  assert.equal(compacted.phase, "stopped");
  assert.equal(existsSync(reviewDirectory), false);
  assert.equal(existsSync(processLogDirectory), false);
  assert.equal(existsSync(workspace.transactionPath), true);
});
