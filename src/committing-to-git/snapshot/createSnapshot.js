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
  readOnlyGitText,
  resolveHead,
  runIndexMutationGit,
  runReadOnlyGit,
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
  const path = readOnlyGitText(root, "git-path", [name]).trim();

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

export function parseGitAlternatePaths(value) {
  if (!value) {
    return [];
  }

  const separator = process.platform === "win32" ? ";" : ":";
  const entries = [];
  let entry = "";
  let quoted = false;
  const escapes = new Map([
    ["a", "\x07"],
    ["b", "\b"],
    ["f", "\f"],
    ["n", "\n"],
    ["r", "\r"],
    ["t", "\t"],
    ["v", "\v"],
    ["\\", "\\"],
    ['"', '"'],
  ]);

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quoted && character === "\\") {
      const escaped = value[index + 1];

      if (escaped === undefined) {
        throw new Error(
          "Git alternate object paths contain invalid C-style quoting.",
        );
      }

      if (/[0-7]/u.test(escaped)) {
        const octal = value.slice(index + 1).match(/^[0-7]{1,3}/u)[0];
        entry += String.fromCharCode(Number.parseInt(octal, 8));
        index += octal.length;
      } else if (escapes.has(escaped)) {
        entry += escapes.get(escaped);
        index += 1;
      } else {
        throw new Error(
          "Git alternate object paths contain an invalid C-style escape.",
        );
      }
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === separator) {
      if (entry.length > 0) {
        entries.push(entry);
      }
      entry = "";
    } else {
      entry += character;
    }
  }

  if (quoted) {
    throw new Error(
      "Git alternate object paths contain invalid C-style quoting.",
    );
  }

  if (entry.length > 0) {
    entries.push(entry);
  }

  return entries;
}

function quoteGitAlternatePath(path, separator) {
  const requiresQuoting = [...path].some((character) => {
    const code = character.codePointAt(0);

    return character === '"' || code < 0x20 || code === 0x7f;
  });

  if (!path.includes(separator) && !requiresQuoting) {
    return path;
  }

  const namedEscapes = new Map([
    ["\x07", "\\a"],
    ["\b", "\\b"],
    ["\f", "\\f"],
    ["\n", "\\n"],
    ["\r", "\\r"],
    ["\t", "\\t"],
    ["\v", "\\v"],
    ["\\", "\\\\"],
    ['"', '\\"'],
  ]);
  const escaped = [...path]
    .map((character) => {
      if (namedEscapes.has(character)) {
        return namedEscapes.get(character);
      }

      const code = character.codePointAt(0);

      return code < 0x20 || code === 0x7f
        ? `\\${code.toString(8).padStart(3, "0")}`
        : character;
    })
    .join("");

  return `"${escaped}"`;
}

export function formatGitAlternatePaths(paths) {
  const separator = process.platform === "win32" ? ";" : ":";

  return paths
    .map((path) => quoteGitAlternatePath(path, separator))
    .join(separator);
}

export function createDraftObjectEnvironment({ root, attemptDirectory }) {
  const indexPath = join(attemptDirectory, "draft-index");
  const objectDirectory = join(attemptDirectory, "draft-objects");

  if (existsSync(indexPath) || existsSync(objectDirectory)) {
    throw new Error("Draft storage already exists in the transaction attempt.");
  }

  mkdirSync(objectDirectory, { mode: 0o700 });

  const primaryObjectDirectory = resolveGitPath(root, "objects");
  const inheritedAlternates = parseGitAlternatePaths(
    process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES,
  ).map((path) => resolve(isAbsolute(path) ? path : join(root, path)));
  const alternates = [
    ...new Set([primaryObjectDirectory, ...inheritedAlternates]),
  ];
  const env = {
    GIT_INDEX_FILE: indexPath,
    GIT_OBJECT_DIRECTORY: objectDirectory,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: formatGitAlternatePaths(alternates),
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_LAZY_FETCH: "1",
  };

  return { env, indexPath, objectDirectory, alternates };
}

function assertRepositoryPreconditions(root) {
  const conflicts = runReadOnlyGit(root, "ls-files", ["-u", "-z"]).stdout;

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
  return runReadOnlyGit(root, "diff", [
    "--cached",
    "--name-only",
    "-z",
    "--no-renames",
    "--",
  ]).stdout;
}

function portableIndexIdentity(identity) {
  return identity.state === "absent"
    ? { state: "absent" }
    : {
        state: "file",
        byteCount: identity.byteCount,
        sha256: identity.sha256,
      };
}

function copyStableIndex(realIndexPath, preparedIndexPath, originalIdentity) {
  if (originalIdentity.state === "absent") {
    return;
  }

  copyFileSync(realIndexPath, preparedIndexPath);
  copySharedIndexFiles(realIndexPath, preparedIndexPath);

  if (process.platform !== "win32") {
    chmodSync(preparedIndexPath, 0o600);
  }

  const currentIdentity = readIndexIdentity(realIndexPath);
  const copiedIdentity = readIndexIdentity(preparedIndexPath);

  if (
    !indexIdentitiesMatch(currentIdentity, originalIdentity) ||
    !indexIdentitiesMatch(copiedIdentity, originalIdentity)
  ) {
    throw new Error(
      "The real index changed while its stable draft copy was made.",
    );
  }
}

