import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  buildEvaluationSchedule,
  buildPolicyEvaluationSchedule,
  createBlindedGradingBundle,
  discoverRuntimeIsolationCatalog,
  executePreparedEvaluationSession,
  listPolicyEvaluationCaseIds,
  preflightPreparedEvaluationSession,
  prepareEvaluationSession,
  preparePolicyEvaluationSession,
} from "./evaluation-runner.mjs";
import { inspectAntigravityCliToolchain } from "../../scripts/evaluation/antigravity-cli.js";
import { inspectCodexAppServerToolchain } from "../../scripts/evaluation/codex-app-server.js";
import { evaluationHomesRootFromLocalAppData } from "../../scripts/evaluation/evaluation-homes.js";

function fail(message) {
  throw new Error(message);
}

function parseOptions(tokens) {
  const options = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const flag = tokens[index];

    if (!flag?.startsWith("--")) {
      fail(`Unexpected argument ${JSON.stringify(flag)}`);
    }

    const name = flag.slice(2);

    if (name === "antigravity-prefix-arg") {
      const value = tokens[index + 1];
      if (value === undefined) fail(`Option ${flag} requires a value`);
      options[name] ??= [];
      options[name].push(value);
      index += 1;
      continue;
    }

    if (Object.hasOwn(options, name)) {
      fail(`Duplicate option ${flag}`);
    }

    if (
      name === "allow-external-model-call" ||
      name === "allow-zero-turn-preflight"
    ) {
      options[name] = true;
      continue;
    }

    const value = tokens[index + 1];

    if (value === undefined || value.startsWith("--")) {
      fail(`Option ${flag} requires a value`);
    }

    options[name] = value;
    index += 1;
  }

  return options;
}

function required(options, name) {
  const value = options[name];

  if (typeof value !== "string" || value.length === 0) {
    fail(`Missing required option --${name}`);
  }

  return value;
}

function assertAllowedOptions(options, allowed) {
  const allowedNames = new Set(allowed);
  for (const name of Object.keys(options)) {
    if (!allowedNames.has(name)) {
      fail(`Option --${name} is not valid for this command`);
    }
  }
}

function positiveInteger(options, name) {
  const value = Number(required(options, name));

  if (!Number.isInteger(value) || value < 1) {
    fail(`Option --${name} must be a positive integer`);
  }

  return value;
}

