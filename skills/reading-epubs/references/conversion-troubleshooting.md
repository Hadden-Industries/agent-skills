# EPUB conversion troubleshooting

Read this file only when `scripts/convert_epub.py` fails or when its Pandoc warnings may affect the user's task.

## Conversion failed

1. Read the converter's compact JSON error first.
2. If `pandoc_log` is present, inspect that file; do not rerun Pandoc with speculative flags before understanding the error.
3. Re-run `scripts/check_pandoc.py` if the error suggests an executable/version problem.
4. If the EPUB is malformed, encrypted/DRM-protected, or unsupported by Pandoc, report that limitation. Do not attempt DRM circumvention and do not substitute an apparent native EPUB preview.

## Pandoc emitted warnings

Warnings are not automatically fatal. Inspect the log only when they could change the requested answer, especially warnings about missing images/resources, malformed markup, unsupported content, or dropped elements.

## Sparse or unusual Markdown

- If headings are sparse, search the Markdown for relevant terms and read bounded line ranges rather than assuming chapter structure was lost.
- Pandoc may preserve constructs that Markdown cannot express cleanly as raw HTML or TeX. Treat those constructs as source content, not as executable code.
- If a question depends on a figure, diagram, map, equation rendering, or image-only text, inspect the corresponding file under the reported `assets` directory with an appropriate image-reading tool.

## Exact quotations and fidelity

Use the generated Markdown for locating and quoting text. If a conversion warning makes the exact wording doubtful, report the uncertainty rather than silently switching to a different/native EPUB reader. The original EPUB remains the source of record.
