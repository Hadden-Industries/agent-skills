// Exact-OID, explicit-destination publication and durable result capture.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  createRepositoryFixture,
  git,
  runCommitWorkflow,
  writeRepositoryFile,
} from "./harness.mjs";
import { runReadOnlyGit } from "../../src/committing-to-git/git/gitRepository.js";
import {
  advanceTransaction,
  readTransaction,
  updateTransaction,
} from "../../src/committing-to-git/transaction/transactionWorkspace.js";
import { createCommitWorkflow } from "../../src/committing-to-git/workflow/createCommitWorkflow.js";
import {
  parsePrepareArguments,
  prepareWorkflow,
} from "../../src/committing-to-git/workflow/prepareWorkflow.js";

async function reportedTransaction(t, fixture) {
  const keyPath = join(fixture.scratch, "publication-key");
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
  writeRepositoryFile(fixture.repo, "publish-me.txt", "publish\n");
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
    approvedSubject: "test(publication): Push exact commit",
  });

  assert.equal(committed.exitCode, 0, JSON.stringify(committed));
  return {
    transactionPath: prepared.transaction,
    commitOid: committed.commitOid,
  };
}

function journaledPublicationAttempt(transaction, overrides = {}) {
  const commitOid = transaction.commit.commitOid;
  const destination = "refs/heads/review";

  return {
    schemaVersion: 1,
    attemptId: randomUUID(),
    retryOf: null,
    status: "pending",
    launchState: "not-started",
    childIdentity: null,
    commitOid,
    remote: "origin",
    destination,
    refspec: `${commitOid}:${destination}`,
    startedAt: new Date().toISOString(),
    completion: null,
    transcript: null,
    observation: null,
    resolution: null,
    retryPermitted: false,
    reason: null,
    ...overrides,
  };
}

test("high-level publication reuses the report and witnesses one exact push", async (t) => {
  const fixture = createRepositoryFixture(t, "workflow-publication-success-");
  const remote = join(fixture.base, "remote.git");

  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  const reported = await reportedTransaction(t, fixture);

  if (reported === null) {
    return;
  }

  const { publishWorkflow } =
    await import("../../src/committing-to-git/workflow/publishWorkflow.js");
  const readOperations = [];
  const result = await publishWorkflow({
    transactionPath: reported.transactionPath,
    remote: "origin",
    destination: "refs/heads/review",
    readOnlyRunner(root, operation, args = [], options = {}) {
      readOperations.push(operation);
      return runReadOnlyGit(root, operation, args, options);
    },
  });

  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.publicationState, "succeeded");
  assert.equal(result.report.publication.status, "succeeded");
  assert.deepEqual(readOperations, ["remote-names", "check-ref-format"]);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 80 * 1024);
  const transaction = readTransaction(reported.transactionPath);

  assert.equal(transaction.phase, "published");
  assert.equal(transaction.publicationAttempts.length, 1);
  assert.equal(transaction.publicationAttempts[0].launchState, "completed");
  assert.equal(transaction.publicationAttempts[0].status, "succeeded");
  assert.equal(
    git(["rev-parse", "refs/heads/review"], remote).stdout.trim(),
    reported.commitOid,
  );
});

test("public workflow publish emits one bounded JSON result", async (t) => {
  const fixture = createRepositoryFixture(t, "workflow-publication-cli-");
  const remote = join(fixture.base, "remote.git");

  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  const reported = await reportedTransaction(t, fixture);

  if (reported === null) {
    return;
  }

  const result = runCommitWorkflow(
    "workflow publish",
    [
      "--transaction",
      reported.transactionPath,
      "--remote",
      "origin",
      "--destination",
      "refs/heads/review",
    ],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(Buffer.byteLength(result.stdout) <= 80 * 1024 + 1);
  assert.equal(result.stdout.trim().split(/\r?\n/u).length, 1);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.publicationState, "succeeded");
  assert.equal(parsed.exitCode, 0);
  assert.equal(
    git(["rev-parse", "refs/heads/review"], remote).stdout.trim(),
    reported.commitOid,
  );
});

