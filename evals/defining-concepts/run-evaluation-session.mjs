import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";

import {
  claudeCliAdapter,
  inspectClaudeCliToolchain,
  preflightClaudeAuth,
} from "../../scripts/evaluation/claude-cli.js";
import {
  codexAppServerAdapter,
  inspectCodexAppServerToolchain,
} from "../../scripts/evaluation/codex-app-server.js";
import {
  evaluationHomesRootFromLocalAppData,
  inspectEvaluationHomes,
  withEvaluationHome,
} from "../../scripts/evaluation/evaluation-homes.js";
import {
  canonicalJsonBytes,
  createTransmissionPacket,
  executeAuthorizedModelSession,
  prepareEvidenceSession,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";
import { createDefiningConceptController } from "./session-controller.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");
const CONTROLLER_PATH = path.join(
  import.meta.dirname,
  "session-controller.mjs",
);
const HARNESS = `# Isolated behavioral evaluation

Do not inspect local files, repository metadata, memories, plugins, commands,
or discoverable skills. Use only the user's prompt, live web search, and the
task-specific skill text below when one is present.
If unrelated task-specific skill material becomes visible, output
BASELINE_CONTAMINATION and stop. Do not mention this harness in an otherwise
valid final answer.
`;
const EMPTY_MCP = '{"mcpServers":{}}';
const RUNTIME_MODULES = [
  "evals/defining-concepts/run-evaluation-session.mjs",
  "evals/defining-concepts/session-controller.mjs",
  "scripts/evaluation/runtime.js",
  "scripts/evaluation/evaluation-homes.js",
  "scripts/evaluation/codex-app-server.js",
  "scripts/evaluation/claude-cli.js",
];

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const command = argv[0];
  if (!new Set(["prepare", "run"]).has(command)) {
    fail("First argument must be prepare or run");
  }
  const values = new Map();
  const repeated = new Map([
    ["--codex-prefix-arg", []],
    ["--claude-prefix-arg", []],
  ]);
  const switches = new Set(["--allow-external-model-call"]);
  for (let index = 1; index < argv.length; index += 1) {
    const name = argv[index];
    if (switches.has(name)) {
      if (values.has(name)) fail(`Duplicate argument: ${name}`);
      values.set(name, true);
      continue;
    }
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      fail(`Expected --name value; received ${name ?? "end of input"}`);
    }
    index += 1;
    if (repeated.has(name)) repeated.get(name).push(value);
    else if (values.has(name)) fail(`Duplicate argument: ${name}`);
    else values.set(name, value);
  }
  return { command, values, repeated };
}

function requireValue(values, name) {
  const value = values.get(name);
  if (typeof value !== "string" || value.length === 0) {
    fail(`Missing required argument: ${name}`);
  }
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail(`${name} must be a positive integer`);
  }
  return parsed;
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

