import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";

import assert from "node:assert/strict";
import test from "node:test";

import { canUseDirectSubjectTransport } from "../../src/committing-to-git/message/approvedMessage.js";
import { checkMessageWorkflow } from "../../src/committing-to-git/workflow/checkMessageWorkflow.js";
import {
  readTransaction,
  updateTransaction,
} from "../../src/committing-to-git/transaction/transactionWorkspace.js";
import {
  parsePrepareArguments,
  prepareWorkflow,
} from "../../src/committing-to-git/workflow/prepareWorkflow.js";

import {
  commitAll,
  createRepositoryFixture,
  git,
  readGitTraceArguments,
  runCommitWorkflow,
  writeRepositoryFile,
} from "./harness.mjs";

function configureSshSigning(t, fixture) {
  const keyPath = join(fixture.scratch, "signing-key");
  const generated = spawnSync(
    "ssh-keygen",
    ["-q", "-t", "ed25519", "-N", "", "-f", keyPath],
    { cwd: fixture.repo, encoding: "utf8", windowsHide: true },
  );

  if (generated.status !== 0) {
    t.skip(`ssh-keygen is unavailable: ${generated.stderr || generated.error}`);
    return false;
  }

  git(["config", "gpg.format", "ssh"], fixture.repo);
  git(["config", "user.signingkey", keyPath], fixture.repo);
  return true;
}

async function prepareConcise(
  fixture,
  { mode = "actual", verification = "skipped" } = {},
) {
  const options = parsePrepareArguments([
    "--mode",
    mode,
    "--scope",
    "full",
    "--evidence",
    "message",
    "--basis",
    "authored-current-task",
    "--verification",
    verification,
  ]);

  return prepareWorkflow({
    options,
    cwd: fixture.repo,
    temporaryRoot: fixture.scratch,
  });
}

async function createLaunchingUnknown(fixture) {
  const prepared = await prepareConcise(fixture);
  const { createCommitWorkflow } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");

  await createCommitWorkflow({
    transactionPath: prepared.transaction,
    approvedSubject: "test(core): Preserve unknown child state",
    failureInjector(point) {
      if (point === "after-launching-before-spawn") {
        throw new Error("leave launching journal");
      }
    },
  });
  return prepared.transaction;
}

test("required SSH trust preflight stops before transaction allocation", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-preflight-required-");
  const missingTrustStore = join(fixture.scratch, "missing-allowed-signers");

  git(["config", "gpg.format", "ssh"], fixture.repo);
  git(
    ["config", "gpg.ssh.allowedSignersFile", missingTrustStore],
    fixture.repo,
  );
  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");

  await assert.rejects(
    prepareConcise(fixture, { verification: "required" }),
    (error) =>
      error.code === "SIGNATURE_TRUST_ACCESS_REQUIRED" && error.exitCode === 1,
  );
  assert.deepEqual(readdirSync(fixture.scratch), []);
});

test("advisory preflight records an unreadable trust store while draft defers it", async (t) => {
  const actual = createRepositoryFixture(t, "commit-preflight-advisory-");
  const missingTrustStore = join(actual.scratch, "missing-allowed-signers");

  git(["config", "gpg.format", "ssh"], actual.repo);
  git(["config", "gpg.ssh.allowedSignersFile", missingTrustStore], actual.repo);
  writeRepositoryFile(actual.repo, "feature.txt", "feature\n");
  const prepared = await prepareConcise(actual, { verification: "advisory" });

  assert.deepEqual(readTransaction(prepared.transaction).signaturePreflight, {
    backend: "ssh",
    trustSource: {
      configured: true,
      origin: "file:.git/config",
      path: missingTrustStore,
      readable: false,
    },
  });

  const draft = createRepositoryFixture(t, "commit-preflight-draft-");

  git(["config", "gpg.format", "ssh"], draft.repo);
  git(
    ["config", "gpg.ssh.allowedSignersFile", join(draft.scratch, "missing")],
    draft.repo,
  );
  writeRepositoryFile(draft.repo, "feature.txt", "feature\n");
  const draftPrepared = await prepareConcise(draft, {
    mode: "draft",
    verification: "required",
  });

  assert.equal(
    readTransaction(draftPrepared.transaction).signaturePreflight,
    null,
  );
});