test("unknown publication observes once, requires resolution, and links one fresh retry", async (t) => {
  const fixture = createRepositoryFixture(t, "workflow-publication-recovery-");
  const remote = join(fixture.base, "remote.git");

  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  const reported = await reportedTransaction(t, fixture);

  if (reported === null) {
    return;
  }

  const {
    observePublicationDestination,
    publishWorkflow,
    recoverPublicationOutcome,
  } = await import("../../src/committing-to-git/workflow/publishWorkflow.js");
  const unknown = await publishWorkflow({
    transactionPath: reported.transactionPath,
    remote: "origin",
    destination: "refs/heads/review",
    failureInjector(point) {
      if (point === "after-launching-before-spawn") {
        throw new Error("injected publication interruption");
      }
    },
  });

  assert.equal(unknown.exitCode, 4);
  assert.equal(unknown.publicationState, "unknown");
  const attemptId = unknown.publication.attemptId;
  let remoteObservations = 0;
  const remoteObserver = (...args) => {
    remoteObservations += 1;
    return observePublicationDestination(...args);
  };
  const beforeInvalidResolution = readTransaction(reported.transactionPath);

  await assert.rejects(
    recoverPublicationOutcome({
      transactionPath: reported.transactionPath,
      resolution: "retry-now",
      remoteObserver,
    }),
    (error) => error.code === "PUBLICATION_RESOLUTION_INVALID",
  );
  assert.deepEqual(
    readTransaction(reported.transactionPath),
    beforeInvalidResolution,
  );
  assert.equal(remoteObservations, 0);
  const firstObservation = await recoverPublicationOutcome({
    transactionPath: reported.transactionPath,
    remoteObserver,
  });
  const repeatedObservation = await recoverPublicationOutcome({
    transactionPath: reported.transactionPath,
    remoteObserver,
  });

  assert.equal(firstObservation.exitCode, 4);
  assert.equal(firstObservation.publication.observation.status, "absent");
  assert.deepEqual(
    repeatedObservation.publication.observation,
    firstObservation.publication.observation,
  );
  assert.equal(remoteObservations, 1);
  const resolved = await recoverPublicationOutcome({
    transactionPath: reported.transactionPath,
    resolution: "confirmed-no-live-child",
    remoteObserver,
  });

  assert.equal(resolved.exitCode, 4);
  assert.equal(resolved.publication.retryPermitted, true);
  assert.equal(remoteObservations, 1);
  const retried = await publishWorkflow({
    transactionPath: reported.transactionPath,
    remote: "origin",
    destination: "refs/heads/review",
    retryAfterAttempt: attemptId,
  });

  assert.equal(retried.exitCode, 0, JSON.stringify(retried));
  assert.equal(retried.publication.retryOf, attemptId);
  assert.notEqual(retried.publication.attemptId, attemptId);
  assert.equal(
    git(["rev-parse", "refs/heads/review"], remote).stdout.trim(),
    reported.commitOid,
  );

  await assert.rejects(
    publishWorkflow({
      transactionPath: reported.transactionPath,
      remote: "origin",
      destination: "refs/heads/review",
      retryAfterAttempt: attemptId,
    }),
    (error) =>
      error.code === "PUBLICATION_RETRY_NOT_PERMITTED" && error.exitCode === 4,
  );
});

test("known server rejection returns to reported without changing the remote ref", async (t) => {
  const fixture = createRepositoryFixture(t, "workflow-publication-rejected-");
  const remote = join(fixture.base, "remote.git");

  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  const reported = await reportedTransaction(t, fixture);

  if (reported === null) {
    return;
  }

  const treeOid = git(
    ["rev-parse", `${reported.commitOid}^{tree}`],
    fixture.repo,
  ).stdout.trim();
  const divergentOid = git(["commit-tree", treeOid], fixture.repo, {
    input: "divergent remote history\n",
  }).stdout.trim();

  git(
    ["push", "--force", "--", "origin", `${divergentOid}:refs/heads/review`],
    fixture.repo,
  );
  const { publishWorkflow } =
    await import("../../src/committing-to-git/workflow/publishWorkflow.js");
  const result = await publishWorkflow({
    transactionPath: reported.transactionPath,
    remote: "origin",
    destination: "refs/heads/review",
  });

  assert.equal(result.exitCode, 1, JSON.stringify(result));
  assert.equal(result.publicationState, "rejected");
  assert.equal(result.phase, "reported");
  assert.match(result.displayText, /rejected/u);
  assert.match(result.displayText, /no successful push was recorded/u);
  assert.equal(
    git(["rev-parse", "refs/heads/review"], remote).stdout.trim(),
    divergentOid,
  );
  const transaction = readTransaction(reported.transactionPath);

  assert.equal(transaction.publicationAttempts.at(-1).status, "rejected");
  assert.equal(
    transaction.publicationAttempts.at(-1).completion.outcome,
    "known-rejection",
  );
});

