import { parseCommandArguments } from "../cli/commandArguments.js";
import { executeCommand } from "../cli/commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { createWorkflowResult } from "../diagnostics/diagnosticContract.js";
import { readFileSync, statSync } from "node:fs";

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
    execute: async (options) => {
      const { inspectPublicationFeasibility } =
        await import("../publication/publicationPreflight.js");
      const { observeTransportInWorker } =
        await import("../publication/transportObservationWorker.js");
      const { observeTransportContext } =
        await import("../publication/discoveryEvidence.js");
      let priorDiscovery;
      if (options.reuseDiscovery) {
        try {
          if (
            !options.taskId ||
            statSync(options.reuseDiscovery).size > 1024 * 1024
          )
            throw new Error("Invalid receipt.");
          const prior = JSON.parse(
            readFileSync(options.reuseDiscovery, "utf8"),
          );
          priorDiscovery =
            prior.feasibility?.discoveryEvidence ??
            prior.data?.feasibility?.discoveryEvidence;
          if (!priorDiscovery) throw new Error("Missing receipt.");
        } catch {
          throw new WorkflowDiagnosticError(
            "INVALID_ARGUMENT",
            "Reuse requires bounded preflight JSON retained from this task and --task-id.",
          );
        }
      }
      const feasibility = inspectPublicationFeasibility({
        ...options,
        cwd,
        priorDiscovery,
        observeContext: observeTransportContext,
        observeTransport: (binding) =>
          observeTransportInWorker(binding, process.argv[1]),
      });
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
        warnings: feasibility.warnings ?? [],
        commitState: "absent",
        publicationState: "not-requested",
        publicationAllowed: false,
        documentation: "references/publication-routing.md",
        data: { feasibility },
      });
    },
  });
}
