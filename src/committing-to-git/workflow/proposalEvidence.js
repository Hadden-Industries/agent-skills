import {
  MAXIMUM_NO_INDEX_PATH_BYTES,
  streamGit,
} from "../git/gitRepository.js";
import { MAXIMUM_CONCISE_RESULT_BYTES } from "../inspection/inlineEvidenceCapsule.js";
import { emptyTreeObjectId } from "../snapshot/workingTreeSnapshot.js";
import { memoryStorageUnsupported } from "./workflowStateStorage.js";

/** Stream one scope-wide diff, stopping as soon as it exceeds the budget. */
async function boundedScopeDiff(root, args, maximumBytes, operation = "diff") {
  const controller = new AbortController();
  const chunks = [];
  let byteCount = 0;
  const result = await streamGit(operation, args, {
    cwd: root,
    signal: controller.signal,
    allowFailure: true,
    onStdout(chunk) {
      byteCount += chunk.length;

      if (byteCount > maximumBytes) {
        controller.abort();
      } else {
        chunks.push(chunk);
      }
    },
  });

  if (byteCount > maximumBytes) {
    return null;
  }

  if (result.aborted || result.timedOut || result.status !== 0) {
    throw new Error(
      `Scope evidence diff did not complete (status ${result.status}).`,
    );
  }

  return Buffer.concat(chunks);
}

async function boundedSelectedDiff(
  root,
  manifest,
  selectedPaths,
  maximumBytes,
) {
  const chunks = [];
  let remaining = maximumBytes;
  const comparison = manifest.headOid ?? emptyTreeObjectId(root);
  for (const pathBytes of selectedPaths) {
    const path = pathBytes.toString("utf8");
    if (
      !Buffer.from(path, "utf8").equals(pathBytes) ||
      pathBytes.length > MAXIMUM_NO_INDEX_PATH_BYTES
    ) {
      throw memoryStorageUnsupported(
        "selected-evidence-path-transport",
        "Selected message evidence needs a UTF-8 path within the native per-path argument bound.",
      );
    }
    const patch = await boundedScopeDiff(
      root,
      [comparison, path],
      remaining,
      "diff-path",
    );
    if (patch === null) return null;
    remaining -= patch.length;
    chunks.push(patch);
  }
  return Buffer.concat(chunks);
}

/**
 * Collect message evidence in process memory. Staged/full use one scope-wide
 * diff; paths use bounded literal single-path native diffs. A message group
 * covers the whole selected scope. Untracked patches come from observation.
 * Returns null once the concise budget is exceeded.
 */
export async function captureProposalEvidence({
  root,
  scope,
  manifest,
  evidencePlan,
  untrackedPatches,
  selectedPaths = null,
  maximumBytes = MAXIMUM_CONCISE_RESULT_BYTES,
}) {
  const messageGroups = evidencePlan.groups.filter(
    ({ policy }) => policy === "message",
  );

  if (messageGroups.length === 0) {
    return {};
  }

  // Per-group projections need a temporary index, which memory never writes.
  if (
    messageGroups.length > 1 ||
    messageGroups[0].changeUnitIds.length !== manifest.changeUnitCount
  ) {
    throw memoryStorageUnsupported(
      "evidence-group-projection",
      "The selected partial-scope message evidence needs a projected index. A uniform message group is a memory alternative only when whole-scope message evidence meets the required provenance.",
    );
  }

  // The observation stops capturing untracked patches once they exceed the budget.
  if (untrackedPatches === null) {
    return null;
  }

  const untrackedEvidence = [...untrackedPatches]
    .sort(([left], [right]) =>
      Buffer.compare(Buffer.from(left, "base64"), Buffer.from(right, "base64")),
    )
    .map(([, patch]) => patch);
  const untrackedBytes = untrackedEvidence.reduce(
    (total, patch) => total + patch.length,
    0,
  );
  const comparison =
    manifest.headOid ??
    (scope === "staged" ? "--root" : emptyTreeObjectId(root));
  const tracked =
    untrackedBytes > maximumBytes
      ? null
      : scope === "paths"
        ? await boundedSelectedDiff(
            root,
            manifest,
            selectedPaths,
            maximumBytes - untrackedBytes,
          )
        : await boundedScopeDiff(
            root,
            [
              ...(scope === "staged" ? ["--cached"] : []),
              "--no-renames",
              "--diff-filter=d",
              comparison,
              "--",
            ],
            maximumBytes - untrackedBytes,
          );

  return tracked === null
    ? null
    : { [messageGroups[0].id]: Buffer.concat([tracked, ...untrackedEvidence]) };
}
