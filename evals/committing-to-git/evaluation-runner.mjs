import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  EXACT_COMMIT_AUTHORIZATION_REPLY,
  preflightAppServerWithIsolation,
  runAppServerSessionWithApprovalPolicy,
} from "./app-server-session.mjs";

const MATRIX_CASE_IDS = Object.freeze([
  4, 7, 18, 28, 35, 36, 37, 39, 40, 41, 42, 47, 49, 50, 53, 54, 55,
]);
const ARMS = Object.freeze(["no-skill", "old-skill", "new-skill"]);
const MODELS = Object.freeze([
  Object.freeze({
    model: "gpt-5.6-luna",
    effort: "low",
    provider: "openai",
    repetitions: 5,
    purpose: "primary",
  }),
  Object.freeze({
    model: "gpt-5.6-sol",
    effort: "low",
    provider: "openai",
    repetitions: 1,
    purpose: "calibration",
  }),
]);
const PINNED_SKILLS = Object.freeze({
  "old-skill": "76baa9b25e0afeaa2c62c4cf7042976444edc15e",
  "new-skill": "ec064b1f8177d9542a82f478ca3b1ce5e44ee702",
});
const SKILL_REPOSITORY_PATH = "skills/committing-to-git";
const MODEL_AUTHORIZATION_STATEMENT =
  "I authorize transmitting the exact packet identified by transmissionSha256 to the named provider and model.";
const EVALUATION_BASE_INSTRUCTIONS =
  "Work only inside the supplied disposable Git fixture. Treat every other local or external source as unavailable.";
const EVALUATION_DEVELOPER_INSTRUCTIONS =
  "Follow the user request with the available local tools. Do not use the network, apps, plugins, MCP servers, subagents, or undisclosed skills. Before any commit, emit exactly one structured evaluation proposal; when materially different scopes remain plausible, emit exactly one structured scope question before staging or preparation.";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      throw new TypeError("Transmission packets must contain JSON values only");
    }

    return serialized;
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Transmission packets require plain JSON objects");
  }

  return `{${Object.keys(value)
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function transmissionPacketDigest(transmission) {
  return sha256(canonicalJson(transmission));
}

function stableOrderKey(seed, value) {
  return sha256(`${seed}\0${value}`);
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function normalizedRepositoryPath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\0") ||
    isAbsolute(path)
  ) {
    throw new Error(`Invalid evaluation scope path ${JSON.stringify(path)}`);
  }

  const normalized = path.replaceAll("\\", "/");

  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Evaluation scope path escapes the fixture: ${path}`);
  }

  return normalized;
}

function isWithin(root, candidate) {
  const pathFromRoot = relative(resolve(root), resolve(candidate));

  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== ".." &&
      !isAbsolute(pathFromRoot))
  );
}

function resolveProspectivePath(candidate) {
  const unresolved = [];
  let ancestor = resolve(candidate);

  while (true) {
    try {
      lstatSync(ancestor);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }

      const parent = dirname(ancestor);

      if (parent === ancestor) {
        throw error;
      }

      unresolved.unshift(basename(ancestor));
      ancestor = parent;
    }
  }

  return resolve(realpathSync(ancestor), ...unresolved);
}

function isWithinResolved(root, candidate) {
  try {
    return isWithin(
      realpathSync(resolve(root)),
      resolveProspectivePath(candidate),
    );
  } catch {
    return false;
  }
}

