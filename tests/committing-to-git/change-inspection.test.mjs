// Complete bounded inspection for text, draft-index, and binary changes.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CHUNK_BYTES,
  MAX_CHUNK_LINES,
  splitPatch,
  writeInspection,
} from "../../src/committing-to-git/inspection/changeInspection.js";
import {
  commitAll,
  createRepositoryFixture,
  git,
  readGitTraceArguments,
  readJson,
  runCommitWorkflow,
  writeJson,
  writeRepositoryFile,
} from "./harness.mjs";

test("inspection preparation refuses to reuse an existing directory", (t) => {
  const fixture = createRepositoryFixture(t, "commit-inspection-collision-");
  const snapshotPath = join(fixture.scratch, "snapshot.json");
  const inspectionDir = join(fixture.scratch, "inspection");
  const markerPath = join(inspectionDir, "foreign.txt");

  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");
  assert.equal(
    runCommitWorkflow(
      "snapshot create",
      ["--mode", "actual", "--scope", "full", "--output", snapshotPath],
      fixture.repo,
    ).status,
    0,
  );
  mkdirSync(inspectionDir);
  writeFileSync(markerPath, "foreign inspection\n");

  const result = runCommitWorkflow(
    "inspection prepare",
    ["--manifest", snapshotPath, "--output-dir", inspectionDir],
    fixture.repo,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /already exists|EEXIST/u);
  assert.equal(readFileSync(markerPath, "utf8"), "foreign inspection\n");
});

test("patch chunks prefer line boundaries and preserve UTF-8 code points", () => {
  const firstLine = "a".repeat(10_000);
  const secondLine = "b".repeat(10_000);
  const lineBounded = Buffer.from(`${firstLine}\n${secondLine}\n`);
  const lineChunks = splitPatch(lineBounded);

  assert.equal(lineChunks.length, 2);
  assert.equal(lineChunks[0].payload.at(-1), 10);
  assert.equal(
    Buffer.concat(lineChunks.map(({ payload }) => payload)).equals(lineBounded),
    true,
  );

  const unicode = Buffer.from(`${"x".repeat(MAX_CHUNK_BYTES - 1)}EUR:€`);
  const unicodeChunks = splitPatch(unicode);
  const decoder = new TextDecoder("utf-8", { fatal: true });

  assert.ok(unicodeChunks.length > 1);
  assert.doesNotThrow(() =>
    unicodeChunks.forEach(({ payload }) => decoder.decode(payload)),
  );
  assert.equal(
    Buffer.concat(unicodeChunks.map(({ payload }) => payload)).equals(unicode),
    true,
  );
});

test("inspection chunks preserve the complete staged patch within line and byte ceilings", (t) => {
  const fixture = createRepositoryFixture(t, "commit-inspection-");
  const snapshotPath = join(fixture.scratch, "snapshot.json");
  const inspectionDir = join(fixture.scratch, "inspection");

  writeRepositoryFile(fixture.repo, "large.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(
    fixture.repo,
    "large.txt",
    Array.from(
      { length: 600 },
      (_, index) => `replacement line ${index + 1}`,
    ).join("\n") + "\n",
  );

  assert.equal(
    runCommitWorkflow(
      "snapshot create",
      ["--mode", "actual", "--scope", "full", "--output", snapshotPath],
      fixture.repo,
    ).status,
    0,
  );

  const result = runCommitWorkflow(
    "inspection prepare",
    ["--manifest", snapshotPath, "--output-dir", inspectionDir],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);

  const ledger = readJson(join(inspectionDir, "ledger.json"));
  const chunks = ledger.units
    .filter(({ kind }) => kind === "text-patch")
    .map((unit) => readFileSync(join(inspectionDir, unit.artifact)));
  const reconstructed = Buffer.concat(chunks);
  const expected = git(
    [
      "-c",
      "diff.renameLimit=1000",
      "diff",
      "--cached",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames=50%",
      "HEAD",
      "--",
    ],
    fixture.repo,
  ).stdout;

  assert.ok(
    ledger.units.length > 1,
    "the fixture should require multiple chunks",
  );
  assert.ok(ledger.units.every(({ lineCount }) => lineCount <= 200));
  assert.ok(ledger.units.every(({ byteCount }) => byteCount <= 16 * 1024));
  assert.equal(reconstructed.toString("utf8"), expected);
  assert.ok(ledger.units.every(({ status }) => status === "pending"));
  assert.equal(ledger.complete, false);
});

