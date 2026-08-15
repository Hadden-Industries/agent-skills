/**
 * Contract tests for the `committing-to-git` commit-message validator.
 *
 * Section 3 of the skill instructs the agent to branch on specific fields of
 * the validator's JSON output (`valid`, `manualReviewRequired`, and the
 * `error`/`review` severities). `commit-message-validation.schema.json`
 * documents that contract, but nothing enforced it, so the validator, the
 * schema, and the skill instructions could drift apart silently.
 *
 * These tests run the validator exactly as the skill does — as a subprocess,
 * against a real Git repository — and assert that its output still conforms to
 * the committed schema. Run them with:
 *
 *     node --test "tests/**\/*.test.mjs"
 *
 * Node 24 treats test-runner positional arguments as glob patterns, so a bare
 * directory path is resolved as a module and fails.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import { schemaErrors } from "../helpers/json-schema.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SCRIPT_DIR = join(REPO_ROOT, "skills", "committing-to-git", "scripts");
const VALIDATOR = join(SCRIPT_DIR, "validate-commit-message.mjs");
const SCHEMA_PATH = join(SCRIPT_DIR, "commit-message-validation.schema.json");

const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });

  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
  );

  return result.stdout;
}

/**
 * Builds a throwaway repository with one commit, plus a scratch directory that
 * sits outside the working tree. The commit-message file must live outside the
 * repository, exactly as the skill requires: a message file written inside the
 * tree would itself show up as an untracked change and alter the expected file
 * list the validator compares against.
 */
function createFixture(t) {
  const base = mkdtempSync(join(tmpdir(), "commit-msg-validator-"));
  const repo = join(base, "repo");
  const scratch = join(base, "scratch");

  mkdirSync(repo);
  mkdirSync(scratch);

  git(["init", "--quiet", "-b", "main"], repo);
  git(["config", "user.email", "tests@example.invalid"], repo);
  git(["config", "user.name", "Validator Tests"], repo);
  git(["config", "commit.gpgsign", "false"], repo);

  writeFileSync(join(repo, "seed.txt"), "seed\n");
  git(["add", "-A"], repo);
  git(["commit", "--quiet", "-m", "seed"], repo);

  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  return { repo, scratch };
}