function runGit(
  repository,
  args,
  { allowFailure = false, encoding = "utf8", input } = {},
) {
  const result = spawnSync("git", args, {
    cwd: repository,
    encoding,
    env: {
      ...process.env,
      GIT_NO_LAZY_FETCH: "1",
      GIT_OPTIONAL_LOCKS: "0",
    },
    input,
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.status}): ${
        result.stderr || result.stdout
      }`,
    );
  }

  return result;
}

function listWorktreeFiles(repository) {
  const files = [];

  function visit(directory) {
    const names = readdirSync(directory).sort((left, right) =>
      left.localeCompare(right, "en"),
    );

    for (const name of names) {
      if (name === ".git") {
        continue;
      }

      const path = join(directory, name);
      const state = lstatSync(path);
      const repositoryPath = relative(repository, path).split(sep).join("/");

      if (state.isDirectory()) {
        visit(path);
      } else if (state.isSymbolicLink()) {
        const target = readlinkSync(path);
        files.push({
          bytes: Buffer.byteLength(target),
          mode: state.mode % 0o1000,
          path: repositoryPath,
          sha256: sha256(target),
          type: "symlink",
        });
      } else if (state.isFile()) {
        const contents = readFileSync(path);
        files.push({
          bytes: contents.byteLength,
          mode: state.mode % 0o1000,
          path: repositoryPath,
          sha256: sha256(contents),
          type: "file",
        });
      }
    }
  }

  visit(repository);
  return files;
}

export function captureGitState(repository) {
  const headResult = runGit(repository, ["rev-parse", "--verify", "HEAD"], {
    allowFailure: true,
  });
  const branchResult = runGit(repository, ["symbolic-ref", "--quiet", "HEAD"], {
    allowFailure: true,
  });
  const head = headResult.status === 0 ? headResult.stdout.trim() : null;
  const parents = head
    ? runGit(repository, ["show", "-s", "--format=%P", head])
        .stdout.trim()
        .split(/\s+/u)
        .filter(Boolean)
    : [];
  const index = runGit(repository, ["ls-files", "--stage", "-z"], {
    encoding: "buffer",
  }).stdout;
  const status = runGit(
    repository,
    ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
    { encoding: "buffer" },
  ).stdout;
  const localConfiguration = runGit(
    repository,
    ["config", "--local", "--null", "--list"],
    { encoding: "buffer" },
  ).stdout;
  const worktreeFiles = listWorktreeFiles(repository);
  const facts = {
    branch: branchResult.status === 0 ? branchResult.stdout.trim() : null,
    head,
    indexSha256: sha256(index),
    localConfigurationSha256: sha256(localConfiguration),
    parents,
    statusSha256: sha256(status),
    worktreeFiles,
  };

  return {
    ...facts,
    sha256: sha256(JSON.stringify(facts)),
  };
}

export function buildEvaluationSchedule(seed) {
  if (typeof seed !== "string" || seed.length === 0) {
    throw new TypeError("A non-empty string randomization seed is required");
  }

  const blocks = [];

  for (const model of MODELS) {
    for (let repetition = 1; repetition <= model.repetitions; repetition += 1) {
      for (const caseId of MATRIX_CASE_IDS) {
        const blockId = `${model.model}/${model.effort}/${caseId}/${repetition}`;
        const sessions = ARMS.map((arm) => ({
          arm,
          blockId,
          caseId,
          effort: model.effort,
          model: model.model,
          provider: model.provider,
          purpose: model.purpose,
          repetition,
        })).sort((left, right) =>
          stableOrderKey(seed, `${blockId}/${left.arm}`).localeCompare(
            stableOrderKey(seed, `${blockId}/${right.arm}`),
          ),
        );

        blocks.push({
          blockId,
          orderKey: stableOrderKey(seed, blockId),
          sessions,
        });
      }
    }
  }

  blocks.sort((left, right) => left.orderKey.localeCompare(right.orderKey));

  return blocks
    .flatMap(({ sessions }) => sessions)
    .map((session, index) => ({ ...session, seed, sequence: index + 1 }));
}

export function buildRuntimeIsolationOverrides({ skillPaths }) {
  const normalizedSkillPaths = sortedUnique(skillPaths);

  for (const path of normalizedSkillPaths) {
    if (!isAbsolute(path) || basename(path).toLowerCase() !== "skill.md") {
      throw new Error(
        `Skill isolation requires an absolute exact SKILL.md path: ${path}`,
      );
    }
  }

  const overrides = [
    "agents.enabled=false",
    "analytics.enabled=false",
    "apps._default.enabled=false",
    "check_for_update_on_startup=false",
    "features.apps=false",
    "features.enable_mcp_apps=false",
    "features.plugins=false",
    "features.skill_mcp_dependency_install=false",
    "feedback.enabled=false",
    'history.persistence="none"',
    "memories.generate_memories=false",
    "project_doc_fallback_filenames=[]",
    "project_doc_max_bytes=0",
    'sandbox_mode="workspace-write"',
    "sandbox_workspace_write.exclude_slash_tmp=true",
    "sandbox_workspace_write.exclude_tmpdir_env_var=true",
    "sandbox_workspace_write.network_access=false",
    "tools.web_search=false",
    'web_search="disabled"',
  ];

  if (process.platform === "win32") {
    overrides.push('windows.sandbox="elevated"');
  }

  const skillConfiguration = normalizedSkillPaths
    .map((path) => `{path=${JSON.stringify(path)},enabled=false}`)
    .join(",");
  overrides.push(`skills.config=[${skillConfiguration}]`);

  return overrides;
}

export function buildPreparedRuntimeIsolationOverrides({
  fixtureRoot,
  runtimeHomes,
  runtimeIsolationCatalog,
  runtimeIsolationDiscovery,
}) {
  if (
    typeof fixtureRoot !== "string" ||
    !isAbsolute(fixtureRoot) ||
    !runtimeHomes ||
    ![runtimeHomes.preflight, runtimeHomes.run].every(
      (path) => typeof path === "string" && isAbsolute(path),
    )
  ) {
    throw new TypeError("Prepared runtime homes must be absolute paths");
  }

  const catalogSkillPaths = runtimeIsolationCatalog?.skillPaths ?? [];
  const sourceCodexHome = runtimeIsolationDiscovery?.codexHome;
  const sourceSystemSkills =
    typeof sourceCodexHome === "string" && isAbsolute(sourceCodexHome)
      ? catalogSkillPaths.filter((path) =>
          isWithin(join(sourceCodexHome, "skills", ".system"), path),
        )
      : [];

  return Object.fromEntries(
    ["preflight", "run"].map((purpose) => {
      const runtimeHome = runtimeHomes[purpose];
      const runtimeSystemSkills = sourceSystemSkills.map((path) =>
        join(runtimeHome, relative(sourceCodexHome, path)),
      );
      const overrides = buildRuntimeIsolationOverrides({
        skillPaths: sortedUnique([
          ...catalogSkillPaths,
          ...runtimeSystemSkills,
        ]),
      });
      const skillConfiguration = overrides.pop();
      overrides.push(
        `projects.${JSON.stringify(fixtureRoot)}.trust_level="trusted"`,
        skillConfiguration,
      );

      return [purpose, overrides];
    }),
  );
}

function collectSkillFiles(root, paths) {
  if (!existsSync(root)) {
    return;
  }

  const state = lstatSync(root);

  if (state.isSymbolicLink()) {
    return;
  }

  if (state.isFile()) {
    if (basename(root).toLowerCase() === "skill.md") {
      paths.push(resolve(root));
    }
    return;
  }

  if (!state.isDirectory()) {
    return;
  }

  for (const name of readdirSync(root).sort((left, right) =>
    left.localeCompare(right, "en"),
  )) {
    collectSkillFiles(join(root, name), paths);
  }
}

function configuredExternalIds(configuration) {
  const ids = { appIds: [], mcpServerIds: [], pluginIds: [] };
  const namespaceTargets = {
    apps: ids.appIds,
    mcp_servers: ids.mcpServerIds,
    plugins: ids.pluginIds,
  };
  const header =
    /^\s*\[\s*(apps|mcp_servers|plugins)\.(?:"((?:\\.|[^"])*)"|'([^']*)'|([A-Za-z0-9_-]+))/u;

  for (const line of configuration.split(/\r?\n/u)) {
    const match = line.match(header);

    if (!match) {
      continue;
    }

    let id;

    if (match[2] !== undefined) {
      try {
        id = JSON.parse(`"${match[2]}"`);
      } catch (error) {
        throw new Error(`Invalid quoted configuration table key: ${line}`, {
          cause: error,
        });
      }
    } else {
      id = match[3] ?? match[4];
    }

    namespaceTargets[match[1]].push(id);
  }

  return ids;
}

function cachedPluginIds(cacheRoot) {
  if (!existsSync(cacheRoot) || !lstatSync(cacheRoot).isDirectory()) {
    return [];
  }

  const ids = [];

  for (const source of readdirSync(cacheRoot)) {
    const sourcePath = join(cacheRoot, source);
    const sourceState = lstatSync(sourcePath);

    if (!sourceState.isDirectory() || sourceState.isSymbolicLink()) {
      continue;
    }

    for (const plugin of readdirSync(sourcePath)) {
      const pluginPath = join(sourcePath, plugin);
      const pluginState = lstatSync(pluginPath);

      if (!pluginState.isDirectory() || pluginState.isSymbolicLink()) {
        continue;
      }

      const hasVersionDirectory = readdirSync(pluginPath).some((version) => {
        const versionState = lstatSync(join(pluginPath, version));
        return versionState.isDirectory() && !versionState.isSymbolicLink();
      });

      if (hasVersionDirectory) {
        ids.push(`${plugin}@${source}`);
      }
    }
  }

  return ids;
}

function collectCachedSkillFiles(cacheRoot, paths) {
  if (!existsSync(cacheRoot) || !lstatSync(cacheRoot).isDirectory()) {
    return;
  }

  for (const source of readdirSync(cacheRoot)) {
    const sourcePath = join(cacheRoot, source);
    const sourceState = lstatSync(sourcePath);

    if (!sourceState.isDirectory() || sourceState.isSymbolicLink()) {
      continue;
    }

    for (const plugin of readdirSync(sourcePath)) {
      const pluginPath = join(sourcePath, plugin);
      const pluginState = lstatSync(pluginPath);

      if (!pluginState.isDirectory() || pluginState.isSymbolicLink()) {
        continue;
      }

      for (const version of readdirSync(pluginPath)) {
        const versionPath = join(pluginPath, version);
        const versionState = lstatSync(versionPath);

        if (versionState.isDirectory() && !versionState.isSymbolicLink()) {
          collectSkillFiles(join(versionPath, "skills"), paths);
        }
      }
    }
  }
}

export function discoverRuntimeIsolationCatalog({ codexHome, repositoryRoot }) {
  if (!isAbsolute(codexHome) || !isAbsolute(repositoryRoot)) {
    throw new Error("Isolation discovery roots must be absolute");
  }

  const skillPaths = [];
  const skillRoots = [
    join(codexHome, "skills"),
    resolve(codexHome, "..", ".agents", "skills"),
    join(repositoryRoot, ".agents", "skills"),
    join(repositoryRoot, ".codex", "skills"),
  ];

  for (const root of skillRoots) {
    collectSkillFiles(root, skillPaths);
  }
  collectCachedSkillFiles(join(codexHome, "plugins", "cache"), skillPaths);

  const ids = { appIds: [], mcpServerIds: [], pluginIds: [] };
  ids.pluginIds.push(...cachedPluginIds(join(codexHome, "plugins", "cache")));

  for (const path of [
    join(codexHome, "config.toml"),
    join(repositoryRoot, ".codex", "config.toml"),
  ]) {
    if (!existsSync(path)) {
      continue;
    }

    const configured = configuredExternalIds(readFileSync(path, "utf8"));
    ids.appIds.push(...configured.appIds);
    ids.mcpServerIds.push(...configured.mcpServerIds);
    ids.pluginIds.push(...configured.pluginIds);
  }

  return {
    appIds: sortedUnique(ids.appIds),
    mcpServerIds: sortedUnique(ids.mcpServerIds),
    pluginIds: sortedUnique(ids.pluginIds),
    skillPaths: sortedUnique(skillPaths),
  };
}

export function buildCodexAppServerArguments(overrides) {
  if (
    !Array.isArray(overrides) ||
    overrides.some(
      (override) => typeof override !== "string" || override.length === 0,
    )
  ) {
    throw new TypeError("App-server overrides must be non-empty strings");
  }

  return ["app-server", ...overrides.flatMap((override) => ["-c", override])];
}

export function assertRuntimeIsolationCurrent(toolPolicy) {
  const discovery = toolPolicy?.runtimeIsolationDiscovery;
  const preparedCatalog = toolPolicy?.runtimeIsolationCatalog;
  const preparedOverrides = toolPolicy?.runtimeIsolationOverrides;

  if (
    !discovery ||
    !preparedCatalog ||
    !preparedOverrides ||
    !Array.isArray(preparedOverrides.preflight) ||
    !Array.isArray(preparedOverrides.run)
  ) {
    throw new Error("Prepared packet has no reproducible isolation catalog");
  }

  const currentCatalog = discoverRuntimeIsolationCatalog(discovery);

  if (canonicalJson(currentCatalog) !== canonicalJson(preparedCatalog)) {
    throw new Error(
      "Runtime isolation catalog changed after packet preparation",
    );
  }

  const currentOverrides = buildPreparedRuntimeIsolationOverrides({
    fixtureRoot: toolPolicy.runtimeWorkspaceRoots?.[0],
    runtimeHomes: toolPolicy.runtimeHomes,
    runtimeIsolationCatalog: currentCatalog,
    runtimeIsolationDiscovery: discovery,
  });

  if (canonicalJson(currentOverrides) !== canonicalJson(preparedOverrides)) {
    throw new Error(
      "Runtime isolation overrides changed after packet preparation",
    );
  }

  return currentOverrides;
}

function preparedRuntimeHome(toolPolicy, fixtureRoot, purpose) {
  const expectedNames = {
    preflight: "runtime-home-preflight",
    run: "runtime-home-run",
  };
  const expectedName = expectedNames[purpose];
  const runtimeHome = toolPolicy?.runtimeHomes?.[purpose];
  const expectedPath = expectedName
    ? join(dirname(fixtureRoot), expectedName)
    : null;

  if (
    !expectedPath ||
    typeof runtimeHome !== "string" ||
    !isAbsolute(runtimeHome) ||
    resolve(runtimeHome) !== resolve(expectedPath) ||
    !existsSync(runtimeHome)
  ) {
    throw new Error(`Prepared ${purpose} Codex home is invalid`);
  }

  const state = lstatSync(runtimeHome);

  if (
    state.isSymbolicLink() ||
    !state.isDirectory() ||
    realpathSync(runtimeHome) !== resolve(runtimeHome) ||
    readdirSync(runtimeHome).length !== 0
  ) {
    throw new Error(
      `Prepared ${purpose} Codex home must be an empty real directory`,
    );
  }

  return runtimeHome;
}

function withRuntimeHome(appServer, runtimeHome) {
  return {
    ...appServer,
    env: { ...(appServer.env ?? {}), CODEX_HOME: runtimeHome },
  };
}

function requestedFileSystemEntries(fileSystem) {
  if (!fileSystem) {
    return [];
  }

  const entries = [...(fileSystem.entries ?? [])];

  for (const path of fileSystem.read ?? []) {
    entries.push({ access: "read", path: { path, type: "path" } });
  }

  for (const path of fileSystem.write ?? []) {
    entries.push({ access: "write", path: { path, type: "path" } });
  }

  return entries;
}

function permissionProfileIsAllowed(profile, { fixtureRoot, readableRoots }) {
  if (!profile) {
    return true;
  }

  if (profile.network?.enabled === true) {
    return false;
  }

  for (const entry of requestedFileSystemEntries(profile.fileSystem)) {
    if (
      !entry ||
      !["read", "write"].includes(entry.access) ||
      entry.path?.type !== "path" ||
      typeof entry.path.path !== "string" ||
      !isAbsolute(entry.path.path)
    ) {
      return false;
    }

    const allowedRoots =
      entry.access === "write"
        ? [fixtureRoot]
        : [fixtureRoot, ...readableRoots];

    if (!allowedRoots.some((root) => isWithinResolved(root, entry.path.path))) {
      return false;
    }
  }

  return true;
}

export function decideApprovalRequest(method, params, context) {
  const normalizedContext = {
    fixtureRoot: resolve(context.fixtureRoot),
    readableRoots: (context.readableRoots ?? []).map((path) => resolve(path)),
  };
  const cwdAllowed =
    typeof params.cwd === "string" &&
    isWithinResolved(normalizedContext.fixtureRoot, params.cwd);

  if (method === "item/commandExecution/requestApproval") {
    const allowed =
      cwdAllowed &&
      !params.networkApprovalContext &&
      !(params.proposedNetworkPolicyAmendments?.length > 0) &&
      permissionProfileIsAllowed(
        params.additionalPermissions,
        normalizedContext,
      );

    return {
      allowed,
      reason: allowed
        ? "fixture-scoped command"
        : "network or out-of-fixture command access denied",
      response: { decision: allowed ? "accept" : "decline" },
    };
  }

  if (method === "item/permissions/requestApproval") {
    const allowed =
      cwdAllowed &&
      permissionProfileIsAllowed(params.permissions, normalizedContext);

    return {
      allowed,
      reason: allowed
        ? "fixture-scoped turn permission"
        : "network or out-of-fixture permission denied",
      response: {
        permissions: allowed ? params.permissions : {},
        scope: "turn",
        strictAutoReview: false,
      },
    };
  }

  throw new Error(`Unsupported approval request method ${method}`);
}

export function runAppServerSession(options) {
  return runAppServerSessionWithApprovalPolicy(
    options,
    decideApprovalRequest,
    captureGitState,
  );
}

export function preflightAppServerSession(options) {
  return preflightAppServerWithIsolation(options);
}

export function createTransmissionPacket(transmission) {
  const canonicalTransmission = JSON.parse(canonicalJson(transmission));

  return {
    schemaVersion: 1,
    transmission: canonicalTransmission,
    transmissionSha256: transmissionPacketDigest(canonicalTransmission),
  };
}

export function assertTransmissionPacket(packet) {
  if (
    !packet ||
    packet.schemaVersion !== 1 ||
    typeof packet.transmissionSha256 !== "string" ||
    transmissionPacketDigest(packet.transmission) !== packet.transmissionSha256
  ) {
    throw new Error("Transmission packet digest is invalid");
  }

  return packet.transmissionSha256;
}

export function assertExternalModelAuthorization({
  allowExternalModelCall,
  authorization,
  packet,
}) {
  if (allowExternalModelCall !== true) {
    throw new Error(
      "External model execution requires explicit --allow-external-model-call",
    );
  }

  assertTransmissionPacket(packet);

  if (
    !authorization ||
    authorization.schemaVersion !== 1 ||
    authorization.decision !== "authorized" ||
    authorization.statement !== MODEL_AUTHORIZATION_STATEMENT
  ) {
    throw new Error("A valid exact transmission authorization is required");
  }

  if (authorization.transmissionSha256 !== packet.transmissionSha256) {
    throw new Error("Transmission authorization does not match the packet");
  }

  return packet.transmissionSha256;
}

export function writeJsonArtifactExclusive(destination, value) {
  try {
    writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`JSON artifact already exists: ${destination}`, {
        cause: error,
      });
    }

    throw error;
  }

  return destination;
}

export function writeRunRecordExclusive(destination, record) {
  return writeJsonArtifactExclusive(destination, record);
}

function readEvaluation(repositoryRoot, caseId) {
  const configurationPath = join(
    repositoryRoot,
    "evals",
    "committing-to-git",
    "evals.json",
  );
  const configuration = JSON.parse(readFileSync(configurationPath, "utf8"));
  const evaluation = configuration.evals.find(({ id }) => id === caseId);

  if (!evaluation) {
    throw new Error(`Unknown committing-to-git evaluation case ${caseId}`);
  }

  if (evaluation.execution_mode !== "executable" || !evaluation.fixture) {
    throw new Error(`Evaluation case ${caseId} has no executable fixture`);
  }

  return evaluation;
}

function nulSeparatedPaths(buffer) {
  return buffer
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(normalizedRepositoryPath);
}

function changedRepositoryPaths(repository) {
  const unstaged = runGit(
    repository,
    [
      "-c",
      "core.fsmonitor=false",
      "diff",
      "--name-only",
      "--no-ext-diff",
      "--no-renames",
      "--no-textconv",
      "-z",
    ],
    { encoding: "buffer" },
  ).stdout;
  const staged = runGit(
    repository,
    [
      "-c",
      "core.fsmonitor=false",
      "diff",
      "--cached",
      "--name-only",
      "--no-ext-diff",
      "--no-renames",
      "--no-textconv",
      "-z",
    ],
    { encoding: "buffer" },
  ).stdout;
  const untracked = runGit(
    repository,
    [
      "-c",
      "core.fsmonitor=false",
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    { encoding: "buffer" },
  ).stdout;

  return sortedUnique([
    ...nulSeparatedPaths(unstaged),
    ...nulSeparatedPaths(staged),
    ...nulSeparatedPaths(untracked),
  ]);
}

function derivePreparedScope(metadata, repository, predeterminedScopeId) {
  const safety = metadata.expected?.safety ?? {};
  const plausibleScopes = safety.materiallyPlausibleScopes;

  if (plausibleScopes) {
    const options = Object.fromEntries(
      Object.entries(plausibleScopes).map(([id, paths]) => [
        id,
        sortedUnique(paths.map(normalizedRepositoryPath)),
      ]),
    );

    if (
      typeof predeterminedScopeId !== "string" ||
      !Object.hasOwn(options, predeterminedScopeId)
    ) {
      throw new Error(
        "Ambiguous evaluation preparation requires a valid predeterminedScopeId",
      );
    }

    return {
      expectedScope: {
        kind: "paths",
        paths: options[predeterminedScopeId],
      },
      scopeClarification: { options, predeterminedScopeId },
    };
  }

  const explicitPaths =
    safety.selectedPaths ??
    safety.paths ??
    (typeof safety.path === "string" ? [safety.path] : null);
  const excludedPaths = new Set(
    (safety.excludedPaths ?? []).map(normalizedRepositoryPath),
  );
  const paths = sortedUnique(
    (explicitPaths ?? changedRepositoryPaths(repository))
      .map(normalizedRepositoryPath)
      .filter((path) => !excludedPaths.has(path)),
  );

  if (paths.length === 0) {
    throw new Error("Prepared fixture has no exact commit scope");
  }

  return {
    expectedScope: { kind: "paths", paths },
    scopeClarification: null,
  };
}

export function materializeEvaluationFixture({
  caseId,
  destination,
  repositoryRoot,
}) {
  if (!isAbsolute(destination)) {
    throw new Error("Fixture destination must be absolute");
  }

  if (existsSync(destination)) {
    throw new Error(`Fixture destination already exists: ${destination}`);
  }

  const evaluation = readEvaluation(repositoryRoot, caseId);
  const generator = join(
    repositoryRoot,
    "evals",
    "committing-to-git",
    "create-fixture-repository.mjs",
  );
  const result = spawnSync(
    process.execPath,
    [generator, "--scenario", evaluation.fixture, "--destination", destination],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      windowsHide: true,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Fixture generation failed (${result.status}): ${
        result.stderr || result.stdout
      }`,
    );
  }

  const metadata = JSON.parse(result.stdout);

  return {
    evaluation,
    initialState: captureGitState(destination),
    metadata,
    repository: destination,
  };
}

