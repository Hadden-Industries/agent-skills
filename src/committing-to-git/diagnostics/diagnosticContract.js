/** Shared version-2 contract for the complete direct cutover. */
export const DIAGNOSTIC_CONTRACT_VERSION = 2;

export const MAXIMUM_RESULT_BYTES = 192 * 1024;
export const MAXIMUM_DIAGNOSTIC_TEXT_BYTES = 4096;

/** Exit meanings belong to the public contract, not individual command parsers. */
export const DISPOSITION_EXIT_CODES = Object.freeze({
  succeeded: 0,
  rejected: 1,
  "invalid-input": 2,
  "completed-with-failure": 3,
  "outcome-unknown": 4,
  "unmet-prerequisite": 5,
  "internal-failure": 6,
});

const COMMIT_STATES = new Set(["absent", "created", "unknown"]);
const PUBLICATION_STATES = new Set([
  "not-requested",
  "blocked",
  "published",
  "rejected",
  "unknown",
]);
const RECOVERY_KINDS = new Set([
  "none",
  "correct-input",
  "satisfy-prerequisite",
  "human-decision",
  "inspect-state",
  "continue",
  "stop",
]);
const DETAIL_KINDS = new Set(["input", "prerequisite", "limit", "internal"]);

export function ownData(value, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function boundedText(value, maximumBytes = MAXIMUM_DIAGNOSTIC_TEXT_BYTES) {
  if (typeof value !== "string") return null;
  const safe = value.replace(/\p{Cc}/gu, (character) =>
    ["\n", "\t"].includes(character) ? character : "?",
  );
  if (Buffer.byteLength(safe) <= maximumBytes) return safe;
  let end = maximumBytes - 3;
  const bytes = Buffer.from(safe);
  while (bytes[end] >= 128 && bytes[end] < 192) end -= 1;
  return `${bytes.subarray(0, end).toString("utf8")}...`;
}

/** Inspect own data properties only: getters and toJSON are not diagnostic authority. */
export function projectDetails(
  value,
  budget = { nodes: 512 },
  ancestors = new Set(),
  depth = 0,
) {
  if (--budget.nodes < 0 || depth > 8) return "[omitted: diagnostic limit]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return boundedText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object") return "[omitted: unsupported value]";
  if (ancestors.has(value)) return "[omitted: cycle]";
  ancestors.add(value);
  const projected = Array.isArray(value) ? [] : Object.create(null);
  try {
    const entries = Object.entries(
      Object.getOwnPropertyDescriptors(value),
    ).filter(([key, descriptor]) => key !== "length" && descriptor.enumerable);
    for (const [key, descriptor] of entries.slice(0, 64)) {
      if (key === "length" && Array.isArray(value)) continue;
      if (!descriptor.enumerable || !("value" in descriptor)) continue;
      if (
        [
          "__proto__",
          "constructor",
          "prototype",
          "stack",
          "cause",
          "toJSON",
        ].includes(key)
      )
        continue;
      projected[boundedText(key, 256)] =
        key === "pointer" &&
        typeof descriptor.value === "string" &&
        Buffer.byteLength(descriptor.value) <= 4096
          ? descriptor.value
          : projectDetails(descriptor.value, budget, ancestors, depth + 1);
    }
    if (entries.length > 64) {
      const omission = { omittedPropertyCount: entries.length - 64 };
      if (Array.isArray(projected)) projected.push(omission);
      else projected.diagnosticOmission = omission;
    }
  } catch {
    return "[omitted: uninspectable value]";
  } finally {
    ancestors.delete(value);
  }
  return projected;
}

