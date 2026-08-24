import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import {
  codexAppServerAdapter,
  inspectCodexAppServerToolchain,
  preflightCodexAppServer,
} from "../../scripts/evaluation/codex-app-server.js";
import {
  EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  createTransmissionPacket,
  executeAuthorizedModelSession,
  prepareEvidenceSession,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fakeAppServer = join(
  testDirectory,
  "fixtures",
  "fake-codex-app-server.mjs",
);

async function temporaryRoot(t, prefix = "codex-app-server-test-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function fakeToolchainOptions(scratchRoot, scenario = "happy") {
  const environment = { PATH: process.env.PATH ?? "" };
  if (typeof process.env.PATHEXT === "string") {
    environment.PATHEXT = process.env.PATHEXT;
  }
  return {
    command: process.execPath,
    prefixArguments: [fakeAppServer, "--scenario", scenario],
    scratchRoot,
    environment,
  };
}

function policyFixture(workingDirectory) {
  const environmentValues = {
    EVALUATION_VISIBLE: "packet-bound",
    PATH: process.env.PATH ?? "",
  };
  if (process.platform === "win32") {
    for (const name of [
      "HOMEDRIVE",
      "HOMEPATH",
      "LOGONSERVER",
      "SYSTEMDRIVE",
      "SYSTEMROOT",
      "TEMP",
      "USERDOMAIN",
      "USERNAME",
      "USERPROFILE",
      "WINDIR",
    ]) {
      if (typeof process.env[name] === "string") {
        environmentValues[name] = process.env[name];
      }
    }
  }

  return {
    schemaVersion: 1,
    provider: "openai",
    model: "gpt-5.6-luna",
    effort: "low",
    instructions: {
      base: "Use only the packet-bound evaluation instructions.",
      developer: "Do not discover ambient instructions.",
    },
    capabilities: {
      network: false,
      webSearch: false,
      tools: [],
      providerFacilities: [],
    },
    isolation: {
      sandbox: "workspace-write",
      workingDirectory,
      runtimeWorkspaceRoots: [workingDirectory],
      instructionSources: [],
      persistence: false,
      environment: {
        values: environmentValues,
        secretSources: [],
      },
    },
  };
}

async function inspectFakeToolchain(t, root, scenario = "happy") {
  return inspectCodexAppServerToolchain(
    fakeToolchainOptions(join(root, `toolchain-${scenario}`), scenario),
  );
}

function homeBoundary(homePath, observations = {}, role = "preflight") {
  observations.registeredChildren = 0;
  observations.releases = [];

  return async (operation) => {
    const operationResult = await operation(
      Object.freeze({
        role,
        path: homePath,
        environment: Object.freeze({ CODEX_HOME: homePath }),
        registerChild(child) {
          assert.equal(child.pid > 0, true);
          observations.registeredChildren += 1;
          if (typeof observations.delayWriteCallbackForMethod === "string") {
            const originalWrite = child.stdin.write.bind(child.stdin);
            child.stdin.write = (bytes, callback) => {
              const message = JSON.parse(Buffer.from(bytes).toString("utf8"));
              if (message.method === observations.delayWriteCallbackForMethod) {
                return originalWrite(bytes, (error) => {
                  setTimeout(
                    () => callback(error),
                    observations.writeCallbackDelayMs ?? 1_000,
                  );
                });
              }
              return originalWrite(bytes, callback);
            };
          }
          if (observations.suppressCloseObservation === true) {
            const originalOnce = child.once.bind(child);
            child.once = (eventName, listener) =>
              eventName === "close" ? child : originalOnce(eventName, listener);
          }
        },
      }),
    );
    assert.deepEqual(Object.keys(operationResult).sort(), ["release", "value"]);
    observations.releases.push(operationResult.release);
    if (
      observations.rejectUnsafeRelease === true &&
      operationResult.release.status === "unsafe"
    ) {
      const error = new Error(
        `home boundary rejected ${operationResult.release.reasonCode}`,
      );
      error.code = operationResult.release.reasonCode;
      throw error;
    }
    if (
      observations.rejectSafeRelease === true &&
      operationResult.release.status === "safe"
    ) {
      const error = new Error("home boundary failed after safe child closure");
      error.code = "HOME_ROTATION_FAILED";
      throw error;
    }
    return operationResult.value;
  };
}

function inputRecord({ id = "prompt", role = "user", content } = {}) {
  const selectedContent = content ?? "Packet-bound evaluation prompt";
  const bytes = Buffer.from(selectedContent, "utf8");
  return {
    id,
    role,
    mediaType: "text/plain",
    encoding: "utf8",
    content: selectedContent,
    byteLength: bytes.byteLength,
    sha256: sha256Hex(bytes),
  };
}

function transmissionFixture(
  toolchain,
  policy,
  {
    maxTurns = 1,
    allowedTransitions = [],
    templates = [],
    omitContinuationRecords = false,
  } = {},
) {
  const continuationRecords = omitContinuationRecords
    ? []
    : templates.flatMap((template, templateIndex) =>
        Array.isArray(template.input)
          ? template.input.map((item, itemIndex) =>
              inputRecord({
                id: `continuation-${templateIndex + 1}-${itemIndex + 1}`,
                role: "continuation",
                content: item.text,
              }),
            )
          : [],
      );
  return {
    suite: "defining-concepts",
    session: {
      preparedSessionId: "0123456789abcdef0123456789abcdef",
      caseId: "adapter-contract",
      arm: "without-skill",
      repetition: 1,
      sequence: 1,
      suiteArtifacts: [],
    },
    provider: policy.provider,
    model: policy.model,
    effort: policy.effort,
    transport: "codex-app-server",
    toolchain,
    runtimeFingerprint: {
      gitCommit: "1".repeat(40),
      gitTree: "2".repeat(40),
      modules: [
        {
          path: "scripts/evaluation/codex-app-server.js",
          byteLength: 1,
          sha256: "3".repeat(64),
        },
      ],
    },
    capabilities: policy.capabilities,
    isolation: policy.isolation,
    harnessControlledInputs: [
      inputRecord({
        id: "base-instructions",
        role: "base",
        content: policy.instructions.base,
      }),
      inputRecord({
        id: "developer-instructions",
        role: "developer",
        content: policy.instructions.developer,
      }),
      inputRecord(),
      ...continuationRecords,
    ],
    continuationPolicy: {
      controllerSha256: "4".repeat(64),
      maxTurns,
      allowedTransitions,
      templates,
    },
  };
}

async function executeAdapterFixture(
  t,
  {
    scenario = "happy-turn",
    controller,
    timeoutMs = 5_000,
    continuationPolicy,
    signal,
    mutatePolicy,
  },
) {
  const root = await temporaryRoot(t, "codex-adapter-execution-");
  const fixtureRoot = join(root, "fixture");
  const homePath = join(root, "execution-home");
  const preparedSession = join(root, "prepared");
  await mkdir(fixtureRoot);
  await mkdir(homePath);
  const policy = policyFixture(fixtureRoot);
  const toolchain = await inspectFakeToolchain(t, root, scenario);
  const packet = createTransmissionPacket(
    transmissionFixture(toolchain, policy, continuationPolicy),
  );
  const prepared = await prepareEvidenceSession({
    destination: preparedSession,
    packet,
    inputs: packet.transmission.harnessControlledInputs.map((input) => ({
      id: input.id,
      mediaType: input.mediaType,
      bytes: Buffer.from(input.content, "utf8"),
    })),
  });
  mutatePolicy?.(policy);
  const observations = {};
  observations.suppressCloseObservation = scenario === "shutdown-ambiguous";
  observations.rejectUnsafeRelease = scenario === "shutdown-ambiguous";
  observations.rejectSafeRelease = scenario === "safe-home-boundary-failure";

  const executionStartedAt = Date.now();
  const result = await executeAuthorizedModelSession({
    preparedSession: prepared,
    allowExternalModelCall: true,
    authorization: {
      schemaVersion: 1,
      decision: "authorized",
      statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
      allowExternalModel: true,
      provider: packet.transmission.provider,
      model: packet.transmission.model,
      effort: packet.transmission.effort,
      transmissionSha256: packet.transmissionSha256,
    },
    assertCurrent: async () => {},
    adapter: codexAppServerAdapter,
    request: Object.freeze({
      toolchain,
      policy,
      controller,
      withHome: homeBoundary(homePath, observations, "execution"),
      timeoutMs,
    }),
    signal,
  });
  const executionElapsedMs = Date.now() - executionStartedAt;

  return {
    fixtureRoot,
    homePath,
    observations,
    packet,
    preparedSession,
    result,
    executionElapsedMs,
  };
}

async function readJsonLines(path) {
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("the module exports only the reviewed public adapter surface", async () => {
  const module = await import("../../scripts/evaluation/codex-app-server.js");

  assert.deepEqual(Object.keys(module).sort(), [
    "codexAppServerAdapter",
    "inspectCodexAppServerToolchain",
    "preflightCodexAppServer",
  ]);
  assert.equal(Object.isFrozen(codexAppServerAdapter), true);
  assert.equal(codexAppServerAdapter.provider, "openai");
  assert.equal(typeof codexAppServerAdapter.execute, "function");
  assert.equal(typeof preflightCodexAppServer, "function");
});

test("toolchain inspection binds explicit prefix arguments and a canonical schema manifest", async (t) => {
  const root = await temporaryRoot(t);
  const scratchRoot = join(root, "scratch");

  const toolchain = await inspectCodexAppServerToolchain(
    fakeToolchainOptions(scratchRoot),
  );

  assert.equal(Object.isFrozen(toolchain), true);
  assert.equal(toolchain.schemaVersion, 1);
  assert.equal(toolchain.provider, "openai");
  assert.equal(toolchain.transport, "codex-app-server");
  assert.equal(toolchain.version, "codex-cli 9.9.9-test");
  assert.equal(toolchain.command.path, process.execPath);
  assert.equal(toolchain.command.byteLength > 0, true);
  assert.match(toolchain.command.sha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(toolchain.prefixArguments, [
    fakeAppServer,
    "--scenario",
    "happy",
  ]);
  assert.deepEqual(
    toolchain.boundPrefixFiles.map(({ argumentIndex, path }) => ({
      argumentIndex,
      path,
    })),
    [{ argumentIndex: 0, path: fakeAppServer }],
  );
  assert.deepEqual(
    toolchain.schemaManifest.map(({ path }) => path),
    ["ClientRequest.json", "v2/ThreadStartParams.json"],
  );
  assert.match(toolchain.schemaSha256, /^[0-9a-f]{64}$/u);

  const invocation = JSON.parse(
    await readFile(join(scratchRoot, "fake-invocation.json"), "utf8"),
  );
  assert.deepEqual(invocation, {
    arguments: [
      "--scenario",
      "happy",
      "app-server",
      "generate-json-schema",
      "--out",
      join(scratchRoot, "schema"),
    ],
    inheritedScenario: null,
  });
});

test("preflight proves the stable zero-turn isolated lifecycle and writes terminal evidence last", async (t) => {
  const root = await temporaryRoot(t);
  const fixtureRoot = join(root, "fixture");
  const homePath = join(root, "preflight-home");
  const evidenceDestination = join(root, "evidence");
  await mkdir(fixtureRoot);
  await mkdir(homePath);
  const toolchain = await inspectFakeToolchain(t, root);
  const observations = {};

  const result = await preflightCodexAppServer({
    toolchain,
    policy: policyFixture(fixtureRoot),
    withHome: homeBoundary(homePath, observations),
    evidenceDestination,
    timeoutMs: 5_000,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.failureClass, null);
  assert.equal(result.modelTurns, 0);
  assert.deepEqual(result.authentication, {
    accountType: "chatgpt",
    requiresOpenaiAuth: true,
  });
  assert.equal(Object.hasOwn(result.authentication, "email"), false);
  assert.equal(observations.registeredChildren, 1);
  assert.equal(observations.releases.length, 1);
  assert.equal(observations.releases[0].status, "safe");
  assert.equal(observations.releases[0].stdioStatus, "closed");
  assert.deepEqual(await readdir(evidenceDestination), [
    "events.jsonl",
    "policy.json",
    "preflight.json",
    "stderr.log",
    "toolchain.json",
    "transcript.jsonl",
  ]);

  const transcript = await readJsonLines(
    join(evidenceDestination, "transcript.jsonl"),
  );
  const clientMessages = transcript.filter(
    (message) => typeof message?.method === "string",
  );
  const methods = clientMessages.map(({ method }) => method);
  assert.equal(methods.filter((method) => method === "initialize").length, 1);
  assert.equal(methods.filter((method) => method === "initialized").length, 1);
  assert.equal(
    methods.indexOf("account/read") < methods.indexOf("thread/start"),
    true,
  );
  assert.equal(methods.includes("model/list"), true);
  assert.equal(methods.includes("modelProvider/capabilities/read"), true);
  assert.equal(methods.includes("skills/list"), true);
  assert.equal(methods.includes("hooks/list"), true);
  assert.equal(methods.includes("app/installed"), true);
  assert.equal(methods.includes("turn/start"), false);
  assert.equal(methods.at(-1), "thread/delete");
  const modelRequest = transcript.find(({ method }) => method === "model/list");
  const capabilitiesRequest = transcript.find(
    ({ method }) => method === "modelProvider/capabilities/read",
  );
  const capabilitiesResponseIndex = transcript.findIndex(
    (message) =>
      message.id === capabilitiesRequest.id &&
      !Object.hasOwn(message, "method"),
  );
  const modelResponseIndex = transcript.findIndex(
    (message) =>
      message.id === modelRequest.id && !Object.hasOwn(message, "method"),
  );
  assert.equal(capabilitiesResponseIndex < modelResponseIndex, true);
  assert.equal(
    transcript.some(
      ({ method }, index) =>
        method === "server/notice" && index < capabilitiesResponseIndex,
    ),
    true,
  );

  const initializeRequest = transcript.find(
    ({ method }) => method === "initialize",
  );
  const initializeResponse = transcript.find(
    (message) =>
      message.id === initializeRequest.id &&
      !Object.hasOwn(message, "method") &&
      Object.hasOwn(message, "result"),
  ).result;
  assert.equal(initializeResponse.codexHome, homePath);
  assert.deepEqual(
    initializeResponse.environmentNames,
    [
      "CODEX_HOME",
      ...Object.keys(policyFixture(fixtureRoot).isolation.environment.values),
    ].sort(),
  );
  assert.equal(initializeResponse.hasOpenaiApiKey, false);

  const threadStart = clientMessages.find(
    ({ method }) => method === "thread/start",
  );
  assert.deepEqual(threadStart.params, {
    allowProviderModelFallback: false,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    baseInstructions: "Use only the packet-bound evaluation instructions.",
    cwd: fixtureRoot,
    developerInstructions: "Do not discover ambient instructions.",
    dynamicTools: [],
    environments: [],
    ephemeral: true,
    model: "gpt-5.6-luna",
    modelProvider: "openai",
    runtimeWorkspaceRoots: [fixtureRoot],
    sandbox: "workspace-write",
    selectedCapabilityRoots: [],
  });

  const retained = await readFile(
    join(evidenceDestination, "transcript.jsonl"),
    "utf8",
  );
  assert.equal(retained.includes("secret@example.invalid"), false);
  assert.equal(retained.includes("accessToken"), false);
  const events = await readJsonLines(join(evidenceDestination, "events.jsonl"));
  assert.equal(
    events.some(({ method }) => method === "server/notice"),
    true,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(evidenceDestination, "preflight.json"), "utf8"),
    ),
    result,
  );
});

test("non-authentication server JSONL bytes and delimiters are retained exactly", async (t) => {
  const root = await temporaryRoot(t);
  const fixtureRoot = join(root, "fixture");
  const homePath = join(root, "preflight-home");
  const evidenceDestination = join(root, "evidence");
  await mkdir(fixtureRoot);
  await mkdir(homePath);
  const toolchain = await inspectFakeToolchain(t, root, "raw-transcript");
  const rawNotice =
    '{  "method" : "server/notice", "params" : { "category" : "preflight", "message" : "retained notification" }  }\r\n';

  const result = await preflightCodexAppServer({
    toolchain,
    policy: policyFixture(fixtureRoot),
    withHome: homeBoundary(homePath),
    evidenceDestination,
    timeoutMs: 5_000,
  });

  assert.equal(result.status, "completed");
  assert.equal(
    (
      await readFile(join(evidenceDestination, "transcript.jsonl"), "utf8")
    ).includes(rawNotice),
    true,
  );
});

test("missing authentication fails before thread creation and retains redacted diagnostics", async (t) => {
  const root = await temporaryRoot(t);
  const fixtureRoot = join(root, "fixture");
  const homePath = join(root, "preflight-home");
  const evidenceDestination = join(root, "evidence");
  await mkdir(fixtureRoot);
  await mkdir(homePath);
  const toolchain = await inspectFakeToolchain(t, root, "unauthenticated");

  const result = await preflightCodexAppServer({
    toolchain,
    policy: policyFixture(fixtureRoot),
    withHome: homeBoundary(homePath),
    evidenceDestination,
    timeoutMs: 5_000,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "preflight-rejected");
  assert.equal(result.modelTurns, 0);
  const transcript = await readJsonLines(
    join(evidenceDestination, "transcript.jsonl"),
  );
  const methods = transcript
    .filter((message) => typeof message?.method === "string")
    .map(({ method }) => method);
  assert.equal(methods.includes("account/read"), true);
  assert.equal(methods.includes("thread/start"), false);
  assert.equal(methods.includes("turn/start"), false);
  assert.equal(
    (
      await readFile(join(evidenceDestination, "transcript.jsonl"), "utf8")
    ).includes("secret@example.invalid"),
    false,
  );
});

test("authentication errors are replaced by deterministic redaction evidence", async (t) => {
  const root = await temporaryRoot(t);
  const fixtureRoot = join(root, "fixture");
  const homePath = join(root, "preflight-home");
  const evidenceDestination = join(root, "evidence");
  await mkdir(fixtureRoot);
  await mkdir(homePath);
  const toolchain = await inspectFakeToolchain(t, root, "authentication-error");

  const result = await preflightCodexAppServer({
    toolchain,
    policy: policyFixture(fixtureRoot),
    withHome: homeBoundary(homePath),
    evidenceDestination,
    timeoutMs: 5_000,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "protocol-failed");
  const persisted = `${await readFile(
    join(evidenceDestination, "transcript.jsonl"),
    "utf8",
  )}${await readFile(join(evidenceDestination, "preflight.json"), "utf8")}`;
  assert.equal(persisted.includes("secret@example.invalid"), false);
  assert.equal(persisted.includes("secret-access-token"), false);
  assert.equal(persisted.includes('"method":"account/read"'), true);
  assert.equal(persisted.includes('"redacted":true'), true);
});

test(
  "Windows environment names reject case-colliding packet entries",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await temporaryRoot(t);
    const fixtureRoot = join(root, "fixture");
    const homePath = join(root, "preflight-home");
    const evidenceDestination = join(root, "evidence");
    await mkdir(fixtureRoot);
    await mkdir(homePath);
    const toolchain = await inspectFakeToolchain(t, root);
    const policy = policyFixture(fixtureRoot);
    policy.isolation.environment.values.Path = "case-colliding-value";

    await assert.rejects(
      preflightCodexAppServer({
        toolchain,
        policy,
        withHome: homeBoundary(homePath),
        evidenceDestination,
        timeoutMs: 5_000,
      }),
      /case-colliding/u,
    );
  },
);

for (const [scenario, failureClass] of [
  ["malformed-json", "protocol-failed"],
  ["unknown-response", "protocol-failed"],
  ["duplicate-response", "protocol-failed"],
  ["premature-eof", "protocol-failed"],
  ["nonzero-exit", "provider-failed"],
]) {
  test(`${scenario} becomes a retained ${failureClass} preflight failure`, async (t) => {
    const root = await temporaryRoot(t);
    const fixtureRoot = join(root, "fixture");
    const homePath = join(root, "preflight-home");
    const evidenceDestination = join(root, "evidence");
    await mkdir(fixtureRoot);
    await mkdir(homePath);
    const toolchain = await inspectFakeToolchain(t, root, scenario);

    const result = await preflightCodexAppServer({
      toolchain,
      policy: policyFixture(fixtureRoot),
      withHome: homeBoundary(homePath),
      evidenceDestination,
      timeoutMs: 2_000,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, failureClass);
    assert.equal(result.modelTurns, 0);
    assert.equal(
      (await readFile(join(evidenceDestination, "transcript.jsonl")))
        .byteLength > 0,
      true,
    );
    assert.equal(
      JSON.parse(
        await readFile(join(evidenceDestination, "preflight.json"), "utf8"),
      ).failureClass,
      failureClass,
    );
    if (scenario === "nonzero-exit") {
      assert.match(
        await readFile(join(evidenceDestination, "stderr.log"), "utf8"),
        /deliberate fake failure/u,
      );
    }
  });
}

test("a protocol failure cannot escape while a request write is pending", async (t) => {
  const root = await temporaryRoot(t);
  const fixtureRoot = join(root, "fixture");
  const homePath = join(root, "preflight-home");
  const evidenceDestination = join(root, "evidence");
  const observations = {
    delayWriteCallbackForMethod: "account/read",
    writeCallbackDelayMs: 1_000,
  };
  await mkdir(fixtureRoot);
  await mkdir(homePath);
  const toolchain = await inspectFakeToolchain(
    t,
    root,
    "duplicate-while-account-write-pending",
  );

  const result = await preflightCodexAppServer({
    toolchain,
    policy: policyFixture(fixtureRoot),
    withHome: homeBoundary(homePath, observations),
    evidenceDestination,
    timeoutMs: 3_000,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "protocol-failed");
  assert.equal(result.modelTurns, 0);
  assert.equal(observations.registeredChildren, 1);
});

for (const [domain, mutate] of [
  [
    "executable identity",
    (toolchain) => {
      toolchain.command.sha256 = "0".repeat(64);
    },
  ],
  [
    "reported version",
    (toolchain) => {
      toolchain.version = "codex-cli 0.0.0-drifted";
    },
  ],
  [
    "schema digest",
    (toolchain) => {
      toolchain.schemaSha256 = "0".repeat(64);
    },
  ],
]) {
  test(`${domain} drift fails before home acquisition or account inspection`, async (t) => {
    const root = await temporaryRoot(t);
    const fixtureRoot = join(root, "fixture");
    const homePath = join(root, "preflight-home");
    const evidenceDestination = join(root, "evidence");
    await mkdir(fixtureRoot);
    await mkdir(homePath);
    const prepared = await inspectFakeToolchain(t, root);
    const drifted = structuredClone(prepared);
    mutate(drifted);
    const observations = {};

    const result = await preflightCodexAppServer({
      toolchain: drifted,
      policy: policyFixture(fixtureRoot),
      withHome: homeBoundary(homePath, observations),
      evidenceDestination,
      timeoutMs: 5_000,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, "preflight-rejected");
    assert.equal(result.error.code, "TOOLCHAIN_DRIFT");
    assert.equal(observations.registeredChildren, 0);
    assert.equal(
      (await readFile(join(evidenceDestination, "transcript.jsonl")))
        .byteLength,
      0,
    );
  });
}

for (const [scenario, failureClass, errorCode] of [
  ["model-unavailable", "preflight-rejected", "MODEL_UNAVAILABLE"],
  ["effort-unavailable", "preflight-rejected", "EFFORT_UNAVAILABLE"],
  [
    "provider-capability-mismatch",
    "capability-rejected",
    "PROVIDER_CAPABILITY_MISMATCH",
  ],
  ["enabled-skill", "capability-rejected", "SKILL_SOURCE_PRESENT"],
  ["disabled-skill", "capability-rejected", "SKILL_SOURCE_PRESENT"],
  ["enabled-hook", "capability-rejected", "HOOK_SOURCE_PRESENT"],
  ["disabled-hook", "capability-rejected", "HOOK_SOURCE_PRESENT"],
  ["callable-app", "capability-rejected", "CALLABLE_APP_PRESENT"],
  [
    "provider-image-capability-mismatch",
    "capability-rejected",
    "PROVIDER_CAPABILITY_MISMATCH",
  ],
  [
    "missing-initialize-isolation",
    "capability-rejected",
    "ENVIRONMENT_MISMATCH",
  ],
  ["leaked-instructions", "capability-rejected", "THREAD_ISOLATION_MISMATCH"],
  ["sandbox-mismatch", "capability-rejected", "THREAD_ISOLATION_MISMATCH"],
  [
    "missing-thread-isolation-field",
    "capability-rejected",
    "THREAD_ISOLATION_MISMATCH",
  ],
  ["external-capability", "capability-rejected", "EXTERNAL_CAPABILITY_EVENT"],
]) {
  test(`${scenario} fails closed before any model turn`, async (t) => {
    const root = await temporaryRoot(t);
    const fixtureRoot = join(root, "fixture");
    const homePath = join(root, "preflight-home");
    const evidenceDestination = join(root, "evidence");
    await mkdir(fixtureRoot);
    await mkdir(homePath);
    const toolchain = await inspectFakeToolchain(t, root, scenario);

    const result = await preflightCodexAppServer({
      toolchain,
      policy: policyFixture(fixtureRoot),
      withHome: homeBoundary(homePath),
      evidenceDestination,
      timeoutMs: 5_000,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, failureClass);
    assert.equal(result.error.code, errorCode);
    assert.equal(result.modelTurns, 0);
    const transcript = await readJsonLines(
      join(evidenceDestination, "transcript.jsonl"),
    );
    assert.equal(
      transcript.some(({ method }) => method === "turn/start"),
      false,
    );
    if (
      [
        "leaked-instructions",
        "missing-thread-isolation-field",
        "sandbox-mismatch",
      ].includes(scenario)
    ) {
      assert.equal(
        transcript.filter(({ method }) => method === "thread/delete").length,
        1,
      );
    }
  });
}

test("the documented already-ephemeral delete result is accepted", async (t) => {
  const root = await temporaryRoot(t);
  const fixtureRoot = join(root, "fixture");
  const homePath = join(root, "preflight-home");
  const evidenceDestination = join(root, "evidence");
  await mkdir(fixtureRoot);
  await mkdir(homePath);
  const toolchain = await inspectFakeToolchain(t, root, "already-ephemeral");

  const result = await preflightCodexAppServer({
    toolchain,
    policy: policyFixture(fixtureRoot),
    withHome: homeBoundary(homePath),
    evidenceDestination,
    timeoutMs: 5_000,
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.cleanup, {
    status: "already-ephemeral",
    threadId: "019a-generic-fake-thread",
  });
  assert.equal(result.modelTurns, 0);
});

test("a definite thread cleanup failure is retained without an automatic retry", async (t) => {
  const root = await temporaryRoot(t);
  const fixtureRoot = join(root, "fixture");
  const homePath = join(root, "preflight-home");
  const evidenceDestination = join(root, "evidence");
  await mkdir(fixtureRoot);
  await mkdir(homePath);
  const toolchain = await inspectFakeToolchain(t, root, "delete-failure");

  const result = await preflightCodexAppServer({
    toolchain,
    policy: policyFixture(fixtureRoot),
    withHome: homeBoundary(homePath),
    evidenceDestination,
    timeoutMs: 5_000,
  });

  assert.equal(result.status, "failed");
  const transcript = await readJsonLines(
    join(evidenceDestination, "transcript.jsonl"),
  );
  assert.equal(
    transcript.filter(({ method }) => method === "thread/delete").length,
    1,
  );
});

test("preflight deadline aborts a slow protocol before thread creation", async (t) => {
  const root = await temporaryRoot(t);
  const fixtureRoot = join(root, "fixture");
  const homePath = join(root, "preflight-home");
  const evidenceDestination = join(root, "evidence");
  await mkdir(fixtureRoot);
  await mkdir(homePath);
  const toolchain = await inspectFakeToolchain(t, root, "slow-account");

  const result = await preflightCodexAppServer({
    toolchain,
    policy: policyFixture(fixtureRoot),
    withHome: homeBoundary(homePath),
    evidenceDestination,
    timeoutMs: 25,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "timed-out");
  assert.equal(result.error.code, "ETIMEDOUT");
  assert.equal(result.closure.status, "safe");
  const transcript = await readJsonLines(
    join(evidenceDestination, "transcript.jsonl"),
  );
  assert.equal(
    transcript.some(({ method }) => method === "thread/start"),
    false,
  );
});

test("preflight preserves safe child evidence when home rotation later fails", async (t) => {
  const root = await temporaryRoot(t);
  const fixtureRoot = join(root, "fixture");
  const homePath = join(root, "preflight-home");
  const evidenceDestination = join(root, "evidence");
  await mkdir(fixtureRoot);
  await mkdir(homePath);
  const toolchain = await inspectFakeToolchain(t, root);
  const observations = { rejectSafeRelease: true };

  const result = await preflightCodexAppServer({
    toolchain,
    policy: policyFixture(fixtureRoot),
    withHome: homeBoundary(homePath, observations),
    evidenceDestination,
    timeoutMs: 5_000,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "HOME_ROTATION_FAILED");
  assert.deepEqual(result.closure, observations.releases[0]);
  assert.equal(result.closure.exitStatus, "observed");
  assert.equal(result.authentication.accountType, "chatgpt");
});

test("execution consumes one launch, returns the authoritative final agent item, and normalizes usage", async (t) => {
  let completionEvent = null;
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted(event) {
      completionEvent = event;
      return {
        action: "complete",
        suiteResult: { finalAnswer: event.finalAnswer },
      };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "happy-turn",
  });

  assert.equal(execution.result.status, "completed");
  assert.equal(execution.result.failureClass, null);
  assert.deepEqual(execution.result.suiteResult, {
    finalAnswer: "authoritative final answer 1",
  });
  assert.deepEqual(execution.result.nativeUsage, {
    cacheWriteInputTokens: 0,
    cachedInputTokens: 2,
    inputTokens: 12,
    outputTokens: 5,
    reasoningOutputTokens: 1,
    totalTokens: 17,
  });
  assert.deepEqual(execution.result.normalizedUsage, {
    inputTokens: 12,
    cachedInputTokens: 2,
    outputTokens: 5,
    totalTokens: 17,
    costUsd: null,
  });
  assert.deepEqual(Object.keys(completionEvent).sort(), [
    "finalAnswer",
    "nativeEventRange",
    "nativeUsage",
    "status",
    "turnIndex",
  ]);
  assert.equal(completionEvent.turnIndex, 1);
  assert.equal(completionEvent.status, "completed");
  assert.equal(completionEvent.finalAnswer, "authoritative final answer 1");
  assert.equal(Object.isFrozen(completionEvent), true);
  assert.equal(Object.isFrozen(completionEvent.nativeEventRange), true);
  assert.equal(Object.isFrozen(completionEvent.nativeUsage), true);
  assert.equal(
    Number.isSafeInteger(completionEvent.nativeEventRange.first),
    true,
  );
  assert.equal(
    Number.isSafeInteger(completionEvent.nativeEventRange.last),
    true,
  );
  assert.equal(
    completionEvent.nativeEventRange.first <=
      completionEvent.nativeEventRange.last,
    true,
  );
  assert.equal(execution.observations.registeredChildren, 1);
  assert.equal(
    await readFile(
      join(execution.preparedSession, "outputs", "final.md"),
      "utf8",
    ),
    "authoritative final answer 1",
  );
  const transcript = await readJsonLines(
    join(execution.preparedSession, "outputs", "transcript.jsonl"),
  );
  assert.equal(
    transcript.some(({ method }) => method === "turn/start"),
    true,
  );
  assert.equal(
    transcript.some(
      (message) => message?.params?.item?.text === "later non-final commentary",
    ),
    true,
  );
  const eventsPath = join(execution.preparedSession, "outputs", "events.jsonl");
  const events = await readJsonLines(eventsPath);
  const normalizedCompletion = events.find(
    ({ method }) => method === "controller/turn-completed",
  );
  assert.deepEqual(normalizedCompletion.params, completionEvent);
  assert.equal(
    (await readFile(eventsPath, "utf8")).includes("later non-final commentary"),
    false,
  );
});

test("a representable approval request is normalized and answered from the controller", async (t) => {
  let approvalEvent = null;
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted(event) {
      return {
        action: "complete",
        suiteResult: { finalAnswer: event.finalAnswer },
      };
    },
    async onApprovalRequest(event) {
      approvalEvent = event;
      return {
        decision: "allow",
        permissions: null,
        scope: "turn",
        reason: "fixture-scoped command",
      };
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "approval-turn",
  });

  assert.equal(execution.result.status, "completed");
  assert.deepEqual(approvalEvent, {
    turnIndex: 1,
    kind: "command",
    cwd: execution.fixtureRoot,
    command: "git status --short",
    permissions: null,
    nativeEventIndex: approvalEvent.nativeEventIndex,
  });
  assert.equal(Object.isFrozen(approvalEvent), true);
  assert.equal(Number.isSafeInteger(approvalEvent.nativeEventIndex), true);
  const transcript = await readJsonLines(
    join(execution.preparedSession, "outputs", "transcript.jsonl"),
  );
  assert.equal(
    transcript.some(
      (message) =>
        message?.id === 700 &&
        !Object.hasOwn(message, "method") &&
        message?.result?.decision === "accept",
    ),
    true,
  );
  const events = await readJsonLines(
    join(execution.preparedSession, "outputs", "events.jsonl"),
  );
  assert.equal(
    events.some(
      ({ method, params }) =>
        method === "controller/approval-request" &&
        params.kind === "command" &&
        params.turnIndex === 1,
    ),
    true,
  );
});

test("an upstream approval shape that cannot be normalized fails before the controller or response", async (t) => {
  let approvalCalls = 0;
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted() {
      throw new Error("turn completion was not expected");
    },
    async onApprovalRequest() {
      approvalCalls += 1;
      return { decision: "deny", reason: "denied" };
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "malformed-approval",
    timeoutMs: 250,
  });

  assert.equal(execution.result.status, "failed");
  assert.equal(execution.result.failureClass, "controller-failed");
  assert.equal(approvalCalls, 0);
  const transcript = await readJsonLines(
    join(execution.preparedSession, "outputs", "transcript.jsonl"),
  );
  assert.equal(
    transcript.some(
      (message) => message?.id === 701 && !Object.hasOwn(message, "method"),
    ),
    false,
  );
});

test("a malformed turn decision fails before a continuation is sent", async (t) => {
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted() {
      return { action: "complete" };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "happy-turn",
  });

  assert.equal(execution.result.status, "failed");
  assert.equal(execution.result.failureClass, "controller-failed");
  const transcript = await readJsonLines(
    join(execution.preparedSession, "outputs", "transcript.jsonl"),
  );
  assert.equal(
    transcript.filter(({ method }) => method === "turn/start").length,
    1,
  );
});

test("a controller cannot mint an unknown runtime failure class", async (t) => {
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted() {
      return {
        action: "reject",
        failureClass: "invented-failure-class",
        reason: "fixture rejection",
      };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "happy-turn",
  });

  assert.equal(execution.result.status, "failed");
  assert.equal(execution.result.failureClass, "controller-failed");
  assert.equal(execution.result.error.code, "TURN_CONTROLLER_FAILED");
});

test("turn timeout sends interrupt and thread cleanup before confirmed shutdown", async (t) => {
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted() {
      throw new Error("turn completion was not expected");
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "turn-timeout",
    timeoutMs: 75,
  });

  assert.equal(execution.result.status, "failed");
  assert.equal(execution.result.failureClass, "timed-out");
  assert.equal(execution.result.closure.status, "safe");
  assert.equal(
    execution.result.closure.terminationActions.includes("interrupt"),
    true,
  );
  const transcript = await readJsonLines(
    join(execution.preparedSession, "outputs", "transcript.jsonl"),
  );
  const methods = transcript
    .filter((message) => typeof message?.method === "string")
    .map(({ method }) => method);
  assert.equal(
    methods.indexOf("turn/interrupt") > methods.indexOf("turn/start"),
    true,
  );
  assert.equal(
    methods.indexOf("thread/delete") > methods.indexOf("turn/interrupt"),
    true,
  );
  assert.equal(execution.observations.releases[0].stdioStatus, "closed");
});

test(
  "cleanup requests are bounded when the provider stops answering",
  { timeout: 3_000 },
  async (t) => {
    const controller = Object.freeze({
      schemaVersion: 1,
      maxTurns: 1,
      initialInput: Object.freeze([
        Object.freeze({
          type: "text",
          text: "Packet-bound evaluation prompt",
        }),
      ]),
      async onTurnCompleted() {
        throw new Error("turn completion was not expected");
      },
      async onApprovalRequest() {
        throw new Error("approval was not expected");
      },
    });
    const execution = await executeAdapterFixture(t, {
      controller,
      scenario: "cleanup-response-timeout",
      timeoutMs: 50,
    });

    assert.equal(execution.result.status, "failed");
    assert.equal(execution.result.failureClass, "timed-out");
    assert.equal(execution.result.closure.status, "safe");
    assert.equal(execution.executionElapsedMs < 500, true);
  },
);

test("a packet-bound continuation starts exactly one additional turn", async (t) => {
  const continuationInput = Object.freeze([
    Object.freeze({ type: "text", text: "Authorized continuation" }),
  ]);
  const completionEvents = [];
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 2,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted(event) {
      completionEvents.push(event);
      return event.turnIndex === 1
        ? {
            action: "continue",
            transitionId: "authorized-second-turn",
            input: continuationInput,
          }
        : {
            action: "complete",
            suiteResult: { finalAnswer: event.finalAnswer },
          };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "happy-turn",
    continuationPolicy: {
      maxTurns: 2,
      allowedTransitions: ["authorized-second-turn"],
      templates: [
        {
          transitionId: "authorized-second-turn",
          input: continuationInput,
        },
      ],
    },
  });

  assert.equal(execution.result.status, "completed");
  assert.equal(completionEvents.length, 2);
  assert.deepEqual(execution.result.suiteResult, {
    finalAnswer: "authoritative final answer 2",
  });
  assert.deepEqual(execution.result.normalizedUsage, {
    inputTokens: 24,
    cachedInputTokens: 2,
    outputTokens: 10,
    totalTokens: 34,
    costUsd: null,
  });
  const transcript = await readJsonLines(
    join(execution.preparedSession, "outputs", "transcript.jsonl"),
  );
  const starts = transcript.filter(({ method }) => method === "turn/start");
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[1].params.input, continuationInput);
  const events = await readJsonLines(
    join(execution.preparedSession, "outputs", "events.jsonl"),
  );
  assert.equal(
    events.some(
      ({ method, params }) =>
        method === "controller/continuation" &&
        params.transitionId === "authorized-second-turn",
    ),
    true,
  );
  assert.deepEqual(
    events.map(({ eventIndex }) => eventIndex),
    events.map((_event, index) => index),
  );
});

test("a continuation is snapshotted before asynchronous controller mutation", async (t) => {
  const continuationText = `Authorized continuation ${"x".repeat(1_000_000)}`;
  const templateInput = Object.freeze([
    Object.freeze({ type: "text", text: continuationText }),
  ]);
  const decisionInput = [{ type: "text", text: continuationText }];
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 2,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted(event) {
      if (event.turnIndex === 1) {
        setTimeout(() => {
          decisionInput[0].text = "Mutated after validation";
        }, 0);
        return {
          action: "continue",
          transitionId: "authorized-second-turn",
          input: decisionInput,
        };
      }
      return {
        action: "complete",
        suiteResult: { finalAnswer: event.finalAnswer },
      };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "happy-turn",
    continuationPolicy: {
      maxTurns: 2,
      allowedTransitions: ["authorized-second-turn"],
      templates: [
        {
          transitionId: "authorized-second-turn",
          input: templateInput,
        },
      ],
    },
  });

  assert.equal(execution.result.status, "completed");
  const transcript = await readJsonLines(
    join(execution.preparedSession, "outputs", "transcript.jsonl"),
  );
  const starts = transcript.filter(({ method }) => method === "turn/start");
  assert.deepEqual(starts[1].params.input, templateInput);
});

test("a continuation whose bytes do not match its packet template is not transmitted", async (t) => {
  const allowedInput = Object.freeze([
    Object.freeze({ type: "text", text: "Authorized continuation" }),
  ]);
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 2,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted() {
      return {
        action: "continue",
        transitionId: "authorized-second-turn",
        input: [{ type: "text", text: "Different continuation" }],
      };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "happy-turn",
    continuationPolicy: {
      maxTurns: 2,
      allowedTransitions: ["authorized-second-turn"],
      templates: [
        {
          transitionId: "authorized-second-turn",
          input: allowedInput,
        },
      ],
    },
  });

  assert.equal(execution.result.status, "failed");
  assert.equal(execution.result.failureClass, "controller-failed");
  const transcript = await readJsonLines(
    join(execution.preparedSession, "outputs", "transcript.jsonl"),
  );
  assert.equal(
    transcript.filter(({ method }) => method === "turn/start").length,
    1,
  );
});

