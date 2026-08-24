import { randomBytes as systemRandomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  resolve,
  sep,
  win32,
} from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export const EVALUATION_HOME_ROLES = Object.freeze(["preflight", "execution"]);

const MANAGER_ID = "openai-codex-evaluation-homes";
const SCHEMA_VERSION = 1;
const ROOT_MARKER_NAME = ".evaluation-homes-root.json";
const HOME_MARKER_NAME = ".evaluation-home-owner.json";
const LEASES_NAME = ".leases";
const QUARANTINE_NAME = ".quarantine";
const HISTORY_NAME = ".history";
const TOKEN_PATTERN = /^[0-9a-f]{32}$/u;
const TEST_DEPENDENCY_KEYS = Object.freeze([
  "clock",
  "failAfterPhase",
  "pathMetadata",
  "randomBytes",
]);
const ROOT_MARKER_KEYS = Object.freeze([
  "createdAt",
  "creationId",
  "manager",
  "normalizedRoot",
  "resolvedRoot",
  "roles",
  "rootNonce",
  "schemaVersion",
]);
const HOME_MARKER_KEYS = Object.freeze([
  "createdAt",
  "generationNonce",
  "manager",
  "role",
  "rootNonce",
  "schemaVersion",
  "stablePath",
]);
const PATH_METADATA_KEYS = Object.freeze([
  "attributes",
  "drive",
  "exists",
  "fullPath",
  "isContainer",
  "schemaVersion",
]);
const DRIVE_METADATA_KEYS = Object.freeze(["driveType", "root"]);
const WINDOWS_PROBE_PATH = fileURLToPath(
  new URL("./windows-path-probe.ps1", import.meta.url),
);

function fail(code, message, details = undefined) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  throw error;
}

function samePath(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  if (process.platform === "win32" || /^[A-Za-z]:[\\/]/u.test(left)) {
    return (
      win32.normalize(left).toLowerCase() ===
      win32.normalize(right).toLowerCase()
    );
  }

  return resolve(left) === resolve(right);
}

function normalizedExplicitRoot(root) {
  if (typeof root !== "string" || root.length === 0) {
    fail("invalid-root", "root must be a non-empty absolute path");
  }
  if (/^(?:\\\\|\/\/)/u.test(root)) {
    fail("unsupported-UNC-root", "UNC roots are not supported");
  }
  if (/^[A-Za-z]:(?:[^\\/]|$)/u.test(root)) {
    fail("drive-relative-root", "drive-relative roots are not supported");
  }
  if (!isAbsolute(root)) {
    fail("invalid-root", "root must be absolute");
  }

  const normalized = resolve(root);
  if (root !== normalized) {
    fail("non-normalized-root", "root must already be normalized");
  }

  return normalized;
}

export function evaluationHomesRootFromLocalAppData(localAppData) {
  if (typeof localAppData !== "string" || localAppData.length === 0) {
    fail(
      "invalid-LOCALAPPDATA",
      "LOCALAPPDATA must be a non-empty absolute path",
    );
  }
  if (/^(?:\\\\|\/\/)/u.test(localAppData)) {
    fail("unsupported-UNC-root", "LOCALAPPDATA cannot be a UNC path");
  }
  if (/^[A-Za-z]:(?:[^\\/]|$)/u.test(localAppData)) {
    fail("drive-relative-root", "LOCALAPPDATA must be absolute");
  }
  if (!win32.isAbsolute(localAppData)) {
    fail("invalid-LOCALAPPDATA", "LOCALAPPDATA must be absolute");
  }

  return win32.resolve(
    localAppData,
    "OpenAI",
    "Codex",
    "EvaluationHomes",
    "v1",
  );
}

function productionRoot() {
  if (!process.env.LOCALAPPDATA || process.platform !== "win32") {
    return null;
  }

  return evaluationHomesRootFromLocalAppData(process.env.LOCALAPPDATA);
}

function validateTestDependencies(root, testDependencies) {
  if (testDependencies === undefined) {
    if (process.platform !== "win32") {
      fail(
        "unsupported-platform",
        "the production evaluation-home backend is Windows-only",
      );
    }
    return {
      clock: () => new Date().toISOString(),
      failAfterPhase: null,
      pathMetadata: windowsPathMetadata,
      randomBytes: systemRandomBytes,
    };
  }

  const acceptedProductionRoot = productionRoot();
  if (acceptedProductionRoot && samePath(root, acceptedProductionRoot)) {
    fail(
      "production-root-test-dependencies",
      "the production root rejects testDependencies",
    );
  }
  if (
    testDependencies === null ||
    typeof testDependencies !== "object" ||
    Array.isArray(testDependencies)
  ) {
    fail(
      "invalid-testDependencies",
      "testDependencies must be a closed object",
    );
  }

  const keys = Object.keys(testDependencies).sort();
  if (!arraysEqual(keys, TEST_DEPENDENCY_KEYS)) {
    fail(
      "invalid-testDependencies",
      `testDependencies must contain exactly ${TEST_DEPENDENCY_KEYS.join(", ")}`,
    );
  }
  if (
    typeof testDependencies.clock !== "function" ||
    typeof testDependencies.randomBytes !== "function" ||
    typeof testDependencies.pathMetadata !== "function" ||
    (testDependencies.failAfterPhase !== null &&
      typeof testDependencies.failAfterPhase !== "function")
  ) {
    fail(
      "invalid-testDependencies",
      "testDependencies contains an invalid dependency port",
    );
  }

  return testDependencies;
}

function arraysEqual(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function objectHasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    arraysEqual(Object.keys(value).sort(), keys)
  );
}

function assertTimestamp(value, field) {
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail("invalid-clock", `${field} must be a UTC RFC 3339 timestamp`);
  }
}

function now(dependencies) {
  const value = dependencies.clock();
  assertTimestamp(value, "clock result");
  return value;
}

function token(dependencies) {
  const bytes = dependencies.randomBytes(16);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 16) {
    fail("invalid-random-source", "randomBytes(16) must return 16 bytes");
  }
  return Buffer.from(bytes).toString("hex");
}

function rootPaths(root) {
  return {
    root,
    rootMarker: join(root, ROOT_MARKER_NAME),
    leases: join(root, LEASES_NAME),
    quarantine: join(root, QUARANTINE_NAME),
    history: join(root, HISTORY_NAME),
    preflight: join(root, "preflight"),
    execution: join(root, "execution"),
  };
}

