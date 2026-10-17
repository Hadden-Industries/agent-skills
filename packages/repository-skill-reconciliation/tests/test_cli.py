"""Consumer-facing CLI contracts exercised with real isolated Git worktrees."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
SOURCE = PACKAGE / "src"
VENDOR = Path(
    os.environ.get(
        "REPOSITORY_SKILLS_TEST_VENDOR",
        str(PACKAGE.parents[1] / "tools" / "repository-skills.pyz"),
    )
)


class RepositoryFixture(unittest.TestCase):
    """Build independent repository state without deriving expected behavior from the CLI."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="repository-skills-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        subprocess.run(["git", "init", "--quiet", str(self.root)], check=True)
        (self.root / ".gitignore").write_text(
            ".agents/skills/\n.claude/skills/\n.agent-tools/\n", encoding="utf-8"
        )
        self.config = {"schemaVersion": 1, "targetAgents": ["codex", "claude-code"]}
        self.lock = {"version": 1, "skills": {}}
        self.write_inputs()

    def write_inputs(self):
        """Write fixture-owned declarations; never derive expectations from production."""
        (self.root / "repository-skills.json").write_text(
            json.dumps(self.config), encoding="utf-8"
        )
        (self.root / "skills-lock.json").write_text(
            json.dumps(self.lock), encoding="utf-8"
        )

    def invoke(self, *arguments):
        """Exercise the real entry point; npm must remain unnecessary for local work."""
        environment = os.environ.copy()
        environment["PYTHONPATH"] = os.pathsep.join(map(str, [SOURCE, VENDOR]))
        return subprocess.run(
            [
                sys.executable,
                "-B",
                "-m",
                "repository_skill_reconciliation",
                "--json",
                *arguments,
            ],
            cwd=self.root,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )

    def local_skill(self, body="Original bytes\n"):
        """Create a real source and a deliberately unrelated installation."""
        source = self.root / "skills" / "team-conventions"
        source.mkdir(parents=True)
        (source / "SKILL.md").write_text(
            "---\nname: team-conventions\ndescription: Team conventions\n---\n" + body,
            encoding="utf-8",
        )
        (source / "asset.bin").write_bytes(b"\x00\xff\x01")
        unrelated = self.root / ".agents" / "skills" / "unrelated"
        unrelated.mkdir(parents=True)
        (unrelated / "keep.bin").write_bytes(b"unmanaged\x00")
        self.config.setdefault("localSkillSources", {})["team-conventions"] = (
            "./skills/team-conventions"
        )
        self.config.setdefault("invocationPolicyOverrides", {})["team-conventions"] = {
            "codex": "explicit-only"
        }
        self.write_inputs()
        return source


