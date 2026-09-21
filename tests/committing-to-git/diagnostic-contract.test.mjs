import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Writable } from "node:stream";
import { executeCommand } from "../../src/committing-to-git/cli/commandExecution.js";
import {
  workflowFailureResult,
  WorkflowDiagnosticError,
} from "../../src/committing-to-git/diagnostics/workflowDiagnosticError.js";
import {
  createWorkflowResult,
  encodeWorkflowResult,
  MAXIMUM_RESULT_BYTES,
  createWorkflowWarning,
  validateWorkflowResult,
} from "../../src/committing-to-git/diagnostics/diagnosticContract.js";

test("asynchronous output failure retains mutation classification without replay", async () => {
  let calls = 0;
  const stdout = new Writable({
    write(_chunk, _encoding, callback) {
      calls += 1;
      callback(new Error("private destination failure"));
    },
  });
  await assert.rejects(
    executeCommand([], {
      parse: () => ({}),
      execute: () =>
        createWorkflowResult({
          disposition: "succeeded",
          status: "reported",
          commitState: "created",
        }),
      stdout,
    }),
    (error) => error.exitCode === 3 && !error.message.includes("private"),
  );
  assert.equal(calls, 1);
});

test("bounded warnings remain successful with truthful omission counts", () => {
  const result = createWorkflowResult({
    disposition: "succeeded",
    status: "reported",
    commitState: "created",
    warnings: Array.from({ length: 40 }, () =>
      createWorkflowWarning({
        code: "ADVISORY_CHECK",
        message: "Advisory only",
      }),
    ),
    details: Array.from({ length: 40 }, () => ({
      kind: "limit",
      reason: "bounded",
    })),
  });
  assert.deepEqual(validateWorkflowResult(result), []);
  assert.equal(result.exitCode, 0);
  assert.equal(result.severity, "warning");
  assert.equal(result.warnings.length, 32);
  assert.equal(result.warnings[31].details[0].omittedWarningCount, 9);
  assert.equal(result.details[31].omittedDetailCount, 9);
  assert.equal(
    JSON.parse(encodeWorkflowResult(result).output).warnings.length,
    32,
  );
});

test("recovery arguments and fallback paths are exact or omitted, never truncated identities", () => {
  const diagnostic = (path) =>
    new WorkflowDiagnosticError("INVALID_ARGUMENT", "Correct input", {
      recovery: {
        kind: "continue",
        automatic: false,
        requiredInputs: [],
        commands: [
          { arguments: ["workflow", "recover", "--transaction", path] },
        ],
      },
    });
  const exact = "fixture\twith\ncharacters";
  assert.equal(
    workflowFailureResult(diagnostic(exact)).recovery.commands[0].arguments[3],
    exact,
  );
  const oversized = "x".repeat(5000);
  const failure = workflowFailureResult(diagnostic(oversized), {
    transaction: oversized,
  });
  assert.equal(failure.code, "DIAGNOSTIC_NORMALIZATION_FAILED");
  assert.equal(failure.transaction, null);
  assert.deepEqual(failure.recovery.commands, []);
});

const cli = fileURLToPath(
  new URL("../../src/committing-to-git/cli/commitWorkflow.js", import.meta.url),
);

test("a known commit needing report recovery is not reclassified as an unknown mutation", () => {
  const result = workflowFailureResult(new Error("report I/O"), {
    state: {
      commitState: "created",
      commitOid: "d".repeat(40),
      publicationState: "not-requested",
      recoveryRequired: true,
    },
  });
  assert.equal(result.exitCode, 3);
  assert.equal(result.disposition, "completed-with-failure");
  assert.equal(result.commitOid, "d".repeat(40));
  assert.equal(result.recoveryRequired, true);
});

test("dispatch rejection declares input recovery without claiming an observed commit state", () => {
  const child = spawnSync(process.execPath, [cli, "unknown", "command"], {
    encoding: "utf8",
  });
  assert.equal(child.status, 2);
  const result = JSON.parse(child.stdout);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.domain, "committing-to-git");
  assert.equal(result.disposition, "invalid-input");
  assert.equal(result.code, "UNKNOWN_COMMAND");
  assert.equal(result.commitState, "unknown");
  assert.equal(result.recovery.kind, "correct-input");
  assert.equal(result.recovery.automatic, false);
  assert.deepEqual(result.recovery.commands, [{ arguments: ["--help"] }]);
  assert.equal(child.stdout.trim().split("\n").length, 1);
});

