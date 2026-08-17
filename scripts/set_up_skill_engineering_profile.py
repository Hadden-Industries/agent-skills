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
- github/github-mcp-server (release binary, not `go install`)

Target Agent Skill hosts
------------------------
- Codex
- Antigravity
- Claude Code

Generated local paths belong in the repository's committed .gitignore rather
than a developer-specific .git/info/exclude.

This script intentionally DOES NOT:
- use `npx skills --global`
- use `npm install -g`
- use `pip --user`
- run Tessl's native/global installer
- authenticate Tessl
- modify user-level ~/.agents, ~/.codex, ~/.claude, ~/.gemini, or ~/.tessl
- store any GitHub credential

Generated command wrappers
--------------------------
- .agent-tools/bin/skills-ref.cmd
- .agent-tools/bin/tessl.cmd
- .agent-tools/bin/plugin-eval.cmd

Generated MCP server and its host configuration
-----------------------------------------------
- .agent-tools/bin/github-mcp-server[.exe]
- .agent-tools/github-mcp-server/install.json  (release/idempotency record)
- .mcp.json                                    (Claude Code)
- .codex/config.toml                           (Codex, marker-delimited block)
- .agents/mcp_config.json                      (Antigravity)

Each host configuration names the server by a repository-relative path, so it
stays correct when the clone moves. No credential is configured: on github.com
the server runs its own browser-based OAuth flow on first use and keeps the
resulting token in memory only. That flow runs only when no token is set, so the
generated configuration deliberately neither names nor forwards a personal access
token.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import zipfile
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

    `skills-lock.json` is deliberately NOT reset. It is tracked, so deleting it
    made `remove_generated_path` refuse and aborted the whole bootstrap at its
    first step. The skills CLI updates it in place instead, which leaves a
    reviewable diff — a better record of a profile change than a file silently
    recreated from scratch. Do not add it back to this tuple without untracking
    it first.
    """
    print("\n== Reset generated Agent Skill views ==")

    for relative in (
        ".agents/skills",
        ".claude/skills",
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


# ===========================================================================
# GitHub MCP server
#
# Self-contained on purpose. Everything between this banner and the closing one
# depends only on the standard library and on `SetupError`, so lifting it into a
# standalone script means copying this block plus that one exception class and
# giving it an `argparse` entry point. Nothing above the banner calls into it
# except `ensure_github_mcp_server`, and nothing inside it calls back out.
# ===========================================================================

GITHUB_MCP_RELEASES_API = (
    "https://api.github.com/repos/github/github-mcp-server/releases/latest"
)
GITHUB_MCP_RELEASES_PAGE = "https://github.com/github/github-mcp-server/releases"

GITHUB_MCP_SERVER_KEY = "github"
GITHUB_MCP_BINARY_STEM = "github-mcp-server"
GITHUB_MCP_MANAGED_BY = "scripts/set_up_skill_engineering_profile.py"

# The server authenticates through its own browser-based OAuth flow, but only
# when no token is set. This variable being present in a developer's environment
# therefore pre-empts OAuth rather than complementing it. The bootstrap never
# sets it and never writes it into a configuration file; it only reports the
# conflict when it sees one.
GITHUB_MCP_TOKEN_VARIABLE = "GITHUB_PERSONAL_ACCESS_TOKEN"

# Where the installed executable and the install record live, relative to the
# repository root. The executable sits beside the other generated wrappers.
GITHUB_MCP_BIN_DIR = Path(".agent-tools") / "bin"
GITHUB_MCP_STATE_PATH = Path(".agent-tools") / "github-mcp-server" / "install.json"

# Repository-local MCP configuration, one file per agent host. All three hosts
# read a `command`/`args` stdio entry; only the file format and the key path
# differ.
MCP_JSON_HOST_CONFIGS = (
    (Path(".mcp.json"), "Claude Code"),
    (Path(".agents") / "mcp_config.json", "Antigravity"),
)
MCP_CODEX_HOST_CONFIG = Path(".codex") / "config.toml"

# `platform.machine()` reports the same architecture under several names, and
# none of them are the names the release assets use.
GITHUB_MCP_ARCHITECTURES = {
    "amd64": "x86_64",
    "x86_64": "x86_64",
    "x64": "x86_64",
    "aarch64": "arm64",
    "arm64": "arm64",
    "i386": "i386",
    "i686": "i386",
    "x86": "i386",
}

# Only the combinations upstream actually publishes, mapped to the archive
# format used for that operating system. Composing an asset name from parts
# without consulting this table produces a URL that 404s on exactly the platform
# nobody tested — macOS, for instance, has no 32-bit build.
GITHUB_MCP_RELEASE_ARCHIVES = {
    ("Windows", "x86_64"): ".zip",
    ("Windows", "arm64"): ".zip",
    ("Windows", "i386"): ".zip",
    ("Darwin", "x86_64"): ".tar.gz",
    ("Darwin", "arm64"): ".tar.gz",
    ("Linux", "x86_64"): ".tar.gz",
    ("Linux", "arm64"): ".tar.gz",
    ("Linux", "i386"): ".tar.gz",
}


def github_mcp_asset_name(system: str, machine: str) -> str:
    """Maps a `platform.system()`/`platform.machine()` pair to a release asset."""
    architecture = GITHUB_MCP_ARCHITECTURES.get(machine.strip().lower())

    if architecture is None:
        known = ", ".join(sorted(GITHUB_MCP_ARCHITECTURES))
        raise SetupError(
            "Unrecognised machine architecture for the GitHub MCP server: "
            f"{machine!r}. Recognised values: {known}."
        )

    extension = GITHUB_MCP_RELEASE_ARCHIVES.get((system, architecture))

    if extension is None:
        published = ", ".join(
            f"{host}/{arch}" for host, arch in sorted(GITHUB_MCP_RELEASE_ARCHIVES)
        )
        raise SetupError(
            "The GitHub MCP server publishes no release archive for "
            f"{system}/{architecture}. Published combinations: {published}.\n"
            f"See {GITHUB_MCP_RELEASES_PAGE}"
        )

    return f"{GITHUB_MCP_BINARY_STEM}_{system}_{architecture}{extension}"


def github_mcp_binary_name(system: str) -> str:
    if system == "Windows":
        return f"{GITHUB_MCP_BINARY_STEM}.exe"

    return GITHUB_MCP_BINARY_STEM


def parse_release_checksums(text: str) -> dict[str, str]:
    """Parses a `sha256sum`-style checksum manifest into name-to-digest pairs."""
    checksums: dict[str, str] = {}

    for line in text.splitlines():
        fields = line.split()

        if len(fields) != 2:
            continue

        digest, name = fields
        # Binary-mode manifests prefix the name with an asterisk.
        checksums[name.lstrip("*")] = digest.lower()

    return checksums


def select_archive_member(names: Iterable[str], binary_name: str, archive: Path) -> str:
    """
    Finds the server executable inside a release archive.

    Upstream keeps it at the archive root, but a leading directory is tolerated
    so a packaging change degrades into a working install rather than a failure.
    """
    candidates = list(names)

    for name in candidates:
        if name == binary_name or name.endswith(f"/{binary_name}"):
            return name

    listing = ", ".join(sorted(candidates)) or "(empty archive)"
    raise SetupError(
        f"{archive.name} does not contain {binary_name}. It contains: {listing}."
    )


def extract_release_binary(archive: Path, binary_name: str, target: Path) -> None:
    """Extracts just the server executable from a release archive."""
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as bundle:
            member = select_archive_member(bundle.namelist(), binary_name, archive)

            with bundle.open(member) as source:
                payload = source.read()
    else:
        with tarfile.open(archive, "r:gz") as bundle:
            member = select_archive_member(bundle.getnames(), binary_name, archive)
            source = bundle.extractfile(member)

            if source is None:
                raise SetupError(
                    f"{archive.name} holds {member} as a directory or link, not a file."
                )

            with source:
                payload = source.read()

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    target.chmod(target.stat().st_mode | 0o111)


def merge_json_mcp_config(
    existing: str | None,
    name: str,
    entry: dict[str, object],
) -> str:
    """
    Returns the text of an `mcpServers`-shaped configuration file with `name`
    pointing at the managed binary.

    Only the keys this bootstrap manages are overwritten. Options the developer
    added to that same server entry, other servers, and unrelated top-level keys
    all survive, because these files are shared with servers this repository
    knows nothing about.
    """
    document: dict[str, object] = {}

    if existing and existing.strip():
        try:
            parsed = json.loads(existing)
        except json.JSONDecodeError as exc:
            raise SetupError(
                f"Existing MCP configuration is not valid JSON: {exc}"
            ) from exc

        if not isinstance(parsed, dict):
            raise SetupError(
                "Existing MCP configuration is not a JSON object, so it cannot be "
                "merged. Move it aside and rerun."
            )

        document = parsed

    servers = document.setdefault("mcpServers", {})

    if not isinstance(servers, dict):
        raise SetupError(
            'Existing MCP configuration has a non-object "mcpServers" value, so it '
            "cannot be merged. Move it aside and rerun."
        )

    current = servers.get(name)
    merged = dict(current) if isinstance(current, dict) else {}
    merged.update(entry)
    servers[name] = merged

    return json.dumps(document, indent=2) + "\n"


def render_toml_value(value: object) -> str:
    if isinstance(value, str):
        # TOML basic strings use JSON's escape rules for everything appearing in
        # a command path or an environment-variable name.
        return json.dumps(value)

    if isinstance(value, bool):
        return "true" if value else "false"

    if isinstance(value, int):
        return str(value)

    if isinstance(value, list):
        return "[" + ", ".join(render_toml_value(item) for item in value) + "]"

    raise SetupError(f"Cannot render {value!r} as a TOML value.")


def codex_managed_marker(name: str, edge: str) -> str:
    return f"# {edge} mcp_servers.{name} - managed by {GITHUB_MCP_MANAGED_BY}"


def merge_codex_mcp_config(
    existing: str | None,
    name: str,
    entry: dict[str, object],
) -> str:
    """
    Returns the text of a Codex `config.toml` with a marker-delimited block for
    `name`.

    Codex configuration is hand-edited TOML carrying comments and ordering that a
    parse-and-rewrite round trip would flatten, so only the region between the
    markers is generated and everything outside it is copied through untouched.
    """
    begin = codex_managed_marker(name, "BEGIN")
    end = codex_managed_marker(name, "END")

    block = "\n".join(
        [
            begin,
            f"[mcp_servers.{name}]",
            *(f"{key} = {render_toml_value(value)}" for key, value in entry.items()),
            end,
        ]
    )

    text = existing or ""

    if begin in text and end in text:
        head, _, remainder = text.partition(begin)
        _, _, tail = remainder.partition(end)
        merged = f"{head}{block}{tail}"
    else:
        # TOML forbids declaring `[mcp_servers.<name>]` twice, so appending a
        # managed block beside a hand-written one would invalidate the whole
        # Codex configuration rather than just this server.
        if re.search(rf"^\s*\[mcp_servers\.{re.escape(name)}\]", text, re.MULTILINE):
            raise SetupError(
                f"The Codex configuration already declares [mcp_servers.{name}] "
                "outside the block managed by this bootstrap. Remove that table and "
                "rerun so the managed block can own it, or rename your entry."
            )

        merged = f"{text.rstrip()}\n\n{block}\n" if text.strip() else f"{block}\n"

    if not merged.endswith("\n"):
        merged = f"{merged}\n"

    # `tomllib` is standard from Python 3.11, which this bootstrap already
    # requires. Importing it here rather than at module scope keeps the failure
    # on an older interpreter an actionable message instead of an ImportError
    # raised before `main` runs.
    try:
        import tomllib
    except ModuleNotFoundError as exc:  # pragma: no cover - guarded by the check
        raise SetupError(
            "Writing the Codex MCP configuration requires Python 3.11 or newer for "
            f"`tomllib`. Running: {sys.version.split()[0]}"
        ) from exc

    try:
        parsed = tomllib.loads(merged)
    except tomllib.TOMLDecodeError as exc:
        raise SetupError(
            f"The generated Codex configuration would not be valid TOML: {exc}"
        ) from exc

    servers = parsed.get("mcp_servers")
    written = servers.get(name) if isinstance(servers, dict) else None

    if not isinstance(written, dict) or written.get("command") != entry.get("command"):
        raise SetupError(
            f"The generated Codex configuration does not resolve [mcp_servers.{name}] "
            "to the managed command. Inspect the file and rerun."
        )

    return merged


def write_host_config_file(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents, encoding="utf-8", newline="\n")


def write_mcp_host_configs(repo: Path, command: str) -> list[Path]:
    """
    Points every supported agent host at `command`, which is expected to be a
    repository-relative POSIX path.

    Relative is deliberate: each of these files sits at the root of the project
    or workspace the host opens, and each host starts a stdio server with that
    root as its working directory, so one string stays correct when the clone
    moves or is checked out on another machine.

    No credential is configured, by design. On github.com the server runs its
    own browser-based OAuth flow on first use and holds the resulting token in
    memory only, which is the authentication this repository relies on. That flow
    runs *only when no token is set*, so naming or forwarding a personal access
    token here would silently pre-empt it and reintroduce a long-lived
    credential.
    """
    entry: dict[str, object] = {"command": command, "args": ["stdio"]}
    written: list[Path] = []

    for relative, _host in MCP_JSON_HOST_CONFIGS:
        path = repo / relative
        existing = path.read_text(encoding="utf-8") if path.exists() else None

        write_host_config_file(
            path,
            merge_json_mcp_config(existing, GITHUB_MCP_SERVER_KEY, entry),
        )
        written.append(path)

    codex = repo / MCP_CODEX_HOST_CONFIG
    existing = codex.read_text(encoding="utf-8") if codex.exists() else None

    write_host_config_file(
        codex,
        merge_codex_mcp_config(existing, GITHUB_MCP_SERVER_KEY, entry),
    )
    written.append(codex)

    return written


def fetch_url(url: str, *, accept: str | None = None) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": f"{GITHUB_MCP_MANAGED_BY} (+repository bootstrap)"},
    )

    if accept:
        request.add_header("Accept", accept)

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        detail = (
            " The unauthenticated GitHub API allows 60 requests an hour per address."
            if exc.code in (403, 429)
            else ""
        )
        raise SetupError(f"HTTP {exc.code} fetching {url}: {exc.reason}.{detail}") from exc
    except urllib.error.URLError as exc:
        raise SetupError(f"Could not fetch {url}: {exc.reason}") from exc


def resolve_latest_github_mcp_release() -> tuple[str, dict[str, str]]:
    """Returns the latest release's tag and its asset-name-to-URL mapping."""
    payload = json.loads(
        fetch_url(GITHUB_MCP_RELEASES_API, accept="application/vnd.github+json")
    )

    tag = payload.get("tag_name")

    if not isinstance(tag, str) or not tag:
        raise SetupError(
            f"The latest GitHub MCP server release reports no tag. See "
            f"{GITHUB_MCP_RELEASES_PAGE}"
        )

    assets = {
        asset["name"]: asset["browser_download_url"]
        for asset in payload.get("assets", [])
        if isinstance(asset, dict)
        and isinstance(asset.get("name"), str)
        and isinstance(asset.get("browser_download_url"), str)
    }

    if not assets:
        raise SetupError(
            f"The latest GitHub MCP server release ({tag}) publishes no assets. See "
            f"{GITHUB_MCP_RELEASES_PAGE}"
        )

    return tag, assets


