import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [root, scenario, role = "consumer"] = process.argv.slice(2);
const record = (name, value) =>
  writeFileSync(join(root, name), JSON.stringify(value));
record(`${role}.json`, { pid: process.pid, parentPid: process.ppid });
const heartbeat = setInterval(
  () => record(`${role}.heartbeat`, Date.now()),
  25,
);
setTimeout(() => process.exit(93), 15000);
setInterval(() => {
  if (existsSync(join(root, "stop"))) process.exit(94);
}, 25);
if (role === "consumer") {
  const child = spawn(
    process.execPath,
    [import.meta.filename, root, scenario, "descendant"],
    { stdio: "inherit", windowsHide: true },
  );
  const ready = setInterval(() => {
    if (!existsSync(join(root, "descendant.json"))) return;
    clearInterval(ready);
    record("ready.json", true);
    if (scenario === "normal") {
      child.kill("SIGKILL");
      child.on("close", () => process.exit(0));
    }
    if (scenario === "consumer-death" || scenario === "inherited-pipe")
      process.exit(scenario === "consumer-death" ? 7 : 0);
    if (scenario === "host-death") process.kill(process.ppid, "SIGKILL");
  }, 10);
} else if (["spawn-race", "provider-death"].includes(scenario)) {
  spawn(
    process.execPath,
    [import.meta.filename, root, "timeout", "grandchild"],
    { stdio: "inherit", windowsHide: true },
  );
}
if (scenario === "provider-death" && role === "descendant") {
  const ready = setInterval(() => {
    if (!existsSync(join(root, "grandchild.json"))) return;
    clearInterval(ready);
    process.kill(process.pid, "SIGKILL");
  }, 10);
}
void heartbeat;
