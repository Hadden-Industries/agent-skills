// Complete bounded inspection for text, draft-index, and binary changes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  writeFileSync(snapshotPath, `${JSON.stringify(manifest, null, 2)}\n`);

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
