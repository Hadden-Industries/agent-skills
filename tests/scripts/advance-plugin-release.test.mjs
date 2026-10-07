import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildPluginPackages } from "../../scripts/buildPluginPackages.js";

const repository = resolve(import.meta.dirname, "../..");

test("one deliberate release operation updates source metadata, digest and generated versions", () => {
  const root = mkdtempSync(join(tmpdir(), "advance-plugin-release-"));
  try {
    for (const directory of ["src", "skills", "lib", "scripts", "plugins"])
      cpSync(join(repository, directory), join(root, directory), {
        recursive: true,
      });
    cpSync(join(repository, "LICENSE"), join(root, "LICENSE"));
    symlinkSync(
      join(repository, "node_modules"),
      join(root, "node_modules"),
      "junction",
    );
    const sourcePath = join(root, "src/committing-to-git/SKILL.md");
    const original = readFileSync(sourcePath, "utf8");
    const ledgerPath = join(root, "scripts/plugin-releases.json");
    const previous = JSON.parse(readFileSync(ledgerPath, "utf8"));
    const run = (version) =>
      spawnSync(
        process.execPath,
        [
          join(repository, "scripts/buildPluginPackages.js"),
          "--repository",
          root,
          "--release-version",
          version,
        ],
        { encoding: "utf8", timeout: 60000 },
      );
    const result = run("0.1.2-dev.1");
    assert.equal(result.status, 0, result.stderr);
    const source = readFileSync(sourcePath, "utf8");
    assert.match(source, / {2}version: "0\.1\.2-dev\.1"/u);
    assert.equal(
      source.slice(source.indexOf("\n---", 4)),
      original.slice(original.indexOf("\n---", 4)),
    );
    for (const path of [
      "skills/committing-to-git/SKILL.md",
      "plugins/committing-to-git/skills/committing-to-git/SKILL.md",
    ])
      assert.equal(readFileSync(join(root, path), "utf8"), source);
    for (const host of ["claude", "codex"])
      assert.equal(
        JSON.parse(
          readFileSync(
            join(root, `plugins/committing-to-git/.${host}-plugin/plugin.json`),
          ),
        ).version,
        "0.1.2-dev.1",
      );
    const after = JSON.parse(readFileSync(ledgerPath, "utf8"));
    assert.deepEqual(
      after.plugins["committing-to-git"].slice(0, -1),
      previous.plugins["committing-to-git"],
    );
    assert.deepEqual(
      buildPluginPackages({ repositoryRoot: root, checkOnly: true })
        .stalePackages,
      [],
    );
    assert.notEqual(run("0.1.2-dev.1").status, 0);
    assert.equal(readFileSync(sourcePath, "utf8"), source);
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, "utf8")), after);
    // Keep a valid content binding while introducing an independently visible
    // metadata disagreement: version agreement must be checked in its own right.
    const generated = join(root, "skills/committing-to-git/SKILL.md");
    writeFileSync(
      generated,
      source.replace('version: "0.1.2-dev.1"', 'version: "9.9.9-dev.1"'),
    );
    assert.throws(
      () => buildPluginPackages({ repositoryRoot: root, checkOnly: true }),
      /metadata.version.*release version/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const scenario of ["block-before-key", "block-last", "linked-ancestor"]) {
  test(`release refuses ${scenario} without modifying source or ledger`, () => {
    const root = mkdtempSync(join(tmpdir(), "release-source-refusal-"));
    try {
      mkdirSync(join(root, "scripts"));
      const ledgerPath = join(root, "scripts/plugin-releases.json");
      const ledgerBytes = readFileSync(
        join(repository, "scripts/plugin-releases.json"),
      );
      writeFileSync(ledgerPath, ledgerBytes);
      mkdirSync(join(root, "src"));
      const directory = join(root, "src/committing-to-git");
      let sourcePath = join(directory, "SKILL.md");
      if (scenario === "linked-ancestor") {
        const target = join(root, "retained-external-source");
        mkdirSync(target);
        symlinkSync(target, directory, "junction");
        sourcePath = join(target, "SKILL.md");
      } else {
        mkdirSync(directory);
      }
      const version =
        scenario === "linked-ancestor"
          ? '  version: "0.1.1-dev.2"\n'
          : "  version: |- # retain this comment\n    0.1.1-dev.2\n";
      const source = `---\nname: committing-to-git\ndescription: Valid release fixture\nmetadata:\n${version}${scenario === "block-last" ? "" : "  category: development\n"}---\n\nBody must survive.\n`;
      writeFileSync(sourcePath, source);
      const result = spawnSync(
        process.execPath,
        [
          join(repository, "scripts/buildPluginPackages.js"),
          "--repository",
          root,
          "--release-version",
          "0.1.2-dev.1",
        ],
        { encoding: "utf8", timeout: 60000 },
      );
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(sourcePath, "utf8"), source);
      assert.deepEqual(readFileSync(ledgerPath), ledgerBytes);
      assert.match(
        result.stderr,
        scenario === "linked-ancestor" ? /redirect|link/iu : /block.*scalar/iu,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