def verified_release_payload(tag: str, assets: dict[str, str], asset_name: str) -> bytes:
    """
    Downloads a release asset and checks it against the release's own checksum
    manifest before anything is written into the repository.
    """
    if asset_name not in assets:
        available = ", ".join(sorted(assets))
        raise SetupError(
            f"Release {tag} does not publish {asset_name}. It publishes: {available}."
        )

    manifests = [name for name in assets if name.endswith("checksums.txt")]

    if not manifests:
        raise SetupError(
            f"Release {tag} publishes no checksum manifest, so {asset_name} cannot be "
            "verified before installation."
        )

    checksums = parse_release_checksums(
        fetch_url(assets[manifests[0]]).decode("utf-8")
    )
    expected = checksums.get(asset_name)

    if expected is None:
        raise SetupError(
            f"{manifests[0]} in release {tag} lists no digest for {asset_name}."
        )

    print(f"  Downloading {asset_name}")
    payload = fetch_url(assets[asset_name])
    actual = hashlib.sha256(payload).hexdigest()

    if actual != expected:
        raise SetupError(
            f"Checksum mismatch for {asset_name} in release {tag}.\n"
            f"Expected: {expected}\n"
            f"Actual:   {actual}"
        )

    return payload


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)

    return digest.hexdigest()


