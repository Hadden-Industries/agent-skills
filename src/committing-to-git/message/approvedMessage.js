import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  MAXIMUM_CANONICAL_MESSAGE_BYTES,
  compareChangeUnitsByRawPath,
  formatChangeUnitPath,
  resolveSemanticCoverage,
} from "./changeSelection.js";

export { MAXIMUM_CANONICAL_MESSAGE_BYTES } from "./changeSelection.js";

export const MAXIMUM_SUBJECT_SCALARS = 72;
export const MAXIMUM_BODY_LINE_SCALARS = 72;
export const MAXIMUM_PRESENTATION_WARNING_SAMPLES = 16;
export const DIRECT_SUBJECT_TRANSPORT_PATTERN = /^[A-Za-z0-9 ():,._/+-]+$/u;

const SUBJECT_PATTERN =
  /^(?<type>[a-z][a-z0-9-]*)(?:\((?<scope>[^()\r\n]+)\))?: (?<description>.+)$/u;
const PROHIBITED_UNICODE_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const SECTION_ORDER = Object.freeze([
  "Rationale:",
  "User Experience Changes:",
  "File Changes:",
]);
const PLACEHOLDER_PATTERN = /<[^<>]+>|\b(?:todo|tbd|placeholder)\b/iu;

export class ApprovedMessageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ApprovedMessageError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ApprovedMessageError(code, message, details);
}

function scalarLength(value) {
  return [...value].length;
}

function isCapitalizedDescription(description) {
  const first = [...description][0] ?? "";

  return (
    first !== "" &&
    first === first.toLocaleUpperCase("en-US") &&
    first !== first.toLocaleLowerCase("en-US")
  );
}

function validateRepositoryType(type, repositoryTypePolicy) {
  if (
    repositoryTypePolicy === null ||
    repositoryTypePolicy === undefined ||
    repositoryTypePolicy.allowedTypes === null ||
    repositoryTypePolicy.allowedTypes === undefined ||
    (Array.isArray(repositoryTypePolicy.allowedTypes) &&
      repositoryTypePolicy.allowedTypes.length === 0)
  ) {
    return;
  }

  if (!Array.isArray(repositoryTypePolicy.allowedTypes)) {
    fail(
      "UNSUPPORTED_REPOSITORY_MESSAGE_POLICY",
      "Repository type policy must provide an allowedTypes array or null.",
    );
  }

  if (!repositoryTypePolicy.allowedTypes.includes(type)) {
    fail(
      "SUBJECT_TYPE_NOT_ALLOWED",
      `Subject type ${JSON.stringify(type)} is not allowed by the recorded repository policy.`,
      { type, allowedTypes: repositoryTypePolicy.allowedTypes },
    );
  }
}

function parseSubject(subjectText, repositoryTypePolicy) {
  const match = SUBJECT_PATTERN.exec(subjectText);

  if (!match) {
    fail(
      "SUBJECT_FORMAT_INVALID",
      "Subject must match <type>: <description> or <type>(<scope>): <description>.",
    );
  }

  const { type, description } = match.groups;
  const scope = match.groups.scope ?? null;

  if (
    description.length === 0 ||
    description !== description.trim() ||
    PROHIBITED_UNICODE_CHARACTER.test(description)
  ) {
    fail(
      "SUBJECT_FORMAT_INVALID",
      "Subject description must be one exact nonempty line without controls or surrounding whitespace.",
    );
  }

  if (!isCapitalizedDescription(description)) {
    fail(
      "SUBJECT_DESCRIPTION_NOT_CAPITALIZED",
      "Subject description must begin with an uppercase Unicode cased letter.",
    );
  }

  if (description.endsWith(".")) {
    fail(
      "SUBJECT_TRAILING_PERIOD",
      "Subject description must not end with an ASCII period.",
    );
  }

  if (
    scope !== null &&
    (scope !== scope.trim() ||
      scope.length === 0 ||
      PROHIBITED_UNICODE_CHARACTER.test(scope))
  ) {
    fail(
      "SUBJECT_SCOPE_INVALID",
      "Subject scope must be one exact nonempty value without parentheses or controls.",
    );
  }

  const length = scalarLength(subjectText);

  if (length > MAXIMUM_SUBJECT_SCALARS) {
    fail(
      "SUBJECT_TOO_LONG",
      `Subject is ${length} Unicode scalar values; maximum is ${MAXIMUM_SUBJECT_SCALARS}.`,
      { scalarLength: length, maximum: MAXIMUM_SUBJECT_SCALARS },
    );
  }

  validateRepositoryType(type, repositoryTypePolicy);

  return {
    text: subjectText,
    type,
    scope,
    description,
    scalarLength: length,
  };
}

function canonicalBytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    fail("MESSAGE_BYTES_REQUIRED", "Approved message input must be bytes.");
  }

  return Buffer.from(value);
}

function decodeCanonicalMessage(bytes) {
  if (bytes.length > MAXIMUM_CANONICAL_MESSAGE_BYTES) {
    fail(
      "MESSAGE_DISPLAY_BUDGET_EXCEEDED",
      `Canonical message is ${bytes.length} bytes; maximum is ${MAXIMUM_CANONICAL_MESSAGE_BYTES}.`,
      {
        byteCount: bytes.length,
        maximumBytes: MAXIMUM_CANONICAL_MESSAGE_BYTES,
        remedy:
          "Shorten prose or combine truthful structured domains without changing scope.",
      },
    );
  }

  if (bytes.length === 0 || bytes.at(-1) !== 0x0a) {
    fail(
      "TERMINAL_LF_REQUIRED",
      "Canonical message bytes must end in exactly one LF.",
    );
  }

  if (bytes.length > 1 && bytes.at(-2) === 0x0a) {
    fail(
      "MULTIPLE_TERMINAL_LF",
      "Canonical message bytes must not end in multiple LF bytes.",
    );
  }

  if (bytes.includes(0x0d)) {
    fail(
      "CARRIAGE_RETURN_FORBIDDEN",
      "Canonical message bytes must not contain CR or CRLF.",
    );
  }

  if (bytes.includes(0x00)) {
    fail("NUL_FORBIDDEN", "Canonical message bytes must not contain NUL.");
  }

  let text;

  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("INVALID_UTF8", "Canonical message bytes must be strict UTF-8.");
  }

  for (const character of text) {
    if (character !== "\n" && PROHIBITED_UNICODE_CHARACTER.test(character)) {
      fail(
        "PROHIBITED_UNICODE_CHARACTER",
        "Canonical message contains a prohibited Unicode control or format character.",
      );
    }
  }

  return text;
}

function assertUsefulEntry(text, label) {
  if (
    text.length === 0 ||
    text !== text.trimEnd() ||
    PLACEHOLDER_PATTERN.test(text)
  ) {
    fail("EMPTY_SECTION", `${label} contains an empty or placeholder entry.`);
  }
}

function parseNarrativeSection(lines, heading) {
  const entries = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith("  - ")) {
      const text = line.slice(4);
      assertUsefulEntry(text, heading);
      current = text;
      entries.push(text);
    } else if (line.startsWith("    ") && current !== null) {
      const continuation = line.slice(4);
      assertUsefulEntry(continuation, heading);
      entries[entries.length - 1] += `\n${continuation}`;
    } else {
      fail(
        "SECTION_ENTRY_FORMAT_INVALID",
        `${heading} entries must use two-space bullets with aligned continuations.`,
      );
    }
  }

  if (entries.length === 0) {
    fail("EMPTY_SECTION", `${heading} cannot be present without entries.`);
  }

  return entries;
}

function expectedDetailedInventory(manifest) {
  if (
    !manifest ||
    !Array.isArray(manifest.changeUnits) ||
    manifest.changeUnitCount !== manifest.changeUnits.length ||
    manifest.changeUnitCount < 1
  ) {
    fail(
      "INVALID_MESSAGE_MANIFEST",
      "Approved-message validation requires one exact nonempty manifest.",
    );
  }

  const units = [...manifest.changeUnits].sort(compareChangeUnitsByRawPath);
  const width = String(units.length).length;

  return units.map((unit, index) => ({
    id: unit.id,
    label: formatChangeUnitPath(unit),
    ordinal: index + 1,
    line: `${"  "}${String(index + 1).padStart(width, " ")}. ${formatChangeUnitPath(unit)}`,
  }));
}

