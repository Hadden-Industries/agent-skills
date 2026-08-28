import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import { selectedWorktreeMatchesPreparedTree } from "../../src/committing-to-git/checks/checkWorkspace.js";
import {
  encodeIndexInfoRecords,
  withProjectedIndex,
} from "../../src/committing-to-git/git/projectedIndex.js";
import { runIndexMutationGit } from "../../src/committing-to-git/git/gitRepository.js";
import { canonicalizeEvidencePlan } from "../../src/committing-to-git/inspection/reviewCatalog.js";
import { buildSnapshot } from "../../src/committing-to-git/snapshot/commitSnapshot.js";
import { acquireEvidence } from "../../src/committing-to-git/workflow/prepareWorkflow.js";
import {
  commitAll,
  configureSshSigning,
  createRepositoryFixture,
  git,
  readGitTraceArguments,
  readJson,
  runCommitWorkflow,
  writeJson,
  writeRepositoryFile,
} from "./harness.mjs";

const ARTIFICIAL_ARGV_BUDGET_BYTES = 1024;
const SYNTHETIC_CHANGE_UNIT_COUNT = 10_000;

function encodedArgvBytes(executable, args) {
  return [executable, ...args].reduce(
    (total, token) => total + Buffer.byteLength(token, "utf8") + 1,
    0,
  );
}

function budgetedSyncLauncher(observations) {
  return (executable, args, options) => {
    const argvBytes = encodedArgvBytes(executable, args);
    const stdinBytes = Buffer.isBuffer(options.input)
      ? options.input.length
      : Buffer.byteLength(options.input ?? "");

    const observation = {
      executable,
      args: [...args],
      argvBytes,
      stdinBytes,
      status: null,
    };

    observations.push(observation);
    assert.ok(
      argvBytes <= ARTIFICIAL_ARGV_BUDGET_BYTES,
      `child argv used ${argvBytes} bytes, above the ${ARTIFICIAL_ARGV_BUDGET_BYTES}-byte test budget`,
    );
    const result = spawnSync(executable, args, options);

    observation.status = result.status;
    return result;
  };
}

function budgetedAsyncLauncher(observations) {
  return (executable, args, options) => {
    const argvBytes = encodedArgvBytes(executable, args);

    const observation = {
      executable,
      args: [...args],
      argvBytes,
      stdinBytes: null,
      status: null,
    };

    observations.push(observation);
    assert.ok(
      argvBytes <= ARTIFICIAL_ARGV_BUDGET_BYTES,
      `child argv used ${argvBytes} bytes, above the ${ARTIFICIAL_ARGV_BUDGET_BYTES}-byte test budget`,
    );
    const child = spawn(executable, args, options);
    const endInput = child.stdin.end.bind(child.stdin);

    child.stdin.end = (input, ...rest) => {
      observation.stdinBytes = Buffer.isBuffer(input)
        ? input.length
        : Buffer.byteLength(input ?? "");
      return endInput(input, ...rest);
    };

    child.once("close", (status) => {
      observation.status = status;
    });
    return child;
  };
}

function syntheticPath(index) {
  const ordinal = String(index).padStart(5, "0");

  return Buffer.from(
    `generated/domain-${ordinal.slice(0, 2)}/component-${ordinal}-with-a-deliberately-long-name.txt`,
    "utf8",
  );
}

test("projected index sends ten thousand raw paths over stdin under a 1 KiB argv budget", async (t) => {
  const fixture = createRepositoryFixture(t, "large-scope-projection-");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  const blobOid = git(
    ["rev-parse", "HEAD:seed.txt"],
    fixture.repo,
  ).stdout.trim();
  const entries = Array.from(
    { length: SYNTHETIC_CHANGE_UNIT_COUNT },
    (_, index) => ({
      mode: "100644",
      oid: blobOid,
      pathBytes: syntheticPath(index),
    }),
  );
  const encoded = encodeIndexInfoRecords(entries);
  const observations = [];
  const launcher = budgetedSyncLauncher(observations);

  assert.ok(encoded.length > 1_000_000);
  assert.equal(encoded.filter((byte) => byte === 0).length, entries.length);

  const projectedTree = await withProjectedIndex(
    {
      root: fixture.repo,
      baselineTreeOid: null,
      entries,
      temporaryDirectory: fixture.scratch,
      purpose: "transport-test",
      launchers: { synchronous: launcher },
    },
    ({ environment }) =>
      runIndexMutationGit(fixture.repo, "write-index-tree", [], {
        env: environment,
        launcher,
      })
        .stdout.toString("utf8")
        .trim(),
  );

  assert.match(projectedTree, /^[0-9a-f]{40}$/u);
  assert.ok(
    observations.some(({ stdinBytes }) => stdinBytes === encoded.length),
  );
  assert.ok(observations.every(({ argvBytes }) => argvBytes <= 1024));
  assert.equal(
    observations.filter(({ args }) => args.includes("update-index")).length,
    1,
  );
  assert.equal(
    observations.some(({ args }) =>
      args.some((argument) => argument.includes("component-09999")),
    ),
    false,
  );
  assert.equal(
    readdirSync(fixture.scratch).some((name) =>
      name.startsWith(".projected-index-transport-test-"),
    ),
    false,
  );
});

