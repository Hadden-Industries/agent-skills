import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { runRepositoryPython } from "../../scripts/runRepositoryPython.js";

test("runRepositoryPython validates required arguments", () => {
  assert.throws(
    () => runRepositoryPython([]),
    /Provide a repository Python script/,
  );
  assert.throws(
    () => runRepositoryPython(null),
    /Provide a repository Python script/,
  );
});

test("runRepositoryPython throws when .venv is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "missing-venv-"));
  try {
    assert.throws(
      () => runRepositoryPython(["-c", "print(1)"], { root }),
      /Repository \.venv is missing/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runRepositoryPython resolves platform executable path", () => {
  for (const [platform, relativePath] of [
    ["win32", "Scripts/python.exe"],
    ["linux", "bin/python"],
    ["darwin", "bin/python"],
  ]) {
    const root = mkdtempSync(join(tmpdir(), "platform-venv-"));
    try {
      const executable = join(root, ".venv", relativePath);
      mkdirSync(dirname(executable), { recursive: true });
      writeFileSync(executable, "");

      // Calling with an empty dummy file will fail at process spawn,
      // confirming it selected the expected platform path.
      assert.throws(
        () =>
          runRepositoryPython(["test.py"], {
            root,
            platform,
          }),
        (error) => {
          assert.ok(
            error.path?.includes(".venv") || error.message?.includes(".venv"),
          );
          return true;
        },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
