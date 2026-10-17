"""Exercise real descendant termination before the subprocess boundary returns."""

import ctypes
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_cli import SOURCE

sys.path.insert(0, str(SOURCE))

from repository_skill_reconciliation.processes import run_command


class ProcessOwnershipTests(unittest.TestCase):
    """Native child processes are the fixture, not a fabricated process mock."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="skill-child-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def assert_child_stopped(self, pid):
        if os.name == "nt":
            from ctypes import wintypes

            native = ctypes.WinDLL("kernel32", use_last_error=True)
            native.OpenProcess.argtypes = [
                wintypes.DWORD,
                wintypes.BOOL,
                wintypes.DWORD,
            ]
            native.OpenProcess.restype = wintypes.HANDLE
            native.GetExitCodeProcess.argtypes = [
                wintypes.HANDLE,
                ctypes.POINTER(wintypes.DWORD),
            ]
            native.CloseHandle.argtypes = [wintypes.HANDLE]
            handle = native.OpenProcess(0x1000, False, pid)
            if handle:
                try:
                    code = wintypes.DWORD()
                    self.assertTrue(
                        native.GetExitCodeProcess(handle, ctypes.byref(code))
                    )
                    self.assertNotEqual(259, code.value, "descendant still active")
                finally:
                    native.CloseHandle(handle)
        else:
            state = Path(f"/proc/{pid}/stat")
            if state.exists():
                self.assertEqual(
                    "Z", state.read_text().split()[2], "descendant still active"
                )
        self.assertFalse((self.root / "late-write").exists())

    def parent_command(self):
        child = "import pathlib,time; time.sleep(30); pathlib.Path('late-write').write_text('unexpected')"
        parent = "import subprocess,sys; p=subprocess.Popen([sys.executable,'-c',sys.argv[1]],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); print(p.pid,flush=True)"
        return [sys.executable, "-c", parent, child]

    def test_orphan_descendant_is_stopped_before_success_returns(self):
        output = run_command(self.parent_command(), self.root)
        pid = int(output.strip())
        self.assertGreater(pid, 0)
        self.assert_child_stopped(pid)

    def test_interrupt_stops_started_descendant_before_propagating(self):
        pid = None

        def interrupt_after_child_started(process, *args, **kwargs):
            nonlocal pid
            pid = int(process.stdout.readline().strip())
            raise KeyboardInterrupt()

        with patch.object(
            subprocess.Popen, "communicate", interrupt_after_child_started
        ):
            with self.assertRaises(KeyboardInterrupt):
                run_command(self.parent_command(), self.root)
        self.assertIsNotNone(pid)
        self.assert_child_stopped(pid)
