"""Acquire native remote skill output at one independently verified Git revision.

The currently qualified source family is GitHub repository shorthand/HTTPS.
Native Skills still owns discovery, selection and lock generation. This adapter
rejects unknown native contracts and never uses a candidate lock path as a live
destination. All working files belong to ``workspace``; normal npm caches remain
normal developer-tool state. No global Git/npm/agent settings are changed.
"""

import json
import os
import re
import shutil
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

from .agent_targets import AGENT_ROOTS
from .errors import ReconciliationError
from .filesystem import copy_tree, validate_tree
from .processes import run_command
from .shared_resources import normalize_shared_resources

_NAME = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
_PART = re.compile(r"[A-Za-z0-9_.-]+\Z")
_COMMIT = re.compile(r"[a-fA-F0-9]{40}\Z")
_HASH = re.compile(r"[a-f0-9]{64}\Z")
_VERSION = re.compile(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\Z")
_NATIVE_AGENT_NAMES = {
    "codex": "Codex",
    "antigravity": "Antigravity",
    "claude-code": "Claude Code",
}
_NATIVE_OMITTED_DIRECTORIES = {".git", "__pycache__", "__pypackages__"}

# Independent source hash oracle using the native runtime's path collation.
# This is a native *source* hash, never a normalized-output digest. Source tree
# links are rejected separately before this program is allowed to read it.
_SOURCE_HASH_PROGRAM = r"""
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.argv[1];
const files = [];
function collect(directory, prefix) {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== '.git' && entry.name !== 'node_modules')
        collect(path.join(directory, entry.name), relative);
    } else if (entry.isFile()) files.push(relative);
    else throw new Error('Non-regular source entry: ' + relative);
  }
}
collect(root, '');
files.sort((left, right) => left.localeCompare(right));
const hash = crypto.createHash('sha256');
for (const relative of files) {
  hash.update(relative);
  hash.update(fs.readFileSync(path.join(root, ...relative.split('/'))));
}
process.stdout.write(hash.digest('hex'));
"""


def _invalid(message, code="invalid-remote-source"):
    return ReconciliationError(
        message, code=code, exit_status=2 if code == "invalid-remote-source" else 1
    )


def source_selection(source: str, ref: str | None = None) -> tuple[str, str | None]:
    """Return canonical HTTPS GitHub URL/requested ref without invoking any tool.

    Full GitHub tree URLs, npm packs, SSH, generic Git providers and embedded
    skill selectors are deliberately unsupported until their contracts are
    qualified. No URL is guessed from a malformed or unfamiliar source.
    """
    if (
        not isinstance(source, str)
        or not source
        or any(ord(char) < 33 for char in source)
    ):
        raise _invalid("Remote source must be a nonempty supported GitHub source")
    base, separator, embedded = source.partition("#")
    if separator:
        if not embedded or ref is not None or "#" in embedded:
            raise _invalid("Embedded and explicit refs must not conflict or be empty")
        try:
            ref = unquote(embedded, errors="strict")
        except UnicodeDecodeError as error:
            raise _invalid("Embedded Git ref is not valid UTF-8") from error
    if base.startswith("https://"):
        parsed = urlsplit(base)
        if parsed.netloc.lower() != "github.com" or parsed.query or parsed.fragment:
            raise _invalid(
                "Only canonical GitHub HTTPS repository sources are supported"
            )
        parts = parsed.path.strip("/").split("/")
    else:
        parts = base.split("/")
    if len(parts) != 2 or any(
        not _PART.fullmatch(part) or part in (".", "..") for part in parts
    ):
        raise _invalid("Source must identify exactly one GitHub owner/repository")
    owner, repository = parts
    if repository.endswith(".git"):
        repository = repository[:-4]
    if not repository or repository in (".", ".."):
        raise _invalid("GitHub repository name is empty or unsafe")
    if ref is not None:
        if (
            not isinstance(ref, str)
            or not ref
            or ref == "@"
            or ref.startswith(("-", "/"))
            or ref.endswith(("/", "."))
        ):
            raise _invalid("Git ref is empty or unsafe")
        if any(
            ord(char) < 33 or ord(char) == 127 or char in "~^:?*[\\" for char in ref
        ) or any(value in ref for value in ("..", "@{", "//")):
            raise _invalid("Git ref contains unsupported syntax")
        if any(
            part.startswith(".") or part.endswith(".lock") for part in ref.split("/")
        ):
            raise _invalid("Git ref contains an invalid path component")
    return f"https://github.com/{owner}/{repository}.git", ref


def _json(value, description):
    def unique(pairs):
        result = {}
        for key, item in pairs:
            if key in result:
                raise ValueError("duplicate object key")
            result[key] = item
        return result

    def invalid_constant(value):
        raise ValueError("non-JSON constant")

    try:
        return json.loads(
            value, object_pairs_hook=unique, parse_constant=invalid_constant
        )
    except (ValueError, TypeError) as error:
        raise _invalid(
            f"Invalid JSON from {description}", "invalid-native-result"
        ) from error


def _environment(workspace):
    environment = dict(os.environ)
    for key in list(environment):
        if key.startswith("GIT_"):
            del environment[key]
    hooks = workspace / "empty-hooks"
    temporary = workspace / "temporary"
    hooks.mkdir()
    temporary.mkdir()
    environment.update(
        GIT_CONFIG_NOSYSTEM="1",
        GIT_CONFIG_GLOBAL=os.devnull,
        GIT_TERMINAL_PROMPT="0",
        DISABLE_TELEMETRY="1",
        DO_NOT_TRACK="1",
        TEMP=str(temporary),
        TMP=str(temporary),
        TMPDIR=str(temporary),
    )
    settings = [
        ("core.autocrlf", "false"),
        ("core.eol", "lf"),
        ("core.longpaths", "true"),
        ("core.hooksPath", str(hooks)),
        ("core.fsmonitor", "false"),
        ("credential.helper", ""),
        ("protocol.ext.allow", "never"),
        ("protocol.file.allow", "never"),
        ("submodule.recurse", "false"),
    ]
    environment["GIT_CONFIG_COUNT"] = str(len(settings))
    for index, (key, value) in enumerate(settings):
        environment[f"GIT_CONFIG_KEY_{index}"] = key
        environment[f"GIT_CONFIG_VALUE_{index}"] = value
    return environment


def _qualified_npm_cli(value):
    """Recognize npm's public entry point from its installed package metadata."""
    if not value:
        return None
    candidate = Path(value)
    if (
        not candidate.is_absolute()
        or candidate.name != "npm-cli.js"
        or candidate.parent.name != "bin"
    ):
        return None
    package = candidate.parent.parent
    try:
        with (package / "package.json").open("rb") as stream:
            raw = stream.read(65537)
        if len(raw) > 65536:
            return None
        manifest = _json(raw, "installed npm package")
        if not isinstance(manifest, dict) or manifest.get("name") != "npm":
            return None
        binary = manifest.get("bin")
        entry = binary.get("npm") if isinstance(binary, dict) else binary
        if not isinstance(entry, str) or Path(entry).is_absolute():
            return None
        if candidate.is_file() and (package / entry).resolve(
            strict=True
        ) == candidate.resolve(strict=True):
            return candidate
    except (OSError, ValueError, ReconciliationError):
        pass
    return None


def _npm_arguments():
    if os.name != "nt":
        return ["npm"]
    node = shutil.which("node")
    if not node or Path(node).suffix.lower() != ".exe":
        raise ReconciliationError(
            "Native Node.js is required for remote acquisition", "missing-tool", 2
        )
    # npm supplies this exact public script to its lifecycle children. PATH may
    # put a command-protection wrapper ahead of the actual npm installation.
    selected = _qualified_npm_cli(os.environ.get("npm_execpath"))
    if selected is not None:
        return ["node", str(selected)]
    executable = shutil.which("npm")
    candidates = []
    if executable:
        launcher = Path(executable)
        if launcher.suffix.lower() not in (".cmd", ".bat", ".ps1"):
            return [str(launcher)]
        candidates.append(
            launcher.parent / "node_modules" / "npm" / "bin" / "npm-cli.js"
        )
    candidates.append(
        Path(node).resolve().parent / "node_modules" / "npm" / "bin" / "npm-cli.js"
    )
    for candidate in candidates:
        selected = _qualified_npm_cli(candidate)
        if selected is not None:
            return ["node", str(selected)]
    raise ReconciliationError(
        "Cannot locate the installed public npm CLI from npm or Node.js",
        "missing-tool",
        2,
    )


def _install_cli(workspace, environment):
    npm = _npm_arguments()
    metadata = _json(
        run_command([*npm, "view", "skills@latest", "--json"], workspace, environment),
        "npm registry metadata",
    )
    # npm releases differ on whether a single selected manifest is wrapped in
    # an array. Both forms must still identify exactly one resolved version.
    if isinstance(metadata, list) and len(metadata) == 1:
        metadata = metadata[0]
    if (
        not isinstance(metadata, dict)
        or metadata.get("name") != "skills"
        or not isinstance(metadata.get("version"), str)
        or not _VERSION.fullmatch(metadata["version"])
    ):
        raise _invalid(
            "Registry did not resolve one exact skills version", "invalid-native-result"
        )
    distribution = metadata.get("dist")
    integrity = (
        distribution.get("integrity") if isinstance(distribution, dict) else None
    )
    if not isinstance(integrity, str) or not integrity.startswith("sha512-"):
        raise _invalid(
            "Resolved skills metadata lacks SHA-512 package integrity",
            "invalid-native-result",
        )
    version = metadata["version"]
    prefix = workspace / "tool"
    prefix.mkdir()
    run_command(
        [
            *npm,
            "install",
            "--prefix",
            str(prefix),
            "--no-save",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--package-lock=false",
            f"skills@{version}",
        ],
        workspace,
        environment,
    )
    package = prefix / "node_modules" / "skills"
    try:
        validate_tree(package)
        installed = _json(
            package.joinpath("package.json").read_text(encoding="utf-8"),
            "installed skills package",
        )
    except OSError as error:
        raise _invalid(
            "npm did not produce the resolved skills package", "invalid-native-result"
        ) from error
    if (
        not isinstance(installed, dict)
        or installed.get("name") != "skills"
        or installed.get("version") != version
    ):
        raise _invalid(
            "Installed skills package differs from the resolved version",
            "invalid-native-result",
        )
    binary = installed.get("bin")
    relative = binary.get("skills") if isinstance(binary, dict) else binary
    entry = _relative_path(relative, expected_filename=None)
    executable = package.joinpath(*entry.parts)
    if not executable.is_file():
        raise _invalid(
            "Resolved skills public executable is absent", "invalid-native-result"
        )
    return executable, {
        "requested": "skills@latest",
        "version": version,
        "registryIntegrity": integrity,
    }


def _relative_path(value, expected_filename="SKILL.md"):
    if (
        not isinstance(value, str)
        or not value
        or "\\" in value
        or ":" in value
        or "\x00" in value
    ):
        raise _invalid("Native source path is invalid", "invalid-native-result")
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or any(part in ("..", ".git") for part in path.parts)
        or (expected_filename and path.name != expected_filename)
    ):
        raise _invalid(
            "Native source path escapes or does not identify SKILL.md",
            "invalid-native-result",
        )
    return path


