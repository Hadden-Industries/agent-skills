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
  antigravityCliAdapter,
  inspectAntigravityCliToolchain,
} from "../../scripts/evaluation/antigravity-cli.js";
import {
  codexAppServerAdapter,
  inspectCodexAppServerToolchain,
  preflightCodexAppServer,
} from "../../scripts/evaluation/codex-app-server.js";
import {
  evaluationHomesRootFromLocalAppData,
  inspectEvaluationHomes,
  withEvaluationHome,
} from "../../scripts/evaluation/evaluation-homes.js";
import {
  assertTransmissionPacket,
  canonicalJsonBytes,
  createTransmissionPacket,
  executeAuthorizedModelSession,
  prepareEvidenceSession,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";
import {
  createScriptedContinuationPolicy,
  normalizeEvaluationConversation,
} from "../../scripts/evaluation/scripted-conversation.js";
import { renderSkillBundle } from "../../scripts/evaluation/skill-bundle.js";
import { createDefiningConceptController } from "./session-controller.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");
const CONTROLLER_PATH = path.join(
  import.meta.dirname,
  "session-controller.mjs",
);
const SCRIPTED_CONTROLLER_PATH = path.join(
  REPOSITORY_ROOT,
  "scripts",
  "evaluation",
  "scripted-conversation.js",
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
const COMMON_RUNTIME_MODULES = [
  "evals/defining-concepts/run-evaluation-session.mjs",
  "evals/defining-concepts/session-controller.mjs",
  "scripts/evaluation/scripted-conversation.js",
  "scripts/evaluation/skill-bundle.js",
  "scripts/evaluation/runtime.js",
];
const PROVIDER_RUNTIME_MODULES = Object.freeze({
  anthropic: ["scripts/evaluation/claude-cli.js"],
  google: ["scripts/evaluation/antigravity-cli.js"],
  openai: [
    "scripts/evaluation/evaluation-homes.js",
    "scripts/evaluation/windows-path-metadata.js",
    "scripts/evaluation/windows-path-probe.ps1",
    "scripts/evaluation/codex-app-server.js",
  ],
});
const ANTIGRAVITY_HARNESS = `# Isolated behavioral evaluation

Do not inspect local files, repository metadata, memories, plugins, commands,
discoverable skills, web search, or network sources. Do not use tools or
subagents. Use only the task-specific skill text below when one is present and
the user task embedded in this exact message.
If unrelated task-specific skill material becomes visible, output
BASELINE_CONTAMINATION and stop. Do not mention this harness in an otherwise
valid final answer.
`;

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const command = argv[0];
  if (!new Set(["prepare", "preflight", "run"]).has(command)) {
    fail("First argument must be prepare, preflight, or run");
  }
  const values = new Map();
  const repeated = new Map([
    ["--antigravity-prefix-arg", []],
    ["--codex-prefix-arg", []],
    ["--claude-prefix-arg", []],
  ]);
  const switches = new Set([
    "--allow-external-model-call",
    "--allow-zero-turn-preflight",
  ]);
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

function readJsonFile(filePath, label) {
  let value;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((name, index) => name !== expected[index])
  ) {
    fail(`${label} contains missing or unknown members`);
  }
}

function validateSkillBundle(bundle, arm) {
  exactKeys(
    bundle,
    ["aggregateSha256", "files", "schemaVersion", "skillName", "source"],
    "skill bundle",
  );
  if (bundle.schemaVersion !== 1 || bundle.skillName !== "defining-concepts") {
    fail("skill bundle identity is invalid");
  }
  if (!Array.isArray(bundle.files) || bundle.files.length === 0) {
    fail("skill bundle files must be nonempty");
  }
  let previousPath = null;
  for (const [index, file] of bundle.files.entries()) {
    exactKeys(
      file,
      ["byteLength", "content", "path", "sha256"],
      `skill bundle file ${index}`,
    );
    if (
      typeof file.path !== "string" ||
      !file.path.startsWith("skills/defining-concepts/") ||
      file.path.includes("\\") ||
      file.path.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      fail(`skill bundle file ${index} has an invalid path`);
    }
    if (previousPath !== null && Buffer.compare(Buffer.from(previousPath), Buffer.from(file.path)) >= 0) {
      fail("skill bundle files must use unique stable path order");
    }
    previousPath = file.path;
    if (typeof file.content !== "string") {
      fail(`skill bundle file ${index} content must be text`);
    }
    const bytes = Buffer.from(file.content, "utf8");
    if (file.byteLength !== bytes.byteLength || file.sha256 !== sha256Hex(bytes)) {
      fail(`skill bundle file ${index} digest does not match its content`);
    }
  }
  if (!bundle.files.some((file) => file.path === "skills/defining-concepts/SKILL.md")) {
    fail("skill bundle is missing skills/defining-concepts/SKILL.md");
  }
  const payload = {
    schemaVersion: bundle.schemaVersion,
    skillName: bundle.skillName,
    source: bundle.source,
    files: bundle.files,
  };
  if (bundle.aggregateSha256 !== sha256Hex(canonicalJsonBytes(payload))) {
    fail("skill bundle aggregate digest does not match its contents");
  }
  if (arm === "current-skill" && bundle.source?.kind !== "git") {
    fail("current-skill requires a committed Git skill bundle");
  }
  if (arm === "candidate-skill" && bundle.source?.kind !== "working-tree") {
    fail("candidate-skill requires a working-tree skill bundle");
  }
  return bundle;
}