test("inspection overview requires an artifact-atomic read and acknowledgement loop", (t) => {
  const fixture = createRepositoryFixture(
    t,
    "commit-inspection-atomic-review-",
  );
  const outputDir = join(fixture.scratch, "inspection");
  const manifest = {
    schemaVersion: 2,
    indexTreeOid: "a".repeat(40),
    changeUnitCount: 1,
    changeUnits: [
      {
        id: "F000001",
        kind: "modified",
        destinationPath: "large.txt",
        displayPath: "large.txt",
        additions: 600,
        deletions: 1,
        binary: false,
      },
    ],
  };

  const ledger = writeInspection({
    outputDir,
    manifest,
    patch: Buffer.from("+ replacement content\n".repeat(600)),
  });
  const overview = readFileSync(join(outputDir, "inventory.md"), "utf8");

  assert.ok(
    ledger.units.filter(({ kind }) => kind === "text-patch").length > 1,
    "the fixture should expose the aggregate-output risk",
  );
  assert.match(overview, /one pending artifact at a time/u);
  assert.match(overview, /dedicated tool action/u);
  assert.match(overview, /acknowledge[^.]+before reading the next artifact/u);
  assert.match(overview, /combined response/u);
});

test("inspection summarizes whole-file deletions without requiring their historical bodies", (t) => {
  const fixture = createRepositoryFixture(
    t,
    "commit-inspection-delete-summary-",
  );
  const snapshotPath = join(fixture.scratch, "snapshot.json");
  const inspectionDir = join(fixture.scratch, "inspection");
  const deletedContents =
    Array.from(
      { length: 600 },
      (_, index) => `obsolete implementation line ${index + 1}`,
    ).join("\n") + "\n";

  writeRepositoryFile(fixture.repo, "obsolete.txt", deletedContents);
  writeRepositoryFile(fixture.repo, "retained.txt", "before\n");
  commitAll(fixture.repo);
  rmSync(join(fixture.repo, "obsolete.txt"));
  writeRepositoryFile(fixture.repo, "retained.txt", "after\n");

  const snapshot = runCommitWorkflow(
    "snapshot create",
    ["--mode", "actual", "--scope", "full", "--output", snapshotPath],
    fixture.repo,
  );

  assert.equal(snapshot.status, 0, snapshot.stderr);

  const inspect = runCommitWorkflow(
    "inspection prepare",
    ["--manifest", snapshotPath, "--output-dir", inspectionDir],
    fixture.repo,
  );

  assert.equal(inspect.status, 0, inspect.stderr);

  const manifest = readJson(snapshotPath);
  const deletedUnit = manifest.changeUnits.find(
    ({ destinationPath }) => destinationPath === "obsolete.txt",
  );
  const ledger = readJson(join(inspectionDir, "ledger.json"));
  const requiredPatch = Buffer.concat(
    ledger.units
      .filter(({ kind }) => kind === "text-patch")
      .map(({ artifact }) => readFileSync(join(inspectionDir, artifact))),
  ).toString("utf8");
  const inventory = Buffer.concat(
    ledger.units
      .filter(({ kind }) => kind === "inventory-page")
      .map(({ artifact }) => readFileSync(join(inspectionDir, artifact))),
  ).toString("utf8");
  const expectedRequiredPatch = git(
    [
      "-c",
      "diff.renameLimit=1000",
      "diff",
      "--cached",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames=50%",
      "--diff-filter=d",
      "HEAD",
      "--",
    ],
    fixture.repo,
  ).stdout;

  assert.equal(ledger.schemaVersion, 2);
  assert.equal(ledger.summarizedDeletionCount, 1);
  assert.equal(ledger.summarizedTextDeletionLines, 600);
  assert.deepEqual(ledger.expandedDeletions, []);
  assert.equal(ledger.reviewPatchBytes, Buffer.byteLength(requiredPatch));
  assert.equal(requiredPatch, expectedRequiredPatch);
  assert.match(requiredPatch, /retained\.txt/u);
  assert.doesNotMatch(requiredPatch, /obsolete implementation line/u);
  assert.match(inventory, /obsolete\.txt/u);
  assert.match(inventory, /historical body summarized/u);
  assert.match(inventory, new RegExp(deletedUnit.oldOid, "u"));
  assert.match(
    readFileSync(join(inspectionDir, "inventory.md"), "utf8"),
    /Summarized whole-file deletions: 1 \(600 text lines\)/u,
  );
});

