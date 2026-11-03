import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

import {
  MAXIMUM_NO_INDEX_PATH_BYTES,
  runReadOnlyGit,
  streamGit,
} from "../git/gitRepository.js";
import { splitNul } from "../git/gitPath.js";
import {
  MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES,
  MAXIMUM_SIMILARITY_CANDIDATE_PAIRS,
  ZERO_OBJECT_ID,
  assembleSnapshot,
  inspectObjectSizes,
  normalizedChangeUnit,
  pairExactObjectRenames,
  parseNumstat,
  parseRawDiff,
  selectLineStatisticsPolicy,
  selectRenamePolicy,
  statisticsForUnit,
} from "./commitSnapshot.js";

// Each untracked path costs one native observation; larger sets use the
// disk route, whose temporary index stages them in one Git process.
export const MAXIMUM_UNTRACKED_OBSERVATIONS = 128;
// Observations are independent short processes; overlap their start-up cost.
const MAXIMUM_CONCURRENT_OBSERVATIONS = 8;
// The smallest patch framing beyond file and path bytes. Reservations are a
// lower bound, so they never reject evidence that fits; the exact total is
// checked after observation.
const MINIMUM_PATCH_FRAMING_BYTES = 64;

/** A working tree that this read-only observer cannot describe faithfully. */
export class UnsupportedWorkingTreeObservation extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "UnsupportedWorkingTreeObservation";
    this.reason = reason;
  }
}

function unsupported(reason, message) {
  throw new UnsupportedWorkingTreeObservation(reason, message);
}

/** Paths reach argv and line-oriented stdin as UTF-8 text. */
function textPath(pathBytes) {
  const text = pathBytes.toString("utf8");

  if (!Buffer.from(text, "utf8").equals(pathBytes) || /[\r\n]/u.test(text)) {
    unsupported(
      "path-encoding",
      "A changed path is not line-safe UTF-8 and cannot be observed without an index.",
    );
  }

  return text;
}

export function emptyTreeObjectId(root) {
  return runReadOnlyGit(root, "empty-tree-object-id", [], {
    input: Buffer.alloc(0),
  })
    .stdout.toString("ascii")
    .trim();
}

/** An untracked path is the one argument a read-only observation must carry. */
export function untrackedPathArgument(pathBytes) {
  const path = textPath(pathBytes);

  if (pathBytes.length > MAXIMUM_NO_INDEX_PATH_BYTES) {
    unsupported(
      "untracked-path-length",
      `An untracked path exceeds ${MAXIMUM_NO_INDEX_PATH_BYTES} bytes; disk preparation stages it through an index instead.`,
    );
  }

  return path;
}

