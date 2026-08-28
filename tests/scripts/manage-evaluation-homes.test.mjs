import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import { runEvaluationHomesCli } from "../../scripts/evaluation/manage-evaluation-homes.js";

function createSink() {
  const chunks = [];

  return {
    stream: {
      write(chunk) {
        chunks.push(String(chunk));
        return true;
      },
    },
    text() {
      return chunks.join("");
    },
  };
}

async function createTestDirectory(t) {
  const owner = await mkdtemp(join(tmpdir(), "evaluation-homes-cli-test-"));
  t.after(() => rm(owner, { force: true, recursive: true }));
  return owner;
}

function inventoryFor(root, initialized) {
  return {
    schemaVersion: 1,
    manager: "fake-evaluation-homes-manager",
    root: { path: root, exists: initialized },
    roles: [
      { role: "execution", path: join(root, "execution"), valid: initialized },
      { role: "preflight", path: join(root, "preflight"), valid: initialized },
    ],
    liveLeases: [],
    quarantines: [],
    completedHistory: [],
    valid: initialized,
  };
}

function createManagerPort() {
  const state = {
    initializedRoots: new Set(),
    calls: [],
    release: null,
    released: false,
    registeredChildren: [],
  };

  const manager = {
    async inspectEvaluationHomes({ root }) {
      state.calls.push({ method: "inspect", root });
      return inventoryFor(root, state.initializedRoots.has(root));
    },
    async initializeEvaluationHomes({ root }) {
      state.calls.push({ method: "initialize", root });
      await mkdir(join(root, "preflight"), { recursive: true });
      await mkdir(join(root, "execution"), { recursive: true });
      state.initializedRoots.add(root);
      return inventoryFor(root, true);
    },
    async withEvaluationHome({ root, role, operationId }, operation) {
      state.calls.push({ method: "with-home", root, role, operationId });
      assert.match(operationId, /^[0-9a-f]{32}$/u);
      const path = join(root, role);
      await mkdir(path, { recursive: true });
      const context = Object.freeze({
        role,
        path,
        environment: Object.freeze({ CODEX_HOME: path }),
        registerChild(child) {
          state.registeredChildren.push(child);
        },
      });
      const result = await operation(context);
      state.release = result.release;
      if (result.release.status !== "safe") {
        throw new Error(`preserved unsafe lease: ${result.release.reasonCode}`);
      }
      state.released = true;
      return result.value;
    },
  };

  return { manager, state };
}

async function invoke(argv, options = {}) {
  const stdout = createSink();
  const stderr = createSink();
  const port = options.port ?? createManagerPort();
  const exitCode = await runEvaluationHomesCli({
    argv,
    environment: options.environment ?? {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    manager: port.manager,
    spawnProcess: options.spawnProcess,
  });

  return {
    exitCode,
    stdout: stdout.text(),
    stderr: stderr.text(),
    ...port,
  };
}

test("inspect delegates read-only work and emits only the versioned inventory", async (t) => {
  const owner = await createTestDirectory(t);
  const root = resolve(owner, "EvaluationHomes", "v1");
  const port = createManagerPort();
  port.state.initializedRoots.add(root);

  const result = await invoke(["inspect", "--root", root], { port });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), inventoryFor(root, true));
  assert.deepEqual(result.state.calls, [{ method: "inspect", root }]);
});

test("initialize requires an identical explicit confirmation before mutation", async (t) => {
  const owner = await createTestDirectory(t);
  const root = resolve(owner, "EvaluationHomes", "v1");

  for (const argv of [
    ["initialize", "--root", root],
    ["initialize", "--root", root, "--confirm-root", dirnameLike(root)],
  ]) {
    const port = createManagerPort();
    const result = await invoke(argv, { port });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /confirm-root/u);
    assert.deepEqual(result.state.calls, []);
  }

  const port = createManagerPort();
  const accepted = await invoke(
    ["initialize", "--root", root, "--confirm-root", root],
    { port },
  );
  assert.equal(accepted.exitCode, 0);
  assert.equal(accepted.stderr, "");
  assert.equal(JSON.parse(accepted.stdout).valid, true);
  assert.deepEqual(accepted.state.calls, [{ method: "initialize", root }]);
});

test("login rejects every missing guard before process launch", async (t) => {
  const owner = await createTestDirectory(t);
  const root = resolve(owner, "EvaluationHomes", "v1");
  const base = [
    "login",
    "--root",
    root,
    "--confirm-root",
    root,
    "--role",
    "execution",
    "--codex-command",
    process.execPath,
    "--allow-interactive-login",
  ];
  const fixtures = [
    base.filter((value) => value !== "--allow-interactive-login"),
    base.map((value) => (value === "execution" ? "grading" : value)),
    base.map((value, index) =>
      index === base.indexOf("--confirm-root") + 1 ? dirnameLike(root) : value,
    ),
    base.filter(
      (_, index) =>
        index !== base.indexOf("--codex-command") &&
        index !== base.indexOf("--codex-command") + 1,
    ),
  ];

  for (const argv of fixtures) {
    let spawned = false;
    const port = createManagerPort();
    const result = await invoke(argv, {
      port,
      spawnProcess() {
        spawned = true;
        throw new Error("must not launch");
      },
    });
    assert.equal(result.exitCode, 2);
    assert.equal(spawned, false);
    assert.deepEqual(result.state.calls, []);
  }
});

