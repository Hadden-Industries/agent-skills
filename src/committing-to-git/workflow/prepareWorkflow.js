import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { TextDecoder } from "node:util";

import {
  activeGitOperations,
  repositoryRoot,
  runGit,
} from "../git/gitRepository.js";
import { splitNul } from "../git/gitPath.js";
import { createSnapshot } from "../snapshot/createSnapshot.js";
import {
  installPreparedIndex,
  recoverIndexInstallation,
} from "../transaction/indexInstallation.js";
import {
  MAXIMUM_BASIS_NOTE_BYTES,
  MAXIMUM_INITIAL_JSON_INPUT_BYTES,
  advanceTransaction,
  createTransactionWorkspace,
  getEvidencePlanInputPath,
  readTransaction,
  updateTransaction,
} from "../transaction/transactionWorkspace.js";

const STORAGE_OVERRIDE_NAMES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_QUARANTINE_PATH",
  "GIT_NAMESPACE",
];
const EVIDENCE_POLICIES = new Set(["reuse", "message", "review"]);
const BASIS_KINDS = new Set([
  "authored-current-task",
  "read-current-task",
  "task-lineage",
  "user-grounded",
  "generated-derived",
  "unknown-preexisting",
]);
const VERIFICATION_POLICIES = new Set(["required", "advisory", "skipped"]);
const TYPE_TOKEN_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;
const SINGLETON_FLAGS = new Set([
  "mode",
  "scope",
  "evidence",
  "basis",
  "evidence-plan",
  "scope-file",
  "verification",
  "format",
]);
const REPEATABLE_FLAGS = new Set([
  "allowed-type",
  "path",
  "path-prefix",
  "exclude-path",
  "exclude-path-prefix",
]);
const INLINE_SELECTOR_FLAGS = [
  "path",
  "path-prefix",
  "exclude-path",
  "exclude-path-prefix",
];
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
const SELECTION_KEYS = new Set([
  "all",
  "remaining",
  "ids",
  "destinationPaths",
  "sourcePaths",
  "destinationPathPrefixes",
  "sourcePathPrefixes",
  "kinds",
]);
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export class PreparationError extends Error {
  constructor(code, message, { exitCode = 2, details = {} } = {}) {
    super(message);
    this.name = "PreparationError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function fail(code, message, options) {
  throw new PreparationError(code, message, options);
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

function compareBuffers(left, right) {
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

function selectorMatches(selector, path) {
  return selector.kind === "exact"
    ? selector.bytes.equals(path)
    : pathStartsWith(path, selector.bytes);
}

function normalizeScopePayload(payload) {
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
  if (!isPlainObject(selection) || Object.keys(selection).length === 0) {
    fail(
      "INVALID_EVIDENCE_PLAN",
      "Evidence selection must be a non-empty object.",
    );
  }

  for (const key of Object.keys(selection)) {
    if (!SELECTION_KEYS.has(key)) {
      fail(
        "INVALID_EVIDENCE_PLAN",
        `Evidence selection contains unknown member ${JSON.stringify(key)}.`,
      );
    }
  }

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

    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.some((entry) => typeof entry !== "string" || entry.length === 0)
    ) {
      fail(
        "INVALID_EVIDENCE_PLAN",
        `Evidence selection ${key} must be a non-empty string array.`,
      );
    }
  }

  return structuredClone(selection);
}

function normalizeEvidencePlan(payload) {
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

    if (!EVIDENCE_POLICIES.has(group.policy)) {
      fail(
        "INVALID_EVIDENCE_PLAN",
        `Evidence group ${index + 1} policy is invalid.`,
      );
    }

    if (!BASIS_KINDS.has(group.basis.kind)) {
      fail(
        "INVALID_EVIDENCE_PLAN",
        `Evidence group ${index + 1} basis is invalid.`,
      );
    }

    if (
      group.basis.note !== null &&
      (typeof group.basis.note !== "string" ||
        Buffer.byteLength(group.basis.note, "utf8") > MAXIMUM_BASIS_NOTE_BYTES)
    ) {
      fail(
        "INVALID_EVIDENCE_PLAN",
        `Evidence group ${index + 1} basis note exceeds ${MAXIMUM_BASIS_NOTE_BYTES} UTF-8 bytes.`,
      );
    }

    if (
      group.policy === "reuse" &&
      new Set(["user-grounded", "unknown-preexisting"]).has(group.basis.kind)
    ) {
      fail(
        "INVALID_EVIDENCE_PLAN",
        "Reuse evidence requires authored, read, generated, or specific task-lineage basis.",
      );
    }

    return {
      selection: normalizeEvidenceSelection(group.selection),
      policy: group.policy,
      basis: { kind: group.basis.kind, note: group.basis.note },
    };
  });

  const canonicalPlan = { schemaVersion: 1, groups };

  return {
    plan: canonicalPlan,
    canonicalBytes: canonicalJsonBytes(canonicalPlan),
  };
}

