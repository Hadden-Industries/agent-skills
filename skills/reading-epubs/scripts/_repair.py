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
import shutil
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Tuple

REPAIRED_NAME = "repaired-source.epub"

MARKUP_SUFFIXES = (".xhtml", ".html", ".htm")

PRE_BLOCK = re.compile(r"(<pre\b[^>]*>)(.*?)(</pre\s*>)", re.S | re.I)
PRE_START = re.compile(rb"<pre", re.I)
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


def _repair_entry(source: zipfile.ZipFile, name: str) -> Tuple[bytes, int]:
    data = source.read(name)
    if PRE_START.search(data):
        text, count = repair_markup(data.decode("utf-8", "replace"))
        if count:
            return text.encode("utf-8"), count
    return data, 0


def _copy_entry(source: zipfile.ZipFile, output: zipfile.ZipFile, name: str) -> None:
    try:
        original = source.open(name)
    except (KeyError, OSError):
        return
    with original:
        info = zipfile.ZipInfo(name, time.localtime()[:6])
        info.file_size = source.getinfo(name).file_size
        if info.is_dir():
            info.external_attr = (0o40775 << 16) | 0x10
        info.compress_type = (
            zipfile.ZIP_STORED if name == "mimetype" else zipfile.ZIP_DEFLATED
        )
        with output.open(info, "w") as entry:
            shutil.copyfileobj(original, entry)


def write_repaired_epub(source: zipfile.ZipFile, destination: Path) -> int:
    """Write a copy only if at least one block changes. Return the repair count."""
    # The container format requires `mimetype` first and uncompressed.
    ordered = sorted(source.namelist(), key=lambda name: name != "mimetype")
    unreadable = set()
    for index, name in enumerate(ordered):
        if not name.lower().endswith(MARKUP_SUFFIXES):
            continue
        try:
            data, repaired = _repair_entry(source, name)
        except zipfile.BadZipFile:
            return 0
        except (KeyError, OSError):
            unreadable.add(index)
            continue
        if repaired:
            break
    else:
        return 0

    # Copy the already-inspected prefix without repeating the markup scan.
    with tempfile.TemporaryDirectory(dir=destination.parent) as directory:
        temporary = Path(directory) / destination.name
        with zipfile.ZipFile(
            temporary, "w", compression=zipfile.ZIP_DEFLATED
        ) as output:
            for preceding, member in enumerate(ordered[:index]):
                if preceding not in unreadable:
                    _copy_entry(source, output, member)
            output.writestr(name, data)
            for member in ordered[index + 1 :]:
                if not member.lower().endswith(MARKUP_SUFFIXES):
                    _copy_entry(source, output, member)
                    continue
                try:
                    data, count = _repair_entry(source, member)
                except (KeyError, OSError):
                    continue
                output.writestr(member, data)
                repaired += count
        temporary.replace(destination)
    return repaired
