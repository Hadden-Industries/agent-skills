import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

import { createDefiningConceptController } from "../../../evals/defining-concepts/session-controller.mjs";
import { initializeEvaluationHomes } from "../../../scripts/evaluation/evaluation-homes.js";
import {
  canonicalJsonBytes,
  EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  sha256Hex,
} from "../../../scripts/evaluation/runtime.js";
import { normalizeEvaluationConversation } from "../../../scripts/evaluation/scripted-conversation.js";

const root = path.resolve(import.meta.dirname, "../../..");
const runner = path.join(
  root,
  "evals",
  "defining-concepts",
  "run-evaluation-session.mjs",
);
const fakeClaude = path.join(
  root,
  "tests",
  "scripts",
  "fixtures",
  "fake-claude-cli.mjs",
);
const fakeCodex = path.join(
  root,
  "tests",
  "scripts",
  "fixtures",
  "fake-codex-app-server.mjs",
);
const fakeAntigravity = path.join(
  root,
  "tests",
  "scripts",
  "fixtures",
  "fake-antigravity-cli.mjs",
);

function invoke(args) {
  return spawnSync(process.execPath, [runner, ...args], { encoding: "utf8" });
}

function bundleRecord({
  content,
  kind = "working-tree",
  sourceId = "candidate",
}) {
  const bytes = Buffer.from(content, "utf8");
  const payload = {
    schemaVersion: 1,
    skillName: "defining-concepts",
    source:
      kind === "git"
        ? {
            kind: "git",
            commitOid: sourceId.padEnd(40, "0").slice(0, 40),
            treeOid: sourceId.padEnd(40, "1").slice(0, 40),
          }
        : {
            kind: "working-tree",
            headCommitOid: sourceId.padEnd(40, "0").slice(0, 40),
            headTreeOid: sourceId.padEnd(40, "1").slice(0, 40),
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

function writeCase(directory, evaluationCase) {
  const target = path.join(directory, "case.json");
  writeFileSync(target, `${JSON.stringify(evaluationCase)}\n`, "utf8");
  return target;
}

function writeBundle(directory, bundle) {
  const target = path.join(directory, "skill-bundle.json");
  writeFileSync(target, `${JSON.stringify(bundle)}\n`, "utf8");
  return target;
}

function fixture() {
  const temporary = mkdtempSync(
    path.join(tmpdir(), "defining-concepts-runner-"),
  );
  const caseFile = writeCase(temporary, {
    id: 1,
    prompt: "Define the registry concept Dataset.",
  });
  const bundleFile = writeBundle(
    temporary,
    bundleRecord({
      content: "# Test skill\n\nFollow the workflow.\n",
      kind: "git",
      sourceId: "a",
    }),
  );
  const destination = path.join(temporary, "prepared");
  const working = path.join(temporary, "working");
  const record = path.join(temporary, "provider.jsonl");
  const prepareArgs = [
    "prepare",
    "--case-file",
    caseFile,
    "--destination",
    destination,
    "--working-dir",
    working,
    "--arm",
    "current-skill",
    "--repetition",
    "1",
    "--provider",
    "claude",
    "--model",
    "claude-opus-4-1",
    "--effort",
    "high",
    "--skill-bundle-file",
    bundleFile,
    "--max-budget-usd",
    "1.25",
    "--claude-command",
    process.execPath,
    "--claude-prefix-arg",
    fakeClaude,
    "--claude-prefix-arg",
    "--record-file",
    "--claude-prefix-arg",
    record,
  ];
  return {
    destination,
    prepareArgs,
    bundleFile,
    caseFile,
    record,
    temporary,
    working,
  };
}

function googleFixture() {
  const temporary = mkdtempSync(
    path.join(tmpdir(), "defining-concepts-google-"),
  );
  const caseFile = writeCase(temporary, {
    id: 1,
    prompt: "Define the registry concept Dataset.",
  });
  const bundleFile = writeBundle(
    temporary,
    bundleRecord({ content: "# Test skill\n\nFollow the workflow.\n\n" }),
  );
  const destination = path.join(temporary, "prepared");
  const working = path.join(temporary, "working");
  const record = path.join(temporary, "provider.jsonl");
  return {
    bundleFile,
    caseFile,
    destination,
    record,
    temporary,
    working,
    prepareArgs: [
      "prepare",
      "--case-file",
      caseFile,
      "--destination",
      destination,
      "--working-dir",
      working,
      "--arm",
      "candidate-skill",
      "--repetition",
      "1",
      "--provider",
      "antigravity",
      "--model",
      "gemini-3.5-flash-low",
      "--effort",
      "low",
      "--skill-bundle-file",
      bundleFile,
      "--antigravity-command",
      process.execPath,
      "--antigravity-prefix-arg",
      fakeAntigravity,
      "--antigravity-prefix-arg",
      "--record-file",
      "--antigravity-prefix-arg",
      record,
    ],
  };
}

function records(record) {
  if (!existsSync(record)) return [];
  return readFileSync(record, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
}

test("one-turn controller treats the adapter final answer as authoritative", async () => {
  const conversation = normalizeEvaluationConversation({
    id: 1,
    prompt: "packet-bound prompt",
  });
  const controller = createDefiningConceptController({ conversation });
  const decision = await controller.onTurnCompleted({
    turnIndex: 1,
    status: "completed",
    finalAnswer: "authoritative answer",
    nativeUsage: { input_tokens: 10, output_tokens: 4 },
    nativeEventRange: { first: 3, last: 5 },
  });
  assert.deepEqual(Object.keys(controller).sort(), [
    "initialInput",
    "maxTurns",
    "onApprovalRequest",
    "onTurnCompleted",
    "schemaVersion",
  ]);
  assert.equal(controller.schemaVersion, 1);
  assert.equal(controller.maxTurns, 1);
  assert.equal(controller.initialInput[0], conversation[0].input);
  assert.deepEqual(decision, {
    action: "complete",
    suiteResult: { finalAnswer: "authoritative answer" },
  });
  assert.deepEqual(await controller.onApprovalRequest({}), {
    action: "reject",
    failureClass: "controller-failed",
    reason: "Defining-concepts sessions do not permit approval requests",
  });
  await assert.rejects(
    controller.onTurnCompleted({
      turnIndex: 1,
      status: "failed",
      finalAnswer: null,
      nativeUsage: null,
      nativeEventRange: { first: 0, last: 0 },
    }),
    /already completed/u,
  );
});

test("prepare freezes packet inputs and performs no provider model turn", () => {
  const context = fixture();
  const result = invoke(context.prepareArgs);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(
    records(context.record).some(({ mode }) => mode === "model"),
    false,
  );
  const packet = JSON.parse(
    readFileSync(path.join(context.destination, "packet.json"), "utf8"),
  );
  assert.equal(packet.transmission.provider, "anthropic");
  assert.equal(packet.transmission.transport, "claude-cli");
  assert.equal(packet.transmission.session.arm, "current-skill");
  assert.equal(packet.transmission.session.repetition, 1);
  assert.equal(
    packet.transmission.session.metadata.skillBundleAggregateSha256,
    JSON.parse(readFileSync(context.bundleFile, "utf8")).aggregateSha256,
  );
  assert.deepEqual(packet.transmission.capabilities, {
    network: true,
    providerFacilities: [],
    tools: ["WebSearch", "WebFetch"],
    webSearch: true,
  });
  assert.equal(packet.transmission.continuationPolicy.maxTurns, 1);
  assert.match(
    packet.transmission.continuationPolicy.controllerSha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.match(
    packet.transmission.runtimeFingerprint.gitCommit,
    /^[0-9a-f]{40}$/u,
  );
  assert.match(
    packet.transmission.runtimeFingerprint.gitTree,
    /^[0-9a-f]{40}$/u,
  );
  assert.match(packet.transmissionSha256, /^[0-9a-f]{64}$/u);
  writeFileSync(
    context.caseFile,
    `${JSON.stringify({ id: 1, prompt: "mutated source prompt" })}\n`,
    "utf8",
  );
  const retained = readFileSync(
    path.join(context.destination, "inputs", "0001-prompt.txt"),
    "utf8",
  );
  assert.equal(
    retained,
    packet.transmission.harnessControlledInputs[0].content,
  );
  assert.notEqual(retained, "mutated source prompt");
});

test("prepare binds an exact clarification turn and Codex completes both turns", async () => {
  const temporary = mkdtempSync(
    path.join(tmpdir(), "defining-concepts-clarification-"),
  );
  const caseFile = writeCase(temporary, {
    id: 10,
    prompt: "Define charge for our glossary.",
    follow_up_turns: [
      {
        id: "select-electric-charge",
        prompt: "Use the physical quantity sense: electric charge.",
      },
    ],
  });
  const bundleFile = writeBundle(
    temporary,
    bundleRecord({ content: "# Candidate skill\n\nResolve ambiguity.\n" }),
  );
  const destination = path.join(temporary, "prepared");
  const working = path.join(temporary, "working");
  const homes = path.join(temporary, "homes-v1");
  await initializeEvaluationHomes({ root: homes });
  const prepared = invoke([
    "prepare",
    "--case-file",
    caseFile,
    "--destination",
    destination,
    "--working-dir",
    working,
    "--arm",
    "candidate-skill",
    "--repetition",
    "1",
    "--provider",
    "codex",
    "--model",
    "gpt-5.6-luna",
    "--effort",
    "low",
    "--skill-bundle-file",
    bundleFile,
    "--codex-command",
    process.execPath,
    "--codex-prefix-arg",
    fakeCodex,
    "--codex-prefix-arg",
    "--scenario",
    "--codex-prefix-arg",
    "happy-turn",
    "--evaluation-homes-root",
    homes,
  ]);
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(existsSync(path.join(destination, "run.json")), false);
  const packet = JSON.parse(
    readFileSync(path.join(destination, "packet.json"), "utf8"),
  );
  assert.equal(packet.transmission.continuationPolicy.maxTurns, 2);
  assert.deepEqual(packet.transmission.continuationPolicy.allowedTransitions, [
    "select-electric-charge",
  ]);
  assert.equal(
    packet.transmission.continuationPolicy.templates[0].input[0].text,
    "Use the physical quantity sense: electric charge.",
  );
  const authorization = path.join(temporary, "authorization.json");
  writeFileSync(
    authorization,
    `${JSON.stringify({
      schemaVersion: 1,
      decision: "authorized",
      statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
      allowExternalModel: true,
      provider: packet.transmission.provider,
      model: packet.transmission.model,
      effort: packet.transmission.effort,
      transmissionSha256: packet.transmissionSha256,
    })}\n`,
    "utf8",
  );
  const result = invoke([
    "run",
    "--prepared-session",
    destination,
    "--authorization",
    authorization,
    "--allow-external-model-call",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(
    readFileSync(path.join(destination, "outputs", "final.md"), "utf8"),
    "authoritative final answer 2",
  );
});

test("canonical arms enforce bundle presence, source kind, and one repetition", () => {
  const context = fixture();
  const armIndex = context.prepareArgs.indexOf("--arm") + 1;
  const bundleFlagIndex = context.prepareArgs.indexOf("--skill-bundle-file");

  const noSkillWithBundle = [...context.prepareArgs];
  noSkillWithBundle[armIndex] = "no-skill";
  let result = invoke(noSkillWithBundle);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no-skill forbids/iu);

  const currentWithoutBundle = [...context.prepareArgs];
  currentWithoutBundle.splice(bundleFlagIndex, 2);
  result = invoke(currentWithoutBundle);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /current-skill requires/iu);

  const repeated = [...context.prepareArgs];
  repeated[repeated.indexOf("--repetition") + 1] = "2";
  result = invoke(repeated);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /repetition 1/iu);

  const candidateWithCommittedBundle = [...context.prepareArgs];
  candidateWithCommittedBundle[armIndex] = "candidate-skill";
  result = invoke(candidateWithCommittedBundle);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /working-tree skill bundle/iu);
});

test("run rejects absent authorization before a provider model turn", () => {
  const context = fixture();
  assert.equal(invoke(context.prepareArgs).status, 0);
  const result = invoke([
    "run",
    "--prepared-session",
    context.destination,
    "--authorization",
    path.join(context.temporary, "missing.json"),
    "--allow-external-model-call",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /authorization/u);
  assert.equal(
    records(context.record).some(({ mode }) => mode === "model"),
    false,
  );
});

test("run rejects mismatched authorization before a provider model turn", () => {
  const context = fixture();
  assert.equal(invoke(context.prepareArgs).status, 0);
  const packet = JSON.parse(
    readFileSync(path.join(context.destination, "packet.json"), "utf8"),
  );
  const authorization = path.join(context.temporary, "authorization.json");
  writeFileSync(
    authorization,
    JSON.stringify({
      schemaVersion: 1,
      decision: "authorized",
      statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
      allowExternalModel: true,
      provider: packet.transmission.provider,
      model: packet.transmission.model,
      effort: packet.transmission.effort,
      transmissionSha256: "0".repeat(64),
    }),
    "utf8",
  );
  const result = invoke([
    "run",
    "--prepared-session",
    context.destination,
    "--authorization",
    authorization,
    "--allow-external-model-call",
  ]);
  assert.notEqual(result.status, 0);
  assert.equal(
    records(context.record).some(({ mode }) => mode === "model"),
    false,
  );
});

test("run launches only after exact authorization and retains shared evidence", () => {
  const context = fixture();
  const prepared = invoke(context.prepareArgs);
  assert.equal(prepared.status, 0, prepared.stderr);
  const packet = JSON.parse(
    readFileSync(path.join(context.destination, "packet.json"), "utf8"),
  );
  const authorization = path.join(context.temporary, "authorization.json");
  writeFileSync(
    authorization,
    `${JSON.stringify({
      schemaVersion: 1,
      decision: "authorized",
      statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
      allowExternalModel: true,
      provider: packet.transmission.provider,
      model: packet.transmission.model,
      effort: packet.transmission.effort,
      transmissionSha256: packet.transmissionSha256,
    })}\n`,
    "utf8",
  );
  const result = invoke([
    "run",
    "--prepared-session",
    context.destination,
    "--authorization",
    authorization,
    "--allow-external-model-call",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    records(context.record).filter(({ mode }) => mode === "model").length,
    1,
  );
  const run = JSON.parse(
    readFileSync(path.join(context.destination, "run.json"), "utf8"),
  );
  assert.equal(run.status, "completed");
  assert.deepEqual(run.suiteResult, {
    finalAnswer: "Authoritative final answer",
  });
  assert.equal(
    readFileSync(path.join(context.destination, "outputs", "final.md"), "utf8"),
    "Authoritative final answer",
  );
});

test("prepare rejects a nonempty destination", () => {
  const context = fixture();
  assert.equal(invoke(context.prepareArgs).status, 0);
  const result = invoke(context.prepareArgs);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /destination|exist/u);
});

test("Codex preparation binds App Server transport and a managed execution home", async () => {
  const temporary = mkdtempSync(
    path.join(tmpdir(), "defining-concepts-codex-"),
  );
  const caseFile = writeCase(temporary, {
    id: 1,
    prompt: "Define Dataset.",
  });
  const destination = path.join(temporary, "prepared");
  const working = path.join(temporary, "working");
  const homes = path.join(temporary, "homes-v1");
  await initializeEvaluationHomes({ root: homes });
  const result = invoke([
    "prepare",
    "--case-file",
    caseFile,
    "--destination",
    destination,
    "--working-dir",
    working,
    "--arm",
    "no-skill",
    "--repetition",
    "1",
    "--provider",
    "codex",
    "--model",
    "gpt-5.6-luna",
    "--effort",
    "low",
    "--codex-command",
    process.execPath,
    "--codex-prefix-arg",
    fakeCodex,
    "--codex-prefix-arg",
    "--scenario",
    "--codex-prefix-arg",
    "happy-turn",
    "--evaluation-homes-root",
    homes,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const packet = JSON.parse(
    readFileSync(path.join(destination, "packet.json"), "utf8"),
  );
  assert.equal(packet.transmission.provider, "openai");
  assert.equal(packet.transmission.transport, "codex-app-server");
  assert.equal(packet.transmission.session.arm, "no-skill");
  assert.equal(
    packet.transmission.session.metadata.skillBundleAggregateSha256,
    null,
  );
  assert.deepEqual(packet.transmission.capabilities, {
    network: false,
    providerFacilities: [],
    tools: [],
    webSearch: false,
  });
  const settings = JSON.parse(
    packet.transmission.harnessControlledInputs.find(
      ({ id }) => id === "runner-settings",
    ).content,
  );
  assert.equal(settings.evaluationHomesRoot, homes);
  assert.deepEqual(
    packet.transmission.runtimeFingerprint.modules.map(({ path }) => path),
    [
      "evals/defining-concepts/run-evaluation-session.mjs",
      "evals/defining-concepts/session-controller.mjs",
      "scripts/evaluation/scripted-conversation.js",
      "scripts/evaluation/skill-bundle.js",
      "scripts/evaluation/runtime.js",
      "scripts/evaluation/evaluation-homes.js",
      "scripts/evaluation/windows-path-metadata.js",
      "scripts/evaluation/windows-path-probe.ps1",
      "scripts/evaluation/codex-app-server.js",
    ],
  );
});

test("Antigravity preparation binds one explicit post-activation message without a model turn", () => {
  const context = googleFixture();
  const result = invoke(context.prepareArgs);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    records(context.record).some(({ mode }) => mode === "model"),
    false,
  );
  const packet = JSON.parse(
    readFileSync(path.join(context.destination, "packet.json"), "utf8"),
  );
  assert.equal(packet.transmission.provider, "google");
  assert.equal(packet.transmission.transport, "antigravity-cli");
  assert.equal(packet.transmission.session.arm, "candidate-skill");
  assert.equal(packet.transmission.toolchain.version, "1.1.19");
  assert.deepEqual(packet.transmission.capabilities, {
    network: false,
    providerFacilities: ["provider-default-context"],
    tools: [],
    webSearch: false,
  });
  const userInputs = packet.transmission.harnessControlledInputs.filter(
    ({ role }) => role === "user",
  );
  assert.equal(userInputs.length, 1);
  assert.match(userInputs[0].content, /# Isolated behavioral evaluation/u);
  assert.match(userInputs[0].content, /# Task-specific skill/u);
  assert.match(
    userInputs[0].content,
    /# Task-specific skill bundle: defining-concepts/u,
  );
  assert.match(
    userInputs[0].content,
    /## `skills\/defining-concepts\/SKILL\.md`/u,
  );
  assert.match(userInputs[0].content, /# Test skill/u);
  assert.match(userInputs[0].content, /# User task/u);
  assert.match(userInputs[0].content, /Define the registry concept Dataset\./u);
  assert.match(
    userInputs[0].content,
    /# Test skill\n\nFollow the workflow\.\n\n\n# User task/u,
    "the composed prompt must preserve the complete skill text and its file boundary",
  );
  assert.deepEqual(
    packet.transmission.runtimeFingerprint.modules.map(({ path }) => path),
    [
      "evals/defining-concepts/run-evaluation-session.mjs",
      "evals/defining-concepts/session-controller.mjs",
      "scripts/evaluation/scripted-conversation.js",
      "scripts/evaluation/skill-bundle.js",
      "scripts/evaluation/runtime.js",
      "scripts/evaluation/antigravity-cli.js",
    ],
  );
});

test("Antigravity run launches only after exact authorization and retains shared evidence", () => {
  const context = googleFixture();
  const prepared = invoke(context.prepareArgs);
  assert.equal(prepared.status, 0, prepared.stderr);
  const packet = JSON.parse(
    readFileSync(path.join(context.destination, "packet.json"), "utf8"),
  );
  const authorization = path.join(context.temporary, "authorization.json");
  writeFileSync(
    authorization,
    `${JSON.stringify({
      schemaVersion: 1,
      decision: "authorized",
      statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
      allowExternalModel: true,
      provider: "google",
      model: packet.transmission.model,
      effort: packet.transmission.effort,
      transmissionSha256: packet.transmissionSha256,
    })}\n`,
    "utf8",
  );
  const result = invoke([
    "run",
    "--prepared-session",
    context.destination,
    "--authorization",
    authorization,
    "--allow-external-model-call",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    records(context.record).filter(({ mode }) => mode === "model").length,
    1,
  );
  const run = JSON.parse(
    readFileSync(path.join(context.destination, "run.json"), "utf8"),
  );
  assert.equal(run.status, "completed");
  assert.deepEqual(run.suiteResult, {
    finalAnswer: "Authoritative Google answer\n",
  });
});

test("Antigravity preparation requires an explicit absolute executable", () => {
  const context = googleFixture();
  const commandIndex = context.prepareArgs.indexOf("--antigravity-command") + 1;
  context.prepareArgs[commandIndex] = "agy";
  const result = invoke(context.prepareArgs);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /antigravity-command.*absolute/iu);
  assert.equal(existsSync(context.destination), false);
  assert.equal(
    records(context.record).some(({ mode }) => mode === "model"),
    false,
  );
});

test("Antigravity preparation rejects a working directory inside a repository", () => {
  const context = googleFixture();
  const repository = path.join(context.temporary, "repository");
  const working = path.join(repository, "empty-working");
  mkdirSync(path.join(repository, ".git"), { recursive: true });
  mkdirSync(working);
  const workingIndex = context.prepareArgs.indexOf("--working-dir") + 1;
  context.prepareArgs[workingIndex] = working;
  const result = invoke(context.prepareArgs);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /working directory.*repository/iu);
  assert.equal(existsSync(context.destination), false);
  assert.equal(
    records(context.record).some(({ mode }) => mode === "model"),
    false,
  );
});
