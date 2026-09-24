import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function subject() {
  return import("../../evals/committing-to-git/reviewed-change-host.mjs");
}

function record() {
  return {
    schemaVersion: 1,
    caseId: "detailed-main",
    wallTimeMs: 1000,
    identity: {
      host: "codex-desktop",
      hostVersion: "test",
      model: "test-model",
      effort: "high",
      hisewVersion: "test",
      helperSha256: "a".repeat(64),
      skillBundleSha256: "b".repeat(64),
    },
    observedKinds: [
      "tool",
      "shell",
      "helper",
      "reference-read",
      "output",
      "hosted-wait",
    ],
    events: [
      {
        id: "t1",
        kind: "tool",
        startMs: 0,
        endMs: 1000,
        evidence: "transcript:t1",
      },
      {
        id: "s1",
        kind: "shell",
        startMs: 100,
        endMs: 250,
        evidence: "transcript:s1",
      },
      {
        id: "h1",
        kind: "helper",
        operation: "workflow prepare",
        startMs: 110,
        endMs: 200,
        evidence: "capture:h1",
      },
      {
        id: "h2",
        kind: "helper",
        operation: "message finalize",
        startMs: 180,
        endMs: 240,
        evidence: "capture:h2",
      },
      {
        id: "w1",
        kind: "hosted-wait",
        startMs: 500,
        endMs: 900,
        evidence: "transcript:w1",
      },
    ],
    safety: {},
  };
}

test("host measurement separates nested helper time, hosted waiting and unattributed time", async () => {
  const { measureReviewedChangeHostRun } = await subject();
  const result = measureReviewedChangeHostRun(record());
  assert.equal(result.toolRoundTrips, 1);
  assert.equal(result.shellInvocations, 1);
  assert.equal(result.helperExecutionMs, 150);
  assert.equal(result.helperOccupiedMs, 130);
  assert.equal(result.hostedWaitMs, 400);
  assert.equal(result.unattributedWallTimeMs, 450);
  assert.equal(result.hostOverheadMs, null);
  assert.deepEqual(result.unattributedTimeCoverage, {
    accountedKinds: ["shell", "helper", "hosted-wait"],
    missingKinds: ["host-overhead"],
  });
  assert.equal(result.safetyDisposition, "incomplete");
});

test("local helper cost includes checks and recovery and excludes only publication operations", async () => {
  const { measureReviewedChangeHostRun } = await subject();
  const input = record();
  for (const operation of [
    "workflow check",
    "workflow report-detail",
    "workflow resume",
    "workflow preflight",
    "workflow publish",
  ])
    input.events.push({
      id: operation,
      kind: "helper",
      operation,
      startMs: 300,
      endMs: 310,
      evidence: `capture:${operation}`,
    });
  const measured = measureReviewedChangeHostRun(input);
  assert.equal(measured.localHelperCalls, 5);
  assert.equal(measured.costDisposition, "over-budget");
  input.events.push({
    id: "unknown",
    kind: "helper",
    operation: "workflow invented",
    startMs: 300,
    endMs: 310,
    evidence: "capture:unknown",
  });
  assert.throws(() => measureReviewedChangeHostRun(input), /operation/i);
});

test("missing measurement coverage stays unknown and invalid or duplicate events are rejected", async () => {
  const { measureReviewedChangeHostRun } = await subject();
  const absent = record();
  absent.observedKinds = [];
  absent.events = [];
  assert.equal(measureReviewedChangeHostRun(absent).toolRoundTrips, null);
  const duplicate = record();
  duplicate.events.push(duplicate.events[0]);
  assert.throws(() => measureReviewedChangeHostRun(duplicate), /duplicate/i);
  const invalid = record();
  invalid.events[0].endMs = 2000;
  assert.throws(() => measureReviewedChangeHostRun(invalid), /interval/i);
});

test("latency cannot hide failed safety or an unverified final destination", async () => {
  const { measureReviewedChangeHostRun, HOST_SAFETY_EXPECTATIONS } =
    await subject();
  const input = record();
  input.safety = Object.fromEntries(
    HOST_SAFETY_EXPECTATIONS.map((key) => [
      key,
      { verdict: "pass", evidence: `grader:${key}` },
    ]),
  );
  assert.equal(measureReviewedChangeHostRun(input).safetyDisposition, "passed");
  input.safety.finalDestination.verdict = "unknown";
  assert.equal(
    measureReviewedChangeHostRun(input).safetyDisposition,
    "incomplete",
  );
  input.safety.unrelatedLockfile.verdict = "fail";
  assert.equal(measureReviewedChangeHostRun(input).safetyDisposition, "failed");
});

test("the host fixture has five reviewed docs, real prior check evidence and an unrelated tracked lockfile", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "reviewed-host-fixture-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const repository = join(parent, "repository");
  const child = spawnSync(
    process.execPath,
    [
      "evals/committing-to-git/create-fixture-repository.mjs",
      "--scenario",
      "reviewed-docs-orchestration",
      "--destination",
      repository,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(child.status, 0, child.stderr);
  const fixture = JSON.parse(child.stdout).expected.safety;
  assert.equal(fixture.selectedPaths.length, 5);
  assert.equal(fixture.preexistingCheck.exitCode, 0);
  assert.equal(
    Object.keys(fixture.preexistingCheck.selectedPathBlobOids).length,
    5,
  );
  assert.equal(fixture.protectedMainVerified, false);
  assert.equal(
    readFileSync(join(repository, "skills-lock.json"), "utf8"),
    '{"userOwned":"preserve this edit"}\n',
  );
});
