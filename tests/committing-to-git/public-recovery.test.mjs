import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  createRepositoryFixture,
  git,
  writeRepositoryFile,
} from "./harness.mjs";

test("public detailed rejection retains its measured diagnostic after restart and compaction", (context) => {
  const fixture = publicFixture(context);
  for (let i = 0; i < 63; i++)
    writeRepositoryFile(
      fixture.repo,
      `f${String(i).padStart(2, "0")}`,
      "Reviewed\n",
    );
  git(["add", "--all"], fixture.repo);
  const beforeIndex = readFileSync(join(fixture.repo, ".git", "index"));
  const rejected = fixture.invoke(
    [
      "workflow",
      "prepare",
      "--mode",
      "actual",
      "--scope",
      "staged",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      "--verification",
      "skipped",
      "--message-format",
      "detailed",
    ],
    2,
  );
  assert.equal(rejected.code, "DETAILED_MESSAGE_LIMIT_EXCEEDED");
  assert.equal(rejected.phase, "stopped");
  assert.equal(rejected.commitState, "absent");
  assert.equal(rejected.details[0].changeUnitCount, 64);
  assert.equal(rejected.details[0].requiredMode, "bulk");
  assert.equal(rejected.details[0].bulkChangeUnitThreshold, 50);
  assert.equal(rejected.details[0].maximumDetailedBytes, 32768);
  assert.deepEqual(rejected.details[0].reasons, ["change-unit-threshold"]);
  const recovered = fixture.invoke([
    "workflow",
    "recover",
    "--transaction",
    rejected.transaction,
  ]);
  assert.equal(
    recovered.preparationDiagnostics.originalDiagnostic.code,
    rejected.code,
  );
  assert.equal(recovered.preparationDiagnostics.resumeAllowed, false);
  assert.equal(recovered.preparationDiagnostics.correction.status, "ready");
  assert.ok(
    recovered.recovery.commands[0].arguments.includes("--correction-from"),
  );
  fixture.invoke([
    "workflow",
    "cleanup",
    "--transaction",
    rejected.transaction,
  ]);
  const detail = fixture.invoke([
    "workflow",
    "report-detail",
    "--transaction",
    rejected.transaction,
    "--section",
    "diagnostics",
    "--result-detail",
    "summary",
  ]);
  assert.equal(
    detail.preparationDiagnostics.originalDiagnostic.code,
    rejected.code,
  );
  assert.deepEqual(
    readFileSync(join(fixture.repo, ".git", "index")),
    beforeIndex,
  );
  fixture.invoke(
    ["workflow", "resume", "--transaction", rejected.transaction],
    1,
  );
});

/** The recovery driver consumes only copied public package bytes and their outputs. */
test("public guarded path correction preserves selectors, mixed evidence, types and policy", (context) => {
  const fixture = publicFixture(context);
  for (let i = 0; i < 50; i++)
    writeRepositoryFile(fixture.repo, `p/f${i}`, "Selected\n");
  writeRepositoryFile(fixture.repo, "p/excluded.txt", "Keep excluded\n");
  const scope = {
    schemaVersion: 2,
    includePaths: [],
    includePathPrefixes: ["p/"],
    excludePaths: ["p/excluded.txt"],
    excludePathPrefixes: [],
    includePathBytesBase64: [],
    excludePathBytesBase64: [],
  };
  const evidence = {
    schemaVersion: 1,
    groups: [
      {
        selection: { destinationPaths: ["p/f0"] },
        policy: "review",
        basis: { kind: "unknown-preexisting", note: null },
      },
      {
        selection: { remaining: true },
        policy: "reuse",
        basis: {
          kind: "task-lineage",
          note: "The other 49 selected units were authored in this fixture; retain their exact membership.",
        },
      },
    ],
  };
  const scopePath = join(fixture.base, "scope.json"),
    evidencePath = join(fixture.base, "mixed.json");
  writeFileSync(scopePath, JSON.stringify(scope));
  writeFileSync(evidencePath, JSON.stringify(evidence));
  const stopped = fixture.invoke(
    [
      "workflow",
      "prepare",
      "--mode",
      "draft",
      "--scope",
      "paths",
      "--scope-file",
      scopePath,
      "--evidence-plan",
      evidencePath,
      "--allowed-type",
      "docs",
      "--verification",
      "advisory",
      "--message-format",
      "detailed",
    ],
    2,
  );
  const inputs =
    stopped.details[0].preparationDiagnostics.correction.inputs.paths;
  assert.deepEqual(JSON.parse(readFileSync(inputs.scope, "utf8")), scope);
  assert.deepEqual(JSON.parse(readFileSync(inputs.evidence, "utf8")), evidence);
  const command = stopped.recovery.commands[0].arguments;
  assert.equal(command[command.indexOf("--verification") + 1], "advisory");
  assert.equal(command[command.indexOf("--allowed-type") + 1], "docs");
  const prepared = fixture.invoke(command);
  assert.equal(prepared.mode, "draft");
  assert.equal(prepared.changeUnitCount, 50);
  assert.equal(prepared.scope.kind, "paths");
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "",
  );
  assert.equal(
    readFileSync(join(fixture.repo, "p/excluded.txt"), "utf8"),
    "Keep excluded\n",
  );
});

