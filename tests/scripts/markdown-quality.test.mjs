import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const {
  inspectSelection,
  readExecutionProfile,
  runQuality,
  validateQualityResult,
} = await import("@hadden-industries/markdown-quality");
const packageRoot = resolve(
  dirname(
    fileURLToPath(import.meta.resolve("@hadden-industries/markdown-quality")),
  ),
  "..",
);
const manifest = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
);
const cli = join(packageRoot, manifest.bin["markdown-quality"]);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "agent skills markdown "));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    join(directory, ".markdown-quality.json"),
    JSON.stringify({
      ...readJson(join(root, ".markdown-quality.json")),
      include: ["**/*.md"],
      exclude: ["excluded/**"],
    }),
  );
  return directory;
}

test("root lock owns the installed core and matching native platform packages", () => {
  const lock = readJson(join(root, "package-lock.json"));
  assert.equal(lock.packages[""].devDependencies[manifest.name], ">=3.0.0");
  assert.equal(
    lock.packages[`node_modules/${manifest.name}`].version,
    manifest.version,
  );
  for (const platform of ["win32-x64", "linux-x64"]) {
    const entry = lock.packages[`node_modules/${manifest.name}-${platform}`];
    assert.equal(entry.version, manifest.version);
    assert.equal(entry.optional, true);
    assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//u);
  }
  const profile = readExecutionProfile({ root });
  assert.equal(profile.schemaVersion, 2);
  assert.equal(profile.executionTimeoutMs, 30000);
});

test("Markdown root policy accounts for tracked inventory and agrees with explicit selection", async () => {
  const report = await inspectSelection({
    root,
    reconciliationInventory: "git",
  });
  assert.equal(report.schemaVersion, 5);
  assert.equal(report.preset, "authored-gfm@2");
  validateQualityResult(report, { operation: "inspect", exitCode: 0 });
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter((path) => path.endsWith(".md"));
  assert.deepEqual(
    report.selection.reconciliationDecisions.map((item) => item.path).sort(),
    tracked.sort(),
  );
  const selected = [
    "README.md",
    "AGENTS.md",
    "src/defining-concepts/SKILL.md",
    "src/reading-epubs/references/conversion-troubleshooting.md",
  ];
  const excluded = [
    "skills/defining-concepts/SKILL.md",
    "src/defining-concepts/evals/README.md",
    "docs/plans/2026-10-10-markdown-quality-centralization.md",
  ];
  for (const path of selected)
    assert.ok(report.selection.files.includes(path), path);
  for (const path of excluded)
    assert.ok(!report.selection.files.includes(path), path);
  const explicit = await inspectSelection({
    root,
    files: [...selected, ...excluded],
  });
  validateQualityResult(explicit, { operation: "inspect", exitCode: 0 });
  assert.deepEqual([...explicit.selection.files].sort(), selected.sort());
});

test("installed formatter preserves skill metadata, literal commands and rendered hard breaks and converges", async (t) => {
  const directory = fixture(t);
  const metadata =
    "---\nname: example-skill\ndescription: Preserve exact skill metadata.\n---\n";
  const code = '```sh\nprintf "%s\\n" "$HOME"\n```';
  writeFileSync(
    join(directory, "SKILL.md"),
    `${metadata}\n# Example\n\nFirst sentence. Second sentence.\n\n${code}\n\nFirst line.  \nSecond line.\n`,
  );
  const formatted = await runQuality({ root: directory, mode: "format" });
  assert.equal(formatted.exitCode, 0, JSON.stringify(formatted));
  validateQualityResult(formatted, { operation: "format", exitCode: 0 });
  const bytes = readFileSync(join(directory, "SKILL.md"), "utf8");
  assert.ok(bytes.startsWith(metadata));
  assert.ok(bytes.includes(code));
  assert.match(bytes, /First line\.(?: {2}|\\)\nSecond line\./u);
  assert.ok([...Buffer.from(bytes)].every((byte) => byte < 128));
  const second = await runQuality({ root: directory, mode: "format" });
  validateQualityResult(second, { operation: "format", exitCode: 0 });
  assert.deepEqual(second.writtenPaths, []);
  assert.equal(readFileSync(join(directory, "SKILL.md"), "utf8"), bytes);
});