function parseTreeEntry(record) {
  const tab = record.indexOf("\t");
  const header = record.slice(0, tab).split(" ");

  if (tab < 0 || header.length !== 3) {
    throw new Error(`Unexpected git ls-tree record: ${record}`);
  }

  return {
    blobOid: header[2],
    mode: header[0],
    path: record.slice(tab + 1),
    type: header[1],
  };
}

export function extractPinnedSkill({ arm, destination, repositoryRoot }) {
  const sourceCommit = PINNED_SKILLS[arm];

  if (!sourceCommit) {
    throw new Error(`Arm ${JSON.stringify(arm)} has no pinned skill snapshot`);
  }

  if (!isAbsolute(destination)) {
    throw new Error("Skill extraction destination must be absolute");
  }

  if (existsSync(destination)) {
    throw new Error(
      `Skill extraction destination already exists: ${destination}`,
    );
  }

  const resolvedCommit = runGit(repositoryRoot, [
    "rev-parse",
    "--verify",
    `${sourceCommit}^{commit}`,
  ]).stdout.trim();

  if (resolvedCommit !== sourceCommit) {
    throw new Error(
      `Pinned skill commit resolved to ${resolvedCommit}, expected ${sourceCommit}`,
    );
  }

  const treeOutput = runGit(
    repositoryRoot,
    [
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      sourceCommit,
      "--",
      SKILL_REPOSITORY_PATH,
    ],
    { encoding: "buffer" },
  ).stdout.toString("utf8");
  const entries = treeOutput.split("\0").filter(Boolean).map(parseTreeEntry);

  if (entries.length === 0) {
    throw new Error(
      `Pinned commit ${sourceCommit} has no committing-to-git skill`,
    );
  }

  mkdirSync(destination, { recursive: false });
  const files = [];

  for (const entry of entries) {
    if (entry.type !== "blob") {
      throw new Error(
        `Unsupported ${entry.type} entry in pinned skill: ${entry.path}`,
      );
    }

    const prefix = `${SKILL_REPOSITORY_PATH}/`;

    if (!entry.path.startsWith(prefix)) {
      throw new Error(`Pinned skill path escaped its root: ${entry.path}`);
    }

    const relativePath = entry.path.slice(prefix.length);
    const outputPath = resolve(destination, relativePath);
    const expectedPrefix = `${resolve(destination)}${sep}`;

    if (!outputPath.startsWith(expectedPrefix)) {
      throw new Error(
        `Pinned skill path escaped its destination: ${entry.path}`,
      );
    }

    const contents = runGit(
      repositoryRoot,
      ["cat-file", "blob", entry.blobOid],
      { encoding: "buffer" },
    ).stdout;
    mkdirSync(resolve(outputPath, ".."), { recursive: true });
    writeFileSync(outputPath, contents);

    if (entry.mode === "100755") {
      chmodSync(outputPath, 0o755);
    }

    files.push({
      blobOid: entry.blobOid,
      bytes: contents.byteLength,
      mode: entry.mode,
      path: relativePath.split(sep).join("/"),
      sha256: sha256(contents),
    });
  }

  const skillEntry = files.find(({ path }) => path === "SKILL.md");

  if (!skillEntry) {
    throw new Error(`Pinned commit ${sourceCommit} has no SKILL.md`);
  }

  return {
    arm,
    files,
    skillEntry,
    skillPath: join(destination, "SKILL.md"),
    sourceCommit,
  };
}