function pathAncestors(target) {
  const absolute = resolve(target);
  const volumeRoot = parse(absolute).root;
  const relative = absolute.slice(volumeRoot.length);
  const components = relative.split(sep).filter(Boolean);
  const ancestors = [volumeRoot];
  let cursor = volumeRoot;

  for (const component of components) {
    cursor = join(cursor, component);
    ancestors.push(cursor);
  }

  return ancestors;
}

async function optionalLstat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function assertProbeShape(metadata, target) {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    !arraysEqual(Object.keys(metadata).sort(), PATH_METADATA_KEYS) ||
    metadata.schemaVersion !== SCHEMA_VERSION ||
    typeof metadata.exists !== "boolean" ||
    typeof metadata.fullPath !== "string" ||
    typeof metadata.isContainer !== "boolean" ||
    !Array.isArray(metadata.attributes) ||
    metadata.attributes.some((value) => typeof value !== "string") ||
    metadata.drive === null ||
    typeof metadata.drive !== "object" ||
    Array.isArray(metadata.drive) ||
    !arraysEqual(Object.keys(metadata.drive).sort(), DRIVE_METADATA_KEYS) ||
    typeof metadata.drive.root !== "string" ||
    typeof metadata.drive.driveType !== "string"
  ) {
    fail("invalid-path-metadata", `metadata for ${target} is malformed`);
  }
  const sortedAttributes = [...metadata.attributes].sort();
  if (!arraysEqual(metadata.attributes, sortedAttributes)) {
    fail("invalid-path-metadata", `attributes for ${target} are not sorted`);
  }
  if (
    !metadata.exists &&
    (metadata.isContainer || metadata.attributes.length > 0)
  ) {
    fail(
      "invalid-path-metadata",
      `missing-path metadata for ${target} claims existing attributes`,
    );
  }
}

async function probeExistingChain(target, dependencies) {
  let expectedVolume = null;
  let last = null;
  const ancestors = pathAncestors(target);

  for (const [index, ancestor] of ancestors.entries()) {
    const nodeMetadata = await optionalLstat(ancestor);
    const metadata = await dependencies.pathMetadata(ancestor);
    assertProbeShape(metadata, ancestor);

    if (metadata.exists !== (nodeMetadata !== null)) {
      fail(
        "path-identity-mismatch",
        `Node and platform metadata disagree about ${ancestor}`,
      );
    }
    if (
      nodeMetadata !== null &&
      metadata.isContainer !== nodeMetadata.isDirectory()
    ) {
      fail(
        "path-identity-mismatch",
        `Node and platform metadata disagree about the type of ${ancestor}`,
      );
    }
    if (!samePath(metadata.fullPath, ancestor)) {
      fail(
        "resolved-identity-mismatch",
        `platform metadata returned a different resolved identity for ${ancestor}`,
      );
    }
    if (metadata.drive.driveType !== "Fixed") {
      fail("unsupported-drive", `${ancestor} is not on a fixed drive`);
    }

    const volume =
      process.platform === "win32"
        ? win32.normalize(metadata.drive.root).toLowerCase()
        : resolve(metadata.drive.root);
    if (expectedVolume === null) {
      expectedVolume = volume;
    } else if (expectedVolume !== volume) {
      fail("cross-volume-path", `${ancestor} changed volume identity`);
    }
    if (
      nodeMetadata?.isSymbolicLink() ||
      metadata.attributes.includes("ReparsePoint")
    ) {
      fail("reparse-point", `${ancestor} is a reparse point`);
    }
    if (
      nodeMetadata !== null &&
      index < ancestors.length - 1 &&
      (!nodeMetadata.isDirectory() || !metadata.isContainer)
    ) {
      fail("not-a-directory", `${ancestor} is not a directory`);
    }

    last = { metadata, nodeMetadata, volume };
  }

  return last;
}

async function windowsPathMetadata(target) {
  const arguments_ = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    WINDOWS_PROBE_PATH,
    "-LiteralPath",
    target,
  ];

  return new Promise((resolvePromise, reject) => {
    const child = spawn("powershell.exe", arguments_, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    const maximumOutput = 1024 * 1024;

    child.stdout.on("data", (chunk) => {
      stdoutLength += chunk.byteLength;
      if (stdoutLength <= maximumOutput) {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrLength += chunk.byteLength;
      if (stderrLength <= maximumOutput) {
        stderr.push(chunk);
      }
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (stdoutLength > maximumOutput || stderrLength > maximumOutput) {
        reject(new Error("Windows path probe exceeded its output limit"));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `Windows path probe exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`,
          ),
        );
        return;
      }

      try {
        resolvePromise(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch (error) {
        reject(
          new Error("Windows path probe returned invalid JSON", {
            cause: error,
          }),
        );
      }
    });
  });
}

async function writeExclusiveJson(target, value) {
  const handle = await open(target, "wx", 0o600);

  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readJson(target) {
  try {
    const source = await readFile(target, "utf8");
    return { exists: true, value: JSON.parse(source) };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, value: null };
    }
    if (error instanceof SyntaxError) {
      return { exists: true, malformed: true, value: null };
    }
    throw error;
  }
}

function rootMarkerProblems(marker, root, resolvedRoot) {
  const problems = [];
  const add = (code) =>
    problems.push({ code, path: join(root, ROOT_MARKER_NAME) });

  if (!objectHasExactKeys(marker, ROOT_MARKER_KEYS)) {
    add("root-marker-schema-mismatch");
    return problems;
  }
  if (marker.schemaVersion !== SCHEMA_VERSION) {
    add("root-marker-schema-mismatch");
  }
  if (marker.manager !== MANAGER_ID) {
    add("root-marker-manager-mismatch");
  }
  if (!samePath(marker.normalizedRoot, root)) {
    add("root-marker-path-mismatch");
  }
  if (!samePath(marker.resolvedRoot, resolvedRoot)) {
    add("root-marker-resolved-path-mismatch");
  }
  if (!arraysEqual(marker.roles, EVALUATION_HOME_ROLES)) {
    add("root-marker-roles-mismatch");
  }
  if (
    typeof marker.creationId !== "string" ||
    !TOKEN_PATTERN.test(marker.creationId)
  ) {
    add("root-marker-creation-id-mismatch");
  }
  if (
    typeof marker.rootNonce !== "string" ||
    !TOKEN_PATTERN.test(marker.rootNonce)
  ) {
    add("root-marker-root-nonce-mismatch");
  }
  try {
    assertTimestamp(marker.createdAt, "root marker createdAt");
  } catch {
    add("root-marker-created-at-mismatch");
  }

  return problems;
}

