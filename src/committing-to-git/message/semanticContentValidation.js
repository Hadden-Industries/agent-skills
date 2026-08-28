import { createHash } from "node:crypto";

const DIAGNOSTIC_SAMPLE_LIMIT = 64;
const MAXIMUM_POINTER_TOKEN_BYTES = 256;
const SUBJECT_FIELDS = Object.freeze(["type", "scope", "description"]);
const COMMON_FIELDS = Object.freeze([
  "schemaVersion",
  "authoringState",
  "evidenceGroups",
  "subject",
  "sharedRationales",
  "userExperienceChanges",
  "mode",
]);
const SELECTION_FIELDS = Object.freeze([
  "all",
  "remaining",
  "ids",
  "destinationPaths",
  "destinationPathPrefixes",
  "sourcePaths",
  "sourcePathPrefixes",
  "kinds",
]);
const ARRAY_SELECTION_FIELDS = Object.freeze(SELECTION_FIELDS.slice(2));
const EVIDENCE_POLICIES = Object.freeze(["reuse", "message", "review"]);
const BASIS_KINDS = Object.freeze([
  "authored-current-task",
  "read-current-task",
  "task-lineage",
  "user-grounded",
  "generated-derived",
  "unknown-preexisting",
]);
const OPTIONAL_DIAGNOSTIC_FIELDS = Object.freeze([
  "expectedType",
  "allowedValues",
  "allowedFields",
  "missingFields",
  "unknownFields",
]);
const TYPE_TOKEN_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedPointerToken(token) {
  const value = String(token);

  if (Buffer.byteLength(value, "utf8") <= MAXIMUM_POINTER_TOKEN_BYTES) {
    return value;
  }

  const digest = createHash("sha256").update(value).digest("hex");

  // Exceptionally large member names cannot be echoed into an 80 KiB result.
  // The digest preserves a stable identity while ordinary names retain exact
  // RFC 6901 pointers.
  return `field-sha256:${digest}`;
}

function childPointer(parent, token) {
  const escaped = boundedPointerToken(token)
    .replaceAll("~", "~0")
    .replaceAll("/", "~1");

  return `${parent}/${escaped}`;
}

function diagnosticCollector() {
  const digest = createHash("sha256");
  const samples = [];
  let count = 0;

  return {
    add(pointer, code, message, details = {}) {
      const diagnostic = { pointer, code, message };

      for (const field of OPTIONAL_DIAGNOSTIC_FIELDS) {
        if (details[field] !== undefined) {
          diagnostic[field] = Array.isArray(details[field])
            ? [...details[field]]
            : details[field];
        }
      }

      digest.update(JSON.stringify(diagnostic));
      digest.update("\n");
      count += 1;

      if (samples.length < DIAGNOSTIC_SAMPLE_LIMIT) {
        samples.push(diagnostic);
      }
    },

    result() {
      return {
        valid: count === 0,
        diagnostics: {
          count,
          samples,
          truncated: count > samples.length,
          sha256: digest.digest("hex"),
        },
      };
    },
  };
}

function validateObjectMembers(
  value,
  pointer,
  { required = [], allowed },
  collector,
) {
  if (!isPlainObject(value)) {
    collector.add(pointer, "EXPECTED_OBJECT", "Value must be an object.", {
      expectedType: "object",
    });
    return false;
  }

  const allowedSet = new Set(allowed);

  for (const field of required) {
    if (!Object.hasOwn(value, field)) {
      collector.add(
        childPointer(pointer, field),
        "REQUIRED_FIELD_MISSING",
        `Required field ${field} is missing.`,
        { missingFields: [field] },
      );
    }
  }

  for (const field of Object.keys(value).sort()) {
    if (allowedSet.has(field)) {
      continue;
    }

    const scopeContrast =
      field === "includePaths"
        ? " includePaths is a scope-file field; semantic selections use destinationPaths."
        : "";

    collector.add(
      childPointer(pointer, field),
      "UNKNOWN_FIELD",
      `Field ${boundedPointerToken(field)} is not allowed here.${scopeContrast}`,
      {
        allowedFields: allowed,
        unknownFields: [boundedPointerToken(field)],
      },
    );
  }

  return true;
}

function validateString(value, pointer, collector, { nullable = false } = {}) {
  if (nullable && value === null) {
    return;
  }

  if (typeof value !== "string") {
    collector.add(pointer, "EXPECTED_STRING", "Value must be a string.", {
      expectedType: nullable ? "string-or-null" : "string",
    });
    return;
  }

  if (value.length === 0) {
    collector.add(pointer, "EMPTY_STRING", "String must not be empty.");
  }
}

