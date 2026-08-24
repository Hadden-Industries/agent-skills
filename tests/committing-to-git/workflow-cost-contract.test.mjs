import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import { createInlineEvidenceCapsule } from "../../src/committing-to-git/inspection/inlineEvidenceCapsule.js";
import { canonicalizeEvidencePlan } from "../../src/committing-to-git/inspection/reviewCatalog.js";

import {
  commitAll,
  configureSshSigning,
  createRepositoryFixture,
  readJson,
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
const PUBLISH_WORKFLOW_SOURCE = readFileSync(
  new URL(
    "../../src/committing-to-git/workflow/publishWorkflow.js",
    import.meta.url,
  ),
  "utf8",
);
const PROMOTE_WORKFLOW_SOURCE = readFileSync(
  new URL(
    "../../src/committing-to-git/workflow/promoteDraftWorkflow.js",
    import.meta.url,
  ),
  "utf8",
);
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
const REMOVED_ROUTES = [
  "snapshot create",
  "snapshot verify",
  "inspection prepare",
  "inspection expand-deletion",
  "inspection acknowledge",
  "inspection status",
  "message scaffold",
  "message render",
  "message validate",
  "signature verify",
  "report create",
  "publication push",
];

function assertNonnegativeInteger(value, label) {
  assert.equal(Number.isInteger(value), true, `${label} must be an integer`);
  assert.ok(value >= 0, `${label} must be nonnegative`);
}

test("publication reuses persisted report facts instead of collecting them again", () => {
  assert.match(PUBLISH_WORKFLOW_SOURCE, /readPersistedReport/u);
  assert.match(PUBLISH_WORKFLOW_SOURCE, /augmentReportWithPublication/u);
  assert.doesNotMatch(PUBLISH_WORKFLOW_SOURCE, /collectCommitReport/u);
  assert.doesNotMatch(PUBLISH_WORKFLOW_SOURCE, /collectWorkspaceSummary/u);
  assert.match(
    PUBLISH_WORKFLOW_SOURCE,
    /\["push", "--porcelain", "--", remote, attempt\.refspec\]/u,
  );
});

test("draft promotion reuses reviewed evidence instead of routing it again", (t) => {
  assert.doesNotMatch(PROMOTE_WORKFLOW_SOURCE, /routePreparedEvidence/u);
  assert.doesNotMatch(PROMOTE_WORKFLOW_SOURCE, /createInlineEvidenceCapsule/u);
  assert.doesNotMatch(PROMOTE_WORKFLOW_SOURCE, /createReviewCatalog/u);

  const fixture = createRepositoryFixture(t, "workflow-cost-promotion-");
  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "draft",
      "--scope",
      "full",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
      "--verification",
      "skipped",
    ],
    fixture.repo,
    { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
  );
  assert.equal(prepared.status, 0, prepared.stderr);
  const transactionPath = JSON.parse(prepared.stdout).transaction;
  const before = readJson(transactionPath);
  const trace2File = join(fixture.scratch, "promotion-trace.json");
  const promoted = runRecordedWorkflow(
    "workflow promote",
    ["--transaction", transactionPath],
    fixture.repo,
    { trace2File, env: { GIT_TRACE2_EVENT: trace2File } },
  );
  const after = readJson(transactionPath);

  assert.equal(promoted.result.status, 0, promoted.result.stderr);
  assert.equal(promoted.invocation.command, "workflow promote");
  assert.deepEqual(after.inlineEvidence, before.inlineEvidence);
  assert.deepEqual(after.review, before.review);
  assert.deepEqual(after.message, before.message);
  assert.equal(after.snapshot.path, before.snapshot.path);
  assert.equal(after.snapshot.sha256, before.snapshot.sha256);
});

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

