"""Extract a book's table of contents and resolve it into the converted Markdown.

Pandoc treats an EPUB's navigation document as structure rather than content:
it uses it to order the spine and then discards it. Nothing about the book's
contents page survives into the Markdown, so a question about the table of
contents cannot be answered from the working representation at all - the reader
has to break out and open the container, which is exactly what the skill tells
them not to do.

This module closes that gap. It reads the navigation - the EPUB 3 `nav`
document where one exists, the EPUB 2 NCX otherwise - and resolves every entry
to the anchor Pandoc generates for it, so the entries can be emitted as data
alongside the Markdown and used to jump straight to a section.

The anchor mapping is deterministic. Pandoc names each anchor after the spine
document's base filename, appending the fragment with an underscore:

    content-3.xhtml#_idTextAnchor098  ->  content-3.xhtml__idTextAnchor098
    chapter-2.xhtml#deep-anchor       ->  chapter-2.xhtml_deep-anchor
    chapter-1.xhtml                   ->  chapter-1.xhtml
"""

from __future__ import annotations

import html
import json
import posixpath
import re
import zipfile
from typing import Dict, List, Optional

TOC_NAME = "toc.json"

CONTAINER_PATH = "META-INF/container.xml"

ROOTFILE = re.compile(r'<rootfile[^>]*full-path="([^"]+)"')
NAV_ITEM = re.compile(r"<item\b[^>]*>")
HREF_ATTR = re.compile(r'href="([^"]+)"')
PROPERTIES_ATTR = re.compile(r'properties="([^"]*)"')

TAG = re.compile(r"<[^>]+>")
WHITESPACE = re.compile(r"\s+")

# EPUB 3 navigation: nested <ol>/<li> inside <nav epub:type="toc">.
NAV_ELEMENT = re.compile(
    r"<nav\b[^>]*epub:type=\"[^\"]*\btoc\b[^\"]*\"[^>]*>(.*?)</nav>", re.S | re.I
)
NAV_TOKEN = re.compile(r"<ol\b[^>]*>|</ol>|<a\b[^>]*>.*?</a>", re.S | re.I)

# EPUB 2 navigation: nested <navPoint> with a label and a content src.
NAVPOINT_TOKEN = re.compile(r"<navPoint\b[^>]*>|</navPoint>", re.I)
NAVPOINT_BODY = re.compile(
    r"<navLabel\b[^>]*>\s*<text\b[^>]*>(.*?)</text>.*?<content\b[^>]*src=\"([^\"]+)\"",
    re.S | re.I,
)


def _clean(text: str) -> str:
    return WHITESPACE.sub(" ", html.unescape(TAG.sub("", text))).strip()


def anchor_for(href: str) -> str:
    """Return the identifier Pandoc generates for a navigation target."""
    target = href.split(")")[0].strip()
    path, _, fragment = target.partition("#")
    base = posixpath.basename(path)

    if not base:
        return fragment

    return f"{base}_{fragment}" if fragment else base


def _opf_path(archive: zipfile.ZipFile) -> Optional[str]:
    try:
        container = archive.read(CONTAINER_PATH).decode("utf-8", "replace")
    except (KeyError, OSError):
        return None

    match = ROOTFILE.search(container)

    return match.group(1) if match else None


def _resolve(base_document: str, href: str) -> str:
    return posixpath.normpath(posixpath.join(posixpath.dirname(base_document), href))


def _nav_document(archive: zipfile.ZipFile, opf_path: str) -> Optional[str]:
    try:
        opf = archive.read(opf_path).decode("utf-8", "replace")
    except (KeyError, OSError):
        return None

    for item in NAV_ITEM.findall(opf):
        properties = PROPERTIES_ATTR.search(item)
        href = HREF_ATTR.search(item)

        if properties and href and "nav" in properties.group(1).split():
            return _resolve(opf_path, href.group(1))

    return None


def _parse_nav(markup: str) -> List[Dict]:
    section = NAV_ELEMENT.search(markup)
    if not section:
        return []

    entries: List[Dict] = []
    depth = 0

    for token in NAV_TOKEN.finditer(section.group(1)):
        text = token.group(0)
        lowered = text.lower()

        if lowered.startswith("<ol"):
            depth += 1
        elif lowered.startswith("</ol"):
            depth = max(0, depth - 1)
        else:
            href = HREF_ATTR.search(text)
            title = _clean(text)
            if href and title:
                entries.append({"title": title, "href": href.group(1), "level": max(1, depth)})

    return entries


def _parse_ncx(markup: str) -> List[Dict]:
    entries: List[Dict] = []
    depth = 0
    position = 0

    for token in NAVPOINT_TOKEN.finditer(markup):
        if token.group(0).lower().startswith("</"):
            depth = max(0, depth - 1)
            continue

        depth += 1
        body = NAVPOINT_BODY.search(markup, token.end())

        if body and body.start() >= position:
            title = _clean(body.group(1))
            if title:
                entries.append({"title": title, "href": body.group(2), "level": depth})
            position = token.end()

    return entries


def build_toc(epub_path) -> List[Dict]:
    """Return [{title, anchor, level}] for the book's table of contents."""
    with zipfile.ZipFile(epub_path) as archive:
        opf_path = _opf_path(archive)
        entries: List[Dict] = []

        if opf_path:
            nav_path = _nav_document(archive, opf_path)
            if nav_path:
                try:
                    entries = _parse_nav(archive.read(nav_path).decode("utf-8", "replace"))
                except (KeyError, OSError):
                    entries = []

        if not entries:
            for name in archive.namelist():
                if name.lower().endswith(".ncx"):
                    try:
                        entries = _parse_ncx(archive.read(name).decode("utf-8", "replace"))
                    except (KeyError, OSError):
                        entries = []
                    break

    resolved = []
    for entry in entries:
        anchor = anchor_for(entry["href"])
        if anchor:
            resolved.append({"title": entry["title"], "anchor": anchor, "level": entry["level"]})

    return resolved


def write_toc(entries: List[Dict], output_dir) -> "object":
    destination = output_dir / TOC_NAME

    destination.write_text(
        json.dumps({"entries": entries}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    return destination
