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

export function indexMatchesTree(root, treeOid, env) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(treeOid)) {
    throw new Error(`Invalid full tree object ID: ${JSON.stringify(treeOid)}.`);
  }

  const readOnlyEnv = {
    ...env,
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
  const objectType = gitText(["cat-file", "-t", treeOid], {
    cwd: root,
    env: readOnlyEnv,
  }).trim();

  if (objectType !== "tree") {
    throw new Error(
      `Expected tree object ID ${treeOid} must identify a tree object, not ${objectType}.`,
    );
  }

  const args = [
    "diff",
    "--cached",
    "--quiet",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--ignore-submodules=none",
    treeOid,
    "--",
  ];
  const result = runGit(args, {
    cwd: root,
    env: readOnlyEnv,
    allowFailure: true,
  });

  if (result.status === 0) {
    return true;
  }

  if (result.status === 1) {
    return false;
  }

  throw new GitCommandError(args, result);
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
  const markerPaths = gitText(
    [
      "rev-parse",
      "--path-format=absolute",
      ...OPERATION_MARKERS.flatMap(([, marker]) => ["--git-path", marker]),
    ],
    { cwd: root },
  )
    .trim()
    .split(/\r?\n/u);
  const operations = OPERATION_MARKERS.filter((_, index) =>
    existsSync(resolve(root, markerPaths[index])),
  ).map(([operation]) => operation);

  return [...new Set(operations)];
}
