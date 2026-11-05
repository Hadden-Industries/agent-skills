import { resolve } from "node:path";

import { createWorkflowResult } from "../diagnostics/diagnosticContract.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { repositoryRoot } from "../git/gitRepository.js";
import {
  MAXIMUM_CONCISE_RESULT_BYTES,
  createInlineEvidenceCapsule,
} from "../inspection/inlineEvidenceCapsule.js";
import { canonicalizeEvidencePlan } from "../inspection/reviewCatalog.js";
import { assessMessagePresentation } from "../message/commitMessageRenderer.js";
import {
  COMMIT_PROPOSAL_SCHEMA,
  encodeCommitProposal,
} from "./commitProposal.js";
import {
  normalizeEvidencePlan,
  normalizeScopePayload,
} from "./preparationInputs.js";
import {
  assertNoGitStorageOverrides,
  assertPreallocationRepositoryState,
  preflightVerificationPolicy,
  readBoundedJson,
  scopeSummary,
} from "./prepareWorkflow.js";
import { captureProposalEvidence } from "./proposalEvidence.js";
import { observeProposalScope } from "./proposalObservation.js";
import { memoryStorageUnsupported } from "./workflowStateStorage.js";

function initialEvidencePlan(options, cwd) {
  return normalizeEvidencePlan(
    options.evidencePlanPath
      ? readBoundedJson(resolve(cwd, options.evidencePlanPath), "Evidence plan")
      : {
          schemaVersion: 1,
          groups: [
            {
              selection: { all: true },
              policy: options.evidence,
              basis: { kind: options.basis, note: null },
            },
          ],
        },
  );
}

/** Reject routes whose state still lives in a transaction, before any read. */
function assertMemoryRoute(options) {
  if (options.correctionFromPath !== null) {
    throw new WorkflowDiagnosticError(
      "CORRECTION_FROM_REQUIRES_TRANSACTION",
      "Memory preparation has no retained transaction to correct; prepare again without --correction-from.",
      {
        recovery: {
          kind: "correct-input",
          requiredInputs: [
            "Remove --correction-from and retain memory storage.",
          ],
          commands: [],
          automatic: false,
        },
      },
    );
  }
}

function preparedResult({
  proposal,
  options,
  headAnchor,
  manifest,
  changeSetSha256,
  evidencePlan,
  capsule,
  normalizedScope,
  selectedPaths,
}) {
  return createWorkflowResult({
    disposition: "succeeded",
    status: "prepared",
    phase: "evidence-ready",
    route: "concise",
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    data: {
      terminalDisposition: null,
      stateStorage: "memory",
      proposal,
      mode: options.mode,
      messageFormat: options.messageFormat,
      scope: scopeSummary(options.scope, normalizedScope, selectedPaths ?? []),
      headAnchor,
      changeUnitCount: manifest.changeUnitCount,
      changeSetSha256,
      evidencePlanSha256: evidencePlan.evidencePlanSha256,
      capsule,
      checkedAuthoring: {
        input: "stdin",
        arguments: ["message", "check", "--proposal", proposal],
      },
      ...(options.mode === "actual"
        ? {
            commit: {
              arguments: ["workflow", "commit", "--proposal", proposal],
            },
          }
        : {}),
    },
  });
}

/**
 * Prepare a commit proposal from repository reads and process memory only.
 * Nothing is written; an interrupted caller simply prepares again.
 */