function inputRecord(id, role, mediaType, content) {
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

function fingerprint() {
  const git = (argument) =>
    execFileSync("git", ["rev-parse", argument], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  return {
    gitCommit: git("HEAD"),
    gitTree: git("HEAD^{tree}"),
    modules: RUNTIME_MODULES.map((relativePath) => {
      const bytes = readFileSync(path.join(REPOSITORY_ROOT, relativePath));
      return {
        path: relativePath,
        byteLength: bytes.byteLength,
        sha256: sha256Hex(bytes),
      };
    }),
  };
}

function assertNewDirectory(directory, label) {
  if (path.resolve(directory) !== directory) fail(`${label} must be absolute`);
  if (existsSync(directory)) fail(`${label} must be a new directory`);
}

function prepareWorkingDirectory(directory) {
  if (path.resolve(directory) !== directory)
    fail("working directory must be absolute");
  if (!existsSync(directory)) {
    mkdirSync(directory);
    return;
  }
  if (readdirSync(directory).length !== 0) {
    fail("working directory must be empty and non-repository");
  }
}

function instructionText(skill) {
  return skill === null
    ? HARNESS
    : `${HARNESS}\n# Task-specific skill\n\n${skill}`;
}

function preparedInputs(transmission) {
  return transmission.harnessControlledInputs.map(
    ({ id, mediaType, content }) => ({
      id,
      mediaType,
      bytes: Buffer.from(content, "utf8"),
    }),
  );
}

async function prepare(options) {
  const { values, repeated } = options;
  const promptPath = path.resolve(requireValue(values, "--prompt-file"));
  const destination = path.resolve(requireValue(values, "--destination"));
  const workingDirectory = path.resolve(requireValue(values, "--working-dir"));
  const arm = requireValue(values, "--arm");
  const providerOption = requireValue(values, "--provider");
  const model = requireValue(values, "--model");
  const effort = requireValue(values, "--effort");
  const evalId = positiveInteger(
    requireValue(values, "--eval-id"),
    "--eval-id",
  );
  const repetition = positiveInteger(
    requireValue(values, "--repetition"),
    "--repetition",
  );
  if (!new Set(["with_skill", "without_skill"]).has(arm))
    fail(`Unsupported arm: ${arm}`);
  if (!new Set(["codex", "claude"]).has(providerOption))
    fail(`Unsupported provider: ${providerOption}`);
  const skillPath = values.get("--skill-file")
    ? path.resolve(values.get("--skill-file"))
    : null;
  if (arm === "with_skill" && skillPath === null)
    fail("with_skill requires --skill-file");
  if (arm === "without_skill" && skillPath !== null)
    fail("without_skill forbids --skill-file");
  assertNewDirectory(destination, "destination");
  prepareWorkingDirectory(workingDirectory);

  const prompt = readFileSync(promptPath, "utf8");
  const skill = skillPath === null ? null : readFileSync(skillPath, "utf8");
  const instructions = instructionText(skill);
  const environment = environmentProfile();
  const provider = providerOption === "codex" ? "openai" : "anthropic";
  const capabilities =
    provider === "openai"
      ? { network: true, webSearch: true, tools: [], providerFacilities: [] }
      : {
          network: true,
          webSearch: true,
          tools: ["WebSearch", "WebFetch"],
          providerFacilities: [],
        };
  const preparedSessionId = randomBytes(16).toString("hex");
  let toolchain;
  let authentication = null;
  let evaluationHomesRoot = null;
  if (provider === "openai") {
    const scratch = mkdtempSync(path.join(tmpdir(), "codex-toolchain-"));
    try {
      toolchain = await inspectCodexAppServerToolchain({
        command: values.get("--codex-command") ?? "codex",
        prefixArguments: repeated.get("--codex-prefix-arg"),
        scratchRoot: path.join(scratch, "inspection"),
        environment,
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    evaluationHomesRoot = values.get("--evaluation-homes-root")
      ? path.resolve(values.get("--evaluation-homes-root"))
      : evaluationHomesRootFromLocalAppData(process.env.LOCALAPPDATA);
    const inventory = await inspectEvaluationHomes({
      root: evaluationHomesRoot,
    });
    if (!inventory.valid)
      fail("evaluation homes root is not initialized and valid");
  } else {
    toolchain = await inspectClaudeCliToolchain({
      command: values.get("--claude-command") ?? "claude",
      prefixArguments: repeated.get("--claude-prefix-arg"),
      environment,
    });
    authentication = await preflightClaudeAuth({
      toolchain,
      environment,
      timeoutMs: 5_000,
    });
    if (authentication.status !== "authenticated")
      fail("Claude authentication preflight failed");
  }

  const settings = JSON.stringify({
    schemaVersion: 1,
    authentication,
    evaluationHomesRoot,
    maxBudgetUsd: values.get("--max-budget-usd") ?? "2",
  });
  if (!/^\d+(?:\.\d+)?$/u.test(JSON.parse(settings).maxBudgetUsd)) {
    fail("--max-budget-usd must be a nonnegative decimal string");
  }
  const base =
    provider === "openai"
      ? "Use only the packet-bound evaluation inputs."
      : null;
  const inputs =
    provider === "openai"
      ? [
          inputRecord("prompt", "user", "text/plain", prompt),
          inputRecord("base-instructions", "base", "text/plain", base),
          inputRecord(
            "instructions",
            "developer",
            "text/markdown",
            instructions,
          ),
          inputRecord(
            "runner-settings",
            "configuration",
            "application/json",
            settings,
          ),
        ]
      : [
          inputRecord("prompt", "user", "text/plain", prompt),
          inputRecord("instructions", "system", "text/markdown", instructions),
          inputRecord(
            "empty-mcp-config",
            "configuration",
            "application/json",
            EMPTY_MCP,
          ),
          inputRecord(
            "runner-settings",
            "configuration",
            "application/json",
            settings,
          ),
        ];
  const isolation =
    provider === "openai"
      ? {
          sandbox: "read-only",
          workingDirectory,
          runtimeWorkspaceRoots: [workingDirectory],
          instructionSources: [],
          persistence: false,
          environment: { values: environment, secretSources: [] },
        }
      : {
          sandbox: "read-only",
          workingDirectory,
          instructionSources: [],
          persistence: false,
          stableHome: null,
          environment: { values: environment, secretSources: [] },
        };
  const transmission = {
    suite: "defining-concepts",
    session: {
      preparedSessionId,
      caseId: evalId,
      arm,
      repetition,
      sequence: 1,
      suiteArtifacts: [],
    },
    provider,
    model,
    effort,
    transport: provider === "openai" ? "codex-app-server" : "claude-cli",
    toolchain,
    runtimeFingerprint: fingerprint(),
    capabilities,
    isolation,
    harnessControlledInputs: inputs,
    continuationPolicy: {
      controllerSha256: sha256Hex(readFileSync(CONTROLLER_PATH)),
      maxTurns: 1,
      allowedTransitions: [],
      templates: [],
    },
  };
  const packet = createTransmissionPacket(transmission);
  const prepared = await prepareEvidenceSession({
    destination,
    packet,
    inputs: preparedInputs(transmission),
  });
  process.stdout.write(`${JSON.stringify(prepared)}\n`);
}

function inputPathMap(directory) {
  const manifest = JSON.parse(
    readFileSync(path.join(directory, "inputs", "manifest.json"), "utf8"),
  );
  return Object.fromEntries(
    manifest.inputs.map(({ id, relativePath }) => [
      id,
      path.join(directory, ...relativePath.split("/")),
    ]),
  );
}

function assertRuntimeCurrent(expected) {
  const current = fingerprint();
  if (!canonicalJsonBytes(current).equals(canonicalJsonBytes(expected))) {
    fail("runtime fingerprint changed after preparation");
  }
}

async function run(options) {
  const { values } = options;
  const preparedSession = path.resolve(
    requireValue(values, "--prepared-session"),
  );
  const authorizationPath = path.resolve(
    requireValue(values, "--authorization"),
  );
  if (values.get("--allow-external-model-call") !== true)
    fail("run requires --allow-external-model-call");
  const timeoutMs = values.has("--timeout-ms")
    ? positiveInteger(values.get("--timeout-ms"), "--timeout-ms")
    : 120_000;
  let authorization;
  try {
    authorization = JSON.parse(readFileSync(authorizationPath, "utf8"));
  } catch (error) {
    fail(`Unable to read authorization file: ${error.message}`);
  }
  const packet = JSON.parse(
    readFileSync(path.join(preparedSession, "packet.json"), "utf8"),
  );
  const transmission = packet.transmission;
  const paths = inputPathMap(preparedSession);
  const settingsInput = transmission.harnessControlledInputs.find(
    ({ id }) => id === "runner-settings",
  );
  if (settingsInput === undefined) fail("prepared runner settings are missing");
  const settings = JSON.parse(settingsInput.content);
  const promptInput = transmission.harnessControlledInputs.find(
    ({ id }) => id === "prompt",
  );
  const initialInput = Object.freeze([
    Object.freeze({ type: "text", text: promptInput.content }),
  ]);
  const controller = createDefiningConceptController({ initialInput });
  let adapter;
  let request;
  if (transmission.provider === "openai") {
    const base = transmission.harnessControlledInputs.find(
      ({ id }) => id === "base-instructions",
    ).content;
    const developer = transmission.harnessControlledInputs.find(
      ({ id }) => id === "instructions",
    ).content;
    const policy = {
      schemaVersion: 1,
      provider: "openai",
      model: transmission.model,
      effort: transmission.effort,
      instructions: { base, developer },
      capabilities: transmission.capabilities,
      isolation: transmission.isolation,
    };
    adapter = codexAppServerAdapter;
    request = Object.freeze({
      toolchain: transmission.toolchain,
      policy,
      controller,
      timeoutMs,
      withHome: (operation) =>
        withEvaluationHome(
          {
            root: settings.evaluationHomesRoot,
            role: "execution",
            operationId: transmission.session.preparedSessionId,
          },
          operation,
        ),
    });
  } else if (transmission.provider === "anthropic") {
    adapter = claudeCliAdapter;
    request = Object.freeze({
      toolchain: transmission.toolchain,
      authentication: settings.authentication,
      controller,
      timeoutMs,
      maxBudgetUsd: settings.maxBudgetUsd,
      inputIds: Object.freeze({
        prompt: "prompt",
        instructions: "instructions",
        mcpConfig: "empty-mcp-config",
      }),
      inputPaths: Object.freeze({
        prompt: paths.prompt,
        instructions: paths.instructions,
        mcpConfig: paths["empty-mcp-config"],
      }),
    });
  } else {
    fail(`Unsupported prepared provider: ${transmission.provider}`);
  }
  const result = await executeAuthorizedModelSession({
    preparedSession,
    allowExternalModelCall: true,
    authorization,
    assertCurrent: async (current) => {
      assertRuntimeCurrent(current.runtimeFingerprint);
      if (
        sha256Hex(readFileSync(CONTROLLER_PATH)) !==
        current.continuationPolicy.controllerSha256
      ) {
        fail("session controller changed after preparation");
      }
    },
    adapter,
    request,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "completed") process.exitCode = 1;
}

const parsed = parseArguments(process.argv.slice(2));
(parsed.command === "prepare" ? prepare(parsed) : run(parsed)).catch(
  (error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  },
);
