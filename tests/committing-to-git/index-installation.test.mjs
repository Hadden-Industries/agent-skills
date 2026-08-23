import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  indexIdentitiesMatch,
  installPreparedIndex,
  readIndexIdentity,
  recoverIndexInstallation,
  resumePreparedIndexInstallation,
} from "../../src/committing-to-git/transaction/indexInstallation.js";
import { createTransactionWorkspace } from "../../src/committing-to-git/transaction/transactionWorkspace.js";
import {
  parsePrepareArguments,
  prepareWorkflow,
} from "../../src/committing-to-git/workflow/prepareWorkflow.js";
import { resumePreparationWorkflow } from "../../src/committing-to-git/workflow/resumePreparationWorkflow.js";
import {
  commitAll,
  createRepositoryFixture,
  git,
  readJson,
  writeRepositoryFile,
} from "./harness.mjs";

function gitPath(root, name) {
  const value = git(["rev-parse", "--git-path", name], root).stdout.trim();

  return isAbsolute(value) ? value : resolve(root, value);
}

function preparedFixture(t, prefix = "index-installation-") {
  const fixture = createRepositoryFixture(t, prefix);
  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");

  const workspace = createTransactionWorkspace({
    repositoryRoot: fixture.repo,
    temporaryRoot: fixture.scratch,
  });
  const indexPath = gitPath(fixture.repo, "index");
  const preparedIndexPath = join(
    workspace.attemptDirectory,
    "preparation-index",
  );
  const preparedEnvironment = {
    ...process.env,
    GIT_INDEX_FILE: preparedIndexPath,
  };

  copyFileSync(indexPath, preparedIndexPath);
  git(["add", "-A"], fixture.repo, {
    env: preparedEnvironment,
  });
  git(["write-tree"], fixture.repo, { env: preparedEnvironment });

  return {
    ...fixture,
    attemptDirectory: workspace.attemptDirectory,
    indexPath,
    preparedIndexPath,
    transactionPath: workspace.transactionPath,
    originalIndexIdentity: readIndexIdentity(indexPath),
    preparedIndexIdentity: readIndexIdentity(preparedIndexPath),
  };
}

function install(fixture, failureInjector) {
  return installPreparedIndex({
    root: fixture.repo,
    transactionPath: fixture.transactionPath,
    originalIndexIdentity: fixture.originalIndexIdentity,
    preparedIndexPath: fixture.preparedIndexPath,
    preparedIndexIdentity: fixture.preparedIndexIdentity,
    failureInjector,
  });
}

test("index identities distinguish absence and install exact prepared bytes", (t) => {
  const fixture = preparedFixture(t);
  const missingPath = join(fixture.scratch, "missing-index");

  assert.deepEqual(readIndexIdentity(missingPath), { state: "absent" });
  assert.equal(fixture.originalIndexIdentity.state, "file");
  assert.equal(fixture.preparedIndexIdentity.state, "file");
  assert.equal(
    indexIdentitiesMatch(
      fixture.originalIndexIdentity,
      fixture.preparedIndexIdentity,
    ),
    false,
  );

  const result = install(fixture);
  const installedIdentity = readIndexIdentity(fixture.indexPath);
  const journal = readJson(result.journalPath);

  assert.equal(result.status, "installed");
  assert.equal(journal.status, "installed");
  assert.equal(journal.preparedIndexTreeOid, result.preparedIndexTreeOid);
  assert.equal(
    indexIdentitiesMatch(installedIdentity, fixture.preparedIndexIdentity),
    true,
  );
  assert.deepEqual(
    readFileSync(fixture.indexPath),
    readFileSync(fixture.preparedIndexPath),
  );
  assert.equal(existsSync(`${fixture.indexPath}.lock`), false);
});

test("an absent unborn index is journaled distinctly and installed once", (t) => {
  const fixture = createRepositoryFixture(t, "index-installation-absent-");
  const workspace = createTransactionWorkspace({
    repositoryRoot: fixture.repo,
    temporaryRoot: fixture.scratch,
  });
  const indexPath = gitPath(fixture.repo, "index");
  const preparedIndexPath = join(
    workspace.attemptDirectory,
    "preparation-index",
  );
  const environment = { ...process.env, GIT_INDEX_FILE: preparedIndexPath };

  assert.deepEqual(readIndexIdentity(indexPath), { state: "absent" });
  writeRepositoryFile(fixture.repo, "first.txt", "first\n");
  git(["read-tree", "--empty"], fixture.repo, { env: environment });
  git(["add", "first.txt"], fixture.repo, { env: environment });
  git(["write-tree"], fixture.repo, { env: environment });

  const preparedIndexIdentity = readIndexIdentity(preparedIndexPath);
  const result = installPreparedIndex({
    root: fixture.repo,
    transactionPath: workspace.transactionPath,
    originalIndexIdentity: { state: "absent" },
    preparedIndexPath,
    preparedIndexIdentity,
  });

  assert.equal(result.status, "installed");
  assert.equal(
    indexIdentitiesMatch(readIndexIdentity(indexPath), preparedIndexIdentity),
    true,
  );
});