function homeMarkerProblems(marker, rootMarker, role, stablePath) {
  const problems = [];
  const markerPath = join(stablePath, HOME_MARKER_NAME);
  const add = (code) => problems.push({ code, path: markerPath, role });

  if (!objectHasExactKeys(marker, HOME_MARKER_KEYS)) {
    add("home-marker-schema-mismatch");
    return problems;
  }
  if (marker.schemaVersion !== SCHEMA_VERSION) {
    add("home-marker-schema-mismatch");
  }
  if (marker.manager !== MANAGER_ID) {
    add("home-marker-manager-mismatch");
  }
  if (marker.rootNonce !== rootMarker?.rootNonce) {
    add("home-marker-root-nonce-mismatch");
  }
  if (marker.role !== role) {
    add("home-marker-role-mismatch");
  }
  if (!samePath(marker.stablePath, stablePath)) {
    add("home-marker-path-mismatch");
  }
  if (
    typeof marker.generationNonce !== "string" ||
    !TOKEN_PATTERN.test(marker.generationNonce)
  ) {
    add("home-marker-generation-nonce-mismatch");
  }
  try {
    assertTimestamp(marker.createdAt, "home marker createdAt");
  } catch {
    add("home-marker-created-at-mismatch");
  }

  return problems;
}

async function listDirectChildren(target, dependencies, root) {
  const children = [];
  const directory = await opendir(target);

  try {
    for await (const entry of directory) {
      const path = join(target, entry.name);
      if (!samePath(resolve(path), path) || !isContained(root, path)) {
        fail("path-containment-failed", `${path} escaped the managed root`);
      }
      const probed = await probeExistingChain(path, dependencies);
      children.push({
        name: entry.name,
        path,
        isContainer: probed.metadata.isContainer,
        attributes: [...probed.metadata.attributes],
      });
    }
  } finally {
    await directory.close().catch(() => {});
  }

  return children.sort((left, right) => left.name.localeCompare(right.name));
}

function isContained(root, candidate) {
  const relative =
    process.platform === "win32"
      ? win32.relative(root, candidate)
      : resolve(candidate).slice(resolve(root).length);
  if (process.platform === "win32") {
    return (
      relative === "" ||
      (!relative.startsWith("..") && !win32.isAbsolute(relative))
    );
  }

  return (
    samePath(root, candidate) ||
    resolve(candidate).startsWith(`${resolve(root)}${sep}`)
  );
}

async function inspectInternalDirectory(
  target,
  root,
  dependencies,
  missingCode,
) {
  const stats = await optionalLstat(target);
  if (stats === null) {
    return { entries: [], problem: { code: missingCode, path: target } };
  }

  await probeExistingChain(target, dependencies);
  return {
    entries: await listDirectChildren(target, dependencies, root),
    problem: null,
  };
}

