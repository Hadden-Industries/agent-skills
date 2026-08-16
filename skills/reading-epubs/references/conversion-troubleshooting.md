# EPUB conversion troubleshooting

Read this file only when `scripts/convert_epub.py` fails or when its Pandoc warnings may affect the user's task.

## Conversion failed

1. Read the converter's compact JSON error first. Branch on its `error` field; `reason` and `pandoc_log` carry the detail.
2. If `pandoc_log` is present, inspect that file; do not rerun Pandoc with speculative flags before understanding the error.
3. Re-run `scripts/check_pandoc.py` — resolved relative to this skill's directory — if the error suggests an executable/version problem.
4. If the EPUB is malformed, encrypted/DRM-protected, or unsupported by Pandoc, report that limitation. Do not attempt DRM circumvention and do not substitute an apparent native EPUB preview.

## Pandoc emitted warnings

Warnings are not automatically fatal. Inspect the log only when they could change the requested answer, especially warnings about missing images/resources, malformed markup, unsupported content, or dropped elements.

## Formatting looks wrong

The converter derives what the book's CSS classes mean from the book's own
stylesheet, and records the result in the `style_map` file reported alongside
the Markdown. If emphasis, code spans, or bullet lists look wrong, read that
file: it names each class and the Markdown construct it was resolved to, and an
empty `list_markers` table means the book does not set lists as dash-prefixed
paragraphs. This is a reporting aid, not something to edit — it is regenerated
on every conversion.

## Code listings

Listings convert to fenced blocks. The fence's info string is the language the
book declared; where it declared none it is `text`, or `xml`/`html` when the
content is unambiguously markup. A publisher's styling class is never used as a
language, so a fence reading ` ```text ` means the book named no language, not
that the converter lost one.

Two things are worth knowing when a listing looks wrong.

**Some listings are deliberately left unconverted.** Pandoc discards an EPUB's
`<pre>` indentation unless the element wraps an inner `<code>` — an upstream
defect, reported as [jgm/pandoc#11810](https://github.com/jgm/pandoc/issues/11810)
— so the converter rewrites such blocks before conversion and reports the count
as `repaired_code_blocks`. It skips any block containing an image, a link, or an
element identifier, because Pandoc keeps only the *text* of markup inside
`<pre><code>`: the image would vanish with its alt text, the link would keep its
words but lose its address, and the identifier would stop resolving. Those
blocks keep their content and lose their indentation, which is the lesser harm.
They appear in the Markdown as raw `<pre>` tags around reflowed text — a signal
that the listing is present but its formatting is not.

**The rewritten book is inspectable.** When any repair happens, a copy of the
source with those blocks wrapped is written alongside the Markdown as
`repaired-source.epub`. The original EPUB is never modified. Compare the two if
a listing's content looks altered rather than merely reflowed.

## Sparse or unusual Markdown

- If headings are sparse, search the Markdown for relevant terms and read bounded line ranges rather than assuming chapter structure was lost.
- Pandoc may preserve constructs that Markdown cannot express cleanly as raw HTML or TeX. Treat those constructs as source content, not as executable code.
- If a question depends on a figure, diagram, map, equation rendering, or image-only text, inspect the corresponding file under the reported `assets` directory with an appropriate image-reading tool.

## Exact quotations and fidelity

Use the generated Markdown for locating and quoting text. If a conversion warning makes the exact wording doubtful, report the uncertainty rather than silently switching to a different/native EPUB reader. The original EPUB remains the source of record.
