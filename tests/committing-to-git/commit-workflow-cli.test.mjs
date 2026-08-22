import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import { runNodeScript } from "./harness.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMMIT_WORKFLOW = join(
  REPO_ROOT,
  "skills",
  "committing-to-git",
  "scripts",
  "commitWorkflow.mjs",
);

test("unified workflow help exposes the domain command groups", () => {
  const result = runNodeScript(COMMIT_WORKFLOW, ["--help"], REPO_ROOT);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /snapshot create/u);
  assert.match(result.stdout, /snapshot verify/u);
  assert.match(result.stdout, /inspection prepare/u);
  assert.match(result.stdout, /message validate/u);
  assert.match(result.stdout, /signature verify/u);
  assert.match(result.stdout, /report create/u);
  assert.match(result.stdout, /publication push/u);
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
