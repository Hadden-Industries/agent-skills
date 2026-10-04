"""Bounded host-death observer. Its signing key and native handles never enter work."""

import base64
import ctypes as c
from ctypes import wintypes as w
import hashlib
import json
import os
import struct
import sys
import time


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate recorder key")
        result[key] = value
    return result


def api(dll, name, result, *arguments):
    function = getattr(dll, name)
    function.restype = result
    function.argtypes = arguments
    return function


def checked(value):
    if not value:
        raise c.WinError(c.get_last_error())
    return value


def nt(status):
    if status != 0:
        raise RuntimeError(f"CNG operation failed: {status:#x}")


class SigningKey:
    """Invocation-only native RSA key, exported only as public JWK."""

    def __init__(self):
        self.dll = c.WinDLL("bcrypt")
        self.algorithm = c.c_void_p()
        self.key = c.c_void_p()
        nt(api(self.dll, "BCryptOpenAlgorithmProvider", w.LONG, c.POINTER(c.c_void_p), w.LPCWSTR, w.LPCWSTR, w.DWORD)(c.byref(self.algorithm), "RSA", None, 0))
        try:
            nt(api(self.dll, "BCryptGenerateKeyPair", w.LONG, c.c_void_p, c.POINTER(c.c_void_p), w.ULONG, w.ULONG)(self.algorithm, c.byref(self.key), 2048, 0))
            nt(api(self.dll, "BCryptFinalizeKeyPair", w.LONG, c.c_void_p, w.ULONG)(self.key, 0))
        except BaseException:
            self.close()
            raise

    def public(self):
        export = api(self.dll, "BCryptExportKey", w.LONG, c.c_void_p, c.c_void_p, w.LPCWSTR, c.c_void_p, w.ULONG, c.POINTER(w.ULONG), w.ULONG)
        amount = w.ULONG()
        nt(export(self.key, None, "RSAPUBLICBLOB", None, 0, c.byref(amount), 0))
        output = c.create_string_buffer(amount.value)
        nt(export(self.key, None, "RSAPUBLICBLOB", output, amount.value, c.byref(amount), 0))
        magic, bits, exponent_length, modulus_length, _, _ = struct.unpack("<6I", output.raw[:24])
        if magic != 0x31415352 or bits != 2048:
            raise RuntimeError("Unexpected public key")
        encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")
        return {"kty": "RSA", "e": encode(output.raw[24:24 + exponent_length]), "n": encode(output.raw[24 + exponent_length:24 + exponent_length + modulus_length])}

    def sign(self, payload):
        class PADDING(c.Structure):
            _fields_ = [("algorithm", w.LPCWSTR)]
        padding = PADDING("SHA256")
        digest = hashlib.sha256(payload).digest()
        source = c.create_string_buffer(digest)
        sign = api(self.dll, "BCryptSignHash", w.LONG, c.c_void_p, c.c_void_p, c.c_void_p, w.ULONG, c.c_void_p, w.ULONG, c.POINTER(w.ULONG), w.ULONG)
        amount = w.ULONG()
        nt(sign(self.key, c.byref(padding), source, len(digest), None, 0, c.byref(amount), 2))
        signature = c.create_string_buffer(amount.value)
        nt(sign(self.key, c.byref(padding), source, len(digest), signature, amount.value, c.byref(amount), 2))
        return base64.b64encode(signature.raw[:amount.value]).decode("ascii")

    def close(self):
        if self.key.value:
            api(self.dll, "BCryptDestroyKey", w.LONG, c.c_void_p)(self.key)
            self.key = c.c_void_p()
        if self.algorithm.value:
            api(self.dll, "BCryptCloseAlgorithmProvider", w.LONG, c.c_void_p, w.ULONG)(self.algorithm, 0)
            self.algorithm = c.c_void_p()


