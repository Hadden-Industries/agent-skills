import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  buildCodexAppServerArguments,
  buildEvaluationSchedule,
  createBlindedGradingBundle,
  discoverRuntimeIsolationCatalog,
  executePreparedEvaluationSession,
  preflightPreparedEvaluationSession,
  prepareEvaluationSession,
  writeJsonArtifactExclusive,
} from "./evaluation-runner.mjs";

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

    if (Object.hasOwn(options, name)) {
      fail(`Duplicate option ${flag}`);
    }

    if (name === "allow-external-model-call") {
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

function writeArtifactOrOutput(options, value, summary) {
  if (!options.output) {
    writeOutput(value);
    return;
  }

  const artifactPath = resolve(options.output);
  writeJsonArtifactExclusive(artifactPath, value);
  writeOutput({ ...summary, artifactPath });
}

function codexAppServer(options, runtimeOverrides) {
  const appServerArguments = buildCodexAppServerArguments(runtimeOverrides);

  if (options["codex-entry"]) {
    return {
      args: [resolve(options["codex-entry"]), ...appServerArguments],
      command: options["codex-command"] ?? process.execPath,
    };
  }

  if (options["codex-command"]) {
    return {
      args: appServerArguments,
      command: options["codex-command"],
    };
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
      args: [npmEntry, ...appServerArguments],
      command: process.execPath,
    };
  }

  return { args: appServerArguments, command: "codex" };
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
  const prepared = prepareEvaluationSession({
    arm: required(options, "arm"),
    authorizationEligible: booleanValue(options, "authorization-eligible"),
    caseId: positiveInteger(options, "case-id"),
    destination: resolve(required(options, "destination")),
    effort: required(options, "effort"),
    model: required(options, "model"),
    predeterminedScopeId: options["predetermined-scope-id"],
    provider: required(options, "provider"),
    repetition: positiveInteger(options, "repetition"),
    repositoryRoot: resolve(options["repository-root"] ?? process.cwd()),
    runtimeIsolationCatalog,
    runtimeIsolationDiscovery: catalogDocument.discovery,
    seed: required(options, "seed"),
    sequence: positiveInteger(options, "sequence"),
  });

  writeOutput({
    command: "prepare",
    fixtureRoot: prepared.fixtureRoot,
    modelCalls: 0,
    packetPath: prepared.packetPath,
    schemaVersion: 1,
    sessionRoot: prepared.sessionRoot,
    transmissionSha256: prepared.packet.transmissionSha256,
  });
}

async function runExecute(options) {
  const packetPath = resolve(required(options, "packet"));
  const authorizationPath = resolve(required(options, "authorization"));
  const resultPath = resolve(required(options, "result"));
  const packet = readJson(packetPath, "transmission packet");
  const authorization = readJson(authorizationPath, "authorization");
  const runtimeOverrides =
    packet.transmission?.toolPolicy?.runtimeIsolationOverrides?.run;

  if (!Array.isArray(runtimeOverrides)) {
    fail("Transmission packet has no runtime isolation overrides");
  }

  const record = await executePreparedEvaluationSession({
    allowExternalModelCall: options["allow-external-model-call"] === true,
    appServer: codexAppServer(options, runtimeOverrides),
    authorization,
    packet,
    resultPath,
    timeoutMs: options["timeout-ms"]
      ? positiveInteger(options, "timeout-ms")
      : 30_000,
  });

  writeOutput({
    command: "run",
    modelTurns: record.session?.turns?.length ?? 0,
    resultPath,
    schemaVersion: 1,
    status: record.status,
    transmissionSha256: record.transmissionSha256,
  });
}

async function runPreflight(options) {
  const packetPath = resolve(required(options, "packet"));
  const resultPath = resolve(required(options, "result"));
  const packet = readJson(packetPath, "transmission packet");
  const runtimeOverrides =
    packet.transmission?.toolPolicy?.runtimeIsolationOverrides?.preflight;

  if (!Array.isArray(runtimeOverrides)) {
    fail("Transmission packet has no runtime isolation overrides");
  }

  const record = await preflightPreparedEvaluationSession({
    appServer: codexAppServer(options, runtimeOverrides),
    packet,
    resultPath,
    timeoutMs: options["timeout-ms"]
      ? positiveInteger(options, "timeout-ms")
      : 30_000,
  });

  writeOutput({
    command: "preflight",
    modelTurns: record.preflight?.modelTurns ?? 0,
    resultPath,
    schemaVersion: 1,
    status: record.status,
    transmissionSha256: record.transmissionSha256,
  });
}

async function runBlind(options) {
  const manifestPath = resolve(required(options, "records-manifest"));
  const manifest = readJson(manifestPath, "record manifest");

  if (!Array.isArray(manifest.records) || manifest.records.length === 0) {
    fail("Record manifest must contain a non-empty records array");
  }

  const records = manifest.records.map((path) =>
    readJson(resolve(dirname(manifestPath), path), "run record"),
  );
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
    await runPlan(options);
  } else if (command === "catalog") {
    await runCatalog(options);
  } else if (command === "prepare") {
    await runPrepare(options);
  } else if (command === "run") {
    await runExecute(options);
  } else if (command === "preflight") {
    await runPreflight(options);
  } else if (command === "blind") {
    await runBlind(options);
  } else {
    fail(
      "Usage: run-evaluation-session.mjs <plan|catalog|prepare|preflight|run|blind> [options]",
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
