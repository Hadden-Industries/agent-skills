import { streamGit } from "../git/gitRepository.js";
import { MAXIMUM_CONCISE_RESULT_BYTES } from "../inspection/inlineEvidenceCapsule.js";
import { emptyTreeObjectId } from "../snapshot/workingTreeSnapshot.js";
import { memoryStorageUnsupported } from "./workflowStateStorage.js";

/** Stream one scope-wide diff, stopping as soon as it exceeds the budget. */
async function boundedScopeDiff(root, args, maximumBytes) {
  const controller = new AbortController();
  const chunks = [];
  let byteCount = 0;
  const result = await streamGit("diff", args, {
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

/**
 * Collect message evidence in process memory without path arguments: one
 * scope-wide diff covers every tracked change, so a message group must cover
 * the whole scope. Full-scope untracked patches come from the observation.
 * Returns null once the concise budget is exceeded.
 */
export async function captureProposalEvidence({
  root,
  scope,
  manifest,
  evidencePlan,
  untrackedPatches,
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