def read_install_state(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}

    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        # A damaged record only costs one redundant download.
        return {}

    return state if isinstance(state, dict) else {}


def install_release_binary(staged: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)

    try:
        shutil.copy2(staged, target)
    except PermissionError as exc:
        raise SetupError(
            f"Could not replace {target} because it is in use. Windows keeps a "
            "running executable locked, so close the agents currently connected to "
            "the GitHub MCP server (Claude Code, Codex, Antigravity) and rerun."
        ) from exc

    target.chmod(target.stat().st_mode | 0o111)


def verify_github_mcp_command(repo: Path, command: str) -> str:
    """
    Runs the installed server once, from the repository root, to prove the
    downloaded build actually executes on this machine.

    The configured `command` is resolved against the repository here rather than
    passed through verbatim: Windows resolves a relative executable against the
    calling process's current directory instead of the child's, so a verbatim
    relative invocation would test the shape of this script's own working
    directory rather than the install.
    """
    executable = (repo / command).resolve()

    result = subprocess.run(
        [str(executable), "--version"],
        cwd=str(repo),
        check=False,
        text=True,
        capture_output=True,
    )

    if result.returncode != 0:
        raise SetupError(
            f"The installed GitHub MCP server did not run: {executable}\n"
            f"Exit status: {result.returncode}\n"
            f"{result.stderr.strip() or result.stdout.strip()}"
        )

    # `--version` reports the name, version, commit and build date on separate
    # lines; the first two identify the build without flooding the log.
    reported = (result.stdout or result.stderr).strip().splitlines()

    return " ".join(line.strip() for line in reported[:2]) or "(reported no version)"


