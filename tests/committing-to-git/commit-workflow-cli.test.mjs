import {
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoGitStorageOverrides,
  parsePrepareArguments,
  prepareWorkflow,
} from "../../src/committing-to-git/workflow/prepareWorkflow.js";
import { MAXIMUM_INITIAL_JSON_INPUT_BYTES } from "../../src/committing-to-git/transaction/transactionWorkspace.js";
import {
  commitAll,
  createRepositoryFixture,
  git,
  runCommitWorkflow,
  runNodeScript,
  writeRepositoryFile,
} from "./harness.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMMIT_WORKFLOW = join(
  REPO_ROOT,
  "skills",
  "committing-to-git",
  "scripts",
  "commitWorkflow.mjs",
);

function temporaryEnvironment(scratch, overrides = {}) {
  return {
    TEMP: scratch,
    TMP: scratch,
    ...overrides,
  };
}

function uniformPrepareArguments(overrides = []) {
  return [
    "--mode",
    "actual",
    "--scope",
    "full",
    "--evidence",
    "reuse",
    "--basis",
    "authored-current-task",
    ...overrides,
  ];
}

test("unified workflow help exposes the domain command groups", () => {
  const result = runNodeScript(COMMIT_WORKFLOW, ["--help"], REPO_ROOT);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /snapshot create/u);
  assert.match(result.stdout, /snapshot verify/u);
  assert.match(result.stdout, /inspection prepare/u);
  assert.match(result.stdout, /inspection expand-deletion/u);
  assert.match(result.stdout, /message validate/u);
  assert.match(result.stdout, /signature verify/u);
  assert.match(result.stdout, /report create/u);
  assert.match(result.stdout, /publication push/u);
  assert.match(result.stdout, /workflow prepare/u);
  assert.match(result.stdout, /workflow resume/u);
});

test("workflow preparation owns one transaction and returns its bounded snapshot envelope", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-prepare-full-");

  writeRepositoryFile(fixture.repo, "tracked.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "tracked.txt", "after\n");
  writeRepositoryFile(fixture.repo, "new.txt", "new\n");

  const result = runCommitWorkflow(
    "workflow prepare",
    uniformPrepareArguments(["--allowed-type", "fix"]),
    fixture.repo,
    { env: temporaryEnvironment(fixture.scratch) },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);

  assert.deepEqual(
    {
      status: output.status,
      phase: output.phase,
      terminalDisposition: output.terminalDisposition,
      route: output.route,
      commitState: output.commitState,
      publicationState: output.publicationState,
      publicationAllowed: output.publicationAllowed,
      recoveryRequired: output.recoveryRequired,
      mode: output.mode,
      scopeKind: output.scope.kind,
      changeUnitCount: output.changeUnitCount,
    },
    {
      status: "prepared",
      phase: "snapshot-created",
      terminalDisposition: null,
      route: null,
      commitState: "absent",
      publicationState: "not-requested",
      publicationAllowed: false,
      recoveryRequired: false,
      mode: "actual",
      scopeKind: "full",
      changeUnitCount: 2,
    },
  );
  assert.equal(output.headAnchor.headKind, "attached");
  assert.equal(output.headAnchor.expectedParentOids.length, 1);
  assert.equal(typeof output.initialEvidencePlanSha256, "string");
  assert.equal(typeof output.indexTreeOid, "string");
  assert.equal(typeof output.transaction, "string");

  const transaction = JSON.parse(readFileSync(output.transaction, "utf8"));
  assert.equal(transaction.phase, "snapshot-created");
  assert.deepEqual(transaction.repositoryTypePolicy.allowedTypes, ["fix"]);
  assert.equal(transaction.scope.kind, "full");
  assert.equal(transaction.snapshot.changeUnitCount, 2);
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "new.txt\ntracked.txt\n",
  );
  assert.deepEqual(
    readdirSync(fixture.scratch).filter((name) =>
      name.startsWith("committing-to-git-"),
    ).length,
    1,
  );
});

