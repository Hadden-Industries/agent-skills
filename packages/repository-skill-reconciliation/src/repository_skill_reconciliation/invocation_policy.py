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
        raise ReconciliationError(
            f"Invalid native YAML: {description}", "invalid-input", 2
        ) from error
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ReconciliationError(
            f"Native metadata must be a mapping: {description}", "invalid-input", 2
        )
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
        raise ReconciliationError(
            "SKILL.md requires YAML frontmatter.", "invalid-input", 2
        )
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        raise ReconciliationError(
            "Unterminated SKILL.md frontmatter.", "invalid-input", 2
        )
    return _mapping("".join(lines[1:end]), str(path)), "".join(lines[end + 1 :])


def validate_skill_identity(tree: Path, name: str) -> None:
    """Ensure a declared skill names the actual materialized native skill."""
    metadata, _ = _frontmatter(tree / "SKILL.md")
    if (
        metadata.get("name") != name
        or not isinstance(metadata.get("description"), str)
        or not metadata["description"].strip()
    ):
        raise ReconciliationError(
            f"Native skill identity/description does not match {name}.",
            "invalid-input",
            2,
        )


def _project_codex_policy(tree: Path, value: str) -> None:
    path = tree / "agents" / "openai.yaml"
    metadata = (
        _mapping(path.read_text(encoding="utf-8"), str(path)) if path.exists() else {}
    )
    policy = metadata.setdefault("policy", {})
    if not isinstance(policy, dict):
        raise ReconciliationError("Codex policy must be a mapping.", "invalid-input", 2)
    policy["allow_implicit_invocation"] = value == "implicit-allowed"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_render(metadata), encoding="utf-8", newline="\n")


def _project_claude_policy(tree: Path, value: str) -> None:
    path = tree / "SKILL.md"
    metadata, body = _frontmatter(path)
    explicit = value == "explicit-only"
    if explicit and metadata.get("user-invocable") is False:
        raise ReconciliationError(
            "Explicit-only conflicts with user-invocable: false.", "invalid-input", 2
        )
    metadata["disable-model-invocation"] = explicit
    path.write_text(
        "---\n" + _render(metadata) + "---\n" + body, encoding="utf-8", newline="\n"
    )


INVOCATION_MODES = ("explicit-only", "implicit-allowed")
INVOCATION_POLICY_PROJECTORS = {
    "codex": _project_codex_policy,
    "claude-code": _project_claude_policy,
}


def project_invocation_policy(tree: Path, policies: dict[str, str]) -> None:
    """Project supported overrides using the same capability registry as validation."""
    for agent, value in policies.items():
        if agent not in INVOCATION_POLICY_PROJECTORS or value not in INVOCATION_MODES:
            raise ReconciliationError(
                f"Unsupported invocation policy: {agent}={value!r}.", "invalid-input", 2
            )
        INVOCATION_POLICY_PROJECTORS[agent](tree, value)
