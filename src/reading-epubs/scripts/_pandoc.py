"""Shared Pandoc discovery helpers for the reading-epubs skill."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

# The agent runs these scripts from its own project directory, never from the
# skill directory, so a bare "references/..." path in the output would not
# resolve for the caller. Anchor them here instead.
SKILL_ROOT = Path(__file__).resolve().parent.parent

INSTALLATION_REFERENCE = str(SKILL_ROOT / "references" / "pandoc-installation.md")
TROUBLESHOOTING_REFERENCE = str(SKILL_ROOT / "references" / "conversion-troubleshooting.md")


def find_pandoc() -> Optional[Path]:
    """Return a usable-looking Pandoc executable path, including common fresh-install locations."""
    on_path = shutil.which("pandoc")
    if on_path:
        return Path(on_path)

    candidates: list[Path] = []
    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        program_files = os.environ.get("ProgramFiles")
        program_files_x86 = os.environ.get("ProgramFiles(x86)")
        if local_app_data:
            candidates.append(Path(local_app_data) / "Pandoc" / "pandoc.exe")
        if program_files:
            candidates.append(Path(program_files) / "Pandoc" / "pandoc.exe")
        if program_files_x86:
            candidates.append(Path(program_files_x86) / "Pandoc" / "pandoc.exe")
    else:
        candidates.extend(
            [
                Path("/opt/homebrew/bin/pandoc"),
                Path("/usr/local/bin/pandoc"),
                Path("/usr/bin/pandoc"),
                Path.home() / ".local" / "bin" / "pandoc",
            ]
        )

    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def run_pandoc(pandoc: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Run Pandoc without a shell and capture UTF-8-safe text output."""
    return subprocess.run(
        [str(pandoc), *args],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def pandoc_version_line(pandoc: Path) -> str:
    result = run_pandoc(pandoc, "--version")
    if result.returncode != 0:
        return ""
    return result.stdout.splitlines()[0].strip() if result.stdout else ""
