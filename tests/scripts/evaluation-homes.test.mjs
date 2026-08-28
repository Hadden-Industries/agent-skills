import { randomBytes } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";

import assert from "node:assert/strict";
import test from "node:test";

import {
  EVALUATION_HOME_ROLES,
  evaluationHomesRootFromLocalAppData,
  initializeEvaluationHomes,
  inspectEvaluationHomes,
  withEvaluationHome,
} from "../../scripts/evaluation/evaluation-homes.js";

const MANAGER_ID = "openai-codex-evaluation-homes";
const ROOT_MARKER = ".evaluation-homes-root.json";
const HOME_MARKER = ".evaluation-home-owner.json";
const OPERATION_ID = "ab".repeat(16);
const THIS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROBE_PATH = resolve(
  THIS_DIRECTORY,
  "../../scripts/evaluation/windows-path-probe.ps1",
);

function fixedClock() {
  return "2026-08-24T12:00:00.000Z";
}

function deterministicRandomBytes() {
  let next = 1;

  return (size) => {
    const bytes = Buffer.alloc(size, next);
    next += 1;
    return bytes;
  };
}

async function localPathMetadata(target) {
  const absolute = resolve(target);
  let stats;

  try {
    stats = await lstat(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        schemaVersion: 1,
        exists: false,
        fullPath: absolute,
        isContainer: false,
        attributes: [],
        drive: {
          root: parse(absolute).root,
          driveType: "Fixed",
        },
      };
    }
    throw error;
  }

  return {
    schemaVersion: 1,
    exists: true,
    fullPath: absolute,
    isContainer: stats.isDirectory(),
    attributes: stats.isSymbolicLink()
      ? ["ReparsePoint"]
      : stats.isDirectory()
        ? ["Directory"]
        : [],
    drive: {
      root: parse(absolute).root,
      driveType: "Fixed",
    },
  };
}

function createTestDependencies(overrides = {}) {
  return {
    clock: fixedClock,
    randomBytes: deterministicRandomBytes(),
    pathMetadata: localPathMetadata,
    failAfterPhase: null,
    ...overrides,
  };
}

function safeWithoutChild() {
  return {
    status: "safe",
    exitStatus: "not-started",
    exitCode: null,
    exitSignal: null,
    stdioStatus: "not-opened",
    protocolStatus: "not-opened",
    terminationActions: [],
    descendantStatus: "none-observed",
  };
}

function safeWithChild({ exitCode = 0, exitSignal = null } = {}) {
  return {
    status: "safe",
    exitStatus: "observed",
    exitCode,
    exitSignal,
    stdioStatus: "closed",
    protocolStatus: "not-applicable",
    terminationActions: [],
    descendantStatus: "none-observed",
  };
}

async function initializeFixture(t, overrides = {}) {
  const paths = await createTestRoot(t);
  const testDependencies = createTestDependencies(overrides);
  await initializeEvaluationHomes({ root: paths.root, testDependencies });

  return { ...paths, testDependencies };
}

async function readJsonLines(target) {
  const source = await readFile(target, "utf8");
  return source
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function createTestRoot(t) {
  const owner = await mkdtemp(join(tmpdir(), "evaluation-homes-test-"));
  t.after(() => rm(owner, { force: true, recursive: true }));
  const parent = join(owner, "EvaluationHomes");
  await mkdir(parent);

  return {
    owner,
    parent,
    root: join(parent, "v1"),
  };
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function runPowerShellProbeSession(targets) {
  const executable = process.env.SystemRoot
    ? join(
        process.env.SystemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      )
    : "powershell.exe";
  const arguments_ = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    PROBE_PATH,
  ];

  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `PowerShell probe exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`,
          ),
        );
        return;
      }

      const responses = Buffer.concat(stdout)
        .toString("utf8")
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      resolvePromise(responses);
    });

    for (const [index, target] of targets.entries()) {
      child.stdin.write(
        `${JSON.stringify({ schemaVersion: 1, id: index + 1, path: target })}\n`,
      );
    }
    child.stdin.end();
  });
}

