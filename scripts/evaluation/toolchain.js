import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "./runtime.js";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function assertRegularPath(path) {
  const absolute = resolve(path);
  let current = absolute;
  while (current !== parse(current).root) {
    const info = lstatSync(current);
    if (info.isSymbolicLink()) {
      throw new Error(`Redirected toolchain path: ${current}`);
    }
    current = dirname(current);
  }
  if (!lstatSync(absolute).isFile()) {
    throw new Error(`Expected regular toolchain file: ${absolute}`);
  }
}

export function inspectToolchain(root = repositoryRoot) {
  const manifestPath = join(root, "evaluation-toolchain.json");
  assertRegularPath(manifestPath);
  const bytes = readFileSync(manifestPath);
  const manifest = JSON.parse(bytes);
  if (manifest.schemaVersion !== 1) {
    throw new Error("Unsupported evaluation toolchain version");
  }
  const platform = `${process.platform}-${process.arch}`;
  const selected = manifest.skillUp.platforms[platform];
  if (!selected) {
    throw new Error(`No reviewed evaluation toolchain for ${platform}`);
  }
  for (const [name, version] of Object.entries(manifest.packages)) {
    const path = join(root, "node_modules", name, "package.json");
    assertRegularPath(path);
    if (JSON.parse(readFileSync(path, "utf8")).version !== version) {
      throw new Error(`Evaluation dependency mismatch: ${name}@${version}`);
    }
  }
  const installation = join(
    root,
    ".agent-tools/evaluation",
    `skill-up-${manifest.skillUp.version}-${platform}`,
  );
  const receiptPath = join(installation, "installation.json");
  assertRegularPath(receiptPath);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (
    receipt.schemaVersion !== 1 ||
    receipt.platform !== platform ||
    receipt.archiveSha256 !== selected.sha256 ||
    receipt.versionOutput !== `skill-up version ${manifest.skillUp.version}`
  ) {
    throw new Error(
      "Evaluation installation identity mismatch; explicit bootstrap required",
    );
  }
  const executable = join(installation, selected.executable);
  assertRegularPath(executable);
  if (
    sha256Hex(readFileSync(executable)) !== selected.executableSha256 ||
    receipt.executableSha256 !== selected.executableSha256
  ) {
    throw new Error("Evaluation executable digest mismatch");
  }
  const license = join(installation, "LICENSE");
  assertRegularPath(license);
  if (sha256Hex(readFileSync(license)) !== selected.licenseSha256) {
    throw new Error("Evaluation license digest mismatch");
  }
  return { manifest, receipt, executable, platform };
}

export function isolatedEnvironment(root, ambient = process.env) {
  const env = {};
  for (const key of ["SystemRoot", "WINDIR", "COMSPEC"]) {
    if (ambient[key]) {
      env[key] = ambient[key];
    }
  }
  return {
    ...env,
    HOME: root,
    USERPROFILE: root,
    XDG_CONFIG_HOME: root,
    APPDATA: root,
    LOCALAPPDATA: root,
    TEMP: root,
    TMP: root,
    TMPDIR: root,
    PATH: dirname(process.execPath),
    OTEL_SDK_DISABLED: "true",
    DO_NOT_TRACK: "1",
    CI: "1",
  };
}
