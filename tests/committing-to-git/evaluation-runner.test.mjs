import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import {
  EXACT_COMMIT_AUTHORIZATION_REPLY,
  createCommittingToGitController,
} from "../../evals/committing-to-git/session-controller.mjs";
import {
  EVALUATION_ARMS,
  EVALUATION_CASE_IDS,
  EVALUATION_MODELS,
  PINNED_SKILL_COMMITS,
  buildEvaluationSchedule,
  createBlindedGradingBundle,
  discoverRuntimeIsolationCatalog,
  executePreparedEvaluationSession,
  preflightPreparedEvaluationSession,
  prepareEvaluationSession,
} from "../../evals/committing-to-git/evaluation-runner.mjs";
import { inspectCodexAppServerToolchain } from "../../scripts/evaluation/codex-app-server.js";
import {
  initializeEvaluationHomes,
  withEvaluationHome,
} from "../../scripts/evaluation/evaluation-homes.js";
import { EXTERNAL_MODEL_AUTHORIZATION_STATEMENT } from "../../scripts/evaluation/runtime.js";

const REPOSITORY_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const FAKE_APP_SERVER = join(
  REPOSITORY_ROOT,
  "tests",
  "committing-to-git",
  "fixtures",
  "fake-app-server.mjs",
);
const RUNNER_CLI = join(
  REPOSITORY_ROOT,
  "evals",
  "committing-to-git",
  "run-evaluation-session.mjs",
);

function temporaryRoot(t, prefix = "committing-to-git-runner-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function testEnvironment(scenario = "authorized") {
  const environment = {
    FAKE_APP_SERVER_SCENARIO: scenario,
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
      if (typeof process.env[name] === "string")
        environment[name] = process.env[name];
    }
  }
  return environment;
}

let cachedToolchain;

async function toolchain(root) {
  const environment = { PATH: process.env.PATH ?? "" };
  if (typeof process.env.PATHEXT === "string") {
    environment.PATHEXT = process.env.PATHEXT;
  }
  cachedToolchain ??= inspectCodexAppServerToolchain({
    command: process.execPath,
    prefixArguments: [FAKE_APP_SERVER],
    scratchRoot: join(root, "toolchain"),
    environment,
  });
  return cachedToolchain;
}

async function preparedFixture(t, options = {}) {
  const root = temporaryRoot(t);
  const homes = join(root, "evaluation-homes-v1");
  if (options.initializeHomes !== false) {
    await initializeEvaluationHomes({ root: homes });
  }
  const environment = testEnvironment(options.scenario);
  const inspectedToolchain = await toolchain(root);
  const prepared = await prepareEvaluationSession({
    arm: options.arm ?? "no-skill",
    authorizationEligible: options.authorizationEligible ?? true,
    caseId: options.caseId ?? 35,
    destination: join(root, "prepared"),
    effort: "low",
    evaluationHomesRoot: homes,
    environment,
    model: "gpt-5.6-luna",
    predeterminedScopeId: options.predeterminedScopeId,
    provider: "openai",
    repetition: 1,
    repositoryRoot: REPOSITORY_ROOT,
    runtimeIsolationCatalog: {
      appIds: [],
      mcpServerIds: [],
      pluginIds: [],
      skillPaths: [],
    },
    runtimeIsolationDiscovery: null,
    seed: "task-6-seed",
    sequence: 1,
    toolchain: inspectedToolchain,
  });
  return { homes, prepared, root };
}

