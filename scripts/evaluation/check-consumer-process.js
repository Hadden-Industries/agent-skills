import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import {
  inspectToolchain,
  isolatedEnvironment,
  repositoryRoot,
} from "./toolchain.js";

export const PROCESS_SCENARIOS = Object.freeze([
  "normal",
  "delayed-startup",
  "timeout",
  "cancellation",
  "abrupt-consumer-death",
  "abrupt-engine-death",
  "inherited-pipe",
  "cleanup-overrun",
]);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await wait(50);
  return predicate();
}
function readObservation(file, token) {
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(value.token, token);
    assert.ok(Number.isSafeInteger(value.pid) && value.pid > 0);
    return value;
  } catch (error) {
    // A heartbeat can be observed between truncation and completion.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
function pidPresent(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function observeScenario(toolchain, matrixRoot, scenario) {
  const root = join(matrixRoot, scenario);
  mkdirSync(root);
  const token = randomUUID();
  writeFileSync(
    join(root, "SKILL.md"),
    "---\nname: process-proof\ndescription: Owned process observation fixture.\n---\nNo model calls.\n",
  );
  writeFileSync(
    join(root, "case.yaml"),
    stringify({
      id: "process",
      title: scenario,
      input: { prompt: "Return process-marker." },
      expect: { exit_code: 0 },
    }),
  );
  writeFileSync(
    join(root, "eval.yaml"),
    stringify({
      schema_version: "v1alpha1",
      environment: { type: "none" },
      mcp: { servers: [] },
      engine: {
        name: "process-proof",
        custom: {
          transport: "local",
          conversation_mode: "batch",
          response_format: "session_result",
          local: {
            command: process.execPath,
            args: [
              join(
                repositoryRoot,
                "tests/fixtures/evaluation-contracts/process-matrix-engine.mjs",
              ),
              "engine",
              root,
              token,
              scenario,
              "${output_file}",
            ],
            output_file: "${output_file}",
          },
        },
      },
      cases: {
        files: ["case.yaml"],
        defaults: { timeout_seconds: 3, max_turns: 1 },
        parallelism: 1,
        retry_policy: { max_retries: 0 },
      },
      benchmark: { enabled: false },
      judge: { type: "rule_based" },
      report: { formats: ["json"] },
    }),
  );
  const consumer = spawn(
    toolchain.executable,
    [
      "run",
      join(root, "eval.yaml"),
      "--iteration",
      "1",
      "--output-dir",
      join(root, "reports"),
    ],
    {
      cwd: root,
      env: isolatedEnvironment(root),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let exited = null;
  let closed = false;
  let launchError = null;
  let stdout = "";
  let stderr = "";
  consumer.stdout.on("data", (bytes) => {
    stdout += bytes;
  });
  consumer.stderr.on("data", (bytes) => {
    stderr += bytes;
  });
  consumer.once("error", (error) => {
    launchError = error;
  });
  consumer.once("exit", (code, signal) => {
    exited = { code, signal, at: Date.now() };
  });
  consumer.once("close", () => {
    closed = true;
  });
  const identities = {};
  let observation;
  let failure = null;
  try {
    assert.ok(
      await until(() => {
        for (const role of ["engine", "grandchild"])
          identities[role] ??= readObservation(
            join(root, `${role}.json`),
            token,
          );
        return (
          launchError !== null ||
          Boolean(identities.engine && identities.grandchild)
        );
      }, 6000),
      `Process fixture did not start: ${scenario}`,
    );
    if (launchError) throw launchError;
    assert.equal(identities.grandchild.parentPid, identities.engine.pid);
    if (scenario === "cleanup-overrun") {
      writeFileSync(join(root, "begin-cleanup"), token);
      assert.ok(
        await until(() => existsSync(join(root, "cleanup-started.json")), 1000),
        "Fixture cleanup did not start",
      );
    }
    if (scenario === "cancellation") consumer.kill("SIGINT");
    if (scenario === "abrupt-consumer-death") consumer.kill("SIGKILL");
    assert.ok(
      await until(() => exited !== null, 8000),
      `Consumer did not exit: ${scenario}`,
    );
    await wait(700);
    const descendants = ["engine", "grandchild"].map((role) => {
      const heartbeat = readObservation(
        join(root, `${role}-heartbeat.json`),
        token,
      );
      if (heartbeat !== null) assert.equal(heartbeat.pid, identities[role].pid);
      return {
        role,
        pid: identities[role].pid,
        pidPresent: pidPresent(identities[role].pid),
        heartbeat,
        progressedAfterConsumerExit:
          heartbeat !== null && heartbeat.at > exited.at + 100,
      };
    });
    const survivor = descendants.some(
      (value) => value.progressedAfterConsumerExit,
    );
    const unknown = descendants.some((value) => value.pidPresent);
    observation = {
      scenario,
      root,
      consumerPid: consumer.pid,
      exit: exited,
      streamsClosed: closed,
      descendants,
      containment: survivor
        ? "failed-descendant-survived"
        : unknown || !closed
          ? "indeterminate"
          : "observed-closed",
      cancellationSemantics:
        scenario === "cancellation" && process.platform === "win32"
          ? "Node SIGINT emulates unconditional target termination; not console cancellation"
          : null,
      cleanupStarted: readObservation(
        join(root, "cleanup-started.json"),
        token,
      ),
      cleanupSignal: existsSync(join(root, "cleanup-signal.json"))
        ? JSON.parse(readFileSync(join(root, "cleanup-signal.json"), "utf8"))
        : null,
    };
    if (scenario === "normal" || scenario === "delayed-startup") {
      assert.equal(exited.code, 0, stdout + stderr);
      assert.equal(observation.containment, "observed-closed");
    }
  } catch (error) {
    failure = error;
  } finally {
    // Cooperative fixture-only stop plus fixed self-expiry. Never signal a PID
    // recovered from disk; the only externally killed process is our own handle.
    const cleanupStartedAt = Date.now();
    writeFileSync(join(root, "stop-all"), token);
    if (exited === null) consumer.kill("SIGKILL");
    const cleaned = await until(
      () =>
        closed &&
        Object.values(identities)
          .filter(Boolean)
          .every(({ pid }) => !pidPresent(pid)),
      16000,
    );
    const cleanup = {
      observedAt: new Date().toISOString(),
      durationMs: Date.now() - cleanupStartedAt,
      allOwnedPidsAbsentAndStreamsClosed: cleaned,
      fixtureStops: ["engine", "grandchild"].map((role) => ({
        role,
        observation: readObservation(join(root, `stopped-${role}.json`), token),
      })),
    };
    writeFileSync(join(root, "consumer.stdout.log"), stdout);
    writeFileSync(join(root, "consumer.stderr.log"), stderr);
    writeFileSync(
      join(root, "observation.json"),
      JSON.stringify(
        {
          ...observation,
          failure: failure === null ? null : String(failure),
          cleanup,
        },
        null,
        2,
      ),
    );
    if (!cleaned) {
      const cleanupError = new Error(
        `Owned fixture cleanup remains unresolved: ${root}`,
      );
      failure =
        failure === null
          ? cleanupError
          : new AggregateError(
              [failure, cleanupError],
              "Process observation and cleanup failed",
            );
    }
  }
  if (failure !== null) throw failure;
  return observation;
}

export async function checkConsumerProcesses() {
  const toolchain = inspectToolchain();
  const root = mkdtempSync(join(tmpdir(), "evaluation-process-matrix-"));
  const observations = [];
  for (const scenario of PROCESS_SCENARIOS)
    observations.push(await observeScenario(toolchain, root, scenario));
  const receipt = {
    schemaVersion: 1,
    root,
    platform: toolchain.platform,
    node: process.version,
    executableSha256: toolchain.receipt.executableSha256,
    observations,
    qualification: observations.every(
      ({ containment }) => containment === "observed-closed",
    )
      ? "observed-matrix-only-not-production-qualification"
      : "assured-cutover-blocked",
    limitations: [
      "Fake local engine, not Hadden session closure or OS-level egress qualification.",
      "Negative containment observations are retained, never converted into production qualification.",
      "PID presence alone is indeterminate; fresh correlated heartbeat proves survival.",
      "Windows SIGINT emulation does not prove console cancellation behavior.",
    ],
  };
  writeFileSync(join(root, "receipt.json"), JSON.stringify(receipt, null, 2));
  return receipt;
}
