"""Native/npm doubles at the external boundary, real local Git source objects."""

import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from test_cli import SOURCE, VENDOR

sys.path[:0] = [str(SOURCE), str(VENDOR)]

from repository_skill_reconciliation.errors import ReconciliationError
from repository_skill_reconciliation.remote_sources import (
    _environment,
    _npm_arguments,
    acquire_remote_skills,
    source_selection,
)


@unittest.skipUnless(os.name == "nt", "Windows npm launcher contract")
class NpmLauncherTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="repository-skills-npm-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.node = self.root / "Node installation & tools" / "node.exe"
        self.node.parent.mkdir()
        self.node.write_bytes(b"fixture: discovery only")
        self.wrapper = self.root / "harness" / "npm.cmd"
        self.wrapper.parent.mkdir()
        self.wrapper.write_text("@echo fixture wrapper must not execute\n")
        self.package = self.node.parent / "node_modules" / "npm"
        self.cli = self.package / "bin" / "npm-cli.js"
        self.cli.parent.mkdir(parents=True)
        self.cli.write_text("// fixture public entry point; never executed\n")
        self.manifest = self.package / "package.json"
        self.manifest.write_text(
            json.dumps({"name": "npm", "bin": {"npm": "bin/npm-cli.js"}})
        )

    def resolve(self, *, entrypoint="", npm=None, node=None):
        executables = {"npm": npm, "node": node}
        with (
            patch.dict(os.environ, {"npm_execpath": entrypoint}),
            patch(
                "repository_skill_reconciliation.remote_sources.shutil.which",
                side_effect=executables.get,
            ),
        ):
            return _npm_arguments()

    def test_npm_script_entrypoint_works_with_unrelated_path_wrapper(self):
        elsewhere = self.root / "other node" / "node.exe"
        elsewhere.parent.mkdir()
        elsewhere.write_bytes(b"fixture: no adjacent npm here")
        self.assertEqual(
            self.resolve(
                entrypoint=str(self.cli), npm=str(self.wrapper), node=str(elsewhere)
            ),
            ["node", str(self.cli)],
        )

    def test_node_adjacent_public_cli_works_without_npm_script_environment(self):
        self.assertEqual(
            self.resolve(npm=str(self.wrapper), node=str(self.node)),
            ["node", str(self.cli)],
        )

    def test_unrelated_environment_entrypoint_is_not_selected(self):
        self.manifest.write_text(
            json.dumps({"name": "different-package", "bin": {"npm": "bin/npm-cli.js"}})
        )
        with self.assertRaises(ReconciliationError) as caught:
            self.resolve(
                entrypoint=str(self.cli), npm=str(self.wrapper), node=str(self.node)
            )
        self.assertEqual(
            (caught.exception.code, caught.exception.exit_status), ("missing-tool", 2)
        )

    def test_missing_node_reports_missing_tool_before_launch(self):
        with self.assertRaises(ReconciliationError) as caught:
            self.resolve(
                entrypoint=str(self.cli),
                npm=str(self.cli.parent.parent.parent.parent / "npm.cmd"),
            )
        self.assertEqual(
            (caught.exception.code, caught.exception.exit_status), ("missing-tool", 2)
        )

    def test_missing_npm_reports_missing_tool(self):
        with self.assertRaises(ReconciliationError) as caught:
            self.resolve()
        self.assertEqual(
            (caught.exception.code, caught.exception.exit_status), ("missing-tool", 2)
        )


class WindowsAcquisitionTests(unittest.TestCase):
    """Exercise native Windows paths and process-local Git settings."""

    @unittest.skipUnless(
        sys.platform == "win32" and shutil.which("git"), "Git for Windows required"
    )
    def test_native_long_path_checkout_uses_child_only_settings(self):
        with tempfile.TemporaryDirectory(prefix="skills-long-path-test-") as temporary:
            root = Path(temporary)
            relative = (
                "plugins/aws-startup-advisor/skills/knowledge-base-for-startups/"
                "references/learn/case-studies/"
                "how-the-4x-performance-of-aws-graviton-enables-ai-powered-startup-"
                "paradimeio-to-transform-the-effectiveness-of-data-analytics-teams.md"
            )
            self.assertGreater(len(str(root / relative)), 260)

            def git(*arguments, check=False, **options):
                return subprocess.run(
                    ["git", "-C", str(root), *arguments],
                    check=check,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    **options,
                )

            git("init", "--quiet", check=True)
            blob = git(
                "hash-object", "-w", "--stdin", input="skill fixture\n", check=True
            ).stdout.strip()
            git(
                "update-index",
                "--add",
                "--cacheinfo",
                "100644",
                blob,
                relative,
                check=True,
            )
            before = dict(os.environ)
            environment = _environment(root)
            self.assertEqual(before, dict(os.environ))
            rejected = git(
                "-c", "core.longpaths=false", "checkout-index", "--", relative
            )
            self.assertNotEqual(0, rejected.returncode)
            self.assertIn("Filename too long", rejected.stderr)
            accepted = git("checkout-index", "--", relative, env=environment)
            self.assertEqual(0, accepted.returncode, accepted.stdout + accepted.stderr)
            self.assertEqual(
                "skill fixture\n", (root / relative).read_text(encoding="utf-8")
            )
            self.assertNotIn(
                "longpaths", (root / ".git/config").read_text(encoding="utf-8").lower()
            )


