import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
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
  BASELINE_SKILL_COMMIT,
  DEFERRED_CALIBRATION_MODEL,
  EVALUATION_ARMS,
  EVALUATION_CASE_IDS,
  EVALUATION_MODELS,
  assertEvaluationCampaignRepositoryCurrent,
  buildEvaluationSchedule,
  buildPolicyEvaluationSchedule,
  createBlindedGradingBundle,
  createEvaluationCampaignPlan,
  createPolicyEvaluationCampaignPlan,
  discoverRuntimeIsolationCatalog,
  executePreparedEvaluationSession,
  listPolicyEvaluationCaseIds,
  preflightPreparedEvaluationSession,
  prepareEvaluationSession,
  preparePolicyEvaluationSession,
  resolvePushedEvaluationCandidate,
  selectEvaluationCampaignSession,
} from "../../evals/committing-to-git/evaluation-runner.mjs";
import { inspectAntigravityCliToolchain } from "../../scripts/evaluation/antigravity-cli.js";
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
const FAKE_ANTIGRAVITY = join(
  REPOSITORY_ROOT,
  "tests",
  "scripts",
  "fixtures",
  "fake-antigravity-cli.mjs",
);
const CURRENT_COMMIT = runGit(REPOSITORY_ROOT, [
  "rev-parse",
  "--verify",
  "HEAD^{commit}",
]);
const TEST_CAMPAIGN_ID = "c".repeat(64);
const PINNED_RUNNER_FILES = Object.freeze([
  "package.json",
  "evals/committing-to-git/create-fixture-repository.mjs",
  "evals/committing-to-git/evaluation-runner.mjs",
  "evals/committing-to-git/evals.json",
  "evals/committing-to-git/run-evaluation-session.mjs",
  "evals/committing-to-git/session-controller.mjs",
  "scripts/evaluation/antigravity-cli.js",
  "scripts/evaluation/codex-app-server.js",
  "scripts/evaluation/evaluation-homes.js",
  "scripts/evaluation/runtime.js",
]);

function temporaryRoot(t, prefix = "committing-to-git-runner-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runGit(repository, args) {
  const result = spawnSync("git", args, {
    cwd: repository,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
  );
  return result.stdout.trim();
}

function createPushedCandidateRepository(t, { includeBaseline = true } = {}) {
  const root = temporaryRoot(t, "committing-to-git-candidate-");
  const remote = join(root, "remote.git");
  const repository = join(root, "repository");
  mkdirSync(repository);
  runGit(root, ["init", "--bare", remote]);
  runGit(repository, ["init"]);
  if (includeBaseline) {
    runGit(repository, ["fetch", REPOSITORY_ROOT, BASELINE_SKILL_COMMIT]);
  }
  runGit(repository, ["config", "user.email", "eval@example.test"]);
  runGit(repository, ["config", "user.name", "Evaluation Fixture"]);
  mkdirSync(join(repository, "skills", "committing-to-git"), {
    recursive: true,
  });
  writeFileSync(
    join(repository, "skills", "committing-to-git", "SKILL.md"),
    "---\nname: committing-to-git\ndescription: Fixture\n---\n",
    "utf8",
  );
  for (const path of PINNED_RUNNER_FILES) {
    const destination = join(repository, ...path.split("/"));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(join(REPOSITORY_ROOT, path)));
  }
  runGit(repository, ["add", "evals", "package.json", "scripts", "skills"]);
  runGit(repository, ["commit", "-m", "test: Add candidate skill"]);
  runGit(repository, ["branch", "-M", "main"]);
  runGit(repository, ["remote", "add", "origin", remote]);
  runGit(repository, ["push", "--set-upstream", "origin", "main"]);
  return { repository, remote };
}

