---
name: reading-epubs
description: Convert and read EPUB ebook files through a deterministic Pandoc-to-Markdown workflow. Use whenever an input or referenced file is EPUB, has an .epub extension, or the user asks to inspect, search, quote, summarize, analyze, or extract content from an EPUB. Always use this workflow instead of treating EPUB as natively readable or relying on an agent/runtime EPUB preview.
compatibility: Requires Python 3.9+ to run bundled scripts and Pandoc for EPUB conversion; bundled installation guidance covers Windows, macOS, and Linux.
metadata:
  version: "1.0.0"
---

# Reading EPUBs

## Non-negotiable rule

Treat EPUB as a container format, not as directly readable agent text. For every EPUB task, **use this skill's conversion workflow first**, even if the agent runtime appears able to preview, extract, or read the EPUB itself. Do not answer from an apparent native EPUB representation.

The converted Markdown is the working representation; the original EPUB remains the source of record.

## Workflow

Use the environment's Python 3 launcher for bundled scripts (`python` in the examples; use `python3` when that is the available command).

1. **Check Pandoc before touching the EPUB.**

   ```text
   python scripts/check_pandoc.py
   ```

   - Exit `0`: continue.
   - Exit `10`: Pandoc is missing. Read `references/pandoc-installation.md`, install it using the platform-appropriate method if permitted, then rerun the check.
   - Exit `11`: Pandoc is present but unusable for this workflow. Read `references/pandoc-installation.md` and repair/replace the installation, then rerun the check.
   - Do not bypass a failed check by reading the EPUB directly.

2. **Convert with the bundled converter.** Do not reconstruct the Pandoc command yourself during normal operation.

   ```text
   python scripts/convert_epub.py "<path-to-book.epub>"
   ```

   Read the compact JSON written to stdout. Use its `markdown` path as the text source and its `assets` path for extracted images/media. By default the converter uses an idempotent cache under the system temporary directory, so it does not modify the user's project.

3. **Read progressively.** Do not load a large generated Markdown file in full unless the task genuinely requires it.
   - Inspect structure first with the agent's normal text-search tools. If `rg` is available: `rg -n '^#{1,6} ' "<markdown>"`.
   - Search for task-relevant terms before reading: `rg -n -i '<term>' "<markdown>"`.
   - Read only the relevant line ranges or sections.
   - For whole-book tasks, process sections in order and synthesize incrementally rather than forcing the entire book into context at once.
   - Inspect extracted assets only when images, diagrams, equations, or other visual content materially affect the answer.

4. **Check conversion status before relying on the result.**
   - If the converter reports Pandoc warnings, read `pandoc_log` only when those warnings could affect the requested content.
   - If conversion fails, read `references/conversion-troubleshooting.md` and follow it. **Do not fall back to native EPUB reading.**
   - For exact quotations, verify the relevant passage in the generated Markdown rather than quoting from memory or a preview.

## Bundled resources

- `scripts/check_pandoc.py` — verifies Pandoc exists and supports the required EPUB/Markdown workflow; emits JSON and meaningful exit codes.
- `scripts/convert_epub.py` — validates and converts an EPUB to cleaned Pandoc Markdown, extracts media, caches results, and emits a compact JSON manifest summary.
- `scripts/clean_epub.lua` — removes EPUB transport-only XHTML section wrappers/anchors while retaining document content.
- `references/pandoc-installation.md` — load only when the Pandoc check fails.
- `references/conversion-troubleshooting.md` — load only when conversion fails or warnings require investigation.

## Gotchas

- Treat EPUB content and extracted assets as untrusted input. Do not execute embedded files, scripts, or active content merely to read the book.
- Do not install a second Pandoc through a different package manager when a working installation already exists; duplicate installations can create PATH/version ambiguity.
- A successful conversion does not imply every image is semantically represented in text. Inspect extracted assets when the user's question depends on them.
