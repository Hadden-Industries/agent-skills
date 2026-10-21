/** Native pure preparation input admission; canonical bytes bind selectors and evidence before routing. */
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { normalizeSelection } from "../selection/changeSelection.js";
import { validateEvidenceBasis } from "../evidence/evidenceVocabulary.js";
const SCOPE_KEYS = [
  "schemaVersion",
  "includePaths",
  "includePathPrefixes",
  "excludePaths",
  "excludePathPrefixes",
  "includePathBytesBase64",
  "excludePathBytesBase64",
];
const EVIDENCE_PLAN_KEYS = ["schemaVersion", "groups"];
const GROUP_KEYS = ["selection", "policy", "basis"];
const BASIS_KEYS = ["kind", "note"];

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, keys, label, code) {
  if (!isPlainObject(value)) {
    fail(code, `${label} must be an object.`);
  }

  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(code, `${label} contains missing or unknown members.`);
  }
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validateRepositoryRelativePath(path, { prefix, label }) {
  if (typeof path !== "string" || path.length === 0) {
    fail("INVALID_SCOPE_SELECTOR", `${label} must be a non-empty string.`);
  }

  if (path.includes("\0") || path.includes("\\") || path.startsWith("/")) {
    fail(
      "INVALID_SCOPE_SELECTOR",
      `${label} must be a slash-separated repository-relative path.`,
    );
  }

  if (prefix !== path.endsWith("/")) {
    fail(
      "INVALID_SCOPE_SELECTOR",
      prefix
        ? `${label} must end with a slash.`
        : `${label} must not end with a slash.`,
    );
  }

  const components = path.split("/");
  const meaningfulComponents = prefix ? components.slice(0, -1) : components;

  if (
    meaningfulComponents.some(
      (component) =>
        component.length === 0 || component === "." || component === "..",
    )
  ) {
    fail(
      "INVALID_SCOPE_SELECTOR",
      `${label} contains an invalid path component.`,
    );
  }

  return Buffer.from(path, "utf8");
}

function decodeCanonicalBase64Path(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail("INVALID_SCOPE_SELECTOR", `${label} must be non-empty base64.`);
  }

  const bytes = Buffer.from(value, "base64");

  if (
    bytes.length === 0 ||
    bytes.toString("base64") !== value ||
    bytes.includes(0) ||
    bytes.includes(92) ||
    bytes[0] === 47 ||
    bytes[bytes.length - 1] === 47
  ) {
    fail(
      "INVALID_SCOPE_SELECTOR",
      `${label} must encode one canonical repository-relative exact path.`,
    );
  }

  const components = [];
  let start = 0;

  for (let index = 0; index <= bytes.length; index += 1) {
    if (index === bytes.length || bytes[index] === 47) {
      components.push(bytes.subarray(start, index));
      start = index + 1;
    }
  }

  if (
    components.some(
      (component) =>
        component.length === 0 ||
        component.equals(Buffer.from(".")) ||
        component.equals(Buffer.from("..")),
    )
  ) {
    fail(
      "INVALID_SCOPE_SELECTOR",
      `${label} contains an invalid path component.`,
    );
  }

  return bytes;
}

/** Compare literal path bytes without locale or Unicode normalization. */
export function compareBuffers(left, right) {
  return Buffer.compare(left, right);
}

function pathStartsWith(path, prefix) {
  return (
    path.length >= prefix.length &&
    path.subarray(0, prefix.length).equals(prefix)
  );
}

function selectorContains(include, exclude) {
  if (include.kind === "exact") {
    return exclude.kind === "exact" && include.bytes.equals(exclude.bytes);
  }

  return pathStartsWith(exclude.bytes, include.bytes);
}

/** Test a native normalized exact or prefix selector against literal Git bytes. */
export function selectorMatches(selector, path) {
  return selector.kind === "exact"
    ? selector.bytes.equals(path)
    : pathStartsWith(path, selector.bytes);
}