test("derives the accepted versioned root without touching the filesystem", () => {
  const localAppData = "C:\\Users\\operator\\AppData\\Local\\";
  const derived = evaluationHomesRootFromLocalAppData(localAppData);

  assert.equal(
    derived,
    "C:\\Users\\operator\\AppData\\Local\\OpenAI\\Codex\\EvaluationHomes\\v1",
  );
  assert.deepEqual(EVALUATION_HOME_ROLES, ["preflight", "execution"]);
  assert.equal(Object.isFrozen(EVALUATION_HOME_ROLES), true);
  assert.throws(() => evaluationHomesRootFromLocalAppData(""), /LOCALAPPDATA/u);
  assert.throws(
    () => evaluationHomesRootFromLocalAppData("C:relative"),
    /absolute/u,
  );
});

test("initializes one exclusively marked layout and inspects it without writes", async (t) => {
  const { root } = await createTestRoot(t);
  const testDependencies = createTestDependencies();
  const initialized = await initializeEvaluationHomes({
    root,
    testDependencies,
  });

  assert.equal(initialized.valid, true);
  assert.equal(initialized.schemaVersion, 1);
  assert.deepEqual(
    initialized.roles.map(({ role }) => role),
    ["execution", "preflight"],
  );

  const rootMarker = JSON.parse(
    await readFile(join(root, ROOT_MARKER), "utf8"),
  );
  assert.deepEqual(rootMarker, {
    schemaVersion: 1,
    manager: MANAGER_ID,
    normalizedRoot: resolve(root),
    resolvedRoot: await realpath(root),
    roles: ["preflight", "execution"],
    creationId: "01".repeat(16),
    rootNonce: "02".repeat(16),
    createdAt: fixedClock(),
  });

  for (const [role, generationByte] of [
    ["preflight", "03"],
    ["execution", "04"],
  ]) {
    const marker = JSON.parse(
      await readFile(join(root, role, HOME_MARKER), "utf8"),
    );
    assert.deepEqual(marker, {
      schemaVersion: 1,
      manager: MANAGER_ID,
      rootNonce: rootMarker.rootNonce,
      role,
      stablePath: resolve(root, role),
      generationNonce: generationByte.repeat(16),
      createdAt: fixedClock(),
    });
  }

  const before = await Promise.all([
    lstat(root),
    lstat(join(root, ROOT_MARKER)),
    lstat(join(root, "preflight", HOME_MARKER)),
    lstat(join(root, "execution", HOME_MARKER)),
  ]);
  const inventory = await inspectEvaluationHomes({ root, testDependencies });
  const after = await Promise.all([
    lstat(root),
    lstat(join(root, ROOT_MARKER)),
    lstat(join(root, "preflight", HOME_MARKER)),
    lstat(join(root, "execution", HOME_MARKER)),
  ]);

  assert.equal(inventory.valid, true);
  assert.deepEqual(
    after.map(({ mtimeMs }) => mtimeMs),
    before.map(({ mtimeMs }) => mtimeMs),
  );
  assert.deepEqual(inventory.liveLeases, []);
  assert.deepEqual(inventory.quarantines, []);
  assert.deepEqual(inventory.completedHistory, []);
});

test("valid initialization is idempotent without replacing marker identity", async (t) => {
  const { root } = await createTestRoot(t);
  const firstDependencies = createTestDependencies();
  await initializeEvaluationHomes({
    root,
    testDependencies: firstDependencies,
  });
  const markerBefore = await readFile(join(root, ROOT_MARKER), "utf8");

  const second = await initializeEvaluationHomes({
    root,
    testDependencies: createTestDependencies({
      randomBytes: () => randomBytes(16),
    }),
  });

  assert.equal(second.valid, true);
  assert.equal(await readFile(join(root, ROOT_MARKER), "utf8"), markerBefore);
});

test("refuses to adopt an unmarked directory or replace a non-directory", async (t) => {
  const { parent } = await createTestRoot(t);
  const unmarked = join(parent, "unmarked");
  const file = join(parent, "file-root");
  await mkdir(unmarked);
  await writeFile(file, "owned by somebody else", "utf8");

  await assert.rejects(
    initializeEvaluationHomes({
      root: unmarked,
      testDependencies: createTestDependencies(),
    }),
    /unmarked-existing-root/u,
  );
  await assert.rejects(
    initializeEvaluationHomes({
      root: file,
      testDependencies: createTestDependencies(),
    }),
    /not-a-directory/u,
  );
  assert.equal(await readFile(file, "utf8"), "owned by somebody else");
});

