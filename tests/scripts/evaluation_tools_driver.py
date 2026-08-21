#!/usr/bin/env python3
"""Test driver for isolated set_up_evaluation_tools.py behaviors."""

from __future__ import annotations

import importlib.util
import io
import json
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
TARGET = REPO_ROOT / "scripts" / "set_up_evaluation_tools.py"
SCRIPTS_DIR = TARGET.parent


def load_target() -> Any:
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))

    spec = importlib.util.spec_from_file_location("evaluation_tools_under_test", TARGET)

    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module under test: {TARGET}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return module


def exercise_virtual_environment(module: Any, state: str) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as scratch:
        repo = Path(scratch).resolve()
        venv = repo / ".venv"
        python = module.venv_python(venv)
        stale_marker = venv / "stale-marker.txt"
        calls: list[list[str]] = []
        created = False

        if state in {"healthy", "broken", "probe-error"}:
            python.parent.mkdir(parents=True)
            python.touch()
            stale_marker.write_text("old environment", encoding="ascii")

        if state == "linked-missing":
            venv.mkdir()
            module.path_is_link_or_junction = lambda path: path == venv

        def fake_run(
            args: Any,
            *,
            cwd: Path | None = None,
            capture: bool = False,
            check: bool = True,
            env: dict[str, str] | None = None,
        ) -> subprocess.CompletedProcess[str]:
            del cwd, capture, check, env
            nonlocal created
            command = [str(item) for item in args]
            calls.append(command)

            if command[1:3] == ["-m", "venv"]:
                created = True
                python.parent.mkdir(parents=True, exist_ok=True)
                python.touch()

                return subprocess.CompletedProcess(command, 0, "", "")

            if command[1:2] == ["-c"]:
                if state == "probe-error" and not created:
                    raise PermissionError("launcher access denied")

                broken = state == "broken" and not created

                return subprocess.CompletedProcess(
                    command,
                    1 if broken else 0,
                    "" if broken else "usable\n",
                    "stale base interpreter\n" if broken else "",
                )

            raise AssertionError(f"Unexpected command: {command}")

        module.run = fake_run
        with redirect_stdout(io.StringIO()):
            actual_venv, actual_python = module.ensure_virtual_environment(repo)

        return {
            "calls": [command[1:3] for command in calls],
            "python_exists": actual_python.exists(),
            "stale_marker_exists": stale_marker.exists(),
            "venv": str(actual_venv),
        }


def exercise_tessl_update(module: Any) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as scratch:
        repo = Path(scratch).resolve()
        prefix = repo / ".agent-tools" / "tessl"
        tessl = module.npm_local_bin(prefix, "tessl")
        calls: list[list[str]] = []

        module.require_command = lambda command: Path(command)

        def fake_run(
            args: Any,
            *,
            cwd: Path | None = None,
            capture: bool = False,
            check: bool = True,
            env: dict[str, str] | None = None,
        ) -> subprocess.CompletedProcess[str]:
            del capture, check, env
            command = [str(item) for item in args]
            calls.append(command)

            if command[0] == "npm":
                tessl.parent.mkdir(parents=True, exist_ok=True)
                tessl.touch()

            return subprocess.CompletedProcess(command, 0, "", "")

        module.run = fake_run
        with redirect_stdout(io.StringIO()):
            actual_tessl = module.ensure_tessl(repo)

        return {
            "calls": [
                [
                    "<tessl>" if item == str(tessl) else item,
                    *command[1:],
                ]
                for command in calls
                for item in command[:1]
            ],
            "cwd": str(repo),
            "tessl": str(actual_tessl),
        }


def main() -> int:
    request = json.loads(sys.stdin.read())

    try:
        module = load_target()
        value = (
            exercise_tessl_update(module)
            if request["state"] == "tessl-update"
            else exercise_virtual_environment(module, request["state"])
        )
    except Exception as exc:  # noqa: BLE001 - return test failures as data
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))

        return 0

    print(json.dumps({"ok": True, "value": value}))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
