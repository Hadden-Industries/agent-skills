"""Real publication fault, crash-recovery, alias and concurrent-writer scenarios."""

import json
import os
import sys
from unittest.mock import patch

from test_cli import SOURCE, VENDOR, RepositoryFixture

sys.path[:0] = [str(SOURCE), str(VENDOR)]

import portalocker  # noqa: E402
from repository_skill_reconciliation import operations  # noqa: E402
from repository_skill_reconciliation.errors import ReconciliationError  # noqa: E402


class PublicationTests(RepositoryFixture):
    """Inject only filesystem faults; keep candidate validation and restoration real."""

    def plan_with_previous_installations(self):
        source = self.local_skill()
        for prefix in (".agents/skills", ".claude/skills"):
            destination = self.root / prefix / "team-conventions"
            destination.mkdir(parents=True)
            (destination / "old.bin").write_bytes(b"prior installation")
        result = operations.create_plan(self.root, local_only=True)
        return source, result["planId"]

    def test_later_publication_failure_restores_both_previous_trees(self):
        _, plan_id = self.plan_with_previous_installations()
        replace = os.replace

        def fail_second_tree(source, destination):
            if str(source).endswith("publication\\1") or str(source).endswith(
                "publication/1"
            ):
                raise OSError("independent injected rename failure")
            return replace(source, destination)

        with patch.object(operations.os, "replace", side_effect=fail_second_tree):
            with self.assertRaisesRegex(OSError, "injected rename failure"):
                operations.apply_plan(self.root, plan_id)
        for prefix in (".agents/skills", ".claude/skills"):
            destination = self.root / prefix / "team-conventions"
            self.assertEqual(["old.bin"], [p.name for p in destination.iterdir()])
            self.assertEqual(
                b"prior installation", (destination / "old.bin").read_bytes()
            )
        self.assertEqual(
            "recovered", operations.recover_plan(self.root, plan_id)["status"]
        )

    def test_failed_restore_preserves_user_edit_and_blocks_another_apply(self):
        _, plan_id = self.plan_with_previous_installations()
        replace = os.replace

        def concurrent_edit_before_second_publish(source, destination):
            if str(source).endswith("publication\\1") or str(source).endswith(
                "publication/1"
            ):
                (self.root / ".agents/skills/team-conventions/asset.bin").write_bytes(
                    b"concurrent user edit"
                )
                raise OSError("second write failed after user edit")
            return replace(source, destination)

        with patch.object(
            operations.os, "replace", side_effect=concurrent_edit_before_second_publish
        ):
            with self.assertRaises(ReconciliationError) as caught:
                operations.apply_plan(self.root, plan_id)
        self.assertEqual(4, caught.exception.exit_status)
        self.assertEqual(
            b"concurrent user edit",
            (self.root / ".agents/skills/team-conventions/asset.bin").read_bytes(),
        )
        with self.assertRaises(ReconciliationError) as caught:
            operations.recover_plan(self.root, plan_id)
        self.assertEqual(4, caught.exception.exit_status)
        another = operations.create_plan(self.root, local_only=True)["planId"]
        with self.assertRaises(ReconciliationError) as caught:
            operations.apply_plan(self.root, another)
        self.assertEqual(4, caught.exception.exit_status)

    def test_recover_after_crash_between_moves_needs_no_valid_current_config(self):
        _, plan_id = self.plan_with_previous_installations()
        run = self.root / ".agent-tools/skill-reconciliation/runs" / plan_id
        record_path = run / "operation.json"
        record = json.loads(record_path.read_text(encoding="utf-8"))
        first = record["changes"][0]
        backup = run / first["backup"]
        backup.parent.mkdir()
        os.replace(self.root / first["destination"], backup)
        record["phase"] = "applying"
        # The interrupted process never advanced 'pending' after the real rename.
        # Restoration must also survive absent planning-only metadata; only the
        # saved restoration journal determines what can safely be moved back.
        for field in ("inputs", "cliDigest", "outputBaselines"):
            record.pop(field)
        record_path.write_text(json.dumps(record), encoding="utf-8")
        (self.root / "repository-skills.json").write_text(
            json.dumps({"schemaVersion": 1, "agents": ["codex"]}), encoding="utf-8"
        )
        result = operations.recover_plan(self.root, plan_id)
        self.assertEqual("recovered", result["status"])
        self.assertEqual(
            b"prior installation",
            (self.root / first["destination"] / "old.bin").read_bytes(),
        )
        self.assertEqual(
            "recovered", operations.recover_plan(self.root, plan_id)["status"]
        )

    def test_writer_exclusion_precedes_state_validation(self):
        _, plan_id = self.plan_with_previous_installations()
        path = self.root / ".agent-tools/skill-reconciliation/writer.lock"
        with portalocker.Lock(str(path), mode="a+b", timeout=0):
            for operation in (operations.apply_plan, operations.recover_plan):
                with self.assertRaises(ReconciliationError) as caught:
                    operation(self.root, plan_id)
                self.assertEqual(3, caught.exception.exit_status)

    def test_hardlinked_local_input_is_rejected_without_modifying_other_link(self):
        source = self.local_skill()
        original = self.root / "outside-skill.bin"
        original.write_bytes(b"shared inode")
        (source / "asset.bin").unlink()
        os.link(original, source / "asset.bin")
        self.assertGreater(original.stat().st_nlink, 1)
        with self.assertRaises(ReconciliationError):
            operations.create_plan(self.root, local_only=True)
        self.assertEqual(b"shared inode", original.read_bytes())
