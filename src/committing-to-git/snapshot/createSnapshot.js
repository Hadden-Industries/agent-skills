import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  activeGitOperations,
  gitText,
  resolveHead,
  runGit,
  writeIndexTree,
} from "../git/gitRepository.js";
import {
  captureHeadAnchor,
  indexIdentitiesMatch,
  readIndexIdentity,
} from "../transaction/indexInstallation.js";
import { buildSnapshot } from "./commitSnapshot.js";

function nulPathInput(paths) {
  return Buffer.concat(
    paths.flatMap((path) => [
      Buffer.isBuffer(path) ? path : Buffer.from(path, "utf8"),
      Buffer.from([0]),
    ]),
  );
}

function resolveGitPath(root, name) {
  const path = gitText(
    ["rev-parse", "--path-format=absolute", "--git-path", name],
    { cwd: root },
  ).trim();

  return resolve(isAbsolute(path) ? path : join(root, path));
}

function copySharedIndexFiles(realIndexPath, preparedIndexPath) {
  const sourceDirectory = dirname(realIndexPath);
  const destinationDirectory = dirname(preparedIndexPath);

  for (const name of readdirSync(sourceDirectory)) {
    if (!name.startsWith("sharedindex.")) {
      continue;
    }

    const destination = join(destinationDirectory, name);

    if (!existsSync(destination)) {
      copyFileSync(join(sourceDirectory, name), destination);

      if (process.platform !== "win32") {
        chmodSync(destination, 0o600);
      }
    }
  }
}

function assertRepositoryPreconditions(root) {
  const conflicts = runGit(["ls-files", "-u", "-z"], { cwd: root }).stdout;

  if (conflicts.length > 0) {
    throw new Error(
      "Cannot prepare a commit snapshot while conflicts remain unresolved.",
    );
  }

  const activeOperations = activeGitOperations(root);

  if (activeOperations.length > 0) {
    throw new Error(
      "Cannot prepare an ordinary commit snapshot during an active " +
        `${activeOperations.join(", ")} operation.`,
    );
  }
}

function stagedChangePaths(root) {
  return runGit(["diff", "--cached", "--name-only", "-z", "--"], {
    cwd: root,
  }).stdout;
}

export function createSnapshot({
  root,
  mode,
  scope,
  scopePaths = [],
  outputPath,
  preparedIndexPath = null,
  deferIndexInstallation = false,
}) {
  if (!new Set(["actual", "draft"]).has(mode)) {
    throw new Error("Snapshot mode must be actual or draft.");
  }

  if (!new Set(["staged", "full", "paths"]).has(scope)) {
    throw new Error("Snapshot scope must be staged, full, or paths.");
  }

  if (scope === "paths" && scopePaths.length === 0) {
    throw new Error("Path scope requires at least one literal path.");
  }

  assertRepositoryPreconditions(root);

  const headOid = resolveHead(root);
  const headAnchor = captureHeadAnchor(root);
  const realIndexPath = resolveGitPath(root, "index");
  let env = scope === "staged" ? { GIT_OPTIONAL_LOCKS: "0" } : undefined;
  let sourceIndex = "real";
  let actualPreparedIndexPath = null;

  if (scope === "staged") {
    writeIndexTree(root, env);
  }

  const originalIndexIdentity = readIndexIdentity(realIndexPath);

  if (mode === "actual" && scope === "paths") {
    const stagedPaths = stagedChangePaths(root);

    if (stagedPaths.length > 0) {
      throw new Error(
        "The real index already contains staged changes; use staged scope or " +
          "resolve the intended index before adding an explicit path scope.",
      );
    }
  }

  if (scope !== "staged") {
    actualPreparedIndexPath =
      preparedIndexPath ??
      join(
        dirname(outputPath),
        mode === "draft" ? "temporary-index" : "preparation-index",
      );

    if (existsSync(actualPreparedIndexPath)) {
      throw new Error(
        `Temporary index already exists: ${actualPreparedIndexPath}`,
      );
    }

    mkdirSync(dirname(actualPreparedIndexPath), { recursive: true });
    env = {
      GIT_INDEX_FILE: actualPreparedIndexPath,
      GIT_OPTIONAL_LOCKS: "0",
    };

    if (mode === "draft") {
      sourceIndex = "temporary";
      runGit(headOid ? ["read-tree", headOid] : ["read-tree", "--empty"], {
        cwd: root,
        env,
      });
    } else if (originalIndexIdentity.state === "file") {
      copyFileSync(realIndexPath, actualPreparedIndexPath);
      copySharedIndexFiles(realIndexPath, actualPreparedIndexPath);
    } else {
      runGit(headOid ? ["read-tree", headOid] : ["read-tree", "--empty"], {
        cwd: root,
        env,
      });
    }
  }

  if (scope === "full") {
    runGit(["add", "-A"], { cwd: root, env });
  } else if (scope === "paths") {
    runGit(
      [
        "--literal-pathspecs",
        "add",
        "-A",
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
      ],
      {
        cwd: root,
        env,
        input: nulPathInput(scopePaths),
      },
    );
  }

  const snapshot = buildSnapshot({
    root,
    env,
    workflowMode: mode,
    scopeKind: scope,
    sourceIndex,
    headOid,
  });

  if (actualPreparedIndexPath && process.platform !== "win32") {
    chmodSync(actualPreparedIndexPath, 0o600);
  }

  snapshot.indexFile =
    sourceIndex === "temporary" ? actualPreparedIndexPath : null;

  if (snapshot.changeUnitCount === 0) {
    throw new Error("The staged scope is empty.");
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });

  const preparedIndexIdentity = actualPreparedIndexPath
    ? readIndexIdentity(actualPreparedIndexPath)
    : readIndexIdentity(realIndexPath);

  if (
    scope === "staged" &&
    (!indexIdentitiesMatch(preparedIndexIdentity, originalIndexIdentity) ||
      JSON.stringify(captureHeadAnchor(root)) !== JSON.stringify(headAnchor))
  ) {
    throw new Error(
      "Repository state changed while the staged snapshot was being read.",
    );
  }

  if (mode === "actual" && scope !== "staged" && !deferIndexInstallation) {
    const currentHeadAnchor = captureHeadAnchor(root);
    const currentOperations = activeGitOperations(root);
    const currentConflicts = runGit(["ls-files", "-u", "-z"], {
      cwd: root,
    }).stdout;
    const currentIndexIdentity = readIndexIdentity(realIndexPath);

    if (
      JSON.stringify(currentHeadAnchor) !== JSON.stringify(headAnchor) ||
      currentOperations.length > 0 ||
      currentConflicts.length > 0 ||
      !indexIdentitiesMatch(currentIndexIdentity, originalIndexIdentity)
    ) {
      throw new Error(
        "Repository state changed while the staged snapshot was being prepared; " +
          "the real index was not replaced.",
      );
    }

    runGit(["read-tree", snapshot.indexTreeOid], { cwd: root });
  }

  return {
    snapshot,
    headAnchor,
    realIndexPath,
    originalIndexIdentity,
    preparedIndexPath: actualPreparedIndexPath,
    preparedIndexIdentity,
    indexInstallationRequired:
      mode === "actual" && scope !== "staged" && deferIndexInstallation,
  };
}
