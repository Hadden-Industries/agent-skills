"""Bounded subprocess ownership for ordinary Git/npm acquisition, without a sandbox."""

import ctypes
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

from .errors import ReconciliationError


class _WindowsJob:
    """Own normal tool descendants and wait for termination before returning to rollback."""

    def __init__(self):
        from ctypes import wintypes

        self.native = ctypes.WinDLL("kernel32", use_last_error=True)
        self.native.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.native.CreateJobObjectW.restype = wintypes.HANDLE
        self.native.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.native.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.native.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
        self.native.CloseHandle.argtypes = [wintypes.HANDLE]
        self.native.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.native.OpenProcess.restype = wintypes.HANDLE
        self.native.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.native.WaitForSingleObject.restype = wintypes.DWORD
        self.native.IsProcessInJob.argtypes = [wintypes.HANDLE, wintypes.HANDLE, ctypes.POINTER(wintypes.BOOL)]
        self.handle = self.native.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())

    def attach(self, process):
        """Attach immediately after launch; ordinary tooling, not hostile-process isolation."""
        if not self.native.AssignProcessToJobObject(self.handle, int(process._handle)):
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        """Wait on retained member handles: accounting-zero precedes handle teardown."""
        from ctypes import wintypes

        class Accounting(ctypes.Structure):
            _fields_ = [("user", ctypes.c_int64), ("kernel", ctypes.c_int64),
                        ("period_user", ctypes.c_int64), ("period_kernel", ctypes.c_int64),
                        ("faults", ctypes.c_uint32), ("total", ctypes.c_uint32),
                        ("active", ctypes.c_uint32), ("terminated", ctypes.c_uint32)]

        handles = []
        try:
            capacity = 64
            while True:
                # JOBOBJECT_BASIC_PROCESS_ID_LIST has two DWORDs then ULONG_PTRs.
                buffer = ctypes.create_string_buffer(8 + capacity * ctypes.sizeof(ctypes.c_size_t))
                if self.native.QueryInformationJobObject(self.handle, 3, buffer, len(buffer), None):
                    break
                if ctypes.get_last_error() != 234:  # ERROR_MORE_DATA
                    raise ctypes.WinError(ctypes.get_last_error())
                capacity *= 2
            count = ctypes.c_uint32.from_buffer(buffer, 4).value
            identifiers = (ctypes.c_size_t * count).from_buffer(buffer, 8)
            for identifier in identifiers:
                process_handle = self.native.OpenProcess(0x100000 | 0x1000, False, identifier)
                if process_handle:
                    member = wintypes.BOOL()
                    if not self.native.IsProcessInJob(process_handle, self.handle, ctypes.byref(member)):
                        self.native.CloseHandle(process_handle)
                        raise ctypes.WinError(ctypes.get_last_error())
                    if member.value:
                        handles.append(process_handle)
                    else:
                        self.native.CloseHandle(process_handle)
            if not self.native.TerminateJobObject(self.handle, 1):
                raise ctypes.WinError(ctypes.get_last_error())
            for process_handle in handles:
                if self.native.WaitForSingleObject(process_handle, 0xFFFFFFFF) != 0:
                    raise ctypes.WinError(ctypes.get_last_error())
            observation = Accounting()
            while True:
                if not self.native.QueryInformationJobObject(self.handle, 1, ctypes.byref(observation), ctypes.sizeof(observation), None):
                    raise ctypes.WinError(ctypes.get_last_error())
                if observation.active == 0:
                    break
                time.sleep(0.01)
        finally:
            # Also terminate on an observation failure; closing an ordinary job
            # handle alone does not stop its processes.
            self.native.TerminateJobObject(self.handle, 1)
            for process_handle in handles:
                self.native.CloseHandle(process_handle)
            self.native.CloseHandle(self.handle)


def run_command(arguments: list[str], cwd: Path, environment: dict | None = None) -> str:
    """Run tokenized argv, capture stdout, forward stderr and stop owned descendants.

    No shell, arbitrary universal command deadline or persistent host configuration is
    introduced. Commands complete or the caller interrupts. Acquisition runs before
    publication; process cleanup finishes before an exception is returned.
    """
    job = _WindowsJob() if os.name == "nt" else None
    process = None
    try:
        process = subprocess.Popen(
            list(map(str, arguments)), cwd=cwd, env=environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            start_new_session=os.name != "nt",
        )
        if job:
            job.attach(process)
        stdout, stderr = process.communicate()
        if stderr:
            print(stderr.rstrip(), file=sys.stderr)
        if process.returncode:
            # Avoid echoing a potentially credential-bearing remote URL in errors.
            raise ReconciliationError(f"{Path(arguments[0]).name} failed (exit {process.returncode}).")
        return stdout
    finally:
        try:
            if job:
                job.close()
            elif process:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        finally:
            if process:
                if process.poll() is None:
                    process.kill()
                process.wait()
                for stream in (process.stdout, process.stderr):
                    if stream:
                        stream.close()