function readBoundedJson(path, label) {
  const absolutePath = resolve(path);
  const initialPathStat = lstatSync(absolutePath);

  if (initialPathStat.isSymbolicLink() || !initialPathStat.isFile()) {
    fail("INVALID_JSON_INPUT", `${label} must be a non-symbolic regular file.`);
  }

  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW;
  const descriptor = openSync(absolutePath, fsConstants.O_RDONLY + noFollow);

  try {
    const before = fstatSync(descriptor);

    if (!before.isFile()) {
      fail("INVALID_JSON_INPUT", `${label} must be a regular file.`);
    }

    if (before.size > MAXIMUM_INITIAL_JSON_INPUT_BYTES) {
      fail(
        "JSON_INPUT_TOO_LARGE",
        `${label} exceeds ${MAXIMUM_INITIAL_JSON_INPUT_BYTES} bytes.`,
      );
    }

    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const finalPathStat = lstatSync(absolutePath);

    if (
      initialPathStat.dev !== before.dev ||
      initialPathStat.ino !== before.ino ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      finalPathStat.isSymbolicLink() ||
      !finalPathStat.isFile() ||
      after.dev !== finalPathStat.dev ||
      after.ino !== finalPathStat.ino ||
      after.size !== finalPathStat.size ||
      bytes.length > MAXIMUM_INITIAL_JSON_INPUT_BYTES
    ) {
      fail("JSON_INPUT_CHANGED", `${label} changed while it was read.`);
    }

    let text;

    try {
      text = STRICT_UTF8_DECODER.decode(bytes);
    } catch {
      fail("INVALID_JSON_UTF8", `${label} is not strict UTF-8.`);
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      fail(
        "INVALID_JSON_INPUT",
        `${label} is not valid JSON: ${error.message}`,
      );
    }
  } finally {
    closeSync(descriptor);
  }
}

function inlineScopePayload(values) {
  return {
    schemaVersion: 2,
    includePaths: values.get("path") ?? [],
    includePathPrefixes: values.get("path-prefix") ?? [],
    excludePaths: values.get("exclude-path") ?? [],
    excludePathPrefixes: values.get("exclude-path-prefix") ?? [],
    includePathBytesBase64: [],
    excludePathBytesBase64: [],
  };
}

