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
import { openEvaluationPathMetadata } from "./evaluation-path-metadata.js";
import { freezeContract, parseContract } from "./json-contract.js";
import {
  assertTransmissionPacket,
  canonicalJsonBytes,
  sha256Hex,
} from "./runtime.js";
import {
  assertProcessClosure,
  assertProcessHost,
  assertProcessHostMembership,
  assertProcessReadiness,
  inspectRecoveryOwner,
} from "./process-host.js";

export const EVALUATION_HOME_ROLES = Object.freeze(["preflight", "execution"]);

/** Prepare a state-bound proposal; never remove a lease or grant model authority. */
export async function prepareEvaluationHomeRecovery({
  root,
  role,
  testDependencies,
}) {
  const normalizedRoot = normalizedExplicitRoot(root);
  assertRole(role);
  if (process.platform !== "win32" || role !== "execution")
    return {
      schemaVersion: 2,
      status: "blocked",
      reason: "unsupported-recovery-scope",
      root,
      role,
    };
  return withPathMetadataDependencies(
    normalizedRoot,
    testDependencies,
    async (dependencies) => {
      try {
        return await prepareRecovery(normalizedRoot, role, dependencies);
      } catch (error) {
        return {
          schemaVersion: 2,
          status:
            error?.code === "recovery-owner-active" ? "blocked" : "unknown",
          reason: error?.code ?? "recovery-proof-invalid",
          root,
          role,
        };
      }
    },
  );
}

const MANAGER_ID = "openai-codex-evaluation-homes";
const SCHEMA_VERSION = 1;
const ROOT_MARKER_NAME = ".evaluation-homes-root.json";
const HOME_MARKER_NAME = ".evaluation-home-owner.json";
const CREDENTIAL_CACHE_NAME = "auth.json";
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
  "exists",
  "fullPath",
  "isDirectory",
  "redirected",
  "schemaVersion",
  "volume",
]);
const VOLUME_METADATA_KEYS = Object.freeze(["identity", "kind"]);

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
    fail(
      "missing-testDependencies",
      "production dependencies must be opened through their managed session",
    );
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

async function withPathMetadataDependencies(root, testDependencies, operation) {
  if (testDependencies !== undefined) {
    return operation(validateTestDependencies(root, testDependencies));
  }
  const probe = openEvaluationPathMetadata();
  const dependencies = {
    clock: () => new Date().toISOString(),
    failAfterPhase: null,
    pathMetadata: (target) => probe.read(target),
    randomBytes: systemRandomBytes,
  };

  try {
    return await operation(dependencies);
  } finally {
    await probe.close();
  }
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
    // Filesystem object IDs and nanosecond birth times must not pass through
    // IEEE-754 numbers before entering a state-bound maintenance receipt.
    return await lstat(target, { bigint: true });
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
    typeof metadata.isDirectory !== "boolean" ||
    typeof metadata.redirected !== "boolean" ||
    metadata.volume === null ||
    typeof metadata.volume !== "object" ||
    Array.isArray(metadata.volume) ||
    !arraysEqual(Object.keys(metadata.volume).sort(), VOLUME_METADATA_KEYS) ||
    typeof metadata.volume.identity !== "string" ||
    metadata.volume.identity.length === 0 ||
    !["local", "unsupported"].includes(metadata.volume.kind)
  ) {
    fail("invalid-path-metadata", `metadata for ${target} is malformed`);
  }
  if (!metadata.exists && (metadata.isDirectory || metadata.redirected)) {
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
      metadata.isDirectory !== nodeMetadata.isDirectory()
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
    if (metadata.volume.kind !== "local") {
      fail(
        "unsupported-drive",
        `${ancestor} is not on supported local storage`,
      );
    }

    const volume = metadata.volume.identity;
    if (expectedVolume === null) {
      expectedVolume = volume;
    } else if (expectedVolume !== volume) {
      fail("cross-volume-path", `${ancestor} changed volume identity`);
    }
    if (nodeMetadata?.isSymbolicLink() || metadata.redirected) {
      fail("reparse-point", `${ancestor} is a reparse point`);
    }
    if (
      nodeMetadata !== null &&
      index < ancestors.length - 1 &&
      (!nodeMetadata.isDirectory() || !metadata.isDirectory)
    ) {
      fail("not-a-directory", `${ancestor} is not a directory`);
    }

    last = { metadata, nodeMetadata, volume };
  }

  return last;
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
        isDirectory: probed.metadata.isDirectory,
        redirected: probed.metadata.redirected,
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
  return withPathMetadataDependencies(
    normalizedRoot,
    testDependencies,
    (dependencies) =>
      inspectEvaluationHomesWithDependencies(normalizedRoot, dependencies),
  );
}

async function inspectEvaluationHomesWithDependencies(
  normalizedRoot,
  dependencies,
) {
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
      recoveredHistory: [],
      otherHistory: [],
      containment: { valid: true },
      volume: { ...rootProbe.metadata.volume },
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
    completedHistory: history.entries.filter(({ name }) =>
      name.endsWith(".completed"),
    ),
    recoveredHistory: history.entries.filter(({ name }) =>
      name.endsWith(".recovered"),
    ),
    otherHistory: history.entries.filter(
      ({ name }) =>
        !name.endsWith(".recovered") && !name.endsWith(".completed"),
    ),
    containment: { valid: true },
    volume: { ...rootProbe.metadata.volume },
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
  await mkdir(target, { mode: 0o700 });
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
  return withPathMetadataDependencies(
    normalizedRoot,
    testDependencies,
    (dependencies) =>
      initializeEvaluationHomesWithDependencies(normalizedRoot, dependencies),
  );
}

async function initializeEvaluationHomesWithDependencies(
  normalizedRoot,
  dependencies,
) {
  const existing = await optionalLstat(normalizedRoot);

  if (existing !== null) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      fail(
        "not-a-directory",
        "the requested root is not an ordinary directory",
      );
    }
    const inventory = await inspectEvaluationHomesWithDependencies(
      normalizedRoot,
      dependencies,
    );
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

  await mkdir(staging, { mode: 0o700 });
  try {
    await mkdir(join(staging, LEASES_NAME), { mode: 0o700 });
    await mkdir(join(staging, QUARANTINE_NAME), { mode: 0o700 });
    await mkdir(join(staging, HISTORY_NAME), { mode: 0o700 });
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

  return inspectEvaluationHomesWithDependencies(normalizedRoot, dependencies);
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
    birthtimeNs: String(stats.birthtimeNs),
    kind: stats.isDirectory() ? "directory" : "file",
  };
}

