import { unlinkSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePrepareArguments,
  prepareWorkflow,
} from "../../src/committing-to-git/workflow/prepareWorkflow.js";
import { runCheckWorkflow } from "../../src/committing-to-git/workflow/runCheckWorkflow.js";
import { readTransaction } from "../../src/committing-to-git/transaction/transactionWorkspace.js";
import {
  createRepositoryFixture,
  runNodeScript,
  writeRepositoryFile,
} from "./harness.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_CLI = join(
  REPO_ROOT,
  "src",
  "committing-to-git",
  "cli",
  "commitWorkflow.js",
);

async function prepareTransaction(t, prefix = "check-workflow-") {
  const fixture = createRepositoryFixture(t, prefix);

  writeRepositoryFile(fixture.repo, "feature.txt", "prepared\n");
  const prepared = await prepareWorkflow({
    options: parsePrepareArguments([
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
    ]),
    cwd: fixture.repo,
    temporaryRoot: fixture.scratch,
  });

  return { fixture, transactionPath: prepared.transaction };
}

function runCheck(fixture, transactionPath, command, options = []) {
  return runNodeScript(
    SOURCE_CLI,
    [
      "workflow",
      "check",
      "--transaction",
      transactionPath,
      "--label",
      "Repository verification",
      ...options,
      "--",
      ...command,
    ],
    fixture.repo,
  );
}

function runCheckDetail(fixture, transactionPath, options) {
  return runNodeScript(
    SOURCE_CLI,
    ["workflow", "check-detail", "--transaction", transactionPath, ...options],
    fixture.repo,
  );
}

function eventedChild({ exitCode = 0, signal = null } = {}) {
  const child = new EventEmitter();

  child.pid = process.pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  setImmediate(() => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", exitCode, signal);
  });
  return child;
}

test("workflow check witnesses one successful argv command without displaying its output", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "check-workflow-pass-",
  );
  // Encode the marker in argv so its plain text can appear only if the helper
  // leaks child output, not merely because it faithfully reports the command.
  const checkScript =
    "process.stdout.write(Buffer.from('cHJpdmF0ZS1zdWNjZXNzLW91dHB1dA==', 'base64')); process.stderr.write(Buffer.from('cHJpdmF0ZS13YXJuaW5nLW91dHB1dA==', 'base64'))";
  const result = runCheck(fixture, transactionPath, [
    process.execPath,
    "-e",
    checkScript,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const transaction = readTransaction(transactionPath);

  assert.equal(payload.status, "check-passed");
  assert.equal(payload.receipt.receiptId, "C000001");
  assert.equal(payload.receipt.outcome, "passed");
  assert.equal(payload.receipt.exitCode, 0);
  assert.equal(payload.receipt.context, "current-worktree");
  assert.deepEqual(payload.receipt.command, {
    executable: process.execPath,
    arguments: ["-e", checkScript],
  });
  assert.doesNotMatch(result.stdout, /private-success-output/u);
  assert.doesNotMatch(result.stderr, /private-warning-output/u);
  assert.equal(transaction.checkAttempts.length, 1);
  assert.equal(transaction.checkAttempts[0].completion.outcome, "passed");
  assert.equal(transaction.checkAttempts[0].workspace.before.matches, true);
  assert.equal(transaction.checkAttempts[0].workspace.after.matches, true);
  assert.equal(transaction.phase, "evidence-ready");
});

