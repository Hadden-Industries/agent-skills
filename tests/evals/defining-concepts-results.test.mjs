import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const resultDirectory = path.join(
  repositoryRoot,
  "evals",
  "defining-concepts",
  "results",
  "2026-08-24T092645.127Z",
);

const cases = [
  [1, "case-01-dataset-distribution-separation"],
  [4, "case-04-identity-verification-process-result"],
  [7, "case-07-charge-polysemy-and-quantity-unit"],
  [8, "case-08-irrelevant-provenance-resistance"],
];

function readJson(...segments) {
  return JSON.parse(readFileSync(path.join(...segments), "utf8"));
}

test("calibration manifests bind the exact prompts retained by successful runs", () => {
  const manifest = readJson(resultDirectory, "manifest.json");
  const attemptManifests = [
    readJson(resultDirectory, "invalid-attempts", "attempt-01", "attempt.json"),
    readJson(resultDirectory, "invalid-attempts", "attempt-02", "attempt.json"),
  ];

  for (const [evalId, caseDirectory] of cases) {
    const expectedDigest = manifest.prompt_sha256[String(evalId)];
    assert.match(expectedDigest, /^[0-9a-f]{64}$/u);

    for (const attempt of attemptManifests) {
      assert.equal(attempt.prompt_sha256[String(evalId)], expectedDigest);
    }

    for (const arm of ["with-skill", "without-skill"]) {
      const run = readJson(
        resultDirectory,
        "runs",
        caseDirectory,
        arm,
        "repetition-01",
        "run.json",
      );
      assert.equal(run.prompt_sha256, expectedDigest);
    }
  }
});
