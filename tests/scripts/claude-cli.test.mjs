import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  createTransmissionPacket,
  executeAuthorizedModelSession,
  prepareEvidenceSession,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";
import * as claudeModule from "../../scripts/evaluation/claude-cli.js";

const { claudeCliAdapter, inspectClaudeCliToolchain, preflightClaudeAuth } =
  claudeModule;
const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/fake-claude-cli.mjs",
);
const expectedTools = "WebSearch,WebFetch";

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

function authorization(packet) {
  return Object.freeze({
    schemaVersion: 1,
    decision: "authorized",
    statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
    allowExternalModel: true,
    provider: "anthropic",
    model: packet.transmission.model,
    effort: packet.transmission.effort,
    transmissionSha256: packet.transmissionSha256,
  });
}

function controller(prompt = "Explain durable concepts.") {
  return Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: prompt }),
    ]),
    async onTurnCompleted(event) {
      return Object.freeze({
        action: "complete",
        suiteResult: Object.freeze({
          finalAnswer: event.finalAnswer,
          turnIndex: event.turnIndex,
        }),
      });
    },
    async onApprovalRequest() {
      return Object.freeze({ decision: "deny", reason: "noninteractive" });
    },
  });
}

function recordsAt(path) {
  return readFile(path, "utf8").then((text) =>
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function createFixture(t, scenario = "happy", overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "claude-cli-adapter-"));
  t.after(async () => {
    if (scenario === "shutdown-ambiguous") {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_300));
    }
    await rm(root, { recursive: true, force: true });
  });
  const recordFile = join(root, "invocations.jsonl");
  const workingDirectory = join(root, "working");
  await mkdir(workingDirectory);
  const prefixArguments = [
    fixturePath,
    "--scenario",
    scenario,
    "--record-file",
    recordFile,
  ];
  if (scenario === "launch-failure") {
    prefixArguments.push("--remove-directory", workingDirectory);
  }
  const environment = Object.freeze({
    ...Object.fromEntries(
      [
        "HOMEDRIVE",
        "HOMEPATH",
        "LOGONSERVER",
        "PATH",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "TEMP",
        "USERDOMAIN",
        "USERNAME",
        "USERPROFILE",
        "WINDIR",
      ]
        .filter((name) => typeof process.env[name] === "string")
        .map((name) => [name, process.env[name]]),
    ),
    EVALUATION_SCENARIO: "must-be-ignored",
    EVALUATION_VISIBLE: "packet-visible",
  });
  const toolchain = await inspectClaudeCliToolchain({
    command: process.execPath,
    prefixArguments,
    environment,
  });
  const authentication = await preflightClaudeAuth({
    toolchain,
    environment,
    timeoutMs: 2_000,
  });
  const prompt = "Explain durable concepts.";
  const instructions = "Follow the evaluation rubric exactly.\n";
  const emptyMcp = '{"mcpServers":{}}';
  const transmission = {
    suite: "defining-concepts",
    session: {
      preparedSessionId: "abcdef0123456789abcdef0123456789",
      caseId: 1,
      arm: "with_skill",
      repetition: 1,
      sequence: 1,
      suiteArtifacts: [],
    },
    provider: "anthropic",
    model: "claude-opus-4-1",
    effort: "high",
    transport: "claude-cli",
    toolchain,
    runtimeFingerprint: {
      gitCommit: "1".repeat(40),
      gitTree: "2".repeat(40),
      modules: [
        {
          path: "scripts/evaluation/claude-cli.js",
          byteLength: 1,
          sha256: "3".repeat(64),
        },
      ],
    },
    capabilities: overrides.capabilities ?? {
      network: true,
      webSearch: true,
      tools: ["WebSearch", "WebFetch"],
      providerFacilities: [],
    },
    isolation: {
      sandbox: "read-only",
      workingDirectory,
      instructionSources: [],
      persistence: false,
      stableHome: null,
      environment: {
        values: environment,
        secretSources: [],
      },
    },
    harnessControlledInputs: [
      inputRecord("prompt", "user", "text/plain", prompt),
      inputRecord("instructions", "system", "text/plain", instructions),
      inputRecord(
        "empty-mcp-config",
        "configuration",
        "application/json",
        emptyMcp,
      ),
    ],
    continuationPolicy: {
      controllerSha256: "4".repeat(64),
      maxTurns: 1,
      allowedTransitions: [],
      templates: [],
    },
  };
  const packet = createTransmissionPacket(transmission);
  const destination = join(root, "prepared");
  const prepared = await prepareEvidenceSession({
    destination,
    packet,
    inputs: [
      { id: "prompt", mediaType: "text/plain", bytes: Buffer.from(prompt) },
      {
        id: "instructions",
        mediaType: "text/plain",
        bytes: Buffer.from(instructions),
      },
      {
        id: "empty-mcp-config",
        mediaType: "application/json",
        bytes: Buffer.from(emptyMcp),
      },
    ],
  });
  const request = Object.freeze({
    toolchain,
    authentication,
    controller: controller(prompt),
    timeoutMs: overrides.timeoutMs ?? 2_000,
    maxBudgetUsd: "1.25",
    inputIds: Object.freeze({
      prompt: "prompt",
      instructions: "instructions",
      mcpConfig: "empty-mcp-config",
    }),
    inputPaths: Object.freeze({
      prompt: join(destination, "inputs", "0001-prompt.txt"),
      instructions: join(destination, "inputs", "0002-instructions.txt"),
      mcpConfig: join(destination, "inputs", "0003-empty-mcp-config.json"),
    }),
  });

  return {
    authentication,
    destination,
    environment,
    packet,
    prepared,
    recordFile,
    request,
    root,
    toolchain,
    workingDirectory,
  };
}