function authorization(packet, overrides = {}) {
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

function observedLaunchOrder(prepared, homes, result) {
  const events = ["evidence-acquired"];
  if (!existsSync(join(prepared.preparedSession, "authorization.json"))) {
    return events;
  }
  events.push("authorization-validated");
  if (result.failureClass === "preflight-rejected") return events;
  events.push("current-state-validated");
  const operationId = prepared.packet.transmission.session.preparedSessionId;
  const history = existsSync(join(homes, ".history"))
    ? readdirSync(join(homes, ".history"))
    : [];
  if (!history.some((name) => name.startsWith(`${operationId}-execution-`))) {
    return events;
  }
  events.push("home-acquired");
  if (!existsSync(join(prepared.preparedSession, "attempt.json")))
    return events;
  events.push("launch-consumed");
  const transcript = join(
    prepared.preparedSession,
    "outputs",
    "transcript.jsonl",
  );
  if (existsSync(transcript) && readFileSync(transcript).byteLength > 0) {
    events.push("app-server-spawned");
  }
  return events;
}

test("controller sends exact authorization once after a valid proposal", async (t) => {
  const fixtureRoot = temporaryRoot(t);
  const state = Object.freeze({ sha256: "a".repeat(64) });
  const controller = createCommittingToGitController({
    session: Object.freeze({
      initialInput: Object.freeze([
        Object.freeze({ type: "text", text: "packet-bound Git task" }),
      ]),
      fixtureRoot,
      expectedScope: Object.freeze({
        kind: "paths",
        paths: Object.freeze(["skills-lock.json"]),
      }),
      scopeClarification: null,
      authorizationEligible: true,
      approvalPolicy: Object.freeze({ readableRoots: Object.freeze([]) }),
    }),
    observeGitState: () => state,
  });
  const decision = await controller.onTurnCompleted({
    turnIndex: 1,
    status: "completed",
    finalAnswer:
      '<EVALUATION_COMMIT_PROPOSAL>\n{"message":"chore(skills): Update inventory\\n","push":false,"scope":{"kind":"paths","paths":["skills-lock.json"]}}\n</EVALUATION_COMMIT_PROPOSAL>',
    nativeUsage: null,
    nativeEventRange: { first: 4, last: 9 },
  });
  assert.equal(controller.maxTurns, 2);
  assert.deepEqual(decision, {
    action: "continue",
    transitionId: "exact-commit-authorization",
    input: [{ type: "text", text: EXACT_COMMIT_AUTHORIZATION_REPLY }],
  });
  const completed = await controller.onTurnCompleted({
    turnIndex: 2,
    status: "completed",
    finalAnswer: "Commit created locally.",
    nativeUsage: null,
    nativeEventRange: { first: 10, last: 14 },
  });
  assert.deepEqual(completed.suiteResult.commitAuthorization, {
    reply: EXACT_COMMIT_AUTHORIZATION_REPLY,
    status: "sent",
  });
});

test("controller withholds invalid proposals and changed-scope replies", async (t) => {
  const fixtureRoot = temporaryRoot(t);
  let observations = 0;
  const controller = createCommittingToGitController({
    session: Object.freeze({
      initialInput: Object.freeze([
        Object.freeze({ type: "text", text: "packet-bound Git task" }),
      ]),
      fixtureRoot,
      expectedScope: Object.freeze({
        kind: "paths",
        paths: Object.freeze(["skills-lock.json"]),
      }),
      scopeClarification: Object.freeze({
        options: Object.freeze({
          inventory: Object.freeze(["skills-lock.json"]),
          skill: Object.freeze(["skills/committing-to-git/SKILL.md"]),
        }),
        predeterminedScopeId: "inventory",
      }),
      authorizationEligible: true,
      approvalPolicy: Object.freeze({ readableRoots: Object.freeze([]) }),
    }),
    observeGitState: () => {
      observations += 1;
      return { sha256: (observations === 1 ? "a" : "b").repeat(64) };
    },
  });
  const result = await controller.onTurnCompleted({
    turnIndex: 1,
    status: "completed",
    finalAnswer:
      '<EVALUATION_SCOPE_QUESTION>\n{"options":{"inventory":["skills-lock.json"],"skill":["skills/committing-to-git/SKILL.md"]}}\n</EVALUATION_SCOPE_QUESTION>',
    nativeUsage: null,
    nativeEventRange: { first: 1, last: 2 },
  });
  assert.equal(observations, 2);
  assert.deepEqual(result.suiteResult.clarification, {
    reason: "fixture state changed before scope clarification",
    stateUnchanged: false,
    status: "withheld",
  });
});

test("controller sends only the exact predetermined scope reply", async (t) => {
  const fixtureRoot = temporaryRoot(t);
  const options = Object.freeze({
    inventory: Object.freeze(["skills-lock.json"]),
    skill: Object.freeze(["skills/committing-to-git/SKILL.md"]),
  });
  const session = Object.freeze({
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "task" }),
    ]),
    fixtureRoot,
    expectedScope: Object.freeze({ kind: "paths", paths: options.inventory }),
    scopeClarification: Object.freeze({
      options,
      predeterminedScopeId: "inventory",
    }),
    authorizationEligible: true,
    approvalPolicy: Object.freeze({ readableRoots: Object.freeze([]) }),
  });
  const unchanged = () => ({ sha256: "a".repeat(64) });
  const valid = createCommittingToGitController({
    session,
    observeGitState: unchanged,
  });
  const reply =
    '<EVALUATION_SCOPE_SELECTION>\n{"paths":["skills-lock.json"],"scopeId":"inventory"}\n</EVALUATION_SCOPE_SELECTION>';
  assert.deepEqual(
    await valid.onTurnCompleted({
      turnIndex: 1,
      status: "completed",
      finalAnswer:
        '<EVALUATION_SCOPE_QUESTION>\n{"options":{"skill":["skills/committing-to-git/SKILL.md"],"inventory":["skills-lock.json"]}}\n</EVALUATION_SCOPE_QUESTION>',
    }),
    {
      action: "continue",
      transitionId: "predetermined-scope-selection",
      input: [{ type: "text", text: reply }],
    },
  );

  const invalid = createCommittingToGitController({
    session,
    observeGitState: unchanged,
  });
  const rejected = await invalid.onTurnCompleted({
    turnIndex: 1,
    status: "completed",
    finalAnswer:
      '<EVALUATION_SCOPE_QUESTION>\n{"options":{"inventory":["skills-lock.json"],"extra":["other.txt"]}}\n</EVALUATION_SCOPE_QUESTION>',
  });
  assert.equal(rejected.action, "complete");
  assert.equal(rejected.suiteResult.clarification.status, "withheld");
  assert.match(
    rejected.suiteResult.clarification.reason,
    /every exact plausible scope/u,
  );
});

