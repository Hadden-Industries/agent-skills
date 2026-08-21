/**
 * Contract tests for code block conversion.
 *
 * Technical books are the case where conversion fidelity matters most, and
 * code is the least forgiving content: whitespace is semantic, and a block
 * that loses its delimiter has to be recovered by guesswork.
 *
 * Pandoc's Markdown writer emits an *indented* code block whenever a CodeBlock
 * has no attributes, and no writer setting overrides that. So the fence is only
 * guaranteed while the block keeps a non-empty attribute, which makes these
 * assertions easy to regress by "tidying" the filter.
 *
 * Every case needs a real Pandoc, so they skip when it is absent.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import assert from "node:assert/strict";
import test from "node:test";

import { buildEpub } from "../helpers/epub.mjs";
import { pandocAvailable, runScript } from "./harness.mjs";

const NEEDS_PANDOC = {
  skip: pandocAvailable ? false : "Pandoc is not installed",
};

// Indentation is load-bearing, and the trailing comments would be silently
// reflowed by anything treating this as prose.
const SOURCE = [
  "def retry(attempts):",
  "    for attempt in range(attempts):",
  "        try:",
  "            return call()          # trailing comment",
  "        except Timeout:",
  "            sleep(2 ** attempt)    # exponential backoff",
  '    raise Timeout("gave up")',
].join("\n");

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function convertFully(t, { css, markup }) {
  const base = mkdtempSync(join(tmpdir(), "reading-epubs-code-"));

  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const input = join(base, "code.epub");
  const output = join(base, "out");

  writeFileSync(input, buildEpub({ css, markup }));

  const result = runScript("convert_epub.py", [input, "--output-dir", output]);

  assert.equal(
    result.json?.status,
    "ok",
    `expected a conversion, got: ${result.stdout}`,
  );

  return {
    json: result.json,
    output,
    markdown: readFileSync(result.json.markdown, "utf8"),
  };
}

function convert(t, fixture) {
  return convertFully(t, fixture).markdown;
}

/** Returns { info, body } for the first fenced block, or null if unfenced. */
function fencedBlock(markdown) {
  const match = markdown.match(/^```+([^\n]*)\n([\s\S]*?)^```+\s*$/mu);

  return match
    ? { info: match[1].trim(), body: match[2].replace(/\r/gu, "") }
    : null;
}

function block(css, preClass, codeClass) {
  const pre = preClass ? `<pre class="${preClass}">` : "<pre>";
  const code = codeClass ? `<code class="${codeClass}">` : "<code>";

  return { css, markup: `${pre}${code}${escapeXml(SOURCE)}</code></pre>` };
}

const PRESENTATIONAL_CSS =
  "pre.Code-Grey { background: #eeeeee; padding: 4px; }\n";

// Each shape appears in real books. All four must fence, because an indented
// block carries no language and forces an extractor to strip the indent.
const SHAPES = [
  {
    name: "a bare pre/code block",
    fixture: () => block("p { margin: 0; }\n", null, null),
    info: "text",
  },
  {
    name: "a block whose only class is presentational",
    fixture: () => block(PRESENTATIONAL_CSS, "Code-Grey", null),
    info: "text",
  },
  {
    name: "a block declaring its language",
    fixture: () => block("p { margin: 0; }\n", null, "language-python"),
    info: "python",
  },
  {
    name: "a block with an unstyled language-like class",
    fixture: () => block("p { margin: 0; }\n", "elixir", null),
    info: "elixir",
  },
];

for (const { name, fixture, info } of SHAPES) {
  test(`${name} is fenced with the right info string`, NEEDS_PANDOC, (t) => {
    const markdown = convert(t, fixture());
    const fence = fencedBlock(markdown);

    assert.ok(fence, "the code block must be fenced, not indented");
    assert.equal(fence.info, info);
  });

  test(`${name} preserves its content exactly`, NEEDS_PANDOC, (t) => {
    const markdown = convert(t, fixture());
    const fence = fencedBlock(markdown);

    assert.ok(fence, "the code block must be fenced, not indented");
    assert.equal(
      fence.body.replace(/\n$/u, ""),
      SOURCE,
      "code must survive character for character, including indentation",
    );
  });
}

// The whole point of reading the stylesheet: a class the book styles is
// presentation, and presentation must never masquerade as a language.
test("a styled class never reaches the info string", NEEDS_PANDOC, (t) => {
  const markdown = convert(t, block(PRESENTATIONAL_CSS, "Code-Grey", null));

  assert.doesNotMatch(markdown, /Code-Grey/u);
});

// A highlighting theme that styles `.python` must not demote a real language.
test(
  "a language survives even when the stylesheet styles it",
  NEEDS_PANDOC,
  (t) => {
    const markdown = convert(
      t,
      block("pre.python { color: #333333; }\n", "python", null),
    );

    assert.equal(fencedBlock(markdown)?.info, "python");
  },
);

// Pandoc marks highlighted blocks with `sourceCode` alongside the language.
// Alone it is a marker, not a language, and a real book leaked it into two
// fences before this was handled.
test(
  "a highlighter marker class never becomes the info string",
  NEEDS_PANDOC,
  (t) => {
    const markdown = convert(
      t,
      block("p { margin: 0; }\n", "sourceCode", null),
    );

    assert.equal(fencedBlock(markdown)?.info, "text");
  },
);

test(
  "a marker class alongside a language keeps the language",
  NEEDS_PANDOC,
  (t) => {
    const markdown = convert(
      t,
      block("p { margin: 0; }\n", "sourceCode python", null),
    );

    assert.equal(fencedBlock(markdown)?.info, "python");
  },
);

test("no code block is emitted as an indented block", NEEDS_PANDOC, (t) => {
  const markdown = convert(
    t,
    block(PRESENTATIONAL_CSS, "Code-Grey", "language-python"),
  );

  assert.doesNotMatch(
    markdown,
    /^ {4}def retry/mu,
    "an indented block means the fence was lost with the attribute",
  );
});
