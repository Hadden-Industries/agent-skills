"""Repair `<pre>` blocks that Pandoc would otherwise flatten.

Pandoc's HTML reader treats a `<pre>` element as a code block only when it
wraps an inner `<code>`. A bare `<pre>` is read as an ordinary paragraph and
its leading whitespace is discarded:

    <pre>alpha
        beta</pre>

    -> Para [Str "alpha", SoftBreak, Str "beta"]      (indentation gone)

HTML defines `<pre>` as the preformatted element on its own; the inner `<code>`
adds the claim that the content *is* code, not the claim that its whitespace
matters. Confirmed against Pandoc 3.10.2. Wrapping the content in `<code>`
before Pandoc reads the book puts it on the path that preserves whitespace.

This is an upstream defect, reported as jgm/pandoc#11810:

    https://github.com/jgm/pandoc/issues/11810

**Retiring this module.** Do not remove it when that issue is closed. The skill
supports whatever Pandoc the user already has, and `check_pandoc.py`
deliberately accepts any build that can read EPUB and write Markdown, so a
fixed Pandoc upstream says nothing about the one doing the conversion. It
becomes safe to delete only once the oldest Pandoc the skill supports contains
the fix — which means first giving `check_pandoc.py` a minimum version to
enforce. Until then, the repair is inert for books that do not need it and
costs them one scan.

Two limits keep the rewrite honest. It runs only for books that contain such a
block, so an ordinary book is converted from its original file. And it skips
any block whose meaning would not survive the wrap, because Pandoc keeps only
the text of markup inside `<pre><code>`: an image disappears entirely, a link
keeps its text but loses its address, and an element loses an identifier that
another part of the book may point at. For those, a mangled indent is the
lesser harm.

The original EPUB is never modified; a repaired copy is written beside the
converted output so the transformation can be inspected.
"""

from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Tuple

REPAIRED_NAME = "repaired-source.epub"

MARKUP_SUFFIXES = (".xhtml", ".html", ".htm")

PRE_BLOCK = re.compile(r"(<pre\b[^>]*>)(.*?)(</pre\s*>)", re.S | re.I)
OPENS_WITH_CODE = re.compile(r"\A\s*<code\b", re.I)

# Markup whose meaning is not carried by its text, and so cannot survive being
# wrapped in <code>.
UNRECOVERABLE = (
    re.compile(r"<img\b", re.I),
    re.compile(r"<a\b[^>]*\bhref=", re.I),
    re.compile(r"<[a-zA-Z][\w:-]*\b[^>]*\bid=", re.I),
)


def _wrappable(body: str) -> bool:
    if OPENS_WITH_CODE.match(body):
        return False

    return not any(pattern.search(body) for pattern in UNRECOVERABLE)


def repair_markup(text: str) -> Tuple[str, int]:
    """Wrap the content of each bare <pre> in <code>. Returns (text, repaired)."""
    repaired = 0

    def replace(match: "re.Match[str]") -> str:
        nonlocal repaired

        opening, body, closing = match.group(1), match.group(2), match.group(3)

        if not _wrappable(body):
            return match.group(0)

        repaired += 1

        return f"{opening}<code>{body}</code>{closing}"

    return PRE_BLOCK.sub(replace, text), repaired


def _markup_entries(archive: zipfile.ZipFile):
    return [name for name in archive.namelist() if name.lower().endswith(MARKUP_SUFFIXES)]


def needs_repair(epub_path: Path) -> bool:
    """Cheap gate: returns at the first repairable block found."""
    try:
        with zipfile.ZipFile(epub_path) as archive:
            for name in _markup_entries(archive):
                try:
                    text = archive.read(name).decode("utf-8", "replace")
                except (KeyError, OSError):
                    continue

                for match in PRE_BLOCK.finditer(text):
                    if _wrappable(match.group(2)):
                        return True
    except (zipfile.BadZipFile, OSError):
        return False

    return False


def write_repaired_epub(epub_path: Path, destination: Path) -> int:
    """Write a repaired copy of the book. Returns the number of blocks fixed."""
    repaired = 0

    with zipfile.ZipFile(epub_path) as source:
        # The container format requires `mimetype` first and uncompressed.
        ordered = sorted(source.namelist(), key=lambda name: name != "mimetype")

        with zipfile.ZipFile(destination, "w") as output:
            for name in ordered:
                try:
                    data = source.read(name)
                except (KeyError, OSError):
                    continue

                if name.lower().endswith(MARKUP_SUFFIXES):
                    text, count = repair_markup(data.decode("utf-8", "replace"))
                    if count:
                        data = text.encode("utf-8")
                        repaired += count

                compression = (
                    zipfile.ZIP_STORED if name == "mimetype" else zipfile.ZIP_DEFLATED
                )
                output.writestr(name, data, compress_type=compression)

    return repaired
