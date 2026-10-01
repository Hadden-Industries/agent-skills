import { resolve } from "node:path";
import { readTransactionOwnedFile } from "../message/canonicalMessageState.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";

// Internal inventories have a separate budget from caller-authored JSON/message
// inputs. The native executor keeps the full inventory and existing receipts.
export const STANDARD_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const MAXIMUM_SNAPSHOT_BYTES = 64 * 1024 * 1024;

/** Reject unsupported inventory capacity without asking callers to trim scope. */
export function assertSnapshotCapacity(byteCount) {
  if (byteCount > MAXIMUM_SNAPSHOT_BYTES) {
    throw new WorkflowDiagnosticError(
      "SNAPSHOT_CAPACITY_EXCEEDED",
      `Recorded snapshot requires ${byteCount} bytes; native execution supports at most ${MAXIMUM_SNAPSHOT_BYTES}. Preserve the complete scope and transaction; a larger-capacity implementation is required.`,
      {
        disposition: "unmet-prerequisite",
        details: { byteCount, maximumBytes: MAXIMUM_SNAPSHOT_BYTES },
        recovery: {
          kind: "satisfy-prerequisite",
          automatic: false,
          requiredInputs: [
            "A helper implementation supporting this complete snapshot; retain existing evidence and approval. Do not shrink the message, truncate the inventory or split the commit.",
          ],
          commands: [],
        },
        documentation: "references/native-execution.md",
      },
    );
  }
}

/** Describe the supported route before expensive evidence preparation. */
export function snapshotExecution(byteCount) {
  assertSnapshotCapacity(byteCount);
  return {
    kind: "native-git",
    selection:
      byteCount > STANDARD_SNAPSHOT_BYTES ? "snapshot-capacity" : "standard",
    snapshotByteCount: byteCount,
    maximumSnapshotBytes: MAXIMUM_SNAPSHOT_BYTES,
    arguments: ["workflow", "commit", "--execution", "native"],
  };
}

/** Read fixed, non-link snapshot bytes with bounded allocation and stable identity. */
export function readRecordedSnapshotFile(transactionPath) {
  try {
    return readTransactionOwnedFile({
      transactionPath,
      artifactName: "snapshot.json",
      maximumBytes: MAXIMUM_SNAPSHOT_BYTES,
      label: "Recorded snapshot",
      allowPathReplacement: false,
    });
  } catch (error) {
    if (error.code === "MESSAGE_INPUT_TOO_LARGE") {
      try {
        assertSnapshotCapacity(error.details.byteCount);
      } catch (capacityError) {
        capacityError.state = { transaction: resolve(transactionPath) };
        throw capacityError;
      }
    }
    throw error;
  }
}
