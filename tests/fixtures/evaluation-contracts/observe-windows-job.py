"""Query a prepared job without retaining a handle that would extend its lifetime."""
import ctypes as c
from ctypes import wintypes as w
import json
import sys

kernel = c.WinDLL("kernel32", use_last_error=True)
kernel.OpenJobObjectW.argtypes = [w.DWORD, w.BOOL, w.LPCWSTR]
kernel.OpenJobObjectW.restype = w.HANDLE
kernel.QueryInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p]
kernel.CloseHandle.argtypes = [w.HANDLE]
kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
kernel.OpenProcess.restype = w.HANDLE
kernel.GetProcessTimes.argtypes = [w.HANDLE, c.POINTER(w.FILETIME), c.POINTER(w.FILETIME), c.POINTER(w.FILETIME), c.POINTER(w.FILETIME)]
kernel.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, c.POINTER(w.DWORD)]
kernel.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
kernel.CreateToolhelp32Snapshot.restype = w.HANDLE


class Entry(c.Structure):
    _fields_ = [("size", w.DWORD), ("usage", w.DWORD), ("pid", w.DWORD),
                ("heap", c.c_size_t), ("module", w.DWORD), ("threads", w.DWORD),
                ("parent", w.DWORD), ("priority", w.LONG), ("flags", w.DWORD),
                ("name", w.WCHAR * 260)]


kernel.Process32FirstW.argtypes = [w.HANDLE, c.POINTER(Entry)]
kernel.Process32NextW.argtypes = [w.HANDLE, c.POINTER(Entry)]
snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
if snapshot == c.c_void_p(-1).value:
    raise c.WinError(c.get_last_error())
parents = {}
try:
    entry = Entry()
    entry.size = c.sizeof(entry)
    success = kernel.Process32FirstW(snapshot, c.byref(entry))
    while success:
        parents[entry.pid] = entry.parent
        success = kernel.Process32NextW(snapshot, c.byref(entry))
finally:
    kernel.CloseHandle(snapshot)

job = kernel.OpenJobObjectW(4, False, sys.argv[1])
if not job:
    raise c.WinError(c.get_last_error())
try:
    buffer = c.create_string_buffer(65536)
    if not kernel.QueryInformationJobObject(job, 3, buffer, len(buffer), None):
        raise c.WinError(c.get_last_error())
    assigned, count = (w.DWORD * 2).from_buffer(buffer)
    if count > (len(buffer) - 8) // c.sizeof(c.c_size_t) or assigned != count:
        raise RuntimeError("Incomplete job process inventory")
    pids = list((c.c_size_t * count).from_buffer(buffer, 8))
finally:
    kernel.CloseHandle(job)

def identity(pid):
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        raise c.WinError(c.get_last_error())
    try:
        times = [w.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(handle, *(c.byref(value) for value in times)):
            raise c.WinError(c.get_last_error())
        length = w.DWORD(32768)
        image = c.create_unicode_buffer(length.value)
        if not kernel.QueryFullProcessImageNameW(handle, 0, image, c.byref(length)):
            raise c.WinError(c.get_last_error())
        return {"pid": pid, "parentPid": parents[pid],
                "creationFileTime": str((times[0].dwHighDateTime << 32) | times[0].dwLowDateTime),
                "image": image.value}
    finally:
        kernel.CloseHandle(handle)
processes = [identity(pid) for pid in pids]
outside_parents = set(parents[pid] for pid in pids) - set(pids)
print(json.dumps({"schemaVersion": 1, "jobName": sys.argv[1], "processes": processes,
                 "outsideParents": [identity(pid) for pid in outside_parents]}))
