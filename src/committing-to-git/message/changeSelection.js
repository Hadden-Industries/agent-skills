import { Buffer } from "node:buffer";

export const MAXIMUM_CANONICAL_MESSAGE_BYTES = 32 * 1024;

const ARRAY_SELECTOR_FIELDS = Object.freeze([
  "ids",
  "destinationPaths",
  "destinationPathPrefixes",
  "sourcePaths",
  "sourcePathPrefixes",
  "kinds",
]);
const SELECTOR_FIELDS = new Set(["all", "remaining", ...ARRAY_SELECTOR_FIELDS]);
const EVIDENCE_POLICIES = new Set(["reuse", "message", "review"]);
const BASIS_KINDS = new Set([
  "authored-current-task",
  "read-current-task",
  "task-lineage",
  "user-grounded",
  "generated-derived",
  "unknown-preexisting",
]);
const REUSE_BASIS_KINDS = new Set([
  "authored-current-task",
  "read-current-task",
  "task-lineage",
  "generated-derived",
]);
const MAXIMUM_BASIS_NOTE_BYTES = 512;
const PROHIBITED_RENDERED_PATH_CHARACTER = /[\p{Cc}\p{Cf}`]/u;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertManifest(manifest) {
  if (
    !isPlainObject(manifest) ||
    !Array.isArray(manifest.changeUnits) ||
    !Number.isSafeInteger(manifest.changeUnitCount) ||
    manifest.changeUnitCount < 1 ||
    manifest.changeUnitCount !== manifest.changeUnits.length
  ) {
    throw new Error(
      "Semantic selection requires one nonempty exact change manifest.",
    );
  }

  const ids = manifest.changeUnits.map(({ id }) => id);

  if (
    ids.some((id) => typeof id !== "string" || !/^F[0-9]{6}$/u.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error("Manifest change-unit IDs must be unique and canonical.");
  }
}

function pathBytes(unit, direction) {
  const encoded = unit[`${direction}PathBytesBase64`];

  if (typeof encoded === "string") {
    return Buffer.from(encoded, "base64");
  }

  const path = unit[`${direction}Path`];
  return typeof path === "string" ? Buffer.from(path, "utf8") : null;
}

function assertRepositoryPath(value, { prefix, field }) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/")
  ) {
    throw new Error(
      `Selector ${field} value ${JSON.stringify(value)} is not a canonical repository-relative path.`,
    );
  }

  if (prefix && !value.endsWith("/")) {
    throw new Error(
      `Selector ${field} prefix ${JSON.stringify(value)} must end in '/'.`,
    );
  }

  if (!prefix && value.endsWith("/")) {
    throw new Error(
      `Selector ${field} exact path ${JSON.stringify(value)} must not end in '/'.`,
    );
  }

  const components = value.split("/");
  const meaningful = prefix ? components.slice(0, -1) : components;

  if (
    meaningful.some(
      (component) =>
        component.length === 0 || component === "." || component === "..",
    )
  ) {
    throw new Error(
      `Selector ${field} value ${JSON.stringify(value)} contains an invalid path component.`,
    );
  }
}

function normalizeSelection(selection) {
  if (!isPlainObject(selection)) {
    throw new Error("Change selection must be an object.");
  }

  const unknown = Object.keys(selection).find(
    (field) => !SELECTOR_FIELDS.has(field),
  );

  if (unknown) {
    throw new Error(`Unknown change selector field ${unknown}.`);
  }

  if (
    ("all" in selection && typeof selection.all !== "boolean") ||
    ("remaining" in selection && typeof selection.remaining !== "boolean")
  ) {
    throw new Error("Selector all and remaining values must be booleans.");
  }

  const all = selection.all === true;
  const remaining = selection.remaining === true;
  const populated = [];
  const normalized = {};

  for (const field of ARRAY_SELECTOR_FIELDS) {
    const values = selection[field];

    if (values === undefined) {
      continue;
    }

    if (
      !Array.isArray(values) ||
      values.some((value) => typeof value !== "string" || value.length === 0)
    ) {
      throw new Error(`Selector ${field} must be a string array.`);
    }

    if (new Set(values).size !== values.length) {
      throw new Error(`Selector ${field} contains duplicate values.`);
    }

    if (field.endsWith("Paths")) {
      values.forEach((value) =>
        assertRepositoryPath(value, { prefix: false, field }),
      );
    } else if (field.endsWith("Prefixes")) {
      values.forEach((value) =>
        assertRepositoryPath(value, { prefix: true, field }),
      );
    }

    if (values.length > 0) {
      populated.push(field);
      normalized[field] = [...values];
    }
  }

  if ((all || remaining) && (all === remaining || populated.length > 0)) {
    throw new Error(
      "Selectors all and remaining are each exclusive of every other selector field.",
    );
  }

  if (!all && !remaining && populated.length === 0) {
    throw new Error("Change selection requires one nonempty selector.");
  }

  if (all) {
    return { all: true };
  }

  if (remaining) {
    return { remaining: true };
  }

  return normalized;
}

function unitMatchesValue(unit, field, value) {
  if (field === "ids") {
    return unit.id === value;
  }

  if (field === "kinds") {
    return unit.kind === value;
  }

  const source = field.startsWith("source");

  if (source && unit.kind !== "renamed") {
    return false;
  }

  const bytes = pathBytes(unit, source ? "source" : "destination");

  if (bytes === null) {
    return false;
  }

  const expected = Buffer.from(value, "utf8");

  return field.endsWith("Prefixes")
    ? bytes.length >= expected.length &&
        bytes.subarray(0, expected.length).equals(expected)
    : bytes.equals(expected);
}

export function resolveSelection(
  manifest,
  selection,
  { assignedIds = new Set() } = {},
) {
  assertManifest(manifest);

  if (!(assignedIds instanceof Set)) {
    throw new Error("Selection assignedIds must be a Set.");
  }

  const normalized = normalizeSelection(selection);

  if (normalized.all === true) {
    return [...manifest.changeUnits];
  }

  if (normalized.remaining === true) {
    const units = manifest.changeUnits.filter(({ id }) => !assignedIds.has(id));

    if (units.length === 0) {
      throw new Error("The remaining selector matched no change units.");
    }

    return units;
  }

  const matchedIds = new Set();

  for (const [field, values] of Object.entries(normalized)) {
    for (const value of values) {
      const matches = manifest.changeUnits.filter((unit) =>
        unitMatchesValue(unit, field, value),
      );

      if (matches.length === 0) {
        throw new Error(
          `Selector field ${field} value ${JSON.stringify(value)} matched no change units.`,
        );
      }

      matches.forEach(({ id }) => matchedIds.add(id));
    }
  }

  return manifest.changeUnits.filter(({ id }) => matchedIds.has(id));
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
    throw new Error(`${label} requires one or more canonical reasons.`);
  }

  if (new Set(reasons).size !== reasons.length) {
    throw new Error(`${label} contains duplicate reasons.`);
  }

  return [...reasons];
}

function validateBasis(policy, basis) {
  if (
    !EVIDENCE_POLICIES.has(policy) ||
    !isPlainObject(basis) ||
    !BASIS_KINDS.has(basis.kind) ||
    !(basis.note === null || typeof basis.note === "string") ||
    (typeof basis.note === "string" &&
      Buffer.byteLength(basis.note, "utf8") > MAXIMUM_BASIS_NOTE_BYTES)
  ) {
    throw new Error("Evidence policy or basis is invalid.");
  }

  if (policy === "reuse" && !REUSE_BASIS_KINDS.has(basis.kind)) {
    throw new Error(
      "Reuse evidence requires authored, read, generated, or specific task-lineage basis.",
    );
  }

  if (
    policy === "reuse" &&
    basis.kind === "task-lineage" &&
    (typeof basis.note !== "string" || basis.note.trim().length === 0)
  ) {
    throw new Error(
      "Reuse task-lineage basis requires a specific nonempty note.",
    );
  }

  return { kind: basis.kind, note: basis.note };
}

function resolvePartition(manifest, groups, { label, validateGroup }) {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error(`${label} groups must be a nonempty array.`);
  }

  const assignedIds = new Set();
  const resolved = groups.map((group, index) => {
    if (!isPlainObject(group)) {
      throw new Error(`${label} group ${index + 1} must be an object.`);
    }

    const selection = normalizeSelection(group.selection);

    if (selection.remaining === true && index !== groups.length - 1) {
      throw new Error(
        `The remaining selector is permitted only in the final ${label.toLowerCase()} group.`,
      );
    }

    const units = resolveSelection(manifest, selection, { assignedIds });
    const overlap = units.find(({ id }) => assignedIds.has(id));

    if (overlap) {
      throw new Error(`${label} groups overlap at ${overlap.id}.`);
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
    throw new Error(
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
    throw new Error(`${label} must be an array.`);
  }

  const previouslyMatched = new Set();

  return groups.map((group, index) => {
    if (!isPlainObject(group)) {
      throw new Error(`${label} entry ${index + 1} must be an object.`);
    }

    const selection = normalizeSelection(group.selection);

    if (selection.remaining === true && index !== groups.length - 1) {
      throw new Error(
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
  assertManifest(manifest);

  if (!isPlainObject(content)) {
    throw new Error("Semantic message content must be an object.");
  }

  const evidenceCoverage = resolvePartition(manifest, content.evidenceGroups, {
    label: "Evidence",
    validateGroup(group, index) {
      if (!EVIDENCE_POLICIES.has(group.policy)) {
        throw new Error(`Evidence group ${index + 1} has an invalid policy.`);
      }

      return {
        policy: group.policy,
        basis: validateBasis(group.policy, group.basis),
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
          throw new Error(`Domain group ${index + 1} has an invalid title.`);
        }

        return {
          title: group.title,
          reasons: validateReasons(group.reasons, `Domain group ${index + 1}`),
        };
      },
    }).resolved;
  } else if (content.mode !== "detailed") {
    throw new Error("Semantic message mode must be detailed or bulk.");
  } else if (content.domains !== undefined && content.domains.length > 0) {
    throw new Error("Detailed semantic content cannot contain bulk domains.");
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
    pathBytes(left, "destination") ?? Buffer.alloc(0),
    pathBytes(right, "destination") ?? Buffer.alloc(0),
  );

  if (destination !== 0) {
    return destination;
  }

  const source = Buffer.compare(
    pathBytes(left, "source") ?? Buffer.alloc(0),
    pathBytes(right, "source") ?? Buffer.alloc(0),
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
  const destination = formatMessagePath(pathBytes(unit, "destination"));

  if (unit.kind !== "renamed") {
    return destination;
  }

  const source = pathBytes(unit, "source");

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
