import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  createTransmissionPacket,
  executeAuthorizedModelSession,
  prepareEvidenceSession,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";
import * as antigravityModule from "../../scripts/evaluation/antigravity-cli.js";

const { antigravityCliAdapter, inspectAntigravityCliToolchain } =
  antigravityModule;
const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/fake-antigravity-cli.mjs",
);

function recordsAt(path) {
  return readFile(path, "utf8").then((text) =>
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
}

function inputRecord(id, role, content) {
  const bytes = Buffer.from(content, "utf8");
  return {
    id,
    role,
    mediaType: "text/plain",
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
    provider: "google",
    model: packet.transmission.model,
    effort: packet.transmission.effort,
    transmissionSha256: packet.transmissionSha256,
  });
}

function controller({ prompt, continuation = null }) {
  const continuationInput =
    continuation === null
      ? null
      : Object.freeze([Object.freeze({ type: "text", text: continuation })]);
  let completedTurns = 0;
  return Object.freeze({
    schemaVersion: 1,
    maxTurns: continuation === null ? 1 : 2,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: prompt }),
    ]),
    async onTurnCompleted(event) {
      completedTurns += 1;
      if (continuationInput !== null && completedTurns === 1) {
        return Object.freeze({
          action: "continue",
          transitionId: "follow-up",
          input: continuationInput,
        });
      }
      return Object.freeze({
        action: "complete",
        suiteResult: Object.freeze({
          finalAnswer: event.finalAnswer,
          turnIndex: event.turnIndex,
        }),
      });
    },
    async onApprovalRequest() {
      return Object.freeze({
        action: "reject",
        failureClass: "controller-failed",
        reason: "Antigravity policy evaluations reject approval requests",
      });
    },
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function inspectionFixture(t, scenario = "happy") {
  const root = await mkdtemp(join(tmpdir(), "antigravity-inspection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recordFile = join(root, "invocations.jsonl");
  const environment = Object.freeze({ EVALUATION_VISIBLE: "packet-visible" });
  const prefixArguments = [
    fixturePath,
    "--scenario",
    scenario,
    "--record-file",
    recordFile,
  ];
  const toolchain = await inspectAntigravityCliToolchain({
    command: process.execPath,
    prefixArguments,
    environment,
  });
  return { environment, prefixArguments, recordFile, root, toolchain };
}

async function executionFixture(
  t,
  scenario = "happy",
  { continuation = null, timeoutMs = 2_000 } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "antigravity-adapter-"));
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
    EVALUATION_VISIBLE: "packet-visible",
  });
  const toolchain = await inspectAntigravityCliToolchain({
    command: process.execPath,
    prefixArguments,
    environment,
  });
  const prompt = "Explain the packet-bound policy.";
  const inputs = [inputRecord("prompt", "user", prompt)];
  const templates = [];
  if (continuation !== null) {
    inputs.push(inputRecord("follow-up", "continuation", continuation));
    templates.push({
      transitionId: "follow-up",
      input: [{ type: "text", text: continuation }],
    });
  }
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
    provider: "google",
    model: "gemini-3.5-flash-low",
    effort: "low",
    transport: "antigravity-cli",
    toolchain,
    runtimeFingerprint: {
      gitCommit: "1".repeat(40),
      gitTree: "2".repeat(40),
      modules: [
        {
          path: "scripts/evaluation/antigravity-cli.js",
          byteLength: 1,
          sha256: "3".repeat(64),
        },
      ],
    },
    capabilities: {
      network: false,
      webSearch: false,
      tools: [],
      providerFacilities: ["provider-default-context"],
    },
    isolation: {
      sandbox: "read-only",
      workingDirectory,
      instructionSources: ["packet-bound-user-message"],
      persistence: false,
      stableHome: null,
      environment: { values: environment, secretSources: [] },
    },
    harnessControlledInputs: inputs,
    continuationPolicy: {
      controllerSha256: "4".repeat(64),
      maxTurns: continuation === null ? 1 : 2,
      allowedTransitions: templates.map(({ transitionId }) => transitionId),
      templates,
    },
  };
  const packet = createTransmissionPacket(transmission);
  const destination = join(root, "prepared");
  const prepared = await prepareEvidenceSession({
    destination,
    packet,
    inputs: inputs.map(({ id, mediaType, content }) => ({
      id,
      mediaType,
      bytes: Buffer.from(content, "utf8"),
    })),
  });
  const request = Object.freeze({
    toolchain,
    controller: controller({ prompt, continuation }),
    timeoutMs,
  });
  return {
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
    adapter: antigravityCliAdapter,
    request: fixture.request,
  });
}

