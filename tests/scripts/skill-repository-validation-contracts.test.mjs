import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCanonicalSkillAscii,
  validateCanonicalSkillMarkdownWrapping,
  validateRepositoryEvaluationLayout,
} from "../../scripts/validateSkillRepository.js";

const skillBuild = {
  validateCanonicalSkillAscii,
  validateCanonicalSkillMarkdownWrapping,
  validateRepositoryEvaluationLayout,
};

const VALID_EVALUATION = {
  id: 1,
  prompt: "Evaluate the example skill.",
  expected_output: "The example skill produces the requested result.",
  files: [],
  expectations: ["The output contains the requested result."],
};
const VALID_TRIGGERS = [
  { query: "Use the example skill for this task.", should_trigger: true },
  { query: "Handle this adjacent task another way.", should_trigger: false },
];

function writeTriggerEvaluations(directory, triggers = VALID_TRIGGERS) {
  writeFileSync(
    join(directory, "trigger-evals.json"),
    JSON.stringify(triggers),
  );
}

function createEvaluationLayout(
  t,
  { definition, triggers = VALID_TRIGGERS, triggerSource },
) {
  const root = mkdtempSync(join(tmpdir(), "skill-evaluation-contract-"));
  const skillsRoot = join(root, "skills");
  const evaluationsRoot = join(root, "evals");
  const skill = join(skillsRoot, "example-skill");
  const evaluationSuite = join(evaluationsRoot, "example-skill");

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(evaluationSuite, "fixtures"), { recursive: true });
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "# Example skill\n");
  writeFileSync(join(evaluationSuite, "fixtures", "sample.txt"), "fixture\n");
  writeFileSync(
    join(evaluationSuite, "evals.json"),
    JSON.stringify(definition),
  );

  if (triggerSource !== undefined) {
    writeFileSync(join(evaluationSuite, "trigger-evals.json"), triggerSource);
  } else if (triggers !== null) {
    writeTriggerEvaluations(evaluationSuite, triggers);
  }

  return { evaluationsRoot, skillsRoot };
}

test("canonical skill validation accepts ASCII-only SKILL.md files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-ascii-pass-"));
  const skill = join(root, "example");

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(skill);
  writeFileSync(
    join(skill, "SKILL.md"),
    "# ASCII only\nStraight quotes and hyphens.\n",
  );

  assert.doesNotThrow(() => skillBuild.validateCanonicalSkillAscii(root));
});

test("canonical skill validation rejects a non-ASCII byte with its location", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-ascii-fail-"));
  const skill = join(root, "example");

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(skill);
  writeFileSync(
    join(skill, "SKILL.md"),
    "# Example\nUses an en dash: \u2013\n",
  );

  assert.throws(
    () => skillBuild.validateCanonicalSkillAscii(root),
    /example[\\/]SKILL\.md:2:18 contains non-ASCII byte 0xE2/u,
  );
});

test("canonical skill validation reads only explicitly selected skills", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-ascii-selection-"));
  const selectedSkill = join(root, "selected");
  const unrelatedSkill = join(root, "unrelated");

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(selectedSkill);
  mkdirSync(unrelatedSkill);
  writeFileSync(join(selectedSkill, "SKILL.md"), "# Selected\n");
  writeFileSync(
    join(unrelatedSkill, "SKILL.md"),
    "# Unrelated \u2013 invalid\n",
  );

  assert.equal(
    skillBuild.validateCanonicalSkillAscii(root, {
      skillNames: ["selected"],
    }),
    1,
  );
});

test("canonical skill validation rejects unknown selected skills", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-ascii-unknown-"));

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "selected"));
  writeFileSync(join(root, "selected", "SKILL.md"), "# Selected\n");

  assert.throws(
    () =>
      skillBuild.validateCanonicalSkillAscii(root, {
        skillNames: ["missing"],
      }),
    /Unknown canonical skill: missing/u,
  );
});