function parseDetailedInventory(lines, manifest) {
  if (manifest.changeUnitCount >= 50) {
    fail(
      "STRUCTURED_BULK_FINALIZATION_REQUIRED",
      "A counted bulk inventory must be derived by the structured extended finalizer.",
      { remedy: "Extend for semantic structure or omit File Changes." },
    );
  }

  const expected = expectedDetailedInventory(manifest);
  const expectedLabels = new Set(expected.map(({ label }) => label));
  const width = String(expected.length).length;
  const notePrefix = `${" ".repeat(width + 4)}- `;
  const continuationPrefix = " ".repeat(width + 6);
  const listed = [];
  let current = null;

  for (const line of lines) {
    const match = /^ {2,}([0-9]+)\. (.+)$/u.exec(line);

    if (match) {
      const ordinal = Number(match[1]);
      const label = match[2];

      if (/\([0-9]+ files?\)$/u.test(label) && !expectedLabels.has(label)) {
        fail(
          "STRUCTURED_BULK_FINALIZATION_REQUIRED",
          "Free-form counted domains cannot prove manifest membership.",
          { remedy: "Use the structured extended finalizer." },
        );
      }

      if (listed.some((entry) => entry.label === label)) {
        fail(
          "FILE_INVENTORY_DUPLICATE",
          `Detailed inventory repeats ${label}.`,
        );
      }

      if (!expectedLabels.has(label)) {
        fail(
          "FILE_INVENTORY_UNKNOWN_PATH",
          `Detailed inventory path ${label} does not identify a manifest change unit.`,
        );
      }

      current = { ordinal, label, notes: [], line };
      listed.push(current);
      continue;
    }

    if (line.startsWith(notePrefix) && current !== null) {
      const note = line.slice(notePrefix.length);

      assertUsefulEntry(note, "File Changes:");
      current.notes.push(note);
      continue;
    }

    if (line.startsWith(continuationPrefix) && current?.notes.length > 0) {
      const continuation = line.slice(continuationPrefix.length);

      assertUsefulEntry(continuation, "File Changes:");
      current.notes[current.notes.length - 1] += `\n${continuation}`;
      continue;
    }

    fail(
      "FILE_INVENTORY_FORMAT_INVALID",
      "Detailed File Changes entries must use numbered reversible paths and optional aligned notes.",
    );
  }

  if (listed.length !== expected.length) {
    fail(
      "FILE_INVENTORY_INCOMPLETE",
      `Detailed inventory lists ${listed.length} of ${expected.length} change units.`,
    );
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (
      listed[index].ordinal !== expected[index].ordinal ||
      listed[index].label !== expected[index].label ||
      listed[index].line !== expected[index].line
    ) {
      fail(
        "FILE_INVENTORY_ORDER_INVALID",
        "Detailed inventory must use deterministic raw-byte order and aligned ordinals.",
      );
    }
  }

  return listed;
}