test("workflow resume is idempotent at snapshot-created and rejects overrides", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-resume-cli-");
  writeRepositoryFile(fixture.repo, "change.txt", "change\n");
  git(["add", "change.txt"], fixture.repo);
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "staged",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
    ],
    fixture.repo,
    { env: temporaryEnvironment(fixture.scratch) },
  );
  assert.equal(prepared.status, 0, prepared.stderr);
  const transaction = JSON.parse(prepared.stdout).transaction;

  const resumed = runCommitWorkflow(
    "workflow resume",
    ["--transaction", transaction],
    fixture.repo,
  );

  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).phase, "snapshot-created");

  const override = runCommitWorkflow(
    "workflow resume",
    ["--transaction", transaction, "--scope", "full"],
    fixture.repo,
  );

  assert.equal(override.status, 2);
  assert.equal(JSON.parse(override.stdout).code, "UNKNOWN_ARGUMENT");
});

test("workflow path preparation expands literal inclusions and exclusions", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-prepare-paths-");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "src/parser/input.js", "selected\n");
  writeRepositoryFile(fixture.repo, "src/parser/generated.lock", "excluded\n");
  writeRepositoryFile(fixture.repo, "other.txt", "unrelated\n");

  const result = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "paths",
      "--evidence",
      "message",
      "--basis",
      "user-grounded",
      "--path-prefix",
      "src/parser/",
      "--exclude-path",
      "src/parser/generated.lock",
    ],
    fixture.repo,
    { env: temporaryEnvironment(fixture.scratch) },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);

  assert.equal(output.scope.selectorCount, 2);
  assert.equal(output.scope.expandedPathCount, 1);
  assert.equal(output.changeUnitCount, 1);
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "src/parser/input.js\n",
  );
});

test("path-prefix scope honors multiple exclusions including deleted paths", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-path-deletions-");
  writeRepositoryFile(fixture.repo, "src/selected-delete.txt", "selected\n");
  writeRepositoryFile(fixture.repo, "src/excluded-delete.txt", "excluded\n");
  commitAll(fixture.repo);
  unlinkSync(join(fixture.repo, "src/selected-delete.txt"));
  unlinkSync(join(fixture.repo, "src/excluded-delete.txt"));
  writeRepositoryFile(fixture.repo, "src/generated/output.txt", "excluded\n");

  const result = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "paths",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      "--path-prefix",
      "src/",
      "--exclude-path",
      "src/excluded-delete.txt",
      "--exclude-path-prefix",
      "src/generated/",
    ],
    fixture.repo,
    { env: temporaryEnvironment(fixture.scratch) },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "src/selected-delete.txt\n",
  );
  assert.equal(
    git(["diff", "--name-only"], fixture.repo).stdout,
    "src/excluded-delete.txt\n",
  );
});

test("workflow preparation rejects policy and storage errors before allocation", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-prepare-preflight-");
  writeRepositoryFile(fixture.repo, "change.txt", "change\n");

  const invalidType = runCommitWorkflow(
    "workflow prepare",
    uniformPrepareArguments(["--allowed-type", "Fix"]),
    fixture.repo,
    { env: temporaryEnvironment(fixture.scratch) },
  );

  assert.equal(invalidType.status, 2);
  assert.equal(JSON.parse(invalidType.stdout).code, "INVALID_ALLOWED_TYPE");
  assert.deepEqual(readdirSync(fixture.scratch), []);

  const sensitiveIndexPath = join(fixture.scratch, "do-not-echo-index");
  const redirected = runCommitWorkflow(
    "workflow prepare",
    uniformPrepareArguments(),
    fixture.repo,
    {
      env: temporaryEnvironment(fixture.scratch, {
        GIT_INDEX_FILE: sensitiveIndexPath,
      }),
    },
  );

  assert.equal(redirected.status, 2);
  assert.equal(
    JSON.parse(redirected.stdout).code,
    "UNSUPPORTED_GIT_STORAGE_OVERRIDE",
  );
  assert.match(redirected.stderr, /GIT_INDEX_FILE/u);
  assert.doesNotMatch(redirected.stderr, /do-not-echo-index/u);
  assert.deepEqual(readdirSync(fixture.scratch), []);
});

test("workflow preparation rejects unmatched selectors and staged path state before allocation", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-prepare-scope-stop-");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "actual.txt", "actual\n");

  const unmatched = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "paths",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      "--path",
      "typo.txt",
    ],
    fixture.repo,
    { env: temporaryEnvironment(fixture.scratch) },
  );

  assert.equal(unmatched.status, 2);
  assert.equal(JSON.parse(unmatched.stdout).code, "UNMATCHED_SCOPE_SELECTOR");
  assert.deepEqual(readdirSync(fixture.scratch), []);

  git(["add", "actual.txt"], fixture.repo);
  const staged = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "paths",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      "--path",
      "actual.txt",
    ],
    fixture.repo,
    { env: temporaryEnvironment(fixture.scratch) },
  );

  assert.equal(staged.status, 1);
  const stagedOutput = JSON.parse(staged.stdout);
  assert.equal(stagedOutput.code, "PREEXISTING_STAGED_CHANGES");
  assert.equal(stagedOutput.stagedChangeUnitCount, 1);
  assert.deepEqual(readdirSync(fixture.scratch), []);
});

