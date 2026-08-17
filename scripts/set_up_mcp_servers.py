#!/usr/bin/env python3
r"""
Install repository-local MCP servers and point every supported agent host at
them.

EXPECTED LOCATION
-----------------
    <repo>/<scripts>/set_up_mcp_servers.py

`<scripts>` is whatever directory one level below the repository root holds this
file; its name is never inspected. The repository root is derived from this
script's own location, so the current working directory is irrelevant.

Rerunning this script IS the update mechanism. The latest release is re-resolved
every time, but the download is skipped while the recorded release still matches
the installed executable.

Generated state
---------------
- .agent-tools/bin/github-mcp-server[.exe]
- .agent-tools/github-mcp-server/install.json  (release/idempotency record)
- .mcp.json                                    (Claude Code)
- .codex/config.toml                           (Codex, marker-delimited block)
- .agents/mcp_config.json                      (Antigravity)

Each host configuration names the server by a repository-relative path, so it
stays correct when the clone moves. No credential is configured: on github.com
the server runs its own browser-based OAuth flow on first use and keeps the
resulting token in memory only. That flow runs only when no token is set, so the
generated configuration deliberately neither names nor forwards a personal
access token.

This script intentionally DOES NOT:
- install a server through `go install`, npm, or any global package manager
- modify user-level ~/.codex, ~/.claude, or ~/.gemini configuration
- store any GitHub credential
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

from _commands import SetupError
from _repository import derive_repo_from_script

GITHUB_MCP_RELEASES_API = (
    "https://api.github.com/repos/github/github-mcp-server/releases/latest"
)
GITHUB_MCP_RELEASES_PAGE = "https://github.com/github/github-mcp-server/releases"

GITHUB_MCP_SERVER_KEY = "github"
GITHUB_MCP_BINARY_STEM = "github-mcp-server"

# Attribution written into the Codex marker comments, derived from this file's
# own location rather than hardcoded: the directory holding the setup scripts is
# `scripts/` here but may be `util/` elsewhere, and an attribution naming the
# wrong path would send a reader looking for a file that does not exist.
MANAGED_BY = f"{Path(__file__).resolve().parent.name}/{Path(__file__).name}"

# The server authenticates through its own browser-based OAuth flow, but only
# when no token is set. This variable being present in a developer's environment
# therefore pre-empts OAuth rather than complementing it. This script never sets
# it and never writes it into a configuration file; it only reports the conflict
# when it sees one.
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

    Only the keys this script manages are overwritten. Options the developer
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
    """The marker line this script writes around the block it owns."""
    return f"# {edge} mcp_servers.{name} - managed by {MANAGED_BY}"


def codex_marker_pattern(name: str, edge: str) -> re.Pattern[str]:
    """
    Matches a marker line written by any version of this script.

    The attribution is matched loosely on purpose. It names the script that owns
    the block, so it changes whenever this file is renamed or moved — and a
    marker recognised only by its exact former text would leave the previous
    block unrecognised, which reads as a hand-written table and makes the merge
    refuse rather than update.
    """
    return re.compile(
        rf"^# {edge} mcp_servers\.{re.escape(name)} - managed by .*$",
        re.MULTILINE,
    )


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
    block = "\n".join(
        [
            codex_managed_marker(name, "BEGIN"),
            f"[mcp_servers.{name}]",
            *(f"{key} = {render_toml_value(value)}" for key, value in entry.items()),
            codex_managed_marker(name, "END"),
        ]
    )

    text = existing or ""

    begin = codex_marker_pattern(name, "BEGIN").search(text)
    end = codex_marker_pattern(name, "END").search(text)

    if begin and end and end.end() > begin.start():
        merged = f"{text[:begin.start()]}{block}{text[end.end():]}"
    else:
        # TOML forbids declaring `[mcp_servers.<name>]` twice, so appending a
        # managed block beside a hand-written one would invalidate the whole
        # Codex configuration rather than just this server.
        if re.search(rf"^\s*\[mcp_servers\.{re.escape(name)}\]", text, re.MULTILINE):
            raise SetupError(
                f"The Codex configuration already declares [mcp_servers.{name}] "
                "outside the block managed by this script. Remove that table and "
                "rerun so the managed block can own it, or rename your entry."
            )

        merged = f"{text.rstrip()}\n\n{block}\n" if text.strip() else f"{block}\n"

    if not merged.endswith("\n"):
        merged = f"{merged}\n"

    # `tomllib` is standard from Python 3.11, which this script already requires.
    # Importing it here rather than at module scope keeps the failure on an older
    # interpreter an actionable message instead of an ImportError raised before
    # `main` runs.
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
        headers={"User-Agent": f"{MANAGED_BY} (+repository bootstrap)"},
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


def verify_mcp_servers(repo: Path, binary: Path, configs: Iterable[Path]) -> None:
    print("\n== Verify repository-local MCP servers ==")

    checks = {"GitHub MCP server executable": binary}
    checks.update(
        {
            f"MCP configuration ({path.relative_to(repo).as_posix()})": path
            for path in configs
        }
    )

    missing: list[Path] = []

    for label, item in checks.items():
        if item.exists():
            print(f"  OK      {label}: {item}")
        else:
            print(f"  MISSING {label}: {item}")
            missing.append(item)

    if missing:
        raise SetupError("Repository-local MCP server verification failed.")


def parse_args() -> argparse.Namespace:
    return argparse.ArgumentParser(
        description=(
            "Install repository-local MCP servers and point every supported "
            "agent host at them."
        )
    ).parse_args()


def main() -> int:
    parse_args()

    try:
        repo = derive_repo_from_script(__file__)
        print(f"Repository root: {repo}")

        binary, configs = ensure_github_mcp_server(repo)
        verify_mcp_servers(repo, binary, configs)

        print("\nMCP server setup is complete.")

        return 0

    except (SetupError, subprocess.CalledProcessError, OSError) as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)

        return 1


if __name__ == "__main__":
    raise SystemExit(main())
