import { createHash } from "node:crypto";

import { runReadOnlyGit } from "../git/gitRepository.js";
import { comparePathBytes } from "../git/gitPath.js";
import { parseRawDiff } from "./commitSnapshot.js";

const CHANGE_SET_VERSION = "committing-to-git-change-set/v1\n";

/**
 * Reduce rename-free raw diff records to the final state of every changed
 * path. Two observations with equal entries describe the same resulting tree
 * relative to the same parent, whatever index or working tree produced them.
 */
export function changeSetEntries(records) {
  return records
    .map((record) => ({
      pathBytes: Buffer.from(record.destinationBytes),
      state:
        record.newMode === "000000"
          ? "deleted"
          : `${record.newMode} ${record.newOid}`,
    }))
    .sort((left, right) => comparePathBytes(left.pathBytes, right.pathBytes));
}

/** Derive the same entries from a manifest; a rename is a deletion plus a destination. */
export function changeSetFromChangeUnits(changeUnits) {
  return changeSetEntries(
    changeUnits.flatMap((unit) => [
      ...(unit.sourcePathBytesBase64
        ? [
            {
              newMode: "000000",
              newOid: unit.oldOid,
              destinationBytes: Buffer.from(
                unit.sourcePathBytesBase64,
                "base64",
              ),
            },
          ]
        : []),
      {
        newMode: unit.newMode,
        newOid: unit.newOid,
        destinationBytes: Buffer.from(
          unit.destinationPathBytesBase64,
          "base64",
        ),
      },
    ]),
  );
}

export function changeSetSha256(entries) {
  const hash = createHash("sha256").update(CHANGE_SET_VERSION);

  for (const { pathBytes, state } of entries) {
    hash.update(`${pathBytes.toString("base64")}\0${state}\n`);
  }

  return hash.digest("hex");
}

/** Observe the real index against HEAD, or the empty tree on an unborn branch. */
export function observeStagedChangeSet(root, headOid) {
  const records = parseRawDiff(
    runReadOnlyGit(root, "diff", [
      "--cached",
      "-z",
      "--raw",
      "--no-abbrev",
      "--no-renames",
      ...(headOid ? [headOid] : ["--root"]),
      "--",
    ]).stdout,
  );

  return changeSetEntries(records);
}

/** Observe what a created commit changed relative to its first parent. */
export function observeCommitChangeSet(root, commitOid) {
  const records = parseRawDiff(
    runReadOnlyGit(root, "diff-tree", [
      "--root",
      "--no-commit-id",
      "-r",
      "-z",
      "--no-renames",
      "--raw",
      commitOid,
    ]).stdout,
  );

  return changeSetEntries(records);
}