function validateStringArray(value, pointer, collector) {
  if (!Array.isArray(value)) {
    collector.add(pointer, "EXPECTED_ARRAY", "Value must be an array.", {
      expectedType: "array",
    });
    return;
  }

  if (value.length === 0) {
    collector.add(
      pointer,
      "EMPTY_ARRAY",
      "Array must contain at least one value.",
    );
  }

  const strings = new Set();
  let duplicate = false;

  value.forEach((entry, index) => {
    validateString(entry, childPointer(pointer, index), collector);

    if (typeof entry === "string") {
      duplicate ||= strings.has(entry);
      strings.add(entry);
    }
  });

  if (duplicate) {
    collector.add(pointer, "DUPLICATE_VALUES", "Array values must be unique.");
  }
}

function validateSelection(value, pointer, collector) {
  if (
    !validateObjectMembers(
      value,
      pointer,
      { allowed: SELECTION_FIELDS },
      collector,
    )
  ) {
    return;
  }

  const selectedFields = [];

  for (const field of ["all", "remaining"]) {
    if (!Object.hasOwn(value, field)) {
      continue;
    }

    if (value[field] !== true) {
      collector.add(
        childPointer(pointer, field),
        "VALUE_NOT_ALLOWED",
        `Selector ${field} must be true when present.`,
        { allowedValues: [true] },
      );
    } else {
      selectedFields.push(field);
    }
  }

  for (const field of ARRAY_SELECTION_FIELDS) {
    if (!Object.hasOwn(value, field)) {
      continue;
    }

    validateStringArray(value[field], childPointer(pointer, field), collector);

    if (Array.isArray(value[field]) && value[field].length > 0) {
      selectedFields.push(field);
    }
  }

  if (selectedFields.length === 0) {
    collector.add(
      pointer,
      "SELECTION_REQUIRED",
      "Semantic selection requires all, remaining, or one nonempty semantic selector field.",
      { allowedFields: SELECTION_FIELDS },
    );
  } else if (
    selectedFields.length > 1 &&
    (selectedFields.includes("all") || selectedFields.includes("remaining"))
  ) {
    collector.add(
      pointer,
      "SELECTION_FIELDS_CONFLICT",
      "Selectors all and remaining are each exclusive of every other selector field.",
      { allowedFields: SELECTION_FIELDS },
    );
  }
}

function validateReasons(value, pointer, collector) {
  validateStringArray(value, pointer, collector);
}

function validateSubject(value, pointer, collector) {
  if (
    !validateObjectMembers(
      value,
      pointer,
      { required: SUBJECT_FIELDS, allowed: SUBJECT_FIELDS },
      collector,
    )
  ) {
    return;
  }

  if (Object.hasOwn(value, "type")) {
    validateString(value.type, childPointer(pointer, "type"), collector);

    if (
      typeof value.type === "string" &&
      !TYPE_TOKEN_PATTERN.test(value.type)
    ) {
      collector.add(
        childPointer(pointer, "type"),
        "INVALID_TYPE_TOKEN",
        "Commit type must be a lowercase Conventional Commit token of at most 32 characters.",
      );
    }
  }

  if (Object.hasOwn(value, "scope")) {
    validateString(value.scope, childPointer(pointer, "scope"), collector, {
      nullable: true,
    });
  }

  if (Object.hasOwn(value, "description")) {
    validateString(
      value.description,
      childPointer(pointer, "description"),
      collector,
    );
  }
}

function validateBasis(value, pointer, collector) {
  const fields = ["kind", "note"];

  if (
    !validateObjectMembers(
      value,
      pointer,
      { required: fields, allowed: fields },
      collector,
    )
  ) {
    return;
  }

  if (Object.hasOwn(value, "kind") && !BASIS_KINDS.includes(value.kind)) {
    collector.add(
      childPointer(pointer, "kind"),
      "VALUE_NOT_ALLOWED",
      "Evidence basis kind is not supported.",
      { allowedValues: BASIS_KINDS },
    );
  }

  if (Object.hasOwn(value, "note")) {
    validateString(value.note, childPointer(pointer, "note"), collector, {
      nullable: true,
    });
  }
}

function validateEvidenceGroups(value, pointer, collector) {
  if (!Array.isArray(value)) {
    collector.add(pointer, "EXPECTED_ARRAY", "Value must be an array.", {
      expectedType: "array",
    });
    return;
  }

  if (value.length === 0) {
    collector.add(
      pointer,
      "EMPTY_ARRAY",
      "Evidence groups must contain at least one helper-owned group.",
    );
  }

  value.forEach((group, index) => {
    const entryPointer = childPointer(pointer, index);
    const fields = ["selection", "policy", "basis"];

    if (
      !validateObjectMembers(
        group,
        entryPointer,
        { required: fields, allowed: fields },
        collector,
      )
    ) {
      return;
    }

    if (Object.hasOwn(group, "selection")) {
      validateSelection(
        group.selection,
        childPointer(entryPointer, "selection"),
        collector,
      );
    }

    if (
      Object.hasOwn(group, "policy") &&
      !EVIDENCE_POLICIES.includes(group.policy)
    ) {
      collector.add(
        childPointer(entryPointer, "policy"),
        "VALUE_NOT_ALLOWED",
        "Evidence policy is not supported.",
        { allowedValues: EVIDENCE_POLICIES },
      );
    }

    if (Object.hasOwn(group, "basis")) {
      validateBasis(
        group.basis,
        childPointer(entryPointer, "basis"),
        collector,
      );
    }
  });
}