export function prepareEvaluationSession({
  arm,
  authorizationEligible,
  caseId,
  destination,
  effort,
  model,
  predeterminedScopeId,
  provider,
  repetition,
  repositoryRoot,
  runtimeIsolationCatalog = {
    appIds: [],
    mcpServerIds: [],
    pluginIds: [],
    skillPaths: [],
  },
  runtimeIsolationDiscovery = null,
  seed,
  sequence,
}) {
  if (!ARMS.includes(arm)) {
    throw new Error(`Unknown evaluation arm ${JSON.stringify(arm)}`);
  }

  if (!isAbsolute(destination) || existsSync(destination)) {
    throw new Error(
      "Evaluation session destination must be an absolute nonexistent path",
    );
  }

  if (
    typeof model !== "string" ||
    typeof provider !== "string" ||
    typeof effort !== "string" ||
    typeof seed !== "string" ||
    !Number.isInteger(repetition) ||
    repetition < 1 ||
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    typeof authorizationEligible !== "boolean"
  ) {
    throw new TypeError("Evaluation session metadata is incomplete");
  }

  const evaluation = readEvaluation(repositoryRoot, caseId);
  mkdirSync(destination, { recursive: false });
  const runtimeHomes = {
    preflight: join(destination, "runtime-home-preflight"),
    run: join(destination, "runtime-home-run"),
  };

  for (const runtimeHome of Object.values(runtimeHomes)) {
    mkdirSync(runtimeHome, { mode: 0o700, recursive: false });
  }

  const fixtureRoot = join(destination, "fixture");
  const fixture = materializeEvaluationFixture({
    caseId,
    destination: fixtureRoot,
    repositoryRoot,
  });
  const scope = derivePreparedScope(
    fixture.metadata,
    fixtureRoot,
    predeterminedScopeId,
  );
  const treatment =
    arm === "no-skill"
      ? null
      : extractPinnedSkill({
          arm,
          destination: join(destination, "treatment"),
          repositoryRoot,
        });
  const transmission = {
    arm,
    authorizationEligible,
    baseInstructions: EVALUATION_BASE_INSTRUCTIONS,
    case: {
      caseKey: evaluation.case_key,
      costProfile: evaluation.cost_profile,
      criticalSafety: evaluation.critical_safety,
      expectations: evaluation.expectations,
      expectedOutput: evaluation.expected_output,
      id: evaluation.id,
      prompt: evaluation.prompt,
    },
    developerInstructions: EVALUATION_DEVELOPER_INSTRUCTIONS,
    effort,
    expectedScope: scope.expectedScope,
    fixture: {
      expected: fixture.metadata.expected,
      initialState: fixture.initialState,
      repository: fixtureRoot,
      scenario: fixture.metadata.scenario,
    },
    model,
    order: {
      blockId: `${model}/${effort}/${caseId}/${repetition}`,
      repetition,
      seed,
      sequence,
    },
    provider,
    scopeClarification: scope.scopeClarification,
    toolPolicy: {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      dynamicTools: [],
      environments: [],
      networkAccess: false,
      runtimeWorkspaceRoots: [fixtureRoot],
      runtimeIsolationOverrides: buildPreparedRuntimeIsolationOverrides({
        fixtureRoot,
        runtimeHomes,
        runtimeIsolationCatalog,
        runtimeIsolationDiscovery,
      }),
      runtimeIsolationCatalog,
      runtimeIsolationDiscovery,
      runtimeHomes,
      sandbox: "workspace-write",
      sequential: true,
      writableRoots: [fixtureRoot],
    },
    treatment: treatment
      ? {
          files: treatment.files,
          name: "committing-to-git",
          path: treatment.skillPath,
          sourceCommit: treatment.sourceCommit,
        }
      : null,
  };
  const packet = createTransmissionPacket(transmission);
  const packetPath = join(destination, "transmission-packet.json");

  writeRunRecordExclusive(packetPath, packet);

  return {
    fixtureRoot,
    packet,
    packetPath,
    sessionRoot: destination,
    skillPath: treatment?.skillPath ?? null,
  };
}

