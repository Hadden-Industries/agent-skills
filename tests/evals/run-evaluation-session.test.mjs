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

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const runnerPath = path.join(
  repositoryRoot,
  "evals",
  "defining-concepts",
  "run-evaluation-session.mjs",
);

test("captures an exact model stream, final answer, diagnostics, and usage metadata", () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "defining-concepts-runner-"),
  );
  const promptPath = path.join(temporaryRoot, "prompt.txt");
  const runDirectory = path.join(temporaryRoot, "run");
  const sessionDirectory = path.join(temporaryRoot, "session");
  const fakeClaudePath = path.join(temporaryRoot, "fake-claude.mjs");
  const skillPath = path.join(temporaryRoot, "SKILL.md");
  const prompt = "Define the registry concept Dataset.";
  const finalAnswer = "### 1. Semantic Analysis\n\nComplete artifact";

  writeFileSync(promptPath, prompt, "utf8");
  writeFileSync(
    skillPath,
    "# Test skill\n\nFollow the test workflow.\n",
    "utf8",
  );
  writeFileSync(
    fakeClaudePath,
    `
import process from "node:process";

let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;

process.stdout.write(JSON.stringify({
  type: "assistant",
  message: {
    model: "claude-test-1",
    content: [{ type: "text", text: ${JSON.stringify(finalAnswer)} }],
  },
}) + "\\n");
process.stdout.write(JSON.stringify({
  type: "result",
  subtype: "success",
  result: ${JSON.stringify(finalAnswer)},
  duration_ms: 1234,
  duration_api_ms: 1000,
  num_turns: 3,
  total_cost_usd: 0.25,
  usage: { input_tokens: 10, output_tokens: 20 },
  modelUsage: {
    "claude-test-1": { inputTokens: 10, outputTokens: 20, costUSD: 0.25 },
  },
  observed_prompt: prompt,
}) + "\\n");
process.stderr.write("fake diagnostic\\n");
`,
    "utf8",
  );

  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      "--prompt-file",
      promptPath,
      "--run-dir",
      runDirectory,
      "--working-dir",
      sessionDirectory,
      "--arm",
      "with_skill",
      "--eval-id",
      "1",
      "--repetition",
      "1",
      "--model",
      "sonnet",
      "--skill-file",
      skillPath,
      "--claude-command",
      process.execPath,
      "--claude-prefix-arg",
      fakeClaudePath,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const inputsDirectory = path.join(runDirectory, "inputs");
  const outputsDirectory = path.join(runDirectory, "outputs");
  const instructions = readFileSync(
    path.join(inputsDirectory, "instructions.md"),
    "utf8",
  );
  assert.match(instructions, /Isolated behavioral evaluation/u);
  assert.match(instructions, /# Test skill/u);
  assert.equal(
    readFileSync(path.join(outputsDirectory, "final.md"), "utf8"),
    finalAnswer,
  );
  assert.equal(
    readFileSync(path.join(outputsDirectory, "stderr.log"), "utf8"),
    "fake diagnostic\n",
  );

  const transcript = readFileSync(
    path.join(outputsDirectory, "transcript.jsonl"),
    "utf8",
  );
  assert.equal(transcript.trimEnd().split("\n").length, 2);

  const metadata = JSON.parse(
    readFileSync(path.join(runDirectory, "run.json"), "utf8"),
  );
  assert.deepEqual(
    {
      status: metadata.status,
      exit_code: metadata.exit_code,
      arm: metadata.arm,
      eval_id: metadata.eval_id,
      repetition: metadata.repetition,
      requested_model: metadata.requested_model,
      actual_models: metadata.actual_models,
      actual_model_evidence: metadata.actual_model_evidence,
      total_cost_usd: metadata.total_cost_usd,
      usage: metadata.usage,
      model_usage: metadata.model_usage,
    },
    {
      status: "succeeded",
      exit_code: 0,
      arm: "with_skill",
      eval_id: 1,
      repetition: 1,
      requested_model: "sonnet",
      actual_models: ["claude-test-1"],
      actual_model_evidence: "transcript",
      total_cost_usd: 0.25,
      usage: { input_tokens: 10, output_tokens: 20 },
      model_usage: {
        "claude-test-1": {
          inputTokens: 10,
          outputTokens: 20,
          costUSD: 0.25,
        },
      },
    },
  );
  assert.equal(metadata.prompt_bytes, Buffer.byteLength(prompt));
  assert.match(metadata.prompt_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(metadata.schema_version, 2);
  assert.equal(metadata.instructions_bytes, Buffer.byteLength(instructions));
  assert.match(metadata.instructions_sha256, /^[0-9a-f]{64}$/u);
  assert.ok(metadata.wall_duration_ms >= 0);
  assert.equal(metadata.result_duration_ms, 1234);
  assert.equal(metadata.api_duration_ms, 1000);
  assert.equal(metadata.num_turns, 3);

  const metrics = JSON.parse(
    readFileSync(path.join(runDirectory, "metrics.json"), "utf8"),
  );
  assert.deepEqual(metrics.tool_calls, {});
  assert.equal(metrics.total_tool_calls, 0);
  assert.equal(metrics.total_steps, 1);
  assert.equal(metrics.errors_encountered, 0);
  assert.deepEqual(metrics.files_created, ["outputs/final.md"]);
  assert.equal(metrics.output_chars, finalAnswer.length);
  assert.equal(metrics.transcript_chars, transcript.length);

  const timing = JSON.parse(
    readFileSync(path.join(runDirectory, "timing.json"), "utf8"),
  );
  assert.equal(timing.total_tokens, 30);
  assert.equal(timing.duration_ms, metadata.wall_duration_ms);
  assert.equal(timing.total_duration_seconds, metadata.wall_duration_ms / 1000);
});

