// Commit snapshot behavior across staged, full, path, rename, and unborn scopes.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  commitAll,
  createRepositoryFixture,
  git,
  readJson,
  runCommitWorkflow,
  writeRepositoryFile,
} from "./harness.mjs";

test("staged scope preserves an already-staged rename without restaging its vanished source", (t) => {
  const fixture = createRepositoryFixture(t, "commit-stage-rename-");
  const output = join(fixture.scratch, "snapshot.json");

  writeRepositoryFile(fixture.repo, "vite.config.js", "export default {};\n");
  commitAll(fixture.repo);

  renameSync(
    join(fixture.repo, "vite.config.js"),
    join(fixture.repo, "vite.config.mjs"),
  );
  git(["add", "-A"], fixture.repo);

  const treeBefore = git(["write-tree"], fixture.repo).stdout.trim();
  const result = runCommitWorkflow(
    "snapshot create",
    ["--mode", "actual", "--scope", "staged", "--output", output],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(["write-tree"], fixture.repo).stdout.trim(), treeBefore);

  const snapshot = readJson(output);

  assert.equal(snapshot.sourceIndex, "real");
  assert.equal(snapshot.indexTreeOid, treeBefore);
  assert.equal(snapshot.changeUnitCount, 1);
  assert.deepEqual(
    snapshot.changeUnits.map(({ kind, sourcePath, destinationPath }) => ({
      kind,
      sourcePath,
      destinationPath,
    })),
    [
      {
        kind: "renamed",
        sourcePath: "vite.config.js",
        destinationPath: "vite.config.mjs",
      },
    ],
  );
});

test("draft full scope captures tracked and untracked changes without mutating the real index", (t) => {
  const fixture = createRepositoryFixture(t, "commit-draft-full-");
  const output = join(fixture.scratch, "snapshot.json");

  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");
  writeRepositoryFile(fixture.repo, "new.txt", "new\n");

  const treeBefore = git(["write-tree"], fixture.repo).stdout.trim();
  const result = runCommitWorkflow(
    "snapshot create",
    ["--mode", "draft", "--scope", "full", "--output", output],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(["write-tree"], fixture.repo).stdout.trim(), treeBefore);

  const snapshot = readJson(output);

  assert.equal(snapshot.sourceIndex, "temporary");
  assert.notEqual(snapshot.indexTreeOid, treeBefore);
  assert.deepEqual(
    snapshot.changeUnits.map(({ destinationPath }) => destinationPath),
    ["new.txt", "tracked.txt"],
  );
});

test("actual path scope stages literal hostile paths and excludes unrelated changes", (t) => {
  const fixture = createRepositoryFixture(t, "commit-stage-paths-");
  const output = join(fixture.scratch, "snapshot.json");
  const scopeFile = join(fixture.scratch, "scope.json");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "-literal[1].txt", "selected\n");
  writeRepositoryFile(fixture.repo, "-literal1.txt", "must stay unstaged\n");
  writeRepositoryFile(fixture.repo, "folder/space name.txt", "selected\n");
  writeRepositoryFile(fixture.repo, "unrelated.txt", "excluded\n");
  writeFileSync(
    scopeFile,
    `${JSON.stringify(
      {
        paths: ["-literal[1].txt", "folder/space name.txt"],
      },
      null,
      2,
    )}\n`,
  );

  const result = runCommitWorkflow(
    "snapshot create",
    [
      "--mode",
      "actual",
      "--scope",
      "paths",
      "--scope-file",
      scopeFile,
      "--output",
      output,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);

  const snapshot = readJson(output);

  assert.deepEqual(
    snapshot.changeUnits.map(({ destinationPath }) => destinationPath),
    ["-literal[1].txt", "folder/space name.txt"],
  );
  assert.equal(
    git(["diff", "--cached", "--quiet", "--", "unrelated.txt"], fixture.repo, {
      allowFailure: true,
    }).status,
    0,
  );
  assert.equal(
    git(["diff", "--cached", "--quiet", "--", "-literal1.txt"], fixture.repo, {
      allowFailure: true,
    }).status,
    0,
  );
});

test("snapshot creation rejects active ordinary-workflow operation states", async (t) => {
  const operationMarkers = [
    ["merge", "MERGE_HEAD", false],
    ["cherry-pick", "CHERRY_PICK_HEAD", false],
    ["revert", "REVERT_HEAD", false],
    ["rebase", "rebase-merge", true],
  ];

  for (const [operation, marker, directory] of operationMarkers) {
    await t.test(operation, (subtest) => {
      const fixture = createRepositoryFixture(
        subtest,
        `commit-operation-${operation}-`,
      );
      const output = join(fixture.scratch, "snapshot.json");

      writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
      commitAll(fixture.repo);
      writeRepositoryFile(fixture.repo, "change.txt", "change\n");
      git(["add", "--", "change.txt"], fixture.repo);

      const markerPath = resolve(
        fixture.repo,
        git(["rev-parse", "--git-path", marker], fixture.repo).stdout.trim(),
      );

      if (directory) {
        mkdirSync(markerPath, { recursive: true });
      } else {
        writeFileSync(
          markerPath,
          `${git(["rev-parse", "HEAD"], fixture.repo).stdout.trim()}\n`,
        );
      }

      const result = runCommitWorkflow(
        "snapshot create",
        ["--mode", "actual", "--scope", "staged", "--output", output],
        fixture.repo,
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, new RegExp(operation, "u"));
    });
  }
});