function treatmentCommit(arm) {
  if (arm === "old-skill") return BASELINE_SKILL_COMMIT;
  if (arm === "new-skill") return CURRENT_COMMIT;
  return null;
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
  const arm = options.arm ?? "no-skill";
  const prepared = await prepareEvaluationSession({
    arm,
    authorizationEligible: options.authorizationEligible ?? true,
    campaignId: TEST_CAMPAIGN_ID,
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
    sourceCommit: treatmentCommit(arm),
    toolchain: inspectedToolchain,
  });
  return { homes, prepared, root };
}

async function policyPreparedFixture(t, options = {}) {
  const root = temporaryRoot(t, "committing-to-git-policy-");
  const workingDirectory = join(root, "working");
  mkdirSync(workingDirectory);
  const recordFile = join(root, "antigravity.jsonl");
  const environment = testEnvironment();
  delete environment.FAKE_APP_SERVER_SCENARIO;
  environment.EVALUATION_VISIBLE = "policy-packet";
  const inspectedToolchain = await inspectAntigravityCliToolchain({
    command: process.execPath,
    prefixArguments: [
      FAKE_ANTIGRAVITY,
      "--record-file",
      recordFile,
      "--scenario",
      options.scenario ?? "happy",
    ],
    environment,
  });
  const arm = options.arm ?? "new-skill";
  const prepared = await preparePolicyEvaluationSession({
    arm,
    campaignId: TEST_CAMPAIGN_ID,
    caseId: options.caseId ?? 3,
    destination: join(root, "prepared"),
    effort: "low",
    environment,
    model: "gemini-3.5-flash-low",
    provider: options.provider ?? "google",
    repetition: 1,
    repositoryRoot: REPOSITORY_ROOT,
    seed: "google-policy-seed",
    sequence: 1,
    sourceCommit: treatmentCommit(arm),
    toolchain: inspectedToolchain,
    workingDirectory,
  });
  return { prepared, recordFile, root, workingDirectory };
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
    "BASELINE_SKILL_COMMIT",
    "DEFERRED_CALIBRATION_MODEL",
    "EVALUATION_ARMS",
    "EVALUATION_CASE_IDS",
    "EVALUATION_MODELS",
    "assertEvaluationCampaignRepositoryCurrent",
    "buildEvaluationSchedule",
    "buildPolicyEvaluationSchedule",
    "captureGitState",
    "createBlindedGradingBundle",
    "createEvaluationCampaignPlan",
    "createPolicyEvaluationCampaignPlan",
    "discoverRuntimeIsolationCatalog",
    "executePreparedEvaluationSession",
    "listPolicyEvaluationCaseIds",
    "preflightPreparedEvaluationSession",
    "prepareEvaluationSession",
    "preparePolicyEvaluationSession",
    "resolvePushedEvaluationCandidate",
    "selectEvaluationCampaignSession",
  ]);
});

