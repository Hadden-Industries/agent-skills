import { join } from "node:path";

import { runFakeCodexAppServer } from "../../scripts/fixtures/codex-app-server-fake-engine.mjs";

let scenario = null;
let emit = null;
const threadId = "019a-fake-thread";
const pendingApprovals = new Map();
let fixtureRoot = null;
let turnCount = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;

function send(message) {
  emit(message);
}

function tokenUsage(turnId, inputTokens, outputTokens) {
  totalInputTokens += inputTokens;
  totalOutputTokens += outputTokens;
  const totalTokens = inputTokens + outputTokens;
  const last = {
    cacheWriteInputTokens: 0,
    cachedInputTokens: 0,
    inputTokens,
    outputTokens,
    reasoningOutputTokens: 0,
    totalTokens,
  };
  const total = {
    ...last,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };

  send({
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      tokenUsage: { last, modelContextWindow: 128000, total },
      turnId,
    },
  });
}

function completedCommand(id, command, aggregatedOutput) {
  return {
    aggregatedOutput,
    command,
    commandActions: [{ command, type: "unknown" }],
    cwd: fixtureRoot,
    durationMs: 12,
    exitCode: 0,
    id,
    pluginId: null,
    processId: null,
    scriptPath: null,
    source: "agent",
    status: "completed",
    type: "commandExecution",
  };
}

function finishTurn(turnId, text, command) {
  const agentMessage = {
    id: `${turnId}-message`,
    memoryCitation: null,
    phase: "final_answer",
    text,
    type: "agentMessage",
  };
  const commandItem = completedCommand(
    `${turnId}-command`,
    command,
    `${JSON.stringify({
      phase: turnCount === 1 ? "evidence-ready" : "reported",
      route: "concise",
      status: "ok",
      transaction: join(fixtureRoot, ".git", "fake-transaction"),
    })}\n`,
  );

  send({
    method: "item/completed",
    params: { item: commandItem, threadId, turnId },
  });
  send({
    method: "item/completed",
    params: { item: agentMessage, threadId, turnId },
  });
  tokenUsage(turnId, turnCount === 1 ? 90 : 30, turnCount === 1 ? 30 : 10);
  send({
    method: "turn/completed",
    params: {
      threadId,
      turn: {
        completedAt: 2,
        durationMs: turnCount === 1 ? 80 : 40,
        error: null,
        id: turnId,
        items: [commandItem, agentMessage],
        itemsView: "full",
        startedAt: 1,
        status: "completed",
      },
    },
  });
}

function finishInitialTurn(turnId) {
  const proposal = {
    message:
      scenario === "invalid-proposal"
        ? "chore(skills): Update inventory"
        : "chore(skills): Update inventory\n",
    push: false,
    scope:
      scenario === "ambiguous"
        ? {
            kind: "paths",
            paths: [
              "src/import/shared-1.js",
              "src/import/shared-2.js",
              "src/import/shared-3.js",
            ],
          }
        : { kind: "paths", paths: ["skills-lock.json"] },
  };
  const text = `<EVALUATION_COMMIT_PROPOSAL>\n${JSON.stringify(
    proposal,
  )}\n</EVALUATION_COMMIT_PROPOSAL>`;

  finishTurn(
    turnId,
    text,
    "node commitWorkflow.mjs workflow prepare --mode actual --scope paths --path skills-lock.json",
  );
}

function finishScopeQuestion(turnId) {
  const question = {
    options: {
      exporter: [
        "src/export/shared-1.js",
        "src/export/shared-2.js",
        "src/export/shared-3.js",
      ],
      importer: [
        "src/import/shared-1.js",
        "src/import/shared-2.js",
        "src/import/shared-3.js",
      ],
    },
  };
  const text = `<EVALUATION_SCOPE_QUESTION>\n${JSON.stringify(
    question,
  )}\n</EVALUATION_SCOPE_QUESTION>`;

  finishTurn(turnId, text, "git status --short");
}

function requestFixturePermission(turnId) {
  const id = 901;
  pendingApprovals.set(id, () => finishInitialTurn(turnId));
  send({
    id,
    method: "item/permissions/requestApproval",
    params: {
      cwd: fixtureRoot,
      environmentId: null,
      itemId: "fixture-permission",
      permissions: {
        fileSystem: {
          entries: [
            {
              access: "write",
              path: {
                path: join(fixtureRoot, ".git", "index.lock"),
                type: "path",
              },
            },
          ],
        },
        network: { enabled: false },
      },
      reason: "fixture metadata",
      startedAtMs: 2,
      threadId,
      turnId,
    },
  });
}

