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
  skill_name: "reading-epubs",
  evals: [
    {
      id: 1,
      prompt: "Evaluate the selected skill.",
      expected_output: "The selected skill produces a result.",
      files: [],
      assertions: ["The result is present."],
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
  mkdirSync(join(root, "skills", "reading-epubs"), { recursive: true });
  mkdirSync(join(root, "skills", "unrelated"), { recursive: true });
  mkdirSync(join(root, "src", "reading-epubs", "evals"), { recursive: true });
  mkdirSync(join(root, "src", "unrelated", "evals"), { recursive: true });
  writeFileSync(
    join(root, "skills", "reading-epubs", "SKILL.md"),
    "# Selected\n",
  );
  writeFileSync(join(root, "src", "reading-epubs", "SKILL.md"), "# Selected\n");
  writeFileSync(join(root, "src", "unrelated", "SKILL.md"), "# Unrelated\n");
  mkdirSync(join(root, "src/reading-epubs/evals/extensions/v1"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "src/reading-epubs/evals/extensions/v1/suite.json"),
    JSON.stringify({
      schemaVersion: 1,
      skill_name: "reading-epubs",
      profile: "portable-v1",
      provenance: {},
      protocol: { cases: {} },
      assurance: { suite: {}, cases: {} },
    }),
  );
  writeFileSync(join(root, "skills", "unrelated", "SKILL.md"), "# Unrelated\n");
  writeFileSync(
    join(root, "src", "reading-epubs", "evals", "evals.json"),
    JSON.stringify(VALID_EVALUATION),
  );
  writeFileSync(
    join(root, "src", "reading-epubs", "evals", "trigger-evals.json"),
    JSON.stringify(VALID_TRIGGERS),
  );
  writeFileSync(join(root, "src", "unrelated", "evals", "evals.json"), "{");
  writeFileSync(
    join(root, "src", "unrelated", "evals", "trigger-evals.json"),
    JSON.stringify(VALID_TRIGGERS),
  );
  mkdirSync(join(root, ".venv", "Scripts"), { recursive: true });
  writeFileSync(
    join(root, ".venv", "Scripts", "skills-ref.exe"),
    "@echo off\n",
  );

  if (includeTests) {
    mkdirSync(join(root, "tests", "reading-epubs", "nested"), {
      recursive: true,
    });
    mkdirSync(join(root, "tests", "evals", "reading-epubs"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "tests", "reading-epubs", "nested", "zeta.test.mjs"),
      "// zeta\n",
    );
    writeFileSync(
      join(root, "tests", "evals", "reading-epubs", "alpha.test.mjs"),
      "// alpha\n",
    );
    writeFileSync(
      join(root, "tests", "reading-epubs", "ignored.mjs"),
      "// ignored\n",
    );
  }

  return root;
}

test("CLI parsing requires exactly one explicit skill selector", () => {
  assert.equal(
    parseSkillArgument(["--skill", "reading-epubs"]),
    "reading-epubs",
  );

  for (const args of [
    [],
    ["--skill"],
    ["--skill", "reading-epubs", "--skill", "reading-epubs"],
    ["--skill", "../selected"],
    ["--skill", "nested/selected"],
    ["--skill", "nested\\selected"],
    ["--skill", "C:\\selected"],
    ["reading-epubs"],
  ]) {
    assert.throws(
      () => parseSkillArgument(args),
      /Usage: verifySkill\.js --skill <canonical-skill-name>/u,
    );
  }
});

test("test discovery is sorted, confined, and follows both conventions", (t) => {
  const root = createRepository(t);

  assert.deepEqual(discoverSkillTests(root, "reading-epubs"), [
    join(root, "tests", "evals", "reading-epubs", "alpha.test.mjs"),
    join(root, "tests", "reading-epubs", "nested", "zeta.test.mjs"),
  ]);
});

test("scoped verification runs only selected checks and reports global omissions", async (t) => {
  const root = createRepository(t);
  const calls = [];

  const result = await verifySkill({
    repositoryRoot: root,
    skillName: "reading-epubs",
    platform: "win32",
    run(command, args, options) {
      calls.push([command, args, options]);
    },
  });

  const skillsRef = join(root, ".venv", "Scripts", "skills-ref.exe");
  assert.deepEqual(calls, [
    [
      "git",
      [
        "diff",
        "--check",
        "HEAD",
        "--",
        "skills/reading-epubs",
        "src/reading-epubs",
        "tests/reading-epubs",
        "tests/evals/reading-epubs",
      ],
      { cwd: root },
    ],
    [skillsRef, ["validate", join(root, "skills", "reading-epubs")], undefined],
    [
      "node",
      [
        "--test",
        join(root, "tests", "evals", "reading-epubs", "alpha.test.mjs"),
        join(root, "tests", "reading-epubs", "nested", "zeta.test.mjs"),
      ],
      { cwd: root },
    ],
  ]);
  assert.deepEqual(result.passedStages, [
    { name: "target diff whitespace", pathsChecked: 4 },
    { name: "canonical ASCII", filesValidated: 1 },
    { name: "evaluation contract", suitesValidated: 1 },
    { name: "generated artifacts", artifactsChecked: 1 },
    { name: "skills-ref validation", skillsValidated: 1 },
    { name: "target tests", testsDiscovered: 2 },
  ]);
  assert.deepEqual(result.globalOnlyNotRun, [
    "repository-wide Prettier and ESLint",
    "shared repository Markdown quality",
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
    skillName: "reading-epubs",
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

test("whitespace failure stops before build validation or later processes", async (t) => {
  const root = createRepository(t);
  const calls = [];
  writeFileSync(join(root, "src", "reading-epubs", "evals", "evals.json"), "{");

  await assert.rejects(
    verifySkill({
      repositoryRoot: root,
      skillName: "reading-epubs",
      run(command, args) {
        calls.push([command, args]);
        assert.equal(command, "git");
        throw new Error("whitespace check failed");
      },
    }),
    /whitespace check failed/u,
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].slice(0, 4), ["diff", "--check", "HEAD", "--"]);
});

test("invalid selected suites stop after whitespace and before validation or tests", async (t) => {
  const root = createRepository(t);
  const calls = [];
  writeFileSync(join(root, "src", "reading-epubs", "evals", "evals.json"), "{");

  await assert.rejects(
    verifySkill({
      repositoryRoot: root,
      skillName: "reading-epubs",
      run(command) {
        calls.push(command);
        assert.equal(command, "git");
      },
    }),
    /reading-epubs[\\/]evals[\\/]evals\.json/u,
  );
  assert.deepEqual(calls, ["git"]);
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
      skillName: "reading-epubs",
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

  assert.deepEqual(
    calls.map(([command]) => command),
    ["git", join(root, ".venv", "Scripts", "skills-ref.exe"), "node"],
  );
});
