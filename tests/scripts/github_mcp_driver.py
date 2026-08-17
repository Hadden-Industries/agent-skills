#!/usr/bin/env python3
"""
Test driver for the GitHub MCP server section of the repository bootstrap.

The bootstrap is a single-file script rather than an importable package, so this
driver loads it by path and calls one function per invocation. It reads a JSON
request on stdin and writes a JSON response on stdout, which keeps the assertions
themselves in `node --test` alongside the rest of the repository's suite.

Building archive fixtures belongs here rather than in the Node tests because
Python's standard library writes both ZIP and gzipped-tar archives, and the
extraction code under test reads them with the same modules.

Request:  {"call": "<name>", "args": {...}}
Response: {"ok": true, "value": ...} | {"ok": false, "error": "<message>"}
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP = REPO_ROOT / "scripts" / "set_up_skill_engineering_profile.py"


def load_bootstrap() -> Any:
    """
    Loads the bootstrap under a module name of its own.

    Executing it is safe because everything it does on import is define
    constants and functions; `main()` runs only under `__main__`.
    """
    spec = importlib.util.spec_from_file_location("bootstrap_under_test", BOOTSTRAP)

    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load bootstrap module: {BOOTSTRAP}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return module


def call_asset_name(module: Any, args: dict[str, Any]) -> Any:
    return module.github_mcp_asset_name(args["system"], args["machine"])


def call_binary_name(module: Any, args: dict[str, Any]) -> Any:
    return module.github_mcp_binary_name(args["system"])


def call_parse_checksums(module: Any, args: dict[str, Any]) -> Any:
    return module.parse_release_checksums(args["text"])


def build_archive(kind: str, entries: dict[str, str], destination: Path) -> Path:
    """Writes a fixture archive containing `entries` as name-to-text pairs."""
    if kind == "zip":
        archive = destination / "release.zip"

        with zipfile.ZipFile(archive, "w") as handle:
            for name, contents in entries.items():
                handle.writestr(name, contents)

        return archive

    archive = destination / "release.tar.gz"

    with tarfile.open(archive, "w:gz") as handle:
        for name, contents in entries.items():
            payload = contents.encode("utf-8")
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            handle.addfile(info, io.BytesIO(payload))

    return archive


def call_extract(module: Any, args: dict[str, Any]) -> Any:
    with tempfile.TemporaryDirectory() as scratch:
        base = Path(scratch)
        archive = build_archive(args["kind"], args["entries"], base)
        target = base / args["binary_name"]

        module.extract_release_binary(archive, args["binary_name"], target)

        return {
            "exists": target.exists(),
            "contents": target.read_text(encoding="utf-8") if target.exists() else None,
        }


def call_merge_json(module: Any, args: dict[str, Any]) -> Any:
    return module.merge_json_mcp_config(args["existing"], args["name"], args["entry"])


def call_merge_codex(module: Any, args: dict[str, Any]) -> Any:
    return module.merge_codex_mcp_config(
        args["existing"],
        args["name"],
        args["entry"],
    )


def call_write_host_configs(module: Any, args: dict[str, Any]) -> Any:
    repo = Path(args["repo"])
    written = module.write_mcp_host_configs(repo, args["command"])

    return {
        str(path.relative_to(repo).as_posix()): path.read_text(encoding="utf-8")
        for path in written
    }


CALLS = {
    "asset_name": call_asset_name,
    "binary_name": call_binary_name,
    "parse_checksums": call_parse_checksums,
    "extract": call_extract,
    "merge_json": call_merge_json,
    "merge_codex": call_merge_codex,
    "write_host_configs": call_write_host_configs,
}


def main() -> int:
    request = json.loads(sys.stdin.read())
    name = request["call"]

    if name not in CALLS:
        print(json.dumps({"ok": False, "error": f"Unknown call: {name}"}))

        return 2

    try:
        module = load_bootstrap()
        value = CALLS[name](module, request.get("args", {}))
    except Exception as exc:  # noqa: BLE001 - the driver reports every failure as data
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))

        return 0

    print(json.dumps({"ok": True, "value": value}))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
