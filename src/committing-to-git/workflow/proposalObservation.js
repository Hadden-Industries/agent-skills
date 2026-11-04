import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { repositoryRoot } from "../git/gitRepository.js";
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
}) {
  const headAnchor = captureHeadAnchor(root);
  const headOid = headAnchor.expectedParentOids[0] ?? null;
  let snapshot;
  let untrackedPatches = new Map();

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

  const observation = await observeProposalScope({
    root,
    scope: proposal.scope,
    mode: proposal.mode,
    withLineStatistics: false,
  });
  const changed = [
    ...(sameHeadAnchor(observation.headAnchor, proposal.headAnchor)
      ? []
      : ["head"]),
    ...(observation.changeSetSha256 === proposal.changeSetSha256 &&
    observation.manifest.changeUnitCount === proposal.changeUnitCount
      ? []
      : [proposal.scope === "staged" ? "index" : "working-tree"]),
  ];

  if (changed.length > 0) {
    throw proposalStale(changed);
  }

  return { root, ...observation };
}

export { proposalStale };
