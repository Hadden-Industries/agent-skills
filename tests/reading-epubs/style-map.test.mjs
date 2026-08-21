/**
 * Contract tests for CSS-derived style stripping.
 *
 * Publisher class names are meaningless outside the book that defined them, so
 * the converter reads the book's own stylesheet to decide which classes carry
 * meaning and which are presentation. These tests define a stylesheet, use its
 * classes, and assert the conversion turns declarations into real Markdown and
 * discards the rest.
 *
 * Every case needs a real Pandoc, so they skip when it is absent.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import assert from "node:assert/strict";
import test from "node:test";

import { buildEpub } from "../helpers/epub.mjs";
import { pandocAvailable, runScript } from "./harness.mjs";

const NEEDS_PANDOC = {
  skip: pandocAvailable ? false : "Pandoc is not installed",
};

function convertWith(t, { css, markup }) {
  const base = mkdtempSync(join(tmpdir(), "reading-epubs-style-"));

  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const input = join(base, "styled.epub");

  writeFileSync(input, buildEpub({ css, markup }));

  const result = runScript("convert_epub.py", [
    input,
    "--output-dir",
    join(base, "out"),
  ]);

  assert.equal(
    result.json?.status,
    "ok",
    `expected a conversion, got: ${result.stdout}`,
  );

  return {
    json: result.json,
    markdown: readFileSync(result.json.markdown, "utf8"),
  };
}

// Each entry: a CSS declaration, and the Markdown it must become.
const DECLARATIONS = [
  { name: "bold", css: "font-weight: bold;", expected: /\*\*styled text\*\*/u },
  {
    name: "italic",
    css: "font-style: italic;",
    expected: /(?<!\*)\*styled text\*(?!\*)/u,
  },
  // Pandoc escapes the space inside super/subscript, since Markdown's syntax
  // for them cannot contain a bare one.
  {
    name: "superscript",
    css: "vertical-align: super;",
    expected: /\^styled\\ text\^/u,
  },
  {
    name: "subscript",
    css: "vertical-align: sub;",
    expected: /(?<!~)~styled\\ text~(?!~)/u,
  },
  {
    name: "strikethrough",
    css: "text-decoration: line-through;",
    expected: /~~styled text~~/u,
  },
  {
    name: "small-caps",
    css: "font-variant: small-caps;",
    expected: /\{\.smallcaps\}/u,
  },
  {
    name: "monospace",
    css: "font-family: Courier New, monospace;",
    expected: /`styled text`/u,
  },
];

for (const { name, css, expected } of DECLARATIONS) {
  test(`a ${name} class becomes real Markdown`, NEEDS_PANDOC, (t) => {
    const { markdown } = convertWith(t, {
      css: `span.styled { ${css} }\n`,
      markup: `<p><span class="styled">styled text</span></p>`,
    });

    assert.match(markdown, expected);
    assert.doesNotMatch(
      markdown,
      /\.styled/u,
      "the class name itself must not survive",
    );
  });
}

test(
  "a presentation-only class is unwrapped, keeping its text",
  NEEDS_PANDOC,
  (t) => {
    const { markdown } = convertWith(t, {
      css: "span.spacer { margin-left: 4px; color: #ff0000; text-align: center; }\n",
      markup: `<p><span class="spacer">styled text</span></p>`,
    });

    assert.match(markdown, /styled text/u, "the text must survive");
    assert.doesNotMatch(
      markdown,
      /spacer/u,
      "a presentational class must be removed",
    );
  },
);

test("a class the stylesheet never defines is unwrapped", NEEDS_PANDOC, (t) => {
  const { markdown } = convertWith(t, {
    css: "p { margin: 0; }\n",
    markup: `<p><span class="undeclared">styled text</span></p>`,
  });

  assert.match(markdown, /styled text/u);
  assert.doesNotMatch(markdown, /undeclared/u);
});

test("declarations combine, nesting both constructors", NEEDS_PANDOC, (t) => {
  const { markdown } = convertWith(t, {
    css: "span.both { font-weight: bold; font-style: italic; }\n",
    markup: `<p><span class="both">styled text</span></p>`,
  });

  assert.match(markdown, /\*\*\*styled text\*\*\*|\*\*\*styled text\*\*\*/u);
});

test("classes inside a @media block are still read", NEEDS_PANDOC, (t) => {
  const { markdown } = convertWith(t, {
    css: "@media screen {\n  span.styled { font-weight: bold; }\n}\n",
    markup: `<p><span class="styled">styled text</span></p>`,
  });

  assert.match(
    markdown,
    /\*\*styled text\*\*/u,
    "a rule nested in @media must not be skipped",
  );
});

// The whole point of reading the stylesheet is that class names are arbitrary.
// A filter keyed on names would pass the cases above and fail this one.
test(
  "the same meaning is found under an unrelated class name",
  NEEDS_PANDOC,
  (t) => {
    const { markdown } = convertWith(t, {
      css: "span.wibble-42 { font-weight: 700; }\n",
      markup: `<p><span class="wibble-42">styled text</span></p>`,
    });

    assert.match(markdown, /\*\*styled text\*\*/u);
  },
);