function booleanValue(options, name) {
  const value = required(options, name);

  if (!["true", "false"].includes(value)) {
    fail(`Option --${name} must be true or false`);
  }

  return value === "true";
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${label} ${path}: ${error.message}`, {
      cause: error,
    });
  }
}

function writeOutput(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// Operator-selected plan and blinding outputs are outside immutable session
// evidence, whose exclusive writes are owned by scripts/evaluation/runtime.js.
function writeJsonArtifactExclusive(destination, value) {
  writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function writeArtifactOrOutput(options, value, summary) {
  if (!options.output) {
    writeOutput(value);
    return;
  }

  const artifactPath = resolve(options.output);
  writeJsonArtifactExclusive(artifactPath, value);
  writeOutput({ ...summary, artifactPath });
}

function codexToolchainCommand(options) {
  if (options["codex-entry"]) {
    return {
      prefixArguments: [resolve(options["codex-entry"])],
      command: options["codex-command"] ?? process.execPath,
    };
  }

  if (options["codex-command"]) {
    return { prefixArguments: [], command: options["codex-command"] };
  }

  const npmEntry = process.env.APPDATA
    ? join(
        process.env.APPDATA,
        "npm",
        "node_modules",
        "@openai",
        "codex",
        "bin",
        "codex.js",
      )
    : null;

  if (process.platform === "win32" && npmEntry && existsSync(npmEntry)) {
    return {
      prefixArguments: [npmEntry],
      command: process.execPath,
    };
  }

  return { prefixArguments: [], command: "codex" };
}

function antigravityToolchainCommand(options) {
  const command = required(options, "antigravity-command");
  if (!isAbsolute(command)) {
    fail("Option --antigravity-command must be an absolute path");
  }
  return {
    command,
    prefixArguments: options["antigravity-prefix-arg"] ?? [],
  };
}

function environmentProfile() {
  const names =
    process.platform === "win32"
      ? [
          "HOMEDRIVE",
          "HOMEPATH",
          "LOGONSERVER",
          "PATH",
          "PATHEXT",
          "SYSTEMDRIVE",
          "SYSTEMROOT",
          "TEMP",
          "TMP",
          "USERDOMAIN",
          "USERNAME",
          "USERPROFILE",
          "WINDIR",
        ]
      : ["HOME", "LANG", "PATH", "SHELL", "TMPDIR", "USER"];
  return Object.fromEntries(
    names
      .filter((name) => typeof process.env[name] === "string")
      .map((name) => [name, process.env[name]]),
  );
}

async function runPlan(options) {
  const seed = required(options, "seed");

  const plan = {
    command: "plan",
    modelCalls: 0,
    schemaVersion: 1,
    seed,
    sessions: buildEvaluationSchedule(seed),
  };

  writeArtifactOrOutput(options, plan, {
    command: "plan",
    modelCalls: 0,
    schemaVersion: 1,
    sessionCount: plan.sessions.length,
  });
}

async function runPolicyPlan(options) {
  const repositoryRoot = resolve(options["repository-root"] ?? process.cwd());
  const seed = required(options, "seed");
  const plan = {
    command: "policy-plan",
    modelCalls: 0,
    schemaVersion: 1,
    seed,
    sessions: buildPolicyEvaluationSchedule({
      seed,
      provider: required(options, "provider"),
      model: required(options, "model"),
      effort: required(options, "effort"),
      repetitions: positiveInteger(options, "repetitions"),
      caseIds: listPolicyEvaluationCaseIds(repositoryRoot),
    }),
  };
  writeArtifactOrOutput(options, plan, {
    command: "policy-plan",
    modelCalls: 0,
    schemaVersion: 1,
    sessionCount: plan.sessions.length,
  });
}

async function runCatalog(options) {
  const repositoryRoot = resolve(options["repository-root"] ?? process.cwd());
  const codexHome = resolve(
    options["codex-home"] ??
      process.env.CODEX_HOME ??
      join(homedir(), ".codex"),
  );

  const document = {
    catalog: discoverRuntimeIsolationCatalog({ codexHome, repositoryRoot }),
    command: "catalog",
    discovery: { codexHome, repositoryRoot },
    modelCalls: 0,
    schemaVersion: 1,
  };

  writeArtifactOrOutput(options, document, {
    appCount: document.catalog.appIds.length,
    command: "catalog",
    mcpServerCount: document.catalog.mcpServerIds.length,
    modelCalls: 0,
    pluginCount: document.catalog.pluginIds.length,
    schemaVersion: 1,
    skillCount: document.catalog.skillPaths.length,
  });
}

async function runPrepare(options) {
  const catalogDocument = readJson(
    resolve(required(options, "isolation-catalog")),
    "isolation catalog",
  );
  const runtimeIsolationCatalog = catalogDocument.catalog ?? catalogDocument;

  if (!catalogDocument.discovery) {
    fail("Isolation catalog must be created by the catalog command");
  }
  const command = codexToolchainCommand(options);
  const scratch = mkdtempSync(join(tmpdir(), "committing-to-git-toolchain-"));
  let toolchain;
  try {
    toolchain = await inspectCodexAppServerToolchain({
      ...command,
      scratchRoot: join(scratch, "inspection"),
      environment: environmentProfile(),
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const prepared = await prepareEvaluationSession({
    arm: required(options, "arm"),
    authorizationEligible: booleanValue(options, "authorization-eligible"),
    caseId: positiveInteger(options, "case-id"),
    destination: resolve(required(options, "destination")),
    effort: required(options, "effort"),
    evaluationHomesRoot: options["evaluation-homes-root"]
      ? resolve(options["evaluation-homes-root"])
      : evaluationHomesRootFromLocalAppData(process.env.LOCALAPPDATA),
    environment: environmentProfile(),
    model: required(options, "model"),
    predeterminedScopeId: options["predetermined-scope-id"],
    provider: required(options, "provider"),
    repetition: positiveInteger(options, "repetition"),
    repositoryRoot: resolve(options["repository-root"] ?? process.cwd()),
    runtimeIsolationCatalog,
    runtimeIsolationDiscovery: catalogDocument.discovery,
    seed: required(options, "seed"),
    sequence: positiveInteger(options, "sequence"),
    toolchain,
  });

  writeOutput({
    command: "prepare",
    fixtureRoot: prepared.fixtureRoot,
    modelCalls: 0,
    packetPath: join(prepared.preparedSession, "packet.json"),
    schemaVersion: 1,
    sessionRoot: prepared.preparedSession,
    transmissionSha256: prepared.packet.transmissionSha256,
  });
}

async function runPreparePolicy(options) {
  const environment = environmentProfile();
  const toolchain = await inspectAntigravityCliToolchain({
    ...antigravityToolchainCommand(options),
    environment,
  });
  const prepared = await preparePolicyEvaluationSession({
    arm: required(options, "arm"),
    caseId: positiveInteger(options, "case-id"),
    destination: resolve(required(options, "destination")),
    effort: required(options, "effort"),
    environment,
    model: required(options, "model"),
    provider: required(options, "provider"),
    repetition: positiveInteger(options, "repetition"),
    repositoryRoot: resolve(options["repository-root"] ?? process.cwd()),
    seed: required(options, "seed"),
    sequence: positiveInteger(options, "sequence"),
    toolchain,
    workingDirectory: resolve(required(options, "working-dir")),
  });
  writeOutput({
    command: "prepare-policy",
    modelCalls: 0,
    packetPath: join(prepared.preparedSession, "packet.json"),
    profile: "policy-only",
    schemaVersion: 1,
    sessionRoot: prepared.preparedSession,
    transmissionSha256: prepared.packet.transmissionSha256,
    workingDirectory: prepared.workingDirectory,
  });
}

async function runExecute(options) {
  const authorizationPath = resolve(required(options, "authorization"));
  const authorization = readJson(authorizationPath, "authorization");
  const record = await executePreparedEvaluationSession({
    preparedSession: resolve(required(options, "prepared-session")),
    allowExternalModelCall: options["allow-external-model-call"] === true,
    authorization,
    timeoutMs: options["timeout-ms"]
      ? positiveInteger(options, "timeout-ms")
      : 30_000,
  });

  writeOutput({
    command: "run",
    modelTurns: record.status === "completed" ? 1 : 0,
    resultPath: join(
      resolve(required(options, "prepared-session")),
      "run.json",
    ),
    schemaVersion: 1,
    status: record.status,
    transmissionSha256: authorization.transmissionSha256,
  });
}

async function runPreflight(options) {
  const record = await preflightPreparedEvaluationSession({
    preparedSession: resolve(required(options, "prepared-session")),
    allowZeroTurnPreflight: options["allow-zero-turn-preflight"] === true,
    timeoutMs: options["timeout-ms"]
      ? positiveInteger(options, "timeout-ms")
      : 30_000,
  });

  writeOutput({
    command: "preflight",
    modelTurns: 0,
    resultPath: join(
      resolve(required(options, "prepared-session")),
      "preflight",
      "preflight.json",
    ),
    schemaVersion: 1,
    status: record.status,
    transmissionSha256: readJson(
      join(resolve(required(options, "prepared-session")), "packet.json"),
      "transmission packet",
    ).transmissionSha256,
  });
}

async function runBlind(options) {
  const manifestPath = resolve(required(options, "records-manifest"));
  const manifest = readJson(manifestPath, "record manifest");

  if (!Array.isArray(manifest.records) || manifest.records.length === 0) {
    fail("Record manifest must contain a non-empty records array");
  }

  const records = manifest.records.map((path) => {
    const runPath = resolve(dirname(manifestPath), path);
    const record = readJson(runPath, "run record");
    const packet = readJson(
      join(dirname(runPath), "packet.json"),
      "transmission packet",
    );
    const transmission = packet.transmission;
    const metadata = transmission.session.metadata;
    return {
      ...record,
      arm: transmission.session.arm,
      case: {
        id: transmission.session.caseId,
        caseKey: metadata.caseKey,
      },
      effort: transmission.effort,
      model: transmission.model,
      order: {
        blockId: metadata.blockId,
        repetition: transmission.session.repetition,
        seed: metadata.seed,
        sequence: transmission.session.sequence,
      },
      provider: transmission.provider,
      sourceCommit: metadata.sourceCommit,
    };
  });
  const bundle = createBlindedGradingBundle({
    records,
    seed: required(options, "seed"),
  });
  const packagePath = resolve(required(options, "package"));
  const mappingPath = resolve(required(options, "mapping"));

  if (packagePath === mappingPath) {
    fail("Blind package and private mapping require different paths");
  }

  writeJsonArtifactExclusive(packagePath, bundle.gradingPackage);
  writeJsonArtifactExclusive(mappingPath, bundle.mapping);
  writeOutput({
    command: "blind",
    mappingPath,
    modelCalls: 0,
    packagePath,
    schemaVersion: 1,
    sessionCount: bundle.gradingPackage.sessions.length,
  });
}

async function main() {
  const [command, ...tokens] = process.argv.slice(2);
  const options = parseOptions(tokens);

  if (command === "plan") {
    assertAllowedOptions(options, ["seed", "output"]);
    await runPlan(options);
  } else if (command === "policy-plan") {
    assertAllowedOptions(options, [
      "effort",
      "model",
      "output",
      "provider",
      "repetitions",
      "repository-root",
      "seed",
    ]);
    await runPolicyPlan(options);
  } else if (command === "catalog") {
    assertAllowedOptions(options, ["repository-root", "codex-home", "output"]);
    await runCatalog(options);
  } else if (command === "prepare") {
    assertAllowedOptions(options, [
      "arm",
      "authorization-eligible",
      "case-id",
      "codex-command",
      "codex-entry",
      "destination",
      "effort",
      "evaluation-homes-root",
      "isolation-catalog",
      "model",
      "predetermined-scope-id",
      "provider",
      "repetition",
      "repository-root",
      "seed",
      "sequence",
    ]);
    await runPrepare(options);
  } else if (command === "prepare-policy") {
    assertAllowedOptions(options, [
      "antigravity-command",
      "antigravity-prefix-arg",
      "arm",
      "case-id",
      "destination",
      "effort",
      "model",
      "provider",
      "repetition",
      "repository-root",
      "seed",
      "sequence",
      "working-dir",
    ]);
    await runPreparePolicy(options);
  } else if (command === "run") {
    assertAllowedOptions(options, [
      "prepared-session",
      "authorization",
      "allow-external-model-call",
      "timeout-ms",
    ]);
    await runExecute(options);
  } else if (command === "preflight") {
    assertAllowedOptions(options, [
      "prepared-session",
      "allow-zero-turn-preflight",
      "timeout-ms",
    ]);
    await runPreflight(options);
  } else if (command === "blind") {
    assertAllowedOptions(options, [
      "records-manifest",
      "seed",
      "package",
      "mapping",
    ]);
    await runBlind(options);
  } else {
    fail(
      "Usage: run-evaluation-session.mjs <plan|policy-plan|catalog|prepare|prepare-policy|preflight|run|blind> [options]",
    );
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
