import { EventEmitter } from "node:events";
import { chmodSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { PassThrough } from "node:stream";

import assert from "node:assert/strict";
import test from "node:test";

import { selectedWorktreeMatchesPreparedTree } from "../../src/committing-to-git/checks/checkWorkspace.js";
import { buildSnapshot } from "../../src/committing-to-git/snapshot/commitSnapshot.js";
import {
  commitAll,
  createRepositoryFixture,
  git,
  writeRepositoryFile,
} from "./harness.mjs";

function stagedManifest(repo) {
  return buildSnapshot({
    root: repo,
    env: undefined,
    workflowMode: "actual",
    scopeKind: "staged",
    sourceIndex: "real",
    headOid: git(["rev-parse", "HEAD"], repo).stdout.trim(),
  });
}

function splitRecordLauncher(chunks, observedArguments) {
  return (_executable, args) => {
    const child = new EventEmitter();

    observedArguments.push([...args]);
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;

    queueMicrotask(() => {
      for (const chunk of chunks) {
        child.stdout.write(chunk);
      }

      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child;
  };
}

test("selected worktree comparison covers literal source and destination paths only", async (t) => {
  const fixture = createRepositoryFixture(t, "check-worktree-subject-");

  writeRepositoryFile(fixture.repo, "renamed-before.txt", "rename\n");
  writeRepositoryFile(fixture.repo, "deleted.txt", "delete\n");
  writeRepositoryFile(fixture.repo, "--literal-option.txt", "literal\n");
  writeRepositoryFile(fixture.repo, "unrelated-tracked.txt", "before\n");
  commitAll(fixture.repo);

  git(["mv", "renamed-before.txt", "renamed-after.txt"], fixture.repo);
  git(["rm", "deleted.txt"], fixture.repo);
  writeRepositoryFile(fixture.repo, "added.txt", "added\n");
  git(["add", "--", "added.txt"], fixture.repo);
  const manifest = stagedManifest(fixture.repo);
  const observedAt = "2026-08-25T12:00:00.000Z";
  const matching = await selectedWorktreeMatchesPreparedTree({
    root: fixture.repo,
    manifest,
    temporaryDirectory: fixture.scratch,
    now: () => observedAt,
  });

  assert.deepEqual(matching, {
    matches: true,
    pathCount: 4,
    observedAt,
  });

  writeRepositoryFile(fixture.repo, "unrelated.txt", "excluded\n");
  writeRepositoryFile(
    fixture.repo,
    "unrelated-tracked.txt",
    "excluded tracked drift\n",
  );
  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
        now: () => observedAt,
      })
    ).matches,
    true,
  );

  writeRepositoryFile(fixture.repo, "renamed-after.txt", "drifted\n");
  assert.deepEqual(
    await selectedWorktreeMatchesPreparedTree({
      root: fixture.repo,
      manifest,
      temporaryDirectory: fixture.scratch,
      now: () => observedAt,
    }),
    { matches: false, pathCount: 4, observedAt },
  );
});

test("selected worktree comparison treats hostile-looking paths literally", async (t) => {
  const fixture = createRepositoryFixture(t, "check-worktree-literal-");

  writeRepositoryFile(fixture.repo, "--literal-option.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "--literal-option.txt", "after\n");
  git(["add", "--", "--literal-option.txt"], fixture.repo);
  const manifest = stagedManifest(fixture.repo);

  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
      })
    ).matches,
    true,
  );
});

test("selected worktree comparison detects recreated deleted and rename-source paths", async (t) => {
  const fixture = createRepositoryFixture(t, "check-worktree-absence-");

  writeRepositoryFile(fixture.repo, "deleted.txt", "delete\n");
  writeRepositoryFile(fixture.repo, "old-name.txt", "rename\n");
  commitAll(fixture.repo);
  writeRepositoryFile(
    fixture.repo,
    ".gitignore",
    "deleted.txt\nold-name.txt\n",
  );
  commitAll(fixture.repo, "ignore recreated selected paths");
  git(["rm", "deleted.txt"], fixture.repo);
  git(["mv", "old-name.txt", "new-name.txt"], fixture.repo);
  const manifest = stagedManifest(fixture.repo);

  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
      })
    ).matches,
    true,
  );

  writeRepositoryFile(fixture.repo, "deleted.txt", "recreated but ignored\n");
  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
      })
    ).matches,
    false,
  );

  unlinkSync(join(fixture.repo, "deleted.txt"));
  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
      })
    ).matches,
    true,
  );

  writeRepositoryFile(fixture.repo, "old-name.txt", "recreated source\n");
  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
      })
    ).matches,
    false,
  );
});

