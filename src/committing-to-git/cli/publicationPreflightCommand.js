import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand } from "./commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { publicationPreflightWorkflow } from "../workflow/publicationPreflightWorkflow.js";

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
      if (
        values.has("transport-probe") &&
        !["auto", "reuse-only"].includes(values.get("transport-probe"))
      )
        throw new WorkflowDiagnosticError(
          "INVALID_ARGUMENT",
          "--transport-probe must be auto or reuse-only.",
        );
      if (
        values.has("authorized-transport-actor") &&
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/u.test(
          values.get("authorized-transport-actor"),
        )
      )
        throw new WorkflowDiagnosticError(
          "INVALID_ARGUMENT",
          "--authorized-transport-actor must be a GitHub login.",
        );
      return {
        reuseDiscovery: values.get("reuse-discovery"),
        taskId: values.get("task-id"),
        transportProbe: values.get("transport-probe") ?? "auto",
        authorizedTransportActor: values.get("authorized-transport-actor"),
        remote: values.get("remote"),
        destination: values.get("destination"),
        sourceBranch: values.get("source-branch"),
        requirePersonalSignature:
          values.get("require-personal-signature") ?? false,
        format: values.get("format") ?? "json",
      };
    },
    execute: (options) =>
      publicationPreflightWorkflow(options, {
        cwd,
        repeatCommand: ["workflow", "preflight", ...arguments_],
      }),
  });
}
