import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  canonicalJsonBytes,
  EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";
import {
  captureGitSkillBundle,
  captureWorkingTreeSkillBundle,
} from "../../scripts/evaluation/skill-bundle.js";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");
const SESSION_RUNNER = path.join(
  import.meta.dirname,
  "run-evaluation-session.mjs",
);
const CANONICAL_ARMS = Object.freeze([
  "no-skill",
  "current-skill",
  "candidate-skill",
]);
const TIMESTAMP_DIRECTORY_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{6}(?:\.\d{3})?Z$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(message);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function canonicalRecord(value) {
  return JSON.parse(canonicalJsonBytes(value).toString("utf8"));
}

function writeCanonicalExclusive(target, value) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, canonicalJsonBytes(value), { flag: "wx" });
}

function readJson(target, label) {
  try {
    return JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
}

function safeTimestamp(date) {
  return date.toISOString().replaceAll(":", "");
}

function stableDigest(seed, identity) {
  return createHash("sha256")
    .update(seed, "utf8")
    .update(Buffer.from([0]))
    .update(identity, "utf8")
    .digest("hex");
}

function assertCanonicalArms(arms) {
  if (
    !Array.isArray(arms) ||
    arms.length !== CANONICAL_ARMS.length ||
    arms.some((arm, index) => arm !== CANONICAL_ARMS[index])
  ) {
    fail("arms must be no-skill, current-skill, and candidate-skill in canonical order");
  }
}

export function buildCampaignMatrix({
  caseIds,
  arms,
  repetitionCount,
  seed,
}) {
  if (
    !Array.isArray(caseIds) ||
    caseIds.length === 0 ||
    caseIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(caseIds).size !== caseIds.length
  ) {
    fail("caseIds must contain unique positive integers");
  }
  assertCanonicalArms(arms);
  if (repetitionCount !== 1) {
    fail("defining-concepts campaigns require exactly one repetition");
  }
  if (typeof seed !== "string" || seed.length < 8) {
    fail("seed must be a nonempty stable campaign seed");
  }

  const cells = [];
  for (const caseId of caseIds) {
    for (const arm of arms) {
      const internalId = `case-${String(caseId).padStart(2, "0")}--${arm}--repetition-01`;
      const orderingDigest = stableDigest(seed, internalId);
      cells.push({
        internalId,
        caseId,
        arm,
        repetition: 1,
        blindAlias: `sample-${orderingDigest.slice(0, 16)}`,
        orderingDigest,
      });
    }
  }
  cells.sort((left, right) =>
    left.orderingDigest.localeCompare(right.orderingDigest, "en"),
  );
  if (new Set(cells.map(({ blindAlias }) => blindAlias)).size !== cells.length) {
    fail("blind alias collision; select a different seed");
  }
  return deepFreeze(
    cells.map((cell, index) => ({ ...cell, sequence: index + 1 })),
  );
}

function assertBundle(bundle, expectedKind, label) {
  if (
    bundle?.schemaVersion !== 1 ||
    bundle?.skillName !== "defining-concepts" ||
    bundle?.source?.kind !== expectedKind ||
    !Array.isArray(bundle?.files) ||
    bundle.files.length === 0 ||
    typeof bundle?.aggregateSha256 !== "string"
  ) {
    fail(`${label} bundle is invalid`);
  }
  const payload = {
    schemaVersion: bundle.schemaVersion,
    skillName: bundle.skillName,
    source: bundle.source,
    files: bundle.files,
  };
  if (sha256Hex(canonicalJsonBytes(payload)) !== bundle.aggregateSha256) {
    fail(`${label} bundle aggregate digest is invalid`);
  }
}

function caseSnapshot(evaluationCase) {
  const conversation = {
    prompt: evaluationCase.prompt,
    ...(Object.hasOwn(evaluationCase, "follow_up_turns")
      ? { follow_up_turns: evaluationCase.follow_up_turns }
      : {}),
  };
  return {
    record: canonicalRecord(evaluationCase),
    caseSha256: sha256Hex(canonicalJsonBytes(evaluationCase)),
    conversationSha256: sha256Hex(canonicalJsonBytes(conversation)),
  };
}

function validatePreparedPacket(result, cell) {
  if (result?.modelTurns !== 0 || result?.packet === undefined) {
    fail(`preparation for ${cell.internalId} must return zero model turns and one packet`);
  }
  const packet = result.packet;
  if (
    packet?.schemaVersion !== 1 ||
    !SHA256_PATTERN.test(packet?.transmissionSha256 ?? "") ||
    packet.transmissionSha256 !==
      sha256Hex(canonicalJsonBytes(packet.transmission)) ||
    packet.transmission?.session?.caseId !== cell.caseId ||
    packet.transmission?.session?.arm !== cell.arm ||
    packet.transmission?.session?.repetition !== 1
  ) {
    fail(`prepared packet for ${cell.internalId} is not bound to its campaign cell`);
  }
  return canonicalRecord(packet);
}

export function prepareCampaign({
  campaign,
  destination,
  cases,
  arms,
  repetitionCount,
  currentBundle,
  candidateBundle,
  provider,
  model,
  effort,
  seed,
  now = new Date(),
  prepareSession,
}) {
  if (typeof destination !== "string" || path.resolve(destination) !== destination) {
    fail("destination must be an absolute new directory");
  }
  if (existsSync(destination)) fail("destination must be a new directory");
  if (!TIMESTAMP_DIRECTORY_PATTERN.test(path.basename(destination))) {
    fail("destination must use a filesystem-safe ISO UTC timestamp name");
  }
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) fail("now must be a valid Date");
  if (path.basename(destination) !== safeTimestamp(now)) {
    fail("destination timestamp must match the frozen campaign start time");
  }
  if (campaign !== "calibration" && campaign !== "confirmatory") {
    fail("campaign must be calibration or confirmatory");
  }
  if (
    !Array.isArray(cases) ||
    cases.length === 0 ||
    cases.some((item) => !Number.isSafeInteger(item?.id) || item.id <= 0) ||
    new Set(cases.map(({ id }) => id)).size !== cases.length
  ) {
    fail("cases must contain unique positive IDs");
  }
  assertCanonicalArms(arms);
  assertBundle(currentBundle, "git", "current-skill");
  assertBundle(candidateBundle, "working-tree", "candidate-skill");
  if (currentBundle.aggregateSha256 === candidateBundle.aggregateSha256) {
    fail("current and candidate skill bundle aggregates must differ");
  }
  for (const [name, value] of Object.entries({ provider, model, effort, seed })) {
    if (typeof value !== "string" || value.length === 0) fail(`${name} must be nonempty`);
  }
  if (typeof prepareSession !== "function") fail("prepareSession must be a function");

  const matrix = buildCampaignMatrix({
    caseIds: cases.map(({ id }) => id),
    arms,
    repetitionCount,
    seed,
  });
  const caseById = new Map(cases.map((item) => [item.id, item]));
  const staging = `${destination}.preparing-${randomBytes(6).toString("hex")}`;
  mkdirSync(staging, { recursive: false });
  try {
    const snapshots = new Map();
    for (const evaluationCase of cases) {
      const snapshot = caseSnapshot(evaluationCase);
      snapshots.set(evaluationCase.id, snapshot);
      writeCanonicalExclusive(
        path.join(staging, "cases", `case-${String(evaluationCase.id).padStart(2, "0")}.json`),
        snapshot.record,
      );
    }
    writeCanonicalExclusive(
      path.join(staging, "bundles", "current-skill.json"),
      currentBundle,
    );
    writeCanonicalExclusive(
      path.join(staging, "bundles", "candidate-skill.json"),
      candidateBundle,
    );

    const sessions = [];
    const mapping = [];
    for (const cell of matrix) {
      const evaluationCase = caseById.get(cell.caseId);
      const snapshot = snapshots.get(cell.caseId);
      const sessionDirectory = path.join(staging, "sessions", cell.blindAlias);
      mkdirSync(sessionDirectory, { recursive: true });
      const bundle =
        cell.arm === "current-skill"
          ? currentBundle
          : cell.arm === "candidate-skill"
            ? candidateBundle
            : null;
      const prepared = validatePreparedPacket(
        prepareSession({
          ...cell,
          caseRecord: snapshot.record,
          bundle,
          sessionDirectory,
        }),
        cell,
      );
      const packetPath = path.join(sessionDirectory, "packet.json");
      if (!existsSync(packetPath)) writeCanonicalExclusive(packetPath, prepared);
      else if (!canonicalJsonBytes(readJson(packetPath, "prepared packet")).equals(canonicalJsonBytes(prepared))) {
        fail(`prepared packet bytes disagree for ${cell.internalId}`);
      }
      sessions.push({
        blindAlias: cell.blindAlias,
        sequence: cell.sequence,
        caseId: cell.caseId,
        arm: cell.arm,
        repetition: 1,
        caseSha256: snapshot.caseSha256,
        conversationSha256: snapshot.conversationSha256,
        skillBundleAggregateSha256: bundle?.aggregateSha256 ?? null,
        provider,
        model,
        effort,
        runtimeFingerprint: prepared.transmission.runtimeFingerprint,
        transmissionSha256: prepared.transmissionSha256,
        relativeSessionPath: `sessions/${cell.blindAlias}`,
        disposition: "prepared",
      });
      mapping.push({
        blindAlias: cell.blindAlias,
        internalId: cell.internalId,
        caseId: cell.caseId,
        arm: cell.arm,
        repetition: 1,
      });
    }

    const mappingRecord = { schemaVersion: 1, seed, sessions: mapping };
    const blindMappingSealSha256 = sha256Hex(canonicalJsonBytes(mappingRecord));
    writeCanonicalExclusive(
      path.join(staging, "sealed", "blind-mapping.json"),
      mappingRecord,
    );
    const manifest = {
      schemaVersion: 2,
      suite: "defining-concepts",
      campaign,
      state: "prepared",
      runIdentity: now.toISOString(),
      directoryName: path.basename(destination),
      protocol: {
        caseIds: cases.map(({ id }) => id),
        arms: [...arms],
        repetitionCount: 1,
        provider,
        model,
        effort,
      },
      skillBundles: {
        currentSkill: {
          relativePath: "bundles/current-skill.json",
          aggregateSha256: currentBundle.aggregateSha256,
          source: currentBundle.source,
          files: currentBundle.files.map(({ path: filePath, byteLength, sha256 }) => ({
            path: filePath,
            byteLength,
            sha256,
          })),
        },
        candidateSkill: {
          relativePath: "bundles/candidate-skill.json",
          aggregateSha256: candidateBundle.aggregateSha256,
          source: candidateBundle.source,
          files: candidateBundle.files.map(({ path: filePath, byteLength, sha256 }) => ({
            path: filePath,
            byteLength,
            sha256,
          })),
        },
      },
      caseSnapshots: cases.map(({ id }) => ({
        id,
        relativePath: `cases/case-${String(id).padStart(2, "0")}.json`,
        caseSha256: snapshots.get(id).caseSha256,
        conversationSha256: snapshots.get(id).conversationSha256,
      })),
      caseRecords: cases.map((evaluationCase) => ({
        id: evaluationCase.id,
        name: evaluationCase.name,
        renderer: evaluationCase.renderer,
        profiles: evaluationCase.profiles,
        research_strata: evaluationCase.research_strata,
        qualitative_dimensions: evaluationCase.qualitative_dimensions,
      })),
      blindMappingSealSha256,
      sessions,
      limitations: {
        repeatedSampling: false,
        withinCellVarianceAvailable: false,
        humanUsabilityEvaluated: false,
      },
    };
    writeCanonicalExclusive(path.join(staging, "manifest.json"), manifest);
    renameSync(staging, destination);
    return deepFreeze(canonicalRecord(manifest));
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function assertAuthorization(authorization, manifest, session) {
  const expected = {
    schemaVersion: 1,
    decision: "authorized",
    statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
    allowExternalModel: true,
    provider: manifest.protocol.provider,
    model: manifest.protocol.model,
    effort: manifest.protocol.effort,
    transmissionSha256: session.transmissionSha256,
  };
  if (!canonicalJsonBytes(authorization).equals(canonicalJsonBytes(expected))) {
    fail(`authorization for ${session.blindAlias} does not match its exact transmission`);
  }
}

export function runPreparedCampaign({
  campaignDirectory,
  authorizationDirectory,
  executeSession,
}) {
  const manifest = readJson(path.join(campaignDirectory, "manifest.json"), "campaign manifest");
  if (manifest.schemaVersion !== 2 || manifest.state !== "prepared") {
    fail("campaign is not in the prepared state");
  }
  if (existsSync(path.join(campaignDirectory, "executed.json"))) {
    fail("campaign execution state already exists and cannot be overwritten");
  }
  if (typeof executeSession !== "function") fail("executeSession must be a function");
  const authorizations = new Map();
  for (const session of manifest.sessions) {
    const target = path.join(authorizationDirectory, `${session.blindAlias}.json`);
    const authorization = readJson(target, `authorization for ${session.blindAlias}`);
    assertAuthorization(authorization, manifest, session);
    authorizations.set(session.blindAlias, authorization);
  }

  const results = [];
  for (const session of manifest.sessions) {
    let result;
    try {
      result = executeSession(
        deepFreeze(canonicalRecord(session)),
        authorizations.get(session.blindAlias),
      );
    } catch (error) {
      const invalidDirectory = path.join(
        campaignDirectory,
        "invalid-attempts",
        `attempt-${String(results.length + 1).padStart(2, "0")}`,
      );
      writeCanonicalExclusive(path.join(invalidDirectory, "attempt.json"), {
        schemaVersion: 1,
        blindAlias: session.blindAlias,
        disposition: "invalid",
        reason: error.message,
      });
      throw error;
    }
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      fail(`execution for ${session.blindAlias} returned a malformed result`);
    }
    results.push({
      blindAlias: session.blindAlias,
      caseId: session.caseId,
      status: result.status,
      disposition: result.status === "completed" ? "valid" : "invalid",
      finalAnswer: result.finalAnswer ?? null,
      transcript: result.transcript ?? null,
      tokens: result.tokens ?? null,
      durationMs: result.durationMs ?? null,
    });
  }
  const record = {
    schemaVersion: 1,
    state: "executed",
    campaignManifestSha256: sha256Hex(canonicalJsonBytes(manifest)),
    sessions: results,
  };
  writeCanonicalExclusive(path.join(campaignDirectory, "executed.json"), record);
  return deepFreeze(canonicalRecord(record));
}

function blindedOutput(result) {
  return {
    finalAnswer: result.finalAnswer,
    transcript: result.transcript,
  };
}

function gradingExpectations(evaluationCase) {
  const critical = new Set(evaluationCase.critical_expectation_indexes ?? []);
  return evaluationCase.expectations.map((expectation, index) =>
    typeof expectation === "string"
      ? {
          id: `expectation-${String(index + 1).padStart(2, "0")}`,
          text: expectation,
          critical: critical.has(index),
        }
      : expectation,
  );
}

export function prepareCampaignGrading({ campaignDirectory }) {
  const manifest = readJson(path.join(campaignDirectory, "manifest.json"), "campaign manifest");
  const executed = readJson(path.join(campaignDirectory, "executed.json"), "executed campaign");
  if (manifest.schemaVersion !== 2 || executed.state !== "executed") {
    fail("campaign must be executed before grading preparation");
  }
  if (existsSync(path.join(campaignDirectory, "grading-prepared.json"))) {
    fail("grading preparation already exists and cannot be overwritten");
  }
  const resultByAlias = new Map(
    executed.sessions.map((result) => [result.blindAlias, result]),
  );
  const criticalPackets = [];
  for (const session of manifest.sessions) {
    const evaluationCase = readJson(
      path.join(
        campaignDirectory,
        manifest.caseSnapshots.find(({ id }) => id === session.caseId).relativePath,
      ),
      `case ${session.caseId}`,
    );
    const packet = {
      schemaVersion: 1,
      packetId: `critical-${session.blindAlias}`,
      blindAlias: session.blindAlias,
      caseId: session.caseId,
      prompt: evaluationCase.prompt,
      followUpTurns: evaluationCase.follow_up_turns ?? [],
      expectations: gradingExpectations(evaluationCase),
      qualitativeDimensions: evaluationCase.qualitative_dimensions,
      output: blindedOutput(resultByAlias.get(session.blindAlias)),
    };
    criticalPackets.push(packet);
    writeCanonicalExclusive(
      path.join(campaignDirectory, "grading", "critical", `${session.blindAlias}.json`),
      packet,
    );
  }

  const mapping = [];
  const pairwisePackets = [];
  for (const caseId of manifest.protocol.caseIds) {
    const selected = manifest.sessions.filter(
      (session) =>
        session.caseId === caseId &&
        ["current-skill", "candidate-skill"].includes(session.arm),
    );
    if (selected.length !== 2) fail(`case ${caseId} lacks a current/candidate pair`);
    const flip = Number.parseInt(
      stableDigest(manifest.blindMappingSealSha256, `pair-${caseId}`).slice(0, 2),
      16,
    ) % 2;
    const sides = flip === 0 ? selected : [...selected].reverse();
    const packet = {
      schemaVersion: 1,
      packetId: `pair-${String(caseId).padStart(2, "0")}`,
      caseId,
      sideA: {
        blindAlias: sides[0].blindAlias,
        output: blindedOutput(resultByAlias.get(sides[0].blindAlias)),
      },
      sideB: {
        blindAlias: sides[1].blindAlias,
        output: blindedOutput(resultByAlias.get(sides[1].blindAlias)),
      },
    };
    pairwisePackets.push(packet);
    mapping.push({ caseId, sideA: sides[0].arm, sideB: sides[1].arm });
    writeCanonicalExclusive(
      path.join(campaignDirectory, "grading", "pairwise", `${packet.packetId}.json`),
      packet,
    );
  }
  const mappingRecord = { schemaVersion: 1, pairs: mapping };
  const pairwiseMappingSealSha256 = sha256Hex(canonicalJsonBytes(mappingRecord));
  writeCanonicalExclusive(
    path.join(campaignDirectory, "sealed", "pairwise-mapping.json"),
    mappingRecord,
  );
  const record = {
    schemaVersion: 1,
    state: "grading-prepared",
    criticalPacketCount: criticalPackets.length,
    pairwisePacketCount: pairwisePackets.length,
    pairwiseMappingSealSha256,
  };
  writeCanonicalExclusive(
    path.join(campaignDirectory, "grading-prepared.json"),
    record,
  );
  return deepFreeze({
    ...record,
    criticalPackets: canonicalRecord(criticalPackets),
    pairwisePackets: canonicalRecord(pairwisePackets),
  });
}

function countGroups(items, valuesForItem) {
  const counts = new Map();
  for (const item of items) {
    for (const value of valuesForItem(item)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([id, count]) => ({ id, count }));
}

export function aggregateCampaignGrades({
  manifest,
  gradeRecords,
  pairwiseGrades,
  disagreements,
}) {
  if (manifest?.schemaVersion !== 2 || manifest.protocol?.repetitionCount !== 1) {
    fail("aggregate requires a current one-repetition campaign manifest");
  }
  if (
    !Array.isArray(gradeRecords) ||
    gradeRecords.length !== manifest.sessions.length ||
    new Set(gradeRecords.map(({ blindAlias }) => blindAlias)).size !== manifest.sessions.length
  ) {
    fail("grade records must provide one complete unique grade per session");
  }
  const knownAliases = new Set(manifest.sessions.map(({ blindAlias }) => blindAlias));
  if (gradeRecords.some(({ blindAlias }) => !knownAliases.has(blindAlias))) {
    fail("grade records contain an unknown blind alias");
  }
  if (!Array.isArray(pairwiseGrades) || !Array.isArray(disagreements)) {
    fail("pairwise grades and disagreements must be arrays");
  }
  const criticalItems = gradeRecords.flatMap((grade) => grade.critical ?? []);
  const criticalFailed = criticalItems.filter(({ passed }) => passed !== true).length;
  const pairwise = {
    candidateWins: pairwiseGrades.filter(({ outcome }) => outcome === "candidate").length,
    currentWins: pairwiseGrades.filter(({ outcome }) => outcome === "current").length,
    ties: pairwiseGrades.filter(({ outcome }) => outcome === "tie").length,
    total: pairwiseGrades.length,
  };
  const sessionByAlias = new Map(
    manifest.sessions.map((session) => [session.blindAlias, session]),
  );
  const caseById = new Map(
    (manifest.caseRecords ?? []).map((evaluationCase) => [evaluationCase.id, evaluationCase]),
  );
  const caseMetadata = (caseId) => caseById.get(caseId) ?? {};
  const enriched = gradeRecords.map((grade) => ({
    ...grade,
    session: sessionByAlias.get(grade.blindAlias),
  }));
  const aggregate = {
    schemaVersion: 1,
    state: "graded",
    critical: {
      total: criticalItems.length,
      passed: criticalItems.length - criticalFailed,
      failed: criticalFailed,
      candidateHasCriticalFailure: enriched.some(
        ({ critical = [], session }) =>
          session.arm === "candidate-skill" && critical.some(({ passed }) => passed !== true),
      ),
    },
    dimensions: countGroups(
      gradeRecords.flatMap(({ dimensions = [] }) => dimensions),
      ({ id }) => [id],
    ),
    byCase: manifest.protocol.caseIds.map((caseId) => ({
      caseId,
      gradeCount: enriched.filter(({ session }) => session.caseId === caseId).length,
    })),
    byProfile: countGroups(enriched, ({ session }) => caseMetadata(session.caseId).profiles ?? []),
    byResearchStratum: countGroups(
      enriched,
      ({ session }) => caseMetadata(session.caseId).research_strata ?? [],
    ),
    pairwise,
    disagreements: canonicalRecord(disagreements),
    usage: {
      totalTokens: gradeRecords.reduce((sum, grade) => sum + (grade.tokens ?? 0), 0),
      totalDurationMs: gradeRecords.reduce((sum, grade) => sum + (grade.durationMs ?? 0), 0),
    },
    limitations: {
      repeatedSampling: false,
      withinCellVarianceAvailable: false,
      humanUsabilityEvaluated: false,
      calibratedPassProbabilityAvailable: false,
    },
  };
  return deepFreeze(canonicalRecord(aggregate));
}

function parseCli(arguments_) {
  const command = arguments_[0];
  const values = new Map();
  const repeated = new Map([
    ["--antigravity-prefix-arg", []],
    ["--claude-prefix-arg", []],
    ["--codex-prefix-arg", []],
  ]);
  for (let index = 1; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) fail("CLI arguments must use --name value pairs");
    if (repeated.has(name)) repeated.get(name).push(value);
    else if (values.has(name)) fail(`duplicate CLI argument ${name}`);
    else values.set(name, value);
  }
  return { command, values, repeated };
}

function requireCli(values, name) {
  const value = values.get(name);
  if (typeof value !== "string" || value.length === 0) fail(`missing ${name}`);
  return value;
}

function providerPrepareArguments(values, repeated) {
  const provider = requireCli(values, "--provider");
  if (provider === "codex") {
    return [
      "--codex-command",
      values.get("--codex-command") ?? "codex",
      ...repeated.get("--codex-prefix-arg").flatMap((item) => ["--codex-prefix-arg", item]),
      "--evaluation-homes-root",
      requireCli(values, "--evaluation-homes-root"),
    ];
  }
  if (provider === "claude") {
    return [
      "--claude-command",
      values.get("--claude-command") ?? "claude",
      ...repeated.get("--claude-prefix-arg").flatMap((item) => ["--claude-prefix-arg", item]),
      "--max-budget-usd",
      values.get("--max-budget-usd") ?? "2",
    ];
  }
  if (provider === "antigravity") {
    return [
      "--antigravity-command",
      requireCli(values, "--antigravity-command"),
      ...repeated.get("--antigravity-prefix-arg").flatMap((item) => ["--antigravity-prefix-arg", item]),
    ];
  }
  fail(`unsupported provider ${provider}`);
}

function prepareFromCli(values, repeated) {
  const campaign = requireCli(values, "--campaign");
  const destination = path.resolve(requireCli(values, "--destination"));
  const baselineRevision = requireCli(values, "--baseline-revision");
  const providerOption = requireCli(values, "--provider");
  const provider =
    providerOption === "codex" ? "openai" : providerOption === "claude" ? "anthropic" : "google";
  const model = requireCli(values, "--model");
  const effort = requireCli(values, "--effort");
  const seed = requireCli(values, "--seed");
  const now = new Date(requireCli(values, "--started-at"));
  const workingRoot = path.resolve(requireCli(values, "--working-root"));
  const definitions = readJson(path.join(import.meta.dirname, "evals.json"), "evaluation definitions");
  const campaignDefinition = definitions.campaigns?.[campaign];
  if (campaignDefinition === undefined) fail(`evaluation definitions do not declare campaign ${campaign}`);
  const selected = campaignDefinition.case_ids.map((id) =>
    definitions.evals.find((evaluationCase) => evaluationCase.id === id),
  );
  const currentBundle = captureGitSkillBundle({
    repositoryRoot: REPOSITORY_ROOT,
    revision: baselineRevision,
    skillName: "defining-concepts",
  });
  const candidateBundle = captureWorkingTreeSkillBundle({
    repositoryRoot: REPOSITORY_ROOT,
    skillName: "defining-concepts",
  });
  const providerArguments = providerPrepareArguments(values, repeated);
  return prepareCampaign({
    campaign,
    destination,
    cases: selected,
    arms: campaignDefinition.arms,
    repetitionCount: campaignDefinition.repetitions,
    currentBundle,
    candidateBundle,
    provider,
    model,
    effort,
    seed,
    now,
    prepareSession(cell) {
      const caseFile = path.join(cell.sessionDirectory, "case.json");
      writeCanonicalExclusive(caseFile, cell.caseRecord);
      const arguments_ = [
        SESSION_RUNNER,
        "prepare",
        "--case-file",
        caseFile,
        "--destination",
        path.join(cell.sessionDirectory, "prepared"),
        "--working-dir",
        path.join(workingRoot, cell.blindAlias),
        "--arm",
        cell.arm,
        "--repetition",
        "1",
        "--provider",
        providerOption,
        "--model",
        model,
        "--effort",
        effort,
      ];
      if (cell.bundle !== null) {
        const bundleFile = path.join(cell.sessionDirectory, "skill-bundle.json");
        writeCanonicalExclusive(bundleFile, cell.bundle);
        arguments_.push("--skill-bundle-file", bundleFile);
      }
      arguments_.push(...providerArguments);
      const result = spawnSync(process.execPath, arguments_, { encoding: "utf8" });
      if (result.status !== 0) fail(`session preparation failed: ${result.stderr}`);
      return {
        modelTurns: 0,
        packet: readJson(
          path.join(cell.sessionDirectory, "prepared", "packet.json"),
          "prepared session packet",
        ),
      };
    },
  });
}

function runFromCli(values) {
  const campaignDirectory = path.resolve(requireCli(values, "--campaign-dir"));
  const authorizationDirectory = path.resolve(requireCli(values, "--authorization-dir"));
  return runPreparedCampaign({
    campaignDirectory,
    authorizationDirectory,
    executeSession(session) {
      const preparedSession = path.join(
        campaignDirectory,
        session.relativeSessionPath,
        "prepared",
      );
      const authorization = path.join(
        authorizationDirectory,
        `${session.blindAlias}.json`,
      );
      const result = spawnSync(
        process.execPath,
        [
          SESSION_RUNNER,
          "run",
          "--prepared-session",
          preparedSession,
          "--authorization",
          authorization,
          "--allow-external-model-call",
        ],
        { encoding: "utf8" },
      );
      const run = readJson(path.join(preparedSession, "run.json"), "session result");
      if (result.status !== 0 && run.status === "completed") {
        fail(`session runner failed after reporting completion: ${result.stderr}`);
      }
      return {
        status: run.status,
        finalAnswer: run.suiteResult?.finalAnswer ?? null,
        transcript: null,
        tokens: null,
        durationMs: null,
      };
    },
  });
}

function aggregateFromCli(values) {
  const campaignDirectory = path.resolve(requireCli(values, "--campaign-dir"));
  const manifest = readJson(path.join(campaignDirectory, "manifest.json"), "campaign manifest");
  const gradesDirectory = path.join(campaignDirectory, "grading", "grades");
  const pairwiseDirectory = path.join(campaignDirectory, "grading", "pairwise-grades");
  const gradeRecords = readdirSync(gradesDirectory).map((name) =>
    readJson(path.join(gradesDirectory, name), `grade ${name}`),
  );
  const pairwiseGrades = readdirSync(pairwiseDirectory).map((name) =>
    readJson(path.join(pairwiseDirectory, name), `pairwise grade ${name}`),
  );
  const disagreementsPath = path.join(campaignDirectory, "grading", "disagreements.json");
  const aggregate = aggregateCampaignGrades({
    manifest,
    gradeRecords,
    pairwiseGrades,
    disagreements: existsSync(disagreementsPath) ? readJson(disagreementsPath, "disagreements") : [],
  });
  writeCanonicalExclusive(path.join(campaignDirectory, "aggregate.generated.json"), aggregate);
  return aggregate;
}

async function cli() {
  const { command, values, repeated } = parseCli(process.argv.slice(2));
  let result;
  if (command === "prepare") result = prepareFromCli(values, repeated);
  else if (command === "run") result = runFromCli(values);
  else if (command === "prepare-grading") {
    result = prepareCampaignGrading({
      campaignDirectory: path.resolve(requireCli(values, "--campaign-dir")),
    });
  } else if (command === "aggregate") result = aggregateFromCli(values);
  else fail("first argument must be prepare, run, prepare-grading, or aggregate");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
