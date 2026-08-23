import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Git process boundary for the commit workflow.

const READ_ONLY_ENVIRONMENT = Object.freeze({
  GIT_OPTIONAL_LOCKS: "0",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_PAGER: "cat",
  PAGER: "cat",
  NO_COLOR: "1",
});
const READ_ONLY_GLOBAL_ARGUMENTS = Object.freeze([
  "--no-lazy-fetch",
  "--no-pager",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "color.ui=false",
]);
const INDEX_MUTATION_GLOBAL_ARGUMENTS = Object.freeze([
  "--no-pager",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "color.ui=false",
]);
const OPERATION_MARKER_NAMES = new Set([
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "rebase-merge",
  "rebase-apply",
  "sequencer",
]);
const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

let readOnlyCapability;

export class GitCapabilityError extends Error {
  constructor(message, { gitVersion = null } = {}) {
    super(message);
    this.name = "GitCapabilityError";
    this.code = "UNSUPPORTED_GIT_VERSION";
    this.gitVersion = gitVersion;
  }
}

function normalizeProbeResult(result) {
  if (result?.error) {
    throw new GitCapabilityError(
      `Git cannot enforce the required no-lazy-fetch boundary: ${result.error.message}`,
    );
  }

  const stdout = Buffer.isBuffer(result?.stdout)
    ? result.stdout.toString("utf8")
    : String(result?.stdout ?? "");
  const stderr = Buffer.isBuffer(result?.stderr)
    ? result.stderr.toString("utf8")
    : String(result?.stderr ?? "");
  const observedVersion = stdout.trim().startsWith("git version ")
    ? stdout.trim()
    : null;

  if (result?.status !== 0 || observedVersion === null) {
    throw new GitCapabilityError(
      "Git cannot enforce --no-lazy-fetch; preparation requires a compatible Git 2.45+ capability boundary.",
      { gitVersion: observedVersion ?? (stderr.trim() || null) },
    );
  }

  return { gitVersion: observedVersion, noLazyFetch: true };
}

export function assertReadOnlyGitCapabilities({ probe } = {}) {
  if (!probe && readOnlyCapability) {
    return { ...readOnlyCapability };
  }

  const result = probe
    ? probe()
    : spawnSync("git", ["--no-lazy-fetch", "--version"], {
        encoding: null,
        env: { ...process.env, ...READ_ONLY_ENVIRONMENT },
        windowsHide: true,
      });
  const capability = normalizeProbeResult(result);

  if (!probe) {
    readOnlyCapability = capability;
  }

  return { ...capability };
}

function assertStringArguments(args, operation) {
  if (
    !Array.isArray(args) ||
    args.some(
      (argument) =>
        typeof argument !== "string" ||
        argument.length === 0 ||
        argument.includes("\0"),
    )
  ) {
    throw new Error(
      `Arguments for read-only Git operation ${operation} must be non-empty strings.`,
    );
  }
}

function assertExactArguments(args, expected, operation) {
  if (JSON.stringify(args) !== JSON.stringify(expected)) {
    throw new Error(
      `Arguments are not permitted for read-only Git operation ${operation}.`,
    );
  }
}

function buildReadOnlyDiffArguments(args) {
  const forbidden = args.find(
    (argument) =>
      argument === "--ext-diff" ||
      argument === "--textconv" ||
      argument === "--color" ||
      argument.startsWith("--color=") ||
      argument === "--paginate" ||
      argument === "-p" ||
      argument === "--no-pager" ||
      argument.startsWith("--output"),
  );

  if (forbidden) {
    throw new Error(
      `Argument ${forbidden} is not permitted for read-only Git operation diff.`,
    );
  }

  const renameArguments = args.filter(
    (argument) =>
      argument === "--no-renames" || argument.startsWith("--find-renames="),
  );

  if (renameArguments.length !== 1) {
    throw new Error(
      "Read-only Git operation diff requires exactly one explicit rename policy.",
    );
  }

  const allowedArguments = new Set([
    "--cached",
    "-z",
    "--raw",
    "--no-abbrev",
    "--name-status",
    "--name-only",
    "--numstat",
    "--quiet",
    "--no-renames",
    "--find-renames=50%",
    "-l0",
    "--diff-filter=d",
    "--ignore-submodules=none",
    "--root",
    "--",
  ]);
  const invalid = args.find(
    (argument) =>
      !allowedArguments.has(argument) && !FULL_OBJECT_ID.test(argument),
  );
  const outputModes = args.filter((argument) =>
    new Set([
      "--raw",
      "--name-status",
      "--name-only",
      "--numstat",
      "--quiet",
    ]).has(argument),
  );

  if (
    invalid ||
    args.at(-1) !== "--" ||
    new Set(args).size !== args.length ||
    outputModes.length > 1 ||
    args.filter((argument) => FULL_OBJECT_ID.test(argument)).length > 1 ||
    args.includes("--find-renames=50%") !== args.includes("-l0") ||
    args.includes("--raw") !== args.includes("--no-abbrev") ||
    (outputModes.some((mode) => mode !== "--quiet") && !args.includes("-z"))
  ) {
    throw new Error(
      `Arguments are not permitted for read-only Git operation diff${
        invalid ? `: ${invalid}` : ""
      }.`,
    );
  }

  return ["diff", "--no-ext-diff", "--no-textconv", "--no-color", ...args];
}

