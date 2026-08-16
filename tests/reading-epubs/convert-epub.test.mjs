/**
 * Contract tests for the `reading-epubs` EPUB converter.
 *
 * SKILL.md steps 2 and 4 branch on this script's JSON output — it reads
 * `markdown` as the text source, `assets` for extracted media, and
 * `pandoc_log`/`warning_count` to decide whether the conversion is trustworthy
 * — and on its exit codes. `conversion-result.schema.json` documents that
 * contract; these tests keep the script, the schema, and the instructions from
 * drifting apart. Run them with:
 *
 *     node --test "tests/**\/*.test.mjs"
 *
 * Pandoc is installed on demand by the skill itself, so it is not guaranteed on
 * a machine running this suite. Tests that need a real conversion skip when it
 * is absent; everything the converter decides before invoking Pandoc is checked
 * unconditionally.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import assert from "node:assert/strict";
import test from "node:test";

import { buildEpub, buildZipWithoutContainer } from "../helpers/epub.mjs";
import { schemaErrors } from "../helpers/json-schema.mjs";
import { SKILL_DIR, exitCodes, pandocAvailable, readScriptSource, readSchema, runScript } from "./harness.mjs";

const SCHEMA = readSchema("conversion-result.schema.json");

const NEEDS_PANDOC = { skip: pandocAvailable ? false : "Pandoc is not installed" };

function workspace(t) {
  const base = mkdtempSync(join(tmpdir(), "reading-epubs-"));

  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  return {
    base,
    write(name, contents) {
      const path = join(base, name);

      writeFileSync(path, contents);

      return path;
    },
    outputDir(name = "out") {
      return join(base, name);
    },
  };
}

function convert(input, args = []) {
  return runScript("convert_epub.py", [input, ...args]);
}

function assertConformsToSchema(payload) {
  const variant = SCHEMA.$defs[payload.status];

  assert.ok(variant, `no schema variant is declared for status "${payload.status}"`);
  assert.deepEqual(
    schemaErrors(payload, variant),
    [],
    `converter output does not conform to the "${payload.status}" variant of conversion-result.schema.json`,
  );
}

// Every failure has to leave the agent with a documented next step, otherwise
// SKILL.md step 4 ("read the troubleshooting reference and follow it") has
// nothing to act on. The path also has to resolve from the caller's working
// directory, which is the agent's project rather than the skill directory.
function assertNamesAResolvableReference(payload) {
  const reference = payload.troubleshooting_reference ?? payload.installation_reference;

  assert.ok(
    reference,
    `error "${payload.error}" names no troubleshooting or installation reference`,
  );

  const resolved = isAbsolute(reference) ? reference : resolve(process.cwd(), reference);

  assert.ok(
    existsSync(resolved),
    `reference "${reference}" does not resolve to an existing file (tried ${resolved}); ` +
      `it must be anchored to the skill directory (${SKILL_DIR})`,
  );
}

test("a file that is not a ZIP archive is rejected as an invalid EPUB", (t) => {
  const space = workspace(t);
  const input = space.write("not-a-zip.epub", "This is plain text, not an archive.\n");

  const result = convert(input);

  assert.equal(result.json.status, "error");
  assert.equal(result.json.error, "invalid_epub");
  assert.equal(result.status, 20, "an unusable input must not share an exit code with the Pandoc checker");
  assertConformsToSchema(result.json);
});

// Kept separate from the assertions above so that an exit-code regression and a
// broken reference path cannot shadow one another.
test("a failure names a reference that resolves from the caller's directory", (t) => {
  const space = workspace(t);
  const input = space.write("not-a-zip.epub", "This is plain text, not an archive.\n");

  assertNamesAResolvableReference(convert(input).json);
});

test("a ZIP archive without a container manifest is rejected as an invalid EPUB", (t) => {
  const space = workspace(t);
  const input = space.write("no-container.epub", buildZipWithoutContainer());

  const result = convert(input);

  assert.equal(result.json.error, "invalid_epub");
  assert.match(result.json.reason, /container\.xml/u);
  assert.equal(result.status, 20);
  assertConformsToSchema(result.json);
});

test("a path that does not exist is rejected as an invalid EPUB", (t) => {
  const space = workspace(t);

  const result = convert(join(space.base, "absent.epub"));

  assert.equal(result.json.error, "invalid_epub");
  assert.equal(result.status, 20);
  assertConformsToSchema(result.json);
});

test("the generated fixture is accepted as a well-formed EPUB container", (t) => {
  const space = workspace(t);
  const input = space.write("fixture.epub", buildEpub());

  const result = convert(input, ["--output-dir", space.outputDir()]);

  if (pandocAvailable) {
    assert.equal(result.json.status, "ok", `expected a conversion, got: ${result.stdout}`);
  } else {
    // Container validation runs before Pandoc is located, so the fixture having
    // got as far as the missing-Pandoc branch is what proves it is well formed.
    assert.equal(result.json.error, "pandoc_missing");
    assert.equal(result.status, 10);
    assertNamesAResolvableReference(result.json);
  }

  assertConformsToSchema(result.json);
});

test("the declared exit constants are disjoint from the checker's, bar the shared missing-Pandoc code", () => {
  const checker = Object.entries(exitCodes("check_pandoc.py"));
  const converter = Object.entries(exitCodes("convert_epub.py"));

  const failureCodes = (entries) =>
    new Map(entries.filter(([, code]) => code !== 0).map(([name, code]) => [code, name]));

  const checkerFailures = failureCodes(checker);
  const converterFailures = failureCodes(converter);
  const shared = [...checkerFailures.keys()].filter((code) => converterFailures.has(code)).sort();

  // 10 is deliberately shared: it means "Pandoc is missing" in both scripts.
  // Any other overlap gives one number two meanings, and SKILL.md step 1
  // teaches the agent the checker's meaning before step 2 runs the converter.
  assert.deepEqual(
    shared,
    [10],
    `exit codes ${shared.join(", ")} are used by both scripts; only 10 may be shared`,
  );
  assert.equal(checkerFailures.get(10), "MISSING");
  assert.equal(converterFailures.get(10), "PANDOC_MISSING");
});

test("the converter declares the intended exit constants", () => {
  assert.deepEqual(exitCodes("convert_epub.py"), {
    OK: 0,
    PANDOC_MISSING: 10,
    BAD_INPUT: 20,
    PANDOC_FAILED: 21,
    BAD_OUTPUT: 22,
  });
});

test("every error literal in the source is declared in the schema", () => {
  const source = readScriptSource("convert_epub.py");
  const emitted = new Set([...source.matchAll(/"error":\s*"([a-z_]+)"/gu)].map((match) => match[1]));

  assert.ok(emitted.size > 0, "no error literals were found in the converter source");

  const declared = new Set(SCHEMA.$defs.error.properties.error.enum);
  const undeclared = [...emitted].filter((code) => !declared.has(code)).sort();
  const unused = [...declared].filter((code) => !emitted.has(code)).sort();

  assert.deepEqual(undeclared, [], "the converter emits errors the schema does not declare");
  assert.deepEqual(unused, [], "the schema declares errors the converter never emits");
});

test("a successful conversion reports the content SKILL.md relies on", NEEDS_PANDOC, (t) => {
  const space = workspace(t);
  const input = space.write("fixture.epub", buildEpub());

  const result = convert(input, ["--output-dir", space.outputDir()]);

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.equal(result.json.cached, false);
  assert.ok(existsSync(result.json.markdown), "the reported markdown path must exist");
  assert.ok(result.json.heading_count > 0, "chapter headings must survive conversion");
  assertConformsToSchema(result.json);
});

// Pandoc's EPUB reader embeds the source filename in the identifiers it
// generates — `::: {#chapter-1.xhtml_chapter-1 .section}` around each document
// and an empty `[]{#chapter-1.xhtml}` anchor before it. Stripping those is the
// entire purpose of clean_epub.lua, and they are noise the agent would
// otherwise read as if it were structure.
//
// The filter matches an identifier containing `.xhtml`/`.html`/`.htm` AND the
// class `section`. Each case below defeats one of those conditions the way a
// real producer does, so a fix has to satisfy all three rather than only the
// extension half.
const SPINE_SHAPES = [
  { extension: "xhtml", wrapper: "section", note: "modern producer" },
  { extension: "xml", wrapper: "section", note: "Feedbooks-style .xml spine" },
  { extension: "xhtml", wrapper: "div", note: "InDesign-style publisher class" },
];

for (const { extension, wrapper, note } of SPINE_SHAPES) {
  test(`a ${extension}/${wrapper} spine (${note}) leaves no transport structure`, NEEDS_PANDOC, (t) => {
    const space = workspace(t);
    const input = space.write("spine.epub", buildEpub({ extension, wrapper }));

    const result = convert(input, ["--output-dir", space.outputDir()]);

    assert.equal(result.json.status, "ok", `expected a conversion, got: ${result.stdout}`);

    const markdown = readFileSync(result.json.markdown, "utf8");

    assert.doesNotMatch(
      markdown,
      new RegExp(String.raw`chapter-\d\.${extension}`, "u"),
      "a spine filename must not survive into the text the agent reads",
    );
  });
}

// Cleaning must not cost the reader their navigation. Pandoc anchors a cross
// reference on an identifier that looks exactly like the transport noise the
// filter removes, so stripping by shape alone turns every table-of-contents
// entry into a dangling link.
test("an internal cross-reference still resolves after cleaning", NEEDS_PANDOC, (t) => {
  const space = workspace(t);
  const input = space.write("linked.epub", buildEpub({ crossLink: true }));

  const result = convert(input, ["--output-dir", space.outputDir()]);

  assert.equal(result.json.status, "ok", `expected a conversion, got: ${result.stdout}`);

  const markdown = readFileSync(result.json.markdown, "utf8");
  const targets = [...markdown.matchAll(/\]\(#([^)]+)\)/gu)].map(([, id]) => id);
  const defined = new Set([...markdown.matchAll(/\{#([^\s}]+)/gu)].map(([, id]) => id));

  assert.ok(targets.length > 0, "the fixture must produce at least one internal link");
  assert.deepEqual(
    targets.filter((id) => !defined.has(id)),
    [],
    "cleaning must not leave an internal link pointing at a removed anchor",
  );
});

// A cache hit is the common case on any repeated question about the same book,
// so it has to report the same fields as a fresh conversion. If it omits the
// warning counters, SKILL.md step 4 silently loses the signal it branches on
// from the second invocation onwards.
test("a cache hit reports the same fields as a fresh conversion", NEEDS_PANDOC, (t) => {
  const space = workspace(t);
  const input = space.write("fixture.epub", buildEpub());
  const output = space.outputDir();

  const fresh = convert(input, ["--output-dir", output]);
  const cached = convert(input, ["--output-dir", output]);

  assert.equal(fresh.json.cached, false);
  assert.equal(cached.json.cached, true, "the second run must hit the cache");

  assert.deepEqual(
    Object.keys(cached.json).sort(),
    Object.keys(fresh.json).sort(),
    "a cache hit must not drop fields a fresh conversion reports",
  );
  assertConformsToSchema(cached.json);
});

test("a non-empty directory the converter did not create is refused", NEEDS_PANDOC, (t) => {
  const space = workspace(t);
  const input = space.write("fixture.epub", buildEpub());
  const output = space.outputDir("occupied");

  // Non-empty, but with no manifest.json, so it cannot be a cache directory
  // this converter created. Overwriting it would destroy the user's files.
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "notes.txt"), "Pre-existing user content.\n");

  const result = convert(input, ["--output-dir", output]);

  assert.equal(result.json.error, "output_directory_not_owned");
  // Checked before the exit code because this branch currently names no
  // reference at all, leaving the agent with an error and no documented
  // next step.
  assertNamesAResolvableReference(result.json);
  assert.equal(result.status, 22);
  assertConformsToSchema(result.json);
});