for (const drift of [
  "HEAD",
  "same-oid-branch",
  "same-oid-detached",
  "staged-membership",
  "retained-input-replacement",
]) {
  test(`public correction withdraws advice after ${drift} drift`, (context) => {
    const fixture = publicFixture(context);
    if (drift.startsWith("same-oid")) {
      git(["add", "--all"], fixture.repo);
      git(["commit", "-qm", "Seed anchor fixture"], fixture.repo);
      writeRepositoryFile(fixture.repo, "feature.txt", "Selected change\n");
    }
    for (let i = 0; i < 63; i++)
      writeRepositoryFile(fixture.repo, `f${i}`, "Reviewed\n");
    git(["add", "--all"], fixture.repo);
    const stopped = fixture.invoke(
      [
        "workflow",
        "prepare",
        "--mode",
        "draft",
        "--scope",
        "staged",
        "--evidence",
        "reuse",
        "--basis",
        "authored-current-task",
        "--message-format",
        "detailed",
      ],
      2,
    );
    const correction = stopped.recovery.commands[0].arguments;
    if (drift === "HEAD")
      git(["commit", "-qm", "Change fixture anchor"], fixture.repo);
    if (drift === "same-oid-branch")
      git(["switch", "-c", "different-destination"], fixture.repo);
    if (drift === "same-oid-detached")
      git(["switch", "--detach", "HEAD"], fixture.repo);
    if (drift === "staged-membership") {
      writeRepositoryFile(fixture.repo, "added-after.txt", "Different scope\n");
      git(["add", "--", "added-after.txt"], fixture.repo);
    }
    if (drift === "retained-input-replacement") {
      const input =
        stopped.details[0].preparationDiagnostics.correction.inputs.paths
          .evidence;
      const bytes = readFileSync(input);
      renameSync(input, `${input}.retained-test-original`);
      writeFileSync(input, bytes);
    }
    const observed = fixture.invoke([
      "workflow",
      "recover",
      "--transaction",
      stopped.transaction,
    ]);
    assert.equal(
      observed.preparationDiagnostics.correction.status,
      "inputs-unavailable",
    );
    assert.deepEqual(observed.recovery.commands, []);
    assert.equal(
      fixture.invoke(correction, 2).code,
      "CORRECTION_INPUTS_CHANGED",
    );
  });
}

