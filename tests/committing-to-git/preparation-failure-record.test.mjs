import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { schemaErrors } from "./schema-validation.mjs";
import { createRepositoryFixture } from "./harness.mjs";
import {
  createTransactionWorkspace,
  validateTransaction,
} from "../../src/committing-to-git/transaction/transactionWorkspace.js";
import { validatePreparationFailure } from "../../src/committing-to-git/transaction/preparationFailureRecord.js";

const schema = JSON.parse(
  readFileSync(
    new URL(
      "../../src/committing-to-git/schema/commitTransaction.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const failureRecord = () => ({
  schemaVersion: 1,
  diagnostic: {
    code: "DETAILED_MESSAGE_LIMIT_EXCEEDED",
    message: "Detailed inventory exceeds its limit.",
    disposition: "invalid-input",
    details: [{ kind: "input", changeUnitCount: 64, requiredMode: "bulk" }],
    recovery: {
      kind: "correct-input",
      automatic: false,
      requiredInputs: [],
      commands: [],
    },
    documentation: "references/diagnostics.md",
  },
  snapshotObservation: {
    headOid: null,
    headAnchor: {
      headKind: "unborn",
      targetRef: "refs/heads/main",
      expectedParentOids: [],
    },
    indexTreeOid: "a".repeat(40),
    changeUnitCount: 64,
    sourceIndexSha256: null,
  },
  correctionInputs: null,
});

test("current runtime and strict schema admit older records and reject malformed failure records", (t) => {
  const fixture = createRepositoryFixture(t, "failure-schema-");
  const allocated = createTransactionWorkspace({
    repositoryRoot: fixture.repo,
    temporaryRoot: fixture.scratch,
  }).transaction;
  const old = {
    ...allocated,
    phase: "stopped",
    status: "stopped",
    terminalDisposition: "no-commit-stopped",
  };
  validateTransaction(old);
  assert.deepEqual(schemaErrors(old, schema), []);
  const current = { ...old, preparationFailure: failureRecord() };
  validateTransaction(current);
  assert.deepEqual(schemaErrors(current, schema), []);
  for (const mutate of [
    (record) => {
      record.preparationFailure.schemaVersion = 2;
    },
    (record) => {
      record.preparationFailure.extra = true;
    },
    (record) => {
      record.preparationFailure.diagnostic.code = "not a code";
    },
    (record) => {
      record.preparationFailure.diagnostic.recovery.automatic = true;
    },
    (record) => {
      record.preparationFailure.snapshotObservation.changeUnitCount = 0;
    },
    (record) => {
      record.preparationFailure.correctionInputs = {
        scope: null,
        evidence: { name: "../input.json" },
      };
    },
    (record) => {
      record.phase = "allocated";
      record.status = null;
      record.terminalDisposition = null;
    },
    ...["scope", "evidence"].map((role) => (record) => {
      const binding = (name) => ({
        name,
        sha256: "a".repeat(64),
        byteCount: 1,
        device: "1",
        inode: "2",
      });
      record.preparationFailure.correctionInputs = {
        scope: binding("correction-scope.json"),
        evidence: binding("correction-evidence.json"),
      };
      record.preparationFailure.correctionInputs[role].name =
        role === "scope" ? "correction-evidence.json" : "correction-scope.json";
    }),
  ]) {
    const malformed = structuredClone(current);
    mutate(malformed);
    assert.throws(() => validateTransaction(malformed));
    assert.notDeepEqual(schemaErrors(malformed, schema), []);
  }
  // The previous strict root contract lacks this optional field; it refuses new
  // records rather than silently stripping their historical failure facts.
  const obsolete = structuredClone(schema);
  delete obsolete.properties.preparationFailure;
  assert.notDeepEqual(schemaErrors(current, obsolete), []);
});

test("failure record validation rejects unsafe serializers and separate resource budgets", () => {
  for (const mutate of [
    (record) => {
      Object.defineProperty(record, "toJSON", {
        value() {
          assert.fail("toJSON executed");
        },
        enumerable: true,
      });
    },
    (record) => {
      Object.defineProperty(record.diagnostic, "message", {
        get() {
          throw new Error("getter executed");
        },
        enumerable: true,
      });
    },
    (record) => {
      record.diagnostic.details[0].cycle = record;
    },
    (record) => {
      record.diagnostic.message = "x".repeat(4097);
    },
    (record) => {
      record.diagnostic.message = "unsafe\u0001message";
    },
    (record) => {
      record.diagnostic.recovery.commands = [{ arguments: ["x".repeat(4097)] }];
    },
  ]) {
    const record = failureRecord();
    mutate(record);
    assert.throws(
      () => validatePreparationFailure(record),
      (error) => !/executed/u.test(error.message),
    );
  }
});