def ensure_github_mcp_server(repo: Path) -> tuple[Path, list[Path]]:
    """
    Installs the current GitHub MCP server release into the repository and points
    every supported agent host at it.

    Rerunning converges: the release is re-resolved every time, but the download
    is skipped while the recorded tag still matches and the installed executable
    still hashes to what was recorded for it.
    """
    print("\n== Repository-local GitHub MCP server ==")

    system = platform.system()
    machine = platform.machine()

    asset_name = github_mcp_asset_name(system, machine)
    binary_name = github_mcp_binary_name(system)

    binary = repo / GITHUB_MCP_BIN_DIR / binary_name
    state_path = repo / GITHUB_MCP_STATE_PATH

    tag, assets = resolve_latest_github_mcp_release()
    print(f"Latest release: {tag} ({system}/{machine} -> {asset_name})")

    state = read_install_state(state_path)
    current = (
        state.get("tag") == tag
        and state.get("asset") == asset_name
        and binary.exists()
        and isinstance(state.get("sha256"), str)
        and file_sha256(binary) == state["sha256"]
    )

    if current:
        print(f"  Already installed: {binary}")
    else:
        payload = verified_release_payload(tag, assets, asset_name)

        with tempfile.TemporaryDirectory(prefix="github-mcp-server-") as scratch:
            archive = Path(scratch) / asset_name
            archive.write_bytes(payload)

            staged = Path(scratch) / binary_name
            extract_release_binary(archive, binary_name, staged)
            install_release_binary(staged, binary)

        write_host_config_file(
            state_path,
            json.dumps(
                {
                    "tag": tag,
                    "asset": asset_name,
                    "sha256": file_sha256(binary),
                    "binary": GITHUB_MCP_BIN_DIR.joinpath(binary_name).as_posix(),
                },
                indent=2,
            )
            + "\n",
        )
        print(f"  Installed: {binary}")

    command = GITHUB_MCP_BIN_DIR.joinpath(binary_name).as_posix()
    written = write_mcp_host_configs(repo, command)

    print(f"  Verified:  {verify_github_mcp_command(repo, command)}")

    for path in written:
        print(f"  Configured {path.relative_to(repo).as_posix()} -> {command}")

    if os.environ.get(GITHUB_MCP_TOKEN_VARIABLE, "").strip():
        print(
            f"\n  NOTE: {GITHUB_MCP_TOKEN_VARIABLE} is set in this environment.\n"
            "        The server uses a token whenever one is present, so an agent\n"
            "        that inherits this variable will skip the OAuth flow. Unset it\n"
            "        to authenticate through OAuth instead."
        )
    else:
        print("  Auth:      browser-based OAuth on first use; no token is stored")

    return binary, written