test("controller withholds authorization for invalid output or changed Git state", async (t) => {
  const fixtureRoot = temporaryRoot(t);
  const session = Object.freeze({
    initialInput: Object.freeze([
      Object.freeze({ type: "text", text: "task" }),
    ]),
    fixtureRoot,
    expectedScope: Object.freeze({
      kind: "paths",
      paths: Object.freeze(["skills-lock.json"]),
    }),
    scopeClarification: null,
    authorizationEligible: true,
    approvalPolicy: Object.freeze({ readableRoots: Object.freeze([]) }),
  });
  const malformed = createCommittingToGitController({
    session,
    observeGitState: () => ({ sha256: "a".repeat(64) }),
  });
  const malformedResult = await malformed.onTurnCompleted({
    turnIndex: 1,
    status: "completed",
    finalAnswer: "No structured proposal.",
  });
  assert.equal(
    malformedResult.suiteResult.commitAuthorization.status,
    "withheld",
  );
  assert.match(
    malformedResult.suiteResult.commitAuthorization.reason,
    /exactly one/u,
  );

  let observations = 0;
  const changed = createCommittingToGitController({
    session,
    observeGitState: () => ({
      sha256: (observations++ === 0 ? "a" : "b").repeat(64),
    }),
  });
  const changedResult = await changed.onTurnCompleted({
    turnIndex: 1,
    status: "completed",
    finalAnswer:
      '<EVALUATION_COMMIT_PROPOSAL>\n{"message":"chore(skills): Update inventory\\n","push":false,"scope":{"kind":"paths","paths":["skills-lock.json"]}}\n</EVALUATION_COMMIT_PROPOSAL>',
  });
  assert.deepEqual(changedResult.suiteResult.commitAuthorization, {
    reason: "fixture state changed before commit authorization",
    status: "withheld",
  });
});

