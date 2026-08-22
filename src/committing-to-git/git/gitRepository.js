import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Git process boundary for the commit workflow.

export class GitCommandError extends Error {
  constructor(args, result) {
    const stderr = result.stderr?.toString("utf8").trim();
    const stdout = result.stdout?.toString("utf8").trim();

    super(
      `git ${args.join(" ")} failed: ${stderr || stdout || `exit ${result.status}`}`,
    );
    this.name = "GitCommandError";
    this.args = args;
    this.status = result.status;
    this.stderr = stderr ?? "";
    this.stdout = stdout ?? "";
  }
}

export function runGit(
  args,
  { cwd = process.cwd(), env, input, allowFailure = false } = {},
) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: null,
    env: env ? { ...process.env, ...env } : process.env,
    input,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (!allowFailure && result.status !== 0) {
    throw new GitCommandError(args, result);
  }

  return result;
}

export function gitText(args, options) {
  return runGit(args, options).stdout.toString("utf8");
}

export function repositoryRoot(cwd = process.cwd()) {
  return gitText(["rev-parse", "--show-toplevel"], { cwd }).trim();
}

export function resolveHead(root, env) {
  const result = runGit(["rev-parse", "--verify", "HEAD"], {
    cwd: root,
    env,
    allowFailure: true,
  });

  return result.status === 0 ? result.stdout.toString("utf8").trim() : null;
}

export function writeIndexTree(root, env) {
  return gitText(["write-tree"], { cwd: root, env }).trim();
}

const OPERATION_MARKERS = [
  ["merge", "MERGE_HEAD"],
  ["cherry-pick", "CHERRY_PICK_HEAD"],
  ["revert", "REVERT_HEAD"],
  ["rebase", "rebase-merge"],
  ["rebase", "rebase-apply"],
  ["sequencer", "sequencer"],
];

export function activeGitOperations(root) {
  const operations = OPERATION_MARKERS.filter(([, marker]) => {
    const markerPath = gitText(["rev-parse", "--git-path", marker], {
      cwd: root,
    }).trim();

    return existsSync(resolve(root, markerPath));
  }).map(([operation]) => operation);

  return [...new Set(operations)];
}
