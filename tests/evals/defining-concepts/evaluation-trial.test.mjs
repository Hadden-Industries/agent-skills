import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  preflightEvaluationTrial,
  prepareEvaluationTrial,
  runEvaluationTrial,
  verifyEvaluationTrial,
} from "../../../evals/defining-concepts/evaluation-trial.mjs";
import {
  canonicalJsonBytes,
  consumeExternalModelLaunch,
  createTransmissionPacket,
  executeAuthorizedModelSession,
  EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  prepareEvidenceSession,
  sha256Hex,
} from "../../../scripts/evaluation/runtime.js";

const definitions = JSON.parse(
  await readFile(
    new URL("../../../evals/defining-concepts/evals.json", import.meta.url),
    "utf8",
  ),
);
async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function skillSource(compatibility, heading) {
  return `---\nname: defining-concepts\ndescription: Fixture skill.\ncompatibility: ${compatibility}\n---\n\n# ${heading}\n`;
}

function bundleRecord({ compatibility, kind, marker }) {
  const content = skillSource(compatibility, marker);
  const bytes = Buffer.from(content, "utf8");
  const payload = {
    schemaVersion: 1,
    skillName: "defining-concepts",
    source:
      kind === "git"
        ? {
            kind: "git",
            commitOid: marker.repeat(40).slice(0, 40),
            treeOid: marker.repeat(40).slice(0, 40),
          }
        : {
            kind: "working-tree",
            headCommitOid: marker.repeat(40).slice(0, 40),
            headTreeOid: marker.repeat(40).slice(0, 40),
          },
    files: [
      {
        path: "skills/defining-concepts/SKILL.md",
        content,
        byteLength: bytes.byteLength,
        sha256: sha256Hex(bytes),
      },
    ],
  };
  return {
    ...payload,
    aggregateSha256: sha256Hex(canonicalJsonBytes(payload)),
  };
}

function bundleFixtures() {
  const interpretations = Object.fromEntries(
    definitions.capability_contract.compatibility_interpretations.map(
      (item) => [item.arm, item.exact_text],
    ),
  );
  return {
    currentBundle: bundleRecord({
      compatibility: interpretations["current-skill"],
      kind: "git",
      marker: "a",
    }),
    candidateBundle: bundleRecord({
      compatibility: interpretations["candidate-skill"],
      kind: "working-tree",
      marker: "b",
    }),
  };
}

