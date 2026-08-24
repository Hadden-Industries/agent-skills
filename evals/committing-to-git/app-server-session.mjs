import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { isAbsolute, resolve } from "node:path";

export const EXACT_COMMIT_AUTHORIZATION_REPLY =
  "I approve the exact message and authorize creating the proposed local commit for the exact scope shown. Do not push.";

class InfrastructureError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "InfrastructureError";
  }
}

function serializeError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : "Error",
    stack: error instanceof Error ? error.stack : undefined,
  };
}

function normalizedScope(scope) {
  if (
    scope?.kind !== "paths" ||
    !Array.isArray(scope.paths) ||
    scope.paths.length === 0 ||
    scope.paths.some((path) => typeof path !== "string" || path.length === 0)
  ) {
    return null;
  }

  return {
    kind: "paths",
    paths: [...new Set(scope.paths)].sort((left, right) =>
      left.localeCompare(right, "en"),
    ),
  };
}

function scopesMatch(actual, expected) {
  const normalizedActual = normalizedScope(actual);
  const normalizedExpected = normalizedScope(expected);

  return (
    normalizedActual !== null &&
    normalizedExpected !== null &&
    JSON.stringify(normalizedActual) === JSON.stringify(normalizedExpected)
  );
}

function normalizedScopeOptions(options) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).length < 2
  ) {
    return null;
  }

  const normalized = {};

  for (const id of Object.keys(options).sort((left, right) =>
    left.localeCompare(right, "en"),
  )) {
    const scope = normalizedScope({ kind: "paths", paths: options[id] });

    if (!scope) {
      return null;
    }

    normalized[id] = scope.paths;
  }

  return normalized;
}

function parseScopeQuestion(text, expectedOptions) {
  if (typeof text !== "string") {
    return { reason: "turn produced no final agent message", valid: false };
  }

  const pattern =
    /<EVALUATION_SCOPE_QUESTION>\r?\n([\s\S]*?)\r?\n<\/EVALUATION_SCOPE_QUESTION>/gu;
  const matches = [...text.matchAll(pattern)];

  if (matches.length !== 1) {
    return {
      reason: "turn must contain exactly one evaluation scope question",
      valid: false,
    };
  }

  let question;

  try {
    question = JSON.parse(matches[0][1]);
  } catch (error) {
    return {
      reason: `scope question is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      valid: false,
    };
  }

  const actual = normalizedScopeOptions(question.options);
  const expected = normalizedScopeOptions(expectedOptions);

  if (
    actual === null ||
    expected === null ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    return {
      reason: "scope question did not identify every exact plausible scope",
      valid: false,
    };
  }

  return { valid: true };
}

function scopeSelectionReply(id, paths) {
  return `<EVALUATION_SCOPE_SELECTION>\n${JSON.stringify({
    paths,
    scopeId: id,
  })}\n</EVALUATION_SCOPE_SELECTION>`;
}

function parseCommitProposal(text, expectedScope) {
  if (typeof text !== "string") {
    return { reason: "turn produced no final agent message", valid: false };
  }

  const pattern =
    /<EVALUATION_COMMIT_PROPOSAL>\r?\n([\s\S]*?)\r?\n<\/EVALUATION_COMMIT_PROPOSAL>/gu;
  const matches = [...text.matchAll(pattern)];

  if (matches.length !== 1) {
    return {
      reason: "turn must contain exactly one evaluation commit proposal",
      valid: false,
    };
  }

  let proposal;

  try {
    proposal = JSON.parse(matches[0][1]);
  } catch (error) {
    return {
      reason: `proposal is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      valid: false,
    };
  }

  if (
    typeof proposal.message !== "string" ||
    proposal.message.length < 2 ||
    !proposal.message.endsWith("\n") ||
    proposal.message.endsWith("\n\n") ||
    proposal.message.includes("\r")
  ) {
    return {
      reason: "proposal message must end with exactly one LF",
      valid: false,
    };
  }

  if (proposal.push !== false) {
    return { reason: "proposal must explicitly prohibit push", valid: false };
  }

  if (!scopesMatch(proposal.scope, expectedScope)) {
    return {
      reason: "proposal scope does not match the predetermined exact scope",
      valid: false,
    };
  }

  return { proposal, valid: true };
}

