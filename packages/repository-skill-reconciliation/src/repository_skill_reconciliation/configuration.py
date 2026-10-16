"""Native remote declarations plus additional repository-local skill options."""

import json
from pathlib import Path
import re

import fastjsonschema

from .errors import ReconciliationError
from .agent_targets import AGENT_ROOTS
from .filesystem import contained_path, validate_tree
from .processes import run_command

SKILL_NAME = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object", "additionalProperties": False,
    "required": ["schemaVersion", "agents"],
    "properties": {
        "schemaVersion": {"const": 1, "type": "integer"},
        "agents": {"type": "array", "minItems": 1, "uniqueItems": True,
                   "items": {"enum": list(AGENT_ROOTS)}},
        "localSkills": {"type": "object", "propertyNames": {"pattern": SKILL_NAME, "maxLength": 64},
                        "additionalProperties": {"type": "string", "pattern": r"^\./.+"}},
        "invocationPolicies": {"type": "object", "propertyNames": {"pattern": SKILL_NAME, "maxLength": 64},
                               "additionalProperties": {"type": "object", "additionalProperties": False,
                                                        "properties": {agent: {"enum": ["explicit-only", "implicit-allowed"]} for agent in AGENT_ROOTS}}},
    },
}
_validate_schema = fastjsonschema.compile(SCHEMA, use_default=False)