test("deletion expansion appends the exact old blob and reopens the required ledger", (t) => {
  const fixture = createRepositoryFixture(
    t,
    "commit-inspection-delete-expand-",
  );
  const snapshotPath = join(fixture.scratch, "snapshot.json");
  const inspectionDir = join(fixture.scratch, "inspection");
  const ledgerPath = join(inspectionDir, "ledger.json");
  const deletedContents =
    Array.from(
      { length: 450 },
      (_, index) => `deleted semantic line ${index + 1}`,
    ).join("\n") + "\n";

  writeRepositoryFile(fixture.repo, "obsolete.txt", deletedContents);
  commitAll(fixture.repo);
  rmSync(join(fixture.repo, "obsolete.txt"));

  assert.equal(
    runCommitWorkflow(
      "snapshot create",
      ["--mode", "actual", "--scope", "full", "--output", snapshotPath],
      fixture.repo,
    ).status,
    0,
  );
  assert.equal(
    runCommitWorkflow(
      "inspection prepare",
      ["--manifest", snapshotPath, "--output-dir", inspectionDir],
      fixture.repo,
    ).status,
    0,
  );

  for (const unit of readJson(ledgerPath).units) {
    const acknowledge = runCommitWorkflow(
      "inspection acknowledge",
      ["--ledger", ledgerPath, "--id", unit.id, "--sha256", unit.sha256],
      fixture.repo,
    );

    assert.equal(acknowledge.status, 0, acknowledge.stderr);
  }

  assert.equal(readJson(ledgerPath).complete, true);

  const expand = runCommitWorkflow(
    "inspection expand-deletion",
    [
      "--manifest",
      snapshotPath,
      "--ledger",
      ledgerPath,
      "--change-unit",
      "F000001",
    ],
    fixture.repo,
  );

  assert.equal(expand.status, 0, expand.stderr);

  const expandedLedger = readJson(ledgerPath);
  const expansion = expandedLedger.expandedDeletions[0];
  const contentUnits = expandedLedger.units.filter(
    ({ kind }) => kind === "deleted-content",
  );
  const reconstructed = Buffer.concat(
    contentUnits.map(({ artifact }) =>
      readFileSync(join(inspectionDir, artifact)),
    ),
  );

  assert.equal(expandedLedger.complete, false);
  assert.equal(expansion.changeUnitId, "F000001");
  assert.equal(expansion.byteCount, Buffer.byteLength(deletedContents));
  assert.deepEqual(
    expansion.unitIds,
    contentUnits.map(({ id }) => id),
  );
  assert.ok(contentUnits.length > 1);
  assert.ok(
    contentUnits.every(({ changeUnitId }) => changeUnitId === "F000001"),
  );
  assert.equal(reconstructed.toString("utf8"), deletedContents);

  for (const unit of contentUnits) {
    const acknowledge = runCommitWorkflow(
      "inspection acknowledge",
      ["--ledger", ledgerPath, "--id", unit.id, "--sha256", unit.sha256],
      fixture.repo,
    );

    assert.equal(acknowledge.status, 0, acknowledge.stderr);
  }

  assert.equal(readJson(ledgerPath).complete, true);

  const completedLedger = readJson(ledgerPath);
  const duplicate = runCommitWorkflow(
    "inspection expand-deletion",
    [
      "--manifest",
      snapshotPath,
      "--ledger",
      ledgerPath,
      "--change-unit",
      "F000001",
    ],
    fixture.repo,
  );

  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /already expanded/u);
  assert.deepEqual(readJson(ledgerPath), completedLedger);
});

