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

// Canonical commit-message scaffolding and rendering.

export const BULK_FILE_THRESHOLD = 50;
export const MAX_LINE_LENGTH = 72;

export const RECOMMENDED_COMMIT_TYPES = Object.freeze([
  "build",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "test",
]);

function characterLength(text) {
  return [...text].length;
}

function containsControlCharacter(text) {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/u.test(text);
}

function isCapitalizedDescription(description) {
  const [first = ""] = description;

  return (
    first !== "" &&
    first === first.toLocaleUpperCase("en-US") &&
    first !== first.toLocaleLowerCase("en-US")
  );
}

function escapedPathBytes(bytes) {
  let result = "";

  for (const byte of bytes) {
    if (byte >= 0x20 && byte <= 0x7e && byte !== 0x22 && byte !== 0x5c) {
      result += String.fromCharCode(byte);
    } else if (byte === 0x22) {
      result += '\\"';
    } else if (byte === 0x5c) {
      result += "\\\\";
    } else {
      result += `\\x${byte.toString(16).padStart(2, "0")}`;
    }
  }

  return `"${result}"`;
}

function safeCodeSpan(path, bytesBase64) {
  const bytes = Buffer.from(bytesBase64, "base64");
  let decoded;

  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return escapedPathBytes(bytes);
  }

  // Git paths may contain control bytes, which must not enter Markdown verbatim.
  // eslint-disable-next-line no-control-regex
  if (!decoded.includes("`") && !/[\u0000-\u001f\u007f]/u.test(decoded)) {
    return `\`${decoded}\``;
  }

  return JSON.stringify(decoded || path);
}

function sortKey(unit) {
  return Buffer.from(unit.destinationPathBytesBase64, "base64");
}

function compareChangeUnits(left, right) {
  const destinationOrder = Buffer.compare(sortKey(left), sortKey(right));

  if (destinationOrder !== 0) {
    return destinationOrder;
  }

  const leftSource = left.sourcePathBytesBase64
    ? Buffer.from(left.sourcePathBytesBase64, "base64")
    : Buffer.alloc(0);
  const rightSource = right.sourcePathBytesBase64
    ? Buffer.from(right.sourcePathBytesBase64, "base64")
    : Buffer.alloc(0);

  return (
    Buffer.compare(leftSource, rightSource) ||
    left.kind.localeCompare(right.kind, "en")
  );
}

function entryLabel(unit) {
  if (unit.kind === "renamed") {
    return (
      `${safeCodeSpan(unit.sourcePath, unit.sourcePathBytesBase64)} → ` +
      `${safeCodeSpan(unit.destinationPath, unit.destinationPathBytesBase64)} ` +
      `(${unit.kind})`
    );
  }

  const tags = {
    deleted: "deleted",
    binary: "binary",
    "mode-changed": "mode changed",
    "symlink-changed": "symlink changed",
    "type-changed": "type changed",
    "submodule-changed": "submodule changed",
  };
  const tag = tags[unit.kind] ?? (unit.binary ? "binary" : null);

  return (
    `${safeCodeSpan(unit.destinationPath, unit.destinationPathBytesBase64)}` +
    `${tag ? ` (${tag})` : ""}`
  );
}

