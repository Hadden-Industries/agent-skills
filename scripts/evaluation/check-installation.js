import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regularFileInventory } from "../skillDistribution.js";
import {
  inspectToolchain,
  isolatedEnvironment,
  repositoryRoot,
} from "./toolchain.js";

export function checkInstallation() {
  inspectToolchain();
  const root = mkdtempSync(join(tmpdir(), "evaluation-installation-"));
  const checkout = join(root, "checkout");
  mkdirSync(checkout);
  for (const directory of ["src", "skills"])
    cpSync(join(repositoryRoot, directory), join(checkout, directory), {
      recursive: true,
    });
  const denyNetwork = join(root, "deny-network.cjs");
  writeFileSync(
    denyNetwork,
    'const fail = () => { throw new Error("NETWORK_ATTEMPT"); }; global.fetch = fail; for (const name of ["node:http","node:https"]) { const api = require(name); api.request = fail; api.get = fail; } require("node:net").Socket.prototype.connect = fail;',
  );
  const results = [];
  for (const skill of [
    "committing-to-git",
    "defining-concepts",
    "naming-objects-in-software-engineering",
    "reading-epubs",
  ])
    for (const mode of ["explicit", "default", "full-depth"]) {
      const cwd = join(root, `${skill}-${mode}`);
      mkdirSync(cwd);
      const environment = isolatedEnvironment(join(cwd, "home"));
      environment.NODE_OPTIONS = `--require=${JSON.stringify(denyNetwork)}`;
      const args = [
        join(repositoryRoot, "node_modules/skills/bin/cli.mjs"),
        "add",
        mode === "explicit" ? join(checkout, "skills", skill) : checkout,
        "--skill",
        skill,
        "--agent",
        "codex",
        "--yes",
        "--copy",
        ...(mode === "full-depth" ? ["--full-depth"] : []),
      ];
      const result = spawnSync(process.execPath, args, {
        cwd,
        env: environment,
        encoding: "utf8",
        windowsHide: true,
        timeout: 45000,
      });
      writeFileSync(
        join(cwd, "process.json"),
        JSON.stringify(
          {
            args,
            status: result.status,
            stdout: result.stdout,
            stderr: result.stderr,
            error: result.error?.message ?? null,
          },
          null,
          2,
        ),
      );
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const installed = regularFileInventory(
        join(cwd, ".agents/skills", skill),
      );
      const expected = regularFileInventory(join(checkout, "skills", skill));
      assert.deepEqual(
        [...installed.keys()].sort(),
        [...expected.keys()].sort(),
      );
      for (const [file, bytes] of expected)
        assert.ok(installed.get(file).equals(bytes), `${skill}/${file}`);
      results.push({
        skill,
        mode,
        files: expected.size,
        exactGeneratedPayload: true,
      });
    }
  const receipt = {
    schemaVersion: 1,
    package: JSON.parse(
      readFileSync(
        join(repositoryRoot, "node_modules/skills/package.json"),
        "utf8",
      ),
    ).version,
    root,
    results,
    limitations: [
      "Node fetch/http/https/net APIs denied; not an OS sandbox.",
      "Local Codex installation layout only; no real host activation claim.",
    ],
  };
  writeFileSync(join(root, "receipt.json"), JSON.stringify(receipt, null, 2));
  return receipt;
}
