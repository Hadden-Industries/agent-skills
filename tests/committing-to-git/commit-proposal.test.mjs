import assert from "node:assert/strict";
import { chmodSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  COMMIT_PROPOSAL_SCHEMA,
  decodeCommitProposal,
  encodeCommitProposal,
} from "../../src/committing-to-git/workflow/commitProposal.js";
import { selectWorkflowStateStorage } from "../../src/committing-to-git/workflow/workflowStateStorage.js";
import {
  changeSetFromChangeUnits,
  changeSetSha256,
  observeStagedChangeSet,
} from "../../src/committing-to-git/snapshot/changeSet.js";
import { buildSnapshot } from "../../src/committing-to-git/snapshot/commitSnapshot.js";
import { buildWorkingTreeSnapshot } from "../../src/committing-to-git/snapshot/workingTreeSnapshot.js";
import {
  commitAll,
  createRepositoryFixture,
  git,
  writeRepositoryFile,
} from "./harness.mjs";

const PROPOSAL = Object.freeze({
  schema: COMMIT_PROPOSAL_SCHEMA,
  repositoryRoot: "C:/work/repository",
  mode: "actual",
  scope: "staged",
  headAnchor: {
    headKind: "attached",
    targetRef: "refs/heads/main",
    expectedParentOids: ["a".repeat(40)],
  },
  changeSetSha256: "b".repeat(64),
  changeUnitCount: 2,
  allowedTypes: [],
  verificationPolicy: "required",
});

function rejectedCode(callback) {
  try {
    callback();
  } catch (error) {
    return error.code;
  }

  return null;
}

test("a proposal round-trips through its canonical opaque encoding", () => {
  const encoded = encodeCommitProposal({ ...PROPOSAL });

  assert.match(encoded, /^ctg1\.[A-Za-z0-9_-]+$/u);
  assert.deepEqual(decodeCommitProposal(encoded), PROPOSAL);
});

test("a detailed proposal preserves its required presentation", () => {
  const detailed = { ...PROPOSAL, messageFormat: "detailed" };
  assert.deepEqual(
    decodeCommitProposal(encodeCommitProposal(detailed)),
    detailed,
  );
  assert.equal(
    rejectedCode(() =>
      encodeCommitProposal({ ...PROPOSAL, messageFormat: "bulk" }),
    ),
    "INVALID_PROPOSAL",
  );
});

test("proposal transport overflow requires a human storage decision", () => {
  assert.throws(
    () =>
      encodeCommitProposal({ ...PROPOSAL, repositoryRoot: "x".repeat(4096) }),
    (error) => {
      assert.equal(error.code, "PROPOSAL_TOO_LARGE");
      assert.equal(error.disposition, "unmet-prerequisite");
      assert.equal(error.recovery.kind, "human-decision");
      assert.equal(error.recovery.automatic, false);
      assert.deepEqual(error.recovery.commands, []);
      assert.doesNotMatch(
        JSON.stringify(error.recovery),
        /--state-storage|--state-directory/u,
      );
      return true;
    },
  );
});