test("the initial campaign schedules one matched Spark repetition and defers default-effort Sol", () => {
  const candidate = {
    branch: "main",
    commitOid: "a".repeat(40),
    remote: "origin",
    remoteRef: "refs/heads/main",
    verification: "git-ls-remote",
  };
  const first = createEvaluationCampaignPlan({
    candidate,
    seed: "step-3-seed",
  });
  assert.equal(first.sessions.length, 81);
  assert.deepEqual(
    first,
    createEvaluationCampaignPlan({ candidate, seed: "step-3-seed" }),
  );
  assert.notDeepEqual(
    first.sessions,
    createEvaluationCampaignPlan({
      candidate,
      seed: "different-seed",
    }).sessions,
  );
  assert.deepEqual(
    first.sessions,
    buildEvaluationSchedule({
      candidateCommit: candidate.commitOid,
      seed: "step-3-seed",
    }),
  );
  assert.equal(first.candidate.commitOid, candidate.commitOid);
  assert.deepEqual(first.integrity, {
    canonicalization: "RFC8785",
    digestAlgorithm: "SHA-256",
    digestField: "campaignId",
  });
  assert.equal(
    first.pinnedRepositoryPaths.includes("skills/committing-to-git"),
    true,
  );
  assert.equal(
    first.pinnedRepositoryPaths.includes(
      "evals/committing-to-git/evaluation-runner.mjs",
    ),
    true,
  );
  assert.equal(first.deferredCalibration.model, "gpt-5.6-sol");
  assert.deepEqual(first.deferredCalibration.reasoningEffort, {
    mode: "model-default",
    override: null,
  });
  assert.equal(Object.hasOwn(first.deferredCalibration, "effort"), false);
  assert.equal(
    first.sessions.some(({ model }) => model === "gpt-5.6-sol"),
    false,
  );
  assert.deepEqual(first.deferredCalibration, DEFERRED_CALIBRATION_MODEL);
  for (let index = 0; index < first.sessions.length; index += 3) {
    assert.deepEqual(
      new Set(first.sessions.slice(index, index + 3).map(({ arm }) => arm)),
      new Set(EVALUATION_ARMS),
    );
  }
  for (const session of first.sessions) {
    assert.equal(
      session.sourceCommit,
      session.arm === "no-skill"
        ? null
        : session.arm === "old-skill"
          ? BASELINE_SKILL_COMMIT
          : candidate.commitOid,
    );
  }
  assert.deepEqual(
    EVALUATION_CASE_IDS,
    [
      4, 7, 18, 28, 35, 36, 37, 39, 40, 41, 42, 47, 49, 50, 53, 54, 55, 67, 68,
      69, 70, 71, 72, 73, 74, 75, 76,
    ],
  );
  assert.deepEqual(EVALUATION_MODELS, [
    {
      effort: "low",
      model: "gpt-5.3-codex-spark",
      provider: "openai",
      purpose: "primary",
      repetitions: 1,
    },
  ]);
  assert.equal(
    BASELINE_SKILL_COMMIT,
    "76baa9b25e0afeaa2c62c4cf7042976444edc15e",
  );
});

test("campaign selection rejects altered schedules and returns the frozen session", () => {
  const plan = createEvaluationCampaignPlan({
    candidate: {
      branch: "main",
      commitOid: "a".repeat(40),
      remote: "origin",
      remoteRef: "refs/heads/main",
      verification: "git-ls-remote",
    },
    seed: "selection-seed",
  });
  assert.deepEqual(selectEvaluationCampaignSession(plan, 1), plan.sessions[0]);

  const altered = structuredClone(plan);
  altered.sessions[0].sourceCommit = "b".repeat(40);
  assert.throws(
    () => selectEvaluationCampaignSession(altered, 1),
    /campaign.*integrity|campaign.*match/iu,
  );
  const malformed = structuredClone(plan);
  delete malformed.seed;
  assert.throws(
    () => selectEvaluationCampaignSession(malformed, 1),
    /campaign.*integrity|campaign.*match/iu,
  );
  assert.throws(() => selectEvaluationCampaignSession(plan, 0), /sequence/iu);
});

test("candidate resolution proves HEAD matches a freshly observed pushed branch", (t) => {
  const { repository } = createPushedCandidateRepository(t);
  const expected = runGit(repository, [
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ]);
  const candidate = resolvePushedEvaluationCandidate(repository);
  assert.deepEqual(candidate, {
    branch: "main",
    commitOid: expected,
    remote: "origin",
    remoteRef: "refs/heads/main",
    verification: "git-ls-remote",
  });
  assert.doesNotThrow(() =>
    assertEvaluationCampaignRepositoryCurrent(repository, candidate),
  );
});