test("filesystem permission approval preserves exact permissions and turn scope", async (t) => {
  let approvalEvent = null;
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted(event) {
      return {
        action: "complete",
        suiteResult: { finalAnswer: event.finalAnswer },
      };
    },
    async onApprovalRequest(event) {
      approvalEvent = event;
      return {
        decision: "allow",
        permissions: event.permissions,
        scope: "turn",
        reason: "fixture-scoped permission",
      };
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "permissions-turn",
  });

  assert.equal(execution.result.status, "completed");
  assert.equal(approvalEvent.kind, "filesystem");
  assert.equal(approvalEvent.command, null);
  assert.deepEqual(approvalEvent.permissions, {
    fileSystem: {
      entries: [
        {
          access: "write",
          path: {
            path: join(execution.fixtureRoot, "result.txt"),
            type: "path",
          },
        },
      ],
    },
    network: { enabled: false },
  });
  const transcript = await readJsonLines(
    join(execution.preparedSession, "outputs", "transcript.jsonl"),
  );
  const response = transcript.find(
    (message) => message?.id === 702 && !Object.hasOwn(message, "method"),
  ).result;
  assert.deepEqual(response, {
    permissions: approvalEvent.permissions,
    scope: "turn",
    strictAutoReview: false,
  });
});

for (const [scenario, failureClass, errorCode] of [
  ["missing-final", "protocol-failed", "MISSING_FINAL_AGENT_ITEM"],
  [
    "external-capability-turn",
    "capability-rejected",
    "EXTERNAL_CAPABILITY_EVENT",
  ],
  ["external-item-turn", "capability-rejected", "EXTERNAL_CAPABILITY_EVENT"],
  ["turn-provider-failure", "provider-failed", "NONZERO_EXIT"],
]) {
  test(`${scenario} is retained as ${failureClass}`, async (t) => {
    const controller = Object.freeze({
      schemaVersion: 1,
      maxTurns: 1,
      initialInput: Object.freeze([
        Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
      ]),
      async onTurnCompleted(event) {
        return {
          action: "complete",
          suiteResult: { finalAnswer: event.finalAnswer },
        };
      },
      async onApprovalRequest() {
        throw new Error("approval was not expected");
      },
    });

    const execution = await executeAdapterFixture(t, {
      controller,
      scenario,
      timeoutMs: 500,
    });

    assert.equal(execution.result.status, "failed");
    assert.equal(execution.result.failureClass, failureClass);
    assert.equal(execution.result.error.code, errorCode);
    if (scenario === "missing-final") {
      const transcript = await readJsonLines(
        join(execution.preparedSession, "outputs", "transcript.jsonl"),
      );
      assert.equal(
        transcript.some(({ method }) => method === "turn/interrupt"),
        false,
      );
    }
    if (scenario === "turn-provider-failure") {
      assert.match(
        await readFile(
          join(execution.preparedSession, "outputs", "stderr.log"),
          "utf8",
        ),
        /turn provider failed deliberately/u,
      );
    }
  });
}