function parseStructuredBulkInventory(lines, manifest, structuredContent) {
  const coverage = resolveSemanticCoverage(manifest, structuredContent);
  const expected = coverage.domains.map((domain, index) => {
    const count = domain.units.length;
    const width = String(coverage.domains.length).length;

    return {
      ordinal: index + 1,
      label: `${domain.title} (${count} ${count === 1 ? "file" : "files"})`,
      prefix: `  ${String(index + 1).padStart(width, " ")}. `,
    };
  });
  const listed = [];
  const width = String(expected.length).length;
  const reasonPrefix = `${" ".repeat(width + 4)}- `;
  const continuationPrefix = " ".repeat(width + 6);
  let current = null;

  for (const line of lines) {
    const match = /^ {2,}([0-9]+)\. (.+)$/u.exec(line);

    if (match) {
      current = {
        ordinal: Number(match[1]),
        label: match[2],
        reasons: [],
        line,
      };
      listed.push(current);
      continue;
    }

    if (line.startsWith(reasonPrefix) && current !== null) {
      const reason = line.slice(reasonPrefix.length);

      assertUsefulEntry(reason, "File Changes:");
      current.reasons.push(reason);
      continue;
    }

    if (line.startsWith(continuationPrefix) && current?.reasons.length > 0) {
      const continuation = line.slice(continuationPrefix.length);

      assertUsefulEntry(continuation, "File Changes:");
      current.reasons[current.reasons.length - 1] += `\n${continuation}`;
      continue;
    }

    fail(
      "FILE_INVENTORY_FORMAT_INVALID",
      "Structured bulk File Changes entries must use derived numbered domains and aligned reasons.",
    );
  }

  if (listed.length !== expected.length) {
    fail(
      "FILE_INVENTORY_INCOMPLETE",
      "Structured bulk rendering does not contain every derived domain.",
    );
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (
      listed[index].ordinal !== expected[index].ordinal ||
      listed[index].label !== expected[index].label ||
      listed[index].line !==
        `${expected[index].prefix}${expected[index].label}` ||
      listed[index].reasons.length === 0
    ) {
      fail(
        "FILE_INVENTORY_ORDER_INVALID",
        "Structured bulk rendering must preserve derived domain order, counts, and reasons.",
      );
    }
  }

  return listed;
}

function parseSections(
  bodyLines,
  manifest,
  { messageSource, structuredContent },
) {
  const parsed = {
    rationale: { present: false, entries: [] },
    userExperience: { present: false, entries: [] },
    fileChanges: { present: false, entries: [] },
  };

  if (bodyLines.length === 0) {
    return parsed;
  }

  if (bodyLines[0] !== "") {
    fail(
      "SECTION_SPACING_INVALID",
      "Subject and body must be separated by exactly one blank line.",
    );
  }

  let index = 1;
  let priorOrder = -1;

  while (index < bodyLines.length) {
    const heading = bodyLines[index];
    const order = SECTION_ORDER.indexOf(heading);

    if (order < 0 || order <= priorOrder) {
      fail(
        "SECTION_ORDER_INVALID",
        "Optional sections must appear once in Rationale, User Experience Changes, File Changes order.",
      );
    }

    priorOrder = order;
    index += 1;
    const entries = [];

    while (index < bodyLines.length && bodyLines[index] !== "") {
      entries.push(bodyLines[index]);
      index += 1;
    }

    if (entries.length === 0) {
      fail("EMPTY_SECTION", `${heading} cannot be empty.`);
    }

    if (heading === "Rationale:") {
      parsed.rationale = {
        present: true,
        entries: parseNarrativeSection(entries, heading),
      };
    } else if (heading === "User Experience Changes:") {
      parsed.userExperience = {
        present: true,
        entries: parseNarrativeSection(entries, heading),
      };
    } else {
      parsed.fileChanges = {
        present: true,
        entries:
          messageSource === "structured-finalizer" &&
          structuredContent?.mode === "bulk"
            ? parseStructuredBulkInventory(entries, manifest, structuredContent)
            : parseDetailedInventory(entries, manifest),
      };
    }

    if (index < bodyLines.length) {
      index += 1;

      if (index >= bodyLines.length || bodyLines[index] === "") {
        fail(
          "SECTION_SPACING_INVALID",
          "Sections must be separated by exactly one blank line.",
        );
      }
    }
  }

  return parsed;
}

function isFileIdentityLine(line) {
  return /^ {2,}[0-9]+\. /u.test(line);
}

