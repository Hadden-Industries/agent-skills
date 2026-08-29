import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aggregateCampaignGrades,
  buildCampaignMatrix,
  preflightPreparedCampaign,
  prepareCampaign,
  prepareCampaignGrading,
  readPreparedSessionResult,
  runPreparedCampaign,
  withNewCampaignWorkingRoot,
} from "../../../evals/defining-concepts/evaluation-runner.mjs";
import {
  canonicalJsonBytes,
  EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  sha256Hex,
} from "../../../scripts/evaluation/runtime.js";

const arms = Object.freeze(["no-skill", "current-skill", "candidate-skill"]);
const currentCompatibility =
  "Requires an agent with web search and URL-fetching tools for vocabulary research and source verification; no bundled scripts or additional runtimes.";
const candidateCompatibility =
  "Requires access to bundled skill files. Tasks that require current external evidence also require web search and URL fetching.";
const cases = Object.freeze(
  Array.from({ length: 10 }, (_, index) =>
    Object.freeze({
      id: index + 1,
      name: `case-${String(index + 1).padStart(2, "0")}`,
      prompt: `Define concept ${index + 1}.`,
      expectations: [
        Object.freeze({
          id: `critical-${index + 1}`,
          text: `Preserves boundary ${index + 1}`,
          critical: true,
        }),
      ],
      profiles: Object.freeze(["terminology-core"]),
      qualitative_dimensions: Object.freeze(["semantic-accuracy"]),
      research_strata: Object.freeze(["category-boundary"]),
      renderer: "definition-answer",
      required_capabilities: Object.freeze(
        [1, 3, 8].includes(index + 1) ? ["url-fetch", "web-search"] : [],
      ),
    }),
  ),
);

