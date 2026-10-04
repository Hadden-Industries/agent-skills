import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import test from "node:test";
import { regularFileInventory } from "../../scripts/skillDistribution.js";
import {
  canonicalJsonBytes,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";
test("runtime inventory matches 57 maintained payload identities and approved JSON formatting", () => {
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
  for (const file of baseline) {
    const bytes = actual.get(file.path.slice("skills/".length));
    assert.ok(bytes, file.path);
    const formatting = approved.find(({ path }) => path === file.path);
    const change = maintenance.find(({ path }) => path === file.path);
    if (change) {
      assert.equal(change.originalSha256, file.sha256, file.path);
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
      bytes.length,
      (change ?? formatting ?? file).byteLength,
      file.path,
    );
    assert.equal(
      sha256Hex(bytes),
      (change ?? formatting ?? file).sha256,
      file.path,
    );
  }
});