export async function prepareProposalWorkflow({
  options,
  cwd = process.cwd(),
  environment = process.env,
}) {
  assertMemoryRoute(options);
  const pathSelectors =
    options.scope === "paths"
      ? normalizeScopePayload(
          options.scopeFilePath
            ? readBoundedJson(resolve(cwd, options.scopeFilePath), "Scope file")
            : options.inlineScope,
        ).canonicalPayload
      : null;
  const normalizedEvidence = initialEvidencePlan(options, cwd);

  if (
    normalizedEvidence.plan.groups.some(({ policy }) => policy === "review")
  ) {
    throw memoryStorageUnsupported(
      "review-evidence",
      "Review packets and their cursor state still live in a transaction.",
    );
  }

  assertNoGitStorageOverrides(environment);
  const root = repositoryRoot(cwd);
  assertPreallocationRepositoryState(root);

  if (options.mode === "actual") {
    preflightVerificationPolicy({
      root,
      verificationPolicy: options.verificationPolicy,
    });
  }

  const needsMessageEvidence = normalizedEvidence.plan.groups.some(
    ({ policy }) => policy === "message",
  );
  const {
    headAnchor,
    manifest,
    changeSetSha256,
    untrackedPatches,
    normalizedScope,
    selectedPaths,
    selectedIndexSha256,
  } = await observeProposalScope({
    root,
    scope: options.scope,
    mode: options.mode,
    pathSelectors,
    // Untracked patches ride on the observation process while they fit.
    maximumUntrackedPatchBytes: needsMessageEvidence
      ? MAXIMUM_CONCISE_RESULT_BYTES
      : null,
  });

  if (manifest.changeUnitCount === 0) {
    throw new WorkflowDiagnosticError(
      "EMPTY_SCOPE",
      options.scope === "staged"
        ? "The staged scope is empty."
        : "The selected working-tree scope is empty.",
    );
  }

  if (options.messageFormat === "detailed") {
    const presentation = assessMessagePresentation(manifest);

    if (presentation.mode !== "detailed") {
      throw new WorkflowDiagnosticError(
        "DETAILED_MESSAGE_LIMIT_EXCEEDED",
        "Detailed inventory requires fewer than 50 change units and a projected presentation within 32 KiB, regardless of storage. Preserve the requested meaning and revise the presentation requirement before preparing again.",
        {
          details: {
            ...presentation,
            requestedMode: "detailed",
            stateStorage: "memory",
          },
          recovery: {
            kind: "correct-input",
            requiredInputs: [
              "Retain memory storage; omit --message-format detailed only if an exhaustive per-file inventory is no longer required.",
            ],
            commands: [],
            automatic: false,
          },
        },
      );
    }
  }

  const evidencePlan = canonicalizeEvidencePlan({
    manifest,
    groups: normalizedEvidence.plan.groups,
  });
  const evidenceByGroupId = await captureProposalEvidence({
    root,
    scope: options.scope,
    manifest,
    evidencePlan,
    untrackedPatches,
    selectedPaths,
  });
  const routing =
    evidenceByGroupId === null
      ? { route: "extended", extendedReason: "required-evidence-over-budget" }
      : createInlineEvidenceCapsule({
          manifest: { ...manifest, evidenceByGroupId },
          evidencePlan,
        });

  if (routing.route !== "concise") {
    throw memoryStorageUnsupported(
      routing.extendedReason,
      "The evidence needs review packets, which still live in a transaction.",
    );
  }

  const proposal = encodeCommitProposal({
    schema: COMMIT_PROPOSAL_SCHEMA,
    repositoryRoot: root,
    mode: options.mode,
    scope: options.scope,
    headAnchor,
    changeSetSha256,
    changeUnitCount: manifest.changeUnitCount,
    allowedTypes: options.allowedTypes ?? [],
    verificationPolicy: options.verificationPolicy,
    ...(options.scope === "paths"
      ? { pathSelectors, selectedIndexSha256 }
      : {}),
    ...(options.messageFormat === "detailed"
      ? { messageFormat: "detailed" }
      : {}),
  });
  const facts = {
    proposal,
    options,
    headAnchor,
    manifest,
    changeSetSha256,
    evidencePlan,
    capsule: routing.capsule,
    normalizedScope,
    selectedPaths,
  };
  let measuredByteCount = routing.capsule.byteCount;
  let result;

  // The capsule reports the byte count of the result that contains it.
  for (;;) {
    routing.capsule.byteCount = measuredByteCount;
    result = preparedResult(facts);
    const nextByteCount = Buffer.byteLength(JSON.stringify(result), "utf8");

    if (nextByteCount === measuredByteCount) {
      break;
    }

    measuredByteCount = nextByteCount;
  }

  if (measuredByteCount > MAXIMUM_CONCISE_RESULT_BYTES) {
    throw memoryStorageUnsupported(
      "scope-synopsis-over-budget",
      "The concise result exceeds its budget; review packets still live in a transaction.",
    );
  }

  return result;
}
