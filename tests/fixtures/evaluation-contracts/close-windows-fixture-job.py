"""Reconcile a deliberately faulty, task-owned test job after retaining survivors."""
import ctypes as c
from ctypes import wintypes as w
import json
import re
import sys

name = sys.argv[1]
if not re.fullmatch(r"Local\\HaddenEvaluation-[a-f0-9-]{36}", name):
    raise ValueError("Unexpected fixture job name")
kernel = c.WinDLL("kernel32", use_last_error=True)
kernel.OpenJobObjectW.argtypes = [w.DWORD, w.BOOL, w.LPCWSTR]
kernel.OpenJobObjectW.restype = w.HANDLE
kernel.TerminateJobObject.argtypes = [w.HANDLE, w.UINT]
kernel.CloseHandle.argtypes = [w.HANDLE]
job = kernel.OpenJobObjectW(8, False, name)  # terminate only, never inherited
if not job:
    if c.get_last_error() != 2:
        raise c.WinError(c.get_last_error())
    print(json.dumps({"jobName": name, "status": "already-absent"}))
else:
    try:
        if not kernel.TerminateJobObject(job, 124):
            raise c.WinError(c.get_last_error())
        print(json.dumps({"jobName": name, "status": "cleanup-termination-requested"}))
    finally:
        kernel.CloseHandle(job)
