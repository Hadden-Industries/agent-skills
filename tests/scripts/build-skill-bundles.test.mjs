import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import * as skillBuild from "../../scripts/buildSkillBundles.js";

test("build check accepts the committed repository-level skill bundles", async () => {
  const result = await skillBuild.buildSkillBundles({ checkOnly: true });

  assert.deepEqual(result.staleBundles, []);
  assert.ok(result.skillFilesValidated > 0);
});

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