export function parsePrepareArguments(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];

    if (typeof token !== "string" || !token.startsWith("--")) {
      fail("INVALID_ARGUMENT", `Unexpected argument ${JSON.stringify(token)}.`);
    }

    const name = token.slice(2);

    if (!SINGLETON_FLAGS.has(name) && !REPEATABLE_FLAGS.has(name)) {
      fail("UNKNOWN_ARGUMENT", `Unknown workflow prepare flag --${name}.`);
    }

    if (value === undefined || value.length === 0) {
      fail("INVALID_ARGUMENT", `--${name} requires a non-empty value.`);
    }

    if (SINGLETON_FLAGS.has(name)) {
      if (values.has(name)) {
        fail("DUPLICATE_ARGUMENT", `--${name} may be supplied only once.`);
      }

      values.set(name, value);
    } else {
      values.set(name, [...(values.get(name) ?? []), value]);
    }
  }

  const mode = values.get("mode");
  const scope = values.get("scope");
  const verificationPolicy = values.get("verification") ?? "required";
  const format = values.get("format") ?? "json";

  if (!new Set(["actual", "draft"]).has(mode)) {
    fail("INVALID_MODE", "--mode must be actual or draft.");
  }

  if (!new Set(["staged", "full", "paths"]).has(scope)) {
    fail("INVALID_SCOPE", "--scope must be staged, full, or paths.");
  }

  if (!VERIFICATION_POLICIES.has(verificationPolicy)) {
    fail(
      "INVALID_VERIFICATION_POLICY",
      "--verification must be required, advisory, or skipped.",
    );
  }

  if (!new Set(["json", "text"]).has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  const evidencePlanPath = values.get("evidence-plan") ?? null;
  const evidence = values.get("evidence") ?? null;
  const basis = values.get("basis") ?? null;

  if (evidencePlanPath !== null && (evidence !== null || basis !== null)) {
    fail(
      "CONFLICTING_EVIDENCE_INPUT",
      "--evidence-plan is an alternative to --evidence and --basis.",
    );
  }

  if (evidencePlanPath === null && (evidence === null || basis === null)) {
    fail(
      "MISSING_EVIDENCE_INPUT",
      "Supply --evidence and --basis together, or supply --evidence-plan.",
    );
  }

  if (evidence !== null && !EVIDENCE_POLICIES.has(evidence)) {
    fail(
      "INVALID_EVIDENCE_POLICY",
      "--evidence must be reuse, message, or review.",
    );
  }

  if (basis !== null && !BASIS_KINDS.has(basis)) {
    fail(
      "INVALID_EVIDENCE_BASIS",
      "--basis is not a supported provenance kind.",
    );
  }

  if (
    evidence === "reuse" &&
    new Set(["user-grounded", "unknown-preexisting"]).has(basis)
  ) {
    fail(
      "INVALID_EVIDENCE_BASIS",
      "Reuse evidence requires authored, read, generated, or specific task-lineage basis.",
    );
  }

  const allowedTypes = values.get("allowed-type") ?? [];

  if (allowedTypes.length > 64) {
    fail(
      "INVALID_ALLOWED_TYPE",
      "At most 64 allowed commit types may be supplied.",
    );
  }

  if (
    allowedTypes.some((type) => !TYPE_TOKEN_PATTERN.test(type)) ||
    new Set(allowedTypes).size !== allowedTypes.length
  ) {
    fail(
      "INVALID_ALLOWED_TYPE",
      "Allowed commit types must be unique lowercase tokens of at most 32 ASCII characters.",
    );
  }

  const hasInlineSelectors = INLINE_SELECTOR_FLAGS.some((name) =>
    values.has(name),
  );
  const scopeFilePath = values.get("scope-file") ?? null;

  if (scope !== "paths" && (hasInlineSelectors || scopeFilePath !== null)) {
    fail(
      "SELECTOR_OUTSIDE_PATH_SCOPE",
      "Path selectors and --scope-file are valid only with --scope paths.",
    );
  }

  if (scope === "paths" && hasInlineSelectors && scopeFilePath !== null) {
    fail(
      "CONFLICTING_SCOPE_INPUT",
      "Inline selectors and --scope-file cannot be combined.",
    );
  }

  if (
    scope === "paths" &&
    scopeFilePath === null &&
    !(values.has("path") || values.has("path-prefix"))
  ) {
    fail("MISSING_SCOPE_INCLUSION", "Path scope requires inclusion data.");
  }

  return {
    mode,
    scope,
    evidencePlanPath,
    evidence,
    basis,
    allowedTypes: allowedTypes.length === 0 ? null : allowedTypes,
    scopeFilePath,
    inlineScope:
      scope === "paths" && scopeFilePath === null
        ? inlineScopePayload(values)
        : null,
    verificationPolicy,
    format,
  };
}

export function assertNoGitStorageOverrides(environment) {
  for (const name of STORAGE_OVERRIDE_NAMES) {
    if (Object.prototype.hasOwnProperty.call(environment, name)) {
      fail(
        "UNSUPPORTED_GIT_STORAGE_OVERRIDE",
        `Inherited Git storage override ${name} is unsupported.`,
      );
    }
  }
}

function parseNameStatus(buffer, source) {
  const fields = splitNul(buffer);
  const records = [];

  for (let index = 0; index < fields.length;) {
    const status = fields[index].toString("ascii");
    const rename = status.startsWith("R") || status.startsWith("C");
    const firstPath = fields[index + 1];
    const secondPath = rename ? fields[index + 2] : null;

    if (
      !/^[A-Z][0-9]*$/u.test(status) ||
      !firstPath ||
      (rename && !secondPath)
    ) {
      fail(
        "GIT_OUTPUT_INVALID",
        `Git returned an invalid ${source} name-status record.`,
      );
    }

    records.push({
      source,
      status,
      paths: rename ? [firstPath, secondPath] : [firstPath],
      rename: rename ? [firstPath, secondPath] : null,
    });
    index += rename ? 3 : 2;
  }

  return records;
}

