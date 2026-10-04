import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  writeFile,
  link,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  initializeEvaluationHomes,
  inspectEvaluationHomes,
  withEvaluationHome,
  prepareEvaluationHomeRecovery,
  applyEvaluationHomeRecovery,
} from "../../scripts/evaluation/evaluation-homes.js";
import {
  prepareProcessHost,
  processHostAssociation,
  runProcessHost,
} from "../../scripts/evaluation/process-host.js";
import {
  canonicalJsonBytes,
  createTransmissionPacket,
  EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  prepareEvidenceSession,
} from "../../scripts/evaluation/runtime.js";
import { runEvaluationHomesCli } from "../../scripts/evaluation/manage-evaluation-homes.js";

const windows = process.platform === "win32";
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const write = (file, value) => writeFileSync(file, canonicalJsonBytes(value));
const suiteRoot = windows
  ? await mkdtemp(join(tmpdir(), "evaluation-recovery-contract-"))
  : null;
if (suiteRoot)
  process.stdout.write(
    `${JSON.stringify({ recoveryFixtures: suiteRoot, retention: "fault/recovery proof; reassess 2026-10-12" })}\n`,
  );

// Native Windows attestation is exercised by the integrated test. These isolated
// filesystem cases use a port for the already-attested fixed local drive, keeping
// actual directory/file identities, links, renames and credential handling real.
function dependencies(failAfterPhase = null) {
  return {
    clock: () => new Date().toISOString(),
    randomBytes,
    failAfterPhase,
    async pathMetadata(target) {
      const stats = await lstat(target).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      return {
        schemaVersion: 1,
        exists: stats !== null,
        fullPath: resolve(target),
        isDirectory: stats?.isDirectory() ?? false,
        redirected: stats?.isSymbolicLink() ?? false,
        volume: {
          identity: parse(resolve(target)).root.toLowerCase(),
          kind: "local",
        },
      };
    },
  };
}

