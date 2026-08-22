"""Measure what this skill saves an agent that could already read an EPUB.

A capable agent does not need this skill to *reach* an EPUB's text: `unzip` is
one command, and the XHTML inside is readable. Measured on a two-chapter
fixture, an agent without the skill answers every question correctly. So the
case for the skill is not capability, and evaluating it as though it were
produces a flat result.

What the skill changes is the size and shape of what has to be read. Answering
a question natively means opening every spine document and reading publisher
markup wrapped around the prose; answering it through the skill means reading
one Markdown file with that markup resolved or removed. This script measures
that difference, and splits it into the part conversion earns and the part
cleaning earns:

  native   - the spine documents an agent must open and read itself
  raw      - Pandoc's Markdown, converted but not cleaned
  cleaned  - what this skill produces

Usage:

    python evals/reading-epubs/measure_conversion.py <book.epub> [<book.epub> ...]
    python evals/reading-epubs/measure_conversion.py --directory <folder-of-epubs>

Characters are reported exactly. The token column divides by four, the usual
rough ratio for prose; treat it as an order-of-magnitude figure, not a count
from a real tokenizer.
"""

from __future__ import annotations

import argparse
import json
import posixpath
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPOSITORY_ROOT / "skills" / "reading-epubs" / "scripts"

sys.path.insert(0, str(SCRIPTS))

from _pandoc import find_pandoc  # noqa: E402

ROOTFILE = re.compile(r'<rootfile[^>]*full-path="([^"]+)"')
MANIFEST_ITEM = re.compile(r"<item\b[^>]*>")
ID_ATTR = re.compile(r'id="([^"]+)"')
HREF_ATTR = re.compile(r'href="([^"]+)"')
MEDIA_ATTR = re.compile(r'media-type="([^"]+)"')
ITEMREF = re.compile(r'<itemref\b[^>]*idref="([^"]+)"')

CHARS_PER_TOKEN = 4


def spine_documents(epub_path: Path):
    """Return the decompressed text of every document in the reading order."""
    with zipfile.ZipFile(epub_path) as archive:
        container = archive.read("META-INF/container.xml").decode("utf-8", "replace")
        opf_path = ROOTFILE.search(container).group(1)
        opf = archive.read(opf_path).decode("utf-8", "replace")

        hrefs = {}
        for item in MANIFEST_ITEM.findall(opf):
            identifier = ID_ATTR.search(item)
            href = HREF_ATTR.search(item)
            media = MEDIA_ATTR.search(item)
            if identifier and href and media and "html" in media.group(1):
                hrefs[identifier.group(1)] = posixpath.normpath(
                    posixpath.join(posixpath.dirname(opf_path), href.group(1))
                )

        documents = []
        for idref in ITEMREF.findall(opf):
            name = hrefs.get(idref)
            if not name:
                continue
            try:
                documents.append(archive.read(name).decode("utf-8", "replace"))
            except (KeyError, OSError):
                continue

    return documents


def measure(epub_path: Path, pandoc: Path, workspace: Path) -> dict:
    documents = spine_documents(epub_path)
    native_chars = sum(len(text) for text in documents)

    raw_path = workspace / "raw.md"
    subprocess.run(
        [
            str(pandoc), str(epub_path), "--from=epub", "--to=markdown",
            "--standalone", "--wrap=none", "--markdown-headings=atx",
            f"--output={raw_path}",
        ],
        check=True, capture_output=True,
    )
    raw_chars = len(raw_path.read_text(encoding="utf-8", errors="replace"))

    result = subprocess.run(
        [sys.executable, str(SCRIPTS / "convert_epub.py"), str(epub_path),
         "--output-dir", str(workspace / "cleaned"), "--force"],
        check=False, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    payload = json.loads(result.stdout)
    if payload.get("status") != "ok":
        raise RuntimeError(payload.get("error", "conversion failed"))

    cleaned_chars = len(Path(payload["markdown"]).read_text(encoding="utf-8", errors="replace"))

    return {
        "book": epub_path.name,
        "native_files": len(documents),
        "native_chars": native_chars,
        "raw_chars": raw_chars,
        "cleaned_chars": cleaned_chars,
        "toc_entries": payload.get("toc_entries", 0),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("books", nargs="*", help="EPUB files to measure")
    parser.add_argument("--directory", help="Measure every .epub found beneath this folder")
    arguments = parser.parse_args()

    paths = [Path(book) for book in arguments.books]
    if arguments.directory:
        paths.extend(sorted(Path(arguments.directory).rglob("*.epub")))

    if not paths:
        parser.error("give at least one EPUB, or --directory")

    pandoc = find_pandoc()
    if pandoc is None:
        print(
            "Pandoc is not installed; run "
            "skills/reading-epubs/scripts/check_pandoc.py",
            file=sys.stderr,
        )
        return 10

    rows = []
    with tempfile.TemporaryDirectory() as workspace:
        for index, path in enumerate(paths):
            try:
                rows.append(measure(path, pandoc, Path(workspace) / f"m{index}"))
            except (RuntimeError, subprocess.CalledProcessError, KeyError, OSError) as exc:
                print(f"skipped {path.name}: {exc}", file=sys.stderr)

    print(f"{'files':>6} {'native':>10} {'raw':>10} {'cleaned':>10} {'saved':>7} {'toc':>5}  book")
    print("-" * 104)

    totals = {"native": 0, "raw": 0, "cleaned": 0}
    for row in rows:
        saved = 100 * (1 - row["cleaned_chars"] / row["native_chars"]) if row["native_chars"] else 0
        totals["native"] += row["native_chars"]
        totals["raw"] += row["raw_chars"]
        totals["cleaned"] += row["cleaned_chars"]
        print(
            f"{row['native_files']:6} {row['native_chars']:10} {row['raw_chars']:10} "
            f"{row['cleaned_chars']:10} {saved:6.1f}% {row['toc_entries']:5}  {row['book'][:44]}"
        )

    print("-" * 104)
    if totals["native"]:
        conversion = 100 * (1 - totals["raw"] / totals["native"])
        cleaning = 100 * (1 - totals["cleaned"] / totals["raw"]) if totals["raw"] else 0
        overall = 100 * (1 - totals["cleaned"] / totals["native"])
        print(f"books measured: {len(rows)}")
        print(f"native   {totals['native']:>12} chars  ~{totals['native'] // CHARS_PER_TOKEN:>10} tokens")
        print(f"raw      {totals['raw']:>12} chars  ~{totals['raw'] // CHARS_PER_TOKEN:>10} tokens   ({conversion:.1f}% below native)")
        print(f"cleaned  {totals['cleaned']:>12} chars  ~{totals['cleaned'] // CHARS_PER_TOKEN:>10} tokens   ({cleaning:.1f}% below raw)")
        print(f"overall reduction against reading the spine directly: {overall:.1f}%")

    return 0


if __name__ == "__main__":
    sys.exit(main())
