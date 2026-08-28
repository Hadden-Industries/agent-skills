import { lstatSync } from "node:fs";
import { resolve, sep } from "node:path";

import {
  GitCommandError,
  buildIndexMutationGitArguments,
  runIndexMutationGit,
  streamGit,
} from "../git/gitRepository.js";
import { withProjectedIndex } from "../git/projectedIndex.js";
import { formatGitAlternatePaths } from "../snapshot/createSnapshot.js";

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const INDEX_MODES = new Set(["100644", "100755", "120000", "160000"]);
const ABSENCE_ERRORS = new Set(["ENOENT", "ENOTDIR"]);

function rawPath(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a base64-encoded raw Git path.`);
  }

  const bytes = Buffer.from(value, "base64");
  const pathText = bytes.toString("binary");
  const components =
    process.platform === "win32"
      ? pathText.split(/[\\/]/u)
      : pathText.split("/");

  if (
    bytes.length === 0 ||
    bytes.includes(0) ||
    bytes.toString("base64") !== value ||
    bytes[0] === 0x2f ||
    (process.platform === "win32" && bytes[0] === 0x5c) ||
    components.some(
      (component) =>
        component.length === 0 || component === "." || component === "..",
    )
  ) {
    throw new Error(`${label} is not a valid repository-relative Git path.`);
  }

  return bytes;
}

function selectedSubject(manifest) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    !FULL_OBJECT_ID.test(manifest.indexTreeOid) ||
    !Array.isArray(manifest.changeUnits)
  ) {
    throw new Error(
      "Selected-worktree comparison requires a validated snapshot manifest.",
    );
  }

  const identities = new Map();
  const present = new Map();

  for (const change of manifest.changeUnits) {
    if (
      change === null ||
      typeof change !== "object" ||
      Array.isArray(change)
    ) {
      throw new Error(
        "Selected-worktree comparison found an invalid change unit.",
      );
    }

    if (change.sourcePathBytesBase64 !== null) {
      const sourceBytes = rawPath(
        change.sourcePathBytesBase64,
        "Change-unit source path",
      );

      identities.set(change.sourcePathBytesBase64, sourceBytes);
    }

    const destinationBytes = rawPath(
      change.destinationPathBytesBase64,
      "Change-unit destination path",
    );

    identities.set(change.destinationPathBytesBase64, destinationBytes);

    if (change.newMode === "000000") {
      continue;
    }

    if (
      !INDEX_MODES.has(change.newMode) ||
      !FULL_OBJECT_ID.test(change.newOid)
    ) {
      throw new Error(
        "Selected-worktree comparison found an invalid prepared index entry.",
      );
    }

    if (present.has(change.destinationPathBytesBase64)) {
      throw new Error(
        "Selected-worktree comparison found a duplicate destination path.",
      );
    }

    present.set(change.destinationPathBytesBase64, {
      mode: change.newMode,
      oid: change.newOid,
      pathBytes: destinationBytes,
    });
  }

  return {
    identities,
    present,
    absent: [...identities.entries()].filter(
      ([identity]) => !present.has(identity),
    ),
  };
}

function objectEnvironment(manifest) {
  return {
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
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

function rawFilesystemPath(root, pathBytes) {
  const rootPrefix = Buffer.from(`${resolve(root)}${sep}`, "utf8");

  // Node's fs APIs accept Buffer paths, which avoids a lossy UTF-8 round trip
  // for repositories created on byte-oriented filesystems. Git records use
  // forward slashes; both Windows and POSIX accept those below an absolute
  // root prefix.
  return Buffer.concat([rootPrefix, pathBytes]);
}

function pathIsAbsent(root, pathBytes) {
  try {
    lstatSync(rawFilesystemPath(root, pathBytes));
    return false;
  } catch (error) {
    if (ABSENCE_ERRORS.has(error?.code)) {
      return true;
    }

    // Permission failures and unexpected I/O errors are not evidence that a
    // selected deletion still holds. Propagating them keeps the witness
    // fail-closed instead of manufacturing a passing receipt.
    throw error;
  }
}

function createDifferenceConsumer(selectedIdentities) {
  let pending = Buffer.alloc(0);
  let selectedDifference = false;

  return {
    consume(chunk) {
      const bytes =
        pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let start = 0;

      for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] !== 0) {
          continue;
        }

        const pathBytes = bytes.subarray(start, index);

        if (pathBytes.length === 0) {
          throw new Error("Git emitted an empty diff-files path record.");
        }

        if (!selectedIdentities.has(pathBytes.toString("base64"))) {
          throw new Error(
            "Projected workspace index emitted a path outside the selected subject.",
          );
        }

        selectedDifference = true;

        start = index + 1;
      }

      pending = Buffer.from(bytes.subarray(start));
    },
    finish() {
      if (pending.length !== 0) {
        throw new Error("Git emitted an incomplete NUL-delimited path record.");
      }

      return selectedDifference;
    },
  };
}

export async function selectedWorktreeMatchesPreparedTree({
  root,
  manifest,
  temporaryDirectory,
  now = () => new Date().toISOString(),
  launchers = {},
}) {
  const subject = selectedSubject(manifest);
  const observedAt = now();

  if (
    typeof observedAt !== "string" ||
    !Number.isFinite(Date.parse(observedAt))
  ) {
    throw new Error("Selected-worktree observation time is invalid.");
  }

  if (subject.identities.size === 0) {
    return { matches: true, pathCount: 0, observedAt };
  }

  let presentMatches = true;

  if (subject.present.size > 0) {
    const consumer = createDifferenceConsumer(new Set(subject.present.keys()));

    await withProjectedIndex(
      {
        root,
        baselineTreeOid: null,
        entries: [...subject.present.values()],
        temporaryDirectory,
        environment: objectEnvironment(manifest),
        purpose: "workspace-check",
        launchers,
      },
      async ({ environment }) => {
        // update-index --index-info intentionally records no worktree stat
        // data. Refresh matching entries before diff-files so a zeroed stat
        // cache is not mistaken for content drift; mismatches remain anchored
        // to their prepared object IDs and are reported by the subsequent
        // raw-name comparison.
        const refresh = runIndexMutationGit(root, "refresh-index", [], {
          env: environment,
          allowFailure: true,
          launcher: launchers.synchronous,
        });

        if (!new Set([0, 1]).has(refresh.status)) {
          throw new GitCommandError(
            buildIndexMutationGitArguments("refresh-index"),
            refresh,
          );
        }

        await streamGit("diff-files-names", [], {
          cwd: root,
          env: environment,
          launcher: launchers.asynchronous,
          onStdout: (chunk) => consumer.consume(chunk),
        });
      },
    );
    presentMatches = !consumer.finish();
  }

  // Paths omitted from the prepared tree are not index entries, so diff-files
  // cannot report an ignored or untracked recreation. Exact non-following
  // lstat calls close that gap for deletions and rename sources.
  const absentMatches = subject.absent.every(([, pathBytes]) =>
    pathIsAbsent(root, pathBytes),
  );

  return {
    matches: presentMatches && absentMatches,
    pathCount: subject.identities.size,
    observedAt,
  };
}
