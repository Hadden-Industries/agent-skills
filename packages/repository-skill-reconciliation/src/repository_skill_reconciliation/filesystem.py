"""Regular-file trees, repository-contained paths and content identities for publication."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat

from .errors import ReconciliationError


def _reject_alias(path: Path):
    """Reject symlinks, Windows reparse points, multiply-linked files and special nodes."""
    facts = path.lstat()
    if stat.S_ISLNK(facts.st_mode) or getattr(facts, "st_file_attributes", 0) & 0x400:
        raise ReconciliationError(f"Linked/reparse path is not managed: {path}", "unsafe-path", 2)
    if not (stat.S_ISREG(facts.st_mode) or stat.S_ISDIR(facts.st_mode)):
        raise ReconciliationError(f"Special file is not managed: {path}", "unsafe-path", 2)
    if stat.S_ISREG(facts.st_mode) and facts.st_nlink != 1:
        raise ReconciliationError(f"Multiply-linked file is not managed: {path}", "unsafe-path", 2)


def contained_path(root: Path, relative: str, *, allow_missing: bool = True) -> Path:
    """Return an alias-free lexical descendant; reject traversal and existing aliases."""
    item = PurePosixPath(relative)
    if not relative or "\\" in relative or item.is_absolute() or any(p in ("..", ".git") or ":" in p for p in item.parts):
        raise ReconciliationError(f"Unsafe repository path: {relative!r}", "unsafe-path", 2)
    path = root
    for part in item.parts:
        path = path / part
        if os.path.lexists(path):
            _reject_alias(path)
        elif not allow_missing:
            raise ReconciliationError(f"Missing repository path: {relative}", "invalid-input", 2)
    if path == root:
        raise ReconciliationError("Repository root is not a managed output.", "unsafe-path", 2)
    return path


def validate_tree(path: Path) -> None:
    """Validate every node without following a link, before copying or fingerprinting."""
    _reject_alias(path)
    if path.is_dir():
        for child in path.iterdir():
            validate_tree(child)


def copy_tree(source: Path, destination: Path) -> None:
    """Copy a validated tree into a new destination, preserving bytes and file modes."""
    validate_tree(source)
    if destination.exists() or destination.is_symlink():
        raise ReconciliationError(f"Copy destination already exists: {destination}", "conflict", 3)
    shutil.copytree(source, destination, symlinks=False)
    validate_tree(destination)


def fingerprint(path: Path) -> str | None:
    """Hash path names, file content and executable permission; None denotes absence.

    This is an operation/output identity, never a native skills computedHash.
    """
    if not os.path.lexists(path):
        return None
    validate_tree(path)
    digest = hashlib.sha256()

    def visit(current, relative):
        facts = current.stat()
        kind = "directory" if current.is_dir() else "file"
        digest.update(json.dumps([relative, kind, bool(facts.st_mode & stat.S_IXUSR)], separators=(",", ":")).encode())
        digest.update(b"\0")
        if current.is_file():
            with current.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
        else:
            for child in sorted(current.iterdir(), key=lambda p: p.name):
                visit(child, relative + "/" + child.name)
        digest.update(b"\0")

    visit(path, "")
    return digest.hexdigest()


def atomic_json(path: Path, value: dict) -> None:
    """Durably replace one owned JSON record; temporary files never choose destinations."""
    import tempfile

    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=path.parent, prefix=".record-", delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