function buildReadOnlyCatFileArguments(args) {
  if (
    args.length === 2 &&
    new Set(["-t", "blob", "commit"]).has(args[0]) &&
    FULL_OBJECT_ID.test(args[1])
  ) {
    return ["cat-file", ...args];
  }

  if (
    args.length === 1 &&
    args[0] === "--batch-check=%(objectname) %(objecttype) %(objectsize)"
  ) {
    return ["cat-file", args[0]];
  }

  throw new Error(
    "Arguments are not permitted for read-only Git operation cat-file.",
  );
}

function buildReadOnlyDiffTreeArguments(args) {
  const format = args.at(-2);
  const commitOid = args.at(-1);
  const expectedPrefix = [
    "--root",
    "--no-commit-id",
    "-r",
    "-z",
    "--no-renames",
  ];

  if (
    args.length !== expectedPrefix.length + 2 ||
    JSON.stringify(args.slice(0, expectedPrefix.length)) !==
      JSON.stringify(expectedPrefix) ||
    !new Set(["--numstat", "--raw"]).has(format) ||
    !FULL_OBJECT_ID.test(commitOid)
  ) {
    throw new Error(
      "Arguments are not permitted for read-only Git operation diff-tree.",
    );
  }

  return [
    "diff-tree",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    ...expectedPrefix,
    format,
    ...(format === "--raw" ? ["--no-abbrev"] : []),
    commitOid,
  ];
}

function buildReadOnlyArguments(operation, args) {
  assertStringArguments(args, operation);

  switch (operation) {
    case "repository-root":
      assertExactArguments(args, [], operation);
      return ["rev-parse", "--show-toplevel"];
    case "resolve-head":
      assertExactArguments(args, [], operation);
      return ["rev-parse", "--verify", "HEAD"];
    case "symbolic-head":
      assertExactArguments(args, [], operation);
      return ["symbolic-ref", "--quiet", "HEAD"];
    case "short-symbolic-head":
      assertExactArguments(args, [], operation);
      return ["symbolic-ref", "--short", "-q", "HEAD"];
    case "operation-markers":
      if (
        args.length === 0 ||
        args.some((argument) => !OPERATION_MARKER_NAMES.has(argument))
      ) {
        throw new Error(
          "Arguments are not permitted for read-only Git operation operation-markers.",
        );
      }
      return [
        "rev-parse",
        "--path-format=absolute",
        ...args.flatMap((marker) => ["--git-path", marker]),
      ];
    case "git-path":
      if (args.length !== 1 || !new Set(["index", "objects"]).has(args[0])) {
        throw new Error(
          "Arguments are not permitted for read-only Git operation git-path.",
        );
      }
      return ["rev-parse", "--path-format=absolute", "--git-path", args[0]];
    case "status":
      if (
        !args.includes("--porcelain=v2") ||
        !args.includes("-z") ||
        args.filter(
          (argument) => argument === "--renames" || argument === "--no-renames",
        ).length !== 1 ||
        args.some(
          (argument) =>
            !new Set([
              "--porcelain=v2",
              "-z",
              "--untracked-files=all",
              "--renames",
              "--no-renames",
            ]).has(argument),
        ) ||
        new Set(args).size !== args.length
      ) {
        throw new Error(
          "Arguments are not permitted for read-only Git operation status.",
        );
      }
      return ["status", ...args];
    case "ls-files":
      if (
        ![
          ["-u", "-z"],
          ["--stage", "-z", "--"],
          ["--others", "--exclude-standard", "-z", "--"],
        ].some((allowed) => JSON.stringify(args) === JSON.stringify(allowed))
      ) {
        throw new Error(
          "Arguments are not permitted for read-only Git operation ls-files.",
        );
      }
      return ["ls-files", ...args];
    case "diff":
      return buildReadOnlyDiffArguments(args);
    case "diff-tree":
      return buildReadOnlyDiffTreeArguments(args);
    case "cat-file":
      return buildReadOnlyCatFileArguments(args);
    case "hash-object":
      if (args.length !== 3 || args[0] !== "--no-filters" || args[1] !== "--") {
        throw new Error(
          "Arguments are not permitted for read-only Git operation hash-object.",
        );
      }
      return ["hash-object", ...args];
    case "show-message":
      if (args.length !== 1 || !FULL_OBJECT_ID.test(args[0])) {
        throw new Error(
          "Arguments are not permitted for read-only Git operation show-message.",
        );
      }
      return ["show", "-s", "--format=%B", args[0]];
    case "show-commit-fields":
      if (
        args.length !== 2 ||
        !args[0].startsWith("--format=") ||
        !FULL_OBJECT_ID.test(args[1])
      ) {
        throw new Error(
          "Arguments are not permitted for read-only Git operation show-commit-fields.",
        );
      }
      return ["show", "-s", args[0], args[1]];
    case "short-object-id":
      if (args.length !== 1 || !FULL_OBJECT_ID.test(args[0])) {
        throw new Error(
          "Arguments are not permitted for read-only Git operation short-object-id.",
        );
      }
      return ["rev-parse", "--short=12", args[0]];
    case "check-ref-format":
      if (args.length !== 1 || !args[0].startsWith("refs/")) {
        throw new Error(
          "Arguments are not permitted for read-only Git operation check-ref-format.",
        );
      }
      return ["check-ref-format", args[0]];
    default:
      throw new Error(
        `Unsupported read-only Git operation ${JSON.stringify(operation)}.`,
      );
  }
}

