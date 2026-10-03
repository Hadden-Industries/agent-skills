import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
const skill = path.join(root, "skills/naming-objects-in-software-engineering");
const checker = path.join(skill, "scripts/check-name.py");
const policy = JSON.parse(
  readFileSync(path.join(skill, "assets/naming-policy.json"), "utf8"),
);
test("installed lexical checker characterizes every artifact profile without certifying semantics", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "naming-checker-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (kind, name) =>
    spawnSync(
      "python",
      ["-B", checker, "--kind", kind, `--name=${name}`, "--json"],
      { cwd, encoding: "utf8", windowsHide: true, timeout: 10000 },
    );
  const examples = [];
  for (const [kind, profile] of Object.entries(policy.profiles)) {
    for (const [field, expected] of [
      ["valid_examples", true],
      ["invalid_examples", false],
    ])
      for (const name of profile[field] ?? []) {
        examples.push({ kind, name, expected });
      }
  }
  // Exercise every installed-script entry point without paying for hundreds
  // of interpreter launches. Real CLI checks below retain process-exit coverage.
  const batch = spawnSync(
    "python",
    [
      "-B",
      path.join(import.meta.dirname, "fixtures/check-installed-examples.py"),
      checker,
    ],
    {
      cwd,
      input: JSON.stringify(examples),
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    },
  );
  assert.ifError(batch.error);
  assert.equal(batch.status, 0, batch.stderr);
  const results = JSON.parse(batch.stdout);
  assert.equal(results.length, examples.length);
  for (const [index, { kind, name, expected }] of examples.entries()) {
    const result = results[index];
    assert.equal(result.status, expected ? 0 : 1, `${kind}: ${name}`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, kind);
    assert.equal(report.name, name);
    assert.equal(report.lexical_valid, expected, `${kind}: ${name}`);
    assert.equal(report.semantic_certified, false);
  }
  for (const expected of [true, false]) {
    const example = examples.find((item) => item.expected === expected);
    assert.ok(example);
    const result = run(example.kind, example.name);
    assert.ifError(result.error);
    assert.equal(result.status, expected ? 0 : 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.lexical_valid, expected);
    assert.equal(report.semantic_certified, false);
  }
  const invalid = run("unknown-artifact-kind", "valid_name");
  assert.ifError(invalid.error);
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stdout).semantic_certified, false);
});
