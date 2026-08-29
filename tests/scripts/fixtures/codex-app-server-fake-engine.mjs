import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const DEFAULT_SCHEMA_BUNDLE = Object.freeze({
  "ClientRequest.json": Object.freeze({
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "ClientRequest",
    type: "object",
  }),
  "v2/ThreadStartParams.json": Object.freeze({
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "ThreadStartParams",
    type: "object",
  }),
});
const APP_SERVER_ARGUMENTS = Object.freeze([
  "-c",
  'cli_auth_credentials_store="file"',
  "app-server",
]);

function parseArguments(arguments_) {
  const scenarioIndex = arguments_.indexOf("--scenario");
  if (
    scenarioIndex < 0 ||
    scenarioIndex + 1 >= arguments_.length ||
    arguments_[scenarioIndex + 1].startsWith("--")
  ) {
    throw new Error("fake App Server requires an explicit --scenario argument");
  }

  const scenario = arguments_[scenarioIndex + 1];
  const operationalArguments = arguments_.filter(
    (_argument, index) =>
      index !== scenarioIndex && index !== scenarioIndex + 1,
  );
  return { operationalArguments, scenario };
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function generateSchemaBundle({
  operationalArguments,
  schemaBundle,
  scenario,
}) {
  const expectedPrefix = ["app-server", "generate-json-schema", "--out"];
  if (
    operationalArguments.length !== 4 ||
    expectedPrefix.some(
      (argument, index) => operationalArguments[index] !== argument,
    )
  ) {
    return false;
  }

  const outputDirectory = operationalArguments[3];
  await mkdir(outputDirectory, { recursive: true });
  for (const [relativePath, value] of Object.entries(schemaBundle)) {
    const target = join(outputDirectory, ...relativePath.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  await writeFile(
    join(dirname(outputDirectory), "fake-invocation.json"),
    `${JSON.stringify(
      {
        arguments: ["--scenario", scenario, ...operationalArguments],
        inheritedScenario: process.env.FAKE_APP_SERVER_SCENARIO ?? null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return true;
}

function createProtocolContext({ scenario, scenarioHandlers }) {
  const state = {
    initializedNotifications: 0,
    initializeRequestId: null,
    requests: [],
    scenario,
    threadId: "019a-generic-fake-thread",
    turnCount: 0,
    pendingModelRequest: null,
    pendingServerRequests: new Map(),
    cleanupExitScheduled: false,
  };
  const context = Object.freeze({
    send: writeMessage,
    state,
  });
  const scenarioHandler = scenarioHandlers[scenario];

  return {
    context,
    async handle(message) {
      state.requests.push(message);
      if (
        Object.hasOwn(message, "id") &&
        typeof message.method !== "string" &&
        state.pendingServerRequests.has(message.id)
      ) {
        const continuation = state.pendingServerRequests.get(message.id);
        state.pendingServerRequests.delete(message.id);
        await continuation(message.result);
        return;
      }
      if (typeof scenarioHandler === "function") {
        const handled = await scenarioHandler(message, context);
        if (handled === true) {
          return;
        }
      }

      if (message.method === "initialize") {
        state.initializeRequestId = message.id;
        if (scenario === "malformed-json") {
          process.stdout.write("{not-json\n");
          return;
        }
        if (scenario === "unknown-response") {
          writeMessage({ id: 987654, result: {} });
          return;
        }
        if (scenario === "premature-eof") {
          process.exit(0);
          return;
        }
        if (scenario === "nonzero-exit") {
          process.stderr.write("deliberate fake failure\n");
          process.exitCode = 7;
          process.stdin.destroy();
          process.stdout.end();
          return;
        }
        writeMessage({
          id: message.id,
          result: {
            codexHome:
              scenario === "wrong-codex-home"
                ? process.cwd()
                : (process.env.CODEX_HOME ?? process.cwd()),
            platformFamily: process.platform === "win32" ? "windows" : "unix",
            platformOs: process.platform,
            userAgent: "codex_cli_rs/9.9.9-test",
          },
        });
        if (scenario === "duplicate-response") {
          writeMessage({ id: message.id, result: { duplicate: true } });
        }
      } else if (message.method === "initialized") {
        state.initializedNotifications += 1;
      } else if (message.method === "account/read") {
        if (scenario === "duplicate-while-account-write-pending") {
          writeMessage({
            id: state.initializeRequestId,
            result: { duplicate: true },
          });
          return;
        }
        if (scenario === "slow-account") {
          await new Promise((resolvePromise) => {
            setTimeout(resolvePromise, 200);
          });
        }
        if (scenario === "authentication-error") {
          writeMessage({
            error: {
              code: -32000,
              data: { accessToken: "secret-access-token" },
              message: "secret@example.invalid could not authenticate",
            },
            id: message.id,
          });
          return;
        }
        writeMessage({
          id: message.id,
          result: {
            account:
              scenario === "unauthenticated"
                ? null
                : { email: "secret@example.invalid", type: "chatgpt" },
            requiresOpenaiAuth: true,
          },
        });
      } else if (message.method === "model/list") {
        state.pendingModelRequest = message;
      } else if (message.method === "modelProvider/capabilities/read") {
        if (scenario === "raw-transcript") {
          process.stdout.write(
            '{  "method" : "server/notice", "params" : { "category" : "preflight", "message" : "retained notification" }  }\r\n',
          );
        } else {
          writeMessage({
            method: "server/notice",
            params: { category: "preflight", message: "retained notification" },
          });
        }
        writeMessage({
          id: message.id,
          result: {
            imageGeneration: scenario === "provider-capabilities-available",
            namespaceTools: scenario === "provider-capabilities-available",
            webSearch:
              scenario === "provider-capabilities-malformed"
                ? "available"
                : scenario === "provider-capabilities-available",
          },
        });
        if (state.pendingModelRequest !== null) {
          const advertisedModel =
            scenario === "model-unavailable"
              ? "gpt-unavailable-test"
              : "gpt-5.6-luna";
          const advertisedEffort =
            scenario === "effort-unavailable" ? "high" : "low";
          writeMessage({
            id: state.pendingModelRequest.id,
            result: {
              data: [
                {
                  defaultReasoningEffort: advertisedEffort,
                  description: "Fake model",
                  displayName: "Fake model",
                  hidden: false,
                  id: advertisedModel,
                  isDefault: true,
                  model: advertisedModel,
                  supportedReasoningEfforts: [
                    {
                      description: "Advertised effort",
                      reasoningEffort: advertisedEffort,
                    },
                  ],
                },
              ],
            },
          });
          state.pendingModelRequest = null;
        }
      } else if (message.method === "skills/list") {
        writeMessage({
          id: message.id,
          result: {
            data: message.params.cwds.map((cwd) => ({
              cwd,
              errors: [],
              skills: ["disabled-skill", "enabled-skill"].includes(scenario)
                ? [
                    {
                      description: "Unexpected skill",
                      enabled: scenario === "enabled-skill",
                      name: "unexpected-skill",
                      path: join(cwd, "SKILL.md"),
                      scope: "repo",
                    },
                  ]
                : [],
            })),
          },
        });
      } else if (message.method === "hooks/list") {
        writeMessage({
          id: message.id,
          result: {
            data: message.params.cwds.map((cwd) => ({
              cwd,
              errors: [],
              hooks: ["disabled-hook", "enabled-hook"].includes(scenario)
                ? [
                    {
                      enabled: scenario === "enabled-hook",
                      eventName: "sessionStart",
                      key: "unexpected-hook",
                    },
                  ]
                : [],
              warnings: [],
            })),
          },
        });
      } else if (message.method === "app/installed") {
        writeMessage({
          id: message.id,
          result: {
            apps:
              scenario === "callable-app"
                ? [
                    {
                      callable: true,
                      enabled: true,
                      id: "unexpected-app",
                      runtimeName: "unexpected",
                    },
                  ]
                : [],
          },
        });
      } else if (message.method === "thread/start") {
        if (scenario === "external-capability") {
          writeMessage({
            method: "mcpServer/status/changed",
            params: { name: "unexpected", status: "starting" },
          });
        }
        writeMessage({
          id: message.id,
          result: {
            allowProviderModelFallback:
              message.params.allowProviderModelFallback,
            approvalPolicy: message.params.approvalPolicy,
            approvalsReviewer: message.params.approvalsReviewer,
            baseInstructions: message.params.baseInstructions,
            cwd: message.params.cwd,
            developerInstructions: message.params.developerInstructions,
            dynamicTools:
              scenario === "missing-thread-isolation-field"
                ? undefined
                : message.params.dynamicTools,
            environments: message.params.environments,
            instructionSources:
              scenario === "leaked-instructions"
                ? [join(message.params.cwd, "AGENTS.md")]
                : [],
            model: message.params.model,
            modelProvider: message.params.modelProvider,
            multiAgentMode: "explicitRequestOnly",
            reasoningEffort: "low",
            runtimeWorkspaceRoots: message.params.runtimeWorkspaceRoots,
            sandbox:
              scenario === "sandbox-mismatch"
                ? { networkAccess: false, type: "readOnly" }
                : {
                    excludeSlashTmp: true,
                    excludeTmpdirEnvVar: true,
                    networkAccess: false,
                    type: "workspaceWrite",
                    writableRoots: [message.params.cwd],
                  },
            selectedCapabilityRoots: message.params.selectedCapabilityRoots,
            thread: {
              cwd: message.params.cwd,
              ephemeral: message.params.ephemeral,
              id: state.threadId,
              modelProvider: message.params.modelProvider,
              status: { type: "idle" },
              turns: [],
            },
            tools: [],
            webSearch: false,
          },
        });
      } else if (message.method === "turn/start") {
        state.turnCount += 1;
        const turnId = `turn-${state.turnCount}`;
        writeMessage({
          id: message.id,
          result: {
            turn: {
              completedAt: null,
              durationMs: null,
              error: null,
              id: turnId,
              items: [],
              itemsView: "full",
              startedAt: 1,
              status: "inProgress",
            },
          },
        });

        const finishTurn = () => {
          const finalItem = {
            id: `${turnId}-final`,
            memoryCitation: null,
            phase: scenario === "missing-final" ? "commentary" : "final_answer",
            text: `authoritative final answer ${state.turnCount}`,
            type: "agentMessage",
          };
          const commentaryItem = {
            id: `${turnId}-commentary`,
            memoryCitation: null,
            phase: "commentary",
            text: "later non-final commentary",
            type: "agentMessage",
          };
          writeMessage({
            method: "item/completed",
            params: { item: finalItem, threadId: state.threadId, turnId },
          });
          writeMessage({
            method: "item/completed",
            params: { item: commentaryItem, threadId: state.threadId, turnId },
          });
          writeMessage({
            method: "thread/tokenUsage/updated",
            params: {
              threadId: state.threadId,
              tokenUsage: {
                last: {
                  cacheWriteInputTokens: 0,
                  cachedInputTokens: 2,
                  inputTokens: 12,
                  outputTokens: 5,
                  reasoningOutputTokens: 1,
                  totalTokens: 17,
                },
                modelContextWindow: 128000,
                total: {
                  cacheWriteInputTokens: 0,
                  cachedInputTokens: 2,
                  inputTokens: 12 * state.turnCount,
                  outputTokens: 5 * state.turnCount,
                  reasoningOutputTokens: state.turnCount,
                  totalTokens: 17 * state.turnCount,
                },
              },
              turnId,
            },
          });
          writeMessage({
            method: "turn/completed",
            params: {
              threadId: state.threadId,
              turn: {
                completedAt: 2,
                durationMs: 25,
                error: null,
                id: turnId,
                items: [finalItem, commentaryItem],
                itemsView: "full",
                startedAt: 1,
                status: "completed",
              },
            },
          });
        };

        if (
          scenario === "turn-timeout" ||
          scenario === "cleanup-response-timeout"
        ) {
          return;
        }
        if (scenario === "external-item-turn") {
          writeMessage({
            method: "item/completed",
            params: {
              item: {
                id: `${turnId}-external`,
                query: "unrequested search",
                type: "webSearch",
              },
              threadId: state.threadId,
              turnId,
            },
          });
          finishTurn();
          return;
        }
        if (scenario === "external-capability-turn") {
          writeMessage({
            method: "mcpServer/status/changed",
            params: { name: "unexpected-turn-capability", status: "starting" },
          });
          return;
        }
        if (scenario === "turn-provider-failure") {
          process.stderr.write("turn provider failed deliberately\n", () => {
            process.exit(9);
          });
          return;
        }
        if (scenario === "malformed-approval") {
          writeMessage({
            id: 701,
            method: "item/commandExecution/requestApproval",
            params: { threadId: state.threadId, turnId },
          });
          return;
        }
        if (scenario === "approval-turn") {
          state.pendingServerRequests.set(700, finishTurn);
          writeMessage({
            id: 700,
            method: "item/commandExecution/requestApproval",
            params: {
              additionalPermissions: null,
              approvalId: null,
              availableDecisions: ["accept", "decline", "cancel"],
              command: "git status --short",
              commandActions: [
                { command: "git status --short", type: "unknown" },
              ],
              cwd: message.params.cwd,
              environmentId: null,
              itemId: "fixture-command",
              networkApprovalContext: null,
              proposedExecpolicyAmendment: null,
              proposedNetworkPolicyAmendments: null,
              reason: "fixture status",
              startedAtMs: 1,
              threadId: state.threadId,
              turnId,
            },
          });
          return;
        }
        if (scenario === "permissions-turn") {
          state.pendingServerRequests.set(702, finishTurn);
          writeMessage({
            id: 702,
            method: "item/permissions/requestApproval",
            params: {
              cwd: message.params.cwd,
              environmentId: null,
              itemId: "fixture-permission",
              permissions: {
                fileSystem: {
                  entries: [
                    {
                      access: "write",
                      path: {
                        path: join(message.params.cwd, "result.txt"),
                        type: "path",
                      },
                    },
                  ],
                },
                network: { enabled: false },
              },
              reason: "fixture output",
              startedAtMs: 2,
              threadId: state.threadId,
              turnId,
            },
          });
          return;
        }
        finishTurn();
      } else if (message.method === "turn/interrupt") {
        if (scenario === "cleanup-response-timeout") {
          if (!state.cleanupExitScheduled) {
            state.cleanupExitScheduled = true;
            setTimeout(() => process.exit(0), 750);
          }
          return;
        }
        writeMessage({ id: message.id, result: {} });
      } else if (message.method === "thread/delete") {
        if (scenario === "cleanup-response-timeout") {
          return;
        }
        if (scenario === "delete-failure") {
          writeMessage({
            error: {
              code: -32603,
              message: "deliberate thread delete failure",
            },
            id: message.id,
          });
        } else if (scenario === "already-ephemeral") {
          writeMessage({
            error: {
              code: -32603,
              message: "thread is not persisted and cannot be deleted",
            },
            id: message.id,
          });
        } else {
          writeMessage({ id: message.id, result: {} });
        }
      } else {
        writeMessage({
          error: {
            code: -32601,
            message: `unsupported method ${message.method}`,
          },
          id: message.id,
        });
      }
    },
  };
}

async function runProtocol({ scenario, scenarioHandlers }) {
  const protocol = createProtocolContext({ scenario, scenarioHandlers });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of input) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stderr.write("fake received malformed JSON\n");
      process.exitCode = 2;
      input.close();
      break;
    }
    await protocol.handle(message);
  }
}

export async function runFakeCodexAppServer({
  defaultVersion = "codex-cli 9.9.9-test",
  legacyAppServerWithoutSubcommand = false,
  legacyScenario = null,
  schemaBundle = DEFAULT_SCHEMA_BUNDLE,
  scenarioHandlers = Object.freeze({}),
} = {}) {
  const suppliedArguments = process.argv.slice(2);
  let effectiveArguments =
    !suppliedArguments.includes("--scenario") &&
    typeof legacyScenario === "string" &&
    legacyScenario.length > 0
      ? ["--scenario", legacyScenario, ...suppliedArguments]
      : suppliedArguments;
  if (
    legacyAppServerWithoutSubcommand === true &&
    suppliedArguments.length === 0 &&
    effectiveArguments.length === 2
  ) {
    effectiveArguments = [...effectiveArguments, "app-server"];
  }
  const { operationalArguments, scenario } = parseArguments(effectiveArguments);

  if (
    operationalArguments.length === 1 &&
    operationalArguments[0] === "--version"
  ) {
    process.stdout.write(`${defaultVersion}\n`);
    return;
  }

  if (
    await generateSchemaBundle({
      operationalArguments,
      schemaBundle,
      scenario,
    })
  ) {
    return;
  }

  if (
    operationalArguments.length === APP_SERVER_ARGUMENTS.length &&
    APP_SERVER_ARGUMENTS.every(
      (argument, index) => operationalArguments[index] === argument,
    )
  ) {
    await runProtocol({ scenario, scenarioHandlers });
    return;
  }

  throw new Error(
    `unsupported fake App Server arguments: ${JSON.stringify(operationalArguments)}`,
  );
}