test("snapshot verification rejects a moved HEAD even when the index tree still matches", (t) => {
  const fixture = createRepositoryFixture(t, "commit-snapshot-verify-");
  const output = join(fixture.scratch, "snapshot.json");

  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");

  const snapshotResult = runCommitWorkflow(
    "snapshot create",
    ["--mode", "actual", "--scope", "full", "--output", output],
    fixture.repo,
  );

  assert.equal(snapshotResult.status, 0, snapshotResult.stderr);

  const currentResult = runCommitWorkflow(
    "snapshot verify",
    ["--manifest", output],
    fixture.repo,
  );

  assert.equal(currentResult.status, 0, currentResult.stderr);
  assert.equal(JSON.parse(currentResult.stdout).valid, true);

  git(["commit", "--quiet", "-m", "concurrent commit"], fixture.repo);

  const staleResult = runCommitWorkflow(
    "snapshot verify",
    ["--manifest", output],
    fixture.repo,
  );

  assert.equal(staleResult.status, 1, staleResult.stderr);
  assert.deepEqual(
    {
      valid: JSON.parse(staleResult.stdout).valid,
      headMatches: JSON.parse(staleResult.stdout).headMatches,
      treeMatches: JSON.parse(staleResult.stdout).treeMatches,
    },
    { valid: false, headMatches: false, treeMatches: true },
  );
});

test("snapshot counts a rename once and preserves unavailable binary line statistics", (t) => {
  const fixture = createRepositoryFixture(t, "commit-stage-special-");
  const output = join(fixture.scratch, "snapshot.json");

  writeRepositoryFile(fixture.repo, "old-name.txt", "same contents\n");
  writeRepositoryFile(fixture.repo, "asset.bin", Buffer.from([0, 1, 2, 3]));
  commitAll(fixture.repo);
  renameSync(
    join(fixture.repo, "old-name.txt"),
    join(fixture.repo, "new-name.txt"),
  );
  writeRepositoryFile(fixture.repo, "asset.bin", Buffer.from([0, 4, 5, 6]));

  const result = runCommitWorkflow(
    "snapshot create",
    ["--mode", "actual", "--scope", "full", "--output", output],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);

  const snapshot = readJson(output);
  const binary = snapshot.changeUnits.find(
    ({ destinationPath }) => destinationPath === "asset.bin",
  );
  const rename = snapshot.changeUnits.find(({ kind }) => kind === "renamed");

  assert.equal(snapshot.changeUnitCount, 2);
  assert.equal(binary.binary, true);
  assert.equal(binary.additions, null);
  assert.equal(binary.deletions, null);
  assert.equal(rename.sourcePath, "old-name.txt");
  assert.equal(rename.destinationPath, "new-name.txt");
  assert.deepEqual(snapshot.statistics, {
    files: 2,
    additions: 0,
    deletions: 0,
    binaryFiles: 1,
  });
});

test("snapshot treats a similar destination with a retained source as an addition", (t) => {
  const fixture = createRepositoryFixture(t, "commit-stage-adapted-addition-");
  const output = join(fixture.scratch, "snapshot.json");
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

  writeRepositoryFile(fixture.repo, "src/source-parser.js", `${source}\n`);
  commitAll(fixture.repo);
  git(["config", "diff.renames", "copies"], fixture.repo);
  writeRepositoryFile(
    fixture.repo,
    "src/adapted-parser.js",
    `${destination}\n`,
  );
  git(["add", "--", "src/adapted-parser.js"], fixture.repo);

  const result = runCommitWorkflow(
    "snapshot create",
    ["--mode", "actual", "--scope", "staged", "--output", output],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);

  const snapshot = readJson(output);

  assert.equal(snapshot.changeUnitCount, 1);
  assert.equal(snapshot.diffPolicy.copyDetection, false);
  assert.deepEqual(
    {
      kind: snapshot.changeUnits[0].kind,
      sourcePath: snapshot.changeUnits[0].sourcePath,
      destinationPath: snapshot.changeUnits[0].destinationPath,
      path: snapshot.changeUnits[0].path,
      similarity: snapshot.changeUnits[0].similarity,
    },
    {
      kind: "added",
      sourcePath: null,
      destinationPath: "src/adapted-parser.js",
      path: "src/adapted-parser.js",
      similarity: null,
    },
  );
});