# ===========================================================================
# End of the GitHub MCP server section
# ===========================================================================


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
    github_mcp_server: Path,
    mcp_host_configs: Iterable[Path],
) -> None:
    checks = {
        "skills-ref executable": skills_ref,
        "Tessl executable": tessl,
        "Plugin Eval script": plugin_root / "scripts" / "plugin-eval.js",
        "Plugin Eval manifest": plugin_root / ".codex-plugin" / "plugin.json",
        "Plugin Eval marketplace": (
            repo / ".agents" / "plugins" / "marketplace.json"
        ),
        "GitHub MCP server executable": github_mcp_server,
        **{
            f"MCP configuration ({path.relative_to(repo).as_posix()})": path
            for path in mcp_host_configs
        },
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

        github_mcp_server, mcp_host_configs = ensure_github_mcp_server(repo)

        verify_agent_skills(repo)
        verify_local_tooling(
            repo,
            skills_ref=skills_ref,
            tessl=tessl,
            plugin_root=plugin_root,
            bin_dir=bin_dir,
            github_mcp_server=github_mcp_server,
            mcp_host_configs=mcp_host_configs,
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
        print(f"  GitHub MCP server:  {github_mcp_server}")

        print("\nMCP configuration (repository-local, one file per host):")
        for path in mcp_host_configs:
            print(f"  {path.relative_to(repo).as_posix()}")
        print(
            "  No credential is configured: the server authenticates through its "
            "own\n  browser-based OAuth flow on first use and stores no token."
        )

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
            "Generated tooling is excluded by the repository's committed "
            ".gitignore, not a\ndeveloper-specific .git/info/exclude. The three "
            "MCP configuration files above are\nthe exception: they are tracked, "
            "so review their diff before committing."
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
