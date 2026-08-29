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
  assertCapabilityReconciliation,
  reconcileEvaluationCapabilities,
} from "../../scripts/evaluation/capability-reconciliation.js";
import {
  captureGitSkillBundle,
  captureWorkingTreeSkillBundle,
} from "../../scripts/evaluation/skill-bundle.js";
import {
  evaluationHomesRootFromLocalAppData,
  initializeEvaluationHomes,
} from "../../scripts/evaluation/evaluation-homes.js";
import {
  preflightEvaluationTrial,
  prepareEvaluationTrial,
  runEvaluationTrial,
  verifyEvaluationTrial,
} from "./evaluation-trial.mjs";

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
const TIMESTAMP_DIRECTORY_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{6}(?:\.\d{3})?Z$/u;
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

function optionalNonnegativeNumber(value, label) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${label} must be a nonnegative finite number or null`);
  }
  return value;
}

export function readPreparedSessionResult(preparedSession) {
  if (
    typeof preparedSession !== "string" ||
    path.resolve(preparedSession) !== preparedSession
  ) {
    fail("preparedSession must be an absolute path");
  }
  const run = readJson(
    path.join(preparedSession, "run.json"),
    "session result",
  );
  const metrics = readJson(
    path.join(preparedSession, "metrics.json"),
    "session metrics",
  );
  const timing = readJson(
    path.join(preparedSession, "timing.json"),
    "session timing",
  );
  if (!new Set(["completed", "failed"]).has(run.status)) {
    fail("session result status must be completed or failed");
  }
  const finalAnswer = run.suiteResult?.finalAnswer ?? null;
  if (
    run.status === "completed" &&
    (typeof finalAnswer !== "string" || finalAnswer.trim().length === 0)
  ) {
    fail("completed session result must retain a nonempty final answer");
  }
  const transcriptPath = path.join(
    preparedSession,
    "outputs",
    "transcript.jsonl",
  );
  const transcript = existsSync(transcriptPath)
    ? readFileSync(transcriptPath, "utf8")
    : null;
  return deepFreeze({
    status: run.status,
    failureClass: run.failureClass ?? null,
    error: run.error ?? null,
    finalAnswer,
    transcript,
    tokens: optionalNonnegativeNumber(
      metrics.normalizedUsage?.totalTokens ?? null,
      "normalized total tokens",
    ),
    durationMs: optionalNonnegativeNumber(
      timing.durationMs ?? null,
      "session duration",
    ),
  });
}

export function withNewCampaignWorkingRoot(workingRoot, operation) {
  if (
    typeof workingRoot !== "string" ||
    path.resolve(workingRoot) !== workingRoot
  ) {
    fail("workingRoot must be an absolute path");
  }
  if (typeof operation !== "function") {
    fail("working-root operation must be a function");
  }
  if (existsSync(workingRoot)) {
    fail("workingRoot must be a new directory");
  }
  mkdirSync(workingRoot, { recursive: false });
  try {
    return operation();
  } catch (error) {
    rmSync(workingRoot, { recursive: true, force: true });
    throw error;
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
    fail(
      "arms must be no-skill, current-skill, and candidate-skill in canonical order",
    );
  }
}

export function buildCampaignMatrix({ caseIds, arms, repetitionCount, seed }) {
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
  if (
    new Set(cells.map(({ blindAlias }) => blindAlias)).size !== cells.length
  ) {
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

function validatePreparedPacket(result, cell, capabilityReconciliation) {
  if (result?.modelTurns !== 0 || result?.packet === undefined) {
    fail(
      `preparation for ${cell.internalId} must return zero model turns and one packet`,
    );
  }
  const packet = result.packet;
  if (
    packet?.schemaVersion !== 1 ||
    !SHA256_PATTERN.test(packet?.transmissionSha256 ?? "") ||
    packet.transmissionSha256 !==
      sha256Hex(canonicalJsonBytes(packet.transmission)) ||
    packet.transmission?.session?.caseId !== cell.caseId ||
    packet.transmission?.session?.arm !== cell.arm ||
    packet.transmission?.session?.repetition !== 1 ||
    !canonicalJsonBytes(packet.transmission?.capabilityReconciliation).equals(
      canonicalJsonBytes(capabilityReconciliation),
    ) ||
    !canonicalJsonBytes(packet.transmission?.capabilities).equals(
      canonicalJsonBytes(capabilityReconciliation.receipt.runtimeCapabilities),
    )
  ) {
    fail(
      `prepared packet for ${cell.internalId} is not bound to its campaign cell`,
    );
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
  capabilityContract,
  providerResolution,
  provider,
  model,
  effort,
  seed,
  now = new Date(),
  prepareSession,
}) {
  if (
    typeof destination !== "string" ||
    path.resolve(destination) !== destination
  ) {
    fail("destination must be an absolute new directory");
  }
  if (existsSync(destination)) fail("destination must be a new directory");
  if (!TIMESTAMP_DIRECTORY_PATTERN.test(path.basename(destination))) {
    fail("destination must use a filesystem-safe ISO UTC timestamp name");
  }
  if (!(now instanceof Date) || Number.isNaN(now.valueOf()))
    fail("now must be a valid Date");
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
  for (const [name, value] of Object.entries({
    provider,
    model,
    effort,
    seed,
  })) {
    if (typeof value !== "string" || value.length === 0)
      fail(`${name} must be nonempty`);
  }
  if (typeof prepareSession !== "function")
    fail("prepareSession must be a function");

  const capabilityReconciliation = reconcileEvaluationCapabilities({
    suite: "defining-concepts",
    contract: capabilityContract,
    cases,
    arms,
    skillBundles: {
      "current-skill": currentBundle,
      "candidate-skill": candidateBundle,
    },
    providerResolution,
  });
  assertCapabilityReconciliation(capabilityReconciliation);

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
        path.join(
          staging,
          "cases",
          `case-${String(evaluationCase.id).padStart(2, "0")}.json`,
        ),
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
    writeCanonicalExclusive(
      path.join(staging, "capability-reconciliation.json"),
      capabilityReconciliation,
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
          capabilityReconciliation,
          sessionDirectory,
        }),
        cell,
        capabilityReconciliation,
      );
      const packetPath = path.join(sessionDirectory, "packet.json");
      if (!existsSync(packetPath))
        writeCanonicalExclusive(packetPath, prepared);
      else if (
        !canonicalJsonBytes(readJson(packetPath, "prepared packet")).equals(
          canonicalJsonBytes(prepared),
        )
      ) {
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
        capabilityReconciliationSha256: capabilityReconciliation.receiptSha256,
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
      schemaVersion: 3,
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
      capabilityReconciliation: {
        relativePath: "capability-reconciliation.json",
        receiptSha256: capabilityReconciliation.receiptSha256,
      },
      skillBundles: {
        currentSkill: {
          relativePath: "bundles/current-skill.json",
          aggregateSha256: currentBundle.aggregateSha256,
          source: currentBundle.source,
          files: currentBundle.files.map(
            ({ path: filePath, byteLength, sha256 }) => ({
              path: filePath,
              byteLength,
              sha256,
            }),
          ),
        },
        candidateSkill: {
          relativePath: "bundles/candidate-skill.json",
          aggregateSha256: candidateBundle.aggregateSha256,
          source: candidateBundle.source,
          files: candidateBundle.files.map(
            ({ path: filePath, byteLength, sha256 }) => ({
              path: filePath,
              byteLength,
              sha256,
            }),
          ),
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
        required_capabilities: evaluationCase.required_capabilities,
        qualitative_dimensions: evaluationCase.qualitative_dimensions,
        expectations: gradingExpectations(evaluationCase),
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

function expectedAuthorization(manifest, session) {
  return {
    schemaVersion: 1,
    decision: "authorized",
    statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
    allowExternalModel: true,
    provider: manifest.protocol.provider,
    model: manifest.protocol.model,
    effort: manifest.protocol.effort,
    transmissionSha256: session.transmissionSha256,
  };
}

function assertAuthorization(authorization, manifest, session) {
  const expected = expectedAuthorization(manifest, session);
  if (!canonicalJsonBytes(authorization).equals(canonicalJsonBytes(expected))) {
    fail(
      `authorization for ${session.blindAlias} does not match its exact transmission`,
    );
  }
}

function campaignManifestSha256(manifest) {
  return sha256Hex(canonicalJsonBytes(manifest));
}

function assertCampaignCapabilityReconciliation(campaignDirectory, manifest) {
  const binding = manifest.capabilityReconciliation;
  if (
    binding?.relativePath !== "capability-reconciliation.json" ||
    !SHA256_PATTERN.test(binding?.receiptSha256 ?? "")
  ) {
    fail("campaign capability reconciliation binding is invalid");
  }
  const reconciliation = readJson(
    path.join(campaignDirectory, binding.relativePath),
    "campaign capability reconciliation",
  );
  assertCapabilityReconciliation(reconciliation);
  if (
    reconciliation.receiptSha256 !== binding.receiptSha256 ||
    reconciliation.receipt.suite !== manifest.suite ||
    reconciliation.receipt.providerResolution?.provider !==
      manifest.protocol.provider ||
    !canonicalJsonBytes(reconciliation.receipt.arms).equals(
      canonicalJsonBytes(manifest.protocol.arms),
    ) ||
    !canonicalJsonBytes(reconciliation.receipt.selectedCaseIds).equals(
      canonicalJsonBytes(
        [...manifest.protocol.caseIds].sort((left, right) => left - right),
      ),
    )
  ) {
    fail("campaign capability reconciliation does not match the manifest");
  }
  const caseRequirements = new Map(
    reconciliation.receipt.caseRequirements?.map(({ caseId, capabilities }) => [
      caseId,
      capabilities,
    ]) ?? [],
  );
  if (
    !Array.isArray(manifest.caseRecords) ||
    manifest.caseRecords.length !== manifest.protocol.caseIds.length ||
    manifest.caseRecords.some(
      (record) =>
        !caseRequirements.has(record.id) ||
        !canonicalJsonBytes(record.required_capabilities).equals(
          canonicalJsonBytes(caseRequirements.get(record.id)),
        ),
    ) ||
    manifest.sessions.some(
      (session) =>
        session.capabilityReconciliationSha256 !== binding.receiptSha256,
    )
  ) {
    fail("campaign capability requirements do not match the manifest");
  }
  return reconciliation;
}

function selectedPreflightSession(manifest) {
  if (!Array.isArray(manifest.sessions)) {
    fail("campaign manifest sessions must be an array");
  }
  const candidates = manifest.sessions.filter(({ sequence }) => sequence === 1);
  if (candidates.length !== 1) {
    fail("campaign must contain exactly one sequence-1 preflight session");
  }
  const session = candidates[0];
  if (
    session.provider !== manifest.protocol.provider ||
    session.model !== manifest.protocol.model ||
    session.effort !== manifest.protocol.effort ||
    session.capabilityReconciliationSha256 !==
      manifest.capabilityReconciliation?.receiptSha256 ||
    !SHA256_PATTERN.test(session.transmissionSha256 ?? "")
  ) {
    fail("campaign preflight session does not match the campaign protocol");
  }
  return session;
}

function preflightSessionBinding(session) {
  return {
    blindAlias: session.blindAlias,
    sequence: session.sequence,
    transmissionSha256: session.transmissionSha256,
    provider: session.provider,
    model: session.model,
    effort: session.effort,
    capabilityReconciliationSha256: session.capabilityReconciliationSha256,
  };
}

function failedCampaignPreflight(error, modelTurns = null) {
  return {
    schemaVersion: 1,
    status: "failed",
    failureClass: "protocol-failed",
    error: {
      code: "CAMPAIGN_PREFLIGHT_PROTOCOL_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
    modelTurns,
  };
}

function normalizeCampaignPreflightResult(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("campaign preflight returned a malformed result");
  }
  if (value.schemaVersion !== 1) {
    fail("campaign preflight result must use schema version 1");
  }
  if (!new Set(["completed", "failed"]).has(value.status)) {
    fail("campaign preflight result status must be completed or failed");
  }
  if (value.modelTurns !== 0) {
    fail("campaign preflight must report exactly zero model turns");
  }
  if (
    value.status === "completed" &&
    (value.failureClass !== null || value.error !== null)
  ) {
    fail("completed campaign preflight cannot report an error");
  }
  return canonicalRecord(value);
}

export function preflightPreparedCampaign({
  campaignDirectory,
  preflightSession,
}) {
  const manifest = readJson(
    path.join(campaignDirectory, "manifest.json"),
    "campaign manifest",
  );
  if (manifest.schemaVersion !== 3 || manifest.state !== "prepared") {
    fail("campaign is not in the prepared state");
  }
  assertCampaignCapabilityReconciliation(campaignDirectory, manifest);
  if (manifest.protocol.provider !== "openai") {
    fail("campaign zero-turn preflight supports only OpenAI");
  }
  if (
    existsSync(path.join(campaignDirectory, "executed.json")) ||
    existsSync(path.join(campaignDirectory, "execution-start.json"))
  ) {
    fail("campaigns with execution state cannot be preflighted");
  }
  const target = path.join(campaignDirectory, "preflight.json");
  if (existsSync(target)) {
    fail("campaign preflight already exists and cannot be overwritten");
  }
  if (typeof preflightSession !== "function") {
    fail("preflightSession must be a function");
  }
  const session = selectedPreflightSession(manifest);
  let candidate;
  let result;
  try {
    candidate = preflightSession(deepFreeze(canonicalRecord(session)));
    result = normalizeCampaignPreflightResult(candidate);
  } catch (error) {
    result = failedCampaignPreflight(
      error,
      Number.isSafeInteger(candidate?.modelTurns) && candidate.modelTurns >= 0
        ? candidate.modelTurns
        : null,
    );
  }
  const record = {
    schemaVersion: 1,
    state: "preflighted",
    campaignManifestSha256: campaignManifestSha256(manifest),
    capabilityReconciliationSha256:
      manifest.capabilityReconciliation.receiptSha256,
    session: preflightSessionBinding(session),
    status: result.status,
    modelTurns: result.modelTurns,
    failureClass: result.failureClass ?? null,
    error: result.error ?? null,
    result,
  };
  writeCanonicalExclusive(target, record);
  return deepFreeze(canonicalRecord(record));
}

function assertSuccessfulCampaignPreflight(campaignDirectory, manifest) {
  const record = readJson(
    path.join(campaignDirectory, "preflight.json"),
    "campaign preflight",
  );
  const session = selectedPreflightSession(manifest);
  if (
    record.schemaVersion !== 1 ||
    record.state !== "preflighted" ||
    record.campaignManifestSha256 !== campaignManifestSha256(manifest) ||
    record.capabilityReconciliationSha256 !==
      manifest.capabilityReconciliation?.receiptSha256 ||
    !canonicalJsonBytes(record.session).equals(
      canonicalJsonBytes(preflightSessionBinding(session)),
    )
  ) {
    fail("campaign preflight does not match the prepared manifest");
  }
  if (
    record.status !== "completed" ||
    record.modelTurns !== 0 ||
    record.failureClass !== null ||
    record.error !== null ||
    record.result?.status !== "completed" ||
    record.result?.modelTurns !== 0
  ) {
    fail("campaign does not have a successful zero-turn preflight");
  }
  return record;
}

function readCanonicalJson(target, label) {
  let bytes;
  let value;
  try {
    bytes = readFileSync(target);
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
  if (!bytes.equals(canonicalJsonBytes(value))) {
    fail(`${label} must use canonical JSON bytes`);
  }
  return value;
}

function campaignAuthorizationSet({ authorizationDirectory, manifest }) {
  const authorizations = new Map();
  for (const session of manifest.sessions) {
    const authorization = readJson(
      path.join(authorizationDirectory, `${session.blindAlias}.json`),
      `authorization for ${session.blindAlias}`,
    );
    assertAuthorization(authorization, manifest, session);
    authorizations.set(session.blindAlias, canonicalRecord(authorization));
  }
  const authorizationSet = {
    schemaVersion: 1,
    sessions: manifest.sessions.map((session) => ({
      blindAlias: session.blindAlias,
      transmissionSha256: session.transmissionSha256,
      authorizationSha256: sha256Hex(
        canonicalJsonBytes(authorizations.get(session.blindAlias)),
      ),
    })),
  };
  return {
    authorizations,
    authorizationSet,
    authorizationSetSha256: sha256Hex(canonicalJsonBytes(authorizationSet)),
  };
}

function assertExecutionStartBinding(executionStart, manifest) {
  const authorizationSessions = executionStart.authorizationSet?.sessions;
  if (
    executionStart.schemaVersion !== 2 ||
    executionStart.state !== "execution-started" ||
    typeof executionStart.startedAt !== "string" ||
    Number.isNaN(Date.parse(executionStart.startedAt)) ||
    executionStart.campaignManifestSha256 !==
      campaignManifestSha256(manifest) ||
    executionStart.capabilityReconciliationSha256 !==
      manifest.capabilityReconciliation.receiptSha256 ||
    executionStart.authorizationSet?.schemaVersion !== 1 ||
    !Array.isArray(authorizationSessions) ||
    authorizationSessions.length !== manifest.sessions.length ||
    executionStart.authorizationSetSha256 !==
      sha256Hex(canonicalJsonBytes(executionStart.authorizationSet))
  ) {
    fail("campaign execution start does not match its manifest");
  }
  for (const [index, session] of manifest.sessions.entries()) {
    const retained = authorizationSessions[index];
    if (
      retained?.blindAlias !== session.blindAlias ||
      retained?.transmissionSha256 !== session.transmissionSha256 ||
      !SHA256_PATTERN.test(retained?.authorizationSha256 ?? "")
    ) {
      fail("campaign execution authorization set does not match its sessions");
    }
  }
  return executionStart;
}

function openCampaignExecution({
  campaignDirectory,
  manifest,
  authorizationSet,
  authorizationSetSha256,
  now,
}) {
  const target = path.join(campaignDirectory, "execution-start.json");
  const identity = {
    schemaVersion: 2,
    state: "execution-started",
    campaignManifestSha256: campaignManifestSha256(manifest),
    capabilityReconciliationSha256:
      manifest.capabilityReconciliation.receiptSha256,
    authorizationSet,
    authorizationSetSha256,
  };
  if (!existsSync(target)) {
    const executionStart = { ...identity, startedAt: now.toISOString() };
    writeCanonicalExclusive(target, executionStart);
    return executionStart;
  }
  const executionStart = readCanonicalJson(target, "campaign execution start");
  if (executionStart.schemaVersion !== 2) {
    fail("historical campaign execution state cannot be continued in place");
  }
  assertExecutionStartBinding(executionStart, manifest);
  const retainedIdentity = { ...executionStart };
  delete retainedIdentity.startedAt;
  if (
    typeof executionStart.startedAt !== "string" ||
    Number.isNaN(Date.parse(executionStart.startedAt)) ||
    !canonicalJsonBytes(retainedIdentity).equals(canonicalJsonBytes(identity))
  ) {
    fail("campaign execution start does not match the exact authorization set");
  }
  return executionStart;
}

function campaignSessionDirectory(campaignDirectory, session) {
  return path.join(
    campaignDirectory,
    ...session.relativeSessionPath.split("/"),
    "prepared",
  );
}

function sessionOutcomeTarget(campaignDirectory, session) {
  return path.join(
    campaignDirectory,
    "execution",
    "session-outcomes",
    `${session.blindAlias}.json`,
  );
}

function expectedAuthorizationConsumption(manifest, session) {
  return {
    schemaVersion: 1,
    provider: manifest.protocol.provider,
    model: manifest.protocol.model,
    effort: manifest.protocol.effort,
    transmissionSha256: session.transmissionSha256,
  };
}

function inspectPreparedSessionEvidence({
  campaignDirectory,
  manifest,
  session,
  authorization,
}) {
  const preparedSession = campaignSessionDirectory(campaignDirectory, session);
  if (!existsSync(preparedSession)) return { state: "pending" };
  const authorizationPath = path.join(preparedSession, "authorization.json");
  const consumptionPath = path.join(preparedSession, "attempt.json");
  const resultPath = path.join(preparedSession, "run.json");
  const metricsPath = path.join(preparedSession, "metrics.json");
  const timingPath = path.join(preparedSession, "timing.json");

  if (existsSync(authorizationPath)) {
    const retainedAuthorization = readJson(
      authorizationPath,
      `retained authorization for ${session.blindAlias}`,
    );
    assertAuthorization(retainedAuthorization, manifest, session);
    if (
      !canonicalJsonBytes(retainedAuthorization).equals(
        canonicalJsonBytes(authorization),
      )
    ) {
      fail(`retained authorization for ${session.blindAlias} changed`);
    }
  }

  let authorizationConsumptionSha256 = null;
  if (existsSync(consumptionPath)) {
    const consumptionBytes = readFileSync(consumptionPath);
    const consumption = readJson(
      consumptionPath,
      `authorization consumption for ${session.blindAlias}`,
    );
    if (
      !canonicalJsonBytes(consumption).equals(
        canonicalJsonBytes(expectedAuthorizationConsumption(manifest, session)),
      )
    ) {
      fail(`authorization consumption for ${session.blindAlias} is invalid`);
    }
    authorizationConsumptionSha256 = sha256Hex(consumptionBytes);
  }

  if (existsSync(resultPath)) {
    const resultBytes = readFileSync(resultPath);
    const retainedRun = readJson(
      resultPath,
      `session result for ${session.blindAlias}`,
    );
    if (retainedRun.transmissionSha256 !== session.transmissionSha256) {
      fail(`session result for ${session.blindAlias} changed transmission`);
    }
    return {
      state: "terminal",
      result: readPreparedSessionResult(preparedSession),
      evidence: {
        source: "prepared-session-result",
        terminalResultSha256: sha256Hex(resultBytes),
        authorizationConsumptionSha256,
      },
    };
  }

  if (authorizationConsumptionSha256 !== null) {
    return {
      state: "consumed-without-terminal-result",
      evidence: {
        source: "authorization-consumption",
        terminalResultSha256: null,
        authorizationConsumptionSha256,
      },
    };
  }
  if (existsSync(metricsPath) || existsSync(timingPath)) {
    fail(
      `unconsumed session ${session.blindAlias} has incomplete terminal evidence`,
    );
  }
  return { state: "pending" };
}

function normalizeSessionResult(result, session) {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    fail(`execution for ${session.blindAlias} returned a malformed result`);
  }
  if (!new Set(["completed", "failed"]).has(result.status)) {
    fail(`execution for ${session.blindAlias} returned an unsupported status`);
  }
  const finalAnswer = result.finalAnswer ?? null;
  if (
    result.status === "completed" &&
    (typeof finalAnswer !== "string" || finalAnswer.trim().length === 0)
  ) {
    fail(`completed execution for ${session.blindAlias} lacks a final answer`);
  }
  return {
    status: result.status,
    disposition: result.status === "completed" ? "valid" : "invalid",
    failureClass:
      result.status === "completed"
        ? null
        : (result.failureClass ?? "execution-failed"),
    error: result.status === "completed" ? null : (result.error ?? null),
    finalAnswer,
    transcript: result.transcript ?? null,
    tokens: optionalNonnegativeNumber(
      result.tokens ?? null,
      `tokens for ${session.blindAlias}`,
    ),
    durationMs: optionalNonnegativeNumber(
      result.durationMs ?? null,
      `duration for ${session.blindAlias}`,
    ),
  };
}

function buildSessionOutcome({
  manifest,
  session,
  executionStartSha256,
  authorizationSetSha256,
  result,
  evidence,
}) {
  const normalized = normalizeSessionResult(result, session);
  return {
    schemaVersion: 2,
    state: "session-outcome",
    campaignManifestSha256: campaignManifestSha256(manifest),
    capabilityReconciliationSha256:
      manifest.capabilityReconciliation.receiptSha256,
    executionStartSha256,
    authorizationSetSha256,
    blindAlias: session.blindAlias,
    sequence: session.sequence,
    caseId: session.caseId,
    transmissionSha256: session.transmissionSha256,
    ...normalized,
    evidence,
  };
}

function buildIndeterminateOutcome({
  manifest,
  session,
  executionStartSha256,
  authorizationSetSha256,
  evidence,
}) {
  return {
    schemaVersion: 2,
    state: "session-outcome",
    campaignManifestSha256: campaignManifestSha256(manifest),
    capabilityReconciliationSha256:
      manifest.capabilityReconciliation.receiptSha256,
    executionStartSha256,
    authorizationSetSha256,
    blindAlias: session.blindAlias,
    sequence: session.sequence,
    caseId: session.caseId,
    transmissionSha256: session.transmissionSha256,
    status: "indeterminate",
    disposition: "indeterminate",
    failureClass: "terminal-result-missing",
    error: {
      name: "Error",
      code: "AUTHORIZATION_CONSUMED_WITHOUT_TERMINAL_RESULT",
      message:
        "authorization was consumed but terminal session evidence is absent",
    },
    finalAnswer: null,
    transcript: null,
    tokens: null,
    durationMs: null,
    evidence,
  };
}

function assertSessionOutcome({
  outcome,
  manifest,
  session,
  executionStartSha256,
  authorizationSetSha256,
}) {
  if (
    outcome.schemaVersion !== 2 ||
    outcome.state !== "session-outcome" ||
    outcome.campaignManifestSha256 !== campaignManifestSha256(manifest) ||
    outcome.capabilityReconciliationSha256 !==
      manifest.capabilityReconciliation.receiptSha256 ||
    outcome.executionStartSha256 !== executionStartSha256 ||
    outcome.authorizationSetSha256 !== authorizationSetSha256 ||
    outcome.blindAlias !== session.blindAlias ||
    outcome.sequence !== session.sequence ||
    outcome.caseId !== session.caseId ||
    outcome.transmissionSha256 !== session.transmissionSha256
  ) {
    fail(
      `session outcome for ${session.blindAlias} does not match its campaign`,
    );
  }
  if (!new Set(["completed", "failed", "indeterminate"]).has(outcome.status)) {
    fail(`session outcome for ${session.blindAlias} has an invalid status`);
  }
  const expectedDisposition =
    outcome.status === "completed"
      ? "valid"
      : outcome.status === "failed"
        ? "invalid"
        : "indeterminate";
  if (outcome.disposition !== expectedDisposition) {
    fail(
      `session outcome for ${session.blindAlias} has an invalid disposition`,
    );
  }
  if (
    outcome.status === "completed" &&
    (typeof outcome.finalAnswer !== "string" ||
      outcome.finalAnswer.trim().length === 0)
  ) {
    fail(`completed session outcome for ${session.blindAlias} lacks an answer`);
  }
  optionalNonnegativeNumber(
    outcome.tokens,
    `outcome tokens for ${session.blindAlias}`,
  );
  optionalNonnegativeNumber(
    outcome.durationMs,
    `outcome duration for ${session.blindAlias}`,
  );
  if (
    outcome.evidence === null ||
    typeof outcome.evidence !== "object" ||
    Array.isArray(outcome.evidence) ||
    !new Set([
      "executor-result",
      "prepared-session-result",
      "authorization-consumption",
    ]).has(outcome.evidence.source) ||
    !["terminalResultSha256", "authorizationConsumptionSha256"].every(
      (name) =>
        outcome.evidence[name] === null ||
        SHA256_PATTERN.test(outcome.evidence[name]),
    )
  ) {
    fail(`session outcome for ${session.blindAlias} has invalid evidence`);
  }
  return outcome;
}

function readSessionOutcome({
  campaignDirectory,
  manifest,
  session,
  executionStartSha256,
  authorizationSetSha256,
}) {
  const target = sessionOutcomeTarget(campaignDirectory, session);
  if (!existsSync(target)) return null;
  const outcome = assertSessionOutcome({
    outcome: readCanonicalJson(target, `session outcome ${session.blindAlias}`),
    manifest,
    session,
    executionStartSha256,
    authorizationSetSha256,
  });
  if (outcome.evidence.source === "executor-result") return outcome;
  const retained = inspectPreparedSessionEvidence({
    campaignDirectory,
    manifest,
    session,
    authorization: expectedAuthorization(manifest, session),
  });
  if (outcome.evidence.source === "prepared-session-result") {
    if (
      retained.state !== "terminal" ||
      !canonicalJsonBytes(retained.evidence).equals(
        canonicalJsonBytes(outcome.evidence),
      )
    ) {
      fail(`retained evidence for ${session.blindAlias} changed after outcome`);
    }
    const expectedResult = normalizeSessionResult(retained.result, session);
    const outcomeResult = {
      status: outcome.status,
      disposition: outcome.disposition,
      failureClass: outcome.failureClass,
      error: outcome.error,
      finalAnswer: outcome.finalAnswer,
      transcript: outcome.transcript,
      tokens: outcome.tokens,
      durationMs: outcome.durationMs,
    };
    if (
      !canonicalJsonBytes(expectedResult).equals(
        canonicalJsonBytes(outcomeResult),
      )
    ) {
      fail(`session outcome for ${session.blindAlias} changed retained result`);
    }
  } else if (
    retained.state !== "consumed-without-terminal-result" ||
    !canonicalJsonBytes(retained.evidence).equals(
      canonicalJsonBytes(outcome.evidence),
    )
  ) {
    fail(`retained consumption evidence for ${session.blindAlias} changed`);
  }
  return outcome;
}

function writeSessionOutcome(campaignDirectory, session, outcome) {
  writeCanonicalExclusive(
    sessionOutcomeTarget(campaignDirectory, session),
    outcome,
  );
  return outcome;
}

function finalizedCampaignExecution({
  campaignDirectory,
  manifest,
  outcomes,
  executionStartSha256,
  authorizationSetSha256,
}) {
  if (outcomes.size !== manifest.sessions.length) return null;
  const record = {
    schemaVersion: 2,
    state: "executed",
    campaignManifestSha256: campaignManifestSha256(manifest),
    capabilityReconciliationSha256:
      manifest.capabilityReconciliation.receiptSha256,
    executionStartSha256,
    authorizationSetSha256,
    sessions: manifest.sessions.map((session) =>
      outcomes.get(session.blindAlias),
    ),
  };
  const target = path.join(campaignDirectory, "executed.json");
  if (existsSync(target)) {
    const retained = readCanonicalJson(target, "executed campaign");
    if (!canonicalJsonBytes(retained).equals(canonicalJsonBytes(record))) {
      fail("executed campaign does not match its durable session outcomes");
    }
    return retained;
  }
  writeCanonicalExclusive(target, record);
  return record;
}

export function inspectCampaignExecution({ campaignDirectory }) {
  const manifest = readJson(
    path.join(campaignDirectory, "manifest.json"),
    "campaign manifest",
  );
  if (manifest.schemaVersion !== 3 || manifest.state !== "prepared") {
    fail("campaign is not in the prepared state");
  }
  assertCampaignCapabilityReconciliation(campaignDirectory, manifest);
  const counts = {
    total: manifest.sessions.length,
    pending: 0,
    completed: 0,
    failed: 0,
    indeterminate: 0,
  };
  const integrityBlockers = [];
  const startPath = path.join(campaignDirectory, "execution-start.json");
  const failedPath = path.join(campaignDirectory, "execution-failed.json");
  const executedPath = path.join(campaignDirectory, "executed.json");
  if (!existsSync(startPath)) {
    counts.pending = counts.total;
    if (existsSync(failedPath) || existsSync(executedPath)) {
      integrityBlockers.push(
        "campaign has terminal execution state without execution-start.json",
      );
    }
    const preflightPath = path.join(campaignDirectory, "preflight.json");
    const preflight = existsSync(preflightPath)
      ? readJson(preflightPath, "campaign preflight")
      : null;
    return deepFreeze({
      schemaVersion: 1,
      state:
        preflight?.status === "completed"
          ? "preflighted"
          : preflight?.status === "failed"
            ? "preflight-failed"
            : "prepared",
      campaignManifestSha256: campaignManifestSha256(manifest),
      executionStartSha256: null,
      counts,
      reconciliationRequired: 0,
      finalizationRequired: false,
      continuationPermitted: false,
      providerLaunchesRemaining: counts.pending,
      integrityBlockers,
    });
  }

  let executionStart;
  try {
    executionStart = readCanonicalJson(startPath, "campaign execution start");
    if (executionStart.schemaVersion !== 2) {
      fail("historical campaign execution state is non-resumable");
    }
    assertExecutionStartBinding(executionStart, manifest);
  } catch (error) {
    counts.pending = counts.total;
    integrityBlockers.push(error.message);
    return deepFreeze({
      schemaVersion: 1,
      state: "execution-blocked",
      campaignManifestSha256: campaignManifestSha256(manifest),
      executionStartSha256: null,
      counts,
      reconciliationRequired: 0,
      finalizationRequired: false,
      continuationPermitted: false,
      providerLaunchesRemaining: 0,
      integrityBlockers,
    });
  }
  const executionStartSha256 = sha256Hex(canonicalJsonBytes(executionStart));
  const authorizationSetSha256 = executionStart.authorizationSetSha256;
  const outcomes = new Map();
  let reconciliationRequired = 0;
  for (const session of manifest.sessions) {
    try {
      const outcome = readSessionOutcome({
        campaignDirectory,
        manifest,
        session,
        executionStartSha256,
        authorizationSetSha256,
      });
      if (outcome !== null) {
        outcomes.set(session.blindAlias, outcome);
        counts[outcome.status] += 1;
        continue;
      }
      const evidence = inspectPreparedSessionEvidence({
        campaignDirectory,
        manifest,
        session,
        authorization: expectedAuthorization(manifest, session),
      });
      if (evidence.state === "terminal") {
        counts[evidence.result.status] += 1;
        reconciliationRequired += 1;
      } else if (evidence.state === "consumed-without-terminal-result") {
        counts.indeterminate += 1;
        reconciliationRequired += 1;
      } else {
        counts.pending += 1;
      }
    } catch (error) {
      counts.pending += 1;
      integrityBlockers.push(`${session.blindAlias}: ${error.message}`);
    }
  }

  let state = "execution-in-progress";
  if (existsSync(failedPath)) {
    integrityBlockers.push(
      "schema-version-1 execution-failed.json is historical and non-resumable",
    );
  }
  if (existsSync(executedPath)) {
    try {
      const retained = readCanonicalJson(executedPath, "executed campaign");
      const expected = finalizedCampaignExecution({
        campaignDirectory,
        manifest,
        outcomes,
        executionStartSha256,
        authorizationSetSha256,
      });
      if (
        expected === null ||
        !canonicalJsonBytes(retained).equals(canonicalJsonBytes(expected))
      ) {
        fail("executed campaign is not derived from all durable outcomes");
      }
      state = "executed";
    } catch (error) {
      integrityBlockers.push(error.message);
    }
  }
  if (integrityBlockers.length > 0) state = "execution-blocked";
  const finalizationRequired =
    !existsSync(executedPath) && outcomes.size === manifest.sessions.length;
  const continuationPermitted =
    integrityBlockers.length === 0 &&
    state !== "executed" &&
    (counts.pending > 0 || reconciliationRequired > 0 || finalizationRequired);
  return deepFreeze({
    schemaVersion: 1,
    state,
    campaignManifestSha256: campaignManifestSha256(manifest),
    executionStartSha256,
    counts,
    reconciliationRequired,
    finalizationRequired,
    continuationPermitted,
    providerLaunchesRemaining: counts.pending,
    integrityBlockers,
  });
}

export function runPreparedCampaign({
  campaignDirectory,
  authorizationDirectory,
  executeSession,
  now = new Date(),
}) {
  const manifest = readJson(
    path.join(campaignDirectory, "manifest.json"),
    "campaign manifest",
  );
  if (manifest.schemaVersion !== 3 || manifest.state !== "prepared") {
    fail("campaign is not in the prepared state");
  }
  assertCampaignCapabilityReconciliation(campaignDirectory, manifest);
  if (existsSync(path.join(campaignDirectory, "execution-failed.json"))) {
    fail("historical failed campaign execution cannot be continued in place");
  }
  if (
    existsSync(path.join(campaignDirectory, "executed.json")) &&
    !existsSync(path.join(campaignDirectory, "execution-start.json"))
  ) {
    fail("terminal campaign execution lacks its execution-start identity");
  }
  if (typeof executeSession !== "function") {
    fail("executeSession must be a function");
  }
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    fail("execution start time must be a valid Date");
  }
  if (manifest.protocol.provider === "openai") {
    assertSuccessfulCampaignPreflight(campaignDirectory, manifest);
  }
  const { authorizations, authorizationSet, authorizationSetSha256 } =
    campaignAuthorizationSet({ authorizationDirectory, manifest });
  const executionStart = openCampaignExecution({
    campaignDirectory,
    manifest,
    authorizationSet,
    authorizationSetSha256,
    now,
  });
  const executionStartSha256 = sha256Hex(canonicalJsonBytes(executionStart));
  const outcomes = new Map();

  if (existsSync(path.join(campaignDirectory, "executed.json"))) {
    for (const session of manifest.sessions) {
      const outcome = readSessionOutcome({
        campaignDirectory,
        manifest,
        session,
        executionStartSha256,
        authorizationSetSha256,
      });
      if (outcome === null) {
        fail(
          `executed campaign is missing session outcome ${session.blindAlias}`,
        );
      }
      outcomes.set(session.blindAlias, outcome);
    }
    const completed = finalizedCampaignExecution({
      campaignDirectory,
      manifest,
      outcomes,
      executionStartSha256,
      authorizationSetSha256,
    });
    return deepFreeze(canonicalRecord(completed));
  }

  function retainOutcome(session, outcome) {
    assertSessionOutcome({
      outcome,
      manifest,
      session,
      executionStartSha256,
      authorizationSetSha256,
    });
    writeSessionOutcome(campaignDirectory, session, outcome);
    outcomes.set(session.blindAlias, outcome);
    finalizedCampaignExecution({
      campaignDirectory,
      manifest,
      outcomes,
      executionStartSha256,
      authorizationSetSha256,
    });
    return outcome;
  }

  for (const session of manifest.sessions) {
    const existing = readSessionOutcome({
      campaignDirectory,
      manifest,
      session,
      executionStartSha256,
      authorizationSetSha256,
    });
    if (existing !== null) {
      outcomes.set(session.blindAlias, existing);
      continue;
    }

    const authorization = authorizations.get(session.blindAlias);
    const before = inspectPreparedSessionEvidence({
      campaignDirectory,
      manifest,
      session,
      authorization,
    });
    if (before.state === "terminal") {
      const outcome = retainOutcome(
        session,
        buildSessionOutcome({
          manifest,
          session,
          executionStartSha256,
          authorizationSetSha256,
          result: before.result,
          evidence: before.evidence,
        }),
      );
      if (outcome.status !== "completed") {
        fail(
          `campaign session ${session.blindAlias} retained a failed terminal result`,
        );
      }
      continue;
    }
    if (before.state === "consumed-without-terminal-result") {
      retainOutcome(
        session,
        buildIndeterminateOutcome({
          manifest,
          session,
          executionStartSha256,
          authorizationSetSha256,
          evidence: before.evidence,
        }),
      );
      fail(
        `campaign session ${session.blindAlias} is indeterminate because authorization consumption has no terminal evidence`,
      );
    }

    let callbackResult;
    try {
      callbackResult = executeSession(
        deepFreeze(canonicalRecord(session)),
        authorization,
      );
    } catch (error) {
      const afterError = inspectPreparedSessionEvidence({
        campaignDirectory,
        manifest,
        session,
        authorization,
      });
      if (afterError.state === "terminal") {
        retainOutcome(
          session,
          buildSessionOutcome({
            manifest,
            session,
            executionStartSha256,
            authorizationSetSha256,
            result: afterError.result,
            evidence: afterError.evidence,
          }),
        );
      } else if (afterError.state === "consumed-without-terminal-result") {
        retainOutcome(
          session,
          buildIndeterminateOutcome({
            manifest,
            session,
            executionStartSha256,
            authorizationSetSha256,
            evidence: afterError.evidence,
          }),
        );
      }
      throw error;
    }

    const after = inspectPreparedSessionEvidence({
      campaignDirectory,
      manifest,
      session,
      authorization,
    });
    let result = callbackResult;
    let evidence = {
      source: "executor-result",
      terminalResultSha256: null,
      authorizationConsumptionSha256: null,
    };
    if (after.state === "terminal") {
      result = after.result;
      evidence = after.evidence;
    } else if (after.state === "consumed-without-terminal-result") {
      retainOutcome(
        session,
        buildIndeterminateOutcome({
          manifest,
          session,
          executionStartSha256,
          authorizationSetSha256,
          evidence: after.evidence,
        }),
      );
      fail(
        `campaign session ${session.blindAlias} consumed authorization without terminal evidence`,
      );
    }
    const outcome = retainOutcome(
      session,
      buildSessionOutcome({
        manifest,
        session,
        executionStartSha256,
        authorizationSetSha256,
        result,
        evidence,
      }),
    );
    if (outcome.status !== "completed") {
      fail(
        `campaign execution failed for ${session.blindAlias}: ${outcome.failureClass}`,
      );
    }
  }

  const completed = finalizedCampaignExecution({
    campaignDirectory,
    manifest,
    outcomes,
    executionStartSha256,
    authorizationSetSha256,
  });
  if (completed === null) {
    fail("campaign execution is incomplete");
  }
  return deepFreeze(canonicalRecord(completed));
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
  const manifest = readJson(
    path.join(campaignDirectory, "manifest.json"),
    "campaign manifest",
  );
  const executed = readJson(
    path.join(campaignDirectory, "executed.json"),
    "executed campaign",
  );
  if (manifest.schemaVersion !== 3 || executed.state !== "executed") {
    fail("campaign must be executed before grading preparation");
  }
  assertCampaignCapabilityReconciliation(campaignDirectory, manifest);
  if (
    executed.campaignManifestSha256 !== sha256Hex(canonicalJsonBytes(manifest))
  ) {
    fail("executed campaign does not match its manifest");
  }
  const expectedAliases = new Set(
    manifest.sessions.map(({ blindAlias }) => blindAlias),
  );
  if (
    !Array.isArray(executed.sessions) ||
    executed.sessions.length !== manifest.sessions.length ||
    new Set(executed.sessions.map(({ blindAlias }) => blindAlias)).size !==
      expectedAliases.size ||
    executed.sessions.some(({ blindAlias }) => !expectedAliases.has(blindAlias))
  ) {
    fail(
      "executed campaign does not contain one result for every prepared session",
    );
  }
  for (const result of executed.sessions) {
    if (result.status !== "completed" || result.disposition !== "valid") {
      fail(`invalid session ${result.blindAlias} cannot enter grading`);
    }
    if (
      typeof result.finalAnswer !== "string" ||
      result.finalAnswer.trim().length === 0 ||
      result.transcript === null ||
      result.transcript === undefined
    ) {
      fail(`session ${result.blindAlias} lacks gradable output evidence`);
    }
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
        manifest.caseSnapshots.find(({ id }) => id === session.caseId)
          .relativePath,
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
      path.join(
        campaignDirectory,
        "grading",
        "critical",
        `${session.blindAlias}.json`,
      ),
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
    if (selected.length !== 2)
      fail(`case ${caseId} lacks a current/candidate pair`);
    const flip =
      Number.parseInt(
        stableDigest(manifest.blindMappingSealSha256, `pair-${caseId}`).slice(
          0,
          2,
        ),
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
      path.join(
        campaignDirectory,
        "grading",
        "pairwise",
        `${packet.packetId}.json`,
      ),
      packet,
    );
  }
  const mappingRecord = { schemaVersion: 1, pairs: mapping };
  const pairwiseMappingSealSha256 = sha256Hex(
    canonicalJsonBytes(mappingRecord),
  );
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

function isNonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function assertExactStringIds(actual, expected, label) {
  if (
    !Array.isArray(actual) ||
    actual.some((id) => !isNonemptyString(id)) ||
    new Set(actual).size !== actual.length ||
    actual.length !== expected.length ||
    [...actual].sort().join("\u0000") !== [...expected].sort().join("\u0000")
  ) {
    fail(`${label} must match the frozen campaign exactly`);
  }
}

function assertCitedJudgment(record, label) {
  if (
    record === null ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    !isNonemptyString(record.excerpt) ||
    !isNonemptyString(record.reason)
  ) {
    fail(`${label} must include a nonempty excerpt and reason`);
  }
}

function validateSessionGrade(grade, session, evaluationCase) {
  if (grade === null || typeof grade !== "object" || Array.isArray(grade)) {
    fail(`grade for ${session.blindAlias} is malformed`);
  }
  const expectedCritical = (evaluationCase.expectations ?? [])
    .filter(({ critical }) => critical === true)
    .map(({ id }) => id);
  assertExactStringIds(
    grade.critical?.map(({ expectationId }) => expectationId),
    expectedCritical,
    `critical expectations for ${session.blindAlias}`,
  );
  for (const judgment of grade.critical) {
    assertCitedJudgment(
      judgment,
      `critical expectation ${judgment.expectationId}`,
    );
    if (typeof judgment.passed !== "boolean") {
      fail(
        `critical expectation ${judgment.expectationId} must have a boolean outcome`,
      );
    }
  }

  const expectedDimensions = evaluationCase.qualitative_dimensions ?? [];
  assertExactStringIds(
    grade.dimensions?.map(({ id }) => id),
    expectedDimensions,
    `qualitative dimensions for ${session.blindAlias}`,
  );
  for (const judgment of grade.dimensions) {
    assertCitedJudgment(judgment, `qualitative dimension ${judgment.id}`);
    if (!isNonemptyString(judgment.rating)) {
      fail(`qualitative dimension ${judgment.id} must have a nonempty rating`);
    }
  }
  optionalNonnegativeNumber(grade.tokens ?? null, "grade token count");
  optionalNonnegativeNumber(grade.durationMs ?? null, "grade duration");
}

function validatePairwiseGrades(pairwiseGrades, caseIds) {
  if (
    !Array.isArray(pairwiseGrades) ||
    pairwiseGrades.length !== caseIds.length ||
    new Set(pairwiseGrades.map(({ caseId }) => caseId)).size !==
      caseIds.length ||
    pairwiseGrades.some(({ caseId }) => !caseIds.includes(caseId))
  ) {
    fail("pairwise grades must contain one complete unique grade per case");
  }
  for (const grade of pairwiseGrades) {
    assertCitedJudgment(grade, `pairwise grade for case ${grade.caseId}`);
    if (!new Set(["candidate", "current", "tie"]).has(grade.outcome)) {
      fail(`pairwise outcome for case ${grade.caseId} is invalid`);
    }
  }
}

export function aggregateCampaignGrades({
  manifest,
  gradeRecords,
  pairwiseGrades,
  disagreements,
}) {
  if (
    manifest?.schemaVersion !== 3 ||
    manifest.protocol?.repetitionCount !== 1
  ) {
    fail("aggregate requires a current one-repetition campaign manifest");
  }
  if (
    !Array.isArray(gradeRecords) ||
    gradeRecords.length !== manifest.sessions.length ||
    new Set(gradeRecords.map(({ blindAlias }) => blindAlias)).size !==
      manifest.sessions.length
  ) {
    fail("grade records must provide one complete unique grade per session");
  }
  const knownAliases = new Set(
    manifest.sessions.map(({ blindAlias }) => blindAlias),
  );
  if (gradeRecords.some(({ blindAlias }) => !knownAliases.has(blindAlias))) {
    fail("grade records contain an unknown blind alias");
  }
  if (!Array.isArray(disagreements)) fail("disagreements must be an array");
  const sessionByAlias = new Map(
    manifest.sessions.map((session) => [session.blindAlias, session]),
  );
  const caseById = new Map(
    (manifest.caseRecords ?? []).map((evaluationCase) => [
      evaluationCase.id,
      evaluationCase,
    ]),
  );
  if (
    caseById.size !== manifest.protocol.caseIds.length ||
    manifest.protocol.caseIds.some((caseId) => !caseById.has(caseId))
  ) {
    fail("campaign manifest lacks complete frozen case grading metadata");
  }
  for (const grade of gradeRecords) {
    const session = sessionByAlias.get(grade.blindAlias);
    validateSessionGrade(grade, session, caseById.get(session.caseId));
  }
  validatePairwiseGrades(pairwiseGrades, manifest.protocol.caseIds);
  const criticalItems = gradeRecords.flatMap((grade) => grade.critical ?? []);
  const criticalFailed = criticalItems.filter(
    ({ passed }) => passed !== true,
  ).length;
  const pairwise = {
    candidateWins: pairwiseGrades.filter(
      ({ outcome }) => outcome === "candidate",
    ).length,
    currentWins: pairwiseGrades.filter(({ outcome }) => outcome === "current")
      .length,
    ties: pairwiseGrades.filter(({ outcome }) => outcome === "tie").length,
    total: pairwiseGrades.length,
  };
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
          session.arm === "candidate-skill" &&
          critical.some(({ passed }) => passed !== true),
      ),
    },
    dimensions: countGroups(
      gradeRecords.flatMap(({ dimensions = [] }) => dimensions),
      ({ id }) => [id],
    ),
    byCase: manifest.protocol.caseIds.map((caseId) => ({
      caseId,
      gradeCount: enriched.filter(({ session }) => session.caseId === caseId)
        .length,
    })),
    byProfile: countGroups(
      enriched,
      ({ session }) => caseMetadata(session.caseId).profiles ?? [],
    ),
    byResearchStratum: countGroups(
      enriched,
      ({ session }) => caseMetadata(session.caseId).research_strata ?? [],
    ),
    pairwise,
    disagreements: canonicalRecord(disagreements),
    usage: {
      totalTokens: gradeRecords.reduce(
        (sum, grade) => sum + (grade.tokens ?? 0),
        0,
      ),
      totalDurationMs: gradeRecords.reduce(
        (sum, grade) => sum + (grade.durationMs ?? 0),
        0,
      ),
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

const TRIAL_ARGUMENTS = Object.freeze({
  prepare: new Set([
    "--output-dir",
    "--case-id",
    "--skill-arm",
    "--trial-index",
    "--adapter",
    "--model",
    "--reasoning-effort",
    "--created-at",
    "--working-root",
    "--baseline-revision",
  ]),
  preflight: new Set(["--trial-dir"]),
  run: new Set([
    "--trial-dir",
    "--authorization-file",
    "--allow-external-model-call",
  ]),
  verify: new Set(["--trial-dir"]),
});

export function parseEvaluationRunnerCli(arguments_) {
  const command = arguments_[0];
  const subcommand = command === "trial" ? arguments_[1] : null;
  if (
    command === "trial" &&
    !new Set(["prepare", "preflight", "run", "verify"]).has(subcommand)
  ) {
    fail("second argument must be trial prepare, preflight, run, or verify");
  }
  const values = new Map();
  const repeated = new Map([
    ["--antigravity-prefix-arg", []],
    ["--claude-prefix-arg", []],
    ["--codex-prefix-arg", []],
  ]);
  const switches = new Set(["--allow-external-model-call"]);
  for (
    let index = command === "trial" ? 2 : 1;
    index < arguments_.length;
    index += 1
  ) {
    const name = arguments_[index];
    if (!name?.startsWith("--")) {
      fail("CLI arguments must use --name value pairs");
    }
    if (command === "trial" && !TRIAL_ARGUMENTS[subcommand].has(name)) {
      fail(`unsupported approved trial argument ${name}`);
    }
    if (switches.has(name)) {
      if (values.has(name)) fail(`duplicate CLI argument ${name}`);
      values.set(name, true);
      continue;
    }
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined)
      fail("CLI arguments must use --name value pairs");
    index += 1;
    if (repeated.has(name)) repeated.get(name).push(value);
    else if (values.has(name)) fail(`duplicate CLI argument ${name}`);
    else values.set(name, value);
  }
  return { command, subcommand, values, repeated };
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
      ...repeated
        .get("--codex-prefix-arg")
        .flatMap((item) => ["--codex-prefix-arg", item]),
      "--evaluation-homes-root",
      requireCli(values, "--evaluation-homes-root"),
    ];
  }
  if (provider === "claude") {
    return [
      "--claude-command",
      values.get("--claude-command") ?? "claude",
      ...repeated
        .get("--claude-prefix-arg")
        .flatMap((item) => ["--claude-prefix-arg", item]),
      "--max-budget-usd",
      values.get("--max-budget-usd") ?? "2",
    ];
  }
  if (provider === "antigravity") {
    return [
      "--antigravity-command",
      requireCli(values, "--antigravity-command"),
      ...repeated
        .get("--antigravity-prefix-arg")
        .flatMap((item) => ["--antigravity-prefix-arg", item]),
    ];
  }
  fail(`unsupported provider ${provider}`);
}

function campaignProviderResolution(provider) {
  if (provider !== "openai") {
    fail(
      "the defining-concepts default-deny live-research campaign currently supports only OpenAI Codex",
    );
  }
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

function positiveCliInteger(values, name) {
  const value = requireCli(values, name);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail(`${name} must be a positive integer`);
  }
  return parsed;
}

export function resolveTrialEvaluationHomesRoot(environment = process.env) {
  return evaluationHomesRootFromLocalAppData(environment?.LOCALAPPDATA);
}

function parsedSpawnResult(spawned, label) {
  if (spawned.error !== undefined) throw spawned.error;
  let result;
  try {
    result = JSON.parse(spawned.stdout.trim());
  } catch (error) {
    fail(`${label} did not return one JSON result: ${error.message}`);
  }
  return result;
}

async function withNewTrialWorkingRoot(workingRoot, operation) {
  if (
    typeof workingRoot !== "string" ||
    path.resolve(workingRoot) !== workingRoot
  ) {
    fail("--working-root must be an absolute new directory");
  }
  if (existsSync(workingRoot)) {
    fail("--working-root must be a new directory");
  }
  mkdirSync(workingRoot, { recursive: false });
  try {
    return await operation();
  } catch (error) {
    rmSync(workingRoot, { recursive: true, force: true });
    throw error;
  }
}

async function prepareTrialFromCli(values) {
  const destination = path.resolve(requireCli(values, "--output-dir"));
  const caseId = positiveCliInteger(values, "--case-id");
  const skillArm = requireCli(values, "--skill-arm");
  const trialIndex = positiveCliInteger(values, "--trial-index");
  const adapter = requireCli(values, "--adapter");
  const model = requireCli(values, "--model");
  const reasoningEffort = requireCli(values, "--reasoning-effort");
  const now = new Date(requireCli(values, "--created-at"));
  const workingRoot = path.resolve(requireCli(values, "--working-root"));
  const baselineRevision = requireCli(values, "--baseline-revision");
  const definitions = readJson(
    path.join(import.meta.dirname, "evals.json"),
    "evaluation definitions",
  );
  const evaluationCase = definitions.evals.find(({ id }) => id === caseId);
  if (evaluationCase === undefined) {
    fail(`evaluation definitions do not declare case ${caseId}`);
  }
  const currentBundle = captureGitSkillBundle({
    repositoryRoot: REPOSITORY_ROOT,
    revision: baselineRevision,
    skillName: "defining-concepts",
  });
  const candidateBundle = captureWorkingTreeSkillBundle({
    repositoryRoot: REPOSITORY_ROOT,
    skillName: "defining-concepts",
  });

  return withNewTrialWorkingRoot(workingRoot, async () => {
    const evaluationHomesRoot = resolveTrialEvaluationHomesRoot();
    await initializeEvaluationHomes({ root: evaluationHomesRoot });
    const workingDirectory = path.join(workingRoot, "workspace");
    return prepareEvaluationTrial({
      destination,
      now,
      evaluationCase,
      skillArm,
      trialIndex,
      currentBundle,
      candidateBundle,
      capabilityContract: definitions.capability_contract,
      providerResolution: campaignProviderResolution("openai"),
      provider: "openai",
      adapter,
      model,
      reasoningEffort,
      baselineRevision,
      workingDirectory,
      async prepareSession({
        caseFile,
        skillBundleFile,
        capabilityReconciliationFile,
        preparedSession,
      }) {
        const arguments_ = [
          SESSION_RUNNER,
          "prepare",
          "--case-file",
          caseFile,
          "--destination",
          preparedSession,
          "--working-dir",
          workingDirectory,
          "--arm",
          skillArm,
          "--repetition",
          "1",
          "--provider",
          "codex",
          "--model",
          model,
          "--effort",
          reasoningEffort,
          "--capability-reconciliation-file",
          capabilityReconciliationFile,
          "--codex-command",
          "codex",
          "--evaluation-homes-root",
          evaluationHomesRoot,
        ];
        if (skillBundleFile !== null) {
          arguments_.push("--skill-bundle-file", skillBundleFile);
        }
        const spawned = spawnSync(process.execPath, arguments_, {
          encoding: "utf8",
        });
        if (spawned.error !== undefined) throw spawned.error;
        if (spawned.status !== 0) {
          fail(`trial session preparation failed: ${spawned.stderr}`);
        }
        return {
          modelTurns: 0,
          packet: readJson(
            path.join(preparedSession, "packet.json"),
            "prepared trial packet",
          ),
        };
      },
    });
  });
}

async function preflightTrialFromCli(values) {
  const trialDirectory = path.resolve(requireCli(values, "--trial-dir"));
  const result = await preflightEvaluationTrial({
    trialDirectory,
    preflightSession({ preparedSession }) {
      const spawned = spawnSync(
        process.execPath,
        [
          SESSION_RUNNER,
          "preflight",
          "--prepared-session",
          preparedSession,
          "--allow-zero-turn-preflight",
        ],
        { encoding: "utf8" },
      );
      const preflight = parsedSpawnResult(spawned, "trial preflight");
      if (spawned.status !== 0 && preflight.status === "completed") {
        fail("trial preflight process failed after reporting completion");
      }
      return preflight;
    },
  });
  if (result.status !== "completed") process.exitCode = 1;
  return result;
}

async function runTrialFromCli(values) {
  const trialDirectory = path.resolve(requireCli(values, "--trial-dir"));
  const authorizationFile = path.resolve(
    requireCli(values, "--authorization-file"),
  );
  return runEvaluationTrial({
    trialDirectory,
    authorizationFile,
    allowExternalModelCall: values.get("--allow-external-model-call") === true,
    executeSession({ preparedSession, evidenceLayout }) {
      const spawned = spawnSync(
        process.execPath,
        [
          SESSION_RUNNER,
          "run",
          "--prepared-session",
          preparedSession,
          "--authorization",
          authorizationFile,
          "--allow-external-model-call",
          "--evidence-layout",
          evidenceLayout,
        ],
        { encoding: "utf8" },
      );
      const execution = parsedSpawnResult(spawned, "trial execution");
      if (spawned.status !== 0 && execution.status === "completed") {
        fail("trial execution process failed after reporting completion");
      }
      return execution;
    },
  });
}

function verifyTrialFromCli(values) {
  return verifyEvaluationTrial({
    trialDirectory: path.resolve(requireCli(values, "--trial-dir")),
  });
}

function prepareFromCli(values, repeated) {
  const campaign = requireCli(values, "--campaign");
  const destination = path.resolve(requireCli(values, "--destination"));
  const baselineRevision = requireCli(values, "--baseline-revision");
  const providerOption = requireCli(values, "--provider");
  const provider =
    providerOption === "codex"
      ? "openai"
      : providerOption === "claude"
        ? "anthropic"
        : "google";
  const model = requireCli(values, "--model");
  const effort = requireCli(values, "--effort");
  const seed = requireCli(values, "--seed");
  const now = new Date(requireCli(values, "--started-at"));
  const workingRoot = path.resolve(requireCli(values, "--working-root"));
  const definitions = readJson(
    path.join(import.meta.dirname, "evals.json"),
    "evaluation definitions",
  );
  const campaignDefinition = definitions.campaigns?.[campaign];
  if (campaignDefinition === undefined)
    fail(`evaluation definitions do not declare campaign ${campaign}`);
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
  return withNewCampaignWorkingRoot(workingRoot, () =>
    prepareCampaign({
      campaign,
      destination,
      cases: selected,
      arms: campaignDefinition.arms,
      repetitionCount: campaignDefinition.repetitions,
      currentBundle,
      candidateBundle,
      capabilityContract: definitions.capability_contract,
      providerResolution: campaignProviderResolution(provider),
      provider,
      model,
      effort,
      seed,
      now,
      prepareSession(cell) {
        const caseFile = path.join(cell.sessionDirectory, "case.json");
        writeCanonicalExclusive(caseFile, cell.caseRecord);
        const capabilityReconciliationFile = path.join(
          cell.sessionDirectory,
          "capability-reconciliation.json",
        );
        writeCanonicalExclusive(
          capabilityReconciliationFile,
          cell.capabilityReconciliation,
        );
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
          "--capability-reconciliation-file",
          capabilityReconciliationFile,
        ];
        if (cell.bundle !== null) {
          const bundleFile = path.join(
            cell.sessionDirectory,
            "skill-bundle.json",
          );
          writeCanonicalExclusive(bundleFile, cell.bundle);
          arguments_.push("--skill-bundle-file", bundleFile);
        }
        arguments_.push(...providerArguments);
        const result = spawnSync(process.execPath, arguments_, {
          encoding: "utf8",
        });
        if (result.status !== 0)
          fail(`session preparation failed: ${result.stderr}`);
        return {
          modelTurns: 0,
          packet: readJson(
            path.join(cell.sessionDirectory, "prepared", "packet.json"),
            "prepared session packet",
          ),
        };
      },
    }),
  );
}

function runFromCli(values) {
  const campaignDirectory = path.resolve(requireCli(values, "--campaign-dir"));
  const authorizationDirectory = path.resolve(
    requireCli(values, "--authorization-dir"),
  );
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
      const retained = readPreparedSessionResult(preparedSession);
      if (result.status !== 0 && retained.status === "completed") {
        fail(
          `session runner failed after reporting completion: ${result.stderr}`,
        );
      }
      return retained;
    },
  });
}

function statusFromCli(values) {
  return inspectCampaignExecution({
    campaignDirectory: path.resolve(requireCli(values, "--campaign-dir")),
  });
}

function preflightFromCli(values) {
  const campaignDirectory = path.resolve(requireCli(values, "--campaign-dir"));
  const timeoutMs = values.get("--timeout-ms");
  const record = preflightPreparedCampaign({
    campaignDirectory,
    preflightSession(session) {
      const preparedSession = path.join(
        campaignDirectory,
        session.relativeSessionPath,
        "prepared",
      );
      const arguments_ = [
        SESSION_RUNNER,
        "preflight",
        "--prepared-session",
        preparedSession,
        "--allow-zero-turn-preflight",
      ];
      if (timeoutMs !== undefined) {
        arguments_.push("--timeout-ms", timeoutMs);
      }
      const spawned = spawnSync(process.execPath, arguments_, {
        encoding: "utf8",
      });
      if (spawned.error !== undefined) throw spawned.error;
      let result;
      try {
        result = JSON.parse(spawned.stdout.trim());
      } catch (error) {
        fail(
          `session preflight did not return one JSON result: ${error.message}`,
        );
      }
      if (spawned.status !== 0 && result.status === "completed") {
        fail(
          `session preflight exited with status ${spawned.status} after reporting completion`,
        );
      }
      return result;
    },
  });
  if (record.status !== "completed") process.exitCode = 1;
  return record;
}

function aggregateFromCli(values) {
  const campaignDirectory = path.resolve(requireCli(values, "--campaign-dir"));
  const manifest = readJson(
    path.join(campaignDirectory, "manifest.json"),
    "campaign manifest",
  );
  const gradesDirectory = path.join(campaignDirectory, "grading", "grades");
  const pairwiseDirectory = path.join(
    campaignDirectory,
    "grading",
    "pairwise-grades",
  );
  const gradeRecords = readdirSync(gradesDirectory).map((name) =>
    readJson(path.join(gradesDirectory, name), `grade ${name}`),
  );
  const pairwiseGrades = readdirSync(pairwiseDirectory).map((name) =>
    readJson(path.join(pairwiseDirectory, name), `pairwise grade ${name}`),
  );
  const disagreementsPath = path.join(
    campaignDirectory,
    "grading",
    "disagreements.json",
  );
  const aggregate = aggregateCampaignGrades({
    manifest,
    gradeRecords,
    pairwiseGrades,
    disagreements: existsSync(disagreementsPath)
      ? readJson(disagreementsPath, "disagreements")
      : [],
  });
  writeCanonicalExclusive(
    path.join(campaignDirectory, "aggregate.generated.json"),
    aggregate,
  );
  return aggregate;
}

async function cli() {
  const { command, subcommand, values, repeated } = parseEvaluationRunnerCli(
    process.argv.slice(2),
  );
  let result;
  if (command === "trial") {
    if (subcommand === "prepare") result = await prepareTrialFromCli(values);
    else if (subcommand === "preflight") {
      result = await preflightTrialFromCli(values);
    } else if (subcommand === "run") result = await runTrialFromCli(values);
    else result = await verifyTrialFromCli(values);
  } else if (command === "prepare") result = prepareFromCli(values, repeated);
  else if (command === "preflight") result = preflightFromCli(values);
  else if (command === "run") result = runFromCli(values);
  else if (command === "status") result = statusFromCli(values);
  else if (command === "prepare-grading") {
    result = prepareCampaignGrading({
      campaignDirectory: path.resolve(requireCli(values, "--campaign-dir")),
    });
  } else if (command === "aggregate") result = aggregateFromCli(values);
  else
    fail(
      "first argument must be trial, prepare, preflight, run, status, prepare-grading, or aggregate",
    );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  cli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