test("controller grants only fixture-scoped one-turn permissions", async (t) => {
  const fixtureRoot = temporaryRoot(t);
  const controller = createCommittingToGitController({
    session: Object.freeze({
      initialInput: Object.freeze([
        Object.freeze({ type: "text", text: "task" }),
      ]),
      fixtureRoot,
      expectedScope: Object.freeze({
        kind: "paths",
        paths: Object.freeze(["a.txt"]),
      }),
      scopeClarification: null,
      authorizationEligible: false,
      approvalPolicy: Object.freeze({ readableRoots: Object.freeze([]) }),
    }),
    observeGitState: () => ({ sha256: "a".repeat(64) }),
  });
  const permissions = { fileSystem: { write: [join(fixtureRoot, "a.txt")] } };
  assert.deepEqual(
    await controller.onApprovalRequest({
      kind: "filesystem",
      cwd: fixtureRoot,
      permissions,
      turnIndex: 1,
      nativeEventIndex: 2,
      command: null,
    }),
    {
      decision: "allow",
      permissions,
      reason: "fixture-scoped turn permission",
      scope: "turn",
    },
  );
  assert.deepEqual(
    await controller.onApprovalRequest({
      kind: "network",
      cwd: fixtureRoot,
      permissions: { network: { enabled: true } },
      turnIndex: 1,
      nativeEventIndex: 3,
      command: "curl example.test",
    }),
    {
      decision: "deny",
      reason: "network, external, or out-of-fixture access denied",
    },
  );
});

test("evaluation runner exports only the migrated orchestration surface", async () => {
  const runner =
    await import("../../evals/committing-to-git/evaluation-runner.mjs");
  assert.deepEqual(Object.keys(runner).sort(), [
    "EVALUATION_ARMS",
    "EVALUATION_CASE_IDS",
    "EVALUATION_MODELS",
    "PINNED_SKILL_COMMITS",
    "buildEvaluationSchedule",
    "captureGitState",
    "createBlindedGradingBundle",
    "discoverRuntimeIsolationCatalog",
    "executePreparedEvaluationSession",
    "preflightPreparedEvaluationSession",
    "prepareEvaluationSession",
  ]);
});

test("the seeded matrix remains 306 deterministic matched sessions", () => {
  const first = buildEvaluationSchedule("step-3-seed");
  assert.equal(first.length, 306);
  assert.deepEqual(first, buildEvaluationSchedule("step-3-seed"));
  assert.notDeepEqual(first, buildEvaluationSchedule("different-seed"));
  for (let index = 0; index < first.length; index += 3) {
    assert.deepEqual(
      new Set(first.slice(index, index + 3).map(({ arm }) => arm)),
      new Set(EVALUATION_ARMS),
    );
  }
  assert.deepEqual(
    EVALUATION_CASE_IDS,
    [4, 7, 18, 28, 35, 36, 37, 39, 40, 41, 42, 47, 49, 50, 53, 54, 55],
  );
  assert.equal(EVALUATION_MODELS[0].repetitions, 5);
  assert.deepEqual(PINNED_SKILL_COMMITS, {
    "old-skill": "76baa9b25e0afeaa2c62c4cf7042976444edc15e",
    "new-skill": "ec064b1f8177d9542a82f478ca3b1ce5e44ee702",
  });
});

test("preparation writes a common packet without packet-local runtime homes", async (t) => {
  const { prepared } = await preparedFixture(t, {
    arm: "old-skill",
    initializeHomes: false,
  });
  assert.equal(existsSync(join(prepared.preparedSession, "packet.json")), true);
  assert.equal(
    existsSync(join(prepared.preparedSession, "inputs", "manifest.json")),
    true,
  );
  assert.equal(
    existsSync(join(prepared.preparedSession, "fixture", ".git")),
    true,
  );
  assert.equal(
    existsSync(join(prepared.preparedSession, "treatment", "SKILL.md")),
    true,
  );
  assert.equal(
    existsSync(join(prepared.preparedSession, "runtime-home-preflight")),
    false,
  );
  assert.equal(
    existsSync(join(prepared.preparedSession, "runtime-home-run")),
    false,
  );
  const packet = JSON.parse(
    readFileSync(join(prepared.preparedSession, "packet.json"), "utf8"),
  );
  assert.equal(packet.canonicalization, "RFC8785");
  assert.equal(packet.transmission.transport, "codex-app-server");
  assert.equal(packet.transmission.capabilities.network, false);
  assert.equal(packet.transmission.session.arm, "old-skill");
  assert.equal(packet.transmission.continuationPolicy.maxTurns, 2);
  assert.match(packet.transmissionSha256, /^[0-9a-f]{64}$/u);
  assert.match(
    packet.transmission.harnessControlledInputs.find(
      ({ id }) => id === "developer-instructions",
    ).content,
    /# Task-specific skill/u,
  );
});

