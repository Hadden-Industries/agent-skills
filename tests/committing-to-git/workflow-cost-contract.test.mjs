import { readFileSync } from "node:fs";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  createRepositoryFixture,
  runCommitWorkflow,
  runRecordedWorkflow,
  summarizeWorkflowCost,
  writeRepositoryFile,
} from "./harness.mjs";

const PRE_CUTOVER_BASELINE = JSON.parse(
  readFileSync(
    new URL("./fixtures/pre-cutover-workflow-cost.json", import.meta.url),
    "utf8",
  ),
);
const PRE_CUTOVER_MIN_HELPER_CALLS = 8;
const PRE_CUTOVER_MIN_AGENT_ARTIFACT_READS = 1;
const PRE_CUTOVER_MIN_AGENT_ARTIFACT_WRITES = 1;
const PRE_CUTOVER_MIN_STDOUT_BYTES = 1;
const REPRESENTATIVE_OLD_LEDGER_UNITS = 1_000;
const PRE_CUTOVER_THOUSAND_UNIT_ACK_RESPONSE_BYTES = 316_216;
const EXPECTED_PRE_CUTOVER_PHASES = [
  "snapshot create",
  "inspection prepare",
  "inspection acknowledge",
  "inspection acknowledge",
  "message scaffold",
  "message render",
  "message validate",
  "signature verify",
  "report create",
];
const PRE_CUTOVER_ROUTES = new Set(EXPECTED_PRE_CUTOVER_PHASES);

function assertNonnegativeInteger(value, label) {
  assert.equal(Number.isInteger(value), true, `${label} must be an integer`);
  assert.ok(value >= 0, `${label} must be nonnegative`);
}

function assertFrozenBaseline(baseline) {
  assert.deepEqual(Object.keys(baseline).sort(), [
    "cost",
    "orderedPhases",
    "safety",
    "scenario",
    "schemaVersion",
    "sourceCommitOid",
  ]);
  assert.equal(baseline.schemaVersion, 1);
  assert.match(baseline.sourceCommitOid, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);
  assert.equal(baseline.scenario, "known-context-skill-inventory-hint");
  assert.deepEqual(baseline.orderedPhases, EXPECTED_PRE_CUTOVER_PHASES);

  assert.deepEqual(Object.keys(baseline.cost).sort(), [
    "agentArtifactReads",
    "agentArtifactWrites",
    "approvalTurns",
    "gitProcesses",
    "helperCalls",
    "stderrBytes",
    "stdoutBytes",
  ]);
  for (const [name, value] of Object.entries(baseline.cost)) {
    assertNonnegativeInteger(value, `cost.${name}`);
  }
  assert.equal(
    baseline.orderedPhases.length,
    baseline.cost.helperCalls,
    "every measured helper call must have one ordered phase",
  );
  assert.ok(baseline.cost.helperCalls >= PRE_CUTOVER_MIN_HELPER_CALLS);
  assert.ok(
    baseline.cost.agentArtifactReads >= PRE_CUTOVER_MIN_AGENT_ARTIFACT_READS,
  );
  assert.ok(
    baseline.cost.agentArtifactWrites >= PRE_CUTOVER_MIN_AGENT_ARTIFACT_WRITES,
  );
  assert.ok(baseline.cost.stdoutBytes >= PRE_CUTOVER_MIN_STDOUT_BYTES);
  assert.equal(baseline.cost.approvalTurns, 1);

  assert.deepEqual(baseline.safety, {
    treeMatches: true,
    messageMatches: true,
    signedCreationRequired: true,
    pushAttempted: false,
  });
}

function runCommitWorkflowWithRemovedPreCutoverRoutes(
  command,
  args,
  cwd,
  options,
) {
  if (PRE_CUTOVER_ROUTES.has(command)) {
    return {
      status: 2,
      stdout: "",
      stderr: `${JSON.stringify({ code: "UNKNOWN_COMMAND", command })}\n`,
    };
  }

  return runCommitWorkflow(command, args, cwd, options);
}