function changeFile(repo, relativePath, contents) {
  const target = join(repo, relativePath);

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function stage(repo, ...paths) {
  git(["add", "--", ...paths], repo);
}

function runValidator({ repo, scratch }, message, extraArguments = []) {
  const messagePath = join(scratch, "commit_msg.txt");

  writeFileSync(messagePath, message);

  const result = spawnSync(process.execPath, [VALIDATOR, ...extraArguments, messagePath], {
    cwd: repo,
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json: result.stdout.trim() ? JSON.parse(result.stdout) : null,
  };
}

function assertConformsToSchema(payload) {
  assert.deepEqual(
    schemaErrors(payload, SCHEMA),
    [],
    "validator output does not conform to commit-message-validation.schema.json",
  );
}

test("accepted message: exit 0 and output conforms to the schema", (t) => {
  const fixture = createFixture(t);

  changeFile(fixture.repo, "src/alpha.js", "export const alpha = 1;\n");

  const result = runValidator(
    fixture,
    [
      "feat(alpha): Add the alpha module",
      "",
      "File Changes:",
      "  1. `src/alpha.js`",
      "     - Add the alpha constant used by downstream callers",
      "",
    ].join("\n"),
  );

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assertConformsToSchema(result.json);
  assert.equal(result.json.valid, true);
  assert.equal(result.json.summary.errors, 0);
});

test("rejected message: exit 1 and output still conforms to the schema", (t) => {
  const fixture = createFixture(t);

  changeFile(fixture.repo, "src/alpha.js", "export const alpha = 1;\n");

  const result = runValidator(
    fixture,
    [
      "feat(alpha): add an alpha module with a subject line that is far too long to accept.",
      "",
      "File Changes:",
      "  1. `src/alpha.js`",
      "     - Add the alpha constant used by downstream callers",
      "",
    ].join("\n"),
  );

  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.stderr}`);
  assertConformsToSchema(result.json);
  assert.equal(result.json.valid, false);

  const codes = result.json.issues.map(({ code }) => code);

  assert.ok(codes.includes("SUBJECT_TOO_LONG"), `expected SUBJECT_TOO_LONG in ${codes.join(", ")}`);
  assert.ok(
    codes.includes("SUBJECT_DESCRIPTION_NOT_CAPITALIZED"),
    `expected SUBJECT_DESCRIPTION_NOT_CAPITALIZED in ${codes.join(", ")}`,
  );
});

test("a file missing from the message is reported against the working tree", (t) => {
  const fixture = createFixture(t);

  changeFile(fixture.repo, "src/alpha.js", "export const alpha = 1;\n");
  changeFile(fixture.repo, "src/beta.js", "export const beta = 2;\n");

  const result = runValidator(
    fixture,
    [
      "feat(alpha): Add the alpha module",
      "",
      "File Changes:",
      "  1. `src/alpha.js`",
      "     - Add the alpha constant used by downstream callers",
      "",
    ].join("\n"),
  );

  assert.equal(result.status, 1);
  assertConformsToSchema(result.json);
  assert.equal(result.json.files.expectedCount, 2);
  assert.equal(result.json.files.listedCount, 1);
  assert.equal(result.json.files.setMatches, false);

  const missing = result.json.issues.filter(({ code }) => code === "FILE_MISSING_FROM_MESSAGE");

  assert.equal(missing.length, 1);
  assert.equal(missing[0].severity, "error");
  assert.equal(missing[0].path, "src/beta.js");
});

test("an overlong body line sets manualReviewRequired without failing", (t) => {
  const fixture = createFixture(t);

  changeFile(fixture.repo, "src/alpha.js", "export const alpha = 1;\n");

  const result = runValidator(
    fixture,
    [
      "feat(alpha): Add the alpha module",
      "",
      "File Changes:",
      "  1. `src/alpha.js`",
      "     - Add the alpha constant, described here in a bullet that runs past the seventy-two character limit",
      "",
    ].join("\n"),
  );

  assertConformsToSchema(result.json);
  assert.equal(result.json.valid, true, "an overlong line is a review issue, not an error");
  assert.equal(result.status, 0);
  assert.equal(result.json.manualReviewRequired, true);

  const overlong = result.json.issues.filter(({ code }) => code === "BODY_LINE_OVER_LIMIT");

  assert.equal(overlong.length, 1);
  assert.equal(overlong[0].severity, "review");
  assert.equal(result.json.summary.reviews, 1);
});

test("a User Experience Changes section is recognised", (t) => {
  const fixture = createFixture(t);

  changeFile(fixture.repo, "src/alpha.js", "export const alpha = 1;\n");

  const result = runValidator(
    fixture,
    [
      "feat(alpha): Add the alpha module",
      "",
      "User Experience Changes:",
      "  - Enable the alpha workflow",
      "",
      "File Changes:",
      "  1. `src/alpha.js`",
      "     - Add the alpha constant used by downstream callers",
      "",
    ].join("\n"),
  );

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assertConformsToSchema(result.json);
  assert.deepEqual(result.json.sections.userExperience, { present: true, structureValid: true });
  assert.deepEqual(result.json.sections.fileChanges, { present: true, structureValid: true });
});

test("usage errors exit 2 and print nothing to stdout", (t) => {
  const fixture = createFixture(t);

  const noArguments = spawnSync(process.execPath, [VALIDATOR], {
    cwd: fixture.repo,
    encoding: "utf8",
  });

  assert.equal(noArguments.status, 2);
  assert.equal(noArguments.stdout, "");

  const missingFile = spawnSync(process.execPath, [VALIDATOR, join(fixture.scratch, "absent.txt")], {
    cwd: fixture.repo,
    encoding: "utf8",
  });

  assert.equal(missingFile.status, 2);
  assert.equal(missingFile.stdout, "");
});

// Partial commits are legitimate: an author may stage a subset of the changed
// files and commit only those. The validator must judge the message against
// what is actually being committed, not against the whole working tree.

const PARTIAL_MESSAGE = [
  "feat(alpha): Add the alpha module",
  "",
  "File Changes:",
  "  1. `src/alpha.js`",
  "     - Add the alpha constant used by downstream callers",
  "",
].join("\n");

function fixtureWithTwoChangesOneStaged(t) {
  const fixture = createFixture(t);

  changeFile(fixture.repo, "src/alpha.js", "export const alpha = 1;\n");
  changeFile(fixture.repo, "src/beta.js", "export const beta = 2;\n");
  stage(fixture.repo, "src/alpha.js");

  return fixture;
}

test("a partial commit describing only the staged file is accepted", (t) => {
  const fixture = fixtureWithTwoChangesOneStaged(t);

  const result = runValidator(fixture, PARTIAL_MESSAGE);

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assertConformsToSchema(result.json);
  assert.equal(result.json.valid, true);
  assert.deepEqual(result.json.scope, { requested: "auto", resolved: "staged" });
  assert.equal(result.json.files.expectedCount, 1);
  assert.equal(result.json.files.setMatches, true);

  const unstagedComplaints = result.json.issues.filter(({ path }) => path === "src/beta.js");

  assert.deepEqual(unstagedComplaints, [], "an unstaged change must not be demanded in the message");
});

test("a staged file omitted from the message is still an error", (t) => {
  const fixture = createFixture(t);

  changeFile(fixture.repo, "src/alpha.js", "export const alpha = 1;\n");
  changeFile(fixture.repo, "src/beta.js", "export const beta = 2;\n");
  stage(fixture.repo, "src/alpha.js", "src/beta.js");

  const result = runValidator(fixture, PARTIAL_MESSAGE);

  assert.equal(result.status, 1);
  assertConformsToSchema(result.json);
  assert.equal(result.json.scope.resolved, "staged");

  const missing = result.json.issues.filter(({ code }) => code === "FILE_MISSING_FROM_MESSAGE");

  assert.equal(missing.length, 1);
  assert.equal(missing[0].path, "src/beta.js");
});

test("listing an unstaged file under staged scope is an error", (t) => {
  const fixture = fixtureWithTwoChangesOneStaged(t);

  const result = runValidator(
    fixture,
    [
      "feat(alpha): Add the alpha and beta modules",
      "",
      "File Changes:",
      "  1. `src/alpha.js`",
      "     - Add the alpha constant used by downstream callers",
      "  2. `src/beta.js`",
      "     - Add the beta constant used by downstream callers",
      "",
    ].join("\n"),
  );

  assert.equal(result.status, 1);
  assertConformsToSchema(result.json);

  const notStaged = result.json.issues.filter(({ code }) => code === "FILE_NOT_CURRENTLY_CHANGED");

  assert.equal(notStaged.length, 1);
  assert.equal(notStaged[0].path, "src/beta.js");
});

test("--scope worktree compares against the whole working tree", (t) => {
  const fixture = fixtureWithTwoChangesOneStaged(t);

  const result = runValidator(fixture, PARTIAL_MESSAGE, ["--scope", "worktree"]);

  assert.equal(result.status, 1, "the unstaged change must be demanded under worktree scope");
  assertConformsToSchema(result.json);
  assert.deepEqual(result.json.scope, { requested: "worktree", resolved: "worktree" });
  assert.equal(result.json.files.expectedCount, 2);

  const missing = result.json.issues.filter(({ code }) => code === "FILE_MISSING_FROM_MESSAGE");

  assert.equal(missing.length, 1);
  assert.equal(missing[0].path, "src/beta.js");
});

test("--scope=staged is accepted in the inline form", (t) => {
  const fixture = fixtureWithTwoChangesOneStaged(t);

  const result = runValidator(fixture, PARTIAL_MESSAGE, ["--scope=staged"]);

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.deepEqual(result.json.scope, { requested: "staged", resolved: "staged" });
});

test("auto scope falls back to the working tree when nothing is staged", (t) => {
  const fixture = createFixture(t);

  changeFile(fixture.repo, "src/alpha.js", "export const alpha = 1;\n");

  const result = runValidator(fixture, PARTIAL_MESSAGE);

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.deepEqual(result.json.scope, { requested: "auto", resolved: "worktree" });
});

test("--scope staged with an empty index fails rather than validating nothing", (t) => {
  const fixture = createFixture(t);

  changeFile(fixture.repo, "src/alpha.js", "export const alpha = 1;\n");

  const result = runValidator(fixture, PARTIAL_MESSAGE, ["--scope", "staged"]);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /nothing is staged/u);
});

test("an unknown scope is a usage error", (t) => {
  const fixture = createFixture(t);

  const result = runValidator(fixture, PARTIAL_MESSAGE, ["--scope", "index"]);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown scope 'index'/u);
});

test("every issue code the validator emits is declared in the schema", () => {
  // Codes are not always a literal argument to `issue()` — some are selected by
  // a ternary — so this scrapes every SCREAMING_SNAKE_CASE string literal in the
  // validator instead of matching call sites. That convention is what keeps the
  // two lists comparable; a non-code literal in that style would fail here and
  // should be renamed rather than silently excluded.
  const source = readFileSync(VALIDATOR, "utf8");
  const emitted = new Set(
    [...source.matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/gu)].map((match) => match[1]),
  );

  assert.ok(emitted.size > 0, "no issue codes were found in the validator source");

  const declared = new Set(SCHEMA.$defs.issue.properties.code.enum);
  const undeclared = [...emitted].filter((code) => !declared.has(code)).sort();
  const unused = [...declared].filter((code) => !emitted.has(code)).sort();

  assert.deepEqual(undeclared, [], "validator emits codes the schema does not declare");
  assert.deepEqual(unused, [], "schema declares codes the validator never emits");
});
