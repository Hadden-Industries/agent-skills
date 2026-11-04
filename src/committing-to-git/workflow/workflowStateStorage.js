import { isAbsolute } from "node:path";

import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";

function invalid(code, message, correction) {
  throw new WorkflowDiagnosticError(code, message, {
    recovery: {
      kind: "correct-input",
      requiredInputs: [correction],
      commands: [],
      automatic: false,
    },
  });
}

/** Call only for an observed capability limit with no equivalent memory route. */
export function memoryStorageUnsupported(
  reason,
  message,
  { code = "STATE_STORAGE_REQUIRES_DISK", ...details } = {},
) {
  return new WorkflowDiagnosticError(code, message, {
    disposition: "unmet-prerequisite",
    documentation: "references/state-storage.md",
    details: {
      reason,
      ...details,
      stateStorage: "memory",
      proposedStorage: "disk",
      storageEffects:
        "Creates a recoverable transaction and authoring/evidence files beneath a user-selected directory; preparation may write Git objects and actual full/paths preparation may update the index.",
    },
    state: { commitState: "absent", publicationState: "not-requested" },
    recovery: {
      kind: "human-decision",
      requiredInputs: [
        "the user's choice to retain memory storage and replan the unmet requirement, or switch to disk storage",
        "only after the user chooses disk: an absolute state directory named by the user or repository instructions",
      ],
      commands: [],
      automatic: false,
    },
  });
}

/**
 * Select where workflow state lives. Memory is the default and needs no
 * directory; disk names its directory explicitly and never falls back to the
 * operating system's temporary directory.
 */
export function selectWorkflowStateStorage({
  storage = null,
  directory = null,
}) {
  const selected = storage ?? "memory";

  if (!new Set(["memory", "disk"]).has(selected)) {
    invalid(
      "INVALID_STATE_STORAGE",
      "--state-storage must be memory or disk.",
      "Use --state-storage memory, or omit the flag to retain the default.",
    );
  }

  if (selected === "memory") {
    if (directory !== null) {
      invalid(
        "STATE_DIRECTORY_WITHOUT_DISK_STORAGE",
        "--state-directory applies only to --state-storage disk.",
        "Remove --state-directory and retain memory storage.",
      );
    }

    return Object.freeze({ storage: "memory", directory: null });
  }

  if (directory === null || !isAbsolute(directory)) {
    invalid(
      "STATE_DIRECTORY_REQUIRED",
      "--state-storage disk requires an absolute --state-directory.",
      "Supply an absolute --state-directory for the explicitly selected disk storage.",
    );
  }

  return Object.freeze({ storage: "disk", directory });
}