test("index-info encoding preserves hostile raw path bytes and rejects ambiguity", () => {
  const oid = "1".repeat(40);
  const hostilePath = Buffer.from([
    0x2d, 0x2d, 0x6e, 0x61, 0x6d, 0x65, 0x2d, 0xff,
  ]);
  const encoded = encodeIndexInfoRecords([
    { mode: "100755", oid, pathBytes: hostilePath },
  ]);

  assert.deepEqual(
    encoded,
    Buffer.concat([
      Buffer.from(`100755 ${oid}\t`, "ascii"),
      hostilePath,
      Buffer.from([0]),
    ]),
  );
  assert.throws(
    () =>
      encodeIndexInfoRecords([
        { mode: "100644", oid, pathBytes: hostilePath },
        { mode: "100755", oid, pathBytes: hostilePath },
      ]),
    /duplicate raw path/u,
  );
  assert.throws(
    () =>
      encodeIndexInfoRecords([
        { mode: "100644", oid, pathBytes: Buffer.from("bad\0path") },
      ]),
    /NUL/u,
  );
});

test("projected-index failure cleanup removes only its exact UUID artifacts", async (t) => {
  const fixture = createRepositoryFixture(t, "projected-index-cleanup-");
  const neighbor = join(fixture.scratch, ".projected-index-neighbor.keep");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeFileSync(neighbor, "preserve\n");
  const blobOid = git(
    ["rev-parse", "HEAD:seed.txt"],
    fixture.repo,
  ).stdout.trim();

  await assert.rejects(
    withProjectedIndex(
      {
        root: fixture.repo,
        baselineTreeOid: null,
        entries: [
          {
            mode: "100644",
            oid: blobOid,
            pathBytes: Buffer.from("selected.txt"),
          },
        ],
        temporaryDirectory: fixture.scratch,
        purpose: "cleanup-test",
      },
      () => {
        throw new Error("injected callback failure");
      },
    ),
    /injected callback failure/u,
  );
  assert.equal(readFileSync(neighbor, "utf8"), "preserve\n");
  assert.deepEqual(readdirSync(fixture.scratch), [
    ".projected-index-neighbor.keep",
  ]);
});

test("projected index accepts canonical deletion records", async (t) => {
  const fixture = createRepositoryFixture(t, "projected-index-deletion-");

  writeRepositoryFile(fixture.repo, "deleted.txt", "delete\n");
  commitAll(fixture.repo);
  const headOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const emptyTreeOid = git(["mktree"], fixture.repo, {
    input: Buffer.alloc(0),
  }).stdout.trim();
  const projectedTreeOid = await withProjectedIndex(
    {
      root: fixture.repo,
      baselineTreeOid: headOid,
      entries: [
        {
          mode: "000000",
          oid: "0".repeat(40),
          pathBytes: Buffer.from("deleted.txt"),
        },
      ],
      temporaryDirectory: fixture.scratch,
      purpose: "deletion-test",
    },
    ({ environment }) =>
      runIndexMutationGit(fixture.repo, "write-index-tree", [], {
        env: environment,
      })
        .stdout.toString("utf8")
        .trim(),
  );

  assert.equal(projectedTreeOid, emptyTreeOid);
});

