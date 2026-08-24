import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import { checkMessageWorkflow } from "../../src/committing-to-git/workflow/checkMessageWorkflow.js";

import {
  commitAll,
  createRepositoryFixture,
  git,
  readJson,
  runCommitWorkflow,
  writeJson,
  writeRepositoryFile,
} from "./harness.mjs";

test("actual workflow carries one approved tree through commit and report", (t) => {
  const fixture = createRepositoryFixture(t, "commit-workflow-e2e-");
  const snapshotPath = join(fixture.scratch, "snapshot.json");
  const inspectionDir = join(fixture.scratch, "inspection");
  const ledgerPath = join(inspectionDir, "ledger.json");
  const contentPath = join(fixture.scratch, "content.json");
  const templatePath = join(fixture.scratch, "template.txt");
  const messagePath = join(fixture.scratch, "message.txt");
  const verificationPath = join(fixture.scratch, "verification.json");
  const checksPath = join(fixture.scratch, "checks.json");
  const reportJson = join(fixture.scratch, "report.json");
  const reportText = join(fixture.scratch, "report.txt");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "Dockerfile", "COPY vite.config.mjs ./\n");
  writeRepositoryFile(
    fixture.repo,
    "vite.config.mjs",
    "export default { root: new URL('.', import.meta.url).pathname };\n",
  );

  const stage = runCommitWorkflow(
    "snapshot create",
    ["--mode", "actual", "--scope", "full", "--output", snapshotPath],
    fixture.repo,
  );

  assert.equal(stage.status, 0, stage.stderr);
  assert.equal(
    runCommitWorkflow(
      "inspection prepare",
      ["--manifest", snapshotPath, "--output-dir", inspectionDir],
      fixture.repo,
    ).status,
    0,
  );

  for (const unit of readJson(ledgerPath).units) {
    assert.equal(
      runCommitWorkflow(
        "inspection acknowledge",
        ["--ledger", ledgerPath, "--id", unit.id, "--sha256", unit.sha256],
        fixture.repo,
      ).status,
      0,
    );
  }

  assert.equal(
    runCommitWorkflow(
      "message scaffold",
      [
        "--manifest",
        snapshotPath,
        "--output",
        contentPath,
        "--template",
        templatePath,
      ],
      fixture.repo,
    ).status,
    0,
  );

  const snapshot = readJson(snapshotPath);
  const reasons = new Map([
    [
      "Dockerfile",
      "Keep container builds aligned with the renamed Vite config",
    ],
    [
      "vite.config.mjs",
      "Declare ESM path handling so native config loading succeeds",
    ],
  ]);

  writeJson(contentPath, {
    subject: {
      type: "build",
      scope: "vite",
      description: "Prevent native config loader warnings",
    },
    rationale: [],
    userExperienceChanges: [],
    mode: "detailed",
    changeEntries: snapshot.changeUnits.map((unit) => ({
      changeUnitId: unit.id,
      reasons: [reasons.get(unit.destinationPath)],
    })),
  });

  assert.equal(
    runCommitWorkflow(
      "message render",
      [
        "--manifest",
        snapshotPath,
        "--content",
        contentPath,
        "--ledger",
        ledgerPath,
        "--output",
        messagePath,
      ],
      fixture.repo,
    ).status,
    0,
  );
  assert.equal(
    runCommitWorkflow(
      "message validate",
      [
        "--manifest",
        snapshotPath,
        "--content",
        contentPath,
        "--ledger",
        ledgerPath,
        messagePath,
      ],
      fixture.repo,
    ).status,
    0,
  );
  assert.equal(
    git(["write-tree"], fixture.repo).stdout.trim(),
    snapshot.indexTreeOid,
  );

  git(
    ["commit", "--quiet", "--cleanup=verbatim", "-F", messagePath],
    fixture.repo,
  );
  const commitOid = git(
    ["rev-parse", "--verify", "HEAD"],
    fixture.repo,
  ).stdout.trim();

  assert.equal(
    runCommitWorkflow(
      "signature verify",
      [
        "--commit",
        commitOid,
        "--initial-policy",
        "skipped",
        "--policy",
        "skipped",
        "--output",
        verificationPath,
      ],
      fixture.repo,
    ).status,
    0,
  );
  assert.equal(readJson(verificationPath).commitOid, commitOid);
  writeJson(checksPath, { schemaVersion: 1, checks: [] });
  assert.equal(
    runCommitWorkflow(
      "report create",
      [
        "--commit",
        commitOid,
        "--manifest",
        snapshotPath,
        "--approved-message",
        messagePath,
        "--verification",
        verificationPath,
        "--checks",
        checksPath,
        "--output-json",
        reportJson,
        "--output-text",
        reportText,
      ],
      fixture.repo,
    ).status,
    0,
  );

  const finalReport = readJson(reportJson);

  assert.equal(finalReport.commit.treeMatches, true);
  assert.equal(finalReport.commit.messageMatches, true);
  assert.deepEqual(finalReport.workspace, {
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  });
  assert.match(
    readFileSync(reportText, "utf8"),
    /build\(vite\): Prevent native config loader warnings/u,
  );
});