const stateDigest = (value) => sha256Hex(canonicalJsonBytes(value));

/** Non-secret evidence is pinned by ordinary single-link identity and exact bytes. */
async function captureRecoveryEvidence(target, dependencies) {
  const probe = await probeExistingChain(target, dependencies);
  if (
    !probe.nodeMetadata?.isFile() ||
    probe.nodeMetadata.nlink !== 1n ||
    probe.nodeMetadata.size > 8 * 1024 * 1024
  )
    fail(
      "recovery-evidence-invalid",
      `${target} is not bounded single-link evidence`,
    );
  const record = await readMarkerFile(target, dependencies);
  const raw = await readFile(target);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  await assertMarkerFile(target, record.identity, source, dependencies);
  if (source !== record.source)
    fail("recovery-evidence-drift", `${target} changed during capture`);
  return {
    path: target,
    identity: record.identity,
    sha256: sha256Hex(raw),
    source,
  };
}

async function assertRecoveryEvidence(record, dependencies) {
  const current = await captureRecoveryEvidence(record.path, dependencies);
  if (stateDigest(current) !== stateDigest(record))
    fail("recovery-evidence-drift", `${record.path} changed after binding`);
}

function parseEvidence(record) {
  return parseContract(Buffer.from(record.source), record.path);
}

/** Association is admission metadata, never a provider capability or model input. */
async function captureContainment(
  containment,
  role,
  operationId,
  root,
  dependencies,
) {
  if (
    process.platform !== "win32" ||
    role !== "execution" ||
    !objectHasExactKeys(containment, [
      "association",
      "processHost",
      "readyPath",
    ])
  )
    fail(
      "unsupported-containment",
      "only Windows bridge execution leases carry closure bindings",
    );
  assertProcessHostMembership(containment.processHost);
  const association = containment.association;
  if (
    !objectHasExactKeys(association, [
      "consumerRoot",
      "controlPath",
      "controlSha256",
      "evidenceLayout",
      "preparedSession",
      "transmissionSha256",
    ]) ||
    ![
      association.consumerRoot,
      association.controlPath,
      association.preparedSession,
      containment.readyPath,
    ].every(
      (path) =>
        typeof path === "string" && isAbsolute(path) && path === resolve(path),
    ) ||
    containment.readyPath !==
      join(
        association.consumerRoot,
        "process-host-observation.json.ready.json",
      ) ||
    association.controlPath !==
      join(association.consumerRoot, "execution-index.json") ||
    isContained(root, association.consumerRoot) ||
    isContained(root, association.preparedSession) ||
    !["legacy-v1", "evaluation-trial-v1"].includes(association.evidenceLayout)
  )
    fail(
      "containment-association-invalid",
      "invalid private carrier association",
    );
  const ready = await captureRecoveryEvidence(
    containment.readyPath,
    dependencies,
  );
  const binding = parseEvidence(ready);
  assertProcessReadiness(binding, containment.processHost, association);
  const control = await captureRecoveryEvidence(
    association.controlPath,
    dependencies,
  );
  const carrier = parseEvidence(control);
  if (
    control.sha256 !== association.controlSha256 ||
    carrier.preparedSession !== association.preparedSession ||
    carrier.consumerRoot !== association.consumerRoot ||
    carrier.transmissionSha256 !== association.transmissionSha256 ||
    carrier.evidenceLayout !== association.evidenceLayout ||
    stateDigest(carrier.processHost) !== stateDigest(containment.processHost) ||
    carrier.executableSha256 !== binding.consumer.sha256 ||
    binding.receiptPath !==
      join(
        association.consumerRoot,
        "process-host-observation.json.closure.json",
      )
  )
    fail(
      "containment-association-invalid",
      "carrier does not match recorder readiness",
    );
  const packet = await captureRecoveryEvidence(
    join(association.preparedSession, "packet.json"),
    dependencies,
  );
  const prepared = parseEvidence(packet);
  assertTransmissionPacket(prepared);
  const settings = prepared.transmission.harnessControlledInputs.find(
    ({ id }) => ["suite-context", "runner-settings"].includes(id),
  );
  if (
    prepared.transmissionSha256 !== association.transmissionSha256 ||
    prepared.transmission.session.preparedSessionId !== operationId ||
    prepared.transmission.provider !== "openai" ||
    !settings ||
    JSON.parse(settings.content).evaluationHomesRoot !== root
  )
    fail(
      "containment-association-invalid",
      "packet does not match the exact home operation",
    );
  const closureProbe = await probeExistingChain(
    binding.receiptPath,
    dependencies,
  );
  if (
    !closureProbe.nodeMetadata?.isFile() ||
    closureProbe.nodeMetadata.nlink !== 1n ||
    closureProbe.nodeMetadata.size !== 0n
  )
    fail(
      "containment-association-invalid",
      "closure reservation was not armed before the lease",
    );
  return {
    schemaVersion: 2,
    ready,
    control,
    packet,
    receiptIdentity: captureIdentity(closureProbe.nodeMetadata),
  };
}