test("selected worktree comparison detects a prepared addition disappearing", async (t) => {
  const fixture = createRepositoryFixture(t, "check-worktree-added-");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "added.txt", "added\n");
  git(["add", "--", "added.txt"], fixture.repo);
  const manifest = stagedManifest(fixture.repo);

  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
      })
    ).matches,
    true,
  );

  unlinkSync(join(fixture.repo, "added.txt"));
  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
      })
    ).matches,
    false,
  );
});

test("selected worktree comparison handles long selected path identities", async (t) => {
  const fixture = createRepositoryFixture(t, "check-worktree-long-path-");
  const longPath = `long/${"a".repeat(80)}/${"b".repeat(80)}.txt`;

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, longPath, "long path\n");
  git(["add", "--", "long"], fixture.repo);
  const manifest = stagedManifest(fixture.repo);

  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
      })
    ).matches,
    true,
  );

  writeRepositoryFile(fixture.repo, longPath, "long path drift\n");
  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
      })
    ).matches,
    false,
  );
});

test("selected worktree comparison parses raw names across stream chunks", async (t) => {
  const fixture = createRepositoryFixture(t, "check-worktree-chunks-");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "chunked-name.txt", "selected\n");
  git(["add", "--", "chunked-name.txt"], fixture.repo);
  const manifest = stagedManifest(fixture.repo);
  const pathBytes = Buffer.from(
    manifest.changeUnits[0].destinationPathBytesBase64,
    "base64",
  );
  const observedArguments = [];
  const splitAt = Math.floor(pathBytes.length / 2);
  const result = await selectedWorktreeMatchesPreparedTree({
    root: fixture.repo,
    manifest,
    temporaryDirectory: fixture.scratch,
    launchers: {
      asynchronous: splitRecordLauncher(
        [
          pathBytes.subarray(0, splitAt),
          pathBytes.subarray(splitAt),
          Buffer.from([0]),
        ],
        observedArguments,
      ),
    },
  });

  assert.equal(result.matches, false);
  assert.equal(observedArguments.length, 1);
  assert.equal(
    observedArguments[0].some((argument) =>
      argument.includes("chunked-name.txt"),
    ),
    false,
  );
});

test("selected worktree comparison witnesses gitlink state", async (t) => {
  const fixture = createRepositoryFixture(t, "check-worktree-gitlink-");
  const nested = join(fixture.repo, "nested-repository");

  writeRepositoryFile(nested, "nested.txt", "one\n");
  git(["init", "--quiet", "-b", "main"], nested);
  git(["config", "user.email", "tests@example.invalid"], nested);
  git(["config", "user.name", "Nested Tests"], nested);
  commitAll(nested, "nested one");
  git(["add", "--", "nested-repository"], fixture.repo);
  commitAll(fixture.repo, "seed gitlink");

  writeRepositoryFile(nested, "nested.txt", "two\n");
  commitAll(nested, "nested two");
  git(["add", "--", "nested-repository"], fixture.repo);
  const manifest = stagedManifest(fixture.repo);

  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
      })
    ).matches,
    true,
  );

  writeRepositoryFile(nested, "nested.txt", "three\n");
  commitAll(nested, "nested three");
  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
      })
    ).matches,
    false,
  );
});

test(
  "selected worktree comparison witnesses executable mode changes",
  { skip: process.platform === "win32" },
  async (t) => {
    const fixture = createRepositoryFixture(t, "check-worktree-mode-");
    const scriptPath = join(fixture.repo, "script.sh");

    writeRepositoryFile(fixture.repo, "script.sh", "#!/bin/sh\n");
    commitAll(fixture.repo);
    chmodSync(scriptPath, 0o755);
    git(["add", "--", "script.sh"], fixture.repo);
    const manifest = stagedManifest(fixture.repo);

    assert.equal(
      (
        await selectedWorktreeMatchesPreparedTree({
          root: fixture.repo,
          manifest,
          temporaryDirectory: fixture.scratch,
        })
      ).matches,
      true,
    );

    chmodSync(scriptPath, 0o644);
    assert.equal(
      (
        await selectedWorktreeMatchesPreparedTree({
          root: fixture.repo,
          manifest,
          temporaryDirectory: fixture.scratch,
        })
      ).matches,
      false,
    );
  },
);

