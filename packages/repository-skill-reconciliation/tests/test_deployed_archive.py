"""Producer-owned conformance tests for the independently deployed archive."""

import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


class DeployedArchiveTests(unittest.TestCase):
    """Exercise the deployed archive independently of producer imports."""

    repository_root = Path(__file__).resolve().parents[3]

    @classmethod
    def validate_runtime(cls):
        """Retain the producer repository's prescribed Python runtime."""
        sys.path.insert(0, str(cls.repository_root / "scripts"))
        try:
            from _commands import require_python_version

            require_python_version()
        finally:
            sys.path.pop(0)

    def setUp(self):
        self.validate_runtime()
        self.archive = self.repository_root / "tools" / "repository-skills.pyz"

    def invoke(self, root, *arguments):
        """Run the independently deployed artifact in isolated Python mode."""
        return subprocess.run(
            [sys.executable, "-I", "-B", str(self.archive), "--json", *arguments],
            cwd=root,
            text=True,
            encoding="utf-8",
            capture_output=True,
            check=False,
        )

    def test_native_declarations_and_additional_options_validate_without_installed_outputs(
        self,
    ):
        result = self.invoke(self.repository_root, "check")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        response = json.loads(result.stdout)
        self.assertEqual("checked", response["status"])
        self.assertEqual(1, response["schemaVersion"])
        # The deployed artifact must carry executable source, its license and its
        # own dependencies; no path into a sibling source checkout is admitted.
        with zipfile.ZipFile(self.archive) as archive:
            for member in (
                "__main__.py",
                "LICENSE",
                "THIRD_PARTY_NOTICES.md",
                "BUILD.json",
                "repository_skill_reconciliation/cli.py",
                "fastjsonschema/__init__.py",
                "portalocker/__init__.py",
                "ruamel/yaml/__init__.py",
            ):
                self.assertIn(member, archive.namelist())

    def test_print_config_schema_is_available_without_consumer_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = self.invoke(Path(temporary), "print-config-schema")
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            schema = json.loads(result.stdout)
            self.assertEqual(["schemaVersion", "targetAgents"], schema["required"])
            self.assertEqual(1, schema["properties"]["schemaVersion"]["const"])
            self.assertNotIn("agents", schema["properties"])
            self.assertEqual([], list(Path(temporary).iterdir()))

    def test_independent_archive_local_roundtrip_preserves_unmanaged_bytes(self):
        with tempfile.TemporaryDirectory(
            prefix="repository-skill-consumer-"
        ) as temporary:
            root = Path(temporary)
            subprocess.run(["git", "init", "--quiet", str(root)], check=True)
            (root / ".gitignore").write_text(
                ".agent-tools/\n.agents/skills/\n.claude/skills/\n", encoding="utf-8"
            )
            source = root / "skills" / "example"
            source.mkdir(parents=True)
            source_bytes = b"---\nname: example\ndescription: Local consumer example\n---\nKeep source text.\n"
            (source / "SKILL.md").write_bytes(source_bytes)
            (source / "binary.bin").write_bytes(b"\x00\xffconsumer")
            config = {
                "schemaVersion": 1,
                "targetAgents": ["codex", "claude-code"],
                "localSkillSources": {"example": "./skills/example"},
            }
            (root / "repository-skills.json").write_text(
                json.dumps(config), encoding="utf-8"
            )
            lock_bytes = b'{"version":1,"skills":{}}\n'
            (root / "skills-lock.json").write_bytes(lock_bytes)
            unrelated = root / ".agents" / "skills" / "unmanaged"
            unrelated.mkdir(parents=True)
            (unrelated / "keep.txt").write_bytes(b"leave alone")
            result = self.invoke(root, "plan", "--local-only")
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            plan_id = json.loads(result.stdout)["planId"]
            self.assertFalse((root / ".agents/skills/example").exists())
            result = self.invoke(root, "apply", plan_id)
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            for prefix in (".agents/skills", ".claude/skills"):
                self.assertEqual(
                    source_bytes, (root / prefix / "example/SKILL.md").read_bytes()
                )
                self.assertEqual(
                    b"\x00\xffconsumer",
                    (root / prefix / "example/binary.bin").read_bytes(),
                )
            self.assertEqual(lock_bytes, (root / "skills-lock.json").read_bytes())
            self.assertEqual(b"leave alone", (unrelated / "keep.txt").read_bytes())
