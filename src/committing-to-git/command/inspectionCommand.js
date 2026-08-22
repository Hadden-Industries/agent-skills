#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  acknowledgeInspection,
  expandDeletionInspection,
  isWholeDeletion,
  writeInspection,
} from "../inspection/changeInspection.js";
import {
  gitText,
  indexMatchesTree,
  repositoryRoot,
  runGit,
} from "../git/gitRepository.js";

function usageError(message) {
  console.error(message);
  console.error(
    "Usage: node commitWorkflow.mjs inspection prepare --manifest <snapshot.json> " +
      "--output-dir <directory> | inspection expand-deletion --manifest <snapshot.json> " +
      "--ledger <ledger.json> --change-unit <F000001> | " +
      "inspection acknowledge --ledger <ledger.json> " +
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

  if (!indexMatchesTree(root, manifest.indexTreeOid, env)) {
    throw new Error(
      `Index tree drifted from manifest tree ${manifest.indexTreeOid}.`,
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
      "--diff-filter=d",
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
          requiredTextChunkCount: ledger.units.filter(
            ({ kind }) => kind === "text-patch",
          ).length,
          summarizedDeletionCount: ledger.summarizedDeletionCount,
          complete: ledger.complete,
        },
        null,
        2,
      )}\n`,
    );
  } else if (command === "expand-deletion") {
    const manifestPath = resolve(required(flags, "manifest"));
    const ledgerPath = resolve(required(flags, "ledger"));
    const changeUnitId = required(flags, "change-unit");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    const root = repositoryRoot();

    if (resolve(manifest.repositoryRoot) !== resolve(root)) {
      throw new Error("Snapshot manifest belongs to a different repository.");
    }

    if (ledger.indexTreeOid !== manifest.indexTreeOid) {
      throw new Error("Inspection ledger belongs to a different index tree.");
    }

    const changeUnit = manifest.changeUnits.find(
      ({ id }) => id === changeUnitId,
    );

    if (!changeUnit) {
      throw new Error(`Unknown change unit ${changeUnitId}.`);
    }

    if (!isWholeDeletion(changeUnit)) {
      throw new Error(
        `Change unit ${changeUnitId} is not a whole-file deletion.`,
      );
    }

    if (changeUnit.binary) {
      throw new Error(
        `Change unit ${changeUnitId} is binary; inspect its content separately.`,
      );
    }

    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(changeUnit.oldOid)) {
      throw new Error(
        `Change unit ${changeUnitId} has an invalid full old object ID.`,
      );
    }

    const readOnlyEnv = {
      GIT_NO_LAZY_FETCH: "1",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
    };
    const objectType = gitText(["cat-file", "-t", changeUnit.oldOid], {
      cwd: root,
      env: readOnlyEnv,
    }).trim();

    if (objectType !== "blob") {
      throw new Error(
        `Old object ${changeUnit.oldOid} must identify a blob object, not ${objectType}.`,
      );
    }

    const content = runGit(["cat-file", "blob", changeUnit.oldOid], {
      cwd: root,
      env: readOnlyEnv,
    }).stdout;
    const expansion = expandDeletionInspection({
      ledgerPath,
      changeUnit,
      content,
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          ledger: ledgerPath,
          changeUnitId,
          oldOid: changeUnit.oldOid,
          byteCount: expansion.expansion.byteCount,
          unitIds: expansion.expansion.unitIds,
          complete: expansion.ledger.complete,
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
    usageError("Expected prepare, expand-deletion, ack, or status command.");
  }
} catch (error) {
  console.error(`Commit scope inspection failed: ${error.message}`);
  process.exit(2);
}
