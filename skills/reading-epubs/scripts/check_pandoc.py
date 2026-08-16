#!/usr/bin/env python3
"""Check whether Pandoc can perform the reading-epubs conversion workflow."""

from __future__ import annotations

import json
import sys

from _pandoc import INSTALLATION_REFERENCE, find_pandoc, pandoc_version_line, run_pandoc

EXIT_OK = 0
EXIT_MISSING = 10
EXIT_UNUSABLE = 11

# Declared by scripts/pandoc-check.schema.json. Bump both together whenever the
# output shape changes; SKILL.md branches on these fields.
SCHEMA_VERSION = 1


def emit(payload: dict) -> None:
    print(json.dumps({"schemaVersion": SCHEMA_VERSION, **payload}, ensure_ascii=False, separators=(",", ":")))


def main() -> int:
    pandoc = find_pandoc()
    if pandoc is None:
        emit(
            {
                "status": "missing",
                "installed": False,
                "installation_reference": INSTALLATION_REFERENCE,
            }
        )
        return EXIT_MISSING

    version = pandoc_version_line(pandoc)
    if not version:
        emit(
            {
                "status": "unusable",
                "installed": True,
                "path": str(pandoc),
                "reason": "pandoc --version failed",
                "installation_reference": INSTALLATION_REFERENCE,
            }
        )
        return EXIT_UNUSABLE

    inputs = run_pandoc(pandoc, "--list-input-formats")
    outputs = run_pandoc(pandoc, "--list-output-formats")
    if inputs.returncode != 0 or outputs.returncode != 0:
        emit(
            {
                "status": "unusable",
                "installed": True,
                "path": str(pandoc),
                "version": version,
                "reason": "could not query Pandoc formats",
                "installation_reference": INSTALLATION_REFERENCE,
            }
        )
        return EXIT_UNUSABLE

    input_formats = set(inputs.stdout.split())
    output_formats = set(outputs.stdout.split())
    missing_features = []
    if "epub" not in input_formats:
        missing_features.append("epub input")
    if "markdown" not in output_formats:
        missing_features.append("markdown output")

    if missing_features:
        emit(
            {
                "status": "unusable",
                "installed": True,
                "path": str(pandoc),
                "version": version,
                "reason": "missing required Pandoc features: " + ", ".join(missing_features),
                "installation_reference": INSTALLATION_REFERENCE,
            }
        )
        return EXIT_UNUSABLE

    emit(
        {
            "status": "ok",
            "installed": True,
            "path": str(pandoc),
            "version": version,
            "epub_input": True,
            "markdown_output": True,
        }
    )
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
