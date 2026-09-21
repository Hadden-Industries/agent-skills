import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import {
  EVIDENCE_POLICIES,
  validateEvidenceBasis,
} from "../evidence/evidenceVocabulary.js";
import {
  assertChangeManifest,
  changeUnitPathBytes,
  normalizeSelection,
  resolveSelection,
} from "../selection/changeSelection.js";
import { Buffer } from "node:buffer";

export const MAXIMUM_CANONICAL_MESSAGE_BYTES = 32 * 1024;

const PROHIBITED_RENDERED_PATH_CHARACTER = /[\p{Cc}\p{Cf}`]/u;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validateReasons(reasons, label) {
  if (
    !Array.isArray(reasons) ||
    reasons.length === 0 ||
    reasons.some(
      (reason) =>
        typeof reason !== "string" ||
        reason.length === 0 ||
        reason !== reason.trim() ||
        /[\p{Cc}\p{Cf}]/u.test(reason),
    )
  ) {
    throw new WorkflowDiagnosticError(
      "SEMANTIC_COVERAGE_INVALID",
      `${label} requires one or more canonical reasons.`,
    );
  }

  if (new Set(reasons).size !== reasons.length) {
    throw new WorkflowDiagnosticError(
      "SEMANTIC_COVERAGE_INVALID",
      `${label} contains duplicate reasons.`,
    );
  }

  return [...reasons];
}

function resolvePartition(manifest, groups, { label, validateGroup }) {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new WorkflowDiagnosticError(
      "SEMANTIC_COVERAGE_INVALID",
      `${label} groups must be a nonempty array.`,
    );
  }

  const assignedIds = new Set();
  const resolved = groups.map((group, index) => {
    if (!isPlainObject(group)) {
      throw new WorkflowDiagnosticError(
        "SEMANTIC_COVERAGE_INVALID",
        `${label} group ${index + 1} must be an object.`,
      );
    }

    const selection = normalizeSelection(group.selection);

    if (selection.remaining === true && index !== groups.length - 1) {
      throw new WorkflowDiagnosticError(
        "SEMANTIC_COVERAGE_INVALID",
        `The remaining selector is permitted only in the final ${label.toLowerCase()} group.`,
      );
    }

    const units = resolveSelection(manifest, selection, { assignedIds });
    const overlap = units.find(({ id }) => assignedIds.has(id));

    if (overlap) {
      throw new WorkflowDiagnosticError(
        "SEMANTIC_COVERAGE_INVALID",
        `${label} groups overlap at ${overlap.id}.`,
      );
    }

    units.forEach(({ id }) => assignedIds.add(id));
    return {
      ...validateGroup(group, index),
      selection,
      units,
    };
  });

  if (assignedIds.size !== manifest.changeUnitCount) {
    const omitted = manifest.changeUnits
      .filter(({ id }) => !assignedIds.has(id))
      .map(({ id }) => id);
    throw new WorkflowDiagnosticError(
      "SEMANTIC_COVERAGE_INVALID",
      `${label} groups must be exhaustive; omitted ${omitted.join(", ")}.`,
    );
  }

  return { assignedIds, resolved };
}

function resolveOverlappingGroups(manifest, groups, label) {
  if (groups === undefined) {
    return [];
  }

  if (!Array.isArray(groups)) {
    throw new WorkflowDiagnosticError(
      "SEMANTIC_COVERAGE_INVALID",
      `${label} must be an array.`,
    );
  }

  const previouslyMatched = new Set();

  return groups.map((group, index) => {
    if (!isPlainObject(group)) {
      throw new WorkflowDiagnosticError(
        "SEMANTIC_COVERAGE_INVALID",
        `${label} entry ${index + 1} must be an object.`,
      );
    }

    const selection = normalizeSelection(group.selection);

    if (selection.remaining === true && index !== groups.length - 1) {
      throw new WorkflowDiagnosticError(
        "SEMANTIC_COVERAGE_INVALID",
        `The remaining selector is permitted only in the final ${label} entry.`,
      );
    }

    const units = resolveSelection(manifest, selection, {
      assignedIds: previouslyMatched,
    });
    units.forEach(({ id }) => previouslyMatched.add(id));

    return {
      selection,
      units,
      reasons: validateReasons(group.reasons, `${label} entry ${index + 1}`),
    };
  });
}

export function resolveSemanticCoverage(manifest, content) {
  assertChangeManifest(manifest);

  if (!isPlainObject(content)) {
    throw new WorkflowDiagnosticError(
      "SEMANTIC_COVERAGE_INVALID",
      "Semantic message content must be an object.",
    );
  }

  const evidenceCoverage = resolvePartition(manifest, content.evidenceGroups, {
    label: "Evidence",
    validateGroup(group, index) {
      if (!EVIDENCE_POLICIES.includes(group.policy)) {
        throw new WorkflowDiagnosticError(
          "SEMANTIC_COVERAGE_INVALID",
          `Evidence group ${index + 1} has an invalid policy.`,
        );
      }

      return {
        policy: group.policy,
        basis: validateEvidenceBasis(group.policy, group.basis),
      };
    },
  });
  const sharedRationales = resolveOverlappingGroups(
    manifest,
    content.sharedRationales ?? [],
    "shared rationale",
  );
  const fileNotes = resolveOverlappingGroups(
    manifest,
    content.fileNotes ?? [],
    "file note",
  );
  let domains = [];

  if (content.mode === "bulk") {
    domains = resolvePartition(manifest, content.domains, {
      label: "Domain",
      validateGroup(group, index) {
        if (
          typeof group.title !== "string" ||
          group.title.length === 0 ||
          group.title !== group.title.trim() ||
          /[\p{Cc}\p{Cf}]/u.test(group.title)
        ) {
          throw new WorkflowDiagnosticError(
            "SEMANTIC_COVERAGE_INVALID",
            `Domain group ${index + 1} has an invalid title.`,
          );
        }

        return {
          title: group.title,
          reasons: validateReasons(group.reasons, `Domain group ${index + 1}`),
        };
      },
    }).resolved;
  } else if (content.mode !== "detailed") {
    throw new WorkflowDiagnosticError(
      "SEMANTIC_COVERAGE_INVALID",
      "Semantic message mode must be detailed or bulk.",
    );
  } else if (content.domains !== undefined && content.domains.length > 0) {
    throw new WorkflowDiagnosticError(
      "SEMANTIC_COVERAGE_INVALID",
      "Detailed semantic content cannot contain bulk domains.",
    );
  }

  return {
    coveredIds: evidenceCoverage.assignedIds,
    evidenceGroups: evidenceCoverage.resolved,
    sharedRationales,
    domains,
    fileNotes,
  };
}

export function compareChangeUnitsByRawPath(left, right) {
  const destination = Buffer.compare(
    changeUnitPathBytes(left, "destination") ?? Buffer.alloc(0),
    changeUnitPathBytes(right, "destination") ?? Buffer.alloc(0),
  );

  if (destination !== 0) {
    return destination;
  }

  const source = Buffer.compare(
    changeUnitPathBytes(left, "source") ?? Buffer.alloc(0),
    changeUnitPathBytes(right, "source") ?? Buffer.alloc(0),
  );

  if (source !== 0) {
    return source;
  }

  return Buffer.compare(Buffer.from(left.id), Buffer.from(right.id));
}

export function formatMessagePath(rawPathBytes) {
  if (!Buffer.isBuffer(rawPathBytes) && !(rawPathBytes instanceof Uint8Array)) {
    throw new Error("Message path identity must be raw bytes.");
  }

  const bytes = Buffer.from(rawPathBytes);
  let decoded;

  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    decoded = null;
  }

  if (
    decoded !== null &&
    decoded.length > 0 &&
    !PROHIBITED_RENDERED_PATH_CHARACTER.test(decoded)
  ) {
    return `\`${decoded}\``;
  }

  return `\`path-bytes-base64:${bytes.toString("base64")}\``;
}

export function formatChangeUnitPath(unit) {
  const destination = formatMessagePath(
    changeUnitPathBytes(unit, "destination"),
  );

  if (unit.kind !== "renamed") {
    return destination;
  }

  const source = changeUnitPathBytes(unit, "source");

  if (source === null) {
    throw new Error(`Rename ${unit.id} has no recorded source path.`);
  }

  return `${formatMessagePath(source)} -> ${destination}`;
}

export function selectMessagePresentation({
  changeUnitCount,
  projectedDetailedBytes,
  maximumBytes = MAXIMUM_CANONICAL_MESSAGE_BYTES,
}) {
  if (
    !Number.isSafeInteger(changeUnitCount) ||
    changeUnitCount < 1 ||
    !Number.isSafeInteger(projectedDetailedBytes) ||
    projectedDetailedBytes < 0 ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1
  ) {
    throw new Error("Message presentation inputs must be bounded integers.");
  }

  return changeUnitCount >= 50 || projectedDetailedBytes > maximumBytes
    ? "bulk"
    : "detailed";
}