// Converting a Span into Strong discards its identifier. If a link pointed at
// that identifier, cleaning would break navigation — the same defect that once
// dangled every cross-reference in a standards document.
test(
  "a styled span that is a link target keeps its anchor",
  NEEDS_PANDOC,
  (t) => {
    const { markdown } = convertWith(t, {
      css: "span.styled { font-weight: bold; }\n",
      markup:
        `<p><a href="#target">jump</a></p>` +
        `<p><span class="styled" id="target">styled text</span></p>`,
    });

    const targets = [...markdown.matchAll(/\]\(#([^)]+)\)/gu)].map(
      ([, id]) => id,
    );
    const defined = new Set(
      [...markdown.matchAll(/\{#([^\s}]+)/gu)].map(([, id]) => id),
    );

    assert.ok(targets.length > 0, "the fixture must produce an internal link");
    assert.deepEqual(
      targets.filter((id) => !defined.has(id)),
      [],
      "styling a span must not delete the anchor a link points at",
    );
    assert.match(markdown, /styled text/u);
  },
);

// Some publishers set bulleted lists as plain paragraphs opening with a dash,
// with no list markup in the source at all. Reconstructing the list needs a
// second signal, because dash-initial paragraphs are also how Russian and
// French prose sets dialogue. The hanging indent is that signal.
const DASH = "—";

test(
  "dash paragraphs the stylesheet outdents become a bullet list",
  NEEDS_PANDOC,
  (t) => {
    const { markdown } = convertWith(t, {
      css: "p.listitem { text-indent: -1.5em; margin-left: 1.5em; }\nspan.marker { margin-right: 0.25em; }\n",
      markup:
        `<p class="listitem">${DASH}<span class="marker">&#9;</span>first item</p>` +
        `<p class="listitem">${DASH}<span class="marker">&#9;</span>second item</p>`,
    });

    assert.match(markdown, /^- first item$/mu);
    assert.match(markdown, /^- second item$/mu);
    assert.doesNotMatch(
      markdown,
      new RegExp(`^${DASH}`, "mu"),
      "the bullet glyph must be consumed",
    );
  },
);

// The safety case. A novel that opens dialogue with a dash indents the first
// line rather than outdenting it, so the gate stays shut and the prose is left
// exactly as written.
test(
  "dash paragraphs with an ordinary first-line indent stay prose",
  NEEDS_PANDOC,
  (t) => {
    const { markdown } = convertWith(t, {
      css: "p.speech { text-indent: 1.5em; }\nspan.marker { margin-right: 0.25em; }\n",
      markup:
        `<p class="speech">${DASH}<span class="marker">&#9;</span>I am dialogue, not a list.</p>` +
        `<p class="speech">${DASH}<span class="marker">&#9;</span>So am I.</p>`,
    });

    assert.doesNotMatch(
      markdown,
      /^- /mu,
      "indented prose must never become a bullet list",
    );
    assert.match(
      markdown,
      /I am dialogue, not a list\./u,
      "the text must survive untouched",
    );
  },
);

test(
  "a book with no outdented dash paragraphs records no list markers",
  NEEDS_PANDOC,
  (t) => {
    const { json } = convertWith(t, {
      css: "p.speech { text-indent: 1.5em; }\n",
      markup: `<p class="speech">${DASH}<span class="marker">&#9;</span>dialogue</p>`,
    });

    const lua = readFileSync(json.style_map, "utf8");
    const markers = lua.slice(lua.indexOf("list_markers"));

    assert.doesNotMatch(
      markers,
      /\["marker"\]/u,
      "the marker set must stay empty",
    );
  },
);

test("a run of dash items becomes one list, not several", NEEDS_PANDOC, (t) => {
  const { markdown } = convertWith(t, {
    css: "p.listitem { text-indent: -1.5em; }\nspan.marker { margin-right: 0.25em; }\n",
    markup:
      `<p class="listitem">${DASH}<span class="marker">&#9;</span>alpha</p>` +
      `<p class="listitem">${DASH}<span class="marker">&#9;</span>beta</p>` +
      `<p>An ordinary paragraph.</p>` +
      `<p class="listitem">${DASH}<span class="marker">&#9;</span>gamma</p>`,
  });

  const items = [...markdown.matchAll(/^- (\w+)$/gmu)].map(([, word]) => word);

  assert.deepEqual(items, ["alpha", "beta", "gamma"]);
  // The intervening paragraph must break the run rather than be absorbed.
  assert.match(markdown, /^An ordinary paragraph\.$/mu);
});

test("the generated style map is written and reported", NEEDS_PANDOC, (t) => {
  const { json } = convertWith(t, {
    css: "span.styled { font-weight: bold; }\n",
    markup: `<p><span class="styled">styled text</span></p>`,
  });

  assert.ok(json.style_map, "the result must report the generated style map");
  assert.ok(existsSync(json.style_map), "the style map file must exist");

  const lua = readFileSync(json.style_map, "utf8");

  assert.match(
    lua,
    /\["styled"\] = \{"strong"\}/u,
    "the map must record the derived semantics",
  );
});
