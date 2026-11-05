import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { repositoryRoot, runReadOnlyGit } from "../git/gitRepository.js";
import { splitNul } from "../git/gitPath.js";
import { createHash } from "node:crypto";
import { manifestDigest } from "../inspection/inlineEvidenceCapsule.js";
import {
  changeSetFromChangeUnits,
  changeSetSha256,
} from "../snapshot/changeSet.js";
import { buildSnapshot } from "../snapshot/commitSnapshot.js";
import {
  UnsupportedWorkingTreeObservation,
  buildWorkingTreeSnapshot,
} from "../snapshot/workingTreeSnapshot.js";
import { captureHeadAnchor } from "../transaction/indexInstallation.js";
import { memoryStorageUnsupported } from "./workflowStateStorage.js";
import { normalizeScopePayload } from "./preparationInputs.js";
import {
  assertPreallocationRepositoryState,
  discoverCandidates,
  validateSelectorsAgainstCandidates,
} from "./prepareWorkflow.js";

/** Bind selected index entries only; unrelated staging is independent of path scope. */
export function selectedIndexDigest(root, paths) {
  const keys = new Set(paths.map((path) => path.toString("base64")));
  const entries = splitNul(
    runReadOnlyGit(root, "ls-files", ["--stage", "-z", "--"]).stdout,
  ).filter((entry) =>
    keys.has(entry.subarray(entry.indexOf(9) + 1).toString("base64")),
  );
  return createHash("sha256")
    .update(
      Buffer.concat(entries.flatMap((entry) => [entry, Buffer.from([0])])),
    )
    .digest("hex");
}

function proposalStale(changed) {
  return new WorkflowDiagnosticError(
    "PROPOSAL_STALE",
    "The repository no longer matches the approved proposal; nothing was changed. Prepare again and approve the new proposal.",
    {
      disposition: "rejected",
      details: { changed },
      state: { commitState: "absent", publicationState: "not-requested" },
      recovery: {
        kind: "correct-input",
        requiredInputs: [
          "a fresh workflow prepare result and approval of its message",
        ],
        commands: [],
        automatic: false,
      },
    },
  );
}

function sameHeadAnchor(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Observe a memory-mode scope entirely from repository reads. The change set
 * derives from the same change units the message is validated against.
 * Rechecks skip line statistics, which neither binding nor validation reads;
 * an untracked patch budget returns full-scope untracked patches by path.
 */
export async function observeProposalScope({
  root,
  scope,
  mode,
  withLineStatistics = true,
  maximumUntrackedPatchBytes = null,
  pathSelectors = null,
}) {
  const headAnchor = captureHeadAnchor(root);
  const headOid = headAnchor.expectedParentOids[0] ?? null;
  let snapshot;
  let untrackedPatches = new Map();
  const normalizedScope =
    scope === "paths" ? normalizeScopePayload(pathSelectors) : null;
  const selectedPaths =
    normalizedScope === null
      ? null
      : validateSelectorsAgainstCandidates(
          normalizedScope,
          discoverCandidates(root),
        );
  const selectedIndexSha256 =
    selectedPaths === null ? null : selectedIndexDigest(root, selectedPaths);

  try {
    if (scope === "staged") {
      snapshot = buildSnapshot({
        root,
        workflowMode: mode,
        scopeKind: "staged",
        sourceIndex: "real",
        headOid,
        writeTree: false,
        ...(withLineStatistics ? {} : { maximumEagerLineStatInputBytes: 0 }),
      });
    } else {
      ({ snapshot, untrackedPatches } = await buildWorkingTreeSnapshot({
        root,
        workflowMode: mode,
        headOid,
        withLineStatistics,
        maximumPatchBytes: maximumUntrackedPatchBytes,
        selectedPaths,
      }));
    }
  } catch (error) {
    if (error instanceof UnsupportedWorkingTreeObservation) {
      throw memoryStorageUnsupported(error.reason, error.message);
    }

    throw error;
  }

  if (!sameHeadAnchor(captureHeadAnchor(root), headAnchor)) {
    throw new WorkflowDiagnosticError(
      "REPOSITORY_CHANGED_DURING_OBSERVATION",
      "HEAD moved while the scope was observed; prepare again.",
      { disposition: "rejected" },
    );
  }

  const manifest = { ...snapshot, manifestSha256: manifestDigest(snapshot) };

  return {
    headAnchor,
    manifest,
    untrackedPatches,
    normalizedScope,
    selectedPaths,
    selectedIndexSha256,
    changeSetSha256: changeSetSha256(
      changeSetFromChangeUnits(manifest.changeUnits),
    ),
  };
}

/** Recompute a proposal's facts and reject any difference before mutation. */
export async function observeCurrentProposal({ proposal, cwd }) {
  const root = repositoryRoot(cwd);

  if (root !== proposal.repositoryRoot) {
    throw new WorkflowDiagnosticError(
      "PROPOSAL_REPOSITORY_MISMATCH",
      "The proposal belongs to a different repository working tree.",
    );
  }
  if (proposal.scope === "paths") assertPreallocationRepositoryState(root);

  let observation;
  try {
    observation = await observeProposalScope({
      root,
      scope: proposal.scope,
      mode: proposal.mode,
      withLineStatistics: false,
      pathSelectors: proposal.pathSelectors ?? null,
    });
  } catch (error) {
    if (
      proposal.scope === "paths" &&
      new Set([
        "UNMATCHED_SCOPE_SELECTOR",
        "EMPTY_SCOPE",
        "RENAME_SCOPE_BOUNDARY",
      ]).has(error.code)
    ) {
      throw proposalStale(["selected-scope"]);
    }
    throw error;
  }
  const changed = [
    ...(sameHeadAnchor(observation.headAnchor, proposal.headAnchor)
      ? []
      : ["head"]),
    ...(observation.changeSetSha256 === proposal.changeSetSha256 &&
    observation.manifest.changeUnitCount === proposal.changeUnitCount
      ? []
      : [proposal.scope === "staged" ? "index" : "working-tree"]),
    ...(proposal.scope !== "paths" ||
    observation.selectedIndexSha256 === proposal.selectedIndexSha256
      ? []
      : ["selected-index"]),
  ];

  if (changed.length > 0) {
    throw proposalStale(changed);
  }

  return { root, ...observation };
}

export { proposalStale };