test("guarded correction rejects selected-content drift before actual path installation", (context) => {
  const fixture = publicFixture(context);
  for (let i = 0; i < 50; i++)
    writeRepositoryFile(fixture.repo, `p/f${i}`, "Original\n");
  const rejected = fixture.invoke(
    [
      "workflow",
      "prepare",
      "--mode",
      "actual",
      "--scope",
      "paths",
      "--path-prefix",
      "p/",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      "--verification",
      "skipped",
      "--message-format",
      "detailed",
    ],
    2,
  );
  const correctedArguments = rejected.recovery.commands[0].arguments;
  assert.ok(correctedArguments.includes("--correction-from"));
  writeRepositoryFile(fixture.repo, "p/f0", "Changed after rejection\n");
  const before = git(["diff", "--cached", "--name-only"], fixture.repo).stdout;
  const stale = fixture.invoke(correctedArguments, 2);
  assert.equal(stale.code, "CORRECTION_CANDIDATE_CHANGED");
  assert.equal(stale.commitState, "absent");
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    before,
  );
  assert.equal(
    readFileSync(join(fixture.repo, "p/f0"), "utf8"),
    "Changed after rejection\n",
  );
});

for (const evidenceRoute of ["concise", "extended"]) {
  test(`public 64-unit ${evidenceRoute} route preserves requested sections through bulk readiness`, (context) => {
    const fixture = publicFixture(context);
    const body =
      evidenceRoute === "extended"
        ? "A genuine review line with context.\n".repeat(100)
        : "Reviewed\n";
    for (let i = 0; i < 63; i++)
      writeRepositoryFile(fixture.repo, `f${String(i).padStart(2, "0")}`, body);
    git(["add", "--all"], fixture.repo);
    const evidence = {
      schemaVersion: 1,
      groups: [
        {
          selection: { all: true },
          policy: evidenceRoute === "concise" ? "reuse" : "review",
          basis: {
            kind:
              evidenceRoute === "concise"
                ? "task-lineage"
                : "unknown-preexisting",
            note:
              evidenceRoute === "concise"
                ? "All 64 staged files were authored in this fixture; preserve their scope and complete inventory."
                : null,
          },
        },
      ],
    };
    const evidencePath = join(fixture.base, "evidence.json");
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const rejected = fixture.invoke(
      [
        "workflow",
        "prepare",
        "--mode",
        "draft",
        "--scope",
        "staged",
        "--evidence-plan",
        evidencePath,
        "--message-format",
        "detailed",
      ],
      2,
    );
    assert.equal(rejected.code, "DETAILED_MESSAGE_LIMIT_EXCEEDED");
    fixture.invoke([
      "workflow",
      "cleanup",
      "--transaction",
      rejected.transaction,
    ]);
    const recovered = fixture.invoke([
      "workflow",
      "recover",
      "--transaction",
      rejected.transaction,
    ]);
    assert.equal(recovered.preparationDiagnostics.correction.status, "ready");
    let prepared = fixture.invoke(recovered.recovery.commands[0].arguments);
    assert.notEqual(prepared.transaction, rejected.transaction);
    assert.equal(prepared.changeUnitCount, 64);
    assert.equal(prepared.route, evidenceRoute);
    if (evidenceRoute === "concise") {
      assert.equal(prepared.phase, "evidence-ready");
      prepared = fixture.invoke([
        "workflow",
        "extend",
        "--transaction",
        prepared.transaction,
        "--reason",
        "semantic-structure-required",
      ]);
    } else {
      assert.equal(prepared.extendedReason, "required-evidence-over-budget");
      while (prepared.reviewRequired) {
        prepared = fixture.invoke([
          "workflow",
          "review-next",
          "--transaction",
          prepared.transaction,
          ...(prepared.reviewProgress.nextCursor
            ? ["--cursor", prepared.reviewProgress.nextCursor]
            : []),
        ]);
      }
      assert.equal(prepared.nextAction, "author-message");
      writeFileSync(
        prepared.messagePath,
        "docs: Describe the staged changes\n\nRationale:\n  - Preserve the complete selected scope\n",
      );
      const checked = fixture.invoke([
        "message",
        "check",
        "--transaction",
        prepared.transaction,
      ]);
      assert.equal(checked.phase, "message-ready");
      writeFileSync(
        prepared.messagePath,
        "docs: Describe the staged changes\n\nFile Changes:\n  1. `feature.txt`\n     - Preserve every staged unit.\n",
      );
      const error = fixture.invoke(
        ["message", "check", "--transaction", prepared.transaction],
        2,
      );
      assert.equal(error.code, "STRUCTURED_BULK_FINALIZATION_REQUIRED");
      assert.equal(
        error.details[0].structuredAuthoring.nextAction,
        "author-content",
      );
      prepared = {
        ...prepared,
        structuredAuthoring: error.details[0].structuredAuthoring,
      };
    }
    const alternative = prepared.structuredAuthoring ?? prepared;
    const content =
      alternative.contentTemplate ??
      JSON.parse(readFileSync(alternative.contentPath, "utf8"));
    assert.equal(content.mode, "bulk");
    assert.deepEqual(content.evidenceGroups, evidence.groups);
    content.authoringState = "complete";
    content.subject = {
      type: "docs",
      scope: null,
      description: "Describe all staged changes",
    };
    content.sharedRationales = [
      {
        selection: { all: true },
        reasons: ["Keep the complete accepted scope in one message"],
      },
    ];
    content.userExperienceChanges = [
      "Every selected file remains represented in the message",
    ];
    content.domains = [
      {
        title: "Staged documentation",
        selection: { all: true },
        reasons: ["Document the intended behavior of every selected unit"],
      },
    ];
    writeFileSync(alternative.contentPath, JSON.stringify(content));
    if (evidenceRoute === "concise") {
      const resumed = fixture.invoke([
        "workflow",
        "resume",
        "--transaction",
        prepared.transaction,
      ]);
      assert.equal(resumed.structuredAuthoring.contentTemplate, null);
    }
    assert.deepEqual(
      JSON.parse(readFileSync(alternative.contentPath, "utf8")),
      content,
    );
    const final = fixture.invoke(
      alternative.arguments ?? [
        "message",
        "finalize",
        "--transaction",
        prepared.transaction,
      ],
    );
    assert.equal(final.status, "message-ready");
    assert.equal(final.commitState, "absent");
    for (const section of [
      "Rationale:",
      "User Experience Changes:",
      "File Changes:",
    ])
      assert.ok(final.displayText.includes(section));
    assert.match(final.displayText, /Staged documentation \(64 files\)/u);
  });
}

