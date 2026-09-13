// Snapshot-domain policies retained after the public low-level CLI cutover.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { createSnapshot } from "../../src/committing-to-git/snapshot/createSnapshot.js";

import {
  MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES,
  MAXIMUM_SIMILARITY_CANDIDATE_PAIRS,
  buildSnapshot,
  pairExactObjectRenames,
  selectLineStatisticsPolicy,
  selectRenamePolicy,
} from "../../src/committing-to-git/snapshot/commitSnapshot.js";
import {
  commitAll,
  createRepositoryFixture,
  git,
  writeRepositoryFile,
} from "./harness.mjs";

test("temporary index preserves native detection of same-size racy edits", (t) => {
  const fixture = createRepositoryFixture(t, "racy-index-copy-");
  git(["config", "core.trustctime", "false"], fixture.repo);
  git(["config", "core.checkStat", "minimal"], fixture.repo);
  const file = join(fixture.repo, "same-size.txt");
  const index = join(fixture.repo, ".git", "index");
  const timestamp = 1700000000;
  writeRepositoryFile(fixture.repo, "same-size.txt", "before\n");
  utimesSync(file, timestamp, timestamp);
  commitAll(fixture.repo);
  utimesSync(index, timestamp, timestamp);
  writeRepositoryFile(fixture.repo, "same-size.txt", "after!\n");
  utimesSync(file, timestamp, timestamp);
  const originalIndex = readFileSync(index);
  const nativeDiff = git(["diff", "--name-only"], fixture.repo, {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  assert.equal(nativeDiff.stdout, "same-size.txt\n");
  const { snapshot } = createSnapshot({
    root: fixture.repo,
    mode: "actual",
    scope: "paths",
    scopePaths: ["same-size.txt"],
    outputPath: join(fixture.scratch, "snapshot.json"),
    deferIndexInstallation: true,
  });
  assert.equal(snapshot.changeUnitCount, 1);
  assert.equal(
    git(["rev-parse", `${snapshot.indexTreeOid}:same-size.txt`], fixture.repo)
      .stdout,
    git(["hash-object", "same-size.txt"], fixture.repo).stdout,
  );
  assert.deepEqual(readFileSync(index), originalIndex);
});

test("rename candidate policy honors its exact pair budget without overflow", () => {
  assert.equal(MAXIMUM_SIMILARITY_CANDIDATE_PAIRS, 40_000);
  assert.deepEqual(
    selectRenamePolicy({
      addedCandidates: 200,
      deletedCandidates: 200,
      maximumCandidatePairs: MAXIMUM_SIMILARITY_CANDIDATE_PAIRS,
    }),
    { mode: "eager", candidatePairs: 40_000 },
  );
  assert.deepEqual(
    selectRenamePolicy({
      addedCandidates: 1,
      deletedCandidates: 40_001,
      maximumCandidatePairs: MAXIMUM_SIMILARITY_CANDIDATE_PAIRS,
    }),
    { mode: "deferred", candidatePairs: 40_001 },
  );
  assert.deepEqual(
    selectRenamePolicy({
      addedCandidates: Number.MAX_SAFE_INTEGER,
      deletedCandidates: Number.MAX_SAFE_INTEGER,
      maximumCandidatePairs: MAXIMUM_SIMILARITY_CANDIDATE_PAIRS,
    }),
    {
      mode: "deferred",
      candidatePairs: "81129638414606663681390495662081",
    },
  );
});

test("line-stat policy handles exact, beyond-safe, and malformed byte sizes", () => {
  assert.equal(MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES, 64 * 1024 * 1024);
  assert.deepEqual(
    selectLineStatisticsPolicy({
      eligibleBlobBytes: String(MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES),
      maximumEagerBytes: MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES,
    }),
    {
      mode: "eager",
      eligibleBlobBytes: MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES,
    },
  );
  assert.deepEqual(
    selectLineStatisticsPolicy({
      eligibleBlobBytes: String(MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES + 1),
      maximumEagerBytes: MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES,
    }),
    {
      mode: "deferred",
      eligibleBlobBytes: MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES + 1,
    },
  );
  assert.deepEqual(
    selectLineStatisticsPolicy({
      eligibleBlobBytes: "9007199254740993",
      maximumEagerBytes: MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES,
    }),
    { mode: "deferred", eligibleBlobBytes: "9007199254740993" },
  );
  assert.throws(
    () =>
      selectLineStatisticsPolicy({
        eligibleBlobBytes: "12.5",
        maximumEagerBytes: MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES,
      }),
    /eligible blob bytes/iu,
  );
});

test("a generated blob preserves exact facts when line statistics defer", (t) => {
  const fixture = createRepositoryFixture(t, "commit-line-stat-deferred-");
  const original = `${"original content\n".repeat(32_768)}`;
  const replacement = `${"replacement content\n".repeat(65_536)}`;

  writeRepositoryFile(fixture.repo, "generated.txt", original);
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "generated.txt", replacement);
  git(["add", "--", "generated.txt"], fixture.repo);

  const headOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const indexTreeOid = git(["write-tree"], fixture.repo).stdout.trim();
  const snapshot = buildSnapshot({
    root: fixture.repo,
    workflowMode: "actual",
    scopeKind: "staged",
    sourceIndex: "real",
    headOid,
    indexTreeOid,
    maximumEagerLineStatInputBytes: 1024,
  });

  assert.equal(snapshot.diffPolicy.lineStatistics.mode, "deferred");
  assert.equal(snapshot.statistics.additions, null);
  assert.equal(snapshot.statistics.deletions, null);
  assert.equal(snapshot.changeUnitCount, 1);
  assert.deepEqual(
    {
      path: snapshot.changeUnits[0].destinationPath,
      kind: snapshot.changeUnits[0].kind,
      lineStatistics: snapshot.changeUnits[0].lineStatistics,
      additions: snapshot.changeUnits[0].additions,
      deletions: snapshot.changeUnits[0].deletions,
    },
    {
      path: "generated.txt",
      kind: "modified",
      lineStatistics: "deferred",
      additions: null,
      deletions: null,
    },
  );
});

test("exact-object rename pairing never invents ambiguous provenance", () => {
  const oid = "a".repeat(40);
  const unit = (kind, path) => ({
    kind,
    sourcePath: null,
    destinationPath: path,
    path,
    sourcePathBytesBase64: null,
    destinationPathBytesBase64: Buffer.from(path).toString("base64"),
    displayPath: path,
    oldMode: kind === "deleted" ? "100644" : "000000",
    newMode: kind === "added" ? "100644" : "000000",
    oldOid: kind === "deleted" ? oid : "0".repeat(40),
    newOid: kind === "added" ? oid : "0".repeat(40),
    similarity: null,
    renameClassification: null,
  });

  const unique = pairExactObjectRenames([
    unit("deleted", "before.txt"),
    unit("added", "after.txt"),
  ]);
  assert.deepEqual(
    unique.map(
      ({ kind, sourcePath, destinationPath, renameClassification }) => ({
        kind,
        sourcePath,
        destinationPath,
        renameClassification,
      }),
    ),
    [
      {
        kind: "renamed",
        sourcePath: "before.txt",
        destinationPath: "after.txt",
        renameClassification: "exact-object",
      },
    ],
  );

  const ambiguous = pairExactObjectRenames([
    unit("deleted", "one.txt"),
    unit("deleted", "two.txt"),
    unit("added", "three.txt"),
  ]);
  assert.equal(
    ambiguous.some(({ kind }) => kind === "renamed"),
    false,
  );
  assert.equal(
    ambiguous.every(
      ({ renameClassification }) =>
        renameClassification === "exact-rename-ambiguous",
    ),
    true,
  );
});