test("deletion expansion rejects retained paths and non-blob historical objects", (t) => {
  const fixture = createRepositoryFixture(
    t,
    "commit-inspection-delete-reject-",
  );
  const modifiedSnapshotPath = join(fixture.scratch, "modified-snapshot.json");
  const modifiedInspectionDir = join(fixture.scratch, "modified-inspection");

  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");

  assert.equal(
    runCommitWorkflow(
      "snapshot create",
      ["--mode", "actual", "--scope", "full", "--output", modifiedSnapshotPath],
      fixture.repo,
    ).status,
    0,
  );
  assert.equal(
    runCommitWorkflow(
      "inspection prepare",
      [
        "--manifest",
        modifiedSnapshotPath,
        "--output-dir",
        modifiedInspectionDir,
      ],
      fixture.repo,
    ).status,
    0,
  );

  const retained = runCommitWorkflow(
    "inspection expand-deletion",
    [
      "--manifest",
      modifiedSnapshotPath,
      "--ledger",
      join(modifiedInspectionDir, "ledger.json"),
      "--change-unit",
      "F000001",
    ],
    fixture.repo,
  );

  assert.equal(retained.status, 2);
  assert.match(retained.stderr, /whole-file deletion/u);

  const deletedAttempt = join(fixture.scratch, "deleted-attempt");
  const deletedSnapshotPath = join(deletedAttempt, "snapshot.json");
  const deletedInspectionDir = join(deletedAttempt, "inspection");

  mkdirSync(deletedAttempt);

  commitAll(fixture.repo, "modified");
  rmSync(join(fixture.repo, "tracked.txt"));
  const deletedSnapshot = runCommitWorkflow(
    "snapshot create",
    ["--mode", "actual", "--scope", "full", "--output", deletedSnapshotPath],
    fixture.repo,
  );

  assert.equal(deletedSnapshot.status, 0, deletedSnapshot.stderr);
  assert.equal(
    runCommitWorkflow(
      "inspection prepare",
      ["--manifest", deletedSnapshotPath, "--output-dir", deletedInspectionDir],
      fixture.repo,
    ).status,
    0,
  );

  const deletedManifest = readJson(deletedSnapshotPath);
  deletedManifest.changeUnits[0].oldOid = deletedManifest.headOid;
  writeJson(deletedSnapshotPath, deletedManifest);

  const wrongType = runCommitWorkflow(
    "inspection expand-deletion",
    [
      "--manifest",
      deletedSnapshotPath,
      "--ledger",
      join(deletedInspectionDir, "ledger.json"),
      "--change-unit",
      "F000001",
    ],
    fixture.repo,
  );

  assert.equal(wrongType.status, 2);
  assert.match(wrongType.stderr, /must identify a blob object/u);
});

test("a retained file changed to empty content remains in the required patch", (t) => {
  const fixture = createRepositoryFixture(t, "commit-inspection-empty-file-");
  const snapshotPath = join(fixture.scratch, "snapshot.json");
  const inspectionDir = join(fixture.scratch, "inspection");

  writeRepositoryFile(fixture.repo, "retained-empty.txt", "still tracked\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "retained-empty.txt", "");

  assert.equal(
    runCommitWorkflow(
      "snapshot create",
      ["--mode", "actual", "--scope", "full", "--output", snapshotPath],
      fixture.repo,
    ).status,
    0,
  );
  assert.equal(
    runCommitWorkflow(
      "inspection prepare",
      ["--manifest", snapshotPath, "--output-dir", inspectionDir],
      fixture.repo,
    ).status,
    0,
  );

  const ledger = readJson(join(inspectionDir, "ledger.json"));
  const requiredPatch = Buffer.concat(
    ledger.units
      .filter(({ kind }) => kind === "text-patch")
      .map(({ artifact }) => readFileSync(join(inspectionDir, artifact))),
  ).toString("utf8");

  assert.equal(ledger.summarizedDeletionCount, 0);
  assert.match(requiredPatch, /retained-empty\.txt/u);
  assert.match(requiredPatch, /^-still tracked$/mu);
});

test("inspection shows every line of a similar retained-source destination as newly added", (t) => {
  const fixture = createRepositoryFixture(t, "commit-inspection-adapted-");
  const snapshotPath = join(fixture.scratch, "snapshot.json");
  const inspectionDir = join(fixture.scratch, "inspection");
  const sharedLines = Array.from(
    { length: 80 },
    (_, index) => `shared line ${String(index + 1).padStart(3, "0")}`,
  );
  const source = [
    ...sharedLines,
    ...Array.from({ length: 20 }, (_, index) => `source line ${index + 1}`),
  ].join("\n");
  const destination = [
    ...sharedLines,
    ...Array.from({ length: 20 }, (_, index) => `adapted line ${index + 1}`),
  ].join("\n");

  writeRepositoryFile(fixture.repo, "source.txt", `${source}\n`);
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "adapted.txt", `${destination}\n`);
  git(["add", "--", "adapted.txt"], fixture.repo);

  assert.equal(
    runCommitWorkflow(
      "snapshot create",
      ["--mode", "actual", "--scope", "staged", "--output", snapshotPath],
      fixture.repo,
    ).status,
    0,
  );
  assert.equal(
    runCommitWorkflow(
      "inspection prepare",
      ["--manifest", snapshotPath, "--output-dir", inspectionDir],
      fixture.repo,
    ).status,
    0,
  );

  const ledger = readJson(join(inspectionDir, "ledger.json"));
  const patch = Buffer.concat(
    ledger.units
      .filter(({ kind }) => kind === "text-patch")
      .map(({ artifact }) => readFileSync(join(inspectionDir, artifact))),
  ).toString("utf8");

  assert.match(patch, /new file mode 100644/u);
  assert.match(patch, /--- \/dev\/null/u);
  assert.match(patch, /\+\+\+ b\/adapted\.txt/u);
  assert.match(patch, /^\+shared line 001$/mu);
});

