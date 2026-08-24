// Post-commit fact collection and human-readable reporting.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAXIMUM_REPORT_RESULT_BYTES,
  collectCommitReport,
  collectWorkspaceSummary,
  renderCommitReport,
} from "../../src/committing-to-git/report/commitReport.js";
import { createCommitWorkflow } from "../../src/committing-to-git/workflow/createCommitWorkflow.js";
import {
  parsePrepareArguments,
  prepareWorkflow,
} from "../../src/committing-to-git/workflow/prepareWorkflow.js";
import {
  commitAll,
  createRepositoryFixture,
  git,
  readGitTraceArguments,
  readJson,
  runCommitWorkflow,
  writeRepositoryFile,
} from "./harness.mjs";

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function skippedVerification(commitOid = "1".repeat(40)) {
  return {
    schemaVersion: 2,
    commitOid,
    initialPolicy: "skipped",
    finalPolicy: "skipped",
    attempts: [
      {
        status: "skipped",
        reason: "user-policy",
        backend: null,
        identity: null,
        timestamp: "2026-08-23T12:00:00.000Z",
      },
    ],
    effectiveAttempt: 0,
    blocksPush: false,
  };
}

function syntheticStatusStream(fields, observedArguments = null) {
  const bytes = Buffer.concat(
    fields.map((field) => Buffer.concat([field, Buffer.from([0])])),
  );

  return async (operation, args, options) => {
    assert.equal(operation, "status");
    observedArguments?.push(args);
    options.onStdout(bytes);
    return {
      status: 0,
      stdoutByteCount: bytes.length,
      stdoutSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  };
}

function reportWorkspace(kind = "clean") {
  const base = {
    observedAt: "2026-08-23T12:00:00.000Z",
    scopeKind: "full",
    untrackedMode: "all",
    detailMode: "inline-exact",
    exactAtReportTime: true,
    counts: {
      observedEntries: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
    },
    exactPaths: [],
    compactDirectories: [],
    compactPathSamples: [],
    digest: "0".repeat(64),
    nestedSubmoduleWorktrees: "not-inspected",
  };

  if (kind === "exact") {
    return {
      ...base,
      counts: { ...base.counts, observedEntries: 1, unstaged: 1 },
      exactPaths: [
        {
          category: "unstaged",
          status: "modified",
          path: {
            display: "src/file.js",
            bytesBase64: Buffer.from("src/file.js").toString("base64"),
            byteCount: 11,
            sha256: createHash("sha256").update("src/file.js").digest("hex"),
          },
        },
      ],
    };
  }

  if (kind === "compact") {
    return {
      ...base,
      detailMode: "fresh-observation",
      counts: { ...base.counts, observedEntries: 50, untracked: 50 },
      compactDirectories: [
        {
          category: "workspace",
          path: {
            prefix: ".",
            suffix: "",
            byteCount: 1,
            sha256: createHash("sha256").update(".").digest("hex"),
          },
          observedEntryCount: 50,
          exactFileCount: false,
        },
      ],
      compactPathSamples: [],
    };
  }

  return base;
}

function languageReport(overrides = {}) {
  const commitOid = "1".repeat(40);
  const report = {
    schemaVersion: 1,
    headAnchor: {
      headKind: "attached",
      targetRef: "refs/heads/main",
      expectedParentOids: ["2".repeat(40)],
    },
    commit: {
      oid: commitOid,
      parents: ["2".repeat(40)],
      treeOid: "3".repeat(40),
      author: { name: "Test", email: "test@example.invalid" },
      committer: { name: "Test", email: "test@example.invalid" },
      subject: "feat(report): Keep status language honest",
      message: "feat(report): Keep status language honest\n",
      messageSha256: "4".repeat(64),
      signed: true,
      signatureHeaders: ["gpgsig"],
      branch: "refs/heads/main",
      headKind: "attached",
      shortOid: "1".repeat(12),
      treeMatches: true,
      messageMatches: true,
      parentMatches: true,
    },
    comparison: {
      expectedParentOids: ["2".repeat(40)],
      actualParentOids: ["2".repeat(40)],
      parentMatches: true,
      expectedTreeOid: "3".repeat(40),
      actualTreeOid: "3".repeat(40),
      treeMatches: true,
      expectedMessageSha256: "4".repeat(64),
      actualMessageSha256: "4".repeat(64),
      messageMatches: true,
      signatureHeaderPresent: true,
      signatureHeaders: ["gpgsig"],
    },
    statistics: {
      files: 1,
      additions: 1,
      deletions: 0,
      binaryFiles: 0,
      kinds: { modified: 1 },
    },
    verification: skippedVerification(commitOid),
    checks: { schemaVersion: 1, checks: [] },
    publication: { status: "not-requested" },
    workspace: reportWorkspace(),
  };

  return {
    ...report,
    ...overrides,
    commit: { ...report.commit, ...overrides.commit },
    comparison: { ...report.comparison, ...overrides.comparison },
  };
}

async function reportedTransaction(t, fixture) {
  const keyPath = join(fixture.scratch, "report-detail-key");
  const generated = spawnSync(
    "ssh-keygen",
    ["-q", "-t", "ed25519", "-N", "", "-f", keyPath],
    { cwd: fixture.repo, encoding: "utf8", windowsHide: true },
  );

  if (generated.status !== 0) {
    t.skip(`ssh-keygen is unavailable: ${generated.stderr || generated.error}`);
    return null;
  }

  git(["config", "gpg.format", "ssh"], fixture.repo);
  git(["config", "user.signingkey", keyPath], fixture.repo);
  writeRepositoryFile(fixture.repo, "reported.txt", "reported\n");
  const prepared = await prepareWorkflow({
    options: parsePrepareArguments([
      "--mode",
      "actual",
      "--scope",
      "full",
      "--evidence",
      "message",
      "--basis",
      "authored-current-task",
      "--verification",
      "skipped",
    ]),
    cwd: fixture.repo,
    temporaryRoot: fixture.scratch,
  });
  const committed = await createCommitWorkflow({
    transactionPath: prepared.transaction,
    approvedSubject: "test(report): Materialize detail pages",
  });

  assert.equal(committed.exitCode, 0, JSON.stringify(committed));
  return prepared.transaction;
}

test("workspace summaries keep 49 exact paths and compact at 50", async (t) => {
  const exactFixture = createRepositoryFixture(t, "commit-report-exact-49-");

  for (let index = 0; index < 49; index += 1) {
    writeRepositoryFile(
      exactFixture.repo,
      `file-${String(index).padStart(4, "0")}.txt`,
      "change\n",
    );
  }

  const exact = await collectWorkspaceSummary(exactFixture.repo, {
    scope: { kind: "full" },
  });

  assert.equal(MAXIMUM_REPORT_RESULT_BYTES, 80 * 1024);
  assert.equal(exact.counts.observedEntries, 49);
  assert.equal(exact.exactPaths.length, 49);
  assert.deepEqual(exact.compactDirectories, []);
  assert.deepEqual(exact.compactPathSamples, []);
  assert.equal(exact.detailMode, "inline-exact");

  writeRepositoryFile(exactFixture.repo, "file-0049.txt", "change\n");
  const compact = await collectWorkspaceSummary(exactFixture.repo, {
    scope: { kind: "full" },
  });

  assert.equal(compact.counts.observedEntries, 50);
  assert.deepEqual(compact.exactPaths, []);
  assert.equal(compact.detailMode, "fresh-observation");
  assert.deepEqual(compact.compactDirectories, []);
  assert.equal(compact.compactPathSamples.length, 1);
});

test("staged summaries use compact untracked directories without claiming file counts", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-scope-aware-");

  writeRepositoryFile(fixture.repo, "nested/a.txt", "a\n");
  writeRepositoryFile(fixture.repo, "nested/deeper/b.txt", "b\n");
  const summary = await collectWorkspaceSummary(fixture.repo, {
    scope: { kind: "staged" },
  });

  assert.equal(summary.untrackedMode, "normal");
  assert.equal(summary.detailMode, "fresh-observation");
  assert.deepEqual(summary.exactPaths, []);
  assert.equal(summary.compactDirectories.length, 1);
  assert.equal(summary.compactDirectories[0].exactFileCount, false);
  assert.equal(summary.nestedSubmoduleWorktrees, "not-inspected");
});