export async function inspectEvaluationHomes({ root, testDependencies }) {
  const normalizedRoot = normalizedExplicitRoot(root);
  const dependencies = validateTestDependencies(
    normalizedRoot,
    testDependencies,
  );
  const paths = rootPaths(normalizedRoot);
  const rootProbe = await probeExistingChain(normalizedRoot, dependencies);
  const problems = [];
  const roles = [];
  let marker = null;

  if (rootProbe.nodeMetadata === null) {
    return {
      schemaVersion: SCHEMA_VERSION,
      manager: MANAGER_ID,
      root: {
        path: normalizedRoot,
        exists: false,
        resolvedPath: null,
        marker: null,
      },
      roles: EVALUATION_HOME_ROLES.toSorted().map((role) => ({
        role,
        path: paths[role],
        exists: false,
        valid: false,
        marker: null,
      })),
      liveLeases: [],
      quarantines: [],
      completedHistory: [],
      containment: { valid: true },
      volume: {
        root: rootProbe.metadata.drive.root,
        driveType: rootProbe.metadata.drive.driveType,
      },
      reparsePoints: [],
      problems: [{ code: "root-missing", path: normalizedRoot }],
      valid: false,
    };
  }

  const resolvedRoot = await realpath(normalizedRoot);
  if (!samePath(resolvedRoot, normalizedRoot)) {
    fail(
      "resolved-identity-mismatch",
      "the root resolved identity differs from its normalized path",
    );
  }
  const rootMarkerProbe = await probeExistingChain(
    paths.rootMarker,
    dependencies,
  );
  const rootMarkerRecord = rootMarkerProbe.nodeMetadata?.isFile()
    ? await readJson(paths.rootMarker)
    : {
        exists: rootMarkerProbe.nodeMetadata !== null,
        malformed: true,
        value: null,
      };
  if (!rootMarkerRecord.exists) {
    problems.push({ code: "root-marker-missing", path: paths.rootMarker });
  } else if (rootMarkerRecord.malformed) {
    problems.push({
      code: "root-marker-schema-mismatch",
      path: paths.rootMarker,
    });
  } else {
    marker = rootMarkerRecord.value;
    problems.push(...rootMarkerProblems(marker, normalizedRoot, resolvedRoot));
  }

  for (const role of EVALUATION_HOME_ROLES.toSorted()) {
    const stablePath = paths[role];
    const stats = await optionalLstat(stablePath);
    let homeMarker = null;
    const roleProblems = [];

    if (stats === null) {
      roleProblems.push({ code: "home-missing", path: stablePath, role });
    } else {
      await probeExistingChain(stablePath, dependencies);
      const markerPath = join(stablePath, HOME_MARKER_NAME);
      const markerProbe = await probeExistingChain(markerPath, dependencies);
      const markerRecord = markerProbe.nodeMetadata?.isFile()
        ? await readJson(markerPath)
        : {
            exists: markerProbe.nodeMetadata !== null,
            malformed: true,
            value: null,
          };
      if (!markerRecord.exists) {
        roleProblems.push({
          code: "home-marker-missing",
          path: join(stablePath, HOME_MARKER_NAME),
          role,
        });
      } else if (markerRecord.malformed) {
        roleProblems.push({
          code: "home-marker-schema-mismatch",
          path: join(stablePath, HOME_MARKER_NAME),
          role,
        });
      } else {
        homeMarker = markerRecord.value;
        roleProblems.push(
          ...homeMarkerProblems(homeMarker, marker, role, stablePath),
        );
      }
    }

    problems.push(...roleProblems);
    roles.push({
      role,
      path: stablePath,
      exists: stats !== null,
      valid: roleProblems.length === 0,
      marker: homeMarker,
    });
  }

  const leases = await inspectInternalDirectory(
    paths.leases,
    normalizedRoot,
    dependencies,
    "leases-directory-missing",
  );
  const quarantine = await inspectInternalDirectory(
    paths.quarantine,
    normalizedRoot,
    dependencies,
    "quarantine-directory-missing",
  );
  const history = await inspectInternalDirectory(
    paths.history,
    normalizedRoot,
    dependencies,
    "history-directory-missing",
  );
  for (const internal of [leases, quarantine, history]) {
    if (internal.problem) {
      problems.push(internal.problem);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    manager: MANAGER_ID,
    root: {
      path: normalizedRoot,
      exists: true,
      resolvedPath: resolvedRoot,
      marker,
    },
    roles,
    liveLeases: leases.entries,
    quarantines: quarantine.entries,
    completedHistory: history.entries,
    containment: { valid: true },
    volume: {
      root: rootProbe.metadata.drive.root,
      driveType: rootProbe.metadata.drive.driveType,
    },
    reparsePoints: [],
    problems,
    valid: problems.length === 0,
  };
}

async function createMarkedHome(
  target,
  finalPath,
  role,
  rootNonce,
  dependencies,
) {
  await mkdir(target);
  const marker = {
    schemaVersion: SCHEMA_VERSION,
    manager: MANAGER_ID,
    rootNonce,
    role,
    stablePath: finalPath,
    generationNonce: token(dependencies),
    createdAt: now(dependencies),
  };
  await writeExclusiveJson(join(target, HOME_MARKER_NAME), marker);
  return marker;
}

async function removeOwnedInitializationDirectory(target) {
  const stats = await optionalLstat(target);
  if (stats === null) {
    return;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    await unlink(target);
    return;
  }

  const directory = await opendir(target);
  try {
    for await (const entry of directory) {
      await removeOwnedInitializationDirectory(join(target, entry.name));
    }
  } finally {
    await directory.close().catch(() => {});
  }
  await rmdir(target);
}

export async function initializeEvaluationHomes({ root, testDependencies }) {
  const normalizedRoot = normalizedExplicitRoot(root);
  const dependencies = validateTestDependencies(
    normalizedRoot,
    testDependencies,
  );
  const existing = await optionalLstat(normalizedRoot);

  if (existing !== null) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      fail(
        "not-a-directory",
        "the requested root is not an ordinary directory",
      );
    }
    const inventory = await inspectEvaluationHomes({ root, testDependencies });
    if (inventory.valid) {
      return inventory;
    }
    if (inventory.problems.some(({ code }) => code === "root-marker-missing")) {
      fail(
        "unmarked-existing-root",
        "refusing to adopt an unmarked existing root",
      );
    }
    fail(
      "invalid-existing-root",
      "refusing to repair an ambiguous existing layout",
      inventory.problems,
    );
  }

  const parent = dirname(normalizedRoot);
  const parentProbe = await probeExistingChain(parent, dependencies);
  if (parentProbe.nodeMetadata === null) {
    fail("root-parent-missing", "the root parent must already exist");
  }

  const creationId = token(dependencies);
  const rootNonce = token(dependencies);
  const staging = join(
    parent,
    `.${parse(normalizedRoot).base}.initializing-${creationId}`,
  );
  const stagingStats = await optionalLstat(staging);
  if (stagingStats !== null) {
    fail(
      "initialization-collision",
      "the exclusive initialization path exists",
    );
  }

  await mkdir(staging);
  try {
    await mkdir(join(staging, LEASES_NAME));
    await mkdir(join(staging, QUARANTINE_NAME));
    await mkdir(join(staging, HISTORY_NAME));
    await createMarkedHome(
      join(staging, "preflight"),
      join(normalizedRoot, "preflight"),
      "preflight",
      rootNonce,
      dependencies,
    );
    await createMarkedHome(
      join(staging, "execution"),
      join(normalizedRoot, "execution"),
      "execution",
      rootNonce,
      dependencies,
    );
    await writeExclusiveJson(join(staging, ROOT_MARKER_NAME), {
      schemaVersion: SCHEMA_VERSION,
      manager: MANAGER_ID,
      normalizedRoot,
      resolvedRoot: normalizedRoot,
      roles: [...EVALUATION_HOME_ROLES],
      creationId,
      rootNonce,
      createdAt: now(dependencies),
    });

    const rootProbe = await probeExistingChain(normalizedRoot, dependencies);
    if (rootProbe.nodeMetadata !== null) {
      fail(
        "root-created-concurrently",
        "the root appeared during initialization",
      );
    }
    await rename(staging, normalizedRoot);
  } catch (error) {
    await removeOwnedInitializationDirectory(staging).catch(() => {});
    throw error;
  }

  return inspectEvaluationHomes({ root: normalizedRoot, testDependencies });
}

function assertRole(role) {
  if (!EVALUATION_HOME_ROLES.includes(role)) {
    fail("invalid-role", "role must be preflight or execution");
  }
}

function assertOperationId(operationId) {
  if (typeof operationId !== "string" || !TOKEN_PATTERN.test(operationId)) {
    fail(
      "invalid-operationId",
      "operationId must be 32 lowercase hexadecimal characters",
    );
  }
}

function safeSerializableError(error) {
  const name =
    typeof error?.name === "string" && error.name.length > 0
      ? error.name.slice(0, 100)
      : "Error";
  const rawMessage =
    typeof error?.message === "string" && error.message.length > 0
      ? error.message.slice(0, 1000)
      : "Evaluation-home operation failed";
  const message =
    /(?:authorization|bearer|credential|password|secret|token)=?\s*\S+/iu.test(
      rawMessage,
    )
      ? "[redacted sensitive error]"
      : rawMessage;

  return { name, message };
}

