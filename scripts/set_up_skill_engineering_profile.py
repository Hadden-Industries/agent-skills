#!/usr/bin/env python3
r"""
Bootstrap or refresh the repository-local skill-engineering environment for
Hadden-Industries/agent-skills.

EXPECTED LOCATION
-----------------
    <repo>/scripts/set_up_skill_engineering_profile.py

The repository root is derived from this script's own location. The current
working directory is irrelevant.

Rerunning this script IS the update mechanism. Dependencies deliberately follow
the latest/current upstream releases rather than being version-pinned.

Repository-local Agent Skills
-----------------------------
- anthropics/skills: skill-creator
- obra/superpowers: writing-skills
- obra/superpowers: test-driven-development
- olgasafonova/SkillCheck-Free: skill-check
- Hadden-Industries/agent-skills: committing-to-git

Repository-local evaluation/tooling
-----------------------------------
- agentskills/agentskills: skills-ref
- Tessl CLI
- openai/plugins: plugin-eval

Target Agent Skill hosts
------------------------
- Codex
- Antigravity
- Claude Code

Generated local paths are added to .git/info/exclude before creation, so they
remain clone-local and do not require tracked .gitignore changes.

This script intentionally DOES NOT:
- use `npx skills --global`
- use `npm install -g`
- use `pip --user`
- run Tessl's native/global installer
- authenticate Tessl
- modify user-level ~/.agents, ~/.codex, ~/.claude, ~/.gemini, or ~/.tessl

Generated command wrappers
--------------------------
- .agent-tools/bin/skills-ref.cmd
- .agent-tools/bin/tessl.cmd
- .agent-tools/bin/plugin-eval.cmd
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Iterable

EXPECTED_REPO = "github.com/hadden-industries/agent-skills"
EXPECTED_SCRIPT_PARENT = "scripts"

AGENTS = ("codex", "antigravity", "claude-code")

EXPECTED_SKILLS = (
    "skill-creator",
    "writing-skills",
    "test-driven-development",
    "skill-check",
	"committing-to-git",
)

OPENAI_PLUGINS_URL = "https://github.com/openai/plugins.git"
OPENAI_PLUGIN_EVAL_PATH = Path("plugins") / "plugin-eval"

SKILLS_REF_VCS = (
    "git+https://github.com/agentskills/agentskills.git@main"
    "#subdirectory=skills-ref"
)


class SetupError(RuntimeError):
    """Raised for a safe, user-actionable setup failure."""


def run(
    args: Iterable[object],
    *,
    cwd: Path | None = None,
    capture: bool = False,
) -> subprocess.CompletedProcess[str]:
    command = [str(arg) for arg in args]
    print(f"> {subprocess.list2cmdline(command)}")
    return subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        check=True,
        text=True,
        capture_output=capture,
    )


def require_command(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise SetupError(f"Required command not found on PATH: {name}")
    return path


def git_output(repo: Path, *args: str) -> str:
    result = run(
        (require_command("git"), "-C", repo, *args),
        capture=True,
    )
    return result.stdout.strip()


def derive_repo_from_script() -> Path:
    """Derive and verify the repository root from scripts/<this-file>."""
    script_path = Path(__file__).resolve()

    if script_path.parent.name.lower() != EXPECTED_SCRIPT_PARENT:
        raise SetupError(
            "This bootstrap must live directly under the repository's "
            f"`{EXPECTED_SCRIPT_PARENT}/` directory.\n"
            f"Current script path: {script_path}"
        )

    candidate = script_path.parent.parent.resolve()

    try:
        discovered = Path(
            git_output(candidate, "rev-parse", "--show-toplevel")
        ).resolve()
    except subprocess.CalledProcessError as exc:
        raise SetupError(
            f"The directory above scripts/ is not a Git working tree: {candidate}"
        ) from exc

    if discovered != candidate:
        raise SetupError(
            "The script's parent layout does not resolve exactly to the Git "
            "repository root.\n"
            f"Expected from script location: {candidate}\n"
            f"Git reports: {discovered}"
        )

    return discovered


def normalize_remote(url: str) -> str:
    value = url.strip().lower().replace("\\", "/")
    value = re.sub(r"^git@github\.com:", "github.com/", value)
    value = re.sub(r"^ssh://git@github\.com/", "github.com/", value)
    value = re.sub(r"^https?://", "", value)
    value = re.sub(r"^git://", "", value)

    if value.endswith(".git"):
        value = value[:-4]

    return value.rstrip("/")


def verify_repo_identity(repo: Path) -> None:
    output = git_output(repo, "remote", "-v")
    remotes = {
        fields[1]
        for line in output.splitlines()
        if len(fields := line.split()) >= 2
    }
    normalized = {normalize_remote(url) for url in remotes}

    if EXPECTED_REPO not in normalized:
        listing = "\n".join(f"  - {url}" for url in sorted(remotes))
        raise SetupError(
            "Refusing to bootstrap because this working tree does not have a "
            "remote for Hadden-Industries/agent-skills.\n"
            f"Repository root: {repo}\n"
            f"Remotes:\n{listing or '  (none)'}\n\n"
            "Use --allow-unverified-repo only for an intentional fork or "
            "worktree without the canonical remote."
        )


def tracked_paths_under(repo: Path, relative_path: str) -> list[str]:
    result = git_output(repo, "ls-files", "--", relative_path)
    return [line for line in result.splitlines() if line.strip()]


def remove_generated_path(repo: Path, relative_path: str) -> None:
    """Safely remove generated state, refusing if Git tracks anything in it."""
    path = (repo / relative_path).resolve(strict=False)

    try:
        path.relative_to(repo)
    except ValueError as exc:
        raise SetupError(
            f"Refusing to remove path outside repository: {path}"
        ) from exc

    tracked = tracked_paths_under(repo, relative_path)
    if tracked:
        rendered = "\n".join(f"  - {item}" for item in tracked)
        raise SetupError(
            "A path managed as generated by this bootstrap contains tracked "
            "Git files, so it will not be removed:\n"
            f"{rendered}"
        )

    if path.is_symlink():
        path.unlink()
        return

    if path.exists():
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()


def reset_generated_skill_views(repo: Path) -> None:
    """
    Recreate project skill views from scratch on every run.

    This prevents stale skills or stale project lock entries surviving when the
    declared profile changes.
    """
    print("\n== Reset generated Agent Skill views ==")

    for relative in (
        ".agents/skills",
        ".claude/skills",
        "skills-lock.json",
        ".agents/.skill-lock.json",
    ):
        remove_generated_path(repo, relative)


def agent_args() -> list[str]:
    result: list[str] = []
    for agent in AGENTS:
        result.extend(("--agent", agent))
    return result


def install_agent_skills(repo: Path) -> None:
    """
    Explicitly re-add only the selected skills from their current upstreams.

    This intentionally avoids relying on project-scoped `skills update`.
    """
    npx = require_command("npx")
    common = [*agent_args(), "--yes"]

    commands = (
        (
            npx,
            "skills@latest",
            "add",
            "https://github.com/anthropics/skills/tree/main/skills/skill-creator",
            *common,
        ),
        (
            npx,
            "skills@latest",
            "add",
            "https://github.com/obra/superpowers",
            "--skill",
            "writing-skills",
            "--skill",
            "test-driven-development",
            *common,
        ),
        (
            npx,
            "skills@latest",
            "add",
            "https://github.com/olgasafonova/SkillCheck-Free/tree/main/skills/skill-check",
            *common,
        ),
        (
            npx,
            "skills@latest",
            "add",            "https://github.com/Hadden-Industries/agent-skills/tree/main/skills/committing-to-git",
            *common,
        ),
    )

    print("\n== Repository-local Agent Skills ==")
    print("Refreshing from current upstream sources; no --global flag is used.\n")

    for command in commands:
        run(command, cwd=repo)


def ensure_python_version() -> None:
    if sys.version_info < (3, 11):
        raise SetupError(
            "Python 3.11 or newer is required because skills-ref currently "
            f"requires Python >=3.11. Running: {sys.version.split()[0]}"
        )


def venv_python(venv: Path) -> Path:
    if os.name == "nt":
        return venv / "Scripts" / "python.exe"
    return venv / "bin" / "python"


def venv_executable(venv: Path, name: str) -> Path:
    if os.name == "nt":
        return venv / "Scripts" / f"{name}.exe"
    return venv / "bin" / name


def ensure_python_tooling(repo: Path) -> tuple[Path, Path]:
    """
    Create/reuse .venv and refresh Python dependencies to current upstream.

    skills-ref is deliberately force-reinstalled from main on every run so
    upstream changes are picked up even if its package version has not changed.
    """
    ensure_python_version()

    venv = (repo / ".venv").resolve()
    python = venv_python(venv)

    if not python.exists():
        print(f"\nCreating repository-local virtual environment: {venv}")
        run((sys.executable, "-m", "venv", venv), cwd=repo)

    if not python.exists():
        raise SetupError(f"Virtual-environment Python not found: {python}")

    print("\n== Repository-local Python tooling ==")

    run(
        (
            python,
            "-m",
            "pip",
            "install",
            "--upgrade",
            "--disable-pip-version-check",
            "pip",
            "PyYAML",
        ),
        cwd=repo,
    )

    run(
        (
            python,
            "-m",
            "pip",
            "install",
            "--upgrade",
            "--force-reinstall",
            "--no-cache-dir",
            "--disable-pip-version-check",
            SKILLS_REF_VCS,
        ),
        cwd=repo,
    )

    skills_ref = venv_executable(venv, "skills-ref")
    if not skills_ref.exists():
        raise SetupError(
            "skills-ref did not install its expected repository-local "
            f"executable: {skills_ref}"
        )

    return venv, skills_ref


def npm_local_bin(prefix: Path, command: str) -> Path:
    if os.name == "nt":
        return prefix / "node_modules" / ".bin" / f"{command}.cmd"
    return prefix / "node_modules" / ".bin" / command


def ensure_tessl(repo: Path) -> Path:
    """Install or refresh Tessl under a strictly repository-local npm prefix."""
    npm = require_command("npm")
    prefix = repo / ".agent-tools" / "tessl"
    prefix.mkdir(parents=True, exist_ok=True)

    print("\n== Repository-local Tessl CLI ==")
    print(f"Install prefix: {prefix}")

    run(
        (
            npm,
            "install",
            "--prefix",
            prefix,
            "--save-exact",
            "--no-audit",
            "--no-fund",
            "@tessl/cli@latest",
        ),
        cwd=repo,
    )

    tessl = npm_local_bin(prefix, "tessl")
    if not tessl.exists():
        raise SetupError(
            "Tessl installed, but its repository-local executable was not "
            f"found at: {tessl}"
        )

    # Do not execute/login here: Tessl's authentication/preferences are
    # user-level state under ~/.tessl.
    return tessl


def node_major_version() -> int:
    node = require_command("node")
    result = run((node, "--version"), capture=True)
    raw = result.stdout.strip().lstrip("v")

    try:
        return int(raw.split(".", 1)[0])
    except (ValueError, IndexError) as exc:
        raise SetupError(f"Could not parse Node.js version: {raw!r}") from exc


def ensure_node_version() -> None:
    major = node_major_version()
    if major < 20:
        raise SetupError(
            "OpenAI Plugin Eval currently requires Node.js >=20. "
            f"Detected Node.js major version {major}."
        )


def verify_openai_checkout_origin(checkout: Path) -> None:
    result = run(
        (
            require_command("git"),
            "-C",
            checkout,
            "remote",
            "get-url",
            "origin",
        ),
        capture=True,
    )

    actual = normalize_remote(result.stdout.strip())
    expected = normalize_remote(OPENAI_PLUGINS_URL)

    if actual != expected:
        raise SetupError(
            "Refusing to update the managed OpenAI Plugin Eval checkout because "
            "its origin is unexpected.\n"
            f"Expected: {OPENAI_PLUGINS_URL}\n"
            f"Actual:   {result.stdout.strip()}"
        )


def update_openai_sparse_checkout(repo: Path, checkout: Path) -> Path:
    """Converge the generated sparse checkout exactly to current origin/main."""
    git = require_command("git")

    if checkout.exists() and not (checkout / ".git").exists():
        raise SetupError(
            "Managed OpenAI checkout path exists but is not a Git repository: "
            f"{checkout}"
        )

    if not checkout.exists():
        checkout.parent.mkdir(parents=True, exist_ok=True)
        run(
            (
                git,
                "clone",
                "--depth",
                "1",
                "--filter=blob:none",
                "--sparse",
                OPENAI_PLUGINS_URL,
                checkout,
            ),
            cwd=repo,
        )
    else:
        verify_openai_checkout_origin(checkout)

    run(
        (
            git,
            "-C",
            checkout,
            "fetch",
            "--prune",
            "--depth",
            "1",
            "origin",
            "main",
        ),
        cwd=repo,
    )

    run(
        (
            git,
            "-C",
            checkout,
            "sparse-checkout",
            "set",
            OPENAI_PLUGIN_EVAL_PATH.as_posix(),
        ),
        cwd=repo,
    )

    # Generated dependency checkout: discard accidental local modifications.
    run(
        (
            git,
            "-C",
            checkout,
            "reset",
            "--hard",
            "origin/main",
        ),
        cwd=repo,
    )
    run(
        (
            git,
            "-C",
            checkout,
            "clean",
            "-fdx",
        ),
        cwd=repo,
    )

    plugin_root = checkout / OPENAI_PLUGIN_EVAL_PATH

    required = (
        plugin_root / ".codex-plugin" / "plugin.json",
        plugin_root / "scripts" / "plugin-eval.js",
        plugin_root / "skills" / "plugin-eval" / "SKILL.md",
    )

    missing = [item for item in required if not item.exists()]
    if missing:
        rendered = "\n".join(f"  - {item}" for item in missing)
        raise SetupError(
            "OpenAI Plugin Eval sparse checkout is incomplete:\n"
            f"{rendered}"
        )

    return plugin_root


def path_is_link_or_junction(path: Path) -> bool:
    if path.is_symlink():
        return True

    is_junction = getattr(path, "is_junction", None)
    return bool(is_junction and is_junction())


def create_directory_link(link: Path, target: Path) -> None:
    """Create an idempotent repo-local junction/symlink to generated tooling."""
    link.parent.mkdir(parents=True, exist_ok=True)
    target = target.resolve()

    if link.exists() or path_is_link_or_junction(link):
        try:
            if link.resolve() == target:
                return
        except OSError:
            pass

        raise SetupError(
            "Refusing to replace an existing path with the generated Plugin "
            f"Eval link: {link}"
        )

    if os.name == "nt":
        run(
            (
                "cmd.exe",
                "/d",
                "/c",
                "mklink",
                "/J",
                str(link),
                str(target),
            ),
            cwd=link.parent,
        )
    else:
        os.symlink(target, link, target_is_directory=True)


def ensure_workspace_marketplace(repo: Path) -> Path:
    """
    Generate the workspace-local Plugin Eval marketplace descriptor.

    This does not register a user-level marketplace with Codex.
    """
    marketplace = repo / ".agents" / "plugins" / "marketplace.json"
    marketplace.parent.mkdir(parents=True, exist_ok=True)

    data = {
        "name": "hadden-agent-skills-local",
        "interface": {
            "displayName": "Hadden Agent Skills Local Tools",
        },
        "plugins": [
            {
                "name": "plugin-eval",
                "source": {
                    "source": "local",
                    "path": "./plugins/plugin-eval",
                },
                "policy": {
                    "installation": "AVAILABLE",
                    "authentication": "ON_INSTALL",
                },
                "category": "Developer Tools",
            }
        ],
    }

    marketplace.write_text(
        json.dumps(data, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    return marketplace


def ensure_openai_plugin_eval(repo: Path) -> Path:
    ensure_node_version()

    checkout = repo / ".agent-tools" / "openai-plugins"

    print("\n== Repository-local OpenAI Plugin Eval ==")
    plugin_root = update_openai_sparse_checkout(repo, checkout)

    plugin_link = repo / "plugins" / "plugin-eval"
    create_directory_link(plugin_link, plugin_root)
    ensure_workspace_marketplace(repo)

    return plugin_root


def write_wrapper(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    newline = "\r\n" if os.name == "nt" else "\n"
    path.write_text(content, encoding="utf-8", newline=newline)


def ensure_wrappers(
    repo: Path,
    *,
    skills_ref: Path,
    tessl: Path,
    plugin_root: Path,
) -> Path:
    """Regenerate stable repo-local wrappers on every setup/update run."""
    bin_dir = repo / ".agent-tools" / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)

    plugin_script = plugin_root / "scripts" / "plugin-eval.js"

    if os.name == "nt":
        write_wrapper(
            bin_dir / "skills-ref.cmd",
            "@echo off\n"
            f"\"{skills_ref}\" %*\n",
        )
        write_wrapper(
            bin_dir / "tessl.cmd",
            "@echo off\n"
            "set TESSL_AUTO_UPDATE_INTERVAL_MINUTES=0\n"
            f"call \"{tessl}\" %*\n",
        )
        write_wrapper(
            bin_dir / "plugin-eval.cmd",
            "@echo off\n"
            f"node \"{plugin_script}\" %*\n",
        )
    else:
        write_wrapper(
            bin_dir / "skills-ref",
            "#!/usr/bin/env sh\n"
            f'exec "{skills_ref}" "$@"\n',
        )
        write_wrapper(
            bin_dir / "tessl",
            "#!/usr/bin/env sh\n"
            "export TESSL_AUTO_UPDATE_INTERVAL_MINUTES=0\n"
            f'exec "{tessl}" "$@"\n',
        )
        write_wrapper(
            bin_dir / "plugin-eval",
            "#!/usr/bin/env sh\n"
            f'exec node "{plugin_script}" "$@"\n',
        )

        for name in ("skills-ref", "tessl", "plugin-eval"):
            wrapper = bin_dir / name
            wrapper.chmod(wrapper.stat().st_mode | 0o111)

    return bin_dir


def verify_agent_skills(repo: Path) -> None:
    roots = {
        "Codex/Antigravity": repo / ".agents" / "skills",
        "Claude Code": repo / ".claude" / "skills",
    }

    missing: list[Path] = []

    print("\n== Verify project-local Agent Skills ==")
    for label, root in roots.items():
        for skill in EXPECTED_SKILLS:
            skill_md = root / skill / "SKILL.md"
            if skill_md.exists():
                print(f"  OK      {label:18} {skill}")
            else:
                print(f"  MISSING {label:18} {skill}")
                missing.append(skill_md)

    if missing:
        raise SetupError(
            "One or more expected project-local SKILL.md files are missing."
        )


def verify_local_tooling(
    repo: Path,
    *,
    skills_ref: Path,
    tessl: Path,
    plugin_root: Path,
    bin_dir: Path,
) -> None:
    checks = {
        "skills-ref executable": skills_ref,
        "Tessl executable": tessl,
        "Plugin Eval script": plugin_root / "scripts" / "plugin-eval.js",
        "Plugin Eval manifest": plugin_root / ".codex-plugin" / "plugin.json",
        "Plugin Eval marketplace": (
            repo / ".agents" / "plugins" / "marketplace.json"
        ),
    }

    print("\n== Verify repository-local tooling ==")
    missing: list[Path] = []

    for label, item in checks.items():
        if item.exists():
            print(f"  OK      {label}: {item}")
        else:
            print(f"  MISSING {label}: {item}")
            missing.append(item)

    wrapper_names = (
        ("skills-ref.cmd", "tessl.cmd", "plugin-eval.cmd")
        if os.name == "nt"
        else ("skills-ref", "tessl", "plugin-eval")
    )

    for name in wrapper_names:
        item = bin_dir / name
        if item.exists():
            print(f"  OK      wrapper: {item}")
        else:
            print(f"  MISSING wrapper: {item}")
            missing.append(item)

    if missing:
        raise SetupError("Repository-local tooling verification failed.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Bootstrap or refresh the complete repository-local "
            "skill-engineering profile."
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


def main() -> int:
    args = parse_args()

    try:
        require_command("git")
        require_command("npx")
        require_command("npm")
        require_command("node")

        repo = derive_repo_from_script()
        print(f"Repository root: {repo}")

        if args.allow_unverified_repo:
            print("Repository identity check: skipped by explicit request")
        else:
            verify_repo_identity(repo)
            print("Repository identity: Hadden-Industries/agent-skills")

        # Recreate the project skill views/lock to guarantee convergence.
        reset_generated_skill_views(repo)
        install_agent_skills(repo)

        _venv, skills_ref = ensure_python_tooling(repo)
        tessl = ensure_tessl(repo)
        plugin_root = ensure_openai_plugin_eval(repo)

        bin_dir = ensure_wrappers(
            repo,
            skills_ref=skills_ref,
            tessl=tessl,
            plugin_root=plugin_root,
        )

        verify_agent_skills(repo)
        verify_local_tooling(
            repo,
            skills_ref=skills_ref,
            tessl=tessl,
            plugin_root=plugin_root,
            bin_dir=bin_dir,
        )

        print("\nSkill-engineering profile is ready and refreshed to latest.")
        print(f"Repository: {repo}")
        print("\nAgent Skills:")
        print(f"  Codex/Antigravity: {repo / '.agents' / 'skills'}")
        print(f"  Claude Code:       {repo / '.claude' / 'skills'}")
        print("\nLocal tools:")
        print(f"  Python venv:        {repo / '.venv'}")
        print(f"  Tool wrappers:      {bin_dir}")
        print(f"  OpenAI Plugin Eval: {plugin_root}")

        if os.name == "nt":
            print("\nExamples:")
            print(
                r"  .\.agent-tools\bin\skills-ref.cmd validate "
                r".\skills\committing-to-git"
            )
            print(
                r"  .\.agent-tools\bin\tessl.cmd skill lint "
                r".\skills\committing-to-git"
            )
            print(
                r"  .\.agent-tools\bin\plugin-eval.cmd analyze "
                r".\skills\committing-to-git --format markdown"
            )

        print(
            "\nRerun this same script whenever you want to refresh the "
            "environment. No separate update script is required."
        )
        print(
            "All files generated by this bootstrap are excluded via "
            ".git/info/exclude; the bootstrap script itself remains trackable."
        )
        print(
            "Tessl authentication is intentionally not performed because its "
            "authentication/preferences use user-level ~/.tessl state."
        )

        return 0

    except (SetupError, subprocess.CalledProcessError) as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