test("workspace inspection selects untracked depth by scope and always ignores nested submodule dirtiness", async () => {
  const observedArguments = [];
  const stream = syntheticStatusStream(
    [Buffer.from("? nested/", "utf8")],
    observedArguments,
  );

  for (const kind of ["staged", "paths", "full"]) {
    await collectWorkspaceSummary("C:/synthetic-repository", {
      scope: { kind },
      stream,
    });
  }

  assert.deepEqual(
    observedArguments.map((args) =>
      args.find((argument) => argument.startsWith("--untracked-files=")),
    ),
    [
      "--untracked-files=normal",
      "--untracked-files=normal",
      "--untracked-files=all",
    ],
  );
  assert.equal(
    observedArguments.every((args) =>
      args.includes("--ignore-submodules=dirty"),
    ),
    true,
  );
});

test("workspace summaries compact below 50 when byte limits cross and escape unsafe path bytes", async () => {
  const oversizedPath = Buffer.alloc(49 * 1024, 0x61);
  const compact = await collectWorkspaceSummary("C:/synthetic-repository", {
    scope: { kind: "full" },
    stream: syntheticStatusStream([
      Buffer.concat([Buffer.from("? "), oversizedPath]),
    ]),
  });

  assert.equal(compact.counts.observedEntries, 1);
  assert.equal(compact.detailMode, "fresh-observation");
  assert.deepEqual(compact.exactPaths, []);
  assert.equal(
    compact.compactPathSamples[0].path.byteCount,
    oversizedPath.length,
  );
  assert.match(
    renderCommitReport(languageReport({ workspace: compact })),
    /1 path/u,
  );

  const unsafePath = Buffer.from([0x65, 0x73, 0x63, 0x1b, 0xff]);
  const exact = await collectWorkspaceSummary("C:/synthetic-repository", {
    scope: { kind: "full" },
    stream: syntheticStatusStream([
      Buffer.concat([Buffer.from("? "), unsafePath]),
    ]),
  });
  const rendered = renderCommitReport(languageReport({ workspace: exact }));

  assert.equal(exact.exactPaths.length, 1);
  assert.equal(exact.exactPaths[0].path.byteCount, unsafePath.length);
  assert.equal(
    exact.exactPaths[0].path.sha256,
    createHash("sha256").update(unsafePath).digest("hex"),
  );
  assert.match(exact.exactPaths[0].path.display, /\\x1b\\xff/u);
  assert.equal(rendered.includes("\u001b"), false);
  assert.match(rendered, /\\x1b\\xff/u);
});