test("a required commit-policy override preflights trust before message or Git mutation", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-preflight-override-");

  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const prepared = await prepareConcise(fixture, { verification: "skipped" });
  const { createCommitWorkflow } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");
  let launches = 0;

  await assert.rejects(
    createCommitWorkflow({
      transactionPath: prepared.transaction,
      approvedSubject: "feat(core): Preflight policy override",
      verificationPolicyOverride: "required",
      signaturePreflightInspector() {
        return {
          backend: "ssh",
          trustSource: {
            configured: true,
            origin: "file:C:/Users/example/.gitconfig",
            path: "G:/keys/allowed_signers",
            readable: false,
          },
        };
      },
      processLauncher() {
        launches += 1;
        throw new Error("Git must not launch");
      },
    }),
    (error) =>
      error.code === "SIGNATURE_TRUST_ACCESS_REQUIRED" && error.exitCode === 1,
  );

  const transaction = readTransaction(prepared.transaction);

  assert.equal(launches, 0);
  assert.equal(transaction.phase, "evidence-ready");
  assert.equal(transaction.message, null);
  assert.equal(transaction.commit, null);
  assert.equal(transaction.signaturePreflight.backend, "ssh");
  assert.equal(transaction.signaturePreflight.trustSource.readable, false);
});

function rawCommitMessage(repo, oid) {
  const raw = git(["cat-file", "commit", oid], repo).stdout;
  return raw.slice(raw.indexOf("\n\n") + 2);
}

test("direct subject transport exclusions remain checked-file boundaries", () => {
  const accepted = "feat(core): Add journal recovery";

  assert.equal(canUseDirectSubjectTransport(accepted), true);

  for (const excluded of [
    "feat(core): Add 'quoted' recovery",
    'feat(core): Add "quoted" recovery',
    "feat(core): Add recovery!",
    "feat(core): Add recovery?",
    "feat(core): Add recovery; safely",
    "feat(core): Add recovery = safely",
    "feat(core): Add recovery @ launch",
    "feat(core): Add recovery # facts",
    "feat(core): Add recovery $ facts",
    "feat(core): Add recovery % facts",
    "feat(core): Add recovery & facts",
    "feat(core): Add recovery * facts",
    "feat(core): Add recovery [facts]",
    "feat(core): Add recovery {facts}",
    "feat(core): Add recovery <facts>",
    "feat(core): Add recovery \\ facts",
    "feat(core): Add recovery | facts",
    "feat(core): Add recovery ~ facts",
    "feat(core): Add recovery `facts`",
    "feat(core): Add recovery ^ facts",
    "feat(core): Add recovery for cafe\u0301",
    "feat(core): Add recovery\n\nBody",
  ]) {
    assert.equal(canUseDirectSubjectTransport(excluded), false, excluded);
  }
});

test("launching without a durable child outcome stays unknown until explicit resolution", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-launching-recovery-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const prepared = await prepareConcise(fixture);
  const { createCommitWorkflow } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");
  const { recoverTransactionWorkflow } =
    await import("../../src/committing-to-git/workflow/recoverTransactionWorkflow.js");
  const interrupted = await createCommitWorkflow({
    transactionPath: prepared.transaction,
    approvedSubject: "feat(core): Add launch recovery",
    failureInjector(point) {
      if (point === "after-launching-before-spawn") {
        throw new Error("injected launching crash");
      }
    },
  });

  assert.equal(interrupted.exitCode, 4);
  assert.equal(interrupted.status, "outcome-unknown");
  assert.equal(
    readTransaction(prepared.transaction).commit.launchState,
    "launching",
  );
  const { purgeTransaction } =
    await import("../../src/committing-to-git/transaction/transactionRecovery.js");

  assert.throws(
    () => purgeTransaction({ transactionPath: prepared.transaction }),
    /pending or unknown/u,
  );

  const unresolved = await recoverTransactionWorkflow({
    transactionPath: prepared.transaction,
  });

  assert.equal(unresolved.exitCode, 4);
  assert.equal(unresolved.status, "outcome-unknown");

  const resolved = await recoverTransactionWorkflow({
    transactionPath: prepared.transaction,
    resolution: "confirmed-no-live-child",
  });

  assert.equal(resolved.exitCode, 1);
  assert.equal(resolved.status, "stopped");
  assert.equal(readTransaction(prepared.transaction).phase, "stopped");
  assert.equal(
    git(["rev-parse", "--verify", "HEAD"], fixture.repo).stdout.trim(),
    readTransaction(prepared.transaction).headAnchor.expectedParentOids[0],
  );
});