test("canonical skill validation keeps recursive all-repository discovery", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-ascii-recursive-"));
  const nestedSkill = join(root, "group", "nested");

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(nestedSkill, { recursive: true });
  writeFileSync(join(nestedSkill, "SKILL.md"), "# Nested \u2013 invalid\n");

  assert.throws(
    () => skillBuild.validateCanonicalSkillAscii(root),
    /group[\\/]nested[\\/]SKILL\.md:1:10 contains non-ASCII byte 0xE2/u,
  );
});

test("canonical skill Markdown validation accepts one-line prose and structural line breaks", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-markdown-wrap-pass-"));
  const skill = join(root, "example");
  const references = join(skill, "references");

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(references, { recursive: true });
  writeFileSync(
    join(skill, "SKILL.md"),
    [
      "# Example skill",
      "",
      "Keep each prose block on one physical line and let the reader soft-wrap it.",
      "",
      "| Input | Result |",
      "| --- | --- |",
      "| prose | readable |",
      "",
      "```text",
      "A code block",
      "may use lines structurally.",
      "```",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(references, "details.md"),
    "# Details\n\nReference prose also stays on one physical line.\n",
  );

  assert.equal(
    await skillBuild.validateCanonicalSkillMarkdownWrapping(root),
    2,
  );
});

for (const [relativePath, source] of [
  ["SKILL.md", "# Example\n\nThis prose was hard-wrapped\nacross two lines.\n"],
  [
    join("references", "details.md"),
    "# Details\n\nThis reference prose was hard-wrapped\nacross two lines.\n",
  ],
]) {
  test(`canonical skill Markdown validation rejects wrapped prose in ${relativePath}`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "skill-markdown-wrap-fail-"));
    const skill = join(root, "example");
    const target = join(skill, relativePath);

    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "# Example\n");
    writeFileSync(target, source);

    await assert.rejects(
      () => skillBuild.validateCanonicalSkillMarkdownWrapping(root),
      (error) => {
        assert.match(error.message, /one physical line/u);
        assert.ok(error.message.includes(relativePath));
        assert.match(error.message, /:3:1/u);
        return true;
      },
    );
  });
}

test("canonical skill Markdown validation isolates explicitly selected skills", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-markdown-wrap-selection-"));
  const selectedSkill = join(root, "selected");
  const unrelatedSkill = join(root, "unrelated");

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(selectedSkill);
  mkdirSync(unrelatedSkill);
  writeFileSync(join(selectedSkill, "SKILL.md"), "# Selected\n");
  writeFileSync(
    join(unrelatedSkill, "SKILL.md"),
    "# Unrelated\n\nWrapped prose in an unrelated\nskill is out of scope.\n",
  );

  assert.equal(
    await skillBuild.validateCanonicalSkillMarkdownWrapping(root, {
      skillNames: ["selected"],
    }),
    1,
  );
});

test("repository evaluation suites resolve beside rather than inside deployable skills", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-evaluation-layout-pass-"));
  const skillsRoot = join(root, "skills");
  const evaluationsRoot = join(root, "evals");
  const skill = join(skillsRoot, "example-skill");
  const evaluation = join(evaluationsRoot, "example-skill");

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(evaluation, "fixtures"), { recursive: true });
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "# Example skill\n");
  writeFileSync(join(evaluation, "fixtures", "sample.txt"), "fixture\n");
  writeFileSync(
    join(evaluation, "evals.json"),
    JSON.stringify({
      skill_name: "example-skill",
      evals: [
        {
          id: 1,
          prompt: "Read the supplied fixture.",
          expected_output: "The output includes the fixture content.",
          files: ["fixtures/sample.txt"],
          expectations: ["The output includes the fixture content."],
        },
      ],
    }),
  );
  writeTriggerEvaluations(evaluation);

  assert.deepEqual(
    skillBuild.validateRepositoryEvaluationLayout({
      skillsRoot,
      evaluationsRoot,
    }),
    {
      deployableSkillsValidated: 1,
      evaluationFileReferencesValidated: 1,
      evaluationSuitesValidated: 1,
    },
  );
});