async function fixture(existingHomes = null, complete = false) {
  const root = await mkdtemp(join(suiteRoot, "case-"));
  const homes = existingHomes ?? join(root, "homes");
  await initializeEvaluationHomes({ root: homes });
  const credential = Buffer.from("synthetic credential, never a real token");
  if (!existsSync(join(homes, "execution/auth.json")))
    await writeFile(join(homes, "execution/auth.json"), credential);
  const preparedSession = join(root, "prepared");
  const consumerRoot = join(root, "consumer");
  await mkdir(consumerRoot);
  const settings = canonicalJsonBytes({ evaluationHomesRoot: homes }).toString(
    "utf8",
  );
  const { sha256Hex } = await import("../../scripts/evaluation/runtime.js");
  const packet = createTransmissionPacket({
    suite: "defining-concepts",
    session: {
      preparedSessionId: randomBytes(16).toString("hex"),
      caseId: "recovery",
      suiteArtifacts: [],
    },
    provider: "openai",
    model: "gpt-5.6-luna",
    effort: "low",
    transport: "codex-app-server",
    toolchain: { protocol: "app-server-v2", version: "synthetic" },
    runtimeFingerprint: { fixture: "real lifecycle, synthetic provider" },
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
      stableHome: { root: homes, role: "execution" },
      environment: { values: {}, secretSources: [] },
    },
    harnessControlledInputs: [
      {
        id: "runner-settings",
        role: "base",
        mediaType: "application/json",
        encoding: "utf8",
        content: settings,
        byteLength: Buffer.byteLength(settings),
        sha256: sha256Hex(Buffer.from(settings)),
      },
    ],
    continuationPolicy: {
      controllerSha256: "1".repeat(64),
      maxTurns: 1,
      allowedTransitions: [],
      templates: [],
    },
  });
  await prepareEvidenceSession({
    destination: preparedSession,
    packet,
    inputs: [
      {
        id: "runner-settings",
        mediaType: "application/json",
        bytes: Buffer.from(settings),
      },
    ],
  });
  const identity = prepareProcessHost();
  const controlPath = join(consumerRoot, "execution-index.json");
  const control = {
    schemaVersion: 1,
    preparedSession,
    consumerRoot,
    transmissionSha256: packet.transmissionSha256,
    evidenceLayout: "legacy-v1",
    processHost: identity,
    executableSha256: sha256Hex(readFileSync(process.execPath)),
  };
  write(controlPath, control);
  const authorization = {
    schemaVersion: 1,
    decision: "authorized",
    allowExternalModel: true,
    statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
    provider: "openai",
    model: "gpt-5.6-luna",
    effort: "low",
    transmissionSha256: packet.transmissionSha256,
  };
  const requestPath = join(root, "request.json");
  write(requestPath, { root, homes, controlPath, authorization, complete });
  const resultPath = join(consumerRoot, "process-host-observation.json");
  const result = await runProcessHost({
    identity,
    executable: process.execPath,
    argv: [
      resolve("tests/fixtures/evaluation-contracts/windows-recovery-lease.mjs"),
      requestPath,
    ],
    cwd: root,
    env: { ...process.env },
    timeoutMs: 10000,
    resultPath,
    association: processHostAssociation(controlPath, control),
  });
  if (complete) {
    assert.equal(result.error, null, JSON.stringify(result));
    assert.equal(result.status, 0);
    assert.equal(json(join(preparedSession, "run.json")).status, "completed");
    return { root, homes, preparedSession, result };
  }
  assert.ok(existsSync(join(root, "barrier.json")), JSON.stringify(result));
  assert.ok(result.error); // Host death is a failed invocation even with proof.
  assert.equal(result.closure?.activeProcesses, 0);
  const leasePath = join(homes, ".leases/execution.lock");
  const leaseBytes = readFileSync(join(leasePath, "lease.json"));
  const journalBytes = readFileSync(join(leasePath, "journal.jsonl"));
  const attemptBytes = readFileSync(join(preparedSession, "attempt.json"));
  const preflightMarker = readFileSync(
    join(homes, "preflight/.evaluation-home-owner.json"),
  );
  const proposal = await prepareEvaluationHomeRecovery({
    root: homes,
    role: "execution",
    testDependencies: dependencies(),
  });
  assert.equal(proposal.status, "eligible", JSON.stringify(proposal));
  return {
    root,
    homes,
    preparedSession,
    consumerRoot,
    resultPath,
    leasePath,
    leaseBytes,
    journalBytes,
    attemptBytes,
    credential,
    preflightMarker,
    proposal,
  };
}

const apply = (value, proposal = value.proposal, options = {}) =>
  applyEvaluationHomeRecovery({
    proposal,
    confirmRoot: value.homes,
    confirmRole: "execution",
    stateDigest: proposal.stateDigest,
    resume: proposal.mode === "resume",
    testDependencies: dependencies(),
    ...options,
  });
async function assertPreserved(value, location = value.leasePath) {
  assert.deepEqual(
    await readFile(join(location, "lease.json")),
    value.leaseBytes,
  );
  assert.deepEqual(
    await readFile(join(location, "journal.jsonl")),
    value.journalBytes,
  );
  assert.deepEqual(
    await readFile(join(value.preparedSession, "attempt.json")),
    value.attemptBytes,
  );
  assert.equal(existsSync(join(value.preparedSession, "run.json")), false);
  assert.deepEqual(
    await readFile(join(value.homes, "preflight/.evaluation-home-owner.json")),
    value.preflightMarker,
  );
}

test(
  "recovery requires exact confirmation and stale state never mutates the role",
  { skip: !windows, timeout: 20000 },
  async () => {
    const value = await fixture();
    for (const override of [
      { confirmRoot: value.root },
      { confirmRole: "preflight" },
      { stateDigest: "0".repeat(64) },
      { resume: true },
    ]) {
      await assert.rejects(
        apply(value, value.proposal, override),
        /recovery-confirmation-invalid/u,
      );
      await assertPreserved(value);
    }
    await writeFile(
      join(value.homes, "execution/new-file"),
      "unexpected writer",
    );
    await assert.rejects(apply(value), /recovery-state-stale/u);
    assert.equal(existsSync(join(value.leasePath, "recovery")), false);
    await assertPreserved(value);
  },
);

