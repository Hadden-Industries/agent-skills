import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { readStableFile } from "../../lib/filesystem/stableFile.js";
import { commitProposalWorkflow } from "../../src/committing-to-git/workflow/commitProposalWorkflow.js";

import {
  assertWorkflowResult,
  commitAll,
  configureSshSigning,
  createRepositoryFixture,
  git,
  runCommitWorkflow,
  writeRepositoryFile,
} from "./harness.mjs";

/** Snapshot fixture entries, rejecting unstable or linked file reads. */
function inventory(root) {
  return readdirSync(root, { withFileTypes: true })
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )
    .flatMap((entry) => {
      const { name } = entry;
      const path = join(root, name);
      if (entry.isDirectory())
        return [name, ...inventory(path).map((entry) => `${name}/${entry}`)];
      const { bytes } = readStableFile(path, Number.MAX_SAFE_INTEGER, {
        rejectLinkedAncestors: true,
      });
      return [`${name}:${createHash("sha256").update(bytes).digest("hex")}`];
    });
}

function fixtureFor(t) {
  const fixture = createRepositoryFixture(t, "c2g-memory-paths-");
  writeRepositoryFile(
    fixture.repo,
    "selected [literal].txt",
    "first\nsecond\n",
  );
  writeRepositoryFile(fixture.repo, "other.txt", "original\n");
  commitAll(fixture.repo);
  const sentinel = join(fixture.scratch, "temporary");
  mkdirSync(sentinel);
  return {
    ...fixture,
    env: { TEMP: sentinel, TMP: sentinel, TMPDIR: sentinel },
    sentinel,
  };
}

function invoke(fixture, command, args, input) {
  const child = runCommitWorkflow(command, args, fixture.repo, {
    env: fixture.env,
    input,
  });
  return { child, result: JSON.parse(child.stdout) };
}

function prepare(fixture, selectors, extra = []) {
  return invoke(fixture, "workflow prepare", [
    "--mode",
    "actual",
    "--scope",
    "paths",
    ...(extra.includes("--evidence")
      ? []
      : ["--evidence", "reuse", "--basis", "authored-current-task"]),
    ...(extra.includes("--verification") ? [] : ["--verification", "skipped"]),
    ...selectors,
    ...extra,
  ]);
}

test("memory path prepare/check are read-only, selected evidence excludes unrelated edits and untracked limits", async (t) => {
  const fixture = fixtureFor(t);
  writeRepositoryFile(
    fixture.repo,
    "selected [literal].txt",
    "selected correction\n",
  );
  writeRepositoryFile(fixture.repo, "other.txt", "unrelated staged secret\n");
  git(["add", "other.txt"], fixture.repo);
  writeRepositoryFile(fixture.repo, "other.txt", "unrelated unstaged secret\n");
  for (let index = 0; index < 130; index++)
    writeRepositoryFile(
      fixture.repo,
      `unrelated/${index}.txt`,
      "outside scope\n",
    );
  const before = inventory(fixture.base);
  const { child, result } = prepare(
    fixture,
    ["--path", "selected [literal].txt"],
    [
      "--evidence",
      "message",
      "--basis",
      "read-current-task",
      "--message-format",
      "detailed",
    ],
  );
  assert.equal(child.status, 0, child.stdout + child.stderr);
  await assertWorkflowResult(result, 0);
  assert.equal(result.stateStorage, "memory");
  assert.equal(result.transaction, null);
  assert.equal(result.scope.kind, "paths");
  assert.equal(result.changeUnitCount, 1);
  assert.match(result.capsule.evidence[0].patchText, /selected correction/u);
  assert.doesNotMatch(
    JSON.stringify(result.capsule),
    /unrelated .*secret|outside scope/u,
  );
  const message =
    "fix: Correct the selected file\n\nFile Changes:\n  1. `selected [literal].txt`\n";
  const checked = invoke(
    fixture,
    "message check",
    ["--proposal", result.proposal],
    message,
  );
  assert.equal(checked.child.status, 0, checked.child.stdout);
  assert.equal(checked.result.displayText, message);
  assert.deepEqual(inventory(fixture.base), before);
});