test("valid login uses file storage and verifies the rotated credential cache", async (t) => {
  const owner = await createTestDirectory(t);
  const root = resolve(owner, "EvaluationHomes", "v1");
  const fakeExecutable = join(owner, "fake-codex.mjs");
  const invocationLog = join(owner, "invocation.json");
  await writeFile(
    fakeExecutable,
    [
      'import { appendFile, access, writeFile } from "node:fs/promises";',
      "const argv = process.argv.slice(2);",
      "await appendFile(",
      "  process.env.FAKE_LOGIN_LOG,",
      "  `${JSON.stringify({ argv, codexHome: process.env.CODEX_HOME })}\\n`,",
      '  "utf8",',
      ");",
      'if (argv.at(-1) === "login") {',
      '  await writeFile(`${process.env.CODEX_HOME}/auth.json`, "credential", "utf8");',
      "} else {",
      "  await access(`${process.env.CODEX_HOME}/auth.json`);",
      "}",
    ].join("\n"),
    "utf8",
  );
  const port = createManagerPort();
  port.state.initializedRoots.add(root);

  const result = await invoke(
    [
      "login",
      "--root",
      root,
      "--confirm-root",
      root,
      "--role",
      "execution",
      "--codex-command",
      process.execPath,
      "--codex-prefix-arg",
      fakeExecutable,
      "--allow-interactive-login",
    ],
    {
      port,
      environment: {
        ...process.env,
        FAKE_LOGIN_LOG: invocationLog,
      },
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    command: "login",
    role: "execution",
    status: "completed",
    login: { exitCode: 0, exitSignal: null },
    verification: { exitCode: 0, exitSignal: null },
  });
  const invocations = (await readFile(invocationLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(invocations, [
    {
      argv: ["-c", 'cli_auth_credentials_store="file"', "login"],
      codexHome: join(root, "execution"),
    },
    {
      argv: ["-c", 'cli_auth_credentials_store="file"', "login", "status"],
      codexHome: join(root, "execution"),
    },
  ]);
  assert.equal(result.state.registeredChildren.length, 2);
  assert.deepEqual(result.state.release, {
    status: "safe",
    exitStatus: "observed",
    exitCode: 0,
    exitSignal: null,
    stdioStatus: "closed",
    protocolStatus: "not-applicable",
    terminationActions: [],
    descendantStatus: "none-observed",
  });
  assert.equal(result.state.released, true);
  assert.equal(
    invocations.some(({ argv }) =>
      argv.some((argument) =>
        /model|packet|authorization|push|config\.toml/iu.test(argument),
      ),
    ),
    false,
  );
});

test("login fails closed when the persisted credential cannot be verified", async (t) => {
  const owner = await createTestDirectory(t);
  const root = resolve(owner, "EvaluationHomes", "v1");
  const fakeExecutable = join(owner, "fake-codex.mjs");
  await writeFile(
    fakeExecutable,
    [
      'if (process.argv.at(-1) === "status") {',
      "  process.exitCode = 1;",
      "}",
    ].join("\n"),
    "utf8",
  );
  const port = createManagerPort();
  port.state.initializedRoots.add(root);

  const result = await invoke(
    [
      "login",
      "--root",
      root,
      "--confirm-root",
      root,
      "--role",
      "preflight",
      "--codex-command",
      process.execPath,
      "--codex-prefix-arg",
      fakeExecutable,
      "--allow-interactive-login",
    ],
    { port, environment: process.env },
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    command: "login",
    role: "preflight",
    status: "failed",
    login: { exitCode: 0, exitSignal: null },
    verification: { exitCode: 1, exitSignal: null },
  });
});

test("ambiguous process closure produces an unsafe disposition and preserves the lease", async (t) => {
  const owner = await createTestDirectory(t);
  const root = resolve(owner, "EvaluationHomes", "v1");
  const port = createManagerPort();
  port.state.initializedRoots.add(root);
  const child = new EventEmitter();
  child.pid = 42;
  child.stdin = null;
  child.stdout = null;
  child.stderr = null;

  const startedAt = Date.now();
  const resultPromise = invoke(
    [
      "login",
      "--root",
      root,
      "--confirm-root",
      root,
      "--role",
      "preflight",
      "--codex-command",
      "fake-codex",
      "--allow-interactive-login",
    ],
    {
      port,
      spawnProcess() {
        queueMicrotask(() => child.emit("exit", 0, null));
        return child;
      },
    },
  );
  const result = await resultPromise;

  assert.equal(Date.now() - startedAt < 5000, true);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /shutdown-ambiguous/u);
  assert.deepEqual(result.state.release, {
    status: "unsafe",
    reasonCode: "shutdown-ambiguous",
    diagnostics: { exitObserved: true, closeObserved: false },
  });
  assert.equal(result.state.released, false);
});

test("unknown commands and options are closed before manager access", async (t) => {
  const owner = await createTestDirectory(t);
  const root = resolve(owner, "EvaluationHomes", "v1");

  for (const argv of [
    ["repair", "--root", root],
    ["inspect", "--root", root, "--model", "gpt-5.6-luna"],
    ["inspect", "--root", root, "--push"],
  ]) {
    const port = createManagerPort();
    const result = await invoke(argv, { port });
    assert.equal(result.exitCode, 2);
    assert.deepEqual(result.state.calls, []);
  }
});

function dirnameLike(target) {
  return resolve(target, "..");
}