function providerResolution() {
  return {
    provider: "openai",
    supportedCapabilities: ["bundled-skill-files", "url-fetch", "web-search"],
    enabledCapabilities: ["bundled-skill-files", "url-fetch", "web-search"],
    bindings: [
      {
        capability: "bundled-skill-files",
        mechanism: "harness-controlled-input",
      },
      { capability: "url-fetch", mechanism: "native-web-search" },
      { capability: "web-search", mechanism: "native-web-search" },
    ],
    runtimeCapabilities: {
      network: false,
      webSearch: true,
      tools: [],
      providerFacilities: [],
    },
  };
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

function preparedPacket({
  evaluationCase,
  skillArm,
  bundle,
  capabilityReconciliation,
}) {
  const inputs = [
    inputRecord("prompt", "user", "text/plain", evaluationCase.prompt),
    inputRecord(
      "evaluation-case",
      "configuration",
      "application/json",
      canonicalJsonBytes(evaluationCase).toString("utf8"),
    ),
    ...(bundle === null
      ? []
      : [
          inputRecord(
            "skill-bundle",
            "configuration",
            "application/json",
            canonicalJsonBytes(bundle).toString("utf8"),
          ),
        ]),
  ];
  return createTransmissionPacket({
    suite: "defining-concepts",
    session: {
      preparedSessionId: "0123456789abcdef0123456789abcdef",
      caseId: evaluationCase.id,
      arm: skillArm,
      repetition: 1,
      sequence: 1,
      metadata: {
        capabilityReconciliationSha256: capabilityReconciliation.receiptSha256,
        skillBundleAggregateSha256: bundle?.aggregateSha256 ?? null,
      },
      suiteArtifacts: [],
    },
    provider: "openai",
    model: "gpt-5.3-codex-spark",
    effort: "low",
    transport: "codex-app-server",
    toolchain: {
      node: process.version,
      operatingSystem: process.platform,
      providerCli: "codex fixture",
      protocol: "app-server-v2",
      schemaSha256: "1".repeat(64),
    },
    runtimeFingerprint: {
      gitCommit: "2".repeat(40),
      gitTree: "3".repeat(40),
      modules: [
        {
          path: "evals/defining-concepts/run-evaluation-session.mjs",
          byteLength: 1,
          sha256: "4".repeat(64),
        },
      ],
    },
    capabilityReconciliation,
    capabilities: capabilityReconciliation.receipt.runtimeCapabilities,
    isolation: {
      sandbox: "workspace-write",
      workingDirectory: "C:\\evaluation\\working",
      runtimeWorkspaceRoots: ["C:\\evaluation\\working"],
      instructionSources: [],
      persistence: false,
      environment: { values: { PATH: "fixture" }, secretSources: [] },
    },
    harnessControlledInputs: inputs,
    continuationPolicy: {
      controllerSha256: "5".repeat(64),
      maxTurns: 1,
      allowedTransitions: [],
      templates: [],
    },
  });
}

async function prepareSessionFixture({
  evaluationCase,
  skillArm,
  bundle,
  capabilityReconciliation,
  preparedSession,
}) {
  const packet = preparedPacket({
    evaluationCase,
    skillArm,
    bundle,
    capabilityReconciliation,
  });
  const inputs = packet.transmission.harnessControlledInputs.map(
    ({ id, mediaType, content }) => ({
      id,
      mediaType,
      bytes: Buffer.from(content, "utf8"),
    }),
  );
  await prepareEvidenceSession({
    destination: preparedSession,
    packet,
    inputs,
  });
  return { modelTurns: 0, packet };
}

async function fixture(t, overrides = {}) {
  const temporary = await mkdtemp(path.join(tmpdir(), "evaluation-trial-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const now = new Date("2026-08-29T12:34:56.789Z");
  const destination = path.join(
    temporary,
    "results",
    "trials",
    "2026-08-29T123456.789Z",
  );
  const { currentBundle, candidateBundle } = bundleFixtures();
  const evaluationCase = definitions.evals.find(({ id }) => id === 1);
  const options = {
    destination,
    now,
    evaluationCase,
    skillArm: "candidate-skill",
    trialIndex: 1,
    currentBundle,
    candidateBundle,
    capabilityContract: definitions.capability_contract,
    providerResolution: providerResolution(),
    provider: "openai",
    adapter: "codex-app-server",
    model: "gpt-5.3-codex-spark",
    reasoningEffort: "low",
    baselineRevision: "6".repeat(40),
    prepareSession: prepareSessionFixture,
    ...overrides,
  };
  return { temporary, destination, options, currentBundle, candidateBundle };
}

async function preflightFixture(context) {
  return preflightEvaluationTrial({
    trialDirectory: context.destination,
    preflightSession: async ({ evidenceDirectory, transmissionSha256 }) => {
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(
        path.join(evidenceDirectory, "provider-check.json"),
        canonicalJsonBytes({ schemaVersion: 1, transmissionSha256 }),
        { flag: "wx" },
      );
      return {
        status: "completed",
        modelTurns: 0,
        capabilities: {
          provider: "openai",
          model: "gpt-5.3-codex-spark",
          effort: "low",
          webSearch: true,
        },
      };
    },
  });
}

async function authorizationFixture(context, overrides = {}) {
  const packet = JSON.parse(
    await readFile(path.join(context.destination, "packet.json"), "utf8"),
  );
  const authorization = {
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
  const authorizationFile = path.join(
    context.temporary,
    `authorization-${Math.random().toString(16).slice(2)}.json`,
  );
  await writeFile(authorizationFile, canonicalJsonBytes(authorization), {
    flag: "wx",
  });
  return { authorization, authorizationFile, packet };
}

function completedAdapter(execute) {
  return Object.freeze({
    provider: "openai",
    execute,
  });
}

function completedAdapterResult() {
  return {
    status: "completed",
    failureClass: null,
    error: null,
    nativeUsage: { input_tokens: 12, output_tokens: 6 },
    normalizedUsage: {
      inputTokens: 12,
      cachedInputTokens: 0,
      outputTokens: 6,
      totalTokens: 18,
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
    suiteResult: { finalAnswer: "Retained trial response" },
  };
}

test("prepare creates one immutable diagnostic trial with packet-bound evidence", async (t) => {
  const context = await fixture(t);

  const manifest = await prepareEvaluationTrial(context.options);

  assert.equal(manifest.artifactType, "evaluation-trial-manifest");
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.suite, "defining-concepts");
  assert.equal(manifest.createdAt, "2026-08-29T12:34:56.789Z");
  assert.equal(manifest.directoryName, "2026-08-29T123456.789Z");
  assert.deepEqual(manifest.identity, {
    caseId: 1,
    skillArm: "candidate-skill",
    trialIndex: 1,
  });
  assert.deepEqual(manifest.execution, {
    adapter: "codex-app-server",
    aggregateEligible: false,
    evidenceUse: "diagnostic",
    maximumTurns: 1,
    model: "gpt-5.3-codex-spark",
    provider: "openai",
    reasoningEffort: "low",
    transport: "codex-app-server",
  });
  assert.equal(
    manifest.skillBundleSources.currentSkill.aggregateSha256,
    context.currentBundle.aggregateSha256,
  );
  assert.equal(
    manifest.skillBundleSources.candidateSkill.aggregateSha256,
    context.candidateBundle.aggregateSha256,
  );

  const packet = JSON.parse(
    await readFile(path.join(context.destination, "packet.json"), "utf8"),
  );
  assert.equal(
    manifest.trialId,
    `trial-${packet.transmissionSha256.slice(0, 16)}`,
  );
  assert.equal(
    manifest.artifacts.packet.transmissionSha256,
    packet.transmissionSha256,
  );
  assert.equal(packet.transmission.session.arm, "candidate-skill");
  assert.equal(packet.transmission.session.repetition, 1);
  assert.equal(packet.transmission.capabilities.webSearch, true);
  assert.equal(
    manifest.artifacts.capabilityReconciliation.receiptSha256,
    packet.transmission.capabilityReconciliation.receiptSha256,
  );

  const selectedBundle = JSON.parse(
    await readFile(path.join(context.destination, "skill-bundle.json"), "utf8"),
  );
  assert.equal(
    selectedBundle.aggregateSha256,
    context.candidateBundle.aggregateSha256,
  );
  assert.equal(
    manifest.artifacts.skillBundle.relativePath,
    "skill-bundle.json",
  );
  assert.equal(
    manifest.artifacts.skillBundle.aggregateSha256,
    context.candidateBundle.aggregateSha256,
  );

  for (const artifact of [
    manifest.artifacts.case,
    manifest.artifacts.skillBundle,
    manifest.artifacts.capabilityReconciliation,
    manifest.artifacts.packet,
    manifest.artifacts.inputManifest,
    ...manifest.artifacts.inputs,
  ]) {
    const bytes = await readFile(
      path.join(context.destination, ...artifact.relativePath.split("/")),
    );
    assert.equal(artifact.byteLength, bytes.byteLength);
    assert.equal(artifact.sha256, sha256Hex(bytes));
  }
  assert.equal(
    await pathExists(path.join(context.destination, "prepared")),
    false,
  );
  assert.equal(
    await pathExists(path.join(context.destination, "preparation")),
    false,
  );
  assert.deepEqual(
    await readFile(path.join(context.destination, "manifest.json")),
    canonicalJsonBytes(manifest),
  );
});

test("prepare omits skill-bundle.json for the no-skill arm", async (t) => {
  const context = await fixture(t, { skillArm: "no-skill" });

  const manifest = await prepareEvaluationTrial(context.options);

  assert.equal(manifest.artifacts.skillBundle, null);
  assert.equal(
    await pathExists(path.join(context.destination, "skill-bundle.json")),
    false,
  );
  const packet = JSON.parse(
    await readFile(path.join(context.destination, "packet.json"), "utf8"),
  );
  assert.equal(packet.transmission.session.arm, "no-skill");
  assert.equal(
    packet.transmission.harnessControlledInputs.some(
      ({ id }) => id === "skill-bundle",
    ),
    false,
  );
});

test("prepare refuses a destination collision and an unsafe timestamp name", async (t) => {
  const collision = await fixture(t);
  await prepareEvaluationTrial(collision.options);
  await assert.rejects(
    prepareEvaluationTrial(collision.options),
    /destination.*new|exist/iu,
  );

  const unsafe = await fixture(t);
  unsafe.options.destination = path.join(unsafe.temporary, "2026-08-29");
  await assert.rejects(
    prepareEvaluationTrial(unsafe.options),
    /filesystem-safe ISO UTC timestamp/iu,
  );
});

test("prepare removes staging evidence when session preparation fails", async (t) => {
  const context = await fixture(t, {
    prepareSession: async () => {
      throw new Error("fixture preparation failure");
    },
  });

  await assert.rejects(
    prepareEvaluationTrial(context.options),
    /fixture preparation failure/iu,
  );
  assert.equal(await pathExists(context.destination), false);
  const parent = path.dirname(context.destination);
  const retained = (await pathExists(parent)) ? await readdir(parent) : [];
  assert.deepEqual(retained, []);
});

test("preflight retains one zero-turn capability check and refuses duplication", async (t) => {
  const context = await fixture(t);
  const manifest = await prepareEvaluationTrial(context.options);
  let calls = 0;

  const preflight = await preflightEvaluationTrial({
    trialDirectory: context.destination,
    preflightSession: async ({ evidenceDirectory, transmissionSha256 }) => {
      calls += 1;
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(
        path.join(evidenceDirectory, "provider-check.json"),
        canonicalJsonBytes({
          schemaVersion: 1,
          transmissionSha256,
          webSearch: true,
        }),
        { flag: "wx" },
      );
      return {
        status: "completed",
        modelTurns: 0,
        capabilities: {
          provider: "openai",
          model: "gpt-5.3-codex-spark",
          effort: "low",
          webSearch: true,
        },
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(preflight.artifactType, "evaluation-trial-preflight");
  assert.equal(preflight.schemaVersion, 1);
  assert.equal(preflight.trialId, manifest.trialId);
  assert.equal(
    preflight.transmissionSha256,
    manifest.artifacts.packet.transmissionSha256,
  );
  assert.equal(preflight.status, "completed");
  assert.equal(preflight.modelTurns, 0);
  assert.equal(preflight.authorizationConsumed, false);
  assert.deepEqual(preflight.capabilities, {
    effort: "low",
    model: "gpt-5.3-codex-spark",
    provider: "openai",
    webSearch: true,
  });
  assert.deepEqual(
    preflight.artifacts.map(({ relativePath }) => relativePath),
    ["preflight/provider-check.json"],
  );
  const rawBytes = await readFile(
    path.join(context.destination, "preflight", "provider-check.json"),
  );
  assert.deepEqual(preflight.artifacts[0], {
    relativePath: "preflight/provider-check.json",
    byteLength: rawBytes.byteLength,
    sha256: sha256Hex(rawBytes),
  });
  assert.deepEqual(
    await readFile(path.join(context.destination, "preflight.json")),
    canonicalJsonBytes(preflight),
  );

  await assert.rejects(
    preflightEvaluationTrial({
      trialDirectory: context.destination,
      preflightSession: async () => {
        calls += 1;
        return { status: "completed", modelTurns: 0, capabilities: {} };
      },
    }),
    /preflight.*already exists/iu,
  );
  assert.equal(calls, 1);
});

test("preflight rejects immutable artifact tampering before the capability check", async (t) => {
  const context = await fixture(t);
  await prepareEvaluationTrial(context.options);
  await writeFile(
    path.join(context.destination, "case.json"),
    '{"tampered":true}',
    "utf8",
  );
  let calls = 0;

  await assert.rejects(
    preflightEvaluationTrial({
      trialDirectory: context.destination,
      preflightSession: async () => {
        calls += 1;
        return { status: "completed", modelTurns: 0, capabilities: {} };
      },
    }),
    /artifact integrity|digest/iu,
  );
  assert.equal(calls, 0);
  assert.equal(
    await pathExists(path.join(context.destination, "preflight.json")),
    false,
  );
});

test("preflight refuses to run after authorization consumption or a terminal result", async (t) => {
  for (const occupied of ["authorization-consumption.json", "result.json"]) {
    const context = await fixture(t);
    await prepareEvaluationTrial(context.options);
    await writeFile(path.join(context.destination, occupied), "{}", "utf8");
    let calls = 0;

    await assert.rejects(
      preflightEvaluationTrial({
        trialDirectory: context.destination,
        preflightSession: async () => {
          calls += 1;
          return { status: "completed", modelTurns: 0, capabilities: {} };
        },
      }),
      /authorization consumption|terminal result/iu,
    );
    assert.equal(calls, 0, occupied);
  }
});

test("run retains authorization consumption and streams before writing the terminal result", async (t) => {
  const context = await fixture(t);
  await prepareEvaluationTrial(context.options);
  await preflightFixture(context);
  const { authorization, authorizationFile } =
    await authorizationFixture(context);
  await writeFile(
    authorizationFile,
    Buffer.concat([canonicalJsonBytes(authorization), Buffer.from("\n")]),
  );
  let evidenceDuringAdapter = null;
  let executions = 0;

  const result = await runEvaluationTrial({
    trialDirectory: context.destination,
    authorizationFile,
    allowExternalModelCall: true,
    executeSession: async ({ preparedSession, evidenceLayout }) => {
      executions += 1;
      return executeAuthorizedModelSession({
        preparedSession,
        allowExternalModelCall: true,
        authorization,
        assertCurrent: async () => {},
        adapter: completedAdapter(async (adapterContext) => {
          await consumeExternalModelLaunch(adapterContext.launchCapability, {
            provider: adapterContext.transmission.provider,
            model: adapterContext.transmission.model,
            effort: adapterContext.transmission.effort,
            transmissionSha256: sha256Hex(
              canonicalJsonBytes(adapterContext.transmission),
            ),
          });
          evidenceDuringAdapter = {
            authorizationConsumption: await pathExists(
              path.join(context.destination, "authorization-consumption.json"),
            ),
            providerTranscript: await pathExists(
              path.join(
                context.destination,
                "outputs",
                "provider-transcript.jsonl",
              ),
            ),
            events: await pathExists(
              path.join(context.destination, "outputs", "events.jsonl"),
            ),
            stderr: await pathExists(
              path.join(context.destination, "outputs", "stderr.log"),
            ),
            terminalResult: await pathExists(
              path.join(context.destination, "result.json"),
            ),
          };
          await adapterContext.evidence.appendTranscript(
            Buffer.from('{"type":"provider-event"}\n', "utf8"),
          );
          await adapterContext.evidence.appendNormalizedEvent({
            type: "normalized-event",
          });
          await adapterContext.evidence.appendStderr(
            Buffer.from("diagnostic\n", "utf8"),
          );
          await adapterContext.evidence.writeFinal(
            Buffer.from("Retained trial response", "utf8"),
          );
          return completedAdapterResult();
        }),
        request: Object.freeze({}),
        evidenceLayout,
      });
    },
  });

  assert.equal(executions, 1);
  assert.deepEqual(evidenceDuringAdapter, {
    authorizationConsumption: true,
    providerTranscript: true,
    events: true,
    stderr: true,
    terminalResult: false,
  });
  assert.equal(result.artifactType, "evaluation-trial-result");
  assert.equal(result.executionStatus, "completed");
  assert.equal(result.gradeStatus, "not-graded");
  assert.equal(result.providerOutcome, "completed");
  assert.equal(result.retryPermitted, false);
  assert.deepEqual(
    await readFile(path.join(context.destination, "authorization.json")),
    canonicalJsonBytes(authorization),
  );
  assert.equal(
    await readFile(
      path.join(context.destination, "outputs", "response.md"),
      "utf8",
    ),
    "Retained trial response",
  );
  assert.equal(
    await pathExists(path.join(context.destination, "executed.json")),
    false,
  );

  await assert.rejects(
    runEvaluationTrial({
      trialDirectory: context.destination,
      authorizationFile,
      allowExternalModelCall: true,
      executeSession: async () => {
        executions += 1;
      },
    }),
    /already consumed|terminal result|execution evidence/iu,
  );
  assert.equal(executions, 1);
});

test("run requires successful preflight, an exact authorization, and the literal call gate", async (t) => {
  const withoutPreflight = await fixture(t);
  await prepareEvaluationTrial(withoutPreflight.options);
  const missingPreflightAuthorization =
    await authorizationFixture(withoutPreflight);
  let executions = 0;
  await assert.rejects(
    runEvaluationTrial({
      trialDirectory: withoutPreflight.destination,
      authorizationFile: missingPreflightAuthorization.authorizationFile,
      allowExternalModelCall: true,
      executeSession: async () => {
        executions += 1;
      },
    }),
    /successful preflight|preflight/iu,
  );

  const gated = await fixture(t);
  await prepareEvaluationTrial(gated.options);
  await preflightFixture(gated);
  const gatedAuthorization = await authorizationFixture(gated);
  await assert.rejects(
    runEvaluationTrial({
      trialDirectory: gated.destination,
      authorizationFile: gatedAuthorization.authorizationFile,
      allowExternalModelCall: false,
      executeSession: async () => {
        executions += 1;
      },
    }),
    /allowExternalModelCall.*literally true/iu,
  );

  const mismatched = await fixture(t);
  await prepareEvaluationTrial(mismatched.options);
  await preflightFixture(mismatched);
  const mismatchedAuthorization = await authorizationFixture(mismatched, {
    transmissionSha256: "0".repeat(64),
  });
  await assert.rejects(
    runEvaluationTrial({
      trialDirectory: mismatched.destination,
      authorizationFile: mismatchedAuthorization.authorizationFile,
      allowExternalModelCall: true,
      executeSession: async () => {
        executions += 1;
      },
    }),
    /authorization.*exact transmission/iu,
  );
  assert.equal(executions, 0);
  assert.equal(
    await pathExists(path.join(mismatched.destination, "authorization.json")),
    false,
  );
});

test("run refuses an authorization-consumed trial even when no terminal result exists", async (t) => {
  const context = await fixture(t);
  await prepareEvaluationTrial(context.options);
  await preflightFixture(context);
  const { authorizationFile, packet } = await authorizationFixture(context);
  await writeFile(
    path.join(context.destination, "authorization-consumption.json"),
    canonicalJsonBytes({
      artifactType: "evaluation-trial-authorization-consumption",
      schemaVersion: 1,
      provider: packet.transmission.provider,
      model: packet.transmission.model,
      effort: packet.transmission.effort,
      transmissionSha256: packet.transmissionSha256,
    }),
    { flag: "wx" },
  );
  let executions = 0;

  await assert.rejects(
    runEvaluationTrial({
      trialDirectory: context.destination,
      authorizationFile,
      allowExternalModelCall: true,
      executeSession: async () => {
        executions += 1;
      },
    }),
    /already consumed/iu,
  );
  assert.equal(executions, 0);
});

test("verify reports prepared and preflighted lifecycle states without changing evidence", async (t) => {
  const context = await fixture(t);
  const manifest = await prepareEvaluationTrial(context.options);
  const manifestBefore = await readFile(
    path.join(context.destination, "manifest.json"),
  );

  const prepared = await verifyEvaluationTrial({
    trialDirectory: context.destination,
  });
  assert.deepEqual(prepared, {
    artifactIntegrity: "verified",
    artifactType: "evaluation-trial-verification",
    authorizationStatus: "not-provided",
    executionStatus: "not-started",
    gradeStatus: "not-graded",
    issues: [],
    preflightStatus: "not-run",
    providerOutcome: "not-started",
    retryPermitted: true,
    schemaVersion: 1,
    transmissionSha256: manifest.artifacts.packet.transmissionSha256,
    trialId: manifest.trialId,
  });

  await preflightFixture(context);
  const preflighted = await verifyEvaluationTrial({
    trialDirectory: context.destination,
  });
  assert.equal(preflighted.artifactIntegrity, "verified");
  assert.equal(preflighted.preflightStatus, "completed");
  assert.equal(preflighted.executionStatus, "not-started");
  assert.equal(preflighted.gradeStatus, "not-graded");
  assert.equal(preflighted.retryPermitted, true);
  assert.deepEqual(
    await readFile(path.join(context.destination, "manifest.json")),
    manifestBefore,
  );
});

test("verify distinguishes a valid failed preflight from artifact corruption", async (t) => {
  const context = await fixture(t);
  await prepareEvaluationTrial(context.options);
  await preflightEvaluationTrial({
    trialDirectory: context.destination,
    preflightSession: async ({ evidenceDirectory, transmissionSha256 }) => {
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(
        path.join(evidenceDirectory, "provider-check.json"),
        canonicalJsonBytes({ schemaVersion: 1, transmissionSha256 }),
        { flag: "wx" },
      );
      return {
        status: "failed",
        modelTurns: 0,
        capabilities: null,
        error: {
          name: "CapabilityError",
          code: "WEB_SEARCH_UNAVAILABLE",
          message: "live web search is unavailable",
        },
      };
    },
  });

  const verification = await verifyEvaluationTrial({
    trialDirectory: context.destination,
  });
  assert.equal(verification.artifactIntegrity, "verified");
  assert.equal(verification.preflightStatus, "failed");
  assert.equal(verification.executionStatus, "not-started");
  assert.equal(verification.providerOutcome, "not-started");
  assert.equal(verification.gradeStatus, "not-graded");
  assert.equal(verification.retryPermitted, false);
  assert.deepEqual(verification.issues, [
    "The zero-turn preflight failed; this trial cannot execute.",
  ]);

  const { authorizationFile } = await authorizationFixture(context);
  let executions = 0;
  await assert.rejects(
    runEvaluationTrial({
      trialDirectory: context.destination,
      authorizationFile,
      allowExternalModelCall: true,
      executeSession: async () => {
        executions += 1;
      },
    }),
    /successful.*preflight/iu,
  );
  assert.equal(executions, 0);
});

test("verify reports completed and failed execution separately from grading", async (t) => {
  for (const expectedExecutionStatus of ["completed", "failed"]) {
    const context = await fixture(t);
    await prepareEvaluationTrial(context.options);
    await preflightFixture(context);
    const { authorization, authorizationFile } =
      await authorizationFixture(context);
    await runEvaluationTrial({
      trialDirectory: context.destination,
      authorizationFile,
      allowExternalModelCall: true,
      executeSession: ({ preparedSession, evidenceLayout }) =>
        executeAuthorizedModelSession({
          preparedSession,
          allowExternalModelCall: true,
          authorization,
          assertCurrent: async () => {},
          adapter: completedAdapter(async (adapterContext) => {
            await consumeExternalModelLaunch(adapterContext.launchCapability, {
              provider: adapterContext.transmission.provider,
              model: adapterContext.transmission.model,
              effort: adapterContext.transmission.effort,
              transmissionSha256: sha256Hex(
                canonicalJsonBytes(adapterContext.transmission),
              ),
            });
            if (expectedExecutionStatus === "completed") {
              await adapterContext.evidence.writeFinal(
                Buffer.from("Retained trial response", "utf8"),
              );
              return completedAdapterResult();
            }
            return {
              ...completedAdapterResult(),
              status: "failed",
              failureClass: "timed-out",
              error: {
                name: "TimeoutError",
                code: "ETIMEDOUT",
                message: "fixture timeout",
              },
              nativeUsage: null,
              normalizedUsage: {
                inputTokens: null,
                cachedInputTokens: null,
                outputTokens: null,
                totalTokens: null,
                costUsd: null,
              },
              suiteResult: null,
            };
          }),
          request: Object.freeze({}),
          evidenceLayout,
        }),
    });

    const verification = await verifyEvaluationTrial({
      trialDirectory: context.destination,
    });
    assert.equal(verification.artifactIntegrity, "verified");
    assert.equal(verification.executionStatus, expectedExecutionStatus);
    assert.equal(
      verification.providerOutcome,
      expectedExecutionStatus === "completed" ? "completed" : "failed",
    );
    assert.equal(verification.gradeStatus, "not-graded");
    assert.equal(verification.authorizationStatus, "consumed");
    assert.equal(verification.retryPermitted, false);
    assert.deepEqual(verification.issues, []);
  }
});

test("verify reports consumed authorization without a terminal result as indeterminate and non-retryable", async (t) => {
  const context = await fixture(t);
  const manifest = await prepareEvaluationTrial(context.options);
  await preflightFixture(context);
  const { authorization, packet } = await authorizationFixture(context);
  await writeFile(
    path.join(context.destination, "authorization.json"),
    canonicalJsonBytes(authorization),
    { flag: "wx" },
  );
  await writeFile(
    path.join(context.destination, "authorization-consumption.json"),
    canonicalJsonBytes({
      artifactType: "evaluation-trial-authorization-consumption",
      schemaVersion: 1,
      provider: packet.transmission.provider,
      model: packet.transmission.model,
      effort: packet.transmission.effort,
      transmissionSha256: packet.transmissionSha256,
    }),
    { flag: "wx" },
  );
  await mkdir(path.join(context.destination, "outputs"), { recursive: false });
  for (const name of [
    "provider-transcript.jsonl",
    "events.jsonl",
    "stderr.log",
    "response.md",
  ]) {
    await writeFile(
      path.join(context.destination, "outputs", name),
      name === "provider-transcript.jsonl" ? "partial\n" : "",
      { flag: "wx" },
    );
  }

  const verification = await verifyEvaluationTrial({
    trialDirectory: context.destination,
  });

  assert.deepEqual(verification, {
    artifactIntegrity: "incomplete",
    artifactType: "evaluation-trial-verification",
    authorizationStatus: "consumed",
    executionStatus: "indeterminate",
    gradeStatus: "not-graded",
    issues: [
      "Authorization was consumed, but no terminal result sealed the execution evidence.",
    ],
    preflightStatus: "completed",
    providerOutcome: "undetermined",
    retryPermitted: false,
    schemaVersion: 1,
    transmissionSha256: manifest.artifacts.packet.transmissionSha256,
    trialId: manifest.trialId,
  });
});

test("verify reports digest tampering, missing evidence, and unknown result statuses", async (t) => {
  const tampered = await fixture(t);
  await prepareEvaluationTrial(tampered.options);
  await writeFile(
    path.join(tampered.destination, "case.json"),
    '{"tampered":true}',
    "utf8",
  );
  const tamperedVerification = await verifyEvaluationTrial({
    trialDirectory: tampered.destination,
  });
  assert.equal(tamperedVerification.artifactIntegrity, "failed");
  assert.equal(tamperedVerification.executionStatus, "indeterminate");
  assert.equal(tamperedVerification.retryPermitted, false);
  assert.match(tamperedVerification.issues[0], /artifact integrity|digest/iu);

  for (const defect of ["missing-evidence", "unknown-status"]) {
    const context = await fixture(t);
    await prepareEvaluationTrial(context.options);
    await preflightFixture(context);
    const { authorization, authorizationFile } =
      await authorizationFixture(context);
    await runEvaluationTrial({
      trialDirectory: context.destination,
      authorizationFile,
      allowExternalModelCall: true,
      executeSession: ({ preparedSession, evidenceLayout }) =>
        executeAuthorizedModelSession({
          preparedSession,
          allowExternalModelCall: true,
          authorization,
          assertCurrent: async () => {},
          adapter: completedAdapter(async (adapterContext) => {
            await consumeExternalModelLaunch(adapterContext.launchCapability, {
              provider: adapterContext.transmission.provider,
              model: adapterContext.transmission.model,
              effort: adapterContext.transmission.effort,
              transmissionSha256: sha256Hex(
                canonicalJsonBytes(adapterContext.transmission),
              ),
            });
            await adapterContext.evidence.writeFinal(
              Buffer.from("Retained trial response", "utf8"),
            );
            return completedAdapterResult();
          }),
          request: Object.freeze({}),
          evidenceLayout,
        }),
    });
    if (defect === "missing-evidence") {
      await rm(
        path.join(context.destination, "outputs", "provider-transcript.jsonl"),
      );
    } else {
      const resultPath = path.join(context.destination, "result.json");
      const result = JSON.parse(await readFile(resultPath, "utf8"));
      result.executionStatus = "unknown";
      await writeFile(resultPath, canonicalJsonBytes(result));
    }

    const verification = await verifyEvaluationTrial({
      trialDirectory: context.destination,
    });
    assert.equal(verification.artifactIntegrity, "failed", defect);
    assert.equal(verification.executionStatus, "indeterminate", defect);
    assert.equal(verification.gradeStatus, "not-graded", defect);
    assert.equal(verification.retryPermitted, false, defect);
    assert.equal(verification.issues.length > 0, true, defect);
  }
});