test("ambiguous descendant-held stdio returns an unsafe release so the home cannot rotate", async (t) => {
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted(event) {
      return {
        action: "complete",
        suiteResult: { finalAnswer: event.finalAnswer },
      };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "shutdown-ambiguous",
    timeoutMs: 150,
  });

  assert.equal(execution.result.status, "failed");
  assert.equal(execution.result.closure.status, "unsafe");
  assert.equal(execution.result.closure.reasonCode, "shutdown-ambiguous");
  assert.equal(execution.observations.releases[0].status, "unsafe");
});

test("home-boundary rejection preserves the exact unsafe shutdown disposition", async (t) => {
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted(event) {
      return {
        action: "complete",
        suiteResult: { finalAnswer: event.finalAnswer },
      };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "shutdown-ambiguous",
    timeoutMs: 150,
  });

  assert.equal(execution.result.status, "failed");
  assert.deepEqual(
    execution.result.closure,
    execution.observations.releases[0],
  );
  assert.equal(execution.result.closure.reasonCode, "shutdown-ambiguous");
});

test("execution preserves safe child evidence when home rotation later fails", async (t) => {
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted(event) {
      return {
        action: "complete",
        suiteResult: { finalAnswer: event.finalAnswer },
      };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "safe-home-boundary-failure",
  });

  assert.equal(execution.result.status, "failed");
  assert.equal(execution.result.error.code, "HOME_ROTATION_FAILED");
  assert.deepEqual(
    execution.result.closure,
    execution.observations.releases[0],
  );
  assert.equal(execution.result.closure.exitStatus, "observed");
});

