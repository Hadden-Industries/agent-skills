import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  commitAll,
  configureSshSigning,
  createRepositoryFixture,
  git,
  readJson,
  runCommitWorkflow,
  writeJson,
  writeRepositoryFile,
} from "./harness.mjs";

test("a trivial lock hash change commits through the direct concise path", (t) => {
  const fixture = createRepositoryFixture(t, "trivial-lock-hash-e2e-");
  const before = {
    skills: {
      "committing-to-git": {
        source: "Hadden-Industries/agent-skills",
        computedHash: "a".repeat(64),
      },
    },
  };

  writeJson(join(fixture.repo, "skills-lock.json"), before);
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

  writeJson(join(fixture.repo, "skills-lock.json"), {
    ...before,
    skills: {
      ...before.skills,
      "committing-to-git": {
        ...before.skills["committing-to-git"],
        computedHash: "b".repeat(64),
      },
    },
  });
  const headBefore = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "paths",
      "--evidence",
      "message",
      "--basis",
      "read-current-task",
      "--path",
      "skills-lock.json",
      "--allowed-type",
      "build",
      "--verification",
      "required",
    ],
    fixture.repo,
    { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
  );

  assert.equal(prepared.status, 0, prepared.stderr);
  const preparation = JSON.parse(prepared.stdout);
  const transaction = readJson(preparation.transaction);
  const attemptDirectory = dirname(preparation.transaction);

  assert.equal(preparation.route, "concise");
  assert.equal(preparation.changeUnitCount, 1);
  assert.equal(transaction.review, null);
  assert.equal(existsSync(join(attemptDirectory, "content.json")), false);
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "skills-lock.json\n",
  );

  const committed = runCommitWorkflow(
    "workflow commit",
    [
      "--transaction",
      preparation.transaction,
      "--message",
      "build(skills): Refresh committing-to-git lock hash",
      "--verification",
      "required",
    ],
    fixture.repo,
  );

  assert.equal(committed.status, 0, committed.stderr);
  const result = JSON.parse(committed.stdout);

  assert.equal(result.commitState, "created");
  assert.equal(result.report.commit.treeMatches, true);
  assert.equal(result.report.commit.messageMatches, true);
  assert.equal(result.report.commit.signed, true);
  assert.equal(result.report.verification.finalPolicy, "required");
  assert.equal(
    result.report.verification.attempts[
      result.report.verification.effectiveAttempt
    ].status,
    "verified",
  );
  assert.equal(
    git(["rev-list", "--count", `${headBefore}..HEAD`], fixture.repo).stdout,
    "1\n",
  );
  assert.equal(
    git(["show", "--format=", "--name-only", "HEAD"], fixture.repo).stdout,
    "skills-lock.json\n",
  );
});

