import assert from "node:assert/strict";
import test from "node:test";

import * as gitRepository from "../../src/committing-to-git/git/gitRepository.js";
import {
  commitAll,
  createRepositoryFixture,
  git,
  writeRepositoryFile,
} from "./harness.mjs";

test("selected worktree comparison covers literal source and destination paths only", (t) => {
  const fixture = createRepositoryFixture(t, "check-worktree-subject-");

  writeRepositoryFile(fixture.repo, "renamed-before.txt", "rename\n");
  writeRepositoryFile(fixture.repo, "deleted.txt", "delete\n");
  writeRepositoryFile(fixture.repo, "--literal-option.txt", "literal\n");
  commitAll(fixture.repo);

  git(["mv", "renamed-before.txt", "renamed-after.txt"], fixture.repo);
  git(["rm", "deleted.txt"], fixture.repo);
  writeRepositoryFile(fixture.repo, "added.txt", "added\n");
  git(["add", "--", "added.txt"], fixture.repo);
  const indexTreeOid = git(["write-tree"], fixture.repo).stdout.trim();
  const manifest = {
    indexTreeOid,
    changeUnits: [
      {
        sourcePath: "renamed-before.txt",
        destinationPath: "renamed-after.txt",
      },
      { sourcePath: "deleted.txt", destinationPath: "deleted.txt" },
      { sourcePath: null, destinationPath: "added.txt" },
    ],
  };
  const observedAt = "2026-08-25T12:00:00.000Z";
  const compare = gitRepository.selectedWorktreeMatchesPreparedTree;
  const matching = compare?.({
    root: fixture.repo,
    manifest,
    now: () => observedAt,
  });

  assert.deepEqual(matching, {
    matches: true,
    pathCount: 4,
    observedAt,
  });

  writeRepositoryFile(fixture.repo, "unrelated.txt", "excluded\n");
  assert.equal(
    compare?.({ root: fixture.repo, manifest, now: () => observedAt }).matches,
    true,
  );

  writeRepositoryFile(fixture.repo, "renamed-after.txt", "drifted\n");
  assert.deepEqual(
    compare?.({ root: fixture.repo, manifest, now: () => observedAt }),
    { matches: false, pathCount: 4, observedAt },
  );
});

test("selected worktree comparison treats hostile-looking paths literally", (t) => {
  const fixture = createRepositoryFixture(t, "check-worktree-literal-");

  writeRepositoryFile(fixture.repo, "--literal-option.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "--literal-option.txt", "after\n");
  git(["add", "--", "--literal-option.txt"], fixture.repo);
  const manifest = {
    indexTreeOid: git(["write-tree"], fixture.repo).stdout.trim(),
    changeUnits: [
      { sourcePath: null, destinationPath: "--literal-option.txt" },
    ],
  };

  assert.equal(
    gitRepository.selectedWorktreeMatchesPreparedTree?.({
      root: fixture.repo,
      manifest,
    }).matches,
    true,
  );
});

test("selected worktree comparison accepts an empty prepared scope without Git work", (t) => {
  const fixture = createRepositoryFixture(t, "check-worktree-empty-");
  const observedAt = "2026-08-25T12:00:00.000Z";

  assert.deepEqual(
    gitRepository.selectedWorktreeMatchesPreparedTree?.({
      root: fixture.repo,
      manifest: {
        indexTreeOid: "a".repeat(40),
        changeUnits: [],
      },
      now: () => observedAt,
    }),
    { matches: true, pathCount: 0, observedAt },
  );
});