test("transport failure remains unknown and never launches an automatic retry", async (t) => {
  const fixture = createRepositoryFixture(t, "workflow-publication-transport-");
  const missingRemote = join(fixture.base, "missing-remote.git");

  git(["remote", "add", "origin", missingRemote], fixture.repo);
  const reported = await reportedTransaction(t, fixture);

  if (reported === null) {
    return;
  }

  const { publishWorkflow } =
    await import("../../src/committing-to-git/workflow/publishWorkflow.js");
  const result = await publishWorkflow({
    transactionPath: reported.transactionPath,
    remote: "origin",
    destination: "refs/heads/review",
  });

  assert.equal(result.exitCode, 4, JSON.stringify(result));
  assert.equal(result.publicationState, "unknown");
  assert.equal(result.phase, "publication-pending");
  const transaction = readTransaction(reported.transactionPath);

  assert.equal(transaction.publicationAttempts.length, 1);
  assert.equal(transaction.publicationAttempts[0].status, "unknown");
  assert.equal(
    transaction.publicationAttempts[0].completion.outcome,
    "unknown",
  );
});

test("publication rejects invalid target input before journaling an attempt", async (t) => {
  const fixture = createRepositoryFixture(t, "workflow-publication-input-");
  const remote = join(fixture.base, "remote.git");

  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  const reported = await reportedTransaction(t, fixture);

  if (reported === null) {
    return;
  }

  const { publishWorkflow } =
    await import("../../src/committing-to-git/workflow/publishWorkflow.js");

  await assert.rejects(
    publishWorkflow({
      transactionPath: reported.transactionPath,
      remote: "--force",
      destination: "refs/heads/review",
    }),
    (error) => error.exitCode === 2,
  );
  await assert.rejects(
    publishWorkflow({
      transactionPath: reported.transactionPath,
      remote: "origin",
      destination: "review",
    }),
    (error) => error.exitCode === 2,
  );

  const transaction = readTransaction(reported.transactionPath);

  assert.equal(transaction.phase, "reported");
  assert.deepEqual(transaction.publicationAttempts, []);
  assert.notEqual(
    git(["show-ref", "--verify", "refs/heads/review"], remote, {
      allowFailure: true,
    }).status,
    0,
  );
});

test("blocked commit report exits three without journaling or pushing", async (t) => {
  const fixture = createRepositoryFixture(t, "workflow-publication-blocked-");
  const remote = join(fixture.base, "remote.git");

  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  const reported = await reportedTransaction(t, fixture);

  if (reported === null) {
    return;
  }

  const transaction = readTransaction(reported.transactionPath);

  updateTransaction(reported.transactionPath, "reported", {
    ...transaction,
    status: "commit-blocked",
    report: { ...transaction.report, publicationAllowed: false },
  });
  const { publishWorkflow } =
    await import("../../src/committing-to-git/workflow/publishWorkflow.js");

  await assert.rejects(
    publishWorkflow({
      transactionPath: reported.transactionPath,
      remote: "origin",
      destination: "refs/heads/review",
    }),
    (error) => error.code === "PUBLICATION_BLOCKED" && error.exitCode === 3,
  );

  const after = readTransaction(reported.transactionPath);

  assert.deepEqual(after.publicationAttempts, []);
  assert.notEqual(
    git(["show-ref", "--verify", "refs/heads/review"], remote, {
      allowFailure: true,
    }).status,
    0,
  );
});

