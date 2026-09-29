import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  commitAll,
  createRepositoryFixture,
  git,
  runNodeScript,
  writeRepositoryFile,
} from "./harness.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const entries = [
  "src/committing-to-git/cli/commitWorkflow.js",
  "skills/committing-to-git/scripts/commitWorkflow.mjs",
  "plugins/committing-to-git/skills/committing-to-git/scripts/commitWorkflow.mjs",
];

function run(args, cwd) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
}

test("bundled workflow prepare creates a transaction through the installed skill link", (t) => {
  const { repo, scratch } = createRepositoryFixture(t);
  writeRepositoryFile(repo, "tracked.txt", "before\n");
  commitAll(repo);
  writeRepositoryFile(repo, "tracked.txt", "after\n");
  git(["add", "tracked.txt"], repo);
  const link = join(scratch, "committing-to-git");
  symlinkSync(
    join(repositoryRoot, "skills", "committing-to-git"),
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  const result = runNodeScript(
    join(link, "scripts", "commitWorkflow.mjs"),
    [
      "workflow",
      "prepare",
      "--mode",
      "actual",
      "--scope",
      "staged",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      "--message-format",
      "detailed",
      "--result-detail",
      "summary",
    ],
    repo,
    { env: { TEMP: scratch, TMP: scratch, TMPDIR: scratch } },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "prepared");
  assert.equal(output.commitState, "absent");
  const transaction = JSON.parse(readFileSync(output.transaction, "utf8"));
  assert.equal(transaction.phase, "authoring-pending");
});

for (const entry of entries) {
  test(`${entry} dispatches through a linked directory`, (t) => {
    const { scratch } = createRepositoryFixture(t);
    const link = join(scratch, "linked skill #9");
    symlinkSync(
      repositoryRoot,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    const script = join(link, entry);

    for (const flags of [[], ["--preserve-symlinks-main"]]) {
      const help = run([...flags, script, "--help"], scratch);
      assert.equal(help.status, 0, help.stderr);
      assert.match(help.stdout, /workflow prepare/u);

      const invalid = run([...flags, script, "not-a-command"], scratch);
      assert.notEqual(invalid.status, 0);
      const result = JSON.parse(invalid.stdout);
      assert.equal(result.schemaVersion, 2);
      assert.equal(result.domain, "committing-to-git");
      assert.equal(result.exitCode, invalid.status);
    }
  });

  test(`${entry} remains inert when imported by a same-named module`, (t) => {
    const { scratch } = createRepositoryFixture(t);
    const importer = join(scratch, "commitWorkflow.mjs");
    writeFileSync(
      importer,
      `await import(${JSON.stringify(pathToFileURL(join(repositoryRoot, entry)).href)});\nconsole.log("imported");\n`,
    );
    const result = run([importer, "--help"], scratch);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "imported\n");
    assert.equal(result.stderr, "");
  });

  test(`${entry} tolerates absent or unresolvable argv when imported`, () => {
    for (const argv of ["undefined", '"missing-entry.mjs"']) {
      const result = run(
        [
          "--input-type=module",
          "--eval",
          `process.argv[1] = ${argv}; await import(${JSON.stringify(pathToFileURL(join(repositoryRoot, entry)).href)}); console.log("imported");`,
        ],
        dirname(join(repositoryRoot, entry)),
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "imported\n");
      assert.equal(result.stderr, "");
    }
  });
}
