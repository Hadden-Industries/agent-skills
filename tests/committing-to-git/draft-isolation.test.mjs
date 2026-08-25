import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReadOnlyGitCapabilities,
  runReadOnlyGit,
} from "../../src/committing-to-git/git/gitRepository.js";
import { collectCommitReport } from "../../src/committing-to-git/report/commitReport.js";
import {
  formatGitAlternatePaths,
  parseGitAlternatePaths,
} from "../../src/committing-to-git/snapshot/createSnapshot.js";
import {
  commitAll,
  createRepositoryFixture,
  git,
  readJson,
  runCommitWorkflow,
  writeJson,
  writeRepositoryFile,
} from "./harness.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function repositoryMetadataFingerprint(root) {
  const gitDirectory = resolve(
    root,
    git(["rev-parse", "--git-dir"], root).stdout.trim(),
  );
  const entries = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative(gitDirectory, path).replaceAll("\\", "/");

      if (entry.isDirectory()) {
        visit(path);
      } else if (
        name === "index" ||
        name.startsWith("objects/") ||
        name.startsWith("refs/") ||
        name.startsWith("logs/") ||
        name.endsWith(".lock")
      ) {
        const stat = lstatSync(path);
        entries.push({
          name,
          byteCount: stat.size,
          sha256: sha256(readFileSync(path)),
        });
      }
    }
  }

  visit(gitDirectory);
  entries.sort((left, right) => left.name.localeCompare(right.name));

  return {
    indexBytes: existsSync(join(gitDirectory, "index"))
      ? readFileSync(join(gitDirectory, "index")).toString("base64")
      : null,
    entries,
  };
}

function containedObjectPaths(directory) {
  const paths = [];

  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);

      if (entry.isDirectory()) {
        visit(path);
      } else {
        paths.push(relative(directory, path).replaceAll("\\", "/"));
      }
    }
  }

  visit(directory);
  return paths.sort();
}

function prepareDraft(fixture, scope, selectors = []) {
  return runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "draft",
      "--scope",
      scope,
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      "--verification",
      "skipped",
      ...selectors,
    ],
    fixture.repo,
    { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
  );
}

function promoteDraft(fixture, transactionPath) {
  return runCommitWorkflow(
    "workflow promote",
    ["--transaction", transactionPath],
    fixture.repo,
  );
}

test("alternate object paths round-trip Git C-style quoting", () => {
  const separator = process.platform === "win32" ? ";" : ":";
  const paths = [
    resolve("plain-object-directory"),
    resolve(`object${separator}directory`),
    resolve("object-directory-with-a-tab\tinside"),
  ];

  assert.deepEqual(
    parseGitAlternatePaths(formatGitAlternatePaths(paths)),
    paths,
  );
});

test("the no-lazy-fetch capability boundary succeeds or stops before repository work", () => {
  const supported = assertReadOnlyGitCapabilities();

  assert.equal(supported.noLazyFetch, true);
  assert.match(supported.gitVersion, /^git version /u);

  let probes = 0;
  assert.throws(
    () =>
      assertReadOnlyGitCapabilities({
        probe() {
          probes += 1;
          return {
            status: 129,
            stdout: Buffer.from("git version 2.44.0\n"),
            stderr: Buffer.from("unknown option: --no-lazy-fetch\n"),
          };
        },
      }),
    (error) => error.code === "UNSUPPORTED_GIT_VERSION",
  );
  assert.equal(probes, 1);
});

test("the read-only Git boundary rejects mutation and output-capable argument shapes", (t) => {
  const fixture = createRepositoryFixture(t, "read-only-git-boundary-");
  const rejected = [
    ["commit", []],
    ["push", []],
    ["fetch", []],
    ["update-ref", []],
    ["update-index", ["--refresh"]],
    ["read-tree", ["HEAD"]],
    ["diff", ["--output=patch.txt"]],
    ["diff", ["--ext-diff"]],
    ["cat-file", ["--filters", "HEAD:file.txt"]],
    ["status", ["--porcelain=v2", "--no-optional-locks"]],
    ["alias-observe", []],
    ["git-external-command", []],
  ];

  for (const [operation, args] of rejected) {
    assert.throws(
      () => runReadOnlyGit(fixture.repo, operation, args),
      /read-only Git operation|not permitted|unsupported/iu,
      `${operation} ${args.join(" ")}`,
    );
  }

  const status = runReadOnlyGit(fixture.repo, "status", [
    "--porcelain=v2",
    "-z",
    "--untracked-files=all",
    "--no-renames",
  ]);
  assert.equal(status.status, 0);
});

