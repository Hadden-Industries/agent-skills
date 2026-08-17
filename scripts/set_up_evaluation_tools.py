#!/usr/bin/env python3
r"""
Install the repository-local skill validation and evaluation toolchain.

EXPECTED LOCATION
-----------------
    <repo>/<scripts>/set_up_evaluation_tools.py

`<scripts>` is whatever directory one level below the repository root holds this
file; its name is never inspected. The repository root is derived from this
script's own location, so the current working directory is irrelevant.

Rerunning this script IS the update mechanism. Dependencies deliberately follow
the latest/current upstream releases rather than being version-pinned, so this
repository tracks current skill-engineering practice rather than reproducing an
old toolchain bit for bit.

Tools installed
---------------
- agentskills/agentskills: skills-ref   (normative Agent Skills validation)
- Tessl CLI                             (independent lint and cloud review)
- openai/plugins: plugin-eval           (Codex analysis and token budgets)

Generated command wrappers
--------------------------
- .agent-tools/bin/skills-ref[.cmd]
- .agent-tools/bin/tessl[.cmd]
- .agent-tools/bin/plugin-eval[.cmd]

This script intentionally DOES NOT:
- use `npm install -g`
- use `pip --user`
- run Tessl's native/global installer
- authenticate Tessl, whose credentials and preferences are user-level ~/.tessl
  state rather than anything this repository should own
- modify user-level ~/.agents, ~/.codex, ~/.claude, ~/.gemini, or ~/.tessl
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from _commands import SetupError, require_command, run
from _repository import derive_repo_from_script, normalize_remote

OPENAI_PLUGINS_URL = "https://github.com/openai/plugins.git"
OPENAI_PLUGIN_EVAL_PATH = Path("plugins") / "plugin-eval"

SKILLS_REF_VCS = (
    "git+https://github.com/agentskills/agentskills.git@main"
    "#subdirectory=skills-ref"
)

WRAPPER_NAMES = ("skills-ref", "tessl", "plugin-eval")


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
        (require_command("git"), "-C", checkout, "remote", "get-url", "origin"),
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
        (git, "-C", checkout, "fetch", "--prune", "--depth", "1", "origin", "main"),
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
    run((git, "-C", checkout, "reset", "--hard", "origin/main"), cwd=repo)
    run((git, "-C", checkout, "clean", "-fdx"), cwd=repo)

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
            f"OpenAI Plugin Eval sparse checkout is incomplete:\n{rendered}"
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
            ("cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)),
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
        "interface": {"displayName": "Hadden Agent Skills Local Tools"},
        "plugins": [
            {
                "name": "plugin-eval",
                "source": {"source": "local", "path": "./plugins/plugin-eval"},
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
            "@echo off\n" f"\"{skills_ref}\" %*\n",
        )
        write_wrapper(
            bin_dir / "tessl.cmd",
            "@echo off\n"
            "set TESSL_AUTO_UPDATE_INTERVAL_MINUTES=0\n"
            f"call \"{tessl}\" %*\n",
        )
        write_wrapper(
            bin_dir / "plugin-eval.cmd",
            "@echo off\n" f"node \"{plugin_script}\" %*\n",
        )
    else:
        write_wrapper(
            bin_dir / "skills-ref",
            "#!/usr/bin/env sh\n" f'exec "{skills_ref}" "$@"\n',
        )
        write_wrapper(
            bin_dir / "tessl",
            "#!/usr/bin/env sh\n"
            "export TESSL_AUTO_UPDATE_INTERVAL_MINUTES=0\n"
            f'exec "{tessl}" "$@"\n',
        )
        write_wrapper(
            bin_dir / "plugin-eval",
            "#!/usr/bin/env sh\n" f'exec node "{plugin_script}" "$@"\n',
        )

        for name in WRAPPER_NAMES:
            wrapper = bin_dir / name
            wrapper.chmod(wrapper.stat().st_mode | 0o111)

    return bin_dir


def verify_evaluation_tools(
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
        "Plugin Eval marketplace": repo / ".agents" / "plugins" / "marketplace.json",
    }

    print("\n== Verify repository-local evaluation tools ==")
    missing: list[Path] = []

    for label, item in checks.items():
        if item.exists():
            print(f"  OK      {label}: {item}")
        else:
            print(f"  MISSING {label}: {item}")
            missing.append(item)

    suffix = ".cmd" if os.name == "nt" else ""

    for name in WRAPPER_NAMES:
        item = bin_dir / f"{name}{suffix}"

        if item.exists():
            print(f"  OK      wrapper: {item}")
        else:
            print(f"  MISSING wrapper: {item}")
            missing.append(item)

    if missing:
        raise SetupError("Repository-local evaluation tooling verification failed.")


def ensure_evaluation_tools(repo: Path) -> dict[str, Path]:
    """
    Install every evaluation tool and its wrapper, returning the notable paths.

    The mapping is what a caller sequencing several setup steps needs in order to
    print a combined summary.
    """
    _venv, skills_ref = ensure_python_tooling(repo)
    tessl = ensure_tessl(repo)
    plugin_root = ensure_openai_plugin_eval(repo)

    bin_dir = ensure_wrappers(
        repo,
        skills_ref=skills_ref,
        tessl=tessl,
        plugin_root=plugin_root,
    )

    verify_evaluation_tools(
        repo,
        skills_ref=skills_ref,
        tessl=tessl,
        plugin_root=plugin_root,
        bin_dir=bin_dir,
    )

    return {
        "venv": repo / ".venv",
        "skills_ref": skills_ref,
        "tessl": tessl,
        "plugin_root": plugin_root,
        "bin_dir": bin_dir,
    }


def parse_args() -> argparse.Namespace:
    return argparse.ArgumentParser(
        description=(
            "Install the repository-local skill validation and evaluation "
            "toolchain."
        )
    ).parse_args()


def main() -> int:
    parse_args()

    try:
        require_command("git")
        require_command("npm")
        require_command("node")

        repo = derive_repo_from_script(__file__)
        print(f"Repository root: {repo}")

        ensure_evaluation_tools(repo)

        print("\nEvaluation tooling setup is complete.")
        print(
            "Tessl authentication is intentionally not performed because its "
            "authentication/preferences use user-level ~/.tessl state."
        )

        return 0

    except (SetupError, subprocess.CalledProcessError, OSError) as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)

        return 1


if __name__ == "__main__":
    raise SystemExit(main())