function createRepresentativeOldLedger(unitCount) {
  const units = Array.from({ length: unitCount }, (_, index) => {
    const id = `C${String(index + 1).padStart(6, "0")}`;
    const byteStart = index * 1024;

    return {
      id,
      kind: "text-patch",
      artifact: `chunks/${id}.patch`,
      byteStart,
      byteEnd: byteStart + 1024,
      byteCount: 1024,
      lineCount: 40,
      sha256: "a".repeat(64),
      status: index === 0 ? "reviewed" : "pending",
    };
  });

  return {
    schemaVersion: 2,
    indexTreeOid: "b".repeat(40),
    reviewPatchSha256: "c".repeat(64),
    reviewPatchBytes: unitCount * 1024,
    summarizedDeletionCount: 0,
    summarizedTextDeletionLines: 0,
    expandedDeletions: [],
    unitCount,
    reviewedCount: 1,
    complete: false,
    units,
  };
}

test("workflow recorder captures one helper invocation without implicit Git tracing", () => {
  const { result, invocation } = runRecordedWorkflow(
    "--help",
    [],
    process.cwd(),
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(invocation.command, "--help");
  assert.deepEqual(invocation.args, []);
  assert.equal(invocation.status, result.status);
  assert.equal(invocation.gitProcesses, 0);
  assert.equal(invocation.stdoutBytes, Buffer.byteLength(result.stdout));
  assert.equal(invocation.stderrBytes, Buffer.byteLength(result.stderr));
  assert.ok(invocation.durationMs >= 0);
});

test("workflow recorder treats an unused Trace2 target as zero Git processes", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-cost-no-git-");
  const trace2File = join(fixture.scratch, "trace2.json");

  const { result, invocation } = runRecordedWorkflow(
    "--help",
    [],
    fixture.repo,
    {
      trace2File,
      env: { GIT_TRACE2_EVENT: trace2File },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(invocation.gitProcesses, 0);
});

test("workflow recorder counts Git process starts rather than all Trace2 events", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-cost-trace2-");
  const trace2File = join(fixture.scratch, "trace2.json");
  const events = [
    { event: "version" },
    { event: "start", argv: ["git", "status"] },
    { event: "region_enter", category: "index" },
    { event: "child_start", child_class: "hook", argv: ["pre-commit"] },
    { event: "exit", code: 0 },
  ];

  writeRepositoryFile(
    fixture.scratch,
    "trace2.json",
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  const { result, invocation } = runRecordedWorkflow(
    "--help",
    [],
    fixture.repo,
    { trace2File },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(invocation.gitProcesses, 1);
});

test("workflow cost summaries add each recorded invocation exactly once", () => {
  const summary = summarizeWorkflowCost([
    {
      gitProcesses: 2,
      stdoutBytes: 100,
      stderrBytes: 5,
      durationMs: 12.5,
    },
    {
      gitProcesses: 3,
      stdoutBytes: 50,
      stderrBytes: 0,
      durationMs: 7.5,
    },
  ]);

  assert.deepEqual(summary, {
    helperCalls: 2,
    gitProcesses: 5,
    stdoutBytes: 150,
    stderrBytes: 5,
    durationMs: 20,
  });
});

test("frozen pre-cutover baseline preserves provenance, cost, and safety facts", () => {
  assertFrozenBaseline(PRE_CUTOVER_BASELINE);
});

test("frozen baseline does not execute routes removed by the cutover", () => {
  const simulatedCommand = runCommitWorkflowWithRemovedPreCutoverRoutes(
    "snapshot create",
    [],
    process.cwd(),
  );

  assert.equal(simulatedCommand.status, 2);
  assert.match(simulatedCommand.stderr, /"code":"UNKNOWN_COMMAND"/u);
  assert.doesNotThrow(() => assertFrozenBaseline(PRE_CUTOVER_BASELINE));
});

test("pre-cutover acknowledgement response scales with the complete old ledger", () => {
  const ledger = createRepresentativeOldLedger(REPRESENTATIVE_OLD_LEDGER_UNITS);
  const responseBytes = Buffer.byteLength(
    `${JSON.stringify(ledger, null, 2)}\n`,
  );

  assert.equal(ledger.units.length, REPRESENTATIVE_OLD_LEDGER_UNITS);
  assert.equal(responseBytes, PRE_CUTOVER_THOUSAND_UNIT_ACK_RESPONSE_BYTES);
});
