"""No-network negative controls for the explicit frozen bootstrap."""
import io
import hashlib
import json
import os
import platform
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from _commands import SetupError
import set_up_evaluation_execution_tools as bootstrap
from set_up_evaluation_execution_tools import archive_files


class ArchiveBoundaryTests(unittest.TestCase):
    def test_old_python_is_rejected_before_acquisition(self):
        with patch.object(sys, "version_info", (3, 14, 7)), \
             patch.object(bootstrap.urllib.request, "urlopen") as download, \
             patch.object(bootstrap.subprocess, "run") as execute:
            with self.assertRaisesRegex(SetupError, "Python 3.14.8 or newer"):
                bootstrap.main({})
            download.assert_not_called()
            execute.assert_not_called()

    def test_failed_download_records_observed_identity_before_execution(self):
        with tempfile.TemporaryDirectory(prefix="bootstrap-negative-") as directory:
            root = Path(directory)
            machine = platform.machine().lower()
            arch = "x64" if machine in ("amd64", "x86_64") else machine
            system = "win32" if os.name == "nt" else platform.system().lower()
            manifest = {"schemaVersion": 1, "skillUp": {"version": "0.12.0", "platforms": {
                f"{system}-{arch}": {"archive": "fixture.zip", "byteLength": 2, "sha256": "0" * 64}
            }}}
            (root / "evaluation-toolchain.json").write_text(json.dumps(manifest), encoding="utf-8")
            context = {}
            with patch.object(bootstrap, "__file__", str(root / "scripts" / "installer.py")), \
                 patch.object(bootstrap.urllib.request, "urlopen", return_value=io.BytesIO(b"x")), \
                 patch.object(bootstrap.subprocess, "run") as execute:
                with self.assertRaisesRegex(SetupError, "reviewed length/SHA-256"):
                    bootstrap.main(context)
                execute.assert_not_called()
            self.assertEqual(context["observedByteLength"], 1)
            self.assertEqual(context["observedSha256"], hashlib.sha256(b"x").hexdigest())
            self.assertEqual(context["expectedByteLength"], 2)
            self.assertFalse((root / ".agent-tools").exists())

    def test_flat_regular_zip_bytes_survive(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("LICENSE", b"exact\r\nbytes\x00")
        self.assertEqual(archive_files(data.getvalue(), "test.zip"),
                         {"LICENSE": b"exact\r\nbytes\x00"})

    def test_zip_traversal_is_rejected_without_extraction(self):
        for name in ("../escape", "/absolute", "nested/file", "nested\\file"):
            with self.subTest(name=name):
                data = io.BytesIO()
                with zipfile.ZipFile(data, "w") as archive:
                    archive.writestr(name, b"untrusted")
                with self.assertRaises(SetupError):
                    archive_files(data.getvalue(), "test.zip")

    def test_tar_links_are_rejected_without_following(self):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w:gz") as archive:
            member = tarfile.TarInfo("LICENSE")
            member.type = tarfile.SYMTYPE
            member.linkname = "../outside"
            archive.addfile(member)
        with self.assertRaises(SetupError):
            archive_files(data.getvalue(), "test.tar.gz")


if __name__ == "__main__":
    unittest.main()