function bytesAfterSpaces(field, spaceCount, label) {
  let spaces = 0;

  for (let index = 0; index < field.length; index += 1) {
    if (field[index] !== 0x20) {
      continue;
    }

    spaces += 1;

    if (spaces === spaceCount) {
      const value = field.subarray(index + 1);

      if (value.length === 0) {
        fail("GIT_OUTPUT_INVALID", `${label} contains an empty path.`);
      }

      return value;
    }
  }

  fail("GIT_OUTPUT_INVALID", `${label} is missing required fields.`);
}

function parseStatusRenamePairs(buffer) {
  const fields = splitNul(buffer);
  const pairs = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];

    if (field[0] !== 0x32 || field[1] !== 0x20) {
      continue;
    }

    const destination = bytesAfterSpaces(
      field,
      9,
      "Git porcelain-v2 rename record",
    );
    const source = fields[index + 1];

    if (!source) {
      fail(
        "GIT_OUTPUT_INVALID",
        "Git porcelain-v2 rename record is missing its source path.",
      );
    }

    pairs.push([source, destination]);
    index += 1;
  }

  return pairs;
}

function parseIndexBlobOids(buffer) {
  const entries = new Map();

  for (const field of splitNul(buffer)) {
    const tab = field.indexOf(0x09);

    if (tab < 0) {
      fail(
        "GIT_OUTPUT_INVALID",
        "Git index entry is missing its path separator.",
      );
    }

    const metadata = field.subarray(0, tab).toString("ascii").split(" ");
    const [mode, oid, stage] = metadata;
    const path = field.subarray(tab + 1);

    if (
      !/^(?:100644|100755|120000|160000)$/u.test(mode) ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid) ||
      stage !== "0" ||
      path.length === 0
    ) {
      fail(
        "GIT_OUTPUT_INVALID",
        "Git returned an invalid stage-zero index entry.",
      );
    }

    entries.set(path.toString("base64"), oid);
  }

  return entries;
}

function exactUnstagedRenamePairs(root, unstaged, untracked, environment) {
  const deletedPaths = unstaged
    .filter(({ status }) => status === "D")
    .flatMap(({ paths }) => paths);

  if (deletedPaths.length === 0 || untracked.length === 0) {
    return [];
  }

  const indexBlobOids = parseIndexBlobOids(
    runGit(["ls-files", "--stage", "-z", "--"], {
      cwd: root,
      env: environment,
    }).stdout,
  );
  const deletedByOid = new Map();

  for (const path of deletedPaths) {
    const oid = indexBlobOids.get(path.toString("base64"));

    if (oid) {
      deletedByOid.set(oid, [...(deletedByOid.get(oid) ?? []), path]);
    }
  }

  const pairs = [];

  for (const record of untracked) {
    const path = record.paths[0];
    let text;

    try {
      text = STRICT_UTF8_DECODER.decode(path);
    } catch {
      continue;
    }

    if (!Buffer.from(text, "utf8").equals(path)) {
      continue;
    }

    const oid = runGit(["hash-object", "--no-filters", "--", text], {
      cwd: root,
      env: environment,
    })
      .stdout.toString("ascii")
      .trim();

    for (const source of deletedByOid.get(oid) ?? []) {
      pairs.push([source, path]);
    }
  }

  return pairs;
}

function discoverCandidates(root) {
  const readOnlyEnvironment = {
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
  };
  const staged = parseNameStatus(
    runGit(
      [
        "diff",
        "--cached",
        "--name-status",
        "-z",
        "--no-ext-diff",
        "--no-textconv",
        "--find-renames=50%",
        "--",
      ],
      { cwd: root, env: readOnlyEnvironment },
    ).stdout,
    "staged",
  );
  const unstaged = parseNameStatus(
    runGit(
      [
        "diff",
        "--name-status",
        "-z",
        "--no-ext-diff",
        "--no-textconv",
        "--find-renames=50%",
        "--",
      ],
      { cwd: root, env: readOnlyEnvironment },
    ).stdout,
    "unstaged",
  );
  const untracked = splitNul(
    runGit(["ls-files", "--others", "--exclude-standard", "-z", "--"], {
      cwd: root,
      env: readOnlyEnvironment,
    }).stdout,
  ).map((path) => ({
    source: "untracked",
    status: "A",
    paths: [path],
    rename: null,
  }));
  const records = [...staged, ...unstaged, ...untracked];
  const statusRenamePairs = parseStatusRenamePairs(
    runGit(
      ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--renames"],
      { cwd: root, env: readOnlyEnvironment },
    ).stdout,
  );
  const exactRenamePairs = exactUnstagedRenamePairs(
    root,
    unstaged,
    untracked,
    readOnlyEnvironment,
  );
  const pathsByBase64 = new Map();

  for (const record of records) {
    for (const path of record.paths) {
      pathsByBase64.set(path.toString("base64"), path);
    }
  }

  return {
    records,
    staged,
    paths: [...pathsByBase64.values()].sort(compareBuffers),
    renamePairs: [
      ...records.flatMap((record) =>
        record.rename === null ? [] : [record.rename],
      ),
      ...statusRenamePairs,
      ...exactRenamePairs,
    ],
  };
}

