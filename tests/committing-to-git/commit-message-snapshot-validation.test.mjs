// Snapshot-bound validation of the rendered canonical commit message.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import { schemaErrors } from "../helpers/json-schema.mjs";
import { createRepositoryFixture, runCommitWorkflow } from "./harness.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEMA = JSON.parse(
  readFileSync(
    join(
      REPO_ROOT,
      "src",
      "committing-to-git",
      "schema",
      "commitMessageValidation.schema.json",
    ),
    "utf8",
  ),
);

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("manifest validation proves canonical output against the approved tree", (t) => {
  const fixture = createRepositoryFixture(t, "commit-validator-v2-");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const contentPath = join(fixture.scratch, "content.json");
  const ledgerPath = join(fixture.scratch, "ledger.json");
  const messagePath = join(fixture.scratch, "message.txt");
  const path = "src/parser.js";

  writeJson(manifestPath, {
    schemaVersion: 1,
    indexTreeOid: "c".repeat(40),
    changeUnitCount: 1,
    changeUnits: [
      {
        id: "F000001",
        kind: "modified",
        sourcePath: null,
        destinationPath: path,
        path,
        sourcePathBytesBase64: null,
        destinationPathBytesBase64: Buffer.from(path).toString("base64"),
        displayPath: path,
      },
    ],
  });
  writeJson(contentPath, {
    subject: {
      type: "fix",
      scope: "parser",
      description: "Prevent malformed token acceptance",
    },
    rationale: [],
    userExperienceChanges: [],
    mode: "detailed",
    changeEntries: [
      {
        changeUnitId: "F000001",
        reasons: [
          "Reject malformed tokens before they reach structural parsing",
        ],
      },
    ],
  });
  writeJson(ledgerPath, {
    schemaVersion: 1,
    indexTreeOid: "c".repeat(40),
    complete: true,
  });

  const render = runCommitWorkflow(
    "message render",
    [
      "--manifest",
      manifestPath,
      "--content",
      contentPath,
      "--ledger",
      ledgerPath,
      "--output",
      messagePath,
    ],
    fixture.repo,
  );

  assert.equal(render.status, 0, render.stderr);

  const result = runCommitWorkflow(
    "message validate",
    [
      "--manifest",
      manifestPath,
      "--content",
      contentPath,
      "--ledger",
      ledgerPath,
      messagePath,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);

  assert.deepEqual(schemaErrors(payload, SCHEMA), []);
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.valid, true);
  assert.equal(payload.canonical, true);
  assert.equal(payload.mode, "detailed");
  assert.deepEqual(payload.inspection, { complete: true, treeMatches: true });
  assert.deepEqual(payload.scope, {
    requested: "manifest",
    resolved: "snapshot",
    indexTreeOid: "c".repeat(40),
  });
});
