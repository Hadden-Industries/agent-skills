import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  assertProcessHost,
  assertProcessHostMembership,
  assertProcessClosure,
  prepareProcessHost,
  runProcessHost,
} from "../../scripts/evaluation/process-host.js";

const windows = process.platform === "win32";
test(
  "Windows parent loss during startup cannot leave a workload",
  { skip: !windows, timeout: 10000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "windows-job-startup-"));
    const input = request(root, "timeout");
    const { identity, ...values } = input;
    const spec = {
      ...values,
      jobName: identity.jobName,
      processHost: identity,
      association: null,
      sha256: createHash("sha256")
        .update(readFileSync(input.executable))
        .digest("hex"),
    };
    const host = spawn(identity.interpreter, ["-I", "-B", identity.script], {
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    });
    const closed = new Promise((done) => host.once("close", done));
    host.stdin.on("error", () => {});
    host.stdin.end(`${JSON.stringify(spec)}\n`);
    try {
      const code = await closed;
      if (
        existsSync(input.resultPath) &&
        readFileSync(input.resultPath, "utf8")
      ) {
        assert.equal(code, 0);
        assert.equal(read(input.resultPath).reason, "parent-loss");
        assert.equal(read(input.resultPath).activeProcesses, 0);
      } else assert.notEqual(code, 0);
      for (const role of ["consumer", "descendant"]) {
        const path = join(root, `${role}.json`);
        if (existsSync(path)) await until(() => !alive(read(path).pid));
      }
    } finally {
      writeFileSync(join(root, "stop"), "stop");
      host.kill("SIGKILL");
    }
  },
);

test(
  "Windows missing process-attribute API fails before workload creation",
  { skip: !windows, timeout: 10000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "windows-job-api-"));
    const input = request(root, "normal");
    const { identity, ...values } = input;
    const spec = {
      ...values,
      jobName: identity.jobName,
      processHost: identity,
      association: null,
      sha256: createHash("sha256")
        .update(readFileSync(input.executable))
        .digest("hex"),
    };
    const fault = [
      "import ctypes,runpy,sys",
      "real = ctypes.WinDLL",
      "class MissingApi:",
      " def __init__(self,*a,**k): self.dll=real(*a,**k)",
      " def __getattr__(self,name):",
      "  if name == 'UpdateProcThreadAttribute': raise AttributeError(name)",
      "  return getattr(self.dll,name)",
      "ctypes.WinDLL=MissingApi",
      `sys.argv=[${JSON.stringify(identity.script)}]`,
      "runpy.run_path(sys.argv[0],run_name='__main__')",
    ].join("\n");
    const host = spawn(identity.interpreter, ["-I", "-B", "-c", fault], {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    host.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const closed = new Promise((done) => host.once("close", done));
    host.stdin.on("error", () => {});
    host.stdin.write(`${JSON.stringify(spec)}\n`);
    const code = await closed;
    assert.notEqual(code, 0);
    assert.match(stderr, /AttributeError: UpdateProcThreadAttribute/u);
    assert.equal(existsSync(join(root, "consumer.json")), false);
  },
);
function read(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function until(predicate, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end)
      throw new Error("Bounded process observation expired");
    await delay(25);
  }
}
function request(root, scenario) {
  return {
    identity: prepareProcessHost(),
    executable: process.execPath,
    argv: [
      resolve("tests/fixtures/evaluation-contracts/windows-job-workload.mjs"),
      root,
      scenario,
    ],
    cwd: root,
    env: { ...process.env },
    timeoutMs: 1200,
    resultPath: join(root, "host-result.json"),
  };
}

