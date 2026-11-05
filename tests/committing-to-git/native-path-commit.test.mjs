import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  commitAll,
  configureSshSigning,
  createRepositoryFixture,
  git,
  writeRepositoryFile,
} from "./harness.mjs";

test("native signed path-only commit preserves unrelated partial staging with separate message and NUL path transports", (t) => {
  const fixture = createRepositoryFixture(t, "c2g-native-paths-");
  const selected = ["selected [literal].txt", "new file.txt"];
  writeRepositoryFile(fixture.repo, selected[0], "before\n");
  writeRepositoryFile(fixture.repo, "other.txt", "before\n");
  commitAll(fixture.repo);
  if (!configureSshSigning(t, fixture)) return;
  writeRepositoryFile(fixture.repo, "other.txt", "staged\n");
  git(["add", "other.txt"], fixture.repo);
  writeRepositoryFile(fixture.repo, "other.txt", "unstaged\n");
  const unrelatedIndex = git(
    ["ls-files", "--stage", "--", "other.txt"],
    fixture.repo,
  ).stdout;
  writeRepositoryFile(fixture.repo, selected[0], "partially staged\n");
  git(["--literal-pathspecs", "add", "--", selected[0]], fixture.repo);
  writeRepositoryFile(fixture.repo, selected[0], "whole selected path\n");
  writeRepositoryFile(fixture.repo, selected[1], "new\n");
  const paths = Buffer.from(selected.map((path) => `${path}\0`).join(""));
  const pathFile = join(fixture.scratch, "paths");
  writeFileSync(pathFile, paths, { mode: 0o600 });
  git(
    [
      "--literal-pathspecs",
      "add",
      "-A",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
    ],
    fixture.repo,
    { input: paths },
  );
  const message = "fix: Commit selected paths\n\nKeep exact message bytes.\n";
  git(
    [
      "--literal-pathspecs",
      "commit",
      "--only",
      "--cleanup=verbatim",
      "-S",
      "-F",
      "-",
      `--pathspec-from-file=${pathFile}`,
      "--pathspec-file-nul",
    ],
    fixture.repo,
    { input: message },
  );
  assert.deepEqual(
    git(
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"],
      fixture.repo,
    )
      .stdout.trim()
      .split("\n")
      .sort(),
    [...selected].sort(),
  );
  assert.equal(
    git(["show", `HEAD:${selected[0]}`], fixture.repo).stdout,
    "whole selected path\n",
  );
  assert.equal(
    git(["ls-files", "--stage", "--", "other.txt"], fixture.repo).stdout,
    unrelatedIndex,
  );
  assert.equal(
    readFileSync(join(fixture.repo, "other.txt"), "utf8"),
    "unstaged\n",
  );
  assert.ok(
    git(["cat-file", "commit", "HEAD"], fixture.repo).stdout.includes(
      "gpgsig -----BEGIN SSH SIGNATURE-----",
    ),
  );
  const rawCommit = git(["cat-file", "commit", "HEAD"], fixture.repo).stdout;
  assert.equal(rawCommit.slice(rawCommit.indexOf("\n\n") + 2), message);
});
