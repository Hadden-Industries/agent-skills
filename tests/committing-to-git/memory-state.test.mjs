import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import {
  assertWorkflowResult,
  commitAll,
  configureSshSigning,
  createRepositoryFixture,
  git,
  readGitTraceArguments,
  runCommitWorkflow,
  writeRepositoryFile,
} from "./harness.mjs";

const PREPARE_MESSAGE_EVIDENCE = [
  "--mode",
  "actual",
  "--evidence",
  "message",
  "--basis",
  "read-current-task",
  "--verification",
  "skipped",
];

function sentinelFixture(t) {
  const fixture = createRepositoryFixture(t, "committing-to-git-memory-");
  const sentinel = join(fixture.base, "temporary-sentinel");

  mkdirSync(sentinel);
  return {
    ...fixture,
    sentinel,
    env: { TEMP: sentinel, TMP: sentinel, TMPDIR: sentinel },
  };
}

function listFiles(root) {
  const entries = [];

  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stats = statSync(path);

    entries.push(
      `${relative(root, path).replaceAll("\\", "/")}:${stats.isDirectory() ? "dir" : stats.size}`,
    );

    if (stats.isDirectory()) {
      entries.push(...listFiles(path).map((entry) => `${name}/${entry}`));
    }
  }

  return entries.sort();
}

/** Index bytes, every metadata path, refs and status: what preparation must not change. */
function repositoryState(repo) {
  const readOnly = { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } };

  return {
    index: createHash("sha256")
      .update(readFileSync(join(repo, ".git", "index")))
      .digest("hex"),
    metadata: listFiles(join(repo, ".git")),
    refs: git(["for-each-ref"], repo, readOnly).stdout,
    head: git(["rev-parse", "HEAD"], repo, readOnly).stdout,
    status: git(
      ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
      repo,
      readOnly,
    ).stdout,
  };
}

function seededRepository(t) {
  const fixture = sentinelFixture(t);

  writeRepositoryFile(fixture.repo, "src/app.txt", "first\nsecond\n");
  writeRepositoryFile(fixture.repo, "docs/obsolete.txt", "old\n");
  commitAll(fixture.repo);
  return fixture;
}

function prepare(fixture, args) {
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [...PREPARE_MESSAGE_EVIDENCE, ...args],
    fixture.repo,
    { env: fixture.env },
  );

  return { prepared, result: JSON.parse(prepared.stdout) };
}

test("memory staged preparation writes nothing anywhere", async (t) => {
  const fixture = seededRepository(t);

  writeRepositoryFile(fixture.repo, "src/app.txt", "first\nchanged\n");
  git(["add", "src/app.txt"], fixture.repo);
  const before = repositoryState(fixture.repo);
  const { prepared, result } = prepare(fixture, ["--scope", "staged"]);

  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  await assertWorkflowResult(result, 0);
  assert.equal(result.stateStorage, "memory");
  assert.equal(result.transaction, null);
  assert.equal(result.route, "concise");
  assert.equal(result.changeUnitCount, 1);
  assert.match(result.proposal, /^ctg1\.[A-Za-z0-9_-]+$/u);
  assert.match(result.capsule.evidence[0].patchText, /\+changed/u);
  assert.deepEqual(result.checkedAuthoring, {
    input: "stdin",
    arguments: ["message", "check", "--proposal", result.proposal],
  });
  assert.deepEqual(readdirSync(fixture.sentinel), []);
  assert.deepEqual(repositoryState(fixture.repo), before);
});

test("memory full preparation describes git add -A without writing", async (t) => {
  const fixture = seededRepository(t);

  writeRepositoryFile(fixture.repo, "src/app.txt", "first\nchanged\n");
  unlinkSync(join(fixture.repo, "docs", "obsolete.txt"));
  writeRepositoryFile(fixture.repo, "src/new file.txt", "brand new\n");
  const before = repositoryState(fixture.repo);
  const { prepared, result } = prepare(fixture, ["--scope", "full"]);

  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  await assertWorkflowResult(result, 0);
  assert.equal(result.changeUnitCount, 3);
  assert.match(result.capsule.evidence[0].patchText, /\+brand new/u);
  assert.match(result.capsule.evidence[0].patchText, /\+changed/u);
  assert.deepEqual(readdirSync(fixture.sentinel), []);
  assert.deepEqual(repositoryState(fixture.repo), before);
});

