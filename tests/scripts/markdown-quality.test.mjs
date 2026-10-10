import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../..");
const tooling = join(root, "tooling/markdown");
const requireTool = createRequire(join(tooling, "package.json"));
const {
  inspectSelection,
  readExecutionProfile,
  runQuality,
  validateQualityResult,
} = await import(
  pathToFileURL(requireTool.resolve("@hadden-industries/markdown-quality"))
);
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

test("Markdown acquisition binds installed latest-source and native archives to the committed lock", () => {
  const source = readJson(join(tooling, "source.json"));
  const identity = readJson(
    join(
      tooling,
      "node_modules/@hadden-industries/markdown-quality/assets/source-identity.json",
    ),
  );
  assert.deepEqual(identity, {
    head: source.source,
    tree: source.tree,
    clean: true,
    lockSha256: source.sourceLockSha256,
  });
  const lock = readJson(join(tooling, "package-lock.json"));
  for (const archive of source.archives) {
    const bytes = readFileSync(join(tooling, "archives", archive.filename));
    assert.equal(hash(bytes), archive.sha256);
    assert.equal(
      `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      archive.integrity,
    );
    const entry = Object.values(lock.packages).find(
      (item) => item.resolved === `file:archives/${archive.filename}`,
    );
    assert.ok(entry, archive.filename);
    assert.equal(entry.integrity, archive.integrity);
  }
  const workflow = readFileSync(
    join(root, ".github/workflows/markdown-quality.yml"),
    "utf8",
  );
  assert.ok(workflow.includes(`markdown-quality.yml@${source.workflow}`));
  assert.equal(source.workflow, source.source);
  const caller = parse(workflow);
  assert.equal(
    caller.jobs.markdown.with["qualification-evidence"],
    "${{ github.event_name == 'workflow_dispatch' }}",
  );
  const profile = readExecutionProfile({ root });
  assert.equal(profile.samples, 6);
  assert.equal(profile.runtimes.node, "24.21.0");
});

test("Markdown root policy accounts for tracked inventory and agrees with explicit selection", async () => {
  const report = await inspectSelection({ root, inventory: "git" });
  validateQualityResult(report, { operation: "inspect", exitCode: 0 });
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter((path) => path.endsWith(".md"));
  assert.deepEqual(
    report.selection.inventory.map((item) => item.path).sort(),
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
  assert.deepEqual(second.written, []);
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
  assert.deepEqual(report.written, []);
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