test("repository evaluation validation isolates explicitly selected skills", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-evaluation-selection-"));
  const skillsRoot = join(root, "skills");
  const evaluationsRoot = join(root, "evals");

  t.after(() => rmSync(root, { recursive: true, force: true }));

  for (const skillName of ["selected", "unrelated"]) {
    const skill = join(skillsRoot, skillName);
    const suite = join(evaluationsRoot, skillName);
    mkdirSync(skill, { recursive: true });
    mkdirSync(suite, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), `# ${skillName}\n`);
    writeFileSync(
      join(suite, "evals.json"),
      skillName === "selected"
        ? JSON.stringify({
            skill_name: skillName,
            evals: [VALID_EVALUATION],
          })
        : "{",
    );
    writeTriggerEvaluations(suite);
  }

  assert.deepEqual(
    skillBuild.validateRepositoryEvaluationLayout({
      skillsRoot,
      evaluationsRoot,
      skillNames: ["selected"],
    }),
    {
      deployableSkillsValidated: 1,
      evaluationFileReferencesValidated: 0,
      evaluationSuitesValidated: 1,
    },
  );
});

test("repository evaluation validation allows a selected skill without a suite", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-evaluation-no-suite-"));
  const skillsRoot = join(root, "skills");
  const evaluationsRoot = join(root, "evals");

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(skillsRoot, "selected"), { recursive: true });
  mkdirSync(evaluationsRoot, { recursive: true });
  writeFileSync(join(skillsRoot, "selected", "SKILL.md"), "# Selected\n");

  assert.deepEqual(
    skillBuild.validateRepositoryEvaluationLayout({
      skillsRoot,
      evaluationsRoot,
      skillNames: ["selected"],
    }),
    {
      deployableSkillsValidated: 1,
      evaluationFileReferencesValidated: 0,
      evaluationSuitesValidated: 0,
    },
  );
});

for (const [label, definition, expectedMessage] of [
  [
    "a non-object behavioral root",
    null,
    /evals\.json must contain a JSON object/u,
  ],
  [
    "an empty behavioral case array",
    { skill_name: "example-skill", evals: [] },
    /evals\.json must contain a non-empty evals array/u,
  ],
  [
    "a non-object behavioral case",
    { skill_name: "example-skill", evals: [null] },
    /evals\.json eval at index 0 must be a JSON object/u,
  ],
  [
    "a non-positive behavioral case id",
    {
      skill_name: "example-skill",
      evals: [{ ...VALID_EVALUATION, id: 0 }],
    },
    /evals\.json eval at index 0 must have a positive integer id/u,
  ],
  [
    "duplicate behavioral case ids",
    {
      skill_name: "example-skill",
      evals: [VALID_EVALUATION, { ...VALID_EVALUATION }],
    },
    /evals\.json contains duplicate evaluation id 1/u,
  ],
  [
    "a blank behavioral prompt",
    {
      skill_name: "example-skill",
      evals: [{ ...VALID_EVALUATION, prompt: "  " }],
    },
    /evals\.json eval 1 must contain a non-empty prompt/u,
  ],
  [
    "a blank behavioral expected output",
    {
      skill_name: "example-skill",
      evals: [{ ...VALID_EVALUATION, expected_output: "\t" }],
    },
    /evals\.json eval 1 must contain a non-empty expected_output/u,
  ],
  [
    "duplicate behavioral expectations",
    {
      skill_name: "example-skill",
      evals: [
        {
          ...VALID_EVALUATION,
          expectations: ["A grounded result.", " A grounded result. "],
        },
      ],
    },
    /evals\.json eval 1 contains duplicate expectation/u,
  ],
  [
    "duplicate behavioral file references",
    {
      skill_name: "example-skill",
      evals: [
        {
          ...VALID_EVALUATION,
          files: ["fixtures/sample.txt", "fixtures/sample.txt"],
        },
      ],
    },
    /evals\.json eval 1 contains duplicate file reference/u,
  ],
]) {
  test(`repository evaluation layout rejects ${label}`, (t) => {
    const { evaluationsRoot, skillsRoot } = createEvaluationLayout(t, {
      definition,
    });

    assert.throws(
      () =>
        skillBuild.validateRepositoryEvaluationLayout({
          skillsRoot,
          evaluationsRoot,
        }),
      expectedMessage,
    );
  });
}

