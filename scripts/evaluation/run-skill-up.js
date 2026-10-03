import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  inspectToolchain,
  isolatedEnvironment,
  assertRegularPath,
} from "./toolchain.js";
import { assertAssuredQualification } from "./skill-up-custom-engine.js";
import { readContract } from "./json-contract.js";
import { sha256Hex } from "./runtime.js";

export function runSkillUp({ controlPath }) {
  const toolchain = inspectToolchain();
  assertAssuredQualification(toolchain);
  assertRegularPath(controlPath);
  const control = readContract(controlPath);
  if (
    existsSync(join(control.consumerRoot, "invocation.json")) ||
    existsSync(join(control.consumerRoot, "invocation-started.json"))
  )
    throw new Error(
      "Consumer invocation already attempted; reconcile retained evidence",
    );
  assertRegularPath(control.configurationPath);
  if (
    sha256Hex(readFileSync(control.configurationPath)) !==
      control.configurationSha256 ||
    control.executableSha256 !== toolchain.receipt.executableSha256
  )
    throw new Error("Frozen consumer invocation drift");
  const argv = [
    "run",
    control.configurationPath,
    "--iteration",
    "1",
    "--output-dir",
    join(control.consumerRoot, "reports"),
  ];
  // Claim the attempt before launching; interruption must never enable replay.
  writeFileSync(
    join(control.consumerRoot, "invocation-started.json"),
    JSON.stringify({
      schemaVersion: 1,
      argv,
      startedAt: new Date().toISOString(),
    }),
    { flag: "wx" },
  );
  const execution = spawnSync(toolchain.executable, argv, {
    cwd: dirname(dirname(control.configurationPath)),
    env: isolatedEnvironment(control.consumerRoot),
    timeout:
      control.deadline.maximumSeconds * 1000 +
      control.deadline.cleanupAllowanceMs +
      10000,
    encoding: "utf8",
    windowsHide: true,
  });
  // This diagnostic is derived only. It never rewrites a Hadden outcome.
  const result = {
    schemaVersion: 1,
    argv,
    status: execution.status,
    signal: execution.signal,
    stdout: execution.stdout,
    stderr: execution.stderr,
    error: execution.error?.message ?? null,
  };
  writeFileSync(
    join(control.consumerRoot, "invocation.json"),
    JSON.stringify(result, null, 2),
    { flag: "wx" },
  );
  if (execution.error || execution.status !== 0)
    throw new Error(
      "Consumer invocation failed; reconcile retained Hadden evidence before any further action",
    );
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [controlPath, ...extra] = process.argv.slice(2);
  if (!controlPath || extra.length)
    throw new Error("Usage: run-skill-up.js CONTROL (overrides are forbidden)");
  runSkillUp({ controlPath });
}
