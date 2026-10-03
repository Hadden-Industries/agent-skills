import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(import.meta.url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function waitFor(path, launchError = () => null) {
  const deadline = Date.now() + 3_000;
  while (!(await exists(path))) {
    const error = launchError();
    if (error !== null) throw error;
    if (Date.now() >= deadline)
      throw new Error("Stdio fixture marker timed out");
    await delay(20);
  }
}

// The adapter must see an open inherited pipe after its own child exits. Keep
// the holder alive until the test's cleanup, independently of provider startup.
export async function holdStdio(recordFile) {
  let launchError = null;
  const child = spawn(process.execPath, [fixturePath, "--hold", recordFile], {
    detached: true,
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  child.once("error", (error) => {
    launchError = error;
  });
  child.unref();
  await waitFor(`${recordFile}.stdio-ready`, () => launchError);
}

export async function releaseStdio(recordFile) {
  await writeFile(`${recordFile}.stdio-stop`, "", { flag: "wx" });
  if (await exists(`${recordFile}.stdio-ready`)) {
    // This marker records the holder's final write, not a native PID-death proof.
    await waitFor(`${recordFile}.stdio-exiting`);
  }
}

if (process.argv[1] === fixturePath && process.argv[2] === "--hold") {
  const recordFile = process.argv[3];
  if (typeof recordFile !== "string" || !isAbsolute(recordFile)) {
    throw new Error("Stdio fixture requires an absolute owned record path");
  }
  await writeFile(`${recordFile}.stdio-ready`, "", { flag: "wx" });
  // A lost test owner cannot leave this fault-injection process running forever.
  const expiresAt = Date.now() + 20_000;
  while (
    Date.now() < expiresAt &&
    !(await exists(`${recordFile}.stdio-stop`))
  ) {
    await delay(20);
  }
  await writeFile(`${recordFile}.stdio-exiting`, "", { flag: "wx" });
}
