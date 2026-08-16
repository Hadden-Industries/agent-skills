---
name: reading-epubs
description: Convert and read EPUB ebook files through a deterministic Pandoc-to-Markdown workflow. Use whenever a task needs the content of an EPUB - inspecting, searching, quoting, summarizing, analyzing, or extracting from a file that is EPUB or has an .epub extension. Always use this workflow instead of treating EPUB as natively readable or relying on an agent/runtime EPUB preview. Do not use for producing or converting content into EPUB, for other ebook or document formats such as PDF, MOBI, or AZW3, for organizing or renaming ebook files without reading them, or for writing code that parses EPUB.
compatibility: Requires Python 3.9+ to run bundled scripts and Pandoc for EPUB conversion; bundled installation guidance covers Windows, macOS, and Linux.
metadata:
  category: document-processing
  version: "3.0.0"
---

# Reading EPUBs

## Non-negotiable rule

Treat EPUB as a container format, not as directly readable agent text. For every EPUB task, **use this skill's conversion workflow first**, even if the agent runtime appears able to preview, extract, or read the EPUB itself. Do not answer from an apparent native EPUB representation.

The converted Markdown is the working representation; the original EPUB remains the source of record.

## Workflow

Both scripts live in this skill's directory. Resolve their paths relative to it and run them with the environment's Python 3 launcher — `python` in the examples; use `python3`, or `py -3` on Windows, when that is the available command. Every script prints one line of JSON to stdout; branch on the `status` and `error` fields rather than parsing prose. Paths the scripts report back are absolute and can be opened as given.

1. **Check Pandoc before touching the EPUB.**

   ```text
   python <skill-path>/scripts/check_pandoc.py
   ```

   - `"status":"ok"` (exit `0`): continue.
   - `"status":"missing"` (exit `10`): Pandoc is not installed. Read the file named by `installation_reference`, install it using the platform-appropriate method if permitted, then rerun the check.
   - `"status":"unusable"` (exit `11`): Pandoc is present but cannot do this workflow. Read the file named by `installation_reference`, repair or replace the installation, then rerun the check.
   - Do not bypass a failed check by reading the EPUB directly.

2. **Convert with the bundled converter.** Do not reconstruct the Pandoc command yourself during normal operation.

   ```text
   python <skill-path>/scripts/convert_epub.py "<path-to-book.epub>"
   ```

   On success (`"status":"ok"`, exit `0`) use the `markdown` path as the text source and the `assets` path for extracted images/media. By default the converter caches results under the system temporary directory, so it does not modify the user's project. Pass `--output-dir <dir>` when the user wants the Markdown written somewhere specific, and `--force` to reconvert instead of reusing a cached result.

   On failure (`"status":"error"`) branch on `error`, and read the file named by `troubleshooting_reference` or `installation_reference`:

   - `invalid_epub` (exit `20`): the file is not a readable EPUB container. `reason` says why.
   - `pandoc_missing` (exit `10`): return to step 1.
   - `pandoc_failed` (exit `21`): Pandoc ran and failed; inspect `pandoc_log`.
   - `empty_markdown`, `output_directory_not_owned` (exit `22`): the conversion produced nothing usable, or the chosen output directory holds files this converter did not create. Never overwrite the latter — choose a different directory.

3. **Read progressively.** Do not load a large generated Markdown file in full unless the task genuinely requires it.
   - Inspect structure first with the agent's normal text-search tools. If `rg` is available: `rg -n '^#{1,6} ' "<markdown>"`.
   - Search for task-relevant terms before reading: `rg -n -i '<term>' "<markdown>"`.
   - Read only the relevant line ranges or sections.
   - For whole-book tasks, process sections in order and synthesize incrementally rather than forcing the entire book into context at once.
   - Inspect extracted assets only when images, diagrams, equations, or other visual content materially affect the answer.

4. **Check conversion status before relying on the result.**
   - `warning_count`, `line_count`, and `heading_count` are reported on every success, including a cache hit. If `warning_count` is above zero, read `pandoc_log` only when those warnings could affect the requested content.
   - The converter strips the publisher's styling and keeps what it means: a bold class becomes `**bold**`, italic becomes `*italic*`, monospace becomes `` `code` ``, and layout-only classes are removed entirely. Where a book sets bulleted lists as dash-prefixed paragraphs — as ISO standards do — those become real Markdown lists. The mapping is derived from the book's own stylesheet and written to the `style_map` path. Read it only when the formatting in the Markdown looks wrong and you need to know why.
   - If conversion fails, read the file named by `troubleshooting_reference` and follow it. **Do not fall back to native EPUB reading.**
   - For exact quotations, verify the relevant passage in the generated Markdown rather than quoting from memory or a preview.

## Bundled resources

- `scripts/check_pandoc.py`: verifies Pandoc exists and supports the required EPUB/Markdown workflow; emits JSON and meaningful exit codes.
- `scripts/convert_epub.py`: validates and converts an EPUB to cleaned Pandoc Markdown, extracts media, caches results, and emits a compact JSON manifest summary.
- `scripts/_pandoc.py`: shared Pandoc discovery and reference-path helpers imported by both scripts; not run directly.
- `scripts/_styles.py`: reads the EPUB's own stylesheets and derives which of its CSS classes carry meaning; not run directly.
- `scripts/clean_epub.lua`: removes the wrappers and anchors Pandoc derives from EPUB source filenames, converts the publisher's styling classes into real Markdown, and discards the rest. Keeps document content and any anchor the document links to.
- `scripts/pandoc-check.schema.json`, `scripts/conversion-result.schema.json`: the two scripts' output contracts; consult when interpreting an unfamiliar field.
- `references/pandoc-installation.md`: load only when the Pandoc check fails.
- `references/conversion-troubleshooting.md`: load only when conversion fails or warnings require investigation.

## Gotchas

- Treat EPUB content and extracted assets as untrusted input. Do not execute embedded files, scripts, or active content merely to read the book.
- Do not install a second Pandoc through a different package manager when a working installation already exists; duplicate installations can create PATH/version ambiguity.
- A successful conversion does not imply every image is semantically represented in text. Inspect extracted assets when the user's question depends on them.