def _unique_object(pairs):
    """Reject repeated names before JSON's ordinary last-value-wins behavior loses them."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path: Path) -> dict:
    """Read strict UTF-8 JSON without duplicate keys or non-JSON numeric constants."""
    def invalid_constant(value):
        raise ValueError(f"Invalid JSON constant: {value}")

    try:
        result = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_unique_object, parse_constant=invalid_constant)
        if not isinstance(result, dict):
            raise ValueError("Expected an object")
        return result
    except (OSError, UnicodeError, ValueError) as error:
        raise ReconciliationError(f"Invalid JSON in {path.name}: {error}", "invalid-input", 2) from error


def repository_root(directory: str | Path) -> Path:
    """Select the native physical Git worktree, without probing parent/user config files."""
    try:
        directory = Path(directory).resolve(strict=True)
        if not directory.is_dir():
            raise ValueError("Not a directory")
    except (OSError, ValueError) as error:
        raise ReconciliationError("Select an existing working directory.", "invalid-input", 2) from error
    return Path(run_command(["git", "-C", str(directory), "rev-parse", "--show-toplevel"], directory).strip()).resolve(strict=True)


def is_local(declaration: dict) -> bool:
    """A portable relative source starts './'; other source families are validated natively."""
    return declaration["source"].startswith("./")


def load_configuration(root: Path, filename: str = "repository-skills.json") -> tuple[Path, dict]:
    """Read only information absent from the native lock; never duplicate remote intent."""
    candidate = Path(filename)
    if candidate.is_absolute():
        try:
            filename = candidate.relative_to(root).as_posix()
        except ValueError as error:
            raise ReconciliationError("Configuration must be inside the selected repository.", "invalid-input", 2) from error
    path = contained_path(root, filename, allow_missing=False)
    config = read_json(path)
    try:
        _validate_schema(config)
    except fastjsonschema.JsonSchemaException as error:
        raise ReconciliationError(f"Invalid configuration: {error.message}", "invalid-input", 2) from error
    for name, relative in config.get("localSkills", {}).items():
        source = contained_path(root, relative, allow_missing=False)
        validate_tree(source)
        if not (source / "SKILL.md").is_file():
            raise ReconciliationError(f"Local skill {name} requires SKILL.md.", "invalid-input", 2)
        if source.is_relative_to(root / ".agent-tools") or any(source.is_relative_to(root / p) for p in set(AGENT_ROOTS.values())):
            raise ReconciliationError("A local source cannot be a generated installation or operation tree.", "invalid-input", 2)
    for name, policies in config.get("invocationPolicies", {}).items():
        for agent in policies:
            if agent not in config["agents"] or agent == "antigravity":
                raise ReconciliationError(f"Unsupported/unselected invocation policy target for {name}: {agent}", "invalid-input", 2)
    return path, config


def load_lock(root: Path, *, allow_missing: bool = False) -> dict:
    """Read native v1 conservatively; corrupt locks are never treated as empty."""
    path = contained_path(root, "skills-lock.json")
    if not path.exists() and allow_missing:
        return {"version": 1, "skills": {}}
    lock = read_json(path)
    if type(lock.get("version")) is not int or lock["version"] != 1 or not isinstance(lock.get("skills"), dict):
        raise ReconciliationError("Expected native skills-lock.json version 1 and a skills object.", "invalid-input", 2)
    if set(lock) != {"version", "skills"}:
        raise ReconciliationError("Unknown native lock root fields; review the upstream format first.", "invalid-input", 2)
    for name, entry in lock["skills"].items():
        if not re.fullmatch(SKILL_NAME, name) or len(name) > 64 or not isinstance(entry, dict):
            raise ReconciliationError("Invalid native skill identity.", "invalid-input", 2)
        if any(not isinstance(entry.get(key), str) or not entry[key] for key in ("source", "sourceType", "computedHash")):
            raise ReconciliationError(f"Incomplete native lock entry: {name}", "invalid-input", 2)
        for key in ("ref", "sourceUrl", "skillPath", "wellKnownDigest", "version", "via"):
            if key in entry and not isinstance(entry[key], str):
                raise ReconciliationError(f"Invalid native {key}: {name}", "invalid-input", 2)
        if "subagents" in entry and (not isinstance(entry["subagents"], list) or not all(isinstance(x, str) for x in entry["subagents"])):
            raise ReconciliationError(f"Invalid native subagents: {name}", "invalid-input", 2)
    return lock


def derive_skill_declarations(config: dict, lock: dict, *, local_only: bool = False) -> dict:
    """Join native remote intent with local declarations and policy references offline."""
    local = config.get("localSkills", {})
    remote = lock["skills"]
    collisions = set(local) & set(remote)
    if collisions:
        raise ReconciliationError(f"Local declaration conflicts with native entries: {', '.join(sorted(collisions))}", "conflict", 3)
    policies = config.get("invocationPolicies", {})
    unknown = set(policies) - (set(local) | set(remote))
    if unknown:
        raise ReconciliationError(f"Invocation policy references unknown skills: {', '.join(sorted(unknown))}", "invalid-input", 2)
    declarations = {}
    if not local_only:
        from .remote_sources import source_selection
        for name, entry in remote.items():
            if entry["sourceType"] != "github":
                raise ReconciliationError(f"Unsupported native source type for {name}: {entry['sourceType']}", "invalid-input", 2)
            source_selection(entry["source"], entry.get("ref"))
            declarations[name] = {key: entry[key] for key in ("source", "ref") if key in entry}
    declarations.update({name: {"source": source} for name, source in local.items()})
    for name, declaration in declarations.items():
        if name in policies:
            declaration["invocationPolicy"] = dict(policies[name])
    return declarations


def validate_managed_destination(root: Path, relative: str) -> Path:
    """Require selected installation roots to be untracked, ignored and alias-free."""
    destination = contained_path(root, relative)
    if destination.exists() and relative != "skills-lock.json" and not destination.is_dir():
        raise ReconciliationError(f"Managed installation/state path must be a directory: {relative}", "unsafe-path", 2)
    tracked = run_command(["git", "ls-files", "-z", "--", relative], root)
    if tracked:
        raise ReconciliationError(f"Refusing tracked managed destination: {relative}", "unsafe-path", 2)
    if relative != "skills-lock.json":
        try:
            run_command(["git", "check-ignore", "--quiet", "--", relative + "/"], root)
        except ReconciliationError as error:
            raise ReconciliationError(f"Managed output must be Git-ignored: {relative}", "unsafe-path", 2) from error
    return destination
