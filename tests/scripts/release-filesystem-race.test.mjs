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
import { basename, join, resolve } from "node:path";
import test from "node:test";

const repository = resolve(import.meta.dirname, "../..");

// Instrument scheduling only: the CLI, filesystem, hard link and external bytes
// remain real. Both name-based and descriptor-based operations reach the same
// attack point, allowing replay against the vulnerable implementation.
const raceInjector = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, join } from "node:path";
const original = { ...fs };
const { RELEASE_RACE_ROOT: root, RELEASE_RACE_PATH: target,
  RELEASE_RACE_MODE: mode } = process.env;
const reportPath = join(root, "attack-report.json");
const report = { triggered: false, externalRead: false };
let writeDescriptor;
function save() { original.writeFileSync(reportPath, JSON.stringify(report)); }
function substitute() {
  if (report.triggered) return;
  original.renameSync(target, join(root, "parked-original"));
  original.linkSync(join(root, "attack-target", basename(target)), target);
  report.triggered = true;
  save();
}
fs.readFileSync = function(path, ...args) {
  if (path === target && mode === "read") {
    substitute();
    report.externalRead = true;
    save();
  }
  return original.readFileSync(path, ...args);
};
fs.writeFileSync = function(path, ...args) {
  if (path === target && mode !== "read") substitute();
  return original.writeFileSync(path, ...args);
};
fs.openSync = function(path, flags, ...args) {
  const descriptor = original.openSync(path, flags, ...args);
  if (path === target) {
    if (mode === "read") substitute();
    else if (typeof flags === "number" && (flags & fs.constants.O_RDWR)) {
      writeDescriptor = descriptor;
      if (mode === "write-before-validation") substitute();
    }
  }
  return descriptor;
};
fs.ftruncateSync = function(descriptor, ...args) {
  if (descriptor === writeDescriptor && mode === "write-after-validation")
    substitute();
  return original.ftruncateSync(descriptor, ...args);
};
save();
syncBuiltinESMExports();
`;

for (const [relativePath, mode] of [
  ["src/committing-to-git/SKILL.md", "read"],
  ["src/committing-to-git/SKILL.md", "write-before-validation"],
  ["src/committing-to-git/SKILL.md", "write-after-validation"],
  ["scripts/plugin-releases.json", "write-before-validation"],
  ["scripts/plugin-releases.json", "write-after-validation"],
]) {
  test(`release preserves external bytes during ${mode} substitution of ${relativePath}`, () => {
    const root = mkdtempSync(join(tmpdir(), "release-filesystem-race-"));
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
      const target = join(root, relativePath);
      const externalDirectory = join(root, "attack-target");
      mkdirSync(externalDirectory);
      const external = join(externalDirectory, basename(target));
      const original = readFileSync(target);
      const externalBytes = Buffer.concat([
        original,
        Buffer.from("\nExternal file must survive unchanged.\n"),
      ]);
      writeFileSync(external, externalBytes);
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          `data:text/javascript,${encodeURIComponent(raceInjector)}`,
          join(repository, "scripts/buildPluginPackages.js"),
          "--repository",
          root,
          "--release-version",
          "0.1.2-dev.1",
        ],
        {
          encoding: "utf8",
          timeout: 60000,
          env: {
            ...process.env,
            RELEASE_RACE_ROOT: root,
            RELEASE_RACE_PATH: target,
            RELEASE_RACE_MODE: mode,
          },
        },
      );
      const report = JSON.parse(readFileSync(join(root, "attack-report.json")));
      assert.equal(report.triggered, true, result.stderr);
      assert.deepEqual(readFileSync(external), externalBytes);
      assert.equal(
        report.externalRead,
        false,
        "Substituted source was consumed",
      );
      assert.notEqual(result.status, 0, "A substituted release path must fail");
      if (mode === "read" || mode === "write-before-validation")
        assert.deepEqual(readFileSync(join(root, "parked-original")), original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