test("recovery adopts a matching signed child commit without invoking commit twice", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-adopt-recovery-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);

  if (!configureSshSigning(t, fixture)) {
    return;
  }

  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const prepared = await prepareConcise(fixture);
  const { createCommitWorkflow } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");
  const { recoverTransactionWorkflow } =
    await import("../../src/committing-to-git/workflow/recoverTransactionWorkflow.js");
  let launches = 0;
  const result = await createCommitWorkflow({
    transactionPath: prepared.transaction,
    approvedSubject: "feat(core): Add journal recovery",
    processLauncher(command, args, options) {
      launches += 1;
      assert.equal(command, "git");
      assert.deepEqual(args.slice(0, 4), [
        "commit",
        "--cleanup=verbatim",
        "-S",
        "-F",
      ]);
      assert.equal(args.length, 5);
      assert.deepEqual(options.stdio, ["inherit", "pipe", "pipe"]);
      assert.equal(Object.hasOwn(options, "timeout"), false);
      return spawn(command, args, options);
    },
    failureInjector(point) {
      if (point === "after-head-update-before-oid") {
        throw new Error("injected crash after ref update");
      }
    },
  });

  assert.equal(result.exitCode, 3, JSON.stringify(result));
  assert.equal(result.commitState, "created");
  assert.equal(launches, 1);

  const repeatedRecovery = await recoverTransactionWorkflow({
    transactionPath: prepared.transaction,
  });

  assert.equal(repeatedRecovery.exitCode, 0);
  assert.equal(repeatedRecovery.report.commit.treeMatches, true);
  assert.equal(repeatedRecovery.report.commit.messageMatches, true);
  assert.equal(repeatedRecovery.report.commit.parentMatches, true);
  assert.equal(repeatedRecovery.report.commit.signed, true);
  assert.equal(
    rawCommitMessage(fixture.repo, repeatedRecovery.commitOid),
    "feat(core): Add journal recovery\n",
  );
  assert.equal(launches, 1);

  const terminalRecovery = await recoverTransactionWorkflow({
    transactionPath: prepared.transaction,
  });

  assert.equal(terminalRecovery.exitCode, 0);
  assert.equal(terminalRecovery.commitOid, repeatedRecovery.commitOid);
});

test("direct input is rejected before mutation when checked transport is required", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-message-source-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const baseline = git(
    ["rev-parse", "--verify", "HEAD"],
    fixture.repo,
  ).stdout.trim();
  const prepared = await prepareConcise(fixture);
  const { createCommitWorkflow, CommitWorkflowError } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");

  await assert.rejects(
    createCommitWorkflow({
      transactionPath: prepared.transaction,
      approvedSubject: "feat(core): Add Unicode recovery é",
    }),
    (error) =>
      error instanceof CommitWorkflowError &&
      error.code === "MESSAGE_REQUIRES_CHECKED_FILE" &&
      error.exitCode === 2,
  );
  assert.equal(readTransaction(prepared.transaction).phase, "evidence-ready");
  assert.equal(
    git(["rev-parse", "--verify", "HEAD"], fixture.repo).stdout.trim(),
    baseline,
  );
});

test("checked multiline nonportable bytes commit exactly and reject a later direct override", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-checked-message-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);

  if (!configureSshSigning(t, fixture)) {
    return;
  }

  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const prepared = await prepareConcise(fixture);
  const message = [
    "feat(core): Add checked recovery",
    "",
    "Rationale:",
    "  - Preserve user's approved bytes",
    "",
  ].join("\n");

  writeFileSync(
    join(dirname(prepared.transaction), "message-input.txt"),
    message,
  );
  const checked = checkMessageWorkflow({
    transactionPath: prepared.transaction,
  });

  assert.equal(checked.exitCode, undefined);
  const { createCommitWorkflow, CommitWorkflowError } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");

  await assert.rejects(
    createCommitWorkflow({
      transactionPath: prepared.transaction,
      approvedSubject: "feat(core): Replace approved bytes",
    }),
    (error) =>
      error instanceof CommitWorkflowError &&
      error.code === "MESSAGE_ALREADY_RECORDED",
  );
  const result = await createCommitWorkflow({
    transactionPath: prepared.transaction,
  });

  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(rawCommitMessage(fixture.repo, result.commitOid), message);
});

