"""Build/check the independently deployable archive from source and pinned pure wheels.

Acquire dependencies with native pip --require-hashes --only-binary=:all: --no-deps
into an external build workspace first. Consumers require no pip installation.
"""

import argparse
import base64
import hashlib
from importlib.metadata import distributions
import json
from pathlib import Path, PurePosixPath
import re
import zipfile

PACKAGE = Path(__file__).resolve().parent
REPOSITORY = PACKAGE.parents[1]


def source_members():
    """The maintained package and its original distribution license are authoritative."""
    members = {path.relative_to(PACKAGE / "src").as_posix(): path.read_bytes() for path in (PACKAGE / "src").rglob("*.py")}
    members["__main__.py"] = b"from repository_skill_reconciliation.cli import main\nraise SystemExit(main())\n"
    members["LICENSE"] = (REPOSITORY / "LICENSE").read_bytes()
    members["THIRD_PARTY_NOTICES.md"] = (PACKAGE / "THIRD_PARTY_NOTICES.md").read_bytes()
    return members


def _requirements():
    return {name.lower().replace("_", "-"): (version, digest) for name, version, digest in re.findall(r"^([\w.-]+)==([^ ]+) --hash=sha256:([a-f0-9]{64})$", (PACKAGE / "requirements.lock").read_text(encoding="utf-8"), re.MULTILINE)}


def _bytecode(name):
    return "__pycache__" in PurePosixPath(name).parts or name.endswith(".pyc")


def _member_name(value):
    name = str(value)
    path = PurePosixPath(name)
    if not name or path.is_absolute() or "\\" in name or ":" in name or ".." in path.parts or path.as_posix() != name:
        raise ValueError("Dependency metadata contains an unsafe member path.")
    return name


def _dependency_members(vendor, expected):
    """Check native installed RECORD identities before bundling their actual bytes.

    RECORD detects installation drift; it is not an independent authenticity
    anchor against coordinated changes to installed code and its metadata.
    Native pip's approved hash-checked acquisition remains the trust boundary.
    """
    members = {}
    for path in vendor.rglob("*"):
        if path.is_symlink() or getattr(path.lstat(), "st_file_attributes", 0) & 0x400:
            raise ValueError("Linked dependency paths cannot be bundled.")
        if path.is_dir():
            continue
        if not path.is_file() or path.suffix.lower() in (".pyd", ".so", ".dll"):
            raise ValueError("Only ordinary pure-Python dependency files can be bundled.")
        name = _member_name(path.relative_to(vendor).as_posix())
        if not _bytecode(name):
            members[name] = path.read_bytes()
    packages = list(distributions(path=[str(vendor)]))
    installed = {item.metadata["Name"].lower().replace("_", "-"): item.version for item in packages}
    if len(packages) != len(expected) or installed != {name: version for name, (version, _) in expected.items()}:
        raise ValueError("Build vendor directory must contain exactly the three locked distributions.")
    recorded = set()
    for package in packages:
        files = package.files
        if files is None:
            raise ValueError("Installed dependency has no RECORD inventory.")
        record_files = [str(item) for item in files if item.name == "RECORD" and item.parent.name.endswith(".dist-info")]
        if len(record_files) != 1:
            raise ValueError("Installed dependency requires one RECORD file.")
        for item in files:
            name = _member_name(item)
            if _bytecode(name):
                continue
            if name in recorded or name not in members:
                raise ValueError("Dependency RECORD contains duplicate or missing members.")
            recorded.add(name)
            content = members[name]
            if item.hash is None:
                if name != record_files[0] or item.size is not None:
                    raise ValueError("Dependency RECORD lacks a required content identity.")
            else:
                if item.hash.mode not in ("sha256", "sha384", "sha512"):
                    raise ValueError("Dependency RECORD uses an unsupported content hash.")
                actual = base64.urlsafe_b64encode(hashlib.new(item.hash.mode, content).digest()).decode().rstrip("=")
                if actual != item.hash.value or item.size != len(content):
                    raise ValueError("Dependency bytes differ from installed RECORD: " + name)
    if recorded != set(members):
        raise ValueError("Vendor directory contains files outside installed RECORD inventories.")
    return members


