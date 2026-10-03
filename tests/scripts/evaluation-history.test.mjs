import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("historical relocation reconciles the complete preserved checkout inventory", () => {
  const manifest = JSON.parse(
    readFileSync(
      resolve(root, "evidence/migrations/2026-10-03-historical-results.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.byteAuthority, "working-tree");
  assert.equal(manifest.files.length, 412);
  assert.equal(new Set(manifest.files.map((file) => file.newPath)).size, 412);
  const differences = [];
  for (const file of manifest.files) {
    assert.match(
      file.newPath,
      /^evidence\/historical\/(committing-to-git|defining-concepts)\//u,
    );
    assert.ok(!file.newPath.split("/").includes(".."));
    const bytes = readFileSync(resolve(root, file.newPath));
    assert.equal(bytes.length, file.byteLength, file.newPath);
    assert.equal(digest(bytes), file.sha256, file.newPath);
    assert.equal(existsSync(resolve(root, file.oldPath)), false, file.oldPath);
    if (file.gitSha256 !== file.sha256) {
      differences.push(file);
      const normalized = Buffer.from(
        bytes.toString("latin1").replaceAll("\r\n", "\n"),
        "latin1",
      );
      assert.equal(normalized.length, file.gitByteLength);
      assert.equal(digest(normalized), file.gitSha256);
      assert.equal(file.disposition, "owner-approved-checkout-CRLF-preserved");
    } else {
      assert.equal(file.disposition, "byte-identical");
    }
  }
  assert.equal(differences.length, 2);
  assert.equal(
    manifest.files.reduce((sum, file) => sum + file.byteLength, 0),
    6028581,
  );
  const actual = readdirSync(resolve(root, "evidence/historical"), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
  assert.deepEqual(
    actual,
    manifest.files.map((file) => resolve(root, file.newPath)).sort(),
  );
});