for (const headKind of ["detached", "unborn"]) {
  test(`signed commit creation preserves the exact ${headKind} parent shape`, async (t) => {
    const fixture = createRepositoryFixture(t, `commit-${headKind}-`);

    if (headKind === "detached") {
      writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
      commitAll(fixture.repo);
      git(["switch", "--detach", "--quiet"], fixture.repo);
    }

    if (!configureSshSigning(t, fixture)) {
      return;
    }

    writeRepositoryFile(fixture.repo, "feature.txt", `${headKind}\n`);
    const prepared = await prepareConcise(fixture);
    const anchor = readTransaction(prepared.transaction).headAnchor;
    const { createCommitWorkflow } =
      await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");
    let verifierCalls = 0;
    const result = await createCommitWorkflow({
      transactionPath: prepared.transaction,
      approvedSubject: `feat(core): Add ${headKind} recovery`,
      signatureVerifier() {
        verifierCalls += 1;
        throw new Error("skipped policy must not invoke verification");
      },
    });

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(
      git(["show", "-s", "--format=%P", result.commitOid], fixture.repo)
        .stdout.trim()
        .split(" ")
        .filter(Boolean),
      anchor.expectedParentOids,
    );
    assert.equal(result.report.commit.signed, true);
    assert.equal(verifierCalls, 0);
  });
}

test("SHA-256 repositories retain full opaque commit and parent IDs when supported", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "commit-sha256-"));
  const fixture = {
    base,
    repo: join(base, "repo"),
    scratch: join(base, "scratch"),
  };

  mkdirSync(fixture.repo);
  mkdirSync(fixture.scratch);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const initialized = git(
    ["init", "--quiet", "--object-format=sha256", "-b", "main"],
    fixture.repo,
    { allowFailure: true },
  );

  if (initialized.status !== 0) {
    t.skip("Installed Git does not support SHA-256 repositories.");
    return;
  }

  git(["config", "user.email", "tests@example.invalid"], fixture.repo);
  git(["config", "user.name", "Committing To Git Tests"], fixture.repo);
  git(["config", "commit.gpgsign", "false"], fixture.repo);
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);

  if (!configureSshSigning(t, fixture)) {
    return;
  }

  writeRepositoryFile(fixture.repo, "feature.txt", "sha256\n");
  const prepared = await prepareConcise(fixture);
  const transaction = readTransaction(prepared.transaction);
  const { createCommitWorkflow } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");
  const result = await createCommitWorkflow({
    transactionPath: prepared.transaction,
    approvedSubject: "test(core): Preserve opaque object IDs",
  });

  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.commitOid.length, 64);
  assert.equal(transaction.headAnchor.expectedParentOids[0].length, 64);
  assert.equal(result.report.commit.treeOid.length, 64);
  assert.ok(
    result.report.commit.signatureHeaders.some((header) =>
      new Set(["gpgsig", "gpgsig-sha256"]).has(header),
    ),
  );
});

test("a commit without a signature header is recorded but cannot be published", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-unsigned-block-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "feature.txt", "unsigned\n");
  const prepared = await prepareConcise(fixture);
  const { createCommitWorkflow } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");
  const result = await createCommitWorkflow({
    transactionPath: prepared.transaction,
    approvedSubject: "feat(core): Detect unsigned commits",
    processLauncher(command, args, options) {
      return spawn(
        command,
        args.filter((argument) => argument !== "-S"),
        options,
      );
    },
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.report.commit.signed, false);
  assert.equal(result.publicationAllowed, false);
  assert.equal(readTransaction(prepared.transaction).phase, "reported");
});