test("a pre-existing real index lock stops before journaling or mutation", (t) => {
  const fixture = preparedFixture(t, "index-installation-lock-");
  const before = readFileSync(fixture.indexPath);
  const lockPath = `${fixture.indexPath}.lock`;

  writeFileSync(lockPath, "owned elsewhere\n", { flag: "wx" });

  assert.throws(() => install(fixture), /index\.lock|index lock/iu);
  assert.deepEqual(readFileSync(fixture.indexPath), before);
  assert.equal(
    existsSync(join(fixture.attemptDirectory, "index-installation.json")),
    false,
  );
  assert.equal(readFileSync(lockPath, "utf8"), "owned elsewhere\n");
});

for (const [stage, expectedStatus] of [
  ["after-pending-journal", "not-installed"],
  ["before-lock-acquisition", "not-installed"],
  ["after-index-replacement", "matching-index-observed"],
  ["before-installed-state", "matching-index-observed"],
]) {
  test(`pending installation recovery classifies ${stage}`, (t) => {
    const fixture = preparedFixture(t, `index-installation-${stage}-`);

    assert.throws(
      () =>
        install(fixture, (currentStage) => {
          if (currentStage === stage) {
            throw new Error(`injected failure at ${stage}`);
          }
        }),
      new RegExp(`injected failure at ${stage}`, "u"),
    );

    const recovery = recoverIndexInstallation({
      root: fixture.repo,
      transactionPath: fixture.transactionPath,
    });

    assert.equal(recovery.status, expectedStatus);
    assert.equal(recovery.resumeAllowed, true);
    assert.equal(recovery.recoveryRequired, true);
    assert.equal(existsSync(`${fixture.indexPath}.lock`), false);

    if (expectedStatus === "not-installed") {
      assert.equal(
        indexIdentitiesMatch(
          readIndexIdentity(fixture.indexPath),
          fixture.originalIndexIdentity,
        ),
        true,
      );
    } else {
      assert.equal(
        indexIdentitiesMatch(
          readIndexIdentity(fixture.indexPath),
          fixture.preparedIndexIdentity,
        ),
        true,
      );
    }
  });
}

test("a third index identity is ambiguous and is never rolled back", (t) => {
  const fixture = preparedFixture(t, "index-installation-ambiguous-");

  assert.throws(() =>
    install(fixture, (stage) => {
      if (stage === "after-pending-journal") {
        throw new Error("stop after journal");
      }
    }),
  );

  writeRepositoryFile(fixture.repo, "third.txt", "third state\n");
  git(["add", "third.txt"], fixture.repo);
  const thirdIdentity = readIndexIdentity(fixture.indexPath);
  const recovery = recoverIndexInstallation({
    root: fixture.repo,
    transactionPath: fixture.transactionPath,
  });

  assert.equal(recovery.status, "ambiguous");
  assert.equal(recovery.resumeAllowed, false);
  assert.equal(recovery.recoveryRequired, true);
  assert.equal(
    indexIdentitiesMatch(readIndexIdentity(fixture.indexPath), thirdIdentity),
    true,
  );
});

test("a byte-identical replacement remains the explicit original-content state", (t) => {
  const fixture = preparedFixture(t, "index-installation-byte-identical-");
  const originalBytes = readFileSync(fixture.indexPath);

  assert.throws(() =>
    install(fixture, (stage) => {
      if (stage === "after-pending-journal") {
        throw new Error("stop before lock");
      }
    }),
  );

  writeFileSync(fixture.indexPath, originalBytes);
  const current = readIndexIdentity(fixture.indexPath);
  const recovery = recoverIndexInstallation({
    root: fixture.repo,
    transactionPath: fixture.transactionPath,
  });

  assert.equal(
    indexIdentitiesMatch(current, fixture.originalIndexIdentity),
    true,
  );
  assert.equal(recovery.status, "not-installed");
  assert.equal(
    resumePreparedIndexInstallation({
      root: fixture.repo,
      transactionPath: fixture.transactionPath,
    }).status,
    "installed",
  );
});

test("a matching pending journal prevents duplicate installation", (t) => {
  const fixture = preparedFixture(t, "index-installation-no-replay-");

  assert.throws(() =>
    install(fixture, (stage) => {
      if (stage === "after-index-replacement") {
        throw new Error("stop after replacement");
      }
    }),
  );

  let replayStage = null;
  const result = install(fixture, (stage) => {
    replayStage = stage;
  });

  assert.equal(result.status, "matching-index-observed");
  assert.equal(result.resumeAllowed, true);
  assert.equal(replayStage, null);
});

