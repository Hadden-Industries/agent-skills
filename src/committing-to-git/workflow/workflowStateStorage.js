import { isAbsolute } from "node:path";

import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";

function invalid(code, message) {
  throw new WorkflowDiagnosticError(code, message, {
    recovery: {
      kind: "correct-input",
      requiredInputs: [
        "--state-storage memory, or --state-storage disk with an absolute --state-directory",
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
    invalid("INVALID_STATE_STORAGE", "--state-storage must be memory or disk.");
  }

  if (selected === "memory") {
    if (directory !== null) {
      invalid(
        "STATE_DIRECTORY_WITHOUT_DISK_STORAGE",
        "--state-directory applies only to --state-storage disk.",
      );
    }

    return Object.freeze({ storage: "memory", directory: null });
  }

  if (directory === null || !isAbsolute(directory)) {
    invalid(
      "STATE_DIRECTORY_REQUIRED",
      "--state-storage disk requires an absolute --state-directory.",
    );
  }

  return Object.freeze({ storage: "disk", directory });
}
