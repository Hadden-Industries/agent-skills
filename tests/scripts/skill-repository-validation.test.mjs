import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import { validateSkillRepository } from "../../scripts/validateSkillRepository.js";

test("repository validation composes canonical and evaluation checks", async (t) => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "skill-validation-"));

  t.after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
  mkdirSync(join(repositoryRoot, "skills", "selected"), { recursive: true });
  mkdirSync(join(repositoryRoot, "evals"), { recursive: true });
  writeFileSync(
    join(repositoryRoot, "skills", "selected", "SKILL.md"),
    "# Selected\n",
  );

  assert.deepEqual(
    await validateSkillRepository({
      repositoryRoot,
      skillNames: ["selected"],
    }),
    {
      deployableSkillsValidated: 1,
      evaluationFileReferencesValidated: 0,
      evaluationSuitesValidated: 0,
      markdownFilesValidated: 1,
      skillFilesValidated: 1,
    },
  );
});
