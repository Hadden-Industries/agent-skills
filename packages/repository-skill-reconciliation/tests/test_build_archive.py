"""Dependency RECORD validation and deployed archive member/content integrity."""

import base64
import csv
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

PACKAGE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("repository_skills_archive_builder", PACKAGE / "build_archive.py")
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class ArchiveDependencyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="repository-skills-archive-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.vendor = self.root / "vendor"
        self.vendor.mkdir()
        # Small independent installed-distribution fixtures use the standard
        # RECORD format; they are never imported as real dependency code.
        for name, version, module in (
            ("fastjsonschema", "2.22.2", "fastjsonschema/__init__.py"),
            ("portalocker", "4.4.0", "portalocker/__init__.py"),
            ("ruamel.yaml", "0.19.1", "ruamel/yaml/__init__.py"),
        ):
            metadata = f"{name.replace('.', '_')}-{version}.dist-info"
            members = {
                module: b"# Independent package payload fixture.\n",
                metadata + "/METADATA": f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n".encode(),
                metadata + "/LICENSE": b"Original fixture license bytes.\n",
            }
            for relative, data in members.items():
                path = self.vendor / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            with (self.vendor / metadata / "RECORD").open("w", encoding="utf-8", newline="") as stream:
                writer = csv.writer(stream)
                for relative, data in members.items():
                    checksum = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("=")
                    writer.writerow([relative, "sha256=" + checksum, len(data)])
                writer.writerow([metadata + "/RECORD", "", ""])
        self.archive = self.root / "repository-skills.pyz"

    def build(self):
        builder.build(self.archive, self.vendor)
        builder.check(self.archive)

    def altered_archive(self, *, remove=None, alter=None, extra=None):
        self.build()
        target = self.root / "altered.pyz"
        with zipfile.ZipFile(self.archive) as original, zipfile.ZipFile(target, "w") as changed:
            for member in original.infolist():
                if member.filename == remove:
                    continue
                data = original.read(member.filename)
                if member.filename == alter:
                    data += b"# Changed after build.\n"
                changed.writestr(member, data)
            if extra:
                changed.writestr(extra, b"unexpected executable bytes\n")
        return target

    def test_valid_recorded_dependencies_build_deterministically(self):
        self.build()
        before = self.archive.read_bytes()
        self.build()
        self.assertEqual(before, self.archive.read_bytes())

    def test_changed_vendor_source_is_rejected_before_output(self):
        path = self.vendor / "fastjsonschema/__init__.py"
        path.write_bytes(path.read_bytes() + b"# Modified after installation.\n")
        with self.assertRaises(ValueError):
            builder.build(self.archive, self.vendor)
        self.assertFalse(self.archive.exists())

    def test_unowned_vendor_file_is_rejected(self):
        (self.vendor / "unexpected.py").write_bytes(b"unowned bytes\n")
        with self.assertRaises(ValueError):
            builder.build(self.archive, self.vendor)
        self.assertFalse(self.archive.exists())

    def test_changed_dependency_bytes_are_rejected(self):
        target = self.altered_archive(alter="fastjsonschema/__init__.py")
        with self.assertRaises(ValueError):
            builder.check(target)

    def test_missing_dependency_module_is_rejected(self):
        target = self.altered_archive(remove="fastjsonschema/__init__.py")
        with self.assertRaises(ValueError):
            builder.check(target)

    def test_additional_dependency_member_is_rejected(self):
        target = self.altered_archive(extra="fastjsonschema/unexpected.py")
        with self.assertRaises(ValueError):
            builder.check(target)