function containsUnsafeControl(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function safePathDisplay(bytes) {
  const digest = sha256(bytes);
  let text;

  try {
    text = STRICT_UTF8_DECODER.decode(bytes);
  } catch {
    text = null;
  }

  if (
    text !== null &&
    !containsUnsafeControl(text) &&
    Buffer.byteLength(text, "utf8") <= 192
  ) {
    return text;
  }

  const prefix = bytes.subarray(0, 48).toString("hex");
  const suffix = bytes.length > 48 ? bytes.subarray(-24).toString("hex") : "";

  return `path-bytes:${prefix}${suffix ? `...${suffix}` : ""};bytes=${bytes.length};sha256=${digest}`;
}

function validateSelectorsAgainstCandidates(scope, candidates) {
  for (const selector of scope.descriptors) {
    if (!candidates.paths.some((path) => selectorMatches(selector, path))) {
      fail(
        "UNMATCHED_SCOPE_SELECTOR",
        "A literal scope selector matched no current change.",
        {
          details: {
            selectorKind: `${selector.direction}-${selector.kind}`,
            candidateSamples: candidates.paths.slice(0, 5).map(safePathDisplay),
          },
        },
      );
    }
  }

  const selectedPaths = candidates.paths.filter(
    (path) =>
      scope.includes.some((selector) => selectorMatches(selector, path)) &&
      !scope.excludes.some((selector) => selectorMatches(selector, path)),
  );
  const selectedKeys = new Set(
    selectedPaths.map((path) => path.toString("base64")),
  );

  if (selectedPaths.length === 0) {
    fail(
      "EMPTY_SCOPE",
      "Scope exclusions remove every included current change.",
    );
  }

  for (const [source, destination] of candidates.renamePairs) {
    if (
      selectedKeys.has(source.toString("base64")) !==
      selectedKeys.has(destination.toString("base64"))
    ) {
      fail(
        "RENAME_SCOPE_BOUNDARY",
        "A rename crosses the selected scope boundary; select or exclude both endpoints.",
      );
    }
  }

  return selectedPaths;
}

function scopeSummary(kind, normalizedScope, selectedPaths) {
  if (kind !== "paths") {
    return {
      kind,
      selectorCount: 0,
      selectorKinds: {
        includeExact: 0,
        includePrefix: 0,
        excludeExact: 0,
        excludePrefix: 0,
      },
      canonicalSelectorSha256: sha256(Buffer.from(`${kind}\n`)),
      expandedPathCount: null,
      samples: [],
    };
  }

  const count = (direction, selectorKind) =>
    normalizedScope.descriptors.filter(
      ({ direction: candidateDirection, kind: candidateKind }) =>
        direction === candidateDirection && selectorKind === candidateKind,
    ).length;

  return {
    kind,
    selectorCount: normalizedScope.descriptors.length,
    selectorKinds: {
      includeExact: count("include", "exact"),
      includePrefix: count("include", "prefix"),
      excludeExact: count("exclude", "exact"),
      excludePrefix: count("exclude", "prefix"),
    },
    canonicalSelectorSha256: sha256(normalizedScope.canonicalBytes),
    expandedPathCount: selectedPaths.length,
    samples: selectedPaths.slice(0, 5).map(safePathDisplay),
  };
}

function writeOwnedInput(path, bytes) {
  const descriptor = openSync(
    path,
    fsConstants.O_WRONLY + fsConstants.O_CREAT + fsConstants.O_EXCL,
    0o600,
  );

  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }

  if (process.platform !== "win32") {
    const directoryDescriptor = openSync(dirname(path), fsConstants.O_RDONLY);

    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  }
}