test("one thousand workspace records never retain a detailed prefix", async () => {
  const fields = Array.from({ length: 1000 }, (_, index) =>
    Buffer.from(`? file-${String(index).padStart(4, "0")}.txt`, "utf8"),
  );
  const summary = await collectWorkspaceSummary("C:/synthetic-repository", {
    scope: { kind: "full" },
    stream: syntheticStatusStream(fields),
  });
  const rendered = renderCommitReport(languageReport({ workspace: summary }));

  assert.equal(summary.counts.observedEntries, 1000);
  assert.deepEqual(summary.exactPaths, []);
  assert.match(rendered, /1,000 paths|1000 paths/u);
  assert.doesNotMatch(rendered, /file-0049/u);
});

test("report language preserves outcome, signature, workspace, and publication distinctions", () => {
  const commitOid = "1".repeat(40);
  const attemptId = randomUUID();
  const basePublication = {
    schemaVersion: 2,
    attemptId,
    retryOf: null,
    commitOid,
    remote: "origin",
    destination: "refs/heads/review",
    refspec: `${commitOid}:refs/heads/review`,
    exitCode: null,
    transcript: null,
    observation: null,
    resolution: null,
    retryPermitted: false,
    reason: null,
  };
  const outcomes = [
    [languageReport(), /Created signed commit/u],
    [
      languageReport({
        verification: {
          ...skippedVerification(commitOid),
          finalPolicy: "required",
          blocksPush: true,
        },
        publication: {
          status: "blocked",
          reason: "verification-policy-blocked",
        },
      }),
      /Created commit; publication blocked/u,
    ],
    [
      languageReport({
        comparison: { treeMatches: false },
        publication: {
          status: "blocked",
          reason: "commit-comparison-mismatch",
        },
      }),
      /signing\/comparison invariant failed/u,
    ],
  ];

  for (const [report, expected] of outcomes) {
    assert.match(renderCommitReport(report), expected);
  }

  const signatureCases = [
    [skippedVerification(commitOid), /Skipped by user policy/u],
    [
      {
        schemaVersion: 2,
        commitOid,
        initialPolicy: "advisory",
        finalPolicy: "advisory",
        attempts: [
          {
            status: "unavailable",
            reason: "trust-store-unreadable",
            backend: "ssh",
            identity: null,
            timestamp: "2026-08-23T12:00:00.000Z",
          },
        ],
        effectiveAttempt: 0,
        blocksPush: false,
      },
      /trust store could not be read/u,
    ],
    [
      {
        schemaVersion: 2,
        commitOid,
        initialPolicy: "required",
        finalPolicy: "required",
        attempts: [
          {
            status: "failed",
            reason: "bad-signature",
            backend: "ssh",
            identity: null,
            timestamp: "2026-08-23T12:00:00.000Z",
          },
        ],
        effectiveAttempt: 0,
        blocksPush: true,
      },
      /Signature verification failed/u,
    ],
    [
      {
        schemaVersion: 2,
        commitOid,
        initialPolicy: "required",
        finalPolicy: "required",
        attempts: [
          {
            status: "verified",
            reason: null,
            backend: "ssh",
            identity: {
              principal: "test@example.invalid",
              keyFingerprint: `SHA256:${"a".repeat(43)}`,
            },
            timestamp: "2026-08-23T12:00:00.000Z",
          },
        ],
        effectiveAttempt: 0,
        blocksPush: false,
      },
      /SSH signature verification succeeded for test@example.invalid/u,
    ],
  ];

  for (const [verification, expected] of signatureCases) {
    const text = renderCommitReport(languageReport({ verification }));

    assert.match(text, expected);
    if (verification.attempts[0].status === "unavailable") {
      assert.doesNotMatch(text, /Trusted verification succeeded/u);
    }
  }

  const checksText = renderCommitReport(
    languageReport({
      checks: {
        schemaVersion: 1,
        checks: [
          {
            label: "unit tests",
            status: "passed",
            context: "approved staged snapshot",
          },
        ],
      },
    }),
  );

  assert.match(checksText, /unit tests: passed \(approved staged snapshot\)/u);
  assert.match(
    renderCommitReport(languageReport()),
    /No checks were run in this workflow/u,
  );

  for (const kind of ["clean", "exact", "compact"]) {
    const text = renderCommitReport(
      languageReport({ workspace: reportWorkspace(kind) }),
    );

    assert.doesNotMatch(text, /user-owned/u);
  }

  const publicationCases = [
    [{ status: "not-requested" }, /no successful push was recorded/u],
    [
      { ...basePublication, status: "rejected", exitCode: 1 },
      /Push was rejected.*no successful push was recorded/su,
    ],
    [
      {
        ...basePublication,
        status: "unknown",
        reason: "remote-outcome-unresolved",
      },
      /Push outcome is unknown.*Recovery is required/su,
    ],
    [
      {
        ...basePublication,
        status: "observed-matching",
        observation: {
          status: "observed",
          observedAt: "2026-08-23T12:01:00.000Z",
          observedOid: commitOid,
          exitCode: 0,
          stdoutSha256: "a".repeat(64),
          stderrSha256: "b".repeat(64),
          commandDigest: "c".repeat(64),
          reason: null,
        },
      },
      /original push actor and attempt remain unproven/u,
    ],
    [
      {
        ...basePublication,
        status: "succeeded",
        exitCode: 0,
        transcript: { retainRecommended: false },
      },
      /helper pushed.*successful push witnessed/su,
    ],
  ];

  for (const [publication, expected] of publicationCases) {
    const text = renderCommitReport(languageReport({ publication }));

    assert.match(text, expected);
  }

  const hierarchy = renderCommitReport(languageReport());
  const headings = [
    "Commit:",
    "Comparison:",
    "Changes:",
    "Checks:",
    "Signature:",
    "Workspace:",
    "Publication:",
  ];

  assert.equal(
    headings.every(
      (heading, index) =>
        index === 0 ||
        hierarchy.indexOf(headings[index - 1]) < hierarchy.indexOf(heading),
    ),
    true,
  );
  assert.equal(languageReport().commit.oid, commitOid);
  assert.match(
    hierarchy,
    new RegExp(`Created signed commit \`${"1".repeat(12)}\``, "u"),
  );
  assert.doesNotMatch(hierarchy, new RegExp(commitOid, "u"));
});