def _resolve_commit(remote, ref, cwd, environment):
    if ref and _COMMIT.fullmatch(ref):
        return ref.lower()
    selectors = (
        ["HEAD"]
        if ref in (None, "HEAD")
        else (
            [ref, ref + "^{}"]
            if ref.startswith("refs/")
            else [f"refs/heads/{ref}", f"refs/tags/{ref}", f"refs/tags/{ref}^{{}}"]
        )
    )
    output = run_command(
        ["git", "ls-remote", "--symref", remote, *selectors], cwd, environment
    )
    advertised = {}
    for line in output.splitlines():
        fields = line.split("\t", 1)
        if len(fields) == 2 and _COMMIT.fullmatch(fields[0]) and fields[1] in selectors:
            advertised[fields[1]] = fields[0].lower()
    if ref in (None, "HEAD"):
        chosen = advertised.get("HEAD")
    elif ref.startswith("refs/"):
        chosen = advertised.get(ref + "^{}") or advertised.get(ref)
    else:
        branch = advertised.get(f"refs/heads/{ref}")
        tag = advertised.get(f"refs/tags/{ref}^{{}}") or advertised.get(
            f"refs/tags/{ref}"
        )
        if branch and tag and branch != tag:
            raise _invalid(
                "Git selector is ambiguous between a branch and tag; qualify it with refs/heads or refs/tags"
            )
        chosen = branch or tag
    if not chosen:
        raise _invalid("Requested Git ref did not resolve to one advertised commit")
    return chosen