for (const scenario of [
  "normal",
  "timeout",
  "consumer-death",
  "host-death",
  "recorder-death",
  "simultaneous-death",
  "parent-death",
  "inherited-pipe",
  "spawn-race",
  "provider-death",
]) {
  test(
    `Windows job closes owned tree: ${scenario}`,
    { skip: !windows, timeout: 20000 },
    async () => {
      const root = mkdtempSync(join(tmpdir(), "windows-job-contract-"));
      const input = request(root, scenario);
      const requestPath = join(root, "request.json");
      writeFileSync(requestPath, JSON.stringify(input));
      const wrapper = spawn(
        process.execPath,
        [
          resolve(
            "tests/fixtures/evaluation-contracts/windows-job-wrapper.mjs",
          ),
          requestPath,
        ],
        { stdio: "ignore", windowsHide: true },
      );
      const closed = new Promise((done) => wrapper.once("close", done));
      try {
        await until(() => existsSync(join(root, "ready.json")));
        if (scenario === "parent-death") wrapper.kill("SIGKILL");
        await closed;
        const identities = ["consumer", "descendant", "grandchild"]
          .filter((role) => existsSync(join(root, `${role}.json`)))
          .map((role) => read(join(root, `${role}.json`)));
        await until(() => identities.every(({ pid }) => !alive(pid)));
        if (scenario !== "parent-death") {
          const result = read(join(root, "wrapper-result.json"));
          if (scenario === "host-death") {
            assert.ok(result.error); // An abrupt death never fabricates success.
            const closure = read(`${input.resultPath}.closure.json`);
            assert.equal(closure.schemaVersion, 2);
            assert.equal(closure.reason, "host-exited");
            assert.equal(closure.activeProcesses, 0);
            assert.equal(closure.binding.jobName, input.identity.jobName);
            assert.match(closure.binding.host.creationFileTime, /^[0-9]+$/u);
            assert.ok(closure.signature);
            const readiness = read(`${input.resultPath}.ready.json`);
            assertProcessClosure(closure, readiness, input.identity);
            assert.throws(
              () =>
                assertProcessClosure(
                  { ...closure, totalProcesses: closure.totalProcesses + 1 },
                  readiness,
                  input.identity,
                ),
              /signature invalid/u,
            );
          } else if (
            ["recorder-death", "simultaneous-death"].includes(scenario)
          ) {
            assert.ok(result.error);
            assert.equal(
              readFileSync(`${input.resultPath}.closure.json`, "utf8"),
              "",
            );
            if (scenario === "recorder-death") {
              assert.equal(result.observation.reason, "recorder-loss");
              assert.equal(result.observation.activeProcesses, 0);
            }
          } else {
            assert.equal(result.error, null);
            assert.equal(result.observation.activeProcesses, 0);
            assert.equal(
              result.status,
              ["normal", "inherited-pipe"].includes(scenario)
                ? 0
                : scenario === "consumer-death"
                  ? 7
                  : 124,
            );
          }
        }
      } finally {
        writeFileSync(join(root, "stop"), "stop");
        if (wrapper.exitCode === null) wrapper.kill("SIGKILL");
      }
    },
  );
}

test(
  "Windows host rejects identity drift before workload launch",
  { skip: !windows },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "windows-job-invalid-"));
    const input = request(root, "normal");
    for (const field of [
      "scriptSha256",
      "interpreterSha256",
      "recorderSha256",
    ]) {
      const original = input.identity[field];
      input.identity[field] = "0".repeat(64);
      await assert.rejects(runProcessHost(input), /identity drift/u);
      input.identity[field] = original;
    }
    assert.throws(
      () => assertProcessHostMembership(input.identity),
      /outside its prepared Windows job/u,
    );
    assert.equal(existsSync(join(root, "consumer.json")), false);
  },
);

test(
  "Windows host rejects retained controls below the Python floor before launch",
  { skip: !windows },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "windows-job-old-python-"));
    const input = request(root, "normal");
    for (const version of [
      "3.14.7 (previous runtime)",
      "3.13.99 (older minor)",
      "3.14.8rc1",
      "3.15.0rc1",
      "unknown",
    ]) {
      input.identity.version = version;
      await assert.rejects(runProcessHost(input), /identity drift/u);
    }
    assert.equal(existsSync(join(root, "consumer.json")), false);
    for (const version of [
      "3.14.8 (CI runtime)",
      "3.14.9",
      "3.15.0",
      "4.0.0",
    ]) {
      assert.doesNotThrow(() =>
        assertProcessHost({ ...input.identity, version }),
      );
    }
  },
);

test(
  "Windows jobs support a nested per-invocation host",
  { skip: !windows, timeout: 15000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "windows-job-nested-"));
    const inner = request(root, "normal");
    const requestPath = join(root, "request.json");
    writeFileSync(requestPath, JSON.stringify(inner));
    const outer = {
      ...request(root, "normal"),
      timeoutMs: 7000,
      argv: [
        resolve("tests/fixtures/evaluation-contracts/windows-job-wrapper.mjs"),
        requestPath,
      ],
      resultPath: join(root, "outer-result.json"),
    };
    const result = await runProcessHost(outer);
    assert.equal(result.error, null);
    assert.equal(result.status, 0);
    assert.equal(read(join(root, "wrapper-result.json")).status, 0);
  },
);

test(
  "Windows host creation failure launches no workload",
  { skip: !windows },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "windows-job-invalid-"));
    const input = request(root, "normal");
    input.argv = ["\0"];
    const result = await runProcessHost(input);
    assert.ok(result.error);
    assert.equal(existsSync(join(root, "consumer.json")), false);
  },
);