function validateRationaleEntries(
  value,
  pointer,
  collector,
  { domain = false } = {},
) {
  if (!Array.isArray(value)) {
    collector.add(pointer, "EXPECTED_ARRAY", "Value must be an array.", {
      expectedType: "array",
    });
    return;
  }

  if (domain && value.length === 0) {
    collector.add(
      pointer,
      "EMPTY_ARRAY",
      "Bulk semantic content requires at least one domain.",
    );
  }

  value.forEach((entry, index) => {
    const entryPointer = childPointer(pointer, index);
    const fields = domain
      ? ["title", "selection", "reasons"]
      : ["selection", "reasons"];

    if (
      !validateObjectMembers(
        entry,
        entryPointer,
        { required: fields, allowed: fields },
        collector,
      )
    ) {
      return;
    }

    if (domain && Object.hasOwn(entry, "title")) {
      validateString(
        entry.title,
        childPointer(entryPointer, "title"),
        collector,
      );
    }

    if (Object.hasOwn(entry, "selection")) {
      validateSelection(
        entry.selection,
        childPointer(entryPointer, "selection"),
        collector,
      );
    }

    if (Object.hasOwn(entry, "reasons")) {
      validateReasons(
        entry.reasons,
        childPointer(entryPointer, "reasons"),
        collector,
      );
    }
  });
}

function validateUserExperienceChanges(value, pointer, collector) {
  if (!Array.isArray(value)) {
    collector.add(pointer, "EXPECTED_ARRAY", "Value must be an array.", {
      expectedType: "array",
    });
    return;
  }

  const entries = new Set();
  let duplicate = false;

  value.forEach((entry, index) => {
    validateString(entry, childPointer(pointer, index), collector);

    if (typeof entry === "string") {
      duplicate ||= entries.has(entry);
      entries.add(entry);
    }
  });

  if (duplicate) {
    collector.add(
      pointer,
      "DUPLICATE_VALUES",
      "User experience changes must be unique.",
    );
  }
}

export function validateCompleteSemanticContent(value) {
  const collector = diagnosticCollector();

  if (!isPlainObject(value)) {
    collector.add(
      "",
      "EXPECTED_OBJECT",
      "Semantic content must be an object.",
      {
        expectedType: "object",
      },
    );
    return collector.result();
  }

  const mode = value.mode;
  const modeField = mode === "bulk" ? "domains" : "fileNotes";
  const allowedFields = [
    ...COMMON_FIELDS,
    ...(new Set(["detailed", "bulk"]).has(mode)
      ? [modeField]
      : ["fileNotes", "domains"]),
  ];
  const requiredFields = [
    ...COMMON_FIELDS,
    ...(new Set(["detailed", "bulk"]).has(mode) ? [modeField] : []),
  ];

  validateObjectMembers(
    value,
    "",
    { required: requiredFields, allowed: allowedFields },
    collector,
  );

  if (value.schemaVersion !== 3) {
    collector.add(
      "/schemaVersion",
      "VALUE_NOT_ALLOWED",
      "Semantic content schemaVersion must be 3.",
      { allowedValues: [3] },
    );
  }

  if (value.authoringState !== "complete") {
    collector.add(
      "/authoringState",
      "VALUE_NOT_ALLOWED",
      "Set authoringState to complete after all semantic decisions are authored.",
      { allowedValues: ["complete"] },
    );
  }

  if (!new Set(["detailed", "bulk"]).has(mode)) {
    collector.add(
      "/mode",
      "VALUE_NOT_ALLOWED",
      "Semantic message mode must be detailed or bulk.",
      { allowedValues: ["detailed", "bulk"] },
    );
  }

  if (Object.hasOwn(value, "evidenceGroups")) {
    validateEvidenceGroups(value.evidenceGroups, "/evidenceGroups", collector);
  }

  if (Object.hasOwn(value, "subject")) {
    validateSubject(value.subject, "/subject", collector);
  }

  if (Object.hasOwn(value, "sharedRationales")) {
    validateRationaleEntries(
      value.sharedRationales,
      "/sharedRationales",
      collector,
    );
  }

  if (Object.hasOwn(value, "userExperienceChanges")) {
    validateUserExperienceChanges(
      value.userExperienceChanges,
      "/userExperienceChanges",
      collector,
    );
  }

  if (Object.hasOwn(value, "fileNotes")) {
    validateRationaleEntries(value.fileNotes, "/fileNotes", collector);
  }

  if (Object.hasOwn(value, "domains")) {
    validateRationaleEntries(value.domains, "/domains", collector, {
      domain: true,
    });
  }

  return collector.result();
}