/** Capture an owned generation without reading its credential contents. */
async function captureRecoveryHome(
  target,
  stablePath,
  rootState,
  role,
  dependencies,
) {
  if ((await probeExistingChain(target, dependencies)).nodeMetadata === null)
    return null;
  const home = await captureHomeState(
    target,
    rootState.rootMarker,
    role,
    dependencies,
    stablePath,
  );
  const tree = [];
  async function visit(path, relativePath, depth) {
    if (depth > 64 || tree.length >= 10000)
      fail(
        "recovery-home-too-large",
        "home inventory exceeds bounded recovery scope",
      );
    const probe = await probeExistingChain(path, dependencies);
    if (
      probe.nodeMetadata === null ||
      (!probe.nodeMetadata.isDirectory() &&
        (!probe.nodeMetadata.isFile() || probe.nodeMetadata.nlink !== 1n))
    )
      fail(
        "recovery-home-invalid",
        "home contains a missing or non-ordinary single-link entry",
      );
    const directory = probe.nodeMetadata.isDirectory();
    tree.push({
      relativePath,
      identity: captureIdentity(probe.nodeMetadata),
      ...(directory
        ? {}
        : {
            size: String(probe.nodeMetadata.size),
            mtimeNs: String(probe.nodeMetadata.mtimeNs),
          }),
    });
    if (directory) {
      const children = await listDirectChildren(
        path,
        dependencies,
        rootState.paths.root,
      );
      for (const child of children)
        await visit(
          child.path,
          relativePath ? `${relativePath}/${child.name}` : child.name,
          depth + 1,
        );
    }
  }
  await visit(target, "", 0);
  return {
    home,
    tree,
    credential: await captureCredentialCache(
      join(target, CREDENTIAL_CACHE_NAME),
      dependencies,
    ),
  };
}

function sameRecoveryHome(actual, expected, allowCredentialMove = false) {
  if (
    !actual ||
    !expected ||
    stateDigest(actual.home) !== stateDigest(expected.home)
  )
    return false;
  const inventory = (value) =>
    value.tree.filter(
      ({ relativePath }) =>
        !allowCredentialMove || relativePath !== CREDENTIAL_CACHE_NAME,
    );
  return (
    stateDigest(inventory(actual)) === stateDigest(inventory(expected)) &&
    (allowCredentialMove ||
      stateDigest(actual.credential) === stateDigest(expected.credential))
  );
}

function validateOriginalJournal(records, lease) {
  const prefix = [
    "acquired",
    "before-prior-home-rename",
    "after-prior-home-rename",
    "before-fresh-home-create",
    "after-fresh-home-create",
    "before-prior-credential-cache-transfer",
    "after-prior-credential-cache-transfer",
    "before-operation",
  ];
  const phases = records.map(({ phase }) => phase);
  if (
    records.length < 8 ||
    !arraysEqual(phases.slice(0, 8), prefix) ||
    ![
      "",
      "after-operation",
      "callback-failed",
      "after-operation,release-rejected",
    ].includes(phases.slice(8).join(","))
  )
    fail(
      "unsupported-recovery-phase",
      "the original journal is outside the witnessed operation interval",
    );
  for (const [index, record] of records.entries()) {
    if (
      record.schemaVersion !== 1 ||
      record.sequence !== index + 1 ||
      record.operationId !== lease.operationId ||
      record.role !== lease.role ||
      record.leaseToken !== lease.leaseToken
    )
      fail(
        "recovery-journal-invalid",
        "journal identity or sequence differs from its lease",
      );
    assertTimestamp(record.timestamp, "journal timestamp");
  }
}

function parseJournal(record) {
  if (!record.source.endsWith("\n"))
    fail(
      "recovery-journal-incomplete",
      "journal has an incomplete terminal record",
    );
  return record.source
    .slice(0, -1)
    .split("\n")
    .map((line) => parseContract(Buffer.from(line), record.path));
}

async function captureOptionalEvidence(target, dependencies) {
  return (await probeExistingChain(target, dependencies)).nodeMetadata === null
    ? null
    : captureRecoveryEvidence(target, dependencies);
}

