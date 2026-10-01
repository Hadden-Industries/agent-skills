import assert from "node:assert/strict";
import test from "node:test";
import {
  closeSync,
  ftruncateSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseCommandArguments } from "../../src/committing-to-git/cli/commandArguments.js";
import { readRecordedSnapshotFile } from "../../src/committing-to-git/snapshot/recordedSnapshot.js";
import { readTransactionOwnedFile } from "../../src/committing-to-git/message/canonicalMessageState.js";
import { workflowFailureResult } from "../../src/committing-to-git/diagnostics/workflowDiagnosticError.js";

import {
  prepareWorkflow,
  parsePrepareArguments,
} from "../../src/committing-to-git/workflow/prepareWorkflow.js";
import { extendReviewWorkflow } from "../../src/committing-to-git/workflow/extendReviewWorkflow.js";
import { createCommitWorkflow } from "../../src/committing-to-git/workflow/createCommitWorkflow.js";
import { recoverTransactionWorkflow } from "../../src/committing-to-git/workflow/recoverTransactionWorkflow.js";
import { readTransaction } from "../../src/committing-to-git/transaction/transactionWorkspace.js";
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

// A message-sized snapshot reader must fail this real preparation/finalization
// journey; post-commit recovery must not turn that capacity failure into a retry.
for (const outcome of ["uninterrupted auto", "interrupted native"]) {
  test(`large snapshot preserves exact staged scope through ${outcome} execution`, async (t) => {
    const fixture = createRepositoryFixture(t, "native-large-");
    writeRepositoryFile(fixture.repo, "partial.txt", "original\n");
    writeRepositoryFile(fixture.repo, "excluded.txt", "original\n");
    commitAll(fixture.repo);
    if (!configureSshSigning(t, fixture)) return;
    const key = git(
      ["config", "--path", "user.signingkey"],
      fixture.repo,
    ).stdout.trim();
    const signers = join(fixture.scratch, "allowed-signers");
    writeFileSync(
      signers,
      `tests@example.invalid ${readFileSync(`${key}.pub`, "utf8").trim()}\n`,
    );
    git(["config", "gpg.ssh.allowedSignersFile", signers], fixture.repo);
    const parent = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
    const paths = [];
    for (let index = 0; index < 14000; index += 1) {
      const path = `conformance/retained-independent-producer-expected-output-${String(index).padStart(5, "0")}.txt`;
      paths.push(path);
      writeRepositoryFile(
        fixture.repo,
        path,
        `input ${index}\nexpected ${index}\n`,
      );
    }
    writeRepositoryFile(fixture.repo, "partial.txt", "staged\n");
    git(["add", "--", "conformance", "partial.txt"], fixture.repo);
    writeRepositoryFile(fixture.repo, "partial.txt", "staged\nunstaged\n");
    writeRepositoryFile(fixture.repo, "excluded.txt", "user-owned\n");
    const expectedTree = git(["write-tree"], fixture.repo).stdout.trim();
    const prepared = await prepareWorkflow({
      options: parsePrepareArguments([
        "--mode",
        "actual",
        "--scope",
        "staged",
        "--evidence",
        "reuse",
        "--basis",
        "authored-current-task",
        "--verification",
        "required",
      ]),
      cwd: fixture.repo,
      temporaryRoot: fixture.scratch,
    });
    const transactionPath = prepared.transaction;
    const transaction = readTransaction(transactionPath);
    assert.ok(statSync(transaction.snapshot.path).size > 8 * 1024 * 1024);
    t.diagnostic(
      `Recorded snapshot: ${statSync(transaction.snapshot.path).size} bytes; 14001 selected files`,
    );
    assert.equal(prepared.commitExecution.selection, "snapshot-capacity");
    assert.equal(transaction.snapshot.changeUnitCount, 14001);
    const extended =
      transaction.route === "concise"
        ? await extendReviewWorkflow({
            transactionPath,
            reason: "semantic-structure-required",
          })
        : prepared;
    assert.equal(extended.reviewRequired, false);
    const contentPath = join(transaction.attemptDirectory, "content.json");
    const content = readJson(contentPath);
    assert.equal(content.mode, "bulk");
    content.authoringState = "complete";
    content.subject = {
      type: "test",
      scope: null,
      description: "Retain independent conformance results",
    };
    content.domains = [
      {
        title: "Conformance inputs and checkpoint",
        selection: { all: true },
        reasons: [
          "Retain complete independent inputs and the staged checkpoint.",
        ],
      },
    ];
    writeJson(contentPath, content);
    const finalization = runCommitWorkflow(
      "message finalize",
      ["--transaction", transactionPath],
      fixture.repo,
    );
    assert.equal(
      finalization.status,
      0,
      finalization.stdout + finalization.stderr,
    );
    const finalized = JSON.parse(finalization.stdout);
    assert.equal(finalized.phase, "message-ready");
    const approvedBytes = readFileSync(
      join(transaction.attemptDirectory, "message/current/message.txt"),
    );
    if (outcome === "uninterrupted auto") {
      const committed = runCommitWorkflow(
        "workflow commit",
        ["--transaction", transactionPath, "--result-detail", "summary"],
        fixture.repo,
      );
      assert.equal(committed.status, 0, committed.stdout + committed.stderr);
      const result = JSON.parse(committed.stdout);
      assert.equal(result.reportSummary.commit.treeMatches, true);
      assert.equal(result.reportSummary.commit.messageMatches, true);
      assert.equal(
        result.reportSummary.verification.attempts[
          result.reportSummary.verification.effectiveAttempt
        ].status,
        "verified",
      );
    } else {
      const interrupted = await createCommitWorkflow({
        transactionPath,
        execution: "native",
        diagnosticWriter: { write() {} },
        failureInjector(point) {
          if (point === "after-oid-before-verification")
            throw new Error("crash after commit");
        },
      });
      assert.equal(interrupted.commitState, "created");
      const recovered = await recoverTransactionWorkflow({ transactionPath });
      assert.equal(recovered.exitCode, 0, JSON.stringify(recovered));
    }
    assert.equal(
      git(["rev-list", "--count", `${parent}..HEAD`], fixture.repo).stdout,
      "1\n",
    );
    assert.equal(
      git(["rev-parse", "HEAD^{tree}"], fixture.repo).stdout.trim(),
      expectedTree,
    );
    assert.equal(
      git(["rev-parse", "HEAD^"], fixture.repo).stdout.trim(),
      parent,
    );
    git(["verify-commit", "HEAD"], fixture.repo);
    const rawCommit = git(["cat-file", "commit", "HEAD"], fixture.repo).stdout;
    assert.equal(
      rawCommit.slice(rawCommit.indexOf("\n\n") + 2),
      approvedBytes.toString("utf8"),
    );
    const inventory = spawnSync(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"],
      {
        cwd: fixture.repo,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
    );
    assert.equal(inventory.status, 0, inventory.stderr);
    const committedPaths = inventory.stdout.trim().split("\n");
    assert.deepEqual(committedPaths.sort(), [...paths, "partial.txt"].sort());
    assert.equal(
      git(["show", "HEAD:partial.txt"], fixture.repo).stdout,
      "staged\n",
    );
    assert.equal(
      readFileSync(join(fixture.repo, "partial.txt"), "utf8"),
      "staged\nunstaged\n",
    );
    assert.equal(
      readFileSync(join(fixture.repo, "excluded.txt"), "utf8"),
      "user-owned\n",
    );
    await assert.rejects(
      createCommitWorkflow({ transactionPath, execution: "native" }),
    );
    assert.equal(
      git(["rev-list", "--count", `${parent}..HEAD`], fixture.repo).stdout,
      "1\n",
    );
  });
}

test("the public commit operation accepts explicit native execution", () => {
  const parsed = parseCommandArguments("workflow commit", [
    "--transaction",
    "opaque",
    "--execution",
    "native",
  ]);
  assert.equal(parsed.values.get("execution"), "native");
});

async function prepareSmall(t, prefix) {
  const fixture = createRepositoryFixture(t, prefix);
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "change.txt", "change\n");
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
  return { ...fixture, transactionPath: prepared.transaction };
}