test("workflow check derives a failed receipt from the actual child exit", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "check-workflow-fail-",
  );
  const result = runCheck(fixture, transactionPath, [
    process.execPath,
    "-e",
    "process.stderr.write('check-failed-evidence'); process.exit(7)",
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const attempt = readTransaction(transactionPath).checkAttempts[0];

  assert.equal(payload.status, "check-failed");
  assert.equal(payload.receipt.outcome, "failed");
  assert.equal(payload.receipt.exitCode, 7);
  assert.match(result.stderr, /check-failed-evidence/u);
  assert.equal(attempt.completion.outcome, "failed");
  assert.equal(attempt.completion.exitCode, 7);
  assert.equal(attempt.output.stderr.totalByteCount, 21);
  assert.match(attempt.output.stderr.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(readTransaction(transactionPath).phase, "evidence-ready");
});

test("workflow check passes shell metacharacters as literal arguments", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "check-workflow-argv-",
  );
  const result = runCheck(fixture, transactionPath, [
    process.execPath,
    "-e",
    "process.exit(JSON.stringify(process.argv.slice(1)) === JSON.stringify(['&&', '|', '$HOME']) ? 0 : 9)",
    "&&",
    "|",
    "$HOME",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).receipt.outcome, "passed");
});

test("workflow check rejects a shell command string before journaling", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "check-workflow-shell-string-",
  );
  const result = runCheck(fixture, transactionPath, [
    "npm run verify && echo fabricated",
  ]);

  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, "CHECK_COMMAND_INVALID");
  assert.deepEqual(readTransaction(transactionPath).checkAttempts, []);
});

test("workflow check stops the transaction when the selected scope drifts", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "check-workflow-drift-",
  );
  const result = runCheck(fixture, transactionPath, [
    process.execPath,
    "-e",
    "require('node:fs').writeFileSync('feature.txt', 'drifted\\n')",
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const transaction = readTransaction(transactionPath);

  assert.equal(payload.status, "stopped");
  assert.equal(payload.code, "CHECK_SCOPE_DRIFT");
  assert.equal(transaction.phase, "stopped");
  assert.equal(transaction.terminalDisposition, "no-commit-stopped");
  assert.equal(transaction.checkAttempts[0].completion.outcome, "passed");
  assert.equal(transaction.checkAttempts[0].workspace.after.matches, false);
});

test("workflow check allows changes outside the selected transaction scope", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "check-workflow-excluded-",
  );
  writeFileSync(join(fixture.repo, "excluded.txt"), "before\n");
  const result = runCheck(fixture, transactionPath, [
    process.execPath,
    "-e",
    "require('node:fs').writeFileSync('excluded.txt', 'after\\n')",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const attempt = readTransaction(transactionPath).checkAttempts[0];

  assert.equal(attempt.workspace.after.matches, true);
  assert.equal(readTransaction(transactionPath).phase, "evidence-ready");
});

test("workflow check resolves the npm command shim cross-platform", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "check-workflow-npm-",
  );
  const result = runCheck(fixture, transactionPath, ["npm", "--version"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).receipt.outcome, "passed");
});

test("workflow check journals a synchronous launcher failure without inventing a child", async (t) => {
  const { transactionPath } = await prepareTransaction(
    t,
    "check-workflow-sync-launch-error-",
  );
  const diagnostics = [];
  const result = await runCheckWorkflow({
    transactionPath,
    label: "Synchronous launch failure",
    command: { executable: "missing-tool", arguments: [] },
    diagnosticWriter: { write: (value) => diagnostics.push(value) },
    processLauncher() {
      const error = new Error("launcher refused the executable");

      error.code = "ENOENT";
      throw error;
    },
  });
  const attempt = readTransaction(transactionPath).checkAttempts[0];

  assert.equal(result.status, "check-failed");
  assert.equal(result.code, "CHECK_LAUNCH_FAILED");
  assert.equal(attempt.launchState, "completed");
  assert.equal(attempt.childIdentity, null);
  assert.equal(attempt.completion.outcome, "launch-error");
  assert.equal(attempt.completion.launchError.code, "ENOENT");
  assert.match(diagnostics.join(""), /launcher refused the executable/u);
});