test("tampered, non-canonical and incomplete proposals are invalid input", () => {
  const encoded = encodeCommitProposal({ ...PROPOSAL });
  const payload = JSON.parse(
    Buffer.from(encoded.slice(5), "base64url").toString("utf8"),
  );
  const reencode = (value) =>
    `ctg1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;

  for (const candidate of [
    `${encoded}x`,
    "ctg2.e30",
    reencode({ ...payload, extra: true }),
    reencode({ ...payload, mode: "promote" }),
    reencode({
      ...payload,
      headAnchor: { ...payload.headAnchor, expectedParentOids: [] },
    }),
    reencode(Object.fromEntries(Object.entries(payload).reverse())),
    reencode({
      ...payload,
      headAnchor: Object.fromEntries(
        Object.entries(payload.headAnchor).reverse(),
      ),
    }),
  ]) {
    assert.equal(
      rejectedCode(() => decodeCommitProposal(candidate)),
      "INVALID_PROPOSAL",
      candidate,
    );
  }
});

test("workflow state defaults to memory and disk needs an absolute directory", () => {
  assert.deepEqual(selectWorkflowStateStorage({}), {
    storage: "memory",
    directory: null,
  });
  assert.equal(
    rejectedCode(() => selectWorkflowStateStorage({ storage: "disk" })),
    "STATE_DIRECTORY_REQUIRED",
  );
  assert.equal(
    rejectedCode(() =>
      selectWorkflowStateStorage({ storage: "disk", directory: "relative" }),
    ),
    "STATE_DIRECTORY_REQUIRED",
  );
  assert.equal(
    rejectedCode(() =>
      selectWorkflowStateStorage({ directory: process.cwd() }),
    ),
    "STATE_DIRECTORY_WITHOUT_DISK_STORAGE",
  );
  assert.equal(
    rejectedCode(() => selectWorkflowStateStorage({ storage: "tmp" })),
    "INVALID_STATE_STORAGE",
  );
});

test("a manifest's change set equals Git's rename-free staged change set", (t) => {
  const fixture = createRepositoryFixture(t, "committing-to-git-change-set-");

  writeRepositoryFile(fixture.repo, "old/name.txt", "same bytes\n");
  writeRepositoryFile(fixture.repo, "edited.txt", "before\n");
  writeRepositoryFile(fixture.repo, "removed.txt", "gone\n");
  commitAll(fixture.repo);
  git(["mv", "old/name.txt", "old/renamed.txt"], fixture.repo);
  git(["rm", "--quiet", "removed.txt"], fixture.repo);
  writeRepositoryFile(fixture.repo, "edited.txt", "after\n");
  writeRepositoryFile(fixture.repo, "added.txt", "new\n");
  git(["add", "edited.txt", "added.txt"], fixture.repo);
  const headOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const snapshot = buildSnapshot({
    root: fixture.repo,
    workflowMode: "actual",
    scopeKind: "staged",
    sourceIndex: "real",
    headOid,
    writeTree: false,
  });

  assert.equal(snapshot.indexTreeOid, null);
  assert.ok(snapshot.changeUnits.some(({ kind }) => kind === "renamed"));
  assert.equal(
    changeSetSha256(changeSetFromChangeUnits(snapshot.changeUnits)),
    changeSetSha256(observeStagedChangeSet(fixture.repo, headOid)),
  );
});

test("memory full scope predicts exactly what git add -A stages", async (t) => {
  const fixture = createRepositoryFixture(t, "committing-to-git-full-scope-");
  const posix = process.platform !== "win32";

  writeRepositoryFile(fixture.repo, ".gitattributes", "*.txt text=auto\n");
  writeRepositoryFile(fixture.repo, "edited.txt", "before\n");
  writeRepositoryFile(fixture.repo, "removed.txt", "gone\n");
  writeRepositoryFile(fixture.repo, "moved/source.bin", "same bytes\0\n");
  if (posix) writeRepositoryFile(fixture.repo, "tool.sh", "#!/bin/sh\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "edited.txt", "after\r\nwith crlf\r\n");
  unlinkSync(join(fixture.repo, "removed.txt"));
  unlinkSync(join(fixture.repo, "moved", "source.bin"));
  writeRepositoryFile(fixture.repo, "moved/target.bin", "same bytes\0\n");
  writeRepositoryFile(fixture.repo, "name with spaces ü.txt", "unicode\r\n");
  writeRepositoryFile(fixture.repo, "empty.txt", "");
  if (posix) {
    chmodSync(join(fixture.repo, "tool.sh"), 0o755);
    symlinkSync("edited.txt", join(fixture.repo, "link-to-edited"));
  }

  const headOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const { snapshot, untrackedPatches } = await buildWorkingTreeSnapshot({
    root: fixture.repo,
    workflowMode: "actual",
    headOid,
    maximumPatchBytes: 32 * 1024,
  });
  // Binding-only rechecks skip line statistics but must bind the same change set.
  const { snapshot: recheck } = await buildWorkingTreeSnapshot({
    root: fixture.repo,
    workflowMode: "actual",
    headOid,
    withLineStatistics: false,
  });

  assert.equal(
    changeSetSha256(changeSetFromChangeUnits(recheck.changeUnits)),
    changeSetSha256(changeSetFromChangeUnits(snapshot.changeUnits)),
  );
  assert.ok(untrackedPatches.size >= 3);
  for (const patch of untrackedPatches.values()) {
    assert.match(patch.toString("utf8"), /^diff --git /u);
  }

  assert.ok(
    snapshot.changeUnits.some(
      ({ renameClassification }) => renameClassification === "exact-object",
    ),
  );
  git(["add", "-A"], fixture.repo);
  assert.equal(
    changeSetSha256(changeSetFromChangeUnits(snapshot.changeUnits)),
    changeSetSha256(observeStagedChangeSet(fixture.repo, headOid)),
  );
});