test("hook-produced message bytes are reported exactly without normalization", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-hook-message-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);

  if (!configureSshSigning(t, fixture)) {
    return;
  }

  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const hookPath = join(fixture.repo, ".git", "hooks", "commit-msg");

  writeFileSync(
    hookPath,
    '#!/bin/sh\nprintf "\\nHook changed the message\\n" >> "$1"\n',
  );
  chmodSync(hookPath, 0o755);
  const prepared = await prepareConcise(fixture);
  const { createCommitWorkflow } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");
  const result = await createCommitWorkflow({
    transactionPath: prepared.transaction,
    approvedSubject: "test(core): Detect hook message changes",
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.report.commit.messageMatches, false);
  assert.equal(result.report.commit.signed, true);
  assert.equal(
    rawCommitMessage(fixture.repo, result.commitOid),
    "test(core): Detect hook message changes\n\nHook changed the message\n",
  );
});

test("checks input is copied once into the journal and remains caller-owned", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-checks-input-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);

  if (!configureSshSigning(t, fixture)) {
    return;
  }

  writeRepositoryFile(fixture.repo, "feature.txt", "checked\n");
  const checksPath = join(fixture.scratch, "checks.json");
  const checks = {
    schemaVersion: 1,
    checks: [
      {
        label: "Focused tests",
        status: "passed",
        context: "approved staged snapshot",
      },
    ],
  };

  writeFileSync(checksPath, `${JSON.stringify(checks)}\n`);
  const prepared = await prepareConcise(fixture);
  const { createCommitWorkflow } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");
  const result = await createCommitWorkflow({
    transactionPath: prepared.transaction,
    approvedSubject: "test(core): Record approved checks",
    checksPath,
  });

  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.deepEqual(result.report.checks, checks);
  assert.equal(existsSync(checksPath), true);
  assert.deepEqual(
    readTransaction(prepared.transaction).commit.checks.value,
    checks,
  );
});

test("checks input rejects path replacement and the 1 MiB boundary without taking ownership", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-checks-race-");
  const checksPath = join(fixture.scratch, "checks.json");
  const openedPath = join(fixture.scratch, "opened-checks.json");
  const valid = `${JSON.stringify({ schemaVersion: 1, checks: [] })}\n`;

  writeFileSync(checksPath, valid);
  const {
    CommitWorkflowError,
    MAXIMUM_CHECKS_INPUT_BYTES,
    readChecksArtifact,
  } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");

  assert.throws(
    () =>
      readChecksArtifact(checksPath, {
        afterOpen() {
          renameSync(checksPath, openedPath);
          writeFileSync(checksPath, valid);
        },
      }),
    (error) =>
      error instanceof CommitWorkflowError &&
      error.code === "CHECKS_INPUT_CHANGED",
  );
  assert.equal(existsSync(checksPath), true);
  assert.equal(existsSync(openedPath), true);

  const oversized = join(fixture.scratch, "oversized-checks.json");

  writeFileSync(oversized, Buffer.alloc(MAXIMUM_CHECKS_INPUT_BYTES + 1, 0x20));
  assert.throws(
    () => readChecksArtifact(oversized),
    (error) =>
      error instanceof CommitWorkflowError &&
      error.code === "CHECKS_INPUT_TOO_LARGE",
  );
  assert.equal(existsSync(oversized), true);
});

test("verification retry appends history for the recorded OID without recreating or repeating statistics", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-verification-retry-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);

  if (!configureSshSigning(t, fixture)) {
    return;
  }

  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const prepared = await prepareConcise(fixture);
  const { createCommitWorkflow, retrySignatureVerificationWorkflow } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");
  const committed = await createCommitWorkflow({
    transactionPath: prepared.transaction,
    approvedSubject: "test(core): Retry exact commit verification",
  });
  const countBefore = git(
    ["rev-list", "--count", "HEAD"],
    fixture.repo,
  ).stdout.trim();
  const retried = retrySignatureVerificationWorkflow({
    transactionPath: prepared.transaction,
    verificationPolicyOverride: "required",
    signatureVerifier(_root, commitOid) {
      return {
        commitOid,
        status: "verified",
        reason: null,
        backend: "ssh",
        identity: {
          principal: "tests@example.invalid",
          keyFingerprint: "SHA256:test-fixture",
        },
        timestamp: "2026-08-23T12:02:00.000Z",
      };
    },
  });

  assert.equal(retried.exitCode, 0);
  assert.equal(retried.commitOid, committed.commitOid);
  assert.equal(retried.verification.attempts.length, 2);
  assert.equal(Object.hasOwn(retried, "report"), false);
  assert.equal(
    git(["rev-list", "--count", "HEAD"], fixture.repo).stdout.trim(),
    countBefore,
  );
});

