import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  assertTransmissionPacket,
  canonicalJsonBytes,
  consumeExternalModelLaunch,
  createTransmissionPacket,
  executeAuthorizedModelSession,
  prepareEvidenceSession,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";

function independentSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("production evaluation modules use the shared SHA-256 owner", async () => {
  for (const relativePath of [
    "../../scripts/evaluation/antigravity-cli.js",
    "../../scripts/evaluation/claude-cli.js",
    "../../evals/committing-to-git/evaluation-runner.mjs",
  ]) {
    const source = await readFile(
      new URL(relativePath, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /function sha256\s*\(/u, relativePath);
  }
});

function inputRecord({
  id = "prompt",
  role = "user",
  mediaType = "text/plain",
  content = "Explain the concept.",
} = {}) {
  const bytes = Buffer.from(content, "utf8");

  return {
    id,
    role,
    mediaType,
    encoding: "utf8",
    content,
    byteLength: bytes.byteLength,
    sha256: independentSha256(bytes),
  };
}

function transmissionFixture() {
  return {
    suite: "defining-concepts",
    session: {
      preparedSessionId: "0123456789abcdef0123456789abcdef",
      caseId: "closures",
      arm: "with-skill",
      repetition: 1,
      sequence: 1,
      suiteArtifacts: [],
    },
    provider: "openai",
    model: "gpt-5.6-luna",
    effort: "low",
    transport: "codex-app-server",
    toolchain: {
      node: "v24.7.0",
      operatingSystem: "win32",
      providerCli: "codex 0.116.0",
      protocol: "app-server-v2",
      schemaSha256: "1".repeat(64),
    },
    runtimeFingerprint: {
      gitCommit: "2".repeat(40),
      gitTree: "3".repeat(40),
      modules: [
        {
          path: "scripts/evaluation/runtime.js",
          byteLength: 100,
          sha256: "4".repeat(64),
        },
      ],
    },
    capabilities: {
      network: false,
      webSearch: false,
      tools: [],
      providerFacilities: [],
    },
    isolation: {
      sandbox: "read-only",
      workingDirectory: "C:\\evaluation\\scratch",
      instructionSources: [],
      persistence: false,
      stableHome: {
        root: "C:\\EvaluationHomes\\v1",
        role: "execution",
      },
      environment: {
        values: {
          PATH: "C:\\Windows\\System32",
        },
        secretSources: [],
      },
    },
    harnessControlledInputs: [inputRecord()],
    continuationPolicy: {
      controllerSha256: "5".repeat(64),
      maxTurns: 1,
      allowedTransitions: [],
      templates: [],
    },
  };
}

function capabilityReconciliationFixture(capabilities) {
  const receipt = {
    schemaVersion: 1,
    suite: "defining-concepts",
    requiredCapabilities: ["bundled-skill-files", "url-fetch", "web-search"],
    runtimeCapabilities: structuredClone(capabilities),
  };
  return {
    schemaVersion: 1,
    receipt,
    receiptSha256: sha256Hex(canonicalJsonBytes(receipt)),
  };
}

function mutateTransmission(mutator) {
  const transmission = structuredClone(transmissionFixture());
  mutator(transmission);
  return transmission;
}

async function pathExists(path) {
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

async function manuallyPrepareSession(t) {
  const root = await mkdtemp(join(tmpdir(), "evaluation-runtime-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const preparedSession = join(root, "prepared-session");
  const inputsDirectory = join(preparedSession, "inputs");
  const packet = createTransmissionPacket(transmissionFixture());
  const input = packet.transmission.harnessControlledInputs[0];
  const relativePath = "inputs/0001-prompt.txt";
  const manifest = {
    schemaVersion: 1,
    inputs: [
      {
        id: input.id,
        relativePath,
        mediaType: input.mediaType,
        byteLength: input.byteLength,
        sha256: input.sha256,
      },
    ],
  };

  await mkdir(inputsDirectory, { recursive: true });
  await writeFile(
    join(preparedSession, "packet.json"),
    canonicalJsonBytes(packet),
  );
  await writeFile(join(preparedSession, relativePath), input.content, "utf8");
  await writeFile(
    join(inputsDirectory, "manifest.json"),
    canonicalJsonBytes(manifest),
  );

  return { packet, preparedSession, relativePath };
}

function authorizationFixture(packet, overrides = {}) {
  return {
    schemaVersion: 1,
    decision: "authorized",
    statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
    allowExternalModel: true,
    provider: packet.transmission.provider,
    model: packet.transmission.model,
    effort: packet.transmission.effort,
    transmissionSha256: packet.transmissionSha256,
    ...overrides,
  };
}

function completedAdapter(onLaunch) {
  return Object.freeze({
    provider: "openai",
    async execute({ launchCapability, transmission }) {
      await consumeExternalModelLaunch(launchCapability, {
        provider: transmission.provider,
        model: transmission.model,
        effort: transmission.effort,
        transmissionSha256: sha256Hex(canonicalJsonBytes(transmission)),
      });
      onLaunch();

      return {
        status: "completed",
        failureClass: null,
        error: null,
        nativeUsage: { input_tokens: 10, output_tokens: 4 },
        normalizedUsage: {
          inputTokens: 10,
          cachedInputTokens: 0,
          outputTokens: 4,
          totalTokens: 14,
          costUsd: null,
        },
        closure: {
          status: "safe",
          exitStatus: "observed",
          exitCode: 0,
          exitSignal: null,
          stdioStatus: "closed",
          protocolStatus: "closed",
          terminationActions: [],
          descendantStatus: "none-observed",
        },
        suiteResult: { finalAnswer: "complete" },
      };
    },
  });
}

function adapterResult(overrides = {}) {
  return {
    status: "completed",
    failureClass: null,
    error: null,
    nativeUsage: { input_tokens: 10, output_tokens: 4 },
    normalizedUsage: {
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 4,
      totalTokens: 14,
      costUsd: null,
    },
    closure: {
      status: "safe",
      exitStatus: "observed",
      exitCode: 0,
      exitSignal: null,
      stdioStatus: "closed",
      protocolStatus: "closed",
      terminationActions: [],
      descendantStatus: "none-observed",
    },
    suiteResult: { finalAnswer: "complete" },
    ...overrides,
  };
}

async function consumeLaunch({ launchCapability, transmission }) {
  await consumeExternalModelLaunch(launchCapability, {
    provider: transmission.provider,
    model: transmission.model,
    effort: transmission.effort,
    transmissionSha256: sha256Hex(canonicalJsonBytes(transmission)),
  });
}

function executingAdapter(execute) {
  return Object.freeze({
    provider: "openai",
    execute,
  });
}

async function prepareWithRuntime(
  t,
  { packet, destinationName = "prepared" } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "evaluation-runtime-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const selectedPacket =
    packet ?? createTransmissionPacket(transmissionFixture());
  const destination = join(root, destinationName);
  const inputs = selectedPacket.transmission.harnessControlledInputs.map(
    ({ id, mediaType, encoding, content }) => ({
      id,
      mediaType,
      bytes:
        encoding === "base64"
          ? Buffer.from(content, "base64")
          : Buffer.from(content, "utf8"),
    }),
  );
  const prepared = await prepareEvidenceSession({
    destination,
    packet: selectedPacket,
    inputs,
  });

  return { destination, packet: selectedPacket, prepared, root };
}

async function executeFixture({
  preparedSession,
  packet,
  allowExternalModelCall = true,
  authorization = authorizationFixture(packet),
  assertCurrent = async () => {},
  onLaunch = () => {},
}) {
  return executeAuthorizedModelSession({
    preparedSession,
    allowExternalModelCall,
    authorization,
    assertCurrent,
    adapter: completedAdapter(onLaunch),
    request: Object.freeze({}),
  });
}

test("canonicalJsonBytes matches the RFC 8785 numeric serialization vector", () => {
  const input = {
    numbers: [Number("333333333.33333329"), 1e30, 4.5, 2e-3, 1e-27],
  };
  const expected = Buffer.from(
    '{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}',
    "utf8",
  );

  assert.deepEqual(canonicalJsonBytes(input), expected);
});

test("canonicalJsonBytes preserves primitive and array order", () => {
  const expected = Buffer.from(
    '{"literals":[null,true,false],"ordered":[3,2,1]}',
    "utf8",
  );

  assert.deepEqual(
    canonicalJsonBytes({ ordered: [3, 2, 1], literals: [null, true, false] }),
    expected,
  );
});

test("canonicalJsonBytes sorts object names by raw UTF-16 code units", () => {
  const input = {
    "\u20ac": "Euro Sign",
    "\r": "Carriage Return",
    "\ufb33": "Hebrew Letter Dalet With Dagesh",
    1: "One",
    "\ud83d\ude00": "Emoji",
    "\u0080": "Control",
    "\u00f6": "Latin Small Letter O With Diaeresis",
  };
  const expected = Buffer.from(
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign","\ud83d\ude00":"Emoji","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
    "utf8",
  );

  assert.deepEqual(canonicalJsonBytes(input), expected);
});

test("canonicalJsonBytes emits exact UTF-8 and performs no Unicode normalization", () => {
  const composed = canonicalJsonBytes({ text: "\u00e9 \u20ac" });
  const decomposed = canonicalJsonBytes({ text: "e\u0301 \u20ac" });

  assert.deepEqual(composed, Buffer.from('{"text":"\u00e9 \u20ac"}', "utf8"));
  assert.notDeepEqual(composed, decomposed);
  assert.notEqual(independentSha256(composed), independentSha256(decomposed));
});

test("canonicalJsonBytes is independent of object insertion order", () => {
  const first = { z: 3, a: { y: 2, x: 1 } };
  const second = { a: { x: 1, y: 2 }, z: 3 };

  assert.deepEqual(canonicalJsonBytes(first), canonicalJsonBytes(second));
  assert.equal(
    sha256Hex(canonicalJsonBytes(first)),
    sha256Hex(canonicalJsonBytes(second)),
  );
});

test("canonicalJsonBytes rejects values that JSON would silently alter", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = [];
  sparse[1] = "value";
  const withAccessor = {};
  Object.defineProperty(withAccessor, "secret", {
    enumerable: true,
    get() {
      return "value";
    },
  });

  const invalidValues = [
    ["undefined", undefined],
    ["function", () => {}],
    ["symbol", Symbol("value")],
    ["bigint", 1n],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["lone surrogate", "\ud800"],
    ["sparse array", sparse],
    ["cycle", cyclic],
    ["non-plain prototype", new Date("2026-08-24T00:00:00.000Z")],
    ["accessor", withAccessor],
    ["toJSON hook", { toJSON() {} }],
  ];

  for (const [label, value] of invalidValues) {
    assert.throws(
      () => canonicalJsonBytes(value),
      { name: "TypeError" },
      label,
    );
  }
});

test("sha256Hex accepts bytes only and returns lowercase hexadecimal", () => {
  assert.equal(
    sha256Hex(Buffer.from("abc", "utf8")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.throws(() => sha256Hex("abc"), { name: "TypeError" });
});

test("createTransmissionPacket binds every transmission domain", () => {
  const baseline = createTransmissionPacket(transmissionFixture());
  const mutations = [
    (value) => {
      value.provider = "anthropic";
      value.transport = "claude-cli";
    },
    (value) => {
      value.model = "claude-opus-4-1";
    },
    (value) => {
      value.effort = "high";
    },
    (value) => {
      value.toolchain.schemaSha256 = "6".repeat(64);
    },
    (value) => {
      value.runtimeFingerprint.gitTree = "7".repeat(40);
    },
    (value) => {
      value.capabilities.webSearch = true;
    },
    (value) => {
      value.isolation.sandbox = "workspace-write";
    },
    (value) => {
      value.continuationPolicy.controllerSha256 = "8".repeat(64);
    },
    (value) => {
      value.harnessControlledInputs[0] = inputRecord({
        content: "Explain a different concept.",
      });
    },
    (value) => {
      value.harnessControlledInputs.push(
        inputRecord({ id: "second-prompt", content: "Second input." }),
      );
    },
  ];

  for (const mutate of mutations) {
    const changed = createTransmissionPacket(mutateTransmission(mutate));
    assert.notEqual(changed.transmissionSha256, baseline.transmissionSha256);
  }
});

test("a capability reconciliation receipt is authenticated when present", () => {
  const transmission = transmissionFixture();
  transmission.capabilities.webSearch = true;
  transmission.capabilityReconciliation = capabilityReconciliationFixture(
    transmission.capabilities,
  );
  const packet = createTransmissionPacket(transmission);

  assert.deepEqual(
    packet.transmission.capabilityReconciliation,
    transmission.capabilityReconciliation,
  );
  const changed = structuredClone(packet);
  changed.transmission.capabilityReconciliation.receipt.requiredCapabilities = [
    "bundled-skill-files",
  ];
  changed.transmissionSha256 = sha256Hex(
    canonicalJsonBytes(changed.transmission),
  );
  assert.throws(
    () => assertTransmissionPacket(changed),
    /capability reconciliation.*digest/iu,
  );
});

test("a reconciled runtime envelope must exactly match packet capabilities", () => {
  const transmission = transmissionFixture();
  transmission.capabilityReconciliation = capabilityReconciliationFixture({
    ...transmission.capabilities,
    webSearch: true,
  });

  assert.throws(
    () => createTransmissionPacket(transmission),
    /runtime capabilities.*transmission capabilities/iu,
  );
});

test("legacy packets may omit capability reconciliation", () => {
  const packet = createTransmissionPacket(transmissionFixture());

  assert.equal(
    Object.hasOwn(packet.transmission, "capabilityReconciliation"),
    false,
  );
  assert.doesNotThrow(() => assertTransmissionPacket(packet));
});

test("Google transmissions require the Antigravity CLI transport", () => {
  const transmission = mutateTransmission((value) => {
    value.provider = "google";
    value.transport = "antigravity-cli";
    value.model = "gemini-3.5-flash-low";
  });

  const packet = createTransmissionPacket(transmission);
  assert.equal(packet.transmission.provider, "google");
  assert.equal(packet.transmission.transport, "antigravity-cli");
  const openai = mutateTransmission((value) => {
    value.model = transmission.model;
  });
  assert.notEqual(
    packet.transmissionSha256,
    createTransmissionPacket(openai).transmissionSha256,
  );

  const mismatched = structuredClone(transmission);
  mismatched.transport = "claude-cli";
  assert.throws(
    () => createTransmissionPacket(mismatched),
    /transport does not match its provider/u,
  );
});

test("array order and string bytes affect the transmission digest", () => {
  const reordered = mutateTransmission((value) => {
    value.capabilities.tools = ["write", "read"];
  });
  const reversed = mutateTransmission((value) => {
    value.capabilities.tools = ["read", "write"];
  });
  const composed = mutateTransmission((value) => {
    value.session.caseId = "\u00e9";
  });
  const decomposed = mutateTransmission((value) => {
    value.session.caseId = "e\u0301";
  });

  assert.notEqual(
    createTransmissionPacket(reordered).transmissionSha256,
    createTransmissionPacket(reversed).transmissionSha256,
  );
  assert.notEqual(
    createTransmissionPacket(composed).transmissionSha256,
    createTransmissionPacket(decomposed).transmissionSha256,
  );
});

test("assertTransmissionPacket recomputes the digest", () => {
  const packet = createTransmissionPacket(transmissionFixture());
  const mutated = structuredClone(packet);
  mutated.transmission.model = "different-model";

  assert.doesNotThrow(() => assertTransmissionPacket(packet));
  assert.throws(() => assertTransmissionPacket(mutated), /digest/u);
});

test("packet schemas reject unknown versions, members, and enum values", () => {
  const valid = createTransmissionPacket(transmissionFixture());
  const unknownVersion = structuredClone(valid);
  unknownVersion.schemaVersion = 2;
  const unknownPacketMember = structuredClone(valid);
  unknownPacketMember.extra = true;
  const unknownTransmissionMember = structuredClone(valid);
  unknownTransmissionMember.transmission.extra = true;
  const unknownInputMember = structuredClone(valid);
  unknownInputMember.transmission.harnessControlledInputs[0].extra = true;
  const unknownProvider = structuredClone(valid);
  unknownProvider.transmission.provider = "unknown";

  for (const packet of [
    unknownVersion,
    unknownPacketMember,
    unknownTransmissionMember,
    unknownInputMember,
    unknownProvider,
  ]) {
    assert.throws(() => assertTransmissionPacket(packet));
  }
});

test("literal external-call permission is required before adapter launch", async (t) => {
  const { packet, preparedSession } = await manuallyPrepareSession(t);
  let launches = 0;

  const result = await executeFixture({
    preparedSession,
    packet,
    allowExternalModelCall: false,
    onLaunch: () => {
      launches += 1;
    },
  });

  assert.equal(result.failureClass, "authorization-rejected");
  assert.equal(launches, 0);
  assert.equal(
    await pathExists(join(preparedSession, "authorization.json")),
    false,
  );
  assert.equal(await pathExists(join(preparedSession, "attempt.json")), false);
});

for (const [name, overrides] of [
  ["transmission digest", { transmissionSha256: "9".repeat(64) }],
  ["provider", { provider: "anthropic" }],
  ["model", { model: "different-model" }],
  ["effort", { effort: "high" }],
  ["fixed statement", { statement: "Authorize something else." }],
  ["literal authorization", { allowExternalModel: false }],
]) {
  test(`a mismatched authorization ${name} cannot launch the adapter`, async (t) => {
    const { packet, preparedSession } = await manuallyPrepareSession(t);
    let launches = 0;

    const result = await executeFixture({
      preparedSession,
      packet,
      authorization: authorizationFixture(packet, overrides),
      onLaunch: () => {
        launches += 1;
      },
    });

    assert.equal(result.failureClass, "authorization-rejected");
    assert.equal(launches, 0);
    assert.equal(
      await pathExists(join(preparedSession, "attempt.json")),
      false,
    );
  });
}

test("a changed canonical packet cannot launch the adapter", async (t) => {
  const { packet, preparedSession } = await manuallyPrepareSession(t);
  const changedPacket = structuredClone(packet);
  changedPacket.transmission.model = "changed-after-preparation";
  await writeFile(
    join(preparedSession, "packet.json"),
    canonicalJsonBytes(changedPacket),
  );
  let launches = 0;

  const result = await executeFixture({
    preparedSession,
    packet,
    onLaunch: () => {
      launches += 1;
    },
  });

  assert.equal(result.failureClass, "authorization-rejected");
  assert.equal(launches, 0);
});

test("a stale prepared input cannot launch the adapter", async (t) => {
  const { packet, preparedSession, relativePath } =
    await manuallyPrepareSession(t);
  await writeFile(join(preparedSession, relativePath), "mutated input", "utf8");
  let launches = 0;

  const result = await executeFixture({
    preparedSession,
    packet,
    onLaunch: () => {
      launches += 1;
    },
  });

  assert.equal(result.failureClass, "authorization-rejected");
  assert.equal(launches, 0);
  assert.equal(await pathExists(join(preparedSession, "attempt.json")), false);
});

for (const name of [
  "toolchain or protocol schema",
  "runtime module or committed tree",
]) {
  test(`${name} drift cannot launch the adapter`, async (t) => {
    const { packet, preparedSession } = await manuallyPrepareSession(t);
    let launches = 0;
    const drift = new Error(`${name} drifted`);
    drift.code = "CURRENT_STATE_MISMATCH";

    const result = await executeFixture({
      preparedSession,
      packet,
      assertCurrent: async (transmission) => {
        assert.deepEqual(transmission, packet.transmission);
        throw drift;
      },
      onLaunch: () => {
        launches += 1;
      },
    });

    assert.equal(result.failureClass, "preflight-rejected");
    assert.equal(launches, 0);
    assert.equal(
      await pathExists(join(preparedSession, "attempt.json")),
      false,
    );
  });
}

test("an exact authorization invokes and consumes one adapter launch", async (t) => {
  const { packet, preparedSession } = await manuallyPrepareSession(t);
  let launches = 0;

  const result = await executeFixture({
    preparedSession,
    packet,
    onLaunch: () => {
      launches += 1;
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.failureClass, null);
  assert.equal(launches, 1);
  const attempt = JSON.parse(
    await readFile(join(preparedSession, "attempt.json"), "utf8"),
  );
  assert.deepEqual(attempt, {
    schemaVersion: 1,
    provider: packet.transmission.provider,
    model: packet.transmission.model,
    effort: packet.transmission.effort,
    transmissionSha256: packet.transmissionSha256,
  });
});

test("prepareEvidenceSession creates canonical packet-bound inputs exclusively", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "evaluation-runtime-prepare-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = join(root, "prepared");
  const packet = createTransmissionPacket(transmissionFixture());
  const input = packet.transmission.harnessControlledInputs[0];

  const prepared = await prepareEvidenceSession({
    destination,
    packet,
    inputs: [
      {
        id: input.id,
        mediaType: input.mediaType,
        bytes: Buffer.from(input.content, "utf8"),
      },
    ],
  });

  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.artifacts), true);
  assert.equal(prepared.schemaVersion, 1);
  assert.equal(prepared.preparedSession, destination);
  assert.equal(prepared.transmissionSha256, packet.transmissionSha256);
  assert.deepEqual(prepared.artifacts, {
    packet: "packet.json",
    inputManifest: "inputs/manifest.json",
    inputs: ["inputs/0001-prompt.txt"],
  });
  assert.deepEqual(
    await readFile(join(destination, "packet.json")),
    canonicalJsonBytes(packet),
  );
  assert.deepEqual(
    await readFile(join(destination, "inputs", "0001-prompt.txt")),
    Buffer.from(input.content, "utf8"),
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(destination, "inputs", "manifest.json"), "utf8"),
    ),
    {
      schemaVersion: 1,
      inputs: [
        {
          id: "prompt",
          relativePath: "inputs/0001-prompt.txt",
          mediaType: "text/plain",
          byteLength: input.byteLength,
          sha256: input.sha256,
        },
      ],
    },
  );

  await assert.rejects(
    prepareEvidenceSession({
      destination,
      packet,
      inputs: [
        {
          id: input.id,
          mediaType: input.mediaType,
          bytes: Buffer.from(input.content, "utf8"),
        },
      ],
    }),
    { code: "EEXIST" },
  );
});

test("prepareEvidenceSession validates all input bytes before creating a destination", async (t) => {
  const root = await mkdtemp(
    join(tmpdir(), "evaluation-runtime-invalid-input-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = join(root, "prepared");
  const packet = createTransmissionPacket(transmissionFixture());
  const input = packet.transmission.harnessControlledInputs[0];

  await assert.rejects(
    prepareEvidenceSession({
      destination,
      packet,
      inputs: [
        {
          id: input.id,
          mediaType: input.mediaType,
          bytes: Buffer.from("different bytes", "utf8"),
        },
      ],
    }),
    /input.*match/u,
  );
  assert.equal(await pathExists(destination), false);
});

test("execution retains ordered evidence and writes a hash-complete terminal record last", async (t) => {
  const transmission = transmissionFixture();
  transmission.session.suiteArtifacts = [
    { relativePath: "suite/decision.json", mediaType: "application/json" },
  ];
  const packet = createTransmissionPacket(transmission);
  const { destination, prepared } = await prepareWithRuntime(t, { packet });
  let sawTerminalDuringAdapter = false;
  const adapter = executingAdapter(async (context) => {
    await consumeLaunch(context);
    await context.evidence.appendTranscript(
      Buffer.from('{"type":"first"}\r\n', "utf8"),
    );
    await context.evidence.appendTranscript(
      Buffer.from('{"type":"second"}\n', "utf8"),
    );
    await context.evidence.appendNormalizedEvent({ z: 2, a: 1 });
    await context.evidence.appendStderr(Buffer.from("diagnostic\n", "utf8"));
    await context.evidence.writeFinal(Buffer.from("final answer\n", "utf8"));
    await context.evidence.writeSuiteArtifact({
      relativePath: "suite/decision.json",
      mediaType: "application/json",
      bytes: Buffer.from('{"decision":"complete"}', "utf8"),
    });
    sawTerminalDuringAdapter = await pathExists(join(destination, "run.json"));
    return adapterResult();
  });

  const result = await executeAuthorizedModelSession({
    preparedSession: prepared,
    allowExternalModelCall: true,
    authorization: authorizationFixture(packet),
    assertCurrent: async () => {},
    adapter,
    request: Object.freeze({}),
  });

  assert.equal(result.status, "completed");
  assert.equal(sawTerminalDuringAdapter, false);
  assert.deepEqual(
    await readFile(join(destination, "outputs", "transcript.jsonl")),
    Buffer.from('{"type":"first"}\r\n{"type":"second"}\n', "utf8"),
  );
  assert.deepEqual(
    await readFile(join(destination, "outputs", "events.jsonl")),
    Buffer.from('{"a":1,"z":2}\n', "utf8"),
  );
  assert.equal(
    await readFile(join(destination, "outputs", "stderr.log"), "utf8"),
    "diagnostic\n",
  );
  assert.equal(
    await readFile(join(destination, "outputs", "final.md"), "utf8"),
    "final answer\n",
  );
  assert.equal(
    await readFile(join(destination, "suite", "decision.json"), "utf8"),
    '{"decision":"complete"}',
  );

  const metrics = JSON.parse(
    await readFile(join(destination, "metrics.json"), "utf8"),
  );
  assert.deepEqual(metrics.nativeUsage, {
    input_tokens: 10,
    output_tokens: 4,
  });
  assert.deepEqual(metrics.normalizedUsage, {
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 4,
    totalTokens: 14,
    costUsd: null,
  });

  const timing = JSON.parse(
    await readFile(join(destination, "timing.json"), "utf8"),
  );
  assert.match(
    timing.startedAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
  );
  assert.match(
    timing.finishedAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
  );
  assert.equal(Number.isFinite(timing.durationMs), true);
  assert.equal(timing.durationMs >= 0, true);

  const run = JSON.parse(await readFile(join(destination, "run.json"), "utf8"));
  assert.equal(run.schemaVersion, 1);
  assert.equal(run.status, "completed");
  assert.equal(run.failureClass, null);
  assert.equal(run.transmissionSha256, packet.transmissionSha256);
  const expectedArtifacts = [
    "attempt.json",
    "authorization.json",
    "inputs/0001-prompt.txt",
    "inputs/manifest.json",
    "metrics.json",
    "outputs/events.jsonl",
    "outputs/final.md",
    "outputs/stderr.log",
    "outputs/transcript.jsonl",
    "packet.json",
    "suite/decision.json",
    "timing.json",
  ];
  assert.deepEqual(Object.keys(run.artifacts).sort(), expectedArtifacts);
  for (const relativePath of expectedArtifacts) {
    const bytes = await readFile(join(destination, ...relativePath.split("/")));
    assert.deepEqual(run.artifacts[relativePath], {
      byteLength: bytes.byteLength,
      sha256: independentSha256(bytes),
    });
  }
});

test("evaluation trial execution durably consumes authorization before launch and writes trial-native evidence", async (t) => {
  const packet = createTransmissionPacket(transmissionFixture());
  const { destination, prepared } = await prepareWithRuntime(t, { packet });
  const rawFinal = "first line  \r\nsecond line \t\r\nthird line\t\r\n";
  let evidenceObservedDuringAdapter = null;
  const adapter = executingAdapter(async (context) => {
    await consumeLaunch(context);
    evidenceObservedDuringAdapter = {
      authorizationConsumption: await pathExists(
        join(destination, "authorization-consumption.json"),
      ),
      providerTranscript: await pathExists(
        join(destination, "outputs", "provider-transcript.jsonl"),
      ),
      terminalResult: await pathExists(join(destination, "result.json")),
    };
    await context.evidence.appendTranscript(
      Buffer.from(`${JSON.stringify({ response: rawFinal })}\n`, "utf8"),
    );
    await context.evidence.appendNormalizedEvent({ type: "normalized-event" });
    await context.evidence.appendStderr(Buffer.from("diagnostic\n", "utf8"));
    await context.evidence.writeFinal(Buffer.from(rawFinal, "utf8"));
    return adapterResult();
  });

  const result = await executeAuthorizedModelSession({
    preparedSession: prepared,
    allowExternalModelCall: true,
    authorization: authorizationFixture(packet),
    assertCurrent: async () => {},
    adapter,
    request: Object.freeze({}),
    evidenceLayout: "evaluation-trial-v1",
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(evidenceObservedDuringAdapter, {
    authorizationConsumption: true,
    providerTranscript: true,
    terminalResult: false,
  });
  assert.equal(
    await readFile(
      join(destination, "outputs", "provider-transcript.jsonl"),
      "utf8",
    ),
    `${JSON.stringify({ response: rawFinal })}\n`,
  );
  assert.equal(
    await readFile(join(destination, "outputs", "events.jsonl"), "utf8"),
    '{"type":"normalized-event"}\n',
  );
  assert.equal(
    await readFile(join(destination, "outputs", "stderr.log"), "utf8"),
    "diagnostic\n",
  );
  assert.equal(
    await readFile(join(destination, "outputs", "response.md"), "utf8"),
    "first line<br>\nsecond line\nthird line\n",
  );

  const consumption = JSON.parse(
    await readFile(join(destination, "authorization-consumption.json"), "utf8"),
  );
  assert.equal(
    consumption.artifactType,
    "evaluation-trial-authorization-consumption",
  );
  assert.equal(consumption.schemaVersion, 1);
  assert.equal(consumption.transmissionSha256, packet.transmissionSha256);

  const terminal = JSON.parse(
    await readFile(join(destination, "result.json"), "utf8"),
  );
  assert.equal(terminal.artifactType, "evaluation-trial-result");
  assert.equal(terminal.schemaVersion, 1);
  assert.equal(terminal.executionStatus, "completed");
  assert.equal(terminal.gradeStatus, "not-graded");
  assert.equal(terminal.providerOutcome, "completed");
  assert.equal(terminal.retryPermitted, false);
  assert.equal(terminal.transmissionSha256, packet.transmissionSha256);
  assert.equal(terminal.failureClass, null);
  assert.deepEqual(Object.keys(terminal.artifacts).sort(), [
    "authorization-consumption.json",
    "authorization.json",
    "inputs/0001-prompt.txt",
    "inputs/manifest.json",
    "metrics.json",
    "outputs/events.jsonl",
    "outputs/provider-transcript.jsonl",
    "outputs/response.md",
    "outputs/stderr.log",
    "packet.json",
    "timing.json",
  ]);

  for (const legacyPath of [
    "attempt.json",
    "run.json",
    "outputs/final.md",
    "outputs/transcript.jsonl",
  ]) {
    assert.equal(
      await pathExists(join(destination, ...legacyPath.split("/"))),
      false,
    );
  }
});

test("a terminal evaluation trial forbids retry when the adapter never consumes launch authorization", async (t) => {
  const packet = createTransmissionPacket(transmissionFixture());
  const { destination, prepared } = await prepareWithRuntime(t, { packet });
  const adapter = executingAdapter(async () => adapterResult());

  const result = await executeAuthorizedModelSession({
    preparedSession: prepared,
    allowExternalModelCall: true,
    authorization: authorizationFixture(packet),
    assertCurrent: async () => {},
    adapter,
    request: Object.freeze({}),
    evidenceLayout: "evaluation-trial-v1",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "provider-failed");
  const terminal = JSON.parse(
    await readFile(join(destination, "result.json"), "utf8"),
  );
  assert.equal(terminal.executionStatus, "failed");
  assert.equal(terminal.providerOutcome, "not-started");
  assert.equal(terminal.retryPermitted, false);
  assert.equal(
    await pathExists(join(destination, "authorization-consumption.json")),
    false,
  );
});

test("exact retained authorization can continue when launch consumption never occurred", async (t) => {
  const { destination, packet, prepared } = await prepareWithRuntime(t);
  const authorization = authorizationFixture(packet);
  const authorizationBytes = canonicalJsonBytes(authorization);
  await mkdir(join(destination, "outputs"), { recursive: true });
  for (const relativePath of [
    "outputs/transcript.jsonl",
    "outputs/events.jsonl",
    "outputs/stderr.log",
    "outputs/final.md",
  ]) {
    await writeFile(join(destination, relativePath), Buffer.alloc(0), {
      flag: "wx",
    });
  }
  await writeFile(join(destination, "authorization.json"), authorizationBytes, {
    flag: "wx",
  });
  let launches = 0;

  const result = await executeAuthorizedModelSession({
    preparedSession: prepared,
    allowExternalModelCall: true,
    authorization,
    assertCurrent: async () => {},
    adapter: completedAdapter(() => {
      launches += 1;
    }),
    request: Object.freeze({}),
  });

  assert.equal(result.status, "completed");
  assert.equal(launches, 1);
  assert.deepEqual(
    await readFile(join(destination, "authorization.json")),
    authorizationBytes,
  );
  assert.equal(await pathExists(join(destination, "attempt.json")), true);
  assert.equal(await pathExists(join(destination, "run.json")), true);
});

test("execution refuses every conflicting pre-existing reserved target before provider launch", async (t) => {
  for (const relativePath of [
    "authorization.json",
    "attempt.json",
    "metrics.json",
    "timing.json",
    "run.json",
  ]) {
    const packet = createTransmissionPacket(
      mutateTransmission((value) => {
        value.session.preparedSessionId = independentSha256(
          Buffer.from(relativePath, "utf8"),
        ).slice(0, 32);
      }),
    );
    const { destination, prepared } = await prepareWithRuntime(t, {
      packet,
      destinationName: `reserved-${relativePath.replace(".", "-")}`,
    });
    await writeFile(join(destination, relativePath), "sentinel", {
      flag: "wx",
    });
    let launches = 0;

    const execution = executeAuthorizedModelSession({
      preparedSession: prepared,
      allowExternalModelCall: true,
      authorization: authorizationFixture(packet),
      assertCurrent: async () => {},
      adapter: completedAdapter(() => {
        launches += 1;
      }),
      request: Object.freeze({}),
    });

    await assert.rejects(execution);
    assert.equal(launches, 0, relativePath);
    assert.equal(
      await readFile(join(destination, relativePath), "utf8"),
      "sentinel",
    );
  }
});

for (const [failureClass, error] of [
  [
    "launch-failed",
    { name: "LaunchError", code: "ENOENT", message: "not found" },
  ],
  [
    "timed-out",
    { name: "TimeoutError", code: "ETIMEDOUT", message: "expired" },
  ],
]) {
  test(`${failureClass} produces a complete spent terminal record`, async (t) => {
    const { destination, packet, prepared } = await prepareWithRuntime(t);
    let adapterCalls = 0;
    const adapter = executingAdapter(async (context) => {
      adapterCalls += 1;
      await consumeLaunch(context);
      return adapterResult({
        status: "failed",
        failureClass,
        error,
        nativeUsage: null,
        normalizedUsage: {
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: null,
          totalTokens: null,
          costUsd: null,
        },
        suiteResult: null,
      });
    });

    const result = await executeAuthorizedModelSession({
      preparedSession: prepared,
      allowExternalModelCall: true,
      authorization: authorizationFixture(packet),
      assertCurrent: async () => {},
      adapter,
      request: Object.freeze({}),
    });

    assert.equal(result.failureClass, failureClass);
    assert.equal(adapterCalls, 1);
    const run = JSON.parse(
      await readFile(join(destination, "run.json"), "utf8"),
    );
    assert.equal(run.status, "failed");
    assert.equal(run.failureClass, failureClass);
    assert.equal(await pathExists(join(destination, "attempt.json")), true);

    await assert.rejects(
      executeAuthorizedModelSession({
        preparedSession: prepared,
        allowExternalModelCall: true,
        authorization: authorizationFixture(packet),
        assertCurrent: async () => {},
        adapter,
        request: Object.freeze({}),
      }),
    );
    assert.equal(adapterCalls, 1);
  });
}

test("structured evidence rejects authentication-bearing values", async (t) => {
  const { destination, packet, prepared } = await prepareWithRuntime(t);
  const secret = "do-not-persist-this-token";
  const adapter = executingAdapter(async (context) => {
    await consumeLaunch(context);
    await context.evidence.appendNormalizedEvent({ accessToken: secret });
    return adapterResult();
  });

  const result = await executeAuthorizedModelSession({
    preparedSession: prepared,
    allowExternalModelCall: true,
    authorization: authorizationFixture(packet),
    assertCurrent: async () => {},
    adapter,
    request: Object.freeze({}),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "provider-failed");
  const retained = await readFile(join(destination, "run.json"), "utf8");
  assert.equal(retained.includes(secret), false);
  assert.equal(
    (await readFile(join(destination, "outputs", "events.jsonl"))).byteLength,
    0,
  );
});

test("undeclared suite artifacts fail closed without creating their path", async (t) => {
  const { destination, packet, prepared } = await prepareWithRuntime(t);
  const adapter = executingAdapter(async (context) => {
    await consumeLaunch(context);
    await context.evidence.writeSuiteArtifact({
      relativePath: "undeclared/output.json",
      mediaType: "application/json",
      bytes: Buffer.from("{}", "utf8"),
    });
    return adapterResult();
  });

  const result = await executeAuthorizedModelSession({
    preparedSession: prepared,
    allowExternalModelCall: true,
    authorization: authorizationFixture(packet),
    assertCurrent: async () => {},
    adapter,
    request: Object.freeze({}),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "provider-failed");
  assert.equal(await pathExists(join(destination, "undeclared")), false);
});

for (const [name, malformedResult] of [
  [
    "unknown failure class",
    adapterResult({
      status: "failed",
      failureClass: "unexpected-failure",
      error: { name: "Error", code: null, message: "failed" },
      nativeUsage: null,
      suiteResult: null,
    }),
  ],
  [
    "negative normalized usage",
    adapterResult({
      normalizedUsage: {
        inputTokens: -1,
        cachedInputTokens: 0,
        outputTokens: 4,
        totalTokens: 3,
        costUsd: null,
      },
    }),
  ],
  [
    "malformed release disposition",
    adapterResult({
      closure: {
        status: "unknown",
      },
    }),
  ],
]) {
  test(`a provider result with ${name} fails closed`, async (t) => {
    const { destination, packet, prepared } = await prepareWithRuntime(t);
    const adapter = executingAdapter(async (context) => {
      await consumeLaunch(context);
      return malformedResult;
    });

    const result = await executeAuthorizedModelSession({
      preparedSession: prepared,
      allowExternalModelCall: true,
      authorization: authorizationFixture(packet),
      assertCurrent: async () => {},
      adapter,
      request: Object.freeze({}),
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, "provider-failed");
    const run = JSON.parse(
      await readFile(join(destination, "run.json"), "utf8"),
    );
    assert.equal(run.failureClass, "provider-failed");
  });
}

test("a held transcript handle cannot be redirected by pathname replacement", async (t) => {
  const { destination, packet, prepared } = await prepareWithRuntime(t);
  const transcript = join(destination, "outputs", "transcript.jsonl");
  const displaced = join(destination, "outputs", "transcript.displaced");
  const adapter = executingAdapter(async (context) => {
    await consumeLaunch(context);
    await context.evidence.appendTranscript(Buffer.from("first\n", "utf8"));
    await rename(transcript, displaced);
    await writeFile(transcript, "replacement\n", { flag: "wx" });
    await context.evidence.appendTranscript(Buffer.from("second\n", "utf8"));
    return adapterResult();
  });

  await assert.rejects(
    executeAuthorizedModelSession({
      preparedSession: prepared,
      allowExternalModelCall: true,
      authorization: authorizationFixture(packet),
      assertCurrent: async () => {},
      adapter,
      request: Object.freeze({}),
    }),
    /evidence|identity|artifact/u,
  );

  assert.equal(await readFile(displaced, "utf8"), "first\nsecond\n");
  assert.equal(await readFile(transcript, "utf8"), "replacement\n");
  assert.equal(await pathExists(join(destination, "run.json")), false);
});

test("noncanonical packet bytes with duplicate object keys are rejected before launch", async (t) => {
  const { destination, packet, prepared } = await prepareWithRuntime(t);
  const canonical = await readFile(join(destination, "packet.json"), "utf8");
  const duplicate = canonical.replace(
    '{"canonicalization":"RFC8785",',
    '{"canonicalization":"RFC8785","canonicalization":"RFC8785",',
  );
  await writeFile(join(destination, "packet.json"), duplicate, "utf8");
  let launches = 0;

  const result = await executeAuthorizedModelSession({
    preparedSession: prepared,
    allowExternalModelCall: true,
    authorization: authorizationFixture(packet),
    assertCurrent: async () => {},
    adapter: completedAdapter(() => {
      launches += 1;
    }),
    request: Object.freeze({}),
  });

  assert.equal(result.failureClass, "authorization-rejected");
  assert.equal(launches, 0);
  assert.equal(await pathExists(join(destination, "attempt.json")), false);
});
