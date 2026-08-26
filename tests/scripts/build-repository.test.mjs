import assert from "node:assert/strict";
import test from "node:test";

import { buildRepository } from "../../scripts/buildRepository.js";

test("repository build composes scoped validation and artifact checks", async () => {
  const result = await buildRepository({
    checkOnly: true,
    skillNames: ["defining-concepts"],
  });

  assert.deepEqual(result, {
    artifactsChecked: 0,
    deployableSkillsValidated: 1,
    evaluationFileReferencesValidated: 0,
    evaluationSuitesValidated: 1,
    markdownFilesValidated: 2,
    skillFilesValidated: 1,
    staleArtifacts: [],
  });
});

test("repository build preserves full-repository validation counts", async () => {
  const result = await buildRepository({ checkOnly: true });

  assert.deepEqual(result.staleArtifacts, []);
  assert.equal(result.artifactsChecked, 1);
  assert.equal(result.deployableSkillsValidated, 3);
  assert.equal(result.evaluationSuitesValidated, 3);
  assert.equal(result.evaluationFileReferencesValidated, 5);
  assert.equal(result.markdownFilesValidated, 12);
  assert.ok(result.skillFilesValidated > 0);
});
