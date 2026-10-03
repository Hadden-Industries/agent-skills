import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { assertRegularPath, repositoryRoot } from "./toolchain.js";
import { sha256Hex } from "./runtime.js";
import { readContract } from "./json-contract.js";

const digest = (path) => {
  assertRegularPath(path);
  return sha256Hex(readFileSync(path));
};

/** Local preparation only: discover once, then bind absolute executable bytes. */
export function prepareProcessHost(root = repositoryRoot) {
  if (process.platform !== "win32") return null;
  const probe = spawnSync(
    "python",
    [
      "-I",
      "-B",
      "-c",
      "import sys,json; assert sys.version_info >= (3,11), 'Python 3.11+ required'; assert sys.prefix == sys.base_prefix and sys.executable == sys._base_executable, 'Base Python required'; print(json.dumps([sys.executable,sys.version]))",
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  if (probe.error || probe.status !== 0)
    throw new Error("Windows host Python discovery failed");
  const [interpreter, version] = JSON.parse(probe.stdout);
  if (!isAbsolute(interpreter))
    throw new Error("Expected absolute Python interpreter");
  const script = join(root, "scripts/evaluation/windows-job-host.py");
  return {
    kind: "windows-job-v1",
    jobName: `Local\\HaddenEvaluation-${randomUUID()}`,
    interpreter,
    interpreterSha256: digest(interpreter),
    version,
    script,
    scriptSha256: digest(script),
  };
}

export function assertProcessHost(identity, root = repositoryRoot) {
  if (process.platform !== "win32") {
    if (identity !== null) throw new Error("Unexpected process host binding");
    return;
  }
  if (
    !identity ||
    Object.keys(identity).sort().join(",") !==
      "interpreter,interpreterSha256,jobName,kind,script,scriptSha256,version" ||
    identity.kind !== "windows-job-v1" ||
    !/^Local\\HaddenEvaluation-[a-f0-9-]{36}$/u.test(identity.jobName) ||
    typeof identity.version !== "string" ||
    !isAbsolute(identity.interpreter) ||
    identity.script !== join(root, "scripts/evaluation/windows-job-host.py") ||
    digest(identity.interpreter) !== identity.interpreterSha256 ||
    digest(identity.script) !== identity.scriptSha256
  )
    throw new Error("Windows process host identity drift");
}

/** The probe inherits this bridge's job and checks the exact prepared job name. */
export function assertProcessHostMembership(identity) {
  assertProcessHost(identity);
  if (identity === null) return;
  const result = spawnSync(
    identity.interpreter,
    ["-I", "-B", identity.script, "--check-membership", identity.jobName],
    { encoding: "utf8", timeout: 3000, windowsHide: true },
  );
  if (result.error || result.status !== 0 || result.stdout.trim() !== "member")
    throw new Error("Bridge is outside its prepared Windows job");
}

/** The wrapper alone owns stdin's writer; abrupt wrapper loss revokes the job. */
export async function runProcessHost({
  identity,
  executable,
  argv,
  cwd,
  env,
  timeoutMs,
  resultPath,
}) {
  assertProcessHost(identity);
  const invocation = {
    executable,
    sha256: digest(executable),
    argv,
    cwd,
    env,
    timeoutMs,
    resultPath,
    jobName: identity.jobName,
  };
  const frame = Buffer.from(`${JSON.stringify(invocation)}\n`);
  if (frame.length > 262144)
    throw new Error("Host invocation exceeds frame limit");
  return new Promise((resolve) => {
    const child = spawn(identity.interpreter, ["-I", "-B", identity.script], {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let error = null;
    let closureTimer;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    // Capture bounded diagnostics while always draining workload streams.
    child.stdout.on("data", (data) => {
      if (stdout.length < 1048576)
        stdout += data.toString().slice(0, 1048576 - stdout.length);
    });
    child.stderr.on("data", (data) => {
      if (stderr.length < 1048576)
        stderr += data.toString().slice(0, 1048576 - stderr.length);
    });
    child.on("error", (failure) => {
      error = failure;
    });
    child.stdin.on("error", (failure) => {
      error ??= failure;
    });
    child.stdin.write(frame); // Keep open: EOF is lifecycle revocation.
    const timer = setTimeout(() => {
      error = new Error("Windows host exceeded its bounded closure deadline");
      child.kill("SIGKILL");
      closureTimer = setTimeout(() => {
        // An unclosed pipe is unsafe; do not wait forever or allow a retry.
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
        child.unref();
        resolve({
          status: null,
          signal: null,
          stdout,
          stderr,
          error,
          observation: null,
        });
      }, 5000);
    }, timeoutMs + 10000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(closureTimer);
      child.stdin.destroy();
      let observation = null;
      try {
        observation = readContract(resultPath);
        if (
          observation.schemaVersion !== 1 ||
          observation.activeProcesses !== 0 ||
          !Number.isInteger(observation.status) ||
          code !== 0
        )
          throw new Error("Windows host closure unverified");
      } catch (failure) {
        error ??= failure;
      }
      resolve({
        status: error ? null : observation.status,
        signal,
        stdout,
        stderr,
        error,
        observation,
      });
    });
  });
}