test("digest rejection occurs before home acquisition or App Server launch", async (t) => {
  const { homes, prepared } = await preparedFixture(t, {
    initializeHomes: false,
  });
  const result = await executePreparedEvaluationSession({
    preparedSession: prepared,
    authorization: authorization(prepared.packet, {
      transmissionSha256: "0".repeat(64),
    }),
    allowExternalModelCall: true,
    timeoutMs: 5_000,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "authorization-rejected");
  assert.equal(
    existsSync(join(prepared.preparedSession, "attempt.json")),
    false,
  );
  assert.equal(existsSync(homes), false);
  assert.deepEqual(observedLaunchOrder(prepared, homes, result), [
    "evidence-acquired",
  ]);
});

test("fixture drift is rejected after authorization and before home acquisition", async (t) => {
  const { homes, prepared } = await preparedFixture(t, {
    initializeHomes: false,
  });
  writeFileSync(join(prepared.fixtureRoot, "drift.txt"), "changed\n", "utf8");
  const result = await executePreparedEvaluationSession({
    preparedSession: prepared,
    authorization: authorization(prepared.packet),
    allowExternalModelCall: true,
    timeoutMs: 5_000,
  });
  assert.equal(result.failureClass, "preflight-rejected");
  assert.deepEqual(observedLaunchOrder(prepared, homes, result), [
    "evidence-acquired",
    "authorization-validated",
  ]);
});

test("preflight uses the stable preflight role and starts no model turn", async (t) => {
  const { homes, prepared } = await preparedFixture(t, {
    scenario: "authorized",
  });
  const result = await preflightPreparedEvaluationSession({
    preparedSession: prepared,
    allowZeroTurnPreflight: true,
    timeoutMs: 5_000,
  });
  assert.equal(result.status, "completed", result.error?.message);
  assert.equal(
    readdirSync(join(homes, ".history")).some((name) =>
      name.includes("-preflight-"),
    ),
    true,
  );
  assert.equal(
    existsSync(join(prepared.preparedSession, "attempt.json")),
    false,
  );
});

test("authorized execution uses the stable execution role and common evidence", async (t) => {
  const { homes, prepared } = await preparedFixture(t, {
    scenario: "authorized",
  });
  const result = await executePreparedEvaluationSession({
    preparedSession: prepared,
    authorization: authorization(prepared.packet),
    allowExternalModelCall: true,
    timeoutMs: 5_000,
  });
  assert.equal(result.status, "completed", result.error?.message);
  assert.equal(result.suiteResult.commitAuthorization.status, "sent");
  assert.equal(
    existsSync(join(prepared.preparedSession, "attempt.json")),
    true,
  );
  assert.equal(
    existsSync(join(prepared.preparedSession, "outputs", "events.jsonl")),
    true,
  );
  assert.equal(
    readdirSync(join(homes, ".history")).some((name) =>
      name.includes("-execution-"),
    ),
    true,
  );
  assert.deepEqual(observedLaunchOrder(prepared, homes, result), [
    "evidence-acquired",
    "authorization-validated",
    "current-state-validated",
    "home-acquired",
    "launch-consumed",
    "app-server-spawned",
  ]);
});

test("execution-home contention stops after current-state validation", async (t) => {
  const { homes, prepared } = await preparedFixture(t);
  await withEvaluationHome(
    { root: homes, role: "execution", operationId: "f".repeat(32) },
    async () => {
      const result = await executePreparedEvaluationSession({
        preparedSession: prepared,
        authorization: authorization(prepared.packet),
        allowExternalModelCall: true,
        timeoutMs: 5_000,
      });
      assert.equal(result.failureClass, "provider-failed");
      assert.equal(
        existsSync(join(prepared.preparedSession, "run.json")),
        true,
      );
      assert.deepEqual(observedLaunchOrder(prepared, homes, result), [
        "evidence-acquired",
        "authorization-validated",
        "current-state-validated",
      ]);
      return {
        value: null,
        release: {
          status: "safe",
          exitStatus: "not-started",
          exitCode: null,
          exitSignal: null,
          stdioStatus: "not-opened",
          protocolStatus: "not-opened",
          terminationActions: [],
          descendantStatus: "none-observed",
        },
      };
    },
  );
});

test("blinding retains failures while removing treatment identities", () => {
  const records = EVALUATION_ARMS.map((arm, index) => ({
    arm,
    case: { id: 35 },
    effort: "low",
    model: "gpt-5.6-luna",
    order: { blockId: "gpt-5.6-luna/low/35/1", sequence: index + 1 },
    provider: "openai",
    sourceCommit: PINNED_SKILL_COMMITS[arm] ?? null,
    status: index === 0 ? "failed" : "completed",
    transmissionSha256: String(index).repeat(64),
  }));
  const bundle = createBlindedGradingBundle({ records, seed: "blind-seed" });
  assert.equal(bundle.gradingPackage.sessions.length, 3);
  assert.match(JSON.stringify(bundle.gradingPackage), /failed/u);
  assert.doesNotMatch(
    JSON.stringify(bundle.gradingPackage),
    /old-skill|new-skill|no-skill/u,
  );
});

test("catalog discovery remains read-only and deterministic", (t) => {
  const root = temporaryRoot(t);
  const codexHome = join(root, "codex-home");
  const emptyRepository = join(root, "repository");
  writeFileSync(join(root, "placeholder"), "", "utf8");
  const first = discoverRuntimeIsolationCatalog({
    codexHome,
    repositoryRoot: emptyRepository,
  });
  const second = discoverRuntimeIsolationCatalog({
    codexHome,
    repositoryRoot: emptyRepository,
  });
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    appIds: [],
    mcpServerIds: [],
    pluginIds: [],
    skillPaths: [],
  });
  assert.equal(existsSync(codexHome), false);
});

