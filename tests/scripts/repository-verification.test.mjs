import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  mkdirSync(join(root, ".venv", "Scripts"), { recursive: true });
  mkdirSync(
    join(root, ".agent-tools", "tessl", "node_modules", "@tessl", "cli", "bin"),
    { recursive: true },
  );
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

test("repository tools resolve to native Windows tools and POSIX wrappers", (t) => {
  const root = createRepository(t);
  const windowsWrapper = join(root, ".venv", "Scripts", "skills-ref.exe");
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
  const wrapper = join(root, ".venv", "Scripts", "skills-ref.exe");
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

test("skill validation invokes skills-ref only for selected canonical skills", (t) => {
  const root = createRepository(t);
  const wrapper = join(root, ".venv", "Scripts", "skills-ref.exe");
  const calls = [];
  writeFileSync(wrapper, "@echo off\n");

  const result = validateSkills({
    repoRoot: root,
    platform: "win32",
    skillNames: ["zebra"],
    run(command, args) {
      calls.push([command, args]);
    },
  });

  assert.deepEqual(calls, [
    [wrapper, ["validate", join(root, "skills", "zebra")]],
  ]);
  assert.deepEqual(result, { skillsValidated: 1 });
});

test("skill validation rejects unknown selected canonical skills", (t) => {
  const root = createRepository(t);
  const wrapper = join(root, ".venv", "Scripts", "skills-ref.exe");
  writeFileSync(wrapper, "@echo off\n");

  assert.throws(
    () =>
      validateSkills({
        repoRoot: root,
        platform: "win32",
        skillNames: ["missing"],
        run() {
          assert.fail("validation must not run for an unknown skill");
        },
      }),
    /Unknown canonical skill: missing/u,
  );
});

test("skill lint invokes Tessl against the repository plugin root", (t) => {
  const root = createRepository(t);
  const wrapper = join(
    root,
    ".agent-tools",
    "tessl",
    "node_modules",
    "@tessl",
    "cli",
    "bin",
    "tessl.js",
  );
  const calls = [];
  writeFileSync(wrapper, "@echo off\n");

  lintSkills({
    repoRoot: root,
    platform: "win32",
    run(command, args, options) {
      calls.push([command, args, options]);
    },
  });

  assert.deepEqual(calls, [
    [
      wrapper,
      ["skill", "lint", "."],
      {
        cwd: root,
        env: { ...process.env, TESSL_AUTO_UPDATE_INTERVAL_MINUTES: "0" },
      },
    ],
  ]);
});

test("missing managed wrappers produce an actionable setup error", (t) => {
  const root = createRepository(t);

  assert.throws(
    () => resolveRepositoryTool(root, "skills-ref", "win32"),
    /Run the repository development-environment setup first/u,
  );
});

test("Windows Node entry points use the current Node executable without a shell", () => {
  const calls = [];

  runRepositoryTool("C:\\repo tools\\tessl.js", ["validate", "skill path"], {
    platform: "win32",
    spawn(command, args, options) {
      calls.push([command, args, options]);
      return { status: 0 };
    },
  });

  assert.deepEqual(calls, [
    [
      process.execPath,
      ["C:\\repo tools\\tessl.js", "validate", "skill path"],
      { shell: false, stdio: "inherit" },
    ],
  ]);
});

test("Windows command scripts are rejected before spawn", () => {
  for (const command of ["C:\\tools\\skills-ref.cmd", "C:\\tools\\other.BAT"]) {
    let launched = false;
    assert.throws(
      () =>
        runRepositoryTool(command, ["validate"], {
          platform: "win32",
          spawn() {
            launched = true;
            return { status: 0 };
          },
        }),
      /native executable or Node entry point/u,
    );
    assert.equal(launched, false);
  }
});

test("native tools receive shell metacharacters as literal arguments", (t) => {
  const root = createRepository(t);
  const script = join(root, "record-arguments.cjs");
  const output = join(root, "arguments.json");
  const values = [
    "%PATH%",
    "!PATH!",
    "x&whoami",
    "x|whoami",
    "x>out",
    "x^y",
    'x"y',
    "x\ny",
    "dir with space\\",
    "",
  ];
  writeFileSync(
    script,
    'require("node:fs").writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));',
  );
  runRepositoryTool(process.execPath, [script, output, ...values], {
    platform: "win32",
  });
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), values);
});
