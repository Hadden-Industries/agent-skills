import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { compileSuite } from "../../../../../scripts/evaluation/compile-suite.js";
import {
  captureWorkingTreeSkillBundle,
  renderSkillBundle,
} from "../../../../../scripts/evaluation/skill-bundle.js";
import {
  extractSkillCompatibility,
  reconcileEvaluationCapabilities,
} from "../../../../../scripts/evaluation/capability-reconciliation.js";
import {
  normalizeEvaluationConversation,
  createScriptedContinuationPolicy,
  createScriptedConversationController,
} from "../../../../../scripts/evaluation/scripted-conversation.js";
import {
  inspectAntigravityCliToolchain,
  antigravityCliAdapter,
} from "../../../../../scripts/evaluation/antigravity-cli.js";
import {
  assertTransmissionPacket,
  canonicalJsonBytes,
  sha256Hex,
  createTransmissionPacket,
  prepareEvidenceSession,
  executeAuthorizedModelSession,
} from "../../../../../scripts/evaluation/runtime.js";

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
export const SKILL_NAME = "naming-objects-in-software-engineering";
export const ARMS = Object.freeze(["no-skill", "candidate-skill"]);
const MODULES = [
  "src/naming-objects-in-software-engineering/evals/assurance/v1/profile.mjs",
  "scripts/evaluation/runtime.js",
  "scripts/evaluation/antigravity-cli.js",
  "scripts/evaluation/scripted-conversation.js",
  "scripts/evaluation/skill-bundle.js",
  "scripts/evaluation/capability-reconciliation.js",
  "scripts/evaluation/compile-suite.js",
  "scripts/evaluation/json-contract.js",
  "scripts/evaluation/profile-registry.js",
  "scripts/evaluation/session-dispatch.js",
  "scripts/evaluation/prepare-consumer-carrier.js",
  "scripts/evaluation/consumer-workspace.js",
  "scripts/evaluation/project-skill-up.js",
  "scripts/evaluation/run-skill-up.js",
  "scripts/evaluation/skill-up-custom-engine.js",
  "scripts/evaluation/derive-reports.js",
  "scripts/skillDistribution.js",
  "scripts/evaluation/schemas/portable.schema.json",
  "scripts/evaluation/schemas/extension.schema.json",
  "scripts/evaluation/toolchain.js",
  "evaluation-toolchain.json",
  "package-lock.json",
  "src/committing-to-git/evals/assurance/v1/create-fixture-repository.mjs",
];
// Historical configuration strings, not verified provider availability or rankings.
export const HISTORICAL_MODEL_PROFILES = Object.freeze({
  judge: "gemini-3.1-pro-high",
  high: "gemini-3.1-pro-high",
  default: "gemini-3.8-flash-medium",
  worker: "gemini-3.8-flash-medium",
  standard: "gemini-3.8-flash-medium",
  low: "gemini-3.6-flash-low",
  stress: "gemini-3.6-flash-low",
});

