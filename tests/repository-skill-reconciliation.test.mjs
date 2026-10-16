import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const localPython = join(
  fileURLToPath(root),
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const python = existsSync(localPython) ? localPython : "python";

test("shared skill CLI source and recovery contracts", (context) => {
  const result = spawnSync(
    python,
    [
      "-B",
      "-m",
      "unittest",
      "discover",
      "-s",
      "packages/repository-skill-reconciliation/tests",
      "-v",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const summary = result.stderr.match(/Ran (\d+) tests? in [^\r\n]+/);
  assert.ok(
    summary && Number(summary[1]) > 0,
    "Shared source tests were not discovered.",
  );
  context.diagnostic(summary[0]);
});

test("deployed archive contains the current shared implementation", () => {
  const result = spawnSync(
    python,
    [
      "-B",
      "packages/repository-skill-reconciliation/build_archive.py",
      "--check",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
