// Synthetic App Server transport: barriers make post-consumption crashes observable.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const write = (file, value) =>
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
if (process.argv[2] === "--descendant") {
  const [root, role] = process.argv.slice(3);
  write(join(root, `${role}.json`), {
    pid: process.pid,
    parentPid: process.ppid,
  });
  if (role === "descendant")
    spawn(
      process.execPath,
      [import.meta.filename, "--descendant", root, "grandchild"],
      {
        stdio: ["ignore", process.stdout, process.stderr],
        windowsHide: true,
      },
    );
  const timer = setInterval(() => {
    write(join(root, `${role}-heartbeat.json`), {
      pid: process.pid,
      at: Date.now(),
    });
  }, 100);
  // Emergency fixture expiry is not accepted as host containment evidence.
  setTimeout(() => {
    clearInterval(timer);
    process.exit(0);
  }, 60000);
} else {
  const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const child = spawn(
    process.execPath,
    [request.provider, ...process.argv.slice(3)],
    {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.stdin.on("error", () => {});
  child.once("error", (error) => {
    process.stderr.write(String(error));
    process.exitCode = 1;
  });
  child.once("close", (code) => process.exit(code ?? 1));
  let barrierReached = false;
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    const message = JSON.parse(line);
    if (message.method === "turn/start" && !barrierReached) {
      barrierReached = true;
      write(join(request.root, "provider-barrier.json"), {
        pid: process.pid,
        parentPid: process.ppid,
        childPid: child.pid,
        phase: "turn/start",
        at: Date.now(),
      });
      if (request.scenario !== "normal") {
        spawn(
          process.execPath,
          [import.meta.filename, "--descendant", request.root, "descendant"],
          {
            stdio: ["ignore", process.stdout, process.stderr],
            windowsHide: true,
          },
        );
      }
      // The positive control also waits so the observer can inventory the job.
      while (!existsSync(join(request.root, "release")))
        await new Promise((done) => setTimeout(done, 25));
    }
    child.stdin.write(`${line}\n`);
  }
  child.stdin.end();
}