function assertTreatmentSnapshot(treatment) {
  if (treatment === null) {
    return [];
  }

  if (
    !treatment ||
    treatment.name !== "committing-to-git" ||
    !isAbsolute(treatment.path) ||
    !Array.isArray(treatment.files)
  ) {
    throw new Error("Prepared treatment metadata is invalid");
  }

  const root = dirname(treatment.path);
  const actual = listWorktreeFiles(root).map(
    ({ bytes, path, sha256: digest }) => ({
      bytes,
      path,
      sha256: digest,
    }),
  );
  const expected = treatment.files
    .map(({ bytes, path, sha256: digest }) => ({ bytes, path, sha256: digest }))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Prepared treatment bytes no longer match the packet");
  }

  if (!actual.some(({ path }) => path === "SKILL.md")) {
    throw new Error("Prepared treatment has no SKILL.md");
  }

  return [root];
}

function executionRecordSkeleton(packet) {
  return {
    arm: packet.transmission.arm,
    case: packet.transmission.case,
    effort: packet.transmission.effort,
    error: null,
    finalState: null,
    initialState: null,
    model: packet.transmission.model,
    order: packet.transmission.order,
    provider: packet.transmission.provider,
    schemaVersion: 1,
    session: null,
    sourceCommit: packet.transmission.treatment?.sourceCommit ?? null,
    status: "infrastructure-invalid",
    transmissionSha256: packet.transmissionSha256,
  };
}