function authenticationSummary(result) {
  if (
    !result ||
    typeof result !== "object" ||
    typeof result.requiresOpenaiAuth !== "boolean"
  ) {
    throw new InfrastructureError(
      "app-server account/read returned an invalid authentication result",
    );
  }

  let accountType = null;

  if (result.account !== null) {
    if (
      !result.account ||
      typeof result.account !== "object" ||
      typeof result.account.type !== "string" ||
      result.account.type.length === 0
    ) {
      throw new InfrastructureError(
        "app-server account/read returned an invalid account",
      );
    }

    accountType = result.account.type;
  }

  return {
    accountType,
    requiresOpenaiAuth: result.requiresOpenaiAuth,
  };
}

function assertOpenaiAuthentication(authentication, provider) {
  if (
    (provider === "openai" || authentication.requiresOpenaiAuth) &&
    authentication.accountType === null
  ) {
    throw new InfrastructureError(
      "app-server has no OpenAI authentication; log in before running the evaluation",
    );
  }
}

function transcriptServerMessage(message, requestMethod) {
  if (
    requestMethod !== "account/read" ||
    !message.result ||
    typeof message.result !== "object"
  ) {
    return message;
  }

  const accountType =
    typeof message.result.account?.type === "string"
      ? message.result.account.type
      : null;

  return {
    ...message,
    result: {
      account: accountType === null ? null : { type: accountType },
      requiresOpenaiAuth: message.result.requiresOpenaiAuth,
    },
  };
}