test("one-page workspace detail completion replays byte-identically until refresh", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-detail-one-");
  const transactionPath = await reportedTransaction(t, fixture);

  if (transactionPath === null) {
    return;
  }

  writeRepositoryFile(fixture.repo, "after-report.txt", "detail\n");
  const { reportDetailWorkflow } =
    await import("../../src/committing-to-git/workflow/reportDetailWorkflow.js");
  const first = await reportDetailWorkflow({ transactionPath });
  const replay = await reportDetailWorkflow({ transactionPath });

  assert.equal(first.exitCode, 0);
  assert.equal(first.observation.exactAtReportTime, false);
  assert.equal(first.nextCursor, null);
  assert.deepEqual(replay, first);
  const cliReplay = runCommitWorkflow(
    "workflow report-detail",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(cliReplay.status, 0, cliReplay.stderr);
  assert.deepEqual(JSON.parse(cliReplay.stdout), first);
  assert.ok(
    Buffer.byteLength(cliReplay.stdout) <= MAXIMUM_REPORT_RESULT_BYTES + 1,
  );

  writeRepositoryFile(fixture.repo, "after-refresh.txt", "refresh\n");
  const refreshed = await reportDetailWorkflow({
    transactionPath,
    refresh: true,
  });

  assert.notEqual(refreshed.observation.digest, first.observation.digest);
  assert.equal(refreshed.nextCursor, null);
});

