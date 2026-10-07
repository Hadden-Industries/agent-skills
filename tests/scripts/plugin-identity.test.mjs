import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { installationArguments } from "../../scripts/inspectPluginInstallation.js";
import { inspectPluginInstallation } from "../../scripts/pluginIdentity.js";
import {
  gitBytes,
  packageInputSha256,
  sha256,
} from "../../scripts/pluginRelease.js";
import { preparePluginRelease } from "../../scripts/preparePluginRelease.js";
import { zipMembers } from "../../scripts/packagePluginArchive.js";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "plugin-identity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repositoryRoot = join(root, "repository");
  const pluginPath = "plugins/committing-to-git";
  const pluginRoot = join(repositoryRoot, pluginPath);
  const installed = join(root, "installed");
  const manifest = { name: "committing-to-git", version: "0.1.1-dev.1" };
  const helperPath = "skills/committing-to-git/scripts/commitWorkflow.mjs";
  const helper = Buffer.from(
    "throw new Error('Inspection must never execute me');\n",
  );
  const files = new Map([
    [
      ".claude-plugin/plugin.json",
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    ],
    [
      ".codex-plugin/plugin.json",
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    ],
    [helperPath, helper],
    ["LICENSE", Buffer.from("fixture licence\n")],
  ]);
  for (const [path, bytes] of files) {
    mkdirSync(join(pluginRoot, path, ".."), { recursive: true });
    writeFileSync(join(pluginRoot, path), bytes);
  }
  const contentSha256 = packageInputSha256(
    new Map([
      [helperPath, helper],
      ["LICENSE", files.get("LICENSE")],
    ]),
    [
      [
        ".claude-plugin/plugin.json",
        Buffer.from(`${JSON.stringify({ name: manifest.name }, null, 2)}\n`),
      ],
      [
        ".codex-plugin/plugin.json",
        Buffer.from(`${JSON.stringify({ name: manifest.name }, null, 2)}\n`),
      ],
    ],
  );
  mkdirSync(join(repositoryRoot, "scripts"));
  writeFileSync(
    join(repositoryRoot, "scripts/plugin-releases.json"),
    JSON.stringify({
      schemaVersion: 1,
      plugins: {
        "committing-to-git": [{ version: manifest.version, contentSha256 }],
      },
    }),
  );
  gitBytes(repositoryRoot, ["init", "-q"]);
  gitBytes(repositoryRoot, ["add", "."]);
  gitBytes(repositoryRoot, [
    "-c",
    "user.name=Identity Test",
    "-c",
    "user.email=identity@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  ]);
  const revision = gitBytes(repositoryRoot, ["rev-parse", "HEAD"])
    .toString()
    .trim();
  cpSync(pluginRoot, installed, { recursive: true });
  return {
    repositoryRoot,
    pluginRoot: installed,
    revision,
    helperPath,
    root,
    files,
  };
}

test("status observes installed bytes without executing helpers or claiming historical source/loaded state", (t) => {
  const input = fixture(t);
  const report = inspectPluginInstallation(input);
  assert.equal(report.installed.version, "0.1.1-dev.1");
  assert.equal(report.configuredTarget.version, "0.1.1-dev.1");
  assert.equal(report.configuredTarget.revision, input.revision);
  assert.equal(report.installed.sourceRevision, null);
  assert.equal(report.installed.loadedSessionState, "not-observed");
  assert.equal(report.comparison.status, "verified-byte-match");
  assert.deepEqual(report.comparison.differences, []);
  // The version stays identical while an actual executable byte changes.
  writeFileSync(join(input.pluginRoot, input.helperPath), "changed helper\n");
  const changed = inspectPluginInstallation(input);
  assert.equal(changed.installed.version, "0.1.1-dev.1");
  assert.equal(changed.comparison.status, "different");
  assert.deepEqual(changed.comparison.differences, [
    { path: input.helperPath, reason: "changed" },
  ]);
  rmSync(join(input.pluginRoot, "LICENSE"));
  writeFileSync(join(input.pluginRoot, "extra.txt"), "extra");
  assert.deepEqual(
    inspectPluginInstallation(input).comparison.differences.map(
      (difference) => difference.reason,
    ),
    ["missing", "unexpected", "changed"],
  );
});

test("desktop layout is explicit, and mismatched manifests or abbreviated pins cannot verify", (t) => {
  const input = fixture(t);
  writeFileSync(
    join(input.pluginRoot, "plugin.json"),
    `${JSON.stringify({ name: "committing-to-git" }, null, 2)}\n`,
  );
  assert.equal(inspectPluginInstallation(input).comparison.status, "different");
  assert.equal(
    inspectPluginInstallation({ ...input, layout: "desktop" }).comparison
      .status,
    "verified-byte-match",
  );
  assert.throws(
    () =>
      inspectPluginInstallation({
        ...input,
        revision: input.revision.slice(0, 7),
      }),
    /full immutable/u,
  );
  writeFileSync(
    join(input.pluginRoot, ".codex-plugin/plugin.json"),
    JSON.stringify({ name: "committing-to-git", version: "0.1.1-dev.2" }),
  );
  assert.throws(() => inspectPluginInstallation(input), /agree/u);
});

test("marketplace selection reads exactly one full pin and does not use an inferred branch", (t) => {
  const input = fixture(t);
  const path = join(input.root, "marketplace.json");
  const plugin = {
    name: "committing-to-git",
    source: {
      source: "git-subdir",
      path: "plugins/committing-to-git",
      sha: input.revision,
    },
  };
  writeFileSync(path, JSON.stringify({ plugins: [plugin] }));
  const args = [
    "--repository",
    input.repositoryRoot,
    "--plugin-root",
    input.pluginRoot,
    "--marketplace",
    path,
  ];
  assert.equal(installationArguments(args).revision, input.revision);
  assert.throws(
    () => installationArguments([...args, "--revision", input.revision]),
    /exactly one/u,
  );
  writeFileSync(path, JSON.stringify({ plugins: [plugin, plugin] }));
  assert.throws(() => installationArguments(args), /one matching/u);
});

test("release preparation binds exact committed bytes and rejects dirty, stale or colliding candidates", (t) => {
  const input = fixture(t);
  const outputDirectory = join(input.root, "release");
  const result = preparePluginRelease({ ...input, outputDirectory });
  assert.equal(result.provenance.version, "0.1.1-dev.1");
  assert.equal(result.provenance.source.revision, input.revision);
  assert.equal(result.provenance.releaseTag, "committing-to-git-0.1.1-dev.1");
  assert.equal(
    result.provenance.archive.sha256,
    sha256(readFileSync(result.archivePath)),
  );
  const members = zipMembers(readFileSync(result.archivePath));
  assert.equal(members.size, input.files.size + 1);
  for (const [path, bytes] of input.files)
    assert.ok(members.get(path).equals(bytes));
  assert.throws(
    () => preparePluginRelease({ ...input, outputDirectory }),
    /EEXIST/u,
  );
  assert.throws(
    () =>
      preparePluginRelease({ ...input, outputDirectory: input.repositoryRoot }),
    /outside/u,
  );
  assert.throws(
    () =>
      preparePluginRelease({
        ...input,
        outputDirectory: join(input.repositoryRoot, "..inside"),
      }),
    /outside/u,
  );
  const linkedOutput = join(input.root, "linked-output");
  symlinkSync(input.repositoryRoot, linkedOutput, "junction");
  assert.throws(
    () =>
      preparePluginRelease({
        ...input,
        outputDirectory: join(linkedOutput, "release"),
      }),
    /outside/u,
  );
  writeFileSync(join(input.repositoryRoot, "untracked.txt"), "dirty");
  assert.throws(
    () =>
      preparePluginRelease({
        ...input,
        outputDirectory: join(input.root, "other"),
      }),
    /clean/u,
  );
  rmSync(join(input.repositoryRoot, "untracked.txt"));
  const sourceHelper = join(
    input.repositoryRoot,
    "plugins/committing-to-git",
    input.helperPath,
  );
  writeFileSync(sourceHelper, "committed stale helper\n");
  gitBytes(input.repositoryRoot, ["add", "."]);
  gitBytes(input.repositoryRoot, [
    "-c",
    "user.name=Identity Test",
    "-c",
    "user.email=identity@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "stale",
  ]);
  const revision = gitBytes(input.repositoryRoot, ["rev-parse", "HEAD"])
    .toString()
    .trim();
  assert.throws(
    () =>
      preparePluginRelease({
        ...input,
        revision,
        outputDirectory: join(input.root, "stale"),
      }),
    /stale/u,
  );
});
