import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPluginPackages,
  pluginPackageDefinition,
  pluginPackageFiles,
} from "../../scripts/buildPluginPackages.js";

const REPOSITORY_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const PLUGIN_ROOT = join(REPOSITORY_ROOT, "plugins", "committing-to-git");

test("package checks skip skills without a host plugin", () => {
  assert.deepEqual(
    buildPluginPackages({ checkOnly: true, skillNames: ["defining-concepts"] }),
    { packagesChecked: 0, stalePackages: [] },
  );
});

test("package check accepts the committed plugin directory", () => {
  assert.deepEqual(buildPluginPackages({ checkOnly: true }), {
    packagesChecked: 1,
    stalePackages: [],
  });
});

test("the committed plugin is self-contained and its manifests agree", () => {
  const claude = JSON.parse(
    readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8"),
  );
  const codex = JSON.parse(
    readFileSync(join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"), "utf8"),
  );

  assert.equal(claude.name, "committing-to-git");
  assert.match(claude.version, /^[0-9]+\.[0-9]+\.[0-9]+-dev\.[1-9][0-9]*$/u);
  assert.equal(codex.version, claude.version);
  assert.equal(codex.skills, "./skills/");
  assert.equal(codex.interface.longDescription, claude.description);
  assert.equal(
    readFileSync(
      join(PLUGIN_ROOT, "skills", "committing-to-git", "SKILL.md"),
      "utf8",
    ),
    readFileSync(
      join(REPOSITORY_ROOT, "skills", "committing-to-git", "SKILL.md"),
      "utf8",
    ),
  );
  for (const notice of [
    "cross-spawn",
    "isexe",
    "path-key",
    "shebang-command",
    "shebang-regex",
    "which",
  ]) {
    assert.ok(readFileSync(join(PLUGIN_ROOT, "notices", `${notice}.LICENSE`)));
  }
});

test("unchanged builds retain the release; changed bytes require a new release", () => {
  const definition = pluginPackageDefinition("committing-to-git");
  const first = pluginPackageFiles(definition, REPOSITORY_ROOT);
  const second = pluginPackageFiles(definition, REPOSITORY_ROOT);

  assert.equal(first.manifest.version, second.manifest.version);

  // A release number is explicit. A changed payload must not silently reuse it.
  assert.throws(
    () =>
      pluginPackageFiles(
        { ...definition, readme: `${definition.readme}\n` },
        REPOSITORY_ROOT,
      ),
    /published inputs changed.*advance.*release/iu,
  );
});
