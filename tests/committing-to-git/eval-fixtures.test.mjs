import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import { resolveSourceWorktree } from "../../evals/committing-to-git/create-fixture-repository.mjs";
import { git } from "./harness.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE_GENERATOR = join(
  REPO_ROOT,
  "evals",
  "committing-to-git",
  "create-fixture-repository.mjs",
);
const EVAL_DIRECTORY = dirname(FIXTURE_GENERATOR);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function createDestination(t, name) {
  const parent = mkdtempSync(join(tmpdir(), "committing-to-git-eval-"));
  const destination = join(parent, name);

  t.after(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  return destination;
}

function runGenerator(scenario, destination) {
  return spawnSync(
    process.execPath,
    [FIXTURE_GENERATOR, "--scenario", scenario, "--destination", destination],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

function generate(t, scenario) {
  const destination = createDestination(t, scenario);
  const result = runGenerator(scenario, destination);

  assert.equal(
    result.status,
    0,
    `fixture generation failed: ${result.stderr || result.stdout}`,
  );

  const metadata = JSON.parse(result.stdout);

  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.scenario, scenario);
  assert.equal(metadata.repository, destination);
  assert.ok(isAbsolute(metadata.repository));
  assert.ok(existsSync(join(destination, ".git")));

  return { destination, metadata };
}

test("the moved fixture generator resolves this repository as its source worktree", () => {
  assert.equal(resolveSourceWorktree(), realpathSync(REPO_ROOT));
});

test("behavior and trigger definitions use their evaluator contracts", () => {
  const behavior = readJson(join(EVAL_DIRECTORY, "evals.json"));
  const triggers = readJson(join(EVAL_DIRECTORY, "trigger-evals.json"));
  const ids = behavior.evals.map(({ id }) => id);

  assert.equal(behavior.skill_name, "committing-to-git");
  assert.ok(behavior.notes.includes("Text-only success is not evidence"));
  assert.ok(behavior.metrics.length >= 8);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    ids,
    Array.from({ length: 34 }, (_, index) => index + 1),
  );

  for (const evaluation of behavior.evals) {
    assert.equal(typeof evaluation.prompt, "string");
    assert.ok(evaluation.prompt.length > 0);
    assert.equal(typeof evaluation.expected_output, "string");
    assert.ok(Array.isArray(evaluation.files));
    assert.ok(Array.isArray(evaluation.expectations));
    assert.ok(evaluation.expectations.length > 0);
    assert.equal("assertions" in evaluation, false);

    for (const expectation of evaluation.expectations) {
      assert.equal(typeof expectation, "string");
      assert.equal(expectation, expectation.trim());
      assert.ok(expectation.length > 0);
    }
  }

  assert.equal(triggers.length, 22);
  assert.equal(
    triggers.filter(({ should_trigger: shouldTrigger }) => shouldTrigger)
      .length,
    10,
  );
  assert.equal(
    triggers.filter(({ should_trigger: shouldTrigger }) => !shouldTrigger)
      .length,
    12,
  );

  for (const trigger of triggers) {
    assert.deepEqual(Object.keys(trigger).sort(), ["query", "should_trigger"]);
    assert.equal(typeof trigger.query, "string");
    assert.equal(typeof trigger.should_trigger, "boolean");
  }
});

test("the retained pilot result is arithmetically self-consistent", () => {
  const result = readJson(
    join(EVAL_DIRECTORY, "results", "2026-08-22-luna-low-pilot.json"),
  );
  const aggregate = result.first_repetition_aggregate;
  const collision = result.collision_repetition_aggregate;

  assert.equal(result.raw_outputs_retained, false);
  assert.equal(result.telemetry.tokens_consumed, null);
  assert.equal(
    aggregate.without_skill.passed / aggregate.without_skill.total,
    aggregate.without_skill.micro_pass_rate,
  );
  assert.equal(
    aggregate.with_skill.passed / aggregate.with_skill.total,
    aggregate.with_skill.micro_pass_rate,
  );
  assert.equal(
    collision.without_skill.passed / collision.without_skill.total,
    collision.without_skill.pass_rate,
  );
  assert.equal(
    collision.with_skill.passed / collision.with_skill.total,
    collision.with_skill.pass_rate,
  );
});

test("the permission-boundary smoke result is arithmetically self-consistent", () => {
  const result = readJson(
    join(
      EVAL_DIRECTORY,
      "results",
      "2026-08-22-luna-low-permission-boundary-smoke.json",
    ),
  );
  const control = result.result.without_skill;
  const treatment = result.result.with_skill;
  const compactedTreatment = result.post_compaction_recheck.with_skill;
  const difference =
    (treatment.passed / treatment.total - control.passed / control.total) * 100;

  assert.equal(result.case_id, 28);
  assert.equal(control.case_passed, control.passed === control.total);
  assert.equal(treatment.case_passed, treatment.passed === treatment.total);
  assert.equal(
    compactedTreatment.case_passed,
    compactedTreatment.passed === compactedTreatment.total,
  );
  assert.equal(result.result.micro_percentage_point_difference, difference);
});

test("requires a new absolute destination outside the source worktree", (t) => {
  const relative = runGenerator("staged-rename", "relative-fixture");
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /absolute/i);

  const existing = createDestination(t, "existing");
  mkdirSync(existing);
  const occupied = runGenerator("staged-rename", existing);
  assert.notEqual(occupied.status, 0);
  assert.match(occupied.stderr, /already exists/i);

  const inWorktree = join(REPO_ROOT, ".committing-to-git-eval-forbidden");
  assert.equal(existsSync(inWorktree), false);
  const nested = runGenerator("staged-rename", inWorktree);
  assert.notEqual(nested.status, 0);
  assert.match(nested.stderr, /source worktree/i);
  assert.equal(existsSync(inWorktree), false);
});

