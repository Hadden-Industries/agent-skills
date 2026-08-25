import { Buffer } from "node:buffer";

import {
  ApprovedMessageError,
  MAXIMUM_BODY_LINE_SCALARS,
  MAXIMUM_CANONICAL_MESSAGE_BYTES,
  validateApprovedMessage,
} from "./approvedMessage.js";
import {
  compareChangeUnitsByRawPath,
  formatChangeUnitPath,
  resolveSemanticCoverage,
  selectMessagePresentation,
} from "./changeSelection.js";

// Canonical structured-content formatting.

export const BULK_FILE_THRESHOLD = 50;

function isCanonicalNarrative(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function wrapNarrative(text, firstPrefix, continuationPrefix) {
  if (!isCanonicalNarrative(text)) {
    throw new Error(
      "Structured message narrative must be trimmed, nonempty, and free of control or format characters.",
    );
  }

  const words = text.split(/\s+/u);
  const lines = [];
  let prefix = firstPrefix;
  let current = prefix;

  for (const word of words) {
    const separator = current === prefix ? "" : " ";
    const candidate = `${current}${separator}${word}`;

    if (
      current !== prefix &&
      [...candidate].length > MAXIMUM_BODY_LINE_SCALARS
    ) {
      lines.push(current);
      prefix = continuationPrefix;
      current = `${prefix}${word}`;
    } else {
      current = candidate;
    }
  }

  lines.push(current);
  return lines;
}

export function ordinalLayout(index, itemCount) {
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(itemCount) ||
    index < 1 ||
    itemCount < 1 ||
    index > itemCount
  ) {
    throw new Error("Ordinal layout requires a valid one-based item index.");
  }

  const width = String(itemCount).length;

  return {
    titlePrefix: `  ${String(index).padStart(width, " ")}. `,
    bulletPrefix: `${" ".repeat(width + 4)}- `,
    continuationPrefix: " ".repeat(width + 6),
  };
}

function renderNarrativeSection(heading, entries) {
  if (entries.length === 0) {
    return null;
  }

  return [
    heading,
    ...entries.flatMap((entry) => wrapNarrative(entry, "  - ", "    ")),
  ];
}

function uniqueReasons(groups) {
  const seen = new Set();
  const reasons = [];

  for (const group of groups) {
    for (const reason of group.reasons) {
      if (!seen.has(reason)) {
        seen.add(reason);
        reasons.push(reason);
      }
    }
  }

  return reasons;
}

function assertEvidencePlanBinding(content, evidencePlan) {
  if (
    !evidencePlan ||
    typeof evidencePlan.evidencePlanSha256 !== "string" ||
    !Array.isArray(evidencePlan.groups)
  ) {
    throw new Error(
      "Structured rendering requires the current canonical evidence plan.",
    );
  }

  function normalizedGroup({ selection, policy, basis }) {
    const normalizedSelection = Object.fromEntries(
      Object.entries(selection)
        .sort(([left], [right]) =>
          Buffer.compare(Buffer.from(left), Buffer.from(right)),
        )
        .map(([field, value]) => [
          field,
          Array.isArray(value)
            ? [...value].sort((left, right) =>
                Buffer.compare(Buffer.from(left), Buffer.from(right)),
              )
            : value,
        ]),
    );

    return {
      selection: normalizedSelection,
      policy,
      basis: { kind: basis.kind, note: basis.note },
    };
  }

  const authored = content.evidenceGroups.map(normalizedGroup);
  const current = evidencePlan.groups.map(normalizedGroup);

  if (JSON.stringify(authored) !== JSON.stringify(current)) {
    throw new Error(
      "Structured content evidence groups do not match the current evidence plan.",
    );
  }
}