test("every read-only operation class receives the lock and lazy-fetch boundary", () => {
  const oid = "a".repeat(40);
  const invocations = [];
  const launcher = (command, args, options) => {
    invocations.push({ command, args, env: options.env });
    return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
  const cases = [
    [
      "status",
      [
        "--porcelain=v2",
        "-z",
        "--untracked-files=normal",
        "--no-renames",
        "--ignore-submodules=dirty",
      ],
    ],
    ["ls-files", ["-u", "-z"]],
    ["diff", ["--cached", "--no-renames", "--"]],
    ["cat-file", ["-t", oid]],
    ["show-commit-fields", ["--format=%H%x00%T", oid]],
    [
      "diff-tree",
      ["--root", "--no-commit-id", "-r", "-z", "--no-renames", "--raw", oid],
    ],
  ];

  for (const [operation, args] of cases) {
    runReadOnlyGit(".", operation, args, { launcher });
  }

  assert.equal(invocations.length, cases.length);
  for (const invocation of invocations) {
    assert.equal(invocation.command, "git");
    assert.equal(invocation.env.GIT_OPTIONAL_LOCKS, "0");
    assert.equal(invocation.env.GIT_NO_LAZY_FETCH, "1");
    assert.ok(invocation.args.includes("--no-lazy-fetch"));
    assert.ok(invocation.args.includes("--no-pager"));
    assert.ok(invocation.args.includes("core.fsmonitor=false"));
  }
});

test("configured diff, textconv, pager, color, and fsmonitor hooks cannot alter read-only evidence", (t) => {
  const fixture = createRepositoryFixture(t, "read-only-config-sentinels-");
  const marker = join(fixture.scratch, "sentinel-ran.txt");
  const sentinelScript = join(fixture.scratch, "sentinel.mjs");
  const command = [process.execPath, sentinelScript, marker]
    .map((value) => `"${value.replaceAll("\\", "/").replaceAll('"', '\\"')}"`)
    .join(" ");

  writeFileSync(
    sentinelScript,
    'import { writeFileSync } from "node:fs";\nwriteFileSync(process.argv[2], `${JSON.stringify(process.argv.slice(3))}\\n`);\n',
  );
  const probe = spawnSync(process.execPath, [sentinelScript, marker], {
    encoding: null,
  });
  assert.equal(probe.status, 0);
  assert.equal(existsSync(marker), true);
  unlinkSync(marker);

  writeRepositoryFile(fixture.repo, ".gitattributes", "*.txt diff=sentinel\n");
  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");
  git(["add", "--", "tracked.txt"], fixture.repo);
  git(["config", "diff.external", command], fixture.repo);
  git(["config", "diff.sentinel.textconv", command], fixture.repo);
  git(["config", "core.pager", command], fixture.repo);
  git(["config", "core.fsmonitor", command], fixture.repo);
  git(["config", "color.ui", "always"], fixture.repo);

  const prepare = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "staged",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
    ],
    fixture.repo,
    { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
  );
  assert.equal(prepare.status, 0, prepare.stderr);
  const transactionPath = JSON.parse(prepare.stdout).transaction;
  const transaction = readJson(transactionPath);

  writeJson(transactionPath, {
    ...transaction,
    phase: "allocated",
    status: null,
    route: null,
    inlineEvidence: null,
    review: null,
  });
  const recovery = runCommitWorkflow(
    "workflow resume",
    ["--transaction", transactionPath],
    fixture.repo,
  );
  assert.equal(recovery.status, 0, recovery.stderr);
  assert.equal(
    existsSync(marker),
    false,
    existsSync(marker) ? readFileSync(marker, "utf8") : undefined,
  );

  git(["config", "core.fsmonitor", "false"], fixture.repo);
  git(
    ["commit", "--quiet", "-m", "test: exercise read-only report"],
    fixture.repo,
  );
  git(["config", "core.fsmonitor", command], fixture.repo);
  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const manifest = readJson(transaction.snapshot.path);
  const report = collectCommitReport({
    root: fixture.repo,
    commitOid,
    manifest,
    approvedMessage: "test: exercise read-only report\n",
    verification: {
      schemaVersion: 2,
      commitOid,
      initialPolicy: "skipped",
      finalPolicy: "skipped",
      attempts: [
        {
          status: "skipped",
          reason: "test-policy",
          backend: null,
          identity: null,
          timestamp: "2026-08-23T12:00:00.000Z",
        },
      ],
      effectiveAttempt: 0,
      blocksPush: false,
    },
    checks: { schemaVersion: 2, attemptCount: 0, receipts: [] },
  });
  assert.equal(report.commit.treeMatches, true);
  assert.deepEqual(report.statistics.kinds, { modified: 1 });
  assert.equal(
    Buffer.from(prepare.stdout).includes(Buffer.from("\u001b[")),
    false,
  );
  assert.equal(existsSync(marker), false);
});

