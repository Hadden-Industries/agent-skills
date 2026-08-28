import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import assert from "node:assert/strict";
import test from "node:test";

const THIS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROBE_PATH = resolve(
  THIS_DIRECTORY,
  "../../scripts/evaluation/windows-path-probe.ps1",
);
const MODULE_PATH = resolve(
  THIS_DIRECTORY,
  "../../scripts/evaluation/windows-path-metadata.js",
);

function powershellExecutable() {
  return process.env.SystemRoot
    ? join(
        process.env.SystemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      )
    : "powershell.exe";
}

async function loadProbeModule() {
  try {
    return await import(pathToFileURL(MODULE_PATH));
  } catch (error) {
    assert.fail(
      `The operation-scoped Windows metadata module is missing: ${error.code}`,
    );
  }
}

async function scriptedProbe(t, source, options = {}) {
  const owner = await mkdtemp(join(tmpdir(), "windows-path-probe-script-"));
  t.after(() => rm(owner, { force: true, recursive: true }));
  const scriptPath = join(owner, "probe.ps1");
  await writeFile(scriptPath, source, "utf8");
  const { openWindowsPathMetadataProbe } = await loadProbeModule();
  return openWindowsPathMetadataProbe({
    executable: powershellExecutable(),
    scriptPath,
    ...options,
  });
}

test(
  "one metadata client reuses one real PowerShell process for many paths",
  { skip: process.platform !== "win32" },
  async (t) => {
    const owner = await mkdtemp(join(tmpdir(), "windows-path-metadata-test-"));
    t.after(() => rm(owner, { force: true, recursive: true }));
    const ordinary = join(owner, "ordinary");
    const missing = join(owner, "missing");
    await mkdir(ordinary);
    const before = await lstat(ordinary);
    let launches = 0;
    const { openWindowsPathMetadataProbe } = await loadProbeModule();
    const probe = openWindowsPathMetadataProbe({
      executable: powershellExecutable(),
      scriptPath: PROBE_PATH,
      spawnProcess(command, arguments_, options) {
        launches += 1;
        return spawn(command, arguments_, options);
      },
    });
    t.after(() => probe.close());

    const ordinaryMetadata = await probe.read(ordinary);
    const missingMetadata = await probe.read(missing);
    await probe.close();

    assert.equal(launches, 1);
    assert.deepEqual(ordinaryMetadata, {
      schemaVersion: 1,
      exists: true,
      fullPath: resolve(ordinary),
      isContainer: true,
      attributes: ["Directory"],
      drive: {
        root: parse(resolve(ordinary)).root,
        driveType: "Fixed",
      },
    });
    assert.deepEqual(missingMetadata, {
      schemaVersion: 1,
      exists: false,
      fullPath: resolve(missing),
      isContainer: false,
      attributes: [],
      drive: {
        root: parse(resolve(missing)).root,
        driveType: "Fixed",
      },
    });
    assert.equal((await lstat(ordinary)).mtimeMs, before.mtimeMs);
  },
);

for (const [name, source, errorCode] of [
  [
    "malformed JSON",
    '[Console]::In.ReadLine()\n[Console]::Out.WriteLine("{bad")\n',
    "path-probe-protocol-failed",
  ],
  [
    "a mismatched response id",
    [
      "$request = [Console]::In.ReadLine() | ConvertFrom-Json",
      "$response = @{ schemaVersion = 1; id = $request.id + 1; result = @{} }",
      "[Console]::Out.WriteLine(($response | ConvertTo-Json -Compress))",
      "",
    ].join("\n"),
    "path-probe-protocol-failed",
  ],
  ["premature process exit", "exit 7\n", "path-probe-process-failed"],
]) {
  test(
    `the metadata client rejects ${name}`,
    { skip: process.platform !== "win32" },
    async (t) => {
      const probe = await scriptedProbe(t, source);

      await assert.rejects(probe.read(resolve(tmpdir(), "probe-target")), {
        code: errorCode,
      });
      await assert.rejects(probe.close(), { code: errorCode });
    },
  );
}

test(
  "the metadata client rejects a successful exit with an unanswered request",
  { skip: process.platform !== "win32" },
  async (t) => {
    const probe = await scriptedProbe(t, "exit 0\n");
    const readOutcome = await Promise.race([
      probe.read(resolve(tmpdir(), "probe-target")).then(
        () => "resolved",
        (error) => error,
      ),
      new Promise((resolvePromise) => {
        setTimeout(() => resolvePromise("still-pending"), 250);
      }),
    ]);

    assert.notEqual(readOutcome, "still-pending");
    assert.equal(readOutcome.code, "path-probe-process-failed");
    await assert.rejects(probe.close(), {
      code: "path-probe-process-failed",
    });
  },
);

test(
  "metadata client shutdown terminates a worker that ignores EOF",
  { skip: process.platform !== "win32" },
  async (t) => {
    const source = [
      "$request = [Console]::In.ReadLine() | ConvertFrom-Json",
      "$response = @{ schemaVersion = 1; id = $request.id; result = @{} }",
      "[Console]::Out.WriteLine(($response | ConvertTo-Json -Compress))",
      "[Console]::Out.Flush()",
      "Start-Sleep -Milliseconds 500",
      "",
    ].join("\n");
    const probe = await scriptedProbe(t, source, { closeTimeoutMs: 50 });

    await probe.read(resolve(tmpdir(), "probe-target"));
    await assert.rejects(probe.close(), {
      code: "path-probe-close-timeout",
    });
  },
);
