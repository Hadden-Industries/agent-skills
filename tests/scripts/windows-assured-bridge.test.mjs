import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const repository = resolve(import.meta.dirname, "../..");
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const write = (file, value) =>
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function until(predicate, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > end)
      throw new Error("Integrated bridge observation expired");
    await delay(25);
  }
}

test(
  "Windows integrated bridge preserves authority and leases across job closure",
  {
    skip: process.platform !== "win32",
    timeout: 180000,
  },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "windows-assured-bridge-"));
    const checkout = join(root, "checkout");
    mkdirSync(checkout);
    const manifestBytes = readFileSync(
      join(repository, "evaluation-toolchain.json"),
    );
    for (const item of [
      "src",
      "scripts",
      "skills",
      "node_modules",
      "package.json",
      "package-lock.json",
      "evaluation-toolchain.json",
    ])
      cpSync(join(repository, item), join(checkout, item), { recursive: true });
    // A selected negative control changes only this disposable checkout. The
    // resulting host bytes are bound by normal preparation, never bypassed.
    const fault = process.env.WINDOWS_BRIDGE_FIXTURE_FAULT;
    if (fault !== undefined) {
      assert.equal(fault, "omit-recorder-termination");
      assert.equal(process.env.WINDOWS_BRIDGE_FIXTURE_SCENARIO, "host-death");
      const hostScript = join(
        checkout,
        "scripts/evaluation/windows-closure-recorder.py",
      );
      const original = readFileSync(hostScript, "utf8");
      assert.ok(original.includes("checked(terminate(job, 124))"));
      writeFileSync(
        hostScript,
        original.replaceAll(
          "checked(terminate(job, 124))",
          "pass  # disposable negative control: omit recorder termination",
        ),
        { mode: 0o600 },
      );
    }
    const manifest = read(join(checkout, "evaluation-toolchain.json"));
    manifest.skillUp.platforms["win32-x64"].qualification = "assured-qualified";
    write(join(checkout, "evaluation-toolchain.json"), manifest);
    const native = `.agent-tools/evaluation/skill-up-${manifest.skillUp.version}-win32-x64`;
    cpSync(join(repository, native), join(checkout, native), {
      recursive: true,
    });
    const environment = Object.fromEntries(
      ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP"]
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    );
    const globalConfig = join(root, "empty-gitconfig");
    writeFileSync(globalConfig, "", { mode: 0o600 });
    const git = (args) => {
      const result = spawnSync("git", args, {
        cwd: checkout,
        env: {
          ...environment,
          GIT_CONFIG_GLOBAL: globalConfig,
          GIT_CONFIG_NOSYSTEM: "1",
        },
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
      });
      assert.equal(result.status, 0, result.stderr);
    };
    git(["init"]);
    git(["add", "package.json"]);
    git([
      "-c",
      "user.name=Qualification Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Synthetic fixture",
    ]);
    const load = (file) => import(pathToFileURL(join(checkout, file)).href);
    const {
      initializeEvaluationHomes,
      inspectEvaluationHomes,
      prepareEvaluationHomeRecovery,
      applyEvaluationHomeRecovery,
    } = await load("scripts/evaluation/evaluation-homes.js");
    const { inspectCodexAppServerToolchain } = await load(
      "scripts/evaluation/codex-app-server.js",
    );
    const { prepareEvaluationSession, executePreparedEvaluationSession } =
      await load(
        "src/committing-to-git/evals/assurance/v1/evaluation-runner.mjs",
      );
    const { prepareSessionDispatch } = await load(
      "scripts/evaluation/session-dispatch.js",
    );
    const { bindPreparedCarrier } = await load(
      "scripts/evaluation/prepare-consumer-carrier.js",
    );
    const { runSkillUp } = await load("scripts/evaluation/run-skill-up.js");
    const { EXTERNAL_MODEL_AUTHORIZATION_STATEMENT } = await load(
      "scripts/evaluation/runtime.js",
    );
    const receipts = [];
    process.stdout.write(
      `${JSON.stringify({ root, baseline: "test-only override; no production qualification" })}\n`,
    );
    const scenarios = [
      "normal",
      "invalid-authority",
      "wrapper-death",
      "host-death",
      "recorder-death",
      "simultaneous-death",
      "consumer-death",
      "bridge-death",
      "cancellation",
      "provider-death",
      "timeout",
    ];
    const selectedScenario = process.env.WINDOWS_BRIDGE_FIXTURE_SCENARIO;
    if (selectedScenario !== undefined)
      assert.ok(scenarios.includes(selectedScenario));
    for (const scenario of scenarios.filter(
      (value) => selectedScenario === undefined || value === selectedScenario,
    )) {
      await t.test(scenario, async () => {
        const directory = join(root, scenario);
        mkdirSync(directory);
        const homes = join(directory, "homes");
        await initializeEvaluationHomes({ root: homes });
        if (scenario === "host-death")
          writeFileSync(
            join(homes, "execution/auth.json"),
            "synthetic credential bytes",
            { mode: 0o600 },
          );
        const requestPath = join(directory, "provider-request.json");
        write(requestPath, {
          root: directory,
          scenario,
          provider: join(
            repository,
            "tests/committing-to-git/fixtures/fake-app-server.mjs",
          ),
        });
        const toolchain = await inspectCodexAppServerToolchain({
          command: process.execPath,
          prefixArguments: [
            join(
              repository,
              "tests/fixtures/evaluation-contracts/bridge-provider-proxy.mjs",
            ),
            requestPath,
          ],
          scratchRoot: join(directory, "inspection"),
          environment,
        });
        const carrier = prepareSessionDispatch({
          executionMode: "skill-up",
          repositoryRoot: checkout,
          skillName: "committing-to-git",
          caseId: 35,
          executionTimeoutMs: 10000,
        });
        const prepared = await prepareEvaluationSession({
          arm: "no-skill",
          authorizationEligible: true,
          campaignId: "d".repeat(64),
          caseId: 35,
          destination: join(directory, "prepared"),
          effort: "low",
          evaluationHomesRoot: homes,
          environment,
          model: "gpt-5.6-luna",
          provider: "openai",
          repetition: 1,
          repositoryRoot: checkout,
          runtimeIsolationCatalog: {
            appIds: [],
            mcpServerIds: [],
            pluginIds: [],
            skillPaths: [],
          },
          runtimeIsolationDiscovery: null,
          seed: "integrated-job-closure",
          sequence: 1,
          sourceCommit: null,
          toolchain,
          consumerProjectionSha256: carrier.projectionReceiptSha256,
        });
        const authPath = join(directory, "authorization.json");
        write(authPath, {
          schemaVersion: 1,
          decision: "authorized",
          statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
          allowExternalModel: true,
          provider: "openai",
          model: "gpt-5.6-luna",
          effort: "low",
          transmissionSha256:
            scenario === "invalid-authority"
              ? "0".repeat(64)
              : prepared.packet.transmissionSha256,
        });
        const controlPath = bindPreparedCarrier({
          carrier,
          preparedSession: prepared.preparedSession,
          packet: prepared.packet,
          authorizationFile: authPath,
        });
        const consumerRoot = carrier.receipt.consumerRoot;
        const wrapper = spawn(
          process.execPath,
          [join(checkout, "scripts/evaluation/run-skill-up.js"), controlPath],
          {
            cwd: checkout,
            env: environment,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          },
        );
        let output = "";
        for (const stream of [wrapper.stdout, wrapper.stderr])
          stream.on("data", (chunk) => {
            if (output.length < 1048576) output += chunk.toString();
          });
        const closed = new Promise((done) =>
          wrapper.once("close", (code) => done(code)),
        );
        let inventory = [];
        let target = null;
        const started = Date.now();
        try {
          if (!["normal", "invalid-authority"].includes(scenario)) {
            await until(
              () =>
                existsSync(join(directory, "provider-barrier.json")) &&
                existsSync(join(directory, "grandchild.json")),
            );
            const barrier = read(join(directory, "provider-barrier.json"));
            assert.equal(barrier.phase, "turn/start");
            assert.ok(
              existsSync(join(prepared.preparedSession, "attempt.json")),
            );
            assert.ok(
              existsSync(join(homes, ".leases/execution.lock/lease.json")),
            );
            const observation = spawnSync(
              carrier.receipt.processHost.interpreter,
              [
                "-I",
                "-B",
                join(
                  repository,
                  "tests/fixtures/evaluation-contracts/observe-windows-job.py",
                ),
                carrier.receipt.processHost.jobName,
                String(
                  read(
                    join(
                      consumerRoot,
                      "process-host-observation.json.ready.json",
                    ),
                  ).recorder.pid,
                ),
              ],
              { encoding: "utf8", windowsHide: true, timeout: 5000 },
            );
            assert.equal(observation.status, 0, observation.stderr);
            const job = JSON.parse(observation.stdout);
            const readyBinding = read(
              join(consumerRoot, "process-host-observation.json.ready.json"),
            );
            assert.equal(job.recorder.inInvocationJob, false);
            assert.equal(job.recorder.pid, readyBinding.recorder.pid);
            assert.equal(
              job.recorder.creationFileTime,
              readyBinding.recorder.creationFileTime,
            );
            assert.equal(
              resolve(job.recorder.image).toLowerCase(),
              resolve(carrier.receipt.processHost.interpreter).toLowerCase(),
            );
            inventory = job.processes;
            assert.ok(inventory.some(({ pid }) => pid === barrier.pid));
            assert.ok(
              inventory.some(
                ({ pid }) =>
                  pid === read(join(directory, "grandchild.json")).pid,
              ),
            );
            const bridge = inventory.find(
              ({ pid }) => pid === barrier.parentPid,
            );
            assert.ok(bridge);
            // Native custom engines may insert shells: parent-of-bridge is not
            // necessarily the native consumer. Match its pinned executable.
            const consumer = inventory.find(
              ({ image }) =>
                resolve(image).toLowerCase() ===
                resolve(join(checkout, native, "skill-up.exe")).toLowerCase(),
            );
            assert.ok(consumer);
            const host = job.outsideParents.find(
              ({ pid }) => pid === consumer.parentPid,
            );
            assert.ok(host);
            assert.equal(
              resolve(host.image).toLowerCase(),
              resolve(carrier.receipt.processHost.interpreter).toLowerCase(),
            );
            assert.equal(host.parentPid, wrapper.pid);
            const targets = {
              "wrapper-death": wrapper.pid,
              "host-death": host.pid,
              "consumer-death": consumer.pid,
              "bridge-death": bridge.pid,
              "provider-death": barrier.pid,
              cancellation: consumer.pid,
              "recorder-death": read(
                join(consumerRoot, "process-host-observation.json.ready.json"),
              ).recorder.pid,
              "simultaneous-death": read(
                join(consumerRoot, "process-host-observation.json.ready.json"),
              ).recorder.pid,
            };
            target = targets[scenario] ?? null;
            const claimBytes = readFileSync(
              join(consumerRoot, "invocation-started.json"),
            );
            const consumptionBytes = readFileSync(
              join(prepared.preparedSession, "attempt.json"),
            );
            // Refuse a concurrent attempt while the first process is demonstrably live.
            await assert.rejects(
              runSkillUp({ controlPath }),
              /already attempted/u,
            );
            assert.ok(alive(barrier.pid));
            if (scenario === "host-death") {
              const live = await prepareEvaluationHomeRecovery({
                root: homes,
                role: "execution",
              });
              assert.equal(live.status, "unknown");
              assert.ok(alive(barrier.pid));
            }
            if (target !== null)
              process.kill(
                target,
                scenario === "cancellation" ? "SIGINT" : "SIGKILL",
              );
            if (scenario === "simultaneous-death")
              process.kill(host.pid, "SIGKILL");
            if (target === null) await closed;
            try {
              await until(
                () => inventory.every(({ pid }) => !alive(pid)),
                8000,
              );
            } catch (error) {
              throw new Error(
                `Owned job processes survived ${scenario}: ${inventory
                  .filter(({ pid }) => alive(pid))
                  .map(({ pid }) => pid)
                  .join(",")}`,
                { cause: error },
              );
            }
            await closed;
            assert.deepEqual(
              readFileSync(join(consumerRoot, "invocation-started.json")),
              claimBytes,
            );
            assert.deepEqual(
              readFileSync(join(prepared.preparedSession, "attempt.json")),
              consumptionBytes,
            );
            await assert.rejects(
              runSkillUp({ controlPath }),
              /already attempted/u,
            );
            if (
              [
                "wrapper-death",
                "host-death",
                "recorder-death",
                "simultaneous-death",
                "consumer-death",
                "bridge-death",
                "cancellation",
              ].includes(scenario)
            ) {
              assert.equal(
                existsSync(join(prepared.preparedSession, "run.json")),
                false,
              );
              assert.ok(
                existsSync(join(homes, ".leases/execution.lock/lease.json")),
              );
              await assert.rejects(
                executePreparedEvaluationSession({
                  preparedSession: prepared.preparedSession,
                  authorization: read(authPath),
                  allowExternalModelCall: true,
                  timeoutMs: 10000,
                }),
                /Reserved execution evidence already exists: attempt.json/u,
              );
              if (scenario === "host-death") {
                const leasePath = join(homes, ".leases/execution.lock");
                const leaseBytes = readFileSync(join(leasePath, "lease.json"));
                const journalBytes = readFileSync(
                  join(leasePath, "journal.jsonl"),
                );
                const oppositeMarker = readFileSync(
                  join(homes, "preflight/.evaluation-home-owner.json"),
                );
                const beforeGeneration = read(
                  join(homes, "execution/.evaluation-home-owner.json"),
                ).generationNonce;
                const proposal = await prepareEvaluationHomeRecovery({
                  root: homes,
                  role: "execution",
                });
                assert.equal(
                  proposal.status,
                  "eligible",
                  JSON.stringify(proposal),
                );
                const recovered = await applyEvaluationHomeRecovery({
                  proposal,
                  confirmRoot: homes,
                  confirmRole: "execution",
                  stateDigest: proposal.stateDigest,
                });
                assert.equal(recovered.status, "recovered");
                assert.equal(existsSync(leasePath), false);
                assert.deepEqual(
                  readFileSync(join(recovered.historyPath, "lease.json")),
                  leaseBytes,
                );
                assert.deepEqual(
                  readFileSync(join(recovered.historyPath, "journal.jsonl")),
                  journalBytes,
                );
                assert.deepEqual(
                  readFileSync(
                    join(homes, "preflight/.evaluation-home-owner.json"),
                  ),
                  oppositeMarker,
                );
                assert.equal(
                  readFileSync(join(homes, "execution/auth.json"), "utf8"),
                  "synthetic credential bytes",
                );
                assert.notEqual(
                  read(join(homes, "execution/.evaluation-home-owner.json"))
                    .generationNonce,
                  beforeGeneration,
                );
                assert.deepEqual(readdirSync(join(homes, "execution")).sort(), [
                  ".evaluation-home-owner.json",
                  "auth.json",
                ]);
                assert.deepEqual(
                  readFileSync(join(prepared.preparedSession, "attempt.json")),
                  consumptionBytes,
                );
                assert.equal(
                  existsSync(join(prepared.preparedSession, "run.json")),
                  false,
                );
                const inventory = await inspectEvaluationHomes({ root: homes });
                assert.equal(inventory.recoveredHistory.length, 1);
                assert.equal(
                  inventory.completedHistory.some(({ name }) =>
                    name.endsWith(".recovered"),
                  ),
                  false,
                );
                await assert.rejects(
                  executePreparedEvaluationSession({
                    preparedSession: prepared.preparedSession,
                    authorization: read(authPath),
                    allowExternalModelCall: true,
                  }),
                  /Reserved execution evidence already exists: attempt.json/u,
                );
                write(join(directory, "recovery-receipt.json"), recovered);
              } else if (
                ["recorder-death", "simultaneous-death"].includes(scenario)
              ) {
                const unknown = await prepareEvaluationHomeRecovery({
                  root: homes,
                  role: "execution",
                });
                assert.equal(unknown.status, "unknown");
                assert.ok(
                  existsSync(join(homes, ".leases/execution.lock/lease.json")),
                );
              }
            } else {
              const outcome = read(join(prepared.preparedSession, "run.json"));
              assert.equal(outcome.status, "failed");
              assert.equal(
                outcome.failureClass,
                scenario === "timeout" ? "timed-out" : "provider-failed",
              );
            }
          } else {
            if (scenario === "normal") {
              await until(() =>
                existsSync(join(directory, "provider-barrier.json")),
              );
              const observation = spawnSync(
                carrier.receipt.processHost.interpreter,
                [
                  "-I",
                  "-B",
                  join(
                    repository,
                    "tests/fixtures/evaluation-contracts/observe-windows-job.py",
                  ),
                  carrier.receipt.processHost.jobName,
                ],
                { encoding: "utf8", windowsHide: true, timeout: 5000 },
              );
              assert.equal(observation.status, 0, observation.stderr);
              inventory = JSON.parse(observation.stdout).processes;
              assert.ok(
                inventory.some(
                  ({ pid }) =>
                    pid === read(join(directory, "provider-barrier.json")).pid,
                ),
              );
              writeFileSync(join(directory, "release"), "release", {
                mode: 0o600,
              });
            }
            const code = await closed;
            if (scenario === "normal") {
              assert.equal(code, 0, output);
              const outcome = read(join(prepared.preparedSession, "run.json"));
              assert.equal(outcome.status, "completed");
              assert.equal(
                outcome.suiteResult.commitAuthorization.status,
                "sent",
              );
              assert.equal(readdirSync(join(homes, ".leases")).length, 0);
              assert.ok(readdirSync(join(homes, ".history")).length > 0);
              const host = read(
                join(consumerRoot, "process-host-observation.json"),
              );
              assert.equal(host.activeProcesses, 0);
              assert.ok(inventory.every(({ pid }) => !alive(pid)));
              assert.equal(
                alive(read(join(directory, "provider-barrier.json")).pid),
                false,
              );
            } else {
              assert.notEqual(code, 0);
              assert.equal(
                existsSync(join(directory, "provider-barrier.json")),
                false,
              );
              assert.equal(
                existsSync(join(prepared.preparedSession, "attempt.json")),
                false,
              );
            }
            await assert.rejects(
              runSkillUp({ controlPath }),
              /already attempted/u,
            );
          }
          receipts.push({
            scenario,
            elapsedMs: Date.now() - started,
            target,
            inventory,
            consumed: existsSync(
              join(prepared.preparedSession, "attempt.json"),
            ),
            terminal: existsSync(join(prepared.preparedSession, "run.json")),
            leaseRetained: existsSync(
              join(homes, ".leases/execution.lock/lease.json"),
            ),
            output,
            consumerRoot,
            preparedSession: prepared.preparedSession,
          });
          write(join(directory, "receipt.json"), receipts.at(-1));
        } catch (error) {
          write(join(directory, "failed-observation.json"), {
            scenario,
            error: String(error),
            inventory,
            survivors: inventory.filter(({ pid }) => alive(pid)),
            consumerRoot,
            preparedSession: prepared.preparedSession,
          });
          throw error;
        } finally {
          // Stop only the still-owned wrapper; its host is responsible for its job.
          if (wrapper.exitCode === null && wrapper.signalCode === null)
            wrapper.kill("SIGKILL");
          if (fault !== undefined) {
            // Mutant cleanup is independently retained and is never a passing
            // containment observation or a license to reset the consumed lease.
            const cleanup = spawnSync(
              carrier.receipt.processHost.interpreter,
              [
                "-I",
                "-B",
                join(
                  repository,
                  "tests/fixtures/evaluation-contracts/close-windows-fixture-job.py",
                ),
                carrier.receipt.processHost.jobName,
              ],
              { encoding: "utf8", windowsHide: true, timeout: 5000 },
            );
            write(join(directory, "mutant-cleanup.json"), {
              status: cleanup.status,
              stdout: cleanup.stdout,
              stderr: cleanup.stderr,
            });
            assert.equal(cleanup.status, 0, cleanup.stderr);
            await until(() => inventory.every(({ pid }) => !alive(pid)), 8000);
          }
        }
      });
    }
    assert.deepEqual(
      readFileSync(join(repository, "evaluation-toolchain.json")),
      manifestBytes,
    );
    write(join(root, "matrix.json"), {
      schemaVersion: 1,
      receipts,
      limitation:
        "Synthetic provider only; interrupted leases remain explicit recovery obligations; production gate unchanged",
    });
  },
);