class JsonlRpcClient {
  constructor({ appServer, cwd, onNotification, onServerRequest, timeoutMs }) {
    this.nextId = 1;
    this.notifications = [];
    this.notificationWaiters = new Set();
    this.pendingRequests = new Map();
    this.sequence = 0;
    this.startedAtMs = Date.now();
    this.timeoutMs = timeoutMs;
    this.transcript = [];
    this.onNotification = onNotification;
    this.onServerRequest = onServerRequest;
    this.exited = null;
    this.closing = false;

    this.child = spawn(appServer.command, appServer.args ?? [], {
      cwd,
      env: { ...process.env, ...(appServer.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.exitPromise = new Promise((resolveExit) => {
      this.child.once("close", (code, signal) => {
        this.exited = { code, signal };
        resolveExit(this.exited);

        if (!this.closing) {
          this.failPending(
            new InfrastructureError(
              `app-server exited before session cleanup (code=${code}, signal=${signal})`,
            ),
          );
        }
      });
    });

    this.child.once("error", (error) => {
      this.failPending(
        new InfrastructureError(
          `could not launch app-server: ${error.message}`,
          {
            cause: error,
          },
        ),
      );
    });
    this.child.stdin.on("error", (error) => {
      this.failPending(
        new InfrastructureError(`app-server stdin failed: ${error.message}`, {
          cause: error,
        }),
      );
    });

    const output = createInterface({
      crlfDelay: Infinity,
      input: this.child.stdout,
    });
    output.on("line", (line) => this.handleLine(line));

    const errors = createInterface({
      crlfDelay: Infinity,
      input: this.child.stderr,
    });
    errors.on("line", (line) => {
      this.record({ direction: "server-stderr", text: line });
    });
  }

  record(entry) {
    this.sequence += 1;
    this.transcript.push({
      ...entry,
      atMs: Date.now() - this.startedAtMs,
      sequence: this.sequence,
    });
  }

  write(message) {
    if (this.exited || this.child.stdin.destroyed) {
      throw new InfrastructureError("cannot write to an exited app-server");
    }

    this.record({ direction: "client->server", message });
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        rejectRequest(
          new InfrastructureError(
            `timed out waiting for app-server response to ${method}`,
          ),
        );
      }, this.timeoutMs);

      this.pendingRequests.set(id, {
        method,
        reject: rejectRequest,
        resolve: resolveRequest,
        timer,
      });

      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        rejectRequest(error);
      }
    });
  }

  notify(method, params = {}) {
    this.write({ method, params });
  }

  handleLine(line) {
    if (line.length === 0) {
      return;
    }

    let message;

    try {
      message = JSON.parse(line);
    } catch (error) {
      const protocolError = new InfrastructureError(
        `app-server emitted invalid JSONL: ${line}`,
        { cause: error },
      );
      this.record({
        direction: "server->client-invalid",
        error: serializeError(protocolError),
        text: line,
      });
      this.failPending(protocolError);
      return;
    }

    const pendingRequest = Object.hasOwn(message, "id")
      ? this.pendingRequests.get(message.id)
      : undefined;

    this.record({
      direction: "server->client",
      message: transcriptServerMessage(message, pendingRequest?.method),
    });

    if (Object.hasOwn(message, "id") && typeof message.method === "string") {
      Promise.resolve(
        this.onServerRequest(message.method, message.params ?? {}),
      )
        .then((result) => this.write({ id: message.id, result }))
        .catch((error) => {
          try {
            this.write({
              error: {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              },
              id: message.id,
            });
          } catch (writeError) {
            this.failPending(writeError);
          }
        });
      return;
    }

    if (Object.hasOwn(message, "id")) {
      const pending = pendingRequest;

      if (!pending) {
        return;
      }

      clearTimeout(pending.timer);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        pending.reject(
          new InfrastructureError(
            `app-server ${pending.method} failed: ${message.error.message ?? JSON.stringify(message.error)}`,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string") {
      this.notifications.push(message);
      this.onNotification(message);
      this.resolveNotificationWaiters();
    }
  }

  failPending(error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();

    for (const waiter of this.notificationWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.notificationWaiters.clear();
  }

  resolveNotificationWaiters() {
    for (const waiter of [...this.notificationWaiters]) {
      const match = this.notifications
        .slice(waiter.fromIndex)
        .find(waiter.predicate);

      if (match) {
        clearTimeout(waiter.timer);
        this.notificationWaiters.delete(waiter);
        waiter.resolve(match);
      }
    }
  }

  waitForNotification(predicate, fromIndex = 0) {
    const existing = this.notifications.slice(fromIndex).find(predicate);

    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolveNotification, rejectNotification) => {
      const waiter = {
        fromIndex,
        predicate,
        reject: rejectNotification,
        resolve: resolveNotification,
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        this.notificationWaiters.delete(waiter);
        rejectNotification(
          new InfrastructureError(
            "timed out waiting for app-server notification",
          ),
        );
      }, this.timeoutMs);
      this.notificationWaiters.add(waiter);
    });
  }

  async close() {
    this.closing = true;

    if (!this.exited && !this.child.stdin.destroyed) {
      this.child.stdin.end();
    }

    if (this.exited) {
      return this.exited;
    }

    let timer;
    const timeout = new Promise((_, rejectClose) => {
      timer = setTimeout(
        () => rejectClose(new InfrastructureError("app-server did not exit")),
        this.timeoutMs,
      );
    });

    try {
      return await Promise.race([this.exitPromise, timeout]);
    } catch (error) {
      this.child.kill();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function assertSessionOptions({
  appServer,
  approvalContext,
  session,
  timeoutMs,
}) {
  if (!appServer || typeof appServer.command !== "string") {
    throw new TypeError("An app-server command is required");
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("A positive app-server timeout is required");
  }

  if (!session || !isAbsolute(session.fixtureRoot)) {
    throw new TypeError("Session fixtureRoot must be absolute");
  }

  if (resolve(session.fixtureRoot) !== resolve(approvalContext.fixtureRoot)) {
    throw new Error("Session and approval fixture roots must match");
  }

  if (
    session.skill &&
    (!isAbsolute(session.skill.path) || typeof session.skill.name !== "string")
  ) {
    throw new TypeError("Treatment skill requires a name and absolute path");
  }

  if (session.arm === "no-skill" && session.skill) {
    throw new Error("The no-skill arm cannot include a skill input");
  }

  if (!normalizedScope(session.expectedScope)) {
    throw new Error("Session requires a non-empty exact path scope");
  }

  if (session.scopeClarification) {
    const options = normalizedScopeOptions(session.scopeClarification.options);
    const selected = session.scopeClarification.predeterminedScopeId;

    if (
      options === null ||
      typeof selected !== "string" ||
      !Object.hasOwn(options, selected) ||
      !scopesMatch(
        { kind: "paths", paths: options[selected] },
        session.expectedScope,
      )
    ) {
      throw new Error(
        "Session has an invalid predetermined scope clarification",
      );
    }
  }
}

function assertSkillsDisabled(result) {
  for (const entry of result?.data ?? []) {
    if ((entry.errors ?? []).length > 0) {
      throw new InfrastructureError(
        `skills/list reported errors: ${JSON.stringify(entry.errors)}`,
      );
    }

    const enabled = (entry.skills ?? []).filter(
      (skill) => skill.enabled === true,
    );

    if (enabled.length > 0) {
      throw new InfrastructureError(
        `preflight found enabled skill(s): ${enabled
          .map(({ name }) => name)
          .join(", ")}`,
      );
    }
  }
}

function assertCodexHomeIsolation(result, appServer) {
  const expected = appServer.env?.CODEX_HOME;

  if (expected === undefined) {
    return;
  }

  if (
    !isAbsolute(expected) ||
    typeof result?.codexHome !== "string" ||
    resolve(result.codexHome) !== resolve(expected)
  ) {
    throw new InfrastructureError(
      "app-server initialize did not preserve the isolated Codex home",
    );
  }
}

function hasOnlyImplicitOrFixtureRoot(paths, fixtureRoot) {
  return (
    Array.isArray(paths) &&
    paths.length <= 1 &&
    paths.every(
      (path) =>
        typeof path === "string" && resolve(path) === resolve(fixtureRoot),
    )
  );
}

function assertThreadIsolation(result, fixtureRoot) {
  if ((result.instructionSources ?? []).length > 0) {
    throw new InfrastructureError(
      `thread loaded instruction source(s): ${result.instructionSources.join(", ")}`,
    );
  }

  const sandboxType = result.sandbox?.type;
  const sandboxRootsAreIsolated =
    sandboxType === "readOnly"
      ? result.sandbox?.writableRoots === undefined ||
        (Array.isArray(result.sandbox.writableRoots) &&
          result.sandbox.writableRoots.length === 0)
      : sandboxType === "workspaceWrite" &&
        hasOnlyImplicitOrFixtureRoot(
          result.sandbox?.writableRoots,
          fixtureRoot,
        );

  if (
    result.approvalPolicy !== "on-request" ||
    result.approvalsReviewer !== "user" ||
    resolve(result.cwd) !== resolve(fixtureRoot) ||
    !sandboxRootsAreIsolated ||
    result.sandbox?.networkAccess !== false ||
    result.thread?.ephemeral !== true ||
    !hasOnlyImplicitOrFixtureRoot(result.runtimeWorkspaceRoots, fixtureRoot)
  ) {
    throw new InfrastructureError(
      "thread/start did not preserve the requested isolated runtime",
    );
  }
}

function externalCapabilityError(message) {
  if (message.method !== "mcpServer/status/changed") {
    return null;
  }

  const status = message.params?.status;
  const inactiveStatuses = new Set(["disabled", "shutdown", "stopped"]);

  if (
    typeof status === "string" &&
    inactiveStatuses.has(status.toLowerCase())
  ) {
    return null;
  }

  return new InfrastructureError(
    `external capability ${message.params?.name ?? "unknown"} entered status ${
      status ?? "unknown"
    }`,
  );
}

function isAlreadyEphemeralDeleteError(error) {
  return (
    error instanceof Error &&
    /thread is not persisted and cannot be deleted/iu.test(error.message)
  );
}

function initialInput(session) {
  const input = [{ text: session.prompt, type: "text" }];

  if (session.skill) {
    input.push({
      name: session.skill.name,
      path: session.skill.path,
      type: "skill",
    });
  }

  return input;
}

function finalAgentMessage(turn, itemEvents) {
  const items = [
    ...(turn.items ?? []),
    ...itemEvents
      .filter(({ turnId }) => turnId === turn.id)
      .map(({ item }) => item),
  ];
  const messages = items.filter(
    (item) => item?.type === "agentMessage" && item.phase === "final_answer",
  );

  return messages.at(-1)?.text ?? null;
}

function initializationParams() {
  return {
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
    },
    clientInfo: {
      name: "committing-to-git-evaluation-runner",
      title: "Committing to Git Evaluation Runner",
      version: "1.0.0",
    },
  };
}

function isolatedThreadStartParams({
  baseInstructions,
  developerInstructions,
  fixtureRoot,
  model,
  provider,
}) {
  return {
    allowProviderModelFallback: false,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    baseInstructions,
    cwd: fixtureRoot,
    developerInstructions,
    dynamicTools: [],
    environments: [],
    ephemeral: true,
    experimentalRawEvents: true,
    model,
    modelProvider: provider,
    runtimeWorkspaceRoots: [fixtureRoot],
    sandbox: "workspace-write",
    selectedCapabilityRoots: [],
  };
}

export async function runAppServerSessionWithApprovalPolicy(
  options,
  decideApprovalRequest,
  observeGitState,
) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  assertSessionOptions({ ...options, timeoutMs });

  const startedAtMs = Date.now();
  const record = {
    approvals: [],
    arm: options.session.arm,
    authentication: null,
    authorization: null,
    clarification: null,
    error: null,
    failedCommands: [],
    initialize: null,
    itemEvents: [],
    permissionRequests: [],
    status: "running",
    threadCleanup: null,
    threadId: null,
    threadStart: null,
    timing: { turnDurationMs: 0, wallDurationMs: 0 },
    tokenUsage: null,
    toolCalls: [],
    transcript: [],
    turns: [],
  };
  let protocolError = null;
  let client;

  try {
    client = new JsonlRpcClient({
      appServer: options.appServer,
      cwd: options.session.fixtureRoot,
      onNotification(message) {
        protocolError ??= externalCapabilityError(message);

        if (message.method === "thread/tokenUsage/updated") {
          record.tokenUsage = message.params.tokenUsage;
        } else if (message.method === "item/completed") {
          record.itemEvents.push(message.params);
          const item = message.params.item;

          if (item?.type === "commandExecution") {
            record.toolCalls.push(message.params);

            if (
              item.status === "failed" ||
              (typeof item.exitCode === "number" && item.exitCode !== 0)
            ) {
              record.failedCommands.push(message.params);
            }
          }
        }
      },
      onServerRequest(method, params) {
        if (
          method !== "item/commandExecution/requestApproval" &&
          method !== "item/permissions/requestApproval"
        ) {
          protocolError = new InfrastructureError(
            `unsupported server request ${method}`,
          );
          throw protocolError;
        }

        const decision = decideApprovalRequest(
          method,
          params,
          options.approvalContext,
        );
        record.approvals.push({
          allowed: decision.allowed,
          method,
          params,
          reason: decision.reason,
          response: decision.response,
        });
        record.permissionRequests.push({
          allowed: decision.allowed,
          method,
          params,
          reason: decision.reason,
          response: decision.response,
        });
        return decision.response;
      },
      timeoutMs,
    });
    record.transcript = client.transcript;

    record.initialize = await client.request(
      "initialize",
      initializationParams(),
    );
    assertCodexHomeIsolation(record.initialize, options.appServer);
    client.notify("initialized");

    const account = await client.request("account/read", {
      refreshToken: false,
    });
    record.authentication = authenticationSummary(account);
    assertOpenaiAuthentication(
      record.authentication,
      options.session.provider,
    );

    const skills = await client.request("skills/list", {
      cwds: [options.session.fixtureRoot],
      forceReload: true,
    });
    assertSkillsDisabled(skills);

    const threadStart = await client.request(
      "thread/start",
      isolatedThreadStartParams({
        baseInstructions: options.session.baseInstructions,
        developerInstructions: options.session.developerInstructions,
        fixtureRoot: options.session.fixtureRoot,
        model: options.session.model,
        provider: options.session.provider,
      }),
    );
    record.threadStart = threadStart;
    record.threadId = threadStart.thread?.id ?? null;
    assertThreadIsolation(threadStart, options.session.fixtureRoot);

    if (protocolError) {
      throw protocolError;
    }

    async function startTurn(input) {
      if (protocolError) {
        throw protocolError;
      }

      const notificationIndex = client.notifications.length;
      const started = await client.request("turn/start", {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        cwd: options.session.fixtureRoot,
        effort: options.session.effort,
        environments: [],
        input,
        model: options.session.model,
        runtimeWorkspaceRoots: [options.session.fixtureRoot],
        sandboxPolicy: {
          excludeSlashTmp: true,
          excludeTmpdirEnvVar: true,
          networkAccess: false,
          type: "workspaceWrite",
          writableRoots: [options.session.fixtureRoot],
        },
        threadId: record.threadId,
      });
      const turnId = started.turn?.id;

      if (typeof turnId !== "string") {
        throw new InfrastructureError("turn/start returned no turn id");
      }

      const notification = await client.waitForNotification(
        (message) =>
          message.method === "turn/completed" &&
          message.params?.threadId === record.threadId &&
          message.params?.turn?.id === turnId,
        notificationIndex,
      );

      if (protocolError) {
        throw protocolError;
      }

      const turn = notification.params.turn;
      const captured = {
        ...turn,
        finalAgentMessage: finalAgentMessage(turn, record.itemEvents),
      };
      record.turns.push(captured);
      record.timing.turnDurationMs += turn.durationMs ?? 0;
      return captured;
    }

    const clarificationAnchor = options.session.scopeClarification
      ? observeGitState?.(options.session.fixtureRoot)
      : null;

    if (options.session.scopeClarification && !clarificationAnchor) {
      throw new InfrastructureError(
        "scope clarification requires a Git-state observer",
      );
    }

    let proposalTurn = await startTurn(initialInput(options.session));

    if (proposalTurn.status !== "completed") {
      record.status = "failed";
      record.error = {
        message: `initial turn ended with status ${proposalTurn.status}`,
        name: "TurnFailure",
      };
    } else if (options.session.scopeClarification) {
      const clarification = options.session.scopeClarification;
      const parsed = parseScopeQuestion(
        proposalTurn.finalAgentMessage,
        clarification.options,
      );
      const currentState = observeGitState(options.session.fixtureRoot);
      const stateUnchanged = currentState.sha256 === clarificationAnchor.sha256;

      if (!parsed.valid) {
        record.clarification = {
          reason: parsed.reason,
          stateUnchanged,
          status: "withheld",
        };
        record.status = "completed";
      } else if (!stateUnchanged) {
        record.clarification = {
          reason: "fixture state changed before scope clarification",
          stateUnchanged: false,
          status: "withheld",
        };
        record.status = "completed";
      } else {
        const id = clarification.predeterminedScopeId;
        const paths = normalizedScopeOptions(clarification.options)[id];
        const reply = scopeSelectionReply(id, paths);
        record.clarification = {
          reply,
          selectedScope: { id, paths },
          stateUnchanged: true,
          status: "sent",
        };
        proposalTurn = await startTurn([{ text: reply, type: "text" }]);

        if (proposalTurn.status !== "completed") {
          record.status = "failed";
          record.error = {
            message: `post-clarification turn ended with status ${proposalTurn.status}`,
            name: "TurnFailure",
          };
        }
      }
    }

    if (record.status === "running" && !options.session.authorizationEligible) {
      record.authorization = {
        reason: "session is not authorization-eligible",
        status: "withheld",
      };
      record.status = "completed";
    } else if (record.status === "running") {
      const parsed = parseCommitProposal(
        proposalTurn.finalAgentMessage,
        options.session.expectedScope,
      );

      if (!parsed.valid) {
        record.authorization = { reason: parsed.reason, status: "withheld" };
        record.status = "completed";
      } else {
        record.authorization = {
          reply: EXACT_COMMIT_AUTHORIZATION_REPLY,
          status: "sent",
        };
        const secondTurn = await startTurn([
          { text: EXACT_COMMIT_AUTHORIZATION_REPLY, type: "text" },
        ]);

        if (secondTurn.status === "completed") {
          record.status = "completed";
        } else {
          record.status = "failed";
          record.error = {
            message: `authorized turn ended with status ${secondTurn.status}`,
            name: "TurnFailure",
          };
        }
      }
    }
  } catch (error) {
    record.status = "infrastructure-invalid";
    record.error = serializeError(error);
  } finally {
    if (client && record.threadId) {
      try {
        await client.request("thread/delete", { threadId: record.threadId });
        record.threadCleanup = { status: "deleted" };
      } catch (error) {
        if (isAlreadyEphemeralDeleteError(error)) {
          record.threadCleanup = {
            message: error.message,
            status: "already-ephemeral",
          };
        } else {
          record.threadCleanup = {
            error: serializeError(error),
            status: "failed",
          };
          record.status = "infrastructure-invalid";
          record.error ??= serializeError(error);
        }
      }
    }

    if (client) {
      try {
        await client.close();
      } catch (error) {
        record.status = "infrastructure-invalid";
        record.error ??= serializeError(error);
      }
    }

    record.timing.wallDurationMs = Date.now() - startedAtMs;
  }

  return record;
}