function assertCompleteContent(
  content,
  reviewCatalog,
  evidencePlan,
  reviewReceipt,
) {
  if (!content || content.schemaVersion !== 3) {
    const error = new Error(
      "Only complete schema-version-3 semantic content can be rendered.",
    );
    error.code = "INCOMPLETE_SEMANTIC_CONTENT";
    throw error;
  }

  if (content.authoringState !== "complete") {
    const missing = [];

    if (content.subject === null) {
      missing.push("subject");
    }

    if (reviewReceipt?.requiredPacketsReviewed !== true) {
      missing.push("review receipt");
    }

    if (content.mode === "bulk" && (content.domains?.length ?? 0) === 0) {
      missing.push("bulk domains");
    }

    const error = new Error(
      missing.length > 0
        ? `Draft semantic content is missing: ${missing.join(", ")}.`
        : "Set authoringState to complete after reviewing every semantic decision.",
    );
    error.code =
      missing.length > 0
        ? "MISSING_SEMANTIC_DECISIONS"
        : "INCOMPLETE_SEMANTIC_CONTENT";
    error.details = { missing };
    throw error;
  }

  if (content.subject === null || typeof content.subject !== "object") {
    const error = new Error("Complete semantic content requires a subject.");
    error.code = "MISSING_SUBJECT_DECISION";
    throw error;
  }

  if (
    !reviewReceipt ||
    reviewReceipt.requiredPacketsReviewed !== true ||
    reviewReceipt.catalogSha256 !== reviewCatalog?.catalogSha256 ||
    reviewReceipt.evidencePlanSha256 !== evidencePlan?.evidencePlanSha256 ||
    reviewCatalog?.evidencePlanSha256 !== evidencePlan?.evidencePlanSha256
  ) {
    const error = new Error(
      "Complete semantic content requires a current reviewed receipt.",
    );
    error.code = "CURRENT_REVIEW_RECEIPT_REQUIRED";
    throw error;
  }

  assertEvidencePlanBinding(content, evidencePlan);
}

function notesByUnit(coverage, sharedReasonSet) {
  const notes = new Map();

  for (const group of coverage.fileNotes) {
    for (const reason of group.reasons) {
      if (sharedReasonSet.has(reason)) {
        throw new Error(
          `File note ${JSON.stringify(reason)} duplicates a shared rationale.`,
        );
      }

      for (const unit of group.units) {
        const values = notes.get(unit.id) ?? [];

        if (!values.includes(reason)) {
          values.push(reason);
        }

        notes.set(unit.id, values);
      }
    }
  }

  return notes;
}

function renderDetailedV2(manifest, coverage, sharedReasonSet) {
  if (manifest.changeUnitCount >= BULK_FILE_THRESHOLD) {
    const error = new Error(
      "Detailed File Changes is unavailable at 50 or more change units; use structured bulk domains.",
    );
    error.code = "STRUCTURED_BULK_FINALIZATION_REQUIRED";
    throw error;
  }

  const units = [...manifest.changeUnits].sort(compareChangeUnitsByRawPath);
  const notes = notesByUnit(coverage, sharedReasonSet);
  const lines = ["File Changes:"];

  units.forEach((unit, index) => {
    const layout = ordinalLayout(index + 1, units.length);

    lines.push(`${layout.titlePrefix}${formatChangeUnitPath(unit)}`);

    for (const note of notes.get(unit.id) ?? []) {
      lines.push(
        ...wrapNarrative(note, layout.bulletPrefix, layout.continuationPrefix),
      );
    }
  });

  return lines;
}

function renderBulkV2(coverage) {
  const lines = ["File Changes:"];

  coverage.domains.forEach((domain, index) => {
    const layout = ordinalLayout(index + 1, coverage.domains.length);
    const count = domain.units.length;

    lines.push(
      `${layout.titlePrefix}${domain.title} (${count} ${count === 1 ? "file" : "files"})`,
    );

    for (const reason of domain.reasons) {
      lines.push(
        ...wrapNarrative(
          reason,
          layout.bulletPrefix,
          layout.continuationPrefix,
        ),
      );
    }
  });

  return lines;
}

function joinSections(sections) {
  return `${sections
    .filter(Boolean)
    .map((lines) => lines.join("\n"))
    .join("\n\n")}\n`;
}