test("durable detail completion replays after page cleanup but before output", async (t) => {
  const fixture = createRepositoryFixture(
    t,
    "commit-report-detail-lost-output-",
  );
  const transactionPath = await reportedTransaction(t, fixture);

  if (transactionPath === null) {
    return;
  }

  writeRepositoryFile(fixture.repo, "lost-output.txt", "detail\n");
  const { reportDetailWorkflow } =
    await import("../../src/committing-to-git/workflow/reportDetailWorkflow.js");

  await assert.rejects(
    reportDetailWorkflow({
      transactionPath,
      failureInjector(point) {
        if (point === "after-detail-page-cleanup-before-journal-cleanup") {
          throw new Error("simulated lost output");
        }
      },
    }),
    /simulated lost output/u,
  );

  const replay = await reportDetailWorkflow({ transactionPath });

  assert.equal(replay.status, "detail-complete");
  assert.equal(replay.nextCursor, null);
  assert.equal(
    existsSync(join(dirname(transactionPath), "report-detail.active.json")),
    false,
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(replay)) <= MAXIMUM_REPORT_RESULT_BYTES,
  );
});

test("multipage workspace detail uses bound cursors and replays the final request", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-detail-many-");
  const transactionPath = await reportedTransaction(t, fixture);

  if (transactionPath === null) {
    return;
  }

  const remote = join(fixture.base, "remote.git");

  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);

  for (let index = 0; index < 180; index += 1) {
    writeRepositoryFile(
      fixture.repo,
      `detail/file-${String(index).padStart(4, "0")}.txt`,
      "detail\n",
    );
  }

  const { ReportDetailError, reportDetailWorkflow } =
    await import("../../src/committing-to-git/workflow/reportDetailWorkflow.js");
  const first = await reportDetailWorkflow({ transactionPath });

  assert.ok(first.nextCursor);
  assert.ok(
    Buffer.byteLength(JSON.stringify(first)) <= MAXIMUM_REPORT_RESULT_BYTES,
  );
  await assert.rejects(
    reportDetailWorkflow({ transactionPath }),
    (error) =>
      error instanceof ReportDetailError &&
      error.code === "DETAIL_STATE_CONFLICT",
  );
  await assert.rejects(
    reportDetailWorkflow({
      transactionPath,
      cursor: `${first.nextCursor.slice(0, -1)}x`,
    }),
    (error) =>
      error instanceof ReportDetailError &&
      error.code === "DETAIL_CURSOR_INVALID",
  );
  const otherFixture = createRepositoryFixture(
    t,
    "commit-report-detail-other-",
  );
  const otherTransaction = await reportedTransaction(t, otherFixture);

  if (otherTransaction !== null) {
    await assert.rejects(
      reportDetailWorkflow({
        transactionPath: otherTransaction,
        cursor: first.nextCursor,
      }),
      (error) =>
        error instanceof ReportDetailError &&
        error.code === "DETAIL_CURSOR_INVALID",
    );
  }

  const { publishWorkflow } =
    await import("../../src/committing-to-git/workflow/publishWorkflow.js");
  const publication = await publishWorkflow({
    transactionPath,
    remote: "origin",
    destination: "refs/heads/review",
  });

  assert.equal(publication.exitCode, 0, JSON.stringify(publication));
  assert.equal(publication.publicationState, "succeeded");

  let requestCursor = first.nextCursor;
  let page = first;

  while (page.nextCursor !== null) {
    requestCursor = page.nextCursor;
    page = await reportDetailWorkflow({
      transactionPath,
      cursor: requestCursor,
    });
  }

  const replay = await reportDetailWorkflow({
    transactionPath,
    cursor: requestCursor,
  });

  assert.deepEqual(replay, page);
});