test("runs Codex in an isolated instruction directory and captures its JSONL protocol", () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "defining-concepts-codex-runner-"),
  );
  const promptPath = path.join(temporaryRoot, "prompt.txt");
  const runDirectory = path.join(temporaryRoot, "run");
  const sessionDirectory = path.join(temporaryRoot, "session");
  const fakeCodexPath = path.join(temporaryRoot, "fake-codex.mjs");
  const skillPath = path.join(temporaryRoot, "SKILL.md");
  const prompt = "Define the registry concept Dataset.";
  const finalAnswer = "### 1. Semantic Analysis\n\nCodex artifact";

  writeFileSync(promptPath, prompt, "utf8");
  writeFileSync(
    skillPath,
    "# Test skill\n\nFollow the test workflow.\n",
    "utf8",
  );
  writeFileSync(
    fakeCodexPath,
    `
import process from "node:process";

const requiredArguments = [
  "--search",
  "exec",
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--json",
  "--sandbox",
  "read-only",
  "--skip-git-repo-check",
];
for (const argument of requiredArguments) {
  if (!process.argv.includes(argument)) {
    process.stderr.write(\`missing Codex argument: \${argument}\\n\`);
    process.exit(7);
  }
}

const configValues = process.argv.flatMap((argument, index, arguments_) =>
  argument === "--config" ? [arguments_[index + 1]] : [],
);
if (!configValues.includes("project_doc_max_bytes=0")) {
  process.stderr.write("project instructions were not suppressed\\n");
  process.exit(8);
}
const developerConfig = configValues.find((value) =>
  value.startsWith("developer_instructions="),
);
const agentInstructions = developerConfig
  ? JSON.parse(developerConfig.slice("developer_instructions=".length))
  : "";
if (!agentInstructions.includes("# Test skill")) {
  process.stderr.write("missing treatment skill in developer instructions\\n");
  process.exit(9);
}

let observedPrompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) observedPrompt += chunk;
if (observedPrompt !== ${JSON.stringify(prompt)}) {
  process.stderr.write("prompt bytes changed\\n");
  process.exit(10);
}

const events = [
  { type: "thread.started", thread_id: "thread-test" },
  { type: "turn.started" },
  {
    type: "item.completed",
    item: { id: "search-1", type: "web_search", query: "Dataset registry" },
  },
  {
    type: "item.completed",
    item: {
      id: "message-1",
      type: "agent_message",
      text: ${JSON.stringify(finalAnswer)},
    },
  },
  {
    type: "turn.completed",
    usage: {
      input_tokens: 100,
      cached_input_tokens: 20,
      output_tokens: 30,
      total_tokens: 130,
    },
  },
];
for (const event of events) {
  process.stdout.write(JSON.stringify(event) + "\\n");
}
process.stderr.write("fake Codex diagnostic\\n");
`,
    "utf8",
  );

  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      "--provider",
      "codex",
      "--prompt-file",
      promptPath,
      "--run-dir",
      runDirectory,
      "--working-dir",
      sessionDirectory,
      "--arm",
      "with_skill",
      "--eval-id",
      "1",
      "--repetition",
      "1",
      "--model",
      "gpt-5.6-sol",
      "--skill-file",
      skillPath,
      "--codex-command",
      process.execPath,
      "--codex-prefix-arg",
      fakeCodexPath,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const inputsDirectory = path.join(runDirectory, "inputs");
  const outputsDirectory = path.join(runDirectory, "outputs");
  const instructions = readFileSync(
    path.join(inputsDirectory, "instructions.md"),
    "utf8",
  );
  assert.equal(existsSync(path.join(sessionDirectory, "AGENTS.md")), false);
  assert.match(instructions, /# Test skill/u);
  assert.equal(
    readFileSync(path.join(outputsDirectory, "final.md"), "utf8"),
    finalAnswer,
  );
  assert.equal(
    readFileSync(path.join(outputsDirectory, "stderr.log"), "utf8"),
    "fake Codex diagnostic\n",
  );

  const metadata = JSON.parse(
    readFileSync(path.join(runDirectory, "run.json"), "utf8"),
  );
  assert.equal(metadata.provider, "codex");
  assert.equal(metadata.status, "succeeded");
  assert.deepEqual(metadata.actual_models, []);
  assert.equal(metadata.actual_model_evidence, "not_exposed_by_provider");
  assert.equal(metadata.thread_id, "thread-test");
  assert.deepEqual(metadata.usage, {
    input_tokens: 100,
    cached_input_tokens: 20,
    output_tokens: 30,
    total_tokens: 130,
  });
  assert.equal(metadata.num_turns, 1);
  assert.equal(metadata.result_subtype, "success");

  const metrics = JSON.parse(
    readFileSync(path.join(runDirectory, "metrics.json"), "utf8"),
  );
  assert.deepEqual(metrics.tool_calls, { web_search: 1 });
  assert.equal(metrics.total_tool_calls, 1);
  assert.equal(metrics.total_steps, 2);
  assert.equal(metrics.errors_encountered, 0);

  const timing = JSON.parse(
    readFileSync(path.join(runDirectory, "timing.json"), "utf8"),
  );
  assert.equal(timing.total_tokens, 130);
});

