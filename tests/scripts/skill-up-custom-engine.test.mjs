import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseContract } from "../../scripts/evaluation/json-contract.js";
import {
  assertConsumerCorrelation,
  assertAssuredQualification,
  assertConsumerOutput,
} from "../../scripts/evaluation/skill-up-custom-engine.js";

test("consumer output refuses existing files and late directory redirection", (t) => {
  const root = mkdtempSync(join(tmpdir(), "consumer-output-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const parent = join(workspace, "output");
  const outside = join(root, "outside");
  mkdirSync(parent, { recursive: true });
  mkdirSync(outside);
  const output = join(parent, "result.json");
  const identity = assertConsumerOutput(workspace, output);
  assert.throws(
    () => assertConsumerOutput(workspace, join(outside, "result.json")),
    /escapes real workspace/u,
  );
  writeFileSync(join(parent, "existing.json"), "retained");
  assert.throws(
    () => assertConsumerOutput(workspace, join(parent, "existing.json")),
    /already exists/u,
  );
  renameSync(parent, join(workspace, "original-output"));
  symlinkSync(
    outside,
    parent,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () => assertConsumerOutput(workspace, output, identity),
    /Redirected consumer output/u,
  );
});

test("in-memory contract parsing retains duplicate-key rejection", () => {
  assert.deepEqual(parseContract(Buffer.from('{"caseId":4}')), { caseId: 4 });
  assert.throws(
    () => parseContract(Buffer.from('{"caseId":4,"caseId":7}')),
    /unique|duplicate/iu,
  );
});
const expected = {
  case_id: "public-cell",
  variant: "with_skill",
  kwargs: { correlation: "public-cell" },
  messages: [
    { role: "user", content: "Execute the frozen session public-cell." },
  ],
  max_turns: 1,
};
const deadline = {
  minimumSeconds: 12,
  maximumSeconds: 15,
  executionTimeoutMs: 10000,
  cleanupAllowanceMs: 2000,
};
test("consumer input is exact public correlation with bounded remaining time", () => {
  const input = { ...expected, workspace: tmpdir(), timeout_seconds: 12 };
  assert.doesNotThrow(() =>
    assertConsumerCorrelation(input, expected, deadline),
  );
  for (const change of [
    { session_id: "continuation" },
    { model: "override" },
    { variant: "without_skill" },
    { max_turns: 2 },
    { kwargs: { correlation: "other" } },
    { messages: [{ role: "user", content: "altered" }] },
    { timeout_seconds: 11 },
    { timeout_seconds: 16 },
    { workspace: "relative" },
  ])
    assert.throws(() =>
      assertConsumerCorrelation({ ...input, ...change }, expected, deadline),
    );
  assert.throws(
    () =>
      assertConsumerCorrelation(input, expected, {
        ...deadline,
        executionTimeoutMs: NaN,
      }),
    /deadline/u,
  );
});
test("failed and pending platforms cannot launch the assured bridge", () => {
  for (const qualification of [
    "pending",
    "assured-disabled-descendant-survived",
    undefined,
  ])
    assert.throws(
      () =>
        assertAssuredQualification({
          platform: "win32-x64",
          manifest: {
            skillUp: { platforms: { "win32-x64": { qualification } } },
          },
        }),
      /disabled/u,
    );
});
