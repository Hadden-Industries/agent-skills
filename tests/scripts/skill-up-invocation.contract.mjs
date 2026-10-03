// Transport and refusal fixtures only. Production qualification is never changed.
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const repository = path.resolve(import.meta.dirname, "../..");
const originalManifest = readFileSync(
  path.join(repository, "evaluation-toolchain.json"),
);
const root = mkdtempSync(path.join(tmpdir(), "bridge-transport-fixture-"));
process.stdout.write(
  JSON.stringify({
    root,
    qualification: "test-only override; no containment claim",
  }) + "\n",
);
const checkout = path.join(root, "checkout");
mkdirSync(checkout);
for (const item of [
  "src",
  "scripts",
  "skills",
  "node_modules",
  "package.json",
  "package-lock.json",
  "evaluation-toolchain.json",
])
  cpSync(path.join(repository, item), path.join(checkout, item), {
    recursive: true,
  });
// Bounded CI diagnosis: profile only the fake Windows Git controller carrier.
// Modify the disposable source before preparation seals its carrier/runtime
// identities. The fake case gets time to flush the exit-only profiler. This
// diagnostic cannot qualify the ordinary deadline or production execution.
if (process.platform === "win32") {
  const profileRoot = path.join(root, "native-git-profile");
  mkdirSync(profileRoot);
  const carrierSource = path.join(
    checkout,
    "scripts/evaluation/prepare-consumer-carrier.js",
  );
  const source = readFileSync(carrierSource, "utf8");
  const anchor = "          args: [";
  const deadlineAnchor = "  const maximumSeconds = Math.ceil(";
  assert.equal(source.split(anchor).length, 2);
  assert.equal(source.split(deadlineAnchor).length, 2);
  writeFileSync(
    path.join(profileRoot, "diagnostic-budget.json"),
    JSON.stringify({
      schemaVersion: 1,
      caseId: 35,
      diagnosticOnly: true,
      ordinaryStartupAllowanceMs: 10000,
      diagnosticStartupAllowanceMs: 40000,
      executionTimeoutMs: 10000,
      cleanupAllowanceMs: 10000,
      ordinaryMaximumSeconds: 30,
      diagnosticMaximumSeconds: 60,
    }),
    { flag: "wx" },
  );
  writeFileSync(
    carrierSource,
    source
      .replace(
        deadlineAnchor,
        `  if (caseId === 35) startupAllowanceMs = 40000;\n${deadlineAnchor}`,
      )
      .replace(
        anchor,
        `${anchor}\n            ...(caseId === 35 ? ["--cpu-prof", ${JSON.stringify(`--cpu-prof-dir=${profileRoot}`)}, "--cpu-prof-name=native-git.cpuprofile"] : []),`,
      ),
  );
}
const platform = `${process.platform}-${process.arch}`;
const manifest = JSON.parse(
  readFileSync(path.join(checkout, "evaluation-toolchain.json"), "utf8"),
);
manifest.skillUp.platforms[platform].qualification = "assured-qualified";
writeFileSync(
  path.join(checkout, "evaluation-toolchain.json"),
  JSON.stringify(manifest, null, 2),
);
const native = `.agent-tools/evaluation/skill-up-${manifest.skillUp.version}-${platform}`;
cpSync(path.join(repository, native), path.join(checkout, native), {
  recursive: true,
});
const globalConfig = path.join(root, "empty-gitconfig");
writeFileSync(globalConfig, "");
const git = (args) => {
  const r = spawnSync("git", args, {
    cwd: checkout,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  if (r.status !== 0) throw new Error(r.stderr);
};
git(["init"]);
git(["add", "package.json"]);
git([
  "-c",
  "user.name=Transport Fixture",
  "-c",
  "user.email=fixture@example.test",
  "-c",
  "commit.gpgsign=false",
  "commit",
  "-m",
  "Transport fixture",
]);
const load = (file) => import(pathToFileURL(path.join(checkout, file)).href);
const { compileSuite } = await load("scripts/evaluation/compile-suite.js");
const { prepareConsumerCarrier, bindPreparedCarrier } = await load(
  "scripts/evaluation/prepare-consumer-carrier.js",
);
const { prepareNamingSession } = await load(
  "src/naming-objects-in-software-engineering/evals/assurance/v1/profile.mjs",
);
const { runSkillUp } = await load("scripts/evaluation/run-skill-up.js");
const { executeSkillUpBridge } = await load(
  "scripts/evaluation/skill-up-custom-engine.js",
);
const {
  EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  canonicalJsonBytes,
  sha256Hex,
} = await load("scripts/evaluation/runtime.js");
const compiled = compileSuite({
  repositoryRoot: checkout,
  skillName: "naming-objects-in-software-engineering",
});
const carrier = prepareConsumerCarrier({
  repositoryRoot: checkout,
  compiled,
  caseId: 4,
  publicSessionId: "fake-normal-closure",
  executionTimeoutMs: 10000,
});
process.stdout.write(
  JSON.stringify({ consumerRoot: carrier.receipt.consumerRoot }) + "\n",
);
const workingDirectory = path.join(root, "work");
mkdirSync(workingDirectory);
const preparedSession = path.join(root, "prepared");
const environment = Object.fromEntries(
  ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP"]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
await prepareNamingSession({
  destination: preparedSession,
  caseId: 4,
  arm: "candidate-skill",
  model: "gemini-3.5-flash-low",
  effort: "low",
  command: process.execPath,
  prefixArguments: [
    path.join(repository, "tests/scripts/fixtures/fake-antigravity-cli.mjs"),
    "--record-file",
    path.join(root, "fake-provider.jsonl"),
  ],
  environment,
  workingDirectory,
  timeoutMs: 10000,
  consumerProjectionSha256: carrier.projectionReceiptSha256,
});
const packet = JSON.parse(
  readFileSync(path.join(preparedSession, "packet.json"), "utf8"),
);
const authorizationFile = path.join(root, "authorization.json");
writeFileSync(
  authorizationFile,
  JSON.stringify({
    schemaVersion: 1,
    decision: "authorized",
    statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
    allowExternalModel: true,
    provider: "google",
    model: packet.transmission.model,
    effort: "low",
    transmissionSha256: packet.transmissionSha256,
  }),
);
const controlPath = bindPreparedCarrier({
  carrier,
  preparedSession,
  packet,
  authorizationFile,
});
const probeWorkspace = path.join(
  carrier.receipt.consumerRoot,
  "refusal-workspace",
);
mkdirSync(probeWorkspace);
const inputPath = path.join(probeWorkspace, "input.json");
const outputPath = path.join(probeWorkspace, "output.json");
writeFileSync(
  inputPath,
  JSON.stringify({
    ...carrier.receipt.expectedInput,
    workspace: probeWorkspace,
    timeout_seconds: carrier.receipt.deadline.maximumSeconds,
  }),
);
const bridge = (output = outputPath) =>
  executeSkillUpBridge({ controlPath, inputPath, outputPath: output });
const controlBytes = readFileSync(controlPath);
const receiptBytes = readFileSync(carrier.receiptPath);
const preflightObservations = readFileSync(
  path.join(root, "fake-provider.jsonl"),
);
writeFileSync(
  carrier.receiptPath,
  Buffer.concat([receiptBytes, Buffer.from(" ")]),
);
await assert.rejects(bridge(), /Carrier receipt drift/u);
writeFileSync(carrier.receiptPath, receiptBytes);
const control = JSON.parse(controlBytes);
writeFileSync(
  controlPath,
  JSON.stringify({ ...control, transmissionSha256: "0".repeat(64) }),
);
await assert.rejects(bridge(), /Prepared carrier binding mismatch/u);
writeFileSync(controlPath, controlBytes);
for (const [field, value, diagnostic] of [
  ["caseId", 7, /Carrier case identity mismatch/u],
  [
    "compiledSuiteSha256",
    "0".repeat(64),
    /Carrier compiled suite identity mismatch/u,
  ],
]) {
  const changedReceipt = canonicalJsonBytes({
    ...carrier.receipt,
    [field]: value,
  });
  writeFileSync(carrier.receiptPath, changedReceipt);
  writeFileSync(
    controlPath,
    JSON.stringify({
      ...control,
      projectionReceiptSha256: sha256Hex(changedReceipt),
    }),
  );
  await assert.rejects(bridge(), diagnostic);
}
writeFileSync(carrier.receiptPath, receiptBytes);
writeFileSync(controlPath, controlBytes);
const configurationBytes = readFileSync(carrier.receipt.configurationPath);
writeFileSync(
  carrier.receipt.configurationPath,
  Buffer.concat([configurationBytes, Buffer.from("\n")]),
);
await assert.rejects(bridge(), /Consumer configuration drift/u);
writeFileSync(carrier.receipt.configurationPath, configurationBytes);
await assert.rejects(
  bridge(path.join(preparedSession, "forbidden-output.json")),
  /prepared evidence boundary/u,
);
writeFileSync(outputPath, "retained existing output");
await assert.rejects(bridge(), /Consumer output already exists/u);
renameSync(
  outputPath,
  path.join(probeWorkspace, "retained-existing-output.json"),
);
assert.equal(existsSync(path.join(preparedSession, "attempt.json")), false);
if (process.platform === "win32")
  await assert.rejects(bridge(), /outside its prepared Windows job/u);
assert.deepEqual(
  readFileSync(path.join(root, "fake-provider.jsonl")),
  preflightObservations,
);
const result = await runSkillUp({ controlPath });
await assert.rejects(() => runSkillUp({ controlPath }), /already attempted/u);
renameSync(
  path.join(carrier.receipt.consumerRoot, "invocation.json"),
  path.join(carrier.receipt.consumerRoot, "completed-invocation.json"),
);
await assert.rejects(() => runSkillUp({ controlPath }), /already attempted/u);
const outcome = JSON.parse(
  readFileSync(path.join(preparedSession, "run.json"), "utf8"),
);
if (outcome.status !== "completed") throw new Error("Hadden did not complete");
assert.ok(
  readFileSync(path.join(repository, "evaluation-toolchain.json")).equals(
    originalManifest,
  ),
);
const observations = readFileSync(
  path.join(root, "fake-provider.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .map(JSON.parse);
assert.equal(observations.filter(({ mode }) => mode === "model").length, 1);
assert.equal(observations.filter(({ mode }) => mode === "input").length, 2);
const reportBytes = readFileSync(
  path.join(carrier.receipt.consumerRoot, "reports/iteration-1/benchmark.json"),
  "utf8",
);
assert.ok(!reportBytes.includes(EXTERNAL_MODEL_AUTHORIZATION_STATEMENT));
assert.ok(!reportBytes.includes("candidate-skill"));
const receipt = {
  schemaVersion: 1,
  root,
  consumerRoot: carrier.receipt.consumerRoot,
  transmissionSha256: packet.transmissionSha256,
  consumerExit: result.status,
  authoritativeStatus: outcome.status,
  qualification:
    "test-only manifest override in disposable copy; normal transport only; no containment or platform qualification",
};
writeFileSync(
  path.join(root, "receipt.json"),
  JSON.stringify(receipt, null, 2),
);
process.stdout.write(JSON.stringify(receipt) + "\n");

// Exercise the operator dispatch seam against the real native consumer in the
// disposable qualification checkout. These fake sessions are not calibration.
const {
  prepareSessionDispatch,
  retainSessionDispatch,
  dispatchPreparedSession,
} = await load("scripts/evaluation/session-dispatch.js");
const { inspectAntigravityCliToolchain } = await load(
  "scripts/evaluation/antigravity-cli.js",
);
const { preparePolicyEvaluationSession, executePreparedEvaluationSession } =
  await load("src/committing-to-git/evals/assurance/v1/evaluation-runner.mjs");
const fakeProvider = path.join(
  repository,
  "tests/scripts/fixtures/fake-antigravity-cli.mjs",
);
const dispatchResults = {};
for (const skillName of [
  "committing-to-git",
  "defining-concepts",
  "naming-objects-in-software-engineering",
]) {
  dispatchResults[skillName] = [];
  for (const executionMode of ["direct", "skill-up"]) {
    const sessionRoot = path.join(root, `${skillName}-${executionMode}`);
    mkdirSync(sessionRoot);
    const work = path.join(sessionRoot, "work");
    const destination = path.join(sessionRoot, "prepared");
    const recordFile = path.join(sessionRoot, "provider.jsonl");
    const authPath = path.join(sessionRoot, "authorization.json");
    if (skillName === "naming-objects-in-software-engineering") {
      mkdirSync(work);
      const requestPath = path.join(sessionRoot, "prepare-request.json");
      writeFileSync(
        requestPath,
        canonicalJsonBytes({
          executionMode,
          destination,
          caseId: 4,
          arm: "no-skill",
          model: "gemini-3.5-flash-low",
          effort: "low",
          command: process.execPath,
          prefixArguments: [fakeProvider, "--record-file", recordFile],
          environment,
          workingDirectory: work,
          timeoutMs: 10000,
        }),
      );
      const preparation = spawnSync(
        process.execPath,
        [
          path.join(
            checkout,
            "src/naming-objects-in-software-engineering/evals/assurance/v1/evaluation-runner.mjs",
          ),
          "prepare",
          requestPath,
        ],
        { encoding: "utf8", timeout: 20000, windowsHide: true },
      );
      assert.equal(preparation.status, 0, preparation.stderr);
    } else if (skillName === "committing-to-git") {
      mkdirSync(work);
      const dispatchCarrier = prepareSessionDispatch({
        executionMode,
        repositoryRoot: checkout,
        skillName,
        caseId: 3,
        executionTimeoutMs: 10000,
      });
      const toolchain = await inspectAntigravityCliToolchain({
        command: process.execPath,
        prefixArguments: [fakeProvider, "--record-file", recordFile],
        environment,
      });
      const prepared = await preparePolicyEvaluationSession({
        arm: "no-skill",
        campaignId: "c".repeat(64),
        caseId: 3,
        destination,
        effort: "low",
        environment,
        model: "gemini-3.5-flash-low",
        provider: "google",
        repetition: 1,
        repositoryRoot: checkout,
        seed: "dispatch-equivalence",
        sequence: 1,
        sourceCommit: null,
        toolchain,
        workingDirectory: work,
        consumerProjectionSha256: dispatchCarrier?.projectionReceiptSha256,
      });
      retainSessionDispatch({
        preparedSession: destination,
        carrier: dispatchCarrier,
        packet: prepared.packet,
      });
    } else {
      const caseFile = path.join(sessionRoot, "case.json");
      const compiledConcepts = compileSuite({
        repositoryRoot: checkout,
        skillName,
      });
      writeFileSync(
        caseFile,
        canonicalJsonBytes(
          compiledConcepts.definition.evals.find(({ id }) => id === 10),
        ),
      );
      // Text-only fake-provider envelope, identical across arms; no claim of
      // provider research capability or production campaign qualification.
      const capabilityReceipt = {
        suite: skillName,
        selectedCaseIds: [10],
        arms: ["no-skill", "current-skill", "candidate-skill"],
        compatibility: [],
        armEnvelopes: ["no-skill", "current-skill", "candidate-skill"].map(
          (arm) => ({ arm, capabilities: ["bundled-skill-files"] }),
        ),
        providerResolution: { provider: "google" },
        runtimeCapabilities: {
          network: false,
          webSearch: false,
          tools: [],
          providerFacilities: ["provider-default-context"],
        },
      };
      const capabilityFile = path.join(sessionRoot, "capabilities.json");
      writeFileSync(
        capabilityFile,
        canonicalJsonBytes({
          schemaVersion: 1,
          receipt: capabilityReceipt,
          receiptSha256: sha256Hex(canonicalJsonBytes(capabilityReceipt)),
        }),
      );
      const preparation = spawnSync(
        process.execPath,
        [
          path.join(
            checkout,
            "src/defining-concepts/evals/assurance/v1/run-evaluation-session.mjs",
          ),
          "prepare",
          "--case-file",
          caseFile,
          "--destination",
          destination,
          "--working-dir",
          work,
          "--arm",
          "no-skill",
          "--repetition",
          "1",
          "--provider",
          "antigravity",
          "--model",
          "gemini-3.5-flash-low",
          "--effort",
          "low",
          "--execution-timeout-ms",
          "10000",
          "--capability-reconciliation-file",
          capabilityFile,
          "--execution-mode",
          executionMode,
          "--antigravity-command",
          process.execPath,
          "--antigravity-prefix-arg",
          fakeProvider,
          "--antigravity-prefix-arg",
          "--record-file",
          "--antigravity-prefix-arg",
          recordFile,
        ],
        { encoding: "utf8", timeout: 20000, windowsHide: true },
      );
      assert.equal(preparation.status, 0, preparation.stderr);
    }
    const preparedPacket = JSON.parse(
      readFileSync(path.join(destination, "packet.json")),
    );
    writeFileSync(
      authPath,
      canonicalJsonBytes({
        schemaVersion: 1,
        decision: "authorized",
        statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
        allowExternalModel: true,
        provider: "google",
        model: preparedPacket.transmission.model,
        effort: "low",
        transmissionSha256: preparedPacket.transmissionSha256,
      }),
    );
    const directExecutor =
      skillName === "committing-to-git"
        ? executePreparedEvaluationSession
        : skillName === "naming-objects-in-software-engineering"
          ? (
              await load(
                "src/naming-objects-in-software-engineering/evals/assurance/v1/profile.mjs",
              )
            ).executePreparedNamingSession
          : (
              await load(
                "src/defining-concepts/evals/assurance/v1/run-evaluation-session.mjs",
              )
            ).executePreparedDefiningSession;
    const before = readFileSync(recordFile);
    if (executionMode === "skill-up") {
      await assert.rejects(
        dispatchPreparedSession({
          preparedSession: destination,
          authorizationFile: authPath,
          allowExternalModelCall: false,
          direct: directExecutor,
        }),
        /literally true/u,
      );
      await assert.rejects(
        dispatchPreparedSession({
          preparedSession: destination,
          authorizationFile: authPath,
          allowExternalModelCall: true,
          timeoutMs: 1,
          direct: directExecutor,
        }),
        /packet-bound/u,
      );
      assert.deepEqual(readFileSync(recordFile), before);
    }
    let executed;
    if (skillName === "naming-objects-in-software-engineering") {
      const requestPath = path.join(sessionRoot, "run-request.json");
      writeFileSync(
        requestPath,
        canonicalJsonBytes({
          preparedSession: destination,
          authorizationFile: authPath,
          allowExternalModelCall: true,
        }),
      );
      const execution = spawnSync(
        process.execPath,
        [
          path.join(
            checkout,
            "src/naming-objects-in-software-engineering/evals/assurance/v1/evaluation-runner.mjs",
          ),
          "run",
          requestPath,
        ],
        { encoding: "utf8", timeout: 45000, windowsHide: true },
      );
      assert.equal(execution.status, 0, execution.stderr);
      executed = JSON.parse(execution.stdout);
    } else
      executed = await dispatchPreparedSession({
        preparedSession: destination,
        authorizationFile: authPath,
        allowExternalModelCall: true,
        direct: directExecutor,
      });
    assert.equal(executed.status, "completed", JSON.stringify(executed));
    const providerRecords = readFileSync(recordFile, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(
      providerRecords.filter(({ mode }) => mode === "model").length,
      1,
    );
    assert.equal(
      providerRecords.filter(({ mode }) => mode === "input").length,
      skillName === "committing-to-git" ? 1 : 2,
    );
    dispatchResults[skillName].push({
      status: executed.status,
      closure: executed.closure.status,
      inputs: providerRecords
        .filter(({ mode }) => mode === "input")
        .map(({ message }) => message),
      caseId: preparedPacket.transmission.session.caseId,
      arm: preparedPacket.transmission.session.arm,
    });
    if (executionMode === "skill-up") {
      await assert.rejects(
        dispatchPreparedSession({
          preparedSession: destination,
          authorizationFile: authPath,
          allowExternalModelCall: true,
          direct() {
            assert.fail("No direct fallback");
          },
        }),
        /EEXIST|already/u,
      );
      assert.deepEqual(
        readFileSync(recordFile),
        Buffer.from(
          providerRecords.map((value) => JSON.stringify(value)).join("\n") +
            "\n",
        ),
      );
    }
  }
  assert.deepEqual(
    dispatchResults[skillName][0],
    dispatchResults[skillName][1],
  );
}
writeFileSync(
  path.join(root, "dispatch-equivalence.json"),
  canonicalJsonBytes(dispatchResults),
);

// Git's fixture/controller path is separate from the text-only policy profile.
const { initializeEvaluationHomes } = await load(
  "scripts/evaluation/evaluation-homes.js",
);
const { inspectCodexAppServerToolchain } = await load(
  "scripts/evaluation/codex-app-server.js",
);
const { prepareEvaluationSession } = await load(
  "src/committing-to-git/evals/assurance/v1/evaluation-runner.mjs",
);
const gitControllerResults = [];
for (const executionMode of ["direct", "skill-up"]) {
  const sessionRoot = path.join(root, `git-controller-${executionMode}`);
  mkdirSync(sessionRoot);
  const homes = path.join(sessionRoot, "homes");
  await initializeEvaluationHomes({ root: homes });
  const toolchain = await inspectCodexAppServerToolchain({
    command: process.execPath,
    prefixArguments: [
      path.join(
        repository,
        "tests/committing-to-git/fixtures/fake-app-server.mjs",
      ),
    ],
    scratchRoot: path.join(sessionRoot, "inspection"),
    environment,
  });
  const dispatchCarrier = prepareSessionDispatch({
    executionMode,
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
    destination: path.join(sessionRoot, "prepared"),
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
    seed: "controller-equivalence",
    sequence: 1,
    sourceCommit: null,
    toolchain,
    consumerProjectionSha256: dispatchCarrier?.projectionReceiptSha256,
  });
  retainSessionDispatch({
    preparedSession: prepared.preparedSession,
    carrier: dispatchCarrier,
    packet: prepared.packet,
  });
  const authPath = path.join(sessionRoot, "authorization.json");
  writeFileSync(
    authPath,
    canonicalJsonBytes({
      schemaVersion: 1,
      decision: "authorized",
      statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
      allowExternalModel: true,
      provider: "openai",
      model: "gpt-5.6-luna",
      effort: "low",
      transmissionSha256: prepared.packet.transmissionSha256,
    }),
  );
  let result;
  const dispatchStarted = Date.now();
  try {
    result = await dispatchPreparedSession({
      preparedSession: prepared.preparedSession,
      authorizationFile: authPath,
      allowExternalModelCall: true,
      direct: executePreparedEvaluationSession,
    });
  } catch (error) {
    // CI artifact upload omits hidden home journals. Retain only phase/timing
    // observations from this disposable fake-provider fixture, never auth bytes.
    try {
      const diagnostic = {
        tag: "git-controller-dispatch-failure",
        executionMode,
        elapsedMs: Date.now() - dispatchStarted,
        error: String(error?.message ?? error),
        homeJournals: [],
      };
      for (const directory of [".leases", ".history"]) {
        const journalRoot = path.join(homes, directory);
        if (!existsSync(journalRoot)) continue;
        for (const entry of readdirSync(journalRoot, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const journalPath = path.join(
            journalRoot,
            entry.name,
            "journal.jsonl",
          );
          if (!existsSync(journalPath)) continue;
          const phases = readFileSync(journalPath, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              try {
                const { phase, timestamp } = JSON.parse(line);
                return { phase, timestamp };
              } catch {
                return { phase: "incomplete-journal-line" };
              }
            });
          diagnostic.homeJournals.push({ directory, name: entry.name, phases });
        }
      }
      writeFileSync(
        path.join(sessionRoot, "dispatch-failure.json"),
        canonicalJsonBytes(diagnostic),
      );
      process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
    } catch {
      // Cleanup may race with journal reads. Never replace the dispatch failure
      // with a diagnostic read, serialization or write error.
    }
    throw error;
  }
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.suiteResult.commitAuthorization.status, "sent");
  gitControllerResults.push({
    status: result.status,
    closure: result.closure.status,
    authorization: result.suiteResult.commitAuthorization.status,
    caseId: prepared.packet.transmission.session.caseId,
    arm: prepared.packet.transmission.session.arm,
  });
}
assert.deepEqual(gitControllerResults[0], gitControllerResults[1]);
writeFileSync(
  path.join(root, "git-controller-equivalence.json"),
  canonicalJsonBytes(gitControllerResults),
);
