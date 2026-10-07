import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readStableFile } from "../../lib/filesystem/stableFile.js";
import { replaceReleaseFile } from "../../scripts/releaseFile.js";

test("release replacement preserves identity and mode while shortening and extending bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "release-file-control-"));
  try {
    const path = join(root, "release.txt");
    writeFileSync(path, "Original release bytes", { mode: 0o600 });
    for (const replacement of [
      "short",
      "a longer replacement than the original",
      "",
    ]) {
      const snapshot = readStableFile(path, 1024);
      replaceReleaseFile(path, snapshot, Buffer.from(replacement));
      const after = readStableFile(path, 1024);
      assert.equal(after.bytes.toString(), replacement);
      assert.equal(after.stat.ino, snapshot.stat.ino);
      assert.equal(after.stat.mode, snapshot.stat.mode);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const change of [
  "edited",
  "replaced",
  "hard-linked",
  "removed",
  "directory",
  "mode",
]) {
  test(`release replacement refuses ${change} input without overwriting it`, () => {
    const root = mkdtempSync(join(tmpdir(), "release-file-stale-"));
    try {
      const path = join(root, "release.txt");
      const retained = join(root, "retained.txt");
      writeFileSync(path, "Original release bytes");
      const snapshot = readStableFile(path, 1024);
      if (change === "edited") writeFileSync(path, "Someone else's release");
      if (change === "replaced") {
        renameSync(path, retained);
        writeFileSync(path, snapshot.bytes);
      }
      if (change === "hard-linked") linkSync(path, retained);
      if (change === "removed" || change === "directory")
        renameSync(path, retained);
      if (change === "directory") mkdirSync(path);
      if (change === "mode") chmodSync(path, 0o400);
      const expected =
        change === "edited"
          ? "Someone else's release"
          : "Original release bytes";
      assert.throws(() =>
        replaceReleaseFile(path, snapshot, Buffer.from("Overwritten")),
      );
      if (change === "removed" || change === "directory")
        assert.equal(readFileSync(retained, "utf8"), expected);
      else assert.equal(readFileSync(path, "utf8"), expected);
      if (change === "replaced" || change === "hard-linked")
        assert.equal(readFileSync(retained, "utf8"), "Original release bytes");
      if (change === "mode") chmodSync(path, 0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
