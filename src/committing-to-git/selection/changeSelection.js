import {
  ARRAY_SELECTOR_FIELDS,
  SELECTOR_FIELDS,
} from "./selectionVocabulary.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function assertChangeManifest(manifest) {
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

export function changeUnitPathBytes(unit, direction) {
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
    throw new WorkflowDiagnosticError(
      "INVALID_SELECTION",
      `Selector ${field} value ${JSON.stringify(value)} is not a canonical repository-relative path.`,
    );
  }

  if (prefix && !value.endsWith("/")) {
    throw new WorkflowDiagnosticError(
      "INVALID_SELECTION",
      `Selector ${field} prefix ${JSON.stringify(value)} must end in '/'.`,
    );
  }

  if (!prefix && value.endsWith("/")) {
    throw new WorkflowDiagnosticError(
      "INVALID_SELECTION",
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
    throw new WorkflowDiagnosticError(
      "INVALID_SELECTION",
      `Selector ${field} value ${JSON.stringify(value)} contains an invalid path component.`,
    );
  }
}

export function normalizeSelection(selection) {
  if (!isPlainObject(selection)) {
    throw new WorkflowDiagnosticError(
      "INVALID_SELECTION",
      "Change selection must be an object.",
    );
  }

  const unknown = Object.keys(selection).find(
    (field) => !SELECTOR_FIELDS.includes(field),
  );

  if (unknown) {
    throw new WorkflowDiagnosticError(
      "INVALID_SELECTION",
      `Unknown change selector field ${unknown}.`,
    );
  }

  if (
    ("all" in selection && typeof selection.all !== "boolean") ||
    ("remaining" in selection && typeof selection.remaining !== "boolean")
  ) {
    throw new WorkflowDiagnosticError(
      "INVALID_SELECTION",
      "Selector all and remaining values must be booleans.",
    );
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
      throw new WorkflowDiagnosticError(
        "INVALID_SELECTION",
        `Selector ${field} must be a string array.`,
      );
    }

    if (new Set(values).size !== values.length) {
      throw new WorkflowDiagnosticError(
        "INVALID_SELECTION",
        `Selector ${field} contains duplicate values.`,
      );
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
    throw new WorkflowDiagnosticError(
      "INVALID_SELECTION",
      "Selectors all and remaining are each exclusive of every other selector field.",
    );
  }

  if (!all && !remaining && populated.length === 0) {
    throw new WorkflowDiagnosticError(
      "INVALID_SELECTION",
      "Change selection requires one nonempty selector.",
    );
  }

  if (all) {
    return { all: true };
  }

  if (remaining) {
    return { remaining: true };
  }

  return normalized;
}

/** Resolve the union in manifest order with operation-local, lossless byte keys. */
export function resolveSelection(
  manifest,
  selection,
  { assignedIds = new Set() } = {},
) {
  assertChangeManifest(manifest);

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
      throw new WorkflowDiagnosticError(
        "EMPTY_SELECTION",
        "The remaining selector matched no change units. Remove the empty group or correct its preceding selections.",
        { details: { selection: { remaining: true }, matchedCount: 0 } },
      );
    }

    return units;
  }

  const matchedIds = new Set();
  // Share decoding between exact and prefix fields, never between calls: input
  // objects may change, and encoded paths remain authoritative over display text.
  const pathCandidates = new Map();
  function candidatesFor(field) {
    const direction = field.startsWith("source") ? "source" : "destination";
    if (!pathCandidates.has(direction)) {
      const candidates = [];
      for (const unit of manifest.changeUnits) {
        if (direction === "source" && unit.kind !== "renamed") continue;
        const bytes = changeUnitPathBytes(unit, direction);
        if (bytes !== null) candidates.push({ unit, bytes });
      }
      pathCandidates.set(direction, candidates);
    }
    return pathCandidates.get(direction);
  }
  let unmatchedCount = 0;
  const unmatchedValues = [];

  for (const [field, values] of Object.entries(normalized)) {
    const prefix = field.endsWith("Prefixes");
    const pathField = field !== "ids" && field !== "kinds";
    const index = new Map();
    const candidates = pathField ? candidatesFor(field) : null;
    if (!prefix) {
      const add = (key, unit) => {
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(unit);
      };
      if (pathField) {
        for (const { unit, bytes } of candidates) {
          add(bytes.toString("base64"), unit);
        }
      } else {
        for (const unit of manifest.changeUnits) {
          add(field === "ids" ? unit.id : unit.kind, unit);
        }
      }
    }
    for (const [valueIndex, value] of values.entries()) {
      const expected = pathField ? Buffer.from(value, "utf8") : null;
      const matches = prefix
        ? candidates
            .filter(
              ({ bytes }) =>
                bytes.length >= expected.length &&
                bytes.subarray(0, expected.length).equals(expected),
            )
            .map(({ unit }) => unit)
        : (index.get(pathField ? expected.toString("base64") : value) ?? []);

      if (matches.length === 0) {
        unmatchedCount += 1;
        if (unmatchedValues.length < 32) {
          unmatchedValues.push(
            Buffer.byteLength(value) <= 256
              ? { field, value }
              : {
                  field,
                  index: valueIndex,
                  valueByteLength: Buffer.byteLength(value),
                },
          );
        }
      }

      matches.forEach(({ id }) => matchedIds.add(id));
    }
  }

  if (unmatchedCount > 0) {
    throw new WorkflowDiagnosticError(
      "UNMATCHED_SELECTION_VALUES",
      `${unmatchedCount} explicit selector value(s) matched no change units.`,
      {
        details: {
          unmatchedCount,
          unmatchedValues,
          omittedCount: unmatchedCount - unmatchedValues.length,
        },
        recovery: {
          kind: "correct-input",
          automatic: false,
          requiredInputs: ["selectors matching the current manifest"],
          commands: [],
        },
      },
    );
  }

  return manifest.changeUnits.filter(({ id }) => matchedIds.has(id));
}
