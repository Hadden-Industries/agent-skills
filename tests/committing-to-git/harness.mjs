import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
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

export function configureSshSigning(t, fixture) {
  const keyPath = join(fixture.scratch, "signing-key");
  const result = spawnSync(
    "ssh-keygen",
    ["-q", "-t", "ed25519", "-N", "", "-f", keyPath],
    { cwd: fixture.repo, encoding: "utf8", windowsHide: true },
  );

  if (result.status !== 0) {
    t.skip(`ssh-keygen is unavailable: ${result.stderr || result.error}`);
    return false;
  }

  git(["config", "gpg.format", "ssh"], fixture.repo);
  git(["config", "user.signingkey", keyPath], fixture.repo);
  return true;
}

export function writeRepositoryFile(repo, relativePath, contents) {
  const target = join(repo, relativePath);

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function commitAll(repo, message = "seed") {
  git(["add", "-A"], repo);
  git(["commit", "--quiet", "-m", message], repo);
}

export function runNodeScript(script, args, cwd, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    env: options.env ? { ...process.env, ...options.env } : process.env,
    windowsHide: true,
  });
}

export function runCommitWorkflow(command, args, cwd, options = {}) {
  return runNodeScript(
    COMMIT_WORKFLOW,
    [...command.split(" "), ...args],
    cwd,
    options,
  );
}

function countTrace2Processes(trace2File) {
  if (!trace2File || !existsSync(trace2File)) {
    return 0;
  }

  const trace = readFileSync(trace2File, "utf8").trim();

  if (!trace) {
    return 0;
  }

  // Each Git process writes one `start` event. Counting those records avoids
  // treating regions, data events, hooks, and other traced children as Git
  // processes while still counting nested Git invocations exactly once.
  return trace
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line))
    .filter((event) => event.event === "start").length;
}

export function runRecordedWorkflow(command, args, cwd, options = {}) {
  const startedAt = performance.now();
  const result = runCommitWorkflow(command, args, cwd, options);

  return {
    result,
    invocation: {
      command,
      args: [...args],
      status: result.status,
      gitProcesses: countTrace2Processes(options.trace2File),
      stdoutBytes: Buffer.byteLength(result.stdout ?? ""),
      stderrBytes: Buffer.byteLength(result.stderr ?? ""),
      durationMs: performance.now() - startedAt,
    },
  };
}

export function summarizeWorkflowCost(invocations) {
  return invocations.reduce(
    (summary, invocation) => ({
      helperCalls: summary.helperCalls + 1,
      gitProcesses: summary.gitProcesses + invocation.gitProcesses,
      stdoutBytes: summary.stdoutBytes + invocation.stdoutBytes,
      stderrBytes: summary.stderrBytes + invocation.stderrBytes,
      durationMs: summary.durationMs + invocation.durationMs,
    }),
    {
      helperCalls: 0,
      gitProcesses: 0,
      stdoutBytes: 0,
      stderrBytes: 0,
      durationMs: 0,
    },
  );
}

export function readGitTraceArguments(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line))
    .filter(
      (event) =>
        new Set(["start", "child_start"]).has(event.event) &&
        Array.isArray(event.argv),
    )
    .map((event) => event.argv);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
