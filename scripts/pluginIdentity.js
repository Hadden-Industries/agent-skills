import { lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { readStableFile } from "../lib/filesystem/stableFile.js";
import { pluginPackageDefinition } from "./buildPluginPackages.js";
import { gitBytes, sha256 } from "./pluginRelease.js";

const maximumPackageBytes = 32 * 1024 * 1024;
const maximumPackageFiles = 1024;

export function packageInventory(files) {
  return [...files]
    .sort(([left], [right]) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    )
    .map(([path, bytes]) => ({
      path,
      byteLength: bytes.length,
      sha256: sha256(bytes),
    }));
}

export function inventorySha256(inventory) {
  return sha256(Buffer.from(JSON.stringify(inventory)));
}

export function packageManifest(files, name) {
  const claude = JSON.parse(files.get(".claude-plugin/plugin.json") ?? "null");
  const codex = JSON.parse(files.get(".codex-plugin/plugin.json") ?? "null");
  if (
    claude?.name !== name ||
    codex?.name !== name ||
    typeof claude.version !== "string" ||
    !claude.version ||
    codex.version !== claude.version
  ) {
    throw new Error(
      "Both installed host manifests must name the plugin and agree on its version.",
    );
  }
  return claude;
}

// Select immutable Git objects, not worktree files or a moving branch. Full
// commit identifiers keep configured pins separate from display abbreviations.
export function committedPlugin(repositoryRoot, skillName, revision) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(revision)) {
    throw new Error("Supply a full immutable commit SHA.");
  }
  const commit = gitBytes(repositoryRoot, [
    "rev-parse",
    "--verify",
    `${revision}^{commit}`,
  ])
    .toString()
    .trim();
  if (commit !== revision)
    throw new Error("The requested revision is not a commit.");
  const { outputDirectory } = pluginPackageDefinition(skillName);
  const tree = gitBytes(repositoryRoot, [
    "ls-tree",
    "-r",
    "-z",
    commit,
    "--",
    outputDirectory,
  ]);
  const files = new Map();
  let byteLength = 0;
  for (const entry of tree.toString("utf8").split("\0").filter(Boolean)) {
    const match = /^(100644|100755) blob ([0-9a-f]+)\t(.+)$/u.exec(entry);
    if (!match || !match[3].startsWith(`${outputDirectory}/`)) {
      throw new Error(
        "Unsupported Git plugin member; only regular files are allowed.",
      );
    }
    const path = match[3].slice(outputDirectory.length + 1);
    if (
      path
        .split("/")
        .some(
          (part) =>
            !part || part === "." || part === ".." || /[\\:]/u.test(part),
        )
    ) {
      throw new Error("Unsafe plugin member path.");
    }
    const bytes = gitBytes(repositoryRoot, ["cat-file", "blob", match[2]]);
    byteLength += bytes.length;
    if (byteLength > maximumPackageBytes || files.size >= maximumPackageFiles) {
      throw new Error("Plugin exceeds the bounded inspection inventory.");
    }
    files.set(path, bytes);
  }
  const manifest = packageManifest(files, skillName);
  const inventory = packageInventory(files);
  return {
    commit,
    files,
    manifest,
    inventory,
    packageSha256: inventorySha256(inventory),
  };
}

// This observes a supplied installed directory, not whether a running app has
// loaded it. Each file is read stably; the directory comparison is observational,
// not an atomic snapshot or a claim about the historical source checkout.
export function installedPluginFiles(pluginRoot) {
  const root = resolve(pluginRoot);
  const files = new Map();
  let byteLength = 0;
  let directoryCount = 0;
  function collect(directory, prefix, depth) {
    directoryCount += 1;
    const state = lstatSync(directory);
    if (
      !state.isDirectory() ||
      state.isSymbolicLink() ||
      depth > 32 ||
      directoryCount > maximumPackageFiles
    ) {
      throw new Error(
        "Installed package directories must be real directories within the depth limit.",
      );
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        collect(absolute, path, depth + 1);
      } else {
        const { bytes } = readStableFile(absolute, maximumPackageBytes, {
          rejectLinkedAncestors: true,
        });
        byteLength += bytes.length;
        if (
          byteLength > maximumPackageBytes ||
          files.size >= maximumPackageFiles
        ) {
          throw new Error(
            "Installed plugin exceeds the bounded inspection inventory.",
          );
        }
        files.set(path, bytes);
      }
    }
  }
  collect(root, "", 0);
  return files;
}

export function inspectPluginInstallation({
  repositoryRoot,
  pluginRoot,
  skillName = "committing-to-git",
  revision,
  layout = "package",
}) {
  if (!["package", "desktop"].includes(layout))
    throw new Error("Unknown installation layout.");
  const target = committedPlugin(repositoryRoot, skillName, revision);
  const expected = new Map(target.files);
  if (layout === "desktop") {
    expected.set(
      "plugin.json",
      Buffer.from(`${JSON.stringify({ name: skillName }, null, 2)}\n`),
    );
  }
  const observed = installedPluginFiles(pluginRoot);
  const manifest = packageManifest(observed, skillName);
  const differences = [];
  for (const path of new Set([...expected.keys(), ...observed.keys()])) {
    if (!expected.has(path)) differences.push({ path, reason: "unexpected" });
    else if (!observed.has(path)) differences.push({ path, reason: "missing" });
    else if (!expected.get(path).equals(observed.get(path)))
      differences.push({ path, reason: "changed" });
  }
  differences.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
  );
  const helper = observed.get(`skills/${skillName}/scripts/commitWorkflow.mjs`);
  return {
    schemaVersion: 1,
    name: skillName,
    installed: {
      path: resolve(pluginRoot),
      version: manifest.version,
      sourceRevision: null,
      sourceRevisionStatus: "not-established",
      loadedSessionState: "not-observed",
      inventorySha256: inventorySha256(packageInventory(observed)),
      helperSha256: helper ? sha256(helper) : null,
    },
    configuredTarget: {
      version: target.manifest.version,
      revision: target.commit,
      releaseTag: `${skillName}-${target.manifest.version}`,
    },
    comparison: {
      status: differences.length === 0 ? "verified-byte-match" : "different",
      scope:
        "all regular files in the supplied directory against the selected Git package and layout",
      atomicSnapshot: false,
      differences,
    },
  };
}