/** Run independent short Git observations a bounded number at a time. */
async function mapConcurrently(items, limit, map) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;

      next += 1;
      results[index] = await map(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

function nulField(buffer, offset) {
  const end = buffer.indexOf(0, offset);

  if (end < 0) {
    throw new Error("git diff --no-index returned an unterminated record.");
  }

  return [buffer.subarray(offset, end), end + 1];
}

/**
 * Parse `-z --raw --numstat [--patch]` output: one raw record, one numstat
 * record (inline path or source/destination pair), then a NUL and the patch.
 */
function parseNoIndexObservation(output, withPatch) {
  const [rawHeader, afterRawHeader] = nulField(output, 0);
  const [, afterRawPath] = nulField(output, afterRawHeader);
  const [numstatHeader, afterNumstatHeader] = nulField(output, afterRawPath);
  const rawFields = rawHeader.toString("ascii").slice(1).split(" ");
  const numstatFields = numstatHeader.toString("ascii").split("\t");
  let offset = afterNumstatHeader;

  if (
    !rawHeader.toString("ascii").startsWith(":") ||
    rawFields.length !== 5 ||
    numstatFields.length !== 3
  ) {
    throw new Error("git diff --no-index returned an unexpected record.");
  }

  if (numstatFields[2] === "") {
    [, offset] = nulField(output, offset);
    [, offset] = nulField(output, offset);
  }

  let patch = null;

  if (withPatch) {
    patch = output.subarray(offset + 1);

    if (
      output[offset] !== 0 ||
      !patch.toString("utf8", 0, 11).startsWith("diff --git")
    ) {
      throw new Error("git diff --no-index returned an unexpected patch.");
    }
  }

  return {
    mode: rawFields[1],
    added: numstatFields[0],
    deleted: numstatFields[1],
    patch,
  };
}

/** Ask Git for the mode, line statistics and optionally patch of one untracked path. */
async function observeUntrackedPath(root, pathBytes, zeroObjectId, withPatch) {
  const path = untrackedPathArgument(pathBytes);
  const chunks = [];
  const result = await streamGit(
    "diff-no-index",
    [withPatch ? "--raw-numstat-patch" : "--raw-numstat", "--", path],
    { cwd: root, allowFailure: true, onStdout: (chunk) => chunks.push(chunk) },
  );

  // diff --no-index exits 1 when the sides differ, as an untracked path does.
  if (result.aborted || result.timedOut || result.status !== 1) {
    throw new Error(
      `git diff --no-index could not observe an untracked path (status ${result.status}).`,
    );
  }

  const observation = parseNoIndexObservation(Buffer.concat(chunks), withPatch);
  const binary = observation.added === "-" || observation.deleted === "-";

  return {
    patch: observation.patch,
    record: {
      oldMode: "000000",
      newMode: observation.mode,
      oldOid: zeroObjectId,
      newOid: zeroObjectId,
      status: "A",
      kind: "added",
      similarity: null,
      sourceBytes: pathBytes,
      destinationBytes: pathBytes,
    },
    statistics: {
      additions: binary ? null : Number(observation.added),
      deletions: binary ? null : Number(observation.deleted),
      binary,
    },
  };
}

function symbolicLinkTarget(root, path) {
  const absolutePath = join(root, path);

  try {
    return readlinkSync(absolutePath, { encoding: "buffer" });
  } catch (error) {
    // Without core.symlinks Git checks the link out as a file of its target.
    if (!new Set(["EINVAL", "UNKNOWN"]).has(error.code)) {
      throw error;
    }

    return readFileSync(absolutePath);
  }
}

/** Fill working-tree object IDs; Git applies path attributes and writes nothing. */
function hashWorkingTreeObjects(root, records) {
  const pending = records.filter(
    (record) =>
      record.newMode !== "000000" && ZERO_OBJECT_ID.test(record.newOid),
  );
  const files = pending.filter(({ newMode }) => newMode !== "120000");

  if (files.length > 0) {
    const objectIds = runReadOnlyGit(root, "hash-object-paths", [], {
      input: Buffer.from(
        files
          .map(({ destinationBytes }) => `${textPath(destinationBytes)}\n`)
          .join(""),
        "utf8",
      ),
    })
      .stdout.toString("ascii")
      .trim()
      .split(/\r?\n/u);

    if (objectIds.length !== files.length) {
      throw new Error("git hash-object returned an incomplete identity list.");
    }

    files.forEach((record, index) => {
      record.newOid = objectIds[index];
    });
  }

  for (const record of pending.filter(({ newMode }) => newMode === "120000")) {
    record.newOid = runReadOnlyGit(root, "hash-object-unfiltered-input", [], {
      input: symbolicLinkTarget(root, textPath(record.destinationBytes)),
    })
      .stdout.toString("ascii")
      .trim();
  }
}

function eligibleBlobBytes(root, records) {
  const { eligibleBlobBytes: storedBytes } = inspectObjectSizes(
    root,
    undefined,
    records,
  );
  let workingTreeBytes = 0n;

  for (const record of records) {
    if (record.newMode !== "000000" && ZERO_OBJECT_ID.test(record.newOid)) {
      workingTreeBytes += BigInt(
        lstatSync(join(root, textPath(record.destinationBytes))).size,
      );
    }
  }

  return storedBytes + workingTreeBytes;
}

/**
 * Observe untracked paths concurrently. With a patch budget, each path's patch
 * comes from the same process while its file size still fits; untrackedPatches
 * is null once the budget is exceeded, so nothing large is ever buffered.
 */
async function observeUntrackedPaths(
  root,
  untrackedPaths,
  zeroObjectId,
  maximumPatchBytes,
) {
  let reservedPatchBytes = 0;
  let patchesComplete = maximumPatchBytes !== null;
  const untracked = await mapConcurrently(
    untrackedPaths,
    MAXIMUM_CONCURRENT_OBSERVATIONS,
    (pathBytes) => {
      // Reservations run synchronously in path order, so the choice is stable.
      // The patch repeats the path in its header and contains every file byte.
      const minimumPatchBytes = patchesComplete
        ? lstatSync(join(root, untrackedPathArgument(pathBytes))).size +
          2 * pathBytes.length +
          MINIMUM_PATCH_FRAMING_BYTES
        : 0;
      const withPatch =
        patchesComplete &&
        reservedPatchBytes + minimumPatchBytes <= maximumPatchBytes;

      if (withPatch) {
        reservedPatchBytes += minimumPatchBytes;
      } else {
        patchesComplete = false;
      }

      return observeUntrackedPath(root, pathBytes, zeroObjectId, withPatch);
    },
  );
  const patchBytes = untracked.reduce(
    (total, { patch }) => total + (patch?.length ?? 0),
    0,
  );

  return {
    untracked,
    untrackedPatches:
      patchesComplete && patchBytes <= maximumPatchBytes
        ? new Map(
            untracked.map(({ record, patch }) => [
              record.destinationBytes.toString("base64"),
              patch,
            ]),
          )
        : null,
  };
}

/**
 * Describe what `git add -A` would commit, without an index, object or
 * temporary file. The manifest has no tree object ID until Git commits it.
 * Without line statistics it reads no content beyond hashing; with a patch
 * budget it also returns the untracked paths' patches by path.
 */
export async function buildWorkingTreeSnapshot({
  root,
  workflowMode,
  headOid,
  withLineStatistics = true,
  maximumPatchBytes = null,
  maximumUntrackedObservations = MAXIMUM_UNTRACKED_OBSERVATIONS,
  maximumEagerLineStatInputBytes = MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES,
}) {
  const baseTreeish = headOid ?? emptyTreeObjectId(root);
  const zeroObjectId = "0".repeat(baseTreeish.length);
  const tracked = parseRawDiff(
    runReadOnlyGit(root, "diff", [
      "-z",
      "--raw",
      "--no-abbrev",
      "--no-renames",
      baseTreeish,
      "--",
    ]).stdout,
  );
  const untrackedPaths = splitNul(
    runReadOnlyGit(root, "ls-files", [
      "--others",
      "--exclude-standard",
      "-z",
      "--",
    ]).stdout,
  );

  if (untrackedPaths.length > maximumUntrackedObservations) {
    unsupported(
      "untracked-path-limit",
      `Full scope has ${untrackedPaths.length} untracked paths; memory preparation observes at most ${maximumUntrackedObservations}.`,
    );
  }

  if (untrackedPaths.some((path) => path.at(-1) === 0x2f)) {
    unsupported(
      "untracked-repository",
      "Full scope contains an untracked embedded repository.",
    );
  }

  if (
    tracked.some(
      ({ oldMode, newMode }) => oldMode === "160000" || newMode === "160000",
    )
  ) {
    unsupported("submodule-change", "Full scope contains a submodule change.");
  }

  const trackedPaths = new Set(
    tracked.map(({ destinationBytes }) => destinationBytes.toString("base64")),
  );

  if (
    untrackedPaths.some((path) => trackedPaths.has(path.toString("base64")))
  ) {
    unsupported(
      "untracked-replaces-tracked",
      "An untracked path replaces a path that the index no longer tracks.",
    );
  }

  const statistics = withLineStatistics
    ? parseNumstat(
        runReadOnlyGit(root, "diff", [
          "-z",
          "--numstat",
          "--no-renames",
          baseTreeish,
          "--",
        ]).stdout,
      )
    : new Map();
  const { untracked, untrackedPatches } = await observeUntrackedPaths(
    root,
    untrackedPaths,
    zeroObjectId,
    maximumPatchBytes,
  );

  for (const { record, statistics: pathStatistics } of untracked) {
    statistics.set(record.destinationBytes.toString("base64"), pathStatistics);
  }

  const records = [...tracked, ...untracked.map(({ record }) => record)];
  const lineStatistics = withLineStatistics
    ? selectLineStatisticsPolicy({
        eligibleBlobBytes: eligibleBlobBytes(root, records),
        maximumEagerBytes: maximumEagerLineStatInputBytes,
      })
    : { mode: "deferred", eligibleBlobBytes: 0 };

  hashWorkingTreeObjects(root, records);
  const initialUnits = records.map(normalizedChangeUnit);
  let changeUnits = pairExactObjectRenames(initialUnits);

  if (lineStatistics.mode === "eager") {
    changeUnits = changeUnits.map((unit) => ({
      ...unit,
      ...statisticsForUnit(unit, statistics),
      lineStatistics: "eager",
    }));
  }

  const addedCandidates = initialUnits.filter(
    ({ oldMode }) => oldMode === "000000",
  ).length;
  const deletedCandidates = initialUnits.filter(
    ({ newMode }) => newMode === "000000",
  ).length;
  const renameSelection = selectRenamePolicy({
    addedCandidates,
    deletedCandidates,
  });
  // Untracked files have no index entry for Git's similarity detection; the
  // deferred policy is reported in the scope synopsis, not as an anomaly.
  const similarityDeferred = addedCandidates > 0 && deletedCandidates > 0;

  const snapshot = assembleSnapshot({
    root,
    workflowMode,
    scopeKind: "full",
    sourceIndex: "working-tree",
    headOid,
    indexTreeOid: null,
    rename: {
      mode: similarityDeferred ? "deferred" : "eager",
      maximumCandidatePairs: MAXIMUM_SIMILARITY_CANDIDATE_PAIRS,
      addedCandidates,
      deletedCandidates,
      candidatePairs: renameSelection.candidatePairs,
    },
    lineStatistics: {
      mode: lineStatistics.mode,
      maximumEagerBytes: maximumEagerLineStatInputBytes,
      eligibleBlobBytes: lineStatistics.eligibleBlobBytes,
    },
    changeUnits,
    warnings: [],
  });

  return { snapshot, untrackedPatches };
}