function directContext(fixture) {
  return {
    launchCapability: Object.freeze({}),
    transmission: fixture.packet.transmission,
    evidence: Object.freeze({
      async appendTranscript() {},
      async appendNormalizedEvent() {},
      async appendStderr() {},
      async writeFinal() {},
      async writeSuiteArtifact() {},
    }),
    request: fixture.request,
    signal: undefined,
  };
}

function oneTurnController(prompt, onTurnCompleted) {
  return Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: prompt }),
    ]),
    onTurnCompleted,
    async onApprovalRequest() {
      return Object.freeze({
        action: "reject",
        failureClass: "controller-failed",
        reason: "approval requests are forbidden",
      });
    },
  });
}

test("exports only the Antigravity adapter contract", () => {
  assert.deepEqual(Object.keys(antigravityModule).sort(), [
    "antigravityCliAdapter",
    "inspectAntigravityCliToolchain",
  ]);
  assert.equal(antigravityCliAdapter.provider, "google");
  assert.equal(Object.isFrozen(antigravityCliAdapter), true);
});

test("inspection pins executable identity, version, help, and capability profile", async (t) => {
  const fixture = await inspectionFixture(t);
  assert.equal(fixture.toolchain.schemaVersion, 1);
  assert.equal(fixture.toolchain.provider, "google");
  assert.equal(fixture.toolchain.transport, "antigravity-cli");
  assert.equal(fixture.toolchain.version, "1.1.19");
  assert.equal(
    fixture.toolchain.command.path,
    await import("node:fs/promises").then(({ realpath }) =>
      realpath(process.execPath),
    ),
  );
  assert.match(fixture.toolchain.command.sha256, /^[0-9a-f]{64}$/u);
  assert.match(fixture.toolchain.help.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(fixture.toolchain.boundPrefixFiles.length, 1);
  assert.equal(
    fixture.toolchain.boundPrefixFiles[0].path,
    await import("node:fs/promises").then(({ realpath }) =>
      realpath(fixturePath),
    ),
  );
  assert.match(fixture.toolchain.boundPrefixFiles[0].sha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(fixture.toolchain.capabilityProfile, {
    schemaVersion: 1,
    version: "1.1.19",
    authentication: {
      mode: "cached-cli-credentials",
      zeroTurnStatusCommand: null,
    },
    invocation: {
      inputFormat: "stream-json",
      outputFormat: "stream-json",
      sandbox: true,
      slashCommands: false,
      dangerouslySkipPermissions: false,
      permissionMode: "request-review",
      explicitAgent: false,
      processConversationPersistence: true,
      crossProcessConversationPersistence: false,
      observedToolUse: "reject",
      observedSubagentUse: "reject",
    },
  });
  assert.equal(Object.isFrozen(fixture.toolchain), true);
  assert.deepEqual(
    (await recordsAt(fixture.recordFile)).map(({ mode }) => mode),
    ["version", "help"],
  );
});

test("inspection rejects every unreviewed Antigravity version", async (t) => {
  const fixture = await inspectionFixture(t, "version-drift-after-first");
  await assert.rejects(
    inspectAntigravityCliToolchain({
      command: fixture.toolchain.command.path,
      prefixArguments: fixture.toolchain.prefixArguments,
      environment: fixture.environment,
    }),
    /1\.1\.20|unsupported|version/iu,
  );
});

test("inspection rejects provider-control prefix arguments before any subprocess", async (t) => {
  const fixture = await inspectionFixture(t);
  const before = await recordsAt(fixture.recordFile);
  for (const argument of [
    "-p",
    "--agent=research",
    "--allowed-tools=run_command",
    "--continue",
    "--dangerously-skip-permissions",
    "--mcp-config=external.json",
    "--model=unreviewed-model",
    "--permission-mode=always-proceed",
    "--plugin-dir=external-plugin",
  ]) {
    await assert.rejects(
      inspectAntigravityCliToolchain({
        command: fixture.toolchain.command.path,
        prefixArguments: [...fixture.toolchain.prefixArguments, argument],
        environment: fixture.environment,
      }),
      /prefix argument.*reserved|forbidden/iu,
      argument,
    );
  }
  assert.deepEqual(await recordsAt(fixture.recordFile), before);
});

test("inspection requires absolute executable prefix files before any subprocess", async (t) => {
  const fixture = await inspectionFixture(t);
  const before = await recordsAt(fixture.recordFile);
  await assert.rejects(
    inspectAntigravityCliToolchain({
      command: fixture.toolchain.command.path,
      prefixArguments: [
        relative(process.cwd(), fixturePath),
        ...fixture.toolchain.prefixArguments.slice(1),
      ],
      environment: fixture.environment,
    }),
    /prefix.*file.*absolute/iu,
  );
  assert.deepEqual(await recordsAt(fixture.recordFile), before);
});

test("authorized execution uses one exact streamed process and retains authoritative evidence", async (t) => {
  const fixture = await executionFixture(t);
  const result = await executeFixture(fixture);
  assert.equal(result.status, "completed");
  assert.equal(await exists(join(fixture.destination, "attempt.json")), true);

  const records = await recordsAt(fixture.recordFile);
  const model = records.find(({ mode }) => mode === "model");
  assert.deepEqual(model.arguments, [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--model",
    "gemini-3.5-flash-low",
    "--effort",
    "low",
    "--sandbox",
    "--disable-slash-commands",
  ]);
  assert.equal(model.cwd, fixture.workingDirectory);
  assert.deepEqual(
    model.environmentNames,
    Object.keys(fixture.environment).sort(),
  );
  assert.equal(model.visibleEnvironment, "packet-visible");
  assert.equal(records.filter(({ mode }) => mode === "model").length, 1);
  assert.deepEqual(records.find(({ mode }) => mode === "input").message, {
    event: "user",
    message: {
      content: [{ type: "text", text: "Explain the packet-bound policy." }],
    },
  });

  const transcript = await readFile(
    join(fixture.destination, "outputs", "transcript.jsonl"),
    "utf8",
  );
  assert.match(transcript, /"event":"init"/u);
  assert.match(transcript, /"event":"result"/u);
  assert.equal(
    await readFile(join(fixture.destination, "outputs", "final.md"), "utf8"),
    "Authoritative Google answer\n",
  );
  assert.equal(
    await readFile(join(fixture.destination, "outputs", "stderr.log"), "utf8"),
    "fake antigravity diagnostic\n",
  );
  const metrics = JSON.parse(
    await readFile(join(fixture.destination, "metrics.json"), "utf8"),
  );
  assert.deepEqual(metrics.normalizedUsage, {
    inputTokens: 100,
    cachedInputTokens: 50,
    outputTokens: 20,
    totalTokens: 120,
    costUsd: null,
  });
  const run = JSON.parse(
    await readFile(join(fixture.destination, "run.json"), "utf8"),
  );
  assert.deepEqual(run.suiteResult, {
    finalAnswer: "Authoritative Google answer\n",
    turnIndex: 1,
  });
  assert.deepEqual(run.closure, {
    status: "safe",
    exitStatus: "observed",
    exitCode: 0,
    exitSignal: null,
    stdioStatus: "closed",
    protocolStatus: "closed",
    terminationActions: [],
    descendantStatus: "none-observed",
  });
});

test("an authorized continuation stays in one process and retains cumulative usage", async (t) => {
  const fixture = await executionFixture(t, "happy", {
    continuation: "Give the second answer.",
  });
  const result = await executeFixture(fixture);
  assert.equal(result.status, "completed");
  const records = await recordsAt(fixture.recordFile);
  assert.equal(records.filter(({ mode }) => mode === "model").length, 1);
  assert.deepEqual(
    records
      .filter(({ mode }) => mode === "input")
      .map(({ message }) => message.message.content[0].text),
    ["Explain the packet-bound policy.", "Give the second answer."],
  );
  assert.deepEqual(result.normalizedUsage, {
    inputTokens: 200,
    cachedInputTokens: 100,
    outputTokens: 40,
    totalTokens: 240,
    costUsd: null,
  });
  assert.deepEqual(result.suiteResult, {
    finalAnswer: "Second Google answer\n",
    turnIndex: 2,
  });
});

test("toolchain drift fails before launch-capability consumption", async (t) => {
  const fixture = await executionFixture(t, "version-drift-after-first");
  const result = await antigravityCliAdapter.execute(directContext(fixture));
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "preflight-rejected");
  assert.equal(
    (await recordsAt(fixture.recordFile)).some(({ mode }) => mode === "model"),
    false,
  );
});

test("unrepresentable capabilities fail before launch-capability consumption", async (t) => {
  const fixture = await executionFixture(t);
  const context = directContext(fixture);
  context.transmission = {
    ...context.transmission,
    capabilities: {
      network: true,
      webSearch: true,
      tools: ["web_search"],
      providerFacilities: ["provider-default-context"],
    },
  };
  const result = await antigravityCliAdapter.execute(context);
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "capability-rejected");
  assert.equal(
    (await recordsAt(fixture.recordFile)).some(({ mode }) => mode === "model"),
    false,
  );
});