test("projected evidence preserves patch semantics across D/F changes and exclusions", async (t) => {
  const fixture = createRepositoryFixture(t, "projected-evidence-parity-");

  writeRepositoryFile(fixture.repo, "modified.txt", "before\n");
  writeRepositoryFile(fixture.repo, "rename-before.txt", "rename body\n");
  writeRepositoryFile(fixture.repo, "dir-to-file/child.txt", "removed child\n");
  writeRepositoryFile(fixture.repo, "file-to-dir", "removed file\n");
  writeRepositoryFile(
    fixture.repo,
    "deleted.txt",
    "deletion body must stay out\n",
  );
  writeRepositoryFile(
    fixture.repo,
    "binary.bin",
    Buffer.from([0x62, 0x65, 0x66, 0x6f, 0x72, 0x65, 0x00]),
  );
  commitAll(fixture.repo);

  writeRepositoryFile(fixture.repo, "modified.txt", "after\n");
  git(["mv", "rename-before.txt", "rename-after.txt"], fixture.repo);
  git(["rm", "dir-to-file/child.txt"], fixture.repo);
  writeRepositoryFile(fixture.repo, "dir-to-file", "replacement file\n");
  git(["rm", "file-to-dir"], fixture.repo);
  writeRepositoryFile(
    fixture.repo,
    "file-to-dir/child.txt",
    "replacement child\n",
  );
  git(["rm", "deleted.txt"], fixture.repo);
  writeRepositoryFile(
    fixture.repo,
    "binary.bin",
    Buffer.from([0x61, 0x66, 0x74, 0x65, 0x72, 0x00]),
  );
  writeRepositoryFile(fixture.repo, "added.txt", "new addition\n");
  git(["add", "-A"], fixture.repo);

  const manifest = buildSnapshot({
    root: fixture.repo,
    env: undefined,
    workflowMode: "actual",
    scopeKind: "staged",
    sourceIndex: "real",
    headOid: git(["rev-parse", "HEAD"], fixture.repo).stdout.trim(),
  });
  const evidencePlan = canonicalizeEvidencePlan({
    manifest,
    groups: [
      {
        selection: { all: true },
        policy: "message",
        basis: { kind: "user-grounded", note: "Parity fixture" },
      },
    ],
  });
  const records = await acquireEvidence({
    root: fixture.repo,
    manifest,
    evidencePlan,
    attemptDirectory: fixture.scratch,
  });
  const patchText = readFileSync(records[0].path, "utf8");

  assert.match(patchText, /-before\n\+after/u);
  assert.match(patchText, /new file mode 100644/u);
  assert.match(patchText, /\+rename body/u);
  assert.match(patchText, /\+replacement file/u);
  assert.match(patchText, /\+replacement child/u);
  assert.match(patchText, /\+new addition/u);
  assert.doesNotMatch(patchText, /deletion body must stay out/u);
  assert.doesNotMatch(patchText, /binary\.bin/u);
  assert.doesNotMatch(patchText, /rename from/u);
  assert.equal(
    readdirSync(fixture.scratch).some((name) =>
      name.startsWith(".projected-index-"),
    ),
    false,
  );
});

test("projected evidence supports an unborn repository", async (t) => {
  const fixture = createRepositoryFixture(t, "projected-evidence-unborn-");

  writeRepositoryFile(fixture.repo, "initial.txt", "initial content\n");
  git(["add", "--", "initial.txt"], fixture.repo);
  const manifest = buildSnapshot({
    root: fixture.repo,
    env: undefined,
    workflowMode: "actual",
    scopeKind: "staged",
    sourceIndex: "real",
    headOid: null,
  });
  const evidencePlan = canonicalizeEvidencePlan({
    manifest,
    groups: [
      {
        selection: { all: true },
        policy: "message",
        basis: { kind: "user-grounded", note: "Initial snapshot" },
      },
    ],
  });
  const records = await acquireEvidence({
    root: fixture.repo,
    manifest,
    evidencePlan,
    attemptDirectory: fixture.scratch,
  });

  assert.match(readFileSync(records[0].path, "utf8"), /\+initial content/u);
});