for (const scope of ["staged", "full", "paths"]) {
  test(`draft ${scope} writes index and objects only inside its attempt`, (t) => {
    const fixture = createRepositoryFixture(t, `draft-${scope}-isolation-`);
    writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
    commitAll(fixture.repo);
    writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");
    writeRepositoryFile(fixture.repo, "new.txt", "new\n");

    if (scope === "staged") {
      git(["add", "tracked.txt"], fixture.repo);
    }

    const before = repositoryMetadataFingerprint(fixture.repo);
    const selectors = scope === "paths" ? ["--path", "new.txt"] : [];
    const result = prepareDraft(fixture, scope, selectors);
    const after = repositoryMetadataFingerprint(fixture.repo);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(after, before);

    const output = JSON.parse(result.stdout);
    const transaction = readJson(output.transaction);
    const snapshot = readJson(transaction.snapshot.path);
    const objectDirectory = transaction.snapshot.temporaryObjectDirectory;

    assert.equal(snapshot.indexTreeOid, transaction.snapshot.indexTreeOid);
    assert.equal(isAbsolute(transaction.snapshot.preparedIndexPath), true);
    assert.equal(isAbsolute(objectDirectory), true);
    assert.equal(dirname(objectDirectory), transaction.attemptDirectory);
    assert.equal(containedObjectPaths(objectDirectory).length > 0, true);
  });
}

test("a disjoint path draft records staged work as a promotion blocker", (t) => {
  const fixture = createRepositoryFixture(t, "draft-path-promotion-blocker-");
  writeRepositoryFile(fixture.repo, "staged.txt", "before\n");
  writeRepositoryFile(fixture.repo, "draft.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "staged.txt", "staged\n");
  git(["add", "staged.txt"], fixture.repo);
  writeRepositoryFile(fixture.repo, "draft.txt", "draft\n");
  const before = repositoryMetadataFingerprint(fixture.repo);

  const result = prepareDraft(fixture, "paths", ["--path", "draft.txt"]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(repositoryMetadataFingerprint(fixture.repo), before);
  const transaction = readJson(JSON.parse(result.stdout).transaction);

  assert.deepEqual(
    {
      kind: transaction.scope.promotionBlocker.kind,
      stagedChangeUnitCount:
        transaction.scope.promotionBlocker.stagedChangeUnitCount,
      digestLength: transaction.scope.promotionBlocker.realIndexSha256.length,
    },
    {
      kind: "real-staged-changes",
      stagedChangeUnitCount: 1,
      digestLength: 64,
    },
  );

  const promotion = promoteDraft(
    fixture,
    JSON.parse(result.stdout).transaction,
  );

  assert.equal(promotion.status, 1);
  assert.equal(
    JSON.parse(promotion.stdout).code,
    "PROMOTION_BLOCKED_STAGED_STATE",
  );
  assert.deepEqual(repositoryMetadataFingerprint(fixture.repo), before);
});

test("an unchanged full draft promotes without rebuilding its evidence", (t) => {
  const fixture = createRepositoryFixture(t, "draft-full-promotion-");
  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");

  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "draft",
      "--scope",
      "full",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      "--verification",
      "skipped",
    ],
    fixture.repo,
    { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
  );
  assert.equal(prepared.status, 0, prepared.stderr);

  const preparedResult = JSON.parse(prepared.stdout);
  const before = readJson(preparedResult.transaction);
  const promotion = promoteDraft(fixture, preparedResult.transaction);

  assert.equal(promotion.status, 0, `${promotion.stderr}\n${promotion.stdout}`);
  const promotedResult = JSON.parse(promotion.stdout);
  const after = readJson(preparedResult.transaction);

  assert.equal(promotedResult.status, "promoted");
  assert.equal(promotedResult.mode, "actual");
  assert.equal(after.mode, "actual");
  assert.equal(after.status, "promoted");
  assert.equal(after.phase, before.phase);
  assert.equal(after.snapshot.path, before.snapshot.path);
  assert.equal(after.snapshot.sha256, before.snapshot.sha256);
  assert.deepEqual(after.inlineEvidence, before.inlineEvidence);
  assert.deepEqual(after.review, before.review);
  assert.deepEqual(after.message, before.message);
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout.trim(),
    "tracked.txt",
  );
  assert.equal(
    git(["write-tree"], fixture.repo).stdout.trim(),
    before.snapshot.indexTreeOid,
  );
});

