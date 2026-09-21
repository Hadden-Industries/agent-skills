import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";

export const EVIDENCE_POLICIES = Object.freeze(["reuse", "message", "review"]);
const BASIS_DEFINITIONS = Object.freeze({
  "authored-current-task": { reusable: true },
  "read-current-task": { reusable: true },
  "task-lineage": { reusable: true, requiresReuseNote: true },
  "user-grounded": { reusable: false },
  "generated-derived": { reusable: true },
  "unknown-preexisting": { reusable: false },
});
export const BASIS_KINDS = Object.freeze(Object.keys(BASIS_DEFINITIONS));
export const REUSE_BASIS_KINDS = Object.freeze(
  BASIS_KINDS.filter((kind) => BASIS_DEFINITIONS[kind].reusable),
);
export const MAXIMUM_BASIS_NOTE_BYTES = 512;

/** Validate provenance without interpreting an input as authorization or fresh evidence. */
export function validateEvidenceBasis(policy, basis) {
  if (
    !EVIDENCE_POLICIES.includes(policy) ||
    basis === null ||
    typeof basis !== "object" ||
    !BASIS_KINDS.includes(basis.kind) ||
    !(basis.note === null || typeof basis.note === "string")
  ) {
    throw new WorkflowDiagnosticError(
      "INVALID_EVIDENCE_BASIS",
      "Evidence policy or basis is invalid.",
    );
  }
  if (
    typeof basis.note === "string" &&
    Buffer.byteLength(basis.note) > MAXIMUM_BASIS_NOTE_BYTES
  ) {
    throw new WorkflowDiagnosticError(
      "EVIDENCE_BASIS_NOTE_TOO_LARGE",
      "The provenance note exceeds the supported UTF-8 byte limit.",
      {
        detailKind: "limit",
        details: {
          observedBytes: Buffer.byteLength(basis.note),
          maximumBytes: MAXIMUM_BASIS_NOTE_BYTES,
        },
        recovery: {
          kind: "correct-input",
          automatic: false,
          requiredInputs: ["a shorter truthful provenance note"],
          commands: [],
        },
      },
    );
  }
  if (policy === "reuse" && !BASIS_DEFINITIONS[basis.kind].reusable) {
    throw new WorkflowDiagnosticError(
      "INVALID_EVIDENCE_BASIS",
      "Reuse evidence requires authored, read, generated, or specific task-lineage basis.",
    );
  }
  if (
    policy === "reuse" &&
    BASIS_DEFINITIONS[basis.kind].requiresReuseNote &&
    (typeof basis.note !== "string" || basis.note.trim().length === 0)
  ) {
    throw new WorkflowDiagnosticError(
      "EVIDENCE_BASIS_NOTE_REQUIRED",
      "Reuse task-lineage basis requires a specific nonempty note. Supply the note through --evidence-plan instead of inline --evidence and --basis.",
      {
        recovery: {
          kind: "correct-input",
          automatic: false,
          requiredInputs: [
            "evidence-plan JSON with a truthful task-lineage note",
          ],
          commands: [],
        },
        details: {
          maximumNoteBytes: MAXIMUM_BASIS_NOTE_BYTES,
          example: {
            schemaVersion: 1,
            groups: [
              {
                selection: { all: true },
                policy: "reuse",
                basis: {
                  kind: "task-lineage",
                  note: "Describe the actual related task and why its evidence applies.",
                },
              },
            ],
          },
        },
      },
    );
  }
  return { kind: basis.kind, note: basis.note };
}
