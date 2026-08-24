import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

const EVALUATION_HARNESS = `# Isolated behavioral evaluation

Do not inspect local files, repository metadata, memories, plugins, commands,
or discoverable skills. Use only the user's prompt, live web search, and the
task-specific skill text below when one is present.
If unrelated task-specific skill material becomes visible, output
BASELINE_CONTAMINATION and stop. Do not mention this harness in an otherwise
valid final answer.
`;

function parseArguments(argv) {
  const values = new Map();
  const claudePrefixArguments = [];
  const codexPrefixArguments = [];

  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(
        `Expected --name value arguments; received ${name ?? "end of input"}`,
      );
    }
    if (name === "--claude-prefix-arg") {
      claudePrefixArguments.push(value);
    } else if (name === "--codex-prefix-arg") {
      codexPrefixArguments.push(value);
    } else if (values.has(name)) {
      throw new Error(`Duplicate argument: ${name}`);
    } else {
      values.set(name, value);
    }
  }

  const required = [
    "--prompt-file",
    "--run-dir",
    "--working-dir",
    "--arm",
    "--eval-id",
    "--repetition",
    "--model",
  ];
  for (const name of required) {
    if (!values.get(name))
      throw new Error(`Missing required argument: ${name}`);
  }

  const arm = values.get("--arm");
  if (!new Set(["with_skill", "without_skill"]).has(arm)) {
    throw new Error(`Unsupported arm: ${arm}`);
  }
  const provider = values.get("--provider") ?? "claude";
  if (!new Set(["claude", "codex"]).has(provider)) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const evalId = Number(values.get("--eval-id"));
  const repetition = Number(values.get("--repetition"));
  if (!Number.isInteger(evalId) || evalId < 1) {
    throw new Error("--eval-id must be a positive integer");
  }
  if (!Number.isInteger(repetition) || repetition < 1) {
    throw new Error("--repetition must be a positive integer");
  }

  return {
    promptFile: path.resolve(values.get("--prompt-file")),
    runDirectory: path.resolve(values.get("--run-dir")),
    workingDirectory: path.resolve(values.get("--working-dir")),
    arm,
    provider,
    evalId,
    repetition,
    model: values.get("--model"),
    skillFile: values.get("--skill-file")
      ? path.resolve(values.get("--skill-file"))
      : null,
    maxBudgetUsd: values.get("--max-budget-usd") ?? "2",
    claudeCommand: values.get("--claude-command") ?? "claude",
    claudePrefixArguments,
    codexCommand:
      values.get("--codex-command") ??
      values.get("--claude-command") ??
      "codex",
    codexPrefixArguments:
      codexPrefixArguments.length > 0
        ? codexPrefixArguments
        : claudePrefixArguments,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertAbsentOrEmpty(directory, label) {
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    throw new Error(`${label} must be absent or empty: ${directory}`);
  }
}

function prepareDirectory(directory) {
  mkdirSync(directory, { recursive: true });
}

function parseJsonEvents(stdout) {
  const events = [];
  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Preserve malformed lines in transcript.jsonl; metadata only uses JSON events.
    }
  }
  return events;
}

function parseClaudeTranscript(stdout) {
  const events = parseJsonEvents(stdout);

  const resultEvent =
    events.findLast((event) => event.type === "result") ?? null;
  const actualModels = new Set();
  const toolCalls = {};
  let totalSteps = 0;
  let errorsEncountered = 0;
  for (const event of events) {
    const model = event?.message?.model;
    if (typeof model === "string" && model) actualModels.add(model);
    if (event.type === "assistant") {
      totalSteps += 1;
      for (const item of event?.message?.content ?? []) {
        if (item?.type !== "tool_use" || typeof item.name !== "string")
          continue;
        toolCalls[item.name] = (toolCalls[item.name] ?? 0) + 1;
      }
    }
    for (const item of event?.message?.content ?? []) {
      if (item?.type === "tool_result" && item.is_error === true) {
        errorsEncountered += 1;
      }
    }
  }
  for (const model of Object.keys(resultEvent?.modelUsage ?? {})) {
    actualModels.add(model);
  }
  if (resultEvent?.is_error === true) errorsEncountered += 1;

  return {
    events,
    resultEvent,
    actualModels: [...actualModels].sort(),
    toolCalls,
    totalSteps,
    errorsEncountered,
  };
}

const CODEX_TOOL_TYPES = new Set([
  "collab_tool_call",
  "command_execution",
  "computer_tool_call",
  "file_change",
  "image_generation_call",
  "mcp_tool_call",
  "web_search",
  "web_search_call",
]);