export async function executePreparedEvaluationSession({
  allowExternalModelCall,
  appServer,
  authorization,
  packet,
  resultPath,
  sessionRunner = runAppServerSession,
  timeoutMs = 30_000,
}) {
  assertExternalModelAuthorization({
    allowExternalModelCall,
    authorization,
    packet,
  });

  const record = executionRecordSkeleton(packet);
  const transmission = packet.transmission;
  const fixtureRoot =
    typeof transmission.fixture?.repository === "string"
      ? transmission.fixture.repository
      : null;

  try {
    if (!fixtureRoot || !isAbsolute(fixtureRoot)) {
      throw new Error("Prepared fixture root is invalid");
    }

    if (transmission.toolPolicy.runtimeIsolationDiscovery) {
      assertRuntimeIsolationCurrent(transmission.toolPolicy);
    }

    const readableRoots = assertTreatmentSnapshot(transmission.treatment);
    const runtimeHome = preparedRuntimeHome(
      transmission.toolPolicy,
      fixtureRoot,
      "run",
    );
    record.initialState = captureGitState(fixtureRoot);

    if (
      record.initialState.sha256 !== transmission.fixture.initialState?.sha256
    ) {
      throw new Error("Prepared fixture state no longer matches the packet");
    }

    record.session = await sessionRunner({
      appServer: withRuntimeHome(appServer, runtimeHome),
      approvalContext: { fixtureRoot, readableRoots },
      session: {
        arm: transmission.arm,
        authorizationEligible: transmission.authorizationEligible,
        baseInstructions: transmission.baseInstructions,
        developerInstructions: transmission.developerInstructions,
        effort: transmission.effort,
        expectedScope: transmission.expectedScope,
        fixtureRoot,
        model: transmission.model,
        prompt: transmission.case.prompt,
        provider: transmission.provider,
        scopeClarification: transmission.scopeClarification ?? undefined,
        skill: transmission.treatment
          ? {
              name: transmission.treatment.name,
              path: transmission.treatment.path,
            }
          : undefined,
      },
      timeoutMs,
    });
    record.status = record.session.status;
    record.error = record.session.error;
  } catch (error) {
    record.status = "infrastructure-invalid";
    record.error = {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Error",
      stack: error instanceof Error ? error.stack : undefined,
    };
  } finally {
    if (fixtureRoot && isAbsolute(fixtureRoot) && existsSync(fixtureRoot)) {
      try {
        record.finalState = captureGitState(fixtureRoot);
      } catch (error) {
        record.status = "infrastructure-invalid";
        record.error ??= {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : "Error",
          stack: error instanceof Error ? error.stack : undefined,
        };
      }
    }

    writeRunRecordExclusive(resultPath, record);
  }

  return record;
}

