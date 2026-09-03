#!/usr/bin/env python3
"""Validate a name against the lexical profiles bundled with this skill.

This checker is intentionally narrow: it can prove that a string matches a
selected physical naming form, but it cannot prove that the words denote the
right concept. Classification and semantic review therefore remain mandatory.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

EXIT_VALID = 0
EXIT_INVALID = 1
EXIT_USAGE_OR_CONFIG = 2
DEFAULT_POLICY = Path(__file__).resolve().parent.parent / "assets" / "naming-policy.json"


class PolicyError(Exception):
    """Raised when the policy file is missing or structurally invalid."""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Check one name against an exact artefact-kind lexical profile. "
            "A pass does not certify semantic correctness."
        )
    )
    parser.add_argument(
        "--kind",
        help="Exact artefact kind, for example python-script or sql-table.",
    )
    parser.add_argument("--name", help="Complete name to validate.")
    parser.add_argument(
        "--policy",
        type=Path,
        default=DEFAULT_POLICY,
        help=f"Policy JSON path (default: {DEFAULT_POLICY}).",
    )
    parser.add_argument(
        "--list-kinds",
        action="store_true",
        help="List all supported artefact kinds and exit.",
    )
    parser.add_argument(
        "--show-examples",
        action="store_true",
        help="Show the selected kind's valid and invalid examples.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="as_json",
        help="Emit a machine-readable JSON result.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress human-readable output; use the process exit status.",
    )
    return parser


def load_policy(path: Path) -> Mapping[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            policy = json.load(handle)
    except FileNotFoundError as exc:
        raise PolicyError(f"policy file not found: {path}") from exc
    except PermissionError as exc:
        raise PolicyError(f"policy file is not readable: {path}") from exc
    except json.JSONDecodeError as exc:
        raise PolicyError(
            f"invalid JSON in policy file {path}: line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc
    except OSError as exc:
        raise PolicyError(f"could not read policy file {path}: {exc}") from exc

    if not isinstance(policy, dict):
        raise PolicyError("policy root must be a JSON object")

    profiles = policy.get("profiles")
    if not isinstance(profiles, dict) or not profiles:
        raise PolicyError("policy must contain a non-empty 'profiles' object")

    for kind, profile in profiles.items():
        if not isinstance(kind, str) or not kind:
            raise PolicyError("each profile key must be a non-empty string")
        if not isinstance(profile, dict):
            raise PolicyError(f"profile {kind!r} must be a JSON object")
        pattern = profile.get("pattern")
        form = profile.get("form")
        if not isinstance(pattern, str) or not pattern:
            raise PolicyError(f"profile {kind!r} must have a non-empty string 'pattern'")
        if not isinstance(form, str) or not form:
            raise PolicyError(f"profile {kind!r} must have a non-empty string 'form'")
        try:
            re.compile(pattern)
        except re.error as exc:
            raise PolicyError(f"profile {kind!r} has an invalid regex: {exc}") from exc

    return policy


def profile_for(policy: Mapping[str, Any], kind: str) -> Mapping[str, Any]:
    profiles = policy["profiles"]
    assert isinstance(profiles, dict)
    profile = profiles.get(kind)
    if isinstance(profile, dict):
        return profile

    suggestions = difflib.get_close_matches(kind, profiles.keys(), n=3, cutoff=0.45)
    suggestion_text = ""
    if suggestions:
        suggestion_text = "; closest: " + ", ".join(suggestions)
    raise PolicyError(f"unknown artefact kind {kind!r}{suggestion_text}")


def split_semantic_tokens(name: str) -> List[str]:
    """Return rough lowercase word tokens for warning purposes only."""

    # Split lower-to-upper and acronym-to-word boundaries before punctuation.
    with_boundaries = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
    with_boundaries = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", with_boundaries)
    return [token.lower() for token in re.findall(r"[A-Za-z]+|[0-9]+", with_boundaries)]


def semantic_warnings(policy: Mapping[str, Any], name: str) -> List[str]:
    gate = policy.get("semantic_gate")
    if not isinstance(gate, dict):
        return []
    vague = gate.get("presumptively_vague_tokens")
    if not isinstance(vague, list):
        return []

    vague_set = {str(token).lower() for token in vague}
    found = sorted({token for token in split_semantic_tokens(name) if token in vague_set})
    if not found:
        return []
    joined = ", ".join(found)
    return [
        f"semantic review recommended: presumptively vague token(s): {joined}"
    ]


def validate_name(
    policy: Mapping[str, Any], kind: str, name: str
) -> Tuple[bool, Mapping[str, Any], List[str]]:
    profile = profile_for(policy, kind)
    pattern = profile["pattern"]
    assert isinstance(pattern, str)
    lexical_valid = re.fullmatch(pattern, name) is not None

    max_length = profile.get("max_length")
    if isinstance(max_length, int) and len(name) > max_length:
        lexical_valid = False

    warnings = semantic_warnings(policy, name)
    return lexical_valid, profile, warnings


def string_list(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value]


def list_kinds_text(policy: Mapping[str, Any]) -> str:
    profiles = policy["profiles"]
    assert isinstance(profiles, dict)
    rows = []
    for kind in sorted(profiles):
        profile = profiles[kind]
        assert isinstance(profile, dict)
        rows.append((kind, str(profile.get("form", "")), str(profile.get("description", ""))))

    kind_width = max(len("KIND"), *(len(row[0]) for row in rows))
    form_width = max(len("FORM"), *(len(row[1]) for row in rows))
    lines = [f"{'KIND':<{kind_width}}  {'FORM':<{form_width}}  DESCRIPTION"]
    lines.append(f"{'-' * kind_width}  {'-' * form_width}  {'-' * 11}")
    for kind, form, description in rows:
        lines.append(f"{kind:<{kind_width}}  {form:<{form_width}}  {description}")
    return "\n".join(lines)


def examples_text(kind: str, profile: Mapping[str, Any]) -> str:
    valid = string_list(profile.get("valid_examples"))
    invalid = string_list(profile.get("invalid_examples"))
    notes = string_list(profile.get("notes"))

    lines = [
        f"KIND: {kind}",
        f"FORM: {profile.get('form', '')}",
        f"BASIS: {profile.get('basis', '')}",
        f"DESCRIPTION: {profile.get('description', '')}",
    ]
    if valid:
        lines.append("VALID EXAMPLES: " + ", ".join(repr(item) for item in valid))
    if invalid:
        lines.append("INVALID EXAMPLES: " + ", ".join(repr(item) for item in invalid))
    for note in notes:
        lines.append(f"NOTE: {note}")
    return "\n".join(lines)


def emit_json(payload: Mapping[str, Any], quiet: bool) -> None:
    if not quiet:
        print(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False))


def emit_error(message: str, as_json: bool, quiet: bool) -> None:
    if quiet:
        return
    if as_json:
        print(
            json.dumps(
                {"error": message, "valid": False, "semantic_certified": False},
                indent=2,
                sort_keys=True,
            )
        )
    else:
        print(f"ERROR: {message}", file=sys.stderr)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.quiet and args.as_json:
        parser.error("--quiet and --json cannot be used together")

    try:
        policy = load_policy(args.policy)

        if args.list_kinds:
            if args.as_json:
                profiles = policy["profiles"]
                assert isinstance(profiles, dict)
                emit_json(
                    {
                        "policy_name": policy.get("policy_name"),
                        "policy_version": policy.get("policy_version"),
                        "kinds": [
                            {
                                "kind": kind,
                                "form": profiles[kind].get("form"),
                                "description": profiles[kind].get("description"),
                            }
                            for kind in sorted(profiles)
                        ],
                    },
                    args.quiet,
                )
            elif not args.quiet:
                print(list_kinds_text(policy))
            return EXIT_VALID

        if not args.kind:
            emit_error("--kind is required unless --list-kinds is used", args.as_json, args.quiet)
            return EXIT_USAGE_OR_CONFIG

        profile = profile_for(policy, args.kind)

        if args.show_examples and args.name is None:
            if args.as_json:
                emit_json(
                    {
                        "kind": args.kind,
                        "form": profile.get("form"),
                        "basis": profile.get("basis"),
                        "description": profile.get("description"),
                        "valid_examples": string_list(profile.get("valid_examples")),
                        "invalid_examples": string_list(profile.get("invalid_examples")),
                        "notes": string_list(profile.get("notes")),
                    },
                    args.quiet,
                )
            elif not args.quiet:
                print(examples_text(args.kind, profile))
            return EXIT_VALID

        if args.name is None:
            emit_error("--name is required for validation", args.as_json, args.quiet)
            return EXIT_USAGE_OR_CONFIG

        lexical_valid, profile, warnings = validate_name(policy, args.kind, args.name)
        result = {
            "kind": args.kind,
            "name": args.name,
            "valid": lexical_valid,
            "lexical_valid": lexical_valid,
            "semantic_certified": False,
            "expected_form": profile.get("form"),
            "basis": profile.get("basis"),
            "pattern": profile.get("pattern"),
            "warnings": warnings,
            "policy_name": policy.get("policy_name"),
            "policy_version": policy.get("policy_version"),
        }

        if args.as_json:
            emit_json(result, args.quiet)
        elif not args.quiet:
            status = "PASS" if lexical_valid else "FAIL"
            relation = "is valid for" if lexical_valid else "is not valid for"
            print(f"{status} lexical: {args.name!r} {relation} {args.kind}")
            if not lexical_valid:
                print(f"EXPECTED: {profile.get('form', '')}")
                valid_examples = string_list(profile.get("valid_examples"))
                if valid_examples:
                    print("VALID EXAMPLES: " + ", ".join(repr(item) for item in valid_examples))
            print("NOTE: semantic correctness is not mechanically certified.")
            for warning in warnings:
                print(f"WARNING: {warning}")
            if args.show_examples:
                print()
                print(examples_text(args.kind, profile))

        return EXIT_VALID if lexical_valid else EXIT_INVALID

    except PolicyError as exc:
        emit_error(str(exc), args.as_json, args.quiet)
        return EXIT_USAGE_OR_CONFIG


if __name__ == "__main__":
    sys.exit(main())