test("arbitrary thrown proxies and cyclic expected details preserve bounded state without invoking getters", () => {
  const hostile = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error("secret prototype");
      },
      ownKeys() {
        throw new Error("secret keys");
      },
    },
  );
  const state = {
    commitState: "created",
    commitOid: "b".repeat(40),
    publicationState: "unknown",
    recoveryRequired: true,
  };
  const result = workflowFailureResult(hostile, { state });
  assert.equal(result.commitState, "created");
  assert.equal(result.commitOid, state.commitOid);
  assert.doesNotMatch(JSON.stringify(result), /secret/u);
  const details = { marker: "safe" };
  details.self = details;
  Object.defineProperty(details, "secret", {
    enumerable: true,
    get() {
      throw new Error("secret accessor");
    },
  });
  const expected = workflowFailureResult(
    new WorkflowDiagnosticError("EXPECTED_FAILURE", "Safe message", {
      details,
    }),
    { state },
  );
  assert.equal(expected.commitOid, state.commitOid);
  assert.match(JSON.stringify(expected), /omitted: cycle/u);
  assert.doesNotMatch(JSON.stringify(expected), /secret accessor/u);
});

test("failed output delivery never executes the operation or writes its result twice", async () => {
  let executions = 0;
  let writes = 0;
  await assert.rejects(
    executeCommand([], {
      parse: () => ({}),
      execute: () => {
        executions += 1;
        return createWorkflowResult({
          disposition: "succeeded",
          status: "reported",
          commitState: "created",
        });
      },
      stdout: {
        write() {
          writes += 1;
          throw new Error("broken output");
        },
      },
    }),
    /output delivery failed/u,
  );
  assert.equal(executions, 1);
  assert.equal(writes, 1);
});

test("encoding fallback does not invoke a hostile state accessor", () => {
  let getterCalls = 0;
  const result = {
    get commitState() {
      getterCalls += 1;
      throw new Error("secret state");
    },
  };
  const encoded = encodeWorkflowResult(result);
  assert.equal(encoded.result.code, "RESULT_ENCODING_FAILED");
  assert.equal(getterCalls, 0);
  assert.doesNotMatch(encoded.output, /secret state/u);
});

test("detail data cannot override identity, authorization, state or exit classification", () => {
  const result = createWorkflowResult({
    disposition: "invalid-input",
    status: "invalid",
    code: "INVALID_ARGUMENT",
    data: {
      domain: "other",
      exitCode: 0,
      commitState: "created",
      publicationAllowed: true,
    },
    details: [{ kind: "input", field: "--transaction" }],
  });
  assert.equal(result.domain, "committing-to-git");
  assert.equal(result.exitCode, 2);
  assert.equal(result.commitState, "unknown");
  assert.equal(result.publicationAllowed, false);
});

test("encoding failure retains a known commit and emits one bounded failure result", () => {
  const cycle = {};
  cycle.self = cycle;
  const result = createWorkflowResult({
    disposition: "succeeded",
    status: "reported",
    commitState: "created",
    publicationState: "not-requested",
    data: { report: cycle, commitOid: "a".repeat(40) },
  });
  const { output, result: encodedResult } = encodeWorkflowResult(result);
  assert.ok(Buffer.byteLength(output) <= MAXIMUM_RESULT_BYTES);
  const failure = JSON.parse(output);
  assert.equal(failure.disposition, "completed-with-failure");
  assert.equal(failure.exitCode, 3);
  assert.equal(encodedResult.exitCode, 3);
  assert.equal(failure.commitState, "created");
  assert.equal(failure.commitOid, "a".repeat(40));
  assert.equal(failure.code, "RESULT_ENCODING_FAILED");
});

test("cyclic diagnostic details never invoke accessors or disclose their exceptions", () => {
  const detail = { kind: "internal" };
  detail.self = detail;
  Object.defineProperty(detail, "secret", {
    enumerable: true,
    get() {
      throw new Error("sensitive contents");
    },
  });
  const result = createWorkflowResult({
    disposition: "internal-failure",
    status: "failed",
    code: "INTERNAL_FAILURE",
    details: [detail],
  });
  const { output } = encodeWorkflowResult(result);
  assert.doesNotMatch(output, /sensitive contents/u);
  assert.match(output, /omitted: cycle/u);
});
