import {
  DISPOSITION_EXIT_CODES,
  createWorkflowResult,
  ownData,
  projectDetails,
  projectRecovery,
  createDiagnosticFallback,
} from "./diagnosticContract.js";

const expectedDiagnostics = new WeakSet();
const STATE_FIELDS = [
  "transaction",
  "phase",
  "route",
  "commitState",
  "commitOid",
  "publicationState",
  "publicationAllowed",
  "recoveryRequired",
];

/** An expected workflow diagnostic with domain-owned effect and recovery facts. */
export class WorkflowDiagnosticError extends Error {
  constructor(
    code,
    message,
    {
      disposition = "invalid-input",
      details = {},
      state = {},
      recovery = null,
      documentation = "references/diagnostics.md",
      detailKind = null,
      cause,
    } = {},
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WorkflowDiagnosticError";
    this.code = code;
    this.disposition = disposition;
    this.exitCode = DISPOSITION_EXIT_CODES[disposition];
    this.details = details;
    this.state = state;
    this.recovery = recovery;
    this.documentation = documentation;
    this.detailKind = detailKind;
    expectedDiagnostics.add(this);
  }
}

/** Unknown exceptions are retained as causes, never promoted to public recovery advice. */
export function workflowFailureResult(
  caught,
  { transaction = null, state = {} } = {},
) {
  const failure = expectedDiagnostics.has(caught)
    ? caught
    : new WorkflowDiagnosticError(
        "INTERNAL_FAILURE",
        "The operation failed unexpectedly. Inspect retained transaction evidence before another mutation.",
        { disposition: "internal-failure", cause: caught },
      );
  const observed = Object.fromEntries(
    STATE_FIELDS.map((key) => [
      key,
      ownData(ownData(failure, "state"), key) ?? ownData(state, key),
    ]).filter(([, value]) => value !== undefined),
  );
  const disposition =
    ownData(failure, "disposition") === "internal-failure" &&
    observed.recoveryRequired === true &&
    (observed.commitState === "unknown" ||
      observed.publicationState === "unknown")
      ? "outcome-unknown"
      : observed.commitState === "created" &&
          ownData(failure, "disposition") === "internal-failure"
        ? "completed-with-failure"
        : ownData(failure, "disposition");
  const projected = projectDetails(ownData(failure, "details"));
  try {
    return createWorkflowResult({
      disposition,
      status: "failed",
      code: ownData(failure, "code"),
      message: ownData(failure, "message"),
      transaction,
      ...observed,
      recoveryRequired:
        observed.recoveryRequired === true || disposition === "outcome-unknown",
      data: { commitOid: observed.commitOid ?? null },
      recovery: projectRecovery(ownData(failure, "recovery")) ?? {
        kind:
          disposition === "invalid-input" ? "correct-input" : "inspect-state",
        automatic: false,
        requiredInputs: [],
        commands: [],
      },
      documentation: ownData(failure, "documentation"),
      details: [
        {
          ...(projected !== null &&
          typeof projected === "object" &&
          !Array.isArray(projected)
            ? projected
            : { diagnosticDetail: projected }),
          kind:
            ownData(failure, "detailKind") ??
            (disposition === "invalid-input"
              ? "input"
              : disposition === "internal-failure"
                ? "internal"
                : "prerequisite"),
        },
      ],
    });
  } catch {
    return createDiagnosticFallback(
      {
        ...observed,
        transaction: observed.transaction ?? transaction,
        disposition,
      },
      "DIAGNOSTIC_NORMALIZATION_FAILED",
    );
  }
}
