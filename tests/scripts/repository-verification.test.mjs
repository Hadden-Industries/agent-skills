import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  findCanonicalSkills,
  resolveRepositoryTool,
  runRepositoryTool,
  validateSkills,
} from "../../scripts/validateSkills.js";
import { lintSkills } from "../../scripts/lintSkills.js";

function createRepository(t) {
  const root = mkdtempSync(join(tmpdir(), "repository-verification-"));

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".agent-tools", "bin"), { recursive: true });
  mkdirSync(join(root, "skills", "zebra"), { recursive: true });
  mkdirSync(join(root, "skills", "alpha", "nested"), { recursive: true });
  writeFileSync(join(root, "skills", "zebra", "SKILL.md"), "# Zebra\n");
  writeFileSync(join(root, "skills", "alpha", "SKILL.md"), "# Alpha\n");
  writeFileSync(join(root, "skills", "alpha", "nested", "notes.md"), "Notes\n");

  return root;
}

test("canonical skills are discovered recursively in stable path order", (t) => {
  const root = createRepository(t);

  assert.deepEqual(findCanonicalSkills(join(root, "skills")), [
    join(root, "skills", "alpha"),
    join(root, "skills", "zebra"),
  ]);
});

test("repository tools resolve to the platform-specific managed wrapper", (t) => {
  const root = createRepository(t);
  const windowsWrapper = join(root, ".agent-tools", "bin", "skills-ref.cmd");
  const posixWrapper = join(root, ".agent-tools", "bin", "skills-ref");
  writeFileSync(windowsWrapper, "@echo off\n");
  writeFileSync(posixWrapper, "#!/usr/bin/env sh\n");

  assert.equal(
    resolveRepositoryTool(root, "skills-ref", "win32"),
    windowsWrapper,
  );
  assert.equal(
    resolveRepositoryTool(root, "skills-ref", "linux"),
    posixWrapper,
  );
});

test("skill validation invokes skills-ref once per canonical skill", (t) => {
  const root = createRepository(t);
  const wrapper = join(root, ".agent-tools", "bin", "skills-ref.cmd");
  const calls = [];
  writeFileSync(wrapper, "@echo off\n");

  validateSkills({
    repoRoot: root,
    platform: "win32",
    run(command, args) {
      calls.push([command, args]);
    },
  });

  assert.deepEqual(calls, [
    [wrapper, ["validate", join(root, "skills", "alpha")]],
    [wrapper, ["validate", join(root, "skills", "zebra")]],
  ]);
});

test("skill lint invokes Tessl against the repository plugin root", (t) => {
  const root = createRepository(t);
  const wrapper = join(root, ".agent-tools", "bin", "tessl.cmd");
  const calls = [];
  writeFileSync(wrapper, "@echo off\n");

  lintSkills({
    repoRoot: root,
    platform: "win32",
    run(command, args, options) {
      calls.push([command, args, options]);
    },
  });

  assert.deepEqual(calls, [[wrapper, ["skill", "lint", "."], { cwd: root }]]);
});

test("missing managed wrappers produce an actionable setup error", (t) => {
  const root = createRepository(t);

  assert.throws(
    () => resolveRepositoryTool(root, "skills-ref", "win32"),
    /Run the repository development-environment setup first/u,
  );
});

test("Windows wrappers use an explicit command interpreter without shell mode", () => {
  const calls = [];

  runRepositoryTool(
    "C:\\repo tools\\skills-ref.cmd",
    ["validate", "skill path"],
    {
      commandInterpreter: "C:\\Windows\\System32\\cmd.exe",
      platform: "win32",
      spawn(command, args, options) {
        calls.push([command, args, options]);
        return { status: 0 };
      },
    },
  );

  assert.deepEqual(calls, [
    [
      "C:\\Windows\\System32\\cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        '"C:\\repo tools\\skills-ref.cmd" validate "skill path"',
      ],
      { stdio: "inherit" },
    ],
  ]);
});