test("memory proposals commit staged and full scope through native Git", async (t) => {
  for (const scope of ["staged", "full"]) {
    await t.test(scope, async (st) => {
      const fixture = seededRepository(st);

      if (!configureSshSigning(st, fixture)) return;
      writeRepositoryFile(fixture.repo, "src/app.txt", "first\nchanged\n");
      writeRepositoryFile(fixture.repo, "src/added.txt", "added\n");
      if (scope === "staged") git(["add", "src/app.txt"], fixture.repo);
      const parent = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
      const { result: preparation } = prepare(fixture, ["--scope", scope]);
      const committed = runCommitWorkflow(
        "workflow commit",
        [
          "--proposal",
          preparation.proposal,
          "--message",
          "fix: Change the application text",
        ],
        fixture.repo,
        { env: fixture.env },
      );
      const result = JSON.parse(committed.stdout);

      assert.equal(committed.status, 0, committed.stdout + committed.stderr);
      await assertWorkflowResult(result, 0);
      assert.equal(result.commitState, "created");
      assert.deepEqual(
        {
          parentMatches: result.commit.parentMatches,
          treeMatches: result.commit.treeMatches,
          messageMatches: result.commit.messageMatches,
          signed: result.commit.signed,
        },
        {
          parentMatches: true,
          treeMatches: true,
          messageMatches: true,
          signed: true,
        },
      );
      assert.deepEqual(result.commit.parentOids, [parent]);
      assert.equal(
        git(["log", "-1", "--format=%B"], fixture.repo).stdout,
        "fix: Change the application text\n\n",
      );
      assert.equal(
        git(["show", "--name-only", "--format=", "HEAD"], fixture.repo).stdout,
        scope === "staged" ? "src/app.txt\n" : "src/added.txt\nsrc/app.txt\n",
      );
      assert.deepEqual(readdirSync(fixture.sentinel), []);
    });
  }
});

test("checked stdin messages bind their exact bytes to the commit", async (t) => {
  const fixture = seededRepository(t);

  if (!configureSshSigning(t, fixture)) return;
  writeRepositoryFile(fixture.repo, "src/app.txt", "first\nchanged\n");
  git(["add", "src/app.txt"], fixture.repo);
  const { result: preparation } = prepare(fixture, ["--scope", "staged"]);
  const message =
    "fix: Change the application text\n\nRationale:\n  - The second line was wrong.\n";
  const checked = runCommitWorkflow(
    "message check",
    ["--proposal", preparation.proposal],
    fixture.repo,
    { env: fixture.env, input: message },
  );
  const check = JSON.parse(checked.stdout);

  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  await assertWorkflowResult(check, 0);
  assert.equal(check.displayText, message);
  assert.deepEqual(check.commit.arguments.slice(0, 4), [
    "workflow",
    "commit",
    "--proposal",
    preparation.proposal,
  ]);

  const mismatched = runCommitWorkflow(
    "workflow commit",
    [...check.commit.arguments.slice(2)],
    fixture.repo,
    { env: fixture.env, input: message.replace("wrong", "stale") },
  );

  assert.equal(mismatched.status, 1, mismatched.stdout);
  assert.equal(JSON.parse(mismatched.stdout).code, "MESSAGE_DIGEST_MISMATCH");

  const committed = runCommitWorkflow(
    "workflow commit",
    [...check.commit.arguments.slice(2)],
    fixture.repo,
    { env: fixture.env, input: message },
  );

  assert.equal(committed.status, 0, committed.stdout + committed.stderr);
  assert.equal(
    git(["log", "-1", "--format=%B"], fixture.repo).stdout,
    `${message}\n`,
  );
  assert.deepEqual(readdirSync(fixture.sentinel), []);
});

test("stale proposals are rejected before any mutation", async (t) => {
  const cases = {
    "index change": (repo) => {
      writeRepositoryFile(repo, "docs/obsolete.txt", "edited\n");
      git(["add", "docs/obsolete.txt"], repo);
    },
    "HEAD movement": (repo) => {
      git(["commit", "--quiet", "--allow-empty", "-m", "concurrent"], repo);
    },
    "working-tree change": (repo) => {
      writeRepositoryFile(repo, "src/app.txt", "first\nchanged again\n");
    },
  };

  for (const [name, change] of Object.entries(cases)) {
    await t.test(name, async (st) => {
      const fixture = seededRepository(st);
      const scope = name === "working-tree change" ? "full" : "staged";

      writeRepositoryFile(fixture.repo, "src/app.txt", "first\nchanged\n");
      if (scope === "staged") git(["add", "src/app.txt"], fixture.repo);
      const { result: preparation } = prepare(fixture, ["--scope", scope]);

      change(fixture.repo);
      const before = repositoryState(fixture.repo);
      const committed = runCommitWorkflow(
        "workflow commit",
        [
          "--proposal",
          preparation.proposal,
          "--message",
          "fix: Change the application text",
        ],
        fixture.repo,
        { env: fixture.env },
      );
      const result = JSON.parse(committed.stdout);

      assert.equal(committed.status, 1, committed.stdout);
      await assertWorkflowResult(result, 1);
      assert.equal(result.code, "PROPOSAL_STALE");
      assert.equal(result.commitState, "absent");
      assert.deepEqual(repositoryState(fixture.repo), before);
    });
  }
});

