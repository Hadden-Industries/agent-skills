import { randomBytes } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  assertTransmissionPacket,
  canonicalJsonBytes,
  EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";
import {
  assertCapabilityReconciliation,
  reconcileEvaluationCapabilities,
} from "../../scripts/evaluation/capability-reconciliation.js";

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

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writeCanonicalExclusive(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, canonicalJsonBytes(value), { flag: "wx" });
}

async function readJson(target, label) {
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
}

async function readCanonicalJson(target, label) {
  let bytes;
  let value;
  try {
    bytes = await readFile(target);
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
  if (!canonicalJsonBytes(value).equals(bytes)) {
    fail(`${label} is not retained as canonical JSON bytes`);
  }
  return value;
}

async function readCanonicalJsonInput(target, label) {
  let bytes;
  let value;
  try {
    bytes = await readFile(target);
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
  const terminalLineEndingLength =
    bytes.at(-1) === 0x0a ? (bytes.at(-2) === 0x0d ? 2 : 1) : 0;
  const documentBytes =
    terminalLineEndingLength === 0
      ? bytes
      : bytes.subarray(0, -terminalLineEndingLength);
  if (!canonicalJsonBytes(value).equals(documentBytes)) {
    fail(
      `${label} must contain canonical JSON with at most one terminal LF or CRLF`,
    );
  }
  return value;
}

function safeTimestamp(date) {
  return date.toISOString().replaceAll(":", "");
}

function assertNewTimestampDestination(destination, now) {
  if (
    typeof destination !== "string" ||
    path.resolve(destination) !== destination
  ) {
    fail("destination must be an absolute new directory");
  }
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    fail("now must be a valid Date");
  }
  if (!TIMESTAMP_DIRECTORY_PATTERN.test(path.basename(destination))) {
    fail("destination must use a filesystem-safe ISO UTC timestamp name");
  }
  if (path.basename(destination) !== safeTimestamp(now)) {
    fail("destination timestamp must match the frozen trial creation time");
  }
}

function assertBundle(bundle, expectedKind, label) {
  if (
    bundle?.schemaVersion !== 1 ||
    bundle?.skillName !== "defining-concepts" ||
    bundle?.source?.kind !== expectedKind ||
    !Array.isArray(bundle?.files) ||
    bundle.files.length === 0 ||
    !SHA256_PATTERN.test(bundle?.aggregateSha256 ?? "")
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

function assertPreparationOptions(options) {
  if (options === null || typeof options !== "object") {
    fail("trial preparation options are required");
  }
  const {
    evaluationCase,
    skillArm,
    trialIndex,
    provider,
    adapter,
    model,
    reasoningEffort,
    baselineRevision,
    prepareSession,
  } = options;
  if (
    !Number.isSafeInteger(evaluationCase?.id) ||
    evaluationCase.id <= 0 ||
    typeof evaluationCase.prompt !== "string" ||
    evaluationCase.prompt.length === 0
  ) {
    fail("evaluationCase must have a positive ID and nonempty prompt");
  }
  if (!CANONICAL_ARMS.includes(skillArm)) {
    fail("skillArm must be no-skill, current-skill, or candidate-skill");
  }
  if (!Number.isSafeInteger(trialIndex) || trialIndex < 1) {
    fail("trialIndex must be a positive integer");
  }
  if (provider !== "openai") {
    fail("single-trial execution currently supports provider openai");
  }
  if (adapter !== "codex-app-server") {
    fail("single-trial execution currently supports adapter codex-app-server");
  }
  for (const [label, value] of [
    ["model", model],
    ["reasoningEffort", reasoningEffort],
    ["baselineRevision", baselineRevision],
  ]) {
    if (typeof value !== "string" || value.length === 0) {
      fail(`${label} must be nonempty`);
    }
  }
  if (typeof prepareSession !== "function") {
    fail("prepareSession must be a function");
  }
}

function assertPacketBinding({
  packet,
  evaluationCase,
  skillArm,
  bundle,
  capabilityReconciliation,
  provider,
  adapter,
  model,
  reasoningEffort,
}) {
  assertTransmissionPacket(packet);
  const transmission = packet.transmission;
  if (
    transmission.suite !== "defining-concepts" ||
    transmission.session.caseId !== evaluationCase.id ||
    transmission.session.arm !== skillArm ||
    transmission.session.repetition !== 1 ||
    transmission.provider !== provider ||
    transmission.transport !== adapter ||
    transmission.model !== model ||
    transmission.effort !== reasoningEffort
  ) {
    fail("prepared packet is not bound to the requested trial identity");
  }
  if (
    !canonicalJsonBytes(transmission.capabilityReconciliation).equals(
      canonicalJsonBytes(capabilityReconciliation),
    ) ||
    !canonicalJsonBytes(transmission.capabilities).equals(
      canonicalJsonBytes(capabilityReconciliation.receipt.runtimeCapabilities),
    )
  ) {
    fail("prepared packet is not bound to the capability reconciliation");
  }
  const caseInput = transmission.harnessControlledInputs.find(
    ({ id }) => id === "evaluation-case",
  );
  if (
    caseInput === undefined ||
    !canonicalJsonBytes(JSON.parse(caseInput.content)).equals(
      canonicalJsonBytes(evaluationCase),
    )
  ) {
    fail("prepared packet is not bound to the selected evaluation case");
  }
  const bundleInput = transmission.harnessControlledInputs.find(
    ({ id }) => id === "skill-bundle",
  );
  if (
    (bundle === null && bundleInput !== undefined) ||
    (bundle !== null &&
      (bundleInput === undefined ||
        !canonicalJsonBytes(JSON.parse(bundleInput.content)).equals(
          canonicalJsonBytes(bundle),
        )))
  ) {
    fail("prepared packet is not bound to the selected skill bundle");
  }
}

async function artifactDescriptor(directory, relativePath, extra = {}) {
  const bytes = await readFile(
    path.join(directory, ...relativePath.split("/")),
  );
  return {
    relativePath,
    byteLength: bytes.byteLength,
    sha256: sha256Hex(bytes),
    ...extra,
  };
}

function assertSafeRelativePath(relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`${label} must be a traversal-free relative path`);
  }
}

async function assertArtifactDescriptor(
  directory,
  descriptor,
  label,
  expectedRelativePath,
) {
  if (descriptor === null || typeof descriptor !== "object") {
    fail(`${label} artifact descriptor is missing`);
  }
  assertSafeRelativePath(descriptor.relativePath, `${label}.relativePath`);
  if (
    expectedRelativePath !== undefined &&
    descriptor.relativePath !== expectedRelativePath
  ) {
    fail(`${label} artifact path is not canonical`);
  }
  if (
    !Number.isSafeInteger(descriptor.byteLength) ||
    descriptor.byteLength < 0 ||
    !SHA256_PATTERN.test(descriptor.sha256 ?? "")
  ) {
    fail(`${label} artifact descriptor is invalid`);
  }
  const target = path.join(directory, ...descriptor.relativePath.split("/"));
  let stats;
  let bytes;
  try {
    stats = await lstat(target);
    bytes = await readFile(target);
  } catch (error) {
    fail(`${label} artifact integrity check failed: ${error.message}`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(`${label} artifact integrity check requires a regular file`);
  }
  if (
    bytes.byteLength !== descriptor.byteLength ||
    sha256Hex(bytes) !== descriptor.sha256
  ) {
    fail(`${label} artifact integrity digest does not match`);
  }
  return bytes;
}

function assertManifestShape(manifest, trialDirectory) {
  if (
    manifest?.artifactType !== "evaluation-trial-manifest" ||
    manifest?.schemaVersion !== 1 ||
    manifest?.suite !== "defining-concepts"
  ) {
    fail("trial manifest schema is invalid");
  }
  if (manifest.directoryName !== path.basename(trialDirectory)) {
    fail("trial manifest directoryName does not match its directory");
  }
  if (
    !TIMESTAMP_DIRECTORY_PATTERN.test(manifest.directoryName) ||
    safeTimestamp(new Date(manifest.createdAt)) !== manifest.directoryName
  ) {
    fail("trial manifest timestamp binding is invalid");
  }
  if (
    !Number.isSafeInteger(manifest.identity?.caseId) ||
    manifest.identity.caseId < 1 ||
    !CANONICAL_ARMS.includes(manifest.identity?.skillArm) ||
    !Number.isSafeInteger(manifest.identity?.trialIndex) ||
    manifest.identity.trialIndex < 1
  ) {
    fail("trial manifest identity is invalid");
  }
  if (
    manifest.execution?.provider !== "openai" ||
    manifest.execution?.transport !== "codex-app-server" ||
    manifest.execution?.adapter !== "codex-app-server" ||
    typeof manifest.execution?.model !== "string" ||
    typeof manifest.execution?.reasoningEffort !== "string" ||
    !Number.isSafeInteger(manifest.execution?.maximumTurns) ||
    manifest.execution.maximumTurns < 1 ||
    !new Set(["diagnostic", "repeatability"]).has(
      manifest.execution?.evidenceUse,
    ) ||
    manifest.execution?.aggregateEligible !== false
  ) {
    fail("trial manifest execution contract is invalid");
  }
  if (
    manifest.trialId !==
    `trial-${manifest.artifacts?.packet?.transmissionSha256?.slice(0, 16)}`
  ) {
    fail("trial manifest trialId is not bound to its transmission");
  }
}

async function loadPreparedTrial(trialDirectory) {
  if (
    typeof trialDirectory !== "string" ||
    path.resolve(trialDirectory) !== trialDirectory
  ) {
    fail("trialDirectory must be an absolute path");
  }
  const manifest = await readCanonicalJson(
    path.join(trialDirectory, "manifest.json"),
    "trial manifest",
  );
  assertManifestShape(manifest, trialDirectory);

  const caseBytes = await assertArtifactDescriptor(
    trialDirectory,
    manifest.artifacts?.case,
    "case",
    "case.json",
  );
  const capabilityBytes = await assertArtifactDescriptor(
    trialDirectory,
    manifest.artifacts?.capabilityReconciliation,
    "capability reconciliation",
    "capability-reconciliation.json",
  );
  const packetBytes = await assertArtifactDescriptor(
    trialDirectory,
    manifest.artifacts?.packet,
    "packet",
    "packet.json",
  );
  const inputManifestBytes = await assertArtifactDescriptor(
    trialDirectory,
    manifest.artifacts?.inputManifest,
    "input manifest",
    "inputs/manifest.json",
  );
  const evaluationCase = JSON.parse(caseBytes.toString("utf8"));
  const capabilityReconciliation = JSON.parse(capabilityBytes.toString("utf8"));
  const packet = JSON.parse(packetBytes.toString("utf8"));
  const inputManifest = JSON.parse(inputManifestBytes.toString("utf8"));
  assertCapabilityReconciliation(capabilityReconciliation);
  assertTransmissionPacket(packet);
  assertInputManifest(inputManifest);
  if (
    manifest.artifacts.case.caseSha256 !==
      sha256Hex(canonicalJsonBytes(evaluationCase)) ||
    manifest.identity.caseId !== evaluationCase.id ||
    manifest.artifacts.capabilityReconciliation.receiptSha256 !==
      capabilityReconciliation.receiptSha256 ||
    manifest.artifacts.packet.transmissionSha256 !== packet.transmissionSha256
  ) {
    fail("trial immutable artifact semantic digest binding is invalid");
  }

  let bundle = null;
  if (manifest.identity.skillArm === "no-skill") {
    if (manifest.artifacts.skillBundle !== null) {
      fail("no-skill trial must not bind a skill bundle artifact");
    }
  } else {
    const bundleBytes = await assertArtifactDescriptor(
      trialDirectory,
      manifest.artifacts.skillBundle,
      "skill bundle",
      "skill-bundle.json",
    );
    bundle = JSON.parse(bundleBytes.toString("utf8"));
    if (
      manifest.artifacts.skillBundle.aggregateSha256 !== bundle.aggregateSha256
    ) {
      fail("skill bundle aggregate binding is invalid");
    }
  }

  if (
    !Array.isArray(manifest.artifacts.inputs) ||
    manifest.artifacts.inputs.length !== inputManifest.inputs.length
  ) {
    fail("trial input artifact bindings are incomplete");
  }
  for (const [index, input] of inputManifest.inputs.entries()) {
    const descriptor = manifest.artifacts.inputs[index];
    if (
      descriptor?.id !== input.id ||
      descriptor?.mediaType !== input.mediaType ||
      descriptor?.relativePath !== input.relativePath ||
      descriptor?.byteLength !== input.byteLength ||
      descriptor?.sha256 !== input.sha256
    ) {
      fail("trial input artifact binding disagrees with the input manifest");
    }
    await assertArtifactDescriptor(
      trialDirectory,
      descriptor,
      `input ${input.id}`,
      input.relativePath,
    );
  }
  assertPacketBinding({
    packet,
    evaluationCase,
    skillArm: manifest.identity.skillArm,
    bundle,
    capabilityReconciliation,
    provider: manifest.execution.provider,
    adapter: manifest.execution.adapter,
    model: manifest.execution.model,
    reasoningEffort: manifest.execution.reasoningEffort,
  });
  if (
    packet.transmission.continuationPolicy.maxTurns !==
    manifest.execution.maximumTurns
  ) {
    fail("trial maximum-turn binding is invalid");
  }
  return { manifest, evaluationCase, capabilityReconciliation, packet, bundle };
}

async function recursiveArtifactDescriptors(directory, relativeDirectory) {
  const root = path.join(directory, ...relativeDirectory.split("/"));
  const descriptors = [];

  async function visit(current, relative) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const nextRelative = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(absolute, nextRelative);
      else if (entry.isFile() && !entry.isSymbolicLink()) {
        descriptors.push(await artifactDescriptor(directory, nextRelative));
      } else {
        fail(
          "preflight evidence must contain only regular files and directories",
        );
      }
    }
  }

  await visit(root, relativeDirectory);
  return descriptors;
}

