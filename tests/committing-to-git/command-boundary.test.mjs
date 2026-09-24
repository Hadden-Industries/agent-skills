import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertWorkflowResult } from "./harness.mjs";
import { COMMAND_ARGUMENTS } from "../../src/committing-to-git/cli/commandArguments.js";

const cli = fileURLToPath(
  new URL(
    "../../plugins/committing-to-git/skills/committing-to-git/scripts/commitWorkflow.mjs",
    import.meta.url,
  ),
);

const commands = [
  "workflow preflight",
  "workflow prepare",
  "workflow resume",
  "workflow extend",
  "workflow review-next",
  "workflow promote",
  "message check",
  "message finalize",
  "workflow check",
  "workflow check-detail",
  "workflow commit",
  "workflow verify",
  "workflow report-detail",
  "workflow publish",
  "workflow recover",
  "workflow cleanup",
];

test("the independently enumerated packaged routes cover the complete command registry", () => {
  assert.deepEqual([...commands].sort(), Object.keys(COMMAND_ARGUMENTS).sort());
});

test("a standalone packaged helper identifies its actual bytes outside Git", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "commit-version-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const packaged = join(directory, "workflow.mjs");
  copyFileSync(
    new URL(
      "../../skills/committing-to-git/scripts/commitWorkflow.mjs",
      import.meta.url,
    ),
    packaged,
  );
  const expectedHash = createHash("sha256")
    .update(readFileSync(packaged))
    .digest("hex");
  const result = spawnSync(process.execPath, [packaged, "--version"], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    implementation: { algorithm: "sha256", digest: expectedHash },
    diagnosticContractVersion: 2,
  });
  assert.equal(result.stderr, "");
});

for (const command of commands) {
  test(`${command} preserves every diagnostic fact in text and JSON`, async () => {
    const invoke = (format) =>
      spawnSync(
        process.execPath,
        [cli, ...command.split(" "), "--not-an-option", "--format", format],
        { encoding: "utf8" },
      );
    const json = invoke("json");
    const text = invoke("text");
    assert.equal(json.status, 2);
    assert.equal(text.status, 2);
    const result = JSON.parse(json.stdout);
    await assertWorkflowResult(result, json.status);
    for (const [key, value] of Object.entries(result)) {
      assert.ok(
        text.stdout.includes(
          `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}\n`,
        ),
        `${command} omitted ${key}`,
      );
    }
    assert.equal(json.stderr, "");
    assert.equal(text.stderr, "");
  });
  test(`${command} rejects duplicate singleton options before admission`, () => {
    const result = spawnSync(
      process.execPath,
      [
        cli,
        ...command.split(" "),
        "--format",
        "json",
        "--format",
        "json",
        ...(command === "workflow check" ? ["--", "node"] : []),
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).code, "DUPLICATE_ARGUMENT");
  });
  if (command !== "workflow check") {
    test(`${command} rejects a child-command separator`, () => {
      const result = spawnSync(
        process.execPath,
        [cli, ...command.split(" "), "--"],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "INVALID_ARGUMENT");
    });
  }
}

test("child transaction arguments cannot trigger helper transaction admission", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "commit-child-arguments-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const childInput = join(directory, "child input.json");
  writeFileSync(childInput, JSON.stringify({ schemaVersion: 123 }));
  const invoke = (arguments_) =>
    spawnSync(process.execPath, [cli, ...arguments_], {
      cwd: directory,
      encoding: "utf8",
    });
  const baseline = invoke(["workflow", "check", "--", "node"]);
  const withChildArguments = invoke([
    "workflow",
    "check",
    "--",
    "node",
    "--transaction",
    childInput,
    "--format",
    "text",
    "--help",
  ]);
  assert.equal(baseline.status, 2);
  const expected = JSON.parse(baseline.stdout);
  assert.notEqual(expected.code, "UNSUPPORTED_ATTEMPT_VERSION");
  assert.equal(withChildArguments.status, baseline.status);
  assert.deepEqual(JSON.parse(withChildArguments.stdout), expected);
});

test("duplicate helper options are rejected before reading a transaction", () => {
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "workflow",
      "publish",
      "--transaction",
      "missing/transaction.json",
      "--remote",
      "origin",
      "--remote",
      "other",
      "--destination",
      "refs/heads/example",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, "DUPLICATE_ARGUMENT");
});

test("helper value options cannot consume the following option as their value", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "workflow", "review-next", "--transaction", "--format", "json"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, "INVALID_ARGUMENT");
});
