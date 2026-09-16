import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import {
  packagePluginArchive,
  zipArchive,
  zipMembers,
} from "../../scripts/packagePluginArchive.js";

const REPOSITORY_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

test("archive members round-trip through the writer and reader", () => {
  const members = [
    ["a.txt", Buffer.from("alpha\n")],
    ["dir/b.bin", Buffer.from([0, 1, 2, 255])],
    ["empty", Buffer.alloc(0)],
  ];

  assert.deepEqual([...zipMembers(zipArchive(members))], members);
  assert.equal(
    zipArchive(members).equals(zipArchive(members)),
    true,
    "the same members produce the same bytes",
  );
});

test("the desktop archive holds the plugin at its root plus the desktop manifest", () => {
  const output = mkdtempSync(join(tmpdir(), "agent-skills-archive-"));

  try {
    const result = packagePluginArchive({
      skillName: "committing-to-git",
      outputDirectory: output,
      repositoryRoot: REPOSITORY_ROOT,
    });
    const members = zipMembers(readFileSync(result.archivePath));

    assert.equal(
      basename(result.archivePath),
      `committing-to-git-${result.manifest.version}-antigravity-desktop.zip`,
    );
    assert.deepEqual(JSON.parse(members.get("plugin.json")), {
      name: "committing-to-git",
    });
    assert.equal(
      members.get(".claude-plugin/plugin.json").toString(),
      readFileSync(
        join(
          REPOSITORY_ROOT,
          "plugins/committing-to-git/.claude-plugin/plugin.json",
        ),
        "utf8",
      ),
    );
    assert.ok(
      members.has("skills/committing-to-git/scripts/commitWorkflow.mjs"),
    );
    assert.equal(members.size, result.memberCount);
    assert.throws(
      () =>
        packagePluginArchive({
          skillName: "committing-to-git",
          outputDirectory: output,
          repositoryRoot: REPOSITORY_ROOT,
        }),
      /never overwritten/u,
    );
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