test("explicit resume completes original and already-replaced pending journals", async (t) => {
  for (const [stage, expectedBeforeResume] of [
    ["after-pending-journal", "not-installed"],
    ["after-index-replacement", "matching-index-observed"],
  ]) {
    await t.test(stage, () => {
      const fixture = preparedFixture(t, `index-resume-${stage}-`);

      assert.throws(() =>
        install(fixture, (currentStage) => {
          if (currentStage === stage) {
            throw new Error(`stop at ${stage}`);
          }
        }),
      );
      assert.equal(
        recoverIndexInstallation({
          root: fixture.repo,
          transactionPath: fixture.transactionPath,
        }).status,
        expectedBeforeResume,
      );

      const resumed = resumePreparedIndexInstallation({
        root: fixture.repo,
        transactionPath: fixture.transactionPath,
      });

      assert.equal(resumed.status, "installed");
      assert.equal(resumed.recoveryRequired, false);
      assert.equal(
        indexIdentitiesMatch(
          readIndexIdentity(fixture.indexPath),
          fixture.preparedIndexIdentity,
        ),
        true,
      );
      assert.equal(
        readJson(join(fixture.attemptDirectory, "index-installation.json"))
          .status,
        "installed",
      );
    });
  }
});

test("preparation resume consumes only the persisted snapshot and policy", (t) => {
  const fixture = createRepositoryFixture(t, "preparation-resume-");
  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");

  let interruption;

  try {
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
      ]),
      cwd: fixture.repo,
      environment: {},
      temporaryRoot: fixture.scratch,
      indexFailureInjector(stage) {
        if (stage === "after-index-replacement") {
          throw new Error("interrupt high-level preparation");
        }
      },
    });
  } catch (error) {
    interruption = error;
  }

  assert.equal(interruption?.code, "INDEX_INSTALLATION_INTERRUPTED");
  assert.equal(interruption.details.recoveryStatus, "matching-index-observed");

  const result = resumePreparationWorkflow({
    transactionPath: interruption.details.transaction,
  });

  assert.equal(result.status, "prepared");
  assert.equal(result.phase, "snapshot-created");
  assert.equal(result.recoveryRequired, false);
  assert.equal(result.changeUnitCount, 1);
  assert.equal(
    readJson(interruption.details.transaction).phase,
    "snapshot-created",
  );
});

test("actual full preparation preserves split-index linkage and entry flags", (t) => {
  const fixture = createRepositoryFixture(t, "preparation-split-index-");
  writeRepositoryFile(fixture.repo, "flagged.txt", "flagged\n");
  writeRepositoryFile(fixture.repo, "changed.txt", "before\n");
  commitAll(fixture.repo);
  git(["update-index", "--assume-unchanged", "flagged.txt"], fixture.repo);
  git(["update-index", "--split-index"], fixture.repo);
  writeRepositoryFile(fixture.repo, "changed.txt", "after\n");

  const result = prepareWorkflow({
    options: parsePrepareArguments([
      "--mode",
      "actual",
      "--scope",
      "full",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
    ]),
    cwd: fixture.repo,
    environment: {},
    temporaryRoot: fixture.scratch,
  });
  const indexBytes = readFileSync(gitPath(fixture.repo, "index"));

  assert.equal(result.status, "prepared");
  assert.equal(indexBytes.includes(Buffer.from("link")), true);
  assert.match(
    git(["ls-files", "-v", "--", "flagged.txt"], fixture.repo).stdout,
    /^h /u,
  );
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "changed.txt\n",
  );
});

test("actual full preparation preserves a sparse index when Git supports it", (t) => {
  const fixture = createRepositoryFixture(t, "preparation-sparse-index-");
  writeRepositoryFile(fixture.repo, "src/changed.txt", "before\n");
  writeRepositoryFile(fixture.repo, "outside/kept.txt", "kept\n");
  commitAll(fixture.repo);
  git(["sparse-checkout", "init", "--cone", "--sparse-index"], fixture.repo);
  git(["sparse-checkout", "set", "src"], fixture.repo);
  assert.match(
    git(["ls-files", "--sparse"], fixture.repo).stdout,
    /^outside\/$/mu,
  );
  writeRepositoryFile(fixture.repo, "src/changed.txt", "after\n");

  const result = prepareWorkflow({
    options: parsePrepareArguments([
      "--mode",
      "actual",
      "--scope",
      "full",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
    ]),
    cwd: fixture.repo,
    environment: {},
    temporaryRoot: fixture.scratch,
  });

  assert.equal(result.status, "prepared");
  assert.match(
    git(["ls-files", "--sparse"], fixture.repo).stdout,
    /^outside\/$/mu,
  );
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "src/changed.txt\n",
  );
});