function bundle(kind, marker) {
  const compatibility =
    kind === "git" ? currentCompatibility : candidateCompatibility;
  const content = `---\nname: defining-concepts\ndescription: Fixture.\ncompatibility: ${compatibility}\n---\n\n# ${marker}\n`;
  const bytes = Buffer.from(content);
  const payload = {
    schemaVersion: 1,
    skillName: "defining-concepts",
    source:
      kind === "git"
        ? {
            kind,
            commitOid: marker.repeat(40).slice(0, 40),
            treeOid: marker.repeat(40).slice(0, 40),
          }
        : {
            kind,
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
  return Object.freeze({
    ...payload,
    aggregateSha256: sha256Hex(canonicalJsonBytes(payload)),
  });
}

function capabilityContract() {
  return {
    schema_version: 1,
    capability_ids: ["bundled-skill-files", "url-fetch", "web-search"],
    arm_requirements: {
      "no-skill": [],
      "current-skill": ["bundled-skill-files"],
      "candidate-skill": ["bundled-skill-files"],
    },
    compatibility_interpretations: [
      {
        arm: "current-skill",
        exact_text: currentCompatibility,
        always_required_capabilities: [],
        conditional_case_capabilities: ["url-fetch", "web-search"],
      },
      {
        arm: "candidate-skill",
        exact_text: candidateCompatibility,
        always_required_capabilities: ["bundled-skill-files"],
        conditional_case_capabilities: ["url-fetch", "web-search"],
      },
    ],
    campaign_policy: {
      default: "deny",
      allowed_capabilities: ["bundled-skill-files", "url-fetch", "web-search"],
      uniform_across_arms: true,
    },
  };
}

function providerResolution(provider = "openai") {
  return {
    provider,
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

function packetFor(cell, provider = "openai") {
  const reconciliation = cell.capabilityReconciliation;
  const capabilities = reconciliation?.receipt.runtimeCapabilities ?? {
    network: false,
    webSearch: false,
    tools: [],
    providerFacilities: [],
  };
  const transmission = {
    suite: "defining-concepts",
    session: {
      preparedSessionId: sha256Hex(Buffer.from(cell.internalId)).slice(0, 32),
      caseId: cell.caseId,
      arm: cell.arm,
      repetition: 1,
      sequence: cell.sequence,
      suiteArtifacts: [],
    },
    provider,
    model: "gpt-test",
    effort: "low",
    transport: provider === "openai" ? "codex-app-server" : "fixture-cli",
    toolchain: { fixture: true },
    runtimeFingerprint: { fixture: true },
    capabilities,
    isolation: { fixture: true },
    harnessControlledInputs: [],
    continuationPolicy: {
      controllerSha256: "a".repeat(64),
      maxTurns: 1,
      allowedTransitions: [],
      templates: [],
    },
    ...(reconciliation === undefined
      ? {}
      : { capabilityReconciliation: reconciliation }),
  };
  return Object.freeze({
    schemaVersion: 1,
    canonicalization: "RFC8785-JCS",
    digestAlgorithm: "sha256",
    transmission,
    transmissionSha256: sha256Hex(canonicalJsonBytes(transmission)),
  });
}

function preparedFixture(provider = "openai") {
  const temporary = mkdtempSync(path.join(tmpdir(), "defining-campaign-"));
  const destination = path.join(temporary, "2026-08-29T024500.123Z");
  const providerCalls = [];
  const manifest = prepareCampaign({
    campaign: "calibration",
    destination,
    cases,
    arms,
    repetitionCount: 1,
    currentBundle: bundle("git", "a"),
    candidateBundle: bundle("working-tree", "b"),
    capabilityContract: capabilityContract(),
    providerResolution: providerResolution(provider),
    provider,
    model: "gpt-test",
    effort: "low",
    seed: "frozen-seed",
    now: new Date("2026-08-29T02:45:00.123Z"),
    prepareSession(cell) {
      providerCalls.push({ kind: "prepare", cell });
      return { modelTurns: 0, packet: packetFor(cell, provider) };
    },
  });
  return { destination, manifest, providerCalls, temporary };
}

function writeAuthorizations(context) {
  const authorizationDirectory = path.join(context.temporary, "authorizations");
  mkdirSync(authorizationDirectory);
  for (const session of context.manifest.sessions) {
    writeFileSync(
      path.join(authorizationDirectory, `${session.blindAlias}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        decision: "authorized",
        statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
        allowExternalModel: true,
        provider: context.manifest.protocol.provider,
        model: context.manifest.protocol.model,
        effort: context.manifest.protocol.effort,
        transmissionSha256: session.transmissionSha256,
      })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  }
  return authorizationDirectory;
}

function writeSuccessfulPreflight(context, calls = []) {
  return preflightPreparedCampaign({
    campaignDirectory: context.destination,
    preflightSession(session) {
      calls.push(session);
      return {
        schemaVersion: 1,
        status: "completed",
        failureClass: null,
        error: null,
        modelTurns: 0,
        authentication: { status: "authenticated" },
        capabilities: {
          namespaceTools: true,
          imageGeneration: true,
          webSearch: true,
        },
        isolation: {
          tools: [],
          webSearch: false,
          network: false,
          multiAgentMode: false,
        },
        cleanup: { status: "clean" },
        closure: { status: "closed" },
      };
    },
  });
}

function completeGradeRecords(manifest) {
  return manifest.sessions.map((session) => ({
    blindAlias: session.blindAlias,
    critical: [
      {
        expectationId: `critical-${session.caseId}`,
        passed: true,
        excerpt: "boundary",
        reason: "supported",
      },
    ],
    dimensions: [
      {
        id: "semantic-accuracy",
        rating: "meets",
        excerpt: "accurate definition",
        reason: "the concept boundary is preserved",
      },
    ],
    tokens: 10,
    durationMs: 20,
  }));
}

function completePairwiseGrades() {
  return cases.map(({ id }) => ({
    caseId: id,
    outcome: "candidate",
    excerpt: "candidate distinguishes the boundary",
    reason: "candidate is semantically more precise",
  }));
}

test("calibration matrix contains exactly one run for every case and arm", () => {
  const matrix = buildCampaignMatrix({
    caseIds: cases.map(({ id }) => id),
    arms,
    repetitionCount: 1,
    seed: "frozen-seed",
  });
  assert.equal(matrix.length, 30);
  assert.equal(new Set(matrix.map(({ internalId }) => internalId)).size, 30);
  assert.equal(new Set(matrix.map(({ blindAlias }) => blindAlias)).size, 30);
  assert.ok(matrix.every(({ repetition }) => repetition === 1));
  assert.ok(
    matrix.every(
      ({ blindAlias }) => !/current|candidate|skill/iu.test(blindAlias),
    ),
  );
  assert.deepEqual(
    buildCampaignMatrix({
      caseIds: cases.map(({ id }) => id),
      arms,
      repetitionCount: 1,
      seed: "frozen-seed",
    }),
    matrix,
  );
  assert.throws(
    () =>
      buildCampaignMatrix({
        caseIds: [1],
        arms,
        repetitionCount: 2,
        seed: "frozen-seed",
      }),
    /one repetition/iu,
  );
});

test("prepare freezes a new timestamped campaign without model turns", () => {
  const context = preparedFixture();
  assert.equal(context.providerCalls.length, 30);
  assert.ok(context.providerCalls.every(({ kind }) => kind === "prepare"));
  assert.equal(context.manifest.schemaVersion, 3);
  assert.equal(context.manifest.state, "prepared");
  assert.equal(context.manifest.runIdentity, "2026-08-29T02:45:00.123Z");
  assert.deepEqual(context.manifest.protocol.arms, arms);
  assert.equal(context.manifest.protocol.repetitionCount, 1);
  assert.equal(context.manifest.sessions.length, 30);
  assert.match(
    context.manifest.capabilityReconciliation.receiptSha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.equal(
    context.manifest.capabilityReconciliation.relativePath,
    "capability-reconciliation.json",
  );
  const reconciliation = JSON.parse(
    readFileSync(
      path.join(context.destination, "capability-reconciliation.json"),
      "utf8",
    ),
  );
  assert.equal(
    reconciliation.receiptSha256,
    context.manifest.capabilityReconciliation.receiptSha256,
  );
  assert.deepEqual(reconciliation.receipt.requiredCapabilities, [
    "bundled-skill-files",
    "url-fetch",
    "web-search",
  ]);
  assert.deepEqual(
    new Set(
      context.manifest.sessions.map(
        ({ capabilityReconciliationSha256 }) => capabilityReconciliationSha256,
      ),
    ),
    new Set([reconciliation.receiptSha256]),
  );
  for (const { cell } of context.providerCalls) {
    assert.equal(
      cell.capabilityReconciliation.receiptSha256,
      reconciliation.receiptSha256,
    );
  }
  assert.equal(context.manifest.limitations.repeatedSampling, false);
  assert.equal(context.manifest.limitations.humanUsabilityEvaluated, false);
  assert.equal(
    JSON.parse(
      readFileSync(path.join(context.destination, "manifest.json"), "utf8"),
    ).blindMappingSealSha256,
    context.manifest.blindMappingSealSha256,
  );
  assert.throws(
    () =>
      preparedFixture().manifest &&
      prepareCampaign({ destination: context.destination }),
    /new directory/iu,
  );
});

test("campaign preparation owns one new working root and cleans failed preparation", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "defining-working-root-"));
  const successfulRoot = path.join(parent, "successful");
  const result = withNewCampaignWorkingRoot(successfulRoot, () => {
    assert.equal(existsSync(successfulRoot), true);
    return "prepared";
  });
  assert.equal(result, "prepared");
  assert.equal(existsSync(successfulRoot), true);
  assert.throws(
    () => withNewCampaignWorkingRoot(successfulRoot, () => undefined),
    /new directory/iu,
  );

  const failedRoot = path.join(parent, "failed");
  assert.throws(
    () =>
      withNewCampaignWorkingRoot(failedRoot, () => {
        throw new Error("fixture preparation failure");
      }),
    /fixture preparation failure/iu,
  );
  assert.equal(existsSync(failedRoot), false);
});

test("campaign preflight selects one deterministic session and records zero model turns", () => {
  const context = preparedFixture();
  const calls = [];
  const record = writeSuccessfulPreflight(context, calls);
  const selected = context.manifest.sessions.find(
    ({ sequence }) => sequence === 1,
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], selected);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.state, "preflighted");
  assert.equal(record.status, "completed");
  assert.equal(record.modelTurns, 0);
  assert.equal(
    record.campaignManifestSha256,
    sha256Hex(canonicalJsonBytes(context.manifest)),
  );
  assert.deepEqual(record.session, {
    blindAlias: selected.blindAlias,
    sequence: 1,
    transmissionSha256: selected.transmissionSha256,
    provider: selected.provider,
    model: selected.model,
    effort: selected.effort,
    capabilityReconciliationSha256:
      context.manifest.capabilityReconciliation.receiptSha256,
  });
  assert.equal(
    record.capabilityReconciliationSha256,
    context.manifest.capabilityReconciliation.receiptSha256,
  );
  assert.deepEqual(
    JSON.parse(
      readFileSync(path.join(context.destination, "preflight.json"), "utf8"),
    ),
    record,
  );
  assert.throws(
    () => writeSuccessfulPreflight(context),
    /already exists|cannot be overwritten/iu,
  );
});

test("campaign preflight rejects a changed capability receipt before its callback", () => {
  const context = preparedFixture();
  const reconciliationPath = path.join(
    context.destination,
    "capability-reconciliation.json",
  );
  const reconciliation = JSON.parse(readFileSync(reconciliationPath, "utf8"));
  writeFileSync(
    reconciliationPath,
    canonicalJsonBytes({
      ...reconciliation,
      receipt: {
        ...reconciliation.receipt,
        requiredCapabilities: ["bundled-skill-files"],
      },
    }),
  );
  let callbacks = 0;

  assert.throws(
    () =>
      preflightPreparedCampaign({
        campaignDirectory: context.destination,
        preflightSession() {
          callbacks += 1;
        },
      }),
    /capability reconciliation|receipt digest|does not match/iu,
  );
  assert.equal(callbacks, 0);
  assert.equal(
    existsSync(path.join(context.destination, "preflight.json")),
    false,
  );
});

test("run refuses absent, failed, and stale campaign preflight records", () => {
  const absent = preparedFixture();
  const absentAuthorizations = writeAuthorizations(absent);
  let executions = 0;
  assert.throws(
    () =>
      runPreparedCampaign({
        campaignDirectory: absent.destination,
        authorizationDirectory: absentAuthorizations,
        executeSession() {
          executions += 1;
        },
      }),
    /preflight/iu,
  );

  const failed = preparedFixture();
  const failedAuthorizations = writeAuthorizations(failed);
  const failedRecord = preflightPreparedCampaign({
    campaignDirectory: failed.destination,
    preflightSession() {
      return {
        schemaVersion: 1,
        status: "failed",
        failureClass: "capability-rejected",
        error: {
          code: "PROVIDER_CAPABILITY_UNAVAILABLE",
          message: "required capability is unavailable",
        },
        modelTurns: 0,
      };
    },
  });
  assert.equal(failedRecord.status, "failed");
  assert.throws(
    () =>
      runPreparedCampaign({
        campaignDirectory: failed.destination,
        authorizationDirectory: failedAuthorizations,
        executeSession() {
          executions += 1;
        },
      }),
    /successful.*preflight/iu,
  );

  const nonzero = preparedFixture();
  const nonzeroAuthorizations = writeAuthorizations(nonzero);
  const nonzeroRecord = preflightPreparedCampaign({
    campaignDirectory: nonzero.destination,
    preflightSession() {
      return {
        schemaVersion: 1,
        status: "completed",
        failureClass: null,
        error: null,
        modelTurns: 1,
      };
    },
  });
  assert.equal(nonzeroRecord.status, "failed");
  assert.equal(nonzeroRecord.modelTurns, 1);
  assert.equal(nonzeroRecord.error.code, "CAMPAIGN_PREFLIGHT_PROTOCOL_ERROR");
  assert.throws(
    () =>
      runPreparedCampaign({
        campaignDirectory: nonzero.destination,
        authorizationDirectory: nonzeroAuthorizations,
        executeSession() {
          executions += 1;
        },
      }),
    /successful.*preflight/iu,
  );

  const stale = preparedFixture();
  const staleAuthorizations = writeAuthorizations(stale);
  const preflightPath = path.join(stale.destination, "preflight.json");
  const staleRecord = writeSuccessfulPreflight(stale);
  writeFileSync(
    preflightPath,
    canonicalJsonBytes({
      ...staleRecord,
      campaignManifestSha256: "f".repeat(64),
    }),
  );
  assert.throws(
    () =>
      runPreparedCampaign({
        campaignDirectory: stale.destination,
        authorizationDirectory: staleAuthorizations,
        executeSession() {
          executions += 1;
        },
      }),
    /does not match|stale/iu,
  );
  assert.equal(executions, 0);
});

test("campaign preflight is mandatory only for providers with the reviewed zero-turn protocol", () => {
  const context = preparedFixture("google");
  const authorizationDirectory = writeAuthorizations(context);
  let executions = 0;

  const executed = runPreparedCampaign({
    campaignDirectory: context.destination,
    authorizationDirectory,
    executeSession(session) {
      executions += 1;
      return {
        status: "completed",
        finalAnswer: `answer ${session.blindAlias}`,
        transcript: "retained transcript",
        tokens: 10,
        durationMs: 20,
      };
    },
  });

  assert.equal(executions, 30);
  assert.equal(executed.state, "executed");
  assert.throws(
    () =>
      preflightPreparedCampaign({
        campaignDirectory: context.destination,
        preflightSession() {
          throw new Error("must not be called");
        },
      }),
    /executed|OpenAI/iu,
  );
});

test("run validates every exact authorization before launching any session", () => {
  const context = preparedFixture();
  writeSuccessfulPreflight(context);
  const authorizationDirectory = path.join(context.temporary, "authorizations");
  const executions = [];
  assert.throws(
    () =>
      runPreparedCampaign({
        campaignDirectory: context.destination,
        authorizationDirectory,
        executeSession(session) {
          executions.push(session);
        },
      }),
    /authorization/iu,
  );
  assert.equal(executions.length, 0);
  assert.equal(
    existsSync(path.join(context.destination, "execution-start.json")),
    false,
  );

  mkdirSync(authorizationDirectory);
  for (const session of context.manifest.sessions) {
    const target = path.join(
      authorizationDirectory,
      `${session.blindAlias}.json`,
    );
    writeFileSync(
      target,
      `${JSON.stringify({
        schemaVersion: 1,
        decision: "authorized",
        statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
        allowExternalModel: true,
        provider: context.manifest.protocol.provider,
        model: context.manifest.protocol.model,
        effort: context.manifest.protocol.effort,
        transmissionSha256: session.transmissionSha256,
      })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  }
  const completed = runPreparedCampaign({
    campaignDirectory: context.destination,
    authorizationDirectory,
    executeSession(session) {
      executions.push(session.blindAlias);
      return {
        status: "completed",
        finalAnswer: `answer ${session.blindAlias}`,
        tokens: 10,
        durationMs: 20,
      };
    },
  });
  assert.equal(executions.length, 30);
  assert.equal(completed.state, "executed");
  assert.equal(completed.sessions.length, 30);
  const executionStart = JSON.parse(
    readFileSync(
      path.join(context.destination, "execution-start.json"),
      "utf8",
    ),
  );
  assert.equal(executionStart.state, "execution-started");
  assert.equal(
    executionStart.campaignManifestSha256,
    sha256Hex(canonicalJsonBytes(context.manifest)),
  );
  assert.equal(
    executionStart.capabilityReconciliationSha256,
    context.manifest.capabilityReconciliation.receiptSha256,
  );
  assert.match(executionStart.authorizationSetSha256, /^[0-9a-f]{64}$/u);
  assert.equal(
    completed.executionStartSha256,
    sha256Hex(canonicalJsonBytes(executionStart)),
  );
  assert.throws(
    () =>
      runPreparedCampaign({
        campaignDirectory: context.destination,
        authorizationDirectory,
        executeSession() {
          throw new Error("must not resume");
        },
      }),
    /execution.*already|cannot.*resume|start.*exists/iu,
  );
});

test("prepared session results retain transcript, token, and timing evidence", () => {
  const preparedSession = mkdtempSync(
    path.join(tmpdir(), "defining-session-result-"),
  );
  mkdirSync(path.join(preparedSession, "outputs"));
  const transcript = '{"type":"assistant","text":"retained answer"}\n';
  writeFileSync(
    path.join(preparedSession, "run.json"),
    JSON.stringify({
      schemaVersion: 1,
      status: "completed",
      failureClass: null,
      error: null,
      suiteResult: { finalAnswer: "retained answer" },
    }),
  );
  writeFileSync(
    path.join(preparedSession, "outputs", "transcript.jsonl"),
    transcript,
  );
  writeFileSync(
    path.join(preparedSession, "metrics.json"),
    JSON.stringify({
      schemaVersion: 1,
      nativeUsage: null,
      normalizedUsage: { totalTokens: 42 },
    }),
  );
  writeFileSync(
    path.join(preparedSession, "timing.json"),
    JSON.stringify({ schemaVersion: 1, durationMs: 123 }),
  );

  assert.deepEqual(readPreparedSessionResult(preparedSession), {
    status: "completed",
    failureClass: null,
    error: null,
    finalAnswer: "retained answer",
    transcript,
    tokens: 42,
    durationMs: 123,
  });
});

test("a failed provider result closes the campaign without retry or resume", () => {
  const context = preparedFixture();
  writeSuccessfulPreflight(context);
  const authorizationDirectory = writeAuthorizations(context);
  const firstAlias = context.manifest.sessions[0].blindAlias;
  let executions = 0;
  assert.throws(
    () =>
      runPreparedCampaign({
        campaignDirectory: context.destination,
        authorizationDirectory,
        executeSession(session) {
          executions += 1;
          if (session.blindAlias !== firstAlias) {
            throw new Error("campaign continued after terminal failure");
          }
          return {
            status: "failed",
            failureClass: "provider-failed",
            error: "fixture provider failure",
            finalAnswer: null,
            transcript: "",
            tokens: null,
            durationMs: 20,
          };
        },
      }),
    /provider-failed|campaign execution failed/iu,
  );

  assert.equal(executions, 1);
  assert.equal(
    JSON.parse(
      readFileSync(
        path.join(
          context.destination,
          "invalid-attempts",
          "attempt-01",
          "attempt.json",
        ),
        "utf8",
      ),
    ).failureClass,
    "provider-failed",
  );
  const failed = JSON.parse(
    readFileSync(
      path.join(context.destination, "execution-failed.json"),
      "utf8",
    ),
  );
  assert.equal(failed.state, "execution-failed");
  assert.equal(failed.blindAlias, firstAlias);
  assert.equal(failed.completedSessionCount, 0);
  assert.equal(
    existsSync(path.join(context.destination, "executed.json")),
    false,
  );
  assert.throws(
    () =>
      runPreparedCampaign({
        campaignDirectory: context.destination,
        authorizationDirectory,
        executeSession() {
          executions += 1;
        },
      }),
    /execution.*already|cannot.*resume|start.*exists/iu,
  );
  assert.equal(executions, 1);
  assert.throws(
    () => prepareCampaignGrading({ campaignDirectory: context.destination }),
    /executed|campaign/iu,
  );
});

test("a thrown execution callback writes terminal failure evidence and cannot resume", () => {
  const context = preparedFixture();
  writeSuccessfulPreflight(context);
  const authorizationDirectory = writeAuthorizations(context);
  let executions = 0;

  assert.throws(
    () =>
      runPreparedCampaign({
        campaignDirectory: context.destination,
        authorizationDirectory,
        executeSession() {
          executions += 1;
          const error = new Error("fixture transport interruption");
          error.code = "FIXTURE_INTERRUPTED";
          throw error;
        },
      }),
    /fixture transport interruption/u,
  );
  assert.equal(executions, 1);
  const failed = JSON.parse(
    readFileSync(
      path.join(context.destination, "execution-failed.json"),
      "utf8",
    ),
  );
  assert.equal(failed.state, "execution-failed");
  assert.equal(failed.failureClass, "execution-threw");
  assert.equal(failed.error.code, "FIXTURE_INTERRUPTED");
  assert.equal(failed.completedSessionCount, 0);
  assert.equal(
    existsSync(path.join(context.destination, "executed.json")),
    false,
  );
  assert.throws(
    () =>
      runPreparedCampaign({
        campaignDirectory: context.destination,
        authorizationDirectory,
        executeSession() {
          executions += 1;
        },
      }),
    /execution.*already|cannot.*resume|start.*exists/iu,
  );
  assert.equal(executions, 1);
});

test("grading packets are blind and pairwise side assignment is sealed", () => {
  const context = preparedFixture();
  writeSuccessfulPreflight(context);
  const authorizationDirectory = path.join(context.temporary, "authorizations");
  mkdirSync(authorizationDirectory);
  for (const session of context.manifest.sessions) {
    const target = path.join(
      authorizationDirectory,
      `${session.blindAlias}.json`,
    );
    writeFileSync(
      target,
      `${JSON.stringify({
        schemaVersion: 1,
        decision: "authorized",
        statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
        allowExternalModel: true,
        provider: "openai",
        model: "gpt-test",
        effort: "low",
        transmissionSha256: session.transmissionSha256,
      })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  }
  runPreparedCampaign({
    campaignDirectory: context.destination,
    authorizationDirectory,
    executeSession(session) {
      return {
        status: "completed",
        finalAnswer: `blind output ${session.blindAlias}`,
        transcript: [{ role: "assistant", text: "blind output" }],
        tokens: 10,
        durationMs: 20,
      };
    },
  });
  const grading = prepareCampaignGrading({
    campaignDirectory: context.destination,
  });
  assert.equal(grading.state, "grading-prepared");
  assert.equal(grading.criticalPackets.length, 30);
  assert.equal(grading.pairwisePackets.length, 10);
  for (const packet of [
    ...grading.criticalPackets,
    ...grading.pairwisePackets,
  ]) {
    const serialized = JSON.stringify(packet);
    assert.doesNotMatch(serialized, /current-skill|candidate-skill|no-skill/u);
  }
  assert.match(grading.pairwiseMappingSealSha256, /^[0-9a-f]{64}$/u);
});

test("aggregate enforces complete grades and one-repetition limitations", () => {
  const context = preparedFixture();
  const gradeRecords = completeGradeRecords(context.manifest);
  const pairwiseGrades = completePairwiseGrades();
  const aggregate = aggregateCampaignGrades({
    manifest: context.manifest,
    gradeRecords,
    pairwiseGrades,
    disagreements: [],
  });
  assert.equal(aggregate.critical.total, 30);
  assert.equal(aggregate.critical.failed, 0);
  assert.equal(aggregate.pairwise.candidateWins, 10);
  assert.equal(aggregate.limitations.repeatedSampling, false);
  assert.equal(aggregate.limitations.humanUsabilityEvaluated, false);
  assert.ok(Array.isArray(aggregate.byCase));
  assert.ok(Array.isArray(aggregate.byProfile));
  assert.ok(Array.isArray(aggregate.byResearchStratum));
  assert.equal(Object.hasOwn(aggregate, "variance"), false);
  assert.equal(Object.hasOwn(aggregate, "standardDeviation"), false);
  assert.equal(Object.hasOwn(aggregate, "passProbability"), false);
  assert.throws(
    () =>
      aggregateCampaignGrades({
        manifest: context.manifest,
        gradeRecords: gradeRecords.slice(1),
        pairwiseGrades: [],
        disagreements: [],
      }),
    /complete/iu,
  );
  assert.throws(
    () =>
      aggregateCampaignGrades({
        manifest: context.manifest,
        gradeRecords: gradeRecords.map((grade, index) =>
          index === 0 ? { ...grade, critical: [] } : grade,
        ),
        pairwiseGrades,
        disagreements: [],
      }),
    /critical expectations/iu,
  );
  assert.throws(
    () =>
      aggregateCampaignGrades({
        manifest: context.manifest,
        gradeRecords: gradeRecords.map((grade, index) =>
          index === 0 ? { ...grade, dimensions: [] } : grade,
        ),
        pairwiseGrades,
        disagreements: [],
      }),
    /qualitative dimensions/iu,
  );
  assert.throws(
    () =>
      aggregateCampaignGrades({
        manifest: context.manifest,
        gradeRecords,
        pairwiseGrades: pairwiseGrades.slice(1),
        disagreements: [],
      }),
    /pairwise grades/iu,
  );
  assert.throws(
    () =>
      aggregateCampaignGrades({
        manifest: context.manifest,
        gradeRecords,
        pairwiseGrades: pairwiseGrades.map((grade, index) =>
          index === 0 ? { ...grade, outcome: "broadly-better" } : grade,
        ),
        disagreements: [],
      }),
    /pairwise outcome/iu,
  );
});