test("installed shared checker rejects a broken local link and formatting writes no selected document", async (t) => {
  const directory = fixture(t);
  const original = "# Good\n\nFirst sentence. Second sentence.\n";
  const broken = "# Broken\n\n[Missing](absent.md)\n";
  writeFileSync(join(directory, "good.md"), original);
  writeFileSync(join(directory, "broken.md"), broken);
  const report = await runQuality({ root: directory, mode: "format" });
  validateQualityResult(report, { operation: "format", exitCode: 1 });
  assert.ok(
    report.diagnostics.some(
      (item) => item.path === "broken.md" && item.source === "links",
    ),
    JSON.stringify(report),
  );
  assert.deepEqual(report.writtenPaths, []);
  assert.equal(readFileSync(join(directory, "good.md"), "utf8"), original);
  assert.equal(readFileSync(join(directory, "broken.md"), "utf8"), broken);
});

test("ignore files cannot bypass the root policy and excluded ancestor bytes stay intact", async (t) => {
  const directory = fixture(t);
  mkdirSync(join(directory, "excluded/nested"), { recursive: true });
  const excluded = "# Broken archival fixture\n\n[Missing](absent.md)\n";
  writeFileSync(join(directory, "excluded/nested/history.md"), excluded);
  writeFileSync(join(directory, "README.md"), "# Visible\n");
  writeFileSync(join(directory, ".gitignore"), "*.md\n");
  writeFileSync(join(directory, ".prettierignore"), "*.md\n");
  const report = await runQuality({ root: directory, mode: "format" });
  validateQualityResult(report, { operation: "format", exitCode: 0 });
  assert.deepEqual(report.selection.files, ["README.md"]);
  assert.equal(
    readFileSync(join(directory, "excluded/nested/history.md"), "utf8"),
    excluded,
  );
});

test("public CLI previews exact candidates, writes explicitly and converges without read-only mutations", (t) => {
  const directory = fixture(t);
  const path = join(directory, "literal [skill].md");
  const original = Buffer.from(
    "# Example\n\nFirst sentence. Second sentence.\n",
  );
  writeFileSync(path, original);
  const invoke = (...args) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: directory,
      encoding: "utf8",
      windowsHide: true,
    });
  for (const args of [[], ["--write", "--dry-run"]]) {
    const refused = invoke("format", "--root", directory, ...args);
    assert.equal(refused.status, 2, refused.stderr);
    assert.deepEqual(readFileSync(path), original);
  }
  const preview = invoke(
    "format",
    "--dry-run",
    "--json",
    "--root",
    directory,
    "--",
    "literal [skill].md",
  );
  assert.equal(preview.status, 0, preview.stderr);
  const predicted = JSON.parse(preview.stdout);
  assert.equal(predicted.schemaVersion, 5);
  validateQualityResult(predicted, { operation: "format", exitCode: 0 });
  assert.deepEqual(predicted.writtenPaths, []);
  assert.deepEqual(readFileSync(path), original);
  const candidate = predicted.documentResults[0].candidate;
  assert.equal(candidate.inputSha256, hash(original));
  assert.equal(candidate.inputBytes, original.length);
  assert.equal(candidate.changed, true);
  const write = invoke(
    "format",
    "--write",
    "--json",
    "--root",
    directory,
    "--",
    "literal [skill].md",
  );
  assert.equal(write.status, 0, write.stderr);
  const written = JSON.parse(write.stdout);
  assert.equal(written.schemaVersion, 5);
  assert.deepEqual(written.writtenPaths, ["literal [skill].md"]);
  const output = readFileSync(path);
  assert.equal(hash(output), candidate.outputSha256);
  assert.equal(output.length, candidate.outputBytes);
  const second = invoke("format", "--write", "--json", "--root", directory);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(JSON.parse(second.stdout).writtenPaths, []);
  const check = invoke("check", "--json", "--root", directory);
  assert.equal(check.status, 0, check.stderr);
  const checked = JSON.parse(check.stdout);
  assert.equal(checked.schemaVersion, 5);
  assert.equal(checked.operationStatus, "completed");
  assert.equal(checked.qualityStatus, "clean");
  assert.deepEqual(readFileSync(path), output);
});