test("a controller may complete with a null suite result", async (t) => {
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted() {
      return { action: "complete", suiteResult: null };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "happy-turn",
  });

  assert.equal(execution.result.status, "completed");
  assert.equal(execution.result.suiteResult, null);
});

test("controller input items must be immutable before home acquisition", async (t) => {
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      { type: "text", text: "Packet-bound evaluation prompt" },
    ]),
    async onTurnCompleted() {
      return { action: "complete", suiteResult: null };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "happy-turn",
  });

  assert.equal(execution.result.status, "failed");
  assert.equal(execution.observations.registeredChildren, 0);
  await assert.rejects(
    readFile(join(execution.preparedSession, "attempt.json")),
    { code: "ENOENT" },
  );
});

test("controller initial input must match the packet-bound user bytes", async (t) => {
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Different unbound prompt" }),
    ]),
    async onTurnCompleted() {
      return { action: "complete", suiteResult: null };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "happy-turn",
  });

  assert.equal(execution.result.status, "failed");
  assert.equal(execution.observations.registeredChildren, 0);
  await assert.rejects(
    readFile(join(execution.preparedSession, "attempt.json")),
    { code: "ENOENT" },
  );
});

test("execution instructions must match the packet-bound instruction bytes", async (t) => {
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted() {
      return { action: "complete", suiteResult: null };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "happy-turn",
    mutatePolicy(policy) {
      policy.instructions.developer = "Mutated unbound instructions";
    },
  });

  assert.equal(execution.result.status, "failed");
  assert.equal(execution.observations.registeredChildren, 0);
  await assert.rejects(
    readFile(join(execution.preparedSession, "attempt.json")),
    { code: "ENOENT" },
  );
});

