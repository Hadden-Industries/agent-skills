import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
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
  codexAppServerAdapter,
  preflightCodexAppServer,
} from "../../scripts/evaluation/codex-app-server.js";
import { withEvaluationHome } from "../../scripts/evaluation/evaluation-homes.js";
import {
  assertTransmissionPacket,
  canonicalJsonBytes,
  createTransmissionPacket,
  executeAuthorizedModelSession,
  prepareEvidenceSession,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";
import {
  EXACT_COMMIT_AUTHORIZATION_REPLY,
  createCommittingToGitController,
} from "./session-controller.mjs";

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
const EVALUATION_BASE_INSTRUCTIONS =
  "Work only inside the supplied disposable Git fixture. Treat every other local or external source as unavailable.";
const EVALUATION_DEVELOPER_INSTRUCTIONS =
  "Follow the user request with the available local tools. Do not use the network, apps, plugins, MCP servers, subagents, or undisclosed skills. Before any commit, emit exactly one structured evaluation proposal; when materially different scopes remain plausible, emit exactly one structured scope question before staging or preparation.";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function assertRuntimeIsolationCurrent(toolPolicy) {
  const discovery = toolPolicy?.runtimeIsolationDiscovery;
  const preparedCatalog = toolPolicy?.runtimeIsolationCatalog;

  if (!discovery || !preparedCatalog) {
    throw new Error("Prepared packet has no reproducible isolation catalog");
  }

  const currentCatalog = discoverRuntimeIsolationCatalog(discovery);

  if (
    !canonicalJsonBytes(currentCatalog).equals(
      canonicalJsonBytes(preparedCatalog),
    )
  ) {
    throw new Error(
      "Runtime isolation catalog changed after packet preparation",
    );
  }

  return currentCatalog;
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

function materializeEvaluationFixture({ caseId, destination, repositoryRoot }) {
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

function extractPinnedSkill({ arm, destination, repositoryRoot }) {
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

const EXECUTION_MODULES = Object.freeze([
  "evals/committing-to-git/evaluation-runner.mjs",
  "evals/committing-to-git/session-controller.mjs",
  "scripts/evaluation/runtime.js",
  "scripts/evaluation/evaluation-homes.js",
  "scripts/evaluation/codex-app-server.js",
]);

function packetInput(id, role, mediaType, content) {
  const bytes = Buffer.from(content, "utf8");
  return {
    id,
    role,
    mediaType,
    encoding: "utf8",
    content,
    byteLength: bytes.byteLength,
    sha256: sha256Hex(bytes),
  };
}

function runtimeFingerprint(repositoryRoot) {
  const git = (argument) =>
    execFileSync("git", ["rev-parse", argument], {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  return {
    gitCommit: git("HEAD"),
    gitTree: git("HEAD^{tree}"),
    modules: EXECUTION_MODULES.map((modulePath) => {
      const bytes = readFileSync(join(repositoryRoot, modulePath));
      return {
        path: modulePath,
        byteLength: bytes.byteLength,
        sha256: sha256Hex(bytes),
      };
    }),
  };
}

function suiteContext(transmission) {
  const input = transmission.harnessControlledInputs.find(
    ({ id }) => id === "suite-context",
  );
  if (input === undefined) throw new Error("Prepared suite context is missing");
  return JSON.parse(input.content);
}

function preparedPath(preparedSession) {
  return typeof preparedSession === "string"
    ? resolve(preparedSession)
    : resolve(preparedSession.preparedSession);
}

function preparedPacket(preparedSession) {
  const directory = preparedPath(preparedSession);
  const bytes = readFileSync(join(directory, "packet.json"));
  const packet = JSON.parse(bytes.toString("utf8"));
  assertTransmissionPacket(packet);
  if (!bytes.equals(canonicalJsonBytes(packet))) {
    throw new Error("Prepared packet bytes are not canonical");
  }
  return { directory, packet };
}

function policyFor(transmission) {
  const byRole = (role) =>
    transmission.harnessControlledInputs.find((input) => input.role === role)
      ?.content;
  return {
    schemaVersion: 1,
    provider: "openai",
    model: transmission.model,
    effort: transmission.effort,
    instructions: { base: byRole("base"), developer: byRole("developer") },
    capabilities: transmission.capabilities,
    isolation: transmission.isolation,
  };
}

function immutableValue(value) {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value)) immutableValue(child);
  return Object.freeze(value);
}

function controllerFor(transmission, context) {
  const prompt = transmission.harnessControlledInputs.find(
    ({ role }) => role === "user",
  )?.content;
  const session = immutableValue({
    initialInput: [{ type: "text", text: prompt }],
    fixtureRoot: transmission.isolation.workingDirectory,
    expectedScope: context.expectedScope,
    scopeClarification: context.scopeClarification,
    authorizationEligible: context.authorizationEligible,
    approvalPolicy: { readableRoots: [] },
  });
  return createCommittingToGitController({
    session,
    observeGitState: captureGitState,
  });
}

function assertPreparedCurrent(transmission, context) {
  const currentFingerprint = runtimeFingerprint(context.repositoryRoot);
  if (
    !canonicalJsonBytes(currentFingerprint).equals(
      canonicalJsonBytes(transmission.runtimeFingerprint),
    )
  ) {
    throw new Error("Evaluation runtime changed after preparation");
  }
  if (context.runtimeIsolationDiscovery) {
    assertRuntimeIsolationCurrent({
      runtimeIsolationCatalog: context.runtimeIsolationCatalog,
      runtimeIsolationDiscovery: context.runtimeIsolationDiscovery,
      runtimeIsolationOverrides: context.runtimeIsolationOverrides,
      runtimeWorkspaceRoots: [transmission.isolation.workingDirectory],
    });
  }
  const state = captureGitState(transmission.isolation.workingDirectory);
  if (state.sha256 !== context.fixtureInitialState.sha256) {
    throw new Error("Prepared fixture state no longer matches the packet");
  }
  if (context.treatment !== null) {
    const actual = listWorktreeFiles(context.treatment.root).map(
      ({ bytes, path, sha256: digest }) => ({ bytes, path, sha256: digest }),
    );
    const expected = context.treatment.files
      .map(({ bytes, path, sha256: digest }) => ({
        bytes,
        path,
        sha256: digest,
      }))
      .sort((left, right) => left.path.localeCompare(right.path, "en"));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error("Prepared treatment bytes no longer match the packet");
    }
  }
}

export async function prepareEvaluationSession({
  arm,
  authorizationEligible,
  caseId,
  destination,
  effort,
  evaluationHomesRoot,
  environment,
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
  toolchain,
}) {
  if (!ARMS.includes(arm)) throw new Error(`Unknown evaluation arm ${arm}`);
  if (!isAbsolute(destination) || existsSync(destination)) {
    throw new Error(
      "Evaluation session destination must be an absolute nonexistent path",
    );
  }
  if (provider !== "openai")
    throw new Error("Committing-to-git evaluations require OpenAI");
  if (!isAbsolute(evaluationHomesRoot))
    throw new Error("evaluationHomesRoot must be absolute");
  const staging = `${destination}.staging-${randomBytes(8).toString("hex")}`;
  mkdirSync(staging);
  try {
    const evaluation = readEvaluation(repositoryRoot, caseId);
    const stagedFixture = join(staging, "fixture");
    const finalFixture = join(destination, "fixture");
    const fixture = materializeEvaluationFixture({
      caseId,
      destination: stagedFixture,
      repositoryRoot,
    });
    const scope = derivePreparedScope(
      fixture.metadata,
      stagedFixture,
      predeterminedScopeId,
    );
    const treatment =
      arm === "no-skill"
        ? null
        : extractPinnedSkill({
            arm,
            destination: join(staging, "treatment"),
            repositoryRoot,
          });
    const treatmentText = treatment
      ? readFileSync(treatment.skillPath, "utf8")
      : null;
    const developerInstructions =
      treatmentText === null
        ? EVALUATION_DEVELOPER_INSTRUCTIONS
        : `${EVALUATION_DEVELOPER_INSTRUCTIONS}\n\n# Task-specific skill\n\n${treatmentText}`;
    const context = {
      schemaVersion: 1,
      authorizationEligible,
      case: {
        caseKey: evaluation.case_key,
        costProfile: evaluation.cost_profile,
        criticalSafety: evaluation.critical_safety,
        expectations: evaluation.expectations,
        expectedOutput: evaluation.expected_output,
        id: evaluation.id,
      },
      evaluationHomesRoot,
      expectedScope: scope.expectedScope,
      fixtureInitialState: fixture.initialState,
      fixtureMetadata: fixture.metadata,
      repositoryRoot,
      runtimeIsolationCatalog,
      runtimeIsolationDiscovery,
      runtimeIsolationOverrides: null,
      scopeClarification: scope.scopeClarification,
      sourceCommit: treatment?.sourceCommit ?? null,
      treatment: treatment
        ? {
            files: treatment.files,
            root: join(destination, "treatment"),
            sourceCommit: treatment.sourceCommit,
          }
        : null,
    };
    const inputs = [
      packetInput(
        "base-instructions",
        "base",
        "text/plain",
        EVALUATION_BASE_INSTRUCTIONS,
      ),
      packetInput(
        "developer-instructions",
        "developer",
        "text/markdown",
        developerInstructions,
      ),
      packetInput("prompt", "user", "text/plain", evaluation.prompt),
      packetInput(
        "suite-context",
        "configuration",
        "application/json",
        JSON.stringify(context),
      ),
    ];
    const templates = [];
    if (scope.scopeClarification) {
      const id = scope.scopeClarification.predeterminedScopeId;
      const paths = scope.scopeClarification.options[id];
      const text = `<EVALUATION_SCOPE_SELECTION>\n${JSON.stringify({ paths, scopeId: id })}\n</EVALUATION_SCOPE_SELECTION>`;
      inputs.push(
        packetInput("scope-selection", "continuation", "text/plain", text),
      );
      templates.push({
        transitionId: "predetermined-scope-selection",
        input: [{ type: "text", text }],
      });
    }
    inputs.push(
      packetInput(
        "commit-authorization",
        "continuation",
        "text/plain",
        EXACT_COMMIT_AUTHORIZATION_REPLY,
      ),
    );
    templates.push({
      transitionId: "exact-commit-authorization",
      input: [{ type: "text", text: EXACT_COMMIT_AUTHORIZATION_REPLY }],
    });
    const transmission = {
      suite: "committing-to-git",
      session: {
        preparedSessionId: randomBytes(16).toString("hex"),
        caseId,
        arm,
        repetition,
        sequence,
        metadata: {
          blockId: `${model}/${effort}/${caseId}/${repetition}`,
          caseKey: evaluation.case_key,
          seed,
          sourceCommit: treatment?.sourceCommit ?? null,
        },
        suiteArtifacts: [],
      },
      provider,
      model,
      effort,
      transport: "codex-app-server",
      toolchain,
      runtimeFingerprint: runtimeFingerprint(repositoryRoot),
      capabilities: {
        network: false,
        webSearch: false,
        tools: ["commandExecution", "fileChange"],
        providerFacilities: [],
      },
      isolation: {
        sandbox: "workspace-write",
        workingDirectory: finalFixture,
        runtimeWorkspaceRoots: [finalFixture],
        instructionSources: [],
        persistence: false,
        environment: { values: environment, secretSources: [] },
      },
      harnessControlledInputs: inputs,
      continuationPolicy: {
        controllerSha256: sha256Hex(
          readFileSync(
            join(
              repositoryRoot,
              "evals",
              "committing-to-git",
              "session-controller.mjs",
            ),
          ),
        ),
        maxTurns: scope.scopeClarification ? 3 : 2,
        allowedTransitions: templates.map(({ transitionId }) => transitionId),
        templates,
      },
    };
    const packet = createTransmissionPacket(transmission);
    const prepared = await prepareEvidenceSession({
      destination,
      packet,
      inputs: inputs.map(({ id, mediaType, content }) => ({
        id,
        mediaType,
        bytes: Buffer.from(content, "utf8"),
      })),
    });
    renameSync(stagedFixture, finalFixture);
    if (treatment)
      renameSync(join(staging, "treatment"), join(destination, "treatment"));
    return Object.freeze({
      ...prepared,
      fixtureRoot: finalFixture,
      packet,
      skillPath: treatment ? join(destination, "treatment", "SKILL.md") : null,
    });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export async function preflightPreparedEvaluationSession({
  preparedSession,
  allowZeroTurnPreflight,
  timeoutMs = 30_000,
  signal,
}) {
  if (allowZeroTurnPreflight !== true) {
    throw new Error("preflight requires literal allowZeroTurnPreflight");
  }
  const { directory, packet } = preparedPacket(preparedSession);
  const transmission = packet.transmission;
  const context = suiteContext(transmission);
  assertPreparedCurrent(transmission, context);
  return preflightCodexAppServer({
    toolchain: transmission.toolchain,
    policy: policyFor(transmission),
    withHome: (operation) =>
      withEvaluationHome(
        {
          root: context.evaluationHomesRoot,
          role: "preflight",
          operationId: transmission.session.preparedSessionId,
        },
        operation,
      ),
    evidenceDestination: join(directory, "preflight"),
    timeoutMs,
    signal,
  });
}

export async function executePreparedEvaluationSession({
  preparedSession,
  authorization,
  allowExternalModelCall,
  timeoutMs = 30_000,
  signal,
}) {
  const { directory, packet } = preparedPacket(preparedSession);
  const transmission = packet.transmission;
  const context = suiteContext(transmission);
  const controller = controllerFor(transmission, context);
  const result = await executeAuthorizedModelSession({
    preparedSession: directory,
    authorization,
    allowExternalModelCall,
    assertCurrent: async (current) => assertPreparedCurrent(current, context),
    adapter: codexAppServerAdapter,
    request: Object.freeze({
      toolchain: transmission.toolchain,
      policy: policyFor(transmission),
      controller,
      timeoutMs,
      withHome: (operation) =>
        withEvaluationHome(
          {
            root: context.evaluationHomesRoot,
            role: "execution",
            operationId: transmission.session.preparedSessionId,
          },
          operation,
        ),
    }),
    signal,
  });
  return result;
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
export const PINNED_SKILL_COMMITS = PINNED_SKILLS;
