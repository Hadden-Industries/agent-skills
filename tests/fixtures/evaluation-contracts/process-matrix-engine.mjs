// Only task-owned fake processes. No provider, network or credential access.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [role, root, token, scenario, outputFile] = process.argv.slice(2);
if (!new Set(["engine", "grandchild"]).has(role))
  throw new Error("Unknown fixture role");
const record = (name, value) =>
  writeFileSync(join(root, name), JSON.stringify(value));
const startedAt = Date.now();
record(`${role}.json`, { token, pid: process.pid, parentPid: process.ppid });
let cleanupRequested = false;
const heartbeat = setInterval(() => {
  if (
    existsSync(join(root, "stop-all")) ||
    (role === "grandchild" && existsSync(join(root, "stop-grandchild")))
  ) {
    record(`stopped-${role}.json`, {
      token,
      pid: process.pid,
      at: Date.now(),
      reason: "cooperative-stop-marker",
    });
    process.exit(0);
  }
  if (
    role === "engine" &&
    scenario === "cleanup-overrun" &&
    !cleanupRequested &&
    existsSync(join(root, "begin-cleanup"))
  ) {
    cleanupRequested = true;
    record("cleanup-started.json", {
      token,
      pid: process.pid,
      at: Date.now(),
      delayMs: 6000,
      trigger: "fixture-control-marker",
    });
    setTimeout(() => process.exit(0), 6000);
  }
  record(`${role}-heartbeat.json`, { token, pid: process.pid, at: Date.now() });
}, 50);
// A lost test runner cannot leave these fixtures alive indefinitely.
setTimeout(() => {
  record(`stopped-${role}.json`, {
    token,
    pid: process.pid,
    at: Date.now(),
    reason: "self-expiry",
  });
  process.exit(92);
}, 15000);

if (role === "engine") {
  if (scenario === "delayed-startup")
    await new Promise((resolve) => setTimeout(resolve, 600));
  const child = spawn(
    process.execPath,
    [import.meta.filename, "grandchild", root, token, scenario],
    { stdio: "inherit", windowsHide: true },
  );
  child.once("error", () => process.exit(93));
  const output = () => {
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(
      outputFile,
      JSON.stringify({
        exit_code: 0,
        final_message: "process-marker",
        turns: 1,
      }),
    );
  };
  if (scenario === "normal" || scenario === "delayed-startup") {
    setTimeout(() => writeFileSync(join(root, "stop-grandchild"), token), 250);
    child.once("close", (code) => {
      if (code !== 0) process.exit(94);
      output();
      clearInterval(heartbeat);
      process.exit(0);
    });
  } else if (scenario === "inherited-pipe") {
    setTimeout(() => {
      output();
      process.exit(0);
    }, 250);
  } else if (scenario === "abrupt-engine-death") {
    setTimeout(() => process.kill(process.pid, "SIGKILL"), 250);
  } else if (scenario === "cleanup-overrun") {
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () =>
        record("cleanup-signal.json", {
          signal,
          elapsedMs: Date.now() - startedAt,
        }),
      );
  }
}
