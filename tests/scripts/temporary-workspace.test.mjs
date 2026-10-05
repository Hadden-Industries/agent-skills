import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { createTestWorkspace } from "../fixtures/temporary-workspace.mjs";
import { createConsumerWorkspace } from "../../scripts/evaluation/consumer-workspace.js";
import { compileSuite } from "../../scripts/evaluation/compile-suite.js";
import { repositoryRoot } from "../../scripts/evaluation/toolchain.js";
import {
  canonicalJsonBytes,
  createTransmissionPacket,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";
import { deriveOutcomeReference } from "../../scripts/evaluation/derive-reports.js";

test("in-process consumer allocation stays inside the owned fixture", (t) => {
  const workspace = createTestWorkspace(t, "test-consumer-containment-");
  const consumer = createConsumerWorkspace({
    repositoryRoot,
    compiled: compileSuite({ repositoryRoot, skillName: "committing-to-git" }),
    temporaryParent: workspace.root,
  });
  assert.equal(dirname(consumer.root), workspace.root);
  assert.ok(existsSync(join(consumer.skillRoot, "SKILL.md")));
  assert.ok(existsSync(join(consumer.root, "projection-receipt.json")));
});

test("omitted consumer temporary parent preserves a redirected OS temp path", (t) => {
  const workspace = createTestWorkspace(t, "test-consumer-default-parent-");
  const target = join(workspace.root, "target");
  const alias = join(workspace.root, "os-temp");
  mkdirSync(target);
  symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
  const source = `import { createConsumerWorkspace } from "./scripts/evaluation/consumer-workspace.js";
    import { compileSuite } from "./scripts/evaluation/compile-suite.js";
    import { repositoryRoot } from "./scripts/evaluation/toolchain.js";
    const consumer = createConsumerWorkspace({ repositoryRoot, compiled: compileSuite({ repositoryRoot, skillName: "committing-to-git" }) });
    process.stdout.write(JSON.stringify({ root: consumer.root }));`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...workspace.environment(),
        TEMP: alias,
        TMP: alias,
        TMPDIR: alias,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(dirname(JSON.parse(result.stdout).root), alias);
  // The asserted alias belongs to this fixture; remove only the link, never its target.
  unlinkSync(alias);
});

const nativeUnavailable =
  process.platform !== "win32" && !existsSync("/usr/bin/gio")
    ? "native recoverable disposal unavailable"
    : false;

function context(passed, testContext) {
  const hooks = [];
  const diagnostics = [];
  return {
    passed,
    name: testContext.name,
    after: (hook) => hooks.push(hook),
    diagnostic: (message) => {
      diagnostics.push(message);
      testContext.diagnostic(message);
    },
    hooks,
    diagnostics,
  };
}

test(
  "passing fake evaluation releases its newly owned workspace",
  { skip: nativeUnavailable },
  (t) => {
    const workspace = createTestWorkspace(t, "evaluation-cleanup-regression-");
    const environment = workspace.environment();
    // This is a separate runner, not a worker of the enclosing node --test run.
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [
        "--test",
        "--test-name-pattern=prepare freezes packet inputs and performs no provider model turn",
        resolve(
          import.meta.dirname,
          "../evals/defining-concepts/run-evaluation-session.test.mjs",
        ),
      ],
      { env: environment, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout.includes("prepare freezes packet inputs"), true);
    // Do not infer release from a passing child exit: inspect its actual root.
    assert.deepEqual(
      readdirSync(workspace.root).filter(
        (name) => !name.startsWith(".test-workspace-"),
      ),
      [],
    );
  },
);

test(
  "real Node after hook recycles success and preserves failure or cancellation",
  { skip: nativeUnavailable },
  (t) => {
    const workspace = createTestWorkspace(
      t,
      "test-workspace-lifecycle-parent-",
    );
    for (const mode of ["success", "failure", "cancelled"]) {
      const result = spawnSync(
        process.execPath,
        [
          resolve(
            import.meta.dirname,
            "../fixtures/temporary-workspace-scenario.mjs",
          ),
          mode,
        ],
        { env: workspace.environment(), encoding: "utf8", timeout: 15000 },
      );
      const match = result.stdout.match(/\{"root":.*\}/u);
      assert.ok(match, `${result.stdout}\n${result.stderr}`);
      const root = JSON.parse(match[0]).root;
      assert.equal(result.status, mode === "success" ? 0 : 1, result.stdout);
      assert.equal(existsSync(root), mode !== "success", result.stdout);
      if (mode !== "success") {
        const retention = JSON.parse(
          readFileSync(join(root, ".test-workspace-retention.json")),
        );
        assert.equal(retention.reason, "test failed or was cancelled");
        assert.equal(
          readFileSync(join(root, "payload.txt"), "utf8"),
          "recoverable fixture",
        );
      }
    }
  },
);

for (const state of [
  "failure",
  "cancelled",
  "child",
  "lease",
  "unfinished",
  "unsafe",
  "unknown",
  "invalid-terminal",
  "unfinished-trial",
  "unknown-trial",
  "unavailable",
  "explicit",
]) {
  test(`retains ${state} without irreversible disposal`, (actualT) => {
    const t = context(
      state === "failure" ? false : state === "cancelled" ? undefined : true,
      actualT,
    );
    let calls = 0;
    const workspace = createTestWorkspace(t, "test-workspace-retention-", {
      recycle: () => {
        calls++;
        return { status: "unavailable" };
      },
    });
    if (state === "child") workspace.trackChild(new EventEmitter());
    if (state === "lease") {
      mkdirSync(join(workspace.root, ".leases"));
      writeFileSync(join(workspace.root, ".leases/lease.json"), "{}");
    }
    if (["unfinished", "unsafe", "unknown", "invalid-terminal"].includes(state))
      writeFileSync(join(workspace.root, "attempt.json"), "{}");
    if (["unsafe", "unknown", "invalid-terminal"].includes(state))
      writeFileSync(
        join(workspace.root, "run.json"),
        JSON.stringify({
          closure:
            state === "unsafe"
              ? { status: "unsafe" }
              : state === "invalid-terminal"
                ? { status: "safe" }
                : null,
        }),
      );
    if (["unfinished-trial", "unknown-trial"].includes(state))
      writeFileSync(
        join(workspace.root, "authorization-consumption.json"),
        "{}",
      );
    if (state === "unknown-trial")
      writeFileSync(
        join(workspace.root, "result.json"),
        JSON.stringify({
          artifactType: "evaluation-trial-result",
          closure: null,
        }),
      );
    if (state === "explicit") workspace.retain("consumer still needs fixture");
    assert.equal(t.hooks.length, 1);
    t.hooks[0]();
    assert.equal(workspace.disposition.status, "retained");
    assert.equal(calls, state === "unavailable" ? 1 : 0);
    assert.ok(t.diagnostics[0].includes(workspace.root));
    assert.ok(
      existsSync(join(workspace.root, ".test-workspace-retention.json")),
    );
  });
}

test("changed ownership refuses disposal and does not write into an unowned root", (actualT) => {
  const t = context(true, actualT);
  const workspace = createTestWorkspace(t, "test-workspace-owner-change-", {
    recycle: () => assert.fail("must not dispose"),
  });
  writeFileSync(
    join(workspace.root, ".test-workspace-owner.json"),
    "substituted",
  );
  assert.throws(t.hooks[0], /ownership marker changed/u);
  assert.equal(
    existsSync(join(workspace.root, ".test-workspace-retention.json")),
    false,
  );
});

test("root replacement refuses disposal of the substituted directory", (actualT) => {
  const t = context(true, actualT);
  const workspace = createTestWorkspace(t, "test-workspace-replacement-", {
    recycle: () => assert.fail("must not dispose"),
  });
  renameSync(workspace.root, `${workspace.root}-original`);
  mkdirSync(workspace.root);
  writeFileSync(join(workspace.root, "unrelated.txt"), "preserve replacement");
  assert.throws(t.hooks[0], /identity changed/u);
  assert.equal(
    readFileSync(join(workspace.root, "unrelated.txt"), "utf8"),
    "preserve replacement",
  );
  assert.equal(
    existsSync(join(workspace.root, ".test-workspace-retention.json")),
    false,
  );
});

test("a nested junction or symlink retains the fixture and its external target", (actualT) => {
  const t = context(true, actualT);
  const targetContext = context(false, actualT);
  const target = createTestWorkspace(
    targetContext,
    "test-workspace-link-target-",
  );
  const workspace = createTestWorkspace(t, "test-workspace-link-", {
    recycle: () => assert.fail("must not dispose"),
  });
  writeFileSync(join(target.root, "unrelated.txt"), "preserve target");
  symlinkSync(
    target.root,
    join(workspace.root, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  t.hooks[0]();
  assert.match(workspace.disposition.reason, /link or reparse/u);
  assert.equal(
    readFileSync(join(target.root, "unrelated.txt"), "utf8"),
    "preserve target",
  );
  targetContext.hooks[0]();
});

test("disposal failure is visible and retained without retry", (actualT) => {
  const t = context(true, actualT);
  let calls = 0;
  const workspace = createTestWorkspace(t, "test-workspace-disposal-failure-", {
    recycle: () => {
      calls++;
      throw new Error("native refusal");
    },
  });
  assert.throws(t.hooks[0], /native refusal/u);
  assert.equal(calls, 1);
  assert.match(workspace.disposition.reason, /disposal failed/u);
  assert.ok(existsSync(workspace.root));
});

test("a child close permits released-fixture disposal", (actualT) => {
  const t = context(true, actualT);
  const child = new EventEmitter();
  let calls = 0;
  const workspace = createTestWorkspace(t, "test-workspace-child-close-", {
    recycle: () => {
      calls++;
      return { status: "unavailable" };
    },
  });
  workspace.trackChild(child);
  child.emit("exit");
  child.emit("close");
  t.hooks[0]();
  assert.equal(calls, 1);
  assert.equal(
    workspace.disposition.reason,
    "native recoverable disposal is unavailable",
  );
});

test("an existing linked retention marker cannot overwrite its external target", (actualT) => {
  const targetContext = context(false, actualT);
  const target = createTestWorkspace(
    targetContext,
    "test-workspace-marker-target-",
  );
  const targetFile = join(target.root, "preserve.txt");
  writeFileSync(targetFile, "external bytes must survive");
  const t = context(true, actualT);
  const workspace = createTestWorkspace(t, "test-workspace-marker-link-", {
    recycle: () => assert.fail("must retain"),
  });
  linkSync(targetFile, join(workspace.root, ".test-workspace-retention.json"));
  workspace.retain("synthetic preservation hold");
  t.hooks[0]();
  assert.equal(readFileSync(targetFile, "utf8"), "external bytes must survive");
  targetContext.hooks[0]();
});

test("a nested retained fixture prevents its successful parent from disposal", (actualT) => {
  const t = context(true, actualT);
  let calls = 0;
  const workspace = createTestWorkspace(t, "test-workspace-nested-hold-", {
    recycle: () => {
      calls++;
      return { status: "unavailable" };
    },
  });
  mkdirSync(join(workspace.root, "child"));
  writeFileSync(
    join(workspace.root, "child/.test-workspace-retention.json"),
    JSON.stringify({ reason: "child failed" }),
  );
  t.hooks[0]();
  assert.equal(calls, 0);
  assert.match(workspace.disposition.reason, /retained fixture/u);
});

test("owner replacement between metadata and byte inspection refuses recycling", (actualT) => {
  const t = context(true, actualT);
  let calls = 0;
  const workspace = createTestWorkspace(t, "test-workspace-owner-race-", {
    recycle: () => {
      calls++;
      return { status: "unavailable" };
    },
  });
  const marker = join(workspace.root, ".test-workspace-owner.json");
  const ownerBytes = readFileSync(marker);
  const original = fs.lstatSync;
  let replaced = false;
  actualT.mock.method(fs, "lstatSync", (...args) => {
    const stat = original(...args);
    if (args[0] === marker && !replaced) {
      replaced = true;
      renameSync(marker, `${marker}.original`);
      writeFileSync(marker, ownerBytes, { flag: "wx" });
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(t.hooks[0], /changed|regular/u);
    assert.equal(replaced, true);
    assert.equal(calls, 0);
    assert.equal(workspace.disposition.status, "retained");
    assert.equal(
      existsSync(join(workspace.root, ".test-workspace-retention.json")),
      false,
    );
    assert.deepEqual(readFileSync(`${marker}.original`), ownerBytes);
  } finally {
    actualT.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("run evidence growth after inventory metadata is rejected before reading", (actualT) => {
  const t = context(true, actualT);
  let calls = 0;
  const workspace = createTestWorkspace(t, "test-workspace-evidence-growth-", {
    recycle: () => {
      calls++;
      return { status: "unavailable" };
    },
  });
  const result = join(workspace.root, "result.json");
  writeFileSync(result, "{}");
  const original = fs.lstatSync;
  const originalOpen = fs.openSync;
  const originalRead = fs.readSync;
  const originalReadFile = fs.readFileSync;
  let descriptor;
  let byteReads = 0;
  let replaced = false;
  actualT.mock.method(fs, "openSync", (...args) => {
    const fd = originalOpen(...args);
    if (args[0] === result) descriptor = fd;
    return fd;
  });
  actualT.mock.method(fs, "readSync", (...args) => {
    if (args[0] === descriptor) byteReads++;
    return originalRead(...args);
  });
  actualT.mock.method(fs, "readFileSync", (...args) => {
    if (args[0] === result) byteReads++;
    return originalReadFile(...args);
  });
  actualT.mock.method(fs, "lstatSync", (...args) => {
    const stat = original(...args);
    if (args[0] === result && !replaced) {
      replaced = true;
      writeFileSync(result, JSON.stringify({ padding: "x".repeat(2097153) }));
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    t.hooks[0]();
    assert.equal(replaced, true);
    assert.equal(calls, 0);
    assert.equal(byteReads, 0);
    assert.match(workspace.disposition.reason, /unreadable|inspection bound/u);
    assert.ok(fs.statSync(result).size > 2097152);
  } finally {
    actualT.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("same-length run replacement during descriptor reading retains evidence and closes the descriptor", (actualT) => {
  const t = context(true, actualT);
  const workspace = createTestWorkspace(
    t,
    "test-workspace-evidence-replacement-",
    {
      recycle: () => assert.fail("must retain raced evidence"),
    },
  );
  const result = join(workspace.root, "result.json");
  writeFileSync(result, '{"value":"one"}');
  const originalOpen = fs.openSync;
  const originalRead = fs.readSync;
  const originalClose = fs.closeSync;
  let descriptor;
  let replaced = false;
  let closed = false;
  actualT.mock.method(fs, "openSync", (...args) => {
    const fd = originalOpen(...args);
    if (args[0] === result) descriptor = fd;
    return fd;
  });
  actualT.mock.method(fs, "readSync", (...args) => {
    if (args[0] === descriptor && !replaced) {
      replaced = true;
      renameSync(result, `${result}.original`);
      writeFileSync(result, '{"value":"two"}', { flag: "wx" });
    }
    return originalRead(...args);
  });
  actualT.mock.method(fs, "closeSync", (fd) => {
    if (fd === descriptor) closed = true;
    return originalClose(fd);
  });
  syncBuiltinESMExports();
  try {
    t.hooks[0]();
    assert.equal(replaced, true);
    assert.equal(closed, true);
    assert.match(workspace.disposition.reason, /unreadable/u);
    assert.equal(readFileSync(`${result}.original`, "utf8"), '{"value":"one"}');
    assert.equal(readFileSync(result, "utf8"), '{"value":"two"}');
  } finally {
    actualT.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

function terminalFixture(root, layout) {
  const packet = createTransmissionPacket({
    suite: "defining-concepts",
    session: {
      preparedSessionId: "0123456789abcdef0123456789abcdef",
      caseId: 1,
      arm: "no-skill",
      repetition: 1,
      sequence: 1,
      suiteArtifacts: [],
    },
    provider: "openai",
    model: "gpt-5.6-luna",
    effort: "low",
    transport: "codex-app-server",
    toolchain: {
      node: "v24.7.0",
      operatingSystem: "win32",
      providerCli: "codex 0.116.0",
      protocol: "app-server-v2",
      schemaSha256: "1".repeat(64),
    },
    runtimeFingerprint: {
      gitCommit: "2".repeat(40),
      gitTree: "3".repeat(40),
      modules: [
        {
          path: "scripts/evaluation/runtime.js",
          byteLength: 100,
          sha256: "4".repeat(64),
        },
      ],
    },
    capabilities: {
      network: false,
      webSearch: false,
      tools: [],
      providerFacilities: [],
    },
    isolation: {
      sandbox: "read-only",
      workingDirectory: root,
      instructionSources: [],
      persistence: false,
      stableHome: { root, role: "execution" },
      environment: { values: {}, secretSources: [] },
    },
    harnessControlledInputs: [],
    continuationPolicy: {
      controllerSha256: "5".repeat(64),
      maxTurns: 1,
      allowedTransitions: [],
      templates: [],
    },
  });
  const artifacts = {};
  mkdirSync(join(root, "inputs"));
  for (const [name, bytes] of [
    ["packet.json", canonicalJsonBytes(packet)],
    [
      "inputs/manifest.json",
      canonicalJsonBytes({ schemaVersion: 1, files: [] }),
    ],
  ]) {
    writeFileSync(join(root, name), bytes);
    artifacts[name] = { byteLength: bytes.length, sha256: sha256Hex(bytes) };
  }
  const trial = layout === "evaluation-trial-v1";
  const path = join(root, trial ? "result.json" : "run.json");
  const record = {
    schemaVersion: 1,
    transmissionSha256: packet.transmissionSha256,
    closure: { status: "safe" },
    artifacts,
    ...(trial
      ? {
          artifactType: "evaluation-trial-result",
          executionStatus: "completed",
        }
      : { status: "completed" }),
  };
  writeFileSync(path, canonicalJsonBytes(record));
  return {
    path,
    record,
    profile: "test-fixture-cleanup",
    transmissionSha256: packet.transmissionSha256,
    evidenceLayout: layout,
  };
}

for (const layout of ["legacy-v1", "evaluation-trial-v1"]) {
  test(`unchanged ${layout} terminal evidence permits recoverable disposal`, (actualT) => {
    const t = context(true, actualT);
    let calls = 0;
    const workspace = createTestWorkspace(t, "test-workspace-safe-outcome-", {
      recycle: () => {
        calls++;
        return { status: "unavailable" };
      },
    });
    const fixture = terminalFixture(workspace.root, layout);
    assert.equal(deriveOutcomeReference(fixture).closureStatus, "safe");
    t.hooks[0]();
    assert.equal(calls, 1);
    assert.equal(
      workspace.disposition.reason,
      "native recoverable disposal is unavailable",
    );
  });

  for (const replacement of ["unsafe", "rewritten-safe"]) {
    test(`${layout} cleanup refuses ${replacement} outcome substitution during validation`, (actualT) => {
      const t = context(true, actualT);
      let calls = 0;
      const workspace = createTestWorkspace(
        t,
        "test-workspace-validator-race-",
        {
          recycle: () => {
            calls++;
            return { status: "unavailable" };
          },
        },
      );
      const fixture = terminalFixture(workspace.root, layout);
      const replacementRecord = { ...fixture.record, observation: "replaced" };
      if (replacement === "unsafe") {
        replacementRecord.closure = { status: "unsafe" };
        replacementRecord[
          layout === "legacy-v1" ? "status" : "executionStatus"
        ] = "failed";
      }
      const original = fs.readFileSync;
      let replaced = false;
      actualT.mock.method(fs, "readFileSync", (...args) => {
        // The maintained validator reads Buffer bytes; the old cleanup read
        // explicitly requested UTF-8. Intercept only the validator's reread.
        if (args[0] === fixture.path && args[1] === undefined && !replaced) {
          replaced = true;
          writeFileSync(fixture.path, canonicalJsonBytes(replacementRecord));
        }
        return original(...args);
      });
      syncBuiltinESMExports();
      try {
        t.hooks[0]();
        assert.equal(replaced, true);
        assert.equal(calls, 0);
        assert.match(
          workspace.disposition.reason,
          /terminal evaluation evidence/u,
        );
        assert.deepEqual(JSON.parse(original(fixture.path)), replacementRecord);
      } finally {
        actualT.mock.restoreAll();
        syncBuiltinESMExports();
      }
    });
  }
}

test("ordinary result JSON still permits recoverable disposal", (actualT) => {
  const t = context(true, actualT);
  let calls = 0;
  const workspace = createTestWorkspace(t, "test-workspace-ordinary-result-", {
    recycle: () => {
      calls++;
      return { status: "unavailable" };
    },
  });
  writeFileSync(
    join(workspace.root, "result.json"),
    JSON.stringify({ value: "ordinary fixture" }),
  );
  t.hooks[0]();
  assert.equal(calls, 1);
});