function presentationWarnings(lines) {
  const warnings = [];

  lines.forEach((line, index) => {
    const length = scalarLength(line);

    if (index === 0 || length <= MAXIMUM_BODY_LINE_SCALARS) {
      return;
    }

    const trimmed = line.trim();
    const words = trimmed.split(/\s+/u);
    const formattedIdentity = isFileIdentityLine(line);

    if (!formattedIdentity && words.length > 1) {
      const longest = Math.max(...words.map(scalarLength));

      if (longest <= MAXIMUM_BODY_LINE_SCALARS - 4) {
        fail(
          "BODY_LINE_AVOIDABLY_OVERLONG",
          `Body line ${index + 1} is ${length} scalars and could be wrapped at whitespace.`,
          { lineNumber: index + 1, scalarLength: length },
        );
      }
    }

    warnings.push({
      lineNumber: index + 1,
      scalarLength: length,
      reason: formattedIdentity
        ? "formatted-path-identity"
        : "indivisible-token",
    });
  });

  const sha256 =
    warnings.length === 0
      ? null
      : createHash("sha256").update(JSON.stringify(warnings)).digest("hex");

  return {
    count: warnings.length,
    samples: warnings.slice(0, MAXIMUM_PRESENTATION_WARNING_SAMPLES),
    sha256,
  };
}

export function canUseDirectSubjectTransport(subject) {
  if (
    typeof subject !== "string" ||
    !DIRECT_SUBJECT_TRANSPORT_PATTERN.test(subject) ||
    subject.includes("\n") ||
    subject.includes("\r")
  ) {
    return false;
  }

  try {
    parseSubject(subject, { allowedTypes: [] });
    return true;
  } catch {
    return false;
  }
}

export function validateApprovedMessage({
  manifest,
  route,
  bytes: inputBytes,
  repositoryTypePolicy,
  messageSource,
  structuredContent = null,
}) {
  const sourceAllowed =
    (route === "concise" &&
      new Set(["approved-subject", "checked-file"]).has(messageSource)) ||
    (route === "extended" &&
      new Set(["checked-file", "structured-finalizer"]).has(messageSource));

  if (!sourceAllowed) {
    fail(
      "DIRECT_TEXT_REQUIRES_CONCISE_TRANSACTION",
      "Direct subjects require a concise transaction; checked text additionally requires a completed non-semantic extended review.",
    );
  }

  const bytes = canonicalBytes(inputBytes);
  const displayText = decodeCanonicalMessage(bytes);
  const withoutTerminalLf = displayText.slice(0, -1);
  const lines = withoutTerminalLf.split("\n");
  const subject = parseSubject(lines[0] ?? "", repositoryTypePolicy);
  const sections = parseSections(lines.slice(1), manifest, {
    messageSource,
    structuredContent,
  });

  if (messageSource === "approved-subject") {
    if (lines.length !== 1) {
      fail(
        "DIRECT_SUBJECT_MUST_BE_SUBJECT_ONLY",
        "Direct subject transport cannot contain a body.",
      );
    }

    if (!canUseDirectSubjectTransport(subject.text)) {
      fail(
        "DIRECT_SUBJECT_TRANSPORT_UNSAFE",
        "Subject is valid canonical text but is outside the conservative direct transport set.",
      );
    }

    if (!bytes.equals(Buffer.from(`${subject.text}\n`, "utf8"))) {
      fail(
        "DIRECT_SUBJECT_ENCODING_INVALID",
        "Direct subject bytes must equal the deterministic subject plus one LF encoding.",
      );
    }
  }

  const warnings = presentationWarnings(lines);
  const messageSha256 = createHash("sha256").update(bytes).digest("hex");
  const presentationEntryCount = sections.fileChanges.entries.length;
  const listedCount =
    messageSource === "structured-finalizer" &&
    structuredContent?.mode === "bulk"
      ? manifest.changeUnitCount
      : presentationEntryCount;

  return {
    schemaVersion: 1,
    valid: true,
    route,
    messageSource,
    byteCount: bytes.length,
    messageSha256,
    displayText,
    subject,
    sections: {
      rationale: {
        present: sections.rationale.present,
        entryCount: sections.rationale.entries.length,
      },
      userExperience: {
        present: sections.userExperience.present,
        entryCount: sections.userExperience.entries.length,
      },
      fileChanges: {
        present: sections.fileChanges.present,
        entryCount: presentationEntryCount,
      },
    },
    files: {
      expectedCount: manifest.changeUnitCount,
      listedCount,
      setMatches:
        !sections.fileChanges.present ||
        listedCount === manifest.changeUnitCount,
      orderValid: true,
      unique: true,
    },
    presentationWarnings: warnings,
  };
}