test("large evidence groups keep every selected destination out of child argv", async (t) => {
  const fixture = createRepositoryFixture(t, "large-evidence-group-");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);

  for (let index = 0; index < 3_150; index += 1) {
    writeRepositoryFile(
      fixture.repo,
      syntheticPath(index).toString("utf8"),
      "selected change\n",
    );
  }

  git(["add", "--", "generated"], fixture.repo);
  const headOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const manifest = buildSnapshot({
    root: fixture.repo,
    env: undefined,
    workflowMode: "actual",
    scopeKind: "paths",
    sourceIndex: "real",
    headOid,
  });
  const evidencePlan = canonicalizeEvidencePlan({
    manifest,
    groups: [
      {
        selection: { all: true },
        policy: "message",
        basis: { kind: "user-grounded", note: "Large transport fixture" },
      },
    ],
  });
  const observations = [];
  const records = await acquireEvidence({
    root: fixture.repo,
    manifest,
    evidencePlan,
    attemptDirectory: fixture.scratch,
    launchers: {
      synchronous: budgetedSyncLauncher(observations),
      asynchronous: budgetedAsyncLauncher(observations),
    },
  });
  const evidence = readFileSync(records[0].path);

  assert.equal(manifest.changeUnitCount, 3_150);
  assert.ok(
    manifest.changeUnits.reduce(
      (total, unit) =>
        total + Buffer.from(unit.destinationPathBytesBase64, "base64").length,
      0,
    ) > 200_000,
  );
  assert.match(evidence.toString("utf8"), /component-03149/u);
  assert.ok(observations.length >= 3);
  assert.ok(observations.every(({ argvBytes }) => argvBytes <= 1024));
  assert.equal(
    observations.some(({ args }) =>
      args.some((argument) => argument.includes("component-03149")),
    ),
    false,
  );

  const matching = await selectedWorktreeMatchesPreparedTree({
    root: fixture.repo,
    manifest,
    temporaryDirectory: fixture.scratch,
    launchers: {
      synchronous: budgetedSyncLauncher(observations),
      asynchronous: budgetedAsyncLauncher(observations),
    },
  });

  assert.equal(matching.matches, true);
  assert.equal(matching.pathCount, 3_150);

  writeRepositoryFile(fixture.repo, "outside-scope.txt", "unrelated\n");
  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
        launchers: {
          synchronous: budgetedSyncLauncher(observations),
          asynchronous: budgetedAsyncLauncher(observations),
        },
      })
    ).matches,
    true,
  );

  writeRepositoryFile(
    fixture.repo,
    syntheticPath(3_149).toString("utf8"),
    "selected drift\n",
  );
  assert.equal(
    (
      await selectedWorktreeMatchesPreparedTree({
        root: fixture.repo,
        manifest,
        temporaryDirectory: fixture.scratch,
        launchers: {
          synchronous: budgetedSyncLauncher(observations),
          asynchronous: budgetedAsyncLauncher(observations),
        },
      })
    ).matches,
    false,
  );
  assert.ok(observations.every(({ argvBytes }) => argvBytes <= 1024));
});

test("public staged preparation accepts 3,150 intentional change units", (t) => {
  const fixture = createRepositoryFixture(t, "large-staged-workflow-");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);

  for (let index = 0; index < 3_150; index += 1) {
    writeRepositoryFile(
      fixture.repo,
      syntheticPath(index).toString("utf8"),
      "staged workflow change\n",
    );
  }

  git(["add", "--", "generated"], fixture.repo);
  const prepared = runCommitWorkflow(
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
      "--verification",
      "skipped",
    ],
    fixture.repo,
    { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
  );

  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(JSON.parse(prepared.stdout).changeUnitCount, 3_150);
});