function requestFixtureCommand(turnId) {
  const id = 900;
  pendingApprovals.set(id, () => requestFixturePermission(turnId));
  send({
    id,
    method: "item/commandExecution/requestApproval",
    params: {
      additionalPermissions: null,
      approvalId: null,
      availableDecisions: ["accept", "decline", "cancel"],
      command: "git status --short",
      commandActions: [{ command: "git status --short", type: "unknown" }],
      cwd: fixtureRoot,
      environmentId: null,
      itemId: "fixture-command",
      networkApprovalContext: null,
      proposedExecpolicyAmendment: null,
      proposedNetworkPolicyAmendments: null,
      reason: "fixture status",
      startedAtMs: 1,
      threadId,
      turnId,
    },
  });
}

function startTurn(request) {
  turnCount += 1;
  const turnId = `turn-${turnCount}`;

  send({
    id: request.id,
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

  if (scenario === "ambiguous" && turnCount === 1) {
    finishScopeQuestion(turnId);
  } else if (scenario === "ambiguous" && turnCount === 2) {
    requestFixtureCommand(turnId);
  } else if (turnCount === 1 && scenario !== "invalid-proposal") {
    requestFixtureCommand(turnId);
  } else if (turnCount === 1) {
    finishInitialTurn(turnId);
  } else {
    finishTurn(
      turnId,
      "Created the exact local commit. No push was attempted.",
      "node commitWorkflow.mjs workflow commit --transaction opaque --message chore(skills): Update inventory",
    );
  }
}

function threadStartResult(params) {
  return {
    activePermissionProfile: null,
    approvalPolicy: params.approvalPolicy,
    approvalsReviewer: params.approvalsReviewer,
    cwd: params.cwd,
    instructionSources: ["leaked-skill", "leaked-instructions"].includes(
      scenario,
    )
      ? [join(params.cwd, "AGENTS.md")]
      : [],
    model: params.model,
    modelProvider: params.modelProvider,
    multiAgentMode: "explicitRequestOnly",
    reasoningEffort: null,
    runtimeWorkspaceRoots: scenario === "implicit-cwd" ? [params.cwd] : [],
    sandbox:
      scenario === "read-only-baseline"
        ? { networkAccess: false, type: "workspaceWrite" }
        : { networkAccess: false, type: "readOnly" },
    serviceTier: null,
    thread: {
      cliVersion: "0.149.1",
      createdAt: 1,
      cwd: params.cwd,
      ephemeral: true,
      id: threadId,
      modelProvider: params.modelProvider,
      preview: "",
      projectId: null,
      sessionId: "fake-session",
      source: "appServer",
      status: { type: "idle" },
      turns: [],
      updatedAt: 1,
    },
  };
}

async function handleGitScenario(message, context) {
  scenario ??= context.state.scenario;
  emit ??= context.send;

  if (pendingApprovals.has(message.id) && typeof message.method !== "string") {
    const continuation = pendingApprovals.get(message.id);
    pendingApprovals.delete(message.id);
    continuation(message.result);
    return true;
  }

  if (message.method === "initialize") {
    return false;
  } else if (message.method === "initialized") {
    return true;
  } else if (message.method === "account/read") {
    send({
      id: message.id,
      result: {
        account:
          scenario === "unauthenticated"
            ? null
            : {
                email: "evaluation-runner@example.invalid",
                planType: "pro",
                type: "chatgpt",
              },
        requiresOpenaiAuth: true,
      },
    });
  } else if (message.method === "skills/list") {
    send({
      id: message.id,
      result: {
        data: [
          {
            cwd: message.params.cwds[0],
            errors: [],
            skills:
              scenario === "leaked-skill"
                ? [
                    {
                      dependencies: null,
                      description: "unexpected",
                      enabled: true,
                      interface: null,
                      name: "unexpected-skill",
                      path: join(message.params.cwds[0], "SKILL.md"),
                      scope: "repo",
                      shortDescription: null,
                    },
                  ]
                : [],
          },
        ],
      },
    });
  } else if (message.method === "thread/start") {
    fixtureRoot = message.params.cwd;

    if (scenario === "external-capability") {
      send({
        method: "mcpServer/status/changed",
        params: { name: "codex_apps", status: "starting" },
      });
    }
    send({ id: message.id, result: threadStartResult(message.params) });
  } else if (message.method === "turn/start") {
    startTurn(message);
  } else if (message.method === "thread/delete") {
    if (scenario === "implicit-cwd") {
      send({
        error: {
          code: -32603,
          message: "thread is not persisted and cannot be deleted",
        },
        id: message.id,
      });
    } else {
      send({ id: message.id, result: {} });
    }
  } else {
    return false;
  }

  return true;
}

const gitScenarios = [
  "ambiguous",
  "authorized",
  "external-capability",
  "implicit-cwd",
  "invalid-proposal",
  "leaked-instructions",
  "leaked-skill",
  "read-only-baseline",
  "unauthenticated",
];
const scenarioHandlers = Object.fromEntries(
  gitScenarios.map((name) => [name, handleGitScenario]),
);

await runFakeCodexAppServer({
  legacyAppServerWithoutSubcommand: true,
  legacyScenario: process.env.FAKE_APP_SERVER_SCENARIO ?? "authorized",
  scenarioHandlers,
});