def _fetch_snapshot(group, remote, commit, environment):
    snapshot = group / "snapshot"
    run_command(
        [
            "git",
            "init",
            "--quiet",
            "--template=" + str(group.parent / "empty-hooks"),
            str(snapshot),
        ],
        group,
        environment,
    )
    run_command(
        [
            "git",
            "fetch",
            "--quiet",
            "--no-tags",
            "--depth=1",
            "--filter=blob:none",
            remote,
            commit,
        ],
        snapshot,
        environment,
    )
    actual = run_command(
        ["git", "rev-parse", "FETCH_HEAD^{commit}"], snapshot, environment
    ).strip()
    if actual.lower() != commit:
        raise _invalid(
            "Fetched source is not the resolved commit", "source-revision-mismatch"
        )
    listing = run_command(
        ["git", "ls-tree", "-r", "-z", "--full-tree", commit], snapshot, environment
    )
    tree = {}
    for record in listing.split("\x00"):
        if not record:
            continue
        header, separator, name = record.partition("\t")
        fields = header.split()
        if not separator or len(fields) != 3:
            raise _invalid("Invalid Git tree output", "invalid-native-result")
        path = _relative_path(name, expected_filename=None)
        tree[path] = fields[0]
    return snapshot, tree


def _checkout_snapshot(snapshot, tree, paths, commit, environment):
    directories = {path.parent for path in paths}
    for path in tree:
        if "_shared" in path.parts:
            directories.add(
                PurePosixPath(*path.parts[: path.parts.index("_shared") + 1])
            )
    for path, mode in tree.items():
        if any(
            path == directory or directory in path.parents for directory in directories
        ) and mode not in ("100644", "100755"):
            raise _invalid(
                "Selected source tree contains a symbolic link or submodule",
                "unsafe-source",
            )
    if any(path not in tree for path in paths):
        raise _invalid(
            "Native skill path is absent from the resolved commit",
            "source-revision-mismatch",
        )
    run_command(
        [
            "git",
            "sparse-checkout",
            "set",
            "--cone",
            "--",
            *sorted(path.as_posix() for path in directories),
        ],
        snapshot,
        environment,
    )
    run_command(
        ["git", "checkout", "--quiet", "--detach", commit], snapshot, environment
    )