function wrapWithPrefix(text, firstPrefix, continuationPrefix) {
  const words = text.trim().split(/\s+/u).filter(Boolean);

  if (words.length === 0) {
    throw new Error("Commit-message narrative fields cannot be empty.");
  }

  const lines = [];
  let prefix = firstPrefix;
  let current = prefix;

  for (const word of words) {
    const separator = current === prefix ? "" : " ";
    const candidate = `${current}${separator}${word}`;

    if (current !== prefix && characterLength(candidate) > MAX_LINE_LENGTH) {
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

function renderSimpleSection(heading, entries) {
  if (!entries || entries.length === 0) {
    return null;
  }

  return [
    heading,
    ...entries.flatMap((entry) => wrapWithPrefix(entry, "  - ", "    ")),
  ].join("\n");
}

function validateSubject(subject) {
  if (
    !subject ||
    typeof subject.type !== "string" ||
    !/^[a-z][a-z0-9-]*$/u.test(subject.type)
  ) {
    throw new Error(
      "Subject type must be a lowercase Conventional Commit token.",
    );
  }

  if (
    typeof subject.description !== "string" ||
    subject.description.trim() === ""
  ) {
    throw new Error("Subject description is required.");
  }

  const description = subject.description.trim();

  if (
    description !== subject.description ||
    containsControlCharacter(description)
  ) {
    throw new Error(
      "Subject description must be one trimmed line without control characters.",
    );
  }

  if (!isCapitalizedDescription(description)) {
    throw new Error("Subject description must begin with a capitalized word.");
  }

  let scope = null;

  if (subject.scope !== null && subject.scope !== undefined) {
    if (
      typeof subject.scope !== "string" ||
      subject.scope.trim() === "" ||
      subject.scope !== subject.scope.trim() ||
      containsControlCharacter(subject.scope) ||
      /[()]/u.test(subject.scope)
    ) {
      throw new Error(
        "Subject scope must be one trimmed, non-empty value without parentheses or control characters.",
      );
    }

    scope = subject.scope;
  }

  const rendered = `${subject.type}${scope ? `(${scope})` : ""}: ${description}`;

  if (characterLength(rendered) > MAX_LINE_LENGTH) {
    throw new Error(`Subject exceeds ${MAX_LINE_LENGTH} characters.`);
  }

  if (rendered.endsWith(".")) {
    throw new Error("Subject must not end with a period.");
  }

  return rendered;
}

function renderDetailed(manifest, content) {
  if (
    manifest.changeUnitCount >= BULK_FILE_THRESHOLD ||
    content.mode !== "detailed"
  ) {
    throw new Error(
      "Detailed mode is valid only for snapshots with fewer than 50 changes.",
    );
  }

  const changeEntries = content.changeEntries ?? [];
  const entries = new Map(
    changeEntries.map((entry) => [entry.changeUnitId, entry]),
  );
  const expectedIds = new Set(manifest.changeUnits.map(({ id }) => id));

  if (
    changeEntries.length !== manifest.changeUnitCount ||
    entries.size !== changeEntries.length ||
    [...entries].some(([id]) => !expectedIds.has(id)) ||
    [...expectedIds].some((id) => !entries.has(id))
  ) {
    throw new Error(
      "Detailed entries must cover every change unit exactly once.",
    );
  }

  const units = [...manifest.changeUnits].sort(compareChangeUnits);
  const width = String(units.length).length;
  const lines = ["File Changes:"];

  units.forEach((unit, index) => {
    const semantic = entries.get(unit.id);

    if (
      !semantic ||
      !Array.isArray(semantic.reasons) ||
      semantic.reasons.length === 0
    ) {
      throw new Error(
        `Change unit ${unit.id} requires at least one rationale.`,
      );
    }

    const ordinal = String(index + 1).padStart(width, " ");
    const bulletPrefix = `${" ".repeat(width + 2)}- `;
    const continuationPrefix = " ".repeat(width + 4);

    lines.push(`${ordinal}. ${entryLabel(unit)}`);

    for (const reason of semantic.reasons) {
      lines.push(...wrapWithPrefix(reason, bulletPrefix, continuationPrefix));
    }
  });

  return lines.join("\n");
}

function renderBulk(manifest, content) {
  if (
    manifest.changeUnitCount < BULK_FILE_THRESHOLD ||
    content.mode !== "bulk"
  ) {
    throw new Error(
      "Bulk mode is required for snapshots with 50 or more changes.",
    );
  }

  const domains = content.domains ?? [];
  const assigned = domains.flatMap((domain) => domain.changeUnitIds ?? []);
  const expected = new Set(manifest.changeUnits.map(({ id }) => id));
  const assignedSet = new Set(assigned);

  if (
    assigned.length !== assignedSet.size ||
    assignedSet.size !== expected.size ||
    [...expected].some((id) => !assignedSet.has(id))
  ) {
    throw new Error("Bulk domains must assign every change unit exactly once.");
  }

  const width = String(domains.length).length;
  const lines = ["File Changes:"];

  domains.forEach((domain, index) => {
    if (
      !domain.title?.trim() ||
      domain.title !== domain.title.trim() ||
      containsControlCharacter(domain.title) ||
      !domain.reasons?.length ||
      !domain.changeUnitIds?.length
    ) {
      throw new Error(
        `Domain ${index + 1} requires a single-line title, files, and rationale.`,
      );
    }

    const count = domain.changeUnitIds.length;
    const ordinal = String(index + 1).padStart(width, " ");
    const bulletPrefix = `${" ".repeat(width + 2)}- `;
    const continuationPrefix = " ".repeat(width + 4);

    lines.push(
      `${ordinal}. ${domain.title.trim()} (${count} ${count === 1 ? "file" : "files"})`,
    );

    for (const reason of domain.reasons) {
      lines.push(...wrapWithPrefix(reason, bulletPrefix, continuationPrefix));
    }
  });

  return lines.join("\n");
}

export function renderLegacyCommitMessage(manifest, content) {
  if (manifest.changeUnitCount !== manifest.changeUnits.length) {
    throw new Error("Snapshot change-unit count does not match its inventory.");
  }

  const sections = [validateSubject(content.subject)];
  const rationale = renderSimpleSection("Rationale:", content.rationale);
  const userExperience = renderSimpleSection(
    "User Experience Changes:",
    content.userExperienceChanges,
  );

  if (rationale) {
    sections.push(rationale);
  }

  if (userExperience) {
    sections.push(userExperience);
  }

  sections.push(
    content.mode === "bulk"
      ? renderBulk(manifest, content)
      : renderDetailed(manifest, content),
  );

  return `${sections.join("\n\n")}\n`;
}

export function scaffoldLegacyContent(manifest) {
  const common = {
    subject: {
      type: "feat",
      scope: null,
      description: "Explain the outcome <replace>",
    },
    rationale: [],
    userExperienceChanges: [],
  };

  if (manifest.changeUnitCount < BULK_FILE_THRESHOLD) {
    return {
      ...common,
      mode: "detailed",
      changeEntries: manifest.changeUnits.map(({ id }) => ({
        changeUnitId: id,
        reasons: [`Explain why ${id} changed <replace>`],
      })),
    };
  }

  return {
    ...common,
    mode: "bulk",
    domains: [
      {
        title: "<name a semantic domain>",
        changeUnitIds: [],
        reasons: ["<explain why this domain changed>"],
      },
    ],
  };
}

export function renderLegacyScaffoldTemplate(manifest, content) {
  if (content.mode === "detailed") {
    return renderLegacyCommitMessage(manifest, content);
  }

  return [
    "feat: <explain the outcome>",
    "",
    "File Changes:",
    "1. <name a semantic domain> (<assigned file count>)",
    "   - <explain why this domain changed>",
    "",
  ].join("\n");
}

// The legacy exports above are retained only for the pre-cutover low-level
// message commands. New high-level workflows use the v2 interfaces below and
// reject old content instead of translating it.

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

function assertCompleteContent(content, reviewCatalog, evidencePlan) {
  if (!content || content.schemaVersion !== 2) {
    const error = new Error(
      "Only complete schema-version-2 semantic content can be rendered.",
    );
    error.code = "INCOMPLETE_SEMANTIC_CONTENT";
    throw error;
  }

  if (content.authoringState !== "complete") {
    const missing = [];

    if (content.subject === null) {
      missing.push("subject");
    }

    if (content.review?.requiredPacketsReviewed !== true) {
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
    !content.review ||
    content.review.requiredPacketsReviewed !== true ||
    content.review.catalogSha256 !== reviewCatalog?.catalogSha256 ||
    content.review.evidencePlanSha256 !== evidencePlan?.evidencePlanSha256 ||
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
  repositoryTypePolicy = { allowedTypes: null },
}) {
  assertCompleteContent(content, reviewCatalog, evidencePlan);
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
  const requiredPacketCount = [
    ...(reviewCatalog.requiredSynopsisPacketIds ?? []),
    ...(reviewCatalog.exactInventoryPacketIds ?? []),
    ...(reviewCatalog.fullPatchPacketIds ?? []),
  ].length;
  const common = {
    schemaVersion: 2,
    authoringState: "draft",
    review: {
      schemaVersion: 1,
      catalogSha256: reviewCatalog.catalogSha256,
      evidencePlanSha256: evidencePlan.evidencePlanSha256,
      requiredPacketsReviewed: requiredPacketCount === 0,
      additionalPacketIds: [],
    },
    evidenceGroups: scaffoldEvidenceGroups(evidencePlan),
    subject: null,
    sharedRationales: [],
    userExperienceChanges: [],
    mode: recommendedMode,
    recommendedMode,
  };

  return recommendedMode === "bulk"
    ? { ...common, domains: [] }
    : { ...common, fileNotes: [] };
}