test("publication and cleanup conflict with an active report-detail state lock", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-detail-lock-");
  const transactionPath = await reportedTransaction(t, fixture);

  if (transactionPath === null) {
    return;
  }

  const {
    acquireTransactionStateLock,
    compactTerminalTransaction,
    releaseTransactionStateLock,
  } =
    await import("../../src/committing-to-git/transaction/transactionRecovery.js");
  const { publishWorkflow } =
    await import("../../src/committing-to-git/workflow/publishWorkflow.js");
  const { reportDetailWorkflow } =
    await import("../../src/committing-to-git/workflow/reportDetailWorkflow.js");
  const lock = acquireTransactionStateLock({
    transactionPath,
    operation: "report-detail",
  });

  try {
    await assert.rejects(
      publishWorkflow({
        transactionPath,
        remote: "origin",
        destination: "refs/heads/review",
      }),
      (error) => error.code === "PUBLICATION_STATE_CONFLICT",
    );
    await assert.rejects(
      reportDetailWorkflow({ transactionPath }),
      (error) => error.code === "DETAIL_STATE_CONFLICT",
    );
    assert.throws(
      () => compactTerminalTransaction({ transactionPath }),
      (error) => error.code === "TRANSACTION_STATE_CONFLICT",
    );
  } finally {
    releaseTransactionStateLock(lock);
  }
});

test("report labels binary line statistics as unavailable", () => {
  const text = renderCommitReport({
    commit: {
      signed: false,
      shortOid: "1".repeat(12),
      branch: "main",
      subject: "build: Preserve binary assets",
      author: { name: "Test", email: "test@example.invalid" },
      committer: { name: "Test", email: "test@example.invalid" },
      treeMatches: true,
      messageMatches: true,
      parentMatches: true,
    },
    statistics: {
      files: 1,
      additions: 0,
      deletions: 0,
      binaryFiles: 1,
      kinds: { modified: 1 },
    },
    verification: skippedVerification(),
    checks: { checks: [] },
    publication: { status: "not-requested" },
    workspace: { staged: [], unstaged: [], untracked: [], conflicted: [] },
  });

  assert.match(text, /1 binary file with unavailable line counts/u);
  assert.doesNotMatch(text, /0 insertions, 0 deletions$/mu);
});

test("report discloses line statistics deferred by the snapshot budget", () => {
  const text = renderCommitReport({
    commit: {
      signed: false,
      shortOid: "1".repeat(12),
      branch: "main",
      subject: "perf: Bound presentation work",
      author: { name: "Test", email: "test@example.invalid" },
      committer: { name: "Test", email: "test@example.invalid" },
      treeMatches: true,
      messageMatches: true,
      parentMatches: true,
    },
    statistics: {
      files: 1,
      additions: null,
      deletions: null,
      binaryFiles: null,
      kinds: { modified: 1 },
    },
    verification: skippedVerification(),
    checks: { checks: [] },
    publication: { status: "not-requested" },
    workspace: { staged: [], unstaged: [], untracked: [], conflicted: [] },
  });

  assert.match(
    text,
    /line statistics deferred by the approved snapshot budget/u,
  );
  assert.doesNotMatch(text, /null insertion|null deletion/u);
});

test("report does not overclaim OpenPGP identity authorization", () => {
  const text = renderCommitReport({
    commit: {
      signed: true,
      shortOid: "1".repeat(12),
      branch: "main",
      subject: "build: Preserve signed history",
      author: { name: "Test", email: "test@example.invalid" },
      committer: { name: "Test", email: "test@example.invalid" },
      treeMatches: true,
      messageMatches: true,
      parentMatches: true,
    },
    statistics: {
      files: 1,
      additions: 1,
      deletions: 0,
      binaryFiles: 0,
      kinds: { added: 1 },
    },
    verification: {
      schemaVersion: 2,
      commitOid: "1".repeat(40),
      initialPolicy: "required",
      finalPolicy: "required",
      attempts: [
        {
          status: "verified",
          reason: null,
          backend: "openpgp",
          identity: {
            signer: "Test Signer <test@example.invalid>",
            primaryKeyFingerprint: "1".repeat(40),
            signingSubkeyFingerprint: null,
          },
          timestamp: "2026-08-23T12:00:00.000Z",
        },
      ],
      effectiveAttempt: 0,
      blocksPush: false,
    },
    checks: { checks: [] },
    publication: { status: "not-requested" },
    workspace: { staged: [], unstaged: [], untracked: [], conflicted: [] },
  });

  assert.match(text, /OpenPGP signature is cryptographically valid/u);
  assert.match(text, /identity authorization was not assessed/u);
  assert.doesNotMatch(text, /Trusted verification succeeded/u);
});