function assertPreallocationRepositoryState(root) {
  const conflicts = runGit(["ls-files", "-u", "-z"], {
    cwd: root,
    env: { GIT_OPTIONAL_LOCKS: "0" },
  }).stdout;

  if (conflicts.length > 0) {
    fail(
      "UNRESOLVED_CONFLICTS",
      "Cannot prepare an ordinary commit while unresolved conflicts remain.",
      { exitCode: 1 },
    );
  }

  const operations = activeGitOperations(root);

  if (operations.length > 0) {
    fail(
      "ACTIVE_GIT_OPERATION",
      `Cannot prepare an ordinary commit during an active ${operations.join(", ")} operation.`,
      { exitCode: 1 },
    );
  }
}

function verifySnapshotScope(snapshot, scope, selectedPaths) {
  if (scope === null) {
    return;
  }

  const selected = new Set(
    selectedPaths.map((path) => path.toString("base64")),
  );
  const covered = new Set();

  for (const unit of snapshot.changeUnits) {
    const endpoints = [
      unit.sourcePathBytesBase64,
      unit.destinationPathBytesBase64,
    ].filter((value) => value !== null);

    if (endpoints.some((value) => !selected.has(value))) {
      fail(
        "SNAPSHOT_SCOPE_MISMATCH",
        "The prepared snapshot contains a change outside the literal selected scope.",
      );
    }

    endpoints.forEach((value) => covered.add(value));
  }

  if ([...selected].some((value) => !covered.has(value))) {
    fail(
      "SNAPSHOT_SCOPE_MISMATCH",
      "A selected current-change path is absent from the prepared snapshot.",
    );
  }
}

function successEnvelope(transaction, summary) {
  return {
    status: "prepared",
    phase: transaction.phase,
    terminalDisposition: transaction.terminalDisposition,
    transaction: resolve(transaction.attemptDirectory, "transaction.json"),
    route: transaction.route,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    mode: transaction.mode,
    scope: summary,
    initialEvidencePlanSha256: transaction.initialEvidencePlan.sha256,
    headAnchor: transaction.headAnchor,
    indexTreeOid: transaction.snapshot.indexTreeOid,
    changeUnitCount: transaction.snapshot.changeUnitCount,
  };
}

function interruptionError(error, transactionPath, summary) {
  let recovery = null;

  try {
    recovery = recoverIndexInstallation({
      root: readTransaction(transactionPath).repositoryRoot,
      transactionPath,
    });
  } catch {
    // A missing journal means installation did not durably start. The sealed
    // snapshot still permits exact transaction-local resume.
  }

  return new PreparationError(
    "INDEX_INSTALLATION_INTERRUPTED",
    `Prepared index installation did not finish: ${error.message}`,
    {
      exitCode: 1,
      details: {
        transaction: transactionPath,
        phase: "allocated",
        recoveryRequired: true,
        resumeAllowed: recovery?.resumeAllowed ?? true,
        recoveryStatus: recovery?.status ?? "not-started",
        scope: summary,
      },
    },
  );
}

function stopAllocatedPreparation(error, transactionPath, summary) {
  try {
    const current = readTransaction(transactionPath);
    const stopped = advanceTransaction(transactionPath, "allocated", {
      ...current,
      phase: "stopped",
      status: "stopped",
      terminalDisposition: "no-commit-stopped",
    });
    const stoppedError = new PreparationError(
      "PREPARATION_STOPPED",
      `Preparation stopped before index installation: ${error.message}`,
      {
        exitCode: 1,
        details: {
          transaction: transactionPath,
          phase: stopped.phase,
          terminalDisposition: stopped.terminalDisposition,
          recoveryRequired: false,
          scope: summary,
        },
      },
    );
    stoppedError.cause = error;
    return stoppedError;
  } catch (checkpointError) {
    const interrupted = new PreparationError(
      "PREPARATION_CHECKPOINT_INTERRUPTED",
      `Preparation checkpoint could not be completed: ${checkpointError.message}`,
      {
        exitCode: 1,
        details: {
          transaction: transactionPath,
          phase: "allocated",
          recoveryRequired: true,
          resumeAllowed: true,
          scope: summary,
        },
      },
    );
    interrupted.cause = checkpointError;
    return interrupted;
  }
}

