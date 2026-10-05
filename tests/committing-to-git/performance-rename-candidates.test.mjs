import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  commitAll,
  createRepositoryFixture,
  git,
  writeRepositoryFile,
} from "./harness.mjs";

test("native unstaged deletion has an index OID; losing it requires changed index state", (t) => {
  const fixture = createRepositoryFixture(t, "performance-rename-candidates-");
  writeRepositoryFile(fixture.repo, "old.txt", "same bytes\n");
  commitAll(fixture.repo);
  unlinkSync(join(fixture.repo, "old.txt"));
  writeRepositoryFile(fixture.repo, "new.txt", "same bytes\n");
  const deletion = git(
    ["diff", "--name-status", "--no-renames", "--"],
    fixture.repo,
  ).stdout;
  assert.equal(deletion.trim(), "D\told.txt");
  const entries = git(
    ["ls-files", "--stage", "--", "old.txt"],
    fixture.repo,
  ).stdout;
  const oid = entries.split(" ")[1];
  assert.match(oid, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);
  assert.equal(
    git(
      ["hash-object", "--no-filters", "--", "new.txt"],
      fixture.repo,
    ).stdout.trim(),
    oid,
  );

  // A real inter-command mutation makes the old deletion response stale.
  git(["rm", "--cached", "--", "old.txt"], fixture.repo);
  assert.equal(
    git(["ls-files", "--stage", "--", "old.txt"], fixture.repo).stdout,
    "",
  );
  assert.equal(
    git(["diff", "--name-status", "--no-renames", "--"], fixture.repo).stdout,
    "",
  );
  // Skipping hashing on that stale response would suppress this native error.
  unlinkSync(join(fixture.repo, "new.txt"));
  assert.notEqual(
    git(["hash-object", "--no-filters", "--", "new.txt"], fixture.repo, {
      allowFailure: true,
    }).status,
    0,
  );
});