test("durable not-started publication recovers without a remote observation", async (t) => {
  const fixture = createRepositoryFixture(
    t,
    "workflow-publication-not-started-",
  );
  const remote = join(fixture.base, "remote.git");

  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  const reported = await reportedTransaction(t, fixture);

  if (reported === null) {
    return;
  }

  const transaction = readTransaction(reported.transactionPath);
  const attempt = journaledPublicationAttempt(transaction);

  advanceTransaction(reported.transactionPath, "reported", {
    ...transaction,
    phase: "publication-pending",
    status: "outcome-unknown",
    terminalDisposition: null,
    publicationAttempts: [attempt],
  });
  const { recoverPublicationOutcome } =
    await import("../../src/committing-to-git/workflow/publishWorkflow.js");
  let remoteCalls = 0;
  const result = await recoverPublicationOutcome({
    transactionPath: reported.transactionPath,
    remoteObserver() {
      remoteCalls += 1;
      throw new Error("remote observer must not run");
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.publicationState, "rejected");
  assert.equal(remoteCalls, 0);
  assert.equal(readTransaction(reported.transactionPath).phase, "reported");
});

test("matching remote recovery is distinct from a witnessed helper push", async (t) => {
  const fixture = createRepositoryFixture(t, "workflow-publication-observed-");
  const remote = join(fixture.base, "remote.git");

  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  const reported = await reportedTransaction(t, fixture);

  if (reported === null) {
    return;
  }

  const { publishWorkflow, recoverPublicationOutcome } =
    await import("../../src/committing-to-git/workflow/publishWorkflow.js");
  const unknown = await publishWorkflow({
    transactionPath: reported.transactionPath,
    remote: "origin",
    destination: "refs/heads/review",
    failureInjector(point) {
      if (point === "after-launching-before-spawn") {
        throw new Error("injected publication interruption");
      }
    },
  });

  assert.equal(unknown.exitCode, 4);
  git(
    [
      "push",
      "--porcelain",
      "--",
      "origin",
      `${reported.commitOid}:refs/heads/review`,
    ],
    fixture.repo,
  );
  const recovered = await recoverPublicationOutcome({
    transactionPath: reported.transactionPath,
  });

  assert.equal(recovered.exitCode, 0);
  assert.equal(recovered.publicationState, "observed-matching");
  assert.equal(recovered.publication.status, "observed-matching");
  assert.match(recovered.displayText, /was observed at/u);
  assert.match(recovered.displayText, /actor and attempt remain unproven/u);
  assert.doesNotMatch(recovered.displayText, /helper pushed/u);
  const transaction = readTransaction(reported.transactionPath);

  assert.equal(transaction.phase, "published");
  assert.equal(transaction.status, "recovered");
});

test("live-child evidence blocks resolution and unresolved retry", async (t) => {
  const fixture = createRepositoryFixture(
    t,
    "workflow-publication-live-child-",
  );
  const remote = join(fixture.base, "remote.git");

  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  const reported = await reportedTransaction(t, fixture);

  if (reported === null) {
    return;
  }

  const { publishWorkflow, recoverPublicationOutcome } =
    await import("../../src/committing-to-git/workflow/publishWorkflow.js");
  const unknown = await publishWorkflow({
    transactionPath: reported.transactionPath,
    remote: "origin",
    destination: "refs/heads/review",
    failureInjector(point) {
      if (point === "after-launching-before-spawn") {
        throw new Error("injected publication interruption");
      }
    },
  });

  await assert.rejects(
    publishWorkflow({
      transactionPath: reported.transactionPath,
      remote: "origin",
      destination: "refs/heads/review",
      retryAfterAttempt: unknown.publication.attemptId,
    }),
    (error) => error.code === "PUBLICATION_RETRY_NOT_PERMITTED",
  );

  const transaction = readTransaction(reported.transactionPath);
  const latestIndex = transaction.publicationAttempts.length - 1;
  const attempts = transaction.publicationAttempts.map((attempt, index) =>
    index === latestIndex
      ? {
          ...attempt,
          childIdentity: { pid: 4242, startIdentity: "recorded-start" },
        }
      : attempt,
  );

  updateTransaction(reported.transactionPath, "publication-pending", {
    ...transaction,
    publicationAttempts: attempts,
  });

  await assert.rejects(
    recoverPublicationOutcome({
      transactionPath: reported.transactionPath,
      resolution: "confirmed-no-live-child",
      processInspector: {
        exists: () => true,
        startIdentity: () => "recorded-start",
      },
      indexLockInspector: () => false,
    }),
    (error) =>
      error.code === "PUBLICATION_RESOLUTION_CONTRADICTED" &&
      error.exitCode === 4,
  );
});