async function captureRecoveryState(root, role, dependencies) {
  const rootState = await readValidatedRootState(root, dependencies);
  await captureRecoveryEvidence(rootState.paths.rootMarker, dependencies);
  const leasePath = join(rootState.paths.leases, `${role}.lock`);
  const leaseDirectoryIdentity = await captureOrdinaryDirectory(
    leasePath,
    dependencies,
  );
  const leaseFile = await captureRecoveryEvidence(
    join(leasePath, "lease.json"),
    dependencies,
  );
  const lease = parseEvidence(leaseFile);
  if (
    !objectHasExactKeys(lease, [
      "acquiredAt",
      "containment",
      "homeOwnership",
      "leaseToken",
      "manager",
      "operationId",
      "processId",
      "role",
      "rootNonce",
      "schemaVersion",
    ]) ||
    lease.schemaVersion !== 2 ||
    lease.manager !== MANAGER_ID ||
    lease.role !== role ||
    lease.rootNonce !== rootState.rootMarker.rootNonce ||
    !TOKEN_PATTERN.test(lease.leaseToken) ||
    !TOKEN_PATTERN.test(lease.operationId)
  )
    fail(
      "unsupported-recovery-lease",
      "a witnessed version2 execution lease is required",
    );
  assertTimestamp(lease.acquiredAt, "lease acquiredAt");
  if (
    stateDigest(lease.homeOwnership) !==
    stateDigest({
      rootIdentity: rootState.identities.root,
      rootMarkerIdentity: rootState.rootMarkerIdentity,
      rootMarkerSha256: sha256Hex(Buffer.from(rootState.rootMarkerSource)),
      volume: rootState.volume,
    })
  )
    fail("recovery-root-drift", "original root identity or volume changed");
  const journalFile = await captureRecoveryEvidence(
    join(leasePath, "journal.jsonl"),
    dependencies,
  );
  const journal = parseJournal(journalFile);
  validateOriginalJournal(journal, lease);
  const containment = lease.containment;
  if (
    !objectHasExactKeys(containment, [
      "control",
      "packet",
      "ready",
      "receiptIdentity",
      "schemaVersion",
    ]) ||
    containment.schemaVersion !== 2
  )
    fail("recovery-containment-invalid", "lease containment is malformed");
  const ready = parseEvidence(containment.ready);
  const association = ready.association;
  // Validate record locations before opening them. A tampered lease cannot
  // redirect an evidence read to a credential cache or another home role.
  if (
    !association ||
    typeof association.consumerRoot !== "string" ||
    !isAbsolute(association.consumerRoot) ||
    typeof association.preparedSession !== "string" ||
    !isAbsolute(association.preparedSession) ||
    association.controlPath !==
      join(association.consumerRoot, "execution-index.json") ||
    containment.ready.path !==
      join(
        association.consumerRoot,
        "process-host-observation.json.ready.json",
      ) ||
    containment.control.path !== association.controlPath ||
    containment.packet.path !==
      join(association.preparedSession, "packet.json") ||
    ready.receiptPath !==
      join(
        association.consumerRoot,
        "process-host-observation.json.closure.json",
      ) ||
    isContained(root, association.consumerRoot) ||
    isContained(root, association.preparedSession)
  )
    fail(
      "recovery-association-invalid",
      "bound evidence locations are not private carrier records",
    );
  for (const record of [
    containment.ready,
    containment.control,
    containment.packet,
  ])
    await assertRecoveryEvidence(record, dependencies);
  assertProcessHost(ready.processHost);
  assertProcessReadiness(ready, ready.processHost, association);
  const control = parseEvidence(containment.control);
  const packet = parseEvidence(containment.packet);
  assertTransmissionPacket(packet);
  if (
    containment.ready.path !==
      join(
        association.consumerRoot,
        "process-host-observation.json.ready.json",
      ) ||
    containment.control.path !== association.controlPath ||
    containment.control.sha256 !== association.controlSha256 ||
    containment.packet.path !==
      join(association.preparedSession, "packet.json") ||
    control.transmissionSha256 !== association.transmissionSha256 ||
    control.consumerRoot !== association.consumerRoot ||
    control.preparedSession !== association.preparedSession ||
    control.evidenceLayout !== association.evidenceLayout ||
    stateDigest(control.processHost) !== stateDigest(ready.processHost) ||
    control.executableSha256 !== ready.consumer.sha256 ||
    ready.receiptPath !==
      join(
        association.consumerRoot,
        "process-host-observation.json.closure.json",
      ) ||
    packet.transmissionSha256 !== association.transmissionSha256 ||
    packet.transmission.session.preparedSessionId !== lease.operationId
  )
    fail(
      "recovery-association-invalid",
      "carrier, packet and lease do not identify the same invocation",
    );
  const settings = packet.transmission.harnessControlledInputs.find(({ id }) =>
    ["suite-context", "runner-settings"].includes(id),
  );
  if (
    packet.transmission.provider !== "openai" ||
    !settings ||
    JSON.parse(settings.content).evaluationHomesRoot !== root
  )
    fail("recovery-association-invalid", "packet does not own this home root");
  const closure = await captureRecoveryEvidence(
    ready.receiptPath,
    dependencies,
  );
  if (
    stateDigest(closure.identity) !== stateDigest(containment.receiptIdentity)
  )
    fail("recovery-proof-replaced", "closure reservation changed identity");
  assertProcessClosure(parseEvidence(closure), ready, ready.processHost);
  const trial = association.evidenceLayout === "evaluation-trial-v1";
  if (!trial && association.evidenceLayout !== "legacy-v1")
    fail("recovery-association-invalid", "unknown evidence layout");
  const attempt = await captureRecoveryEvidence(
    join(
      association.preparedSession,
      trial ? "authorization-consumption.json" : "attempt.json",
    ),
    dependencies,
  );
  const consumption = parseEvidence(attempt);
  const expectedConsumption = {
    schemaVersion: 1,
    provider: packet.transmission.provider,
    model: packet.transmission.model,
    effort: packet.transmission.effort,
    transmissionSha256: packet.transmissionSha256,
    ...(trial
      ? { artifactType: "evaluation-trial-authorization-consumption" }
      : {}),
  };
  if (stateDigest(consumption) !== stateDigest(expectedConsumption))
    fail(
      "recovery-authority-invalid",
      "consumed authority does not match the original packet",
    );
  const outcome = await captureOptionalEvidence(
    join(association.preparedSession, trial ? "result.json" : "run.json"),
    dependencies,
  );
  const stem = `${lease.operationId}-${role}-${lease.leaseToken}`;
  const usedPath = join(rootState.paths.quarantine, `${stem}-recovery-used`);
  const stagingPath = join(
    rootState.paths.quarantine,
    `${stem}-recovery-fresh`,
  );
  const priorPath = join(rootState.paths.quarantine, `${stem}-prior`);
  const historyPath = join(rootState.paths.history, `${stem}.recovered`);
  await assertCandidateAbsent(historyPath, dependencies, "history-collision");
  const active = await captureRecoveryHome(
    rootState.paths[role],
    rootState.paths[role],
    rootState,
    role,
    dependencies,
  );
  const used = await captureRecoveryHome(
    usedPath,
    rootState.paths[role],
    rootState,
    role,
    dependencies,
  );
  const staging = await captureRecoveryHome(
    stagingPath,
    rootState.paths[role],
    rootState,
    role,
    dependencies,
  );
  const prior = await captureRecoveryHome(
    priorPath,
    rootState.paths[role],
    rootState,
    role,
    dependencies,
  );
  if (
    !prior ||
    stateDigest(prior.home) !== stateDigest(journal[2].homeState) ||
    prior.credential !== null
  )
    fail(
      "recovery-prior-home-invalid",
      "prior generation or credential disposition is ambiguous",
    );
  const recoveryPath = join(leasePath, "recovery");
  let recovery = null;
  if (
    (await probeExistingChain(recoveryPath, dependencies)).nodeMetadata !== null
  ) {
    const identity = await captureOrdinaryDirectory(recoveryPath, dependencies);
    const entries = await listDirectChildren(recoveryPath, dependencies, root);
    if (
      entries.some(
        ({ name, isDirectory }) =>
          isDirectory ||
          !/^(?:plan\.json|journal\.jsonl|receipt\.json|owner-[1-9][0-9]*\.(?:json|closed\.json))$/u.test(
            name,
          ),
      )
    )
      fail("recovery-control-invalid", "unexpected recovery control entries");
    const records = [];
    for (const entry of entries)
      records.push(await captureRecoveryEvidence(entry.path, dependencies));
    recovery = { identity, records };
  }
  return {
    rootState,
    leasePath,
    leaseDirectoryIdentity,
    leaseFile,
    journalFile,
    closure,
    attempt,
    outcome,
    active,
    used,
    staging,
    prior,
    usedPath,
    stagingPath,
    priorPath,
    historyPath,
    recoveryPath,
    recovery,
  };
}

function proposalDigest(proposal) {
  const { stateDigest: _ignored, ...content } = proposal;
  return stateDigest(content);
}