test("staged-rename preserves rename identity and excludes unstaged lockfiles", (t) => {
  const { destination, metadata } = generate(t, "staged-rename");
  const staged = git(
    ["diff", "--cached", "--name-status", "-M"],
    destination,
  ).stdout;
  const unstaged = git(["diff", "--name-only"], destination).stdout;

  assert.match(staged, /^M\s+Dockerfile$/m);
  assert.match(staged, /^R\d+\s+vite\.config\.js\s+vite\.config\.mjs$/m);
  assert.doesNotMatch(staged, /(?:package|skills)-lock\.json/);
  assert.match(unstaged, /^package-lock\.json$/m);
  assert.match(unstaged, /^skills-lock\.json$/m);
  assert.equal(existsSync(join(destination, "vite.config.js")), false);
  assert.equal(existsSync(join(destination, "vite.config.mjs")), true);
  assert.deepEqual(metadata.expected.excludedPaths, [
    "package-lock.json",
    "skills-lock.json",
  ]);
});

test("literal-path leaves a wildcard-like sibling untracked", (t) => {
  const { destination, metadata } = generate(t, "literal-path");
  const staged = git(["diff", "--cached", "--name-only"], destination).stdout;
  const status = git(
    ["status", "--short", "--untracked-files=all"],
    destination,
  ).stdout;

  assert.equal(staged, "");
  assert.match(status, /^ M -literal\[1\]\.txt$/m);
  assert.match(status, /^\?\? -literal1\.txt$/m);
  assert.equal(
    readFileSync(join(destination, "-literal[1].txt"), "utf8"),
    "target update\n",
  );
  assert.equal(metadata.expected.literalPath, "-literal[1].txt");
});

for (const count of [49, 50]) {
  test(`bulk-${count} contains exactly ${count} staged change units`, (t) => {
    const { destination, metadata } = generate(t, `bulk-${count}`);
    const stagedPaths = git(["diff", "--cached", "--name-only"], destination)
      .stdout.trim()
      .split(/\r?\n/u)
      .filter(Boolean);

    assert.equal(stagedPaths.length, count);
    assert.equal(metadata.expected.changeUnitCount, count);
    assert.equal(
      metadata.expected.messageMode,
      count === 49 ? "detailed" : "bulk",
    );
  });
}

test("stale-head changes the parent without changing the approved index tree", (t) => {
  const { destination, metadata } = generate(t, "stale-head");
  const currentHead = git(["rev-parse", "HEAD"], destination).stdout.trim();
  const currentIndexTree = git(["write-tree"], destination).stdout.trim();

  assert.notEqual(metadata.expected.approvedHead, currentHead);
  assert.equal(metadata.expected.currentHead, currentHead);
  assert.equal(metadata.expected.approvedIndexTree, currentIndexTree);
  assert.equal(metadata.expected.currentIndexTree, currentIndexTree);
  assert.notEqual(
    metadata.expected.approvedIndexTree,
    metadata.expected.currentHeadTree,
  );
});

test("active-cherry-pick stops with an unresolved sequencer state", (t) => {
  const { destination, metadata } = generate(t, "active-cherry-pick");
  const gitDirectory = git(
    ["rev-parse", "--absolute-git-dir"],
    destination,
  ).stdout.trim();
  const unmerged = git(
    ["diff", "--name-only", "--diff-filter=U"],
    destination,
  ).stdout.trim();

  assert.equal(existsSync(join(gitDirectory, "CHERRY_PICK_HEAD")), true);
  assert.equal(unmerged, "shared.txt");
  assert.equal(metadata.expected.operation, "cherry-pick");
  assert.equal(metadata.expected.unmergedPath, "shared.txt");
});
