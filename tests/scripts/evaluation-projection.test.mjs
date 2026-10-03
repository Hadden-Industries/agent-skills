import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { compileSuite } from "../../scripts/evaluation/compile-suite.js";
import { projectSkillUp } from "../../scripts/evaluation/project-skill-up.js";
import { createConsumerWorkspace } from "../../scripts/evaluation/consumer-workspace.js";
import { regularFileInventory } from "../../scripts/skillDistribution.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
test("projection round-trips exact authored strings without promoting natural language to rules", () => {
  const suite = compileSuite({
    repositoryRoot,
    skillName: "defining-concepts",
  });
  const first = projectSkillUp(suite);
  assert.deepEqual(projectSkillUp(suite), first);
  for (const file of first.cases) {
    const value = suite.cases.find(({ id }) => id === file.id);
    const parsed = parse(file.yaml);
    assert.equal(parsed.input.prompt, value.prompt);
    assert.deepEqual(JSON.parse(parsed.description), {
      expected_output: value.expected_output,
      assertions: value.assertions,
    });
    assert.deepEqual(parsed.expect, { exit_code: 0 });
    assert.equal(parsed.input.turns, undefined);
    assert.deepEqual(file.eligibleClaims, [
      "format-conformance",
      "initial-input-delivery",
    ]);
  }
  assert.match(
    first.cases.find(({ id }) => id === 10).coverage.follow_up_turns,
    /unsupported/u,
  );
  assert.throws(() => projectSkillUp(suite, { caseIds: [1, 1] }), /distinct/u);
  assert.throws(() => projectSkillUp(suite, { caseIds: [99] }), /Unknown/u);
});

test("portable EPUB workspace includes exact distribution and binary fixture without source or private records", (t) => {
  const compiled = compileSuite({ repositoryRoot, skillName: "reading-epubs" });
  const workspace = createConsumerWorkspace({ repositoryRoot, compiled });
  t.after(() => rmSync(workspace.root, { recursive: true, force: true }));
  const files = regularFileInventory(workspace.skillRoot);
  for (const file of compiled.distribution)
    assert.deepEqual(
      files.get(file.relativePath),
      readFileSync(
        join(repositoryRoot, "skills/reading-epubs", file.relativePath),
      ),
    );
  assert.deepEqual(
    files.get("evals/files/sample.epub"),
    readFileSync(
      join(repositoryRoot, "src/reading-epubs/evals/files/sample.epub"),
    ),
  );
  assert.equal(files.size, compiled.distribution.length + 1 + 1 + 5);
  assert.ok(
    [...files.keys()].every(
      (file) =>
        !/assurance|extensions|historical|authorization|projection-receipt/u.test(
          file,
        ),
    ),
  );
});
