#!/usr/bin/env python3
"""Explicitly acquire frozen evaluation tools; never called by verification.

Native npm dependencies are installed separately with npm ci. The existing
current-tracking authoring bootstrap is independent of this installer.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from _commands import SetupError, require_python_version


def assert_plain_path(path: Path) -> None:
    for component in (path, *path.parents):
        if component.is_symlink() or getattr(component, "is_junction", lambda: False)():
            raise SetupError(f"Redirected installation path: {component}")


def archive_files(data: bytes, name: str) -> dict[str, bytes]:
    """Read regular files without extracting archive-controlled paths."""
    files = {}
    if name.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for member in archive.infolist():
                if member.is_dir():
                    continue
                if stat.S_ISLNK(member.external_attr >> 16):
                    raise SetupError("Archive contains a symbolic link")
                if member.filename in files:
                    raise SetupError("Archive contains duplicate members")
                files[member.filename] = archive.read(member)
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            for member in archive.getmembers():
                if member.isdir():
                    continue
                if not member.isfile() or member.name in files:
                    raise SetupError("Archive contains a special or duplicate member")
                files[member.name] = archive.extractfile(member).read()
    for name in files:
        if Path(name).name != name or name in (".", "..") or "/" in name or "\\" in name:
            raise SetupError(f"Unexpected archive member: {name}")
    return files


def main(context: dict) -> None:
    require_python_version()
    root = Path(__file__).resolve().parent.parent
    manifest_bytes = (root / "evaluation-toolchain.json").read_bytes()
    context["toolchainSha256"] = hashlib.sha256(manifest_bytes).hexdigest()
    manifest = json.loads(manifest_bytes)
    if manifest.get("schemaVersion") != 1:
        raise SetupError("Unsupported evaluation toolchain schema")
    machine = platform.machine().lower()
    arch = "x64" if machine in ("amd64", "x86_64") else machine
    system = "win32" if os.name == "nt" else platform.system().lower()
    key = f"{system}-{arch}"
    context["platform"] = key
    tool = manifest["skillUp"]
    selected = tool["platforms"].get(key)
    if selected is None:
        raise SetupError(f"No reviewed tool identity for {key}")
    parent = root / ".agent-tools" / "evaluation"
    destination = parent / f"skill-up-{tool['version']}-{key}"
    assert_plain_path(destination)
    if destination.exists():
        raise SetupError(f"Installation already exists; preserved without replacement: {destination}")
    url = f"https://github.com/alibaba/skill-up/releases/download/v{tool['version']}/{selected['archive']}"
    context.update(stage="download", url=url, expectedByteLength=selected["byteLength"],
                   expectedSha256=selected["sha256"])
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(selected["byteLength"] + 1)
    context.update(observedByteLength=len(data), observedSha256=hashlib.sha256(data).hexdigest())
    if len(data) != selected["byteLength"] or hashlib.sha256(data).hexdigest() != selected["sha256"]:
        raise SetupError("Downloaded archive does not match reviewed length/SHA-256")
    files = archive_files(data, selected["archive"])
    context["stage"] = "archive-validation"
    if selected["executable"] not in files or "LICENSE" not in files:
        raise SetupError("Archive lacks executable or license")
    if "installation.json" in files:
        raise SetupError("Archive conflicts with installation receipt")
    if hashlib.sha256(files[selected["executable"]]).hexdigest() != selected["executableSha256"]:
        raise SetupError("Executable differs from reviewed identity")
    if hashlib.sha256(files["LICENSE"]).hexdigest() != selected["licenseSha256"]:
        raise SetupError("License differs from reviewed identity")
    parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".skill-up-", dir=parent))
    try:
        for name, content in files.items():
            (staging / name).write_bytes(content)
        executable = staging / selected["executable"]
        executable.chmod(0o755)
        # Version observation has no provider inputs or inherited user config.
        clean_home = Path(tempfile.mkdtemp(prefix=".observation-", dir=parent))
        env = {k: os.environ[k] for k in ("SystemRoot", "WINDIR", "COMSPEC") if k in os.environ}
        env.update(HOME=str(clean_home), USERPROFILE=str(clean_home),
                   XDG_CONFIG_HOME=str(clean_home), APPDATA=str(clean_home),
                   LOCALAPPDATA=str(clean_home), TEMP=str(clean_home), TMP=str(clean_home),
                   TMPDIR=str(clean_home), OTEL_SDK_DISABLED="true", DO_NOT_TRACK="1", CI="1")
        try:
            context["stage"] = "version-observation"
            observed = subprocess.run([str(executable), "--version"], cwd=clean_home,
                                      env=env, capture_output=True, text=True, timeout=15, check=True)
        finally:
            assert_plain_path(clean_home)
            shutil.rmtree(clean_home)
        version_output = observed.stdout.strip()
        context["versionOutput"] = version_output
        if version_output != f"skill-up version {tool['version']}":
            raise SetupError(f"Unexpected executable version: {version_output}")
        receipt = {"schemaVersion": 1, "platform": key,
                   "toolchainSha256": hashlib.sha256(manifest_bytes).hexdigest(),
                   "archiveSha256": selected["sha256"],
                   "executableSha256": hashlib.sha256(files[selected["executable"]]).hexdigest(),
                   "versionOutput": version_output,
                   "files": {name: hashlib.sha256(content).hexdigest() for name, content in sorted(files.items())}}
        (staging / "installation.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        # Reserve the destination exclusively; concurrent installers cannot replace it.
        destination.mkdir()
        context["stage"] = "installation-publication"
        for item in staging.iterdir():
            item.rename(destination / item.name)
        staging.rmdir()
        print(json.dumps({"installed": str(destination), **receipt}, indent=2))
    finally:
        if staging.exists():
            assert_plain_path(staging)
            shutil.rmtree(staging)


if __name__ == "__main__":
    context = {"schemaVersion": 1, "stage": "manifest-preflight"}
    try:
        main(context)
    except Exception as error:
        if sys.version_info < (3, 12):
            # Do not write failure evidence where junction inspection is unavailable.
            raise
        failure_root = Path(__file__).resolve().parent.parent / ".agent-tools" / "evaluation" / "acquisition-failures"
        assert_plain_path(failure_root)
        failure_root.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", prefix="failure-", suffix=".json",
                                         dir=failure_root, encoding="utf-8", delete=False) as record:
            json.dump({**context, "status": "failed", "errorType": type(error).__name__,
                       "message": str(error), "stdout": str(getattr(error, "stdout", ""))[:4096],
                       "stderr": str(getattr(error, "stderr", ""))[:4096]}, record, indent=2)
            print(f"Acquisition failure retained: {record.name}", file=sys.stderr)
        raise