test("required SSH verification succeeds for a selected path", async (t) => {
  const fixture = fixtureFor(t);
  if (!configureSshSigning(t, fixture)) return;
  const allowedSigners = join(fixture.scratch, "allowed-signers");
  writeFileSync(
    allowedSigners,
    `tests@example.invalid ${readFileSync(join(fixture.scratch, "signing-key.pub"), "utf8").trim()}\n`,
  );
  git(["config", "gpg.ssh.allowedSignersFile", allowedSigners], fixture.repo);
  writeRepositoryFile(
    fixture.repo,
    "selected [literal].txt",
    "verified change\n",
  );
  const prepared = prepare(
    fixture,
    ["--path", "selected [literal].txt"],
    ["--verification", "required"],
  );
  assert.equal(prepared.child.status, 0, prepared.child.stdout);
  const committed = invoke(fixture, "workflow commit", [
    "--proposal",
    prepared.result.proposal,
    "--message",
    "fix: Verify selected path signing",
  ]);
  assert.equal(committed.child.status, 0, committed.child.stdout);
  await assertWorkflowResult(committed.result, 0);
  git(["verify-commit", "HEAD"], fixture.repo);
});

test("unborn path commits exclude unrelated staged files", (t) => {
  const fixture = createRepositoryFixture(t, "c2g-memory-unborn-paths-");
  fixture.env = {};
  if (!configureSshSigning(t, fixture)) return;
  writeRepositoryFile(fixture.repo, "selected.txt", "selected\n");
  writeRepositoryFile(fixture.repo, "unrelated.txt", "unrelated\n");
  git(["add", "unrelated.txt"], fixture.repo);
  const prepared = prepare(fixture, ["--path", "selected.txt"]);
  assert.equal(prepared.child.status, 0, prepared.child.stdout);
  const committed = invoke(fixture, "workflow commit", [
    "--proposal",
    prepared.result.proposal,
    "--message",
    "fix: Create the selected file",
  ]);
  assert.equal(committed.child.status, 0, committed.child.stdout);
  assert.deepEqual(committed.result.commit.parentOids, []);
  assert.equal(
    git(["ls-tree", "--name-only", "HEAD"], fixture.repo).stdout,
    "selected.txt\n",
  );
  assert.equal(
    git(["show", ":unrelated.txt"], fixture.repo).stdout,
    "unrelated\n",
  );
});

test("whole path selection remains literal for leading dashes, Unicode and metacharacters", (t) => {
  const fixture = fixtureFor(t);
  if (!configureSshSigning(t, fixture)) return;
  const paths = [
    "-leading.txt",
    "unicode-\u00e9.txt",
    "brackets[1].txt",
    ...(process.platform === "win32" ? [] : ['quote".txt', "line\nname.txt"]),
  ];
  for (const path of paths)
    writeRepositoryFile(fixture.repo, path, `content for ${path}\n`);
  writeRepositoryFile(fixture.repo, "brackets1.txt", "must stay untracked\n");
  const prepared = prepare(
    fixture,
    paths.map((path) => `--path=${path}`),
  );
  assert.equal(prepared.child.status, 0, prepared.child.stdout);
  const committed = invoke(fixture, "workflow commit", [
    "--proposal",
    prepared.result.proposal,
    "--message",
    "fix: Add literal selected paths",
  ]);
  assert.equal(committed.child.status, 0, committed.child.stdout);
  assert.equal(committed.result.commit.treeMatches, true);
  const actual = git(["ls-tree", "-z", "--name-only", "HEAD"], fixture.repo)
    .stdout.split("\0")
    .filter(Boolean);
  assert.deepEqual(
    actual.sort(),
    [...paths, "other.txt", "selected [literal].txt"].sort(),
  );
});

test("draft memory path scope observes selected partial staging without writes and cannot commit", (t) => {
  const fixture = fixtureFor(t);
  writeRepositoryFile(fixture.repo, "selected [literal].txt", "staged\n");
  git(
    ["--literal-pathspecs", "add", "--", "selected [literal].txt"],
    fixture.repo,
  );
  writeRepositoryFile(
    fixture.repo,
    "selected [literal].txt",
    "whole worktree\n",
  );
  const before = inventory(fixture.base);
  const prepared = invoke(fixture, "workflow prepare", [
    "--mode",
    "draft",
    "--scope",
    "paths",
    "--path",
    "selected [literal].txt",
    "--evidence",
    "reuse",
    "--basis",
    "read-current-task",
  ]);
  assert.equal(prepared.child.status, 0, prepared.child.stdout);
  const committed = invoke(fixture, "workflow commit", [
    "--proposal",
    prepared.result.proposal,
    "--message",
    "fix: Keep the draft read-only",
  ]);
  assert.equal(committed.result.code, "DRAFT_PROPOSAL_NOT_COMMITTABLE");
  assert.deepEqual(inventory(fixture.base), before);
});