test("a draft proposal is never committed", async (t) => {
  const fixture = seededRepository(t);

  writeRepositoryFile(fixture.repo, "src/app.txt", "first\nchanged\n");
  git(["add", "src/app.txt"], fixture.repo);
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      ...PREPARE_MESSAGE_EVIDENCE.map((value) =>
        value === "actual" ? "draft" : value,
      ),
      "--scope",
      "staged",
    ],
    fixture.repo,
    { env: fixture.env },
  );
  const preparation = JSON.parse(prepared.stdout);

  assert.equal(prepared.status, 0, prepared.stdout);
  assert.equal(preparation.commit, undefined);
  const committed = runCommitWorkflow(
    "workflow commit",
    ["--proposal", preparation.proposal, "--message", "fix: Change text"],
    fixture.repo,
    { env: fixture.env },
  );

  assert.equal(committed.status, 1, committed.stdout);
  assert.equal(
    JSON.parse(committed.stdout).code,
    "DRAFT_PROPOSAL_NOT_COMMITTABLE",
  );
});

test("memory full scope observes each untracked path with one Git process", (t) => {
  const fixture = seededRepository(t);
  const tracePath = join(fixture.base, "trace2.json");

  for (let index = 0; index < 12; index += 1) {
    writeRepositoryFile(fixture.repo, `new/file-${index}.txt`, `${index}\n`);
  }

  const { prepared, result } = (() => {
    const child = runCommitWorkflow(
      "workflow prepare",
      [...PREPARE_MESSAGE_EVIDENCE, "--scope", "full"],
      fixture.repo,
      { env: { ...fixture.env, GIT_TRACE2_EVENT: tracePath } },
    );

    return { prepared: child, result: JSON.parse(child.stdout) };
  })();

  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  assert.equal(result.changeUnitCount, 12);
  // Mode, line statistics and message patch share one observation per path.
  assert.equal(
    readGitTraceArguments(tracePath).filter((argv) =>
      argv.includes("--no-index"),
    ).length,
    12,
  );
});

test("routes needing durable state require explicit disk storage", async (t) => {
  const fixture = seededRepository(t);

  writeRepositoryFile(fixture.repo, "src/app.txt", "first\nchanged\n");
  for (const args of [
    ["--scope", "paths", "--path", "src/app.txt"],
    [
      "--scope",
      "full",
      "--evidence",
      "review",
      "--basis",
      "unknown-preexisting",
    ],
  ]) {
    const prepared = runCommitWorkflow(
      "workflow prepare",
      [
        "--mode",
        "actual",
        "--verification",
        "skipped",
        ...(args.includes("--evidence")
          ? []
          : ["--evidence", "message", "--basis", "read-current-task"]),
        ...args,
      ],
      fixture.repo,
      { env: fixture.env },
    );
    const result = JSON.parse(prepared.stdout);

    assert.equal(prepared.status, 2, prepared.stdout);
    await assertWorkflowResult(result, 2);
    assert.equal(result.code, "STATE_STORAGE_REQUIRES_DISK");
  }

  assert.deepEqual(readdirSync(fixture.sentinel), []);
});

test("disk storage needs an explicit absolute directory and uses only it", async (t) => {
  const fixture = seededRepository(t);
  const stateDirectory = join(fixture.base, "workflow-state");

  mkdirSync(stateDirectory);
  writeRepositoryFile(fixture.repo, "src/app.txt", "first\nchanged\n");
  git(["add", "src/app.txt"], fixture.repo);

  for (const storage of [
    ["--state-storage", "disk"],
    ["--state-storage", "disk", "--state-directory", "relative-state"],
    ["--state-directory", stateDirectory],
  ]) {
    const { prepared, result } = prepare(fixture, [
      "--scope",
      "staged",
      ...storage,
    ]);

    assert.equal(prepared.status, 2, prepared.stdout);
    await assertWorkflowResult(result, 2);
  }

  const { prepared, result } = prepare(fixture, [
    "--scope",
    "staged",
    "--state-storage",
    "disk",
    "--state-directory",
    stateDirectory,
  ]);

  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  assert.ok(
    relative(stateDirectory, result.transaction).startsWith(
      "committing-to-git-",
    ),
    result.transaction,
  );
  assert.deepEqual(readdirSync(fixture.sentinel), []);
});