function validRecovery(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    RECOVERY_KINDS.has(value.kind) &&
    value.automatic === false &&
    Array.isArray(value.requiredInputs) &&
    value.requiredInputs.length <= 32 &&
    value.requiredInputs.every(
      (input) => typeof input === "string" && Buffer.byteLength(input) <= 4096,
    ) &&
    Array.isArray(value.commands) &&
    value.commands.length <= 8 &&
    (value.kind !== "human-decision" || value.commands.length === 0) &&
    value.commands.every(
      (command) =>
        command !== null &&
        typeof command === "object" &&
        Object.keys(command).length === 1 &&
        Array.isArray(command.arguments) &&
        command.arguments.length > 0 &&
        command.arguments.length <= 128 &&
        command.arguments.every(
          (argument) =>
            typeof argument === "string" &&
            !argument.includes("\0") &&
            Buffer.byteLength(argument) <= 4096,
        ),
    )
  );
}

/** Recovery operands are identities, not prose: preserve them exactly or reject. */
export function projectRecovery(value) {
  if (value === null) return null;
  function copyArray(array, maximum, copy) {
    const length = ownData(array, "length");
    if (
      !Array.isArray(array) ||
      !Number.isSafeInteger(length) ||
      length > maximum
    )
      throw new TypeError("Invalid recovery collection.");
    return Array.from({ length }, (_, index) =>
      copy(ownData(array, String(index))),
    );
  }
  function exactOperand(operand) {
    if (
      typeof operand !== "string" ||
      operand.includes("\0") ||
      Buffer.byteLength(operand) > 4096
    )
      throw new TypeError("Invalid recovery operand.");
    return operand;
  }
  const result = {
    kind: ownData(value, "kind"),
    automatic: ownData(value, "automatic"),
    requiredInputs: copyArray(
      ownData(value, "requiredInputs"),
      32,
      exactOperand,
    ),
    commands: copyArray(ownData(value, "commands"), 8, (command) => ({
      arguments: copyArray(ownData(command, "arguments"), 128, exactOperand),
    })),
  };
  if (!validRecovery(result)) throw new TypeError("Invalid recovery guidance.");
  return result;
}

/** This executable definition is the sole validator of the common result fields. */
const RESULT_FIELDS = {
  schemaVersion: (value) => value === DIAGNOSTIC_CONTRACT_VERSION,
  domain: (value) => value === "committing-to-git",
  severity: (value, result) =>
    value ===
    (result.disposition !== "succeeded"
      ? "error"
      : result.warnings.length > 0
        ? "warning"
        : "info"),
  disposition: (value) => Object.hasOwn(DISPOSITION_EXIT_CODES, value),
  exitCode: (value, result) =>
    value === DISPOSITION_EXIT_CODES[result.disposition],
  status: (value) =>
    typeof value === "string" && /^[a-z][a-z-]{0,63}$/u.test(value),
  code: (value) =>
    value === null ||
    (typeof value === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(value)),
  message: (value) =>
    value === null ||
    (typeof value === "string" &&
      Buffer.byteLength(value) <= MAXIMUM_DIAGNOSTIC_TEXT_BYTES),
  transaction: (value) =>
    value === null ||
    (typeof value === "string" && Buffer.byteLength(value) <= 4096),
  phase: (value) => value === null || typeof value === "string",
  route: (value) => value === null || ["concise", "extended"].includes(value),
  commitState: (value) => COMMIT_STATES.has(value),
  publicationState: (value) => PUBLICATION_STATES.has(value),
  publicationAllowed: (value) => typeof value === "boolean",
  recoveryRequired: (value) => typeof value === "boolean",
  recovery: validRecovery,
  documentation: (value) =>
    typeof value === "string" &&
    /^references\/[a-z-]+\.md(?:#[a-z-]+)?$/u.test(value),
  details: (value) =>
    Array.isArray(value) &&
    value.length <= 32 &&
    value.every(
      (detail) =>
        detail !== null &&
        typeof detail === "object" &&
        DETAIL_KINDS.has(detail.kind),
    ),
  warnings: (value) =>
    Array.isArray(value) && value.length <= 32 && value.every(validWarning),
};

export const WORKFLOW_RESULT_FIELDS = Object.freeze(Object.keys(RESULT_FIELDS));

function validWarning(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.domain === "committing-to-git" &&
    value.severity === "warning" &&
    typeof value.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,127}$/u.test(value.code) &&
    typeof value.message === "string" &&
    Buffer.byteLength(value.message) <= MAXIMUM_DIAGNOSTIC_TEXT_BYTES &&
    validRecovery(value.recovery) &&
    RESULT_FIELDS.documentation(value.documentation) &&
    RESULT_FIELDS.details(value.details)
  );
}