test("reports marker schema, manager, root nonce, role, and stable-path mismatches", async (t) => {
  const fields = [
    [ROOT_MARKER, "schemaVersion", 999, "root-marker-schema-mismatch"],
    [ROOT_MARKER, "manager", "foreign-manager", "root-marker-manager-mismatch"],
    [
      join("preflight", HOME_MARKER),
      "rootNonce",
      "ff".repeat(16),
      "home-marker-root-nonce-mismatch",
    ],
    [
      join("preflight", HOME_MARKER),
      "role",
      "execution",
      "home-marker-role-mismatch",
    ],
    [
      join("preflight", HOME_MARKER),
      "stablePath",
      "C:\\outside",
      "home-marker-path-mismatch",
    ],
  ];

  for (const [relativeMarker, field, value, problemCode] of fields) {
    await t.test(String(field), async (t2) => {
      const { root } = await createTestRoot(t2);
      const testDependencies = createTestDependencies();
      await initializeEvaluationHomes({ root, testDependencies });
      const markerPath = join(root, relativeMarker);
      const marker = JSON.parse(await readFile(markerPath, "utf8"));
      marker[field] = value;
      await writeFile(markerPath, `${JSON.stringify(marker)}\n`, "utf8");

      const inventory = await inspectEvaluationHomes({
        root,
        testDependencies,
      });
      assert.equal(inventory.valid, false);
      assert.equal(
        inventory.problems.some(({ code }) => code === problemCode),
        true,
      );
    });
  }
});

test("rejects UNC, drive-relative, network, and cross-volume roots before mutation", async (t) => {
  const { parent, root } = await createTestRoot(t);
  const dependencies = createTestDependencies();

  await assert.rejects(
    inspectEvaluationHomes({
      root: "\\\\server\\share\\EvaluationHomes\\v1",
      testDependencies: dependencies,
    }),
    /UNC/u,
  );
  await assert.rejects(
    inspectEvaluationHomes({
      root: "C:relative",
      testDependencies: dependencies,
    }),
    /drive-relative/u,
  );
  await assert.rejects(
    initializeEvaluationHomes({
      root,
      testDependencies: createTestDependencies({
        pathMetadata: async (target) => ({
          ...(await localPathMetadata(target)),
          drive: { root: parse(resolve(target)).root, driveType: "Network" },
        }),
      }),
    }),
    /fixed drive/u,
  );
  assert.equal(await pathExists(root), false);

  const crossVolumeRoot = join(parent, "cross-volume");
  let observations = 0;
  await assert.rejects(
    initializeEvaluationHomes({
      root: crossVolumeRoot,
      testDependencies: createTestDependencies({
        pathMetadata: async (target) => {
          const metadata = await localPathMetadata(target);
          observations += 1;
          return {
            ...metadata,
            drive: {
              root: observations === 1 ? metadata.drive.root : "Z:\\",
              driveType: "Fixed",
            },
          };
        },
      }),
    }),
    /volume/u,
  );
  assert.equal(await pathExists(crossVolumeRoot), false);
});

test("rejects path traversal through a reparse point before adopting or descending", async (t) => {
  const { owner, parent } = await createTestRoot(t);
  const outside = join(owner, "outside");
  const linkedParent = join(parent, "linked");
  await mkdir(outside);

  try {
    await symlink(
      outside,
      linkedParent,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("The test account cannot create a directory link.");
      return;
    }
    throw error;
  }

  const root = join(linkedParent, "v1");
  await assert.rejects(
    initializeEvaluationHomes({
      root,
      testDependencies: createTestDependencies(),
    }),
    /reparse point/u,
  );
  assert.equal(await pathExists(join(outside, "v1")), false);
});