test("secret environment and nonempty workspace drift fail before launch consumption", async (t) => {
  await t.test("provider authentication environment", async (t) => {
    const fixture = await executionFixture(t);
    const context = directContext(fixture);
    context.transmission = {
      ...context.transmission,
      isolation: {
        ...context.transmission.isolation,
        environment: {
          values: {
            ...context.transmission.isolation.environment.values,
            GEMINI_API_KEY: "packet-secret",
          },
          secretSources: [],
        },
      },
    };
    const result = await antigravityCliAdapter.execute(context);
    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, "capability-rejected");
    assert.equal(
      (await recordsAt(fixture.recordFile)).some(
        ({ mode }) => mode === "model",
      ),
      false,
    );
  });

  await t.test("nonempty working directory", async (t) => {
    const fixture = await executionFixture(t);
    await mkdir(join(fixture.workingDirectory, "unexpected-entry"));
    const result = await antigravityCliAdapter.execute(directContext(fixture));
    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, "capability-rejected");
    assert.equal(
      (await recordsAt(fixture.recordFile)).some(
        ({ mode }) => mode === "model",
      ),
      false,
    );
  });
});

test("controller input drift fails before launch-capability consumption", async (t) => {
  const fixture = await executionFixture(t);
  const context = directContext(fixture);
  context.request = Object.freeze({
    ...context.request,
    controller: oneTurnController("unbound prompt", async () => ({
      action: "complete",
      suiteResult: {},
    })),
  });
  const result = await antigravityCliAdapter.execute(context);
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "preflight-rejected");
  assert.equal(
    (await recordsAt(fixture.recordFile)).some(({ mode }) => mode === "model"),
    false,
  );
});