async function loadPreflightEvidence(trialDirectory, manifest, packet) {
  const preflight = await readCanonicalJson(
    path.join(trialDirectory, "preflight.json"),
    "trial preflight",
  );
  const capabilitiesAreObject =
    preflight?.capabilities !== null &&
    typeof preflight?.capabilities === "object" &&
    !Array.isArray(preflight?.capabilities);
  if (
    preflight?.artifactType !== "evaluation-trial-preflight" ||
    preflight?.schemaVersion !== 1 ||
    preflight?.trialId !== manifest.trialId ||
    preflight?.transmissionSha256 !== packet.transmissionSha256 ||
    !new Set(["completed", "failed"]).has(preflight?.status) ||
    preflight?.modelTurns !== 0 ||
    preflight?.authorizationConsumed !== false ||
    (preflight?.status === "completed" &&
      (!capabilitiesAreObject ||
        preflight.capabilities.provider !== manifest.execution.provider ||
        preflight.capabilities.model !== manifest.execution.model ||
        preflight.capabilities.effort !==
          manifest.execution.reasoningEffort)) ||
    (preflight?.status === "failed" &&
      preflight?.capabilities !== null &&
      !capabilitiesAreObject) ||
    !Array.isArray(preflight?.artifacts)
  ) {
    fail("trial preflight evidence is not packet-bound zero-turn evidence");
  }
  const currentArtifacts = await recursiveArtifactDescriptors(
    trialDirectory,
    "preflight",
  );
  if (
    !canonicalJsonBytes(currentArtifacts).equals(
      canonicalJsonBytes(preflight.artifacts),
    )
  ) {
    fail("preflight artifact integrity does not match its retained summary");
  }
  return preflight;
}

