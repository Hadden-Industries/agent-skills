import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  committedPlugin,
  inventorySha256,
  packageInventory,
} from "./pluginIdentity.js";
import {
  gitBytes,
  packageInputSha256,
  readReleaseLedger,
  sha256,
} from "./pluginRelease.js";
import { pluginArchiveBytes } from "./packagePluginArchive.js";

function outside(root, path) {
  const difference = relative(root, path);
  return (
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference)
  );
}

function effectiveOutput(path) {
  let ancestor = path;
  const missing = [];
  for (;;) {
    try {
      return join(realpathSync(ancestor), ...missing);
    } catch (error) {
      if (error.code !== "ENOENT" || dirname(ancestor) === ancestor)
        throw error;
      missing.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
}

// Prepare create-only external release artifacts from a clean exact commit.
// The record is reported provenance, not a signed attestation or SLSA level.
export function preparePluginRelease({
  repositoryRoot,
  revision,
  outputDirectory,
  skillName = "committing-to-git",
}) {
  const root = resolve(repositoryRoot);
  if (!isAbsolute(outputDirectory))
    throw new Error("Supply an absolute external output directory.");
  const output = resolve(outputDirectory);
  if (
    !outside(root, output) ||
    !outside(realpathSync(root), effectiveOutput(output))
  ) {
    throw new Error("Release artifacts must be outside the repository.");
  }
  if (
    gitBytes(root, ["status", "--porcelain=v1", "--untracked-files=all"])
      .length > 0
  ) {
    throw new Error("Release preparation requires a clean checkout.");
  }
  if (gitBytes(root, ["rev-parse", "HEAD"]).toString().trim() !== revision) {
    throw new Error("Release revision must be the checkout's exact HEAD.");
  }
  const target = committedPlugin(root, skillName, revision);
  const release = readReleaseLedger(root).plugins[skillName]?.at(-1);
  if (release?.version !== target.manifest.version)
    throw new Error("Release ledger and committed package versions disagree.");
  const inputs = new Map(target.files);
  const manifests = [
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
  ].map((path) => {
    const manifest = JSON.parse(inputs.get(path));
    delete manifest.version;
    inputs.delete(path);
    return [path, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)];
  });
  if (packageInputSha256(inputs, manifests) !== release.contentSha256) {
    throw new Error(
      "Committed package inputs do not match the release ledger; generated package is stale.",
    );
  }
  // The build gate owns reconstruction from source; this step owns exact Git
  // package bytes. Requiring the generated correspondence before commit remains
  // part of the documented release procedure, not invented proof in this record.
  const { archive, members } = pluginArchiveBytes(target.files, skillName);
  const filename = `${skillName}-${target.manifest.version}-antigravity-desktop.zip`;
  const provenance = {
    schemaVersion: 1,
    name: skillName,
    version: target.manifest.version,
    releaseTag: `${skillName}-${target.manifest.version}`,
    source: { revision: target.commit, packagePath: `plugins/${skillName}` },
    package: {
      inventory: target.inventory,
      inventorySha256: target.packageSha256,
      inputSha256: release.contentSha256,
    },
    archive: {
      filename,
      sha256: sha256(archive),
      byteLength: archive.length,
      inventorySha256: inventorySha256(packageInventory(new Map(members))),
    },
    assurance: {
      kind: "reported-provenance",
      authenticated: false,
      buildVerification: "separate-required-evidence",
      liveInstallation: "not-observed",
    },
  };
  mkdirSync(output, { recursive: true });
  const provenancePath = join(
    output,
    `${skillName}-${target.manifest.version}-provenance.json`,
  );
  const archivePath = join(output, filename);
  // Create the record first. If a later create collides, preserve both records
  // and existing archives; never overwrite or silently claim a complete bundle.
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  writeFileSync(archivePath, archive, { flag: "wx", mode: 0o600 });
  return { archivePath, provenancePath, provenance };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      repository: { type: "string" },
      revision: { type: "string" },
      output: { type: "string" },
      skill: { type: "string", default: "committing-to-git" },
    },
  });
  if (!values.repository || !values.revision || !values.output)
    throw new Error("Supply --repository, --revision and --output.");
  const result = preparePluginRelease({
    repositoryRoot: values.repository,
    revision: values.revision,
    outputDirectory: values.output,
    skillName: values.skill,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