test("a hook-mutated path commit is retained and reported as a mismatch", (t) => {
  const fixture = fixtureFor(t);
  if (!configureSshSigning(t, fixture)) return;
  writeRepositoryFile(fixture.repo, "selected [literal].txt", "selected\n");
  writeRepositoryFile(fixture.repo, "other.txt", "hook addition\n");
  const prepared = prepare(fixture, ["--path", "selected [literal].txt"]);
  writeFileSync(
    join(fixture.repo, ".git", "hooks", "pre-commit"),
    "#!/bin/sh\ngit add other.txt\n",
    { mode: 0o700 },
  );
  const committed = invoke(fixture, "workflow commit", [
    "--proposal",
    prepared.result.proposal,
    "--message",
    "fix: Detect a hook mutation",
  ]);
  assert.equal(committed.child.status, 3, committed.child.stdout);
  assert.equal(committed.result.code, "COMMIT_POLICY_BLOCKED");
  assert.equal(committed.result.commitState, "created");
  assert.equal(committed.result.commit.treeMatches, false);
  assert.equal(
    git(["rev-parse", "HEAD"], fixture.repo).stdout.trim(),
    committed.result.commitOid,
  );
  assert.deepEqual(readdirSync(fixture.sentinel), []);
});

test("signed memory paths commit whole selected files and preserve unrelated partial staging, including new staging after prepare", async (t) => {
  const fixture = fixtureFor(t);
  if (!configureSshSigning(t, fixture)) return;
  writeRepositoryFile(
    fixture.repo,
    "selected [literal].txt",
    "selected staged\n",
  );
  git(
    ["--literal-pathspecs", "add", "--", "selected [literal].txt"],
    fixture.repo,
  );
  writeRepositoryFile(
    fixture.repo,
    "selected [literal].txt",
    "whole selected worktree\n",
  );
  writeRepositoryFile(fixture.repo, "other.txt", "staged unrelated\n");
  git(["add", "other.txt"], fixture.repo);
  writeRepositoryFile(fixture.repo, "other.txt", "unstaged unrelated\n");
  const unrelated = git(
    ["ls-files", "--stage", "--", "other.txt"],
    fixture.repo,
  ).stdout;
  const prepared = prepare(
    fixture,
    ["--path", "selected [literal].txt"],
    ["--message-format", "detailed"],
  );
  assert.equal(prepared.child.status, 0, prepared.child.stdout);
  writeRepositoryFile(fixture.repo, "later.txt", "later staged\n");
  git(["add", "later.txt"], fixture.repo);
  const message =
    "fix: Correct the selected file\n\nFile Changes:\n  1. `selected [literal].txt`\n";
  const checked = invoke(
    fixture,
    "message check",
    ["--proposal", prepared.result.proposal],
    message,
  );
  assert.equal(checked.child.status, 0, checked.child.stdout);
  const committed = invoke(
    fixture,
    "workflow commit",
    checked.result.commit.arguments.slice(2),
    message,
  );
  assert.equal(
    committed.child.status,
    0,
    committed.child.stdout + committed.child.stderr,
  );
  await assertWorkflowResult(committed.result, 0);
  assert.equal(committed.result.commit.signed, true);
  assert.equal(committed.result.commit.treeMatches, true);
  assert.equal(committed.result.commit.messageMatches, true);
  assert.equal(
    git(["show", "--format=", "--name-only", "HEAD"], fixture.repo).stdout,
    "selected [literal].txt\n",
  );
  assert.equal(
    git(["show", "HEAD:selected [literal].txt"], fixture.repo).stdout,
    "whole selected worktree\n",
  );
  assert.equal(
    git(["ls-files", "--stage", "--", "other.txt"], fixture.repo).stdout,
    unrelated,
  );
  assert.equal(
    git(["show", ":later.txt"], fixture.repo).stdout,
    "later staged\n",
  );
  assert.equal(
    readFileSync(join(fixture.repo, "other.txt"), "utf8"),
    "unstaged unrelated\n",
  );
  assert.deepEqual(readdirSync(fixture.sentinel), []);
});