test("snapshot counts retained-source additions and special Git changes once", (t) => {
  const fixture = createRepositoryFixture(t, "commit-stage-kinds-");
  const output = join(fixture.scratch, "snapshot.json");

  writeRepositoryFile(fixture.repo, "source.txt", "copy source\n");
  writeRepositoryFile(fixture.repo, "script.sh", "#!/bin/sh\nexit 0\n");
  writeRepositoryFile(fixture.repo, "type-entry", "regular file\n");
  commitAll(fixture.repo);

  const oldLinkOid = git(["hash-object", "-w", "--stdin"], fixture.repo, {
    input: "old-target",
  }).stdout.trim();

  git(
    ["update-index", "--add", "--cacheinfo", `120000,${oldLinkOid},link-entry`],
    fixture.repo,
  );
  git(["commit", "--quiet", "-m", "add symlink fixture"], fixture.repo);

  const newLinkOid = git(["hash-object", "-w", "--stdin"], fixture.repo, {
    input: "new-target",
  }).stdout.trim();
  const headOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();

  writeRepositoryFile(fixture.repo, "copy.txt", "copy source\n");
  git(["add", "--", "copy.txt"], fixture.repo);
  git(["update-index", "--chmod=+x", "script.sh"], fixture.repo);
  git(
    ["update-index", "--cacheinfo", `120000,${newLinkOid},type-entry`],
    fixture.repo,
  );
  git(
    ["update-index", "--cacheinfo", `120000,${newLinkOid},link-entry`],
    fixture.repo,
  );
  git(
    [
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${headOid},vendor/component`,
    ],
    fixture.repo,
  );

  const result = runCommitWorkflow(
    "snapshot create",
    ["--mode", "actual", "--scope", "staged", "--output", output],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);

  const snapshot = readJson(output);

  assert.equal(snapshot.changeUnitCount, 5);
  assert.deepEqual(
    Object.fromEntries(
      snapshot.changeUnits.map(({ destinationPath, kind }) => [
        destinationPath,
        kind,
      ]),
    ),
    {
      "copy.txt": "added",
      "link-entry": "symlink-changed",
      "script.sh": "mode-changed",
      "type-entry": "type-changed",
      "vendor/component": "submodule-changed",
    },
  );

  const addition = snapshot.changeUnits.find(
    ({ destinationPath }) => destinationPath === "copy.txt",
  );

  assert.equal(addition.kind, "added");
  assert.equal(addition.sourcePath, null);
  assert.equal(addition.destinationPath, "copy.txt");
});

test("path scope rejects a pre-existing staged snapshot before adding more paths", (t) => {
  const fixture = createRepositoryFixture(t, "commit-stage-ambiguous-");
  const output = join(fixture.scratch, "snapshot.json");
  const scopeFile = join(fixture.scratch, "scope.json");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "already-staged.txt", "staged\n");
  writeRepositoryFile(fixture.repo, "requested.txt", "requested\n");
  git(["add", "--", "already-staged.txt"], fixture.repo);
  writeFileSync(scopeFile, `${JSON.stringify({ paths: ["requested.txt"] })}\n`);
  const treeBefore = git(["write-tree"], fixture.repo).stdout.trim();

  const result = runCommitWorkflow(
    "snapshot create",
    [
      "--mode",
      "actual",
      "--scope",
      "paths",
      "--scope-file",
      scopeFile,
      "--output",
      output,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /already contains staged changes/u);
  assert.equal(git(["write-tree"], fixture.repo).stdout.trim(), treeBefore);
});

test("actual full leaves the real index unchanged when snapshot output fails", (t) => {
  const fixture = createRepositoryFixture(t, "commit-stage-output-failure-");

  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");
  writeRepositoryFile(fixture.repo, "untracked.txt", "new\n");

  const indexTreeBefore = git(["write-tree"], fixture.repo).stdout.trim();
  const result = runCommitWorkflow(
    "snapshot create",
    ["--mode", "actual", "--scope", "full", "--output", fixture.scratch],
    fixture.repo,
  );

  assert.equal(result.status, 2);
  assert.equal(
    git(["write-tree"], fixture.repo).stdout.trim(),
    indexTreeBefore,
  );
  assert.equal(
    git(
      ["status", "--porcelain", "--", "tracked.txt", "untracked.txt"],
      fixture.repo,
    ).stdout,
    " M tracked.txt\n?? untracked.txt\n",
  );
});

test("full scope on an unborn branch compares the first snapshot with the empty tree", (t) => {
  const fixture = createRepositoryFixture(t, "commit-stage-unborn-");
  const output = join(fixture.scratch, "snapshot.json");

  writeRepositoryFile(fixture.repo, "first.txt", "first commit\n");

  const result = runCommitWorkflow(
    "snapshot create",
    ["--mode", "actual", "--scope", "full", "--output", output],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);

  const snapshot = readJson(output);

  assert.equal(snapshot.headOid, null);
  assert.equal(snapshot.changeUnitCount, 1);
  assert.equal(snapshot.changeUnits[0].kind, "added");
  assert.equal(snapshot.changeUnits[0].destinationPath, "first.txt");
});