async function executeFixture(fixture) {
  return executeAuthorizedModelSession({
    preparedSession: fixture.prepared,
    allowExternalModelCall: true,
    authorization: authorization(fixture.packet),
    assertCurrent: async () => {},
    adapter: claudeCliAdapter,
    request: fixture.request,
  });
}

function directContext(fixture) {
  const evidence = Object.freeze({
    async appendTranscript() {},
    async appendNormalizedEvent() {},
    async appendStderr() {},
    async writeFinal() {},
    async writeSuiteArtifact() {},
  });
  return {
    launchCapability: Object.freeze({}),
    transmission: fixture.packet.transmission,
    evidence,
    request: fixture.request,
    signal: undefined,
  };
}

test("exports only the Claude adapter contract", () => {
  assert.deepEqual(Object.keys(claudeModule).sort(), [
    "claudeCliAdapter",
    "inspectClaudeCliToolchain",
    "preflightClaudeAuth",
  ]);
  assert.equal(claudeCliAdapter.provider, "anthropic");
  assert.equal(Object.isFrozen(claudeCliAdapter), true);
});

test("inspection pins executable identity, version, and the static capability profile", async (t) => {
  const fixture = await createFixture(t);
  assert.equal(fixture.toolchain.schemaVersion, 1);
  assert.equal(fixture.toolchain.provider, "anthropic");
  assert.equal(fixture.toolchain.transport, "claude-cli");
  assert.equal(fixture.toolchain.version, "2.1.233");
  assert.equal(
    fixture.toolchain.command.path,
    await import("node:fs/promises").then(({ realpath }) =>
      realpath(process.execPath),
    ),
  );
  assert.match(fixture.toolchain.command.sha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(fixture.toolchain.capabilityProfile, {
    schemaVersion: 1,
    version: "2.1.233",
    authentication: {
      command: ["auth", "status", "--json"],
      safeModePreservesOauthKeychain: true,
    },
    invocation: {
      safeMode: true,
      slashCommands: false,
      sessionPersistence: false,
      chrome: false,
      promptSuggestions: false,
      permissionMode: "dontAsk",
      inputFormat: "text",
      outputFormat: "stream-json",
      verbose: true,
      strictMcpConfig: true,
      disallowedTools: ["mcp__*"],
      maxTurns: 1,
      fallbackModel: false,
      systemPromptMode: "append-file",
    },
  });
  assert.match(fixture.toolchain.help.sha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    (await recordsAt(fixture.recordFile)).slice(0, 3).map(({ mode }) => mode),
    ["version", "help", "auth"],
  );
});

test("inspection rejects every unreviewed Claude version", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "claude-version-drift-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    inspectClaudeCliToolchain({
      command: process.execPath,
      prefixArguments: [
        fixturePath,
        "--scenario",
        "version-drift-after-first",
        "--record-file",
        join(root, "records.jsonl"),
      ],
      environment: {},
    }).then((first) =>
      inspectClaudeCliToolchain({
        command: first.command.path,
        prefixArguments: first.prefixArguments,
        environment: {},
      }),
    ),
    /2\.1\.234|unsupported|version/iu,
  );
});