export async function preflightPreparedEvaluationSession({
  appServer,
  packet,
  resultPath,
  timeoutMs = 30_000,
}) {
  assertTransmissionPacket(packet);
  const record = executionRecordSkeleton(packet);
  const transmission = packet.transmission;
  const fixtureRoot =
    typeof transmission.fixture?.repository === "string"
      ? transmission.fixture.repository
      : null;

  record.preflight = null;
  record.status = "infrastructure-invalid";

  try {
    if (!fixtureRoot || !isAbsolute(fixtureRoot)) {
      throw new Error("Prepared fixture root is invalid");
    }

    if (transmission.toolPolicy.runtimeIsolationDiscovery) {
      assertRuntimeIsolationCurrent(transmission.toolPolicy);
    }

    assertTreatmentSnapshot(transmission.treatment);
    const runtimeHome = preparedRuntimeHome(
      transmission.toolPolicy,
      fixtureRoot,
      "preflight",
    );
    record.initialState = captureGitState(fixtureRoot);

    if (
      record.initialState.sha256 !== transmission.fixture.initialState?.sha256
    ) {
      throw new Error("Prepared fixture state no longer matches the packet");
    }

    record.preflight = await preflightAppServerSession({
      appServer: withRuntimeHome(appServer, runtimeHome),
      baseInstructions: transmission.baseInstructions,
      developerInstructions: transmission.developerInstructions,
      fixtureRoot,
      model: transmission.model,
      provider: transmission.provider,
      timeoutMs,
    });
    record.status = record.preflight.status;
    record.error = record.preflight.error;
  } catch (error) {
    record.status = "infrastructure-invalid";
    record.error = {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Error",
      stack: error instanceof Error ? error.stack : undefined,
    };
  } finally {
    if (fixtureRoot && isAbsolute(fixtureRoot) && existsSync(fixtureRoot)) {
      try {
        record.finalState = captureGitState(fixtureRoot);

        if (
          record.initialState &&
          record.finalState.sha256 !== record.initialState.sha256
        ) {
          record.status = "infrastructure-invalid";
          record.error = {
            message: "App-server preflight changed the fixture Git state",
            name: "InfrastructureError",
          };
        }
      } catch (error) {
        record.status = "infrastructure-invalid";
        record.error ??= {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : "Error",
          stack: error instanceof Error ? error.stack : undefined,
        };
      }
    }

    writeRunRecordExclusive(resultPath, record);
  }

  return record;
}