test("a rename crossing a path-scope boundary fails before allocation", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-rename-boundary-");
  writeRepositoryFile(fixture.repo, "included/original.txt", "content\n");
  commitAll(fixture.repo);
  renameSync(
    join(fixture.repo, "included/original.txt"),
    join(fixture.repo, "destination.txt"),
  );

  const result = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "paths",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      "--path",
      "destination.txt",
    ],
    fixture.repo,
    { env: temporaryEnvironment(fixture.scratch) },
  );

  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, "RENAME_SCOPE_BOUNDARY");
  assert.deepEqual(readdirSync(fixture.scratch), []);
  assert.equal(
    git(["diff", "--cached", "--quiet", "--"], fixture.repo, {
      allowFailure: true,
    }).status,
    0,
  );
});

test("draft path scope coexists with disjoint staged work without changing it", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-draft-disjoint-");
  writeRepositoryFile(fixture.repo, "staged.txt", "before\n");
  writeRepositoryFile(fixture.repo, "draft.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "staged.txt", "staged\n");
  git(["add", "staged.txt"], fixture.repo);
  writeRepositoryFile(fixture.repo, "draft.txt", "draft\n");
  const stagedTree = git(["write-tree"], fixture.repo).stdout.trim();

  const result = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "draft",
      "--scope",
      "paths",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      "--path",
      "draft.txt",
    ],
    fixture.repo,
    { env: temporaryEnvironment(fixture.scratch) },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(["write-tree"], fixture.repo).stdout.trim(), stagedTree);
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "staged.txt\n",
  );
});

test("draft path scope rejects overlap with staged work before allocation", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-draft-overlap-");
  writeRepositoryFile(fixture.repo, "overlap.txt", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "overlap.txt", "after\n");
  git(["add", "overlap.txt"], fixture.repo);

  const result = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "draft",
      "--scope",
      "paths",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      "--path",
      "overlap.txt",
    ],
    fixture.repo,
    { env: temporaryEnvironment(fixture.scratch) },
  );

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).code, "DRAFT_SCOPE_OVERLAPS_STAGED");
  assert.deepEqual(readdirSync(fixture.scratch), []);
});

test("workflow preparation validates one-time scope and evidence inputs", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-prepare-inputs-");
  const scopePath = join(fixture.base, "scope.json");
  const evidencePath = join(fixture.base, "evidence.json");

  writeRepositoryFile(fixture.repo, "raw-name.txt", "selected\n");
  writeFileSync(
    scopePath,
    `${JSON.stringify({
      schemaVersion: 2,
      includePaths: [],
      includePathPrefixes: [],
      excludePaths: [],
      excludePathPrefixes: [],
      includePathBytesBase64: [Buffer.from("raw-name.txt").toString("base64")],
      excludePathBytesBase64: [],
    })}\n`,
  );
  writeFileSync(
    evidencePath,
    `${JSON.stringify({
      schemaVersion: 1,
      groups: [
        {
          selection: { all: true },
          policy: "message",
          basis: { kind: "user-grounded", note: "Requested behavior" },
        },
      ],
    })}\n`,
  );

  const result = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "draft",
      "--scope",
      "paths",
      "--scope-file",
      scopePath,
      "--evidence-plan",
      evidencePath,
    ],
    fixture.repo,
    { env: temporaryEnvironment(fixture.scratch) },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const transaction = JSON.parse(readFileSync(output.transaction, "utf8"));
  const persistedPlan = join(
    dirname(output.transaction),
    "evidence-plan-input.json",
  );

  assert.equal(transaction.mode, "draft");
  assert.equal(transaction.scope.expandedPathBytesBase64.length, 1);
  assert.equal(typeof output.initialEvidencePlanSha256, "string");
  assert.equal(readFileSync(scopePath, "utf8").length > 0, true);
  assert.equal(readFileSync(evidencePath, "utf8").length > 0, true);
  assert.equal(readFileSync(persistedPlan, "utf8").length > 0, true);
});