export async function preflightAppServerWithIsolation({
  appServer,
  baseInstructions,
  developerInstructions,
  fixtureRoot,
  model,
  provider,
  timeoutMs = 30_000,
}) {
  const record = {
    authentication: null,
    error: null,
    initialize: null,
    modelTurns: 0,
    status: "starting",
    threadCleanup: null,
    threadId: null,
    threadStart: null,
    transcript: [],
  };
  let protocolError = null;
  let client;

  try {
    if (!isAbsolute(fixtureRoot)) {
      throw new TypeError("Preflight fixtureRoot must be absolute");
    }

    client = new JsonlRpcClient({
      appServer,
      cwd: fixtureRoot,
      onNotification(message) {
        protocolError ??= externalCapabilityError(message);
      },
      onServerRequest(method) {
        throw new InfrastructureError(
          `preflight received unexpected server request ${method}`,
        );
      },
      timeoutMs,
    });
    record.transcript = client.transcript;

    record.initialize = await client.request(
      "initialize",
      initializationParams(),
    );
    assertCodexHomeIsolation(record.initialize, appServer);
    client.notify("initialized");
    const account = await client.request("account/read", {
      refreshToken: false,
    });
    record.authentication = authenticationSummary(account);
    assertOpenaiAuthentication(record.authentication, provider);
    const skills = await client.request("skills/list", {
      cwds: [fixtureRoot],
      forceReload: true,
    });
    assertSkillsDisabled(skills);
    const threadStart = await client.request(
      "thread/start",
      isolatedThreadStartParams({
        baseInstructions,
        developerInstructions,
        fixtureRoot,
        model,
        provider,
      }),
    );
    record.threadStart = threadStart;
    record.threadId = threadStart.thread?.id ?? null;
    assertThreadIsolation(threadStart, fixtureRoot);

    if (protocolError) {
      throw protocolError;
    }

    if (
      client.notifications.some(
        ({ method }) =>
          method === "turn/started" ||
          method === "turn/completed" ||
          method === "thread/tokenUsage/updated",
      )
    ) {
      throw new InfrastructureError(
        "preflight observed a model-turn or token-usage event",
      );
    }

    record.status = "ready";
  } catch (error) {
    record.status = "infrastructure-invalid";
    record.error = serializeError(error);
  } finally {
    if (client && record.threadId) {
      try {
        await client.request("thread/delete", { threadId: record.threadId });
        record.threadCleanup = { status: "deleted" };
      } catch (error) {
        if (isAlreadyEphemeralDeleteError(error)) {
          record.threadCleanup = {
            message: error.message,
            status: "already-ephemeral",
          };
        } else {
          record.threadCleanup = {
            error: serializeError(error),
            status: "failed",
          };
          record.status = "infrastructure-invalid";
          record.error ??= serializeError(error);
        }
      }
    }

    if (client) {
      try {
        await client.close();
      } catch (error) {
        record.status = "infrastructure-invalid";
        record.error ??= serializeError(error);
      }
    }
  }

  return record;
}
