"""Derive a class-to-semantics map from an EPUB's own stylesheets.

Pandoc's EPUB reader preserves the publisher's CSS class names on Span and Div
elements, so converted Markdown arrives full of `[text]{.CharOverride-2}` and
`::: {.MainContent}` noise. The class names are meaningless outside the book
that defined them - one publisher's bold is `CharOverride-2`, another's is
`Bold`, a third uses `<strong>` and no class at all - so no hardcoded list of
names can clean EPUBs in general.

The stylesheet is the missing piece. It says what each class actually does, and
a handful of CSS declarations correspond exactly to Pandoc inline constructors:
`font-weight: bold` is Strong, `font-style: italic` is Emph, and so on. This
module reads those declarations and produces a map the Lua filter applies.

Classes whose declarations are purely presentational - margins, text-align,
colour, spacing - map to an empty list, meaning "unwrap": keep the text, drop
the wrapper. The map is therefore an allowlist of meaning, and everything not
on it is presentation to be removed.
"""

from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Dict, Iterator, List, Tuple

# Fixed order so a class carrying several declarations always nests its
# constructors the same way, and the generated map is reproducible.
SEMANTIC_ORDER = ["strong", "emph", "smallcaps", "strikeout", "superscript", "subscript", "code"]

BOLD_WEIGHTS = {"bold", "bolder", "600", "700", "800", "900"}
MONOSPACE_HINTS = ("mono", "courier", "consolas", "menlo", "typewriter")

# At-rules that wrap ordinary rules; their contents still apply to the document.
TRANSPARENT_AT_RULES = {"@media", "@supports", "@document", "@layer"}

CLASS_IN_SELECTOR = re.compile(r"\.(-?[A-Za-z_][-\w]*)")
COMMENT = re.compile(r"/\*.*?\*/", re.S)
CLASS_PREFIX_SELECTOR = re.compile(r'\[class\^="([^"]+)"\]')

STYLE_MAP_NAME = "style-map.lua"

# Em dash, en dash, and the horizontal bar, all used as bullet glyphs.
DASH_GLYPHS = "—–―"

# A paragraph that opens with a dash and hands off to a marker span. The span
# is the only part of this structure that survives into Pandoc's AST, because
# Para carries no attributes there.
DASH_MARKER = re.compile(
    r'<p[^>]*class="([^"]+)"[^>]*>\s*[' + DASH_GLYPHS + r']\s*<span[^>]*class="([^"]+)"'
)

MARKUP_SUFFIXES = (".xhtml", ".html", ".htm", ".xml")


def _iter_rules(css: str) -> Iterator[Tuple[str, str]]:
    """Yield (selector, declaration block) pairs, descending into at-rules.

    Written as a brace scanner rather than a regex because `@media` blocks nest
    rules one level deeper, and a regex that ignores nesting silently drops
    every rule inside them.
    """
    index = 0
    length = len(css)
    prelude: List[str] = []

    while index < length:
        character = css[index]

        if character == "}":
            # Stray close brace; resynchronise rather than abort.
            prelude = []
            index += 1
            continue

        if character != "{":
            prelude.append(character)
            index += 1
            continue

        selector = "".join(prelude).strip()
        prelude = []

        depth = 1
        cursor = index + 1
        while cursor < length and depth:
            if css[cursor] == "{":
                depth += 1
            elif css[cursor] == "}":
                depth -= 1
            cursor += 1

        body = css[index + 1 : cursor - 1]

        if selector.startswith("@"):
            if selector.split()[0].lower() in TRANSPARENT_AT_RULES:
                yield from _iter_rules(body)
            # @font-face, @page and friends define no document semantics.
        else:
            yield selector, body

        index = cursor


def _declarations(block: str) -> Dict[str, str]:
    parsed: Dict[str, str] = {}

    for part in block.split(";"):
        if ":" not in part:
            continue
        prop, _, value = part.partition(":")
        parsed[prop.strip().lower()] = " ".join(value.split()).lower()

    return parsed


def semantics_for(declarations: Dict[str, str]) -> List[str]:
    """Map CSS declarations to the Pandoc inline constructors they correspond to."""
    found = set()

    if declarations.get("font-weight", "") in BOLD_WEIGHTS:
        found.add("strong")

    if declarations.get("font-style", "") in ("italic", "oblique"):
        found.add("emph")

    vertical_align = declarations.get("vertical-align", "")
    if vertical_align == "super":
        found.add("superscript")
    elif vertical_align == "sub":
        found.add("subscript")

    decoration = " ".join(
        (declarations.get("text-decoration", ""), declarations.get("text-decoration-line", ""))
    )
    if "line-through" in decoration:
        found.add("strikeout")

    family = declarations.get("font-family", "")
    if any(hint in family for hint in MONOSPACE_HINTS):
        found.add("code")

    small_caps = (
        declarations.get("font-variant", ""),
        declarations.get("font-variant-caps", ""),
    )
    if "small-caps" in small_caps:
        found.add("smallcaps")

    return [name for name in SEMANTIC_ORDER if name in found]


