"""One invocation, one non-breakaway Windows job. No provider authority lives here."""

import ctypes as c
from ctypes import wintypes as w
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate invocation key")
        result[key] = value
    return result


def main():
    if sys.platform != "win32":
        raise RuntimeError("Windows job host requires Windows")
    # Use the same unbuffered descriptor for framing and liveness, so read-ahead
    # cannot hide unexpected control bytes from the watcher.
    line = b""
    while not line.endswith(b"\n"):
        chunk = os.read(sys.stdin.fileno(), 4096)
        if not chunk:
            raise ValueError("Incomplete invocation frame")
        line += chunk
        if len(line) > 262144 or b"\n" in line[:-1]:
            raise ValueError("Invalid invocation framing")
    spec = json.loads(line, object_pairs_hook=unique)
    if set(spec) != {"executable", "sha256", "argv", "cwd", "env", "timeoutMs", "resultPath", "jobName"}:
        raise ValueError("Invalid invocation fields")
    if not isinstance(spec["jobName"], str) or not re.fullmatch(r"Local\\HaddenEvaluation-[a-f0-9-]{36}", spec["jobName"]):
        raise ValueError("Invalid job identity")
    for field in ("executable", "cwd", "resultPath"):
        if not isinstance(spec[field], str) or not os.path.isabs(spec[field]) or "\0" in spec[field]:
            raise ValueError("Expected absolute invocation path")
    if not isinstance(spec["argv"], list) or not all(isinstance(a, str) and "\0" not in a for a in spec["argv"]):
        raise ValueError("Invalid argument vector")
    if not isinstance(spec["env"], dict) or not all(isinstance(k, str) and k and "=" not in k and "\0" not in k and isinstance(v, str) and "\0" not in v for k, v in spec["env"].items()):
        raise ValueError("Invalid environment")
    if type(spec["timeoutMs"]) is not int or not 1 <= spec["timeoutMs"] <= 86400000:
        raise ValueError("Invalid deadline")
    with open(spec["executable"], "rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != spec["sha256"]:
            raise ValueError("Executable identity drift")
    # Reserve the observation before creating any workload. A crashed host leaves
    # an empty record, which is unknown, never successful closure evidence.
    result = open(spec["resultPath"], "x", encoding="utf-8")
    kernel = c.WinDLL("kernel32", use_last_error=True)
    size = c.c_size_t

    class STARTUPINFO(c.Structure):
        _fields_ = [("cb", w.DWORD), ("reserved", w.LPWSTR), ("desktop", w.LPWSTR), ("title", w.LPWSTR), ("x", w.DWORD), ("y", w.DWORD), ("xSize", w.DWORD), ("ySize", w.DWORD), ("xChars", w.DWORD), ("yChars", w.DWORD), ("fill", w.DWORD), ("flags", w.DWORD), ("show", w.WORD), ("reservedSize", w.WORD), ("reservedBytes", c.POINTER(w.BYTE)), ("stdin", w.HANDLE), ("stdout", w.HANDLE), ("stderr", w.HANDLE)]

    class STARTUPINFOEX(c.Structure):
        _fields_ = [("startup", STARTUPINFO), ("attributes", c.c_void_p)]

    class PROCESSINFO(c.Structure):
        _fields_ = [("process", w.HANDLE), ("thread", w.HANDLE), ("pid", w.DWORD), ("tid", w.DWORD)]

    class LIMIT(c.Structure):
        _fields_ = [("processTime", c.c_int64), ("jobTime", c.c_int64), ("flags", w.DWORD), ("minWorkingSet", size), ("maxWorkingSet", size), ("activeLimit", w.DWORD), ("affinity", size), ("priority", w.DWORD), ("scheduling", w.DWORD)]

    class IO(c.Structure):
        _fields_ = [(name, c.c_uint64) for name in ("readOps", "writeOps", "otherOps", "readBytes", "writeBytes", "otherBytes")]

    class EXTENDEDLIMIT(c.Structure):
        _fields_ = [("basic", LIMIT), ("io", IO), ("processMemory", size), ("jobMemory", size), ("peakProcess", size), ("peakJob", size)]

    class ACCOUNTING(c.Structure):
        _fields_ = [(name, c.c_int64) for name in ("user", "kernel", "periodUser", "periodKernel")] + [(name, w.DWORD) for name in ("faults", "total", "active", "terminated")]

    def api(name, restype, *args):
        function = getattr(kernel, name)
        function.restype = restype
        function.argtypes = args
        return function

    def checked(value):
        if not value:
            raise c.WinError(c.get_last_error())
        return value

    create_job = api("CreateJobObjectW", w.HANDLE, c.c_void_p, w.LPCWSTR)
    close = api("CloseHandle", w.BOOL, w.HANDLE)
    set_job = api("SetInformationJobObject", w.BOOL, w.HANDLE, c.c_int, c.c_void_p, w.DWORD)
    query_job = api("QueryInformationJobObject", w.BOOL, w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p)
    terminate = api("TerminateJobObject", w.BOOL, w.HANDLE, w.UINT)
    initialize = api("InitializeProcThreadAttributeList", w.BOOL, c.c_void_p, w.DWORD, w.DWORD, c.POINTER(size))
    update = api("UpdateProcThreadAttribute", w.BOOL, c.c_void_p, w.DWORD, size, c.c_void_p, size, c.c_void_p, c.c_void_p)
    delete = api("DeleteProcThreadAttributeList", None, c.c_void_p)
    create = api("CreateProcessW", w.BOOL, w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL, w.DWORD, c.c_void_p, w.LPCWSTR, c.POINTER(STARTUPINFOEX), c.POINTER(PROCESSINFO))
    wait = api("WaitForSingleObject", w.DWORD, w.HANDLE, w.DWORD)
    exit_code = api("GetExitCodeProcess", w.BOOL, w.HANDLE, c.POINTER(w.DWORD))
    current = api("GetCurrentProcess", w.HANDLE)
    duplicate = api("DuplicateHandle", w.BOOL, w.HANDLE, w.HANDLE, w.HANDLE, c.POINTER(w.HANDLE), w.DWORD, w.BOOL, w.DWORD)
    import msvcrt

    lost_parent = threading.Event()

    def watch_parent():
        # EOF and unexpected control bytes both revoke lifecycle ownership.
        try:
            os.read(sys.stdin.fileno(), 1)
        finally:
            lost_parent.set()

    threading.Thread(target=watch_parent, daemon=True).start()
    job = checked(create_job(None, spec["jobName"]))  # non-inheritable
    if c.get_last_error() == 183:
        close(job)
        raise RuntimeError("Prepared job already exists")
    handles = []
    attributes = None
    attributes_initialized = False
    info = PROCESSINFO()
    started = time.monotonic()
    try:
        limits = EXTENDEDLIMIT()
        limits.basic.flags = 0x2000  # KILL_ON_JOB_CLOSE, no breakaway flags
        checked(set_job(job, 9, c.byref(limits), c.sizeof(limits)))
        with open(os.devnull, "rb") as null:
            for stream in (null, sys.stdout, sys.stderr):
                handle = w.HANDLE()
                checked(duplicate(current(), msvcrt.get_osfhandle(stream.fileno()), current(), c.byref(handle), 0, True, 2))
                handles.append(handle.value)
        amount = size()
        initialize(None, 2, 0, c.byref(amount))
        attributes = c.create_string_buffer(amount.value)
        checked(initialize(attributes, 2, 0, c.byref(amount)))
        attributes_initialized = True
        jobs = (w.HANDLE * 1)(job)
        streams = (w.HANDLE * 3)(*handles)
        checked(update(attributes, 0, 0x2000D, jobs, c.sizeof(jobs), None, None))
        checked(update(attributes, 0, 0x20002, streams, c.sizeof(streams), None, None))
        startup = STARTUPINFOEX()
        startup.startup.cb = c.sizeof(startup)
        startup.startup.flags = 0x100  # STARTF_USESTDHANDLES
        startup.startup.stdin, startup.startup.stdout, startup.startup.stderr = handles
        startup.attributes = c.cast(attributes, c.c_void_p)
        command = c.create_unicode_buffer(subprocess.list2cmdline([spec["executable"], *spec["argv"]]))
        environment = c.create_unicode_buffer("\0".join(f"{k}={v}" for k, v in sorted(spec["env"].items(), key=lambda item: item[0].upper())) + "\0\0")
        if lost_parent.is_set():
            raise RuntimeError("Parent lost before creation")
        # Assignment is atomic with creation. There is never a suspended process
        # outside the owned job for a dying host to abandon.
        checked(create(spec["executable"], command, None, None, True, 0x80000 | 0x400 | 0x8000000, environment, spec["cwd"], c.byref(startup), c.byref(info)))
        reason = "consumer-exit"
        while True:
            state = wait(info.process, 20)
            if state == 0:
                break
            if state != 258:
                raise c.WinError(c.get_last_error())
            if lost_parent.is_set():
                reason = "parent-loss"
                break
            if (time.monotonic() - started) * 1000 >= spec["timeoutMs"]:
                reason = "deadline"
                break
        code = w.DWORD()
        checked(exit_code(info.process, c.byref(code)))
        accounting = ACCOUNTING()
        checked(query_job(job, 1, c.byref(accounting), c.sizeof(accounting), None))
        active_before_termination = accounting.active
        checked(terminate(job, 124))
        cleanup_deadline = time.monotonic() + 5
        accounting = ACCOUNTING()
        while True:
            checked(query_job(job, 1, c.byref(accounting), c.sizeof(accounting), None))
            if accounting.active == 0:
                break
            if time.monotonic() >= cleanup_deadline:
                raise RuntimeError("Job closure unobserved")
            time.sleep(0.01)
        json.dump({"schemaVersion": 1, "reason": reason, "status": code.value if reason == "consumer-exit" else 124, "activeBeforeTermination": active_before_termination, "activeProcesses": accounting.active, "totalProcesses": accounting.total, "consumerPid": info.pid, "hostPid": os.getpid()}, result)
        result.flush()
    finally:
        # Closing the sole job handle also covers exceptions and partial startup.
        close(job)
        if info.thread:
            close(info.thread)
        if info.process:
            close(info.process)
        for handle in handles:
            close(handle)
        if attributes_initialized:
            delete(attributes)
        result.close()


def check_membership(name):
    kernel = c.WinDLL("kernel32", use_last_error=True)
    kernel.OpenJobObjectW.argtypes = [w.DWORD, w.BOOL, w.LPCWSTR]
    kernel.OpenJobObjectW.restype = w.HANDLE
    kernel.GetCurrentProcess.restype = w.HANDLE
    kernel.IsProcessInJob.argtypes = [w.HANDLE, w.HANDLE, c.POINTER(w.BOOL)]
    kernel.CloseHandle.argtypes = [w.HANDLE]
    job = kernel.OpenJobObjectW(4, False, name)  # query only, never inherited
    if not job:
        raise c.WinError(c.get_last_error())
    try:
        member = w.BOOL()
        if not kernel.IsProcessInJob(kernel.GetCurrentProcess(), job, c.byref(member)) or not member.value:
            raise RuntimeError("Process is outside prepared job")
    finally:
        kernel.CloseHandle(job)
    print("member")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--check-membership":
        check_membership(sys.argv[2])
    elif len(sys.argv) == 1:
        main()
    else:
        raise ValueError("Invalid host arguments")
