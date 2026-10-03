import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const [mode, root] = process.argv.slice(2);
if (mode === "engine") {
  const child = spawn(
    process.execPath,
    [import.meta.filename, "grandchild", root],
    { stdio: "inherit", windowsHide: true },
  );
  writeFileSync(
    join(root, "engine.json"),
    JSON.stringify({ pid: process.pid, childPid: child.pid }),
  );
} else if (mode === "grandchild") {
  writeFileSync(
    join(root, "grandchild.json"),
    JSON.stringify({ pid: process.pid, parentPid: process.ppid }),
  );
} else throw new Error("Unknown process fixture mode");
const interval = setInterval(
  () => writeFileSync(join(root, `${mode}-heartbeat`), String(Date.now())),
  100,
);
setTimeout(() => {
  clearInterval(interval);
  process.exit(0);
}, 15000);
