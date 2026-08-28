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
import { EXTERNAL_MODEL_AUTHORIZATION_STATEMENT } from "../../../scripts/evaluation/runtime.js";

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

function fixture() {
  const temporary = mkdtempSync(
    path.join(tmpdir(), "defining-concepts-runner-"),
  );
  const prompt = path.join(temporary, "prompt.txt");
  const skill = path.join(temporary, "SKILL.md");
  const destination = path.join(temporary, "prepared");
  const working = path.join(temporary, "working");
  const record = path.join(temporary, "provider.jsonl");
  writeFileSync(prompt, "Define the registry concept Dataset.", "utf8");
  writeFileSync(skill, "# Test skill\n\nFollow the workflow.\n", "utf8");
  const prepareArgs = [
    "prepare",
    "--prompt-file",
    prompt,
    "--destination",
    destination,
    "--working-dir",
    working,
    "--arm",
    "with_skill",
    "--eval-id",
    "1",
    "--repetition",
    "1",
    "--provider",
    "claude",
    "--model",
    "claude-opus-4-1",
    "--effort",
    "high",
    "--skill-file",
    skill,
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
    prompt,
    record,
    skill,
    temporary,
    working,
  };
}

function googleFixture() {
  const temporary = mkdtempSync(
    path.join(tmpdir(), "defining-concepts-google-"),
  );
  const prompt = path.join(temporary, "prompt.txt");
  const skill = path.join(temporary, "SKILL.md");
  const destination = path.join(temporary, "prepared");
  const working = path.join(temporary, "working");
  const record = path.join(temporary, "provider.jsonl");
  writeFileSync(prompt, "Define the registry concept Dataset.", "utf8");
  writeFileSync(skill, "# Test skill\n\nFollow the workflow.\n\n", "utf8");
  return {
    destination,
    prompt,
    record,
    skill,
    temporary,
    working,
    prepareArgs: [
      "prepare",
      "--prompt-file",
      prompt,
      "--destination",
      destination,
      "--working-dir",
      working,
      "--arm",
      "with_skill",
      "--eval-id",
      "1",
      "--repetition",
      "1",
      "--provider",
      "antigravity",
      "--model",
      "gemini-3.5-flash-low",
      "--effort",
      "low",
      "--skill-file",
      skill,
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
  const initialInput = Object.freeze([
    Object.freeze({ type: "text", text: "packet-bound prompt" }),
  ]);
  const controller = createDefiningConceptController({ initialInput });
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
  assert.equal(controller.initialInput, initialInput);
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
    /completed one-turn result/u,
  );
});

test("prepare freezes packet inputs and performs no provider model turn", () => {
  const context = fixture();
  const result = invoke(context.prepareArgs);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    records(context.record).some(({ mode }) => mode === "model"),
    false,
  );
  const packet = JSON.parse(
    readFileSync(path.join(context.destination, "packet.json"), "utf8"),
  );
  assert.equal(packet.transmission.provider, "anthropic");
  assert.equal(packet.transmission.transport, "claude-cli");
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
  writeFileSync(context.prompt, "mutated source prompt", "utf8");
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
  const prompt = path.join(temporary, "prompt.txt");
  const destination = path.join(temporary, "prepared");
  const working = path.join(temporary, "working");
  const homes = path.join(temporary, "homes-v1");
  writeFileSync(prompt, "Define Dataset.", "utf8");
  await initializeEvaluationHomes({ root: homes });
  const result = invoke([
    "prepare",
    "--prompt-file",
    prompt,
    "--destination",
    destination,
    "--working-dir",
    working,
    "--arm",
    "without_skill",
    "--eval-id",
    "1",
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
  assert.equal(packet.transmission.capabilities.webSearch, true);
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
  assert.match(userInputs[0].content, /# Test skill/u);
  assert.match(userInputs[0].content, /# User task/u);
  assert.match(userInputs[0].content, /Define the registry concept Dataset\./u);
  assert.ok(
    userInputs[0].content.includes(
      "# Task-specific skill\n\n# Test skill\n\nFollow the workflow.\n\n\n# User task",
    ),
    "the composed prompt must preserve the complete skill text",
  );
  assert.deepEqual(
    packet.transmission.runtimeFingerprint.modules.map(({ path }) => path),
    [
      "evals/defining-concepts/run-evaluation-session.mjs",
      "evals/defining-concepts/session-controller.mjs",
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
