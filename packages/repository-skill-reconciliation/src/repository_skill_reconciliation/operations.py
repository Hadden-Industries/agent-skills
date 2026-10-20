"""Construct exact candidate plans and publish/recover only their managed changes.

Publication and recovery share one writer lock. It excludes this tool's writers,
not editors; each affected path is compared again immediately before replacement.
"""

import difflib
import hashlib
import os
import re
import shutil
import stat
import uuid
from contextlib import contextmanager
from pathlib import Path

import portalocker

from . import __version__
from .configuration import (
    AGENT_ROOTS,
    SKILL_NAME,
    derive_skill_declarations,
    is_local,
    load_configuration,
    load_lock,
    read_json,
    validate_managed_destination,
)
from .errors import ReconciliationError
from .filesystem import (
    atomic_json,
    contained_path,
    copy_tree,
    fingerprint,
    validate_tree,
)
from .installation_layout import assert_installation_links, installation_layout
from .invocation_policy import project_invocation_policy, validate_skill_identity
from .processes import run_command

STATE = ".agent-tools/skill-reconciliation"
_PHASES = {
    "preparing",
    "planned",
    "applying",
    "recovery-required",
    "complete",
    "restored",
}
_CHANGE_PHASES = {"pending", "backed-up", "published", "restored"}


def _invalid_record(message):
    raise ReconciliationError(
        "Invalid operation record: " + message, "invalid-input", 2
    )


def _record_phase(record):
    phase = record.get("phase")
    if not isinstance(phase, str) or phase not in _PHASES:
        _invalid_record("unknown or missing phase.")
    return phase


def _valid_fingerprint(value):
    return (
        value is None
        or isinstance(value, str)
        and re.fullmatch(r"[0-9a-f]{64}", value) is not None
    )


def _managed_output(relative):
    return isinstance(relative, str) and (
        relative == "skills-lock.json"
        or any(
            relative.startswith(prefix + "/")
            and re.fullmatch(SKILL_NAME, relative[len(prefix) + 1 :])
            for prefix in set(AGENT_ROOTS.values())
        )
    )


def _fingerprint_map(root, value, *, managed=False):
    if not isinstance(value, dict):
        _invalid_record("expected a fingerprint mapping.")
    for relative, expected in value.items():
        if (
            not isinstance(relative, str)
            or not _valid_fingerprint(expected)
            or managed
            and not _managed_output(relative)
        ):
            _invalid_record("invalid fingerprint path or value.")
        contained_path(root, relative)
    return value