test("public commit and recovery commands keep stdout to one bounded JSON result", (t) => {
  const fixture = createRepositoryFixture(t, "commit-public-cli-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);

  if (!configureSshSigning(t, fixture)) {
    return;
  }

  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
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
    ],
    fixture.repo,
    { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
  );

  assert.equal(prepared.status, 0, prepared.stderr);
  const preparation = JSON.parse(prepared.stdout);
  const commitTrace = join(fixture.scratch, "commit-trace.json");
  const committed = runCommitWorkflow(
    "workflow commit",
    [
      "--transaction",
      preparation.transaction,
      "--message",
      "feat(core): Expose journaled commit command",
    ],
    fixture.repo,
    { env: { GIT_TRACE2_EVENT: commitTrace } },
  );

  assert.equal(committed.status, 0, committed.stderr);
  assert.ok(Buffer.byteLength(committed.stdout) <= 80 * 1024);
  const result = JSON.parse(committed.stdout);

  assert.equal(result.commitState, "created");
  assert.equal(result.publicationAllowed, true);
  assert.equal(
    readGitTraceArguments(commitTrace).filter(
      (args) => args.includes("commit") && args.includes("--cleanup=verbatim"),
    ).length,
    1,
  );

  const recoveryTrace = join(fixture.scratch, "recovery-trace.json");
  const recovered = runCommitWorkflow(
    "workflow recover",
    ["--transaction", preparation.transaction],
    fixture.repo,
    { env: { GIT_TRACE2_EVENT: recoveryTrace } },
  );

  assert.equal(recovered.status, 0, recovered.stderr);
  assert.doesNotThrow(() => JSON.parse(recovered.stdout));
  assert.equal(
    existsSync(recoveryTrace) &&
      readGitTraceArguments(recoveryTrace).some((args) =>
        args.includes("commit"),
      ),
    false,
  );
});

test("cleanup rejects active compaction and purge stays confined to one exact UUID attempt", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-cleanup-purge-");
  const sentinel = join(fixture.scratch, "keep-me.txt");

  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  writeFileSync(sentinel, "keep\n");
  const prepared = await prepareConcise(fixture);
  const { compactTerminalTransaction, purgeTransaction } =
    await import("../../src/committing-to-git/transaction/transactionRecovery.js");

  assert.throws(
    () => compactTerminalTransaction({ transactionPath: prepared.transaction }),
    /active|pending|unknown/u,
  );
  const attempt = dirname(prepared.transaction);
  const result = purgeTransaction({ transactionPath: prepared.transaction });

  assert.equal(result.status, "purged");
  assert.equal(result.formerPath, attempt);
  assert.match(result.finalCapsuleSha256, /^[0-9a-f]{64}$/u);
  assert.equal(existsSync(attempt), false);
  assert.equal(existsSync(sentinel), true);
});

test("transaction-state lock acquisition replaces only a provably stale owner", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-state-lock-stale-");

  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const prepared = await prepareConcise(fixture);
  const lockPath = join(
    dirname(prepared.transaction),
    "transaction-state.lock",
  );

  writeFileSync(
    lockPath,
    `${JSON.stringify({
      schemaVersion: 1,
      token: "stale",
      operation: "report-detail",
      pid: 2_147_483_647,
      startIdentity: "stale-start",
    })}\n`,
  );
  const { acquireTransactionStateLock, releaseTransactionStateLock } =
    await import("../../src/committing-to-git/transaction/transactionRecovery.js");
  const lock = acquireTransactionStateLock({
    transactionPath: prepared.transaction,
    operation: "cleanup",
  });

  assert.notEqual(lock.token, "stale");
  releaseTransactionStateLock(lock);
  assert.equal(existsSync(lockPath), false);
});