function recordNamed(recovery, name) {
  return (
    recovery?.records.find(({ path }) => parse(path).base === name) ?? null
  );
}

function validateRecoveryPlan(plan, state) {
  if (
    plan.schemaVersion !== 2 ||
    plan.kind !== "evaluation-home-recovery-v2" ||
    plan.status !== "eligible" ||
    plan.mode !== "apply" ||
    proposalDigest(plan) !== plan.stateDigest ||
    plan.state.recovery !== null
  )
    fail(
      "recovery-plan-invalid",
      "original recovery proposal is not a complete bound plan",
    );
  for (const field of [
    "rootState",
    "leasePath",
    "leaseDirectoryIdentity",
    "leaseFile",
    "journalFile",
    "closure",
    "attempt",
    "outcome",
    "prior",
    "usedPath",
    "stagingPath",
    "priorPath",
    "historyPath",
    "recoveryPath",
  ])
    if (stateDigest(plan.state[field]) !== stateDigest(state[field]))
      fail("recovery-plan-drift", `original recovery ${field} changed`);
  if (
    !plan.state.active ||
    plan.state.used !== null ||
    plan.state.staging !== null ||
    stateDigest(plan.state.active.home) !==
      stateDigest(parseJournal(state.journalFile)[4].homeState)
  )
    fail(
      "recovery-plan-invalid",
      "original active generation was not journal-bound",
    );
  const marker = plan.cleanMarker;
  if (
    homeMarkerProblems(
      marker,
      state.rootState.rootMarker,
      "execution",
      state.rootState.paths.execution,
    ).length > 0 ||
    marker.generationNonce === plan.state.active.home.marker.generationNonce
  )
    fail(
      "recovery-plan-invalid",
      "replacement generation is not an exact fresh role",
    );
  if (state.used === null) {
    if (!sameRecoveryHome(state.active, plan.state.active))
      fail("recovery-home-drift", "original active generation changed");
  } else {
    if (!sameRecoveryHome(state.used, plan.state.active, true))
      fail("recovery-home-drift", "retained used generation changed");
    if (state.active !== null && state.staging !== null)
      fail("recovery-home-ambiguous", "two fresh homes exist");
    for (const home of [state.active, state.staging].filter(Boolean)) {
      if (
        stateDigest(home.home.marker) !== stateDigest(marker) ||
        home.tree.some(
          ({ relativePath }) =>
            !["", HOME_MARKER_NAME, CREDENTIAL_CACHE_NAME].includes(
              relativePath,
            ),
        )
      )
        fail("recovery-home-drift", "replacement home has unexpected state");
    }
    const target = state.active ?? state.staging;
    if (state.used.credential && target?.credential)
      fail("credential-cache-collision", "two credential caches are present");
    const currentCredential =
      state.used.credential ?? target?.credential ?? null;
    if (
      stateDigest(currentCredential) !==
      stateDigest(plan.state.active.credential)
    )
      fail(
        "credential-cache-identity-mismatch",
        "original credential identity was lost or replaced",
      );
    if (state.staging?.credential)
      fail("recovery-home-ambiguous", "staging cannot own a credential cache");
  }
  if (state.used === null && state.staging !== null)
    fail("recovery-home-ambiguous", "staging exists before original rotation");
}

async function prepareRecovery(root, role, dependencies) {
  const state = await captureRecoveryState(root, role, dependencies);
  let cleanMarker;
  let mode = "apply";
  let nextOwnerAttempt = 1;
  if (state.recovery === null) {
    if (
      state.used !== null ||
      state.staging !== null ||
      !state.active ||
      stateDigest(state.active.home) !==
        stateDigest(parseJournal(state.journalFile)[4].homeState)
    )
      fail(
        "recovery-home-drift",
        "active generation does not match the original journal",
      );
    cleanMarker = {
      schemaVersion: 1,
      manager: MANAGER_ID,
      rootNonce: state.rootState.rootMarker.rootNonce,
      role,
      stablePath: state.rootState.paths[role],
      generationNonce: token(dependencies),
      createdAt: now(dependencies),
    };
  } else {
    mode = "resume";
    const planRecord = recordNamed(state.recovery, "plan.json");
    const journalRecord = recordNamed(state.recovery, "journal.jsonl");
    if (!planRecord || !journalRecord)
      fail(
        "recovery-control-incomplete",
        "interrupted recovery has no complete plan/journal",
      );
    const plan = parseEvidence(planRecord);
    validateRecoveryPlan(plan, state);
    cleanMarker = plan.cleanMarker;
    const journal = parseJournal(journalRecord);
    for (const [index, record] of journal.entries())
      if (
        record.schemaVersion !== 2 ||
        record.sequence !== index + 1 ||
        record.planDigest !== plan.stateDigest ||
        typeof record.phase !== "string"
      )
        fail(
          "recovery-journal-invalid",
          "recovery journal association or sequence changed",
        );
    const owners = state.recovery.records
      .filter(({ path }) => /^owner-[1-9][0-9]*\.json$/u.test(parse(path).base))
      .sort(
        (a, b) =>
          Number(parse(a.path).base.split("-")[1].split(".")[0]) -
          Number(parse(b.path).base.split("-")[1].split(".")[0]),
      );
    if (!owners.length || owners.length >= 32)
      fail(
        "recovery-owner-invalid",
        "recovery ownership is missing or its bounded attempts are exhausted",
      );
    for (const [index, ownerRecord] of owners.entries()) {
      const owner = parseEvidence(ownerRecord);
      if (
        !objectHasExactKeys(owner, [
          "acquiredAt",
          "attempt",
          "creationFileTime",
          "processId",
          "schemaVersion",
          "stateDigest",
        ]) ||
        owner.schemaVersion !== 2 ||
        owner.attempt !== index + 1 ||
        parse(ownerRecord.path).base !== `owner-${index + 1}.json` ||
        !Number.isSafeInteger(owner.processId) ||
        owner.processId <= 0 ||
        !/^[1-9][0-9]{15,20}$/u.test(owner.creationFileTime)
      )
        fail("recovery-owner-invalid", "recovery owner identity is malformed");
      const closedRecord = recordNamed(
        state.recovery,
        `owner-${index + 1}.closed.json`,
      );
      if (closedRecord) {
        const closed = parseEvidence(closedRecord);
        if (
          !objectHasExactKeys(closed, [
            "closedAt",
            "ownerSha256",
            "schemaVersion",
          ]) ||
          closed.schemaVersion !== 2 ||
          closed.ownerSha256 !== ownerRecord.sha256
        )
          fail("recovery-owner-invalid", "recovery owner release is not bound");
        assertTimestamp(closed.closedAt, "owner closedAt");
      } else if (
        inspectRecoveryOwner(
          parseEvidence(parseEvidence(state.leaseFile).containment.ready)
            .processHost,
          owner.processId,
          owner.creationFileTime,
        ).state !== "closed"
      )
        fail("recovery-owner-active", "a recovery owner is still active");
    }
    nextOwnerAttempt = owners.length + 1;
    const receiptRecord = recordNamed(state.recovery, "receipt.json");
    if (
      receiptRecord &&
      stateDigest(parseEvidence(receiptRecord)) !==
        stateDigest(recoveryReceipt(plan))
    )
      fail("recovery-receipt-invalid", "recovered-resource receipt changed");
  }
  const proposal = {
    schemaVersion: 2,
    kind: "evaluation-home-recovery-v2",
    status: "eligible",
    mode,
    root,
    role,
    state,
    cleanMarker,
    nextOwnerAttempt,
  };
  proposal.stateDigest = proposalDigest(proposal);
  return proposal;
}