def write_record(handle, value):
    json.dump(value, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    handle.flush()
    os.fsync(handle.fileno())


def main():
    if sys.platform != "win32" or len(sys.argv) != 3:
        raise ValueError("Recorder requires Windows and two retained handles")
    job, host = (int(value) for value in sys.argv[1:])
    kernel = c.WinDLL("kernel32", use_last_error=True)
    close = api(kernel, "CloseHandle", w.BOOL, w.HANDLE)
    # These inherited handles are private control handles, never inheritable by
    # any process the recorder could create (it creates none).
    set_handle = api(kernel, "SetHandleInformation", w.BOOL, w.HANDLE, w.DWORD, w.DWORD)
    checked(set_handle(job, 1, 0))
    checked(set_handle(host, 1, 0))
    key = None
    result = None
    try:
        frame = sys.stdin.buffer.readline(262145)
        if len(frame) > 262144 or not frame.endswith(b"\n"):
            raise ValueError("Invalid recorder framing")
        spec = json.loads(frame, object_pairs_hook=unique)
        identity = spec["processHost"]
        for path, expected in ((sys.executable, identity["interpreterSha256"]), (__file__, identity["recorderSha256"]), (identity["script"], identity["scriptSha256"])):
            with open(path, "rb") as source:
                if hashlib.file_digest(source, "sha256").hexdigest() != expected:
                    raise ValueError("Recorder producer identity drift")
        wait = api(kernel, "WaitForSingleObject", w.DWORD, w.HANDLE, w.DWORD)
        query = api(kernel, "QueryInformationJobObject", w.BOOL, w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p)
        terminate = api(kernel, "TerminateJobObject", w.BOOL, w.HANDLE, w.UINT)
        process_id = api(kernel, "GetProcessId", w.DWORD, w.HANDLE)
        current = api(kernel, "GetCurrentProcess", w.HANDLE)
        member = w.BOOL()
        membership = api(kernel, "IsProcessInJob", w.BOOL, w.HANDLE, w.HANDLE, c.POINTER(w.BOOL))
        checked(membership(current(), job, c.byref(member)))
        if member.value:
            raise RuntimeError("Recorder entered the invocation workload job")
        times = api(kernel, "GetProcessTimes", w.BOOL, w.HANDLE, c.POINTER(w.FILETIME), c.POINTER(w.FILETIME), c.POINTER(w.FILETIME), c.POINTER(w.FILETIME))

        def birth(handle):
            values = [w.FILETIME() for _ in range(4)]
            checked(times(handle, *(c.byref(value) for value in values)))
            return {"pid": checked(process_id(handle)), "creationFileTime": str((values[0].dwHighDateTime << 32) | values[0].dwLowDateTime)}

        class ACCOUNTING(c.Structure):
            _fields_ = [(name, c.c_int64) for name in ("user", "kernel", "periodUser", "periodKernel")] + [(name, w.DWORD) for name in ("faults", "total", "active", "terminated")]

        # Exclusive reservation and pinned public key precede readiness. The
        # private key remains in this process; editing zero-active bytes later
        # cannot authenticate a forged receipt against the leased readiness key.
        result = open(spec["resultPath"] + ".closure.json", "x", encoding="utf-8")
        key = SigningKey()
        binding = {"schemaVersion": 2, "jobName": spec["jobName"], "processHost": identity, "consumer": {"executable": spec["executable"], "sha256": spec["sha256"]}, "association": spec["association"], "host": birth(host), "recorder": birth(current()), "publicKey": key.public(), "receiptPath": spec["resultPath"] + ".closure.json"}
        with open(spec["resultPath"] + ".ready.json", "x", encoding="utf-8") as ready:
            write_record(ready, binding)
        print(json.dumps({"jobName": spec["jobName"], "pid": os.getpid()}), flush=True)
        # Wait for exact host death, including completion of any in-flight atomic
        # CreateProcess. The deadline also bounds abandoned partial startup.
        state = wait(host, spec["timeoutMs"] + 10000)
        if state != 0:
            checked(terminate(job, 124))
            raise RuntimeError("Host death unobserved within invocation budget")
        checked(terminate(job, 124))
        deadline = time.monotonic() + 5
        accounting = ACCOUNTING()
        while True:
            checked(query(job, 1, c.byref(accounting), c.sizeof(accounting), None))
            if accounting.active == 0:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError("Recorder job closure unobserved")
            time.sleep(0.01)
        payload = {"schemaVersion": 2, "binding": binding, "reason": "host-exited", "activeProcesses": accounting.active, "totalProcesses": accounting.total}
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        write_record(result, {**payload, "signature": key.sign(encoded)})
    finally:
        if result is not None:
            result.close()
        if key is not None:
            key.close()
        close(host)
        close(job)


if __name__ == "__main__":
    main()