test("declared continuation templates must also be present as packet-bound bytes", async (t) => {
  const continuationInput = Object.freeze([
    Object.freeze({ type: "text", text: "Authorized continuation" }),
  ]);
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 2,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted(event) {
      return {
        action: "complete",
        suiteResult: { finalAnswer: event.finalAnswer },
      };
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "happy-turn",
    continuationPolicy: {
      maxTurns: 2,
      allowedTransitions: ["authorized-second-turn"],
      omitContinuationRecords: true,
      templates: [
        {
          transitionId: "authorized-second-turn",
          input: continuationInput,
        },
      ],
    },
  });

  assert.equal(execution.result.status, "failed");
  assert.equal(execution.observations.registeredChildren, 0);
  await assert.rejects(
    readFile(join(execution.preparedSession, "attempt.json")),
    { code: "ENOENT" },
  );
});

test("a pre-aborted execution does not acquire a home or spend its launch capability", async (t) => {
  const controller = Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "Packet-bound evaluation prompt" }),
    ]),
    async onTurnCompleted() {
      throw new Error("turn completion was not expected");
    },
    async onApprovalRequest() {
      throw new Error("approval was not expected");
    },
  });
  const abortController = new AbortController();
  abortController.abort(new Error("cancel before launch"));

  const execution = await executeAdapterFixture(t, {
    controller,
    scenario: "happy-turn",
    signal: abortController.signal,
  });

  assert.equal(execution.result.status, "failed");
  assert.equal(execution.observations.registeredChildren, 0);
  await assert.rejects(
    readFile(join(execution.preparedSession, "attempt.json")),
    { code: "ENOENT" },
  );
});

test("a preflight home context with the wrong role fails before child registration", async (t) => {
  const root = await temporaryRoot(t);
  const fixtureRoot = join(root, "fixture");
  const homePath = join(root, "wrong-role-home");
  const evidenceDestination = join(root, "evidence");
  await mkdir(fixtureRoot);
  await mkdir(homePath);
  const toolchain = await inspectFakeToolchain(t, root);
  let registrations = 0;

  const result = await preflightCodexAppServer({
    toolchain,
    policy: policyFixture(fixtureRoot),
    withHome: async (operation) => {
      const operationResult = await operation(
        Object.freeze({
          role: "execution",
          path: homePath,
          environment: Object.freeze({ CODEX_HOME: homePath }),
          registerChild() {
            registrations += 1;
          },
        }),
      );
      return operationResult.value;
    },
    evidenceDestination,
    timeoutMs: 5_000,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "HOME_CONTEXT_MISMATCH");
  assert.equal(registrations, 0);
});