test("workflow check journals an asynchronous executable lookup failure", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "check-workflow-async-launch-error-",
  );
  const result = runCheck(fixture, transactionPath, [
    "committing-to-git-command-that-does-not-exist-8af35330",
  ]);
  const payload = JSON.parse(result.stdout);
  const attempt = readTransaction(transactionPath).checkAttempts[0];

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(payload.code, "CHECK_LAUNCH_FAILED");
  assert.equal(attempt.launchState, "completed");
  assert.equal(attempt.completion.outcome, "launch-error");
  assert.equal(attempt.completion.launchError.code, "ENOENT");
});

test("workflow check derives a signaled outcome from the child close event", async (t) => {
  const { transactionPath } = await prepareTransaction(
    t,
    "check-workflow-signaled-",
  );
  const result = await runCheckWorkflow({
    transactionPath,
    label: "Signaled check",
    command: { executable: "signal-fixture", arguments: [] },
    processLauncher: () => eventedChild({ exitCode: null, signal: "SIGTERM" }),
    diagnosticWriter: { write() {} },
  });

  assert.equal(result.status, "check-failed");
  assert.equal(result.code, "CHECK_SIGNALED");
  assert.equal(result.receipt.outcome, "signaled");
  assert.equal(result.receipt.signal, "SIGTERM");
});

test("workflow check records a helper-enforced timeout as timed-out", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "check-workflow-timeout-",
  );
  const result = runCheck(
    fixture,
    transactionPath,
    [process.execPath, "-e", "setInterval(() => {}, 1000)"],
    ["--timeout-ms", "100"],
  );
  const attempt = readTransaction(transactionPath).checkAttempts[0];

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).code, "CHECK_TIMED_OUT");
  assert.equal(attempt.completion.outcome, "timed-out");
  assert.equal(attempt.completion.exitCode, null);
});

test("workflow check bounds diagnostics and retained segments while hashing complete output", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "check-workflow-output-budget-",
  );
  const result = runCheck(fixture, transactionPath, [
    process.execPath,
    "-e",
    "process.stderr.write('H'.repeat(300000) + 'T'.repeat(300000)); process.exit(6)",
  ]);
  const attempt = readTransaction(transactionPath).checkAttempts[0];

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(attempt.output.stderr.totalByteCount, 600_000);
  assert.equal(attempt.output.stderr.headByteCount, 256 * 1024);
  assert.equal(attempt.output.stderr.tailByteCount, 256 * 1024);
  assert.equal(attempt.output.stderr.truncated, true);
  assert.match(attempt.output.stderr.sha256, /^[0-9a-f]{64}$/u);
  assert.match(attempt.output.stderr.headSha256, /^[0-9a-f]{64}$/u);
  assert.match(attempt.output.stderr.tailSha256, /^[0-9a-f]{64}$/u);
  assert.ok(Buffer.byteLength(result.stderr, "utf8") <= 32 * 1024);
  assert.match(result.stderr, /H{32}/u);
  assert.match(result.stderr, /check output suppressed/u);
  assert.match(result.stderr, /T{32}/u);
});

test("workflow check-detail pages one bounded transaction-owned output segment", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "check-detail-page-",
  );

  runCheck(fixture, transactionPath, [
    process.execPath,
    "-e",
    "process.stderr.write('detail-evidence-'.repeat(3000)); process.exit(8)",
  ]);
  const first = runCheckDetail(fixture, transactionPath, [
    "--receipt",
    "C000001",
    "--stream",
    "stderr",
    "--segment",
    "head",
  ]);

  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstPage = JSON.parse(first.stdout);

  assert.equal(firstPage.status, "check-detail");
  assert.equal(firstPage.receiptId, "C000001");
  assert.equal(firstPage.stream, "stderr");
  assert.equal(firstPage.segment, "head");
  assert.equal(firstPage.offset, 0);
  assert.ok(firstPage.byteCount <= 16 * 1024);
  assert.equal(firstPage.nextOffset, firstPage.byteCount);
  assert.equal(firstPage.complete, false);
  assert.equal(firstPage.content.encoding, "utf8");
  assert.match(firstPage.content.value, /detail-evidence/u);

  const second = runCheckDetail(fixture, transactionPath, [
    "--receipt",
    "C000001",
    "--stream",
    "stderr",
    "--segment",
    "head",
    "--offset",
    String(firstPage.nextOffset),
  ]);
  const secondPage = JSON.parse(second.stdout);

  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(secondPage.offset, firstPage.nextOffset);
  assert.ok(secondPage.nextOffset > secondPage.offset);
});