test("draft full inspection uses its temporary index and preserves the real staged tree", (t) => {
  const fixture = createRepositoryFixture(t, "commit-draft-inspection-");
  const snapshotPath = join(fixture.scratch, "snapshot.json");
  const inspectionDir = join(fixture.scratch, "inspection");

  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");
  const realTree = git(["write-tree"], fixture.repo).stdout.trim();

  const stage = runCommitWorkflow(
    "snapshot create",
    ["--mode", "draft", "--scope", "full", "--output", snapshotPath],
    fixture.repo,
  );

  assert.equal(stage.status, 0, stage.stderr);

  const inspect = runCommitWorkflow(
    "inspection prepare",
    ["--manifest", snapshotPath, "--output-dir", inspectionDir],
    fixture.repo,
  );

  assert.equal(inspect.status, 0, inspect.stderr);
  assert.equal(git(["write-tree"], fixture.repo).stdout.trim(), realTree);
  assert.match(
    readFileSync(join(inspectionDir, "chunks/C000001.patch"), "utf8"),
    /after/u,
  );
});

test("inspection preparation does not invoke git write-tree", (t) => {
  const fixture = createRepositoryFixture(t, "commit-inspection-read-only-");
  const snapshotPath = join(fixture.scratch, "snapshot.json");
  const inspectionDir = join(fixture.scratch, "inspection");
  const tracePath = join(fixture.scratch, "inspection-git-trace.json");

  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");

  const snapshot = runCommitWorkflow(
    "snapshot create",
    ["--mode", "actual", "--scope", "full", "--output", snapshotPath],
    fixture.repo,
  );

  assert.equal(snapshot.status, 0, snapshot.stderr);

  const inspect = runCommitWorkflow(
    "inspection prepare",
    ["--manifest", snapshotPath, "--output-dir", inspectionDir],
    fixture.repo,
    { env: { GIT_TRACE2_EVENT: tracePath } },
  );

  assert.equal(inspect.status, 0, inspect.stderr);
  assert.equal(readJson(join(inspectionDir, "ledger.json")).complete, false);
  assert.equal(
    readGitTraceArguments(tracePath).some((args) =>
      args.includes("write-tree"),
    ),
    false,
  );
});

test("inspection rejects a commit object where the manifest requires a tree", (t) => {
  const fixture = createRepositoryFixture(t, "commit-inspection-tree-type-");
  const snapshotPath = join(fixture.scratch, "snapshot.json");
  const inspectionDir = join(fixture.scratch, "inspection");

  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");

  const snapshot = runCommitWorkflow(
    "snapshot create",
    ["--mode", "actual", "--scope", "full", "--output", snapshotPath],
    fixture.repo,
  );

  assert.equal(snapshot.status, 0, snapshot.stderr);

  const manifest = readJson(snapshotPath);
  manifest.indexTreeOid = manifest.headOid;
  writeJson(snapshotPath, manifest);

  const inspect = runCommitWorkflow(
    "inspection prepare",
    ["--manifest", snapshotPath, "--output-dir", inspectionDir],
    fixture.repo,
  );

  assert.equal(inspect.status, 2);
  assert.match(inspect.stderr, /must identify a tree object/u);
});

