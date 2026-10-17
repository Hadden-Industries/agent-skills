"""Shared-resource behavior, with independently specified paths and bytes."""

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from test_cli import SOURCE, VENDOR

sys.path[:0] = [str(SOURCE), str(VENDOR)]

# Source and bundled dependencies must be bootstrapped before these imports.
from repository_skill_reconciliation.errors import ReconciliationError  # noqa: E402
from repository_skill_reconciliation.shared_resources import normalize_shared_resources  # noqa: E402


class SharedResourcesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="repository-skills-shared-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.skill = self.source / "skills" / "example"
        self.shared = self.source / "skills" / "_shared"
        self.skill.mkdir(parents=True)
        self.shared.mkdir()
        self.output = self.root / "output"

    def write(self, path, contents):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(contents if isinstance(contents, bytes) else contents.encode())

    def materialize(self):
        shutil.copytree(self.skill, self.output)

    def test_nested_paths_binary_resources_and_nonreferences(self):
        self.write(
            self.skill / "SKILL.md",
            "[Guide](../_shared/guide.md#rules)\nLiteral prose ../_shared stays.\n",
        )
        self.write(
            self.skill / "docs" / "detail.md", "Read `../../_shared/guide.md`.\n"
        )
        self.write(
            self.shared / "guide.md",
            "![Image](images/chart.bin)\n[Back](../example/docs/detail.md)\n",
        )
        binary = bytes(range(256))
        self.write(self.shared / "images" / "chart.bin", binary)
        self.materialize()

        changes = normalize_shared_resources(self.output, self.skill, self.source)

        self.assertEqual(
            self.output.joinpath("SKILL.md").read_text(),
            "[Guide](references/_shared/guide.md#rules)\nLiteral prose ../_shared stays.\n",
        )
        self.assertEqual(
            self.output.joinpath("docs/detail.md").read_text(),
            "Read `../references/_shared/guide.md`.\n",
        )
        self.assertEqual(
            self.output.joinpath("references/_shared/guide.md").read_text(),
            "![Image](images/chart.bin)\n[Back](../../docs/detail.md)\n",
        )
        self.assertEqual(
            self.output.joinpath("references/_shared/images/chart.bin").read_bytes(),
            binary,
        )
        self.assertIn("../_shared", self.skill.joinpath("SKILL.md").read_text())
        self.assertTrue(changes)

    def test_markdown_reference_definition_html_and_encoded_path(self):
        self.write(
            self.skill / "SKILL.md",
            '[doc]: <../_shared/a%20b.md> "Title"\n<img src="../_shared/image.bin">\nhttps://example.test/../_shared/guide\n',
        )
        self.write(self.shared / "a b.md", "# Resource\n")
        self.write(self.shared / "image.bin", b"\x00\xff")
        self.materialize()
        normalize_shared_resources(self.output, self.skill, self.source)
        value = self.output.joinpath("SKILL.md").read_text()
        self.assertIn('[doc]: <references/_shared/a%20b.md> "Title"', value)
        self.assertIn('src="references/_shared/image.bin"', value)
        self.assertIn("https://example.test/../_shared/guide", value)

    def test_missing_resource_fails_before_any_rewrite_or_copy(self):
        original = "[Missing](../_shared/absent.md)\n"
        self.write(self.skill / "SKILL.md", original)
        self.materialize()
        with self.assertRaises(ReconciliationError):
            normalize_shared_resources(self.output, self.skill, self.source)
        self.assertEqual(self.output.joinpath("SKILL.md").read_text(), original)
        self.assertFalse(self.output.joinpath("references").exists())

    def test_escape_from_snapshot_rejected(self):
        self.write(self.skill / "SKILL.md", "[Outside](../../../_shared/private.md)\n")
        self.write(self.root / "_shared" / "private.md", "outside")
        self.materialize()
        with self.assertRaises(ReconciliationError):
            normalize_shared_resources(self.output, self.skill, self.source)
        self.assertFalse(self.output.joinpath("references").exists())

    def test_existing_vendor_destination_is_not_overwritten(self):
        self.write(self.skill / "SKILL.md", "`../_shared/guide.md`\n")
        self.write(self.skill / "references" / "_shared" / "owned.md", "preserve")
        self.write(self.shared / "guide.md", "new")
        self.materialize()
        with self.assertRaises(ReconciliationError):
            normalize_shared_resources(self.output, self.skill, self.source)
        self.assertEqual(
            self.output.joinpath("references/_shared/owned.md").read_text(), "preserve"
        )

    def test_broken_transitive_reference_fails_before_writes(self):
        self.write(self.skill / "SKILL.md", "[Guide](../_shared/guide.md)\n")
        self.write(self.shared / "guide.md", "[Missing](images/missing.png)\n")
        self.materialize()
        with self.assertRaises(ReconciliationError):
            normalize_shared_resources(self.output, self.skill, self.source)
        self.assertFalse(self.output.joinpath("references").exists())

    def test_no_shared_references_is_byte_preserving(self):
        original = b"# Example\r\nMention ../_shared in ordinary prose.\r\n"
        self.write(self.skill / "SKILL.md", original)
        self.materialize()
        self.assertEqual(
            normalize_shared_resources(self.output, self.skill, self.source), []
        )
        self.assertEqual(self.output.joinpath("SKILL.md").read_bytes(), original)

    def test_distinct_shared_roots_do_not_overwrite_each_other(self):
        self.write(
            self.skill / "SKILL.md",
            "[One](../_shared/one.md)\n[Two](../../_shared/two.md)\n",
        )
        self.write(self.shared / "one.md", "one")
        self.write(self.source / "_shared" / "two.md", "two")
        self.materialize()
        normalize_shared_resources(self.output, self.skill, self.source)
        self.assertEqual(
            sorted(
                path.read_text()
                for path in self.output.joinpath("references").rglob("*.md")
            ),
            ["one", "two"],
        )

    def test_hardlinked_shared_resource_is_rejected_without_mutation(self):
        self.write(self.skill / "SKILL.md", "[Guide](../_shared/guide.md)\n")
        outside = self.root / "outside.md"
        self.write(outside, "preserve")
        os.link(outside, self.shared / "guide.md")
        self.materialize()
        with self.assertRaises(ReconciliationError):
            normalize_shared_resources(self.output, self.skill, self.source)
        self.assertEqual(outside.read_text(), "preserve")
        self.assertFalse(self.output.joinpath("references").exists())


if __name__ == "__main__":
    unittest.main()
