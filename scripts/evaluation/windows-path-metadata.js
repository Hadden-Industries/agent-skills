import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";

const POWERSHELL_ARGUMENTS = Object.freeze([
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
]);
const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function assertOptions({
  executable,
  scriptPath,
  spawnProcess,
  closeTimeoutMs,
}) {
  if (
    typeof executable !== "string" ||
    executable.length === 0 ||
    typeof scriptPath !== "string" ||
    !isAbsolute(scriptPath) ||
    typeof spawnProcess !== "function" ||
    !Number.isSafeInteger(closeTimeoutMs) ||
    closeTimeoutMs <= 0
  ) {
    throw new TypeError("Windows path metadata probe options are invalid");
  }
}

export function openWindowsPathMetadataProbe({
  executable,
  scriptPath,
  spawnProcess = spawn,
  closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
}) {
  assertOptions({ executable, scriptPath, spawnProcess, closeTimeoutMs });
  const child = spawnProcess(
    executable,
    [...POWERSHELL_ARGUMENTS, scriptPath],
    {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  if (child.stdin === null || child.stdout === null || child.stderr === null) {
    throw new TypeError("Windows path metadata probe requires piped stdio");
  }

  const pending = new Map();
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let nextId = 1;
  let terminalError = null;
  let closeOutcome = null;
  let closing = false;
  let closeCall = null;

  const rejectPending = (error) => {
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  };

  lines.on("line", (line) => {
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      terminalError = fail(
        "path-probe-protocol-failed",
        "the Windows path metadata probe returned malformed JSON",
      );
      rejectPending(terminalError);
      return;
    }

    const request = pending.get(response?.id);
    if (
      response?.schemaVersion !== 1 ||
      !Number.isSafeInteger(response.id) ||
      request === undefined ||
      response.result === null ||
      typeof response.result !== "object" ||
      Array.isArray(response.result)
    ) {
      terminalError = fail(
        "path-probe-protocol-failed",
        "the Windows path metadata probe returned an invalid response",
      );
      rejectPending(terminalError);
      return;
    }

    pending.delete(response.id);
    request.resolve(response.result);
  });

  const childClosed = new Promise((resolvePromise) => {
    child.once("error", (error) => {
      terminalError = fail(
        "path-probe-launch-failed",
        error instanceof Error ? error.message : "probe launch failed",
      );
      rejectPending(terminalError);
      resolvePromise();
    });
    child.once("close", (code, signal) => {
      closeOutcome = { code, signal };
      if (pending.size > 0 && terminalError === null) {
        terminalError = fail(
          "path-probe-process-failed",
          "the Windows path metadata probe closed with unanswered requests",
        );
      } else if (code !== 0 && terminalError === null) {
        terminalError = fail(
          "path-probe-process-failed",
          `the Windows path metadata probe exited with code ${String(code)}`,
        );
      }
      if (terminalError !== null) {
        rejectPending(terminalError);
      }
      resolvePromise();
    });
  });

  // Drain stderr so a verbose PowerShell failure cannot block process exit.
  child.stderr.resume();

  return Object.freeze({
    read(target) {
      if (closing || terminalError !== null) {
        return Promise.reject(
          terminalError ??
            fail(
              "path-probe-closed",
              "the Windows path metadata probe is closing",
            ),
        );
      }
      if (typeof target !== "string" || !isAbsolute(target)) {
        return Promise.reject(
          new TypeError("Windows path metadata target must be absolute"),
        );
      }

      const id = nextId;
      nextId += 1;
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject });
        child.stdin.write(
          `${JSON.stringify({ schemaVersion: 1, id, path: target })}\n`,
          "utf8",
          (error) => {
            if (error === null || error === undefined) {
              return;
            }
            pending.delete(id);
            reject(error);
          },
        );
      });
    },
    close() {
      if (closeCall !== null) {
        return closeCall;
      }
      closing = true;
      closeCall = (async () => {
        child.stdin.end();
        let timeout;
        const timeoutReached = new Promise((resolvePromise) => {
          timeout = setTimeout(() => resolvePromise(true), closeTimeoutMs);
        });
        const closedBeforeTimeout = await Promise.race([
          childClosed.then(() => true),
          timeoutReached.then(() => false),
        ]);
        clearTimeout(timeout);
        if (!closedBeforeTimeout) {
          terminalError = fail(
            "path-probe-close-timeout",
            "the Windows path metadata probe did not close before its deadline",
          );
          rejectPending(terminalError);
          child.kill();
          await childClosed;
        }
        lines.close();
        if (terminalError !== null) {
          throw terminalError;
        }
        if (closeOutcome?.code !== 0 || closeOutcome.signal !== null) {
          throw fail(
            "path-probe-process-failed",
            "the Windows path metadata probe did not close normally",
          );
        }
      })();
      return closeCall;
    },
  });
}