test("snapshot capacity is an actionable prerequisite and never a message correction", async (t) => {
  const fixture = await prepareSmall(t, "native-capacity-");
  const transaction = readTransaction(fixture.transactionPath);
  const before = readFileSync(fixture.transactionPath);
  const descriptor = openSync(transaction.snapshot.path, "r+");
  try {
    ftruncateSync(descriptor, 64 * 1024 * 1024 + 1);
  } finally {
    closeSync(descriptor);
  }
  assert.throws(
    () => readRecordedSnapshotFile(fixture.transactionPath),
    (error) => {
      const result = workflowFailureResult(error);
      assert.equal(result.code, "SNAPSHOT_CAPACITY_EXCEEDED");
      assert.equal(result.disposition, "unmet-prerequisite");
      assert.equal(result.recovery.kind, "satisfy-prerequisite");
      assert.ok(result.recovery.requiredInputs.length > 0);
      return true;
    },
  );
  assert.deepEqual(readFileSync(fixture.transactionPath), before);
});

test("bounded artifact reads reject growth without consuming or accepting changed input", async (t) => {
  const fixture = await prepareSmall(t, "native-growing-");
  const transaction = readTransaction(fixture.transactionPath);
  const path = join(transaction.attemptDirectory, "message-input.txt");
  writeFileSync(path, "abc");
  assert.throws(
    () =>
      readTransactionOwnedFile({
        transactionPath: fixture.transactionPath,
        artifactName: "message-input.txt",
        maximumBytes: 4,
        label: "Message",
        afterOpen() {
          writeFileSync(path, "abcdef");
        },
      }),
    (error) => error.code === "MESSAGE_INPUT_CHANGED",
  );
  assert.equal(readFileSync(path, "utf8"), "abcdef");
});

