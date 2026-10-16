#!/usr/bin/env python3
r"""
Bootstrap or refresh the complete repository-local development environment for
Hadden-Industries/agent-skills.

EXPECTED LOCATION
-----------------
    <repo>/<scripts>/set_up_development_environment.py

`<scripts>` is whatever directory one level below the repository root holds this
file; its name is never inspected. The repository root is derived from this
script's own location, so the current working directory is irrelevant.

This runner verifies the repository identity and checks the shared skill CLI's
desired-state/lock contract, then runs the two standalone tooling setup scripts:

    tools/repository-skills.pyz  Check repository-skills.json and native lock
    set_up_evaluation_tools.py   skills-ref, Tessl CLI, OpenAI Plugin Eval
    set_up_mcp_servers.py        MCP servers and each host's configuration

Run one of those directly when only that part needs refreshing. Run this script
to converge everything. Rerunning IS the update mechanism; dependencies
deliberately follow current upstream releases rather than being version-pinned.

The identity check lives here rather than in the reusable tooling setup scripts.
It guards their generated-directory changes against running in the wrong clone.

Target Agent Skill hosts
------------------------
- Codex
- Antigravity
- Claude Code

Generated local paths belong in the repository's committed .gitignore rather than
a developer-specific .git/info/exclude. The three MCP configuration files are the
deliberate exception: they are tracked, because they name the server by a
repository-relative path and configure no credential.

This runner and its parts intentionally DO NOT:
- use `npx skills --global`
- use `npm install -g`
- use `pip --user`
- run Tessl's native/global installer
- authenticate Tessl
- modify user-level ~/.agents, ~/.codex, ~/.claude, ~/.gemini, or ~/.tessl
- store any GitHub credential
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import set_up_evaluation_tools
import set_up_mcp_servers
from _commands import SetupError, require_python_version, run
from _repository import derive_repo_from_script, verify_repo_identity

EXPECTED_REPO = "github.com/hadden-industries/agent-skills"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Check repository skill declarations, then set up evaluation tooling "
            "and MCP servers in order. Skill publication uses a reviewed CLI plan."
        )
    )
    parser.add_argument(
        "--allow-unverified-repo",
        action="store_true",
        help=(
            "Skip verification that a Git remote identifies the repository as "
            "Hadden-Industries/agent-skills."
        ),
    )
    return parser.parse_args()


def report(repo: Path, tools: dict[str, Path], server: Path, configs: list[Path]) -> None:
    print("\nDevelopment environment is ready and refreshed to latest.")
    print(f"Repository: {repo}")

    print("\nAgent Skills:")
    print("  Declarations checked; skill refresh requires a reviewed plan and apply.")
    print(f"  Codex/Antigravity: {repo / '.agents' / 'skills'}")
    print(f"  Claude Code:       {repo / '.claude' / 'skills'}")

    print("\nLocal tools:")
    print(f"  Python venv:        {tools['venv']}")
    print(f"  Tool wrappers:      {tools['bin_dir']}")
    print(f"  OpenAI Plugin Eval: {tools['plugin_root']}")
    print(f"  GitHub MCP server:  {server}")

    print("\nMCP configuration (repository-local, one file per host):")
    for path in configs:
        print(f"  {path.relative_to(repo).as_posix()}")
    print(
        "  No credential is configured: the server authenticates through its own"
        "\n  browser-based OAuth flow on first use and stores no token."
    )

    if os.name == "nt":
        print("\nExamples:")
        print(
            r"  .\.agent-tools\bin\skills-ref.cmd validate "
            r".\skills\committing-to-git"
        )
        print(
            r"  .\.agent-tools\bin\tessl.cmd skill lint ."
        )
        print(
            r"  .\.agent-tools\bin\plugin-eval.cmd analyze "
            r".\skills\committing-to-git --format markdown"
        )

    print(
        "\nRerun this same script whenever you want to refresh everything, or "
        "run an individual tooling setup script to refresh that part. "
        "Refresh skills\nwith tools/repository-skills.pyz plan, review, then apply PLAN_ID."
    )
    print(
        "Generated tooling is excluded by the repository's committed .gitignore, "
        "not a\ndeveloper-specific .git/info/exclude. The three MCP configuration "
        "files above are\nthe exception: they are tracked, so review their diff "
        "before committing."
    )
    print(
        "Tessl authentication is intentionally not performed because its "
        "authentication/preferences use user-level ~/.tessl state."
    )


def main() -> int:
    args = parse_args()

    try:
        require_python_version()
        repo = derive_repo_from_script(__file__)
        print(f"Repository root: {repo}")

        if args.allow_unverified_repo:
            print("Repository identity check: skipped by explicit request")
        else:
            verify_repo_identity(repo, EXPECTED_REPO)
            print("Repository identity: Hadden-Industries/agent-skills")

        run([sys.executable, "-I", "-B", repo / "tools" / "repository-skills.pyz", "check"], cwd=repo)
        tools = set_up_evaluation_tools.ensure_evaluation_tools(repo)

        server, configs = set_up_mcp_servers.ensure_github_mcp_server(repo)
        set_up_mcp_servers.verify_mcp_servers(repo, server, configs)

        report(repo, tools, server, configs)

        return 0

    except (SetupError, subprocess.CalledProcessError, OSError) as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)

        return 1


if __name__ == "__main__":
    raise SystemExit(main())
