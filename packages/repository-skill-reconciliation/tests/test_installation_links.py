"""Native directory links retain one physical installation across reconciliation."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

from test_cli import SOURCE, VENDOR, RepositoryFixture

sys.path[:0] = [str(SOURCE), str(VENDOR)]

from repository_skill_reconciliation import operations  # noqa: E402
from repository_skill_reconciliation.errors import ReconciliationError  # noqa: E402


class InstallationLinkTests(RepositoryFixture):
    """Exercise Windows junctions (portable directory symlinks on other systems)."""

    def link(self, destination, target):
        destination.parent.mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            subprocess.run(
                ["cmd", "/c", "mklink", "/J", str(destination), str(target)],
                check=True,
                capture_output=True,
            )
            self.assertEqual(0xA0000003, destination.lstat().st_reparse_tag)
        else:
            destination.symlink_to(target, target_is_directory=True)
            self.assertTrue(destination.is_symlink())

    def installed_link(self):
        source = self.local_skill()
        canonical = self.root / ".agents/skills/team-conventions"
        shutil.copytree(source, canonical)
        (canonical / "asset.bin").write_bytes(b"previous installation")
        link = self.root / ".claude/skills/team-conventions"
        self.link(link, canonical)
        return source, canonical, link

    def test_shared_update_preserves_link_and_combines_host_metadata(self):
        _, canonical, link = self.installed_link()
        self.config["invocationPolicyOverrides"]["team-conventions"]["claude-code"] = (
            "explicit-only"
        )
        self.write_inputs()
        identity = (os.readlink(link), link.lstat().st_ino)
        result = self.invoke("plan", "--local-only")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        plan = json.loads(result.stdout)
        self.assertEqual(1, plan["changeCount"])
        self.assertEqual(
            ".agents/skills/team-conventions", plan["changes"][0]["destination"]
        )
        result = self.invoke("apply", plan["planId"])
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(identity, (os.readlink(link), link.lstat().st_ino))
        self.assertEqual(b"\x00\xff\x01", (link / "asset.bin").read_bytes())
        self.assertIn(
            "disable-model-invocation: true", (canonical / "SKILL.md").read_text()
        )
        self.assertIn(
            "allow_implicit_invocation: false",
            (link / "agents/openai.yaml").read_text(),
        )
        self.assertEqual(0, self.invoke("apply", plan["planId"]).returncode)
        unchanged = self.invoke("plan", "--local-only")
        self.assertEqual(0, unchanged.returncode, unchanged.stdout + unchanged.stderr)
        self.assertEqual(0, json.loads(unchanged.stdout)["changeCount"])

    def test_failed_publication_restores_canonical_bytes_and_original_link(self):
        _, canonical, link = self.installed_link()
        identity = (os.readlink(link), link.lstat().st_ino)
        plan = operations.create_plan(self.root, local_only=True)
        replace = os.replace

        def fail_publication(source, destination):
            if Path(source).parent.name == "publication":
                raise OSError("injected publication fault")
            return replace(source, destination)

        with patch.object(operations.os, "replace", side_effect=fail_publication):
            with self.assertRaisesRegex(OSError, "injected publication fault"):
                operations.apply_plan(self.root, plan["planId"])
        self.assertEqual(
            b"previous installation", (canonical / "asset.bin").read_bytes()
        )
        self.assertEqual(b"previous installation", (link / "asset.bin").read_bytes())
        self.assertEqual(identity, (os.readlink(link), link.lstat().st_ino))

    def test_crash_recovery_with_dangling_link_needs_no_configuration(self):
        _, canonical, link = self.installed_link()
        identity = (os.readlink(link), link.lstat().st_ino)
        plan = operations.create_plan(self.root, local_only=True)
        run = Path(plan["record"]).parent
        record = json.loads(Path(plan["record"]).read_text())
        change = record["changes"][0]
        backup = run / change["backup"]
        backup.parent.mkdir()
        os.replace(canonical, backup)
        self.assertFalse(link.exists())
        self.assertTrue(os.path.lexists(link))
        record["phase"] = "applying"
        for field in ("inputs", "cliDigest", "outputBaselines"):
            record.pop(field)
        Path(plan["record"]).write_text(json.dumps(record))
        (self.root / "repository-skills.json").unlink()
        self.assertEqual(
            "recovered", operations.recover_plan(self.root, plan["planId"])["status"]
        )
        self.assertEqual(b"previous installation", (link / "asset.bin").read_bytes())
        self.assertEqual(identity, (os.readlink(link), link.lstat().st_ino))

    def test_retargeted_link_blocks_apply_and_leaves_both_trees_unchanged(self):
        _, canonical, link = self.installed_link()
        plan = operations.create_plan(self.root, local_only=True)
        other = self.root / ".agents/skills/other"
        other.mkdir()
        (other / "keep.bin").write_bytes(b"user-owned target")
        link.rmdir() if sys.platform == "win32" else link.unlink()
        self.link(link, other)
        result = self.invoke("apply", plan["planId"])
        self.assertEqual(3, result.returncode, result.stdout + result.stderr)
        self.assertEqual(
            b"previous installation", (canonical / "asset.bin").read_bytes()
        )
        self.assertEqual(b"user-owned target", (link / "keep.bin").read_bytes())

    def test_claude_only_selection_rejects_shared_link_without_converting_it(self):
        _, canonical, link = self.installed_link()
        self.config["targetAgents"] = ["claude-code"]
        self.config.pop("invocationPolicyOverrides")
        self.write_inputs()
        identity = (os.readlink(link), link.lstat().st_ino)
        result = self.invoke("plan", "--local-only")
        self.assertEqual(3, result.returncode, result.stdout + result.stderr)
        self.assertIn(
            "explicit conversion", json.loads(result.stdout)["error"]["message"]
        )
        self.assertEqual(
            b"previous installation", (canonical / "asset.bin").read_bytes()
        )
        self.assertEqual(b"previous installation", (link / "asset.bin").read_bytes())
        self.assertEqual(identity, (os.readlink(link), link.lstat().st_ino))
        self.assertFalse((self.root / ".agent-tools").exists())

    def test_fresh_claude_only_selection_publishes_only_to_claude(self):
        self.local_skill()
        self.config["targetAgents"] = ["claude-code"]
        self.config.pop("invocationPolicyOverrides")
        self.write_inputs()
        plan = operations.create_plan(self.root, local_only=True)
        self.assertEqual(
            [".claude/skills/team-conventions"],
            [entry["destination"] for entry in plan["changes"]],
        )
        operations.apply_plan(self.root, plan["planId"])
        destination = self.root / ".claude/skills/team-conventions"
        self.assertTrue(destination.is_dir())
        self.assertEqual(
            0, getattr(destination.lstat(), "st_file_attributes", 0) & 0x400
        )
        self.assertFalse(destination.is_symlink())
        self.assertEqual(b"\x00\xff\x01", (destination / "asset.bin").read_bytes())
        self.assertFalse((self.root / ".agents/skills/team-conventions").exists())

    def test_nested_links_external_targets_and_link_chains_remain_rejected(self):
        source, canonical, link = self.installed_link()
        link.rmdir() if sys.platform == "win32" else link.unlink()
        # Every forbidden case has a real directory link and a positive control
        # in the shared-update test; refusal is not caused by invalid fixtures.
        for target in (source, self.root.parent):
            with self.subTest(target=target):
                self.link(link, target)
                result = self.invoke("plan", "--local-only")
                self.assertEqual(2, result.returncode, result.stdout + result.stderr)
                link.rmdir() if sys.platform == "win32" else link.unlink()
        alternate = self.root / "canonical-backup"
        canonical.rename(alternate)
        self.link(canonical, alternate)
        self.link(link, canonical)
        result = self.invoke("plan", "--local-only")
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        canonical.rmdir() if sys.platform == "win32" else canonical.unlink()
        alternate.rename(canonical)
        self.link(canonical / "nested", source)
        result = self.invoke("plan", "--local-only")
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)

    def test_concurrent_user_edit_is_preserved_when_recovery_cannot_restore(self):
        _, canonical, link = self.installed_link()
        plan = operations.create_plan(self.root, local_only=True)
        replace = os.replace

        def edit_after_publish(source, destination):
            result = replace(source, destination)
            if Path(source).parent.name == "publication":
                (canonical / "asset.bin").write_bytes(b"concurrent edit")
                raise OSError("fault after concurrent edit")
            return result

        with patch.object(operations.os, "replace", side_effect=edit_after_publish):
            with self.assertRaises(ReconciliationError) as caught:
                operations.apply_plan(self.root, plan["planId"])
        self.assertEqual(4, caught.exception.exit_status)
        self.assertEqual(b"concurrent edit", (link / "asset.bin").read_bytes())
        result = self.invoke("recover", plan["planId"])
        self.assertEqual(4, result.returncode, result.stdout + result.stderr)
        self.assertEqual(b"concurrent edit", (canonical / "asset.bin").read_bytes())

    def test_link_change_during_planning_leaves_installations_untouched(self):
        _, canonical, link = self.installed_link()
        other = self.root / ".agents/skills/other"
        other.mkdir()
        copy = operations.copy_tree

        def retarget_after_copy(source, destination):
            copy(source, destination)
            link.rmdir() if sys.platform == "win32" else link.unlink()
            self.link(link, other)

        with patch.object(operations, "copy_tree", side_effect=retarget_after_copy):
            with self.assertRaises(ReconciliationError) as caught:
                operations.create_plan(self.root, local_only=True)
        self.assertEqual(3, caught.exception.exit_status)
        self.assertEqual(
            b"previous installation", (canonical / "asset.bin").read_bytes()
        )
        self.assertEqual([], list(other.iterdir()))

    def test_completed_plan_still_rejects_a_retargeted_link(self):
        _, canonical, link = self.installed_link()
        plan = operations.create_plan(self.root, local_only=True)
        operations.apply_plan(self.root, plan["planId"])
        link.rmdir() if sys.platform == "win32" else link.unlink()
        self.link(link, self.root)
        result = self.invoke("apply", plan["planId"])
        self.assertEqual(3, result.returncode, result.stdout + result.stderr)
        self.assertEqual(b"\x00\xff\x01", (canonical / "asset.bin").read_bytes())

    def test_malformed_link_record_cannot_redirect_recovery(self):
        _, canonical, link = self.installed_link()
        plan = operations.create_plan(self.root, local_only=True)
        path = Path(plan["record"])
        record = json.loads(path.read_text())
        record["installationLinks"][".claude/skills/team-conventions"][
            "destination"
        ] = "../escape"
        path.write_text(json.dumps(record))
        result = self.invoke("apply", plan["planId"])
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        self.assertEqual(b"previous installation", (link / "asset.bin").read_bytes())
        self.assertEqual(
            b"previous installation", (canonical / "asset.bin").read_bytes()
        )

    def test_parent_traversal_cannot_hide_an_intermediate_link(self):
        _, canonical, link = self.installed_link()
        foreign = self.root / "foreign/child"
        foreign.mkdir(parents=True)
        self.link(self.root / "hop", foreign)
        target = str(self.root / "hop/../.agents/skills/team-conventions")
        if sys.platform != "win32":
            link.unlink()
            link.symlink_to(target, target_is_directory=True)
            with self.assertRaises(ReconciliationError):
                operations.create_plan(self.root, local_only=True)
        else:
            # mklink normalizes parent components when creating a junction.
            # Supply the raw target at the OS-read boundary to exercise the
            # same validator input as the real POSIX traversal above.
            readlink = os.readlink

            def raw_target(path, *args, **kwargs):
                return target if Path(path) == link else readlink(path, *args, **kwargs)

            with patch.object(os, "readlink", side_effect=raw_target):
                with self.assertRaises(ReconciliationError):
                    operations.create_plan(self.root, local_only=True)
        self.assertEqual(
            b"previous installation", (canonical / "asset.bin").read_bytes()
        )

    def test_ordinary_relative_parent_target_remains_supported(self):
        _, canonical, link = self.installed_link()
        readlink = os.readlink

        def relative_target(path, *args, **kwargs):
            return (
                "../../.agents/skills/team-conventions"
                if Path(path) == link
                else readlink(path, *args, **kwargs)
            )

        if sys.platform != "win32":
            link.unlink()
            link.symlink_to(
                "../../.agents/skills/team-conventions", target_is_directory=True
            )
        # Windows junction targets are absolute; the mock only supplies the
        # portable relative spelling to the native readlink boundary.
        with patch.object(os, "readlink", side_effect=relative_target):
            plan = operations.create_plan(self.root, local_only=True)
            operations.apply_plan(self.root, plan["planId"])
        self.assertEqual(b"\x00\xff\x01", (canonical / "asset.bin").read_bytes())
        self.assertEqual(b"\x00\xff\x01", (link / "asset.bin").read_bytes())

    def test_parent_traversal_requires_existing_intermediate_directories(self):
        _, canonical, link = self.installed_link()
        (self.root / "ordinary-file").write_bytes(b"not a directory")
        readlink = os.readlink
        for intermediate in ("missing-directory", "ordinary-file"):
            with self.subTest(intermediate=intermediate):
                target = str(
                    self.root / intermediate / ".." / ".agents/skills/team-conventions"
                )

                def raw_target(path, *args, **kwargs):
                    return (
                        target
                        if Path(path) == link
                        else readlink(path, *args, **kwargs)
                    )

                # Exercise raw OS target spellings that mklink normalizes.
                with patch.object(os, "readlink", side_effect=raw_target):
                    with self.assertRaises(ReconciliationError):
                        operations.create_plan(self.root, local_only=True)
        self.assertEqual(
            b"previous installation", (canonical / "asset.bin").read_bytes()
        )
