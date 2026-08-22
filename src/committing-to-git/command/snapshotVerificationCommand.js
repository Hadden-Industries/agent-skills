#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  activeGitOperations,
  repositoryRoot,
  resolveHead,
  writeIndexTree,
} from "../git/gitRepository.js";

function usageError(message) {
  console.error(message);
  console.error(
    "Usage: node commitWorkflow.mjs snapshot verify --manifest <snapshot.json>",
  );
  process.exit(2);
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--manifest" || !argv[1]) {
    usageError("--manifest is required.");
  }

  return resolve(argv[1]);
}

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);

  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

try {
  const manifestPath = parseArguments(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const root = repositoryRoot();
  const repositoryMatches =
    typeof manifest.repositoryRoot === "string" &&
    samePath(root, manifest.repositoryRoot);
  const env =
    manifest.sourceIndex === "temporary" && manifest.indexFile
      ? { GIT_INDEX_FILE: manifest.indexFile }
      : undefined;
  const actualHeadOid = repositoryMatches ? resolveHead(root, env) : null;
  const actualTreeOid = repositoryMatches ? writeIndexTree(root, env) : null;
  const activeOperations = repositoryMatches ? activeGitOperations(root) : [];
  const result = {
    schemaVersion: 1,
    valid:
      repositoryMatches &&
      actualHeadOid === manifest.headOid &&
      actualTreeOid === manifest.indexTreeOid &&
      activeOperations.length === 0,
    repositoryMatches,
    headMatches: repositoryMatches && actualHeadOid === manifest.headOid,
    treeMatches: repositoryMatches && actualTreeOid === manifest.indexTreeOid,
    operationClear: repositoryMatches && activeOperations.length === 0,
    expectedHeadOid: manifest.headOid ?? null,
    actualHeadOid,
    expectedTreeOid: manifest.indexTreeOid ?? null,
    actualTreeOid,
    activeOperations,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.valid ? 0 : 1);
} catch (error) {
  console.error(`Commit snapshot verification failed: ${error.message}`);
  process.exit(2);
}