export function prepareWorkflow({
  options,
  cwd = process.cwd(),
  environment = process.env,
  temporaryRoot,
  indexFailureInjector,
}) {
  const parsed =
    options ?? fail("INVALID_ARGUMENT", "Preparation options are required.");
  let normalizedScope = null;
  let normalizedEvidence;

  if (parsed.scope === "paths") {
    const payload = parsed.scopeFilePath
      ? readBoundedJson(resolve(cwd, parsed.scopeFilePath), "Scope file")
      : parsed.inlineScope;
    normalizedScope = normalizeScopePayload(payload);
  }

  if (parsed.evidencePlanPath) {
    normalizedEvidence = normalizeEvidencePlan(
      readBoundedJson(resolve(cwd, parsed.evidencePlanPath), "Evidence plan"),
    );
  } else {
    normalizedEvidence = normalizeEvidencePlan({
      schemaVersion: 1,
      groups: [
        {
          selection: { all: true },
          policy: parsed.evidence,
          basis: { kind: parsed.basis, note: null },
        },
      ],
    });
  }

  assertNoGitStorageOverrides(environment);
  const root = repositoryRoot(cwd);
  assertPreallocationRepositoryState(root);
  const candidates = discoverCandidates(root);
  let selectedPaths = [];

  if (parsed.scope === "staged") {
    if (candidates.staged.length === 0) {
      fail("EMPTY_SCOPE", "The staged scope is empty.");
    }
  } else if (parsed.scope === "full") {
    if (candidates.paths.length === 0) {
      fail("EMPTY_SCOPE", "The full workspace scope is empty.");
    }
  } else {
    selectedPaths = validateSelectorsAgainstCandidates(
      normalizedScope,
      candidates,
    );

    if (parsed.mode === "actual" && candidates.staged.length > 0) {
      fail(
        "PREEXISTING_STAGED_CHANGES",
        "Actual path scope requires an initially clean staged index.",
        {
          exitCode: 1,
          details: {
            stagedChangeUnitCount: candidates.staged.length,
            stagedSamples: candidates.staged
              .flatMap(({ paths }) => paths)
              .sort(compareBuffers)
              .slice(0, 5)
              .map(safePathDisplay),
          },
        },
      );
    }

    if (parsed.mode === "draft" && candidates.staged.length > 0) {
      const stagedKeys = new Set(
        candidates.staged
          .flatMap(({ paths }) => paths)
          .map((path) => path.toString("base64")),
      );
      const overlap = selectedPaths.filter((path) =>
        stagedKeys.has(path.toString("base64")),
      );

      if (overlap.length > 0) {
        fail(
          "DRAFT_SCOPE_OVERLAPS_STAGED_STATE",
          "Draft path scope overlaps existing staged work.",
          {
            exitCode: 1,
            details: {
              overlapSamples: overlap.slice(0, 5).map(safePathDisplay),
            },
          },
        );
      }
    }
  }

  const summary = scopeSummary(parsed.scope, normalizedScope, selectedPaths);
  const workspace = createTransactionWorkspace({
    repositoryRoot: root,
    ...(temporaryRoot ? { temporaryRoot } : {}),
  });
  const evidenceSha256 = sha256(normalizedEvidence.canonicalBytes);

  if (parsed.evidencePlanPath) {
    writeOwnedInput(
      getEvidencePlanInputPath(workspace.transactionPath),
      normalizedEvidence.canonicalBytes,
    );
  }

  const initialScope = {
    schemaVersion: 1,
    kind: parsed.scope,
    selectors: normalizedScope?.canonicalPayload ?? null,
    selectorDigest: summary.canonicalSelectorSha256,
    expandedPathBytesBase64:
      parsed.scope === "paths"
        ? selectedPaths.map((path) => path.toString("base64"))
        : [],
    summary,
  };
  const allocated = updateTransaction(workspace.transactionPath, "allocated", {
    ...workspace.transaction,
    mode: parsed.mode,
    scope: initialScope,
    repositoryTypePolicy: { allowedTypes: parsed.allowedTypes },
    initialEvidencePlan: {
      source: parsed.evidencePlanPath ? "file" : "uniform",
      sha256: evidenceSha256,
      groups: normalizedEvidence.plan.groups,
    },
    verificationPolicy: parsed.verificationPolicy,
  });
  const snapshotPath = resolve(workspace.attemptDirectory, "snapshot.json");
  let snapshotResult;
  let prepared;

  try {
    snapshotResult = createSnapshot({
      root,
      mode: parsed.mode,
      scope: parsed.scope,
      scopePaths: selectedPaths,
      outputPath: snapshotPath,
      preparedIndexPath:
        parsed.scope === "staged"
          ? null
          : resolve(
              workspace.attemptDirectory,
              parsed.mode === "draft" ? "temporary-index" : "preparation-index",
            ),
      deferIndexInstallation:
        parsed.mode === "actual" && parsed.scope !== "staged",
    });

    verifySnapshotScope(
      snapshotResult.snapshot,
      normalizedScope,
      selectedPaths,
    );

    const snapshotBytes = readFileSync(snapshotPath);
    prepared = updateTransaction(workspace.transactionPath, "allocated", {
      ...allocated,
      headAnchor: snapshotResult.headAnchor,
      snapshot: {
        path: snapshotPath,
        sha256: sha256(snapshotBytes),
        indexTreeOid: snapshotResult.snapshot.indexTreeOid,
        changeUnitCount: snapshotResult.snapshot.changeUnitCount,
        preparedIndexPath: snapshotResult.preparedIndexPath,
        originalIndexIdentity: snapshotResult.originalIndexIdentity,
        preparedIndexIdentity: snapshotResult.preparedIndexIdentity,
        indexInstallationRequired: snapshotResult.indexInstallationRequired,
      },
    });
  } catch (error) {
    throw stopAllocatedPreparation(error, workspace.transactionPath, summary);
  }

  if (snapshotResult.indexInstallationRequired) {
    try {
      const installation = installPreparedIndex({
        root,
        transactionPath: workspace.transactionPath,
        originalIndexIdentity: snapshotResult.originalIndexIdentity,
        preparedIndexPath: snapshotResult.preparedIndexPath,
        preparedIndexIdentity: snapshotResult.preparedIndexIdentity,
        ...(indexFailureInjector
          ? { failureInjector: indexFailureInjector }
          : {}),
      });

      if (
        installation.status !== "installed" ||
        installation.preparedIndexTreeOid !==
          snapshotResult.snapshot.indexTreeOid ||
        JSON.stringify(installation.headAnchor) !==
          JSON.stringify(snapshotResult.headAnchor)
      ) {
        throw new Error(
          "Prepared index installation did not preserve the snapshot anchors.",
        );
      }
    } catch (error) {
      throw interruptionError(error, workspace.transactionPath, summary);
    }
  }

  let completed;

  try {
    completed = advanceTransaction(workspace.transactionPath, "allocated", {
      ...prepared,
      phase: "snapshot-created",
    });
  } catch (error) {
    throw interruptionError(error, workspace.transactionPath, summary);
  }

  return successEnvelope(completed, summary);
}

