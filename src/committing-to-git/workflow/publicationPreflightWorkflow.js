import { parseCommandArguments } from "../cli/commandArguments.js";
import { executeCommand } from "../cli/commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { createWorkflowResult } from "../diagnostics/diagnosticContract.js";

/** Read-only discovery is intentionally separate from preparation and its index effects. */
export async function runPublicationPreflightCommand(
  arguments_,
  { cwd = process.cwd(), stdout = process.stdout } = {},
) {
  return executeCommand(arguments_, {
    stdout,
    parse: (args) => {
      const { values } = parseCommandArguments("workflow preflight", args);
      if (
        values.has("format") &&
        !["json", "text"].includes(values.get("format"))
      )
        throw new WorkflowDiagnosticError(
          "INVALID_ARGUMENT",
          "--format must be json or text.",
        );
      if (!values.has("remote"))
        throw new WorkflowDiagnosticError(
          "INVALID_ARGUMENT",
          "--remote is required.",
        );
      return {
        remote: values.get("remote"),
        destination: values.get("destination"),
        sourceBranch: values.get("source-branch"),
        requirePersonalSignature:
          values.get("require-personal-signature") ?? false,
        format: values.get("format") ?? "json",
      };
    },
    execute: async (options) => {
      const { inspectPublicationFeasibility } =
        await import("../publication/publicationPreflight.js");
      const feasibility = inspectPublicationFeasibility({ ...options, cwd });
      return createWorkflowResult({
        disposition: ["viable", "viable-with-prerequisites"].includes(
          feasibility.status,
        )
          ? "succeeded"
          : "unmet-prerequisite",
        status: feasibility.status,
        code: ["blocked", "unknown"].includes(feasibility.status)
          ? "PUBLICATION_PREFLIGHT_INCOMPLETE"
          : null,
        message: feasibility.summary,
        commitState: "absent",
        publicationState: "not-requested",
        publicationAllowed: false,
        documentation: "references/publication-routing.md",
        data: { feasibility },
      });
    },
  });
}