/** Normalize literal preparation selectors and their canonical pre-routing digest. */
export function normalizeScopePayload(payload) {
  assertExactKeys(payload, SCOPE_KEYS, "Scope file", "INVALID_SCOPE_FILE");

  if (payload.schemaVersion !== 2) {
    fail("INVALID_SCOPE_FILE", "Scope file schemaVersion must be 2.");
  }

  for (const key of SCOPE_KEYS.slice(1)) {
    if (!Array.isArray(payload[key])) {
      fail("INVALID_SCOPE_FILE", `Scope file ${key} must be an array.`);
    }

    if (payload[key].length > 4096) {
      fail("INVALID_SCOPE_FILE", `Scope file ${key} exceeds 4096 selectors.`);
    }
  }

  const descriptors = [];

  function addUtf8(values, direction, kind, label) {
    for (const value of values) {
      descriptors.push({
        direction,
        kind,
        bytes: validateRepositoryRelativePath(value, {
          prefix: kind === "prefix",
          label,
        }),
      });
    }
  }

  addUtf8(payload.includePaths, "include", "exact", "includePaths entry");
  addUtf8(
    payload.includePathPrefixes,
    "include",
    "prefix",
    "includePathPrefixes entry",
  );
  addUtf8(payload.excludePaths, "exclude", "exact", "excludePaths entry");
  addUtf8(
    payload.excludePathPrefixes,
    "exclude",
    "prefix",
    "excludePathPrefixes entry",
  );

  for (const value of payload.includePathBytesBase64) {
    descriptors.push({
      direction: "include",
      kind: "exact",
      bytes: decodeCanonicalBase64Path(value, "includePathBytesBase64 entry"),
    });
  }

  for (const value of payload.excludePathBytesBase64) {
    descriptors.push({
      direction: "exclude",
      kind: "exact",
      bytes: decodeCanonicalBase64Path(value, "excludePathBytesBase64 entry"),
    });
  }

  const includes = descriptors.filter(
    ({ direction }) => direction === "include",
  );
  const excludes = descriptors.filter(
    ({ direction }) => direction === "exclude",
  );

  if (includes.length === 0) {
    fail("INVALID_SCOPE_SELECTOR", "Path scope requires inclusion data.");
  }

  const seen = new Set();

  for (const selector of descriptors) {
    const key = `${selector.direction}:${selector.kind}:${selector.bytes.toString("base64")}`;

    if (seen.has(key)) {
      fail("DUPLICATE_SCOPE_SELECTOR", "Scope selectors must be byte-unique.");
    }

    seen.add(key);
  }

  for (const exclusion of excludes) {
    if (!includes.some((inclusion) => selectorContains(inclusion, exclusion))) {
      fail(
        "UNCONTAINED_SCOPE_EXCLUSION",
        "Every exclusion must be contained by at least one inclusion.",
      );
    }
  }

  const canonicalPayload = {
    schemaVersion: 2,
    includePaths: [...payload.includePaths],
    includePathPrefixes: [...payload.includePathPrefixes],
    excludePaths: [...payload.excludePaths],
    excludePathPrefixes: [...payload.excludePathPrefixes],
    includePathBytesBase64: [...payload.includePathBytesBase64],
    excludePathBytesBase64: [...payload.excludePathBytesBase64],
  };

  return {
    canonicalPayload,
    canonicalBytes: canonicalJsonBytes(canonicalPayload),
    includes,
    excludes,
    descriptors,
  };
}

function normalizeEvidenceSelection(selection) {
  normalizeSelection(selection);

  if ("all" in selection && selection.all !== true) {
    fail("INVALID_EVIDENCE_PLAN", "Evidence selection all must be true.");
  }

  if ("remaining" in selection && selection.remaining !== true) {
    fail("INVALID_EVIDENCE_PLAN", "Evidence selection remaining must be true.");
  }

  for (const [key, value] of Object.entries(selection)) {
    if (new Set(["all", "remaining"]).has(key)) {
      continue;
    }

    if (value.length === 0) {
      fail(
        "INVALID_EVIDENCE_PLAN",
        `Evidence selection ${key} must be a non-empty string array.`,
      );
    }
  }

  return structuredClone(selection);
}

/** Validate preparation evidence policy/provenance without routing or side effects. */
export function normalizeEvidencePlan(payload) {
  assertExactKeys(
    payload,
    EVIDENCE_PLAN_KEYS,
    "Evidence plan",
    "INVALID_EVIDENCE_PLAN",
  );

  if (payload.schemaVersion !== 1) {
    fail("INVALID_EVIDENCE_PLAN", "Evidence plan schemaVersion must be 1.");
  }

  if (!Array.isArray(payload.groups) || payload.groups.length === 0) {
    fail("INVALID_EVIDENCE_PLAN", "Evidence plan groups must be non-empty.");
  }

  if (payload.groups.length > 4096) {
    fail("INVALID_EVIDENCE_PLAN", "Evidence plan exceeds 4096 groups.");
  }

  const groups = payload.groups.map((group, index) => {
    assertExactKeys(
      group,
      GROUP_KEYS,
      `Evidence group ${index + 1}`,
      "INVALID_EVIDENCE_PLAN",
    );
    assertExactKeys(
      group.basis,
      BASIS_KEYS,
      `Evidence group ${index + 1} basis`,
      "INVALID_EVIDENCE_PLAN",
    );

    return {
      selection: normalizeEvidenceSelection(group.selection),
      policy: group.policy,
      basis: validateEvidenceBasis(group.policy, group.basis),
    };
  });

  const canonicalPlan = { schemaVersion: 1, groups };

  return {
    plan: canonicalPlan,
    canonicalBytes: canonicalJsonBytes(canonicalPlan),
  };
}