function containsOnlyUnicodeScalarValues(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }

  return true;
}

function isIJson(value, seen = new Set()) {
  if (value === null || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "string") {
    return containsOnlyUnicodeScalarValues(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object" || seen.has(value)) {
    return false;
  }

  seen.add(value);
  if (Array.isArray(value)) {
    const valid = value.every((entry) => isIJson(entry, seen));
    seen.delete(value);
    return valid;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    seen.delete(value);
    return false;
  }
  const valid = Object.entries(value).every(
    ([key, entry]) =>
      containsOnlyUnicodeScalarValues(key) && isIJson(entry, seen),
  );
  seen.delete(value);
  return valid;
}

function containsSensitiveDiagnosticMember(value) {
  if (Array.isArray(value)) {
    return value.some(containsSensitiveDiagnosticMember);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }

  return Object.entries(value).some(
    ([key, entry]) =>
      /(?:auth|bearer|cookie|credential|environment|keyring|password|secret|token)/iu.test(
        key,
      ) || containsSensitiveDiagnosticMember(entry),
  );
}

function captureIdentity(stats) {
  return {
    device: String(stats.dev),
    inode: String(stats.ino),
    birthtimeMs: stats.birthtimeMs,
    kind: stats.isDirectory() ? "directory" : "file",
  };
}

function identityMatches(stats, identity) {
  const current = captureIdentity(stats);
  return (
    current.device === identity.device &&
    current.inode === identity.inode &&
    current.birthtimeMs === identity.birthtimeMs &&
    current.kind === identity.kind
  );
}

async function captureOrdinaryFile(target, dependencies) {
  const probe = await probeExistingChain(target, dependencies);
  if (probe.nodeMetadata === null || !probe.nodeMetadata.isFile()) {
    fail("marker-file-identity-mismatch", `${target} is not an ordinary file`);
  }

  return captureIdentity(probe.nodeMetadata);
}

async function assertMarkerFile(target, identity, source, dependencies) {
  const probe = await probeExistingChain(target, dependencies);
  if (
    probe.nodeMetadata === null ||
    !probe.nodeMetadata.isFile() ||
    !identityMatches(probe.nodeMetadata, identity)
  ) {
    fail("marker-file-identity-mismatch", `${target} changed identity`);
  }
  if ((await readFile(target, "utf8")) !== source) {
    fail("marker-file-identity-mismatch", `${target} changed content`);
  }
}

async function readMarkerFile(target, dependencies) {
  const identity = await captureOrdinaryFile(target, dependencies);
  const source = await readFile(target, "utf8");
  await assertMarkerFile(target, identity, source, dependencies);
  return { identity, source };
}

async function captureOrdinaryDirectory(target, dependencies) {
  const probe = await probeExistingChain(target, dependencies);
  if (probe.nodeMetadata === null || !probe.nodeMetadata.isDirectory()) {
    fail(
      "directory-identity-mismatch",
      `${target} is not an ordinary directory`,
    );
  }

  return captureIdentity(probe.nodeMetadata);
}

async function assertOrdinaryDirectoryIdentity(target, identity, dependencies) {
  const probe = await probeExistingChain(target, dependencies);
  if (
    probe.nodeMetadata === null ||
    !probe.nodeMetadata.isDirectory() ||
    !identityMatches(probe.nodeMetadata, identity)
  ) {
    fail("directory-identity-mismatch", `${target} changed identity`);
  }
}

async function readValidatedRootState(root, dependencies) {
  const paths = rootPaths(root);
  const rootProbe = await probeExistingChain(root, dependencies);
  if (
    rootProbe.nodeMetadata === null ||
    !rootProbe.nodeMetadata.isDirectory()
  ) {
    fail("root-identity-mismatch", "the evaluation-home root is missing");
  }
  const resolvedRoot = await realpath(root);
  if (!samePath(root, resolvedRoot)) {
    fail("root-identity-mismatch", "the root resolved identity changed");
  }

  const rootMarkerFile = await readMarkerFile(
    paths.rootMarker,
    dependencies,
  ).catch((error) => {
    fail(
      "root-marker-missing",
      `cannot read the root marker: ${error.message}`,
    );
  });
  const rootMarkerSource = rootMarkerFile.source;
  let rootMarker;
  try {
    rootMarker = JSON.parse(rootMarkerSource);
  } catch {
    fail("root-marker-schema-mismatch", "the root marker is malformed");
  }
  const problems = rootMarkerProblems(rootMarker, root, resolvedRoot);
  if (problems.length > 0) {
    fail(
      "root-marker-mismatch",
      "the root marker no longer authorizes mutation",
      problems,
    );
  }

  const identities = {
    root: captureIdentity(rootProbe.nodeMetadata),
    leases: await captureOrdinaryDirectory(paths.leases, dependencies),
    quarantine: await captureOrdinaryDirectory(paths.quarantine, dependencies),
    history: await captureOrdinaryDirectory(paths.history, dependencies),
  };

  return {
    paths,
    rootMarker,
    rootMarkerSource,
    rootMarkerIdentity: rootMarkerFile.identity,
    identities,
  };
}

async function assertRootState(rootState, dependencies) {
  await assertOrdinaryDirectoryIdentity(
    rootState.paths.root,
    rootState.identities.root,
    dependencies,
  );
  await assertOrdinaryDirectoryIdentity(
    rootState.paths.leases,
    rootState.identities.leases,
    dependencies,
  );
  await assertOrdinaryDirectoryIdentity(
    rootState.paths.quarantine,
    rootState.identities.quarantine,
    dependencies,
  );
  await assertOrdinaryDirectoryIdentity(
    rootState.paths.history,
    rootState.identities.history,
    dependencies,
  );
  await assertMarkerFile(
    rootState.paths.rootMarker,
    rootState.rootMarkerIdentity,
    rootState.rootMarkerSource,
    dependencies,
  );
}

async function captureHomeState(stablePath, rootMarker, role, dependencies) {
  const identity = await captureOrdinaryDirectory(stablePath, dependencies);
  const markerPath = join(stablePath, HOME_MARKER_NAME);
  const markerFile = await readMarkerFile(markerPath, dependencies).catch(
    (error) => {
      fail(
        "home-marker-missing",
        `cannot read the home marker: ${error.message}`,
      );
    },
  );
  const markerSource = markerFile.source;
  let marker;
  try {
    marker = JSON.parse(markerSource);
  } catch {
    fail("home-marker-schema-mismatch", "the home marker is malformed");
  }
  const problems = homeMarkerProblems(marker, rootMarker, role, stablePath);
  if (problems.length > 0) {
    fail(
      "home-marker-mismatch",
      "the home marker no longer authorizes mutation",
      problems,
    );
  }

  return {
    identity,
    marker,
    markerSource,
    markerIdentity: markerFile.identity,
  };
}

async function assertHomeState(
  stablePath,
  expected,
  rootMarker,
  role,
  dependencies,
) {
  await assertOrdinaryDirectoryIdentity(
    stablePath,
    expected.identity,
    dependencies,
  );
  await assertMarkerFile(
    join(stablePath, HOME_MARKER_NAME),
    expected.markerIdentity,
    expected.markerSource,
    dependencies,
  );
  const markerSource = expected.markerSource;
  const marker = JSON.parse(markerSource);
  const problems = homeMarkerProblems(marker, rootMarker, role, stablePath);
  if (problems.length > 0) {
    fail(
      "home-marker-mismatch",
      "the active home marker became invalid",
      problems,
    );
  }
}

async function assertCandidateAbsent(target, dependencies, collisionCode) {
  const probe = await probeExistingChain(target, dependencies);
  if (probe.nodeMetadata !== null) {
    fail(collisionCode, `${target} already exists`);
  }
}

function createJournal(handle, lease, dependencies) {
  let sequence = 0;

  return async (phase, details = {}) => {
    sequence += 1;
    const record = {
      schemaVersion: SCHEMA_VERSION,
      sequence,
      timestamp: now(dependencies),
      operationId: lease.operationId,
      role: lease.role,
      leaseToken: lease.leaseToken,
      phase,
      ...details,
    };
    if (!isIJson(record)) {
      fail("invalid-journal-record", `journal phase ${phase} is not I-JSON`);
    }
    await handle.write(`${JSON.stringify(record)}\n`, null, "utf8");
    await handle.sync();
    if (dependencies.failAfterPhase !== null) {
      await dependencies.failAfterPhase(phase);
    }
  };
}

function createChildTracker(child) {
  if (
    child === null ||
    typeof child !== "object" ||
    typeof child.once !== "function" ||
    !Number.isInteger(child.pid)
  ) {
    fail("invalid-child", "registerChild requires a started ChildProcess");
  }

  const tracker = {
    child,
    exitObserved: child.exitCode !== null || child.signalCode !== null,
    exitCode: child.exitCode,
    exitSignal: child.signalCode,
    processCloseObserved: false,
    streams: [],
    closurePromise: null,
  };
  let resolveClosure;
  tracker.closurePromise = new Promise((resolvePromise) => {
    resolveClosure = resolvePromise;
  });

  const observeExit = (code, signal) => {
    tracker.exitObserved = true;
    tracker.exitCode = code;
    tracker.exitSignal = signal;
  };
  child.once("exit", observeExit);
  child.once("close", () => {
    tracker.processCloseObserved = true;
    resolveClosure();
  });
  if (child.exitCode !== null || child.signalCode !== null) {
    observeExit(child.exitCode, child.signalCode);
  }

  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    if (stream === null || stream === undefined) {
      continue;
    }
    const streamTracker = { stream, closeObserved: stream.closed === true };
    stream.once("close", () => {
      streamTracker.closeObserved = true;
    });
    tracker.streams.push(streamTracker);
  }

  if (
    child.exitCode !== null &&
    child.killed === false &&
    child.connected === false
  ) {
    tracker.processCloseObserved = true;
    resolveClosure();
  }

  return tracker;
}