async function loadSuccessfulPreflight(trialDirectory, manifest, packet) {
  const preflight = await loadPreflightEvidence(
    trialDirectory,
    manifest,
    packet,
  );
  if (preflight.status !== "completed") {
    fail("trial run requires one successful packet-bound zero-turn preflight");
  }
  return preflight;
}

function expectedAuthorization(manifest, packet) {
  return {
    schemaVersion: 1,
    decision: "authorized",
    statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
    allowExternalModel: true,
    provider: manifest.execution.provider,
    model: manifest.execution.model,
    effort: manifest.execution.reasoningEffort,
    transmissionSha256: packet.transmissionSha256,
  };
}

async function assertResultArtifactMap(
  trialDirectory,
  result,
  manifest,
  packet,
) {
  if (
    result.artifacts === null ||
    typeof result.artifacts !== "object" ||
    Array.isArray(result.artifacts)
  ) {
    fail("terminal result artifact map is invalid");
  }
  const required = new Set([
    "packet.json",
    "inputs/manifest.json",
    ...manifest.artifacts.inputs.map(({ relativePath }) => relativePath),
    "authorization.json",
    "metrics.json",
    "timing.json",
    "outputs/provider-transcript.jsonl",
    "outputs/events.jsonl",
    "outputs/stderr.log",
    "outputs/response.md",
  ]);
  if (result.providerOutcome !== "not-started") {
    required.add("authorization-consumption.json");
  }
  for (const relativePath of required) {
    if (!Object.hasOwn(result.artifacts, relativePath)) {
      fail(`terminal result is missing artifact binding ${relativePath}`);
    }
  }
  for (const [relativePath, descriptor] of Object.entries(result.artifacts)) {
    assertSafeRelativePath(relativePath, "terminal result artifact path");
    if (
      descriptor === null ||
      typeof descriptor !== "object" ||
      !Number.isSafeInteger(descriptor.byteLength) ||
      descriptor.byteLength < 0 ||
      !SHA256_PATTERN.test(descriptor.sha256 ?? "")
    ) {
      fail("terminal result artifact descriptor is invalid");
    }
    const bytes = await readFile(
      path.join(trialDirectory, ...relativePath.split("/")),
    );
    if (
      bytes.byteLength !== descriptor.byteLength ||
      sha256Hex(bytes) !== descriptor.sha256
    ) {
      fail(`terminal result artifact integrity failed for ${relativePath}`);
    }
  }
  const retainedPacket = await readCanonicalJson(
    path.join(trialDirectory, "packet.json"),
    "terminal packet",
  );
  if (
    retainedPacket.transmissionSha256 !== packet.transmissionSha256 ||
    result.transmissionSha256 !== packet.transmissionSha256
  ) {
    fail("terminal result transmission binding is invalid");
  }
}