test("refuses to overwrite a retained run directory before launching the model", () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "defining-concepts-immutable-run-"),
  );
  const promptPath = path.join(temporaryRoot, "prompt.txt");
  const runDirectory = path.join(temporaryRoot, "run");
  const sessionDirectory = path.join(temporaryRoot, "session");
  const fakeClaudePath = path.join(temporaryRoot, "fake-claude.mjs");
  const retainedPath = path.join(runDirectory, "retained.txt");

  writeFileSync(promptPath, "Define the registry concept Dataset.", "utf8");
  writeFileSync(fakeClaudePath, "process.exitCode = 0;\n", "utf8");
  mkdirSync(runDirectory);
  writeFileSync(retainedPath, "retain this result", "utf8");

  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      "--prompt-file",
      promptPath,
      "--run-dir",
      runDirectory,
      "--working-dir",
      sessionDirectory,
      "--arm",
      "without_skill",
      "--eval-id",
      "1",
      "--repetition",
      "1",
      "--model",
      "sonnet",
      "--claude-command",
      process.execPath,
      "--claude-prefix-arg",
      fakeClaudePath,
    ],
    { encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Run directory must be absent or empty/u);
  assert.equal(readFileSync(retainedPath, "utf8"), "retain this result");
  assert.equal(
    existsSync(path.join(runDirectory, "outputs", "transcript.jsonl")),
    false,
  );
});