test("a concise transaction checks one fixed exact message without a worksheet", (t) => {
  const fixture = createRepositoryFixture(t, "message-check-concise-");
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
  const preparation = JSON.parse(prepared.stdout);
  const attempt = dirname(preparation.transaction);
  const input = join(attempt, "message-input.txt");
  const exact = Buffer.from(
    "fix(parser): Prevent malformed token acceptance\n\nRationale:\n  - Reject malformed input before structural parsing\n",
  );

  assert.equal(preparation.route, "concise");
  assert.equal(existsSync(join(attempt, "content.json")), false);
  assert.equal(existsSync(join(attempt, "commit-message.template.txt")), false);
  writeFileSync(input, exact);

  const checked = runCommitWorkflow(
    "message check",
    ["--transaction", preparation.transaction],
    fixture.repo,
  );
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.stdout.trim().split(/\r?\n/u).length, 1);
  const result = JSON.parse(checked.stdout);

  assert.equal(result.status, "message-ready");
  assert.equal(result.phase, "message-ready");
  assert.equal(result.route, "concise");
  assert.equal(result.messageSource, "checked-file");
  assert.equal(result.messageRevision, 1);
  assert.equal(result.displayText, exact.toString("utf8"));
  assert.equal(existsSync(input), false);
  const transaction = readJson(preparation.transaction);

  assert.equal(transaction.message.revision, 1);
  assert.equal(
    readFileSync(join(attempt, "message", "current", "message.txt")).equals(
      exact,
    ),
    true,
  );
});