test("rejects a substituted owner-marker link before reading it", async (t) => {
  const { owner, root } = await createTestRoot(t);
  const testDependencies = createTestDependencies();
  await initializeEvaluationHomes({ root, testDependencies });
  const markerPath = join(root, "execution", HOME_MARKER);
  const foreignMarker = join(owner, "foreign-marker.json");
  await writeFile(foreignMarker, await readFile(markerPath));
  await unlink(markerPath);

  try {
    await symlink(foreignMarker, markerPath, "file");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("The test account cannot create a file link.");
      return;
    }
    throw error;
  }

  await assert.rejects(
    inspectEvaluationHomes({ root, testDependencies }),
    /reparse point/u,
  );
});

test("rejects malformed or open test dependency bundles", async (t) => {
  const { root } = await createTestRoot(t);

  await assert.rejects(
    inspectEvaluationHomes({
      root,
      testDependencies: {
        ...createTestDependencies(),
        filesystem: {},
      },
    }),
    /testDependencies/u,
  );
  await assert.rejects(
    inspectEvaluationHomes({
      root,
      testDependencies: {
        clock: fixedClock,
        randomBytes: deterministicRandomBytes(),
        pathMetadata: localPathMetadata,
      },
    }),
    /testDependencies/u,
  );
});

test(
  "one real Windows probe session reports multiple paths without writing",
  { skip: process.platform !== "win32" },
  async (t) => {
    const { owner } = await createTestRoot(t);
    const ordinary = join(owner, "ordinary");
    const target = join(owner, "target");
    const link = join(owner, "link");
    await mkdir(ordinary);
    await mkdir(target);

    const before = await lstat(ordinary);
    try {
      await symlink(target, link, "junction");
    } catch (error) {
      if (error?.code === "EPERM") {
        t.skip("The test account cannot create a junction.");
        return;
      }
      throw error;
    }

    const responses = await runPowerShellProbeSession([ordinary, link]);
    const after = await lstat(ordinary);

    assert.equal(responses.length, 2);
    assert.deepEqual(responses[0], {
      schemaVersion: 1,
      id: 1,
      result: {
        schemaVersion: 1,
        exists: true,
        fullPath: resolve(ordinary),
        isContainer: true,
        attributes: ["Directory"],
        drive: {
          root: parse(resolve(ordinary)).root,
          driveType: "Fixed",
        },
      },
    });
    assert.equal(after.mtimeMs, before.mtimeMs);

    const linkProbe = responses[1].result;
    assert.equal(responses[1].id, 2);
    assert.equal(linkProbe.exists, true);
    assert.equal(linkProbe.attributes.includes("ReparsePoint"), true);
  },
);

test(
  "the production backend rejects unsupported platforms before mutation",
  { skip: process.platform === "win32" },
  async (t) => {
    const { root } = await createTestRoot(t);

    await assert.rejects(
      initializeEvaluationHomes({ root }),
      /unsupported-platform/u,
    );
    assert.equal(await pathExists(root), false);
  },
);

test(
  "the production Windows backend completes one streamed home lifecycle",
  { skip: process.platform !== "win32", timeout: 10_000 },
  async (t) => {
    const { root } = await createTestRoot(t);
    const initialized = await initializeEvaluationHomes({ root });

    assert.equal(initialized.valid, true);
    const result = await withEvaluationHome(
      {
        root,
        role: "preflight",
        operationId: OPERATION_ID,
      },
      async () => ({ value: "completed", release: safeWithoutChild() }),
    );

    assert.equal(result, "completed");
    const inspected = await inspectEvaluationHomes({ root });
    assert.equal(inspected.valid, true);
    assert.deepEqual(inspected.liveLeases, []);
    assert.deepEqual(inspected.quarantines, []);
    assert.equal(inspected.completedHistory.length, 1);
  },
);

test("all explicit roots must be normalized absolute paths", async (t) => {
  const { root } = await createTestRoot(t);

  assert.equal(isAbsolute(root), true);
  await assert.rejects(
    inspectEvaluationHomes({
      root: `${root}${sep}..${sep}v1`,
      testDependencies: createTestDependencies(),
    }),
    /normalized/u,
  );
  await assert.rejects(
    inspectEvaluationHomes({
      root: dirname(root),
      testDependencies: createTestDependencies({
        pathMetadata: async (target) => {
          const metadata = await localPathMetadata(target);
          return {
            ...metadata,
            fullPath:
              resolve(target) === resolve(dirname(root))
                ? resolve(root, "outside")
                : metadata.fullPath,
          };
        },
      }),
    }),
    /resolved identity/u,
  );
});