test("candidate resolution rejects unpushed, dirty, or incomplete campaigns", (t) => {
  const noUpstream = createPushedCandidateRepository(t).repository;
  runGit(noUpstream, ["config", "--unset", "branch.main.remote"]);
  assert.throws(
    () => resolvePushedEvaluationCandidate(noUpstream),
    /configured remote branch upstream/iu,
  );

  const unpushed = createPushedCandidateRepository(t).repository;
  writeFileSync(join(unpushed, "README.md"), "unpushed\n", "utf8");
  runGit(unpushed, ["add", "README.md"]);
  runGit(unpushed, ["commit", "-m", "test: Add unpushed change"]);
  assert.throws(
    () => resolvePushedEvaluationCandidate(unpushed),
    /does not match.*remote|not.*pushed/iu,
  );

  const dirty = createPushedCandidateRepository(t).repository;
  writeFileSync(
    join(dirty, "skills", "committing-to-git", "SKILL.md"),
    "dirty candidate\n",
    "utf8",
  );
  assert.throws(
    () => resolvePushedEvaluationCandidate(dirty),
    /campaign.*skill.*uncommitted|differs from.*commit/iu,
  );

  const missingBaseline = createPushedCandidateRepository(t, {
    includeBaseline: false,
  }).repository;
  assert.throws(
    () => resolvePushedEvaluationCandidate(missingBaseline),
    /baseline.*unavailable|obtain.*exact commit/iu,
  );

  const dirtyRunner = createPushedCandidateRepository(t).repository;
  const dirtyCandidate = resolvePushedEvaluationCandidate(dirtyRunner);
  writeFileSync(
    join(dirtyRunner, "evals", "committing-to-git", "evaluation-runner.mjs"),
    "dirty runner\n",
    "utf8",
  );
  assert.throws(
    () =>
      assertEvaluationCampaignRepositoryCurrent(dirtyRunner, dirtyCandidate),
    /campaign runner.*uncommitted|runner.*differs/iu,
  );
});

test("Google policy schedule derives only manifest policy cases and leaves the executable matrix unchanged", () => {
  const caseIds = listPolicyEvaluationCaseIds(REPOSITORY_ROOT);
  assert.deepEqual(caseIds, [3, 12, 15, 17, 23, 24]);
  const options = {
    seed: "google-policy-seed",
    provider: "google",
    model: "gemini-3.5-flash-low",
    effort: "low",
    repetitions: 2,
    caseIds,
  };
  const schedule = buildPolicyEvaluationSchedule(options);
  assert.equal(schedule.length, 36);
  assert.deepEqual(schedule, buildPolicyEvaluationSchedule(options));
  assert.equal(
    buildEvaluationSchedule({
      candidateCommit: "a".repeat(40),
      seed: "step-3-seed",
    }).length,
    81,
  );
  assert.deepEqual(
    new Set(schedule.map(({ caseId }) => caseId)),
    new Set(caseIds),
  );
  assert.deepEqual(
    new Set(schedule.map(({ arm }) => arm)),
    new Set(EVALUATION_ARMS),
  );
  assert.deepEqual(
    new Set(schedule.map(({ provider }) => provider)),
    new Set(["google"]),
  );
  assert.deepEqual(
    new Set(schedule.map(({ profile }) => profile)),
    new Set(["policy-only"]),
  );
});