function recoveryReceipt(plan) {
  const lease = parseEvidence(plan.state.leaseFile);
  return {
    schemaVersion: 2,
    kind: "recovered-evaluation-home",
    status: "recovered",
    root: plan.root,
    role: plan.role,
    rootNonce: lease.rootNonce,
    operationId: lease.operationId,
    leaseToken: lease.leaseToken,
    planDigest: plan.stateDigest,
    originalLeaseSha256: plan.state.leaseFile.sha256,
    originalJournalSha256: plan.state.journalFile.sha256,
    closureSha256: plan.state.closure.sha256,
    consumedAttemptSha256: plan.state.attempt.sha256,
    originalOutcomeSha256: plan.state.outcome?.sha256 ?? null,
    cleanGenerationNonce: plan.cleanMarker.generationNonce,
    credentialMoved: plan.state.active.credential !== null,
    retainedUsedPath: plan.state.usedPath,
    retainedPriorPath: plan.state.priorPath,
    historyPath: plan.state.historyPath,
  };
}

/** Apply/resume only an exact operator-prepared state. No authority is restored. */
export async function applyEvaluationHomeRecovery({
  proposal,
  confirmRoot,
  confirmRole,
  stateDigest: approvedDigest,
  resume = false,
  testDependencies,
}) {
  // Copy before the first await: a caller cannot revise approved paths or the
  // replacement marker while this asynchronous maintenance operation runs.
  proposal = freezeContract(
    parseContract(canonicalJsonBytes(proposal), "recovery proposal"),
  );
  if (
    !proposal ||
    proposal.status !== "eligible" ||
    proposal.schemaVersion !== 2 ||
    proposal.kind !== "evaluation-home-recovery-v2" ||
    proposalDigest(proposal) !== proposal.stateDigest ||
    approvedDigest !== proposal.stateDigest ||
    confirmRoot !== proposal.root ||
    confirmRole !== proposal.role ||
    (proposal.mode === "resume") !== resume
  )
    fail(
      "recovery-confirmation-invalid",
      "exact root, role, mode and prepared state digest are required",
    );
  const root = normalizedExplicitRoot(proposal.root);
  assertRole(proposal.role);
  if (process.platform !== "win32" || proposal.role !== "execution")
    fail(
      "unsupported-recovery-scope",
      "only witnessed Windows execution recovery is supported",
    );
  return withPathMetadataDependencies(
    root,
    testDependencies,
    async (dependencies) => {
      try {
        return await applyRecovery(proposal, dependencies);
      } catch (error) {
        if (typeof error?.code === "string") throw error;
        fail(
          "recovery-proof-invalid",
          error?.message ?? "recovery proof is invalid",
        );
      }
    },
  );
}