test("workflow preparation parser rejects every ambiguous argument combination", () => {
  const invalidArguments = [
    ["UNKNOWN_ARGUMENT", [...uniformPrepareArguments(), "--mystery", "value"]],
    ["DUPLICATE_ARGUMENT", [...uniformPrepareArguments(), "--mode", "draft"]],
    ["MISSING_EVIDENCE_INPUT", ["--mode", "actual", "--scope", "full"]],
    [
      "MISSING_EVIDENCE_INPUT",
      ["--mode", "actual", "--scope", "full", "--evidence", "message"],
    ],
    [
      "INVALID_EVIDENCE_POLICY",
      [
        "--mode",
        "actual",
        "--scope",
        "full",
        "--evidence",
        "guess",
        "--basis",
        "authored-current-task",
      ],
    ],
    [
      "INVALID_EVIDENCE_BASIS",
      [
        "--mode",
        "actual",
        "--scope",
        "full",
        "--evidence",
        "reuse",
        "--basis",
        "unspecified",
      ],
    ],
    [
      "CONFLICTING_EVIDENCE_INPUT",
      [...uniformPrepareArguments(), "--evidence-plan", "plan.json"],
    ],
    [
      "UNKNOWN_ARGUMENT",
      [...uniformPrepareArguments(), "--basis-note", "note"],
    ],
    [
      "INVALID_ALLOWED_TYPE",
      [
        ...uniformPrepareArguments(),
        "--allowed-type",
        "fix",
        "--allowed-type",
        "fix",
      ],
    ],
    [
      "SELECTOR_OUTSIDE_PATH_SCOPE",
      [...uniformPrepareArguments(), "--path", "src/file.js"],
    ],
    [
      "CONFLICTING_SCOPE_INPUT",
      [
        "--mode",
        "actual",
        "--scope",
        "paths",
        "--evidence",
        "reuse",
        "--basis",
        "authored-current-task",
        "--path",
        "src/file.js",
        "--scope-file",
        "scope.json",
      ],
    ],
    [
      "MISSING_SCOPE_INCLUSION",
      [
        "--mode",
        "actual",
        "--scope",
        "paths",
        "--evidence",
        "reuse",
        "--basis",
        "authored-current-task",
        "--exclude-path",
        "src/file.js",
      ],
    ],
    ["INVALID_ARGUMENT", [...uniformPrepareArguments(), "--allowed-type", ""]],
  ];

  for (const [code, arguments_] of invalidArguments) {
    assert.throws(
      () => parsePrepareArguments(arguments_),
      (error) => error.code === code,
      `${code}: ${arguments_.join(" ")}`,
    );
  }
});

test("workflow preparation normalizes selectors before repository discovery", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-selector-validation-");
  const invalidScopes = [
    ["INVALID_SCOPE_SELECTOR", ["--path-prefix", "src/parser"]],
    [
      "DUPLICATE_SCOPE_SELECTOR",
      ["--path", "src/file.js", "--path", "src/file.js"],
    ],
    [
      "UNCONTAINED_SCOPE_EXCLUSION",
      ["--path-prefix", "src/", "--exclude-path", "tests/file.js"],
    ],
  ];

  for (const [code, selectors] of invalidScopes) {
    const options = parsePrepareArguments([
      "--mode",
      "actual",
      "--scope",
      "paths",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      ...selectors,
    ]);

    assert.throws(
      () =>
        prepareWorkflow({
          options,
          cwd: fixture.repo,
          environment: {},
          temporaryRoot: fixture.scratch,
        }),
      (error) => error.code === code,
    );
    assert.deepEqual(readdirSync(fixture.scratch), []);
  }
});

test("every inherited Git storage override is rejected without exposing its value", () => {
  const names = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_QUARANTINE_PATH",
    "GIT_NAMESPACE",
  ];

  for (const name of names) {
    const sensitiveValue = `sensitive-${name.toLowerCase()}`;

    assert.throws(
      () => assertNoGitStorageOverrides({ [name]: sensitiveValue }),
      (error) =>
        error.code === "UNSUPPORTED_GIT_STORAGE_OVERRIDE" &&
        error.message.includes(name) &&
        !error.message.includes(sensitiveValue),
    );
  }
});