function publicFixture(context) {
  const fixture = createRepositoryFixture(context, "public-recovery-");
  const skill = join(fixture.base, "installed skill");
  cpSync(new URL("../../skills/committing-to-git", import.meta.url), skill, {
    recursive: true,
  });
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

test("public body-only drafting exposes checked authoring without structured inventory", (context) => {
  const fixture = publicFixture(context);
  git(["commit", "--allow-empty", "-m", "Fixture baseline"], fixture.repo);
  for (let index = 1; index < 5; index++)
    writeRepositoryFile(fixture.repo, `body-${index}.txt`, "Body fixture\n");
  const beforeIndex = readFileSync(join(fixture.repo, ".git", "index"));
  const beforeHead = git(["rev-parse", "HEAD"], fixture.repo).stdout;
  const prepared = fixture.invoke([
    "workflow",
    "prepare",
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
  ]);
  assert.equal(prepared.changeUnitCount, 5);
  assert.equal(prepared.route, "concise");
  assert.equal(Object.hasOwn(prepared, "nextAction"), false);
  assert.equal(prepared.checkedAuthoring.nextAction, "author-message");
  assert.equal(typeof prepared.checkedAuthoring.messagePath, "string");
  const message =
    "test: Add body fixtures\n\nRationale:\n  - Cover body-only message authoring\n\nUser Experience Changes:\n  - No application behavior changes\n";
  writeFileSync(prepared.checkedAuthoring.messagePath, message);
  const checked = fixture.invoke(prepared.checkedAuthoring.arguments);
  assert.equal(checked.status, "message-ready");
  assert.equal(checked.route, "concise");
  assert.equal(checked.displayText, message);
  assert.equal(checked.displayText.includes("File Changes:"), false);
  assert.equal(checked.commitState, "absent");
  assert.equal(git(["rev-parse", "HEAD"], fixture.repo).stdout, beforeHead);
  assert.deepEqual(
    readFileSync(join(fixture.repo, ".git", "index")),
    beforeIndex,
  );
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