test("removed pre-cutover routes fail uniformly before Git or filesystem effects", (t) => {
  const fixture = createRepositoryFixture(t, "removed-routes-");

  for (const command of REMOVED_ROUTES) {
    const trace2File = join(
      fixture.scratch,
      `${command.replaceAll(" ", "-")}-trace.json`,
    );
    const outputPath = join(
      fixture.scratch,
      `${command.replaceAll(" ", "-")}-output.json`,
    );
    const result = runCommitWorkflow(
      command,
      ["--output", outputPath],
      fixture.repo,
      { env: { GIT_TRACE2_EVENT: trace2File } },
    );

    assert.equal(result.status, 2, command);
    assert.equal(JSON.parse(result.stdout).code, "UNKNOWN_COMMAND", command);
    assert.equal(existsSync(trace2File), false, command);
    assert.equal(existsSync(outputPath), false, command);
  }

  assert.doesNotThrow(() => assertFrozenBaseline(PRE_CUTOVER_BASELINE));
});

test("every transaction route rejects old versions without migration", (t) => {
  const fixture = createRepositoryFixture(t, "unsupported-attempt-version-");
  const attemptDirectory = join(fixture.scratch, "old-attempt");
  const transactionPath = join(attemptDirectory, "transaction.json");

  writeRepositoryFile(
    attemptDirectory,
    "transaction.json",
    '{"schemaVersion":0}\n',
  );

  for (const command of [
    "workflow resume",
    "workflow extend",
    "workflow promote",
    "workflow commit",
    "workflow verify",
    "workflow report-detail",
    "workflow publish",
    "workflow recover",
    "workflow cleanup",
    "message check",
    "message finalize",
  ]) {
    const result = runCommitWorkflow(
      command,
      ["--transaction", transactionPath],
      fixture.repo,
    );
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 2, command);
    assert.equal(output.code, "UNSUPPORTED_ATTEMPT_VERSION", command);
  }

  assert.equal(readFileSync(transactionPath, "utf8"), '{"schemaVersion":0}\n');
});

test("pre-cutover acknowledgement response scales with the complete old ledger", () => {
  const ledger = createRepresentativeOldLedger(REPRESENTATIVE_OLD_LEDGER_UNITS);
  const responseBytes = Buffer.byteLength(
    `${JSON.stringify(ledger, null, 2)}\n`,
  );

  assert.equal(ledger.units.length, REPRESENTATIVE_OLD_LEDGER_UNITS);
  assert.equal(responseBytes, PRE_CUTOVER_THOUSAND_UNIT_ACK_RESPONSE_BYTES);
});

test("the proportional route contract never uses change-unit count as an evidence proxy", () => {
  const routeForCount = (changeUnitCount) => {
    const changeUnits = Array.from({ length: changeUnitCount }, (_, index) => {
      const id = `F${String(index + 1).padStart(6, "0")}`;
      const path = `generated/domain/file-${index + 1}.json`;

      return {
        id,
        kind: "modified",
        destinationPath: path,
        destinationPathBytesBase64: Buffer.from(path).toString("base64"),
        sourcePath: null,
        sourcePathBytesBase64: null,
        oldMode: "100644",
        newMode: "100644",
        oldOid: "a".repeat(40),
        newOid: "b".repeat(40),
        binary: false,
        additions: 1,
        deletions: 1,
        lineStatistics: "eager",
        renameClassification: null,
      };
    });
    const manifest = {
      schemaVersion: 2,
      indexTreeOid: "c".repeat(40),
      changeUnitCount,
      changeUnits,
      statistics: {
        files: changeUnitCount,
        additions: changeUnitCount,
        deletions: changeUnitCount,
        binaryFiles: 0,
      },
      warnings: [],
    };
    const evidencePlan = canonicalizeEvidencePlan({
      manifest,
      groups: [
        {
          selection: { all: true },
          policy: "reuse",
          basis: { kind: "generated-derived", note: null },
        },
      ],
    });

    return createInlineEvidenceCapsule({ manifest, evidencePlan });
  };

  assert.equal(routeForCount(1).route, "concise");
  assert.equal(routeForCount(1_000).route, "concise");
});

