import { existsSync, readFileSync } from "node:fs";
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
  const attempt = dirname(preparation.transaction);
  const contentPath = join(attempt, "content.json");
  const content = readJson(contentPath);

  assert.equal(preparation.route, "extended");
  assert.equal(content.authoringState, "draft");
  assert.equal(content.review.requiredPacketsReviewed, false);
  assert.equal(existsSync(join(attempt, "commit-message.template.txt")), false);

  content.authoringState = "complete";
  delete content.recommendedMode;
  content.review.requiredPacketsReviewed = true;
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
  delete content.recommendedMode;
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

  const revised = readJson(contentPath);
  revised.review.requiredPacketsReviewed = true;
  writeJson(contentPath, revised);
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