function parseCodexTranscript(stdout) {
  const events = parseJsonEvents(stdout);
  const threadEvent =
    events.find((event) => event.type === "thread.started") ?? null;
  const completedTurn =
    events.findLast((event) => event.type === "turn.completed") ?? null;
  const failedTurn =
    events.findLast((event) => event.type === "turn.failed") ?? null;
  const finalMessageEvent =
    events.findLast(
      (event) =>
        event.type === "item.completed" &&
        event?.item?.type === "agent_message" &&
        typeof event.item.text === "string",
    ) ?? null;
  const actualModels = new Set();
  const toolCalls = {};
  let totalSteps = 0;
  let errorsEncountered = 0;

  for (const event of events) {
    for (const model of [event?.model, event?.item?.model]) {
      if (typeof model === "string" && model) actualModels.add(model);
    }
    if (event.type === "error" || event.type === "turn.failed") {
      errorsEncountered += 1;
    }
    if (event.type !== "item.completed") continue;
    totalSteps += 1;
    const itemType = event?.item?.type;
    if (CODEX_TOOL_TYPES.has(itemType)) {
      toolCalls[itemType] = (toolCalls[itemType] ?? 0) + 1;
    }
    if (
      event?.item?.status === "failed" ||
      event?.item?.is_error === true ||
      event?.item?.error
    ) {
      errorsEncountered += 1;
    }
  }

  return {
    events,
    threadId: threadEvent?.thread_id ?? null,
    completedTurn,
    failedTurn,
    finalMessageEvent,
    finalAnswer: finalMessageEvent?.item?.text ?? "",
    actualModels: [...actualModels].sort(),
    toolCalls,
    totalSteps,
    errorsEncountered,
    numTurns: events.filter((event) => event.type === "turn.started").length,
  };
}

