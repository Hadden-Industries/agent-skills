#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { repositoryRoot } from "../git/gitRepository.js";
import { createSnapshot } from "../snapshot/createSnapshot.js";

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

const options = parseArguments(process.argv.slice(2));

try {
  const result = createSnapshot({
    root: repositoryRoot(),
    mode: options.mode,
    scope: options.scope,
    scopePaths: options.scopeFile ? readScopePaths(options.scopeFile) : [],
    outputPath: options.output,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        snapshot: options.output,
        indexTreeOid: result.snapshot.indexTreeOid,
        changeUnitCount: result.snapshot.changeUnitCount,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  console.error(`Commit scope preparation failed: ${error.message}`);
  process.exit(2);
}