for (const [label, triggerOptions, expectedMessage] of [
  [
    "a missing trigger manifest",
    { triggers: null },
    /trigger-evals\.json is required/u,
  ],
  [
    "malformed trigger JSON",
    { triggerSource: "{" },
    /trigger-evals\.json is not valid JSON/u,
  ],
  [
    "a non-array trigger root",
    { triggerSource: "{}" },
    /trigger-evals\.json must contain a non-empty array/u,
  ],
  [
    "an empty trigger array",
    { triggers: [] },
    /trigger-evals\.json must contain a non-empty array/u,
  ],
  [
    "a non-object trigger case",
    { triggers: [null, ...VALID_TRIGGERS] },
    /trigger-evals\.json entry at index 0 must be a JSON object/u,
  ],
  [
    "an unknown trigger field",
    {
      triggers: [
        { ...VALID_TRIGGERS[0], note: "unexpected" },
        VALID_TRIGGERS[1],
      ],
    },
    /trigger-evals\.json entry at index 0 must contain exactly query and should_trigger/u,
  ],
  [
    "a blank trigger query",
    {
      triggers: [{ query: "  ", should_trigger: true }, VALID_TRIGGERS[1]],
    },
    /trigger-evals\.json entry at index 0 must contain a non-empty query/u,
  ],
  [
    "a non-boolean trigger decision",
    {
      triggers: [
        { query: "Use the example skill.", should_trigger: "true" },
        VALID_TRIGGERS[1],
      ],
    },
    /trigger-evals\.json entry at index 0 must contain a boolean should_trigger/u,
  ],
  [
    "normalized duplicate trigger queries",
    {
      triggers: [
        { query: " Define this concept ", should_trigger: true },
        { query: "define THIS concept", should_trigger: false },
      ],
    },
    /trigger-evals\.json contains duplicate query/u,
  ],
  [
    "a positive-only trigger set",
    {
      triggers: [{ query: "Use the example skill.", should_trigger: true }],
    },
    /trigger-evals\.json must contain at least one should-trigger and one should-not-trigger case/u,
  ],
  [
    "a negative-only trigger set",
    {
      triggers: [{ query: "Use another skill.", should_trigger: false }],
    },
    /trigger-evals\.json must contain at least one should-trigger and one should-not-trigger case/u,
  ],
]) {
  test(`repository evaluation layout rejects ${label}`, (t) => {
    const { evaluationsRoot, skillsRoot } = createEvaluationLayout(t, {
      definition: {
        skill_name: "example-skill",
        evals: [VALID_EVALUATION],
      },
      ...triggerOptions,
    });

    assert.throws(
      () =>
        skillBuild.validateRepositoryEvaluationLayout({
          skillsRoot,
          evaluationsRoot,
        }),
      expectedMessage,
    );
  });
}

