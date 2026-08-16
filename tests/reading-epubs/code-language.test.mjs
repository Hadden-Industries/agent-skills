/**
 * Contract tests for inferring a code block's language from its content.
 *
 * Many books declare no language at all. DocBook emits `<pre class=
 * "programlisting">`, and a syntax highlighter contributes per-token classes
 * such as `nt` or `kd` rather than naming the language once, so a listing that
 * is plainly markup arrives labelled `text`.
 *
 * Where nothing is declared the content is inspected. That is inference rather
 * than recovery, so the cases that must NOT be mistaken for markup matter as
 * much as the ones that must: a book on relational theory is full of BNF
 * grammar, which has the shape of an opening tag without being markup.
 *
 * Written test-first, each assertion watched failing against a converter with
 * no inference at all.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import assert from "node:assert/strict";
import test from "node:test";

import { buildEpub } from "../helpers/epub.mjs";
import { pandocAvailable, runScript } from "./harness.mjs";

const NEEDS_PANDOC = { skip: pandocAvailable ? false : "Pandoc is not installed" };

function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function infoString(t, body, { css = "p { margin: 0; }\n", preClass = null } = {}) {
  const base = mkdtempSync(join(tmpdir(), "reading-epubs-lang-"));

  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const input = join(base, "book.epub");
  const pre = preClass ? `<pre class="${preClass}">` : "<pre>";

  writeFileSync(
    input,
    buildEpub({ css, markup: `${pre}<code>${escapeXml(body)}</code></pre>` }),
  );

  const result = runScript("convert_epub.py", [input, "--output-dir", join(base, "out")]);

  assert.equal(result.json?.status, "ok", `expected a conversion, got: ${result.stdout}`);

  const markdown = readFileSync(result.json.markdown, "utf8");
  const fence = markdown.match(/^```+([^\n]*)$/mu);

  return fence ? fence[1].trim() : null;
}

const CASES = [
  // Recognised as markup.
  { name: "an XML declaration", body: '<?xml version="1.0"?>\n<root/>', info: "xml" },
  {
    name: "a fragment showing one element's attributes",
    body: '<svg width="4cm" height="5cm" viewBox="0 0 64 80">',
    info: "xml",
  },
  {
    name: "markup introduced by a comment",
    body: '<!-- tall viewports -->\n<svg preserveAspectRatio="xMinYMin meet">',
    info: "xml",
  },
  {
    name: "a closed element with no attributes",
    body: "<note>\n  <to>reader</to>\n</note>",
    info: "xml",
  },
  { name: "an HTML document", body: "<!DOCTYPE html>\n<html><body>hi</body></html>", info: "html" },

  // Not markup, however much it may resemble it.
  {
    name: "BNF grammar notation",
    body: "<relation assign>\n         ::=   <relvar name> := <relation exp>",
    info: "text",
  },
  {
    name: "a CSS rule",
    body: 'div.background-cat {\n background-image: url("cat.svg");\n}',
    info: "text",
  },
  { name: "a function signature", body: "rotate(angle, centerX, centerY)", info: "text" },
  { name: "an algebraic identity", body: "x2 = x + (x - x1) = 2 * x - x1", info: "text" },
];

for (const { name, body, info } of CASES) {
  test(`${name} is labelled ${info}`, NEEDS_PANDOC, (t) => {
    assert.equal(infoString(t, body), info);
  });
}

test("a declared language always wins over inference", NEEDS_PANDOC, (t) => {
  assert.equal(
    infoString(t, '<svg width="4cm">', { preClass: "sourceCode python" }),
    "python",
    "content must never override a language the book actually stated",
  );
});
