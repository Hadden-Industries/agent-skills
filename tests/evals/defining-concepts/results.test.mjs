import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const resultsRoot = path.join(
  repositoryRoot,
  "evals",
  "defining-concepts",
  "results",
);

function readJson(...segments) {
  return JSON.parse(readFileSync(path.join(...segments), "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function resultDirectories() {
  return readdirSync(resultsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(path.join(resultsRoot, entry.name, "manifest.json")),
    )
    .map((entry) => path.join(resultsRoot, entry.name))
    .sort();
}

function resultSchemaKind(manifest) {
  if (Number.isSafeInteger(manifest?.schema_version)) {
    assert.ok(
      manifest.schema_version === 1 || manifest.schema_version === 2,
      `unsupported retained result schema ${manifest.schema_version}`,
    );
    return "legacy";
  }
  if (manifest?.schemaVersion === 2 || manifest?.schemaVersion === 3) {
    return "current";
  }
  throw new Error(
    "result artifact set must declare an explicitly supported result schema",
  );
}

function resultDirectoriesFor(kind) {
  return resultDirectories().filter(
    (directory) =>
      resultSchemaKind(readJson(directory, "manifest.json")) === kind,
  );
}

function currentSchemaFixture() {
  const caseBytes = Buffer.from(
    '{"id":1,"prompt":"Define distribution."}\n',
    "utf8",
  );
  const conversationBytes = Buffer.from(
    '{"turns":[{"id":"initial","prompt":"Define distribution."}]}\n',
    "utf8",
  );
  const currentBundleBytes = Buffer.from(
    '{"aggregateSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","schemaVersion":1}\n',
    "utf8",
  );
  const candidateBundleBytes = Buffer.from(
    '{"aggregateSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","schemaVersion":1}\n',
    "utf8",
  );
  const mappingBytes = Buffer.from(
    '{"schemaVersion":1,"seed":"fixture-seed","sessions":[]}\n',
    "utf8",
  );
  const capabilityReceipt = {
    schemaVersion: 1,
    suite: "defining-concepts",
    requiredCapabilities: ["bundled-skill-files"],
  };
  const capabilityReconciliation = {
    schemaVersion: 1,
    receipt: capabilityReceipt,
    receiptSha256: sha256(Buffer.from(JSON.stringify(capabilityReceipt))),
  };
  const capabilityBytes = Buffer.from(
    `${JSON.stringify(capabilityReconciliation)}\n`,
    "utf8",
  );
  const caseSha256 = sha256(caseBytes);
  const conversationSha256 = sha256(conversationBytes);
  const runtimeFingerprint = "c".repeat(64);
  const transmissions = {
    "blind-01": "d".repeat(64),
    "blind-02": "e".repeat(64),
    "blind-03": "f".repeat(64),
  };
  return {
    manifest: {
      schemaVersion: 3,
      suite: "defining-concepts",
      campaign: "calibration",
      state: "prepared",
      protocol: {
        caseIds: [1],
        arms: ["no-skill", "current-skill", "candidate-skill"],
        repetitionCount: 1,
        provider: "codex",
        model: "gpt-fixture",
        effort: "high",
      },
      capabilityReconciliation: {
        relativePath: "capability-reconciliation.json",
        receiptSha256: capabilityReconciliation.receiptSha256,
      },
      skillBundles: {
        currentSkill: {
          relativePath: "bundles/current-skill.json",
          aggregateSha256: "a".repeat(64),
          source: { kind: "git", revision: "1".repeat(40) },
          files: [{ path: "SKILL.md", byteLength: 12, sha256: "1".repeat(64) }],
        },
        candidateSkill: {
          relativePath: "bundles/candidate-skill.json",
          aggregateSha256: "b".repeat(64),
          source: { kind: "working-tree" },
          files: [{ path: "SKILL.md", byteLength: 13, sha256: "2".repeat(64) }],
        },
      },
      caseSnapshots: [
        {
          id: 1,
          relativePath: "cases/case-01.json",
          caseSha256,
          conversationSha256,
        },
      ],
      blindMappingSealSha256: sha256(mappingBytes),
      sessions: [
        ["blind-01", "no-skill"],
        ["blind-02", "current-skill"],
        ["blind-03", "candidate-skill"],
      ].map(([blindAlias, arm]) => ({
        blindAlias,
        caseId: 1,
        arm,
        repetition: 1,
        caseSha256,
        conversationSha256,
        provider: "codex",
        model: "gpt-fixture",
        effort: "high",
        runtimeFingerprint,
        capabilityReconciliationSha256: capabilityReconciliation.receiptSha256,
        transmissionSha256: transmissions[blindAlias],
        disposition: "prepared",
      })),
      limitations: {
        repeatedSampling: false,
        withinCellVarianceAvailable: false,
        humanUsabilityEvaluated: false,
      },
    },
    bytes: {
      caseBytes,
      conversationBytes,
      currentBundleBytes,
      candidateBundleBytes,
      capabilityBytes,
      mappingBytes,
    },
    execution: {
      schemaVersion: 1,
      capabilityReconciliationSha256: capabilityReconciliation.receiptSha256,
      sessions: [
        { blindAlias: "blind-01", disposition: "valid" },
        { blindAlias: "blind-02", disposition: "valid" },
        { blindAlias: "blind-03", disposition: "invalid" },
      ],
    },
    invalidAttempts: [
      { schemaVersion: 1, blindAlias: "blind-03", disposition: "invalid" },
    ],
  };
}

function validateResultArtifactSet({
  manifest,
  bytes,
  execution,
  invalidAttempts = [],
}) {
  if (resultSchemaKind(manifest) === "legacy") {
    assert.deepEqual(manifest.arms, ["with_skill", "without_skill"]);
    assert.equal(manifest.runs_per_configuration, 1);
    return "legacy";
  }

  if (manifest?.schemaVersion !== 2 && manifest?.schemaVersion !== 3) {
    throw new Error(
      "result artifact set must declare an explicitly supported result schema",
    );
  }

  assert.equal(manifest.suite, "defining-concepts");
  if (manifest.schemaVersion === 3) {
    const reconciliation = JSON.parse(bytes.capabilityBytes.toString("utf8"));
    assert.equal(reconciliation.schemaVersion, 1);
    assert.equal(
      reconciliation.receiptSha256,
      sha256(Buffer.from(JSON.stringify(reconciliation.receipt))),
    );
    assert.equal(
      manifest.capabilityReconciliation.receiptSha256,
      reconciliation.receiptSha256,
    );
  }
  assert.deepEqual(manifest.protocol.arms, [
    "no-skill",
    "current-skill",
    "candidate-skill",
  ]);
  assert.equal(manifest.protocol.repetitionCount, 1);
  for (const field of ["provider", "model", "effort"]) {
    assert.equal(typeof manifest.protocol[field], "string");
    assert.notEqual(manifest.protocol[field].trim(), "");
  }

  for (const [manifestKey, bytesKey] of [
    ["currentSkill", "currentBundleBytes"],
    ["candidateSkill", "candidateBundleBytes"],
  ]) {
    const bundle = manifest.skillBundles[manifestKey];
    assert.match(bundle.aggregateSha256, /^[0-9a-f]{64}$/u);
    assert.ok(Array.isArray(bundle.files) && bundle.files.length > 0);
    for (const file of bundle.files) {
      assert.match(file.sha256, /^[0-9a-f]{64}$/u);
      assert.ok(Number.isSafeInteger(file.byteLength) && file.byteLength >= 0);
    }
    const frozenBundle = JSON.parse(bytes[bytesKey].toString("utf8"));
    assert.equal(frozenBundle.schemaVersion, 1);
    assert.equal(frozenBundle.aggregateSha256, bundle.aggregateSha256);
  }

  assert.equal(manifest.caseSnapshots.length, manifest.protocol.caseIds.length);
  for (const snapshot of manifest.caseSnapshots) {
    assert.match(snapshot.caseSha256, /^[0-9a-f]{64}$/u);
    assert.match(snapshot.conversationSha256, /^[0-9a-f]{64}$/u);
    assert.equal(sha256(bytes.caseBytes), snapshot.caseSha256);
    assert.equal(sha256(bytes.conversationBytes), snapshot.conversationSha256);
  }
  assert.equal(sha256(bytes.mappingBytes), manifest.blindMappingSealSha256);

  assert.equal(manifest.sessions.length, manifest.protocol.arms.length);
  const sessionArms = new Set();
  for (const session of manifest.sessions) {
    sessionArms.add(session.arm);
    assert.equal(session.repetition, 1);
    assert.equal(session.caseSha256, manifest.caseSnapshots[0].caseSha256);
    assert.equal(
      session.conversationSha256,
      manifest.caseSnapshots[0].conversationSha256,
    );
    assert.equal(session.provider, manifest.protocol.provider);
    assert.equal(session.model, manifest.protocol.model);
    assert.equal(session.effort, manifest.protocol.effort);
    assert.match(session.runtimeFingerprint, /^[0-9a-f]{64}$/u);
    if (manifest.schemaVersion === 3) {
      assert.equal(
        session.capabilityReconciliationSha256,
        manifest.capabilityReconciliation.receiptSha256,
      );
    }
    assert.match(session.transmissionSha256, /^[0-9a-f]{64}$/u);
    assert.equal(session.disposition, "prepared");
  }
  assert.deepEqual(sessionArms, new Set(manifest.protocol.arms));

  assert.equal(execution.schemaVersion, 1);
  if (manifest.schemaVersion === 3) {
    assert.equal(
      execution.capabilityReconciliationSha256,
      manifest.capabilityReconciliation.receiptSha256,
    );
  }
  const dispositions = new Set();
  for (const session of execution.sessions) {
    assert.ok(
      session.disposition === "valid" || session.disposition === "invalid",
    );
    dispositions.add(session.disposition);
  }
  for (const attempt of invalidAttempts) {
    assert.equal(attempt.schemaVersion, 1);
    assert.equal(attempt.disposition, "invalid");
    dispositions.add(attempt.disposition);
  }
  assert.deepEqual(dispositions, new Set(["valid", "invalid"]));

  assert.deepEqual(manifest.limitations, {
    repeatedSampling: false,
    withinCellVarianceAvailable: false,
    humanUsabilityEvaluated: false,
  });
  return "current";
}

function retainedCases(resultDirectory) {
  const runsDirectory = path.join(resultDirectory, "runs");
  return readdirSync(runsDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(path.join(runsDirectory, entry.name, "case.json")),
    )
    .map((entry) => {
      const directory = path.join(runsDirectory, entry.name);
      const record = readJson(directory, "case.json");
      return {
        directory,
        evalId: record.id ?? record.eval_id,
        expectations: record.expectations ?? record.assertions,
        prompt: record.prompt,
      };
    })
    .sort((left, right) => left.evalId - right.evalId);
}

function validateCurrentResultDirectory(resultDirectory) {
  const manifestPath = path.join(resultDirectory, "manifest.json");
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(resultSchemaKind(manifest), "current");
  assert.equal(manifest.state, "prepared");
  assert.equal(manifest.directoryName, path.basename(resultDirectory));
  assert.equal(
    manifest.runIdentity.replaceAll(":", ""),
    manifest.directoryName,
  );
  assert.deepEqual(manifest.protocol.arms, [
    "no-skill",
    "current-skill",
    "candidate-skill",
  ]);
  assert.equal(manifest.protocol.repetitionCount, 1);
  assert.equal(
    manifest.sessions.length,
    manifest.protocol.caseIds.length * manifest.protocol.arms.length,
  );
  const capabilityAware = manifest.schemaVersion === 3;
  let capabilityReceiptSha256 = null;
  if (capabilityAware) {
    assert.deepEqual(manifest.capabilityReconciliation, {
      relativePath: "capability-reconciliation.json",
      receiptSha256: manifest.capabilityReconciliation.receiptSha256,
    });
    const reconciliation = readJson(
      resultDirectory,
      manifest.capabilityReconciliation.relativePath,
    );
    assert.equal(reconciliation.schemaVersion, 1);
    assert.equal(
      reconciliation.receiptSha256,
      sha256(Buffer.from(JSON.stringify(reconciliation.receipt))),
    );
    assert.equal(
      reconciliation.receiptSha256,
      manifest.capabilityReconciliation.receiptSha256,
    );
    assert.equal(reconciliation.receipt.suite, manifest.suite);
    assert.deepEqual(reconciliation.receipt.arms, manifest.protocol.arms);
    capabilityReceiptSha256 = reconciliation.receiptSha256;
  }

  for (const [manifestKey, fileName] of [
    ["currentSkill", "current-skill.json"],
    ["candidateSkill", "candidate-skill.json"],
  ]) {
    const declared = manifest.skillBundles[manifestKey];
    const retained = readJson(resultDirectory, "bundles", fileName);
    assert.equal(retained.aggregateSha256, declared.aggregateSha256);
    assert.deepEqual(
      retained.files.map(
        ({ path: filePath, byteLength, sha256: fileSha256 }) => ({
          path: filePath,
          byteLength,
          sha256: fileSha256,
        }),
      ),
      declared.files,
    );
    assert.deepEqual(retained.source, declared.source);
  }

  const caseSnapshots = new Map();
  for (const snapshot of manifest.caseSnapshots) {
    assert.ok(!caseSnapshots.has(snapshot.id));
    const retainedBytes = readFileSync(
      path.join(resultDirectory, ...snapshot.relativePath.split("/")),
    );
    assert.equal(sha256(retainedBytes), snapshot.caseSha256);
    assert.match(snapshot.conversationSha256, /^[0-9a-f]{64}$/u);
    caseSnapshots.set(snapshot.id, snapshot);
  }
  assert.deepEqual(
    [...caseSnapshots.keys()].sort((left, right) => left - right),
    [...manifest.protocol.caseIds].sort((left, right) => left - right),
  );

  const mappingBytes = readFileSync(
    path.join(resultDirectory, "sealed", "blind-mapping.json"),
  );
  assert.equal(sha256(mappingBytes), manifest.blindMappingSealSha256);

  const cells = new Set();
  const aliases = new Set();
  const transmissions = new Set();
  for (const session of manifest.sessions) {
    const cell = `${session.caseId}/${session.arm}/${session.repetition}`;
    assert.ok(!cells.has(cell));
    assert.ok(!aliases.has(session.blindAlias));
    assert.ok(!transmissions.has(session.transmissionSha256));
    cells.add(cell);
    aliases.add(session.blindAlias);
    transmissions.add(session.transmissionSha256);
    assert.equal(session.repetition, 1);
    assert.ok(manifest.protocol.arms.includes(session.arm));
    assert.equal(session.provider, manifest.protocol.provider);
    assert.equal(session.model, manifest.protocol.model);
    assert.equal(session.effort, manifest.protocol.effort);
    assert.equal(session.disposition, "prepared");
    assert.equal(
      session.caseSha256,
      caseSnapshots.get(session.caseId).caseSha256,
    );
    assert.equal(
      session.conversationSha256,
      caseSnapshots.get(session.caseId).conversationSha256,
    );
    assert.equal(typeof session.runtimeFingerprint, "object");
    assert.ok(Array.isArray(session.runtimeFingerprint.modules));
    if (capabilityAware) {
      assert.equal(
        session.capabilityReconciliationSha256,
        capabilityReceiptSha256,
      );
    }
    assert.match(session.transmissionSha256, /^[0-9a-f]{64}$/u);
    const packet = readJson(
      resultDirectory,
      ...session.relativeSessionPath.split("/"),
      "packet.json",
    );
    assert.equal(packet.transmissionSha256, session.transmissionSha256);
    if (capabilityAware) {
      assert.equal(
        packet.transmission.capabilityReconciliation.receiptSha256,
        capabilityReceiptSha256,
      );
      assert.deepEqual(
        packet.transmission.capabilities,
        packet.transmission.capabilityReconciliation.receipt
          .runtimeCapabilities,
      );
    }
  }

  assert.deepEqual(manifest.limitations, {
    repeatedSampling: false,
    withinCellVarianceAvailable: false,
    humanUsabilityEvaluated: false,
  });

  const preflightPath = path.join(resultDirectory, "preflight.json");
  const preflight = existsSync(preflightPath) ? readJson(preflightPath) : null;
  if (preflight !== null) {
    const selected = manifest.sessions.filter(({ sequence }) => sequence === 1);
    assert.equal(selected.length, 1);
    assert.equal(preflight.schemaVersion, 1);
    assert.equal(preflight.state, "preflighted");
    assert.equal(preflight.campaignManifestSha256, sha256(manifestBytes));
    assert.deepEqual(preflight.session, {
      blindAlias: selected[0].blindAlias,
      sequence: 1,
      transmissionSha256: selected[0].transmissionSha256,
      provider: selected[0].provider,
      model: selected[0].model,
      effort: selected[0].effort,
      ...(capabilityAware
        ? { capabilityReconciliationSha256: capabilityReceiptSha256 }
        : {}),
    });
    if (capabilityAware) {
      assert.equal(
        preflight.capabilityReconciliationSha256,
        capabilityReceiptSha256,
      );
    }
    assert.ok(
      preflight.status === "completed" || preflight.status === "failed",
    );
    assert.equal(preflight.status, preflight.result.status);
    assert.equal(preflight.modelTurns, preflight.result.modelTurns);
    if (preflight.status === "completed") {
      assert.equal(preflight.modelTurns, 0);
      assert.equal(preflight.failureClass, null);
      assert.equal(preflight.error, null);
    }
  }

  const executedPath = path.join(resultDirectory, "executed.json");
  const executionStartPath = path.join(resultDirectory, "execution-start.json");
  const executionFailedPath = path.join(
    resultDirectory,
    "execution-failed.json",
  );
  const gradingPreparedPath = path.join(
    resultDirectory,
    "grading-prepared.json",
  );
  const aggregatePath = path.join(resultDirectory, "aggregate.generated.json");
  if (!existsSync(executedPath)) {
    assert.equal(existsSync(gradingPreparedPath), false);
    assert.equal(existsSync(aggregatePath), false);
    if (existsSync(executionFailedPath)) {
      assert.equal(capabilityAware, true);
      assert.equal(existsSync(executionStartPath), true);
      const executionStart = readJson(executionStartPath);
      const executionFailed = readJson(executionFailedPath);
      assert.equal(executionStart.state, "execution-started");
      assert.equal(executionFailed.state, "execution-failed");
      assert.equal(
        executionStart.capabilityReconciliationSha256,
        capabilityReceiptSha256,
      );
      assert.equal(
        executionFailed.capabilityReconciliationSha256,
        capabilityReceiptSha256,
      );
      assert.equal(
        executionFailed.executionStartSha256,
        sha256(Buffer.from(JSON.stringify(executionStart))),
      );
      return "execution-failed";
    }
    if (existsSync(executionStartPath)) {
      assert.equal(capabilityAware, true);
      return "execution-started";
    }
    return preflight === null
      ? "prepared"
      : preflight.status === "completed"
        ? "preflighted"
        : "preflight-failed";
  }

  if (preflight !== null) assert.equal(preflight.status, "completed");

  const executed = readJson(executedPath);
  assert.equal(executed.schemaVersion, 1);
  assert.equal(executed.state, "executed");
  assert.equal(executed.campaignManifestSha256, sha256(manifestBytes));
  if (capabilityAware) {
    assert.equal(existsSync(executionStartPath), true);
    assert.equal(existsSync(executionFailedPath), false);
    const executionStart = readJson(executionStartPath);
    assert.equal(
      executionStart.capabilityReconciliationSha256,
      capabilityReceiptSha256,
    );
    assert.equal(
      executed.capabilityReconciliationSha256,
      capabilityReceiptSha256,
    );
    assert.equal(
      executed.executionStartSha256,
      sha256(Buffer.from(JSON.stringify(executionStart))),
    );
    assert.equal(
      executed.authorizationSetSha256,
      executionStart.authorizationSetSha256,
    );
  }
  assert.equal(executed.sessions.length, manifest.sessions.length);
  assert.deepEqual(
    new Set(executed.sessions.map(({ blindAlias }) => blindAlias)),
    aliases,
  );
  for (const session of executed.sessions) {
    assert.ok(session.status === "completed" || session.status === "failed");
    assert.equal(
      session.disposition,
      session.status === "completed" ? "valid" : "invalid",
    );
  }

  const invalidSessions = executed.sessions.filter(
    ({ disposition }) => disposition === "invalid",
  );
  const invalidAttemptsDirectory = path.join(
    resultDirectory,
    "invalid-attempts",
  );
  const invalidAttempts = existsSync(invalidAttemptsDirectory)
    ? readdirSync(invalidAttemptsDirectory, { withFileTypes: true }).filter(
        (entry) => entry.isDirectory(),
      )
    : [];
  assert.equal(invalidAttempts.length, invalidSessions.length);
  if (invalidSessions.length > 0) {
    assert.equal(existsSync(gradingPreparedPath), false);
    assert.equal(existsSync(aggregatePath), false);
    return "executed-invalid";
  }

  if (!existsSync(gradingPreparedPath)) {
    assert.equal(existsSync(aggregatePath), false);
    return "executed";
  }
  const gradingPrepared = readJson(gradingPreparedPath);
  assert.equal(gradingPrepared.state, "grading-prepared");
  if (!existsSync(aggregatePath)) {
    return "grading-prepared";
  }
  const aggregate = readJson(aggregatePath);
  assert.equal(aggregate.state, "graded");
  return "graded";
}

test("all retained legacy manifests bind the exact prompts used by successful runs", () => {
  const directories = resultDirectoriesFor("legacy");
  assert.ok(directories.length > 0, "expected at least one retained run set");

  for (const resultDirectory of directories) {
    const manifest = readJson(resultDirectory, "manifest.json");
    assert.equal(manifest.run_set_id, path.basename(resultDirectory));

    const cases = retainedCases(resultDirectory);
    assert.deepEqual(
      cases.map(({ evalId }) => evalId),
      manifest.calibration_eval_ids,
    );

    for (const retainedCase of cases) {
      const expectedDigest =
        manifest.prompt_sha256[String(retainedCase.evalId)];
      assert.match(expectedDigest, /^[0-9a-f]{64}$/u);
      assert.equal(
        sha256(`${retainedCase.prompt}\n`),
        expectedDigest,
        `case ${retainedCase.evalId} prompt bytes must match the manifest`,
      );

      for (const arm of ["with-skill", "without-skill"]) {
        for (
          let repetition = 1;
          repetition <= manifest.runs_per_configuration;
          repetition += 1
        ) {
          const run = readJson(
            retainedCase.directory,
            arm,
            `repetition-${String(repetition).padStart(2, "0")}`,
            "run.json",
          );
          assert.equal(run.status, "succeeded");
          assert.equal(run.eval_id, retainedCase.evalId);
          assert.equal(run.prompt_sha256, expectedDigest);
          assert.equal(
            run.skill_sha256,
            arm === "with-skill" ? manifest.skill_sha256 : null,
          );
          if (manifest.instructions_sha256) {
            const manifestArm = arm.replaceAll("-", "_");
            assert.equal(
              run.instructions_sha256,
              manifest.instructions_sha256[manifestArm],
            );
          }
        }
      }
    }

    for (const relativeAttemptPath of manifest.previous_invalid_attempts ??
      []) {
      const attempt = readJson(
        resultDirectory,
        ...relativeAttemptPath.split("/"),
      );
      assert.equal(attempt.status, "invalid");
      for (const evalId of manifest.calibration_eval_ids) {
        assert.equal(
          attempt.prompt_sha256[String(evalId)],
          manifest.prompt_sha256[String(evalId)],
        );
      }
    }
  }
});

test("all retained legacy grades preserve frozen expectation text and consistent totals", () => {
  for (const resultDirectory of resultDirectoriesFor("legacy")) {
    const manifest = readJson(resultDirectory, "manifest.json");

    for (const retainedCase of retainedCases(resultDirectory)) {
      assert.ok(Array.isArray(retainedCase.expectations));
      assert.ok(retainedCase.expectations.length > 0);

      for (const arm of ["with-skill", "without-skill"]) {
        for (
          let repetition = 1;
          repetition <= manifest.runs_per_configuration;
          repetition += 1
        ) {
          const grade = readJson(
            retainedCase.directory,
            arm,
            `repetition-${String(repetition).padStart(2, "0")}`,
            "grading.json",
          );
          assert.deepEqual(
            grade.expectations.map(({ text }) => text),
            retainedCase.expectations,
          );
          for (const expectation of grade.expectations) {
            assert.equal(typeof expectation.passed, "boolean");
            assert.equal(typeof expectation.evidence, "string");
            assert.notEqual(expectation.evidence.trim(), "");
          }

          const passed = grade.expectations.filter(
            ({ passed: expectationPassed }) => expectationPassed,
          ).length;
          assert.equal(grade.summary.passed, passed);
          assert.equal(
            grade.summary.failed,
            grade.expectations.length - passed,
          );
          assert.equal(grade.summary.total, grade.expectations.length);
          assert.ok(
            Math.abs(
              grade.summary.pass_rate - passed / grade.expectations.length,
            ) < 0.000001,
          );
        }
      }
    }
  }
});

test("legacy schema-v2 manifests and aggregates agree with retained grades", () => {
  for (const resultDirectory of resultDirectoriesFor("legacy")) {
    const manifest = readJson(resultDirectory, "manifest.json");
    if (manifest.schema_version < 2) {
      continue;
    }

    const aggregate = readJson(resultDirectory, "aggregate.generated.json");
    assert.equal(aggregate.metadata.run_set_id, manifest.run_set_id);
    assert.equal(
      aggregate.metadata.runs_per_configuration,
      manifest.runs_per_configuration,
    );
    assert.equal(aggregate.runs.length, manifest.outcome.successful_runs);

    const totals = {
      with_skill: { passed: 0, total: 0, destinations: 0, trace: 0 },
      without_skill: { passed: 0, total: 0, destinations: 0, trace: 0 },
    };

    for (const retainedCase of retainedCases(resultDirectory)) {
      for (const [armDirectory, arm] of [
        ["with-skill", "with_skill"],
        ["without-skill", "without_skill"],
      ]) {
        for (
          let repetition = 1;
          repetition <= manifest.runs_per_configuration;
          repetition += 1
        ) {
          const grade = readJson(
            retainedCase.directory,
            armDirectory,
            `repetition-${String(repetition).padStart(2, "0")}`,
            "grading.json",
          );
          totals[arm].passed += grade.summary.passed;
          totals[arm].total += grade.summary.total;
          totals[arm].destinations +=
            grade.source_verification.final_destinations;
          totals[arm].trace +=
            grade.source_verification.trace_verified_destinations;
        }
      }
    }

    assert.equal(
      totals.with_skill.passed,
      manifest.outcome.with_skill_expectations_passed,
    );
    assert.equal(
      totals.without_skill.passed,
      manifest.outcome.without_skill_expectations_passed,
    );
    assert.equal(
      totals.with_skill.total,
      manifest.outcome.expectations_per_arm,
    );
    assert.equal(
      totals.without_skill.total,
      manifest.outcome.expectations_per_arm,
    );

    for (const arm of ["with_skill", "without_skill"]) {
      assert.equal(
        aggregate.arm_summary[arm].atomic_expectations.passed,
        totals[arm].passed,
      );
      assert.equal(
        aggregate.arm_summary[arm].atomic_expectations.total,
        totals[arm].total,
      );
      assert.equal(
        aggregate.arm_summary[arm].source_destinations.final,
        totals[arm].destinations,
      );
      assert.equal(
        aggregate.arm_summary[arm].source_destinations.trace_verified,
        totals[arm].trace,
      );
    }
  }
});

test("retained two-arm artifacts remain on their explicitly declared legacy schemas", () => {
  for (const resultDirectory of resultDirectoriesFor("legacy")) {
    const manifest = readJson(resultDirectory, "manifest.json");
    assert.equal(validateResultArtifactSet({ manifest }), "legacy");
  }
});

test("current three-arm result directories validate according to retained campaign state", () => {
  const directories = resultDirectoriesFor("current");
  assert.ok(directories.length > 0, "expected current retained campaigns");
  const states = directories.map(validateCurrentResultDirectory);
  assert.ok(states.includes("prepared"));
  assert.ok(states.includes("executed-invalid"));
});

test("current three-arm fixture binds bundles, bytes, runtime, transmissions, dispositions, and limits", () => {
  assert.equal(validateResultArtifactSet(currentSchemaFixture()), "current");
});

test("an undeclared result schema is rejected instead of inferred from missing fields", () => {
  assert.throws(
    () => validateResultArtifactSet({ manifest: { arms: ["no-skill"] } }),
    /explicitly supported result schema/iu,
  );
});
