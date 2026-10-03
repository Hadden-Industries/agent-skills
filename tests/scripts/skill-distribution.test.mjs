import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildSkillArtifacts } from "../../scripts/buildSkillArtifacts.js";
import { regularFileInventory } from "../../scripts/skillDistribution.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
test("fresh distribution builds are deterministic and check mode is read-only", async (t) => {
  const roots = [0, 1].map(() =>
    mkdtempSync(join(tmpdir(), "skill-distribution-")),
  );
  t.after(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });
  for (const root of roots) {
    mkdirSync(join(root, "src"));
    cpSync(
      join(repositoryRoot, "src/reading-epubs"),
      join(root, "src/reading-epubs"),
      { recursive: true },
    );
    const stale = await buildSkillArtifacts({
      repositoryRoot: root,
      checkOnly: true,
    });
    assert.equal(stale.staleArtifacts.length, 12);
    assert.throws(
      () => readFileSync(join(root, "skills/reading-epubs/SKILL.md")),
      /ENOENT/u,
    );
    await buildSkillArtifacts({ repositoryRoot: root });
    assert.deepEqual(
      (await buildSkillArtifacts({ repositoryRoot: root, checkOnly: true }))
        .staleArtifacts,
      [],
    );
  }
  assert.deepEqual(
    regularFileInventory(join(roots[0], "skills")),
    regularFileInventory(join(roots[1], "skills")),
  );
  const file = join(roots[0], "skills/reading-epubs/SKILL.md");
  writeFileSync(file, "stale");
  assert.deepEqual(
    (await buildSkillArtifacts({ repositoryRoot: roots[0], checkOnly: true }))
      .staleArtifacts,
    ["skills/reading-epubs/SKILL.md"],
  );
  assert.equal(readFileSync(file, "utf8"), "stale");
  // Rebuilding an existing file must replace from offset zero, without a hole
  // after the descriptor read or leftover bytes from the previous payload.
  await buildSkillArtifacts({ repositoryRoot: roots[0] });
  assert.deepEqual(
    readFileSync(file),
    readFileSync(join(roots[0], "src/reading-epubs/SKILL.md")),
  );
  writeFileSync(file, "stale");
  writeFileSync(
    join(roots[0], "skills/reading-epubs/unexpected.txt"),
    "preserve me",
  );
  await assert.rejects(
    buildSkillArtifacts({ repositoryRoot: roots[0] }),
    /requires disposition/u,
  );
  assert.equal(readFileSync(file, "utf8"), "stale");
});
