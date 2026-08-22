#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  acknowledgeInspection,
  writeInspection,
} from "../inspection/changeInspection.js";
import {
  repositoryRoot,
  runGit,
  writeIndexTree,
} from "../git/gitRepository.js";

function usageError(message) {
  console.error(message);
  console.error(
    "Usage: node commitWorkflow.mjs inspection prepare --manifest <snapshot.json> " +
      "--output-dir <directory> | inspection acknowledge --ledger <ledger.json> " +
      "--id <id> --sha256 <hash> | inspection status --ledger <ledger.json>",
  );
  process.exit(2);
}

function parseFlags(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      usageError(`Invalid argument near ${JSON.stringify(argv[index])}.`);
    }

    values.set(argv[index].slice(2), argv[index + 1]);
  }

  return values;
}

function required(values, name) {
  const value = values.get(name);

  if (!value) {
    usageError(`--${name} is required.`);
  }

  return value;
}

function patchForManifest(manifest, root) {
  const env = manifest.indexFile
    ? { GIT_INDEX_FILE: manifest.indexFile }
    : undefined;
  const currentTree = writeIndexTree(root, env);

  if (currentTree !== manifest.indexTreeOid) {
    throw new Error(
      `Index tree drifted: manifest has ${manifest.indexTreeOid}, current tree is ${currentTree}.`,
    );
  }

  const base = manifest.headOid ? [manifest.headOid] : [];

  return runGit(
    [
      "-c",
      `diff.renameLimit=${manifest.diffPolicy.renameLimit}`,
      "diff",
      "--cached",
      "--no-ext-diff",
      "--no-textconv",
      `--find-renames=${manifest.diffPolicy.renameScore}%`,
      `--find-copies=${manifest.diffPolicy.copyScore}%`,
      "--find-copies-harder",
      ...base,
      "--",
    ],
    { cwd: root, env },
  ).stdout;
}

const [command, ...flagArguments] = process.argv.slice(2);
const flags = parseFlags(flagArguments);

try {
  if (command === "prepare") {
    const manifestPath = resolve(required(flags, "manifest"));
    const outputDir = resolve(required(flags, "output-dir"));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const root = repositoryRoot();

    if (resolve(manifest.repositoryRoot) !== resolve(root)) {
      throw new Error("Snapshot manifest belongs to a different repository.");
    }

    const ledger = writeInspection({
      outputDir,
      manifest,
      patch: patchForManifest(manifest, root),
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          ledger: resolve(outputDir, "ledger.json"),
          unitCount: ledger.unitCount,
          complete: ledger.complete,
        },
        null,
        2,
      )}\n`,
    );
  } else if (command === "ack") {
    const ledger = acknowledgeInspection({
      ledgerPath: resolve(required(flags, "ledger")),
      id: required(flags, "id"),
      expectedSha256: required(flags, "sha256"),
    });

    process.stdout.write(`${JSON.stringify(ledger, null, 2)}\n`);
  } else if (command === "status") {
    const ledger = JSON.parse(
      readFileSync(resolve(required(flags, "ledger")), "utf8"),
    );

    process.stdout.write(`${JSON.stringify(ledger, null, 2)}\n`);
  } else {
    usageError("Expected prepare, ack, or status command.");
  }
} catch (error) {
  console.error(`Commit scope inspection failed: ${error.message}`);
  process.exit(2);
}
