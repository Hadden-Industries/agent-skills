import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
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
import test from "node:test";
import { createTestWorkspace } from "../fixtures/temporary-workspace.mjs";
import { createConsumerWorkspace } from "../../scripts/evaluation/consumer-workspace.js";
import { compileSuite } from "../../scripts/evaluation/compile-suite.js";
import { repositoryRoot } from "../../scripts/evaluation/toolchain.js";

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