async function waitForRegisteredChildren(trackers) {
  const timeoutMs = 5000;

  for (const tracker of trackers) {
    if (!tracker.processCloseObserved) {
      let timeoutHandle;
      try {
        await Promise.race([
          tracker.closurePromise,
          new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error("registered child closure remained ambiguous"));
            }, timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
  }
}

const SAFE_RELEASE_KEYS = Object.freeze([
  "descendantStatus",
  "exitCode",
  "exitSignal",
  "exitStatus",
  "protocolStatus",
  "status",
  "stdioStatus",
  "terminationActions",
]);
const UNSAFE_RELEASE_KEYS = Object.freeze([
  "diagnostics",
  "reasonCode",
  "status",
]);
const UNSAFE_REASON_CODES = Object.freeze([
  "callback-failed",
  "shutdown-ambiguous",
  "stdio-open",
  "protocol-open",
  "descendant-suspected",
]);
const TERMINATION_ACTIONS = Object.freeze(["interrupt", "terminate", "kill"]);

function validateOperationResult(result) {
  if (
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    !arraysEqual(Object.keys(result).sort(), ["release", "value"])
  ) {
    fail(
      "invalid-release-disposition",
      "the callback must return value and an exact release disposition",
    );
  }

  return result;
}

function validateUnsafeRelease(release) {
  if (!arraysEqual(Object.keys(release).sort(), UNSAFE_RELEASE_KEYS)) {
    fail(
      "invalid-release-disposition",
      "unsafe release disposition is not closed",
    );
  }
  if (!UNSAFE_REASON_CODES.includes(release.reasonCode)) {
    fail("invalid-release-disposition", "unsafe release reason is unknown");
  }
  if (!isIJson(release.diagnostics)) {
    fail("invalid-release-disposition", "unsafe diagnostics must be I-JSON");
  }
  if (containsSensitiveDiagnosticMember(release.diagnostics)) {
    fail(
      "sensitive-diagnostics",
      "sensitive diagnostics cannot be persisted in lease evidence",
    );
  }
}

function validateSafeReleaseShape(release) {
  if (!arraysEqual(Object.keys(release).sort(), SAFE_RELEASE_KEYS)) {
    fail(
      "invalid-release-disposition",
      "safe release disposition is not closed",
    );
  }
  if (
    !["not-started", "observed"].includes(release.exitStatus) ||
    !["not-opened", "closed"].includes(release.stdioStatus) ||
    !["not-opened", "closed", "not-applicable"].includes(
      release.protocolStatus,
    ) ||
    release.descendantStatus !== "none-observed" ||
    !Array.isArray(release.terminationActions) ||
    release.terminationActions.some(
      (action) => !TERMINATION_ACTIONS.includes(action),
    ) ||
    (release.exitCode !== null && !Number.isInteger(release.exitCode)) ||
    (release.exitSignal !== null && typeof release.exitSignal !== "string")
  ) {
    fail("invalid-release-disposition", "safe release fields are malformed");
  }
}

function crossCheckRelease(release, trackers) {
  if (trackers.length === 0) {
    if (
      release.exitStatus !== "not-started" ||
      release.exitCode !== null ||
      release.exitSignal !== null ||
      release.stdioStatus !== "not-opened" ||
      release.protocolStatus !== "not-opened"
    ) {
      fail(
        "release-contradiction",
        "release disposition contradicts the absence of a registered child",
      );
    }
    return;
  }

  if (
    release.exitStatus !== "observed" ||
    release.stdioStatus !== "closed" ||
    release.protocolStatus === "not-opened"
  ) {
    fail(
      "release-contradiction",
      "release disposition contradicts registered child evidence",
    );
  }
  for (const tracker of trackers) {
    if (
      !tracker.exitObserved ||
      !tracker.processCloseObserved ||
      tracker.streams.some(({ closeObserved }) => !closeObserved)
    ) {
      fail(
        "release-contradiction",
        "registered child exit or stdio closure was not observed",
      );
    }
  }
  const tracker = trackers[0];
  if (
    tracker.exitCode !== release.exitCode ||
    tracker.exitSignal !== release.exitSignal
  ) {
    fail(
      "release-contradiction",
      "release exit identity contradicts registered child evidence",
    );
  }
}

async function snapshotDeletionTree(target, root, dependencies) {
  if (!isContained(root, target)) {
    fail("path-containment-failed", `${target} is outside the managed root`);
  }
  const probe = await probeExistingChain(target, dependencies);
  if (probe.nodeMetadata === null) {
    fail("cleanup-target-missing", `${target} disappeared before cleanup`);
  }

  const snapshot = {
    path: target,
    name: parse(target).base,
    identity: captureIdentity(probe.nodeMetadata),
    kind: probe.nodeMetadata.isDirectory() ? "directory" : "file",
    children: [],
  };
  if (snapshot.kind === "file") {
    return snapshot;
  }

  const directory = await opendir(target);
  try {
    for await (const entry of directory) {
      snapshot.children.push(
        await snapshotDeletionTree(
          join(target, entry.name),
          root,
          dependencies,
        ),
      );
    }
  } finally {
    await directory.close().catch(() => {});
  }
  snapshot.children.sort((left, right) => left.name.localeCompare(right.name));
  return snapshot;
}

async function deleteSnapshotTree(snapshot, root, dependencies) {
  if (!isContained(root, snapshot.path)) {
    fail("path-containment-failed", `${snapshot.path} escaped before deletion`);
  }
  const probe = await probeExistingChain(snapshot.path, dependencies);
  if (
    probe.nodeMetadata === null ||
    !identityMatches(probe.nodeMetadata, snapshot.identity)
  ) {
    fail(
      "cleanup-identity-mismatch",
      `${snapshot.path} changed before deletion`,
    );
  }

  if (snapshot.kind === "file") {
    await unlink(snapshot.path);
    return;
  }

  const directory = await opendir(snapshot.path);
  const observedNames = [];
  try {
    for await (const entry of directory) {
      observedNames.push(entry.name);
    }
  } finally {
    await directory.close().catch(() => {});
  }
  observedNames.sort((left, right) => left.localeCompare(right));
  if (
    !arraysEqual(
      observedNames,
      snapshot.children.map(({ name }) => name),
    )
  ) {
    fail("cleanup-identity-mismatch", `${snapshot.path} contents changed`);
  }

  for (const child of snapshot.children) {
    await deleteSnapshotTree(child, root, dependencies);
  }
  await assertOrdinaryDirectoryIdentity(
    snapshot.path,
    snapshot.identity,
    dependencies,
  );
  await rmdir(snapshot.path);
}

export async function withEvaluationHome(
  { root, role, operationId, testDependencies },
  operation,
) {
  const normalizedRoot = normalizedExplicitRoot(root);
  assertRole(role);
  assertOperationId(operationId);
  if (typeof operation !== "function") {
    fail("invalid-operation", "operation must be a function");
  }
  const dependencies = validateTestDependencies(
    normalizedRoot,
    testDependencies,
  );
  const rootState = await readValidatedRootState(normalizedRoot, dependencies);
  const stablePath = rootState.paths[role];
  const initialHome = await captureHomeState(
    stablePath,
    rootState.rootMarker,
    role,
    dependencies,
  );
  const leasePath = join(rootState.paths.leases, `${role}.lock`);

  try {
    await mkdir(leasePath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("lease-contended", `the ${role} role already has a live lease`);
    }
    throw error;
  }

  const leaseToken = token(dependencies);
  const lease = {
    schemaVersion: SCHEMA_VERSION,
    manager: MANAGER_ID,
    operationId,
    role,
    processId: process.pid,
    rootNonce: rootState.rootMarker.rootNonce,
    leaseToken,
    acquiredAt: now(dependencies),
  };
  const priorQuarantine = join(
    rootState.paths.quarantine,
    `${operationId}-${role}-${leaseToken}-prior`,
  );
  const usedQuarantine = join(
    rootState.paths.quarantine,
    `${operationId}-${role}-${leaseToken}-used`,
  );
  const historyPath = join(
    rootState.paths.history,
    `${operationId}-${role}-${leaseToken}.completed`,
  );

  await writeExclusiveJson(join(leasePath, "lease.json"), lease);
  const journalHandle = await open(
    join(leasePath, "journal.jsonl"),
    "wx",
    0o600,
  );
  const appendPhase = createJournal(journalHandle, lease, dependencies);
  let journalOpen = true;

  try {
    await appendPhase("acquired");
    await assertCandidateAbsent(historyPath, dependencies, "history-collision");
    await assertCandidateAbsent(
      priorQuarantine,
      dependencies,
      "quarantine-collision",
    );
    await assertCandidateAbsent(
      usedQuarantine,
      dependencies,
      "quarantine-collision",
    );

    await appendPhase("before-prior-home-rename");
    await assertRootState(rootState, dependencies);
    await assertHomeState(
      stablePath,
      initialHome,
      rootState.rootMarker,
      role,
      dependencies,
    );
    await assertCandidateAbsent(
      priorQuarantine,
      dependencies,
      "quarantine-collision",
    );
    await rename(stablePath, priorQuarantine);
    const priorIdentity = await captureOrdinaryDirectory(
      priorQuarantine,
      dependencies,
    );
    await appendPhase("after-prior-home-rename", {
      quarantine: parse(priorQuarantine).base,
      generationNonce: initialHome.marker.generationNonce,
    });

    await appendPhase("before-fresh-home-create");
    await assertRootState(rootState, dependencies);
    await assertCandidateAbsent(
      stablePath,
      dependencies,
      "stable-home-collision",
    );
    const freshMarker = await createMarkedHome(
      stablePath,
      stablePath,
      role,
      rootState.rootMarker.rootNonce,
      dependencies,
    );
    const freshHome = await captureHomeState(
      stablePath,
      rootState.rootMarker,
      role,
      dependencies,
    );
    await appendPhase("after-fresh-home-create", {
      generationNonce: freshMarker.generationNonce,
    });

    const trackers = [];
    let registrationOpen = true;
    const registerChild = (child) => {
      if (!registrationOpen) {
        fail("registration-closed", "child registration is closed");
      }
      if (trackers.length > 0) {
        fail("multiple-children", "one operation may register only one child");
      }
      trackers.push(createChildTracker(child));
    };
    const context = Object.freeze({
      role,
      path: stablePath,
      environment: Object.freeze({ CODEX_HOME: stablePath }),
      registerChild,
    });

    await appendPhase("before-operation");
    let operationResult;
    try {
      operationResult = await operation(context);
    } catch (error) {
      registrationOpen = false;
      await appendPhase("callback-failed", {
        error: safeSerializableError(error),
      });
      throw error;
    }
    registrationOpen = false;
    await appendPhase("after-operation");

    const validatedResult = validateOperationResult(operationResult);
    const { release } = validatedResult;
    if (
      release === null ||
      typeof release !== "object" ||
      Array.isArray(release) ||
      !["safe", "unsafe"].includes(release.status)
    ) {
      await appendPhase("release-rejected", { reasonCode: "malformed" });
      fail("invalid-release-disposition", "release disposition is malformed");
    }
    if (release.status === "unsafe") {
      try {
        validateUnsafeRelease(release);
      } catch (error) {
        await appendPhase("release-rejected", {
          reasonCode: "invalid-unsafe-release",
        });
        throw error;
      }
      await appendPhase("release-rejected", {
        reasonCode: release.reasonCode,
        diagnostics: release.diagnostics,
      });
      fail(
        release.reasonCode,
        `operation reported unsafe release: ${release.reasonCode}`,
      );
    }

    validateSafeReleaseShape(release);
    if (trackers.length > 0) {
      try {
        await waitForRegisteredChildren(trackers);
      } catch (error) {
        await appendPhase("release-rejected", {
          reasonCode: "shutdown-ambiguous",
        });
        fail("shutdown-ambiguous", error.message);
      }
    }
    try {
      crossCheckRelease(release, trackers);
    } catch (error) {
      await appendPhase("release-rejected", {
        reasonCode: "release-contradiction",
      });
      throw error;
    }

    await appendPhase("before-used-home-rename");
    await assertRootState(rootState, dependencies);
    await assertHomeState(
      stablePath,
      freshHome,
      rootState.rootMarker,
      role,
      dependencies,
    );
    await assertCandidateAbsent(
      usedQuarantine,
      dependencies,
      "quarantine-collision",
    );
    await rename(stablePath, usedQuarantine);
    const usedIdentity = await captureOrdinaryDirectory(
      usedQuarantine,
      dependencies,
    );
    await appendPhase("after-used-home-rename", {
      quarantine: parse(usedQuarantine).base,
      generationNonce: freshMarker.generationNonce,
    });

    await appendPhase("before-clean-home-create");
    await assertRootState(rootState, dependencies);
    await assertCandidateAbsent(
      stablePath,
      dependencies,
      "stable-home-collision",
    );
    const cleanMarker = await createMarkedHome(
      stablePath,
      stablePath,
      role,
      rootState.rootMarker.rootNonce,
      dependencies,
    );
    const cleanHome = await captureHomeState(
      stablePath,
      rootState.rootMarker,
      role,
      dependencies,
    );
    await appendPhase("after-clean-home-create", {
      generationNonce: cleanMarker.generationNonce,
    });

    await assertOrdinaryDirectoryIdentity(
      priorQuarantine,
      priorIdentity,
      dependencies,
    );
    await assertOrdinaryDirectoryIdentity(
      usedQuarantine,
      usedIdentity,
      dependencies,
    );
    const priorSnapshot = await snapshotDeletionTree(
      priorQuarantine,
      normalizedRoot,
      dependencies,
    );
    const usedSnapshot = await snapshotDeletionTree(
      usedQuarantine,
      normalizedRoot,
      dependencies,
    );

    await appendPhase("before-prior-quarantine-delete");
    await assertRootState(rootState, dependencies);
    await deleteSnapshotTree(priorSnapshot, normalizedRoot, dependencies);
    await appendPhase("after-prior-quarantine-delete");

    await appendPhase("before-used-quarantine-delete");
    await assertRootState(rootState, dependencies);
    await deleteSnapshotTree(usedSnapshot, normalizedRoot, dependencies);
    await appendPhase("after-used-quarantine-delete");

    await assertRootState(rootState, dependencies);
    await assertHomeState(
      stablePath,
      cleanHome,
      rootState.rootMarker,
      role,
      dependencies,
    );
    await assertCandidateAbsent(historyPath, dependencies, "history-collision");
    await appendPhase("completed");
    await journalHandle.close();
    journalOpen = false;
    await assertCandidateAbsent(historyPath, dependencies, "history-collision");
    await rename(leasePath, historyPath);

    return validatedResult.value;
  } finally {
    if (journalOpen) {
      await journalHandle.close().catch(() => {});
    }
  }
}