function totalTokens(usage) {
  if (!usage || typeof usage !== "object") return 0;
  if (Number.isFinite(Number(usage.total_tokens))) {
    return Number(usage.total_tokens);
  }
  if (Object.hasOwn(usage, "cached_input_tokens")) {
    return (
      (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0)
    );
  }
  return [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ].reduce((total, name) => total + (Number(usage[name]) || 0), 0);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const prompt = readFileSync(options.promptFile);
  const skill = options.skillFile ? readFileSync(options.skillFile) : null;

  if (options.arm === "with_skill" && !skill) {
    throw new Error("The with_skill arm requires --skill-file");
  }
  if (options.arm === "without_skill" && skill) {
    throw new Error("The without_skill arm cannot receive --skill-file");
  }

  assertAbsentOrEmpty(options.runDirectory, "Run directory");
  assertAbsentOrEmpty(options.workingDirectory, "Working directory");
  prepareDirectory(options.runDirectory);
  const inputsDirectory = path.join(options.runDirectory, "inputs");
  const outputsDirectory = path.join(options.runDirectory, "outputs");
  mkdirSync(inputsDirectory);
  mkdirSync(outputsDirectory);
  prepareDirectory(options.workingDirectory);

  const instructions = skill
    ? `${EVALUATION_HARNESS}\n# Task-specific skill\n\n${skill.toString("utf8")}`
    : EVALUATION_HARNESS;
  const instructionsPath = path.join(inputsDirectory, "instructions.md");
  writeFileSync(instructionsPath, instructions, "utf8");

  let command;
  let commandArguments;
  if (options.provider === "codex") {
    command = options.codexCommand;
    commandArguments = [
      ...options.codexPrefixArguments,
      "--search",
      "exec",
      "--config",
      "project_doc_max_bytes=0",
      "--config",
      `developer_instructions=${JSON.stringify(instructions)}`,
      "--model",
      options.model,
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--json",
      "-C",
      options.workingDirectory,
      "-",
    ];
  } else {
    command = options.claudeCommand;
    commandArguments = [
      ...options.claudePrefixArguments,
      "-p",
      "--safe-mode",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
      "--tools",
      "WebSearch,WebFetch",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      options.model,
      "--max-budget-usd",
      options.maxBudgetUsd,
      "--append-system-prompt-file",
      instructionsPath,
    ];
  }

  const environment = { ...process.env };
  if (options.provider === "claude") delete environment.CLAUDECODE;

  const startedAt = new Date();
  const started = performance.now();
  let stdout = "";
  let stderr = "";
  let launchError = null;
  let exitCode = 1;
  try {
    const child = spawn(command, commandArguments, {
      cwd: options.workingDirectory,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end(prompt);

    exitCode = await new Promise((resolve) => {
      child.once("error", (error) => {
        launchError = error;
        resolve(1);
      });
      child.once("close", (code) => resolve(code ?? 1));
    });
  } catch (error) {
    launchError = error;
  }
  if (launchError) {
    stderr += `${launchError.stack ?? launchError.message}\n`;
  }
  const endedAt = new Date();
  const wallDurationMs = Math.round(performance.now() - started);
  const parsed =
    options.provider === "codex"
      ? parseCodexTranscript(stdout)
      : parseClaudeTranscript(stdout);
  const resultEvent =
    options.provider === "codex" ? parsed.completedTurn : parsed.resultEvent;
  const succeeded = launchError
    ? false
    : options.provider === "codex"
      ? exitCode === 0 &&
        Boolean(parsed.completedTurn) &&
        !parsed.failedTurn &&
        Boolean(parsed.finalMessageEvent)
      : exitCode === 0 && resultEvent?.subtype === "success";
  const finalAnswer =
    options.provider === "codex"
      ? parsed.finalAnswer
      : typeof resultEvent?.result === "string"
        ? resultEvent.result
        : "";
  const usage = resultEvent?.usage ?? null;

  writeFileSync(
    path.join(outputsDirectory, "transcript.jsonl"),
    stdout,
    "utf8",
  );
  writeFileSync(path.join(outputsDirectory, "stderr.log"), stderr, "utf8");
  writeFileSync(path.join(outputsDirectory, "final.md"), finalAnswer, "utf8");

  const metadata = {
    schema_version: 2,
    provider: options.provider,
    status: succeeded ? "succeeded" : "failed",
    exit_code: exitCode,
    arm: options.arm,
    eval_id: options.evalId,
    repetition: options.repetition,
    requested_model: options.model,
    actual_models: parsed.actualModels,
    actual_model_evidence:
      parsed.actualModels.length > 0 ? "transcript" : "not_exposed_by_provider",
    prompt_bytes: prompt.byteLength,
    prompt_sha256: sha256(prompt),
    skill_bytes: skill?.byteLength ?? null,
    skill_sha256: skill ? sha256(skill) : null,
    instructions_bytes: Buffer.byteLength(instructions),
    instructions_sha256: sha256(instructions),
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    wall_duration_ms: wallDurationMs,
    result_duration_ms:
      options.provider === "claude" ? (resultEvent?.duration_ms ?? null) : null,
    api_duration_ms:
      options.provider === "claude"
        ? (resultEvent?.duration_api_ms ?? null)
        : null,
    num_turns:
      options.provider === "codex"
        ? parsed.numTurns
        : (resultEvent?.num_turns ?? null),
    total_cost_usd:
      options.provider === "claude"
        ? (resultEvent?.total_cost_usd ?? null)
        : null,
    usage,
    model_usage:
      options.provider === "claude" ? (resultEvent?.modelUsage ?? null) : null,
    result_subtype: launchError
      ? "launch_error"
      : options.provider === "codex"
        ? succeeded
          ? "success"
          : parsed.failedTurn
            ? "failed"
            : null
        : (resultEvent?.subtype ?? null),
    is_error:
      options.provider === "claude"
        ? (resultEvent?.is_error ?? !succeeded)
        : !succeeded,
    thread_id: options.provider === "codex" ? parsed.threadId : null,
    launch_error: launchError
      ? {
          name: launchError.name ?? "Error",
          message: launchError.message ?? String(launchError),
          code: launchError.code ?? null,
          errno: launchError.errno ?? null,
          syscall: launchError.syscall ?? null,
          path: launchError.path ?? null,
        }
      : null,
  };
  writeFileSync(
    path.join(options.runDirectory, "run.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );

  const metrics = {
    tool_calls: parsed.toolCalls,
    total_tool_calls: Object.values(parsed.toolCalls).reduce(
      (total, count) => total + count,
      0,
    ),
    total_steps: parsed.totalSteps,
    files_created: ["outputs/final.md"],
    errors_encountered: parsed.errorsEncountered + (launchError ? 1 : 0),
    output_chars: finalAnswer.length,
    transcript_chars: stdout.length,
  };
  writeFileSync(
    path.join(options.runDirectory, "metrics.json"),
    `${JSON.stringify(metrics, null, 2)}\n`,
    "utf8",
  );

  const timing = {
    total_tokens: totalTokens(usage),
    duration_ms: wallDurationMs,
    total_duration_seconds: wallDurationMs / 1000,
    executor_start: startedAt.toISOString(),
    executor_end: endedAt.toISOString(),
    executor_duration_seconds: wallDurationMs / 1000,
  };
  writeFileSync(
    path.join(options.runDirectory, "timing.json"),
    `${JSON.stringify(timing, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(`${JSON.stringify(metadata)}\n`);
  if (!succeeded) process.exitCode = exitCode || 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
