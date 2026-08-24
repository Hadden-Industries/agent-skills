import { appendFile, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const scenario = option("--scenario") ?? "happy";
const recordFile = option("--record-file");
const removeDirectory = option("--remove-directory");
const operationalArguments = process.argv
  .slice(2)
  .filter((argument, index, all) => {
    const previous = all[index - 1];
    return (
      !["--scenario", "--record-file", "--remove-directory"].includes(
        previous,
      ) &&
      !["--scenario", "--record-file", "--remove-directory"].includes(argument)
    );
  });

async function records() {
  if (recordFile === null) {
    return [];
  }
  try {
    return (await readFile(recordFile, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
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
  const versionCalls = prior.filter(({ mode }) => mode === "version").length;
  await record({ mode: "version", arguments: operationalArguments });
  const drifted = scenario === "version-drift-after-first" && versionCalls > 0;
  process.stdout.write(
    drifted ? "2.1.234 (Claude Code)\n" : "2.1.233 (Claude Code)\n",
  );
  process.exit(0);
}

if (operationalArguments.length === 1 && operationalArguments[0] === "--help") {
  await record({ mode: "help", arguments: operationalArguments });
  process.stdout.write(
    "Usage: claude [options]\n  -p, --print\n  --output-format <format>\n",
  );
  process.exit(0);
}

if (
  operationalArguments.length === 3 &&
  operationalArguments[0] === "auth" &&
  operationalArguments[1] === "status" &&
  operationalArguments[2] === "--json"
) {
  const prior = await records();
  const authCalls = prior.filter(({ mode }) => mode === "auth").length;
  const authMethod =
    scenario === "auth-mode-drift-after-preflight" && authCalls > 0
      ? "api_key"
      : "oauth";
  await record({
    mode: "auth",
    arguments: operationalArguments,
    environmentNames: Object.keys(process.env).sort(),
  });
  if (
    scenario === "launch-failure" &&
    authCalls > 0 &&
    removeDirectory !== null
  ) {
    await rm(removeDirectory, { recursive: true, force: true });
  }
  process.stdout.write(
    `${JSON.stringify({
      loggedIn: scenario !== "unauthenticated",
      authMethod,
      apiProvider: "firstParty",
      email: "identity@example.test",
      token: "secret-token-must-not-survive",
    })}\n`,
  );
  process.exit(0);
}

if (operationalArguments[0] !== "-p") {
  await record({ mode: "invalid", arguments: operationalArguments });
  process.stderr.write("unexpected invocation\n");
  process.exit(64);
}

let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  stdin += chunk;
}

await record({
  mode: "model",
  arguments: operationalArguments,
  cwd: process.cwd(),
  environmentNames: Object.keys(process.env).sort(),
  visibleEnvironment: process.env.EVALUATION_VISIBLE ?? null,
  inheritedScenario: process.env.EVALUATION_SCENARIO ?? null,
  stdin,
});

process.stderr.write("fake claude diagnostic\n");

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
  setInterval(() => {}, 1000);
  process.once("SIGINT", () => process.exit(130));
  process.once("SIGTERM", () => process.exit(143));
  await new Promise(() => {});
}

if (scenario === "malformed-json") {
  process.stdout.write('{"type":"system"}\nnot-json\n');
  process.exit(0);
}

writeEvent({ type: "system", subtype: "init", session_id: "fake-session" });
writeEvent({
  type: "assistant",
  message: {
    id: "message-1",
    content: [{ type: "text", text: "Answer body" }],
  },
});

if (scenario === "nonzero-exit") {
  process.exit(7);
}

if (scenario === "provider-error") {
  writeEvent({
    type: "result",
    subtype: "error",
    is_error: true,
    result: "provider failed",
  });
  process.exit(0);
}

writeEvent({
  type: "result",
  subtype: "success",
  is_error: false,
  result: scenario === "empty-final" ? "" : "Authoritative final answer",
  usage: {
    input_tokens: 10,
    cache_creation_input_tokens: 2,
    cache_read_input_tokens: 3,
    output_tokens: 20,
  },
  modelUsage: { "claude-opus-4-1": { inputTokens: 10, outputTokens: 20 } },
  total_cost_usd: 0.25,
});