test("Google policy preparation composes the complete pinned treatment without a Git fixture or model turn", async (t) => {
  const { prepared, recordFile, workingDirectory } =
    await policyPreparedFixture(t);
  const packet = prepared.packet;
  assert.equal(packet.transmission.provider, "google");
  assert.equal(packet.transmission.transport, "antigravity-cli");
  assert.equal(packet.transmission.session.metadata.profile, "policy-only");
  assert.equal(
    packet.transmission.isolation.workingDirectory,
    workingDirectory,
  );
  assert.equal(existsSync(join(prepared.preparedSession, "fixture")), false);
  assert.equal(
    existsSync(join(prepared.preparedSession, "treatment", "SKILL.md")),
    true,
  );
  const prompt = packet.transmission.harnessControlledInputs.find(
    ({ role }) => role === "user",
  ).content;
  for (const path of [
    "SKILL.md",
    "references/inspection-recovery.md",
    "references/message-format.md",
    "references/publication-recovery.md",
    "references/signature-recovery.md",
    "references/transaction-recovery.md",
    "scripts/commitWorkflow.mjs",
  ]) {
    const beginMarker = `<BEGIN_SKILL_FILE path="${path}">`;
    const endMarker = `<END_SKILL_FILE path="${path}">`;
    const content = readFileSync(
      join(prepared.preparedSession, "treatment", ...path.split("/")),
      "utf8",
    );
    const framingNewline = content.endsWith("\n") ? "" : "\n";
    assert.ok(
      prompt.includes(
        `${beginMarker}\n${content}${framingNewline}${endMarker}`,
      ),
      `prompt must preserve every treatment character for ${path}`,
    );
  }
  assert.match(prompt, /# User task/u);
  assert.match(prompt, /File Changes:/u);
  const records = existsSync(recordFile)
    ? readFileSync(recordFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
    : [];
  assert.equal(
    records.some(({ mode }) => mode === "model"),
    false,
  );
});

test("Google policy preparation rejects executable cases before creating evidence or launching", async (t) => {
  const root = temporaryRoot(t, "committing-to-git-policy-reject-");
  const workingDirectory = join(root, "working");
  mkdirSync(workingDirectory);
  const recordFile = join(root, "antigravity.jsonl");
  const environment = { PATH: process.env.PATH ?? "" };
  const inspectedToolchain = await inspectAntigravityCliToolchain({
    command: process.execPath,
    prefixArguments: [FAKE_ANTIGRAVITY, "--record-file", recordFile],
    environment,
  });
  const destination = join(root, "prepared");
  await assert.rejects(
    preparePolicyEvaluationSession({
      arm: "no-skill",
      campaignId: TEST_CAMPAIGN_ID,
      caseId: 4,
      destination,
      effort: "low",
      environment,
      model: "gemini-3.5-flash-low",
      provider: "google",
      repetition: 1,
      repositoryRoot: REPOSITORY_ROOT,
      seed: "reject-seed",
      sequence: 1,
      sourceCommit: null,
      toolchain: inspectedToolchain,
      workingDirectory,
    }),
    /policy-only|execution_mode|policy case/iu,
  );
  assert.equal(existsSync(destination), false);
  const records = readFileSync(recordFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  assert.equal(
    records.some(({ mode }) => mode === "model"),
    false,
  );
});

test("policy preparation rejects a non-Google provider before creating evidence", async (t) => {
  const root = temporaryRoot(t, "committing-to-git-policy-provider-");
  const workingDirectory = join(root, "working");
  const destination = join(root, "prepared");
  mkdirSync(workingDirectory);
  await assert.rejects(
    preparePolicyEvaluationSession({
      arm: "no-skill",
      campaignId: TEST_CAMPAIGN_ID,
      caseId: 3,
      destination,
      effort: "low",
      environment: {},
      model: "gpt-5.6-luna",
      provider: "openai",
      repetition: 1,
      repositoryRoot: REPOSITORY_ROOT,
      seed: "reject-provider-seed",
      sequence: 1,
      sourceCommit: null,
      toolchain: null,
      workingDirectory,
    }),
    /require.*Google|provider.*Google/iu,
  );
  assert.equal(existsSync(destination), false);
});

test("Google policy execution uses the shared authorization and one-turn evidence path", async (t) => {
  const { prepared, recordFile } = await policyPreparedFixture(t, {
    arm: "no-skill",
  });
  const result = await executePreparedEvaluationSession({
    preparedSession: prepared,
    authorization: authorization(prepared.packet),
    allowExternalModelCall: true,
    timeoutMs: 5_000,
  });
  assert.equal(result.status, "completed", result.error?.message);
  assert.deepEqual(result.suiteResult, {
    finalAnswer: "Authoritative Google answer\n",
    profile: "policy-only",
  });
  const records = readFileSync(recordFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  assert.equal(records.filter(({ mode }) => mode === "model").length, 1);
  await assert.rejects(
    preflightPreparedEvaluationSession({
      preparedSession: prepared,
      allowZeroTurnPreflight: true,
    }),
    /OpenAI|zero-turn|Antigravity/iu,
  );
});

test("CLI policy-plan freezes the pushed candidate without model execution", (t) => {
  const { repository } = createPushedCandidateRepository(t);
  const args = [
    RUNNER_CLI,
    "policy-plan",
    "--repository-root",
    repository,
    "--seed",
    "cli-policy-seed",
    "--provider",
    "google",
    "--model",
    "gemini-3.5-flash-low",
    "--effort",
    "low",
    "--repetitions",
    "2",
  ];
  const first = spawnSync(process.execPath, args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });
  const second = spawnSync(process.execPath, args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  const output = JSON.parse(first.stdout);
  assert.equal(output.command, "policy-plan");
  assert.equal(output.modelCalls, 0);
  assert.equal(output.sessions.length, 36);
  assert.equal(
    output.candidate.commitOid,
    runGit(repository, ["rev-parse", "--verify", "HEAD^{commit}"]),
  );
});

test("CLI prepare-policy pins Antigravity and creates no fixture or model turn", (t) => {
  const root = temporaryRoot(t, "committing-to-git-policy-cli-");
  const { repository } = createPushedCandidateRepository(t);
  const candidate = resolvePushedEvaluationCandidate(repository);
  const campaignPath = join(root, "campaign.json");
  const destination = join(root, "prepared");
  const workingDirectory = join(root, "working");
  const recordFile = join(root, "antigravity.jsonl");
  mkdirSync(workingDirectory);
  const campaign = createPolicyEvaluationCampaignPlan({
    candidate,
    caseIds: [3],
    effort: "low",
    model: "gemini-3.5-flash-low",
    provider: "google",
    repetitions: 1,
    seed: "cli-policy-seed",
  });
  const session = campaign.sessions.find(({ arm }) => arm === "new-skill");
  writeFileSync(campaignPath, `${JSON.stringify(campaign)}\n`, "utf8");
  const result = spawnSync(
    process.execPath,
    [
      RUNNER_CLI,
      "prepare-policy",
      "--repository-root",
      repository,
      "--campaign-plan",
      campaignPath,
      "--sequence",
      String(session.sequence),
      "--working-dir",
      workingDirectory,
      "--destination",
      destination,
      "--antigravity-command",
      process.execPath,
      "--antigravity-prefix-arg",
      FAKE_ANTIGRAVITY,
      "--antigravity-prefix-arg",
      "--record-file",
      "--antigravity-prefix-arg",
      recordFile,
    ],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.command, "prepare-policy");
  assert.equal(output.campaignId, campaign.campaignId);
  assert.equal(output.modelCalls, 0);
  assert.equal(output.profile, "policy-only");
  assert.equal(existsSync(join(destination, "fixture")), false);
  const packet = JSON.parse(
    readFileSync(join(destination, "packet.json"), "utf8"),
  );
  assert.equal(packet.transmission.provider, "google");
  assert.equal(
    packet.transmission.session.metadata.campaignId,
    campaign.campaignId,
  );
  assert.equal(packet.transmission.toolchain.version, "1.1.19");
  const records = readFileSync(recordFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  assert.equal(
    records.some(({ mode }) => mode === "model"),
    false,
  );
});

test("CLI prepare derives every schedule field from the reviewed campaign", (t) => {
  const root = temporaryRoot(t, "committing-to-git-prepare-cli-");
  const { repository } = createPushedCandidateRepository(t);
  const candidate = resolvePushedEvaluationCandidate(repository);
  const campaignPath = join(root, "campaign.json");
  const catalogPath = join(root, "catalog.json");
  const destination = join(root, "prepared");
  const campaign = createEvaluationCampaignPlan({
    candidate,
    seed: "cli-prepare-seed",
  });
  const session = campaign.sessions.find(
    ({ arm, caseId }) => arm === "new-skill" && caseId === 35,
  );
  writeFileSync(campaignPath, `${JSON.stringify(campaign)}\n`, "utf8");
  writeFileSync(
    catalogPath,
    `${JSON.stringify({
      catalog: {
        appIds: [],
        mcpServerIds: [],
        pluginIds: [],
        skillPaths: [],
      },
      discovery: {
        codexHome: join(root, "codex-home"),
        repositoryRoot: repository,
      },
    })}\n`,
    "utf8",
  );
  const result = spawnSync(
    process.execPath,
    [
      RUNNER_CLI,
      "prepare",
      "--repository-root",
      repository,
      "--campaign-plan",
      campaignPath,
      "--sequence",
      String(session.sequence),
      "--isolation-catalog",
      catalogPath,
      "--authorization-eligible",
      "true",
      "--evaluation-homes-root",
      join(root, "evaluation-homes-v1"),
      "--destination",
      destination,
      "--codex-entry",
      FAKE_APP_SERVER,
    ],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.campaignId, campaign.campaignId);
  assert.equal(output.sequence, session.sequence);
  const packet = JSON.parse(
    readFileSync(join(destination, "packet.json"), "utf8"),
  );
  assert.equal(packet.transmission.session.arm, session.arm);
  assert.equal(packet.transmission.session.caseId, session.caseId);
  assert.equal(packet.transmission.session.sequence, session.sequence);
  assert.equal(
    packet.transmission.session.metadata.campaignId,
    campaign.campaignId,
  );
  assert.equal(
    packet.transmission.session.metadata.sourceCommit,
    candidate.commitOid,
  );
});

test("CLI prepare rejects duplicated schedule fields outside the campaign", () => {
  const result = spawnSync(
    process.execPath,
    [RUNNER_CLI, "prepare", "--arm", "new-skill"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--arm is not valid/iu);
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
  assert.equal(
    packet.transmission.session.metadata.campaignId,
    TEST_CAMPAIGN_ID,
  );
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
    campaignId: TEST_CAMPAIGN_ID,
    case: { id: 35 },
    effort: "low",
    model: "gpt-5.6-luna",
    order: { blockId: "gpt-5.6-luna/low/35/1", sequence: index + 1 },
    provider: "openai",
    sourceCommit: treatmentCommit(arm),
    status: index === 0 ? "failed" : "completed",
    transmissionSha256: String(index).repeat(64),
  }));
  const bundle = createBlindedGradingBundle({ records, seed: "blind-seed" });
  assert.equal(bundle.gradingPackage.campaignId, TEST_CAMPAIGN_ID);
  assert.equal(bundle.mapping.campaignId, TEST_CAMPAIGN_ID);
  assert.equal(bundle.gradingPackage.sessions.length, 3);
  assert.match(JSON.stringify(bundle.gradingPackage), /failed/u);
  assert.doesNotMatch(
    JSON.stringify(bundle.gradingPackage),
    /old-skill|new-skill|no-skill/u,
  );
  const mixedCampaign = structuredClone(records);
  mixedCampaign[0].campaignId = "d".repeat(64);
  assert.throws(
    () =>
      createBlindedGradingBundle({
        records: mixedCampaign,
        seed: "blind-seed",
      }),
    /one campaign|campaign.*match/iu,
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

test("CLI plan freezes the freshly observed pushed candidate without model execution", (t) => {
  const { repository } = createPushedCandidateRepository(t);
  const result = spawnSync(
    process.execPath,
    [RUNNER_CLI, "plan", "--repository-root", repository, "--seed", "cli-seed"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.modelCalls, 0);
  assert.equal(output.sessions.length, 81);
  assert.equal(
    output.candidate.commitOid,
    runGit(repository, ["rev-parse", "--verify", "HEAD^{commit}"]),
  );
  assert.equal(output.deferredCalibration.model, "gpt-5.6-sol");
  assert.equal(
    output.deferredCalibration.reasoningEffort.mode,
    "model-default",
  );
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
