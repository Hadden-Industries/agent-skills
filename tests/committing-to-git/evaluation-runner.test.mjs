import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNNER_MODULE = new URL(
  "../../evals/committing-to-git/evaluation-runner.mjs",
  import.meta.url,
);
const OLD_SKILL_COMMIT = "76baa9b25e0afeaa2c62c4cf7042976444edc15e";
const NEW_SKILL_COMMIT = "ec064b1f8177d9542a82f478ca3b1ce5e44ee702";
const FAKE_APP_SERVER = join(
  REPO_ROOT,
  "tests",
  "committing-to-git",
  "fixtures",
  "fake-app-server.mjs",
);
const RUNNER_CLI = join(
  REPO_ROOT,
  "evals",
  "committing-to-git",
  "run-evaluation-session.mjs",
);

async function loadRunner() {
  try {
    return await import(RUNNER_MODULE);
  } catch (error) {
    assert.fail(
      `evaluation runner module is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function createTemporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), "committing-to-git-runner-"));

  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  return directory;
}

async function runFakeSession(t, options = {}) {
  const { runAppServerSession } = await loadRunner();
  const fixtureRoot = options.fixtureRoot ?? createTemporaryDirectory(t);
  const skillRoot = createTemporaryDirectory(t);
  const skillPath = join(skillRoot, "SKILL.md");

  writeFileSync(skillPath, "# Test committing-to-git skill\n", "utf8");

  const prompt = "Commit the task-authored skill inventory update.";
  const record = await runAppServerSession({
    appServer: {
      args: [FAKE_APP_SERVER],
      command: process.execPath,
      env: {
        FAKE_APP_SERVER_SCENARIO: options.scenario ?? "authorized",
      },
    },
    approvalContext: { fixtureRoot, readableRoots: [skillRoot] },
    session: {
      arm: options.arm ?? "new-skill",
      authorizationEligible: options.authorizationEligible ?? true,
      baseInstructions: "Use only the supplied fixture and treatment.",
      developerInstructions: "Return the deterministic evaluation envelope.",
      effort: "low",
      expectedScope: options.expectedScope ?? {
        kind: "paths",
        paths: ["skills-lock.json"],
      },
      fixtureRoot,
      model: "gpt-5.6-luna",
      prompt,
      provider: "openai",
      scopeClarification: options.scopeClarification,
      skill:
        options.skill === false
          ? undefined
          : { name: "committing-to-git", path: skillPath },
    },
    timeoutMs: 5_000,
  });

  return { fixtureRoot, prompt, record, skillPath };
}

test("the seeded matrix contains 306 sequential sessions in matched triplets", async () => {
  const { buildEvaluationSchedule } = await loadRunner();
  const first = buildEvaluationSchedule("step-3-seed");
  const repeated = buildEvaluationSchedule("step-3-seed");
  const different = buildEvaluationSchedule("different-seed");

  assert.equal(first.length, 306);
  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, different);
  assert.deepEqual(
    first.map(({ sequence }) => sequence),
    Array.from({ length: 306 }, (_, index) => index + 1),
  );

  for (let index = 0; index < first.length; index += 3) {
    const triplet = first.slice(index, index + 3);
    const [{ caseId, effort, model, repetition }] = triplet;

    assert.deepEqual(
      new Set(triplet.map(({ arm }) => arm)),
      new Set(["no-skill", "old-skill", "new-skill"]),
    );
    assert.ok(
      triplet.every(
        (session) =>
          session.caseId === caseId &&
          session.effort === effort &&
          session.model === model &&
          session.repetition === repetition,
      ),
    );
  }

  assert.equal(
    first.filter(({ model }) => model === "gpt-5.6-luna").length,
    255,
  );
  assert.equal(first.filter(({ model }) => model === "gpt-5.6-sol").length, 51);
});

test("fixture preparation creates a fresh repository with a recorded initial digest", async (t) => {
  const { materializeEvaluationFixture } = await loadRunner();
  const parent = createTemporaryDirectory(t);
  const firstDestination = join(parent, "fixture-one");
  const secondDestination = join(parent, "fixture-two");
  const first = materializeEvaluationFixture({
    caseId: 35,
    destination: firstDestination,
    repositoryRoot: REPO_ROOT,
  });
  const second = materializeEvaluationFixture({
    caseId: 35,
    destination: secondDestination,
    repositoryRoot: REPO_ROOT,
  });

  assert.equal(first.evaluation.id, 35);
  assert.equal(first.metadata.scenario, "known-context-skill-inventory-hint");
  assert.equal(first.repository, firstDestination);
  assert.equal(second.repository, secondDestination);
  assert.ok(existsSync(join(firstDestination, ".git")));
  assert.ok(existsSync(join(secondDestination, ".git")));
  assert.match(first.initialState.sha256, /^[0-9a-f]{64}$/u);
  assert.match(second.initialState.sha256, /^[0-9a-f]{64}$/u);
  assert.notEqual(firstDestination, secondDestination);
  assert.throws(
    () =>
      materializeEvaluationFixture({
        caseId: 35,
        destination: firstDestination,
        repositoryRoot: REPO_ROOT,
      }),
    /already exists/iu,
  );
});

test("skill extraction reads the exact old and candidate Git blobs without checkout", async (t) => {
  const { extractPinnedSkill } = await loadRunner();
  const parent = createTemporaryDirectory(t);
  const oldSnapshot = extractPinnedSkill({
    arm: "old-skill",
    destination: join(parent, "opaque-a"),
    repositoryRoot: REPO_ROOT,
  });
  const newSnapshot = extractPinnedSkill({
    arm: "new-skill",
    destination: join(parent, "opaque-b"),
    repositoryRoot: REPO_ROOT,
  });

  assert.equal(oldSnapshot.sourceCommit, OLD_SKILL_COMMIT);
  assert.equal(newSnapshot.sourceCommit, NEW_SKILL_COMMIT);
  assert.equal(
    oldSnapshot.skillEntry.blobOid,
    "74fe1000b0c8e7e253136df0d726ba2af30eec5f",
  );
  assert.equal(
    newSnapshot.skillEntry.blobOid,
    "ffe8c6ffa30f44af1bb2076fab0ca7e6e16834cd",
  );
  assert.equal(oldSnapshot.skillPath, join(parent, "opaque-a", "SKILL.md"));
  assert.equal(newSnapshot.skillPath, join(parent, "opaque-b", "SKILL.md"));
  assert.match(
    readFileSync(oldSnapshot.skillPath, "utf8"),
    /Committing to Git/u,
  );
  assert.match(
    readFileSync(newSnapshot.skillPath, "utf8"),
    /Committing to Git/u,
  );
  assert.notEqual(
    readFileSync(oldSnapshot.skillPath, "utf8"),
    readFileSync(newSnapshot.skillPath, "utf8"),
  );
  assert.ok(
    oldSnapshot.files.some(({ path }) => path.endsWith("commitWorkflow.mjs")),
  );
  assert.ok(
    newSnapshot.files.some(({ path }) => path.endsWith("commitWorkflow.mjs")),
  );
});

test("runtime overrides disable every discovered external context source", async () => {
  const {
    buildPreparedRuntimeIsolationOverrides,
    buildRuntimeIsolationOverrides,
  } = await loadRunner();
  const skillPaths = [
    "C:\\Users\\example\\.agents\\skills\\committing-to-git\\SKILL.md",
    "C:\\Users\\example\\.codex\\skills\\.system\\skill-creator\\SKILL.md",
  ];
  const overrides = buildRuntimeIsolationOverrides({
    appIds: ["github"],
    mcpServerIds: ["github", "node_repl"],
    pluginIds: ["browser@openai-bundled"],
    skillPaths,
  });

  assert.ok(overrides.includes("agents.enabled=false"));
  assert.ok(overrides.includes("apps._default.enabled=false"));
  assert.ok(overrides.includes("features.apps=false"));
  assert.ok(overrides.includes("features.enable_mcp_apps=false"));
  assert.ok(overrides.includes("features.plugins=false"));
  assert.ok(overrides.includes('web_search="disabled"'));
  assert.ok(overrides.includes("tools.web_search=false"));
  assert.ok(overrides.includes("features.skill_mcp_dependency_install=false"));
  assert.ok(overrides.includes("project_doc_max_bytes=0"));
  assert.ok(overrides.includes("project_doc_fallback_filenames=[]"));
  assert.ok(overrides.includes('sandbox_mode="workspace-write"'));
  assert.ok(overrides.includes("sandbox_workspace_write.network_access=false"));
  assert.ok(
    overrides.includes("sandbox_workspace_write.exclude_slash_tmp=true"),
  );
  assert.ok(
    overrides.includes("sandbox_workspace_write.exclude_tmpdir_env_var=true"),
  );
  if (process.platform === "win32") {
    assert.ok(overrides.includes('windows.sandbox="elevated"'));
  }
  assert.ok(!overrides.includes("mcp_servers.codex_apps.enabled=false"));
  assert.ok(!overrides.includes("mcp_servers.github.enabled=false"));
  assert.ok(!overrides.includes("mcp_servers.node_repl.enabled=false"));
  assert.ok(
    !overrides.includes('plugins."browser@openai-bundled".enabled=false'),
  );
  assert.ok(!overrides.includes('apps."github".enabled=false'));
  assert.ok(
    overrides.includes(
      `skills.config=[${skillPaths
        .sort()
        .map((path) => `{path=${JSON.stringify(path)},enabled=false}`)
        .join(",")}]`,
    ),
  );
  const runtimeHomes = {
    preflight: "C:\\isolated\\runtime-home-preflight",
    run: "C:\\isolated\\runtime-home-run",
  };
  const fixtureRoot = "C:\\isolated\\fixture";
  const preparedOverrides = buildPreparedRuntimeIsolationOverrides({
    fixtureRoot,
    runtimeIsolationCatalog: {
      appIds: ["github"],
      mcpServerIds: ["github", "node_repl"],
      pluginIds: ["browser@openai-bundled"],
      skillPaths,
    },
    runtimeIsolationDiscovery: {
      codexHome: "C:\\Users\\example\\.codex",
      repositoryRoot: "C:\\repository",
    },
    runtimeHomes,
  });

  assert.ok(
    preparedOverrides.preflight
      .at(-1)
      .includes(
        "C:\\\\isolated\\\\runtime-home-preflight\\\\skills\\\\.system\\\\skill-creator\\\\SKILL.md",
      ),
  );
  assert.ok(
    preparedOverrides.preflight.includes(
      `projects.${JSON.stringify(fixtureRoot)}.trust_level="trusted"`,
    ),
  );
  assert.ok(
    !preparedOverrides.preflight
      .at(-1)
      .includes("C:\\\\isolated\\\\runtime-home-run"),
  );
  assert.ok(
    preparedOverrides.run
      .at(-1)
      .includes(
        "C:\\\\isolated\\\\runtime-home-run\\\\skills\\\\.system\\\\skill-creator\\\\SKILL.md",
      ),
  );
  assert.throws(
    () =>
      buildRuntimeIsolationOverrides({
        appIds: [],
        mcpServerIds: [],
        pluginIds: [],
        skillPaths: ["C:\\Users\\example\\.agents\\skills\\committing-to-git"],
      }),
    /exact SKILL\.md/iu,
  );
});

test("approval policy grants only one-turn fixture-scoped access", async (t) => {
  const { decideApprovalRequest } = await loadRunner();
  const fixtureRoot = createTemporaryDirectory(t);
  const skillRoot = createTemporaryDirectory(t);
  const insidePath = join(fixtureRoot, ".git", "index.lock");
  const skillPath = join(skillRoot, "scripts", "commitWorkflow.mjs");
  const outsidePath = join(dirname(fixtureRoot), "outside", "secret.txt");
  const context = { fixtureRoot, readableRoots: [skillRoot] };
  const commandBase = {
    cwd: fixtureRoot,
    itemId: "command-1",
    startedAtMs: 1,
    threadId: "thread-1",
    turnId: "turn-1",
  };
  const permissionBase = {
    cwd: fixtureRoot,
    itemId: "permission-1",
    reason: "fixture metadata",
    startedAtMs: 2,
    threadId: "thread-1",
    turnId: "turn-1",
  };

  assert.deepEqual(
    decideApprovalRequest(
      "item/commandExecution/requestApproval",
      { ...commandBase, command: "git status --short" },
      context,
    ),
    {
      allowed: true,
      reason: "fixture-scoped command",
      response: { decision: "accept" },
    },
  );

  assert.deepEqual(
    decideApprovalRequest(
      "item/commandExecution/requestApproval",
      {
        ...commandBase,
        additionalPermissions: { network: { enabled: true } },
        networkApprovalContext: { host: "example.com", protocol: "https" },
      },
      context,
    ).response,
    { decision: "decline" },
  );
  assert.deepEqual(
    decideApprovalRequest(
      "item/commandExecution/requestApproval",
      { ...commandBase, cwd: dirname(fixtureRoot) },
      context,
    ).response,
    { decision: "decline" },
  );

  const safePermissions = {
    fileSystem: {
      entries: [
        { access: "write", path: { path: insidePath, type: "path" } },
        { access: "read", path: { path: skillPath, type: "path" } },
      ],
    },
    network: { enabled: false },
  };
  const granted = decideApprovalRequest(
    "item/permissions/requestApproval",
    { ...permissionBase, permissions: safePermissions },
    context,
  );

  assert.equal(granted.allowed, true);
  assert.deepEqual(granted.response, {
    permissions: safePermissions,
    scope: "turn",
    strictAutoReview: false,
  });

  const denied = decideApprovalRequest(
    "item/permissions/requestApproval",
    {
      ...permissionBase,
      permissions: {
        fileSystem: {
          entries: [
            { access: "write", path: { path: outsidePath, type: "path" } },
          ],
        },
      },
    },
    context,
  );

  assert.equal(denied.allowed, false);
  assert.deepEqual(denied.response, {
    permissions: {},
    scope: "turn",
    strictAutoReview: false,
  });

  const outsideRoot = createTemporaryDirectory(t);
  const junction = join(fixtureRoot, "escape-junction");
  symlinkSync(outsideRoot, junction, "junction");
  const reparseEscape = decideApprovalRequest(
    "item/permissions/requestApproval",
    {
      ...permissionBase,
      permissions: {
        fileSystem: {
          entries: [
            {
              access: "write",
              path: {
                path: join(junction, "prospective-secret.txt"),
                type: "path",
              },
            },
          ],
        },
      },
    },
    context,
  );

  assert.equal(reparseEscape.allowed, false);
});

test("app-server transport records the isolated authorized two-turn flow", async (t) => {
  const { EXACT_COMMIT_AUTHORIZATION_REPLY } = await loadRunner();
  const { fixtureRoot, prompt, record, skillPath } = await runFakeSession(t);

  assert.equal(record.status, "completed");
  assert.equal(record.turns.length, 2);
  assert.deepEqual(record.authorization, {
    reply: EXACT_COMMIT_AUTHORIZATION_REPLY,
    status: "sent",
  });
  assert.deepEqual(
    record.approvals.map(({ allowed, method, response }) => ({
      allowed,
      method,
      response,
    })),
    [
      {
        allowed: true,
        method: "item/commandExecution/requestApproval",
        response: { decision: "accept" },
      },
      {
        allowed: true,
        method: "item/permissions/requestApproval",
        response: {
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
          scope: "turn",
          strictAutoReview: false,
        },
      },
      {
        allowed: false,
        method: "item/commandExecution/requestApproval",
        response: { decision: "decline" },
      },
    ],
  );
  assert.equal(record.tokenUsage.total.inputTokens, 120);
  assert.equal(record.tokenUsage.total.outputTokens, 40);
  assert.equal(record.tokenUsage.total.totalTokens, 160);
  assert.equal(record.toolCalls.length, 2);
  assert.equal(record.failedCommands.length, 0);
  assert.equal(record.permissionRequests.length, 3);
  assert.equal(record.timing.turnDurationMs, 120);
  assert.ok(record.timing.wallDurationMs >= 0);

  const outbound = record.transcript
    .filter(({ direction }) => direction === "client->server")
    .map(({ message }) => message);
  const methods = outbound.map(({ method }) => method).filter(Boolean);

  assert.ok(methods.includes("initialize"));
  assert.ok(methods.includes("initialized"));
  assert.ok(methods.includes("skills/list"));
  assert.ok(methods.includes("thread/start"));
  assert.equal(methods.filter((method) => method === "turn/start").length, 2);
  assert.ok(methods.includes("thread/delete"));

  const threadStart = outbound.find(({ method }) => method === "thread/start");
  assert.equal(threadStart.params.approvalsReviewer, "user");
  assert.equal(threadStart.params.approvalPolicy, "on-request");
  assert.equal(threadStart.params.sandbox, "workspace-write");
  assert.equal(threadStart.params.ephemeral, true);
  assert.deepEqual(threadStart.params.runtimeWorkspaceRoots, [fixtureRoot]);
  assert.deepEqual(threadStart.params.dynamicTools, []);
  assert.deepEqual(threadStart.params.environments, []);

  const turns = outbound.filter(({ method }) => method === "turn/start");
  assert.deepEqual(turns[0].params.input, [
    { text: prompt, type: "text" },
    { name: "committing-to-git", path: skillPath, type: "skill" },
  ]);
  assert.deepEqual(turns[0].params.sandboxPolicy, {
    excludeSlashTmp: true,
    excludeTmpdirEnvVar: true,
    networkAccess: false,
    type: "workspaceWrite",
    writableRoots: [fixtureRoot],
  });
  assert.equal(turns[0].params.approvalsReviewer, "user");
  assert.equal(turns[0].params.approvalPolicy, "on-request");
  assert.deepEqual(turns[0].params.environments, []);
  assert.deepEqual(turns[0].params.runtimeWorkspaceRoots, [fixtureRoot]);
  assert.deepEqual(turns[1].params.input, [
    { text: EXACT_COMMIT_AUTHORIZATION_REPLY, type: "text" },
  ]);
});

test("the no-skill control sends the exact prompt without a skill input", async (t) => {
  const { prompt, record } = await runFakeSession(t, {
    arm: "no-skill",
    authorizationEligible: false,
    skill: false,
  });
  const initialTurn = record.transcript
    .filter(
      ({ direction, message }) =>
        direction === "client->server" && message.method === "turn/start",
    )
    .at(0);

  assert.equal(record.status, "completed");
  assert.equal(record.turns.length, 1);
  assert.deepEqual(record.authorization, {
    reason: "session is not authorization-eligible",
    status: "withheld",
  });
  assert.deepEqual(initialTurn.message.params.input, [
    { text: prompt, type: "text" },
  ]);
});

test("preflight rejects leaked skills and instruction sources before a turn", async (t) => {
  const { record } = await runFakeSession(t, { scenario: "leaked-skill" });
  const outboundMethods = record.transcript
    .filter(({ direction }) => direction === "client->server")
    .map(({ message }) => message.method)
    .filter(Boolean);

  assert.equal(record.status, "infrastructure-invalid");
  assert.match(record.error.message, /enabled skill/iu);
  assert.ok(outboundMethods.includes("skills/list"));
  assert.ok(!outboundMethods.includes("thread/start"));
  assert.ok(!outboundMethods.includes("turn/start"));
  assert.equal(record.turns.length, 0);
});

test("thread preflight deletes a thread with leaked instruction sources before a turn", async (t) => {
  const { record } = await runFakeSession(t, {
    scenario: "leaked-instructions",
  });
  const outboundMethods = record.transcript
    .filter(({ direction }) => direction === "client->server")
    .map(({ message }) => message.method)
    .filter(Boolean);

  assert.equal(record.status, "infrastructure-invalid");
  assert.match(record.error.message, /instruction source/iu);
  assert.ok(outboundMethods.includes("thread/start"));
  assert.ok(outboundMethods.includes("thread/delete"));
  assert.ok(!outboundMethods.includes("turn/start"));
  assert.equal(record.turns.length, 0);
});

test("app-server preflight starts and deletes an isolated thread without a turn", async (t) => {
  const { preflightAppServerSession } = await loadRunner();
  const fixtureRoot = createTemporaryDirectory(t);
  const record = await preflightAppServerSession({
    appServer: {
      args: [FAKE_APP_SERVER],
      command: process.execPath,
      env: { FAKE_APP_SERVER_SCENARIO: "authorized" },
    },
    fixtureRoot,
    model: "gpt-5.6-luna",
    provider: "openai",
    timeoutMs: 5_000,
  });
  const outboundMethods = record.transcript
    .filter(({ direction }) => direction === "client->server")
    .map(({ message }) => message.method)
    .filter(Boolean);

  assert.equal(record.status, "ready");
  assert.equal(record.modelTurns, 0);
  assert.ok(outboundMethods.includes("initialize"));
  assert.ok(outboundMethods.includes("skills/list"));
  assert.ok(outboundMethods.includes("thread/start"));
  assert.ok(outboundMethods.includes("thread/delete"));
  assert.ok(!outboundMethods.includes("turn/start"));
});

test("preflight accepts implicit fixture roots and records ephemeral cleanup", async (t) => {
  const { preflightAppServerSession } = await loadRunner();
  const fixtureRoot = createTemporaryDirectory(t);
  const record = await preflightAppServerSession({
    appServer: {
      args: [FAKE_APP_SERVER],
      command: process.execPath,
      env: { FAKE_APP_SERVER_SCENARIO: "implicit-cwd" },
    },
    fixtureRoot,
    model: "gpt-5.6-luna",
    provider: "openai",
    timeoutMs: 5_000,
  });

  assert.equal(record.status, "ready");
  assert.equal(record.modelTurns, 0);
  assert.deepEqual(record.threadStart.runtimeWorkspaceRoots, []);
  assert.deepEqual(record.threadStart.sandbox.writableRoots, []);
  assert.equal(record.threadCleanup.status, "already-ephemeral");
});

test("preflight accepts a read-only thread baseline before per-turn workspace policy", async (t) => {
  const { preflightAppServerSession } = await loadRunner();
  const fixtureRoot = createTemporaryDirectory(t);
  const record = await preflightAppServerSession({
    appServer: {
      args: [FAKE_APP_SERVER],
      command: process.execPath,
      env: { FAKE_APP_SERVER_SCENARIO: "read-only-baseline" },
    },
    fixtureRoot,
    model: "gpt-5.6-luna",
    provider: "openai",
    timeoutMs: 5_000,
  });

  assert.equal(record.status, "ready");
  assert.equal(record.modelTurns, 0);
  assert.equal(record.threadStart.sandbox.type, "readOnly");
  assert.equal(record.threadStart.sandbox.networkAccess, false);
});

test("preflight fails closed when an external capability starts", async (t) => {
  const { preflightAppServerSession } = await loadRunner();
  const fixtureRoot = createTemporaryDirectory(t);
  const record = await preflightAppServerSession({
    appServer: {
      args: [FAKE_APP_SERVER],
      command: process.execPath,
      env: { FAKE_APP_SERVER_SCENARIO: "external-capability" },
    },
    fixtureRoot,
    model: "gpt-5.6-luna",
    provider: "openai",
    timeoutMs: 5_000,
  });
  const outboundMethods = record.transcript
    .filter(({ direction }) => direction === "client->server")
    .map(({ message }) => message.method)
    .filter(Boolean);

  assert.equal(record.status, "infrastructure-invalid");
  assert.match(record.error.message, /external capability/iu);
  assert.ok(!outboundMethods.includes("turn/start"));
  assert.equal(record.modelTurns, 0);
});

test("session fails closed before a turn when an external capability starts", async (t) => {
  const { record } = await runFakeSession(t, {
    scenario: "external-capability",
  });
  const outboundMethods = record.transcript
    .filter(({ direction }) => direction === "client->server")
    .map(({ message }) => message.method)
    .filter(Boolean);

  assert.equal(record.status, "infrastructure-invalid");
  assert.match(record.error.message, /external capability/iu);
  assert.ok(!outboundMethods.includes("turn/start"));
  assert.equal(record.turns.length, 0);
});

test("an invalid proposal is retained but never receives commit authorization", async (t) => {
  const { record } = await runFakeSession(t, { scenario: "invalid-proposal" });
  const turnStarts = record.transcript.filter(
    ({ direction, message }) =>
      direction === "client->server" && message.method === "turn/start",
  );

  assert.equal(record.status, "completed");
  assert.equal(record.turns.length, 1);
  assert.deepEqual(record.authorization, {
    reason: "proposal message must end with exactly one LF",
    status: "withheld",
  });
  assert.equal(turnStarts.length, 1);
  assert.match(
    record.turns[0].finalAgentMessage,
    /EVALUATION_COMMIT_PROPOSAL/u,
  );
});

test("the external-call gate binds approval to the exact transmission packet", async () => {
  const {
    EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
    assertExternalModelAuthorization,
    createTransmissionPacket,
  } = await loadRunner();
  const transmission = {
    content: {
      fixture: { sha256: "a".repeat(64) },
      prompt: "Commit the exact fixture change.",
      skill: { sha256: "b".repeat(64) },
    },
    effort: "low",
    model: "gpt-5.6-luna",
    provider: "openai",
    toolPolicy: { networkAccess: false, workspaceWrite: true },
  };
  const packet = createTransmissionPacket(transmission);
  const repeated = createTransmissionPacket({
    toolPolicy: transmission.toolPolicy,
    provider: transmission.provider,
    model: transmission.model,
    effort: transmission.effort,
    content: transmission.content,
  });
  const authorization = {
    decision: "authorized",
    schemaVersion: 1,
    statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
    transmissionSha256: packet.transmissionSha256,
  };

  assert.match(packet.transmissionSha256, /^[0-9a-f]{64}$/u);
  assert.equal(packet.transmissionSha256, repeated.transmissionSha256);
  assert.throws(
    () =>
      assertExternalModelAuthorization({
        allowExternalModelCall: false,
        authorization,
        packet,
      }),
    /explicit --allow-external-model-call/iu,
  );
  assert.throws(
    () =>
      assertExternalModelAuthorization({
        allowExternalModelCall: true,
        authorization: {
          ...authorization,
          transmissionSha256: "0".repeat(64),
        },
        packet,
      }),
    /does not match/iu,
  );
  assert.throws(
    () =>
      assertExternalModelAuthorization({
        allowExternalModelCall: true,
        authorization,
        packet: {
          ...packet,
          transmission: {
            ...packet.transmission,
            model: "gpt-5.6-sol",
          },
        },
      }),
    /packet digest is invalid/iu,
  );
  assert.equal(
    assertExternalModelAuthorization({
      allowExternalModelCall: true,
      authorization,
      packet,
    }),
    packet.transmissionSha256,
  );
});

test("run-record persistence is exclusive and retains infrastructure failures", async (t) => {
  const { writeRunRecordExclusive } = await loadRunner();
  const destination = join(createTemporaryDirectory(t), "result.json");
  const failure = {
    error: { message: "preflight found enabled skill" },
    status: "infrastructure-invalid",
    transcript: [{ direction: "server->client", sequence: 1 }],
  };

  writeRunRecordExclusive(destination, failure);

  assert.deepEqual(JSON.parse(readFileSync(destination, "utf8")), failure);
  assert.throws(
    () => writeRunRecordExclusive(destination, { status: "completed" }),
    /already exists/iu,
  );
  assert.deepEqual(JSON.parse(readFileSync(destination, "utf8")), failure);
});

test("session preparation binds a fresh fixture and pinned treatment into one packet", async (t) => {
  const { buildPreparedRuntimeIsolationOverrides, prepareEvaluationSession } =
    await loadRunner();
  const parent = createTemporaryDirectory(t);
  const destination = join(parent, "prepared-session");
  const prepared = prepareEvaluationSession({
    arm: "old-skill",
    authorizationEligible: true,
    caseId: 35,
    destination,
    effort: "low",
    model: "gpt-5.6-luna",
    provider: "openai",
    repetition: 2,
    repositoryRoot: REPO_ROOT,
    seed: "packet-seed",
    sequence: 17,
  });
  const persisted = JSON.parse(readFileSync(prepared.packetPath, "utf8"));

  assert.deepEqual(persisted, prepared.packet);
  assert.equal(prepared.fixtureRoot, join(destination, "fixture"));
  assert.equal(prepared.skillPath, join(destination, "treatment", "SKILL.md"));
  assert.deepEqual(prepared.packet.transmission.toolPolicy.runtimeHomes, {
    preflight: join(destination, "runtime-home-preflight"),
    run: join(destination, "runtime-home-run"),
  });
  assert.deepEqual(
    readdirSync(prepared.packet.transmission.toolPolicy.runtimeHomes.preflight),
    [],
  );
  assert.deepEqual(
    readdirSync(prepared.packet.transmission.toolPolicy.runtimeHomes.run),
    [],
  );
  assert.equal(
    prepared.packet.transmission.case.prompt,
    "Commit only the task's skills-lock.json update. Hint: Add new agent skills, update existing skill. Leave unrelated README.md and package-lock.json changes alone.",
  );
  assert.deepEqual(prepared.packet.transmission.expectedScope, {
    kind: "paths",
    paths: ["skills-lock.json"],
  });
  assert.equal(
    prepared.packet.transmission.treatment.sourceCommit,
    OLD_SKILL_COMMIT,
  );
  assert.equal(
    prepared.packet.transmission.treatment.files.find(
      ({ path }) => path === "SKILL.md",
    ).blobOid,
    "74fe1000b0c8e7e253136df0d726ba2af30eec5f",
  );
  assert.equal(prepared.packet.transmission.authorizationEligible, true);
  assert.equal(prepared.packet.transmission.order.seed, "packet-seed");
  assert.equal(prepared.packet.transmission.order.sequence, 17);
  assert.equal(prepared.packet.transmission.order.repetition, 2);
  assert.match(
    prepared.packet.transmission.fixture.initialState.sha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.deepEqual(prepared.packet.transmission.toolPolicy, {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    dynamicTools: [],
    environments: [],
    networkAccess: false,
    runtimeIsolationCatalog: {
      appIds: [],
      mcpServerIds: [],
      pluginIds: [],
      skillPaths: [],
    },
    runtimeIsolationDiscovery: null,
    runtimeIsolationOverrides: buildPreparedRuntimeIsolationOverrides({
      fixtureRoot: prepared.fixtureRoot,
      runtimeIsolationCatalog: {
        appIds: [],
        mcpServerIds: [],
        pluginIds: [],
        skillPaths: [],
      },
      runtimeIsolationDiscovery: null,
      runtimeHomes: {
        preflight: join(destination, "runtime-home-preflight"),
        run: join(destination, "runtime-home-run"),
      },
    }),
    runtimeHomes: {
      preflight: join(destination, "runtime-home-preflight"),
      run: join(destination, "runtime-home-run"),
    },
    runtimeWorkspaceRoots: [prepared.fixtureRoot],
    sandbox: "workspace-write",
    sequential: true,
    writableRoots: [prepared.fixtureRoot],
  });
});

test("ambiguous preparation pins the predetermined scope without answering it early", async (t) => {
  const { prepareEvaluationSession } = await loadRunner();
  const destination = join(createTemporaryDirectory(t), "ambiguous-session");
  const prepared = prepareEvaluationSession({
    arm: "no-skill",
    authorizationEligible: true,
    caseId: 42,
    destination,
    effort: "low",
    model: "gpt-5.6-luna",
    predeterminedScopeId: "importer",
    provider: "openai",
    repetition: 1,
    repositoryRoot: REPO_ROOT,
    seed: "ambiguous-seed",
    sequence: 1,
  });

  assert.equal(prepared.skillPath, null);
  assert.deepEqual(prepared.packet.transmission.expectedScope, {
    kind: "paths",
    paths: [
      "src/import/shared-1.js",
      "src/import/shared-2.js",
      "src/import/shared-3.js",
    ],
  });
  assert.deepEqual(prepared.packet.transmission.scopeClarification, {
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
    predeterminedScopeId: "importer",
  });
  assert.doesNotMatch(
    prepared.packet.transmission.case.prompt,
    /src\/import\/shared-1\.js/u,
  );
});

test("ambiguous scope selection is sent only after a valid question and unchanged state", async (t) => {
  const { materializeEvaluationFixture } = await loadRunner();
  const parent = createTemporaryDirectory(t);
  const fixtureRoot = join(parent, "ambiguous-fixture");
  const fixture = materializeEvaluationFixture({
    caseId: 42,
    destination: fixtureRoot,
    repositoryRoot: REPO_ROOT,
  });
  const scopeClarification = {
    options: fixture.metadata.expected.safety.materiallyPlausibleScopes,
    predeterminedScopeId: "importer",
  };
  const { record } = await runFakeSession(t, {
    expectedScope: {
      kind: "paths",
      paths: scopeClarification.options.importer,
    },
    fixtureRoot,
    scenario: "ambiguous",
    scopeClarification,
  });
  const turnStarts = record.transcript
    .filter(
      ({ direction, message }) =>
        direction === "client->server" && message.method === "turn/start",
    )
    .map(({ message }) => message);

  assert.equal(record.status, "completed");
  assert.equal(record.turns.length, 3);
  assert.equal(record.clarification.status, "sent");
  assert.equal(record.clarification.stateUnchanged, true);
  assert.deepEqual(record.clarification.selectedScope, {
    id: "importer",
    paths: [
      "src/import/shared-1.js",
      "src/import/shared-2.js",
      "src/import/shared-3.js",
    ],
  });
  assert.match(
    turnStarts[1].params.input[0].text,
    /^<EVALUATION_SCOPE_SELECTION>\n/iu,
  );
  assert.match(turnStarts[1].params.input[0].text, /"scopeId":"importer"/u);
  assert.equal(turnStarts[2].params.input[0].text, record.authorization.reply);
  assert.deepEqual(record.authorization.status, "sent");
  assert.equal(record.approvals.length, 3);
});

test("prepared execution gates before launch and persists final state on failure", async (t) => {
  const {
    EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
    executePreparedEvaluationSession,
    prepareEvaluationSession,
  } = await loadRunner();
  const destination = join(createTemporaryDirectory(t), "gated-session");
  const prepared = prepareEvaluationSession({
    arm: "no-skill",
    authorizationEligible: true,
    caseId: 35,
    destination,
    effort: "low",
    model: "gpt-5.6-luna",
    provider: "openai",
    repetition: 1,
    repositoryRoot: REPO_ROOT,
    seed: "gated-seed",
    sequence: 1,
  });
  const authorization = {
    decision: "authorized",
    schemaVersion: 1,
    statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
    transmissionSha256: prepared.packet.transmissionSha256,
  };
  const resultPath = join(destination, "result.json");
  let launched = false;

  await assert.rejects(
    () =>
      executePreparedEvaluationSession({
        allowExternalModelCall: false,
        appServer: { args: [], command: "must-not-launch" },
        authorization,
        packet: prepared.packet,
        resultPath,
        sessionRunner: async () => {
          launched = true;
          return { status: "completed" };
        },
      }),
    /explicit --allow-external-model-call/iu,
  );
  assert.equal(launched, false);
  assert.equal(existsSync(resultPath), false);

  const record = await executePreparedEvaluationSession({
    allowExternalModelCall: true,
    appServer: {
      args: [FAKE_APP_SERVER],
      command: process.execPath,
      env: { FAKE_APP_SERVER_SCENARIO: "leaked-skill" },
    },
    authorization,
    packet: prepared.packet,
    resultPath,
    timeoutMs: 5_000,
  });
  const persisted = JSON.parse(readFileSync(resultPath, "utf8"));

  assert.equal(record.status, "infrastructure-invalid");
  assert.equal(record.session.status, "infrastructure-invalid");
  assert.match(record.session.error.message, /enabled skill/iu);
  assert.equal(record.initialState.sha256, record.finalState.sha256);
  assert.equal(record.transmissionSha256, prepared.packet.transmissionSha256);
  assert.deepEqual(persisted, record);
  assert.ok(record.session.transcript.length > 0);
});

test("blind grading packages retain failures without treatment identities", async () => {
  const { createBlindedGradingBundle } = await loadRunner();
  const blockId = "gpt-5.6-luna/low/35/1";
  const records = [
    {
      arm: "no-skill",
      case: { caseKey: "known-context-skill-inventory-hint", id: 35 },
      effort: "low",
      model: "gpt-5.6-luna",
      order: { blockId, repetition: 1, seed: "blind-seed", sequence: 1 },
      provider: "openai",
      session: {
        status: "completed",
        transcript: [
          {
            direction: "server->client",
            message: { method: "turn/completed" },
            sequence: 1,
          },
        ],
        turns: [{ finalAgentMessage: "control behavior retained" }],
      },
      sourceCommit: null,
      status: "completed",
    },
    {
      arm: "old-skill",
      case: { caseKey: "known-context-skill-inventory-hint", id: 35 },
      effort: "low",
      model: "gpt-5.6-luna",
      order: { blockId, repetition: 1, seed: "blind-seed", sequence: 2 },
      provider: "openai",
      session: {
        status: "infrastructure-invalid",
        transcript: [
          {
            direction: "client->server",
            message: {
              method: "turn/start",
              params: {
                input: [
                  { text: "same prompt", type: "text" },
                  {
                    name: "committing-to-git",
                    path: "C:\\opaque\\old-extraction\\SKILL.md",
                    type: "skill",
                  },
                ],
              },
            },
            sequence: 1,
          },
        ],
        turns: [{ finalAgentMessage: "failure behavior retained" }],
      },
      sourceCommit: OLD_SKILL_COMMIT,
      status: "infrastructure-invalid",
    },
    {
      arm: "new-skill",
      case: { caseKey: "known-context-skill-inventory-hint", id: 35 },
      effort: "low",
      model: "gpt-5.6-luna",
      order: { blockId, repetition: 1, seed: "blind-seed", sequence: 3 },
      provider: "openai",
      session: {
        status: "completed",
        transcript: [],
        turns: [{ finalAgentMessage: "treatment behavior retained" }],
      },
      sourceCommit: NEW_SKILL_COMMIT,
      status: "completed",
    },
  ];
  const first = createBlindedGradingBundle({ records, seed: "blind-seed" });
  const repeated = createBlindedGradingBundle({
    records,
    seed: "blind-seed",
  });
  const gradingJson = JSON.stringify(first.gradingPackage);

  assert.deepEqual(first, repeated);
  assert.deepEqual(
    new Set(first.gradingPackage.sessions.map(({ armLabel }) => armLabel)),
    new Set(["A", "B", "C"]),
  );
  assert.deepEqual(
    new Set(Object.values(first.mapping.blocks[blockId])),
    new Set(["no-skill", "old-skill", "new-skill"]),
  );
  assert.equal(
    first.gradingPackage.sessions.filter(
      ({ status }) => status === "infrastructure-invalid",
    ).length,
    1,
  );
  assert.match(gradingJson, /failure behavior retained/u);
  assert.doesNotMatch(gradingJson, /old-skill|new-skill/iu);
  assert.doesNotMatch(gradingJson, new RegExp(OLD_SKILL_COMMIT, "u"));
  assert.doesNotMatch(gradingJson, new RegExp(NEW_SKILL_COMMIT, "u"));
  assert.doesNotMatch(gradingJson, /old-extraction/iu);
  assert.doesNotMatch(gradingJson, /"type":"skill"/u);
  assert.doesNotMatch(gradingJson, /"sourceCommit"/u);
  assert.doesNotMatch(gradingJson, /"arm":/u);
});

test("read-only catalog discovery produces exact app-server isolation arguments", async (t) => {
  const {
    assertRuntimeIsolationCurrent,
    buildCodexAppServerArguments,
    buildPreparedRuntimeIsolationOverrides,
    discoverRuntimeIsolationCatalog,
  } = await loadRunner();
  const root = createTemporaryDirectory(t);
  const codexHome = join(root, "codex-home");
  const repositoryRoot = join(root, "repository");
  const globalSkill = join(codexHome, "skills", "global", "SKILL.md");
  const pluginSkill = join(
    codexHome,
    "plugins",
    "cache",
    "openai-bundled",
    "browser",
    "1.0.0",
    "skills",
    "browser",
    "SKILL.md",
  );
  const repositorySkill = join(
    repositoryRoot,
    ".agents",
    "skills",
    "local",
    "SKILL.md",
  );

  for (const path of [globalSkill, pluginSkill, repositorySkill]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "# isolated\n", "utf8");
  }
  writeFileSync(
    join(codexHome, "config.toml"),
    [
      "[mcp_servers.github]",
      "enabled = true",
      "[apps.github]",
      "enabled = true",
      "",
    ].join("\n"),
    "utf8",
  );

  const catalog = discoverRuntimeIsolationCatalog({
    codexHome,
    repositoryRoot,
  });
  const runtimeHomes = {
    preflight: join(root, "runtime-home-preflight"),
    run: join(root, "runtime-home-run"),
  };

  for (const runtimeHome of Object.values(runtimeHomes)) {
    mkdirSync(runtimeHome);
  }

  const overrides = buildPreparedRuntimeIsolationOverrides({
    fixtureRoot: join(root, "fixture"),
    runtimeIsolationCatalog: catalog,
    runtimeIsolationDiscovery: { codexHome, repositoryRoot },
    runtimeHomes,
  });
  const args = buildCodexAppServerArguments(overrides.preflight);

  assert.deepEqual(
    catalog.skillPaths,
    [repositorySkill, pluginSkill, globalSkill].sort(),
  );
  assert.deepEqual(catalog.mcpServerIds, ["github"]);
  assert.deepEqual(catalog.pluginIds, ["browser@openai-bundled"]);
  assert.deepEqual(catalog.appIds, ["github"]);
  assert.equal(args[0], "app-server");
  assert.deepEqual(
    args.slice(1),
    overrides.preflight.flatMap((override) => ["-c", override]),
  );

  const toolPolicy = {
    runtimeIsolationCatalog: catalog,
    runtimeIsolationDiscovery: { codexHome, repositoryRoot },
    runtimeIsolationOverrides: overrides,
    runtimeHomes,
    runtimeWorkspaceRoots: [join(root, "fixture")],
  };
  assert.doesNotThrow(() => assertRuntimeIsolationCurrent(toolPolicy));

  writeFileSync(
    join(codexHome, "config.toml"),
    "[mcp_servers.new_source]\nenabled = true\n",
    "utf8",
  );
  assert.throws(
    () => assertRuntimeIsolationCurrent(toolPolicy),
    /runtime isolation catalog changed/iu,
  );
});

test("the CLI plan is deterministic and performs no model execution", () => {
  const result = spawnSync(
    process.execPath,
    [RUNNER_CLI, "plan", "--seed", "cli-step-3-seed"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      windowsHide: true,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.command, "plan");
  assert.equal(output.modelCalls, 0);
  assert.equal(output.sessions.length, 306);
  assert.equal(output.sessions[0].sequence, 1);
  assert.equal(output.sessions.at(-1).sequence, 306);
});

test("the CLI run gate fails before its configured executable can launch", async (t) => {
  const { EXTERNAL_MODEL_AUTHORIZATION_STATEMENT, createTransmissionPacket } =
    await loadRunner();
  const root = createTemporaryDirectory(t);
  const packetPath = join(root, "packet.json");
  const authorizationPath = join(root, "authorization.json");
  const resultPath = join(root, "result.json");
  const packet = createTransmissionPacket({
    toolPolicy: {
      runtimeIsolationOverrides: {
        preflight: ["agents.enabled=false"],
        run: ["agents.enabled=false"],
      },
    },
  });
  const authorization = {
    decision: "authorized",
    schemaVersion: 1,
    statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
    transmissionSha256: packet.transmissionSha256,
  };

  writeFileSync(packetPath, `${JSON.stringify(packet)}\n`, "utf8");
  writeFileSync(
    authorizationPath,
    `${JSON.stringify(authorization)}\n`,
    "utf8",
  );

  const result = spawnSync(
    process.execPath,
    [
      RUNNER_CLI,
      "run",
      "--packet",
      packetPath,
      "--authorization",
      authorizationPath,
      "--result",
      resultPath,
      "--codex-command",
      "must-not-launch-step-3",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      windowsHide: true,
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /explicit --allow-external-model-call/iu);
  assert.doesNotMatch(result.stderr, /could not launch/iu);
  assert.equal(existsSync(resultPath), false);
});