test("auth preflight is zero-turn and retains no account-identifying fields", async (t) => {
  const fixture = await createFixture(t);
  assert.deepEqual(fixture.authentication, {
    schemaVersion: 1,
    provider: "anthropic",
    status: "authenticated",
    authMode: "oauth-keychain",
    apiProvider: "firstParty",
    modelTurns: 0,
    closure: {
      status: "safe",
      exitStatus: "observed",
      exitCode: 0,
      exitSignal: null,
      stdioStatus: "closed",
      protocolStatus: "not-applicable",
      terminationActions: [],
      descendantStatus: "none-observed",
    },
  });
  assert.doesNotMatch(
    JSON.stringify(fixture.authentication),
    /email|token|person@example/iu,
  );
  assert.equal(
    (await recordsAt(fixture.recordFile)).some(({ mode }) => mode === "model"),
    false,
  );
});

test("auth preflight reports an unauthenticated CLI without a model turn", async (t) => {
  const fixture = await createFixture(t, "unauthenticated");
  assert.equal(fixture.authentication.status, "unauthenticated");
  assert.equal(fixture.authentication.authMode, null);
  assert.equal(fixture.authentication.apiProvider, null);
  assert.equal(
    (await recordsAt(fixture.recordFile)).some(({ mode }) => mode === "model"),
    false,
  );
});

test("authorized execution uses exact arguments, environment, cwd, input, evidence, and usage", async (t) => {
  const fixture = await createFixture(t);
  const result = await executeFixture(fixture);
  assert.equal(result.status, "completed");
  assert.equal(await exists(join(fixture.destination, "attempt.json")), true);
  const model = (await recordsAt(fixture.recordFile)).find(
    ({ mode }) => mode === "model",
  );
  assert.deepEqual(model.arguments, [
    "-p",
    "--safe-mode",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--no-chrome",
    "--prompt-suggestions",
    "false",
    "--permission-mode",
    "dontAsk",
    "--tools",
    expectedTools,
    "--allowedTools",
    expectedTools,
    "--disallowedTools",
    "mcp__*",
    "--mcp-config",
    fixture.request.inputPaths.mcpConfig,
    "--strict-mcp-config",
    "--input-format",
    "text",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "claude-opus-4-1",
    "--effort",
    "high",
    "--max-turns",
    "1",
    "--max-budget-usd",
    "1.25",
    "--append-system-prompt-file",
    fixture.request.inputPaths.instructions,
  ]);
  assert.equal(model.cwd, fixture.workingDirectory);
  assert.equal(model.stdin, "Explain durable concepts.");
  assert.deepEqual(
    model.environmentNames,
    Object.keys(
      fixture.packet.transmission.isolation.environment.values,
    ).sort(),
  );
  assert.equal(model.visibleEnvironment, "packet-visible");
  assert.equal(model.inheritedScenario, "must-be-ignored");

  const transcript = await readFile(
    join(fixture.destination, "outputs", "transcript.jsonl"),
    "utf8",
  );
  const expectedTranscript = [
    { type: "system", subtype: "init", session_id: "fake-session" },
    {
      type: "assistant",
      message: {
        id: "message-1",
        content: [{ type: "text", text: "Answer body" }],
      },
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Authoritative final answer",
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 3,
        output_tokens: 20,
      },
      modelUsage: {
        "claude-opus-4-1": { inputTokens: 10, outputTokens: 20 },
      },
      total_cost_usd: 0.25,
    },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n");
  assert.equal(transcript, `${expectedTranscript}\n`);
  assert.equal(
    await readFile(join(fixture.destination, "outputs", "final.md"), "utf8"),
    "Authoritative final answer",
  );
  assert.equal(
    await readFile(join(fixture.destination, "outputs", "stderr.log"), "utf8"),
    "fake claude diagnostic\n",
  );
  const metrics = JSON.parse(
    await readFile(join(fixture.destination, "metrics.json"), "utf8"),
  );
  assert.deepEqual(metrics.normalizedUsage, {
    inputTokens: 10,
    cachedInputTokens: 3,
    outputTokens: 20,
    totalTokens: 30,
    costUsd: 0.25,
  });
  const run = JSON.parse(
    await readFile(join(fixture.destination, "run.json"), "utf8"),
  );
  assert.deepEqual(run.suiteResult, {
    finalAnswer: "Authoritative final answer",
    turnIndex: 1,
  });
  assert.deepEqual(run.closure, {
    status: "safe",
    exitStatus: "observed",
    exitCode: 0,
    exitSignal: null,
    stdioStatus: "closed",
    protocolStatus: "not-applicable",
    terminationActions: [],
    descendantStatus: "none-observed",
  });
});