test(
  "exclusive recovery contention has one winner and retains original evidence",
  { skip: !windows, timeout: 20000 },
  async () => {
    const value = await fixture();
    const results = await Promise.allSettled([apply(value), apply(value)]);
    assert.equal(
      results.filter(({ status }) => status === "fulfilled").length,
      1,
    );
    assert.match(
      results.find(({ status }) => status === "rejected").reason.message,
      /recovery-contended|recovery-state-stale/u,
    );
    const receipt = results.find(({ status }) => status === "fulfilled").value;
    await assertPreserved(value, receipt.historyPath);
    assert.deepEqual(
      await readFile(join(value.homes, "execution/auth.json")),
      value.credential,
    );
    assert.equal(
      await readFile(join(receipt.retainedUsedPath, "runtime-residue"), "utf8"),
      "preserve in retained used generation",
    );
    const fresh = await fixture(value.homes, true);
    assert.notEqual(fresh.preparedSession, value.preparedSession);
    assert.notEqual(
      json(join(fresh.preparedSession, "attempt.json")).transmissionSha256,
      json(join(value.preparedSession, "attempt.json")).transmissionSha256,
    );
    await assertPreserved(value, receipt.historyPath);
    assert.equal(
      existsSync(join(value.homes, ".leases/execution.lock")),
      false,
    );
  },
);

test(
  "a live recovery owner blocks new preparation until its exact operation ends",
  { skip: !windows, timeout: 20000 },
  async () => {
    const value = await fixture();
    let reached;
    const barrier = new Promise((done) => {
      reached = done;
    });
    let release;
    const wait = new Promise((done) => {
      release = done;
    });
    const running = apply(value, value.proposal, {
      testDependencies: dependencies(async (phase) => {
        if (phase === "recovery-before-rotate") {
          reached();
          await wait;
        }
      }),
    });
    await barrier;
    try {
      const blocked = await prepareEvaluationHomeRecovery({
        root: value.homes,
        role: "execution",
        testDependencies: dependencies(),
      });
      assert.equal(blocked.status, "blocked");
      assert.equal(blocked.reason, "recovery-owner-active");
      await assert.rejects(apply(value), /recovery-state-stale/u);
      await assertPreserved(value);
    } finally {
      release();
    }
    const receipt = await running;
    await assertPreserved(value, receipt.historyPath);
  },
);

