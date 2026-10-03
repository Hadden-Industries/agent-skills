import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectToolchain,
  isolatedEnvironment,
  repositoryRoot,
} from "../../scripts/evaluation/toolchain.js";
import { sha256Hex } from "../../scripts/evaluation/runtime.js";

test("bootstrap rejects unsafe archive members without extraction or network", () => {
  const result = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    [join(repositoryRoot, "tests/scripts/evaluation-bootstrap.py")],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "toolchain-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let bytes = readFileSync(join(repositoryRoot, "evaluation-toolchain.json"));
  const manifest = JSON.parse(bytes);
  const platform = `${process.platform}-${process.arch}`;
  // These are preflight unit fixtures, not executable platform qualification.
  manifest.skillUp.platforms[platform] ??= structuredClone(
    manifest.skillUp.platforms["win32-x64"],
  );
  const executableBytes = Buffer.from("fixture never executed");
  const licenseBytes = Buffer.from("fixture license");
  manifest.skillUp.platforms[platform].executableSha256 =
    sha256Hex(executableBytes);
  manifest.skillUp.platforms[platform].licenseSha256 = sha256Hex(licenseBytes);
  bytes = Buffer.from(JSON.stringify(manifest));
  writeFileSync(join(root, "evaluation-toolchain.json"), bytes);
  for (const [name, version] of Object.entries(manifest.packages)) {
    mkdirSync(join(root, "node_modules", name), { recursive: true });
    writeFileSync(
      join(root, "node_modules", name, "package.json"),
      JSON.stringify({ name, version }),
    );
  }
  const directory = join(
    root,
    ".agent-tools/evaluation",
    `skill-up-${manifest.skillUp.version}-${platform}`,
  );
  mkdirSync(directory, { recursive: true });
  const executable = join(
    directory,
    manifest.skillUp.platforms[platform].executable,
  );
  writeFileSync(executable, executableBytes);
  writeFileSync(join(directory, "LICENSE"), licenseBytes);
  const receipt = {
    schemaVersion: 1,
    platform,
    versionOutput: `skill-up version ${manifest.skillUp.version}`,
    toolchainSha256: sha256Hex(bytes),
    archiveSha256: manifest.skillUp.platforms[platform].sha256,
    executableSha256: sha256Hex(executableBytes),
  };
  writeFileSync(join(directory, "installation.json"), JSON.stringify(receipt));
  return { root, executable, directory };
}

test("toolchain preflight accepts observed identity without executing a binary", (t) => {
  const { root, executable } = fixture(t);
  assert.equal(inspectToolchain(root).executable, executable);
});

test("toolchain preflight rejects changed executable before invocation", (t) => {
  const { root, executable } = fixture(t);
  writeFileSync(executable, "changed executable");
  assert.throws(() => inspectToolchain(root), /executable digest mismatch/u);
});

test("toolchain preflight rejects changed package and manifest", (t) => {
  const { root } = fixture(t);
  writeFileSync(
    join(root, "node_modules/yaml/package.json"),
    '{"version":"0.0.0"}',
  );
  assert.throws(() => inspectToolchain(root), /dependency mismatch/u);
  writeFileSync(join(root, "evaluation-toolchain.json"), '{"schemaVersion":2}');
  assert.throws(() => inspectToolchain(root), /Unsupported/u);
});

test("missing tools cannot fall back to PATH or acquire a replacement", (t) => {
  const { root, directory } = fixture(t);
  rmSync(join(directory, "installation.json"));
  assert.throws(() => inspectToolchain(root), /ENOENT/u);
});

test("isolated environment is an allowlist without credential or config authority", () => {
  const environment = isolatedEnvironment("owned-home", {
    OPENAI_API_KEY: "sentinel-openai",
    ANTHROPIC_API_KEY: "sentinel-anthropic",
    SKILL_UP_CONFIG: "sentinel-config",
    NODE_OPTIONS: "sentinel-node-options",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
    GIT_CONFIG_GLOBAL: "sentinel-git",
    HOME: "ambient-home",
    TMPDIR: "ambient-temp",
    PATH: "ambient-path",
  });
  assert.equal(environment.HOME, "owned-home");
  assert.equal(environment.USERPROFILE, "owned-home");
  assert.equal(environment.OTEL_SDK_DISABLED, "true");
  assert.equal(environment.TMPDIR, "owned-home");
  assert.notEqual(environment.PATH, "ambient-path");
  for (const name of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "SKILL_UP_CONFIG",
    "NODE_OPTIONS",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "GIT_CONFIG_GLOBAL",
  ]) {
    assert.equal(Object.hasOwn(environment, name), false);
  }
});

test("changing both receipt and executable cannot change reviewed executable authority", (t) => {
  const { root, executable, directory } = fixture(t);
  const changed = Buffer.from("changed executable");
  writeFileSync(executable, changed);
  const path = join(directory, "installation.json");
  const receipt = JSON.parse(readFileSync(path));
  receipt.executableSha256 = sha256Hex(changed);
  writeFileSync(path, JSON.stringify(receipt));
  assert.throws(() => inspectToolchain(root), /executable digest mismatch/u);
});

test("qualification metadata does not invalidate unchanged installed bytes", (t) => {
  const { root } = fixture(t);
  const path = join(root, "evaluation-toolchain.json");
  const manifest = JSON.parse(readFileSync(path));
  manifest.skillUp.platforms[
    `${process.platform}-${process.arch}`
  ].qualification = "smoke-only";
  writeFileSync(path, JSON.stringify(manifest));
  assert.doesNotThrow(() => inspectToolchain(root));
});
