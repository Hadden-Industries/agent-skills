import { spawn } from "node:child_process";
import { appendFile, readFile, rm } from "node:fs/promises";
import { createInterface } from "node:readline";

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const fixtureOptions = new Set([
  "--record-file",
  "--remove-directory",
  "--scenario",
]);
const scenario = option("--scenario") ?? "happy";
const recordFile = option("--record-file");
const removeDirectory = option("--remove-directory");
const operationalArguments = process.argv
  .slice(2)
  .filter((argument, index, all) => {
    const previous = all[index - 1];
    return !fixtureOptions.has(previous) && !fixtureOptions.has(argument);
  });

async function records() {
  if (recordFile === null) return [];
  try {
    return (await readFile(recordFile, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function record(entry) {
  if (recordFile !== null) {
    await appendFile(recordFile, `${JSON.stringify(entry)}\n`, "utf8");
  }
}

function writeEvent(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

if (
  operationalArguments.length === 1 &&
  operationalArguments[0] === "--version"
) {
  const prior = await records();
  const calls = prior.filter(({ mode }) => mode === "version").length;
  await record({ mode: "version", arguments: operationalArguments });
  process.stdout.write(
    scenario === "version-drift-after-first" && calls > 0
      ? "1.1.20\n"
      : "1.1.19\n",
  );
  process.exit(0);
}

if (operationalArguments.length === 1 && operationalArguments[0] === "--help") {
  const prior = await records();
  const calls = prior.filter(({ mode }) => mode === "help").length;
  await record({ mode: "help", arguments: operationalArguments });
  process.stdout.write(
    "Usage: agy [options]\n  --input-format <format>\n  --output-format <format>\n  --sandbox\n  --disable-slash-commands\n",
  );
  if (scenario === "launch-failure" && calls > 0 && removeDirectory !== null) {
    await rm(removeDirectory, { recursive: true, force: true });
  }
  process.exit(0);
}

await record({
  mode: "model",
  arguments: operationalArguments,
  cwd: process.cwd(),
  environmentNames: Object.keys(process.env).sort(),
  visibleEnvironment: process.env.EVALUATION_VISIBLE ?? null,
});
process.stderr.write("fake antigravity diagnostic\n");

const conversationId = "fake-google-conversation";
const tools =
  scenario === "external-advertised-tool"
    ? ["ask_permission", "run_command", "mcp__external__read"]
    : ["ask_permission", "run_command", "write_to_file"];
const initEvent = {
  event: "init",
  conversation_id: conversationId,
  init: {
    cwd: scenario === "cwd-mismatch" ? "C:\\wrong-cwd" : process.cwd(),
    tools,
    permission_mode:
      scenario === "permission-mode-mismatch"
        ? "always-proceed"
        : "request-review",
    model:
      scenario === "model-mismatch"
        ? "different-google-model"
        : option("--model"),
  },
};
if (scenario === "agent-override") initEvent.init.agent = "research";
if (scenario !== "missing-init") writeEvent(initEvent);
if (scenario === "duplicate-init") writeEvent(initEvent);
if (scenario === "malformed-utf8") {
  process.stdout.write(Buffer.from([0xff, 0x0a]));
}
if (scenario === "unknown-event") {
  writeEvent({ event: "unreviewed_event", payload: {} });
}

if (scenario === "timeout" || scenario === "shutdown-ambiguous") {
  if (scenario === "shutdown-ambiguous") {
    spawn(
      process.execPath,
      [
        "-e",
        'setTimeout(() => process.stdout.write("descendant-held-stdio\\n"), 1000)',
      ],
      {
        detached: true,
        stdio: ["ignore", "inherit", "inherit"],
        windowsHide: true,
      },
    ).unref();
  }
  setInterval(() => {}, 1_000);
  process.once("SIGINT", () => process.exit(130));
  process.once("SIGTERM", () => process.exit(143));
  await new Promise(() => {});
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let turn = 0;
let nonzeroExit = false;
for await (const line of input) {
  turn += 1;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    writeEvent({
      event: "result",
      result: {
        conversation_id: conversationId,
        status: "ERROR",
        response: "",
        error: "invalid input",
        duration_seconds: 0,
        num_turns: turn - 1,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          thinking_tokens: 0,
          cache_read_tokens: 0,
          total_tokens: 0,
        },
      },
    });
    process.exit(1);
  }
  await record({ mode: "input", turn, message });

  writeEvent({
    event: "step_update",
    step_update: {
      conversation_id: conversationId,
      step_index: (turn - 1) * 3,
      state: "DONE",
      step_type: "user_input",
    },
  });

  if (scenario === "malformed-json") {
    process.stdout.write("not-json\n");
    process.exit(0);
  }
  if (scenario === "tool-use") {
    writeEvent({
      event: "step_update",
      step_update: {
        conversation_id: conversationId,
        step_index: (turn - 1) * 3 + 1,
        state: "DONE",
        step_type: "tool",
        tool_name: "run_command",
        tool_info: {
          name: "run_command",
          parameters: { CommandLine: "git status" },
          output: "",
        },
      },
    });
  }
  if (scenario === "subagent-use") {
    writeEvent({
      event: "step_update",
      step_update: {
        conversation_id: conversationId,
        step_index: (turn - 1) * 3 + 1,
        state: "DONE",
        step_type: "agent_response",
        subagent_info: {
          subagents: [
            {
              type_name: "research",
              role: "worker",
              conversation_id: "child-conversation",
              log_uri: "memory://child",
              workspace_uris: [],
            },
          ],
        },
      },
    });
  }

  const response =
    turn === 1 ? "Authoritative Google answer" : "Second Google answer";
  writeEvent({
    event: "step_update",
    step_update: {
      conversation_id: conversationId,
      step_index: (turn - 1) * 3 + 2,
      state: "DONE",
      step_type: "agent_response",
      text_delta: `${response}\n`,
      duration_seconds: turn * 0.5,
      usage: {
        input_tokens: turn * 100,
        output_tokens: turn * 20,
        thinking_tokens: turn * 5,
        cache_read_tokens: turn * 50,
        total_tokens: turn * 120,
      },
    },
  });

  if (scenario === "missing-result") process.exit(0);

  const providerError = scenario === "provider-error";
  const result = {
    event: "result",
    result: {
      conversation_id:
        scenario === "conversation-mismatch"
          ? "different-conversation"
          : conversationId,
      status: providerError ? "ERROR" : "SUCCESS",
      response:
        scenario === "empty-response" || providerError ? "" : `${response}\n`,
      duration_seconds: turn * 0.75,
      num_turns: scenario === "turn-count-mismatch" ? turn + 1 : turn,
      usage: {
        input_tokens: turn * 100,
        output_tokens: turn * 20,
        thinking_tokens: turn * 5,
        cache_read_tokens: turn * 50,
        total_tokens: scenario === "inconsistent-usage" ? 999 : turn * 120,
      },
    },
  };
  if (providerError) result.result.error = "provider failed";
  writeEvent(result);
  if (scenario === "duplicate-result") writeEvent(result);
  if (scenario === "nonzero-exit") nonzeroExit = true;
}

process.exit(nonzeroExit ? 7 : 0);
