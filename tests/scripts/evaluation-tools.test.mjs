import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import { resolvePython } from "../helpers/python.mjs";

const DRIVER = join(
  dirname(fileURLToPath(import.meta.url)),
  "evaluation_tools_driver.py",
);

function invoke(state) {
  const [command, ...prefix] = resolvePython();
  const result = spawnSync(command, [...prefix, DRIVER], {
    input: JSON.stringify({ state }),
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  assert.equal(
    result.status,
    0,
    `driver exited ${result.status}: ${result.stderr}`,
  );

  return JSON.parse(result.stdout);
}

function exercise(state) {
  const response = invoke(state);
  assert.ok(response.ok, response.error);

  return response.value;
}

test("an existing usable virtual environment is reused", () => {
  const result = exercise("healthy");

  assert.deepEqual(result.calls, [["-c"]]);
  assert.equal(result.python_exists, true);
  assert.equal(result.stale_marker_exists, true);
});

test("a missing virtual environment is created and verified", () => {
  const result = exercise("missing");

  assert.deepEqual(result.calls, [["-m", "venv"], ["-c"]]);
  assert.equal(result.python_exists, true);
});

test("an unusable virtual environment is cleared, recreated, and verified", () => {
  const result = exercise("broken");

  assert.deepEqual(result.calls, [["-c"], ["-m", "venv"], ["-c"]]);
  assert.equal(result.python_exists, true);
  assert.equal(result.stale_marker_exists, false);
});

test("an interpreter launch error also triggers safe recreation", () => {
  const result = exercise("probe-error");

  assert.deepEqual(result.calls, [["-c"], ["-m", "venv"], ["-c"]]);
  assert.equal(result.stale_marker_exists, false);
});

test("a linked .venv is refused even when its interpreter is missing", () => {
  const response = invoke("linked-missing");

  assert.equal(response.ok, false);
  assert.match(response.error, /link or junction/u);
});

test("an older usable virtual environment is replaced before installing tools", () => {
  const result = exercise("outdated");
  assert.deepEqual(result.calls, [["-c"], ["-m", "venv"], ["-c"]]);
  assert.equal(result.stale_marker_exists, false);
});

test("Python setup rejects older runtimes and accepts the floor and newer versions", () => {
  const target = JSON.parse(
    readFileSync(
      new URL("../../.markdown-quality-runtimes.json", import.meta.url),
      "utf8",
    ),
  ).python;
  const [major, minor, patch] = target.split(".").map(Number);
  for (const version of [
    `${major}.${minor - 1}.99`,
    `${target}@candidate`,
    `${major}.${minor + 1}.0@alpha`,
  ]) {
    const rejected = invoke(`python-${version}`);
    assert.equal(rejected.ok, false);
    assert.ok(rejected.error.includes(`Stable Python ${target} or newer`));
  }
  for (const version of [
    target,
    `${major}.${minor}.${patch + 1}`,
    `${major}.${minor + 1}.0`,
    `${major + 1}.0.0`,
  ])
    assert.equal(exercise(`python-${version}`).accepted, true);
});

test("refreshing Tessl updates the runtime after installing the latest launcher", () => {
  const result = exercise("tessl-update");

  assert.equal(result.calls.length, 2);
  assert.deepEqual(result.calls[0].slice(0, 2), ["npm", "install"]);
  assert.deepEqual(result.calls[1], ["<tessl>", "cli", "update"]);
});
