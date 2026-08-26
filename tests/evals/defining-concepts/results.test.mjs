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

test("all retained manifests bind the exact prompts used by successful runs", () => {
  const directories = resultDirectories();
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

test("all retained grades preserve frozen expectation text and consistent totals", () => {
  for (const resultDirectory of resultDirectories()) {
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

test("current-schema manifests and aggregates agree with retained grades", () => {
  for (const resultDirectory of resultDirectories()) {
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