test("explicit native execution preserves unknown-outcome handling before process launch", async (t) => {
  const fixture = await prepareSmall(t, "native-unknown-");
  const parent = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const interrupted = await createCommitWorkflow({
    transactionPath: fixture.transactionPath,
    execution: "native",
    approvedSubject: "fix: Preserve the approved change",
    failureInjector(point) {
      if (point === "after-launching-before-spawn")
        throw new Error("interrupted launch");
    },
  });
  assert.equal(interrupted.commitState, "unknown");
  await assert.rejects(
    createCommitWorkflow({
      transactionPath: fixture.transactionPath,
      execution: "native",
    }),
  );
  const recovered = await recoverTransactionWorkflow({
    transactionPath: fixture.transactionPath,
  });
  assert.equal(recovered.commitState, "unknown");
  assert.equal(git(["rev-parse", "HEAD"], fixture.repo).stdout.trim(), parent);
});

test("the packaged native operation runs normal hooks and preserves a rejected commit", async (t) => {
  const fixture = await prepareSmall(t, "native-hook-");
  if (!configureSshSigning(t, fixture)) return;
  const parent = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  writeFileSync(
    join(fixture.repo, ".git/hooks/pre-commit"),
    "#!/bin/sh\necho observed > hook-observed.txt\nexit 1\n",
    { mode: 0o755 },
  );
  const attempted = runCommitWorkflow(
    "workflow commit",
    [
      "--transaction",
      fixture.transactionPath,
      "--execution",
      "native",
      "--message",
      "fix: Preserve the approved change",
    ],
    fixture.repo,
  );
  assert.equal(attempted.status, 1, attempted.stdout + attempted.stderr);
  assert.equal(JSON.parse(attempted.stdout).commitState, "absent");
  assert.equal(
    readFileSync(join(fixture.repo, "hook-observed.txt"), "utf8"),
    "observed\n",
  );
  assert.equal(git(["rev-parse", "HEAD"], fixture.repo).stdout.trim(), parent);
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "change.txt\n",
  );
});

test("preparation retains the snapshot capacity prerequisite before installing the index", async (t) => {
  const fixture = createRepositoryFixture(t, "native-preparation-cap-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "change.txt", "change\n");
  const originalIndex = readFileSync(join(fixture.repo, ".git/index"));
  // Inject only the serializer's measured size to reach the upper-bound branch
  // without another 70,000-file fixture. The >8 MiB journey above uses real bytes.
  const byteLength = Buffer.byteLength;
  const measure = t.mock.method(Buffer, "byteLength", (value, encoding) =>
    typeof value === "string" &&
    value.startsWith('{\n  "schemaVersion": 2,') &&
    value.includes('"sourceIndexIdentity"')
      ? 64 * 1024 * 1024 + 1
      : byteLength(value, encoding),
  );
  try {
    await assert.rejects(
      prepareWorkflow({
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
      }),
      (error) => {
        const result = workflowFailureResult(error);
        assert.equal(result.code, "SNAPSHOT_CAPACITY_EXCEEDED");
        assert.equal(result.phase, "stopped");
        assert.equal(result.commitState, "absent");
        assert.equal(result.recovery.kind, "satisfy-prerequisite");
        assert.equal(result.documentation, "references/native-execution.md");
        return true;
      },
    );
  } finally {
    measure.mock.restore();
  }
  assert.deepEqual(
    readFileSync(join(fixture.repo, ".git/index")),
    originalIndex,
  );
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "",
  );
});
