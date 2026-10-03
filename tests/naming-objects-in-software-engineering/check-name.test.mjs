import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
const skill = path.join(root, "skills/naming-objects-in-software-engineering");
const policy = JSON.parse(
  readFileSync(path.join(skill, "assets/naming-policy.json"), "utf8"),
);
test("installed lexical checker characterizes every artifact profile without certifying semantics", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "naming-checker-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (kind, name) =>
    spawnSync(
      "python",
      [
        "-B",
        path.join(skill, "scripts/check-name.py"),
        "--kind",
        kind,
        `--name=${name}`,
        "--json",
      ],
      { cwd, encoding: "utf8", windowsHide: true, timeout: 10000 },
    );
  for (const [kind, profile] of Object.entries(policy.profiles)) {
    for (const [field, expected] of [
      ["valid_examples", true],
      ["invalid_examples", false],
    ])
      for (const name of profile[field] ?? []) {
        const result = run(kind, name);
        assert.equal(
          result.status,
          expected ? 0 : 1,
          `${kind}: ${name}: ${result.stderr}`,
        );
        const report = JSON.parse(result.stdout);
        assert.equal(report.lexical_valid, expected);
        assert.equal(report.semantic_certified, false);
      }
  }
  const invalid = run("unknown-artifact-kind", "valid_name");
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stdout).semantic_certified, false);
});
