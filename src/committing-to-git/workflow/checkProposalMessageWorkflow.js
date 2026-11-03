import { createWorkflowResult } from "../diagnostics/diagnosticContract.js";
import {
  presentationDiagnostics,
  validateApprovedMessage,
} from "../message/approvedMessage.js";
import { decodeCommitProposal } from "./commitProposal.js";
import { assertMessageResultBudget } from "./checkMessageWorkflow.js";
import { observeCurrentProposal } from "./proposalObservation.js";

/** Validate candidate message bytes against the current proposal, writing nothing. */
export async function checkProposalMessageWorkflow({
  proposal: encodedProposal,
  messageBytes,
  cwd = process.cwd(),
}) {
  const proposal = decodeCommitProposal(encodedProposal);
  const { manifest } = await observeCurrentProposal({ proposal, cwd });
  const validation = validateApprovedMessage({
    manifest,
    route: "concise",
    bytes: messageBytes,
    repositoryTypePolicy: { allowedTypes: proposal.allowedTypes },
    messageSource: "checked-input",
  });

  return assertMessageResultBudget(
    createWorkflowResult({
      disposition: "succeeded",
      status: "message-ready",
      phase: "message-ready",
      route: "concise",
      commitState: "absent",
      publicationState: "not-requested",
      warnings: presentationDiagnostics(validation.presentationWarnings),
      data: {
        terminalDisposition: null,
        stateStorage: "memory",
        messageSource: "checked-input",
        messageSha256: validation.messageSha256,
        presentationWarnings: validation.presentationWarnings,
        displayText: validation.displayText,
        ...(proposal.mode === "actual"
          ? {
              commit: {
                input: "stdin",
                arguments: [
                  "workflow",
                  "commit",
                  "--proposal",
                  encodedProposal,
                  "--message-stdin",
                  "--message-sha256",
                  validation.messageSha256,
                ],
              },
            }
          : {}),
      },
    }),
  );
}
