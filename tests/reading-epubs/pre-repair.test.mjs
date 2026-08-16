/**
 * Contract tests for repairing `<pre>` blocks Pandoc would otherwise flatten.
 *
 * Pandoc's HTML reader treats `<pre>` as a code block only when it wraps an
 * inner `<code>`. A bare `<pre>` is read as a paragraph and its indentation is
 * discarded, which is wrong: HTML defines `<pre>` as preformatted on its own.
 * The converter therefore rewrites such books before conversion.
 *
 * Reported upstream as jgm/pandoc#11810. These tests describe the workaround,
 * so they outlive the fix: they should keep passing once Pandoc is corrected,
 * because the repair only ever runs where a bare `<pre>` is present. If they
 * start failing after a Pandoc upgrade, the reader's behaviour has changed and
 * `scripts/_repair.py` needs revisiting rather than the tests.
 *
 * Written test-first. Each assertion below was watched failing against a
 * converter with no repair step at all, so each is known to be capable of
 * catching the regression it describes.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import assert from "node:assert/strict";
import test from "node:test";

import { buildEpub } from "../helpers/epub.mjs";
import { pandocAvailable, runScript } from "./harness.mjs";

const NEEDS_PANDOC = { skip: pandocAvailable ? false : "Pandoc is not installed" };

const INDENTED = ["alpha", "    beta", "        gamma"].join("\n");

function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function convert(t, markup) {
  const base = mkdtempSync(join(tmpdir(), "reading-epubs-repair-"));

  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const input = join(base, "book.epub");
  const output = join(base, "out");

  writeFileSync(input, buildEpub({ css: "p { margin: 0; }\n", markup }));

  const result = runScript("convert_epub.py", [input, "--output-dir", output]);

  assert.equal(result.json?.status, "ok", `expected a conversion, got: ${result.stdout}`);

  return {
    json: result.json,
    output,
    markdown: readFileSync(result.json.markdown, "utf8"),
  };
}

function fencedBody(markdown) {
  const match = markdown.match(/^```+[^\n]*\n([\s\S]*?)^```+\s*$/mu);

  return match ? match[1].replace(/\r/gu, "").replace(/\n$/u, "") : null;
}

test("a bare pre block keeps its indentation", NEEDS_PANDOC, (t) => {
  const { markdown } = convert(t, `<pre>${escapeXml(INDENTED)}</pre>`);

  assert.equal(
    fencedBody(markdown),
    INDENTED,
    "a bare <pre> must convert to a fenced block with its whitespace intact",
  );
});

test("the number of repaired blocks is reported", NEEDS_PANDOC, (t) => {
  const { json } = convert(t, `<pre>${escapeXml(INDENTED)}</pre>`);

  assert.equal(json.repaired_code_blocks, 1);
});

test("a book needing no repair is converted from the original", NEEDS_PANDOC, (t) => {
  const { json, output } = convert(t, `<pre><code>${escapeXml(INDENTED)}</code></pre>`);

  assert.equal(json.repaired_code_blocks, 0);
  assert.ok(
    !existsSync(join(output, "repaired-source.epub")),
    "an untouched book must not be rewritten, so the cost falls only on books that need it",
  );
});

test("a repaired book leaves an inspectable copy beside the output", NEEDS_PANDOC, (t) => {
  const { output } = convert(t, `<pre>${escapeXml(INDENTED)}</pre>`);

  assert.ok(
    existsSync(join(output, "repaired-source.epub")),
    "the rewritten source must be inspectable rather than hidden",
  );
});

// Wrapping a block in <code> keeps the text of any markup inside and discards
// the rest. That is harmless for emphasis, and destructive for anything whose
// meaning is not carried by its text.

test("text inside a repaired block survives", NEEDS_PANDOC, (t) => {
  const { markdown } = convert(t, `<pre>SELECT <em>column</em>\n    FROM <strong>table</strong></pre>`);

  assert.equal(fencedBody(markdown), "SELECT column\n    FROM table");
});

test("a block containing an image is left unrepaired", NEEDS_PANDOC, (t) => {
  const { json, markdown } = convert(
    t,
    `<pre>alpha\n    beta<img src="figure.png" alt="DIAGRAM"/></pre>`,
  );

  assert.equal(json.repaired_code_blocks, 0, "repairing this would drop the image entirely");
  assert.match(markdown, /DIAGRAM/u, "the image must survive instead");
});

test("a block containing a link is left unrepaired", NEEDS_PANDOC, (t) => {
  const { json, markdown } = convert(
    t,
    `<pre>see <a href="https://example.invalid/spec">the spec</a>\n    then continue</pre>`,
  );

  assert.equal(json.repaired_code_blocks, 0, "repairing this would drop the address");
  assert.match(markdown, /example\.invalid\/spec/u, "the address must survive instead");
});

test("a block containing an anchor identifier is left unrepaired", NEEDS_PANDOC, (t) => {
  const { json } = convert(t, `<pre>alpha<span id="callout-1"></span>\n    beta</pre>`);

  assert.equal(
    json.repaired_code_blocks,
    0,
    "repairing this would drop an identifier another part of the book may link to",
  );
});
