import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMMIT_WORKFLOW = join(
  REPO_ROOT,
  "skills",
  "committing-to-git",
  "scripts",
  "commitWorkflow.mjs",
);

export function git(args, cwd, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: options.env,
    input: options.input,
    windowsHide: true,
  });

  if (!options.allowFailure) {
    assert.equal(
      result.status,
      0,
      `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }

  return result;
}

export function createRepositoryFixture(t, prefix = "committing-to-git-") {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const repo = join(base, "repo");
  const scratch = join(base, "scratch");

  mkdirSync(repo);
  mkdirSync(scratch);

  git(["init", "--quiet", "-b", "main"], repo);
  git(["config", "user.email", "tests@example.invalid"], repo);
  git(["config", "user.name", "Committing To Git Tests"], repo);
  git(["config", "commit.gpgsign", "false"], repo);

  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  return { base, repo, scratch };
}

export function writeRepositoryFile(repo, relativePath, contents) {
  const target = join(repo, relativePath);

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

export function commitAll(repo, message = "seed") {
  git(["add", "-A"], repo);
  git(["commit", "--quiet", "-m", message], repo);
}

export function runNodeScript(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

export function runCommitWorkflow(command, args, cwd) {
  return runNodeScript(COMMIT_WORKFLOW, [...command.split(" "), ...args], cwd);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