test("prefix/exclusion selectors bind selected membership and commit selected additions/deletions literally", async (t) => {
  const fixture = fixtureFor(t);
  writeRepositoryFile(fixture.repo, "chosen/delete.txt", "delete me\n");
  writeRepositoryFile(fixture.repo, "chosen/exclude.txt", "before\n");
  commitAll(fixture.repo);
  if (!configureSshSigning(t, fixture)) return;
  unlinkSync(join(fixture.repo, "chosen/delete.txt"));
  writeRepositoryFile(fixture.repo, "chosen/exclude.txt", "excluded\n");
  writeRepositoryFile(
    fixture.repo,
    "chosen/-new [literal].txt",
    "new selected content\n",
  );
  const prepared = prepare(fixture, [
    "--path-prefix",
    "chosen/",
    "--exclude-path",
    "chosen/exclude.txt",
  ]);
  assert.equal(prepared.child.status, 0, prepared.child.stdout);
  const committed = invoke(fixture, "workflow commit", [
    "--proposal",
    prepared.result.proposal,
    "--message",
    "fix: Update the selected directory",
  ]);
  assert.equal(committed.child.status, 0, committed.child.stdout);
  assert.equal(committed.result.commit.treeMatches, true);
  assert.deepEqual(
    git(["show", "--name-only", "--format=", "HEAD"], fixture.repo)
      .stdout.trim()
      .split("\n"),
    ["chosen/-new [literal].txt", "chosen/delete.txt"],
  );
  assert.equal(
    git(["show", "HEAD:chosen/exclude.txt"], fixture.repo).stdout,
    "before\n",
  );
  assert.equal(
    readFileSync(join(fixture.repo, "chosen/exclude.txt"), "utf8"),
    "excluded\n",
  );
});

for (const drift of ["content", "selected-index", "prefix-membership"]) {
  test(`selected ${drift} drift rejects before mutation`, (t) => {
    const fixture = fixtureFor(t);
    writeRepositoryFile(fixture.repo, "chosen/a.txt", "first\n");
    const prepared = prepare(fixture, ["--path-prefix", "chosen/"]);
    assert.equal(prepared.child.status, 0, prepared.child.stdout);
    if (drift === "content")
      writeRepositoryFile(fixture.repo, "chosen/a.txt", "changed\n");
    if (drift === "selected-index") git(["add", "chosen/a.txt"], fixture.repo);
    if (drift === "prefix-membership")
      writeRepositoryFile(fixture.repo, "chosen/b.txt", "new member\n");
    const before = inventory(fixture.base);
    const checked = invoke(
      fixture,
      "message check",
      ["--proposal", prepared.result.proposal],
      "fix: Update the selected directory\n",
    );
    assert.equal(checked.child.status, 1, checked.child.stdout);
    assert.equal(checked.result.code, "PROPOSAL_STALE");
    assert.deepEqual(inventory(fixture.base), before);
  });
}

test("selected renames require both endpoints without changing the index", (t) => {
  const fixture = fixtureFor(t);
  git(["mv", "other.txt", "renamed.txt"], fixture.repo);
  const before = inventory(fixture.base);
  const prepared = prepare(fixture, ["--path", "renamed.txt"]);
  assert.equal(prepared.result.code, "RENAME_SCOPE_BOUNDARY");
  assert.deepEqual(inventory(fixture.base), before);
});

test("selected-path staging failure preserves the existing index and lock without attempting a commit", async (t) => {
  const fixture = fixtureFor(t);
  writeRepositoryFile(fixture.repo, "selected [literal].txt", "selected\n");
  writeRepositoryFile(fixture.repo, "other.txt", "unrelated staged\n");
  git(["add", "other.txt"], fixture.repo);
  const prepared = prepare(fixture, ["--path", "selected [literal].txt"]);
  assert.equal(prepared.child.status, 0, prepared.child.stdout);
  const parent = git(["rev-parse", "HEAD"], fixture.repo).stdout;
  const index = readFileSync(join(fixture.repo, ".git", "index"));
  const lock = join(fixture.repo, ".git", "index.lock");
  writeFileSync(lock, "owned test lock", { flag: "wx" });
  const committed = invoke(fixture, "workflow commit", [
    "--proposal",
    prepared.result.proposal,
    "--message",
    "fix: Keep failed staging truthful",
  ]);
  await assertWorkflowResult(committed.result, committed.child.status);
  assert.equal(committed.result.code, "PATH_STAGING_FAILED");
  assert.equal(committed.result.commitState, "absent");
  assert.equal(committed.result.details[0].indexMutationAttempted, true);
  assert.equal(committed.result.details[0].selectedIndexChanged, false);
  assert.deepEqual(readFileSync(join(fixture.repo, ".git", "index")), index);
  assert.equal(readFileSync(lock, "utf8"), "owned test lock");
  assert.equal(git(["rev-parse", "HEAD"], fixture.repo).stdout, parent);
  assert.deepEqual(readdirSync(fixture.sentinel), []);
});