test("an unchanged promoted draft accepts later direct commit authorization", (t) => {
  const fixture = createRepositoryFixture(t, "draft-promotion-commit-e2e-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);

  if (!configureSshSigning(t, fixture)) {
    return;
  }

  writeRepositoryFile(fixture.repo, "feature.txt", "promoted\n");
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
  const transactionPath = JSON.parse(prepared.stdout).transaction;
  const headBefore = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const promotion = runCommitWorkflow(
    "workflow promote",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(promotion.status, 0, `${promotion.stderr}\n${promotion.stdout}`);
  assert.equal(
    git(["rev-parse", "HEAD"], fixture.repo).stdout.trim(),
    headBefore,
  );

  const committed = runCommitWorkflow(
    "workflow commit",
    [
      "--transaction",
      transactionPath,
      "--message",
      "feat(core): Preserve promoted draft evidence",
    ],
    fixture.repo,
  );

  assert.equal(committed.status, 0, committed.stderr);
  const result = JSON.parse(committed.stdout);

  assert.equal(result.commitState, "created");
  assert.equal(result.report.commit.treeMatches, true);
  assert.equal(result.report.commit.messageMatches, true);
  assert.equal(
    git(["show", "-s", "--format=%B", result.commitOid], fixture.repo).stdout,
    "feat(core): Preserve promoted draft evidence\n\n",
  );
});

test("commit after promotion verifies the current real index", (t) => {
  const fixture = createRepositoryFixture(t, "draft-promotion-index-drift-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "feature.txt", "promoted\n");
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
  const transactionPath = JSON.parse(prepared.stdout).transaction;
  const promotion = runCommitWorkflow(
    "workflow promote",
    ["--transaction", transactionPath],
    fixture.repo,
  );
  assert.equal(promotion.status, 0, promotion.stderr);

  writeRepositoryFile(fixture.repo, "unexpected.txt", "unexpected\n");
  git(["add", "unexpected.txt"], fixture.repo);
  const commit = runCommitWorkflow(
    "workflow commit",
    [
      "--transaction",
      transactionPath,
      "--message",
      "feat(core): Preserve promoted draft evidence",
    ],
    fixture.repo,
  );

  assert.equal(commit.status, 1, commit.stderr);
  assert.equal(JSON.parse(commit.stdout).code, "SNAPSHOT_DRIFT");
  assert.equal(
    git(["rev-list", "--count", "HEAD"], fixture.repo).stdout.trim(),
    "1",
  );
});

test("semantic content finalizes after filling only editable placeholders", (t) => {
  const fixture = createRepositoryFixture(t, "semantic-content-round-trip-");
  writeRepositoryFile(fixture.repo, "parser.js", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "parser.js", "after\n");
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
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
  const transactionPath = JSON.parse(prepared.stdout).transaction;
  const extended = runCommitWorkflow(
    "workflow extend",
    [
      "--transaction",
      transactionPath,
      "--reason",
      "semantic-structure-required",
    ],
    fixture.repo,
  );

  assert.equal(extended.status, 0, extended.stderr);
  const contentPath = join(dirname(transactionPath), "content.json");
  const content = readJson(contentPath);

  assert.equal(content.schemaVersion, 3);
  assert.equal("recommendedMode" in content, false);
  assert.equal("review" in content, false);
  assert.deepEqual(Object.keys(content).sort(), [
    "authoringState",
    "evidenceGroups",
    "fileNotes",
    "mode",
    "schemaVersion",
    "sharedRationales",
    "subject",
    "userExperienceChanges",
  ]);

  content.authoringState = "complete";
  content.subject = {
    type: "fix",
    scope: "parser",
    description: "Preserve parser behavior",
  };
  content.sharedRationales = [
    {
      selection: { all: true },
      reasons: ["Keep established parser callers stable"],
    },
  ];
  writeJson(contentPath, content);

  const finalized = runCommitWorkflow(
    "message finalize",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(finalized.status, 0, finalized.stderr);
  const result = JSON.parse(finalized.stdout);

  assert.equal(result.status, "message-ready");
  assert.match(result.displayText, /^fix\(parser\): Preserve parser behavior/u);
});

test("zero-packet four-file authoring finalizes once and creates the canonical signed commit", (t) => {
  const fixture = createRepositoryFixture(t, "zero-packet-authoring-e2e-");
  const paths = [
    "docs/implementation-plan.md",
    "scripts/reference-import-map.mjs",
    "scripts/reference-import-map.test.js",
    "test/consumers/browser/import-map/reference-import-map.json",
  ];

  paths.forEach((path, index) =>
    writeRepositoryFile(fixture.repo, path, `before ${index + 1}\n`),
  );
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
  paths.forEach((path, index) =>
    writeRepositoryFile(fixture.repo, path, `after ${index + 1}\n`),
  );

  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "paths",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      ...paths.flatMap((path) => ["--path", path]),
      "--allowed-type",
      "fix",
      "--verification",
      "required",
    ],
    fixture.repo,
    { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
  );

  assert.equal(prepared.status, 0, prepared.stderr);
  const preparation = JSON.parse(prepared.stdout);
  const extended = runCommitWorkflow(
    "workflow extend",
    [
      "--transaction",
      preparation.transaction,
      "--reason",
      "semantic-structure-required",
    ],
    fixture.repo,
  );

  assert.equal(extended.status, 0, extended.stderr);
  const authoring = JSON.parse(extended.stdout);

  assert.equal(authoring.phase, "authoring-pending");
  assert.equal(authoring.reviewRequired, false);
  assert.equal(authoring.nextAction, "author-content");
  assert.deepEqual(authoring.contentContract.supportedSections, [
    "Rationale",
    "User Experience Changes",
    "File Changes",
  ]);

  const content = readJson(authoring.contentPath);

  content.authoringState = authoring.contentContract.completion.value;
  content.subject = {
    type: "fix",
    scope: "import-map",
    description: "Preserve deterministic reference imports",
  };
  content.sharedRationales = [
    {
      selection: { all: true },
      reasons: [
        "Keep generated import metadata synchronized with its documented contract",
      ],
    },
  ];
  content.userExperienceChanges = [
    "Browser consumers receive the same deterministic reference import mapping",
  ];
  content.fileNotes = paths.map((path) => ({
    selection: { destinationPaths: [path] },
    reasons: [`Keep ${path} aligned with the reference import contract`],
  }));
  writeJson(authoring.contentPath, content);

  const finalized = runCommitWorkflow(
    "message finalize",
    ["--transaction", preparation.transaction],
    fixture.repo,
  );

  assert.equal(finalized.status, 0, finalized.stderr);
  const canonical = JSON.parse(finalized.stdout);

  assert.equal(canonical.status, "message-ready");
  assert.equal(canonical.messageRevision, 1);
  assert.match(canonical.displayText, /\nRationale:\n/u);
  assert.match(canonical.displayText, /\nUser Experience Changes:\n/u);
  assert.match(canonical.displayText, /\nFile Changes:\n/u);
  paths.forEach((path) =>
    assert.equal(canonical.displayText.includes(`\`${path}\``), true),
  );

  const committed = runCommitWorkflow(
    "workflow commit",
    ["--transaction", preparation.transaction],
    fixture.repo,
  );

  assert.equal(committed.status, 0, committed.stderr);
  const result = JSON.parse(committed.stdout);

  assert.equal(result.commitState, "created");
  assert.equal(result.report.commit.treeMatches, true);
  assert.equal(result.report.commit.messageMatches, true);
  assert.equal(result.report.commit.signed, true);
  assert.equal(
    result.report.comparison.actualMessageSha256,
    canonical.messageSha256,
  );
  assert.equal(
    result.report.verification.attempts[
      result.report.verification.effectiveAttempt
    ].status,
    "verified",
  );
  assert.deepEqual(
    git(["show", "--format=", "--name-only", "HEAD"], fixture.repo)
      .stdout.trim()
      .split("\n"),
    paths,
  );
});

test("semantic finalization aggregates independent structural diagnostics", (t) => {
  const fixture = createRepositoryFixture(t, "semantic-content-diagnostics-");
  writeRepositoryFile(fixture.repo, "parser.js", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "parser.js", "after\n");
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
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
  const transactionPath = JSON.parse(prepared.stdout).transaction;
  const extended = runCommitWorkflow(
    "workflow extend",
    [
      "--transaction",
      transactionPath,
      "--reason",
      "semantic-structure-required",
    ],
    fixture.repo,
  );

  assert.equal(extended.status, 0, extended.stderr);
  const contentPath = join(dirname(transactionPath), "content.json");
  const content = readJson(contentPath);

  content.authoringState = "ready";
  content.subject = "fix(parser): Preserve parser behavior";
  content.fileNotes = [
    {
      selection: { includePaths: ["parser.js"] },
      notes: ["Keep established parser callers stable"],
    },
  ];
  writeJson(contentPath, content);

  const finalized = runCommitWorkflow(
    "message finalize",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(finalized.status, 2, finalized.stderr);
  const result = JSON.parse(finalized.stdout);

  assert.equal(result.code, "INVALID_MESSAGE_CONTENT");
  assert.equal(result.diagnostics.truncated, false);
  assert.match(result.diagnostics.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(result.diagnostics.count, result.diagnostics.samples.length);
  const diagnosticsByPointer = new Map(
    result.diagnostics.samples.map((diagnostic) => [
      diagnostic.pointer,
      diagnostic,
    ]),
  );

  assert.deepEqual(diagnosticsByPointer.get("/authoringState").allowedValues, [
    "complete",
  ]);
  assert.equal(diagnosticsByPointer.get("/subject").expectedType, "object");
  assert.ok(diagnosticsByPointer.has("/fileNotes/0/reasons"));
  assert.ok(diagnosticsByPointer.has("/fileNotes/0/notes"));
  assert.deepEqual(
    diagnosticsByPointer.get("/fileNotes/0/selection/includePaths")
      .allowedFields,
    [
      "all",
      "remaining",
      "ids",
      "destinationPaths",
      "destinationPathPrefixes",
      "sourcePaths",
      "sourcePathPrefixes",
      "kinds",
    ],
  );
  assert.match(
    diagnosticsByPointer.get("/fileNotes/0/selection/includePaths").message,
    /scope-file.*destinationPaths/iu,
  );
});

test("structural diagnostics precede presentation-mode binding", (t) => {
  const fixture = createRepositoryFixture(t, "semantic-mode-binding-");
  writeRepositoryFile(fixture.repo, "parser.js", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "parser.js", "after\n");
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
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
  const transactionPath = JSON.parse(prepared.stdout).transaction;
  const extended = runCommitWorkflow(
    "workflow extend",
    [
      "--transaction",
      transactionPath,
      "--reason",
      "semantic-structure-required",
    ],
    fixture.repo,
  );

  assert.equal(extended.status, 0, extended.stderr);
  const contentPath = join(dirname(transactionPath), "content.json");
  const content = readJson(contentPath);

  assert.equal(content.mode, "detailed");
  content.authoringState = "complete";
  content.subject = {
    type: "fix",
    scope: "parser",
    description: "Preserve parser behavior",
  };
  content.sharedRationales = [
    {
      selection: { all: true },
      reasons: ["Keep established parser callers stable"],
    },
  ];
  content.mode = "bulk";
  delete content.fileNotes;
  content.domains = [
    {
      selection: { all: true },
      domain: "Parser behavior",
    },
  ];
  writeJson(contentPath, content);

  const structurallyInvalid = runCommitWorkflow(
    "message finalize",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(structurallyInvalid.status, 2, structurallyInvalid.stderr);
  const structuralResult = JSON.parse(structurallyInvalid.stdout);

  assert.equal(structuralResult.code, "INVALID_MESSAGE_CONTENT");
  assert.ok(
    structuralResult.diagnostics.samples.some(
      (diagnostic) => diagnostic.pointer === "/domains/0/title",
    ),
  );
  assert.ok(
    structuralResult.diagnostics.samples.some(
      (diagnostic) => diagnostic.pointer === "/domains/0/reasons",
    ),
  );

  content.domains = [
    {
      title: "Parser behavior",
      selection: { all: true },
      reasons: ["Keep established parser callers stable"],
    },
  ];
  writeJson(contentPath, content);
  const presentationMismatch = runCommitWorkflow(
    "message finalize",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(presentationMismatch.status, 2, presentationMismatch.stderr);
  assert.equal(
    JSON.parse(presentationMismatch.stdout).code,
    "MESSAGE_PRESENTATION_MODE_MISMATCH",
  );
});

test("verified packet traversal enables a concise message after review", (t) => {
  const fixture = createRepositoryFixture(t, "review-next-concise-");
  writeRepositoryFile(fixture.repo, "large.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(
    fixture.repo,
    "large.txt",
    "reviewed change\n".repeat(8_000),
  );
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "full",
      "--evidence",
      "review",
      "--basis",
      "unknown-preexisting",
      "--verification",
      "skipped",
    ],
    fixture.repo,
    { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
  );

  assert.equal(prepared.status, 0, prepared.stderr);
  const preparation = JSON.parse(prepared.stdout);

  assert.equal(preparation.route, "extended");
  assert.ok(preparation.reviewQueue.requiredPacketCount > 1);
  let cursor = null;
  let deliveredPacketCount = 0;
  const deliveredPacketIds = new Set();
  let finalRequestCursor;
  let finalResult;

  for (;;) {
    const requestCursor = cursor;
    const reviewed = runCommitWorkflow(
      "workflow review-next",
      [
        "--transaction",
        preparation.transaction,
        ...(cursor === null ? [] : ["--cursor", cursor]),
      ],
      fixture.repo,
    );

    assert.equal(reviewed.status, 0, reviewed.stderr);
    const result = JSON.parse(reviewed.stdout);

    deliveredPacketCount += 1;
    assert.match(result.packet.id, /^[SIPD][0-9]{6}$/u);
    assert.equal(deliveredPacketIds.has(result.packet.id), false);
    deliveredPacketIds.add(result.packet.id);
    assert.ok(result.packet.byteCount <= 16 * 1024);
    assert.equal(
      Buffer.byteLength(result.packet.content, "utf8"),
      result.packet.byteCount,
    );
    assert.match(result.packet.content, /^# Review evidence packet\n/u);
    assert.equal(
      result.reviewProgress.deliveredPacketCount,
      deliveredPacketCount,
    );

    if (result.reviewProgress.complete) {
      assert.equal(result.reviewProgress.nextCursor, null);
      assert.equal(result.phase, "authoring-pending");
      assert.equal(result.status, "authoring-pending");
      assert.equal(result.nextAction, "author-message");
      assert.equal(
        result.messagePath,
        join(dirname(preparation.transaction), "message-input.txt"),
      );
      assert.equal(result.contentPath, null);
      assert.equal(result.contentContract, null);
      finalRequestCursor = requestCursor;
      finalResult = result;
      break;
    }

    cursor = result.reviewProgress.nextCursor;
    assert.equal(typeof cursor, "string");
  }

  assert.equal(
    deliveredPacketCount,
    preparation.reviewQueue.requiredPacketCount,
  );
  const finalReplay = runCommitWorkflow(
    "workflow review-next",
    [
      "--transaction",
      preparation.transaction,
      ...(finalRequestCursor === null ? [] : ["--cursor", finalRequestCursor]),
    ],
    fixture.repo,
  );

  assert.equal(finalReplay.status, 0, finalReplay.stderr);
  assert.deepEqual(JSON.parse(finalReplay.stdout), finalResult);
  const transaction = readJson(preparation.transaction);

  assert.equal(transaction.phase, "authoring-pending");
  assert.equal(transaction.review.receipt.requiredPacketsReviewed, true);
  assert.equal(
    transaction.review.receipt.catalogSha256,
    transaction.review.catalogSha256,
  );
  const messagePath = join(
    dirname(preparation.transaction),
    "message-input.txt",
  );

  writeFileSync(messagePath, "fix(review): Preserve reviewed behavior\n");
  const checked = runCommitWorkflow(
    "message check",
    ["--transaction", preparation.transaction],
    fixture.repo,
  );

  assert.equal(checked.status, 0, `${checked.stderr}\n${checked.stdout}`);
  const checkedResult = JSON.parse(checked.stdout);

  assert.equal(checkedResult.status, "message-ready");
  assert.equal(checkedResult.route, "extended");
  assert.equal(
    checkedResult.displayText,
    "fix(review): Preserve reviewed behavior\n",
  );
});

test("review packet replay is idempotent and stale cursors do not advance", (t) => {
  const fixture = createRepositoryFixture(t, "review-next-replay-");
  writeRepositoryFile(fixture.repo, "large.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(
    fixture.repo,
    "large.txt",
    "reviewed change\n".repeat(3_000),
  );
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "full",
      "--evidence",
      "review",
      "--basis",
      "unknown-preexisting",
      "--verification",
      "skipped",
    ],
    fixture.repo,
    { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
  );

  assert.equal(prepared.status, 0, prepared.stderr);
  const transactionPath = JSON.parse(prepared.stdout).transaction;
  const first = runCommitWorkflow(
    "workflow review-next",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(first.status, 0, first.stderr);
  const firstResult = JSON.parse(first.stdout);
  const replay = runCommitWorkflow(
    "workflow review-next",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(replay.status, 0, replay.stderr);
  const replayResult = JSON.parse(replay.stdout);

  assert.deepEqual(replayResult.packet, firstResult.packet);
  assert.deepEqual(replayResult.reviewProgress, firstResult.reviewProgress);

  const second = runCommitWorkflow(
    "workflow review-next",
    [
      "--transaction",
      transactionPath,
      "--cursor",
      firstResult.reviewProgress.nextCursor,
    ],
    fixture.repo,
  );

  assert.equal(second.status, 0, second.stderr);
  const secondResult = JSON.parse(second.stdout);

  assert.equal(secondResult.reviewProgress.deliveredPacketCount, 2);
  const stale = runCommitWorkflow(
    "workflow review-next",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(stale.status, 2, stale.stderr);
  assert.equal(JSON.parse(stale.stdout).code, "REVIEW_CURSOR_INVALID");
  assert.equal(
    readJson(transactionPath).review.traversal.deliveredPacketCount,
    2,
  );
});

test("review traversal rejects a changed packet without advancing", (t) => {
  const fixture = createRepositoryFixture(t, "review-next-tamper-");
  writeRepositoryFile(fixture.repo, "large.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(
    fixture.repo,
    "large.txt",
    "reviewed change\n".repeat(3_000),
  );
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "full",
      "--evidence",
      "review",
      "--basis",
      "unknown-preexisting",
      "--verification",
      "skipped",
    ],
    fixture.repo,
    { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
  );

  assert.equal(prepared.status, 0, prepared.stderr);
  const transactionPath = JSON.parse(prepared.stdout).transaction;
  const first = runCommitWorkflow(
    "workflow review-next",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(first.status, 0, first.stderr);
  const firstResult = JSON.parse(first.stdout);
  const transaction = readJson(transactionPath);
  const catalog = readJson(transaction.review.catalogPath);
  const requiredPacketIds = [
    ...new Set([
      ...catalog.requiredSynopsisPacketIds,
      ...catalog.exactInventoryPacketIds,
      ...catalog.fullPatchPacketIds,
    ]),
  ];
  const nextPacket = catalog.packets.find(
    ({ id }) => id === requiredPacketIds[1],
  );

  writeFileSync(
    join(dirname(transaction.review.catalogPath), nextPacket.artifact),
    "tampered\n",
  );
  const changed = runCommitWorkflow(
    "workflow review-next",
    [
      "--transaction",
      transactionPath,
      "--cursor",
      firstResult.reviewProgress.nextCursor,
    ],
    fixture.repo,
  );

  assert.equal(changed.status, 2, changed.stderr);
  assert.equal(JSON.parse(changed.stdout).code, "REVIEW_PACKET_CHANGED");
  assert.equal(
    readJson(transactionPath).review.traversal.deliveredPacketCount,
    1,
  );
});

test("semantic structure extension cannot use checked concise text", (t) => {
  const fixture = createRepositoryFixture(t, "semantic-check-gate-");
  writeRepositoryFile(fixture.repo, "feature.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "feature.txt", "after\n");
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
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
  const transactionPath = JSON.parse(prepared.stdout).transaction;
  const extended = runCommitWorkflow(
    "workflow extend",
    [
      "--transaction",
      transactionPath,
      "--reason",
      "semantic-structure-required",
    ],
    fixture.repo,
  );

  assert.equal(extended.status, 0, extended.stderr);
  writeFileSync(
    join(dirname(transactionPath), "message-input.txt"),
    "fix(core): Preserve checked behavior\n",
  );
  const checked = runCommitWorkflow(
    "message check",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(checked.status, 2, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).code, "MESSAGE_CHECK_NOT_ALLOWED");
});

test("extended draft finalization survives unchanged promotion", (t) => {
  const fixture = createRepositoryFixture(t, "message-finalize-extended-");
  writeRepositoryFile(fixture.repo, "parser.js", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "parser.js", "after\n");
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
  const preparation = JSON.parse(prepared.stdout);
  const extended = runCommitWorkflow(
    "workflow extend",
    [
      "--transaction",
      preparation.transaction,
      "--reason",
      "semantic-structure-required",
    ],
    fixture.repo,
  );

  assert.equal(extended.status, 0, extended.stderr);
  const attempt = dirname(preparation.transaction);
  const contentPath = join(attempt, "content.json");
  const content = readJson(contentPath);

  assert.equal(JSON.parse(extended.stdout).route, "extended");
  assert.equal(content.authoringState, "draft");
  assert.equal("review" in content, false);
  assert.equal("recommendedMode" in content, false);
  assert.equal(existsSync(join(attempt, "commit-message.template.txt")), false);

  content.authoringState = "complete";
  content.subject = {
    type: "fix",
    scope: "parser",
    description: "Prevent malformed token acceptance",
  };
  content.sharedRationales = [
    {
      selection: { all: true },
      reasons: ["Reject malformed input before structural parsing"],
    },
  ];
  writeJson(contentPath, content);

  const finalized = runCommitWorkflow(
    "message finalize",
    ["--transaction", preparation.transaction],
    fixture.repo,
  );
  assert.equal(finalized.status, 0, finalized.stderr);
  const result = JSON.parse(finalized.stdout);

  assert.equal(result.status, "message-ready");
  assert.equal(result.route, "extended");
  assert.equal(result.canonical, true);
  assert.equal(result.messageRevision, 1);
  assert.match(result.displayText, /^fix\(parser\):/u);
  assert.equal(
    readFileSync(join(attempt, "message", "current", "message.txt"), "utf8"),
    result.displayText,
  );

  const beforePromotion = readJson(preparation.transaction);
  const promotion = runCommitWorkflow(
    "workflow promote",
    ["--transaction", preparation.transaction],
    fixture.repo,
  );
  assert.equal(promotion.status, 0, `${promotion.stderr}\n${promotion.stdout}`);
  const afterPromotion = readJson(preparation.transaction);

  assert.equal(afterPromotion.mode, "actual");
  assert.deepEqual(afterPromotion.review, beforePromotion.review);
  assert.deepEqual(afterPromotion.message, beforePromotion.message);
});

test("extended finalization converges through one evidence delta", (t) => {
  const fixture = createRepositoryFixture(t, "message-finalize-delta-");
  writeRepositoryFile(fixture.repo, "parser.js", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "parser.js", "after\n");
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "full",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
    ],
    fixture.repo,
    { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
  );
  assert.equal(prepared.status, 0, prepared.stderr);
  const transactionPath = JSON.parse(prepared.stdout).transaction;
  const extended = runCommitWorkflow(
    "workflow extend",
    [
      "--transaction",
      transactionPath,
      "--reason",
      "semantic-structure-required",
    ],
    fixture.repo,
  );
  assert.equal(extended.status, 0, extended.stderr);
  const contentPath = join(dirname(transactionPath), "content.json");
  const content = readJson(contentPath);

  content.authoringState = "complete";
  content.evidenceGroups = [
    {
      selection: { all: true },
      policy: "review",
      basis: { kind: "unknown-preexisting", note: "Ownership uncertain" },
    },
  ];
  content.subject = {
    type: "fix",
    scope: "parser",
    description: "Preserve parser output",
  };
  content.sharedRationales = [
    {
      selection: { all: true },
      reasons: ["Keep the parser result stable for existing callers"],
    },
  ];
  writeJson(contentPath, content);

  const first = runCommitWorkflow(
    "message finalize",
    ["--transaction", transactionPath],
    fixture.repo,
  );
  assert.equal(first.status, 1, first.stderr);
  const delta = JSON.parse(first.stdout);

  assert.equal(delta.status, "evidence-required");
  assert.ok(delta.evidenceDelta.newlyRequiredPacketCount > 0);
  assert.equal(existsSync(delta.evidenceDelta.firstQueuePage), true);

  let cursor = null;

  for (;;) {
    const reviewed = runCommitWorkflow(
      "workflow review-next",
      [
        "--transaction",
        transactionPath,
        ...(cursor === null ? [] : ["--cursor", cursor]),
      ],
      fixture.repo,
    );

    assert.equal(reviewed.status, 0, reviewed.stderr);
    const reviewResult = JSON.parse(reviewed.stdout);

    if (reviewResult.reviewProgress.complete) {
      break;
    }

    cursor = reviewResult.reviewProgress.nextCursor;
  }

  const second = runCommitWorkflow(
    "message finalize",
    ["--transaction", transactionPath],
    fixture.repo,
  );
  assert.equal(second.status, 0, second.stderr);
  const finalized = JSON.parse(second.stdout);

  assert.equal(finalized.status, "message-ready");
  assert.equal(finalized.messageRevision, 1);
  assert.equal(
    readJson(transactionPath).review.receipt.requiredPacketsReviewed,
    true,
  );
});

test("an evidence revision delivers only packets not covered by the prior receipt", (t) => {
  const fixture = createRepositoryFixture(t, "message-finalize-delta-only-");
  writeRepositoryFile(fixture.repo, "first.txt", "before first\n");
  writeRepositoryFile(fixture.repo, "second.txt", "before second\n");
  commitAll(fixture.repo);
  writeRepositoryFile(
    fixture.repo,
    "first.txt",
    "reviewed first change\n".repeat(3_000),
  );
  writeRepositoryFile(
    fixture.repo,
    "second.txt",
    "reviewed second change\n".repeat(3_000),
  );
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
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
  const preparation = JSON.parse(prepared.stdout);
  const extended = runCommitWorkflow(
    "workflow extend",
    [
      "--transaction",
      preparation.transaction,
      "--reason",
      "semantic-structure-required",
    ],
    fixture.repo,
  );

  assert.equal(extended.status, 0, extended.stderr);
  const firstReviewGroups = [
    {
      selection: { destinationPaths: ["first.txt"] },
      policy: "review",
      basis: { kind: "unknown-preexisting", note: "Ownership uncertain" },
    },
    {
      selection: { remaining: true },
      policy: "reuse",
      basis: { kind: "read-current-task", note: null },
    },
  ];
  const contentPath = join(dirname(preparation.transaction), "content.json");
  const content = readJson(contentPath);

  content.authoringState = "complete";
  content.evidenceGroups = firstReviewGroups;
  content.subject = {
    type: "fix",
    scope: "review",
    description: "Preserve both reviewed changes",
  };
  content.sharedRationales = [
    {
      selection: { all: true },
      reasons: ["Keep both reviewed outcomes consistent"],
    },
  ];
  writeJson(contentPath, content);

  const firstEvidenceRequest = runCommitWorkflow(
    "message finalize",
    ["--transaction", preparation.transaction],
    fixture.repo,
  );

  assert.equal(firstEvidenceRequest.status, 1, firstEvidenceRequest.stderr);
  let cursor = null;
  const initiallyReviewed = new Set();

  for (;;) {
    const reviewed = runCommitWorkflow(
      "workflow review-next",
      [
        "--transaction",
        preparation.transaction,
        ...(cursor === null ? [] : ["--cursor", cursor]),
      ],
      fixture.repo,
    );

    assert.equal(reviewed.status, 0, reviewed.stderr);
    const result = JSON.parse(reviewed.stdout);

    initiallyReviewed.add(result.packet.id);

    if (result.reviewProgress.complete) {
      break;
    }

    cursor = result.reviewProgress.nextCursor;
  }

  const firstFinalization = runCommitWorkflow(
    "message finalize",
    ["--transaction", preparation.transaction],
    fixture.repo,
  );

  assert.equal(firstFinalization.status, 0, firstFinalization.stderr);
  const revisedContent = readJson(contentPath);

  revisedContent.evidenceGroups = [
    firstReviewGroups[0],
    {
      selection: { remaining: true },
      policy: "review",
      basis: { kind: "unknown-preexisting", note: "Now requires review" },
    },
  ];
  writeJson(contentPath, revisedContent);
  const secondEvidenceRequest = runCommitWorkflow(
    "message finalize",
    ["--transaction", preparation.transaction],
    fixture.repo,
  );

  assert.equal(secondEvidenceRequest.status, 1, secondEvidenceRequest.stderr);
  const evidenceRequired = JSON.parse(secondEvidenceRequest.stdout);
  const pending = readJson(preparation.transaction).review.deliveryPacketIds;

  assert.equal(evidenceRequired.status, "evidence-required");
  assert.equal(
    pending.length,
    evidenceRequired.evidenceDelta.newlyRequiredPacketCount,
  );
  assert.ok(pending.length > 0);
  assert.equal(
    pending.some((id) => initiallyReviewed.has(id)),
    false,
  );

  cursor = null;
  const deltaPackets = [];

  for (;;) {
    const reviewed = runCommitWorkflow(
      "workflow review-next",
      [
        "--transaction",
        preparation.transaction,
        ...(cursor === null ? [] : ["--cursor", cursor]),
      ],
      fixture.repo,
    );

    assert.equal(reviewed.status, 0, reviewed.stderr);
    const result = JSON.parse(reviewed.stdout);

    deltaPackets.push(result.packet.id);
    assert.equal(result.reviewProgress.requiredPacketCount, pending.length);

    if (result.reviewProgress.complete) {
      break;
    }

    cursor = result.reviewProgress.nextCursor;
  }

  assert.deepEqual(deltaPackets, pending);
  assert.equal(
    deltaPackets.some((id) => initiallyReviewed.has(id)),
    false,
  );

  const secondFinalization = runCommitWorkflow(
    "message finalize",
    ["--transaction", preparation.transaction],
    fixture.repo,
  );

  assert.equal(secondFinalization.status, 0, secondFinalization.stderr);
  assert.equal(JSON.parse(secondFinalization.stdout).status, "message-ready");
});