for (const [scenario, failureClass] of [
  ["malformed-json", "protocol-failed"],
  ["malformed-utf8", "protocol-failed"],
  ["duplicate-init", "protocol-failed"],
  ["missing-init", "protocol-failed"],
  ["missing-result", "protocol-failed"],
  ["duplicate-result", "protocol-failed"],
  ["unknown-event", "protocol-failed"],
  ["provider-error", "provider-failed"],
  ["empty-response", "protocol-failed"],
  ["nonzero-exit", "provider-failed"],
  ["cwd-mismatch", "capability-rejected"],
  ["model-mismatch", "capability-rejected"],
  ["permission-mode-mismatch", "capability-rejected"],
  ["agent-override", "capability-rejected"],
  ["conversation-mismatch", "protocol-failed"],
  ["turn-count-mismatch", "protocol-failed"],
  ["inconsistent-usage", "protocol-failed"],
  ["external-advertised-tool", "capability-rejected"],
  ["tool-use", "capability-rejected"],
  ["subagent-use", "capability-rejected"],
]) {
  test(`${scenario} retains a spent launch and fails as ${failureClass}`, async (t) => {
    const fixture = await executionFixture(t, scenario);
    const result = await executeFixture(fixture);
    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, failureClass);
    assert.equal(await exists(join(fixture.destination, "attempt.json")), true);
    assert.equal(
      (await recordsAt(fixture.recordFile)).filter(
        ({ mode }) => mode === "model",
      ).length,
      1,
    );
    const run = JSON.parse(
      await readFile(join(fixture.destination, "run.json"), "utf8"),
    );
    assert.equal(run.failureClass, failureClass);
  });
}