test("report preserves normalized Git change kinds", (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-kinds-");
  const message = "build: Preserve Git change semantics\n";

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

  const parentOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const newLinkOid = git(["hash-object", "-w", "--stdin"], fixture.repo, {
    input: "new-target",
  }).stdout.trim();

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
      `160000,${parentOid},vendor/component`,
    ],
    fixture.repo,
  );

  const approvedTree = git(["write-tree"], fixture.repo).stdout.trim();

  git(["commit", "--quiet", "-m", message.trim()], fixture.repo);
  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const report = collectCommitReport({
    root: fixture.repo,
    commitOid,
    manifest: { headOid: parentOid, indexTreeOid: approvedTree },
    approvedMessage: message,
    verification: skippedVerification(commitOid),
    checks: { schemaVersion: 1, checks: [] },
  });

  assert.deepEqual(report.statistics.kinds, {
    "mode-changed": 1,
    "submodule-changed": 1,
    "symlink-changed": 1,
    "type-changed": 1,
  });
});

test("report counts a similar destination with a retained source as added", (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-adapted-");
  const message = "feat(parser): Add adapted parser support\n";
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

  const parentOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();

  writeRepositoryFile(
    fixture.repo,
    "src/adapted-parser.js",
    `${destination}\n`,
  );
  git(["add", "--", "src/adapted-parser.js"], fixture.repo);

  const approvedTree = git(["write-tree"], fixture.repo).stdout.trim();

  git(["commit", "--quiet", "-m", message.trim()], fixture.repo);

  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const report = collectCommitReport({
    root: fixture.repo,
    commitOid,
    manifest: { headOid: parentOid, indexTreeOid: approvedTree },
    approvedMessage: message,
    verification: skippedVerification(commitOid),
    checks: { schemaVersion: 1, checks: [] },
  });

  assert.deepEqual(report.statistics.kinds, { added: 1 });
});

test("normal report uses actual commit facts and groups remaining workspace state", (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-");
  const messagePath = join(fixture.scratch, "message.txt");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const verificationPath = join(fixture.scratch, "verification.json");
  const checksPath = join(fixture.scratch, "checks.json");
  const outputJson = join(fixture.scratch, "report.json");
  const outputText = join(fixture.scratch, "report.txt");
  const tracePath = join(fixture.scratch, "report-git-trace.json");
  const message = [
    "feat(parser): Prevent malformed token acceptance",
    "",
    "File Changes:",
    "1. `src/parser.js`",
    "   - Reject malformed tokens before structural parsing",
    "",
  ].join("\n");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(
    fixture.repo,
    "src/parser.js",
    "export const parser = true;\n",
  );
  git(["add", "-A"], fixture.repo);
  const approvedTree = git(["write-tree"], fixture.repo).stdout.trim();

  writeFileSync(messagePath, message);
  git(
    ["commit", "--quiet", "--cleanup=verbatim", "-F", messagePath],
    fixture.repo,
  );
  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();

  writeJson(manifestPath, {
    schemaVersion: 2,
    headOid: git(["rev-parse", "HEAD^"], fixture.repo).stdout.trim(),
    indexTreeOid: approvedTree,
    changeUnitCount: 1,
    changeUnits: [{ kind: "added" }],
    statistics: {
      files: 1,
      additions: 1,
      deletions: 0,
      binaryFiles: 0,
    },
  });
  writeJson(verificationPath, skippedVerification(commitOid));
  writeJson(checksPath, { schemaVersion: 1, checks: [] });

  writeRepositoryFile(fixture.repo, "seed.txt", "remaining change\n");
  writeRepositoryFile(fixture.repo, "notes.txt", "untracked\n");

  const result = runCommitWorkflow(
    "report create",
    [
      "--commit",
      commitOid,
      "--manifest",
      manifestPath,
      "--approved-message",
      messagePath,
      "--verification",
      verificationPath,
      "--checks",
      checksPath,
      "--output-json",
      outputJson,
      "--output-text",
      outputText,
    ],
    fixture.repo,
    { env: { GIT_TRACE2_EVENT: tracePath } },
  );

  assert.equal(result.status, 0, result.stderr);

  const report = readJson(outputJson);
  const text = readFileSync(outputText, "utf8");

  assert.equal(report.commit.oid, commitOid);
  assert.equal(report.commit.treeMatches, true);
  assert.equal(report.commit.messageMatches, true);
  assert.deepEqual(report.statistics, {
    files: 1,
    additions: 1,
    deletions: 0,
    binaryFiles: 0,
    kinds: { added: 1 },
  });
  assert.equal(
    readGitTraceArguments(tracePath).some((args) => args.includes("diff-tree")),
    false,
  );
  assert.deepEqual(
    report.workspace.unstaged.map(({ path }) => path),
    ["seed.txt"],
  );
  assert.deepEqual(
    report.workspace.untracked.map(({ path }) => path),
    ["notes.txt"],
  );
  assert.match(
    text,
    new RegExp(
      "Created commit; signing/comparison invariant failed `" +
        commitOid.slice(0, 12),
      "u",
    ),
  );
  assert.match(text, /Snapshot: Matches the approved staged tree/u);
  assert.match(text, /Policy: skipped/u);
  assert.match(text, /Result: Skipped by user policy/u);
  assert.match(text, /No checks were run in this workflow/u);
  assert.match(text, /Not attempted because publication is blocked/u);
  assert.doesNotMatch(text, /Includes/u);
});

