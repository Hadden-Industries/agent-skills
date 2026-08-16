/**
 * Keeps the committed eval fixture verifiable.
 *
 * `evals/fixtures/sample.epub` is a binary, so a reviewer cannot read it in a
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
 *     node -e "import('./tests/helpers/epub.mjs').then(m => require('fs').writeFileSync('skills/reading-epubs/evals/fixtures/sample.epub', m.buildEpub({ crossLink: true })))"
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import { buildEpub } from "../helpers/epub.mjs";
import { SKILL_DIR } from "./harness.mjs";

const FIXTURE = join(SKILL_DIR, "evals", "fixtures", "sample.epub");

test("the committed eval fixture is exactly what the builder produces", () => {
  assert.deepEqual(
    readFileSync(FIXTURE),
    buildEpub({ crossLink: true }),
    "evals/fixtures/sample.epub has drifted from tests/helpers/epub.mjs; regenerate it",
  );
});