test("a real spawn failure occurs only after launch consumption", async (t) => {
  const fixture = await executionFixture(t, "launch-failure");
  const result = await executeFixture(fixture);
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "launch-failed");
  assert.equal(await exists(join(fixture.destination, "attempt.json")), true);
  assert.equal(
    (await recordsAt(fixture.recordFile)).some(({ mode }) => mode === "model"),
    false,
  );
});

test("a controller rejection retains usage and fails the session", async (t) => {
  const fixture = await executionFixture(t);
  fixture.request = Object.freeze({
    ...fixture.request,
    controller: oneTurnController(
      "Explain the packet-bound policy.",
      async () =>
        Object.freeze({
          action: "reject",
          failureClass: "controller-failed",
          reason: "suite rejected the answer",
        }),
    ),
  });
  const result = await executeFixture(fixture);
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "controller-failed");
  assert.deepEqual(result.normalizedUsage, {
    inputTokens: 100,
    cachedInputTokens: 50,
    outputTokens: 20,
    totalTokens: 120,
    costUsd: null,
  });
});

test("a thrown controller failure retains usage and fails the session", async (t) => {
  const fixture = await executionFixture(t);
  fixture.request = Object.freeze({
    ...fixture.request,
    controller: oneTurnController(
      "Explain the packet-bound policy.",
      async () => {
        throw new Error("controller implementation failed");
      },
    ),
  });
  const result = await executeFixture(fixture);
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "controller-failed");
  assert.deepEqual(result.normalizedUsage, {
    inputTokens: 100,
    cachedInputTokens: 50,
    outputTokens: 20,
    totalTokens: 120,
    costUsd: null,
  });
});

test("confirmed timeout is terminal, safe, and never retried", async (t) => {
  const fixture = await executionFixture(t, "timeout", { timeoutMs: 75 });
  const result = await executeFixture(fixture);
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "timed-out");
  assert.equal(result.closure.status, "safe");
  assert.equal(result.closure.stdioStatus, "closed");
  assert.equal(
    (await recordsAt(fixture.recordFile)).filter(({ mode }) => mode === "model")
      .length,
    1,
  );
});

test("unconfirmed timeout closure is unsafe and never retried", async (t) => {
  const fixture = await executionFixture(t, "shutdown-ambiguous", {
    timeoutMs: 250,
  });
  const result = await executeFixture(fixture);
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "timed-out");
  assert.equal(result.closure.status, "unsafe");
  assert.equal(result.closure.reasonCode, "shutdown-ambiguous");
  assert.equal(
    (await recordsAt(fixture.recordFile)).filter(({ mode }) => mode === "model")
      .length,
    1,
  );
});