test("selected-content drift leaves a full draft and the real index unchanged", (t) => {
  const fixture = createRepositoryFixture(t, "draft-full-promotion-drift-");
  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "drafted\n");

  const prepared = prepareDraft(fixture, "full");
  assert.equal(prepared.status, 0, prepared.stderr);
  const transactionPath = JSON.parse(prepared.stdout).transaction;
  const transactionBefore = readJson(transactionPath);
  const indexBefore = git(
    ["diff", "--cached", "--binary", "--no-ext-diff"],
    fixture.repo,
  ).stdout;

  writeRepositoryFile(fixture.repo, "tracked.txt", "drifted\n");
  const promotion = promoteDraft(fixture, transactionPath);

  assert.equal(promotion.status, 1);
  assert.equal(JSON.parse(promotion.stdout).code, "PROMOTION_TREE_DRIFT");
  assert.equal(
    git(["diff", "--cached", "--binary", "--no-ext-diff"], fixture.repo).stdout,
    indexBefore,
  );
  assert.deepEqual(readJson(transactionPath), transactionBefore);
});

test("removing a selected untracked path is promotion drift, not malformed input", (t) => {
  const fixture = createRepositoryFixture(t, "draft-path-removal-drift-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "selected.txt", "drafted\n");
  const prepared = prepareDraft(fixture, "paths", ["--path", "selected.txt"]);
  assert.equal(prepared.status, 0, prepared.stderr);
  const transactionPath = JSON.parse(prepared.stdout).transaction;

  unlinkSync(join(fixture.repo, "selected.txt"));
  const promotion = promoteDraft(fixture, transactionPath);

  assert.equal(promotion.status, 1);
  assert.equal(JSON.parse(promotion.stdout).code, "PROMOTION_TREE_DRIFT");
  assert.equal(readJson(transactionPath).mode, "draft");
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "",
  );
});

for (const scope of ["staged", "paths"]) {
  test(`an unchanged ${scope} draft promotes the exact reviewed tree`, (t) => {
    const fixture = createRepositoryFixture(t, `draft-${scope}-promotion-`);
    writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
    commitAll(fixture.repo);
    writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");

    if (scope === "staged") {
      git(["add", "tracked.txt"], fixture.repo);
    }

    const prepared = prepareDraft(
      fixture,
      scope,
      scope === "paths" ? ["--path", "tracked.txt"] : [],
    );
    assert.equal(prepared.status, 0, prepared.stderr);
    const transactionPath = JSON.parse(prepared.stdout).transaction;
    const reviewedTree = readJson(transactionPath).snapshot.indexTreeOid;
    const promotion = promoteDraft(fixture, transactionPath);

    assert.equal(
      promotion.status,
      0,
      `${promotion.stderr}\n${promotion.stdout}`,
    );
    assert.equal(readJson(transactionPath).mode, "actual");
    assert.equal(git(["write-tree"], fixture.repo).stdout.trim(), reviewedTree);
  });
}