function controllerDigest() {
  return sha256Hex(
    canonicalJsonBytes([
      {
        path: "evals/defining-concepts/session-controller.mjs",
        sha256: sha256Hex(readFileSync(CONTROLLER_PATH)),
      },
      {
        path: "scripts/evaluation/scripted-conversation.js",
        sha256: sha256Hex(readFileSync(SCRIPTED_CONTROLLER_PATH)),
      },
    ]),
  );
}

function withInitialText(conversation, text) {
  return Object.freeze([
    Object.freeze({
      id: "prompt",
      input: Object.freeze({ type: "text", text }),
    }),
    ...conversation.slice(1),
  ]);
}

function fingerprint(provider) {
  if (!Object.hasOwn(PROVIDER_RUNTIME_MODULES, provider)) {
    fail(`Unsupported fingerprint provider: ${provider}`);
  }
  const git = (argument) =>
    execFileSync("git", ["rev-parse", argument], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  return {
    gitCommit: git("HEAD"),
    gitTree: git("HEAD^{tree}"),
    modules: [
      ...COMMON_RUNTIME_MODULES,
      ...PROVIDER_RUNTIME_MODULES[provider],
    ].map((relativePath) => {
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

function assertOutsideRepository(directory) {
  let cursor = path.resolve(directory);
  while (true) {
    if (existsSync(path.join(cursor, ".git"))) {
      fail("Antigravity working directory must not be inside a repository");
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

function instructionText(skill, webSearch) {
  const harness = webSearch
    ? HARNESS
    : HARNESS.replace(
        "the user's prompt, live web search, and the",
        "the user's prompt and the",
      );
  return skill === null
    ? harness
    : `${harness}\n# Task-specific skill\n\n${skill}`;
}

function antigravityPrompt(prompt, skill) {
  const treatment =
    skill === null
      ? ""
      : `\n# Task-specific skill\n\n${skill}${skill.endsWith("\n") ? "" : "\n"}`;
  return `${ANTIGRAVITY_HARNESS}${treatment}\n# User task\n\n${prompt}`;
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
  const casePath = path.resolve(requireValue(values, "--case-file"));
  const destination = path.resolve(requireValue(values, "--destination"));
  const workingDirectory = path.resolve(requireValue(values, "--working-dir"));
  const arm = requireValue(values, "--arm");
  const providerOption = requireValue(values, "--provider");
  const model = requireValue(values, "--model");
  const effort = requireValue(values, "--effort");
  const repetition = positiveInteger(
    requireValue(values, "--repetition"),
    "--repetition",
  );
  if (!new Set(["no-skill", "current-skill", "candidate-skill"]).has(arm))
    fail(`Unsupported arm: ${arm}`);
  if (repetition !== 1) fail("defining-concepts sessions require repetition 1");
  if (!new Set(["antigravity", "codex", "claude"]).has(providerOption))
    fail(`Unsupported provider: ${providerOption}`);
  const bundlePath = values.get("--skill-bundle-file")
    ? path.resolve(values.get("--skill-bundle-file"))
    : null;
  if (arm !== "no-skill" && bundlePath === null)
    fail(`${arm} requires --skill-bundle-file`);
  if (arm === "no-skill" && bundlePath !== null)
    fail("no-skill forbids --skill-bundle-file");
  assertNewDirectory(destination, "destination");
  prepareWorkingDirectory(workingDirectory);
  if (providerOption === "antigravity") {
    assertOutsideRepository(workingDirectory);
  }

  const evaluationCase = readJsonFile(casePath, "evaluation case");
  const evalId = positiveInteger(evaluationCase.id, "evaluation case id");
  const declaredConversation = normalizeEvaluationConversation(evaluationCase);
  if (providerOption === "claude" && declaredConversation.length > 1) {
    fail("Claude CLI evaluation sessions do not support scripted follow-up turns");
  }
  const bundle =
    bundlePath === null
      ? null
      : validateSkillBundle(readJsonFile(bundlePath, "skill bundle"), arm);
  const renderedBundle = bundle === null ? null : renderSkillBundle(bundle);
  const environment = environmentProfile();
  const provider =
    providerOption === "codex"
      ? "openai"
      : providerOption === "claude"
        ? "anthropic"
        : "google";
  const capabilities =
    provider === "openai"
      ? { network: false, webSearch: false, tools: [], providerFacilities: [] }
      : provider === "anthropic"
        ? {
            network: true,
            webSearch: true,
            tools: ["WebSearch", "WebFetch"],
            providerFacilities: [],
          }
        : {
            network: false,
            webSearch: false,
            tools: [],
            providerFacilities: ["provider-default-context"],
          };
  const instructions = instructionText(renderedBundle, capabilities.webSearch);
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
  } else if (provider === "anthropic") {
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
  } else {
    const command = requireValue(values, "--antigravity-command");
    if (!path.isAbsolute(command)) {
      fail("--antigravity-command must be an absolute path");
    }
    toolchain = await inspectAntigravityCliToolchain({
      command,
      prefixArguments: repeated.get("--antigravity-prefix-arg"),
      environment,
    });
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
  const caseContent = canonicalJsonBytes(evaluationCase).toString("utf8");
  const bundleContent =
    bundle === null ? null : canonicalJsonBytes(bundle).toString("utf8");
  const initialPrompt = declaredConversation[0].input.text;
  const providerInitialPrompt =
    provider === "google"
      ? antigravityPrompt(initialPrompt, renderedBundle)
      : initialPrompt;
  const conversation = withInitialText(
    declaredConversation,
    providerInitialPrompt,
  );
  const continuationInputs = declaredConversation
    .slice(1)
    .map((turn, index) =>
      inputRecord(
        `follow-up-${String(index + 1).padStart(2, "0")}`,
        "continuation",
        "text/plain",
        turn.input.text,
      ),
    );
  const inputs =
    provider === "openai"
      ? [
          inputRecord("prompt", "user", "text/plain", providerInitialPrompt),
          ...continuationInputs,
          inputRecord(
            "evaluation-case",
            "configuration",
            "application/json",
            caseContent,
          ),
          ...(bundleContent === null
            ? []
            : [
                inputRecord(
                  "skill-bundle",
                  "configuration",
                  "application/json",
                  bundleContent,
                ),
              ]),
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
      : provider === "anthropic"
        ? [
            inputRecord("prompt", "user", "text/plain", providerInitialPrompt),
            ...continuationInputs,
            inputRecord(
              "evaluation-case",
              "configuration",
              "application/json",
              caseContent,
            ),
            ...(bundleContent === null
              ? []
              : [
                  inputRecord(
                    "skill-bundle",
                    "configuration",
                    "application/json",
                    bundleContent,
                  ),
                ]),
            inputRecord(
              "instructions",
              "system",
              "text/markdown",
              instructions,
            ),
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
          ]
        : [
            inputRecord(
              "prompt",
              "user",
              "text/markdown",
              providerInitialPrompt,
            ),
            ...continuationInputs,
            inputRecord(
              "evaluation-case",
              "configuration",
              "application/json",
              caseContent,
            ),
            ...(bundleContent === null
              ? []
              : [
                  inputRecord(
                    "skill-bundle",
                    "configuration",
                    "application/json",
                    bundleContent,
                  ),
                ]),
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
          sandbox: "workspace-write",
          workingDirectory,
          runtimeWorkspaceRoots: [workingDirectory],
          instructionSources: [],
          persistence: false,
          environment: { values: environment, secretSources: [] },
        }
      : provider === "anthropic"
        ? {
            sandbox: "read-only",
            workingDirectory,
            instructionSources: [],
            persistence: false,
            stableHome: null,
            environment: { values: environment, secretSources: [] },
          }
        : {
            sandbox: "read-only",
            workingDirectory,
            instructionSources: ["packet-bound-user-message"],
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
      metadata: {
        conversationTurnIds: declaredConversation.map(({ id }) => id),
        skillBundleAggregateSha256: bundle?.aggregateSha256 ?? null,
        skillBundleSource: bundle?.source ?? null,
      },
      suiteArtifacts: [],
    },
    provider,
    model,
    effort,
    transport:
      provider === "openai"
        ? "codex-app-server"
        : provider === "anthropic"
          ? "claude-cli"
          : "antigravity-cli",
    toolchain,
    runtimeFingerprint: fingerprint(provider),
    capabilities,
    isolation,
    harnessControlledInputs: inputs,
    continuationPolicy: createScriptedContinuationPolicy({
      conversation,
      controllerSha256: controllerDigest(),
    }),
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

function assertRuntimeCurrent(expected, provider) {
  const current = fingerprint(provider);
  if (!canonicalJsonBytes(current).equals(canonicalJsonBytes(expected))) {
    fail("runtime fingerprint changed after preparation");
  }
}

function conversationFromTransmission(transmission) {
  const promptInput = transmission.harnessControlledInputs.find(
    ({ id }) => id === "prompt",
  );
  if (promptInput === undefined) fail("prepared prompt is missing");
  return Object.freeze([
    Object.freeze({
      id: "prompt",
      input: Object.freeze({ type: "text", text: promptInput.content }),
    }),
    ...transmission.continuationPolicy.templates.map((template) =>
      Object.freeze({
        id: template.transitionId,
        input: Object.freeze({ ...template.input[0] }),
      }),
    ),
  ]);
}

function runnerSettingsFromTransmission(transmission) {
  const settingsInput = transmission.harnessControlledInputs.find(
    ({ id }) => id === "runner-settings",
  );
  if (settingsInput === undefined) fail("prepared runner settings are missing");
  return JSON.parse(settingsInput.content);
}

function codexPolicyFromTransmission(transmission) {
  const base = transmission.harnessControlledInputs.find(
    ({ id }) => id === "base-instructions",
  )?.content;
  const developer = transmission.harnessControlledInputs.find(
    ({ id }) => id === "instructions",
  )?.content;
  if (typeof base !== "string" || typeof developer !== "string") {
    fail("prepared Codex instructions are missing");
  }
  return {
    schemaVersion: 1,
    provider: "openai",
    model: transmission.model,
    effort: transmission.effort,
    instructions: { base, developer },
    capabilities: transmission.capabilities,
    isolation: transmission.isolation,
  };
}

function assertPreparedRuntimeCurrent(transmission) {
  assertRuntimeCurrent(
    transmission.runtimeFingerprint,
    transmission.provider,
  );
  if (
    controllerDigest() !== transmission.continuationPolicy.controllerSha256
  ) {
    fail("session controller changed after preparation");
  }
}

async function preflight(options) {
  const { values } = options;
  const preparedSession = path.resolve(
    requireValue(values, "--prepared-session"),
  );
  if (values.get("--allow-zero-turn-preflight") !== true) {
    fail("preflight requires --allow-zero-turn-preflight");
  }
  const timeoutMs = values.has("--timeout-ms")
    ? positiveInteger(values.get("--timeout-ms"), "--timeout-ms")
    : 30_000;
  const packet = JSON.parse(
    readFileSync(path.join(preparedSession, "packet.json"), "utf8"),
  );
  assertTransmissionPacket(packet);
  const transmission = packet.transmission;
  if (transmission.provider !== "openai") {
    fail("zero-turn preflight supports only prepared OpenAI sessions");
  }
  assertPreparedRuntimeCurrent(transmission);
  const settings = runnerSettingsFromTransmission(transmission);
  const result = await preflightCodexAppServer({
    toolchain: transmission.toolchain,
    policy: codexPolicyFromTransmission(transmission),
    withHome: (operation) =>
      withEvaluationHome(
        {
          root: settings.evaluationHomesRoot,
          role: "preflight",
          operationId: transmission.session.preparedSessionId,
        },
        operation,
      ),
    evidenceDestination: path.join(preparedSession, "preflight"),
    timeoutMs,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "completed") process.exitCode = 1;
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
  const settings = runnerSettingsFromTransmission(transmission);
  const conversation = conversationFromTransmission(transmission);
  const controller = createDefiningConceptController({ conversation });
  let adapter;
  let request;
  if (transmission.provider === "openai") {
    adapter = codexAppServerAdapter;
    request = Object.freeze({
      toolchain: transmission.toolchain,
      policy: codexPolicyFromTransmission(transmission),
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
  } else if (transmission.provider === "google") {
    adapter = antigravityCliAdapter;
    request = Object.freeze({
      toolchain: transmission.toolchain,
      controller,
      timeoutMs,
    });
  } else {
    fail(`Unsupported prepared provider: ${transmission.provider}`);
  }
  const result = await executeAuthorizedModelSession({
    preparedSession,
    allowExternalModelCall: true,
    authorization,
    assertCurrent: async (current) => {
      assertPreparedRuntimeCurrent(current);
    },
    adapter,
    request,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "completed") process.exitCode = 1;
}

const parsed = parseArguments(process.argv.slice(2));
const operation =
  parsed.command === "prepare"
    ? prepare(parsed)
    : parsed.command === "preflight"
      ? preflight(parsed)
      : run(parsed);
operation.catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