test("rotates one leased role and retires its synced evidence into immutable history", async (t) => {
  const { root, testDependencies } = await initializeFixture(t);
  const role = "execution";
  const stablePath = join(root, role);
  const originalMarker = JSON.parse(
    await readFile(join(stablePath, HOME_MARKER), "utf8"),
  );
  let callbackFinished = false;

  const result = await withEvaluationHome(
    { root, role, operationId: OPERATION_ID, testDependencies },
    async (context) => {
      assert.equal(Object.isFrozen(context), true);
      assert.equal(Object.isFrozen(context.environment), true);
      assert.deepEqual(Object.keys(context).sort(), [
        "environment",
        "path",
        "registerChild",
        "role",
      ]);
      assert.equal(context.role, role);
      assert.equal(context.path, stablePath);
      assert.deepEqual(context.environment, { CODEX_HOME: stablePath });

      const freshMarker = JSON.parse(
        await readFile(join(stablePath, HOME_MARKER), "utf8"),
      );
      assert.notEqual(
        freshMarker.generationNonce,
        originalMarker.generationNonce,
      );
      assert.equal(freshMarker.stablePath, stablePath);

      const lease = JSON.parse(
        await readFile(
          join(root, ".leases", `${role}.lock`, "lease.json"),
          "utf8",
        ),
      );
      const quarantines = await readdir(join(root, ".quarantine"));
      assert.deepEqual(quarantines, [
        `${OPERATION_ID}-${role}-${lease.leaseToken}-prior`,
      ]);
      await writeFile(
        join(stablePath, "provider-residue.txt"),
        "remove me",
        "utf8",
      );
      callbackFinished = true;

      return {
        value: { providerStatus: "completed" },
        release: safeWithoutChild(),
      };
    },
  );

  assert.equal(callbackFinished, true);
  assert.deepEqual(result, { providerStatus: "completed" });
  assert.equal(
    await pathExists(join(stablePath, "provider-residue.txt")),
    false,
  );
  assert.deepEqual(await readdir(join(root, ".quarantine")), []);
  assert.deepEqual(await readdir(join(root, ".leases")), []);

  const historyNames = await readdir(join(root, ".history"));
  assert.equal(historyNames.length, 1);
  assert.match(
    historyNames[0],
    new RegExp(`^${OPERATION_ID}-${role}-[0-9a-f]{32}\\.completed$`, "u"),
  );
  const historyPath = join(root, ".history", historyNames[0]);
  const lease = JSON.parse(
    await readFile(join(historyPath, "lease.json"), "utf8"),
  );
  const journal = await readJsonLines(join(historyPath, "journal.jsonl"));
  assert.equal(lease.schemaVersion, 1);
  assert.equal(lease.manager, MANAGER_ID);
  assert.equal(lease.operationId, OPERATION_ID);
  assert.equal(lease.role, role);
  assert.equal(lease.processId, process.pid);
  assert.equal(lease.rootNonce, originalMarker.rootNonce);
  assert.match(lease.leaseToken, /^[0-9a-f]{32}$/u);
  assert.deepEqual(
    journal.map(({ sequence }) => sequence),
    journal.map((_, index) => index + 1),
  );
  assert.deepEqual(
    journal.map(({ phase }) => phase),
    [
      "acquired",
      "before-prior-home-rename",
      "after-prior-home-rename",
      "before-fresh-home-create",
      "after-fresh-home-create",
      "before-operation",
      "after-operation",
      "before-used-home-rename",
      "after-used-home-rename",
      "before-clean-home-create",
      "after-clean-home-create",
      "before-prior-quarantine-delete",
      "after-prior-quarantine-delete",
      "before-used-quarantine-delete",
      "after-used-quarantine-delete",
      "completed",
    ],
  );
  assert.equal(
    journal.every(({ operationId }) => operationId === OPERATION_ID),
    true,
  );
  assert.equal(
    journal.every(({ role: entryRole }) => entryRole === role),
    true,
  );

  const cleanMarker = JSON.parse(
    await readFile(join(stablePath, HOME_MARKER), "utf8"),
  );
  assert.notEqual(cleanMarker.generationNonce, originalMarker.generationNonce);
  assert.equal(
    cleanMarker.generationNonce,
    journal.find(({ phase }) => phase === "after-clean-home-create")
      .generationNonce,
  );
});

