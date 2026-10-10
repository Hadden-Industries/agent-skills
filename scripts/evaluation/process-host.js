import { spawn, spawnSync } from "node:child_process";
import { createPublicKey, randomUUID, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { assertRegularPath, repositoryRoot } from "./toolchain.js";
import { canonicalJsonBytes, sha256Hex } from "./runtime.js";
import { readContract } from "./json-contract.js";
import { setTimeout as delay } from "node:timers/promises";

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
      "import sys,json; assert sys.version_info >= (3,14,8), 'Python 3.14.8+ required'; assert sys.prefix == sys.base_prefix and sys.executable == sys._base_executable, 'Base Python required'; print(json.dumps([sys.executable,sys.version]))",
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  if (probe.error || probe.status !== 0)
    throw new Error("Windows host Python discovery failed");
  const [interpreter, version] = JSON.parse(probe.stdout);
  if (!isAbsolute(interpreter))
    throw new Error("Expected absolute Python interpreter");
  const script = join(root, "scripts/evaluation/windows-job-host.py");
  const recorder = join(root, "scripts/evaluation/windows-closure-recorder.py");
  return {
    kind: "windows-job-v2",
    jobName: `Local\\HaddenEvaluation-${randomUUID()}`,
    interpreter,
    interpreterSha256: digest(interpreter),
    version,
    script,
    scriptSha256: digest(script),
    recorder,
    recorderSha256: digest(recorder),
  };
}

export function assertProcessHost(identity, root = repositoryRoot) {
  if (process.platform !== "win32") {
    if (identity !== null) throw new Error("Unexpected process host binding");
    return;
  }
  const version = /^(\d+)\.(\d+)\.(\d+)(?:\s|$)/u.exec(identity?.version ?? "");
  const supportedPython =
    version &&
    (Number(version[1]) > 3 ||
      (Number(version[1]) === 3 &&
        (Number(version[2]) > 14 ||
          (Number(version[2]) === 14 && Number(version[3]) >= 8))));
  if (
    !identity ||
    !supportedPython ||
    Object.keys(identity).sort().join(",") !==
      "interpreter,interpreterSha256,jobName,kind,recorder,recorderSha256,script,scriptSha256,version" ||
    identity.kind !== "windows-job-v2" ||
    !/^Local\\HaddenEvaluation-[a-f0-9-]{36}$/u.test(identity.jobName) ||
    typeof identity.version !== "string" ||
    !isAbsolute(identity.interpreter) ||
    identity.script !== join(root, "scripts/evaluation/windows-job-host.py") ||
    digest(identity.interpreter) !== identity.interpreterSha256 ||
    digest(identity.script) !== identity.scriptSha256 ||
    identity.recorder !==
      join(root, "scripts/evaluation/windows-closure-recorder.py") ||
    digest(identity.recorder) !== identity.recorderSha256
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
  association = null,
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
    processHost: identity,
    association,
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
    child.on("close", async (code, signal) => {
      clearTimeout(timer);
      clearTimeout(closureTimer);
      child.stdin.destroy();
      let observation = null;
      try {
        observation = readContract(resultPath);
        if (
          observation.schemaVersion !== 2 ||
          observation.activeProcesses !== 0 ||
          !Number.isInteger(observation.status) ||
          code !== 0
        )
          throw new Error("Windows host closure unverified");
      } catch (failure) {
        error ??= failure;
      }
      // The independent recorder owns no workload streams. Its durable terminal
      // write can follow host exit; observe it for one bounded cleanup interval.
      let closure = null;
      const end = Date.now() + 5500;
      while (Date.now() < end) {
        try {
          const binding = readContract(`${resultPath}.ready.json`);
          const candidate = readContract(`${resultPath}.closure.json`);
          assertProcessClosure(candidate, binding, identity);
          closure = candidate;
          break;
        } catch {
          await delay(20);
        }
      }
      if (!closure)
        error ??= new Error("Independent Windows closure unverified");
      resolve({
        status: error ? null : observation.status,
        signal,
        stdout,
        stderr,
        error,
        observation,
        closure,
      });
    });
  });
}

/** Stable signed payload encoding shared with the native recorder. */
export function processClosurePayload(value) {
  // The closed native payload contains only fixed ASCII keys, safe integers,
  // strings and null; Python sorted compact JSON matches this common owner.
  return canonicalJsonBytes(value).toString("utf8");
}

