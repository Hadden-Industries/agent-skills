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

This is a runner. It verifies the repository's identity once, then sequences the
three setup scripts that do the work, each of which is also runnable on its own
and each of which lives beside this file:

    set_up_agent_skills.py       Agent Skills declared in skills-lock.json
    set_up_evaluation_tools.py   skills-ref, Tessl CLI, OpenAI Plugin Eval
    set_up_mcp_servers.py        MCP servers and each host's configuration

Run one of those directly when only that part needs refreshing. Run this script
to converge everything. Rerunning IS the update mechanism; dependencies
deliberately follow current upstream releases rather than being version-pinned.

The identity check lives here rather than in the three parts, which keeps them
repository-agnostic and reusable elsewhere. It exists because every part deletes
and rewrites generated directories, and doing that in the wrong clone would
destroy someone's unrelated work.

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

import set_up_agent_skills
import set_up_evaluation_tools
import set_up_mcp_servers
from _commands import SetupError
from _repository import derive_repo_from_script, verify_repo_identity

EXPECTED_REPO = "github.com/hadden-industries/agent-skills"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Bootstrap or refresh the complete repository-local development "
            "environment by running every setup script in order."
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
    parser.add_argument(
        "--agent",
        action="append",
        choices=sorted(set_up_agent_skills.AGENT_SKILL_ROOTS),
        dest="agents",
        help=(
            "Target agent for Agent Skills. Repeat for multiple agents. "
            "Default: codex, antigravity, claude-code."
        ),
    )

    return parser.parse_args()


def report(repo: Path, tools: dict[str, Path], server: Path, configs: list[Path]) -> None:
    print("\nDevelopment environment is ready and refreshed to latest.")
    print(f"Repository: {repo}")

    print("\nAgent Skills:")
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
        "run one of\nthe three setup scripts directly to refresh only that part. "
        "No separate update\nscript is required."
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
        repo = derive_repo_from_script(__file__)
        print(f"Repository root: {repo}")

        if args.allow_unverified_repo:
            print("Repository identity check: skipped by explicit request")
        else:
            verify_repo_identity(repo, EXPECTED_REPO)
            print("Repository identity: Hadden-Industries/agent-skills")

        agents = tuple(
            dict.fromkeys(args.agents or set_up_agent_skills.DEFAULT_AGENTS)
        )

        set_up_agent_skills.ensure_agent_skills(repo, agents)
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