def _is_hanging(indent: str) -> bool:
    """True for a negative text-indent, which outdents the first line.

    That is how a bullet is set: the marker hangs to the left of the text
    block. Ordinary prose does the opposite, indenting the first line, so the
    sign of this one property separates a list from a paragraph that merely
    happens to begin with a dash - as most dialogue in Russian and French
    fiction does.
    """
    return indent.strip().startswith("-")


def build_maps(epub_path: Path) -> Tuple[Dict[str, List[str]], List[str]]:
    """Return the class-to-semantics map and the list-marker span classes."""
    style_map: Dict[str, List[str]] = {}
    hanging_exact = set()
    hanging_prefixes = []

    with zipfile.ZipFile(epub_path) as archive:
        names = archive.namelist()

        for name in [n for n in names if n.lower().endswith(".css")]:
            try:
                css = archive.read(name).decode("utf-8", "replace")
            except (OSError, zipfile.BadZipFile):
                continue

            css = COMMENT.sub("", css)

            for selector_group, block in _iter_rules(css):
                declarations = _declarations(block)
                semantics = semantics_for(declarations)
                hanging = _is_hanging(declarations.get("text-indent", ""))

                for selector in selector_group.split(","):
                    if hanging:
                        hanging_prefixes.extend(CLASS_PREFIX_SELECTOR.findall(selector))

                    for class_name in CLASS_IN_SELECTOR.findall(selector):
                        if hanging:
                            hanging_exact.add(class_name)

                        existing = style_map.get(class_name)
                        # Several rules can target one class. Keep the first
                        # semantic reading found; never let a later
                        # presentation-only rule downgrade a class to unwrap.
                        if existing is None or (semantics and not existing):
                            style_map[class_name] = semantics

        def outdented(class_attribute: str) -> bool:
            for token in class_attribute.split():
                if token in hanging_exact:
                    return True
                if any(token.startswith(prefix) for prefix in hanging_prefixes):
                    return True
            return False

        markers = set()
        for name in [n for n in names if n.lower().endswith(MARKUP_SUFFIXES)]:
            try:
                markup = archive.read(name).decode("utf-8", "replace")
            except (OSError, zipfile.BadZipFile):
                continue

            for paragraph_classes, span_classes in DASH_MARKER.findall(markup):
                if outdented(paragraph_classes):
                    markers.update(span_classes.split())

    return style_map, sorted(markers)


def build_style_map(epub_path: Path) -> Dict[str, List[str]]:
    return build_maps(epub_path)[0]


def _lua_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def render_lua(style_map: Dict[str, List[str]], list_markers: List[str]) -> str:
    """Serialise both maps as a Lua module the filter loads with dofile().

    A generated Lua table avoids needing a JSON parser inside the filter, and
    leaves a readable artifact next to the converted Markdown explaining why a
    given book cleaned the way it did.
    """
    lines = [
        "-- Generated by reading-epubs from the EPUB's own stylesheets.",
        "return {",
        "  -- class name -> Pandoc inline constructors; {} means unwrap.",
        "  styles = {",
    ]

    for class_name in sorted(style_map):
        semantics = style_map[class_name]
        rendered = ", ".join(_lua_string(name) for name in semantics)
        lines.append(f"    [{_lua_string(class_name)}] = {{{rendered}}},")

    lines.extend(
        [
            "  },",
            "  -- Span classes that mark the gap after a dash bullet, in",
            "  -- paragraphs the stylesheet outdents. Empty unless this book",
            "  -- sets dash lists with a hanging indent.",
            "  list_markers = {",
        ]
    )

    for class_name in list_markers:
        lines.append(f"    [{_lua_string(class_name)}] = true,")

    lines.extend(["  },", "}"])

    return "\n".join(lines) + "\n"


def write_style_map(epub_path: Path, output_dir: Path) -> Tuple[Path, Dict[str, List[str]], List[str]]:
    style_map, list_markers = build_maps(epub_path)
    destination = output_dir / STYLE_MAP_NAME

    destination.write_text(render_lua(style_map, list_markers), encoding="utf-8")

    return destination, style_map, list_markers