/** Warnings share diagnostic identity and recovery semantics without changing success. */
export function createWorkflowWarning({
  code,
  message,
  details = [],
  documentation = "references/diagnostics.md",
  recovery = {
    kind: "none",
    automatic: false,
    requiredInputs: [],
    commands: [],
  },
}) {
  const warning = {
    domain: "committing-to-git",
    severity: "warning",
    code,
    message: boundedText(message),
    details: boundedDetails(details),
    documentation,
    recovery: projectRecovery(recovery),
  };
  if (!validWarning(warning)) throw new TypeError("Invalid workflow warning.");
  return warning;
}

/** Validate the shared contract; domain-specific result fields remain domain-owned. */
export function validateWorkflowResult(result) {
  const failures = [];
  const plain = Object.fromEntries(
    WORKFLOW_RESULT_FIELDS.map((name) => [name, ownData(result, name)]),
  );
  result = plain;
  for (const [name, accepts] of Object.entries(RESULT_FIELDS)) {
    let accepted = false;
    try {
      accepted = accepts(result[name], result);
    } catch {
      /* Malformed public values are not executable diagnostics. */
    }
    if (!accepted) failures.push(name);
  }
  if (result.disposition === "outcome-unknown" && !result.recoveryRequired)
    failures.push("recoveryRequired");
  if (
    result.disposition === "completed-with-failure" &&
    result.commitState !== "created"
  )
    failures.push("commitState");
  if (result.publicationAllowed && result.commitState !== "created")
    failures.push("publicationAllowed");
  if (result.disposition !== "succeeded" && result.code === null)
    failures.push("code");
  return failures;
}

/** Construct a result from facts supplied by its owning operation, without I/O or retries. */
export function createWorkflowResult({
  disposition,
  status,
  code = null,
  message = null,
  transaction = null,
  phase = null,
  route = null,
  commitState = "unknown",
  publicationState = "unknown",
  publicationAllowed = false,
  recoveryRequired = false,
  recovery = {
    kind: "none",
    requiredInputs: [],
    commands: [],
    automatic: false,
  },
  documentation = "references/diagnostics.md",
  details = [],
  warnings = [],
  data = {},
}) {
  const result = {
    ...Object.fromEntries(
      Object.entries(Object.getOwnPropertyDescriptors(data))
        .filter(
          ([, descriptor]) => descriptor.enumerable && "value" in descriptor,
        )
        .map(([key, descriptor]) => [key, descriptor.value])
        .filter(
          ([key]) => !Object.hasOwn(RESULT_FIELDS, key) && key !== "toJSON",
        ),
    ),
    schemaVersion: DIAGNOSTIC_CONTRACT_VERSION,
    domain: "committing-to-git",
    severity:
      disposition !== "succeeded"
        ? "error"
        : warnings.length > 0
          ? "warning"
          : "info",
    disposition,
    exitCode: DISPOSITION_EXIT_CODES[disposition],
    status,
    code,
    message: boundedText(message),
    transaction,
    phase,
    route,
    commitState,
    publicationState,
    publicationAllowed,
    recoveryRequired,
    recovery: projectRecovery(recovery),
    documentation,
    details: boundedDetails(details),
    warnings: boundedWarnings(warnings),
  };
  const failures = validateWorkflowResult(result);
  if (failures.length)
    throw new TypeError(
      `Invalid workflow result fields: ${failures.join(", ")}.`,
    );
  return result;
}