test(
  "selected worktree comparison witnesses symbolic-link targets",
  { skip: process.platform === "win32" },
  async (t) => {
    const fixture = createRepositoryFixture(t, "check-worktree-symlink-");
    const linkPath = join(fixture.repo, "selected-link");

    writeRepositoryFile(fixture.repo, "target.txt", "target\n");
    commitAll(fixture.repo);
    symlinkSync("target.txt", linkPath);
    git(["add", "--", "selected-link"], fixture.repo);
    const manifest = stagedManifest(fixture.repo);

    assert.equal(
      (
        await selectedWorktreeMatchesPreparedTree({
          root: fixture.repo,
          manifest,
          temporaryDirectory: fixture.scratch,
        })
      ).matches,
      true,
    );

    unlinkSync(linkPath);
    symlinkSync("different-target.txt", linkPath);
    assert.equal(
      (
        await selectedWorktreeMatchesPreparedTree({
          root: fixture.repo,
          manifest,
          temporaryDirectory: fixture.scratch,
        })
      ).matches,
      false,
    );
  },
);

test(
  "selected worktree comparison preserves non-UTF-8 Git path bytes",
  { skip: process.platform === "win32" },
  async (t) => {
    const fixture = createRepositoryFixture(t, "check-worktree-raw-path-");
    const rawPath = Buffer.from([
      0x72, 0x61, 0x77, 0x2d, 0xff, 0x2e, 0x74, 0x78, 0x74,
    ]);
    const filesystemPath = Buffer.concat([
      Buffer.from(`${fixture.repo}${sep}`, "utf8"),
      rawPath,
    ]);

    writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
    commitAll(fixture.repo);
    writeFileSync(filesystemPath, "raw path\n");
    git(
      [
        "--literal-pathspecs",
        "add",
        "-A",
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
      ],
      fixture.repo,
      { input: Buffer.concat([rawPath, Buffer.from([0])]) },
    );
    const manifest = stagedManifest(fixture.repo);

    assert.equal(
      (
        await selectedWorktreeMatchesPreparedTree({
          root: fixture.repo,
          manifest,
          temporaryDirectory: fixture.scratch,
        })
      ).matches,
      true,
    );

    writeFileSync(filesystemPath, "raw path drift\n");
    assert.equal(
      (
        await selectedWorktreeMatchesPreparedTree({
          root: fixture.repo,
          manifest,
          temporaryDirectory: fixture.scratch,
        })
      ).matches,
      false,
    );
  },
);

test("selected worktree comparison accepts an empty prepared scope without Git work", async (t) => {
  const fixture = createRepositoryFixture(t, "check-worktree-empty-");
  const observedAt = "2026-08-25T12:00:00.000Z";

  assert.deepEqual(
    await selectedWorktreeMatchesPreparedTree({
      root: fixture.repo,
      manifest: {
        indexTreeOid: "a".repeat(40),
        changeUnits: [],
      },
      temporaryDirectory: fixture.scratch,
      now: () => observedAt,
    }),
    { matches: true, pathCount: 0, observedAt },
  );
});

test("selected worktree comparison rejects path identities that can escape the root", async (t) => {
  const fixture = createRepositoryFixture(t, "check-worktree-traversal-");
  const traversal = process.platform === "win32" ? "..\\escape" : "../escape";

  await assert.rejects(
    selectedWorktreeMatchesPreparedTree({
      root: fixture.repo,
      manifest: {
        indexTreeOid: "a".repeat(40),
        changeUnits: [
          {
            sourcePathBytesBase64: null,
            destinationPathBytesBase64:
              Buffer.from(traversal).toString("base64"),
            newMode: "100644",
            newOid: "b".repeat(40),
          },
        ],
      },
      temporaryDirectory: fixture.scratch,
    }),
    /valid repository-relative Git path/u,
  );
});