function buildIndexMutationArguments(operation, args) {
  assertStringArguments(args, operation);

  switch (operation) {
    case "write-index-tree":
      assertExactArguments(args, [], operation);
      return ["write-tree"];
    case "read-index-tree":
      if (
        args.length !== 1 ||
        (args[0] !== "--empty" && !FULL_OBJECT_ID.test(args[0]))
      ) {
        throw new Error(
          "Arguments are not permitted for index mutation read-index-tree.",
        );
      }
      return ["read-tree", args[0]];
    case "add-all":
      assertExactArguments(args, [], operation);
      return ["add", "-A"];
    case "add-paths":
      assertExactArguments(args, [], operation);
      return [
        "--literal-pathspecs",
        "add",
        "-A",
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
      ];
    case "install-index-tree":
      if (args.length !== 1 || !FULL_OBJECT_ID.test(args[0])) {
        throw new Error(
          "Arguments are not permitted for index mutation install-index-tree.",
        );
      }
      return ["read-tree", args[0]];
    default:
      throw new Error(
        `Unsupported index mutation operation ${JSON.stringify(operation)}.`,
      );
  }
}

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

export function runReadOnlyGit(
  root,
  operation,
  args = [],
  { env, input, allowFailure = false, launcher = spawnSync } = {},
) {
  const operationArguments = buildReadOnlyArguments(operation, args);

  assertReadOnlyGitCapabilities();

  const gitArguments = [...READ_ONLY_GLOBAL_ARGUMENTS, ...operationArguments];
  const result = launcher("git", gitArguments, {
    cwd: root,
    encoding: null,
    env: {
      ...process.env,
      ...env,
      ...READ_ONLY_ENVIRONMENT,
    },
    input,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (!allowFailure && result.status !== 0) {
    throw new GitCommandError(gitArguments, result);
  }

  return result;
}

export function runIndexMutationGit(
  root,
  operation,
  args = [],
  { env, input, allowFailure = false } = {},
) {
  const operationArguments = buildIndexMutationArguments(operation, args);

  return runGit([...INDEX_MUTATION_GLOBAL_ARGUMENTS, ...operationArguments], {
    cwd: root,
    env: {
      ...env,
      GIT_PAGER: "cat",
      PAGER: "cat",
      NO_COLOR: "1",
    },
    input,
    allowFailure,
  });
}

export function readOnlyGitText(root, operation, args = [], options) {
  return runReadOnlyGit(root, operation, args, options).stdout.toString("utf8");
}

export function gitText(args, options) {
  return runGit(args, options).stdout.toString("utf8");
}

export function repositoryRoot(cwd = process.cwd()) {
  return readOnlyGitText(cwd, "repository-root").trim();
}

export function resolveHead(root, env) {
  const result = runReadOnlyGit(root, "resolve-head", [], {
    env,
    allowFailure: true,
  });

  return result.status === 0 ? result.stdout.toString("utf8").trim() : null;
}

export function writeIndexTree(root, env) {
  return runIndexMutationGit(root, "write-index-tree", [], { env })
    .stdout.toString("utf8")
    .trim();
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
  const objectType = readOnlyGitText(root, "cat-file", ["-t", treeOid], {
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
    "--no-renames",
    "--ignore-submodules=none",
    treeOid,
    "--",
  ];
  const result = runReadOnlyGit(root, "diff", args.slice(1), {
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
  const markerPaths = readOnlyGitText(
    root,
    "operation-markers",
    OPERATION_MARKERS.map(([, marker]) => marker),
  )
    .trim()
    .split(/\r?\n/u);
  const operations = OPERATION_MARKERS.filter((_, index) =>
    existsSync(resolve(root, markerPaths[index])),
  ).map(([operation]) => operation);

  return [...new Set(operations)];
}