test("purge rejects a link replacement without touching its external target", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-cleanup-link-");
  const external = join(fixture.scratch, "external.txt");

  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  writeFileSync(external, "external\n");
  const prepared = await prepareConcise(fixture);
  const replacement = join(dirname(prepared.transaction), "message-input.txt");

  try {
    symlinkSync(external, replacement, "file");
  } catch (error) {
    t.skip(`File symlinks are unavailable: ${error.message}`);
    return;
  }

  const { purgeTransaction } =
    await import("../../src/committing-to-git/transaction/transactionRecovery.js");

  assert.throws(
    () => purgeTransaction({ transactionPath: prepared.transaction }),
    /link|reparse/u,
  );
  assert.equal(existsSync(external), true);
  assert.equal(existsSync(dirname(prepared.transaction)), true);
});

test("terminal compaction retries Windows-style lock failures and is idempotent", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-cleanup-retry-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const prepared = await prepareConcise(fixture);
  const { createCommitWorkflow } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");
  const { recoverTransactionWorkflow } =
    await import("../../src/committing-to-git/workflow/recoverTransactionWorkflow.js");
  const { compactTerminalTransaction } =
    await import("../../src/committing-to-git/transaction/transactionRecovery.js");

  await createCommitWorkflow({
    transactionPath: prepared.transaction,
    approvedSubject: "test(core): Exercise cleanup retry",
    failureInjector(point) {
      if (point === "after-launching-before-spawn") {
        throw new Error("stop before spawn");
      }
    },
  });
  await recoverTransactionWorkflow({
    transactionPath: prepared.transaction,
    resolution: "confirmed-no-live-child",
  });
  const leftover = join(dirname(prepared.transaction), "message-input.txt");

  writeFileSync(leftover, "leftover\n");
  let attempts = 0;
  const first = compactTerminalTransaction({
    transactionPath: prepared.transaction,
    removeOperation(path, options) {
      if (path !== leftover) {
        rmSync(path, options);
        return;
      }

      attempts += 1;

      if (attempts < 3) {
        const error = new Error("locked");
        error.code = "EBUSY";
        throw error;
      }

      rmSync(path, options);
    },
  });

  if (process.platform === "win32") {
    assert.equal(attempts, 3);
    assert.equal(first.failed.length, 0);
    assert.equal(existsSync(leftover), false);
  } else {
    assert.equal(attempts, 1);
    assert.equal(first.failed.length, 1);
    rmSync(leftover);
  }

  const second = compactTerminalTransaction({
    transactionPath: prepared.transaction,
  });

  assert.deepEqual(second.completed, []);
  assert.deepEqual(second.failed, []);
});

test("launcher failures distinguish proven non-launch from asynchronous unknown outcome", async (t) => {
  const synchronous = createRepositoryFixture(t, "commit-launch-sync-");

  writeRepositoryFile(synchronous.repo, "feature.txt", "feature\n");
  const synchronousPrepared = await prepareConcise(synchronous);
  const { createCommitWorkflow } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");
  const synchronousResult = await createCommitWorkflow({
    transactionPath: synchronousPrepared.transaction,
    approvedSubject: "test(core): Classify synchronous launch failure",
    processLauncher() {
      const error = new Error("launcher rejected before child creation");
      error.code = "ENOENT";
      throw error;
    },
  });

  assert.equal(synchronousResult.exitCode, 1);
  assert.equal(synchronousResult.status, "stopped");
  assert.equal(
    readTransaction(synchronousPrepared.transaction).commit.completion
      .nonLaunchGuaranteed,
    true,
  );

  const asynchronous = createRepositoryFixture(t, "commit-launch-async-");

  writeRepositoryFile(asynchronous.repo, "feature.txt", "feature\n");
  const asynchronousPrepared = await prepareConcise(asynchronous);
  const asynchronousResult = await createCommitWorkflow({
    transactionPath: asynchronousPrepared.transaction,
    approvedSubject: "test(core): Classify asynchronous launch failure",
    processLauncher() {
      const child = new EventEmitter();

      child.pid = undefined;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(() => {
        const error = new Error("spawn failed asynchronously");
        error.code = "ENOENT";
        child.emit("error", error);
        child.stdout.end();
        child.stderr.end();
        child.emit("close", null, null);
      });
      return child;
    },
  });

  assert.equal(asynchronousResult.exitCode, 4);
  assert.equal(asynchronousResult.status, "outcome-unknown");
  assert.equal(
    readTransaction(asynchronousPrepared.transaction).commit.launchState,
    "launching",
  );
});