class RepositoryCliTests(RepositoryFixture):
    """Prove offline checking and exact local publication without native acquisition."""

    def test_check_works_without_installed_outputs_and_writes_nothing(self):
        before = {
            p.relative_to(self.root): p.read_bytes()
            for p in self.root.rglob("*")
            if p.is_file()
        }
        result = self.invoke("check")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual("checked", json.loads(result.stdout)["status"])
        after = {
            p.relative_to(self.root): p.read_bytes()
            for p in self.root.rglob("*")
            if p.is_file()
        }
        self.assertEqual(before, after)
        self.assertFalse((self.root / ".agents").exists())

    def test_check_rejects_unknown_and_duplicate_config_keys(self):
        for body in [
            '{"schemaVersion":1,"targetAgents":["codex"],"agentz":[]}',
            '{"schemaVersion":1,"schemaVersion":1,"targetAgents":["codex"]}',
            '{"schemaVersion":1,"targetAgents":["codex"],"skills":{}}',
        ]:
            with self.subTest(body=body):
                (self.root / "repository-skills.json").write_text(
                    body, encoding="utf-8"
                )
                result = self.invoke("check")
                self.assertEqual(2, result.returncode, result.stdout + result.stderr)
                self.assertEqual(
                    "invalid-input", json.loads(result.stdout)["error"]["code"]
                )

    def test_print_config_schema_is_offline_and_does_not_need_a_repository(self):
        (self.root / "repository-skills.json").write_text("not JSON", encoding="utf-8")
        environment = os.environ.copy()
        environment["PYTHONPATH"] = os.pathsep.join(map(str, [SOURCE, VENDOR]))
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                "-m",
                "repository_skill_reconciliation",
                "print-config-schema",
            ],
            cwd=self.root.parent,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        schema = json.loads(result.stdout)
        self.assertEqual("http://json-schema.org/draft-07/schema#", schema["$schema"])
        self.assertEqual(["schemaVersion", "targetAgents"], schema["required"])
        policy = schema["properties"]["invocationPolicyOverrides"][
            "additionalProperties"
        ]
        self.assertEqual({"codex", "claude-code"}, set(policy["properties"]))
        self.assertNotIn("default", schema["definitions"]["invocationMode"])
        self.assertFalse((self.root / ".agent-tools").exists())

    def test_previous_schema_command_is_rejected_without_an_alias(self):
        result = self.invoke("schema")
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        self.assertEqual("invalid-input", json.loads(result.stdout)["error"]["code"])
        self.assertIn("print-config-schema", result.stderr)
        self.assertFalse((self.root / ".agent-tools").exists())

    def test_previous_unreleased_field_names_are_rejected_without_aliases(self):
        for old_name, value in (
            ("agents", ["codex"]),
            ("localSkills", {}),
            ("invocationPolicies", {}),
        ):
            with self.subTest(old_name=old_name):
                self.write_inputs()
                config = {**self.config, old_name: value}
                (self.root / "repository-skills.json").write_text(
                    json.dumps(config), encoding="utf-8"
                )
                result = self.invoke("check")
                self.assertEqual(2, result.returncode, result.stderr)
                self.assertIn(old_name, json.loads(result.stdout)["error"]["message"])
                self.assertFalse((self.root / ".agent-tools").exists())

    def test_local_identity_and_frontmatter_fail_check_and_plan_without_state(self):
        source = self.local_skill()
        for contents in (
            "---\nname: another-name\ndescription: Different identity\n---\nBody\n",
            "No native frontmatter\n",
            "---\nname: team-conventions\ndescription: ''\n---\nBody\n",
        ):
            for command in (("check",), ("plan", "--local-only")):
                with self.subTest(contents=contents, command=command):
                    (source / "SKILL.md").write_text(contents, encoding="utf-8")
                    result = self.invoke(*command)
                    self.assertEqual(2, result.returncode, result.stderr)
                    message = json.loads(result.stdout)["error"]["message"]
                    self.assertIn("repository-skills.json", message)
                    self.assertIn("/localSkillSources/team-conventions", message)
                    self.assertFalse((self.root / ".agent-tools").exists())

    def test_empty_outer_maps_inherit_but_empty_per_skill_override_is_invalid(self):
        self.config.update(localSkillSources={}, invocationPolicyOverrides={})
        self.write_inputs()
        self.assertEqual(0, self.invoke("check").returncode)
        self.lock["skills"]["example"] = {
            "source": "owner/repository",
            "sourceType": "github",
            "computedHash": "a" * 64,
        }
        self.config["invocationPolicyOverrides"] = {"example": {}}
        self.write_inputs()
        result = self.invoke("check")
        self.assertEqual(2, result.returncode, result.stderr)
        self.assertIn(
            "/invocationPolicyOverrides/example",
            json.loads(result.stdout)["error"]["message"],
        )

    def test_custom_configuration_diagnostics_name_exact_policy_reference(self):
        path = self.root / "options" / "skills.json"
        path.parent.mkdir()
        for policies, expected in (
            ({"example": {"antigravity": "explicit-only"}}, "Unsupported"),
            ({"example": {"claude-code": "explicit-only"}}, "Unselected"),
            ({"missing": {"codex": "explicit-only"}}, "unknown skills"),
        ):
            with self.subTest(policies=policies):
                config = {
                    "schemaVersion": 1,
                    "targetAgents": ["codex", "antigravity"],
                    "invocationPolicyOverrides": policies,
                }
                path.write_text(json.dumps(config), encoding="utf-8")
                result = self.invoke("check", "--config", "options/skills.json")
                self.assertEqual(2, result.returncode, result.stderr)
                message = json.loads(result.stdout)["error"]["message"]
                self.assertIn(
                    "options/skills.json at /invocationPolicyOverrides/", message
                )
                self.assertIn(expected, message)

    def test_invalid_skill_key_diagnostic_identifies_the_key(self):
        self.config["localSkillSources"] = {"Bad/Name": "./unused"}
        self.write_inputs()
        result = self.invoke("check")
        self.assertEqual(2, result.returncode, result.stderr)
        self.assertIn(
            "/localSkillSources/Bad~1Name",
            json.loads(result.stdout)["error"]["message"],
        )

    def test_map_type_errors_point_to_the_field_instead_of_its_value(self):
        for field in ("localSkillSources", "invocationPolicyOverrides"):
            with self.subTest(field=field):
                self.config = {
                    "schemaVersion": 1,
                    "targetAgents": ["codex"],
                    field: "bogus",
                }
                self.write_inputs()
                result = self.invoke("check")
                self.assertEqual(2, result.returncode, result.stdout + result.stderr)
                message = json.loads(result.stdout)["error"]["message"]
                self.assertIn(f"at /{field}:", message)
                self.assertNotIn(f"/{field}/bogus", message)
                self.assertFalse((self.root / ".agent-tools").exists())

    def test_local_plan_apply_is_exact_and_preserves_native_lock_and_unmanaged_skill(
        self,
    ):
        source = self.local_skill()
        lock_before = (self.root / "skills-lock.json").read_bytes()
        planned = self.invoke("plan", "--local-only")
        self.assertEqual(0, planned.returncode, planned.stdout + planned.stderr)
        plan_id = json.loads(planned.stdout)["planId"]
        self.assertFalse((self.root / ".agents/skills/team-conventions").exists())
        applied = self.invoke("apply", plan_id)
        self.assertEqual(0, applied.returncode, applied.stdout + applied.stderr)
        for target in [".agents/skills", ".claude/skills"]:
            tree = self.root / target / "team-conventions"
            self.assertEqual(
                (source / "SKILL.md").read_bytes(), (tree / "SKILL.md").read_bytes()
            )
            self.assertEqual(b"\x00\xff\x01", (tree / "asset.bin").read_bytes())
        policy = (
            self.root / ".agents/skills/team-conventions/agents/openai.yaml"
        ).read_text(encoding="utf-8")
        self.assertIn("allow_implicit_invocation: false", policy)
        self.assertFalse(
            (self.root / ".claude/skills/team-conventions/agents/openai.yaml").exists()
        )
        self.assertEqual(lock_before, (self.root / "skills-lock.json").read_bytes())
        self.assertEqual(
            b"unmanaged\x00",
            (self.root / ".agents/skills/unrelated/keep.bin").read_bytes(),
        )
        self.assertEqual(0, self.invoke("apply", plan_id).returncode)

    def test_apply_rejects_source_edit_after_review_without_publishing(self):
        source = self.local_skill()
        result = self.invoke("plan", "--local-only")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        plan_id = json.loads(result.stdout)["planId"]
        (source / "asset.bin").write_bytes(b"Changed after review")
        result = self.invoke("apply", plan_id)
        self.assertEqual(3, result.returncode, result.stdout + result.stderr)
        self.assertFalse((self.root / ".agents/skills/team-conventions").exists())

    def test_apply_rejects_candidate_tampering_and_escaping_plan_operand(self):
        self.local_skill()
        result = self.invoke("plan", "--local-only")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        plan_id = json.loads(result.stdout)["planId"]
        candidate = (
            self.root
            / ".agent-tools/skill-reconciliation/runs"
            / plan_id
            / "prepared/.agents/skills/team-conventions/asset.bin"
        )
        self.assertTrue(candidate.is_file())
        candidate.write_bytes(b"candidate tampered")
        self.assertEqual(3, self.invoke("apply", plan_id).returncode)
        self.assertEqual(2, self.invoke("apply", "../outside").returncode)
        self.assertFalse((self.root / ".agents/skills/team-conventions").exists())

    def test_plan_reports_empty_file_additions_and_file_output_collision(self):
        source = self.local_skill()
        (source / "empty.txt").write_bytes(b"")
        result = self.invoke("plan", "--local-only")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("Added empty file:", json.loads(result.stdout)["diff"])
        collision = self.root / ".agents/skills/team-conventions"
        collision.write_bytes(b"user-owned file")
        result = self.invoke("plan", "--local-only")
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        self.assertEqual(b"user-owned file", collision.read_bytes())

    def test_local_only_preserves_unsupported_native_provider_without_acquisition(self):
        self.lock["skills"]["unmanaged"] = {
            "source": "other/provider",
            "sourceType": "future-provider",
            "computedHash": "native-value",
            "providerExtension": {"retain": True},
        }
        self.write_inputs()
        result = self.invoke("check")
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        self.assertIn(
            "Unsupported native source type",
            json.loads(result.stdout)["error"]["message"],
        )
        self.local_skill()
        lock_before = (self.root / "skills-lock.json").read_bytes()
        result = self.invoke("plan", "--local-only")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        result = self.invoke("apply", json.loads(result.stdout)["planId"])
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(lock_before, (self.root / "skills-lock.json").read_bytes())

    def test_skill_file_only_ignore_does_not_authorize_unignored_assets(self):
        self.local_skill()
        (self.root / ".gitignore").write_text(
            ".agent-tools/\n.agents/skills/*/SKILL.md\n.claude/skills/\n",
            encoding="utf-8",
        )
        ignored = subprocess.run(
            [
                "git",
                "check-ignore",
                "--quiet",
                "--",
                ".agents/skills/team-conventions/SKILL.md",
            ],
            cwd=self.root,
            check=False,
        )
        visible = subprocess.run(
            [
                "git",
                "check-ignore",
                "--quiet",
                "--",
                ".agents/skills/team-conventions/asset.bin",
            ],
            cwd=self.root,
            check=False,
        )
        self.assertEqual(0, ignored.returncode)
        self.assertEqual(1, visible.returncode)
        result = self.invoke("plan", "--local-only")
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        self.assertFalse((self.root / ".agents/skills/team-conventions").exists())

    def test_native_lock_alone_supplies_remote_selections_and_optional_pin(self):
        self.lock["skills"]["example"] = {
            "source": "owner/repository",
            "sourceType": "github",
            "ref": "main",
            "computedHash": "a" * 64,
        }
        self.write_inputs()
        first = self.invoke("check")
        self.assertEqual(0, first.returncode, first.stdout + first.stderr)
        self.assertEqual(1, json.loads(first.stdout)["skills"])
        config_before = (self.root / "repository-skills.json").read_bytes()
        self.lock["skills"]["example"]["ref"] = "b" * 40
        self.write_inputs()
        pinned = self.invoke("check")
        self.assertEqual(0, pinned.returncode, pinned.stdout + pinned.stderr)
        self.assertEqual(
            config_before, (self.root / "repository-skills.json").read_bytes()
        )
        self.assertFalse((self.root / ".agents").exists())

    def test_dangling_policy_reference_fails_before_planning(self):
        self.config["invocationPolicyOverrides"] = {
            "missing": {"codex": "explicit-only"}
        }
        self.write_inputs()
        result = self.invoke("plan", "--local-only")
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        self.assertIn("unknown skills", json.loads(result.stdout)["error"]["message"])
        self.assertFalse((self.root / ".agent-tools").exists())

    def test_local_and_native_skill_identity_collision_is_not_an_override(self):
        self.local_skill()
        self.lock["skills"]["team-conventions"] = {
            "source": "owner/repository",
            "sourceType": "github",
            "computedHash": "a" * 64,
        }
        self.write_inputs()
        result = self.invoke("plan", "--local-only")
        self.assertEqual(3, result.returncode, result.stdout + result.stderr)
        self.assertIn(
            "conflicts with native", json.loads(result.stdout)["error"]["message"]
        )
        self.assertFalse((self.root / ".agent-tools").exists())

    def test_policy_target_must_be_selected_and_supported(self):
        self.local_skill()
        for target in ("antigravity", "claude-code"):
            with self.subTest(target=target):
                self.config["targetAgents"] = ["codex", "antigravity"]
                self.config["invocationPolicyOverrides"] = {
                    "team-conventions": {target: "explicit-only"}
                }
                self.write_inputs()
                result = self.invoke("plan", "--local-only")
                self.assertEqual(2, result.returncode, result.stdout + result.stderr)
                self.assertFalse((self.root / ".agent-tools").exists())


if __name__ == "__main__":
    unittest.main()
