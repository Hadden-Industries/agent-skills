import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../..");

function npmCli() {
  // npm test supplies its actual CLI. Direct node --test also works on the
  // supported Windows installation and standard POSIX global npm layout.
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
  ];
  const cli = candidates.find((path) => path && existsSync(path));
  assert.ok(cli, "The selected native npm CLI must already be installed");
  return realpathSync(cli);
}

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "agent-skills-npm-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const contents = {
    name: "native-npm-policy-fixture",
    version: "1.0.0",
    private: true,
  };
  const run = (...args) =>
    spawnSync(process.execPath, [npmCli(), ...args], {
      cwd,
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
      env: { ...process.env, npm_config_offline: "true" },
    });
  const save = () =>
    writeFileSync(join(cwd, "package.json"), JSON.stringify(contents));
  save();
  return { cwd, contents, run, save };
}

test("frozen npm install refuses a manifest dependency absent from its lock", (t) => {
  const f = fixture(t);
  const locked = f.run("install", "--package-lock-only", "--ignore-scripts");
  assert.equal(locked.status, 0, locked.stderr);
  const lock = readFileSync(join(f.cwd, "package-lock.json"));
  f.contents.dependencies = { "missing-lock-fixture": "file:./dependency" };
  // A real local dependency avoids treating a registry/cache failure as the
  // mismatch oracle; npm can resolve it without any external acquisition.
  mkdirSync(join(f.cwd, "dependency"));
  writeFileSync(
    join(f.cwd, "dependency/package.json"),
    JSON.stringify({ name: "missing-lock-fixture", version: "1.0.0" }),
  );
  f.save();
  const denied = f.run("ci", "--ignore-scripts");
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /EUSAGE/u);
  assert.match(denied.stderr, /Missing: .*missing-lock-fixture/u);
  assert.deepEqual(readFileSync(join(f.cwd, "package-lock.json")), lock);
});

for (const [workflow, jobId] of [
  ["evaluation-conformance", "conformance"],
  ["committing-to-git-linux", "verify"],
  ["defining-concepts-linux", "verify"],
  ["markdown-quality", "markdown"],
]) {
  test(`${workflow} selects exact npm before project npm consumers`, () => {
    const document = parse(
      readFileSync(join(root, ".github/workflows", `${workflow}.yml`), "utf8"),
    );
    const job = document.jobs[jobId];
    const setupIndex = job.steps.findIndex((step) =>
      step.uses?.startsWith("actions/setup-node@"),
    );
    assert.ok(setupIndex >= 0);
    assert.equal(job.steps[setupIndex].with["package-manager-cache"], false);
    const bootstrapIndex = job.steps.findIndex(
      (step) => step.uses === "./.github/actions/setup-npm",
    );
    const firstNpmCommand = job.steps.findIndex((step) =>
      /\bnpm\b/u.test(step.run ?? ""),
    );
    assert.ok(bootstrapIndex > setupIndex && firstNpmCommand > bootstrapIndex);
    const bootstrap = job.steps[bootstrapIndex];
    assert.notEqual(bootstrap["continue-on-error"], true);
    assert.equal(bootstrap.if, undefined);
  });
}

test("shared npm setup installs and verifies the same exact version", () => {
  const action = parse(
    readFileSync(join(root, ".github/actions/setup-npm/action.yml"), "utf8"),
  );
  const [setup] = action.runs.steps;
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(setup.shell, "pwsh");
  assert.match(manifest.packageManager, /^npm@\d+\.\d+\.\d+$/u);
  assert.match(setup.run, /require\(process\.argv\[1\]\)\.packageManager/u);
  assert.match(
    setup.run,
    /npm install --global --prefix "\$npmPrefix" "\$selector"/u,
  );
  assert.match(setup.run, /"npm@\$actual" -cne \$selector/u);
});
