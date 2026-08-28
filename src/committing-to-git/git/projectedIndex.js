import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  openSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { runIndexMutationGit } from "./gitRepository.js";

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const INDEX_MODES = new Set(["000000", "100644", "100755", "120000", "160000"]);
const PURPOSE = /^[a-z][a-z0-9-]{0,63}$/u;
const NUL = Buffer.from([0]);

function validatedPathBytes(pathBytes) {
  if (
    !Buffer.isBuffer(pathBytes) ||
    pathBytes.length === 0 ||
    pathBytes.includes(0)
  ) {
    throw new Error(
      "Projected-index entries require a nonempty raw path Buffer without NUL bytes.",
    );
  }

  return pathBytes;
}

function validatedEntry(entry) {
  if (
    entry === null ||
    typeof entry !== "object" ||
    Array.isArray(entry) ||
    !INDEX_MODES.has(entry.mode) ||
    !FULL_OBJECT_ID.test(entry.oid)
  ) {
    throw new Error(
      "Projected-index entries require a supported Git mode and full object ID.",
    );
  }

  return {
    mode: entry.mode,
    oid: entry.oid,
    pathBytes: validatedPathBytes(entry.pathBytes),
  };
}

export function encodeIndexInfoRecords(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("Projected-index entries must be an array.");
  }

  const seen = new Set();
  const records = [];

  for (const candidate of entries) {
    const entry = validatedEntry(candidate);
    const identity = entry.pathBytes.toString("base64");

    if (seen.has(identity)) {
      throw new Error(
        "Projected-index entries contain a duplicate raw path identity.",
      );
    }

    seen.add(identity);
    records.push(
      Buffer.from(`${entry.mode} ${entry.oid}\t`, "ascii"),
      entry.pathBytes,
      NUL,
    );
  }

  return Buffer.concat(records);
}

function allocateProjectedIndexPath(temporaryDirectory, purpose) {
  const canonicalDirectory = resolve(temporaryDirectory);
  const directoryStat = lstatSync(canonicalDirectory);

  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(
      "Projected indexes require a real helper-owned temporary directory.",
    );
  }

  const indexPath = resolve(
    canonicalDirectory,
    `.projected-index-${purpose}-${randomUUID()}.tmp`,
  );

  if (dirname(indexPath) !== canonicalDirectory) {
    throw new Error("Projected index escaped its temporary directory.");
  }

  // O_EXCL proves that this exact UUID path was unoccupied at allocation.
  // Git must create the actual index itself: read-tree treats a zero-byte file
  // as corrupt, so the reservation is released immediately inside the already
  // private transaction directory before the first fixed-argv Git operation.
  const reservation = openSync(
    indexPath,
    fsConstants.O_WRONLY + fsConstants.O_CREAT + fsConstants.O_EXCL,
    0o600,
  );

  closeSync(reservation);
  unlinkSync(indexPath);
  return indexPath;
}

function removeExactArtifact(path) {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export async function withProjectedIndex(
  {
    root,
    baselineTreeOid = null,
    entries,
    temporaryDirectory,
    environment = {},
    purpose = "projection",
    launchers = {},
  },
  useIndex,
) {
  if (
    typeof root !== "string" ||
    root.length === 0 ||
    typeof temporaryDirectory !== "string" ||
    temporaryDirectory.length === 0 ||
    !PURPOSE.test(purpose) ||
    (baselineTreeOid !== null && !FULL_OBJECT_ID.test(baselineTreeOid)) ||
    typeof useIndex !== "function" ||
    launchers === null ||
    typeof launchers !== "object" ||
    Array.isArray(launchers) ||
    (launchers.synchronous !== undefined &&
      typeof launchers.synchronous !== "function")
  ) {
    throw new Error("Projected-index invocation is invalid.");
  }

  // Encode before touching disk so malformed or duplicate raw identities fail
  // without leaving a helper artifact behind. Path-count growth lives entirely
  // in this stdin buffer and never in a child-process argument vector.
  const encodedEntries = encodeIndexInfoRecords(entries);
  const indexPath = allocateProjectedIndexPath(temporaryDirectory, purpose);
  const lockPath = `${indexPath}.lock`;
  const projectedEnvironment = {
    ...environment,
    GIT_INDEX_FILE: indexPath,
    GIT_OPTIONAL_LOCKS: "0",
  };
  const gitOptions = {
    env: projectedEnvironment,
    launcher: launchers.synchronous,
  };
  let primaryError = null;
  let result;

  try {
    runIndexMutationGit(
      root,
      "read-index-tree",
      [baselineTreeOid ?? "--empty"],
      gitOptions,
    );

    if (encodedEntries.length > 0) {
      runIndexMutationGit(root, "update-index-info", [], {
        ...gitOptions,
        input: encodedEntries,
      });
    }

    if (process.platform !== "win32") {
      chmodSync(indexPath, 0o600);
    }

    result = await useIndex({
      environment: projectedEnvironment,
      indexPath,
    });
  } catch (error) {
    primaryError = error;
  }

  let cleanupError = null;

  try {
    // Cleanup is deliberately exact rather than recursive. A failed Git
    // update may leave only this index lock; no neighboring transaction
    // evidence or user-owned file can match either explicit path.
    removeExactArtifact(lockPath);
    removeExactArtifact(indexPath);
  } catch (error) {
    cleanupError = error;
  }

  if (primaryError !== null && cleanupError !== null) {
    throw new AggregateError(
      [primaryError, cleanupError],
      "Projected-index operation and exact cleanup both failed.",
    );
  }

  if (primaryError !== null) {
    throw primaryError;
  }

  if (cleanupError !== null) {
    throw cleanupError;
  }

  return result;
}
