"""Native metadata projections preserve unrelated meaning and distinguish agent capabilities."""

from pathlib import Path
import sys
import tempfile
import unittest

from test_cli import SOURCE, VENDOR

sys.path[:0] = [str(SOURCE), str(VENDOR)]

from ruamel.yaml import YAML
from repository_skill_reconciliation.errors import ReconciliationError
from repository_skill_reconciliation.invocation_policy import project_invocation_policy


class InvocationPolicyTests(unittest.TestCase):
    """Use independently specified native fields and body bytes as the oracle."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="skill-policy-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "agents").mkdir()
        (self.root / "SKILL.md").write_text("---\nname: example\ndescription: Example\nuser-invocable: true\n---\nBody with punctuation: —\n", encoding="utf-8")

    def test_codex_changes_one_field_and_preserves_other_metadata(self):
        path = self.root / "agents/openai.yaml"
        path.write_text("# retained comment\ninterface:\n  display_name: Example\npolicy:\n  allow_implicit_invocation: true\n  retained: yes\ndependencies:\n  tools: []\n", encoding="utf-8")
        before = (self.root / "SKILL.md").read_bytes()
        project_invocation_policy(self.root, {"codex": "explicit-only"})
        text = path.read_text(encoding="utf-8")
        parsed = YAML(typ="safe", pure=True).load(text)
        self.assertFalse(parsed["policy"]["allow_implicit_invocation"])
        self.assertEqual("yes", parsed["policy"]["retained"])
        self.assertEqual({"display_name": "Example"}, parsed["interface"])
        self.assertEqual({"tools": []}, parsed["dependencies"])
        self.assertIn("# retained comment", text)
        self.assertEqual(before, (self.root / "SKILL.md").read_bytes())

    def test_claude_projection_preserves_body_and_rejects_disabled_manual_invocation(self):
        path = self.root / "SKILL.md"
        body = path.read_text(encoding="utf-8").split("---\n", 2)[2]
        project_invocation_policy(self.root, {"claude-code": "explicit-only"})
        text = path.read_text(encoding="utf-8")
        self.assertIn("disable-model-invocation: true", text)
        self.assertEqual(body, text.split("---\n", 2)[2])
        text = text.replace("user-invocable: true", "user-invocable: false")
        path.write_text(text, encoding="utf-8")
        before = path.read_bytes()
        with self.assertRaises(ReconciliationError):
            project_invocation_policy(self.root, {"claude-code": "explicit-only"})
        self.assertEqual(before, path.read_bytes())

    def test_omission_preserves_explicit_source_policy_and_metadata_bytes(self):
        path = self.root / "agents/openai.yaml"
        path.write_bytes(b"policy:\n  allow_implicit_invocation: false\n")
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        project_invocation_policy(self.root, {})
        self.assertEqual(before, {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()})

    def test_duplicate_native_metadata_keys_fail_instead_of_being_discarded(self):
        path = self.root / "agents/openai.yaml"
        path.write_text("policy: {}\npolicy: {}\n", encoding="utf-8")
        with self.assertRaises(ReconciliationError):
            project_invocation_policy(self.root, {"codex": "implicit-allowed"})

    def test_claude_preserves_crlf_body_bytes(self):
        path = self.root / "SKILL.md"
        body = b"First line.\r\nSecond line.\r\n\r\nFinal line.\r\n"
        path.write_bytes(b"---\r\nname: example\r\ndescription: Example\r\n---\r\n" + body)
        self.assertTrue(path.read_bytes().endswith(body))
        project_invocation_policy(self.root, {"claude-code": "explicit-only"})
        result = path.read_bytes()
        self.assertIn(b"disable-model-invocation: true", result)
        self.assertTrue(result.endswith(body), result)