for (const [scenario, failureClass] of [
  ["malformed-json", "protocol-failed"],
  ["nonzero-exit", "provider-failed"],
  ["provider-error", "provider-failed"],
  ["empty-final", "protocol-failed"],
]) {
  test(`${scenario} retains evidence and fails as ${failureClass}`, async (t) => {
    const fixture = await createFixture(t, scenario);
    const result = await executeFixture(fixture);
    assert.equal(result.status, "failed");
    const run = JSON.parse(
      await readFile(join(fixture.destination, "run.json"), "utf8"),
    );
    assert.equal(run.failureClass, failureClass);
    assert.equal(await exists(join(fixture.destination, "attempt.json")), true);
    assert.equal(
      (await readFile(join(fixture.destination, "outputs", "transcript.jsonl")))
        .byteLength > 0,
      true,
    );
    assert.equal(
      (await readFile(join(fixture.destination, "outputs", "stderr.log")))
        .byteLength > 0,
      true,
    );
  });
}

test("unrepresentable capabilities fail before launch consumption", async (t) => {
  const fixture = await createFixture(t, "happy", {
    capabilities: {
      network: false,
      webSearch: false,
      tools: [],
      providerFacilities: [],
    },
  });
  const result = await claudeCliAdapter.execute(directContext(fixture));
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "capability-rejected");
  assert.equal(
    (await recordsAt(fixture.recordFile)).some(({ mode }) => mode === "model"),
    false,
  );
});

test("toolchain drift fails before auth inspection or launch consumption", async (t) => {
  const fixture = await createFixture(t, "version-drift-after-first");
  const result = await claudeCliAdapter.execute(directContext(fixture));
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "preflight-rejected");
  const records = await recordsAt(fixture.recordFile);
  assert.equal(records.filter(({ mode }) => mode === "auth").length, 1);
  assert.equal(
    records.some(({ mode }) => mode === "model"),
    false,
  );
});

test("capability-profile drift fails before auth inspection or launch consumption", async (t) => {
  const fixture = await createFixture(t);
  const driftedToolchain = structuredClone(fixture.toolchain);
  driftedToolchain.capabilityProfile.invocation.safeMode = false;
  const context = directContext(fixture);
  context.request = { ...context.request, toolchain: driftedToolchain };
  context.transmission = {
    ...context.transmission,
    toolchain: driftedToolchain,
  };
  const result = await claudeCliAdapter.execute(context);
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "preflight-rejected");
  assert.equal(
    (await recordsAt(fixture.recordFile)).filter(({ mode }) => mode === "auth")
      .length,
    1,
  );
  assert.equal(
    (await recordsAt(fixture.recordFile)).some(({ mode }) => mode === "model"),
    false,
  );
});

test("auth-mode drift fails before launch consumption", async (t) => {
  const fixture = await createFixture(t, "auth-mode-drift-after-preflight");
  const result = await claudeCliAdapter.execute(directContext(fixture));
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "preflight-rejected");
  assert.equal(
    (await recordsAt(fixture.recordFile)).some(({ mode }) => mode === "model"),
    false,
  );
});

test("packet-bound input drift fails before launch consumption", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(fixture.request.inputPaths.instructions, "drifted\n", "utf8");
  const result = await claudeCliAdapter.execute(directContext(fixture));
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "preflight-rejected");
  assert.equal(
    (await recordsAt(fixture.recordFile)).some(({ mode }) => mode === "model"),
    false,
  );
});

test("a real spawn failure occurs only after launch consumption", async (t) => {
  const fixture = await createFixture(t, "launch-failure");
  const result = await executeFixture(fixture);
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "launch-failed");
  assert.equal(await exists(join(fixture.destination, "attempt.json")), true);
  assert.equal(
    (await recordsAt(fixture.recordFile)).some(({ mode }) => mode === "model"),
    false,
  );
});

test("confirmed timeout is terminal, safe, and never retried", async (t) => {
  const fixture = await createFixture(t, "timeout", { timeoutMs: 75 });
  const result = await executeFixture(fixture);
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "timed-out");
  const run = JSON.parse(
    await readFile(join(fixture.destination, "run.json"), "utf8"),
  );
  assert.equal(run.closure.status, "safe");
  assert.equal(run.closure.stdioStatus, "closed");
  assert.equal(
    (await recordsAt(fixture.recordFile)).filter(({ mode }) => mode === "model")
      .length,
    1,
  );
});

test("unconfirmed timeout closure is unsafe and never retried", async (t) => {
  const fixture = await createFixture(t, "shutdown-ambiguous", {
    timeoutMs: 250,
  });
  const result = await executeFixture(fixture);
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "timed-out");
  const run = JSON.parse(
    await readFile(join(fixture.destination, "run.json"), "utf8"),
  );
  assert.equal(run.closure.status, "unsafe");
  assert.equal(run.closure.reasonCode, "shutdown-ambiguous");
  assert.equal(
    (await recordsAt(fixture.recordFile)).filter(({ mode }) => mode === "model")
      .length,
    1,
  );
});