def _cli_identity():
    """Bind plans to the exact deployed archive, or complete source implementation."""
    archive = getattr(__loader__, "archive", None)
    if archive:
        return hashlib.sha256(Path(archive).read_bytes()).hexdigest()
    digest = hashlib.sha256()
    for path in sorted(Path(__file__).parent.glob("*.py")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _repository_identity(root):
    return {
        "root": str(root),
        "gitDirectory": run_command(
            ["git", "rev-parse", "--absolute-git-dir"], root
        ).strip(),
    }


def _state_directory(root):
    state = validate_managed_destination(root, STATE)
    state.mkdir(parents=True, exist_ok=True)
    contained_path(root, STATE, allow_missing=False)
    return state


@contextmanager
def _writer(root):
    """Hold the same repository lock before authoritative baseline/recovery checks."""
    state = _state_directory(root)
    lock_path = contained_path(root, STATE + "/writer.lock")
    try:
        with portalocker.Lock(str(lock_path), mode="a+b", timeout=0):
            yield state
    except portalocker.exceptions.LockException as error:
        raise ReconciliationError(
            "Another repository-skills writer is active.", "conflict", 3
        ) from error


def _run_directory(root, plan_id):
    if not re.fullmatch(r"[0-9a-f]{32}", plan_id):
        raise ReconciliationError(
            "PLAN_ID must be an emitted plan identifier, not a path.",
            "invalid-input",
            2,
        )
    return contained_path(root, f"{STATE}/runs/{plan_id}", allow_missing=False)


def _read_record(root, plan_id, *, for_apply=False):
    run = _run_directory(root, plan_id)
    record = read_json(
        contained_path(
            root, f"{STATE}/runs/{plan_id}/operation.json", allow_missing=False
        )
    )
    if (
        record.get("schemaVersion") != 1
        or record.get("planId") != plan_id
        or record.get("repository") != _repository_identity(root)
    ):
        raise ReconciliationError(
            "Plan does not belong to this repository/format.", "conflict", 3
        )
    _record_phase(record)
    assert_installation_links(root, record.get("installationLinks", {}))
    changes = record.get("changes")
    if not isinstance(changes, list):
        raise ReconciliationError("Invalid plan changes.", "invalid-input", 2)
    destinations = set()
    for index, change in enumerate(changes):
        required = {"destination", "candidate", "backup", "before", "after", "phase"}
        if not isinstance(change, dict) or not required.issubset(change):
            _invalid_record("incomplete change mapping.")
        relative = change["destination"]
        if not _managed_output(relative) or relative in destinations:
            _invalid_record("invalid/duplicate managed destination.")
        if (
            not _valid_fingerprint(change["before"])
            or not isinstance(change["after"], str)
            or not _valid_fingerprint(change["after"])
            or not isinstance(change["phase"], str)
            or change["phase"] not in _CHANGE_PHASES
        ):
            _invalid_record("invalid change fingerprint or phase.")
        destinations.add(relative)
        contained_path(root, relative)
        if (
            change.get("candidate") != "prepared/" + relative
            or change.get("backup") != f"backups/{index}"
        ):
            raise ReconciliationError(
                "Invalid candidate/backup path in plan.", "invalid-input", 2
            )
        contained_path(run, change["candidate"])
        contained_path(run, change["backup"])
    # Recovery needs only the validated restoration journal, never a current
    # config or planning-only fields from a newer implementation.
    if for_apply and record["phase"] in ("planned", "complete"):
        if not isinstance(record.get("cliDigest"), str) or not _valid_fingerprint(
            record["cliDigest"]
        ):
            _invalid_record("missing or invalid CLI identity.")
        _fingerprint_map(root, record.get("inputs"))
        baselines = _fingerprint_map(root, record.get("outputBaselines"), managed=True)
        if any(
            change["destination"] not in baselines
            or baselines[change["destination"]] != change["before"]
            for change in changes
        ):
            _invalid_record("changes differ from the saved output baseline.")
    return run, record


def _assert_fingerprint(path, expected, message):
    if fingerprint(path) != expected:
        raise ReconciliationError(message, "conflict", 3)


def _expected_outputs(record):
    """Expected final state includes selected outputs which required no change."""
    return {
        **record["outputBaselines"],
        **{change["destination"]: change["after"] for change in record["changes"]},
    }


def _active_publication(state, excluding=None):
    """A retained incomplete journal blocks another publication, never another check."""
    runs = state / "runs"
    if not runs.exists():
        return
    for child in runs.iterdir():
        if child.name == excluding:
            continue
        if (
            child.is_symlink()
            or getattr(child.lstat(), "st_file_attributes", 0) & 0x400
        ):
            raise ReconciliationError("Linked operation state.", "unsafe-path", 2)
        path = child / "operation.json"
        if path.exists():
            validate_tree(path)
            if _record_phase(read_json(path)) in ("applying", "recovery-required"):
                raise ReconciliationError(
                    f"Recover interrupted plan {child.name} before applying another.",
                    "recovery-required",
                    4,
                )


def _describe_change(root, relative, candidate):
    """Show actual byte changes, including native metadata; binaries get explicit hashes."""
    current = root / relative
    if candidate.is_file():
        files = [Path("")]
    else:
        files = sorted(
            set(p.relative_to(candidate) for p in candidate.rglob("*") if p.is_file())
            | set(p.relative_to(current) for p in current.rglob("*") if p.is_file())
        )
    rendered = [
        f"Managed path {relative}: {fingerprint(current)} -> {fingerprint(candidate)}\n"
    ]
    for file in files:
        before = current if candidate.is_file() else current / file
        after = candidate if candidate.is_file() else candidate / file
        old = before.read_bytes() if before.is_file() else b""
        new = after.read_bytes() if after.is_file() else b""
        label = relative + ("/" + file.as_posix() if file.parts else "")
        old_exists, new_exists = before.is_file(), after.is_file()
        old_executable = (
            bool(before.stat().st_mode & stat.S_IXUSR) if old_exists else None
        )
        new_executable = (
            bool(after.stat().st_mode & stat.S_IXUSR) if new_exists else None
        )
        if old_executable != new_executable:
            rendered.append(
                f"Executable permission {label}: {old_executable} -> {new_executable}\n"
            )
        if old == new:
            if old_exists != new_exists:
                rendered.append(
                    f"{'Added' if new_exists else 'Removed'} empty file: {label}\n"
                )
            continue
        try:
            if b"\0" in old or b"\0" in new:
                raise UnicodeError()
            rendered.extend(
                difflib.unified_diff(
                    old.decode("utf-8").splitlines(keepends=True),
                    new.decode("utf-8").splitlines(keepends=True),
                    fromfile="a/" + label,
                    tofile="b/" + label,
                )
            )
        except UnicodeError:
            rendered.append(
                f"Binary {label}: {hashlib.sha256(old).hexdigest()} -> {hashlib.sha256(new).hexdigest()}\n"
            )
    return "".join(rendered)


def create_plan(root, filename="repository-skills.json", *, local_only=False):
    """Stage actual candidate bytes; freeze inputs/outputs without live installation writes."""
    config_path, config = load_configuration(root, filename)
    lock = load_lock(root, allow_missing=True)
    selected = derive_skill_declarations(
        config,
        lock,
        local_only=local_only,
        configuration_filename=config_path.relative_to(root).as_posix(),
    )
    inputs = {
        config_path.relative_to(root).as_posix(): fingerprint(config_path),
        "skills-lock.json": fingerprint(root / "skills-lock.json"),
    }
    for declaration in selected.values():
        if is_local(declaration):
            relative = Path(declaration["source"]).as_posix()
            inputs[relative] = fingerprint(
                contained_path(root, relative, allow_missing=False)
            )
    roots = {AGENT_ROOTS[agent] for agent in config["targetAgents"]}
    destinations, links = installation_layout(root, roots, selected)
    baselines = {
        relative: fingerprint(validate_managed_destination(root, relative))
        for relative in sorted(set(destinations.values()))
    }
    _state_directory(root)
    plan_id = uuid.uuid4().hex
    run = contained_path(root, f"{STATE}/runs/{plan_id}")
    run.mkdir(parents=True)
    prepared = run / "prepared"
    prepared.mkdir()
    record = {
        "schemaVersion": 1,
        "planId": plan_id,
        "phase": "preparing",
        "repository": _repository_identity(root),
        "cliVersion": __version__,
        "cliDigest": _cli_identity(),
        "config": config_path.relative_to(root).as_posix(),
        "scope": "local-only" if local_only else "all",
        "inputs": inputs,
        "changes": [],
        "acquisition": {},
        "installationLinks": links,
    }
    atomic_json(run / "operation.json", record)
    remote = {name: entry for name, entry in selected.items() if not is_local(entry)}
    acquired = {}
    if remote:
        from .remote_sources import acquire_remote_skills

        workspace = run / "acquisition"
        workspace.mkdir()
        acquired, entries, identity = acquire_remote_skills(
            root, workspace, remote, tuple(config["targetAgents"])
        )
        if set(acquired) != set(remote) or set(entries) != set(remote):
            raise ReconciliationError(
                "Native acquisition changed the requested skill set."
            )
        candidate_lock = {"version": 1, "skills": {**lock["skills"], **entries}}
        atomic_json(prepared / "skills-lock.json", candidate_lock)
        record["acquisition"] = identity
    for name, declaration in selected.items():
        source = (
            contained_path(root, declaration["source"], allow_missing=False)
            if is_local(declaration)
            else acquired[name]
        )
        validate_skill_identity(source, name)
        physical = {destinations[prefix + "/" + name] for prefix in roots}
        for relative in sorted(physical):
            destination = prepared / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            copy_tree(source, destination)
            policies = {
                agent: policy
                for agent, policy in declaration.get("invocationPolicy", {}).items()
                if destinations[AGENT_ROOTS[agent] + "/" + name] == relative
            }
            project_invocation_policy(destination, policies)
    candidates = dict(baselines)
    if remote:
        candidates["skills-lock.json"] = inputs["skills-lock.json"]
    record["outputBaselines"] = candidates
    for relative, before in candidates.items():
        candidate = prepared / relative
        after = fingerprint(candidate)
        if before != after:
            index = len(record["changes"])
            record["changes"].append(
                {
                    "destination": relative,
                    "candidate": "prepared/" + relative,
                    "backup": f"backups/{index}",
                    "before": before,
                    "after": after,
                    "phase": "pending",
                }
            )
    for relative, expected in inputs.items():
        _assert_fingerprint(
            contained_path(root, relative),
            expected,
            "An input changed during planning; plan again.",
        )
    for relative, expected in baselines.items():
        _assert_fingerprint(
            contained_path(root, relative),
            expected,
            "An installation changed during planning; plan again.",
        )
    assert_installation_links(root, links)
    record["diff"] = "".join(
        _describe_change(root, change["destination"], run / change["candidate"])
        for change in record["changes"]
    )
    record["phase"] = "planned"
    atomic_json(run / "operation.json", record)
    return {
        "status": "planned",
        "repository": str(root),
        "planId": plan_id,
        "changeCount": len(record["changes"]),
        "diff": record["diff"],
        "changes": record["changes"],
        "record": str(run / "operation.json"),
        "acquisition": record["acquisition"],
    }


def _restore(root, run, record):
    """Compare-before-restore; a conflicting user edit is preserved as recovery-required."""
    for index in reversed(range(len(record["changes"]))):
        assert_installation_links(root, record.get("installationLinks", {}))
        change = record["changes"][index]
        destination = contained_path(root, change["destination"])
        backup = contained_path(run, change["backup"])
        current = fingerprint(destination)
        backup_digest = fingerprint(backup)
        if current == change["before"] and backup_digest is None:
            change["phase"] = "restored"
            atomic_json(run / "operation.json", record)
            continue
        if backup_digest != change["before"]:
            raise ReconciliationError(
                f"Backup differs for {change['destination']}.", "recovery-required", 4
            )
        absent_between_moves = current is None and change["phase"] in (
            "pending",
            "backed-up",
        )
        if current != change["after"] and not absent_between_moves:
            raise ReconciliationError(
                f"Preserved concurrent change at {change['destination']}.",
                "recovery-required",
                4,
            )
        if current is not None:
            discarded = contained_path(run, f"restored-outputs/{index}")
            discarded.parent.mkdir(parents=True, exist_ok=True)
            if discarded.exists():
                raise ReconciliationError(
                    "Recovery output already exists; inspect retained state.",
                    "recovery-required",
                    4,
                )
            os.replace(destination, discarded)
        if backup_digest is not None:
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.replace(backup, destination)
        _assert_fingerprint(
            destination,
            change["before"],
            "Restoration identity could not be confirmed.",
        )
        change["phase"] = "restored"
        atomic_json(run / "operation.json", record)


def _publication_failure(root, run, record, error):
    try:
        _restore(root, run, record)
        record["phase"] = "restored"
        atomic_json(run / "operation.json", record)
    except BaseException as restoration:
        record["phase"] = "recovery-required"
        atomic_json(run / "operation.json", record)
        raise ReconciliationError(
            f"Publication failed ({error}); restoration incomplete ({restoration}). Preserve state; run repository-skills recover {record['planId']}.",
            "recovery-required",
            4,
        ) from error


def apply_plan(root, plan_id):
    """Publish only saved bytes under writer exclusion and fresh input/path checks."""
    with _writer(root) as state:
        run, record = _read_record(root, plan_id, for_apply=True)
        _active_publication(state, excluding=plan_id)
        if record["phase"] in ("applying", "recovery-required"):
            raise ReconciliationError(
                f"Recover interrupted plan {plan_id} first.", "recovery-required", 4
            )
        if record["phase"] == "complete":
            for relative, expected in _expected_outputs(record).items():
                _assert_fingerprint(
                    contained_path(root, relative),
                    expected,
                    "Completed plan output changed.",
                )
            return {
                "status": "applied",
                "repository": str(root),
                "planId": plan_id,
                "alreadyComplete": True,
            }
        if record["phase"] != "planned":
            raise ReconciliationError(
                "Plan is not publishable; construct a fresh plan.", "conflict", 3
            )
        if record["cliDigest"] != _cli_identity():
            raise ReconciliationError("CLI changed after planning.", "conflict", 3)
        for relative, expected in record["inputs"].items():
            _assert_fingerprint(
                contained_path(root, relative),
                expected,
                "An input changed after review; plan again.",
            )
        for relative, expected in record["outputBaselines"].items():
            if relative != "skills-lock.json":
                validate_managed_destination(root, relative)
            _assert_fingerprint(
                contained_path(root, relative),
                expected,
                "An output changed after review; plan again.",
            )
        for change in record["changes"]:
            _assert_fingerprint(
                contained_path(run, change["candidate"], allow_missing=False),
                change["after"],
                "Candidate bytes changed after review.",
            )
        record["phase"] = "applying"
        atomic_json(run / "operation.json", record)
        try:
            for index, change in enumerate(record["changes"]):
                assert_installation_links(root, record.get("installationLinks", {}))
                destination = contained_path(root, change["destination"])
                candidate = contained_path(
                    run, change["candidate"], allow_missing=False
                )
                publication = contained_path(run, f"publication/{index}")
                publication.parent.mkdir(parents=True, exist_ok=True)
                if candidate.is_dir():
                    copy_tree(candidate, publication)
                else:
                    shutil.copy2(candidate, publication)
                _assert_fingerprint(
                    publication,
                    change["after"],
                    "Publication copy differs from reviewed candidate.",
                )
                _assert_fingerprint(
                    destination,
                    change["before"],
                    "Concurrent output change before publication.",
                )
                backup = contained_path(run, change["backup"])
                backup.parent.mkdir(parents=True, exist_ok=True)
                destination.parent.mkdir(parents=True, exist_ok=True)
                if change["before"] is not None:
                    os.replace(destination, backup)
                    _assert_fingerprint(
                        backup,
                        change["before"],
                        "Concurrent edit detected in publication backup.",
                    )
                change["phase"] = "backed-up"
                atomic_json(run / "operation.json", record)
                if os.path.lexists(destination):
                    raise ReconciliationError(
                        "Concurrent creation at managed destination.", "conflict", 3
                    )
                os.replace(publication, destination)
                change["phase"] = "published"
                atomic_json(run / "operation.json", record)
            assert_installation_links(root, record.get("installationLinks", {}))
            for relative, expected in _expected_outputs(record).items():
                _assert_fingerprint(
                    contained_path(root, relative),
                    expected,
                    "Concurrent change during publication.",
                )
            record["phase"] = "complete"
            atomic_json(run / "operation.json", record)
        except BaseException as error:
            _publication_failure(root, run, record, error)
            raise
        return {
            "status": "applied",
            "repository": str(root),
            "planId": plan_id,
            "changeCount": len(record["changes"]),
        }


def recover_plan(root, plan_id):
    """Restore this interrupted publication under the same lock, with no config dependency."""
    with _writer(root):
        run, record = _read_record(root, plan_id)
        if record["phase"] == "restored":
            for change in record["changes"]:
                _assert_fingerprint(
                    contained_path(root, change["destination"]),
                    change["before"],
                    "Previously restored output changed.",
                )
            return {"status": "recovered", "repository": str(root), "planId": plan_id}
        if record["phase"] not in ("applying", "recovery-required"):
            raise ReconciliationError(
                "No interrupted publication to recover for this plan.", "conflict", 3
            )
        try:
            _restore(root, run, record)
            record["phase"] = "restored"
            atomic_json(run / "operation.json", record)
        except BaseException as error:
            record["phase"] = "recovery-required"
            atomic_json(run / "operation.json", record)
            raise ReconciliationError(
                f"Recovery incomplete: {error}. Retain plan {plan_id}.",
                "recovery-required",
                4,
            ) from error
        return {"status": "recovered", "repository": str(root), "planId": plan_id}