test("message checking preserves a prior revision and failed fixed input", (t) => {
  const fixture = createRepositoryFixture(t, "message-check-revision-");
  writeRepositoryFile(fixture.repo, "parser.js", "change\n");
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
  const input = join(dirname(transactionPath), "message-input.txt");

  writeFileSync(input, "fix(parser): Preserve parser behavior\n");
  assert.equal(
    runCommitWorkflow(
      "message check",
      ["--transaction", transactionPath],
      fixture.repo,
    ).status,
    0,
  );
  const prior = readJson(transactionPath).message;

  writeFileSync(input, "fix(parser): invalid lowercase description\n");
  const rejected = runCommitWorkflow(
    "message check",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(rejected.status, 2);
  assert.equal(rejected.stdout.trim().split(/\r?\n/u).length, 1);
  assert.equal(
    JSON.parse(rejected.stdout).code,
    "SUBJECT_DESCRIPTION_NOT_CAPITALIZED",
  );
  assert.equal(existsSync(input), true);
  assert.deepEqual(readJson(transactionPath).message, prior);

  const removedOption = runCommitWorkflow(
    "message check",
    [
      "--transaction",
      transactionPath,
      "--message-file",
      join(fixture.scratch, "external.txt"),
    ],
    fixture.repo,
  );
  assert.equal(removedOption.status, 2);
  assert.equal(JSON.parse(removedOption.stdout).code, "UNKNOWN_ARGUMENT");
});

test("message checking consumes the opened object and never deletes a replacement path", (t) => {
  const fixture = createRepositoryFixture(t, "message-check-identity-");
  writeRepositoryFile(fixture.repo, "parser.js", "change\n");
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
  const input = join(dirname(transactionPath), "message-input.txt");
  const moved = join(dirname(transactionPath), "opened-message-input.txt");
  const approved = "fix(parser): Preserve exact opened bytes\n";
  const replacement = "fix(parser): Preserve replacement bytes\n";

  writeFileSync(input, approved);
  const checked = checkMessageWorkflow({
    transactionPath,
    afterInputOpen() {
      renameSync(input, moved);
      writeFileSync(input, replacement);
    },
  });

  assert.equal(checked.displayText, approved);
  assert.equal(checked.cleanupWarnings.length, 1);
  assert.equal(checked.cleanupWarnings[0].code, "MESSAGE_INPUT_REPLACED");
  assert.equal(readFileSync(input, "utf8"), replacement);
  assert.equal(
    readFileSync(
      join(dirname(transactionPath), "message", "current", "message.txt"),
      "utf8",
    ),
    approved,
  );

  writeFileSync(
    input,
    "fix(parser): Retain input when identity is unavailable\n",
  );
  const conservative = checkMessageWorkflow({
    transactionPath,
    forceCleanupIdentityUnavailable: true,
  });

  assert.equal(conservative.messageRevision, 2);
  assert.equal(
    conservative.cleanupWarnings[0].code,
    "MESSAGE_INPUT_IDENTITY_UNAVAILABLE",
  );
  assert.equal(existsSync(input), true);
});

test("maximum checked bytes and worst-case JSON escaping stay inside the result budget", (t) => {
  const fixture = createRepositoryFixture(t, "message-check-budget-");
  writeRepositoryFile(fixture.repo, "parser.js", "change\n");
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
  const input = join(dirname(transactionPath), "message-input.txt");
  const prefix = "fix(parser): Preserve parser behavior\n\nRationale:\n  - ";
  const exact = `${prefix}${"\\".repeat(32 * 1024 - Buffer.byteLength(prefix) - 1)}\n`;

  assert.equal(Buffer.byteLength(exact), 32 * 1024);
  writeFileSync(input, exact);
  const checked = runCommitWorkflow(
    "message check",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(checked.status, 0, checked.stderr);
  assert.ok(Buffer.byteLength(checked.stdout) <= 80 * 1024);
  assert.equal(JSON.parse(checked.stdout).displayText, exact);

  writeFileSync(input, `${exact.slice(0, -1)}\\\n`);
  const oversized = runCommitWorkflow(
    "message check",
    ["--transaction", transactionPath],
    fixture.repo,
  );

  assert.equal(oversized.status, 2);
  assert.equal(JSON.parse(oversized.stdout).code, "MESSAGE_INPUT_TOO_LARGE");
  assert.equal(existsSync(input), true);
  assert.equal(readJson(transactionPath).message.revision, 1);
});

test("extended preparation creates one draft worksheet and finalizes it once", (t) => {
  const fixture = createRepositoryFixture(t, "message-finalize-extended-");
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
      "review",
      "--basis",
      "unknown-preexisting",
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
  assert.equal(content.schemaVersion, 2);
  assert.equal(content.authoringState, "draft");
  assert.equal(content.subject, null);
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
  assert.match(result.displayText, /File Changes:/u);
  assert.equal(readJson(preparation.transaction).phase, "message-ready");
  assert.equal(
    readFileSync(join(attempt, "message", "current", "message.txt"), "utf8"),
    result.displayText,
  );
});

test("extended finalization converges through one newly required evidence delta", (t) => {
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
  assert.equal(delta.phase, "review-pending");
  assert.equal(delta.canonical, false);
  assert.ok(delta.evidenceDelta.newlyRequiredPacketCount > 0);
  assert.equal(existsSync(delta.evidenceDelta.firstQueuePage), true);
  assert.equal(readJson(transactionPath).message, null);

  const revised = readJson(contentPath);
  assert.equal(revised.review.requiredPacketsReviewed, false);
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
  assert.match(
    finalized.displayText,
    /^fix\(parser\): Preserve parser output/u,
  );
  assert.equal(
    readJson(transactionPath).review.receipt.requiredPacketsReviewed,
    true,
  );
});
