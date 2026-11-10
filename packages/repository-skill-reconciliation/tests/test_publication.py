"""Real publication fault, crash-recovery, alias and concurrent-writer scenarios."""

import json
import os
import sys
import uuid
from pathlib import Path
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
        previous = operations.create_plan(self.root, local_only=True)
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
        self.assertTrue(Path(previous["record"]).is_file())

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
        record = operations._run_directory(self.root, plan_id) / "operation.json"
        self.assertEqual("recovery-required", json.loads(record.read_bytes())["phase"])

    def test_apply_preserves_a_plan_still_in_preparation(self):
        _, plan_id = self.plan_with_previous_installations()
        concurrent = operations.create_plan(self.root, local_only=True)
        journal = Path(concurrent["record"])
        record = json.loads(journal.read_bytes())
        write_record = operations.atomic_json
        write_record(journal, {**record, "phase": "preparing"})

        def finish_planning_during_publication(path, value):
            write_record(path, value)
            if value["planId"] == plan_id and value["phase"] == "applying":
                write_record(journal, record)

        with patch.object(
            operations, "atomic_json", side_effect=finish_planning_during_publication
        ):
            self.assertEqual(
                "applied", operations.apply_plan(self.root, plan_id)["status"]
            )
        self.assertEqual(record, json.loads(journal.read_bytes()))

    def test_prune_failure_keeps_apply_success_and_allows_later_cleanup(self):
        _, plan_id = self.plan_with_previous_installations()
        previous = operations.create_plan(self.root, local_only=True)
        journal = Path(previous["record"])
        with patch.object(
            operations.shutil, "rmtree", side_effect=PermissionError("in use")
        ):
            applied = operations.apply_plan(self.root, plan_id)
        self.assertEqual("applied", applied["status"])
        self.assertIn(previous["planId"], applied["warnings"][0])
        self.assertTrue(journal.is_file())
        self.assertTrue(operations.apply_plan(self.root, plan_id)["alreadyComplete"])
        later = operations.create_plan(self.root, local_only=True)
        self.assertEqual(
            "applied", operations.apply_plan(self.root, later["planId"])["status"]
        )
        self.assertFalse(journal.parent.exists())

    def test_recover_after_crash_between_moves_needs_no_valid_current_config(self):
        _, plan_id = self.plan_with_previous_installations()
        runs = self.root / ".agent-tools/skill-reconciliation/runs"
        legacy_id = uuid.UUID(plan_id).hex
        run = (runs / plan_id).rename(runs / legacy_id)
        record_path = run / "operation.json"
        record = json.loads(record_path.read_text(encoding="utf-8"))
        record["planId"] = legacy_id
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
        result = operations.recover_plan(self.root, legacy_id)
        self.assertEqual("recovered", result["status"])
        self.assertEqual(
            b"prior installation",
            (self.root / first["destination"] / "old.bin").read_bytes(),
        )
        self.assertEqual(
            "recovered", operations.recover_plan(self.root, legacy_id)["status"]
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