function fingerprint() {
  const git = (ref) =>
    execFileSync("git", ["rev-parse", ref], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  return {
    gitCommit: git("HEAD"),
    gitTree: git("HEAD^{tree}"),
    modules: MODULES.map((file) => {
      const bytes = readFileSync(path.join(ROOT, file));
      return { path: file, byteLength: bytes.length, sha256: sha256Hex(bytes) };
    }),
  };
}
function record(id, role, content, mediaType = "text/markdown") {
  return {
    id,
    role,
    mediaType,
    encoding: "utf8",
    content,
    byteLength: Buffer.byteLength(content),
    sha256: sha256Hex(Buffer.from(content)),
  };
}
function jsonRecord(id, value) {
  return record(
    id,
    "configuration",
    canonicalJsonBytes(value).toString("utf8"),
    "application/json",
  );
}
function same(a, b) {
  return canonicalJsonBytes(a).equals(canonicalJsonBytes(b));
}

export function namingSchedule(
  compiled = compileSuite({ repositoryRoot: ROOT, skillName: SKILL_NAME }),
) {
  return Object.freeze(
    compiled.definition.calibration_case_ids.flatMap((caseId) =>
      ARMS.map((arm) => Object.freeze({ caseId, arm, repetition: 1 })),
    ),
  );
}

export function namingConversation(evaluationCase, arm, bundle) {
  if (!ARMS.includes(arm)) throw new Error("Unsupported naming arm");
  const prompt =
    arm === "no-skill"
      ? `You are an expert software engineer. Answer the following naming question directly, precisely, and concisely.\n\n${evaluationCase.prompt}`
      : `You are an expert software engineer following the "naming-objects-in-software-engineering" skill.\n\n${renderSkillBundle(bundle)}\n\n[Task]\n${evaluationCase.prompt}`;
  return normalizeEvaluationConversation({ ...evaluationCase, prompt });
}

function reconciliation(cases, bundle) {
  if (cases.some((item) => item.required_capabilities?.length))
    throw new Error(
      "Naming text-only profile does not support required capabilities",
    );
  // Execution policy v1 injects the complete bundle as text. It enables no tools,
  // including the optional Python checker. This is not a claim about tool use.
  const capabilities = {
    network: false,
    webSearch: false,
    tools: [],
    providerFacilities: ["provider-default-context"],
  };
  return reconcileEvaluationCapabilities({
    suite: SKILL_NAME,
    arms: ARMS,
    skillBundles: { "candidate-skill": bundle },
    cases: cases.map((item) => ({ ...item, required_capabilities: [] })),
    contract: {
      schema_version: 1,
      capability_ids: ["bundled-skill-files"],
      arm_requirements: {
        "no-skill": [],
        "candidate-skill": ["bundled-skill-files"],
      },
      compatibility_interpretations: [
        {
          arm: "candidate-skill",
          exact_text: extractSkillCompatibility(bundle).text,
          always_required_capabilities: ["bundled-skill-files"],
          conditional_case_capabilities: [],
        },
      ],
      campaign_policy: {
        default: "deny",
        allowed_capabilities: ["bundled-skill-files"],
        uniform_across_arms: true,
      },
    },
    providerResolution: {
      provider: "google",
      supportedCapabilities: ["bundled-skill-files"],
      enabledCapabilities: ["bundled-skill-files"],
      bindings: [
        {
          capability: "bundled-skill-files",
          mechanism: "packet-bound-user-message",
        },
      ],
      runtimeCapabilities: capabilities,
    },
  });
}

export async function prepareNamingSession({
  destination,
  caseId,
  arm,
  model,
  effort,
  command,
  prefixArguments = [],
  environment,
  workingDirectory,
  timeoutMs,
  consumerProjectionSha256,
}) {
  if (!ARMS.includes(arm)) throw new Error("Unsupported naming arm");
  if (
    typeof model !== "string" ||
    !model.trim() ||
    typeof effort !== "string" ||
    !effort.trim()
  )
    throw new Error("Explicit model and effort are required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new Error("Explicit positive timeoutMs is required");
  if (!path.isAbsolute(workingDirectory))
    throw new Error("Working directory must be absolute");
  if (
    consumerProjectionSha256 !== undefined &&
    !/^[a-f0-9]{64}$/u.test(consumerProjectionSha256)
  )
    throw new Error("Invalid consumer projection identity");
  const compiled = compileSuite({
    repositoryRoot: ROOT,
    skillName: SKILL_NAME,
  });
  const evaluationCase = compiled.definition.evals.find(
    ({ id }) => id === caseId,
  );
  if (!evaluationCase) throw new Error("Unknown naming case");
  const bundle = captureWorkingTreeSkillBundle({
    repositoryRoot: ROOT,
    skillName: SKILL_NAME,
  });
  const capabilityReconciliation = reconciliation(
    compiled.definition.evals,
    bundle,
  );
  const conversation = namingConversation(evaluationCase, arm, bundle);
  const toolchain = await inspectAntigravityCliToolchain({
    command,
    prefixArguments,
    environment,
  });
  const inputs = [
    ...conversation.map(({ id, input }, index) =>
      record(id, index === 0 ? "user" : "continuation", input.text),
    ),
    jsonRecord("evaluation-case", evaluationCase),
    jsonRecord("runner-settings", {
      executionTimeoutMs: timeoutMs,
      executionPolicy: "naming-text-only-v1",
    }),
    ...(arm === "candidate-skill" ? [jsonRecord("skill-bundle", bundle)] : []),
  ];
  const runtimeFingerprint = fingerprint();
  const packet = createTransmissionPacket({
    suite: SKILL_NAME,
    session: {
      preparedSessionId: randomBytes(16).toString("hex"),
      caseId,
      arm,
      repetition: 1,
      sequence: 1,
      suiteArtifacts: [],
      metadata: {
        compiledSuiteSha256: compiled.compiledSuiteSha256,
        capabilityReconciliationSha256: capabilityReconciliation.receiptSha256,
        skillBundleAggregateSha256:
          arm === "candidate-skill" ? bundle.aggregateSha256 : null,
        ...(consumerProjectionSha256 ? { consumerProjectionSha256 } : {}),
      },
    },
    provider: "google",
    model,
    effort,
    transport: "antigravity-cli",
    toolchain,
    runtimeFingerprint,
    capabilityReconciliation,
    capabilities: capabilityReconciliation.receipt.runtimeCapabilities,
    isolation: {
      sandbox: "read-only",
      workingDirectory,
      instructionSources: ["packet-bound-user-message"],
      persistence: false,
      stableHome: null,
      environment: { values: environment, secretSources: [] },
    },
    harnessControlledInputs: inputs,
    continuationPolicy: createScriptedContinuationPolicy({
      conversation,
      controllerSha256: runtimeFingerprint.modules[0].sha256,
    }),
  });
  return prepareEvidenceSession({
    destination,
    packet,
    inputs: inputs.map(({ id, mediaType, content }) => ({
      id,
      mediaType,
      bytes: Buffer.from(content),
    })),
  });
}

export async function executePreparedNamingSession({
  preparedSession,
  authorization,
  allowExternalModelCall,
  evidenceLayout = "legacy-v1",
  signal,
}) {
  const packet = JSON.parse(
    readFileSync(path.join(preparedSession, "packet.json"), "utf8"),
  );
  assertTransmissionPacket(packet);
  const transmission = packet.transmission;
  if (
    transmission.suite !== SKILL_NAME ||
    transmission.provider !== "google" ||
    transmission.transport !== "antigravity-cli"
  )
    throw new Error("Unsupported naming provider or suite");
  const get = (id) =>
    transmission.harnessControlledInputs.find((input) => input.id === id)
      ?.content;
  const evaluationCase = JSON.parse(get("evaluation-case"));
  const bundle =
    transmission.session.arm === "candidate-skill"
      ? JSON.parse(get("skill-bundle"))
      : null;
  const conversation = namingConversation(
    evaluationCase,
    transmission.session.arm,
    bundle,
  );
  const settings = JSON.parse(get("runner-settings"));
  if (
    !Number.isSafeInteger(settings.executionTimeoutMs) ||
    settings.executionTimeoutMs < 1 ||
    settings.executionPolicy !== "naming-text-only-v1"
  )
    throw new Error("Invalid naming runtime settings");
  const controller = createScriptedConversationController({
    conversation,
    completeResult: ({ finalAnswer }) => ({
      finalAnswer,
      gradingStatus: "not-graded",
      semanticCertified: false,
    }),
  });
  return executeAuthorizedModelSession({
    preparedSession,
    authorization,
    allowExternalModelCall,
    evidenceLayout,
    signal,
    adapter: antigravityCliAdapter,
    request: Object.freeze({
      toolchain: transmission.toolchain,
      controller,
      timeoutMs: settings.executionTimeoutMs,
    }),
    assertCurrent: async (current) => {
      const compiled = compileSuite({
        repositoryRoot: ROOT,
        skillName: SKILL_NAME,
      });
      if (
        !same(current, transmission) ||
        !same(fingerprint(), transmission.runtimeFingerprint) ||
        compiled.compiledSuiteSha256 !==
          transmission.session.metadata.compiledSuiteSha256
      )
        throw new Error("Prepared naming source or runtime is stale");
      const currentCase = compiled.definition.evals.find(
        ({ id }) => id === transmission.session.caseId,
      );
      if (!same(currentCase, evaluationCase))
        throw new Error("Prepared naming case changed");
      const currentBundle = captureWorkingTreeSkillBundle({
        repositoryRoot: ROOT,
        skillName: SKILL_NAME,
      });
      if (
        !same(
          reconciliation(compiled.definition.evals, currentBundle),
          transmission.capabilityReconciliation,
        )
      )
        throw new Error("Naming capability policy changed");
      if (bundle && !same(currentBundle, bundle))
        throw new Error("Prepared naming bundle changed");
      const expected = createScriptedContinuationPolicy({
        conversation,
        controllerSha256: fingerprint().modules[0].sha256,
      });
      if (!same(expected, transmission.continuationPolicy))
        throw new Error("Naming conversation policy changed");
    },
  });
}
