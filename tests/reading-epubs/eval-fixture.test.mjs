/**
 * Keeps the committed eval fixture verifiable.
 *
 * `evals/reading-epubs/fixtures/sample.epub` is a binary, so a reviewer cannot read it in a
 * diff and has no way to tell what it contains or whether it still matches the
 * evals that depend on it. Pinning it to the output of `buildEpub` gives it a
 * reviewable source: the bytes are whatever `tests/helpers/epub.mjs` produces,
 * and that file is plain text.
 *
 * The ZIP writer stamps a fixed 1980-01-01 timestamp precisely so this
 * comparison can be byte-exact rather than structural.
 *
 * Regenerate the fixture whenever the builder changes:
 *
 *     node -e "import('./tests/helpers/epub.mjs').then(m => require('fs').writeFileSync('evals/reading-epubs/fixtures/sample.epub', m.buildEpub({ crossLink: true })))"
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import { buildEpub } from "../helpers/epub.mjs";
import { REPO_ROOT, resolvePython } from "./harness.mjs";

const EVAL_DIRECTORY = join(REPO_ROOT, "evals", "reading-epubs");
const FIXTURE = join(EVAL_DIRECTORY, "fixtures", "sample.epub");
const MEASUREMENT_SCRIPT = join(EVAL_DIRECTORY, "measure_conversion.py");

test("the committed eval fixture is exactly what the builder produces", () => {
  assert.deepEqual(
    readFileSync(FIXTURE),
    buildEpub({ crossLink: true }),
    "evals/reading-epubs/fixtures/sample.epub has drifted from tests/helpers/epub.mjs; regenerate it",
  );
});

test("the maintainer measurement script resolves the canonical skill from the repository root", () => {
  const [command, ...prefix] = resolvePython();
  const result = spawnSync(command, [...prefix, MEASUREMENT_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /give at least one EPUB, or --directory/u);
  assert.doesNotMatch(result.stderr, /ModuleNotFoundError/u);
});
