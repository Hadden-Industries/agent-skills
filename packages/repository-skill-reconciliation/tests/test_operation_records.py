"""Saved-plan result state and malformed-journal failures through the public CLI."""

import json
import shutil

from test_cli import RepositoryFixture


class OperationRecordTests(RepositoryFixture):
    def plan(self):
        result = self.invoke("plan", "--local-only")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def test_failed_planning_retains_a_valid_unpublishable_journal(self):
        source = self.local_skill()
        (source / "agents").mkdir()
        (source / "agents/openai.yaml").write_text(
            "policy: {}\npolicy: {}\n", encoding="utf-8"
        )
        failed = self.invoke("plan", "--local-only")
        self.assertEqual(2, failed.returncode, failed.stdout + failed.stderr)
        journals = list(
            (self.root / ".agent-tools/skill-reconciliation/runs").glob(
                "*/operation.json"
            )
        )
        self.assertEqual(1, len(journals))
        before = journals[0].read_bytes()
        record = json.loads(before)
        self.assertEqual("preparing", record["phase"])
        result = self.invoke("apply", record["planId"])
        self.assertEqual(3, result.returncode, result.stdout + result.stderr)
        response = json.loads(result.stdout)
        self.assertEqual("conflict", response["error"]["code"])
        self.assertIn("construct a fresh plan", response["error"]["message"])
        self.assertEqual(before, journals[0].read_bytes())
        self.assertFalse((self.root / ".agents/skills/team-conventions").exists())

    def test_unchanged_output_drift_blocks_publication_of_another_output(self):
        source = self.local_skill()
        claude = self.root / ".claude/skills/team-conventions"
        claude.parent.mkdir(parents=True)
        shutil.copytree(source, claude)
        plan = self.plan()
        self.assertEqual(1, plan["changeCount"])
        (claude / "asset.bin").write_bytes(b"user edit after review")
        result = self.invoke("apply", plan["planId"])
        self.assertEqual(3, result.returncode, result.stdout + result.stderr)
        self.assertFalse((self.root / ".agents/skills/team-conventions").exists())
        self.assertEqual(b"user edit after review", (claude / "asset.bin").read_bytes())

    def test_changed_cli_identity_rejects_prepared_plan_before_publication(self):
        self.local_skill()
        plan = self.plan()
        path = (
            self.root
            / ".agent-tools/skill-reconciliation/runs"
            / plan["planId"]
            / "operation.json"
        )
        record = json.loads(path.read_text(encoding="utf-8"))
        record["cliDigest"] = "0" * 64
        path.write_text(json.dumps(record), encoding="utf-8")
        result = self.invoke("apply", plan["planId"])
        self.assertEqual(3, result.returncode, result.stdout + result.stderr)
        self.assertEqual("conflict", json.loads(result.stdout)["error"]["code"])
        self.assertFalse((self.root / ".agents/skills/team-conventions").exists())

    def test_completed_zero_change_plan_checks_unchanged_result_state(self):
        self.local_skill()
        first = self.plan()
        result = self.invoke("apply", first["planId"])
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        empty = self.plan()
        self.assertEqual(0, empty["changeCount"])
        self.assertEqual(0, self.invoke("apply", empty["planId"]).returncode)
        asset = self.root / ".claude/skills/team-conventions/asset.bin"
        asset.write_bytes(b"changed after completion")
        result = self.invoke("apply", empty["planId"])
        self.assertEqual(3, result.returncode, result.stdout + result.stderr)
        self.assertEqual(b"changed after completion", asset.read_bytes())

    def test_malformed_records_fail_with_structured_json_before_publication(self):
        self.local_skill()
        mutations = {
            "non-object-change": lambda value: value.update(changes=[42]),
            "non-string-destination": lambda value: value["changes"][0].update(
                destination=[]
            ),
            "missing-before": lambda value: value["changes"][0].pop("before"),
            "invalid-after": lambda value: value["changes"][0].update(after={}),
            "missing-phase": lambda value: value.pop("phase"),
            "missing-cliDigest": lambda value: value.pop("cliDigest"),
            "missing-inputs": lambda value: value.pop("inputs"),
            "inputs-array": lambda value: value.update(inputs=[]),
            "invalid-input-hash": lambda value: value["inputs"].update(
                {"skills-lock.json": []}
            ),
            "invalid-output-baselines": lambda value: value.update(outputBaselines=[]),
        }
        for name, mutate in mutations.items():
            with self.subTest(case=name):
                plan = self.plan()
                path = (
                    self.root
                    / ".agent-tools/skill-reconciliation/runs"
                    / plan["planId"]
                    / "operation.json"
                )
                value = json.loads(path.read_text(encoding="utf-8"))
                mutate(value)
                path.write_text(json.dumps(value), encoding="utf-8")
                result = self.invoke("apply", plan["planId"])
                self.assertEqual(2, result.returncode, result.stdout + result.stderr)
                response = json.loads(result.stdout)
                self.assertEqual(1, response["schemaVersion"])
                self.assertEqual("failed", response["status"])
                self.assertEqual("invalid-input", response["error"]["code"])
                self.assertNotIn("Traceback", result.stderr)
                self.assertFalse(
                    (self.root / ".agents/skills/team-conventions").exists()
                )
                # This invalid operation is no longer needed by the fixture;
                # leave its valid phase so a subsequent case tests its own ID.
                if "phase" not in value:
                    value["phase"] = "planned"
                    path.write_text(json.dumps(value), encoding="utf-8")

    def test_json_without_subcommand_is_a_structured_usage_error(self):
        result = self.invoke()
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        response = json.loads(result.stdout)
        self.assertEqual(1, response["schemaVersion"])
        self.assertEqual("invalid-input", response["error"]["code"])
        self.assertFalse((self.root / ".agent-tools").exists())