test("exclusive role contention fails before stable-home rotation", async (t) => {
  const { root, testDependencies } = await initializeFixture(t);
  const stableMarkerPath = join(root, "preflight", HOME_MARKER);
  const markerBefore = await readFile(stableMarkerPath, "utf8");
  await mkdir(join(root, ".leases", "preflight.lock"));

  await assert.rejects(
    withEvaluationHome(
      {
        root,
        role: "preflight",
        operationId: OPERATION_ID,
        testDependencies,
      },
      async () => ({ value: null, release: safeWithoutChild() }),
    ),
    /lease-contended/u,
  );

  assert.equal(await readFile(stableMarkerPath, "utf8"), markerBefore);
  assert.deepEqual(await readdir(join(root, ".quarantine")), []);
});

test("rejects role and operation identity before acquiring a lease", async (t) => {
  const { root, testDependencies } = await initializeFixture(t);

  for (const [role, operationId] of [
    ["grading", OPERATION_ID],
    ["execution", "AB".repeat(16)],
    ["execution", "ab".repeat(15)],
    ["execution", `${"ab".repeat(16)}../escape`],
  ]) {
    await assert.rejects(
      withEvaluationHome(
        { root, role, operationId, testDependencies },
        async () => ({ value: null, release: safeWithoutChild() }),
      ),
      /role|operationId/u,
    );
  }

  assert.deepEqual(await readdir(join(root, ".leases")), []);
  assert.deepEqual(await readdir(join(root, ".quarantine")), []);
});

test("waits for registered process exit and stdio closure before cleanup", async (t) => {
  const { root, testDependencies } = await initializeFixture(t);
  const events = [];

  const result = await withEvaluationHome(
    {
      root,
      role: "execution",
      operationId: OPERATION_ID,
      testDependencies,
    },
    async (context) => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          "process.stderr.write('provider-failed'); process.exitCode = 7;",
        ],
        { shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
      );
      context.registerChild(child);
      child.once("exit", () => events.push("exit"));
      child.once("close", () => events.push("close"));
      await once(child, "exit");
      events.push("callback-return");

      return {
        value: { providerStatus: "failed" },
        release: safeWithChild({ exitCode: 7 }),
      };
    },
  );
  events.push("manager-return");

  assert.deepEqual(result, { providerStatus: "failed" });
  assert.equal(
    events.indexOf("exit") < events.indexOf("callback-return"),
    true,
  );
  assert.equal(
    events.indexOf("close") < events.indexOf("manager-return"),
    true,
  );
  assert.deepEqual(await readdir(join(root, ".leases")), []);
});

test("a thrown callback records failure and preserves the lease and managed generations", async (t) => {
  const { root, testDependencies } = await initializeFixture(t);

  await assert.rejects(
    withEvaluationHome(
      {
        root,
        role: "execution",
        operationId: OPERATION_ID,
        testDependencies,
      },
      async () => {
        throw new Error("provider callback failed");
      },
    ),
    /provider callback failed/u,
  );

  const leasePath = join(root, ".leases", "execution.lock");
  assert.equal(await pathExists(leasePath), true);
  assert.equal((await readdir(join(root, ".quarantine"))).length, 1);
  assert.equal(await pathExists(join(root, "execution")), true);
  const journal = await readJsonLines(join(leasePath, "journal.jsonl"));
  assert.equal(journal.at(-1).phase, "callback-failed");
  assert.deepEqual(journal.at(-1).error, {
    name: "Error",
    message: "provider callback failed",
  });
});