export function renderCommitMessage({
  manifest,
  content,
  reviewCatalog,
  evidencePlan,
  reviewReceipt,
  repositoryTypePolicy = { allowedTypes: null },
}) {
  assertCompleteContent(content, reviewCatalog, evidencePlan, reviewReceipt);
  const coverage = resolveSemanticCoverage(manifest, content);
  const sharedReasons = uniqueReasons(coverage.sharedRationales);
  const sharedReasonSet = new Set(sharedReasons);
  const userExperience = content.userExperienceChanges ?? [];

  if (!Array.isArray(userExperience)) {
    throw new Error("User experience changes must be an array.");
  }

  const subject = `${content.subject.type}${
    content.subject.scope === null || content.subject.scope === undefined
      ? ""
      : `(${content.subject.scope})`
  }: ${content.subject.description}`;
  const sections = [[subject]];
  const rationaleSection = renderNarrativeSection("Rationale:", sharedReasons);
  const userExperienceSection = renderNarrativeSection(
    "User Experience Changes:",
    userExperience,
  );

  if (rationaleSection) {
    sections.push(rationaleSection);
  }

  if (userExperienceSection) {
    sections.push(userExperienceSection);
  }

  sections.push(
    content.mode === "bulk"
      ? renderBulkV2(coverage)
      : renderDetailedV2(manifest, coverage, sharedReasonSet),
  );

  const displayText = joinSections(sections);
  const bytes = Buffer.from(displayText, "utf8");

  if (bytes.length > MAXIMUM_CANONICAL_MESSAGE_BYTES) {
    throw new ApprovedMessageError(
      "MESSAGE_DISPLAY_BUDGET_EXCEEDED",
      `Rendered message is ${bytes.length} bytes; maximum is ${MAXIMUM_CANONICAL_MESSAGE_BYTES}.`,
      {
        byteCount: bytes.length,
        maximumBytes: MAXIMUM_CANONICAL_MESSAGE_BYTES,
        remedy:
          content.mode === "detailed"
            ? "Select structured bulk mode without changing scope."
            : "Shorten prose or combine truthful domains without changing scope.",
      },
    );
  }

  const validation = validateApprovedMessage({
    manifest,
    route: "extended",
    bytes,
    repositoryTypePolicy,
    messageSource: "structured-finalizer",
    structuredContent: content,
  });

  return {
    schemaVersion: 1,
    mode: content.mode,
    bytes,
    byteCount: bytes.length,
    displayText,
    validation,
    presentationWarnings: validation.presentationWarnings,
    coverage,
  };
}

function projectedDetailedInventoryBytes(manifest) {
  const units = [...manifest.changeUnits].sort(compareChangeUnitsByRawPath);
  const lines = ["a: A", "", "File Changes:"];

  units.forEach((unit, index) => {
    const layout = ordinalLayout(index + 1, units.length);
    lines.push(`${layout.titlePrefix}${formatChangeUnitPath(unit)}`);
  });

  return Buffer.byteLength(`${lines.join("\n")}\n`, "utf8");
}

function scaffoldEvidenceGroups(evidencePlan) {
  return evidencePlan.groups.map(({ selection, policy, basis }) => ({
    selection,
    policy,
    basis,
  }));
}

export function scaffoldContent(manifest, reviewCatalog, evidencePlan) {
  if (
    !reviewCatalog ||
    typeof reviewCatalog.catalogSha256 !== "string" ||
    reviewCatalog.evidencePlanSha256 !== evidencePlan?.evidencePlanSha256 ||
    !Array.isArray(evidencePlan?.groups)
  ) {
    throw new Error(
      "Semantic scaffolding requires one matching review catalog and evidence plan.",
    );
  }

  const recommendedMode = selectMessagePresentation({
    changeUnitCount: manifest.changeUnitCount,
    projectedDetailedBytes: projectedDetailedInventoryBytes(manifest),
  });
  const common = {
    schemaVersion: 3,
    authoringState: "draft",
    evidenceGroups: scaffoldEvidenceGroups(evidencePlan),
    subject: null,
    sharedRationales: [],
    userExperienceChanges: [],
    mode: recommendedMode,
  };

  return recommendedMode === "bulk"
    ? { ...common, domains: [] }
    : { ...common, fileNotes: [] };
}
