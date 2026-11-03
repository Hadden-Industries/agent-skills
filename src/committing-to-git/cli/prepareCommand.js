import { parseCommandArguments } from "./commandArguments.js";
import { executeCommand } from "./commandExecution.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import {
  EVIDENCE_POLICIES,
  BASIS_KINDS,
  REUSE_BASIS_KINDS,
} from "../evidence/evidenceVocabulary.js";
import { selectWorkflowStateStorage } from "../workflow/workflowStateStorage.js";
import { prepareProposalWorkflow } from "../workflow/prepareProposalWorkflow.js";
import {
  INLINE_SELECTOR_FLAGS,
  TYPE_TOKEN_PATTERN,
  VERIFICATION_POLICIES,
  prepareWorkflow,
} from "../workflow/prepareWorkflow.js";

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

function inlineScopePayload(values) {
  return {
    schemaVersion: 2,
    includePaths: values.get("path") ?? [],
    includePathPrefixes: values.get("path-prefix") ?? [],
    excludePaths: values.get("exclude-path") ?? [],
    excludePathPrefixes: values.get("exclude-path-prefix") ?? [],
    includePathBytesBase64: [],
    excludePathBytesBase64: [],
  };
}

export function parsePrepareArguments(argv) {
  const { values } = parseCommandArguments("workflow prepare", argv);

  const mode = values.get("mode");
  const scope = values.get("scope");
  const verificationPolicy = values.get("verification") ?? "required";
  const format = values.get("format") ?? "json";
  const messageFormat = values.get("message-format") ?? null;
  if (messageFormat !== null && messageFormat !== "detailed") {
    fail(
      "INVALID_MESSAGE_FORMAT",
      "--message-format must be detailed when supplied.",
    );
  }

  if (!new Set(["actual", "draft"]).has(mode)) {
    fail("INVALID_MODE", "--mode must be actual or draft.");
  }

  if (!new Set(["staged", "full", "paths"]).has(scope)) {
    fail("INVALID_SCOPE", "--scope must be staged, full, or paths.");
  }

  if (!VERIFICATION_POLICIES.has(verificationPolicy)) {
    fail(
      "INVALID_VERIFICATION_POLICY",
      "--verification must be required, advisory, or skipped.",
    );
  }

  if (!new Set(["json", "text"]).has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  const evidencePlanPath = values.get("evidence-plan") ?? null;
  const evidence = values.get("evidence") ?? null;
  const basis = values.get("basis") ?? null;

  if (evidencePlanPath !== null && (evidence !== null || basis !== null)) {
    fail(
      "CONFLICTING_EVIDENCE_INPUT",
      "--evidence-plan is an alternative to --evidence and --basis.",
    );
  }

  if (evidencePlanPath === null && (evidence === null || basis === null)) {
    fail(
      "MISSING_EVIDENCE_INPUT",
      "Supply --evidence and --basis together, or supply --evidence-plan.",
    );
  }

  if (evidence !== null && !EVIDENCE_POLICIES.includes(evidence)) {
    fail(
      "INVALID_EVIDENCE_POLICY",
      "--evidence must be reuse, message, or review.",
    );
  }

  if (basis !== null && !BASIS_KINDS.includes(basis)) {
    fail(
      "INVALID_EVIDENCE_BASIS",
      "--basis is not a supported provenance kind.",
    );
  }

  if (evidence === "reuse" && !REUSE_BASIS_KINDS.includes(basis)) {
    fail(
      "INVALID_EVIDENCE_BASIS",
      "Reuse evidence requires authored, read, generated, or specific task-lineage basis.",
    );
  }

  const allowedTypes = values.get("allowed-type") ?? [];

  if (allowedTypes.length > 64) {
    fail(
      "INVALID_ALLOWED_TYPE",
      "At most 64 allowed commit types may be supplied.",
    );
  }

  if (
    allowedTypes.some((type) => !TYPE_TOKEN_PATTERN.test(type)) ||
    new Set(allowedTypes).size !== allowedTypes.length
  ) {
    fail(
      "INVALID_ALLOWED_TYPE",
      "Allowed commit types must be unique lowercase tokens of at most 32 ASCII characters.",
    );
  }

  const hasInlineSelectors = INLINE_SELECTOR_FLAGS.some((name) =>
    values.has(name),
  );
  const scopeFilePath = values.get("scope-file") ?? null;

  if (scope !== "paths" && (hasInlineSelectors || scopeFilePath !== null)) {
    fail(
      "SELECTOR_OUTSIDE_PATH_SCOPE",
      "Path selectors and --scope-file are valid only with --scope paths.",
    );
  }

  if (scope === "paths" && hasInlineSelectors && scopeFilePath !== null) {
    fail(
      "CONFLICTING_SCOPE_INPUT",
      "Inline selectors and --scope-file cannot be combined.",
    );
  }

  if (
    scope === "paths" &&
    scopeFilePath === null &&
    !(values.has("path") || values.has("path-prefix"))
  ) {
    fail("MISSING_SCOPE_INCLUSION", "Path scope requires inclusion data.");
  }

  return {
    mode,
    correctionFromPath: values.get("correction-from") ?? null,
    scope,
    evidencePlanPath,
    evidence,
    basis,
    allowedTypes: allowedTypes.length === 0 ? null : allowedTypes,
    scopeFilePath,
    inlineScope:
      scope === "paths" && scopeFilePath === null
        ? inlineScopePayload(values)
        : null,
    verificationPolicy,
    messageFormat,
    format,
    workflowState: selectWorkflowStateStorage({
      storage: values.get("state-storage") ?? null,
      directory: values.get("state-directory") ?? null,
    }),
  };
}

export async function runPrepareWorkflowCommand(
  argv,
  {
    cwd = process.cwd(),
    environment = process.env,
    stdout = process.stdout,
  } = {},
) {
  return executeCommand(argv, {
    parse: parsePrepareArguments,
    execute: (options) =>
      options.workflowState.storage === "memory"
        ? prepareProposalWorkflow({ options, cwd, environment })
        : prepareWorkflow({
            options,
            cwd,
            environment,
            stateDirectory: options.workflowState.directory,
          }),
    failureState: () => ({
      commitState: "absent",
      publicationState: "not-requested",
    }),
    stdout,
  });
}