test("a staged draft rejects real-index source digest drift", (t) => {
  const fixture = createRepositoryFixture(t, "draft-staged-source-drift-");
  writeRepositoryFile(fixture.repo, "first.txt", "before\n");
  writeRepositoryFile(fixture.repo, "second.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "first.txt", "drafted\n");
  git(["add", "first.txt"], fixture.repo);
  const prepared = prepareDraft(fixture, "staged");
  assert.equal(prepared.status, 0, prepared.stderr);
  const transactionPath = JSON.parse(prepared.stdout).transaction;

  writeRepositoryFile(fixture.repo, "second.txt", "drifted\n");
  git(["add", "second.txt"], fixture.repo);
  const promotion = promoteDraft(fixture, transactionPath);

  assert.equal(promotion.status, 1);
  assert.equal(
    JSON.parse(promotion.stdout).code,
    "PROMOTION_STAGED_SOURCE_DRIFT",
  );
  assert.equal(readJson(transactionPath).mode, "draft");
});

test("promotion rejects a changed symbolic attachment at the same commit OID", (t) => {
  const fixture = createRepositoryFixture(t, "draft-head-kind-drift-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const prepared = prepareDraft(fixture, "full");
  assert.equal(prepared.status, 0, prepared.stderr);
  const transactionPath = JSON.parse(prepared.stdout).transaction;
  const parentBefore = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();

  git(["checkout", "--quiet", "--detach"], fixture.repo);
  assert.equal(
    git(["rev-parse", "HEAD"], fixture.repo).stdout.trim(),
    parentBefore,
  );
  const promotion = promoteDraft(fixture, transactionPath);

  assert.equal(promotion.status, 1);
  assert.equal(JSON.parse(promotion.stdout).code, "PROMOTION_HEAD_DRIFT");
  assert.equal(readJson(transactionPath).mode, "draft");
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "",
  );
});

test("a partially staged selected path is rejected before attempt mutation", (t) => {
  const fixture = createRepositoryFixture(t, "draft-path-partial-stage-");
  writeRepositoryFile(fixture.repo, "partial.txt", "one\ntwo\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "partial.txt", "ONE\ntwo\n");
  git(["add", "partial.txt"], fixture.repo);
  writeRepositoryFile(fixture.repo, "partial.txt", "ONE\nTWO\n");

  const result = prepareDraft(fixture, "paths", ["--path", "partial.txt"]);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).code, "DRAFT_SCOPE_OVERLAPS_STAGED");
  assert.deepEqual(
    readdirSync(fixture.scratch).filter((name) =>
      name.startsWith("committing-to-git-"),
    ),
    [],
  );
});

test("full draft promotion preserves attached, detached, and unborn head anchors", async (t) => {
  for (const kind of ["attached", "detached", "unborn"]) {
    await t.test(kind, (subtest) => {
      const fixture = createRepositoryFixture(subtest, `head-anchor-${kind}-`);

      if (kind !== "unborn") {
        writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
        commitAll(fixture.repo);

        if (kind === "detached") {
          git(["checkout", "--quiet", "--detach"], fixture.repo);
        }
      }

      writeRepositoryFile(fixture.repo, "change.txt", "change\n");
      const result = prepareDraft(fixture, "full");

      assert.equal(result.status, 0, result.stderr);
      const transactionPath = JSON.parse(result.stdout).transaction;
      const transaction = readJson(transactionPath);
      const anchor = transaction.headAnchor;

      assert.equal(anchor.headKind, kind);
      assert.equal(anchor.expectedParentOids.length, kind === "unborn" ? 0 : 1);

      if (kind === "detached") {
        assert.equal(anchor.targetRef, null);
      } else {
        assert.equal(anchor.targetRef, "refs/heads/main");
      }

      const promotion = promoteDraft(fixture, transactionPath);

      assert.equal(promotion.status, 0, promotion.stderr);
      assert.equal(readJson(transactionPath).mode, "actual");
      assert.equal(
        git(["write-tree"], fixture.repo).stdout.trim(),
        transaction.snapshot.indexTreeOid,
      );
    });
  }
});
