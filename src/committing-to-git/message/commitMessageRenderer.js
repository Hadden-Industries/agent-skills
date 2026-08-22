import { Buffer } from "node:buffer";

// Canonical commit-message scaffolding and rendering.

export const BULK_FILE_THRESHOLD = 50;
export const MAX_LINE_LENGTH = 72;

const ALLOWED_TYPES = new Set([
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
  if (!subject || !ALLOWED_TYPES.has(subject.type)) {
    throw new Error("Subject type is missing or not allowed.");
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

export function renderCommitMessage(manifest, content) {
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

export function scaffoldContent(manifest) {
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

export function renderScaffoldTemplate(manifest, content) {
  if (content.mode === "detailed") {
    return renderCommitMessage(manifest, content);
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