class SourceSelectionTests(unittest.TestCase):
    def test_supported_source_and_embedded_ref(self):
        self.assertEqual(
            source_selection("owner/repo"), ("https://github.com/owner/repo.git", None)
        )
        self.assertEqual(
            source_selection("https://github.com/owner/repo.git#feature%2Fone"),
            ("https://github.com/owner/repo.git", "feature/one"),
        )

    def test_reject_conflicting_or_unsafe_selectors(self):
        cases = [
            ("owner/repo#main", "main"),
            ("owner/repo#%FF", None),
            ("../repo", None),
            ("https://evil.test/o/r", None),
            ("owner/repo", "--upload-pack=bad"),
            ("owner/repo", "../../main"),
            ("owner/repo", "x.lock"),
            ("owner/repo", "x\nmain"),
            ("https://github.com/o/r/tree/main", None),
        ]
        for source, ref in cases:
            with (
                self.subTest(source=source, ref=ref),
                self.assertRaises(ReconciliationError),
            ):
                source_selection(source, ref)


@unittest.skipUnless(
    shutil.which("git") and shutil.which("node"),
    "Git and Node are required for source-contract tests",
)
class RemoteSourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="repository-skills-remote-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repository = self.root / "consumer"
        self.repository.mkdir()
        self.remote = self.root / "remote"
        self.remote.mkdir()
        self.calls = []
        self.advance = False
        self.wrong_commit = False
        self.bad_hash = False
        self.omit_lock = False
        self.bad_path = False
        self.bad_ref = False
        self.registry_array = False
        self.environment = dict(
            os.environ,
            GIT_CONFIG_NOSYSTEM="1",
            GIT_CONFIG_GLOBAL=os.devnull,
            GIT_CONFIG_COUNT="0",
        )
        self.git("init", "-q", "--initial-branch=main")
        for revision in ("A", "B"):
            for name in ("example", "second"):
                directory = self.remote / "skills" / name
                directory.mkdir(parents=True, exist_ok=True)
                directory.joinpath("SKILL.md").write_text(
                    f"---\nname: {name}\ndescription: fixture\n---\n{revision}\n[Shared](../_shared/guide.md)\n",
                    encoding="utf-8",
                    newline="\n",
                )
                directory.joinpath("data.bin").write_bytes(b"\x00" + revision.encode())
            shared = self.remote / "skills" / "_shared"
            shared.mkdir(exist_ok=True)
            shared.joinpath("guide.md").write_text(
                revision + "\n", encoding="utf-8", newline="\n"
            )
            self.git("add", ".")
            self.git(
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-q",
                "-m",
                revision,
            )
            setattr(self, revision, self.git("rev-parse", "HEAD").strip())
        self.git("update-ref", "refs/heads/main", self.A)

    def git(self, *arguments):
        return subprocess.run(
            ["git", *arguments],
            cwd=self.remote,
            env=self.environment,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        ).stdout

    def source_files(self, commit, name):
        data = subprocess.run(
            ["git", "archive", "--format=zip", commit, f"skills/{name}"],
            cwd=self.remote,
            env=self.environment,
            check=True,
            capture_output=True,
        ).stdout
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            prefix = f"skills/{name}/"
            return {
                entry.filename[len(prefix) :]: archive.read(entry)
                for entry in archive.infolist()
                if not entry.is_dir()
            }

    def native(self, arguments, cwd, environment=None):
        self.calls.append((list(arguments), Path(cwd)))
        if arguments[0] == "npm" or any(
            Path(value).name == "npm-cli.js" for value in arguments[:2]
        ):
            if "view" in arguments:
                metadata = {
                    "name": "skills",
                    "version": "1.7.2",
                    "dist": {"integrity": "sha512-fixture"},
                }
                return json.dumps([metadata] if self.registry_array else metadata)
            prefix = Path(arguments[arguments.index("--prefix") + 1])
            package = prefix / "node_modules" / "skills"
            package.joinpath("bin").mkdir(parents=True)
            package.joinpath("package.json").write_text(
                json.dumps(
                    {
                        "name": "skills",
                        "version": "1.7.2",
                        "bin": {"skills": "bin/cli.mjs"},
                    }
                )
            )
            package.joinpath("bin/cli.mjs").write_text(
                "// The public CLI boundary is doubled in this fixture.\n"
            )
            return ""
        if arguments[0] == "node" and "add" in arguments:
            source = arguments[arguments.index("add") + 1]
            commit = self.B if self.wrong_commit else source.rsplit("#", 1)[1]
            names = arguments[
                arguments.index("--skill") + 1 : arguments.index("--agent")
            ]
            targets = arguments[
                arguments.index("--agent") + 1 : arguments.index("--yes")
            ]
            entries, report = {}, []
            for name in names:
                files = self.source_files(commit, name)
                checksum = hashlib.sha256()
                # Independent ordering for this ASCII-only fixture: native
                # locale collation puts data.bin before SKILL.md.
                for relative in sorted(files, key=str.casefold):
                    content = files[relative]
                    checksum.update(relative.encode())
                    checksum.update(content)
                digest = "0" * 64 if self.bad_hash else checksum.hexdigest()
                for target in targets:
                    base = (
                        ".claude/skills"
                        if target == "claude-code"
                        else ".agents/skills"
                    )
                    output = Path(cwd) / base / name
                    output.mkdir(parents=True, exist_ok=True)
                    for relative, content in files.items():
                        path = output / relative
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(content)
                entries[name] = {
                    "source": "owner/repo",
                    "sourceType": "github",
                    "ref": "main" if self.bad_ref else source.rsplit("#", 1)[1],
                    "skillPath": "../escape/SKILL.md"
                    if self.bad_path
                    else f"skills/{name}/SKILL.md",
                    "computedHash": digest,
                }
                display_names = {
                    "codex": "Codex",
                    "antigravity": "Antigravity",
                    "claude-code": "Claude Code",
                }
                report.append(
                    {
                        "name": name,
                        "status": "installed",
                        "scope": "project",
                        "mode": "copy",
                        "source": "owner/repo",
                        "ref": source.rsplit("#", 1)[1],
                        "agents": [display_names[target] for target in targets],
                        "hash": digest,
                    }
                )
            if not self.omit_lock:
                Path(cwd).joinpath("skills-lock.json").write_text(
                    json.dumps({"version": 1, "skills": entries})
                )
            return json.dumps(report)
        effective = list(arguments)
        effective = [
            str(self.remote) if value == "https://github.com/owner/repo.git" else value
            for value in effective
        ]
        child_environment = dict(environment or self.environment)
        count = int(child_environment.get("GIT_CONFIG_COUNT", "0"))
        child_environment[f"GIT_CONFIG_KEY_{count}"] = "protocol.file.allow"
        child_environment[f"GIT_CONFIG_VALUE_{count}"] = "always"
        child_environment["GIT_CONFIG_COUNT"] = str(count + 1)
        result = subprocess.run(
            effective,
            cwd=cwd,
            env=child_environment,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        ).stdout
        if arguments[0] == "git" and "ls-remote" in arguments and self.advance:
            self.git("update-ref", "refs/heads/main", self.B)
        return result

    def acquire(self, declarations=None, agents=("codex", "claude-code")):
        # These tests own the npm/native acquisition boundary; installed launcher
        # discovery has independent fixtures in NpmLauncherTests above.
        with (
            patch(
                "repository_skill_reconciliation.remote_sources._npm_arguments",
                return_value=["npm"],
            ),
            patch(
                "repository_skill_reconciliation.remote_sources.run_command",
                side_effect=self.native,
            ),
        ):
            return acquire_remote_skills(
                self.repository,
                self.root / "work",
                declarations or {"example": {"source": "owner/repo", "ref": "main"}},
                agents,
            )

    def test_branch_advance_keeps_skill_shared_and_native_hash_at_one_commit(self):
        self.advance = True
        directories, entries, identities = self.acquire(
            {
                name: {"source": "owner/repo", "ref": "main"}
                for name in ("example", "second")
            }
        )
        self.assertEqual(self.git("rev-parse", "main").strip(), self.B)
        for name, directory in directories.items():
            self.assertIn("\nA\n", directory.joinpath("SKILL.md").read_text())
            self.assertEqual(
                directory.joinpath("references/_shared/guide.md").read_text(), "A\n"
            )
            self.assertEqual(directory.joinpath("data.bin").read_bytes(), b"\x00A")
            self.assertEqual(entries[name]["ref"], "main")
        self.assertEqual(identities["sources"][0]["resolvedCommit"], self.A)
        self.assertEqual(identities["installer"]["requested"], "skills@latest")
        self.assertEqual(sum("view" in command for command, _ in self.calls), 1)
        self.assertEqual(sum("install" in command for command, _ in self.calls), 1)
        self.assertEqual(sum("ls-remote" in command for command, _ in self.calls), 1)
        self.assertEqual(
            sum("add" in command and command[0] == "node" for command, _ in self.calls),
            1,
        )
        self.assertFalse(self.repository.joinpath(".agents").exists())
        self.assertTrue(any("sparse-checkout" in command for command, _ in self.calls))

    def test_default_ref_stays_absent_and_claude_only_needs_no_codex_output(self):
        directories, entries, _ = self.acquire(
            {"example": {"source": "owner/repo"}}, ("claude-code",)
        )
        self.assertNotIn("ref", entries["example"])
        self.assertTrue(directories["example"].joinpath("SKILL.md").is_file())
        native_commands = [
            command
            for command, _ in self.calls
            if command[0] == "node" and "add" in command
        ]
        self.assertNotIn("codex", native_commands[0])

    def test_commit_pin_remains_a_pin(self):
        _, entries, identities = self.acquire(
            {"example": {"source": "owner/repo", "ref": self.A}}
        )
        self.assertEqual(entries["example"]["ref"], self.A)
        self.assertEqual(identities["sources"][0]["resolvedCommit"], self.A)

    def test_npm_single_manifest_array_is_one_resolution(self):
        self.registry_array = True
        _, _, identities = self.acquire()
        self.assertEqual(identities["installer"]["version"], "1.7.2")
        self.assertEqual(sum("view" in command for command, _ in self.calls), 1)

    def test_distinct_refs_share_installer_but_not_source_revision(self):
        directories, entries, identities = self.acquire(
            {
                "example": {"source": "owner/repo", "ref": "main"},
                "second": {"source": "owner/repo", "ref": self.B},
            }
        )
        self.assertEqual(
            directories["example"].joinpath("references/_shared/guide.md").read_text(),
            "A\n",
        )
        self.assertEqual(
            directories["second"].joinpath("references/_shared/guide.md").read_text(),
            "B\n",
        )
        self.assertEqual(entries["example"]["ref"], "main")
        self.assertEqual(entries["second"]["ref"], self.B)
        self.assertEqual(
            {source["resolvedCommit"] for source in identities["sources"]},
            {self.A, self.B},
        )
        self.assertEqual(sum("view" in command for command, _ in self.calls), 1)
        self.assertEqual(sum("install" in command for command, _ in self.calls), 1)

    def test_annotated_tag_is_peeled_but_requested_tag_is_preserved(self):
        self.git(
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "tag.gpgsign=false",
            "tag",
            "-a",
            "release/v1",
            self.A,
            "-m",
            "fixture",
        )
        _, entries, identities = self.acquire(
            {"example": {"source": "owner/repo", "ref": "release/v1"}}
        )
        self.assertEqual(entries["example"]["ref"], "release/v1")
        self.assertEqual(identities["sources"][0]["resolvedCommit"], self.A)

    def test_selected_git_symlink_is_rejected_even_if_native_dereferences_it(self):
        blob = (
            subprocess.run(
                ["git", "hash-object", "-w", "--stdin"],
                cwd=self.remote,
                env=self.environment,
                input=b"../../outside",
                check=True,
                stdout=subprocess.PIPE,
            )
            .stdout.decode()
            .strip()
        )
        self.git(
            "update-index", "--add", "--cacheinfo", f"120000,{blob},skills/example/link"
        )
        self.git(
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "-m",
            "linked fixture",
        )
        self.A = self.git("rev-parse", "HEAD").strip()
        with self.assertRaises(ReconciliationError):
            self.acquire()

    def test_wrong_native_commit_is_rejected_before_normalization(self):
        self.wrong_commit = True
        with self.assertRaises(ReconciliationError):
            self.acquire()
        self.assertFalse(
            self.root.joinpath("work/acquired/example/references").exists()
        )

    def test_native_success_without_lock_is_failure(self):
        self.omit_lock = True
        with self.assertRaises(ReconciliationError) as caught:
            self.acquire()
        self.assertEqual(caught.exception.exit_status, 1)

    def test_invented_native_hash_is_rejected(self):
        self.bad_hash = True
        with self.assertRaises(ReconciliationError):
            self.acquire()

    def test_escaping_native_skill_path_is_rejected(self):
        self.bad_path = True
        with self.assertRaises(ReconciliationError):
            self.acquire()

    def test_native_ref_must_match_pinned_acquisition_before_restoring_selector(self):
        self.bad_ref = True
        with self.assertRaises(ReconciliationError):
            self.acquire()

    def test_empty_selection_launches_nothing(self):
        with patch(
            "repository_skill_reconciliation.remote_sources.run_command"
        ) as process:
            self.assertEqual(
                acquire_remote_skills(
                    self.repository, self.root / "empty", {}, ("codex",)
                ),
                ({}, {}, {"installer": None, "sources": []}),
            )
            process.assert_not_called()


if __name__ == "__main__":
    unittest.main()
