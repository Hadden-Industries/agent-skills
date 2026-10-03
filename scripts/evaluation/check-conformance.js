import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  inspectToolchain,
  isolatedEnvironment,
  repositoryRoot,
} from "./toolchain.js";

export async function checkConformance({ fakeOutcome = "success" } = {}) {
  assert.ok(["success", "wrong-marker", "error"].includes(fakeOutcome));
  const toolchain = inspectToolchain();
  const { stringify } = await import("yaml");
  const { createStaticProvider, discoverSkills, loadSkill, runEval } =
    await import("agent-skills-eval");
  const root = mkdtempSync(join(tmpdir(), "evaluation-conformance-"));
  const skill = join(root, "qualification");
  mkdirSync(join(skill, "evals/files"), { recursive: true });
  mkdirSync(join(skill, "evals/cases"));
  const prompt = "Reply with the literal qualification marker.";
  writeFileSync(
    join(skill, "SKILL.md"),
    "---\nname: qualification\ndescription: Deterministic consumer qualification fixture.\n---\nReturn the requested marker.\n",
  );
  writeFileSync(join(skill, "evals/files/context.txt"), "fixture-marker");
  writeFileSync(
    join(skill, "evals/files/binary.bin"),
    Buffer.from([0, 1, 2, 255]),
  );
  writeFileSync(
    join(skill, "evals/evals.json"),
    JSON.stringify({
      skill_name: "qualification",
      evals: [
        {
          id: 1,
          prompt,
          expected_output: "expected-output-marker",
          files: ["evals/files/context.txt", "evals/files/binary.bin"],
          assertions: ["The output equals qualification-marker."],
        },
      ],
    }),
  );
  copyFileSync(
    join(repositoryRoot, "tests/fixtures/evaluation-contracts/fake-engine.mjs"),
    join(skill, "fake-engine.mjs"),
  );
  const config = {
    schema_version: "v1alpha1",
    environment: { type: "none" },
    mcp: { servers: [] },
    engine: {
      name: "hadden-qualification",
      custom: {
        transport: "local",
        conversation_mode: "batch",
        response_format: "session_result",
        local: {
          command: process.execPath,
          args: [
            join(skill, "fake-engine.mjs"),
            "${input_file}",
            "${output_file}",
            fakeOutcome,
          ],
          output_file: "${output_file}",
        },
      },
    },
    cases: {
      files: ["evals/cases/marker.yaml"],
      defaults: { timeout_seconds: 20, max_turns: 1 },
      parallelism: 1,
      retry_policy: { max_retries: 0 },
    },
    benchmark: { enabled: false },
    judge: { type: "rule_based" },
    report: { formats: ["json"] },
  };
  writeFileSync(join(skill, "evals/eval.yaml"), stringify(config));
  writeFileSync(
    join(skill, "evals/cases/marker.yaml"),
    stringify({
      id: "marker",
      title: "Deterministic marker",
      input: { prompt },
      expect: { must_contain: ["qualification-marker"] },
    }),
  );
  const env = isolatedEnvironment(root);
  const commands = [];
  for (const operation of ["validate", "run"]) {
    const args = [operation, join(skill, "evals/eval.yaml")];
    if (operation === "run") {
      args.push(
        "--iteration",
        "1",
        "--output-dir",
        join(root, "skill-up-results"),
      );
    }
    const result = spawnSync(toolchain.executable, args, {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 45000,
      maxBuffer: 4 * 1024 * 1024,
    });
    commands.push({
      argv: args,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error?.message,
    });
    writeFileSync(
      join(root, "commands.json"),
      JSON.stringify(commands, null, 2),
    );
    assert.equal(
      result.status,
      0,
      `skill-up ${operation} failed; evidence: ${root}\n${result.stderr}\n${result.stdout}`,
    );
  }
  const report = JSON.parse(
    readFileSync(
      join(root, "skill-up-results/iteration-1/report.json"),
      "utf8",
    ),
  );
  assert.equal(report.case_results.length, 1);
  assert.equal(report.case_results[0].case_id, "marker");
  assert.equal(report.case_results[0].status, "PASS");
  assert.equal(report.case_results[0].response, "qualification-marker");
  assert.equal(report.case_results[0].grading.summary.passed, 1);
  assert.equal(report.case_results[0].grading.summary.total, 1);
  const discovered = discoverSkills(root);
  assert.ok(
    discovered.some(
      (entry) => entry.name === "qualification" && entry.hasEvals,
    ),
  );
  const loaded = loadSkill(skill, { strict: true });
  assert.equal(loaded.evals[0].prompt, prompt);
  const targetPrompts = [];
  const staticTarget = createStaticProvider("qualification-marker");
  const target = {
    ...staticTarget,
    complete(prompt) {
      targetPrompts.push(prompt);
      return staticTarget.complete(prompt);
    },
  };
  const result = await runEval({
    skill: loaded,
    eval: loaded.evals[0],
    modes: ["with_skill", "without_skill"],
    target: { model: "static", provider: target },
    judge: {
      model: "static",
      provider: createStaticProvider(
        JSON.stringify({
          assertion_results: [
            { passed: true, evidence: "qualification-marker" },
          ],
        }),
      ),
    },
    workspace: join(root, "independent-results"),
    iteration: 1,
  });
  assert.equal(result.modes.with_skill.rawOutput, "qualification-marker");
  assert.equal(result.modes.without_skill.rawOutput, "qualification-marker");
  assert.equal(result.modes.without_skill.fileCount, 0);
  assert.equal(targetPrompts.length, 2);
  assert.ok(targetPrompts[0].includes("binary-skipped"));
  assert.ok(targetPrompts[0].includes("fixture-marker"));
  assert.ok(!targetPrompts[1].includes("fixture-marker"));
  assert.equal(result.modes.with_skill.grading.summary.passed, 1);
  assert.ok(
    !result.modes.with_skill.judgePrompt.includes("expected-output-marker"),
  );
  const receipt = {
    schemaVersion: 1,
    platform: toolchain.platform,
    executableSha256: toolchain.receipt.executableSha256,
    status: "consumer-smoke-passed",
    root,
    commands,
    limitations: [
      "Network and descendant-process isolation require separate qualification.",
      "Independent consumer baseline omits fixtures.",
      "Independent consumer assertion grading omits expected_output.",
      "Independent consumer represents binary input as binary-skipped without its bytes.",
      "Static-provider success does not establish semantic grading or real skill activation.",
    ],
    independent: {
      withSkillFileCount: result.modes.with_skill.fileCount,
      withoutSkillFileCount: result.modes.without_skill.fileCount,
    },
  };
  writeFileSync(join(root, "receipt.json"), JSON.stringify(receipt, null, 2));
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const receipt = await checkConformance();
  const { checkPortableConsumers } =
    await import("./check-portable-consumers.js");
  const { checkInstallation } = await import("./check-installation.js");
  const portable = await checkPortableConsumers();
  const installation = checkInstallation();
  const bridgeFixture = spawnSync(
    process.execPath,
    [
      "--test",
      join(repositoryRoot, "tests/scripts/skill-up-invocation.contract.mjs"),
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 90000,
      windowsHide: true,
    },
  );
  writeFileSync(
    join(receipt.root, "bridge-transport-fixture.json"),
    JSON.stringify(
      {
        status: bridgeFixture.status,
        stdout: bridgeFixture.stdout,
        stderr: bridgeFixture.stderr,
        error: bridgeFixture.error?.message ?? null,
        limitation:
          "Disposable test-only qualification override. Does not qualify platform containment.",
      },
      null,
      2,
    ),
  );
  assert.equal(
    bridgeFixture.status,
    0,
    bridgeFixture.stderr + bridgeFixture.stdout,
  );
  process.stdout.write(
    `${JSON.stringify({ ...receipt, portable, installation }, null, 2)}\n`,
  );
}