test("report renders an explicitly recorded publication result", (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-push-");
  const messagePath = join(fixture.scratch, "message.txt");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const verificationPath = join(fixture.scratch, "verification.json");
  const checksPath = join(fixture.scratch, "checks.json");
  const publicationPath = join(fixture.scratch, "publication.json");
  const outputJson = join(fixture.scratch, "report.json");
  const outputText = join(fixture.scratch, "report.txt");
  const message = "docs: Explain publication status\n";

  writeRepositoryFile(fixture.repo, "published.md", "published\n");
  git(["add", "-A"], fixture.repo);
  const approvedTree = git(["write-tree"], fixture.repo).stdout.trim();
  writeFileSync(messagePath, message);
  git(
    ["commit", "--quiet", "--cleanup=verbatim", "-F", messagePath],
    fixture.repo,
  );
  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();

  writeJson(manifestPath, {
    schemaVersion: 1,
    headOid: null,
    indexTreeOid: approvedTree,
    changeUnitCount: 1,
    changeUnits: [],
  });
  writeJson(verificationPath, skippedVerification(commitOid));
  writeJson(checksPath, { schemaVersion: 1, checks: [] });
  writeJson(publicationPath, {
    schemaVersion: 1,
    status: "pushed",
    commitOid,
    remote: "origin",
    destination: "refs/heads/main",
    refspec: `${commitOid}:refs/heads/main`,
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
  });

  const result = runCommitWorkflow(
    "report create",
    [
      "--commit",
      commitOid,
      "--manifest",
      manifestPath,
      "--approved-message",
      messagePath,
      "--verification",
      verificationPath,
      "--checks",
      checksPath,
      "--publication",
      publicationPath,
      "--output-json",
      outputJson,
      "--output-text",
      outputText,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readJson(outputJson).publication, {
    schemaVersion: 1,
    status: "pushed",
    commitOid,
    remote: "origin",
    destination: "refs/heads/main",
    refspec: `${commitOid}:refs/heads/main`,
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
  });
  assert.ok(
    readFileSync(outputText, "utf8").includes(
      `The helper pushed \`${commitOid}\` to \`origin\` \`refs/heads/main\``,
    ),
  );
});

test("report rejects a merge commit even when its first parent matches", (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-merge-");
  const messagePath = join(fixture.scratch, "message.txt");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const verificationPath = join(fixture.scratch, "verification.json");
  const checksPath = join(fixture.scratch, "checks.json");
  const outputJson = join(fixture.scratch, "report.json");
  const outputText = join(fixture.scratch, "report.txt");
  const message = "Merge feature branch\n";

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  git(["switch", "-c", "feature"], fixture.repo);
  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  commitAll(fixture.repo, "feature");
  git(["switch", "main"], fixture.repo);
  writeRepositoryFile(fixture.repo, "main.txt", "main\n");
  commitAll(fixture.repo, "main");

  const expectedParent = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();

  git(["merge", "--no-ff", "feature", "-m", message.trim()], fixture.repo);

  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const approvedTree = git(
    ["rev-parse", "HEAD^{tree}"],
    fixture.repo,
  ).stdout.trim();

  writeFileSync(messagePath, message);
  writeJson(manifestPath, {
    schemaVersion: 1,
    headOid: expectedParent,
    indexTreeOid: approvedTree,
    changeUnitCount: 1,
    changeUnits: [],
  });
  writeJson(verificationPath, skippedVerification(commitOid));
  writeJson(checksPath, { schemaVersion: 1, checks: [] });

  const result = runCommitWorkflow(
    "report create",
    [
      "--commit",
      commitOid,
      "--manifest",
      manifestPath,
      "--approved-message",
      messagePath,
      "--verification",
      verificationPath,
      "--checks",
      checksPath,
      "--output-json",
      outputJson,
      "--output-text",
      outputText,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 1, result.stderr);
  assert.equal(readJson(outputJson).commit.parentMatches, false);
  assert.match(readFileSync(outputText, "utf8"), /Parent: DIFFERS/u);
});
