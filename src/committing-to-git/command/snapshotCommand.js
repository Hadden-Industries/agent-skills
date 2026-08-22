#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  activeGitOperations,
  gitText,
  repositoryRoot,
  resolveHead,
  runGit,
  writeIndexTree,
} from "../git/gitRepository.js";
import { buildSnapshot } from "../snapshot/commitSnapshot.js";

function usageError(message) {
  console.error(message);
  console.error(
    "Usage: node commitWorkflow.mjs snapshot create --mode actual|draft " +
      "--scope staged|full|paths [--scope-file <scope.json>] " +
      "--output <snapshot.json>",
  );
  process.exit(2);
}

function parseArguments(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key?.startsWith("--") || value === undefined) {
      usageError(`Invalid argument near ${JSON.stringify(key)}.`);
    }

    values.set(key.slice(2), value);
  }

  const mode = values.get("mode");
  const scope = values.get("scope");
  const scopeFile = values.get("scope-file");
  const output = values.get("output");

  if (!new Set(["actual", "draft"]).has(mode)) {
    usageError("--mode must be actual or draft.");
  }

  if (!new Set(["staged", "full", "paths"]).has(scope)) {
    usageError("--scope must be staged, full, or paths.");
  }

  if (!output) {
    usageError("--output is required.");
  }

  if (scope === "paths" && !scopeFile) {
    usageError("--scope-file is required for path scope.");
  }

  return {
    mode,
    scope,
    scopeFile: scopeFile ? resolve(scopeFile) : null,
    output: resolve(output),
  };
}

function readScopePaths(path) {
  const payload = JSON.parse(readFileSync(path, "utf8"));

  if (
    !Array.isArray(payload.paths) ||
    payload.paths.length === 0 ||
    payload.paths.some(
      (entry) => typeof entry !== "string" || entry.length === 0,
    )
  ) {
    throw new Error(
      "Scope file must contain a non-empty string array named paths.",
    );
  }

  if (payload.paths.some((entry) => entry.includes("\0"))) {
    throw new Error("Scope paths cannot contain NUL bytes.");
  }

  return payload.paths;
}

function nulPathInput(paths) {
  return Buffer.concat(
    paths.flatMap((path) => [Buffer.from(path, "utf8"), Buffer.from([0])]),
  );
}

const options = parseArguments(process.argv.slice(2));

try {
  const root = repositoryRoot();
  const conflicts = gitText(["ls-files", "-u", "-z"], { cwd: root });

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

  const headOid = resolveHead(root);
  let env;
  let sourceIndex = "real";
  let initialRealIndexTree = null;
  let installPreparedTree = false;

  if (options.mode === "actual" && options.scope === "paths") {
    const stagedPaths = runGit(
      ["diff", "--cached", "--name-only", "-z", "--"],
      {
        cwd: root,
      },
    ).stdout;

    if (stagedPaths.length > 0) {
      throw new Error(
        "The real index already contains staged changes; use staged scope or " +
          "resolve the intended index before adding an explicit path scope.",
      );
    }
  }

  if (options.scope !== "staged") {
    const temporaryIndex = join(
      dirname(options.output),
      options.mode === "draft" ? "temporary-index" : "preparation-index",
    );

    if (existsSync(temporaryIndex)) {
      throw new Error(`Temporary index already exists: ${temporaryIndex}`);
    }

    mkdirSync(dirname(temporaryIndex), { recursive: true });
    env = { GIT_INDEX_FILE: temporaryIndex };

    if (options.mode === "draft") {
      sourceIndex = "temporary";
      runGit(headOid ? ["read-tree", headOid] : ["read-tree", "--empty"], {
        cwd: root,
        env,
      });
    } else {
      initialRealIndexTree = writeIndexTree(root);
      installPreparedTree = true;
      runGit(["read-tree", initialRealIndexTree], { cwd: root, env });
    }
  }

  if (options.scope === "full") {
    runGit(["add", "-A"], { cwd: root, env });
  } else if (options.scope === "paths") {
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
        input: nulPathInput(readScopePaths(options.scopeFile)),
      },
    );
  }

  const snapshot = buildSnapshot({
    root,
    env,
    workflowMode: options.mode,
    scopeKind: options.scope,
    sourceIndex,
    headOid,
  });

  snapshot.indexFile = sourceIndex === "temporary" ? env.GIT_INDEX_FILE : null;

  if (snapshot.changeUnitCount === 0) {
    throw new Error("The staged scope is empty.");
  }

  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(snapshot, null, 2)}\n`);

  if (installPreparedTree) {
    const currentHeadOid = resolveHead(root);
    const currentOperations = activeGitOperations(root);
    const currentConflicts = gitText(["ls-files", "-u", "-z"], { cwd: root });
    const currentIndexTree = writeIndexTree(root);

    if (
      currentHeadOid !== headOid ||
      currentOperations.length > 0 ||
      currentConflicts.length > 0 ||
      currentIndexTree !== initialRealIndexTree
    ) {
      throw new Error(
        "Repository state changed while the staged snapshot was being prepared; " +
          "the real index was not replaced.",
      );
    }

    runGit(["read-tree", snapshot.indexTreeOid], { cwd: root });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        snapshot: options.output,
        indexTreeOid: snapshot.indexTreeOid,
        changeUnitCount: snapshot.changeUnitCount,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  console.error(`Commit scope preparation failed: ${error.message}`);
  process.exit(2);
}