test("one-time JSON inputs reject invalid UTF-8, oversized bytes, and long notes before allocation", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-json-input-boundary-");
  const evidencePath = join(fixture.base, "evidence.json");
  const options = () =>
    parsePrepareArguments([
      "--mode",
      "actual",
      "--scope",
      "full",
      "--evidence-plan",
      evidencePath,
    ]);

  writeFileSync(evidencePath, Buffer.from([0xff]));
  assert.throws(
    () =>
      prepareWorkflow({
        options: options(),
        cwd: fixture.repo,
        environment: {},
        temporaryRoot: fixture.scratch,
      }),
    (error) => error.code === "INVALID_JSON_UTF8",
  );
  assert.deepEqual(readdirSync(fixture.scratch), []);

  writeFileSync(
    evidencePath,
    JSON.stringify({
      schemaVersion: 1,
      groups: [
        {
          selection: { all: true },
          policy: "message",
          basis: { kind: "user-grounded", note: "n".repeat(513) },
        },
      ],
    }),
  );
  assert.throws(
    () =>
      prepareWorkflow({
        options: options(),
        cwd: fixture.repo,
        environment: {},
        temporaryRoot: fixture.scratch,
      }),
    (error) => error.code === "INVALID_EVIDENCE_PLAN",
  );
  assert.deepEqual(readdirSync(fixture.scratch), []);

  writeFileSync(
    evidencePath,
    Buffer.alloc(MAXIMUM_INITIAL_JSON_INPUT_BYTES + 1, 0x20),
  );
  assert.throws(
    () =>
      prepareWorkflow({
        options: options(),
        cwd: fixture.repo,
        environment: {},
        temporaryRoot: fixture.scratch,
      }),
    (error) => error.code === "JSON_INPUT_TOO_LARGE",
  );
  assert.deepEqual(readdirSync(fixture.scratch), []);
});

test("deletion expansion help explains exact old-blob materialization", () => {
  const result = runNodeScript(
    COMMIT_WORKFLOW,
    ["inspection", "expand-deletion", "--help"],
    REPO_ROOT,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--manifest <snapshot\.json>/u);
  assert.match(result.stdout, /--ledger <ledger\.json>/u);
  assert.match(result.stdout, /--change-unit <F[0-9]+>/u);
  assert.match(result.stdout, /exact old blob/u);
  assert.match(result.stdout, /ledger incomplete/u);
  assert.match(result.stdout, /Exit status:/u);
});

test("unified workflow rejects an unknown command with concise help", () => {
  const result = runNodeScript(COMMIT_WORKFLOW, ["unknown"], REPO_ROOT);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown command/u);
  assert.match(result.stderr, /--help/u);
  assert.doesNotMatch(result.stderr, /\n\s+at\s/u);
});

test("domain command help documents its required options without running Git", () => {
  const result = runNodeScript(
    COMMIT_WORKFLOW,
    ["snapshot", "create", "--help"],
    REPO_ROOT,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--mode <actual\|draft>/u);
  assert.match(result.stdout, /--scope <staged\|full\|paths>/u);
  assert.match(result.stdout, /Side effects:/u);
  assert.match(result.stdout, /Staged scope reads the real index as-is/u);
  assert.match(result.stdout, /may lock it to update cache metadata/u);
  assert.match(result.stdout, /Draft full and paths do not change/u);
  assert.match(result.stdout, /Exit status:/u);
});

test("command usage errors name the unified published executable", () => {
  const result = runNodeScript(
    COMMIT_WORKFLOW,
    ["snapshot", "create"],
    REPO_ROOT,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /commitWorkflow\.mjs snapshot create/u);
  assert.doesNotMatch(result.stderr, /stage-commit-scope/u);
});

test("report help includes the optional publication artifact", () => {
  const result = runNodeScript(
    COMMIT_WORKFLOW,
    ["report", "create", "--help"],
    REPO_ROOT,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[--publication <publication\.json>\]/u);
  assert.match(result.stdout, /Output:/u);
  assert.match(result.stdout, /Exit status:/u);
});

test("publication help discloses its network side effect and enforcement boundary", () => {
  const result = runNodeScript(
    COMMIT_WORKFLOW,
    ["publication", "push", "--help"],
    REPO_ROOT,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Network side effect:/u);
  assert.match(result.stdout, /\.pending/u);
  assert.match(result.stdout, /does not enforce authorization/u);
  assert.match(result.stdout, /Exit status:/u);
});