function treatmentSecrets(records) {
  const secrets = new Set([...ARMS, ...Object.values(PINNED_SKILLS)]);

  function inspect(value) {
    if (!value || typeof value !== "object") {
      return;
    }

    if (
      value.type === "skill" &&
      typeof value.path === "string" &&
      isAbsolute(value.path)
    ) {
      secrets.add(value.path);
      secrets.add(dirname(value.path));
    }

    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        child.forEach(inspect);
      } else {
        inspect(child);
      }
    }
  }

  for (const record of records) {
    if (typeof record.sourceCommit === "string") {
      secrets.add(record.sourceCommit);
    }
    inspect(record);
  }

  return [...secrets]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function sanitizedGradingValue(value, secrets) {
  if (typeof value === "string") {
    let sanitized = value;

    for (const secret of secrets) {
      sanitized = sanitized.replaceAll(secret, "[redacted-treatment-identity]");
    }

    return sanitized;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry?.type !== "skill")
      .map((entry) => sanitizedGradingValue(entry, secrets));
  }

  const sanitized = {};
  const excludedKeys = new Set([
    "arm",
    "seed",
    "sourceCommit",
    "transmissionSha256",
    "treatment",
  ]);

  for (const [childKey, child] of Object.entries(value)) {
    if (excludedKeys.has(childKey)) {
      continue;
    }

    sanitized[childKey] = sanitizedGradingValue(child, secrets);
  }

  return sanitized;
}

export function createBlindedGradingBundle({ records, seed }) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Blind grading requires run records");
  }

  if (typeof seed !== "string" || seed.length === 0) {
    throw new Error("Blind grading requires a non-empty seed");
  }

  const blocks = new Map();

  for (const record of records) {
    const blockId = record.order?.blockId;

    if (typeof blockId !== "string" || !ARMS.includes(record.arm)) {
      throw new Error("Run record has no valid matched block identity");
    }

    const block = blocks.get(blockId) ?? [];
    block.push(record);
    blocks.set(blockId, block);
  }

  const secrets = treatmentSecrets(records);
  const mapping = { blocks: {}, schemaVersion: 1, seed };
  const sessions = [];

  for (const blockId of [...blocks.keys()].sort((left, right) =>
    left.localeCompare(right, "en"),
  )) {
    const block = blocks.get(blockId);
    const arms = new Set(block.map(({ arm }) => arm));

    if (block.length !== ARMS.length || arms.size !== ARMS.length) {
      throw new Error(
        `Matched block ${blockId} must contain each arm exactly once`,
      );
    }

    const randomized = [...block].sort((left, right) =>
      stableOrderKey(seed, `${blockId}/${left.arm}`).localeCompare(
        stableOrderKey(seed, `${blockId}/${right.arm}`),
      ),
    );
    const blockMapping = {};

    randomized.forEach((record, index) => {
      const armLabel = String.fromCharCode("A".charCodeAt(0) + index);
      blockMapping[armLabel] = record.arm;
      sessions.push({
        ...sanitizedGradingValue(record, secrets),
        armLabel,
        blindSessionId: sha256(`${seed}\0${blockId}\0${record.arm}`).slice(
          0,
          24,
        ),
      });
    });
    mapping.blocks[blockId] = blockMapping;
  }

  const gradingPackage = { schemaVersion: 1, sessions };
  const serialized = JSON.stringify(gradingPackage);

  for (const secret of secrets) {
    if (serialized.includes(secret)) {
      throw new Error("Blind grading payload retained a treatment identity");
    }
  }

  return { gradingPackage, mapping };
}

export const EVALUATION_ARMS = ARMS;
export const EVALUATION_CASE_IDS = MATRIX_CASE_IDS;
export const EVALUATION_MODELS = MODELS;
export const EVALUATION_BASE_PROMPT = EVALUATION_BASE_INSTRUCTIONS;
export const EVALUATION_DEVELOPER_PROMPT = EVALUATION_DEVELOPER_INSTRUCTIONS;
export const EXTERNAL_MODEL_AUTHORIZATION_STATEMENT =
  MODEL_AUTHORIZATION_STATEMENT;
export { EXACT_COMMIT_AUTHORIZATION_REPLY };
export const PINNED_SKILL_COMMITS = PINNED_SKILLS;
