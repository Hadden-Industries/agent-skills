import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { createWorkflowResult } from "../diagnostics/diagnosticContract.js";
import { readStableFile } from "../../../lib/filesystem/stableFile.js";

/** `repeatCommand` is the delivery layer's opaque command that repeats this discovery. */
export async function publicationPreflightWorkflow(
  options,
  { cwd, repeatCommand },
) {
  const { inspectPublicationFeasibility } =
    await import("../publication/publicationPreflight.js");
  const { observeTransportInWorker } =
    await import("../publication/transportObservationWorker.js");
  const { observeTransportContext } =
    await import("../publication/discoveryEvidence.js");
  let priorDiscovery;
  if (options.reuseDiscovery) {
    try {
      if (!options.taskId) throw new Error("Invalid receipt.");
      const prior = JSON.parse(
        readStableFile(options.reuseDiscovery, 1024 * 1024).bytes.toString(
          "utf8",
        ),
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
    recovery: {
      kind: feasibility.route ? "continue" : "satisfy-prerequisite",
      automatic: false,
      requiredInputs: feasibility.route
        ? []
        : (feasibility.probes ?? [])
            .filter(
              (probe) =>
                probe.required !== false &&
                !["observed", "not-available"].includes(probe.classification),
            )
            .map((probe) => `${probe.probe}: ${probe.resolution}`)
            .slice(0, 32),
      commands: feasibility.route ? [] : [{ arguments: repeatCommand }],
    },
    data: { feasibility, nextAction: feasibility.nextAction },
  });
}