async function applyRecovery(proposal, dependencies) {
  const current = await captureRecoveryState(
    proposal.root,
    proposal.role,
    dependencies,
  );
  if (stateDigest(current) !== stateDigest(proposal.state))
    fail("recovery-state-stale", "prepared filesystem/evidence state changed");
  const ownerCount =
    current.recovery?.records.filter(({ path }) =>
      /^owner-[1-9][0-9]*\.json$/u.test(parse(path).base),
    ).length ?? 0;
  if (
    proposal.nextOwnerAttempt !== ownerCount + 1 ||
    proposal.nextOwnerAttempt > 32
  )
    fail(
      "recovery-owner-invalid",
      "prepared attempt does not follow retained ownership",
    );
  let plan = proposal;
  if (proposal.mode === "resume")
    plan = parseEvidence(recordNamed(current.recovery, "plan.json"));
  validateRecoveryPlan(plan, current);
  await assertRootState(current.rootState, dependencies);
  if (proposal.mode === "apply") {
    try {
      await mkdir(current.recoveryPath, { mode: 0o700 });
    } catch (error) {
      if (error.code === "EEXIST")
        fail("recovery-contended", "another recovery claimed the lease");
      throw error;
    }
    await writeExclusiveJson(join(current.recoveryPath, "plan.json"), plan);
    const handle = await open(
      join(current.recoveryPath, "journal.jsonl"),
      "wx",
      0o600,
    );
    await handle.close();
  }
  const producer = parseEvidence(
    parseEvidence(current.leaseFile).containment.ready,
  ).processHost;
  const identity = inspectRecoveryOwner(producer, process.pid);
  if (identity.state !== "active")
    fail(
      "recovery-owner-invalid",
      "current recovery owner was not observed active",
    );
  const owner = {
    schemaVersion: 2,
    attempt: proposal.nextOwnerAttempt,
    processId: process.pid,
    creationFileTime: identity.creationFileTime,
    stateDigest: proposal.stateDigest,
    acquiredAt: now(dependencies),
  };
  const ownerPath = join(current.recoveryPath, `owner-${owner.attempt}.json`);
  try {
    await writeExclusiveJson(ownerPath, owner);
  } catch (error) {
    if (error.code === "EEXIST")
      fail("recovery-contended", "another recovery claimed this state");
    throw error;
  }
  const ownerRecord = await captureRecoveryEvidence(ownerPath, dependencies);
  const controlDirectoryIdentity = await captureOrdinaryDirectory(
    current.recoveryPath,
    dependencies,
  );
  const planRecord = await captureRecoveryEvidence(
    join(current.recoveryPath, "plan.json"),
    dependencies,
  );
  const journalPath = join(current.recoveryPath, "journal.jsonl");
  const previous = await captureRecoveryEvidence(journalPath, dependencies);
  let journalRecord = previous;
  let sequence = previous.source === "" ? 0 : parseJournal(previous).length;
  const journal = await open(journalPath, "a", 0o600);
  let journalOpen = true;
  let archived = false;
  async function phase(name) {
    await journal.write(
      `${JSON.stringify({ schemaVersion: 2, sequence: ++sequence, timestamp: now(dependencies), planDigest: plan.stateDigest, phase: name })}\n`,
    );
    await journal.sync();
    journalRecord = await captureRecoveryEvidence(journalPath, dependencies);
    if (dependencies.failAfterPhase) await dependencies.failAfterPhase(name);
  }
  async function operationBoundary(name) {
    if (dependencies.failAfterPhase) await dependencies.failAfterPhase(name);
    await assertRootState(current.rootState, dependencies);
    await assertOrdinaryDirectoryIdentity(
      current.leasePath,
      current.leaseDirectoryIdentity,
      dependencies,
    );
    await assertOrdinaryDirectoryIdentity(
      current.recoveryPath,
      controlDirectoryIdentity,
      dependencies,
    );
    const containment = parseEvidence(current.leaseFile).containment;
    for (const record of [
      ownerRecord,
      planRecord,
      journalRecord,
      current.leaseFile,
      current.journalFile,
      current.closure,
      current.attempt,
      containment.ready,
      containment.control,
      containment.packet,
    ])
      await assertRecoveryEvidence(record, dependencies);
    // Immutable evidence was authenticated at admission; exact-byte checks
    // preserve that proof. Reobserve mutable home/outcome state without
    // repeatedly hashing producer binaries or verifying the same signature.
    const observed = { ...current };
    for (const [field, target] of [
      ["active", current.rootState.paths.execution],
      ["used", current.usedPath],
      ["staging", current.stagingPath],
      ["prior", current.priorPath],
    ])
      observed[field] = await captureRecoveryHome(
        target,
        current.rootState.paths.execution,
        current.rootState,
        proposal.role,
        dependencies,
      );
    const association = parseEvidence(containment.ready).association;
    observed.outcome = await captureOptionalEvidence(
      join(
        association.preparedSession,
        association.evidenceLayout === "evaluation-trial-v1"
          ? "result.json"
          : "run.json",
      ),
      dependencies,
    );
    validateRecoveryPlan(plan, observed);
    return observed;
  }
  try {
    await phase("recovery-acquired");
    let state = current;
    if (state.used === null) {
      await phase("recovery-before-rotate");
      state = await operationBoundary("recovery-rotate-intent");
      await assertCandidateAbsent(
        state.usedPath,
        dependencies,
        "quarantine-collision",
      );
      await rename(state.rootState.paths.execution, state.usedPath);
      state = await operationBoundary("recovery-rotated-before-observation");
      await phase("recovery-after-rotate");
    }
    if (state.active === null && state.staging === null) {
      await phase("recovery-before-create");
      state = await operationBoundary("recovery-create-intent");
      await assertCandidateAbsent(
        state.stagingPath,
        dependencies,
        "quarantine-collision",
      );
      await mkdir(state.stagingPath, { mode: 0o700 });
      if (dependencies.failAfterPhase)
        await dependencies.failAfterPhase(
          "recovery-directory-created-before-marker",
        );
      await writeExclusiveJson(
        join(state.stagingPath, HOME_MARKER_NAME),
        plan.cleanMarker,
      );
      state = await operationBoundary("recovery-created-before-observation");
      await phase("recovery-after-create");
    }
    if (state.active === null) {
      await phase("recovery-before-publish");
      state = await operationBoundary("recovery-publish-intent");
      await assertCandidateAbsent(
        state.rootState.paths.execution,
        dependencies,
        "stable-home-collision",
      );
      await rename(state.stagingPath, state.rootState.paths.execution);
      state = await operationBoundary("recovery-published-before-observation");
      await phase("recovery-after-publish");
    }
    if (state.used.credential !== null) {
      await phase("recovery-before-credential-transfer");
      state = await operationBoundary("recovery-credential-intent");
      await assertCredentialCacheIdentity(
        join(state.usedPath, CREDENTIAL_CACHE_NAME),
        plan.state.active.credential,
        dependencies,
      );
      await transferCredentialCache(
        state.usedPath,
        state.rootState.paths.execution,
        dependencies,
      );
      state = await operationBoundary(
        "recovery-transferred-before-observation",
      );
      await phase("recovery-after-credential-transfer");
    }
    const receipt = recoveryReceipt(plan);
    const receiptPath = join(state.recoveryPath, "receipt.json");
    const existingReceipt = await captureOptionalEvidence(
      receiptPath,
      dependencies,
    );
    if (existingReceipt === null) {
      await phase("recovery-before-seal");
      await operationBoundary("recovery-seal-intent");
      await writeExclusiveJson(receiptPath, receipt);
      await operationBoundary("recovery-sealed-before-observation");
      await phase("recovery-after-seal");
    } else if (
      stateDigest(parseEvidence(existingReceipt)) !== stateDigest(receipt)
    )
      fail("recovery-receipt-invalid", "resource receipt changed");
    await phase("recovery-before-archive");
    await operationBoundary("recovery-archive-intent");
    const final = await captureRecoveryState(
      proposal.root,
      proposal.role,
      dependencies,
    );
    validateRecoveryPlan(plan, final);
    await assertCandidateAbsent(
      final.historyPath,
      dependencies,
      "history-collision",
    );
    // This rename releases the original lease only after the fresh role and
    // distinct recovered-resource receipt are durable. Nothing is deleted.
    // Windows refuses a directory rename while our non-delete-sharing journal
    // handle is open. Close it after its final durable intent, before archival.
    await journal.close();
    journalOpen = false;
    await rename(final.leasePath, final.historyPath);
    archived = true;
    if (dependencies.failAfterPhase)
      await dependencies.failAfterPhase("recovery-archived-before-return");
    return receipt;
  } finally {
    if (journalOpen) await journal.close();
    const directory = archived ? current.historyPath : current.leasePath;
    await assertOrdinaryDirectoryIdentity(
      directory,
      current.leaseDirectoryIdentity,
      dependencies,
    );
    await assertOrdinaryDirectoryIdentity(
      join(directory, "recovery"),
      controlDirectoryIdentity,
      dependencies,
    );
    // A returned/failed owner has finished all home I/O. A hard-killed owner
    // lacks this record and requires native process birth/death inspection.
    await writeExclusiveJson(
      join(directory, "recovery", `owner-${owner.attempt}.closed.json`),
      {
        schemaVersion: 2,
        ownerSha256: ownerRecord.sha256,
        closedAt: now(dependencies),
      },
    );
  }
}

