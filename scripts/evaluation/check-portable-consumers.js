import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { compileSuite } from "./compile-suite.js";
import { createConsumerWorkspace } from "./consumer-workspace.js";
import {
  inspectToolchain,
  isolatedEnvironment,
  repositoryRoot,
} from "./toolchain.js";

export async function checkPortableConsumers() {
  const toolchain = inspectToolchain();
  const compiled = compileSuite({ repositoryRoot, skillName: "reading-epubs" });
  const workspace = createConsumerWorkspace({ repositoryRoot, compiled });
  const config = {
    schema_version: "v1alpha1",
    environment: { type: "none" },
    mcp: { servers: [] },
    engine: {
      name: "hadden-portable-qualification",
      custom: {
        transport: "local",
        conversation_mode: "batch",
        response_format: "session_result",
        local: {
          command: process.execPath,
          args: [
            join(
              repositoryRoot,
              "tests/fixtures/evaluation-contracts/fake-portable-engine.mjs",
            ),
            "${input_file}",
            "${output_file}",
          ],
          output_file: "${output_file}",
        },
      },
    },
    cases: {
      files: workspace.projection.cases.map(({ path }) => path),
      defaults: { timeout_seconds: 20, max_turns: 1 },
      parallelism: 1,
      retry_policy: { max_retries: 0 },
    },
    benchmark: { enabled: false },
    judge: { type: "rule_based" },
    report: { formats: ["json"] },
  };
  const configPath = join(workspace.skillRoot, "eval.yaml");
  writeFileSync(configPath, stringify(config));
  const commands = [];
  for (const operation of ["validate", "run"]) {
    const argv = [
      operation,
      configPath,
      ...(operation === "run"
        ? [
            "--iteration",
            "1",
            "--output-dir",
            join(workspace.root, "consumer-results"),
          ]
        : []),
    ];
    const result = spawnSync(toolchain.executable, argv, {
      cwd: workspace.skillRoot,
      env: isolatedEnvironment(workspace.root),
      encoding: "utf8",
      timeout: 45000,
      windowsHide: true,
    });
    commands.push({
      argv,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error?.message,
    });
    writeFileSync(
      join(workspace.root, "commands.json"),
      JSON.stringify(commands, null, 2),
    );
    assert.equal(
      result.status,
      0,
      `${operation}: ${result.stderr}\n${result.stdout}; retained ${workspace.root}`,
    );
  }
  const report = JSON.parse(
    readFileSync(
      join(workspace.root, "consumer-results/iteration-1/report.json"),
      "utf8",
    ),
  );
  assert.equal(report.case_results.length, 5);
  for (const result of report.case_results) {
    const evaluation = compiled.cases.find(
      ({ id }) => result.case_id === `case-${id}`,
    );
    assert.ok(evaluation, "Unexpected consumer case identity");
    assert.equal(result.prompt, evaluation.prompt);
    assert.equal(result.status, "PASS");
    assert.equal(result.response, "portable-transport-ok");
  }
  const { loadSkill, runEval, createStaticProvider } =
    await import("agent-skills-eval");
  const loaded = loadSkill(workspace.skillRoot, { strict: true });
  assert.equal(loaded.evals.length, 5);
  for (const evaluation of loaded.evals) {
    const result = await runEval({
      skill: loaded,
      eval: evaluation,
      modes: ["with_skill", "without_skill"],
      target: {
        model: "static",
        provider: createStaticProvider("portable-transport-ok"),
      },
      judge: {
        model: "static",
        provider: createStaticProvider(
          JSON.stringify({
            assertion_results: evaluation.assertions.map(() => ({
              passed: true,
              evidence: "synthetic conformance judgment; no semantic claim",
            })),
          }),
        ),
      },
      workspace: join(workspace.root, "independent-results"),
      iteration: 1,
    });
    assert.equal(result.modes.with_skill.rawOutput, "portable-transport-ok");
    assert.equal(result.modes.without_skill.fileCount, 0);
  }
  const receipt = {
    schemaVersion: 1,
    status: "portable-consumer-conformance-passed",
    root: workspace.root,
    compiledSuiteSha256: compiled.compiledSuiteSha256,
    projectionReceiptSha256: workspace.projection.receiptSha256,
    cases: 5,
    limitations: [
      "Fake targets and synthetic grades establish transport only.",
      "Binary EPUB is skipped by the independent consumer; installed Pandoc tests own conversion evidence.",
      "Independent baseline omits fixtures and assertion judge omits expected output.",
      "No network or descendant-containment qualification is implied.",
    ],
  };
  writeFileSync(
    join(workspace.root, "receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  return receipt;
}