def _source_digest(members):
    return hashlib.sha256(json.dumps({name: hashlib.sha256(value).hexdigest() for name, value in sorted(members.items())}, sort_keys=True).encode()).hexdigest()


def _directories(names):
    return {parent.as_posix() + "/" for name in names for parent in PurePosixPath(name).parents if parent != PurePosixPath(".")}


def build(output: Path, vendor: Path):
    """Create deterministic ZIP bytes with dependencies/schema/notices inside one file."""
    expected = _requirements()
    dependencies = _dependency_members(vendor, expected)
    members = source_members()
    source_digest = _source_digest(members)
    if set(dependencies) & (set(members) | {"BUILD.json"}):
        raise ValueError("Dependency/source archive member collision.")
    members.update(dependencies)
    members["BUILD.json"] = (json.dumps({"schemaVersion": 2, "sourceDigest": source_digest,
        "dependencies": {name: {"version": version, "wheelSha256": digest} for name, (version, digest) in expected.items()},
        "dependencyFiles": {name: {"sha256": hashlib.sha256(content).hexdigest(), "byteLength": len(content)} for name, content in sorted(dependencies.items())}}, sort_keys=True, indent=2) + "\n").encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        directories = _directories(members)
        for name in sorted(directories | set(members)):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (0o40755 if name.endswith("/") else 0o100644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, b"" if name.endswith("/") else members[name])


def check(output: Path):
    """Check source and measured dependency members; no signature/authenticity claim."""
    with zipfile.ZipFile(output) as archive:
        maintained = source_members()
        packaged_source = {name for name in archive.namelist() if name.startswith("repository_skill_reconciliation/") and name.endswith(".py")}
        if packaged_source != {name for name in maintained if name.startswith("repository_skill_reconciliation/")}:
            raise ValueError("Archive contains missing or obsolete maintained modules.")
        for name, expected in maintained.items():
            if archive.read(name) != expected:
                raise ValueError(f"Archive differs from maintained source: {name}")
        identity = json.loads(archive.read("BUILD.json"))
        expected = {name: {"version": version, "wheelSha256": digest} for name, (version, digest) in _requirements().items()}
        if (not isinstance(identity, dict) or identity.get("schemaVersion") != 2
                or identity.get("sourceDigest") != _source_digest(maintained) or identity.get("dependencies") != expected):
            raise ValueError("Archive dependency lock differs.")
        dependency_files = identity.get("dependencyFiles")
        if not isinstance(dependency_files, dict) or not dependency_files:
            raise ValueError("Archive has no measured dependency inventory.")
        for name, facts in dependency_files.items():
            _member_name(name)
            if name in maintained or name == "BUILD.json" or not isinstance(facts, dict):
                raise ValueError("Invalid dependency inventory member.")
        files = set(maintained) | {"BUILD.json"} | set(dependency_files)
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != files | _directories(files):
            raise ValueError("Archive member inventory differs from the build.")
        for name, facts in dependency_files.items():
            content = archive.read(name)
            if facts != {"sha256": hashlib.sha256(content).hexdigest(), "byteLength": len(content)}:
                raise ValueError("Archive dependency bytes differ from the build: " + name)


def main():
    """Build only from explicitly supplied vendor bytes, or read-only check deployment."""
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--vendor", type=Path)
    parser.add_argument("--output", type=Path, default=REPOSITORY / "tools" / "repository-skills.pyz")
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    if arguments.check:
        check(arguments.output)
    else:
        if arguments.vendor is None:
            parser.error("--vendor is required for a build")
        build(arguments.output, arguments.vendor)
        check(arguments.output)
    print(json.dumps({"archive": str(arguments.output), "sha256": hashlib.sha256(arguments.output.read_bytes()).hexdigest(), "status": "checked" if arguments.check else "built"}))


if __name__ == "__main__":
    main()
