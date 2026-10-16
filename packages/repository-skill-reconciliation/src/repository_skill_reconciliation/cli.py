"""Check desired state, construct exact plans, and publish or recover a selected plan."""

import argparse
import json
from pathlib import Path
import sys

from . import __version__
from .configuration import derive_skill_declarations, load_configuration, load_lock, repository_root
from .errors import ReconciliationError


class _ArgumentParser(argparse.ArgumentParser):
    """Keep parse failures inside the same JSON/error contract as domain failures."""

    def error(self, message):
        raise ReconciliationError(message, "invalid-input", 2)


def _parser():
    parser = _ArgumentParser(
        prog="repository-skills", allow_abbrev=False,
        description="Manage declared repository-local skills using saved, reviewable plans.",
        epilog="Examples: repository-skills check; repository-skills plan --local-only; repository-skills apply PLAN_ID",
    )
    parser.add_argument("-C", "--directory", metavar="DIR", help="working directory (default: current directory)")
    parser.add_argument("--json", action="store_true", help="one structured result on stdout")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    commands = parser.add_subparsers(dest="command", parser_class=_ArgumentParser)
    for name, description in [
        ("check", "Check declarations and native lock offline without installed outputs."),
        ("plan", "Stage actual candidate bytes and show the exact proposed changes."),
        ("apply", "Publish a saved plan without reacquisition."),
        ("recover", "Restore a selected interrupted publication without overwriting edits."),
    ]:
        command = commands.add_parser(name, help=description, description=description, allow_abbrev=False)
        if name in ("check", "plan"):
            command.add_argument("--config", default="repository-skills.json", metavar="FILE")
        else:
            command.add_argument("plan_id", metavar="PLAN_ID")
        if name == "plan":
            command.add_argument("--local-only", action="store_true", help="stage only configured repository-local sources")
    return parser


def _arguments(arguments):
    # Parse common invocation controls independently so their position is consistent
    # without building a second grammar for subcommands or substantive options.
    common = _ArgumentParser(add_help=False, allow_abbrev=False)
    common.add_argument("-C", "--directory", action="append")
    common.add_argument("--json", action="store_true")
    invocation, remaining = common.parse_known_args(arguments)
    if invocation.directory and len(set(invocation.directory)) != 1:
        raise ReconciliationError("Conflicting directory options.", "invalid-input", 2)
    parser = _parser()
    parsed = parser.parse_args(remaining)
    parsed.directory = invocation.directory[-1] if invocation.directory else str(Path.cwd())
    parsed.json = invocation.json
    if parsed.command is None:
        if parsed.json:
            raise ReconciliationError("Specify check, plan, apply or recover.", "invalid-input", 2)
        parser.print_help()
    return parsed


def _dispatch(arguments):
    root = repository_root(arguments.directory)
    if arguments.command == "check":
        _, config = load_configuration(root, arguments.config)
        lock = load_lock(root)
        declarations = derive_skill_declarations(config, lock)
        return {"status": "checked", "repository": str(root), "skills": len(declarations)}
    from .operations import apply_plan, create_plan, recover_plan
    if arguments.command == "plan":
        return create_plan(root, arguments.config, local_only=arguments.local_only)
    if arguments.command == "apply":
        return apply_plan(root, arguments.plan_id)
    return recover_plan(root, arguments.plan_id)


def main(arguments=None):
    """Run one explicit command; return stable statuses and uncontaminated JSON output."""
    arguments = list(sys.argv[1:] if arguments is None else arguments)
    as_json = "--json" in arguments
    try:
        parsed = _arguments(arguments)
        if parsed.command is None:
            return 0
        result = {"schemaVersion": 1, **_dispatch(parsed)}
        if parsed.json:
            print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        else:
            print(result["status"] + ": " + result.get("repository", ""))
            if "planId" in result:
                print("Plan: " + result["planId"])
            if "diff" in result:
                print(result["diff"])
        return 0
    except ReconciliationError as error:
        if as_json:
            print(json.dumps({"schemaVersion": 1, "status": "failed", "error": {"code": error.code, "message": str(error)}}))
        print(f"{error.code}: {error}", file=sys.stderr)
        return error.exit_status
    except KeyboardInterrupt:
        if as_json:
            print(json.dumps({"schemaVersion": 1, "status": "failed", "error": {"code": "interrupted", "message": "Interrupted before publication, or publication was safely restored."}}))
        print("Interrupted.", file=sys.stderr)
        return 130
    except (OSError, ValueError) as error:
        if as_json:
            print(json.dumps({"schemaVersion": 1, "status": "failed", "error": {"code": "operation-failed", "message": str(error)}}))
        print(f"operation-failed: {error}", file=sys.stderr)
        return 1