test("CLI plan remains deterministic and performs no model execution", () => {
  const result = spawnSync(
    process.execPath,
    [RUNNER_CLI, "plan", "--seed", "cli-seed"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.modelCalls, 0);
  assert.equal(output.sessions.length, 306);
});

test("CLI run and preflight reject obsolete path-redirection flags", () => {
  for (const command of ["run", "preflight"]) {
    const result = spawnSync(
      process.execPath,
      [RUNNER_CLI, command, "--packet", "redirected.json"],
      { cwd: REPOSITORY_ROOT, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--packet is not valid/u);
  }
});

test("CLI blind enriches common run records from their packet metadata", async (t) => {
  const root = temporaryRoot(t, "committing-to-git-blind-");
  const recordPaths = [];
  for (const [index, arm] of EVALUATION_ARMS.entries()) {
    const { prepared } = await preparedFixture(t, {
      arm,
      initializeHomes: false,
    });
    const runPath = join(prepared.preparedSession, "run.json");
    writeFileSync(
      runPath,
      `${JSON.stringify({
        schemaVersion: 1,
        transmissionSha256: prepared.packet.transmissionSha256,
        status: index === 0 ? "failed" : "completed",
        failureClass: index === 0 ? "provider-failed" : null,
        error:
          index === 0
            ? { name: "Error", code: null, message: "retained" }
            : null,
        closure: { status: "safe" },
        suiteResult: null,
        artifacts: {},
      })}\n`,
      "utf8",
    );
    recordPaths.push(runPath);
  }
  const manifest = join(root, "records.json");
  const packagePath = join(root, "package.json");
  const mappingPath = join(root, "mapping.json");
  writeFileSync(
    manifest,
    `${JSON.stringify({ records: recordPaths })}\n`,
    "utf8",
  );
  const result = spawnSync(
    process.execPath,
    [
      RUNNER_CLI,
      "blind",
      "--records-manifest",
      manifest,
      "--seed",
      "blind-cli-seed",
      "--package",
      packagePath,
      "--mapping",
      mappingPath,
    ],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const gradingPackage = readFileSync(packagePath, "utf8");
  assert.doesNotMatch(gradingPackage, /no-skill|old-skill|new-skill/u);
  assert.match(gradingPackage, /provider-failed/u);
  const mapping = readFileSync(mappingPath, "utf8");
  assert.match(mapping, /no-skill/u);
  assert.match(mapping, /old-skill/u);
  assert.match(mapping, /new-skill/u);
});