export function createSnapshot({
  root,
  mode,
  scope,
  scopePaths = [],
  outputPath,
  preparedIndexPath = null,
  deferIndexInstallation = false,
  stagedPromotionSummary = null,
  maximumSimilarityCandidatePairs,
  maximumEagerLineStatInputBytes,
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

  if (existsSync(outputPath)) {
    throw new Error(`Snapshot output already exists: ${outputPath}`);
  }

  assertRepositoryPreconditions(root);

  const headOid = resolveHead(root);
  const headAnchor = captureHeadAnchor(root);
  const realIndexPath = resolveGitPath(root, "index");
  let originalIndexIdentity;
  let env;
  let sourceIndex = "real";
  let actualPreparedIndexPath = null;
  let draftStorage = null;
  let indexTreeOid = null;

  if (mode === "actual" && scope === "staged") {
    indexTreeOid = writeIndexTree(root);
    originalIndexIdentity = readIndexIdentity(realIndexPath);
  } else {
    originalIndexIdentity = readIndexIdentity(realIndexPath);
  }

  if (mode === "actual" && scope === "paths") {
    const stagedPaths = stagedChangePaths(root);

    if (stagedPaths.length > 0) {
      throw new Error(
        "The real index already contains staged changes; use staged scope or " +
          "resolve the intended index before adding an explicit path scope.",
      );
    }
  }

  if (mode === "draft") {
    draftStorage = createDraftObjectEnvironment({
      root,
      attemptDirectory: dirname(outputPath),
    });
    actualPreparedIndexPath = draftStorage.indexPath;
    env = draftStorage.env;
    sourceIndex = "temporary";

    if (scope === "staged" && originalIndexIdentity.state === "file") {
      copyStableIndex(
        realIndexPath,
        actualPreparedIndexPath,
        originalIndexIdentity,
      );
    } else {
      runIndexMutationGit(root, "read-index-tree", [headOid ?? "--empty"], {
        env,
      });
    }
  } else if (scope !== "staged") {
    actualPreparedIndexPath =
      preparedIndexPath ?? join(dirname(outputPath), "preparation-index");

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

    if (originalIndexIdentity.state === "file") {
      copyStableIndex(
        realIndexPath,
        actualPreparedIndexPath,
        originalIndexIdentity,
      );
    } else {
      runIndexMutationGit(root, "read-index-tree", [headOid ?? "--empty"], {
        env,
      });
    }
  }

  if (scope === "full") {
    runIndexMutationGit(root, "add-all", [], { env });
  } else if (scope === "paths") {
    runIndexMutationGit(root, "add-paths", [], {
      env,
      input: nulPathInput(scopePaths),
    });
  }

  indexTreeOid ??= writeIndexTree(root, env);

  const snapshot = buildSnapshot({
    root,
    env,
    workflowMode: mode,
    scopeKind: scope,
    sourceIndex,
    headOid,
    indexTreeOid,
    ...(maximumSimilarityCandidatePairs === undefined
      ? {}
      : { maximumSimilarityCandidatePairs }),
    ...(maximumEagerLineStatInputBytes === undefined
      ? {}
      : { maximumEagerLineStatInputBytes }),
  });

  if (actualPreparedIndexPath && process.platform !== "win32") {
    chmodSync(actualPreparedIndexPath, 0o600);
  }

  const preparedIndexIdentity = actualPreparedIndexPath
    ? readIndexIdentity(actualPreparedIndexPath)
    : readIndexIdentity(realIndexPath);
  const promotionBlocker =
    mode === "draft" &&
    scope === "paths" &&
    stagedPromotionSummary?.stagedChangeUnitCount > 0
      ? {
          kind: "real-staged-changes",
          realIndexSha256:
            originalIndexIdentity.state === "file"
              ? originalIndexIdentity.sha256
              : null,
          stagedChangeUnitCount: stagedPromotionSummary.stagedChangeUnitCount,
          samples: [...stagedPromotionSummary.samples],
        }
      : null;

  Object.assign(snapshot, {
    indexFile: sourceIndex === "temporary" ? actualPreparedIndexPath : null,
    temporaryObjectDirectory: draftStorage?.objectDirectory ?? null,
    objectAlternates: draftStorage?.alternates ?? [],
    sourceIndexIdentity: portableIndexIdentity(originalIndexIdentity),
    promotionBlocker,
  });

  if (snapshot.changeUnitCount === 0) {
    throw new Error("The staged scope is empty.");
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });

  if (
    mode === "draft" &&
    (!indexIdentitiesMatch(
      readIndexIdentity(realIndexPath),
      originalIndexIdentity,
    ) ||
      JSON.stringify(captureHeadAnchor(root)) !== JSON.stringify(headAnchor))
  ) {
    throw new Error(
      "Repository state changed while the isolated draft snapshot was prepared.",
    );
  }

  if (
    mode === "actual" &&
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
    const currentConflicts = runReadOnlyGit(root, "ls-files", [
      "-u",
      "-z",
    ]).stdout;
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

    runIndexMutationGit(root, "install-index-tree", [snapshot.indexTreeOid]);
  }

  return {
    snapshot,
    headAnchor,
    realIndexPath,
    originalIndexIdentity,
    preparedIndexPath: actualPreparedIndexPath,
    preparedIndexIdentity,
    temporaryObjectDirectory: draftStorage?.objectDirectory ?? null,
    promotionBlocker,
    indexInstallationRequired:
      mode === "actual" && scope !== "staged" && deferIndexInstallation,
  };
}
