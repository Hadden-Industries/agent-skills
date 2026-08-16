/**
 * Contract tests for the `reading-epubs` Pandoc checker.
 *
 * SKILL.md step 1 branches on this script's exit code to decide whether to
 * continue, install Pandoc, or repair an installation, and it points the agent
 * at a reference file the script names. Nothing enforced either half of that
 * contract, so the script, the schema, and the skill instructions could drift
 * apart silently. Run them with:
 *
 *     node --test "tests/**\/*.test.mjs"
 *
 * Node 24 treats test-runner positional arguments as glob patterns, so a bare
 * directory path is resolved as a module and fails.
 */

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import { schemaErrors } from "../helpers/json-schema.mjs";
import { SKILL_DIR, exitCodes, readScriptSource, readSchema, runScript } from "./harness.mjs";

const SCHEMA = readSchema("pandoc-check.schema.json");

const STATUS_EXIT_CODES = {
  ok: 0,
  missing: 10,
  unusable: 11,
};

function assertConformsToSchema(payload) {
  const variant = SCHEMA.$defs[payload.status];

  assert.ok(variant, `no schema variant is declared for status "${payload.status}"`);
  assert.deepEqual(
    schemaErrors(payload, variant),
    [],
    `checker output does not conform to the "${payload.status}" variant of pandoc-check.schema.json`,
  );
}

test("output conforms to the schema variant its status selects", () => {
  const result = runScript("check_pandoc.py");

  assert.notEqual(result.json, null, "the checker must always emit JSON on stdout");
  assertConformsToSchema(result.json);
});

test("the exit code matches the status the payload reports", () => {
  const result = runScript("check_pandoc.py");

  assert.equal(
    result.status,
    STATUS_EXIT_CODES[result.json.status],
    `status "${result.json.status}" must exit ${STATUS_EXIT_CODES[result.json.status]}`,
  );
});

test("the declared exit constants are the ones SKILL.md documents", () => {
  assert.deepEqual(exitCodes("check_pandoc.py"), {
    OK: 0,
    MISSING: 10,
    UNUSABLE: 11,
  });
});

test("every status literal in the source is declared in the schema", () => {
  const source = readScriptSource("check_pandoc.py");
  const emitted = new Set(
    [...source.matchAll(/"status":\s*"([a-z_]+)"/gu)].map((match) => match[1]),
  );

  assert.ok(emitted.size > 0, "no status literals were found in the checker source");

  const declared = new Set(Object.keys(SCHEMA.$defs));
  const undeclared = [...emitted].filter((status) => !declared.has(status)).sort();
  const unused = [...declared].filter((status) => !emitted.has(status)).sort();

  assert.deepEqual(undeclared, [], "the checker emits statuses the schema does not declare");
  assert.deepEqual(unused, [], "the schema declares statuses the checker never emits");
});

// The agent runs this script from its own project directory, so a bare
// `references/...` path in the output points at a file that does not exist
// there. Whatever the script reports has to resolve from the caller's working
// directory, not from the skill directory it happens to live in.
test("the reported installation reference resolves from the caller's directory", (t) => {
  const result = runScript("check_pandoc.py");

  if (!("installation_reference" in result.json)) {
    // Only the missing/unusable branches name a reference. Skipping keeps this
    // visible instead of passing vacuously on a machine that has Pandoc; the
    // converter's error paths cover the same defect deterministically.
    t.skip("Pandoc is installed, so the checker reports no installation reference");

    return;
  }

  const reference = result.json.installation_reference;
  const resolved = isAbsolute(reference) ? reference : resolve(process.cwd(), reference);

  assert.ok(
    existsSync(resolved),
    `installation_reference "${reference}" does not resolve to an existing file ` +
      `(tried ${resolved}); it must be anchored to the skill directory (${SKILL_DIR})`,
  );
});

test("the result does not depend on the working directory", () => {
  const fromTemp = runScript("check_pandoc.py");
  const fromSkill = runScript("check_pandoc.py", [], { cwd: SKILL_DIR });

  assert.equal(fromTemp.status, fromSkill.status);
  assert.deepEqual(fromTemp.json, fromSkill.json);
});