test("missing, malformed, unsafe, or contradictory release evidence preserves authority", async (t) => {
  const cases = [
    {
      name: "missing result",
      callback: async () => undefined,
      expected: /release disposition/u,
    },
    {
      name: "extra safe field",
      callback: async () => ({
        value: null,
        release: { ...safeWithoutChild(), guessed: true },
      }),
      expected: /release disposition/u,
    },
    {
      name: "unsafe closure",
      callback: async () => ({
        value: null,
        release: {
          status: "unsafe",
          reasonCode: "shutdown-ambiguous",
          diagnostics: { phase: "shutdown" },
        },
      }),
      expected: /shutdown-ambiguous/u,
    },
    {
      name: "invented no-child evidence",
      callback: async (context) => {
        const child = spawn(process.execPath, ["-e", ""], {
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        context.registerChild(child);
        await once(child, "close");
        return { value: null, release: safeWithoutChild() };
      },
      expected: /contradicts registered child/u,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async (t2) => {
      const { root, testDependencies } = await initializeFixture(t2);
      await assert.rejects(
        withEvaluationHome(
          {
            root,
            role: "preflight",
            operationId: OPERATION_ID,
            testDependencies,
          },
          fixture.callback,
        ),
        fixture.expected,
      );
      assert.equal(
        await pathExists(join(root, ".leases", "preflight.lock")),
        true,
      );
    });
  }
});

test("rejects sensitive unsafe diagnostics instead of persisting credentials", async (t) => {
  const { root, testDependencies } = await initializeFixture(t);

  await assert.rejects(
    withEvaluationHome(
      {
        root,
        role: "preflight",
        operationId: OPERATION_ID,
        testDependencies,
      },
      async () => ({
        value: null,
        release: {
          status: "unsafe",
          reasonCode: "shutdown-ambiguous",
          diagnostics: { authenticationToken: "do-not-persist" },
        },
      }),
    ),
    /sensitive diagnostics/u,
  );

  const journalSource = await readFile(
    join(root, ".leases", "preflight.lock", "journal.jsonl"),
    "utf8",
  );
  assert.equal(journalSource.includes("do-not-persist"), false);
});

test("marker mutation during the callback fails closed", async (t) => {
  const { root, testDependencies } = await initializeFixture(t);

  await assert.rejects(
    withEvaluationHome(
      {
        root,
        role: "execution",
        operationId: OPERATION_ID,
        testDependencies,
      },
      async (context) => {
        const markerPath = join(context.path, HOME_MARKER);
        const marker = JSON.parse(await readFile(markerPath, "utf8"));
        marker.generationNonce = "ff".repeat(16);
        await writeFile(markerPath, `${JSON.stringify(marker)}\n`, "utf8");
        return { value: null, release: safeWithoutChild() };
      },
    ),
    /identity|marker/u,
  );

  assert.equal(await pathExists(join(root, ".leases", "execution.lock")), true);
});

test("a completed-history collision preserves the live lease without overwriting history", async (t) => {
  const { root, testDependencies } = await initializeFixture(t);
  const leaseToken = "05".repeat(16);
  const destination = join(
    root,
    ".history",
    `${OPERATION_ID}-execution-${leaseToken}.completed`,
  );
  await mkdir(destination);
  await writeFile(join(destination, "foreign.txt"), "preserve", "utf8");

  await assert.rejects(
    withEvaluationHome(
      {
        root,
        role: "execution",
        operationId: OPERATION_ID,
        testDependencies,
      },
      async () => ({ value: null, release: safeWithoutChild() }),
    ),
    /history-collision/u,
  );

  assert.equal(
    await readFile(join(destination, "foreign.txt"), "utf8"),
    "preserve",
  );
  assert.equal(await pathExists(join(root, ".leases", "execution.lock")), true);
});

test("never scans or deletes an unrelated quarantine sibling", async (t) => {
  const { root, testDependencies: baseDependencies } =
    await initializeFixture(t);
  const unrelated = join(root, ".quarantine", "unrelated-owner-data");
  await mkdir(unrelated);
  await writeFile(join(unrelated, "keep.txt"), "keep", "utf8");
  const testDependencies = {
    ...baseDependencies,
    pathMetadata: async (target) => {
      if (sameFilePath(target, unrelated)) {
        throw new Error("unrelated quarantine was probed");
      }
      return localPathMetadata(target);
    },
  };

  await withEvaluationHome(
    {
      root,
      role: "execution",
      operationId: OPERATION_ID,
      testDependencies,
    },
    async () => ({ value: null, release: safeWithoutChild() }),
  );

  assert.equal(await readFile(join(unrelated, "keep.txt"), "utf8"), "keep");
  assert.deepEqual(await readdir(join(root, ".quarantine")), [
    "unrelated-owner-data",
  ]);
});

test("a reparse point inside an owned quarantine blocks all owned cleanup", async (t) => {
  const { root, owner, testDependencies } = await initializeFixture(t);
  const outside = join(owner, "outside-owned-home");
  await mkdir(outside);

  await assert.rejects(
    withEvaluationHome(
      {
        root,
        role: "execution",
        operationId: OPERATION_ID,
        testDependencies,
      },
      async (context) => {
        const link = join(context.path, "provider-link");
        try {
          await symlink(
            outside,
            link,
            process.platform === "win32" ? "junction" : "dir",
          );
        } catch (error) {
          if (error?.code === "EPERM") {
            t.skip("The test account cannot create a directory link.");
            return {
              value: null,
              release: {
                status: "unsafe",
                reasonCode: "shutdown-ambiguous",
                diagnostics: { reason: "test-skipped" },
              },
            };
          }
          throw error;
        }
        return { value: null, release: safeWithoutChild() };
      },
    ),
    /reparse point/u,
  );

  assert.equal(await pathExists(join(root, ".leases", "execution.lock")), true);
  assert.equal((await readdir(join(root, ".quarantine"))).length, 2);
  assert.equal((await readdir(outside)).length, 0);
});

test("simulated crashes at every journaled phase preserve a diagnosable lock", async (t) => {
  const phases = [
    "acquired",
    "before-prior-home-rename",
    "after-prior-home-rename",
    "before-fresh-home-create",
    "after-fresh-home-create",
    "before-operation",
    "after-operation",
    "before-used-home-rename",
    "after-used-home-rename",
    "before-clean-home-create",
    "after-clean-home-create",
    "before-prior-quarantine-delete",
    "after-prior-quarantine-delete",
    "before-used-quarantine-delete",
    "after-used-quarantine-delete",
    "completed",
  ];

  for (const phase of phases) {
    await t.test(phase, async (t2) => {
      const { root, testDependencies: baseDependencies } =
        await initializeFixture(t2);
      const testDependencies = {
        ...baseDependencies,
        failAfterPhase(observedPhase) {
          if (observedPhase === phase) {
            throw new Error(`simulated crash after ${phase}`);
          }
        },
      };

      await assert.rejects(
        withEvaluationHome(
          {
            root,
            role: "preflight",
            operationId: OPERATION_ID,
            testDependencies,
          },
          async () => ({ value: null, release: safeWithoutChild() }),
        ),
        new RegExp(`simulated crash after ${phase}`, "u"),
      );

      const leasePath = join(root, ".leases", "preflight.lock");
      assert.equal(await pathExists(leasePath), true);
      const journal = await readJsonLines(join(leasePath, "journal.jsonl"));
      assert.equal(journal.at(-1).phase, phase);
      assert.equal(
        (await readdir(root)).some((name) => name === "preflight") ||
          (await readdir(join(root, ".quarantine"))).some((name) =>
            name.includes("-preflight-"),
          ),
        true,
      );
    });
  }
});

test("replacing the active home identity during execution is detected", async (t) => {
  const { root, testDependencies } = await initializeFixture(t);
  const displaced = join(root, ".quarantine", "test-displaced-home");

  await assert.rejects(
    withEvaluationHome(
      {
        root,
        role: "execution",
        operationId: OPERATION_ID,
        testDependencies,
      },
      async (context) => {
        const marker = await readFile(join(context.path, HOME_MARKER), "utf8");
        await rename(context.path, displaced);
        await mkdir(context.path);
        await writeFile(join(context.path, HOME_MARKER), marker, "utf8");
        return { value: null, release: safeWithoutChild() };
      },
    ),
    /identity/u,
  );

  assert.equal(await pathExists(join(root, ".leases", "execution.lock")), true);
  assert.equal(await pathExists(displaced), true);
});

function sameFilePath(left, right) {
  return process.platform === "win32"
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}
