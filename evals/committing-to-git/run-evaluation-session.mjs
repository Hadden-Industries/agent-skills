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
  assertEvaluationCampaignRepositoryCurrent,
  createBlindedGradingBundle,
  createEvaluationCampaignPlan,
  createPolicyEvaluationCampaignPlan,
  discoverRuntimeIsolationCatalog,
  executePreparedEvaluationSession,
  listPolicyEvaluationCaseIds,
  preflightPreparedEvaluationSession,
  prepareEvaluationSession,
  preparePolicyEvaluationSession,
  resolvePushedEvaluationCandidate,
  selectEvaluationCampaignSession,
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

function campaignSession(options, expectedCommand, repositoryRoot) {
  const campaignPath = resolve(required(options, "campaign-plan"));
  const campaign = readJson(campaignPath, "evaluation campaign plan");

  if (campaign.command !== expectedCommand) {
    fail(
      `Campaign plan ${campaignPath} is for ${JSON.stringify(
        campaign.command,
      )}, expected ${JSON.stringify(expectedCommand)}`,
    );
  }

  const session = selectEvaluationCampaignSession(
    campaign,
    positiveInteger(options, "sequence"),
  );
  assertEvaluationCampaignRepositoryCurrent(repositoryRoot, campaign.candidate);

  return {
    campaignId: campaign.campaignId,
    session,
  };
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
  const repositoryRoot = resolve(options["repository-root"] ?? process.cwd());
  const seed = required(options, "seed");
  const plan = createEvaluationCampaignPlan({
    candidate: resolvePushedEvaluationCandidate(repositoryRoot),
    seed,
  });

  writeArtifactOrOutput(options, plan, {
    campaignId: plan.campaignId,
    candidateCommit: plan.candidate.commitOid,
    command: "plan",
    modelCalls: 0,
    schemaVersion: plan.schemaVersion,
    sessionCount: plan.sessions.length,
  });
}

async function runPolicyPlan(options) {
  const repositoryRoot = resolve(options["repository-root"] ?? process.cwd());
  const seed = required(options, "seed");
  const plan = createPolicyEvaluationCampaignPlan({
    candidate: resolvePushedEvaluationCandidate(repositoryRoot),
    seed,
    provider: required(options, "provider"),
    model: required(options, "model"),
    effort: required(options, "effort"),
    repetitions: positiveInteger(options, "repetitions"),
    caseIds: listPolicyEvaluationCaseIds(repositoryRoot),
  });
  writeArtifactOrOutput(options, plan, {
    campaignId: plan.campaignId,
    candidateCommit: plan.candidate.commitOid,
    command: "policy-plan",
    modelCalls: 0,
    schemaVersion: plan.schemaVersion,
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
  const repositoryRoot = resolve(options["repository-root"] ?? process.cwd());
  const { campaignId, session } = campaignSession(
    options,
    "plan",
    repositoryRoot,
  );
  const catalogDocument = readJson(
    resolve(required(options, "isolation-catalog")),
    "isolation catalog",
  );
  const runtimeIsolationCatalog = catalogDocument.catalog ?? catalogDocument;

  if (!catalogDocument.discovery) {
    fail("Isolation catalog must be created by the catalog command");
  }
  if (
    typeof catalogDocument.discovery.repositoryRoot !== "string" ||
    resolve(catalogDocument.discovery.repositoryRoot) !== repositoryRoot
  ) {
    fail("Isolation catalog repository does not match the campaign repository");
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
    arm: session.arm,
    authorizationEligible: booleanValue(options, "authorization-eligible"),
    campaignId,
    caseId: session.caseId,
    destination: resolve(required(options, "destination")),
    effort: session.effort,
    evaluationHomesRoot: options["evaluation-homes-root"]
      ? resolve(options["evaluation-homes-root"])
      : evaluationHomesRootFromLocalAppData(process.env.LOCALAPPDATA),
    environment: environmentProfile(),
    model: session.model,
    predeterminedScopeId: options["predetermined-scope-id"],
    provider: session.provider,
    repetition: session.repetition,
    repositoryRoot,
    runtimeIsolationCatalog,
    runtimeIsolationDiscovery: catalogDocument.discovery,
    seed: session.seed,
    sequence: session.sequence,
    sourceCommit: session.sourceCommit,
    toolchain,
  });

  writeOutput({
    arm: session.arm,
    campaignId,
    caseId: session.caseId,
    command: "prepare",
    fixtureRoot: prepared.fixtureRoot,
    modelCalls: 0,
    packetPath: join(prepared.preparedSession, "packet.json"),
    schemaVersion: 1,
    sequence: session.sequence,
    sessionRoot: prepared.preparedSession,
    transmissionSha256: prepared.packet.transmissionSha256,
  });
}

async function runPreparePolicy(options) {
  const repositoryRoot = resolve(options["repository-root"] ?? process.cwd());
  const { campaignId, session } = campaignSession(
    options,
    "policy-plan",
    repositoryRoot,
  );
  const environment = environmentProfile();
  const toolchain = await inspectAntigravityCliToolchain({
    ...antigravityToolchainCommand(options),
    environment,
  });
  const prepared = await preparePolicyEvaluationSession({
    arm: session.arm,
    campaignId,
    caseId: session.caseId,
    destination: resolve(required(options, "destination")),
    effort: session.effort,
    environment,
    model: session.model,
    provider: session.provider,
    repetition: session.repetition,
    repositoryRoot,
    seed: session.seed,
    sequence: session.sequence,
    sourceCommit: session.sourceCommit,
    toolchain,
    workingDirectory: resolve(required(options, "working-dir")),
  });
  writeOutput({
    arm: session.arm,
    campaignId,
    caseId: session.caseId,
    command: "prepare-policy",
    modelCalls: 0,
    packetPath: join(prepared.preparedSession, "packet.json"),
    profile: "policy-only",
    schemaVersion: 1,
    sequence: session.sequence,
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
      campaignId: metadata.campaignId,
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
    assertAllowedOptions(options, ["output", "repository-root", "seed"]);
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
      "authorization-eligible",
      "campaign-plan",
      "codex-command",
      "codex-entry",
      "destination",
      "evaluation-homes-root",
      "isolation-catalog",
      "predetermined-scope-id",
      "repository-root",
      "sequence",
    ]);
    await runPrepare(options);
  } else if (command === "prepare-policy") {
    assertAllowedOptions(options, [
      "antigravity-command",
      "antigravity-prefix-arg",
      "campaign-plan",
      "destination",
      "repository-root",
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
