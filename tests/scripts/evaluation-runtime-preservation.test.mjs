import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import test from "node:test";
import { regularFileInventory } from "../../scripts/skillDistribution.js";
import {
  canonicalJsonBytes,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";
test("runtime inventory matches 57 maintained payload identities and approved runtime maintenance", () => {
  const root = resolve(import.meta.dirname, "../..");
  const baseline = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/runtime-identities.json",
      ),
      "utf8",
    ),
  );
  const actual = regularFileInventory(join(root, "skills"));
  // Keep the migration baseline immutable; bind later maintenance to exact bytes.
  const maintenance = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/issue-12-runtime-changes.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(maintenance.map(({ path }) => path).sort(), [
    "skills/committing-to-git/references/diagnostics.md",
    "skills/committing-to-git/references/publication-routing.md",
    "skills/committing-to-git/scripts/commitWorkflow.mjs",
  ]);
  const performance = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/committing-performance-runtime-change.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(
    performance.map(({ path }) => path),
    ["skills/committing-to-git/scripts/commitWorkflow.mjs"],
  );
  const approved = JSON.parse(
    readFileSync(
      join(
        root,
        "evidence/migrations/2026-10-03-approved-json-formatting.json",
      ),
      "utf8",
    ),
  ).files;
  assert.deepEqual(approved.map(({ path }) => path).sort(), [
    "skills/naming-objects-in-software-engineering/assets/naming-policy.json",
    "skills/reading-epubs/scripts/conversion-result.schema.json",
  ]);
  assert.equal(baseline.length, 57);
  assert.equal(actual.size, 57);
  const releaseVersion = JSON.parse(
    readFileSync(join(root, "scripts/plugin-releases.json"), "utf8"),
  ).plugins["committing-to-git"].at(-1).version;
  const metadataVersions = new Map([
    ["skills/committing-to-git/SKILL.md", releaseVersion],
    ["skills/defining-concepts/SKILL.md", "0.1.0-dev.1"],
    ["skills/naming-objects-in-software-engineering/SKILL.md", "0.1.0-dev.1"],
  ]);
  for (const file of baseline) {
    const bytes = actual.get(file.path.slice("skills/".length));
    assert.ok(bytes, file.path);
    let comparisonBytes = bytes;
    if (metadataVersions.has(file.path)) {
      // Keep the historical oracle intact: only the exact approved version
      // insertion may be removed, and it must occur once in frontmatter.
      const text = bytes.toString("utf8");
      assert.ok(Buffer.from(text, "utf8").equals(bytes), file.path);
      const boundary = text.indexOf("\n---", 4);
      assert.ok(boundary > 4, file.path);
      const frontmatter = text.slice(0, boundary + 1);
      const line = `  version: "${metadataVersions.get(file.path)}"\n`;
      assert.equal(frontmatter.split(line).length, 2, file.path);
      comparisonBytes = Buffer.from(
        frontmatter.replace(line, "") + text.slice(boundary + 1),
        "utf8",
      );
    }
    if (file.path === "skills/committing-to-git/scripts/commitWorkflow.mjs") {
      // Preserve the historical hash: reverse only the two approved esbuild
      // source-location labels, requiring each relocated label exactly once.
      let text = bytes.toString("utf8");
      assert.ok(Buffer.from(text, "utf8").equals(bytes), file.path);
      for (const label of [
        "// lib/filesystem/stableFile.js\n",
        '  "lib/filesystem/stableFile.js"() {\n',
      ]) {
        assert.equal(text.split(label).length, 2, file.path);
        text = text.replace(
          label,
          label.replace(
            "lib/filesystem/stableFile.js",
            "src/committing-to-git/filesystem/stableFile.js",
          ),
        );
      }
      comparisonBytes = Buffer.from(text, "utf8");
    }
    const formatting = approved.find(({ path }) => path === file.path);
    const change = maintenance.find(({ path }) => path === file.path);
    const laterChange = performance.find(({ path }) => path === file.path);
    if (change) {
      assert.equal(change.originalSha256, file.sha256, file.path);
      assert.equal(formatting, undefined, file.path);
    }
    if (laterChange) {
      assert.equal(
        laterChange.previousSha256,
        (change ?? file).sha256,
        file.path,
      );
      assert.equal(formatting, undefined, file.path);
    }
    if (formatting) {
      assert.equal(formatting.originalSha256, file.sha256, file.path);
      assert.equal(
        sha256Hex(canonicalJsonBytes(JSON.parse(bytes))),
        formatting.canonicalValueSha256,
        file.path,
      );
    }
    assert.equal(
      comparisonBytes.length,
      (laterChange ?? change ?? formatting ?? file).byteLength,
      file.path,
    );
    assert.equal(
      sha256Hex(comparisonBytes),
      (laterChange ?? change ?? formatting ?? file).sha256,
      file.path,
    );
  }
});
