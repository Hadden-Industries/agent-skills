#!/usr/bin/env python3
"""Convert an EPUB into agent-readable Pandoc Markdown plus extracted assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

from _styles import STYLE_MAP_NAME, write_style_map

from _pandoc import (
    INSTALLATION_REFERENCE,
    TROUBLESHOOTING_REFERENCE,
    find_pandoc,
    pandoc_version_line,
)

EXIT_OK = 0
# 10 deliberately matches check_pandoc.py: it means "Pandoc is missing" in both
# scripts. Every other failure here uses the 20s, because SKILL.md teaches the
# checker's codes first and a number must not mean two different things.
EXIT_PANDOC_MISSING = 10
EXIT_BAD_INPUT = 20
EXIT_PANDOC_FAILED = 21
EXIT_BAD_OUTPUT = 22

MANIFEST_NAME = "manifest.json"
MARKDOWN_NAME = "document.md"
LOG_NAME = "pandoc.stderr.log"
ASSETS_NAME = "assets"

# Declared by scripts/conversion-result.schema.json. Bump both together whenever
# the output shape changes; SKILL.md branches on these fields.
SCHEMA_VERSION = 1

# Reported on both a fresh conversion and a cache hit. Dropping them on a cache
# hit would silently remove the signal SKILL.md step 4 uses to decide whether a
# conversion is trustworthy, from the second question about a book onwards.
COUNT_FIELDS = ("warning_count", "line_count", "heading_count")


def emit(payload: dict) -> None:
    print(json.dumps({"schemaVersion": SCHEMA_VERSION, **payload}, ensure_ascii=False, separators=(",", ":")))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_stem(path: Path) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", path.stem).strip(".-") or "epub"
    return stem[:48]


def validate_epub(path: Path) -> Tuple[bool, Optional[str]]:
    if not path.is_file():
        return False, "input file does not exist or is not a regular file"
    if not zipfile.is_zipfile(path):
        return False, "input is not a ZIP-based EPUB container"
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            if "META-INF/container.xml" not in names:
                return False, "EPUB container is missing META-INF/container.xml"
    except (OSError, zipfile.BadZipFile) as exc:
        return False, f"could not inspect EPUB container: {exc}"
    return True, None


def load_manifest(path: Path) -> Optional[dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def manifest_counts(manifest: Optional[dict]) -> Optional[dict]:
    """Return the manifest's counters, or None if it predates them or is damaged.

    A manifest without them cannot serve a cache hit, because the result would
    be missing fields a fresh conversion reports. Reconverting is cheap and
    restores the full contract.
    """
    if not manifest:
        return None

    counts = {field: manifest.get(field) for field in COUNT_FIELDS}

    if any(not isinstance(value, int) for value in counts.values()):
        return None

    return counts


def warning_count(stderr: str) -> int:
    warning_lines = [line for line in stderr.splitlines() if "warning" in line.lower()]
    if warning_lines:
        return len(warning_lines)
    return 1 if stderr.strip() else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Convert an EPUB to cleaned Pandoc Markdown for agent consumption. "
            "The default output is an idempotent cache in the system temp directory."
        )
    )
    parser.add_argument("input", help="Path to the EPUB file")
    parser.add_argument(
        "--output-dir",
        help="Dedicated output directory. Must be empty or previously created by this script.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Reconvert even when a matching cached result already exists.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = Path(args.input).expanduser().resolve()

    valid, reason = validate_epub(source)
    if not valid:
        emit(
            {
                "status": "error",
                "error": "invalid_epub",
                "reason": reason,
                "troubleshooting_reference": TROUBLESHOOTING_REFERENCE,
            }
        )
        return EXIT_BAD_INPUT

    pandoc = find_pandoc()
    if pandoc is None:
        emit(
            {
                "status": "error",
                "error": "pandoc_missing",
                "installation_reference": INSTALLATION_REFERENCE,
            }
        )
        return EXIT_PANDOC_MISSING

    source_hash = sha256_file(source)
    if args.output_dir:
        output_dir = Path(args.output_dir).expanduser().resolve()
    else:
        output_dir = (
            Path(tempfile.gettempdir())
            / "agent-epub"
            / f"{safe_stem(source)}-{source_hash[:12]}"
        )

    manifest_path = output_dir / MANIFEST_NAME
    markdown_path = output_dir / MARKDOWN_NAME
    log_path = output_dir / LOG_NAME
    assets_path = output_dir / ASSETS_NAME
    style_map_path = output_dir / STYLE_MAP_NAME

    existing_manifest = load_manifest(manifest_path) if manifest_path.exists() else None
    cached_counts = manifest_counts(existing_manifest)
    if (
        not args.force
        and existing_manifest
        and cached_counts
        and existing_manifest.get("source_sha256") == source_hash
        and markdown_path.is_file()
        and markdown_path.stat().st_size > 0
    ):
        emit(
            {
                "status": "ok",
                "cached": True,
                "markdown": str(markdown_path),
                "assets": str(assets_path) if assets_path.exists() else None,
                "manifest": str(manifest_path),
                "pandoc_log": str(log_path) if log_path.exists() else None,
                "style_map": str(style_map_path) if style_map_path.exists() else None,
                **cached_counts,
                "source_sha256": source_hash,
            }
        )
        return EXIT_OK

    if output_dir.exists() and any(output_dir.iterdir()) and existing_manifest is None:
        emit(
            {
                "status": "error",
                "error": "output_directory_not_owned",
                "reason": "output directory is non-empty and was not created by this converter",
                "troubleshooting_reference": TROUBLESHOOTING_REFERENCE,
            }
        )
        return EXIT_BAD_OUTPUT

    output_dir.mkdir(parents=True, exist_ok=True)
    if existing_manifest is not None:
        for generated in (markdown_path, log_path, manifest_path):
            generated.unlink(missing_ok=True)
        if assets_path.exists():
            shutil.rmtree(assets_path)

    # The Lua filter cannot read the EPUB's zip, so the class-to-semantics map
    # is derived here and handed over as a generated Lua module.
    _, style_map, list_markers = write_style_map(source, output_dir)

    filter_path = Path(__file__).with_name("clean_epub.lua").resolve()
    command = [
        str(pandoc),
        str(source),
        "--from=epub",
        "--to=markdown",
        "--standalone",
        "--wrap=none",
        "--markdown-headings=atx",
        f"--extract-media={ASSETS_NAME}",
        f"--lua-filter={filter_path}",
        f"--output={MARKDOWN_NAME}",
    ]

    environment = dict(os.environ)
    environment["READING_EPUBS_STYLE_MAP"] = str(style_map_path)

    result = subprocess.run(
        command,
        cwd=output_dir,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=environment,
    )

    stderr = result.stderr or ""
    if stderr.strip():
        log_path.write_text(stderr, encoding="utf-8")
    else:
        log_path.unlink(missing_ok=True)

    if result.returncode != 0:
        emit(
            {
                "status": "error",
                "error": "pandoc_failed",
                "exit_code": result.returncode,
                "pandoc_log": str(log_path) if log_path.exists() else None,
                "troubleshooting_reference": TROUBLESHOOTING_REFERENCE,
            }
        )
        return EXIT_PANDOC_FAILED

    if not markdown_path.is_file() or markdown_path.stat().st_size == 0:
        emit(
            {
                "status": "error",
                "error": "empty_markdown",
                "troubleshooting_reference": TROUBLESHOOTING_REFERENCE,
            }
        )
        return EXIT_BAD_OUTPUT

    markdown_text = markdown_path.read_text(encoding="utf-8", errors="replace")
    lines = markdown_text.splitlines()
    headings = sum(1 for line in lines if re.match(r"^#{1,6}\s+\S", line))
    warnings = warning_count(stderr)

    manifest = {
        "format": "reading-epubs-manifest-v1",
        "source": str(source),
        "source_sha256": source_hash,
        "converted_at": datetime.now(timezone.utc).isoformat(),
        "pandoc": pandoc_version_line(pandoc),
        "markdown": str(markdown_path),
        "assets": str(assets_path) if assets_path.exists() else None,
        "pandoc_log": str(log_path) if log_path.exists() else None,
        "style_map": str(style_map_path),
        "style_map_classes": len(style_map),
        "style_map_semantic_classes": sum(1 for names in style_map.values() if names),
        "list_marker_classes": list_markers,
        "warning_count": warnings,
        "line_count": len(lines),
        "heading_count": headings,
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    if warnings:
        print(
            f"Pandoc emitted {warnings} warning(s); inspect {log_path} only if relevant.",
            file=sys.stderr,
        )

    emit(
        {
            "status": "ok",
            "cached": False,
            "markdown": str(markdown_path),
            "assets": str(assets_path) if assets_path.exists() else None,
            "manifest": str(manifest_path),
            "pandoc_log": str(log_path) if log_path.exists() else None,
            "style_map": str(style_map_path),
            "warning_count": warnings,
            "line_count": len(lines),
            "heading_count": headings,
            "source_sha256": source_hash,
        }
    )
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