test("path commit hook failure leaves selected staging explicit and cleans only owned transport", (t) => {
  const fixture = fixtureFor(t);
  if (!configureSshSigning(t, fixture)) return;
  writeRepositoryFile(fixture.repo, "selected [literal].txt", "selected\n");
  const prepared = prepare(fixture, ["--path", "selected [literal].txt"]);
  const parent = git(["rev-parse", "HEAD"], fixture.repo).stdout;
  writeFileSync(
    join(fixture.repo, ".git", "hooks", "pre-commit"),
    "#!/bin/sh\nexit 1\n",
    { mode: 0o700 },
  );
  const committed = invoke(fixture, "workflow commit", [
    "--proposal",
    prepared.result.proposal,
    "--message",
    "fix: Update the selected file",
  ]);
  assert.equal(committed.result.code, "GIT_COMMIT_FAILED");
  assert.equal(committed.result.commitState, "absent");
  assert.equal(committed.result.details[0].indexUpdated, true);
  assert.equal(git(["rev-parse", "HEAD"], fixture.repo).stdout, parent);
  assert.deepEqual(readdirSync(fixture.sentinel), []);
});

test("native launch failure closes and cleans the owned path transport without claiming a commit", async (t) => {
  const fixture = fixtureFor(t);
  writeRepositoryFile(fixture.repo, "selected [literal].txt", "selected\n");
  const prepared = prepare(fixture, ["--path", "selected [literal].txt"]);
  let pathspecFile;
  await assert.rejects(
    commitProposalWorkflow({
      proposal: prepared.result.proposal,
      approvedSubject: "fix: Keep launch failure truthful",
      cwd: fixture.repo,
      processLauncher(_command, args, options) {
        pathspecFile = args
          .find((argument) => argument.startsWith("--pathspec-from-file="))
          .slice("--pathspec-from-file=".length);
        assert.ok(existsSync(pathspecFile));
        return spawn("c2g-deliberately-missing-git-executable", [], options);
      },
    }),
    (error) =>
      error.code === "GIT_COMMIT_FAILED" &&
      error.state.commitState === "absent",
  );
  assert.equal(existsSync(pathspecFile), false);
});

test(
  "tracked raw-byte path selection uses literal bytes through hashing and commit",
  { skip: process.platform === "win32" },
  (t) => {
    const fixture = fixtureFor(t);
    const path = Buffer.from([0x72, 0x61, 0x77, 0xff]);
    const absolute = Buffer.concat([Buffer.from(`${fixture.repo}/`), path]);
    writeFileSync(absolute, "before\n");
    commitAll(fixture.repo);
    if (!configureSshSigning(t, fixture)) return;
    writeFileSync(absolute, "raw changed\n");
    const scopeFile = join(fixture.scratch, "scope-input.json");
    writeFileSync(
      scopeFile,
      JSON.stringify({
        schemaVersion: 2,
        includePaths: [],
        includePathPrefixes: [],
        excludePaths: [],
        excludePathPrefixes: [],
        includePathBytesBase64: [path.toString("base64")],
        excludePathBytesBase64: [],
      }),
    );
    const prepared = prepare(fixture, ["--scope-file", scopeFile]);
    assert.equal(prepared.child.status, 0, prepared.child.stdout);
    const committed = invoke(fixture, "workflow commit", [
      "--proposal",
      prepared.result.proposal,
      "--message",
      "fix: Preserve literal raw path bytes",
    ]);
    assert.equal(committed.child.status, 0, committed.child.stdout);
    const observed = spawnSync(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD"],
      { cwd: fixture.repo, encoding: null },
    );
    assert.equal(observed.status, 0);
    assert.deepEqual(observed.stdout, Buffer.concat([path, Buffer.from([0])]));
  },
);