function boundedDetails(details) {
  if (!Array.isArray(details))
    return [
      { kind: "internal", diagnosticOmission: "Malformed detail collection" },
    ];
  const projected = projectDetails(
    details.slice(0, details.length > 32 ? 31 : 32),
  );
  if (details.length > 32)
    projected.push({ kind: "limit", omittedDetailCount: details.length - 31 });
  return projected.map((detail) =>
    detail !== null &&
    typeof detail === "object" &&
    DETAIL_KINDS.has(detail.kind)
      ? detail
      : { kind: "internal", diagnosticOmission: "Malformed detail" },
  );
}

function boundedWarnings(warnings) {
  if (!Array.isArray(warnings))
    throw new TypeError("Malformed warning collection.");
  const projected = warnings
    .slice(0, warnings.length > 32 ? 31 : 32)
    .map((warning) =>
      createWorkflowWarning({
        code: ownData(warning, "code"),
        message: ownData(warning, "message"),
        details: ownData(warning, "details"),
        documentation: ownData(warning, "documentation"),
        recovery: ownData(warning, "recovery"),
      }),
    );
  if (warnings.length > 32)
    projected.push(
      createWorkflowWarning({
        code: "WARNING_DETAILS_OMITTED",
        message:
          "Additional advisory diagnostics exceeded the response sample limit.",
        details: [{ kind: "limit", omittedWarningCount: warnings.length - 31 }],
      }),
    );
  return projected;
}

/** Both output modes present exactly the same facts; no domain renderer is needed. */
function encodeResult(result, format) {
  return format === "text"
    ? Object.entries(result)
        .map(
          ([key, value]) =>
            `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
        )
        .join("\n") + "\n"
    : `${JSON.stringify(result)}\n`;
}

/** Encode once before writing; a fallback also supplies the truthful process exit. */
export function encodeWorkflowResult(result, format = "json") {
  try {
    const failures = validateWorkflowResult(result);
    if (failures.length) throw new TypeError("Invalid result.");
    const output = encodeResult(result, format);
    if (Buffer.byteLength(output) > MAXIMUM_RESULT_BYTES)
      throw new RangeError("Result budget exceeded.");
    return { result, output };
  } catch {
    const fallback = createDiagnosticFallback(result);
    return { result: fallback, output: encodeResult(fallback, format) };
  }
}

export function createDiagnosticFallback(
  result,
  code = "RESULT_ENCODING_FAILED",
) {
  // Only copy bounded primitive facts, never the failed payload or its exception.
  const observed = Object.fromEntries(
    [
      "commitState",
      "publicationState",
      "disposition",
      "transaction",
      "commitOid",
      "recoveryRequired",
    ].map((key) => [key, ownData(result, key)]),
  );
  const commitState = COMMIT_STATES.has(observed.commitState)
    ? observed.commitState
    : "unknown";
  const unknownOutcome = observed.disposition === "outcome-unknown";
  return createWorkflowResult({
    disposition: unknownOutcome
      ? "outcome-unknown"
      : commitState === "created"
        ? "completed-with-failure"
        : "internal-failure",
    status: "failed",
    code,
    message:
      "The operation result could not be represented safely. Inspect retained transaction evidence; do not replay the mutation.",
    transaction:
      typeof observed.transaction === "string" &&
      Buffer.byteLength(observed.transaction) <= 4096
        ? observed.transaction
        : null,
    commitState,
    publicationState: PUBLICATION_STATES.has(observed.publicationState)
      ? observed.publicationState
      : "unknown",
    recoveryRequired: unknownOutcome || observed.recoveryRequired === true,
    recovery: {
      kind: "inspect-state",
      automatic: false,
      requiredInputs: ["retained transaction evidence"],
      commands: [],
    },
    data: {
      commitOid:
        typeof observed.commitOid === "string" &&
        /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(observed.commitOid)
          ? observed.commitOid
          : null,
    },
  });
}