test("public workflow completes and publishes one signed 3,150-unit transaction", (t) => {
  const fixture = createRepositoryFixture(t, "large-public-workflow-");
  const tracePath = join(fixture.scratch, "git-trace.json");
  const scopePath = join(fixture.base, "large-scope.json");
  const remotePath = join(fixture.base, "remote.git");
  let aggregateSelectedPathBytes = 0;

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);

  if (!configureSshSigning(t, fixture)) {
    return;
  }

  const signingKeyPath = git(
    ["config", "--path", "user.signingkey"],
    fixture.repo,
  ).stdout.trim();
  const allowedSignersPath = join(fixture.scratch, "allowed-signers");
  const publicKey = readFileSync(`${signingKeyPath}.pub`, "utf8").trim();

  writeFileSync(allowedSignersPath, `tests@example.invalid ${publicKey}\n`);
  git(
    ["config", "gpg.ssh.allowedSignersFile", allowedSignersPath],
    fixture.repo,
  );
  git(["init", "--bare", "--quiet", remotePath], fixture.repo);
  git(["remote", "add", "origin", remotePath], fixture.repo);

  for (let index = 0; index < 3_150; index += 1) {
    const pathBytes = syntheticPath(index);

    aggregateSelectedPathBytes += pathBytes.length;
    writeRepositoryFile(
      fixture.repo,
      pathBytes.toString("utf8"),
      "public workflow change\n",
    );
  }

  writeRepositoryFile(fixture.repo, "outside-scope.txt", "excluded\n");

  writeJson(scopePath, {
    schemaVersion: 2,
    includePaths: [],
    includePathPrefixes: ["generated/"],
    excludePaths: [],
    excludePathPrefixes: [],
    includePathBytesBase64: [],
    excludePathBytesBase64: [],
  });

  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "paths",
      "--scope-file",
      scopePath,
      "--evidence",
      "message",
      "--basis",
      "user-grounded",
      "--allowed-type",
      "test",
      "--verification",
      "required",
    ],
    fixture.repo,
    {
      env: {
        TEMP: fixture.scratch,
        TMP: fixture.scratch,
        GIT_TRACE2_EVENT: tracePath,
      },
    },
  );

  assert.equal(prepared.status, 0, prepared.stderr);
  const preparation = JSON.parse(prepared.stdout);

  assert.equal(preparation.changeUnitCount, 3_150);
  if (preparation.route === "extended") {
    assert.equal(preparation.structuredMessageMode, "bulk");
  }
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo)
      .stdout.trim()
      .split(/\r?\n/u).length,
    3_150,
  );

  let authoring = preparation;
  let reviewedPacketCount = 0;

  if (preparation.route === "concise") {
    const extended = runCommitWorkflow(
      "workflow extend",
      [
        "--transaction",
        preparation.transaction,
        "--reason",
        "semantic-structure-required",
      ],
      fixture.repo,
      { env: { GIT_TRACE2_EVENT: tracePath } },
    );

    assert.equal(extended.status, 0, extended.stderr);
    authoring = JSON.parse(extended.stdout);
  }

  if (authoring.phase === "review-pending") {
    let cursor = null;

    for (;;) {
      const reviewed = runCommitWorkflow(
        "workflow review-next",
        [
          "--transaction",
          preparation.transaction,
          ...(cursor === null ? [] : ["--cursor", cursor]),
        ],
        fixture.repo,
        { env: { GIT_TRACE2_EVENT: tracePath } },
      );

      assert.equal(reviewed.status, 0, reviewed.stderr);
      authoring = JSON.parse(reviewed.stdout);

      if (authoring.packet !== null) {
        reviewedPacketCount += 1;
        assert.ok(authoring.packet.byteCount <= 16 * 1024);
      }

      if (authoring.reviewProgress.complete) {
        break;
      }

      cursor = authoring.reviewProgress.nextCursor;
      assert.equal(typeof cursor, "string");
      assert.ok(reviewedPacketCount <= 1_000);
    }
  }

  assert.equal(authoring.phase, "authoring-pending");
  const contentPath =
    authoring.contentPath ??
    join(dirname(preparation.transaction), "content.json");
  const content = readJson(contentPath);

  content.authoringState = "complete";
  content.subject = {
    type: "test",
    scope: "transport",
    description: "Preserve large-scope commit transport",
  };
  content.sharedRationales = [
    {
      selection: { all: true },
      reasons: [
        "Keep exact commit preparation independent of operating-system argv limits",
      ],
    },
  ];
  content.userExperienceChanges = [
    "Large selected commits complete without manual scope splitting",
  ];
  content.mode = "bulk";
  delete content.fileNotes;
  content.domains = [
    {
      title: "Generated transport fixtures",
      selection: { destinationPathPrefixes: ["generated/"] },
      reasons: [
        "Exercise one exact domain through staging, witnessing, signing, and publication",
      ],
    },
  ];
  writeJson(contentPath, content);

  const finalized = runCommitWorkflow(
    "message finalize",
    ["--transaction", preparation.transaction],
    fixture.repo,
    { env: { GIT_TRACE2_EVENT: tracePath } },
  );

  assert.equal(finalized.status, 0, finalized.stderr);
  const canonical = JSON.parse(finalized.stdout);

  assert.equal(canonical.status, "message-ready");
  assert.match(
    canonical.displayText,
    /Generated transport fixtures \(3150 files\)/u,
  );

  const checked = runCommitWorkflow(
    "workflow check",
    [
      "--transaction",
      preparation.transaction,
      "--label",
      "Large transport fixture",
      "--",
      process.execPath,
      "--eval",
      "process.exit(0)",
    ],
    fixture.repo,
    { env: { GIT_TRACE2_EVENT: tracePath } },
  );

  assert.equal(checked.status, 0, checked.stderr);
  const checkResult = JSON.parse(checked.stdout);

  assert.equal(checkResult.receipt.outcome, "passed");
  assert.equal(checkResult.receipt.selectedScopeStable, true);

  const committed = runCommitWorkflow(
    "workflow commit",
    ["--transaction", preparation.transaction],
    fixture.repo,
    { env: { GIT_TRACE2_EVENT: tracePath } },
  );

  assert.equal(committed.status, 0, committed.stderr);
  const commitResult = JSON.parse(committed.stdout);

  assert.equal(commitResult.commitState, "created");
  assert.equal(commitResult.report.commit.treeMatches, true);
  assert.equal(commitResult.report.commit.messageMatches, true);
  assert.equal(commitResult.report.commit.signed, true);
  assert.equal(commitResult.report.checks.attemptCount, 1);
  assert.equal(
    commitResult.report.checks.receipts[0].receiptId,
    checkResult.receipt.receiptId,
  );
  assert.equal(
    commitResult.report.verification.attempts[
      commitResult.report.verification.effectiveAttempt
    ].status,
    "verified",
  );

  const verified = runCommitWorkflow(
    "workflow verify",
    ["--transaction", preparation.transaction, "--verification", "required"],
    fixture.repo,
    { env: { GIT_TRACE2_EVENT: tracePath } },
  );

  assert.equal(verified.status, 0, verified.stderr);
  const verificationResult = JSON.parse(verified.stdout);

  assert.equal(verificationResult.status, "verified");
  assert.equal(verificationResult.commitOid, commitResult.commitOid);
  assert.equal(
    verificationResult.verification.attempts[
      verificationResult.verification.effectiveAttempt
    ].status,
    "verified",
  );
  const verifiedTransaction = JSON.parse(
    readFileSync(preparation.transaction, "utf8"),
  );
  const verifiedReport = JSON.parse(
    readFileSync(verifiedTransaction.report.jsonPath, "utf8"),
  );

  assert.equal(
    verifiedReport.checks.receipts[0].receiptId,
    checkResult.receipt.receiptId,
  );

  const published = runCommitWorkflow(
    "workflow publish",
    [
      "--transaction",
      preparation.transaction,
      "--remote",
      "origin",
      "--destination",
      "refs/heads/transport-test",
    ],
    fixture.repo,
    { env: { GIT_TRACE2_EVENT: tracePath } },
  );

  assert.equal(published.status, 0, published.stderr);
  assert.equal(JSON.parse(published.stdout).publicationState, "succeeded");
  assert.equal(
    git(["rev-parse", "refs/heads/transport-test"], remotePath).stdout.trim(),
    commitResult.commitOid,
  );
  assert.equal(
    git(["show", "-s", "--format=%B", commitResult.commitOid], fixture.repo)
      .stdout,
    `${canonical.displayText}\n`,
  );
  assert.equal(
    git(["status", "--short", "--", "outside-scope.txt"], fixture.repo).stdout,
    "?? outside-scope.txt\n",
  );

  const gitArgumentVectors = readGitTraceArguments(tracePath);
  const maximumGitArgvBytes = Math.max(
    ...gitArgumentVectors.map((args) => encodedArgvBytes("git", args)),
  );

  assert.ok(maximumGitArgvBytes < 1024);
  assert.equal(
    gitArgumentVectors.some((args) =>
      args.some((argument) => argument.includes("component-03149")),
    ),
    false,
  );
  assert.equal(
    reviewedPacketCount,
    preparation.reviewQueue.requiredPacketCount,
  );
  assert.ok(reviewedPacketCount > 0 && reviewedPacketCount <= 1_000);
  t.diagnostic(
    JSON.stringify({
      changeUnitCount: preparation.changeUnitCount,
      aggregateSelectedPathBytes,
      maximumGitArgvBytes,
      reviewedPacketCount,
      checkReceiptId: checkResult.receipt.receiptId,
      checkOutcome: checkResult.receipt.outcome,
      verificationStatus:
        verificationResult.verification.attempts[
          verificationResult.verification.effectiveAttempt
        ].status,
      publicationState: JSON.parse(published.stdout).publicationState,
    }),
  );
});