/** A pinned readiness key authenticates zero-active proof; it grants no authority. */
export function assertProcessClosure(closure, binding, identity) {
  assertProcessHost(identity);
  assertProcessReadiness(binding, identity, binding?.association);
  if (
    !closure ||
    Object.keys(closure).sort().join(",") !==
      "activeProcesses,binding,reason,schemaVersion,signature,totalProcesses" ||
    closure.schemaVersion !== 2 ||
    closure.reason !== "host-exited" ||
    closure.activeProcesses !== 0 ||
    !Number.isSafeInteger(closure.totalProcesses) ||
    closure.totalProcesses < 0 ||
    processClosurePayload(closure.binding) !== processClosurePayload(binding) ||
    processClosurePayload(binding.processHost) !==
      processClosurePayload(identity) ||
    binding.jobName !== identity.jobName ||
    binding.schemaVersion !== 2 ||
    !/^[0-9]+$/u.test(binding.host.creationFileTime) ||
    !/^[0-9]+$/u.test(binding.recorder.creationFileTime) ||
    typeof closure.signature !== "string" ||
    !/^[A-Za-z0-9+/]{342}==$/u.test(closure.signature)
  )
    throw new Error("Windows closure binding invalid");
  const { signature, ...payload } = closure;
  if (
    !verify(
      "RSA-SHA256",
      Buffer.from(processClosurePayload(payload)),
      createPublicKey({ key: binding.publicKey, format: "jwk" }),
      Buffer.from(signature, "base64"),
    )
  )
    throw new Error("Windows closure signature invalid");
}

/** Readiness is pinned before workload launch and later copied into the lease. */
export function assertProcessReadiness(binding, identity, association) {
  const keys =
    "association,consumer,host,jobName,processHost,publicKey,receiptPath,recorder,schemaVersion";
  if (
    !binding ||
    Object.keys(binding).sort().join(",") !== keys ||
    binding.schemaVersion !== 2 ||
    binding.jobName !== identity.jobName ||
    processClosurePayload(binding.processHost) !==
      processClosurePayload(identity) ||
    processClosurePayload(binding.association) !==
      processClosurePayload(association) ||
    !isAbsolute(binding.receiptPath) ||
    Object.keys(binding.consumer).sort().join(",") !== "executable,sha256" ||
    !isAbsolute(binding.consumer.executable) ||
    !/^[a-f0-9]{64}$/u.test(binding.consumer.sha256) ||
    Object.keys(binding.publicKey).sort().join(",") !== "e,kty,n" ||
    binding.publicKey.kty !== "RSA" ||
    binding.publicKey.e !== "AQAB" ||
    !/^[a-zA-Z0-9_-]{342}$/u.test(binding.publicKey.n) ||
    ![binding.host, binding.recorder].every(
      (value) =>
        value &&
        Object.keys(value).sort().join(",") === "creationFileTime,pid" &&
        Number.isSafeInteger(value.pid) &&
        value.pid > 0 &&
        typeof value.creationFileTime === "string" &&
        /^[1-9][0-9]{15,20}$/u.test(value.creationFileTime),
    )
  )
    throw new Error("Windows recorder readiness invalid");
}

/** Freeze only private carrier association; no prompt, environment or secret. */
export function processHostAssociation(controlPath, control) {
  return {
    controlPath: controlPath,
    controlSha256: digest(controlPath),
    preparedSession: control.preparedSession,
    transmissionSha256: control.transmissionSha256,
    consumerRoot: control.consumerRoot,
    evidenceLayout: control.evidenceLayout,
  };
}

/** Called inside the native job after the bridge has validated its exact packet. */
export function preparedProcessContainment(controlPath, control) {
  if (control.processHost === null) return null;
  if (controlPath !== join(control.consumerRoot, "execution-index.json"))
    throw new Error("Windows carrier control location invalid");
  assertProcessHostMembership(control.processHost);
  const readyPath = join(
    control.consumerRoot,
    "process-host-observation.json.ready.json",
  );
  const binding = readContract(readyPath);
  const association = processHostAssociation(controlPath, control);
  assertProcessReadiness(binding, control.processHost, association);
  if (
    binding.consumer.sha256 !== control.executableSha256 ||
    binding.receiptPath !==
      join(control.consumerRoot, "process-host-observation.json.closure.json")
  )
    throw new Error("Windows recorder carrier mismatch");
  return { readyPath, processHost: control.processHost, association };
}

/** Native birth identity prevents PID reuse from admitting a live recovery owner. */
export function inspectRecoveryOwner(
  identity,
  pid,
  creationFileTime = "capture",
) {
  assertProcessHost(identity);
  const result = spawnSync(
    identity.interpreter,
    [
      "-I",
      "-B",
      identity.script,
      "--process-state",
      String(pid),
      creationFileTime,
    ],
    { encoding: "utf8", timeout: 3000, windowsHide: true },
  );
  if (result.error || result.status !== 0)
    throw new Error("Recovery owner native identity unavailable");
  const value = JSON.parse(result.stdout);
  if (
    !["active", "closed"].includes(value.state) ||
    value.pid !== pid ||
    typeof value.creationFileTime !== "string" ||
    !/^[1-9][0-9]{15,20}$/u.test(value.creationFileTime)
  )
    throw new Error("Recovery owner native identity invalid");
  return value;
}