function errorEnvelope(error) {
  return {
    status: error.exitCode === 1 ? "stopped" : "invalid",
    phase: error.details.phase ?? null,
    terminalDisposition: error.details.terminalDisposition ?? null,
    transaction: error.details.transaction ?? null,
    route: null,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: error.details.recoveryRequired ?? false,
    code: error.code,
    message: error.message,
    ...Object.fromEntries(
      Object.entries(error.details).filter(
        ([key]) =>
          !new Set([
            "phase",
            "terminalDisposition",
            "transaction",
            "recoveryRequired",
          ]).has(key),
      ),
    ),
  };
}

function textResult(result) {
  const lines = [`Status: ${result.status}`];

  if (result.code) {
    lines.push(`Code: ${result.code}`, `Message: ${result.message}`);
  }

  if (result.transaction) {
    lines.push(`Transaction: ${result.transaction}`);
  }

  if (result.indexTreeOid) {
    lines.push(`Index tree: ${result.indexTreeOid}`);
  }

  return `${lines.join("\n")}\n`;
}

export function runPrepareWorkflowCommand(
  argv,
  {
    cwd = process.cwd(),
    environment = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  let format = "json";

  try {
    const options = parsePrepareArguments(argv);
    format = options.format;
    const result = prepareWorkflow({ options, cwd, environment });
    stdout.write(
      format === "text" ? textResult(result) : `${JSON.stringify(result)}\n`,
    );
    return 0;
  } catch (caught) {
    const error =
      caught instanceof PreparationError
        ? caught
        : new PreparationError("PREPARATION_FAILED", caught.message);
    const result = errorEnvelope(error);

    stderr.write(`${error.code}: ${error.message}\n`);
    stdout.write(
      format === "text" ? textResult(result) : `${JSON.stringify(result)}\n`,
    );
    return error.exitCode;
  }
}