async function loadTerminalResult(trialDirectory, manifest, packet) {
  const result = await readCanonicalJson(
    path.join(trialDirectory, "result.json"),
    "trial terminal result",
  );
  if (
    result?.artifactType !== "evaluation-trial-result" ||
    result?.schemaVersion !== 1 ||
    !new Set(["completed", "failed"]).has(result?.executionStatus) ||
    result?.gradeStatus !== "not-graded" ||
    !new Set(["completed", "failed", "not-started"]).has(
      result?.providerOutcome,
    ) ||
    typeof result?.retryPermitted !== "boolean"
  ) {
    fail("trial terminal result schema is invalid");
  }
  if (
    (result.executionStatus === "completed" &&
      result.providerOutcome !== "completed") ||
    (result.providerOutcome === "completed" &&
      result.executionStatus !== "completed")
  ) {
    fail("trial terminal execution and provider outcomes disagree");
  }
  if (result.retryPermitted !== false) {
    fail("a terminal trial result must forbid retry");
  }
  await assertResultArtifactMap(trialDirectory, result, manifest, packet);
  const retainedAuthorization = await readCanonicalJson(
    path.join(trialDirectory, "authorization.json"),
    "retained authorization",
  );
  if (
    !canonicalJsonBytes(retainedAuthorization).equals(
      canonicalJsonBytes(expectedAuthorization(manifest, packet)),
    )
  ) {
    fail("retained authorization does not match the exact transmission");
  }
  return result;
}

function assertInputManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.inputs)) {
    fail("prepared input manifest is invalid");
  }
  for (const input of manifest.inputs) {
    if (
      typeof input?.relativePath !== "string" ||
      !input.relativePath.startsWith("inputs/") ||
      input.relativePath.includes("\\") ||
      input.relativePath.split("/").some((part) => part === "..")
    ) {
      fail("prepared input manifest contains an unsafe path");
    }
  }
}

export async function prepareEvaluationTrial(options) {
  assertPreparationOptions(options);
  const {
    destination,
    now,
    evaluationCase,
    skillArm,
    trialIndex,
    currentBundle,
    candidateBundle,
    capabilityContract,
    providerResolution,
    provider,
    adapter,
    model,
    reasoningEffort,
    baselineRevision,
    prepareSession,
    workingDirectory = null,
  } = options;
  assertNewTimestampDestination(destination, now);
  if (await exists(destination)) fail("destination must be a new directory");
  assertBundle(currentBundle, "git", "current-skill");
  assertBundle(candidateBundle, "working-tree", "candidate-skill");
  if (currentBundle.aggregateSha256 === candidateBundle.aggregateSha256) {
    fail("current and candidate skill bundles must differ");
  }

  const capabilityReconciliation = reconcileEvaluationCapabilities({
    suite: "defining-concepts",
    contract: capabilityContract,
    cases: [evaluationCase],
    arms: CANONICAL_ARMS,
    skillBundles: {
      "current-skill": currentBundle,
      "candidate-skill": candidateBundle,
    },
    providerResolution,
  });
  assertCapabilityReconciliation(capabilityReconciliation);
  const bundle =
    skillArm === "current-skill"
      ? currentBundle
      : skillArm === "candidate-skill"
        ? candidateBundle
        : null;

  await mkdir(path.dirname(destination), { recursive: true });
  const staging = `${destination}.preparing-${randomBytes(6).toString("hex")}`;
  await mkdir(staging, { recursive: false });
  const preparationDirectory = path.join(staging, "preparation");
  const preparedSession = path.join(preparationDirectory, "prepared");
  try {
    const caseFile = path.join(preparationDirectory, "case.json");
    const capabilityReconciliationFile = path.join(
      preparationDirectory,
      "capability-reconciliation.json",
    );
    await writeCanonicalExclusive(caseFile, evaluationCase);
    await writeCanonicalExclusive(
      capabilityReconciliationFile,
      capabilityReconciliation,
    );
    let skillBundleFile = null;
    if (bundle !== null) {
      skillBundleFile = path.join(preparationDirectory, "skill-bundle.json");
      await writeCanonicalExclusive(skillBundleFile, bundle);
    }

    const prepared = await prepareSession({
      evaluationCase: canonicalRecord(evaluationCase),
      skillArm,
      trialIndex,
      bundle,
      capabilityReconciliation,
      caseFile,
      skillBundleFile,
      capabilityReconciliationFile,
      preparedSession,
      workingDirectory,
    });
    if (prepared?.modelTurns !== 0 || prepared?.packet === undefined) {
      fail("trial preparation must return zero model turns and one packet");
    }
    const retainedPacket = await readJson(
      path.join(preparedSession, "packet.json"),
      "prepared packet",
    );
    if (
      !canonicalJsonBytes(retainedPacket).equals(
        canonicalJsonBytes(prepared.packet),
      )
    ) {
      fail("prepared packet result disagrees with retained packet bytes");
    }
    assertPacketBinding({
      packet: retainedPacket,
      evaluationCase,
      skillArm,
      bundle,
      capabilityReconciliation,
      provider,
      adapter,
      model,
      reasoningEffort,
    });

    await rename(
      path.join(preparedSession, "packet.json"),
      path.join(staging, "packet.json"),
    );
    await rename(
      path.join(preparedSession, "inputs"),
      path.join(staging, "inputs"),
    );
    await writeCanonicalExclusive(
      path.join(staging, "case.json"),
      evaluationCase,
    );
    await writeCanonicalExclusive(
      path.join(staging, "capability-reconciliation.json"),
      capabilityReconciliation,
    );
    if (bundle !== null) {
      await writeCanonicalExclusive(
        path.join(staging, "skill-bundle.json"),
        bundle,
      );
    }
    await rm(preparationDirectory, { recursive: true, force: true });

    const packet = retainedPacket;
    const inputManifest = await readJson(
      path.join(staging, "inputs", "manifest.json"),
      "prepared input manifest",
    );
    assertInputManifest(inputManifest);
    const caseArtifact = await artifactDescriptor(staging, "case.json", {
      caseSha256: sha256Hex(canonicalJsonBytes(evaluationCase)),
    });
    const skillBundleArtifact =
      bundle === null
        ? null
        : await artifactDescriptor(staging, "skill-bundle.json", {
            aggregateSha256: bundle.aggregateSha256,
          });
    const capabilityArtifact = await artifactDescriptor(
      staging,
      "capability-reconciliation.json",
      { receiptSha256: capabilityReconciliation.receiptSha256 },
    );
    const packetArtifact = await artifactDescriptor(staging, "packet.json", {
      transmissionSha256: packet.transmissionSha256,
    });
    const inputManifestArtifact = await artifactDescriptor(
      staging,
      "inputs/manifest.json",
    );
    const inputArtifacts = [];
    for (const input of inputManifest.inputs) {
      inputArtifacts.push(
        await artifactDescriptor(staging, input.relativePath, {
          id: input.id,
          mediaType: input.mediaType,
        }),
      );
    }

    const manifest = canonicalRecord({
      artifactType: "evaluation-trial-manifest",
      schemaVersion: 1,
      suite: "defining-concepts",
      trialId: `trial-${packet.transmissionSha256.slice(0, 16)}`,
      createdAt: now.toISOString(),
      directoryName: path.basename(destination),
      identity: {
        caseId: evaluationCase.id,
        skillArm,
        trialIndex,
      },
      execution: {
        provider,
        transport: adapter,
        adapter,
        model,
        reasoningEffort,
        maximumTurns: packet.transmission.continuationPolicy.maxTurns,
        evidenceUse: trialIndex === 1 ? "diagnostic" : "repeatability",
        aggregateEligible: false,
      },
      baselineRevision,
      skillBundleSources: {
        currentSkill: {
          aggregateSha256: currentBundle.aggregateSha256,
          source: currentBundle.source,
        },
        candidateSkill: {
          aggregateSha256: candidateBundle.aggregateSha256,
          source: candidateBundle.source,
        },
      },
      artifacts: {
        case: caseArtifact,
        skillBundle: skillBundleArtifact,
        capabilityReconciliation: capabilityArtifact,
        packet: packetArtifact,
        inputManifest: inputManifestArtifact,
        inputs: inputArtifacts,
      },
    });
    await writeCanonicalExclusive(
      path.join(staging, "manifest.json"),
      manifest,
    );
    await rename(staging, destination);
    return deepFreeze(manifest);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function preflightEvaluationTrial({
  trialDirectory,
  preflightSession,
}) {
  if (typeof preflightSession !== "function") {
    fail("preflightSession must be a function");
  }
  const { manifest, packet } = await loadPreparedTrial(trialDirectory);
  const preflightPath = path.join(trialDirectory, "preflight.json");
  const evidenceDirectory = path.join(trialDirectory, "preflight");
  if ((await exists(preflightPath)) || (await exists(evidenceDirectory))) {
    fail("preflight evidence already exists for this trial");
  }
  if (
    await exists(path.join(trialDirectory, "authorization-consumption.json"))
  ) {
    fail("preflight cannot run after authorization consumption");
  }
  if (await exists(path.join(trialDirectory, "result.json"))) {
    fail("preflight cannot run after a terminal result");
  }
  if (await exists(path.join(trialDirectory, "authorization.json"))) {
    fail("preflight cannot run after authorization evidence exists");
  }

  const result = await preflightSession({
    trialDirectory,
    preparedSession: trialDirectory,
    evidenceDirectory,
    transmissionSha256: packet.transmissionSha256,
    manifest,
  });
  const capabilitiesAreObject =
    result?.capabilities !== null &&
    typeof result?.capabilities === "object" &&
    !Array.isArray(result?.capabilities);
  if (
    result === null ||
    typeof result !== "object" ||
    !new Set(["completed", "failed"]).has(result.status) ||
    result.modelTurns !== 0 ||
    (result.status === "completed" && !capabilitiesAreObject) ||
    (result.status === "failed" &&
      result.capabilities !== null &&
      !capabilitiesAreObject)
  ) {
    fail("preflight must return a zero-turn completed or failed result");
  }
  if (
    await exists(path.join(trialDirectory, "authorization-consumption.json"))
  ) {
    fail("zero-turn preflight unexpectedly consumed model authorization");
  }
  if (!(await exists(evidenceDirectory))) {
    fail("preflight did not retain its raw evidence directory");
  }
  const artifacts = await recursiveArtifactDescriptors(
    trialDirectory,
    "preflight",
  );
  if (artifacts.length === 0) {
    fail("preflight did not retain any raw evidence files");
  }
  const preflight = canonicalRecord({
    artifactType: "evaluation-trial-preflight",
    schemaVersion: 1,
    trialId: manifest.trialId,
    transmissionSha256: packet.transmissionSha256,
    status: result.status,
    modelTurns: 0,
    authorizationConsumed: false,
    capabilities: result.capabilities,
    error: result.error ?? null,
    artifacts,
  });
  await writeCanonicalExclusive(preflightPath, preflight);
  return deepFreeze(preflight);
}

export async function runEvaluationTrial({
  trialDirectory,
  authorizationFile,
  allowExternalModelCall,
  executeSession,
}) {
  if (allowExternalModelCall !== true) {
    fail("allowExternalModelCall must be literally true");
  }
  if (typeof executeSession !== "function") {
    fail("executeSession must be a function");
  }
  const { manifest, packet } = await loadPreparedTrial(trialDirectory);
  await loadSuccessfulPreflight(trialDirectory, manifest, packet);
  if (
    typeof authorizationFile !== "string" ||
    path.resolve(authorizationFile) !== authorizationFile
  ) {
    fail("authorizationFile must be an absolute path");
  }
  const authorization = await readCanonicalJsonInput(
    authorizationFile,
    "external model authorization",
  );
  if (
    !canonicalJsonBytes(authorization).equals(
      canonicalJsonBytes(expectedAuthorization(manifest, packet)),
    )
  ) {
    fail("authorization does not match the exact transmission");
  }

  if (await exists(path.join(trialDirectory, "result.json"))) {
    fail("trial already has a terminal result");
  }
  if (
    await exists(path.join(trialDirectory, "authorization-consumption.json"))
  ) {
    fail("trial authorization is already consumed");
  }
  for (const relativePath of [
    "authorization.json",
    "metrics.json",
    "timing.json",
    "outputs",
  ]) {
    if (await exists(path.join(trialDirectory, relativePath))) {
      fail(`trial execution evidence already exists: ${relativePath}`);
    }
  }

  const execution = await executeSession({
    trialDirectory,
    preparedSession: trialDirectory,
    authorizationFile,
    authorization,
    evidenceLayout: "evaluation-trial-v1",
    manifest,
    packet,
  });
  const result = await loadTerminalResult(trialDirectory, manifest, packet);
  if (
    execution?.status !== undefined &&
    execution.status !== result.executionStatus
  ) {
    fail("session execution return status disagrees with the terminal result");
  }
  return deepFreeze(result);
}

function verificationRecord({
  trialId,
  transmissionSha256,
  artifactIntegrity,
  preflightStatus,
  authorizationStatus,
  executionStatus,
  providerOutcome,
  gradeStatus = "not-graded",
  retryPermitted,
  issues,
}) {
  return deepFreeze(
    canonicalRecord({
      artifactType: "evaluation-trial-verification",
      schemaVersion: 1,
      trialId,
      transmissionSha256,
      artifactIntegrity,
      preflightStatus,
      authorizationStatus,
      executionStatus,
      providerOutcome,
      gradeStatus,
      retryPermitted,
      issues,
    }),
  );
}

async function authorizationStatusFor(trialDirectory) {
  if (
    await exists(path.join(trialDirectory, "authorization-consumption.json"))
  ) {
    return "consumed";
  }
  if (await exists(path.join(trialDirectory, "authorization.json"))) {
    return "provided";
  }
  return "not-provided";
}

async function validateRetainedAuthorization(trialDirectory, manifest, packet) {
  const authorizationPath = path.join(trialDirectory, "authorization.json");
  if (!(await exists(authorizationPath))) return false;
  const authorization = await readCanonicalJson(
    authorizationPath,
    "retained authorization",
  );
  if (
    !canonicalJsonBytes(authorization).equals(
      canonicalJsonBytes(expectedAuthorization(manifest, packet)),
    )
  ) {
    fail("retained authorization does not match the exact transmission");
  }
  return true;
}

async function validateAuthorizationConsumption(
  trialDirectory,
  manifest,
  packet,
) {
  const consumptionPath = path.join(
    trialDirectory,
    "authorization-consumption.json",
  );
  if (!(await exists(consumptionPath))) return false;
  const consumption = await readCanonicalJson(
    consumptionPath,
    "authorization consumption",
  );
  const expected = {
    artifactType: "evaluation-trial-authorization-consumption",
    schemaVersion: 1,
    provider: manifest.execution.provider,
    model: manifest.execution.model,
    effort: manifest.execution.reasoningEffort,
    transmissionSha256: packet.transmissionSha256,
  };
  if (!canonicalJsonBytes(consumption).equals(canonicalJsonBytes(expected))) {
    fail("authorization consumption does not match the exact transmission");
  }
  return true;
}

export async function verifyEvaluationTrial({ trialDirectory }) {
  let prepared;
  try {
    prepared = await loadPreparedTrial(trialDirectory);
  } catch (error) {
    let trialId = null;
    let transmissionSha256 = null;
    try {
      const manifest = await readCanonicalJson(
        path.join(trialDirectory, "manifest.json"),
        "trial manifest",
      );
      trialId = typeof manifest?.trialId === "string" ? manifest.trialId : null;
      transmissionSha256 = SHA256_PATTERN.test(
        manifest?.artifacts?.packet?.transmissionSha256 ?? "",
      )
        ? manifest.artifacts.packet.transmissionSha256
        : null;
    } catch {
      // The primary integrity error remains authoritative.
    }
    return verificationRecord({
      trialId,
      transmissionSha256,
      artifactIntegrity: "failed",
      preflightStatus: "indeterminate",
      authorizationStatus: await authorizationStatusFor(trialDirectory),
      executionStatus: "indeterminate",
      providerOutcome: "undetermined",
      retryPermitted: false,
      issues: [error.message],
    });
  }

  const { manifest, packet } = prepared;
  let preflightStatus = "not-run";
  const issues = [];
  if (await exists(path.join(trialDirectory, "preflight.json"))) {
    try {
      const preflight = await loadPreflightEvidence(
        trialDirectory,
        manifest,
        packet,
      );
      preflightStatus = preflight.status;
    } catch (error) {
      return verificationRecord({
        trialId: manifest.trialId,
        transmissionSha256: packet.transmissionSha256,
        artifactIntegrity: "failed",
        preflightStatus: "indeterminate",
        authorizationStatus: await authorizationStatusFor(trialDirectory),
        executionStatus: "indeterminate",
        providerOutcome: "undetermined",
        retryPermitted: false,
        issues: [error.message],
      });
    }
  } else if (await exists(path.join(trialDirectory, "preflight"))) {
    return verificationRecord({
      trialId: manifest.trialId,
      transmissionSha256: packet.transmissionSha256,
      artifactIntegrity: "failed",
      preflightStatus: "indeterminate",
      authorizationStatus: await authorizationStatusFor(trialDirectory),
      executionStatus: "indeterminate",
      providerOutcome: "undetermined",
      retryPermitted: false,
      issues: [
        "Raw preflight evidence exists without a sealed preflight summary.",
      ],
    });
  }

  const authorizationStatus = await authorizationStatusFor(trialDirectory);
  if (await exists(path.join(trialDirectory, "result.json"))) {
    try {
      const result = await loadTerminalResult(trialDirectory, manifest, packet);
      return verificationRecord({
        trialId: manifest.trialId,
        transmissionSha256: packet.transmissionSha256,
        artifactIntegrity: "verified",
        preflightStatus,
        authorizationStatus,
        executionStatus: result.executionStatus,
        providerOutcome: result.providerOutcome,
        gradeStatus: result.gradeStatus,
        retryPermitted: result.retryPermitted,
        issues,
      });
    } catch (error) {
      return verificationRecord({
        trialId: manifest.trialId,
        transmissionSha256: packet.transmissionSha256,
        artifactIntegrity: "failed",
        preflightStatus,
        authorizationStatus,
        executionStatus: "indeterminate",
        providerOutcome: "undetermined",
        retryPermitted: false,
        issues: [error.message],
      });
    }
  }

  const executionEvidencePaths = [
    "authorization.json",
    "authorization-consumption.json",
    "metrics.json",
    "timing.json",
    "outputs",
  ];
  const hasExecutionEvidence = (
    await Promise.all(
      executionEvidencePaths.map((relativePath) =>
        exists(path.join(trialDirectory, relativePath)),
      ),
    )
  ).some(Boolean);
  if (!hasExecutionEvidence) {
    if (preflightStatus === "failed") {
      return verificationRecord({
        trialId: manifest.trialId,
        transmissionSha256: packet.transmissionSha256,
        artifactIntegrity: "verified",
        preflightStatus,
        authorizationStatus,
        executionStatus: "not-started",
        providerOutcome: "not-started",
        retryPermitted: false,
        issues: ["The zero-turn preflight failed; this trial cannot execute."],
      });
    }
    return verificationRecord({
      trialId: manifest.trialId,
      transmissionSha256: packet.transmissionSha256,
      artifactIntegrity: "verified",
      preflightStatus,
      authorizationStatus,
      executionStatus: "not-started",
      providerOutcome: "not-started",
      retryPermitted: true,
      issues,
    });
  }

  try {
    const authorizationRetained = await validateRetainedAuthorization(
      trialDirectory,
      manifest,
      packet,
    );
    const authorizationConsumed = await validateAuthorizationConsumption(
      trialDirectory,
      manifest,
      packet,
    );
    if (authorizationConsumed && !authorizationRetained) {
      fail("authorization consumption exists without retained authorization");
    }
    const outputsPath = path.join(trialDirectory, "outputs");
    if (await exists(outputsPath)) {
      await recursiveArtifactDescriptors(trialDirectory, "outputs");
    }
    issues.push(
      authorizationConsumed
        ? "Authorization was consumed, but no terminal result sealed the execution evidence."
        : "Execution evidence exists without a terminal result; provider launch state is unresolved.",
    );
    return verificationRecord({
      trialId: manifest.trialId,
      transmissionSha256: packet.transmissionSha256,
      artifactIntegrity: "incomplete",
      preflightStatus,
      authorizationStatus,
      executionStatus: "indeterminate",
      providerOutcome: "undetermined",
      retryPermitted: false,
      issues,
    });
  } catch (error) {
    return verificationRecord({
      trialId: manifest.trialId,
      transmissionSha256: packet.transmissionSha256,
      artifactIntegrity: "failed",
      preflightStatus,
      authorizationStatus,
      executionStatus: "indeterminate",
      providerOutcome: "undetermined",
      retryPermitted: false,
      issues: [error.message],
    });
  }
}