test("binary changes produce explicit unavailable-line metadata review units", (t) => {
  const fixture = createRepositoryFixture(t, "commit-binary-inspection-");
  const snapshotPath = join(fixture.scratch, "snapshot.json");
  const inspectionDir = join(fixture.scratch, "inspection");

  writeRepositoryFile(fixture.repo, "asset.bin", Buffer.from([0, 1, 2]));
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "asset.bin", Buffer.from([0, 3, 4]));

  assert.equal(
    runCommitWorkflow(
      "snapshot create",
      ["--mode", "actual", "--scope", "full", "--output", snapshotPath],
      fixture.repo,
    ).status,
    0,
  );

  const inspect = runCommitWorkflow(
    "inspection prepare",
    ["--manifest", snapshotPath, "--output-dir", inspectionDir],
    fixture.repo,
  );

  assert.equal(inspect.status, 0, inspect.stderr);

  const ledger = readJson(join(inspectionDir, "ledger.json"));
  const binaryUnit = ledger.units.find(
    ({ kind }) => kind === "binary-metadata",
  );

  assert.ok(
    binaryUnit,
    "binary changes require their own metadata review unit",
  );
  assert.deepEqual(readJson(join(inspectionDir, binaryUnit.artifact)), {
    changeUnitId: "F000001",
    kind: "binary",
    path: "asset.bin",
    additions: null,
    deletions: null,
  });
  assert.match(
    [
      readFileSync(join(inspectionDir, "inventory.md"), "utf8"),
      ...ledger.units
        .filter(({ kind }) => kind === "inventory-page")
        .map(({ artifact }) =>
          readFileSync(join(inspectionDir, artifact), "utf8"),
        ),
    ].join("\n"),
    /binary\/unavailable/u,
  );
});

test("summarized deletion line totals exclude submodule gitlinks", (t) => {
  const fixture = createRepositoryFixture(
    t,
    "commit-submodule-delete-summary-",
  );
  const outputDir = join(fixture.scratch, "inspection");
  const manifest = {
    schemaVersion: 2,
    indexTreeOid: "a".repeat(40),
    changeUnitCount: 1,
    changeUnits: [
      {
        id: "F000001",
        kind: "submodule-changed",
        destinationPath: "vendor/library",
        displayPath: "vendor/library",
        oldMode: "160000",
        newMode: "000000",
        oldOid: "b".repeat(40),
        newOid: "0".repeat(40),
        additions: 0,
        deletions: 1,
        binary: false,
      },
    ],
  };

  const ledger = writeInspection({
    outputDir,
    manifest,
    patch: Buffer.alloc(0),
  });

  assert.equal(ledger.summarizedDeletionCount, 1);
  assert.equal(ledger.summarizedTextDeletionLines, 0);
  assert.ok(ledger.units.some(({ kind }) => kind === "submodule-metadata"));
});

test("large inventories are emitted as bounded review pages", (t) => {
  const fixture = createRepositoryFixture(t, "commit-large-inventory-");
  const outputDir = join(fixture.scratch, "inspection");
  const changeUnits = Array.from({ length: 1_000 }, (_, index) => {
    const id = `F${String(index + 1).padStart(6, "0")}`;
    const path = `src/generated/file-${String(index + 1).padStart(4, "0")}.js`;

    return {
      id,
      kind: "modified",
      destinationPath: path,
      displayPath: path,
      additions: 1,
      deletions: 1,
      binary: false,
    };
  });
  const manifest = {
    schemaVersion: 1,
    indexTreeOid: "a".repeat(40),
    changeUnitCount: changeUnits.length,
    changeUnits,
  };

  const ledger = writeInspection({
    outputDir,
    manifest,
    patch: Buffer.alloc(0),
  });
  const inventoryPages = ledger.units.filter(
    ({ kind }) => kind === "inventory-page",
  );

  assert.ok(inventoryPages.length > 1);
  assert.ok(
    inventoryPages.every(({ lineCount }) => lineCount <= MAX_CHUNK_LINES),
  );
  assert.ok(
    inventoryPages.every(({ byteCount }) => byteCount <= MAX_CHUNK_BYTES),
  );

  const overview = readFileSync(join(outputDir, "inventory.md"), "utf8");
  const completeInventory = Buffer.concat(
    inventoryPages.map(({ artifact }) =>
      readFileSync(join(outputDir, artifact)),
    ),
  ).toString("utf8");

  assert.doesNotMatch(overview, /src\/generated\/file-1000\.js/u);

  for (const { id } of changeUnits) {
    assert.match(completeInventory, new RegExp(`\\b${id}\\b`, "u"));
  }
});
