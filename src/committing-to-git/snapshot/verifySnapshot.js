import { resolve } from "node:path";

import {
  activeGitOperations,
  indexMatchesTree,
  resolveHead,
  runReadOnlyGit,
} from "../git/gitRepository.js";
import { formatGitAlternatePaths } from "./createSnapshot.js";

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);

  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function manifestEnvironment(manifest) {
  if (manifest.sourceIndex !== "temporary" || !manifest.indexFile) {
    return undefined;
  }

  return {
    GIT_INDEX_FILE: manifest.indexFile,
    ...(manifest.temporaryObjectDirectory
      ? { GIT_OBJECT_DIRECTORY: manifest.temporaryObjectDirectory }
      : {}),
    ...(Array.isArray(manifest.objectAlternates) &&
    manifest.objectAlternates.length > 0
      ? {
          GIT_ALTERNATE_OBJECT_DIRECTORIES: formatGitAlternatePaths(
            manifest.objectAlternates,
          ),
        }
      : {}),
  };
}

function symbolicHead(root, env) {
  const result = runReadOnlyGit(root, "symbolic-head", [], {
    env,
    allowFailure: true,
  });

  return result.status === 0 ? result.stdout.toString("utf8").trim() : null;
}

function compareHeadAnchor(root, headAnchor, env) {
  const actualHeadOid = resolveHead(root, env);
  const actualTargetRef = symbolicHead(root, env);

  if (headAnchor === undefined) {
    return { matches: true, actualHeadOid, actualTargetRef };
  }

  if (headAnchor === null) {
    return {
      matches: actualHeadOid === null,
      actualHeadOid,
      actualTargetRef,
    };
  }

  const expectedParentOid = headAnchor.expectedParentOids[0] ?? null;
  let matches;

  if (headAnchor.headKind === "unborn") {
    matches =
      actualHeadOid === null && actualTargetRef === headAnchor.targetRef;
  } else if (headAnchor.headKind === "attached") {
    matches =
      actualHeadOid === expectedParentOid &&
      actualTargetRef === headAnchor.targetRef;
  } else {
    matches = actualHeadOid === expectedParentOid && actualTargetRef === null;
  }

  return { matches, actualHeadOid, actualTargetRef };
}

export function verifySnapshotAgainstRepository({
  root,
  manifest,
  headAnchor = undefined,
  useRealIndex = false,
}) {
  const repositoryMatches =
    typeof manifest.repositoryRoot === "string" &&
    samePath(root, manifest.repositoryRoot);
  const env = useRealIndex ? undefined : manifestEnvironment(manifest);
  const head = repositoryMatches
    ? compareHeadAnchor(root, headAnchor, env)
    : { matches: false, actualHeadOid: null, actualTargetRef: null };
  const treeMatches = repositoryMatches
    ? indexMatchesTree(root, manifest.indexTreeOid, env)
    : false;
  const activeOperations = repositoryMatches ? activeGitOperations(root) : [];
  const expectedHeadOid = manifest.headOid ?? null;
  const snapshotHeadMatches = head.actualHeadOid === expectedHeadOid;

  return {
    schemaVersion: 1,
    valid:
      repositoryMatches &&
      head.matches &&
      snapshotHeadMatches &&
      treeMatches &&
      activeOperations.length === 0,
    repositoryMatches,
    headMatches: head.matches && snapshotHeadMatches,
    headAnchorMatches: head.matches,
    treeMatches,
    operationClear: repositoryMatches && activeOperations.length === 0,
    expectedHeadOid,
    actualHeadOid: head.actualHeadOid,
    expectedTargetRef: headAnchor?.targetRef ?? null,
    actualTargetRef: head.actualTargetRef,
    expectedTreeOid: manifest.indexTreeOid ?? null,
    actualTreeOid: treeMatches ? manifest.indexTreeOid : null,
    activeOperations,
  };
}