def _installed_inventory(directory, *, source=False):
    result = {}
    for path in directory.rglob("*"):
        relative = path.relative_to(directory)
        if source and (
            any(part in _NATIVE_OMITTED_DIRECTORIES for part in relative.parts[:-1])
            or path.name == "metadata.json"
        ):
            continue
        if path.is_file():
            result[relative.as_posix()] = path.read_bytes()
    return result


def acquire_remote_skills(
    repository: Path,
    workspace: Path,
    declarations: dict[str, dict],
    agents: tuple[str, ...],
) -> tuple[dict[str, Path], dict[str, dict], dict]:
    """Return normalized private skill directories, native entries and identities.

    No live repository output or lock is touched. Nonempty workspace destinations
    are never cleared or reused. Errors use ReconciliationError; incompatible
    successful native output is an error, not an empty or partial success.
    """
    if not declarations:
        return {}, {}, {"installer": None, "sources": []}
    if not agents or any(agent not in AGENT_ROOTS for agent in agents):
        raise _invalid("Explicit supported agent targets are required")
    groups = {}
    for name, declaration in declarations.items():
        if not isinstance(name, str) or len(name) > 64 or not _NAME.fullmatch(name):
            raise _invalid("Unsafe or unsupported skill name")
        key = source_selection(declaration.get("source"), declaration.get("ref"))
        groups.setdefault(key, []).append(name)
    workspace = workspace.absolute()
    if workspace == repository.absolute() or (
        workspace.exists() and any(workspace.iterdir())
    ):
        raise _invalid("Remote acquisition requires a separate fresh workspace")
    workspace.mkdir(parents=True, exist_ok=True)
    validate_tree(workspace)
    environment = _environment(workspace)
    executable, installer = _install_cli(workspace, environment)
    acquired = workspace / "acquired"
    acquired.mkdir()
    directories, entries = {}, {}
    identities = {"installer": installer, "sources": []}
    for index, ((remote, requested_ref), names) in enumerate(groups.items()):
        group = workspace / f"source-{index:04d}"
        group.mkdir()
        native = group / "native"
        native.mkdir()
        commit = _resolve_commit(remote, requested_ref, group, environment)
        snapshot, tree = _fetch_snapshot(group, remote, commit, environment)
        owner_repo = urlsplit(remote).path.strip("/")[:-4]
        report = _json(
            run_command(
                [
                    "node",
                    str(executable),
                    "add",
                    owner_repo + "#" + commit,
                    "--skill",
                    *names,
                    "--agent",
                    *agents,
                    "--yes",
                    "--copy",
                    "--full-depth",
                    "--json",
                ],
                native,
                environment,
            ),
            "skills add",
        )
        try:
            validate_tree(native)
            lock = _json(
                native.joinpath("skills-lock.json").read_text(encoding="utf-8"),
                "native project lock",
            )
        except OSError as error:
            raise _invalid(
                "Native acquisition returned without a readable project lock",
                "invalid-native-result",
            ) from error
        if (
            not isinstance(lock, dict)
            or lock.get("version") != 1
            or set(lock) != {"version", "skills"}
            or not isinstance(lock.get("skills"), dict)
            or set(lock["skills"]) != set(names)
        ):
            raise _invalid(
                "Native project lock is incomplete or uses an unsupported format",
                "invalid-native-result",
            )
        if (
            not isinstance(report, list)
            or len(report) != len(names)
            or not all(
                isinstance(item, dict) and isinstance(item.get("name"), str)
                for item in report
            )
            or {item["name"] for item in report} != set(names)
        ):
            raise _invalid(
                "Native acquisition did not report every selected skill",
                "invalid-native-result",
            )
        reports = {item["name"]: item for item in report}
        paths = {}
        for name in names:
            entry = lock["skills"][name]
            if (
                not isinstance(entry, dict)
                or entry.get("sourceType") != "github"
                or not isinstance(entry.get("source"), str)
                or entry["source"].lower() != owner_repo.lower()
                or entry.get("ref") != commit
                or not isinstance(entry.get("computedHash"), str)
                or not _HASH.fullmatch(entry["computedHash"])
            ):
                raise _invalid(
                    "Native source identity, pinned ref or hash does not match acquisition",
                    "invalid-native-result",
                )
            if (
                entry.get("sourceUrl")
                and source_selection(entry["sourceUrl"])[0] != remote
            ):
                raise _invalid(
                    "Native source URL differs from acquisition",
                    "invalid-native-result",
                )
            result = reports[name]
            result_agents = result.get("agents")
            if (
                result.get("status") != "installed"
                or result.get("scope") != "project"
                or result.get("mode") != "copy"
                or result.get("source") != entry["source"]
                or result.get("ref") != commit
                or not isinstance(result_agents, list)
                or not all(isinstance(agent, str) for agent in result_agents)
                or set(result_agents)
                != {_NATIVE_AGENT_NAMES[agent] for agent in agents}
                or result.get("hash") != entry["computedHash"]
            ):
                raise _invalid(
                    "Native acquisition contains partial, global or inconsistent output",
                    "invalid-native-result",
                )
            paths[name] = _relative_path(entry.get("skillPath"))
        _checkout_snapshot(snapshot, tree, paths.values(), commit, environment)
        transforms = {}
        for name in names:
            source_skill = snapshot.joinpath(*paths[name].parent.parts)
            validate_tree(source_skill)
            checksum = run_command(
                ["node", "--eval", _SOURCE_HASH_PROGRAM, str(source_skill)],
                group,
                environment,
            ).strip()
            if checksum != lock["skills"][name]["computedHash"]:
                raise _invalid(
                    "Native content hash does not match the resolved source commit",
                    "source-revision-mismatch",
                )
            expected = _installed_inventory(source_skill, source=True)
            outputs = [
                native / base / name
                for base in dict.fromkeys(AGENT_ROOTS[agent] for agent in agents)
            ]
            for output in outputs:
                if not output.is_dir() or _installed_inventory(output) != expected:
                    raise _invalid(
                        "Native skill bytes differ from the resolved source commit",
                        "source-revision-mismatch",
                    )
            destination = acquired / name
            copy_tree(outputs[0], destination)
            transforms[name] = normalize_shared_resources(
                destination, source_skill, snapshot
            )
            directories[name] = destination
            entry = dict(lock["skills"][name])
            if requested_ref is None:
                entry.pop("ref", None)
            else:
                entry["ref"] = requested_ref
            entries[name] = entry
        identities["sources"].append(
            {
                "source": remote,
                "requestedRef": requested_ref,
                "resolvedCommit": commit,
                "skills": names,
                "snapshot": snapshot.relative_to(workspace).as_posix(),
                "transformations": transforms,
            }
        )
    return directories, entries, identities
