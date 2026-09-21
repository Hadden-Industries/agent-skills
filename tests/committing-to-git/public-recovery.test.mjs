import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  createRepositoryFixture,
  git,
  writeRepositoryFile,
} from "./harness.mjs";

/** The recovery driver consumes only copied public package bytes and their outputs. */
function publicFixture(context) {
  const fixture = createRepositoryFixture(context, "public-recovery-");
  const skill = join(fixture.base, "installed skill");
  cpSync(
    new URL(
      "../../plugins/committing-to-git/skills/committing-to-git",
      import.meta.url,
    ),
    skill,
    { recursive: true },
  );
  const helper = join(skill, "scripts", "commitWorkflow.mjs");
  const packageSha256 = createHash("sha256")
    .update(readFileSync(helper))
    .digest("hex");
  writeRepositoryFile(fixture.repo, "feature.txt", "Fixture-authored change\n");
  const key = join(fixture.scratch, "test-key");
  const signing = spawnSync(
    "ssh-keygen",
    ["-q", "-t", "ed25519", "-N", "", "-f", key],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(signing.status, 0, signing.stderr);
  git(["config", "gpg.format", "ssh"], fixture.repo);
  git(["config", "user.signingkey", key], fixture.repo);
  function invoke(arguments_, expectedExit = 0) {
    const child = spawnSync(process.execPath, [helper, ...arguments_], {
      cwd: fixture.repo,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(
      child.status,
      expectedExit,
      `${packageSha256}: ${child.stdout}\n${child.stderr}`,
    );
    const result = JSON.parse(child.stdout);
    assert.equal(child.stdout.trim().split("\n").length, 1);
    return result;
  }
  const prepare = (extra = []) =>
    invoke([
      "workflow",
      "prepare",
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
      ...extra,
    ]);
  return { ...fixture, skill, helper, packageSha256, invoke, prepare };
}

test("public lineage recovery uses the emitted reusable JSON shape", (context) => {
  const fixture = publicFixture(context);
  const rejected = fixture.invoke(
    [
      "workflow",
      "prepare",
      "--mode",
      "draft",
      "--scope",
      "full",
      "--evidence",
      "reuse",
      "--basis",
      "task-lineage",
    ],
    2,
  );
  assert.equal(rejected.code, "EVIDENCE_BASIS_NOTE_REQUIRED");
  const evidencePlan = rejected.details[0].example;
  evidencePlan.groups[0].basis.note =
    "The fixture setup authored feature.txt; its recorded content is the intended change.";
  const evidencePath = join(fixture.base, "reusable evidence.json");
  writeFileSync(evidencePath, JSON.stringify(evidencePlan));
  const prepared = fixture.invoke([
    "workflow",
    "prepare",
    "--mode",
    "draft",
    "--scope",
    "full",
    "--evidence-plan",
    evidencePath,
  ]);
  assert.equal(prepared.phase, "evidence-ready");
  assert.equal(prepared.commitState, "absent");
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "",
  );
});

test("public verification failure retains one signed commit and advisory recovery does not create another", (context) => {
  const fixture = publicFixture(context);
  const trustedSigners = join(fixture.scratch, "fixture-allowed-signers");
  const otherKey = join(fixture.scratch, "unrelated-key");
  const generated = spawnSync(
    "ssh-keygen",
    ["-q", "-t", "ed25519", "-N", "", "-f", otherKey],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(generated.status, 0, generated.stderr);
  writeFileSync(
    trustedSigners,
    `different@example.invalid ${readFileSync(`${otherKey}.pub`, "utf8")}`,
  );
  git(["config", "gpg.ssh.allowedSignersFile", trustedSigners], fixture.repo);
  const prepared = fixture.invoke([
    "workflow",
    "prepare",
    "--mode",
    "actual",
    "--scope",
    "full",
    "--evidence",
    "reuse",
    "--basis",
    "authored-current-task",
    "--verification",
    "required",
  ]);
  const blocked = fixture.invoke(
    [
      "workflow",
      "commit",
      "--transaction",
      prepared.transaction,
      "--message",
      "fix(core): Preserve fixture behavior",
    ],
    3,
  );
  const oid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  assert.equal(blocked.commitOid, oid);
  assert.equal(blocked.commitState, "created");
  assert.equal(blocked.publicationState, "blocked");
  assert.equal(blocked.publicationAllowed, false);
  // Explicit fixture-owner policy decision; this authorizes verification only.
  const advisory = fixture.invoke([
    "workflow",
    "verify",
    "--transaction",
    prepared.transaction,
    "--verification",
    "advisory",
  ]);
  assert.equal(advisory.commitOid, oid);
  assert.equal(advisory.severity, "warning");
  assert.ok(
    advisory.warnings.some(
      ({ code }) => code === "SIGNATURE_VERIFICATION_ADVISORY",
    ),
  );
  assert.equal(git(["rev-parse", "HEAD"], fixture.repo).stdout.trim(), oid);
});

test("public multiline rejection supplies the exact checked-input path and command", (context) => {
  const fixture = publicFixture(context);
  const prepared = fixture.prepare();
  const message =
    "fix(core): Preserve authored text\n\nRationale:\n  - Preserve the fixture change\n";
  const rejected = fixture.invoke(
    [
      "workflow",
      "commit",
      "--transaction",
      prepared.transaction,
      "--message",
      message,
    ],
    2,
  );
  assert.equal(rejected.code, "MESSAGE_REQUIRES_CHECKED_FILE");
  const messagePath = rejected.details[0].messagePath;
  assert.equal(typeof messagePath, "string");
  assert.ok(messagePath.endsWith("message-input.txt"));
  assert.deepEqual(rejected.recovery.requiredInputs, [messagePath]);
  writeFileSync(messagePath, message);
  const checked = fixture.invoke(rejected.recovery.commands[0].arguments);
  assert.equal(checked.phase, "message-ready");
  assert.equal(checked.commitState, "absent");
});

test("public structured recovery identifies editable shapes and preserves the helper binding", (context) => {
  const fixture = publicFixture(context);
  const prepared = fixture.prepare();
  const extended = fixture.invoke([
    "workflow",
    "extend",
    "--transaction",
    prepared.transaction,
    "--reason",
    "semantic-structure-required",
  ]);
  const content = JSON.parse(readFileSync(extended.contentPath, "utf8"));
  const binding = {
    schemaVersion: content.schemaVersion,
    mode: content.mode,
    evidenceGroups: content.evidenceGroups,
  };
  content.authoringState = "complete";
  content.subject = "fix(core): Preserve fixture behavior";
  writeFileSync(extended.contentPath, JSON.stringify(content));
  const rejected = fixture.invoke(
    ["message", "finalize", "--transaction", prepared.transaction],
    2,
  );
  assert.equal(rejected.code, "INVALID_MESSAGE_CONTENT");
  assert.ok(
    rejected.details[0].diagnostics.samples.some(
      ({ pointer, expectedType }) =>
        pointer === "/subject" && expectedType === "object",
    ),
  );
  assert.equal(rejected.details[0].contentPath, extended.contentPath);
  content.subject = {
    type: "fix",
    scope: "core",
    description: "Preserve fixture behavior",
  };
  content.sharedRationales = [
    {
      ...rejected.details[0].contentContract.sharedRationale.example,
      reasons: ["Preserve the intended fixture content"],
    },
  ];
  content.userExperienceChanges = [];
  content.fileNotes = [
    {
      selection: { all: true },
      reasons: ["Record the fixture-authored behavior"],
    },
  ];
  writeFileSync(extended.contentPath, JSON.stringify(content));
  const finalized = fixture.invoke(rejected.recovery.commands[0].arguments);
  assert.equal(finalized.phase, "message-ready");
  assert.equal(finalized.commitState, "absent");
  const finalContent = JSON.parse(readFileSync(extended.contentPath, "utf8"));
  assert.deepEqual(
    {
      schemaVersion: finalContent.schemaVersion,
      mode: finalContent.mode,
      evidenceGroups: finalContent.evidenceGroups,
    },
    binding,
  );
});

test("public failed-check recovery requires the exact receipt decision before one signed commit", (context) => {
  const fixture = publicFixture(context);
  const prepared = fixture.prepare();
  const failed = fixture.invoke(
    [
      "workflow",
      "check",
      "--transaction",
      prepared.transaction,
      "--",
      process.execPath,
      "-e",
      "process.exit(7)",
    ],
    1,
  );
  const rejected = fixture.invoke(
    [
      "workflow",
      "commit",
      "--transaction",
      prepared.transaction,
      "--message",
      "fix(core): Preserve fixture behavior",
    ],
    5,
  );
  assert.equal(rejected.code, "FAILED_CHECK_ACKNOWLEDGEMENT_REQUIRED");
  assert.deepEqual(rejected.details[0].receiptIds, [failed.receipt.receiptId]);
  assert.equal(rejected.recovery.kind, "human-decision");
  assert.deepEqual(rejected.recovery.commands, []);
  assert.equal(rejected.commitState, "absent");
  // This isolated test supplies an explicit fixture-only decision; the diagnostic cannot supply it.
  const committed = fixture.invoke([
    "workflow",
    "commit",
    "--transaction",
    prepared.transaction,
    "--message",
    "fix(core): Preserve fixture behavior",
    "--acknowledge-failed-check",
    failed.receipt.receiptId,
  ]);
  assert.equal(committed.commitState, "created");
  assert.equal(committed.report.commit.signed, true);
  assert.equal(
    git(["rev-parse", "HEAD"], fixture.repo).stdout.trim(),
    committed.commitOid,
  );
});