test("refuses a non-empty session directory before launching the model", () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "defining-concepts-isolated-session-"),
  );
  const promptPath = path.join(temporaryRoot, "prompt.txt");
  const runDirectory = path.join(temporaryRoot, "run");
  const sessionDirectory = path.join(temporaryRoot, "session");
  const fakeClaudePath = path.join(temporaryRoot, "fake-claude.mjs");

  writeFileSync(promptPath, "Define the registry concept Dataset.", "utf8");
  writeFileSync(fakeClaudePath, "process.exitCode = 0;\n", "utf8");
  mkdirSync(sessionDirectory);
  writeFileSync(
    path.join(sessionDirectory, "contamination.txt"),
    "hidden context",
    "utf8",
  );

  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      "--prompt-file",
      promptPath,
      "--run-dir",
      runDirectory,
      "--working-dir",
      sessionDirectory,
      "--arm",
      "without_skill",
      "--eval-id",
      "1",
      "--repetition",
      "1",
      "--model",
      "sonnet",
      "--claude-command",
      process.execPath,
      "--claude-prefix-arg",
      fakeClaudePath,
    ],
    { encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Working directory must be absent or empty/u);
  assert.equal(existsSync(runDirectory), false);
});

test("retains a complete failed-run record when the model launcher cannot start", () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "defining-concepts-launch-failure-"),
  );
  const promptPath = path.join(temporaryRoot, "prompt.txt");
  const runDirectory = path.join(temporaryRoot, "run");
  const sessionDirectory = path.join(temporaryRoot, "session");
  const missingCommand = path.join(
    temporaryRoot,
    "definitely-missing-model-launcher.exe",
  );

  writeFileSync(promptPath, "Define the registry concept Dataset.", "utf8");

  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      "--prompt-file",
      promptPath,
      "--run-dir",
      runDirectory,
      "--working-dir",
      sessionDirectory,
      "--arm",
      "without_skill",
      "--eval-id",
      "1",
      "--repetition",
      "1",
      "--model",
      "test-model",
      "--claude-command",
      missingCommand,
    ],
    { encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  const outputsDirectory = path.join(runDirectory, "outputs");
  assert.equal(
    readFileSync(path.join(outputsDirectory, "transcript.jsonl"), "utf8"),
    "",
  );
  assert.equal(
    readFileSync(path.join(outputsDirectory, "final.md"), "utf8"),
    "",
  );
  assert.match(
    readFileSync(path.join(outputsDirectory, "stderr.log"), "utf8"),
    /ENOENT|cannot start|not found/iu,
  );

  const metadata = JSON.parse(
    readFileSync(path.join(runDirectory, "run.json"), "utf8"),
  );
  assert.equal(metadata.status, "failed");
  assert.equal(metadata.result_subtype, "launch_error");
  assert.equal(metadata.is_error, true);
  assert.match(metadata.launch_error.message, /ENOENT|not found/iu);

  const metrics = JSON.parse(
    readFileSync(path.join(runDirectory, "metrics.json"), "utf8"),
  );
  assert.equal(metrics.errors_encountered, 1);
  assert.equal(existsSync(path.join(runDirectory, "timing.json")), true);
});
