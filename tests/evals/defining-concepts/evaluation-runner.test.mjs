import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aggregateCampaignGrades,
  buildCampaignMatrix,
  prepareCampaign,
  prepareCampaignGrading,
  runPreparedCampaign,
} from "../../../evals/defining-concepts/evaluation-runner.mjs";
import {
  canonicalJsonBytes,
  EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  sha256Hex,
} from "../../../scripts/evaluation/runtime.js";

const arms = Object.freeze(["no-skill", "current-skill", "candidate-skill"]);
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
    }),
  ),
);

function bundle(kind, marker) {
  const content = `# ${marker}\n`;
  const bytes = Buffer.from(content);
  const payload = {
    schemaVersion: 1,
    skillName: "defining-concepts",
    source:
      kind === "git"
        ? { kind, commitOid: marker.repeat(40).slice(0, 40), treeOid: marker.repeat(40).slice(0, 40) }
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

function packetFor(cell) {
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
    provider: "openai",
    model: "gpt-test",
    effort: "low",
    transport: "codex-app-server",
    toolchain: { fixture: true },
    runtimeFingerprint: { fixture: true },
    capabilities: { network: false, webSearch: false, tools: [], providerFacilities: [] },
    isolation: { fixture: true },
    harnessControlledInputs: [],
    continuationPolicy: {
      controllerSha256: "a".repeat(64),
      maxTurns: 1,
      allowedTransitions: [],
      templates: [],
    },
  };
  return Object.freeze({
    schemaVersion: 1,
    canonicalization: "RFC8785-JCS",
    digestAlgorithm: "sha256",
    transmission,
    transmissionSha256: sha256Hex(canonicalJsonBytes(transmission)),
  });
}

function preparedFixture() {
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
    provider: "openai",
    model: "gpt-test",
    effort: "low",
    seed: "frozen-seed",
    now: new Date("2026-08-29T02:45:00.123Z"),
    prepareSession(cell) {
      providerCalls.push({ kind: "prepare", cell });
      return { modelTurns: 0, packet: packetFor(cell) };
    },
  });
  return { destination, manifest, providerCalls, temporary };
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
  assert.ok(matrix.every(({ blindAlias }) => !/current|candidate|skill/iu.test(blindAlias)));
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
  assert.equal(context.manifest.schemaVersion, 2);
  assert.equal(context.manifest.state, "prepared");
  assert.equal(context.manifest.runIdentity, "2026-08-29T02:45:00.123Z");
  assert.deepEqual(context.manifest.protocol.arms, arms);
  assert.equal(context.manifest.protocol.repetitionCount, 1);
  assert.equal(context.manifest.sessions.length, 30);
  assert.equal(context.manifest.limitations.repeatedSampling, false);
  assert.equal(context.manifest.limitations.humanUsabilityEvaluated, false);
  assert.equal(
    JSON.parse(readFileSync(path.join(context.destination, "manifest.json"), "utf8")).blindMappingSealSha256,
    context.manifest.blindMappingSealSha256,
  );
  assert.throws(() => preparedFixture().manifest && prepareCampaign({ destination: context.destination }), /new directory/iu);
});

test("run validates every exact authorization before launching any session", () => {
  const context = preparedFixture();
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

  mkdirSync(authorizationDirectory);
  for (const session of context.manifest.sessions) {
    const target = path.join(authorizationDirectory, `${session.blindAlias}.json`);
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
      return { status: "completed", finalAnswer: `answer ${session.blindAlias}`, tokens: 10, durationMs: 20 };
    },
  });
  assert.equal(executions.length, 30);
  assert.equal(completed.state, "executed");
  assert.equal(completed.sessions.length, 30);
});

test("grading packets are blind and pairwise side assignment is sealed", () => {
  const context = preparedFixture();
  const authorizationDirectory = path.join(context.temporary, "authorizations");
  mkdirSync(authorizationDirectory);
  for (const session of context.manifest.sessions) {
    const target = path.join(authorizationDirectory, `${session.blindAlias}.json`);
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
  const grading = prepareCampaignGrading({ campaignDirectory: context.destination });
  assert.equal(grading.state, "grading-prepared");
  assert.equal(grading.criticalPackets.length, 30);
  assert.equal(grading.pairwisePackets.length, 10);
  for (const packet of [...grading.criticalPackets, ...grading.pairwisePackets]) {
    const serialized = JSON.stringify(packet);
    assert.doesNotMatch(serialized, /current-skill|candidate-skill|no-skill/u);
  }
  assert.match(grading.pairwiseMappingSealSha256, /^[0-9a-f]{64}$/u);
});

test("aggregate enforces complete grades and one-repetition limitations", () => {
  const context = preparedFixture();
  const gradeRecords = context.manifest.sessions.map((session) => ({
    blindAlias: session.blindAlias,
    critical: [{ expectationId: `critical-${session.caseId}`, passed: true, excerpt: "boundary", reason: "supported" }],
    dimensions: [{ id: "semantic-accuracy", rating: "meets" }],
    tokens: 10,
    durationMs: 20,
  }));
  const aggregate = aggregateCampaignGrades({
    manifest: context.manifest,
    gradeRecords,
    pairwiseGrades: cases.map(({ id }) => ({ caseId: id, outcome: "candidate" })),
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
});