test(
  "hard death of the exact recovery owner permits a newly bound explicit resume",
  { skip: !windows, timeout: 30000 },
  async () => {
    const value = await fixture();
    const barrierPath = join(value.root, "recovery-barrier.json");
    const requestPath = join(value.root, "apply-request.json");
    write(requestPath, {
      proposal: value.proposal,
      phase: "recovery-published-before-observation",
      barrierPath,
    });
    const child = spawn(
      process.execPath,
      [
        resolve(
          "tests/fixtures/evaluation-contracts/windows-recovery-apply.mjs",
        ),
        requestPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    const closed = new Promise((done) => child.once("close", done));
    let diagnostics = "";
    child.stderr.on("data", (bytes) => {
      diagnostics += bytes;
    });
    try {
      const deadline = Date.now() + 15000;
      while (!existsSync(barrierPath)) {
        assert.equal(child.exitCode, null, diagnostics);
        assert.ok(Date.now() < deadline, diagnostics);
        await delay(20);
      }
      assert.equal(json(barrierPath).pid, child.pid);
      const live = await prepareEvaluationHomeRecovery({
        root: value.homes,
        role: "execution",
        testDependencies: dependencies(),
      });
      assert.equal(live.reason, "recovery-owner-active");
      child.kill("SIGKILL");
      await closed;
      assert.equal(
        existsSync(join(value.leasePath, "recovery/owner-1.closed.json")),
        false,
      );
      const resume = await prepareEvaluationHomeRecovery({
        root: value.homes,
        role: "execution",
        testDependencies: dependencies(),
      });
      assert.equal(resume.status, "eligible", JSON.stringify(resume));
      assert.equal(resume.nextOwnerAttempt, 2);
      const receipt = await apply(value, resume);
      await assertPreserved(value, receipt.historyPath);
      assert.deepEqual(
        await readFile(join(value.homes, "execution/auth.json")),
        value.credential,
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  },
);

test(
  "recovery never selects between conflicting credential caches",
  { skip: !windows, timeout: 20000 },
  async () => {
    const value = await fixture();
    await assert.rejects(
      apply(value, value.proposal, {
        testDependencies: dependencies(async (phase) => {
          if (phase === "recovery-published-before-observation") {
            await writeFile(
              join(value.homes, "execution/auth.json"),
              "conflicting synthetic cache",
            );
            throw new Error("injected collision");
          }
        }),
      }),
      /injected collision/u,
    );
    const refused = await prepareEvaluationHomeRecovery({
      root: value.homes,
      role: "execution",
      testDependencies: dependencies(),
    });
    assert.equal(refused.status, "unknown");
    assert.equal(refused.reason, "credential-cache-collision");
    assert.deepEqual(
      await readFile(join(value.proposal.state.usedPath, "auth.json")),
      value.credential,
    );
    assert.equal(
      await readFile(join(value.homes, "execution/auth.json"), "utf8"),
      "conflicting synthetic cache",
    );
    await assertPreserved(value);
  },
);

test(
  "a substituted fresh generation cannot receive the retained credential",
  { skip: !windows, timeout: 20000 },
  async () => {
    const value = await fixture();
    await assert.rejects(
      apply(value, value.proposal, {
        testDependencies: dependencies(async (phase) => {
          if (phase === "recovery-credential-intent") {
            const markerPath = join(
              value.homes,
              "execution/.evaluation-home-owner.json",
            );
            const marker = json(markerPath);
            marker.generationNonce = "f".repeat(32);
            write(markerPath, marker);
          }
        }),
      }),
      /recovery-home-drift/u,
    );
    assert.deepEqual(
      await readFile(join(value.proposal.state.usedPath, "auth.json")),
      value.credential,
    );
    assert.equal(existsSync(join(value.homes, "execution/auth.json")), false);
    await assertPreserved(value);
  },
);

for (const mutation of ["outcome", "recovery-journal"]) {
  test(
    `changed ${mutation} blocks credential movement at the operation boundary`,
    { skip: !windows, timeout: 20000 },
    async () => {
      const value = await fixture();
      await assert.rejects(
        apply(value, value.proposal, {
          testDependencies: dependencies((phase) => {
            if (phase !== "recovery-credential-intent") return;
            if (mutation === "outcome")
              write(join(value.root, "prepared/run.json"), {
                unexpected: true,
              });
            else
              writeFileSync(
                join(value.leasePath, "recovery/journal.jsonl"),
                "altered\n",
              );
          }),
        }),
        /recovery-(?:plan|evidence)-drift/u,
      );
      assert.deepEqual(
        await readFile(join(value.proposal.state.usedPath, "auth.json")),
        value.credential,
      );
      assert.equal(existsSync(join(value.homes, "execution/auth.json")), false);
    },
  );
}

test(
  "unmarked partial replacement stays unknown with every original resource retained",
  { skip: !windows, timeout: 20000 },
  async () => {
    const value = await fixture();
    await assert.rejects(
      apply(value, value.proposal, {
        testDependencies: dependencies((phase) => {
          if (phase === "recovery-directory-created-before-marker")
            throw new Error("injected unmarked create");
        }),
      }),
      /injected unmarked create/u,
    );
    const proposal = await prepareEvaluationHomeRecovery({
      root: value.homes,
      role: "execution",
      testDependencies: dependencies(),
    });
    assert.equal(proposal.status, "unknown");
    assert.equal(
      existsSync(
        join(value.proposal.state.stagingPath, ".evaluation-home-owner.json"),
      ),
      false,
    );
    assert.deepEqual(
      await readFile(join(value.proposal.state.usedPath, "auth.json")),
      value.credential,
    );
    await assertPreserved(value);
  },
);

test(
  "archival is terminal even if the caller dies before receiving the receipt",
  { skip: !windows, timeout: 20000 },
  async () => {
    const value = await fixture();
    await assert.rejects(
      apply(value, value.proposal, {
        testDependencies: dependencies((phase) => {
          if (phase === "recovery-archived-before-return")
            throw new Error("injected after archive");
        }),
      }),
      /injected after archive/u,
    );
    assert.equal(existsSync(value.leasePath), false);
    await assertPreserved(value, value.proposal.state.historyPath);
    const inventory = await inspectEvaluationHomes({
      root: value.homes,
      testDependencies: dependencies(),
    });
    assert.equal(inventory.recoveredHistory.length, 1);
    assert.equal(inventory.completedHistory.length, 0);
  },
);

test(
  "the CLI saves a private proposal and requires its exact digest for application",
  { skip: !windows, timeout: 25000 },
  async () => {
    const value = await fixture();
    const proposalPath = join(value.root, "operator-proposal.json");
    async function invoke(args) {
      let stdout = "";
      let stderr = "";
      const code = await runEvaluationHomesCli({
        argv: args,
        stdout: {
          write: (text) => {
            stdout += text;
          },
        },
        stderr: {
          write: (text) => {
            stderr += text;
          },
        },
      });
      return { code, stdout, stderr };
    }
    const prepared = await invoke([
      "prepare-recovery",
      "--root",
      value.homes,
      "--role",
      "execution",
      "--proposal",
      proposalPath,
    ]);
    assert.equal(prepared.code, 0, prepared.stderr);
    const proposal = json(proposalPath);
    assert.equal(proposal.status, "eligible");
    await assertPreserved(value);
    const missing = await invoke([
      "apply-recovery",
      "--root",
      value.homes,
      "--role",
      "execution",
      "--proposal",
      proposalPath,
    ]);
    assert.equal(missing.code, 2);
    assert.equal(existsSync(join(value.leasePath, "recovery")), false);
    const applied = await invoke([
      "apply-recovery",
      "--root",
      value.homes,
      "--role",
      "execution",
      "--confirm-root",
      value.homes,
      "--confirm-role",
      "execution",
      "--proposal",
      proposalPath,
      "--state-digest",
      proposal.stateDigest,
    ]);
    assert.equal(applied.code, 0, applied.stderr);
    assert.equal(JSON.parse(applied.stdout).status, "recovered");
    await assertPreserved(value, value.proposal.state.historyPath);
  },
);

for (const phase of [
  "recovery-acquired",
  "recovery-before-rotate",
  "recovery-rotated-before-observation",
  "recovery-before-create",
  "recovery-created-before-observation",
  "recovery-before-publish",
  "recovery-published-before-observation",
  "recovery-before-credential-transfer",
  "recovery-transferred-before-observation",
  "recovery-before-seal",
  "recovery-sealed-before-observation",
  "recovery-before-archive",
]) {
  test(
    `recovery resumes exact interruption: ${phase}`,
    { skip: !windows, timeout: 20000 },
    async () => {
      const value = await fixture();
      await assert.rejects(
        apply(value, value.proposal, {
          testDependencies: dependencies((observed) => {
            if (observed === phase) throw new Error(`injected ${phase}`);
          }),
        }),
        /injected/u,
      );
      await assertPreserved(value);
      const resume = await prepareEvaluationHomeRecovery({
        root: value.homes,
        role: "execution",
        testDependencies: dependencies(),
      });
      assert.equal(resume.status, "eligible", JSON.stringify(resume));
      assert.equal(resume.mode, "resume");
      assert.notEqual(resume.stateDigest, value.proposal.stateDigest);
      await assert.rejects(apply(value), /recovery-state-stale/u);
      const receipt = await apply(value, resume);
      await assertPreserved(value, receipt.historyPath);
      assert.deepEqual(
        await readFile(join(value.homes, "execution/auth.json")),
        value.credential,
      );
      const inventory = await inspectEvaluationHomes({
        root: value.homes,
        testDependencies: dependencies(),
      });
      assert.equal(inventory.recoveredHistory.length, 1);
      assert.equal(inventory.completedHistory.length, 0);
      assert.equal(inventory.liveLeases.length, 0);
    },
  );
}

for (const corruption of [
  "forged-zero",
  "truncated-proof",
  "wrong-key",
  "changed-ready",
  "wrong-token",
  "wrong-job",
  "missing-attempt",
  "reparse-home",
  "hardlink-cache",
]) {
  test(
    `recovery refuses ambiguous or altered state: ${corruption}`,
    { skip: !windows, timeout: 20000 },
    async () => {
      const value = await fixture();
      if (corruption === "forged-zero") {
        const proof = json(`${value.resultPath}.closure.json`);
        proof.totalProcesses += 1;
        write(`${value.resultPath}.closure.json`, proof);
      } else if (corruption === "truncated-proof")
        writeFileSync(`${value.resultPath}.closure.json`, '{"schemaVersion":2');
      else if (corruption === "wrong-key") {
        const proof = json(`${value.resultPath}.closure.json`);
        proof.binding.publicKey.n = "A".repeat(342);
        write(`${value.resultPath}.closure.json`, proof);
      } else if (corruption === "changed-ready")
        writeFileSync(`${value.resultPath}.ready.json`, "{}\n");
      else if (corruption === "wrong-token") {
        const lease = json(join(value.leasePath, "lease.json"));
        lease.leaseToken = "1".repeat(32);
        write(join(value.leasePath, "lease.json"), lease);
      } else if (corruption === "wrong-job") {
        const proof = json(`${value.resultPath}.closure.json`);
        proof.binding.jobName =
          "Local\\HaddenEvaluation-00000000-0000-0000-0000-000000000000";
        write(`${value.resultPath}.closure.json`, proof);
      } else if (corruption === "missing-attempt")
        await rename(
          join(value.preparedSession, "attempt.json"),
          join(value.root, "retained-attempt.json"),
        );
      else if (corruption === "reparse-home") {
        await rename(
          join(value.homes, "execution"),
          join(value.homes, "execution-moved"),
        );
        await symlink(
          join(value.homes, "execution-moved"),
          join(value.homes, "execution"),
          "junction",
        );
      } else if (corruption === "hardlink-cache")
        await link(
          join(value.homes, "execution/auth.json"),
          join(value.root, "cache-link"),
        );
      const refused = await prepareEvaluationHomeRecovery({
        root: value.homes,
        role: "execution",
        testDependencies: dependencies(),
      });
      assert.equal(refused.status, "unknown");
      await assert.rejects(apply(value), /recovery-/u);
      assert.equal(existsSync(join(value.leasePath, "recovery")), false);
      assert.equal(existsSync(join(value.preparedSession, "run.json")), false);
    },
  );
}

test(
  "legacy and preflight leases remain preserved and unavailable for recovery",
  { skip: !windows },
  async () => {
    const root = join(await mkdtemp(join(suiteRoot, "legacy-")), "homes");
    await initializeEvaluationHomes({ root, testDependencies: dependencies() });
    await assert.rejects(
      withEvaluationHome(
        {
          root,
          role: "execution",
          operationId: "a".repeat(32),
          testDependencies: dependencies(),
        },
        async () => {
          throw new Error("interrupted legacy");
        },
      ),
      /interrupted legacy/u,
    );
    const before = await readFile(
      join(root, ".leases/execution.lock/lease.json"),
    );
    const legacy = await prepareEvaluationHomeRecovery({
      root,
      role: "execution",
      testDependencies: dependencies(),
    });
    assert.equal(legacy.status, "unknown");
    assert.equal(legacy.reason, "unsupported-recovery-lease");
    const preflight = await prepareEvaluationHomeRecovery({
      root,
      role: "preflight",
      testDependencies: dependencies(),
    });
    assert.equal(preflight.status, "blocked");
    assert.deepEqual(
      await readFile(join(root, ".leases/execution.lock/lease.json")),
      before,
    );
  },
);