test("a durable not-started journal classifies as a no-commit stop", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-not-started-");
  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const prepared = await prepareConcise(fixture);
  const { createCommitWorkflow } =
    await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");
  const result = await createCommitWorkflow({
    transactionPath: prepared.transaction,
    approvedSubject: "test(core): Classify durable non-launch",
    failureInjector(point) {
      if (point === "after-pending-journal-before-git") {
        throw new Error("injected before Git launch");
      }
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.status, "stopped");
  assert.equal(
    readTransaction(prepared.transaction).commit.launchState,
    "not-started",
  );
});

test("explicit resolution rejects live, reused, locked, and unstable evidence", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-resolution-guards-");
  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const transactionPath = await createLaunchingUnknown(fixture);
  const current = readTransaction(transactionPath);

  updateTransaction(transactionPath, "commit-pending", {
    ...current,
    commit: {
      ...current.commit,
      childIdentity: { pid: 4242, startIdentity: "start-a" },
    },
  });
  const { recoverCommitOutcome } =
    await import("../../src/committing-to-git/transaction/transactionRecovery.js");

  assert.throws(
    () =>
      recoverCommitOutcome({
        transactionPath,
        resolution: "confirmed-no-live-child",
        processInspector: {
          exists: () => true,
          startIdentity: () => "start-a",
        },
        indexLockInspector: () => false,
      }),
    /still live/u,
  );
  assert.throws(
    () =>
      recoverCommitOutcome({
        transactionPath,
        resolution: "confirmed-no-live-child",
        processInspector: {
          exists: () => true,
          startIdentity: () => "start-b",
        },
        indexLockInspector: () => false,
      }),
    /reused/u,
  );
  assert.throws(
    () =>
      recoverCommitOutcome({
        transactionPath,
        resolution: "confirmed-no-live-child",
        processInspector: {
          exists: () => false,
          startIdentity: () => null,
        },
        indexLockInspector: () => true,
      }),
    /index lock/u,
  );

  const baseline = current.headAnchor.expectedParentOids[0] ?? null;
  let observations = 0;
  const unstable = recoverCommitOutcome({
    transactionPath,
    resolution: "confirmed-no-live-child",
    refObserver() {
      observations += 1;
      return {
        observationPoint: current.headAnchor.targetRef ?? "HEAD",
        oid: observations === 1 ? baseline : "f".repeat(40),
        status: 0,
      };
    },
    processInspector: {
      exists: () => false,
      startIdentity: () => null,
    },
    indexLockInspector: () => false,
  });

  assert.equal(unstable.exitCode, 4);
  assert.equal(unstable.code, "COMMIT_REF_UNSTABLE");
});

for (const boundary of [
  "after-oid-before-verification",
  "during-verification",
  "during-report-writing",
  "after-report-writing-before-compaction",
]) {
  test(`commit boundary ${boundary} never relaunches Git`, async (t) => {
    const fixture = createRepositoryFixture(t, `commit-boundary-${boundary}-`);
    writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
    commitAll(fixture.repo);

    if (!configureSshSigning(t, fixture)) {
      return;
    }

    writeRepositoryFile(fixture.repo, "feature.txt", `${boundary}\n`);
    const prepared = await prepareConcise(fixture);
    const { createCommitWorkflow } =
      await import("../../src/committing-to-git/workflow/createCommitWorkflow.js");
    const { recoverTransactionWorkflow } =
      await import("../../src/committing-to-git/workflow/recoverTransactionWorkflow.js");
    let launches = 0;
    let injected = false;
    const result = await createCommitWorkflow({
      transactionPath: prepared.transaction,
      approvedSubject: "test(core): Preserve irreversible boundary",
      processLauncher(command, args, options) {
        launches += 1;
        return spawn(command, args, options);
      },
      failureInjector(point) {
        if (!injected && point === boundary) {
          injected = true;
          throw new Error(`injected ${boundary}`);
        }
      },
    });

    if (boundary === "after-report-writing-before-compaction") {
      assert.equal(result.exitCode, 0);
      assert.equal(result.cleanup.status, "warning");
    } else {
      assert.equal(result.exitCode, 3);
      const recovered = await recoverTransactionWorkflow({
        transactionPath: prepared.transaction,
      });

      assert.equal(recovered.exitCode, 0, JSON.stringify(recovered));
    }

    assert.equal(launches, 1);
  });
}