test("workflow check-detail rejects hostile receipt identifiers before path construction", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "check-detail-hostile-id-",
  );
  const result = runCheckDetail(fixture, transactionPath, [
    "--receipt",
    "../C000001",
    "--stream",
    "stderr",
    "--segment",
    "head",
  ]);

  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, "CHECK_DETAIL_RECEIPT_INVALID");
});

test("workflow check-detail detects replaced and unavailable retained segments", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "check-detail-replacement-",
  );

  runCheck(fixture, transactionPath, [
    process.execPath,
    "-e",
    "process.stderr.write('original-detail'); process.exit(9)",
  ]);
  let attempt = readTransaction(transactionPath).checkAttempts[0];

  writeFileSync(
    attempt.output.stderr.headPath,
    Buffer.alloc(attempt.output.stderr.headByteCount, 0x58),
  );
  const replaced = runCheckDetail(fixture, transactionPath, [
    "--receipt",
    "C000001",
    "--stream",
    "stderr",
    "--segment",
    "head",
  ]);

  assert.equal(replaced.status, 1);
  assert.equal(
    JSON.parse(replaced.stdout).code,
    "CHECK_DETAIL_ARTIFACT_CHANGED",
  );

  const second = await prepareTransaction(t, "check-detail-unavailable-");

  runCheck(second.fixture, second.transactionPath, [
    process.execPath,
    "-e",
    "process.stderr.write('temporary-detail'); process.exit(10)",
  ]);
  attempt = readTransaction(second.transactionPath).checkAttempts[0];
  unlinkSync(attempt.output.stderr.headPath);
  const unavailable = runCheckDetail(second.fixture, second.transactionPath, [
    "--receipt",
    "C000001",
    "--stream",
    "stderr",
    "--segment",
    "head",
  ]);

  assert.equal(unavailable.status, 1);
  assert.equal(JSON.parse(unavailable.stdout).code, "CHECK_DETAIL_UNAVAILABLE");
});

test("workflow commit rejects the removed external checks interface before reading it", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "commit-removed-checks-input-",
  );
  const result = runNodeScript(
    SOURCE_CLI,
    [
      "workflow",
      "commit",
      "--transaction",
      transactionPath,
      "--message",
      "test(checks): Reject external evidence",
      "--checks",
      join(fixture.scratch, "must-not-be-read.json"),
    ],
    fixture.repo,
  );

  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, "UNKNOWN_ARGUMENT");
  assert.equal(readTransaction(transactionPath).commit, null);
});

test("workflow commit accepts repeated failed-check acknowledgement flags as a vector", async (t) => {
  const { fixture, transactionPath } = await prepareTransaction(
    t,
    "commit-repeatable-check-acknowledgement-",
  );
  const result = runNodeScript(
    SOURCE_CLI,
    [
      "workflow",
      "commit",
      "--transaction",
      transactionPath,
      "--message",
      "test(checks): Parse repeated acknowledgements",
      "--acknowledge-failed-check",
      "C000001",
      "--acknowledge-failed-check",
      "C000002",
    ],
    fixture.repo,
  );

  assert.equal(result.status, 2);
  assert.equal(
    JSON.parse(result.stdout).code,
    "FAILED_CHECK_ACKNOWLEDGEMENT_INVALID",
  );
  assert.doesNotMatch(result.stderr, /DUPLICATE_ARGUMENT/u);
  assert.equal(readTransaction(transactionPath).commit, null);
});
