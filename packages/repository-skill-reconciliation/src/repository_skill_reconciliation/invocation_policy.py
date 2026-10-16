"""Project explicit per-host invocation eligibility while preserving native metadata."""

from io import StringIO
from pathlib import Path

from ruamel.yaml import YAML

from .errors import ReconciliationError


def _yaml():
    parser = YAML(typ="rt", pure=True)
    parser.preserve_quotes = True
    parser.allow_duplicate_keys = False
    return parser


def _mapping(text: str, description: str):
    try:
        value = _yaml().load(text)
    except Exception as error:
        raise ReconciliationError(f"Invalid native YAML: {description}", "invalid-input", 2) from error
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ReconciliationError(f"Native metadata must be a mapping: {description}", "invalid-input", 2)
    return value


def _render(value):
    stream = StringIO()
    _yaml().dump(value, stream)
    return stream.getvalue()


def _frontmatter(path: Path):
    """Require native delimiters and preserve the body verbatim when projecting policy."""
    text = path.read_bytes().decode("utf-8")
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise ReconciliationError("SKILL.md requires YAML frontmatter.", "invalid-input", 2)
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        raise ReconciliationError("Unterminated SKILL.md frontmatter.", "invalid-input", 2)
    return _mapping("".join(lines[1:end]), str(path)), "".join(lines[end + 1:])


def validate_skill_identity(tree: Path, name: str) -> None:
    """Ensure a declared skill names the actual materialized native skill."""
    metadata, _ = _frontmatter(tree / "SKILL.md")
    if metadata.get("name") != name or not isinstance(metadata.get("description"), str) or not metadata["description"].strip():
        raise ReconciliationError(f"Native skill identity/description does not match {name}.", "invalid-input", 2)


def project_invocation_policy(tree: Path, policies: dict[str, str]) -> None:
    """Change only requested native fields in an independently staged physical output."""
    if "codex" in policies:
        path = tree / "agents" / "openai.yaml"
        metadata = _mapping(path.read_text(encoding="utf-8"), str(path)) if path.exists() else {}
        policy = metadata.setdefault("policy", {})
        if not isinstance(policy, dict):
            raise ReconciliationError("Codex policy must be a mapping.", "invalid-input", 2)
        policy["allow_implicit_invocation"] = policies["codex"] == "implicit-allowed"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_render(metadata), encoding="utf-8", newline="\n")
    if "claude-code" in policies:
        path = tree / "SKILL.md"
        metadata, body = _frontmatter(path)
        explicit = policies["claude-code"] == "explicit-only"
        if explicit and metadata.get("user-invocable") is False:
            raise ReconciliationError("Explicit-only conflicts with user-invocable: false.", "invalid-input", 2)
        metadata["disable-model-invocation"] = explicit
        path.write_text("---\n" + _render(metadata) + "---\n" + body, encoding="utf-8", newline="\n")
