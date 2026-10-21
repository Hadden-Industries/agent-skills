import { validateHeadAnchor } from "./transactionRecordValidation.js";
/** Bounded historical failure facts; these records never grant execution authority. */
import {
  projectDetails,
  projectRecovery,
} from "../diagnostics/diagnosticContract.js";

const HASH = /^[0-9a-f]{64}$/u;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const DISPOSITIONS = new Set([
  "invalid-input",
  "rejected",
  "unmet-prerequisite",
  "internal-failure",
]);

function exactKeys(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  )
    throw new Error("Invalid retained preparation failure fields.");
}

/** Reject accessors and custom serialization before measuring retained JSON. */
function assertPlainFailureData(value, budget = { nodes: 1024 }, depth = 0) {
  if (--budget.nodes < 0 || depth > 10)
    throw new Error("Preparation failure exceeds structural bounds.");
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (
    typeof value !== "object" ||
    ![Object.prototype, Array.prototype, null].includes(
      Object.getPrototypeOf(value),
    )
  )
    throw new Error("Preparation failure must contain plain JSON data.");
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (key === "length" && Array.isArray(value)) continue;
    if (
      ![
        "__proto__",
        "constructor",
        "prototype",
        "toJSON",
        "stack",
        "cause",
      ].includes(key) &&
      descriptor.enumerable &&
      "value" in descriptor
    )
      assertPlainFailureData(descriptor.value, budget, depth + 1);
    else
      throw new Error(
        "Preparation failure contains unsafe serialization fields.",
      );
  }
}

/** Admit an optional schema-1 record before stop persistence or current-reader use. */
export function validatePreparationFailure(record) {
  assertPlainFailureData(record);
  exactKeys(record, [
    "schemaVersion",
    "diagnostic",
    "snapshotObservation",
    "correctionInputs",
  ]);
  if (
    record.schemaVersion !== 1 ||
    Buffer.byteLength(JSON.stringify(record)) > 32 * 1024
  )
    throw new Error("Invalid preparation failure version or capacity.");
  const diagnostic = record.diagnostic;
  exactKeys(diagnostic, [
    "code",
    "message",
    "disposition",
    "details",
    "recovery",
    "documentation",
  ]);
  if (
    !/^[A-Z][A-Z0-9_]{0,127}$/u.test(diagnostic.code) ||
    typeof diagnostic.message !== "string" ||
    Buffer.byteLength(diagnostic.message) > 4096 ||
    projectDetails(diagnostic.message) !== diagnostic.message ||
    !Array.isArray(diagnostic.details) ||
    diagnostic.details.length > 64 ||
    !DISPOSITIONS.has(diagnostic.disposition) ||
    !["references/diagnostics.md", "references/native-execution.md"].includes(
      diagnostic.documentation,
    ) ||
    JSON.stringify(projectDetails(diagnostic.details)) !==
      JSON.stringify(diagnostic.details) ||
    JSON.stringify(projectRecovery(diagnostic.recovery)) !==
      JSON.stringify(diagnostic.recovery)
  )
    throw new Error("Invalid retained preparation diagnostic.");
  if (record.snapshotObservation !== null) {
    const observation = record.snapshotObservation;
    exactKeys(observation, [
      "headOid",
      "headAnchor",
      "indexTreeOid",
      "changeUnitCount",
      "sourceIndexSha256",
    ]);
    if (observation.headAnchor === null)
      throw new Error("Snapshot observations require a HEAD anchor.");
    validateHeadAnchor(observation.headAnchor);
    if (
      !(observation.headOid === null || OID.test(observation.headOid)) ||
      !OID.test(observation.indexTreeOid) ||
      !Number.isSafeInteger(observation.changeUnitCount) ||
      observation.changeUnitCount < 1 ||
      !(
        observation.sourceIndexSha256 === null ||
        HASH.test(observation.sourceIndexSha256)
      )
    )
      throw new Error("Invalid preparation snapshot observations.");
  }
  if (record.correctionInputs !== null) {
    exactKeys(record.correctionInputs, ["scope", "evidence"]);
    for (const binding of Object.values(record.correctionInputs)) {
      if (binding === null) continue;
      exactKeys(binding, ["name", "sha256", "byteCount", "device", "inode"]);
      if (
        !["correction-scope.json", "correction-evidence.json"].includes(
          binding.name,
        ) ||
        !HASH.test(binding.sha256) ||
        !Number.isSafeInteger(binding.byteCount) ||
        binding.byteCount < 1 ||
        binding.byteCount > 8 * 1024 * 1024 ||
        !/^\d+$/u.test(binding.device) ||
        !/^\d+$/u.test(binding.inode)
      )
        throw new Error("Invalid correction input binding.");
    }
    if (
      record.correctionInputs.evidence?.name !== "correction-evidence.json" ||
      (record.correctionInputs.scope !== null &&
        record.correctionInputs.scope.name !== "correction-scope.json")
    )
      throw new Error("Correction input roles do not match their fixed names.");
  }
  return record;
}
