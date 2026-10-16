"""Materialize referenced sibling ``_shared`` trees without blanket replacement.

Only Markdown link destinations, reference definitions, literal inline-code
paths, and quoted HTML href/src attributes are rewritten. Paths are relative to
the containing source file. All reads/rewrites are checked before the first
write; native source trees and binary resources are never modified.
"""

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import re
import stat
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from .errors import ReconciliationError
from .filesystem import copy_tree, validate_tree


_DOCUMENT_SUFFIXES = {".md", ".markdown", ".mdx"}
_DESTINATIONS = (
    (re.compile(r"!?\[[^\]\r\n]*\]\(\s*(?:<(?P<angle>[^<>\r\n]+)>|(?P<path>[^\s()]+))"), True),
    (re.compile(r"^\s{0,3}\[[^\]\r\n]+\]:\s*(?:<(?P<angle>[^<>\r\n]+)>|(?P<path>\S+))", re.MULTILINE), True),
    (re.compile(r"(?<!`)`(?P<path>\.{1,2}/[^`\r\n]+)`(?!`)"), False),
    (re.compile(r"\b(?:href|src)\s*=\s*([\"'])(?P<path>[^\"'\r\n]+)\1", re.IGNORECASE), True),
)


@dataclass(frozen=True)
class _Reference:
    start: int
    end: int
    original: str
    target: Path
    is_url: bool
    query: str
    fragment: str


def _failure(message: str) -> ReconciliationError:
    return ReconciliationError(message, code="shared-resource-invalid", exit_status=2)


def _within(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def _source_path(parent: Path, value: str, root: Path) -> Path:
    if "\\" in value or "\x00" in value or ":" in value:
        raise _failure(f"Unsupported shared resource path: {value!r}")
    target = Path(os.path.abspath(parent / value))
    if not _within(target, root):
        raise _failure(f"Resource escapes its source snapshot: {value!r}")
    current = root
    for part in target.relative_to(root).parts:
        current /= part
        try:
            info = current.lstat()
        except FileNotFoundError as error:
            raise _failure(f"Referenced resource does not exist: {target}") from error
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise _failure(f"Linked resource is unsupported: {current}")
    return target


def _shared_root(path: Path, root: Path) -> Path | None:
    current = root
    for part in path.relative_to(root).parts:
        current /= part
        if part == "_shared":
            return current
    return None


def _references(text: str, source_file: Path, source_skill: Path, root: Path):
    seen = set()
    in_shared = not _within(source_file, source_skill)
    for pattern, is_url in _DESTINATIONS:
        for match in pattern.finditer(text):
            group = "angle" if match.groupdict().get("angle") is not None else "path"
            span = match.span(group)
            if span in seen:
                continue
            seen.add(span)
            original = match.group(group)
            parsed = urlsplit(original)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            path_text = unquote(parsed.path) if is_url else parsed.path
            # Unrelated skill prose/links are outside this transform's scope.
            if not in_shared and "_shared" not in path_text.split("/"):
                continue
            target = _source_path(source_file.parent, path_text, root)
            if not _within(target, source_skill) and _shared_root(target, root) is None:
                raise _failure(f"Shared resource depends on an unsupported external tree: {original}")
            yield _Reference(*span, original, target, is_url, parsed.query, parsed.fragment)


def normalize_shared_resources(
    skill_directory: Path, source_skill_directory: Path, source_root: Path
) -> list[dict]:
    """Normalize a private copied skill using its immutable source snapshot.

    Return JSON-serializable copy/rewrite evidence. Failure leaves the candidate
    untouched when validation fails; I/O failure remains confined to that
    disposable candidate and is reported to its owning preparation operation.
    """
    output = skill_directory.absolute()
    root = source_root.absolute()
    source_skill = source_skill_directory.absolute()
    if not _within(source_skill, root) or _within(output, root):
        raise _failure("Source skill must be in its snapshot; candidate must be separate")
    validate_tree(source_skill)
    validate_tree(output)
    shared_roots: set[Path] = set()
    documents: dict[Path, tuple[bytes, str, list[_Reference]]] = {}
    pending = [source_skill]
    while pending:
        directory = pending.pop()
        for source_file in sorted(directory.rglob("*")):
            if not source_file.is_file() or source_file.suffix.lower() not in _DOCUMENT_SUFFIXES:
                continue
            if source_file in documents:
                continue
            raw = source_file.read_bytes()
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError as error:
                raise _failure(f"Referenced Markdown must be UTF-8: {source_file}") from error
            references = list(_references(text, source_file, source_skill, root))
            documents[source_file] = (raw, text, references)
            for reference in references:
                if _within(reference.target, source_skill):
                    continue
                shared = _shared_root(reference.target, root)
                if shared not in shared_roots:
                    validate_tree(shared)
                    shared_roots.add(shared)
                    pending.append(shared)

    if not shared_roots:
        return []
    preferred = source_skill.parent / "_shared"
    ordered = sorted(shared_roots, key=lambda path: (path != preferred, path.relative_to(root).as_posix()))
    destinations = {}
    for index, shared in enumerate(ordered):
        suffix = "" if index == 0 else "-" + hashlib.sha256(shared.relative_to(root).as_posix().encode()).hexdigest()[:12]
        destination = output / "references" / ("_shared" + suffix)
        if destination.exists() or destination.is_symlink():
            raise _failure(f"Shared-resource destination already exists: {destination}")
        destinations[shared] = destination

    def mapped(path):
        if _within(path, source_skill):
            return output / path.relative_to(source_skill)
        for shared in ordered:
            if _within(path, shared):
                return destinations[shared] / path.relative_to(shared)
        raise _failure(f"No materialized destination for resource: {path}")

    updates = []
    evidence = []
    for source_file, (raw, text, references) in documents.items():
        destination_file = mapped(source_file)
        replacement = text
        for reference in sorted(references, key=lambda item: item.start, reverse=True):
            relative = os.path.relpath(mapped(reference.target), destination_file.parent).replace("\\", "/")
            if reference.original.split("?", 1)[0].split("#", 1)[0].endswith("/"):
                relative += "/"
            if reference.is_url:
                relative = quote(relative, safe="/-._~")
            value = urlunsplit(("", "", relative, reference.query, reference.fragment))
            if value != reference.original:
                replacement = replacement[:reference.start] + value + replacement[reference.end:]
                evidence.append({"kind": "rewrite-reference", "file": destination_file.relative_to(output).as_posix(), "from": reference.original, "to": value})
        if replacement != text:
            updates.append((destination_file, replacement.encode("utf-8")))
        # Source candidate bytes must still be those validated by acquisition.
        if _within(source_file, source_skill) and destination_file.read_bytes() != raw:
            raise _failure(f"Candidate changed before shared-resource normalization: {destination_file}")

    for shared in ordered:
        destination = destinations[shared]
        destination.parent.mkdir(parents=True, exist_ok=True)
        copy_tree(shared, destination)
        evidence.append({"kind": "copy-shared-resource", "source": shared.relative_to(root).as_posix(), "destination": destination.relative_to(output).as_posix()})
    for destination, contents in updates:
        destination.write_bytes(contents)
    validate_tree(output)
    return evidence
