import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

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

function buildReadOnlyDiffArguments(args, { literalPaths = false } = {}) {
  const separatorIndex = args.indexOf("--");
  const optionArguments = literalPaths
    ? args.slice(0, separatorIndex + 1)
    : args;
  const pathArguments = literalPaths ? args.slice(separatorIndex + 1) : [];
  const forbidden = optionArguments.find(
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

  const renameArguments = optionArguments.filter(
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
  const invalid = optionArguments.find(
    (argument) =>
      !allowedArguments.has(argument) && !FULL_OBJECT_ID.test(argument),
  );
  const outputModes = optionArguments.filter((argument) =>
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
    separatorIndex < 0 ||
    (!literalPaths && args.at(-1) !== "--") ||
    (literalPaths && pathArguments.length === 0) ||
    new Set(optionArguments).size !== optionArguments.length ||
    outputModes.length > 1 ||
    optionArguments.filter((argument) => FULL_OBJECT_ID.test(argument)).length >
      1 ||
    optionArguments.includes("--find-renames=50%") !==
      optionArguments.includes("-l0") ||
    optionArguments.includes("--raw") !==
      optionArguments.includes("--no-abbrev") ||
    (outputModes.some((mode) => mode !== "--quiet") &&
      !optionArguments.includes("-z")) ||
    (literalPaths &&
      pathArguments.some(
        (path) =>
          isAbsolute(path) ||
          path.includes("\0") ||
          path.split(/[\\/]/u).some((component) => component === ".."),
      ))
  ) {
    throw new Error(
      `Arguments are not permitted for read-only Git operation diff${
        invalid ? `: ${invalid}` : ""
      }.`,
    );
  }

  return [
    ...(literalPaths ? ["--literal-pathspecs"] : []),
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    ...optionArguments,
    ...pathArguments,
  ];
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
    case "diff-paths":
      return buildReadOnlyDiffArguments(args, { literalPaths: true });
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

export function buildReadOnlyGitArguments(operation, args = []) {
  return [
    ...READ_ONLY_GLOBAL_ARGUMENTS,
    ...buildReadOnlyArguments(operation, args),
  ];
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

function boundedDiagnosticAppend(state, chunk, maximumBytes) {
  if (maximumBytes === 0 || chunk.length === 0) {
    return;
  }

  const headBudget = Math.ceil(maximumBytes / 2);
  const tailBudget = maximumBytes - headBudget;

  if (state.full !== null) {
    const complete = Buffer.concat([state.full, chunk]);
    state.full = complete.length <= maximumBytes ? complete : null;
  }

  if (state.head.length < headBudget) {
    const needed = headBudget - state.head.length;
    state.head = Buffer.concat([state.head, chunk.subarray(0, needed)]);
  }

  if (tailBudget > 0) {
    state.tail = Buffer.concat([state.tail, chunk]);

    if (state.tail.length > tailBudget) {
      state.tail = state.tail.subarray(state.tail.length - tailBudget);
    }
  }
}

function boundedDiagnosticResult(state, totalBytes, maximumBytes) {
  if (totalBytes <= maximumBytes) {
    return state.full ?? Buffer.alloc(0);
  }

  return Buffer.concat([
    state.head,
    Buffer.from(
      `\n...[${totalBytes - state.head.length - state.tail.length} bytes omitted]...\n`,
    ),
    state.tail,
  ]);
}

async function consumeStream(
  readable,
  { callback, hash, maximumCallbackBytes, diagnostic, maximumDiagnosticBytes },
) {
  let byteCount = 0;

  for await (const value of readable) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);

    hash.update(chunk);
    byteCount += chunk.length;
    boundedDiagnosticAppend(diagnostic, chunk, maximumDiagnosticBytes);

    if (callback) {
      for (let start = 0; start < chunk.length; start += maximumCallbackBytes) {
        await callback(
          Buffer.from(
            chunk.subarray(
              start,
              Math.min(start + maximumCallbackBytes, chunk.length),
            ),
          ),
        );
      }
    }
  }

  return byteCount;
}

function emptyStreamResult({ aborted, timedOut }) {
  const emptyDigest = createHash("sha256")
    .update(Buffer.alloc(0))
    .digest("hex");

  return {
    status: null,
    signal: aborted || timedOut ? "SIGTERM" : null,
    aborted,
    timedOut,
    stdoutByteCount: 0,
    stderrByteCount: 0,
    stdoutSha256: emptyDigest,
    stderrSha256: emptyDigest,
    stderrDiagnostic: "",
  };
}

export async function streamGit(
  operation,
  args = [],
  {
    cwd = process.cwd(),
    env,
    input,
    allowFailure = false,
    onStdout,
    onStderr,
    signal,
    timeoutMs,
    maximumCallbackBytes = 16 * 1024,
    maximumDiagnosticBytes = 32 * 1024,
    launcher = spawn,
  } = {},
) {
  const gitArguments = buildReadOnlyGitArguments(operation, args);

  assertReadOnlyGitCapabilities();

  if (
    !Number.isSafeInteger(maximumCallbackBytes) ||
    maximumCallbackBytes < 1 ||
    !Number.isSafeInteger(maximumDiagnosticBytes) ||
    maximumDiagnosticBytes < 0 ||
    (timeoutMs !== undefined &&
      (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1))
  ) {
    throw new Error("Streaming Git limits must be positive safe integers.");
  }

  if (signal?.aborted) {
    return emptyStreamResult({ aborted: true, timedOut: false });
  }

  const child = launcher("git", gitArguments, {
    cwd,
    env: { ...process.env, ...env, ...READ_ONLY_ENVIRONMENT },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let aborted = false;
  let timedOut = false;
  let callbackError = null;
  const abort = () => {
    aborted = true;
    child.kill("SIGTERM");
  };
  const timeout =
    timeoutMs === undefined
      ? null
      : setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, timeoutMs);

  signal?.addEventListener("abort", abort, { once: true });

  const stdoutHash = createHash("sha256");
  const stderrHash = createHash("sha256");
  const stdoutDiagnostic = {
    full: Buffer.alloc(0),
    head: Buffer.alloc(0),
    tail: Buffer.alloc(0),
  };
  const stderrDiagnostic = {
    full: Buffer.alloc(0),
    head: Buffer.alloc(0),
    tail: Buffer.alloc(0),
  };
  const completion = new Promise((resolveCompletion, rejectCompletion) => {
    child.once("error", rejectCompletion);
    child.once("close", (status, childSignal) =>
      resolveCompletion({ status, signal: childSignal }),
    );
  });

  if (input === undefined) {
    child.stdin.end();
  } else {
    child.stdin.end(input);
  }

  let stdoutByteCount;
  let stderrByteCount;
  let completionResult;

  try {
    const safelyConsume = async (readable, options) => {
      try {
        return await consumeStream(readable, options);
      } catch (error) {
        callbackError ??= error;
        child.kill("SIGTERM");
        return 0;
      }
    };
    const streams = await Promise.all([
      safelyConsume(child.stdout, {
        callback: onStdout,
        hash: stdoutHash,
        maximumCallbackBytes,
        diagnostic: stdoutDiagnostic,
        maximumDiagnosticBytes,
      }),
      safelyConsume(child.stderr, {
        callback: onStderr,
        hash: stderrHash,
        maximumCallbackBytes,
        diagnostic: stderrDiagnostic,
        maximumDiagnosticBytes,
      }),
    ]);

    [stdoutByteCount, stderrByteCount] = streams;
    completionResult = await completion;
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    signal?.removeEventListener("abort", abort);
  }

  if (callbackError) {
    throw callbackError;
  }

  const stdoutSha256 = stdoutHash.digest("hex");
  const stderrSha256 = stderrHash.digest("hex");
  const stderrBytes = boundedDiagnosticResult(
    stderrDiagnostic,
    stderrByteCount,
    maximumDiagnosticBytes,
  );
  const result = {
    status: completionResult.status,
    signal: completionResult.signal,
    aborted,
    timedOut,
    stdoutByteCount,
    stderrByteCount,
    stdoutSha256,
    stderrSha256,
    stderrDiagnostic: stderrBytes.toString("utf8"),
  };

  if (!allowFailure && !aborted && !timedOut && completionResult.status !== 0) {
    throw new GitCommandError(gitArguments, {
      status: completionResult.status,
      stdout: boundedDiagnosticResult(
        stdoutDiagnostic,
        stdoutByteCount,
        maximumDiagnosticBytes,
      ),
      stderr: stderrBytes,
    });
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
