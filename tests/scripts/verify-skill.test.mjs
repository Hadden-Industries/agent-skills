import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverSkillTests,
  parseSkillArgument,
  verifySkill,
} from "../../scripts/verifySkill.js";

const VALID_EVALUATION = {
  skill_name: "selected",
  evals: [
    {
      id: 1,
      prompt: "Evaluate the selected skill.",
      expected_output: "The selected skill produces a result.",
      files: [],
      expectations: ["The result is present."],
    },
  ],
};
const VALID_TRIGGERS = [
  { query: "Use the selected skill.", should_trigger: true },
  { query: "Use a different workflow.", should_trigger: false },
];

function createRepository(t, { includeTests = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "verify-skill-"));

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".agent-tools", "bin"), { recursive: true });
  mkdirSync(join(root, "skills", "selected"), { recursive: true });
  mkdirSync(join(root, "skills", "unrelated"), { recursive: true });
  mkdirSync(join(root, "evals", "selected"), { recursive: true });
  mkdirSync(join(root, "evals", "unrelated"), { recursive: true });
  writeFileSync(join(root, "skills", "selected", "SKILL.md"), "# Selected\n");
  writeFileSync(join(root, "skills", "unrelated", "SKILL.md"), "# Unrelated\n");
  writeFileSync(
    join(root, "evals", "selected", "evals.json"),
    JSON.stringify(VALID_EVALUATION),
  );
  writeFileSync(
    join(root, "evals", "selected", "trigger-evals.json"),
    JSON.stringify(VALID_TRIGGERS),
  );
  writeFileSync(join(root, "evals", "unrelated", "evals.json"), "{");
  writeFileSync(
    join(root, "evals", "unrelated", "trigger-evals.json"),
    JSON.stringify(VALID_TRIGGERS),
  );
  writeFileSync(
    join(root, ".agent-tools", "bin", "skills-ref.cmd"),
    "@echo off\n",
  );

  if (includeTests) {
    mkdirSync(join(root, "tests", "selected", "nested"), {
      recursive: true,
    });
    mkdirSync(join(root, "tests", "evals", "selected"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "tests", "selected", "nested", "zeta.test.mjs"),
      "// zeta\n",
    );
    writeFileSync(
      join(root, "tests", "evals", "selected", "alpha.test.mjs"),
      "// alpha\n",
    );
    writeFileSync(
      join(root, "tests", "selected", "ignored.mjs"),
      "// ignored\n",
    );
  }

  return root;
}

test("CLI parsing requires exactly one explicit skill selector", () => {
  assert.equal(parseSkillArgument(["--skill", "selected"]), "selected");

  for (const args of [
    [],
    ["--skill"],
    ["--skill", "selected", "--skill", "selected"],
    ["--skill", "../selected"],
    ["--skill", "nested/selected"],
    ["--skill", "nested\\selected"],
    ["--skill", "C:\\selected"],
    ["selected"],
  ]) {
    assert.throws(
      () => parseSkillArgument(args),
      /Usage: verifySkill\.js --skill <canonical-skill-name>/u,
    );
  }
});

test("test discovery is sorted, confined, and follows both conventions", (t) => {
  const root = createRepository(t);

  assert.deepEqual(discoverSkillTests(root, "selected"), [
    join(root, "tests", "evals", "selected", "alpha.test.mjs"),
    join(root, "tests", "selected", "nested", "zeta.test.mjs"),
  ]);
});

test("scoped verification runs only selected checks and reports global omissions", async (t) => {
  const root = createRepository(t);
  const calls = [];

  const result = await verifySkill({
    repositoryRoot: root,
    skillName: "selected",
    platform: "win32",
    run(command, args, options) {
      calls.push([command, args, options]);
    },
  });

  const skillsRef = join(root, ".agent-tools", "bin", "skills-ref.cmd");
  assert.deepEqual(calls, [
    [skillsRef, ["validate", join(root, "skills", "selected")], undefined],
    [
      "node",
      [
        "--test",
        join(root, "tests", "evals", "selected", "alpha.test.mjs"),
        join(root, "tests", "selected", "nested", "zeta.test.mjs"),
      ],
      { cwd: root },
    ],
    [
      "git",
      [
        "diff",
        "--check",
        "HEAD",
        "--",
        "skills/selected",
        "evals/selected",
        "tests/selected",
        "tests/evals/selected",
      ],
      { cwd: root },
    ],
  ]);
  assert.deepEqual(result.passedStages, [
    { name: "canonical ASCII", filesValidated: 1 },
    { name: "canonical Markdown wrapping", filesValidated: 1 },
    { name: "evaluation contract", suitesValidated: 1 },
    { name: "generated artifacts", artifactsChecked: 0 },
    { name: "skills-ref validation", skillsValidated: 1 },
    { name: "target tests", testsDiscovered: 2 },
    { name: "target diff whitespace", pathsChecked: 4 },
  ]);
  assert.deepEqual(result.globalOnlyNotRun, [
    "repository-wide Prettier and ESLint",
    "Tessl plugin-package lint",
    "unrelated Node tests",
    "repository-wide diff whitespace checking",
  ]);
});

test("scoped verification reports zero discovered tests without launching Node", async (t) => {
  const root = createRepository(t, { includeTests: false });
  const calls = [];

  const result = await verifySkill({
    repositoryRoot: root,
    skillName: "selected",
    platform: "win32",
    run(command, args, options) {
      calls.push([command, args, options]);
    },
  });

  assert.equal(
    calls.some(([command]) => command === "node"),
    false,
  );
  assert.deepEqual(
    result.passedStages.find(({ name }) => name === "target tests"),
    { name: "target tests", testsDiscovered: 0 },
  );
});

test("invalid selected suites fail before any process check runs", async (t) => {
  const root = createRepository(t);
  writeFileSync(join(root, "evals", "selected", "evals.json"), "{");

  await assert.rejects(
    verifySkill({
      repositoryRoot: root,
      skillName: "selected",
      run() {
        assert.fail("process checks must not run after contract failure");
      },
    }),
    /evals[\\/]selected[\\/]evals\.json is not valid JSON/u,
  );
});

test("unknown skills fail before any process check runs", async (t) => {
  const root = createRepository(t);

  await assert.rejects(
    verifySkill({
      repositoryRoot: root,
      skillName: "missing",
      run() {
        assert.fail("process checks must not run for an unknown skill");
      },
    }),
    /Unknown canonical skill: missing/u,
  );
});

test("a failed process stage prevents later checks and a success summary", async (t) => {
  const root = createRepository(t);
  const calls = [];

  await assert.rejects(
    verifySkill({
      repositoryRoot: root,
      skillName: "selected",
      platform: "win32",
      run(command, args) {
        calls.push([command, args]);
        if (command === "node") {
          throw new Error("target tests failed");
        }
      },
    }),
    /target tests failed/u,
  );

  assert.equal(
    calls.some(([command]) => command === "git"),
    false,
  );
});
