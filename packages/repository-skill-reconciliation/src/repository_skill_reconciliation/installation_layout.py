"""Resolve only matching Claude skill links to canonical repository installations.

Publication never traverses these links. Their identities are frozen separately
from the ordinary, alias-free trees used by the transaction journal.
"""

import os
import re
import stat
from pathlib import Path

from .configuration import (
    SKILL_NAME,
    validate_ignored_output,
    validate_managed_destination,
)
from .errors import ReconciliationError
from .filesystem import contained_path


def _canonical_destination(relative):
    prefix = ".claude/skills/"
    if not isinstance(relative, str) or not relative.startswith(prefix):
        raise ReconciliationError("Invalid installation link path.", "unsafe-path", 2)
    name = relative[len(prefix) :]
    if not re.fullmatch(SKILL_NAME, name) or len(name) > 64:
        raise ReconciliationError("Invalid installation link skill.", "unsafe-path", 2)
    return ".agents/skills/" + name


def _link_identity(root, relative):
    """Inspect one leaf link; neither its parents nor its target may be aliases."""
    canonical = _canonical_destination(relative)
    path = (
        contained_path(root, str(Path(relative).parent).replace("\\", "/"))
        / Path(relative).name
    )
    facts = path.lstat()
    if not (
        stat.S_ISLNK(facts.st_mode) or getattr(facts, "st_reparse_tag", 0) == 0xA0000003
    ):
        raise ReconciliationError("Expected a skill directory link.", "unsafe-path", 2)
    target = os.readlink(path)
    normalized = target
    if os.name == "nt" and normalized.startswith("\\\\?\\"):
        normalized = normalized[4:]
        if normalized.startswith("UNC\\"):
            normalized = "\\\\" + normalized[4:]
    # Inspect components before collapsing '..': OS traversal follows a link
    # before its following parent component, unlike lexical normalization.
    try:
        parts = (path.parent / normalized).relative_to(root).parts
    except ValueError as error:
        raise ReconciliationError(
            "External skill link target.", "unsafe-path", 2
        ) from error
    actual = root
    for part in parts:
        if not actual.is_dir():
            raise ReconciliationError(
                "Skill link traverses a missing or non-directory component.",
                "unsafe-path",
                2,
            )
        if part == "..":
            if actual == root:
                raise ReconciliationError(
                    "External skill link traversal.", "unsafe-path", 2
                )
            actual = actual.parent
        else:
            actual = contained_path(root, (actual / part).relative_to(root).as_posix())
    expected = contained_path(root, canonical)
    if os.path.normcase(str(actual)) != os.path.normcase(str(expected)):
        raise ReconciliationError(
            f"Skill link must target {canonical}: {relative}", "unsafe-path", 2
        )
    validate_ignored_output(root, relative)
    validate_managed_destination(root, canonical)
    return {
        "destination": canonical,
        "target": target,
        "device": facts.st_dev,
        "inode": facts.st_ino,
    }


def installation_layout(root, prefixes, names):
    """Return logical-to-physical destinations and identities of existing leaf links."""
    destinations, links = {}, {}
    for prefix in sorted(prefixes):
        for name in sorted(names):
            relative = prefix + "/" + name
            path = contained_path(root, prefix) / name
            facts = path.lstat() if os.path.lexists(path) else None
            if facts and (
                stat.S_ISLNK(facts.st_mode)
                or getattr(facts, "st_file_attributes", 0) & 0x400
            ):
                identity = _link_identity(root, relative)
                if ".agents/skills" not in prefixes:
                    raise ReconciliationError(
                        "Claude-only installation requires an explicit conversion of the shared link to a physical .claude/skills directory.",
                        "conflict",
                        3,
                    )
                if not (root / identity["destination"]).is_dir():
                    raise ReconciliationError("Dangling skill link.", "unsafe-path", 2)
                destinations[relative] = identity["destination"]
                links[relative] = identity
            else:
                validate_managed_destination(root, relative)
                destinations[relative] = relative
    return destinations, links


def assert_installation_links(root, links):
    """Validate saved link records and reject replacement/retargeting, even on recovery."""
    if not isinstance(links, dict):
        raise ReconciliationError(
            "Invalid installation link records.", "invalid-input", 2
        )
    for relative, expected in links.items():
        canonical = _canonical_destination(relative)
        if (
            not isinstance(expected, dict)
            or set(expected) != {"destination", "target", "device", "inode"}
            or expected["destination"] != canonical
            or not isinstance(expected["target"], str)
            or any(
                type(expected[key]) is not int or expected[key] < 0
                for key in ("device", "inode")
            )
        ):
            raise ReconciliationError(
                "Invalid installation link identity.", "invalid-input", 2
            )
        try:
            actual = _link_identity(root, relative)
        except (OSError, ReconciliationError) as error:
            raise ReconciliationError(
                f"Installation link changed: {relative}", "conflict", 3
            ) from error
        if actual != expected:
            raise ReconciliationError(
                f"Installation link changed: {relative}", "conflict", 3
            )