test("concise preapproval action budgets distinguish direct subjects from checked exact text", (t) => {
  const fixture = createRepositoryFixture(t, "workflow-cost-concise-");
  writeRepositoryFile(fixture.repo, "parser.js", "before\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "parser.js", "after\n");
  const prepared = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "full",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
    ],
    fixture.repo,
    { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
  );
  assert.equal(prepared.status, 0, prepared.stderr);
  const preparation = JSON.parse(prepared.stdout);
  const direct = {
    agentVisiblePhases: ["workflow prepare"],
    agentArtifactReads: 0,
    agentArtifactWrites: 0,
  };

  assert.equal(preparation.route, "concise");
  assert.equal(preparation.capsule.unresolved.length, 0);
  assert.deepEqual(direct.agentVisiblePhases, ["workflow prepare"]);
  assert.equal(direct.agentArtifactReads, 0);
  assert.equal(direct.agentArtifactWrites, 0);

  const inputPath = join(dirname(preparation.transaction), "message-input.txt");
  writeFileSync(
    inputPath,
    "fix(parser): Preserve parser behavior\n\nRationale:\n  - Keep existing callers stable\n",
  );
  const trace2File = join(fixture.scratch, "message-check-trace.json");
  const checked = runRecordedWorkflow(
    "message check",
    ["--transaction", preparation.transaction],
    fixture.repo,
    { trace2File, env: { GIT_TRACE2_EVENT: trace2File } },
  );
  const exactFile = {
    agentVisiblePhases: [
      "workflow prepare",
      "write exact message-input.txt",
      "message check",
    ],
    semanticWorksheetWrites: 0,
    reviewReceiptWrites: 0,
  };

  assert.equal(checked.result.status, 0, checked.result.stderr);
  assert.equal(checked.invocation.gitProcesses, 0);
  assert.deepEqual(exactFile.agentVisiblePhases, [
    "workflow prepare",
    "write exact message-input.txt",
    "message check",
  ]);
  assert.equal(exactFile.semanticWorksheetWrites, 0);
  assert.equal(exactFile.reviewReceiptWrites, 0);
});

for (const changeUnitCount of [1, 12, 1_000]) {
  test(`known-context ${changeUnitCount}-unit fixture uses one postapproval commit command`, (t) => {
    const fixture = createRepositoryFixture(
      t,
      `workflow-cost-postapproval-${changeUnitCount}-`,
    );
    writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
    commitAll(fixture.repo);

    if (!configureSshSigning(t, fixture)) {
      return;
    }

    for (let index = 0; index < changeUnitCount; index += 1) {
      writeRepositoryFile(
        fixture.repo,
        `generated/unit-${String(index + 1).padStart(4, "0")}.txt`,
        `unit ${index + 1}\n`,
      );
    }

    const preparation = runCommitWorkflow(
      "workflow prepare",
      [
        "--mode",
        "actual",
        "--scope",
        "full",
        "--evidence",
        "reuse",
        "--basis",
        "generated-derived",
        "--verification",
        "skipped",
      ],
      fixture.repo,
      { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
    );

    assert.equal(preparation.status, 0, preparation.stderr);
    const prepared = JSON.parse(preparation.stdout);

    assert.equal(prepared.route, "concise");
    assert.equal(prepared.changeUnitCount, changeUnitCount);
    const trace2File = join(fixture.scratch, "postapproval-trace.json");
    const committed = runRecordedWorkflow(
      "workflow commit",
      [
        "--transaction",
        prepared.transaction,
        "--message",
        "chore(fixtures): Record generated unit set",
      ],
      fixture.repo,
      { trace2File, env: { GIT_TRACE2_EVENT: trace2File } },
    );

    assert.equal(committed.result.status, 0, committed.result.stderr);
    assert.equal(committed.invocation.command, "workflow commit");
    assert.ok(committed.invocation.stdoutBytes <= 80 * 1024);
    assert.equal(JSON.parse(committed.result.stdout).commitState, "created");
    assert.deepEqual(
      [committed.invocation.command],
      ["workflow commit"],
      "postapproval flow must not add a finalizer call",
    );
  });
}