for (const [label, evaluation, expectedMessage] of [
  [
    "legacy assertions",
    {
      id: 1,
      files: [],
      assertions: ["The output includes the fixture content."],
    },
    /must use expectations instead of assertions/u,
  ],
  [
    "missing expectations",
    { id: 1, files: [] },
    /must contain a non-empty expectations array/u,
  ],
  [
    "empty expectation text",
    { id: 1, files: [], expectations: [""] },
    /contains an expectation that is not a non-empty string/u,
  ],
]) {
  test(`repository evaluation layout rejects ${label}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "skill-evaluation-schema-fail-"));
    const skillsRoot = join(root, "skills");
    const evaluationsRoot = join(root, "evals");
    const skill = join(skillsRoot, "example-skill");
    const evaluationSuite = join(evaluationsRoot, "example-skill");

    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(skill, { recursive: true });
    mkdirSync(evaluationSuite, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "# Example skill\n");
    writeFileSync(
      join(evaluationSuite, "evals.json"),
      JSON.stringify({
        skill_name: "example-skill",
        evals: [
          {
            prompt: "Evaluate the example skill.",
            expected_output: "The example skill produces the requested result.",
            ...evaluation,
          },
        ],
      }),
    );
    writeTriggerEvaluations(evaluationSuite);

    assert.throws(
      () =>
        skillBuild.validateRepositoryEvaluationLayout({
          skillsRoot,
          evaluationsRoot,
        }),
      expectedMessage,
    );
  });
}

for (const maintainerDirectory of ["evals", ".plugin-eval"]) {
  test(`repository evaluation layout rejects ${maintainerDirectory} inside a deployable skill`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "skill-evaluation-layout-fail-"));
    const skillsRoot = join(root, "skills");
    const evaluationsRoot = join(root, "evals");
    const skill = join(skillsRoot, "example-skill");

    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(skill, maintainerDirectory), { recursive: true });
    mkdirSync(evaluationsRoot);
    writeFileSync(join(skill, "SKILL.md"), "# Example skill\n");

    assert.throws(
      () =>
        skillBuild.validateRepositoryEvaluationLayout({
          skillsRoot,
          evaluationsRoot,
        }),
      (error) => {
        assert.match(error.message, /skills[\\/]example-skill/u);
        assert.ok(error.message.includes(maintainerDirectory));
        assert.match(error.message, /deployable/u);
        return true;
      },
    );
  });
}

test("repository evaluation layout rejects a suite without its canonical skill", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-evaluation-orphan-fail-"));
  const skillsRoot = join(root, "skills");
  const evaluationsRoot = join(root, "evals");
  const evaluation = join(evaluationsRoot, "missing-skill");

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(skillsRoot);
  mkdirSync(evaluation, { recursive: true });
  writeFileSync(
    join(evaluation, "evals.json"),
    JSON.stringify({
      skill_name: "missing-skill",
      evals: [VALID_EVALUATION],
    }),
  );
  writeTriggerEvaluations(evaluation);

  assert.throws(
    () =>
      skillBuild.validateRepositoryEvaluationLayout({
        skillsRoot,
        evaluationsRoot,
      }),
    /evals[\\/]missing-skill.*skills[\\/]missing-skill[\\/]SKILL\.md/u,
  );
});

test("repository evaluation layout rejects mismatched suites and escaped fixtures", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-evaluation-content-fail-"));
  const skillsRoot = join(root, "skills");
  const evaluationsRoot = join(root, "evals");
  const skill = join(skillsRoot, "example-skill");
  const evaluation = join(evaluationsRoot, "example-skill");

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(skill, { recursive: true });
  mkdirSync(evaluation, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "# Example skill\n");
  writeFileSync(join(evaluationsRoot, "outside.txt"), "outside\n");
  writeFileSync(
    join(evaluation, "evals.json"),
    JSON.stringify({
      skill_name: "different-skill",
      evals: [
        {
          ...VALID_EVALUATION,
          files: ["../outside.txt"],
        },
      ],
    }),
  );
  writeTriggerEvaluations(evaluation);

  assert.throws(
    () =>
      skillBuild.validateRepositoryEvaluationLayout({
        skillsRoot,
        evaluationsRoot,
      }),
    (error) => {
      assert.match(error.message, /declares skill_name "different-skill"/u);
      assert.match(error.message, /missing or out-of-suite file/u);
      return true;
    },
  );
});