function identityMatches(stats, identity) {
  const current = captureIdentity(stats);
  return (
    current.device === identity.device &&
    current.inode === identity.inode &&
    current.birthtimeNs === identity.birthtimeNs &&
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
    volume: { ...rootProbe.metadata.volume },
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

async function captureHomeState(
  stablePath,
  rootMarker,
  role,
  dependencies,
  markerStablePath = stablePath,
) {
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
  const problems = homeMarkerProblems(
    marker,
    rootMarker,
    role,
    markerStablePath,
  );
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

async function captureCredentialCache(target, dependencies) {
  const probe = await probeExistingChain(target, dependencies);
  if (probe.nodeMetadata === null) {
    return null;
  }
  if (!probe.nodeMetadata.isFile() || probe.nodeMetadata.nlink !== 1n) {
    fail(
      "credential-cache-identity-mismatch",
      `${target} is not a single-link ordinary file`,
    );
  }
  return captureIdentity(probe.nodeMetadata);
}

async function assertCredentialCacheIdentity(target, identity, dependencies) {
  const probe = await probeExistingChain(target, dependencies);
  if (
    probe.nodeMetadata === null ||
    !probe.nodeMetadata.isFile() ||
    probe.nodeMetadata.nlink !== 1n ||
    !identityMatches(probe.nodeMetadata, identity)
  ) {
    fail("credential-cache-identity-mismatch", `${target} changed identity`);
  }
}

async function transferCredentialCache(sourceHome, targetHome, dependencies) {
  const source = join(sourceHome, CREDENTIAL_CACHE_NAME);
  const target = join(targetHome, CREDENTIAL_CACHE_NAME);
  const identity = await captureCredentialCache(source, dependencies);

  await assertCandidateAbsent(
    target,
    dependencies,
    "credential-cache-collision",
  );
  if (identity === null) {
    return false;
  }

  // Never read or copy the secret bytes. An identity-checked same-volume rename
  // carries the one persistent credential file into the otherwise fresh home.
  await assertCredentialCacheIdentity(source, identity, dependencies);
  await rename(source, target);
  await assertCredentialCacheIdentity(target, identity, dependencies);
  return true;
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
  { root, role, operationId, testDependencies, containment = null },
  operation,
) {
  const normalizedRoot = normalizedExplicitRoot(root);
  assertRole(role);
  assertOperationId(operationId);
  if (typeof operation !== "function") {
    fail("invalid-operation", "operation must be a function");
  }
  return withPathMetadataDependencies(
    normalizedRoot,
    testDependencies,
    (dependencies) =>
      withEvaluationHomeDependencies(
        { normalizedRoot, role, operationId, containment },
        operation,
        dependencies,
      ),
  );
}

async function withEvaluationHomeDependencies(
  { normalizedRoot, role, operationId, containment },
  operation,
  dependencies,
) {
  const rootState = await readValidatedRootState(normalizedRoot, dependencies);
  const stablePath = rootState.paths[role];
  const initialHome = await captureHomeState(
    stablePath,
    rootState.rootMarker,
    role,
    dependencies,
  );
  const leasePath = join(rootState.paths.leases, `${role}.lock`);
  const containmentRecord =
    containment === null
      ? null
      : await captureContainment(
          containment,
          role,
          operationId,
          normalizedRoot,
          dependencies,
        );

  try {
    await mkdir(leasePath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("lease-contended", `the ${role} role already has a live lease`);
    }
    throw error;
  }

  const leaseToken = token(dependencies);
  const lease = {
    schemaVersion: containmentRecord === null ? SCHEMA_VERSION : 2,
    manager: MANAGER_ID,
    operationId,
    role,
    processId: process.pid,
    rootNonce: rootState.rootMarker.rootNonce,
    leaseToken,
    acquiredAt: now(dependencies),
    ...(containmentRecord === null
      ? {}
      : {
          containment: containmentRecord,
          homeOwnership: {
            rootIdentity: rootState.identities.root,
            rootMarkerIdentity: rootState.rootMarkerIdentity,
            rootMarkerSha256: sha256Hex(
              Buffer.from(rootState.rootMarkerSource),
            ),
            volume: rootState.volume,
          },
        }),
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
      ...(containmentRecord === null ? {} : { homeState: initialHome }),
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
      ...(containmentRecord === null ? {} : { homeState: freshHome }),
    });
    await appendPhase("before-prior-credential-cache-transfer");
    const priorCredentialCacheMoved = await transferCredentialCache(
      priorQuarantine,
      stablePath,
      dependencies,
    );
    await appendPhase("after-prior-credential-cache-transfer", {
      moved: priorCredentialCacheMoved,
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
    await appendPhase("before-used-credential-cache-transfer");
    const usedCredentialCacheMoved = await transferCredentialCache(
      usedQuarantine,
      stablePath,
      dependencies,
    );
    await appendPhase("after-used-credential-cache-transfer", {
      moved: usedCredentialCacheMoved,
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
