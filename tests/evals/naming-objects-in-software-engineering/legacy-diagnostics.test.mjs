import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceCategory,
  gradeExpectations,
} from "../../../src/naming-objects-in-software-engineering/evals/analysis/legacy-diagnostics.mjs";

test("historical keyword scores preserve lexical false positives and empty denominator", () => {
  assert.equal(evidenceCategory, "selection-and-keyword-diagnostic");
  const expectations = [
    "process data is vague",
    "order entity",
    "fetch remote",
  ];
  const result = gradeExpectations(
    "This vague process handles data, but never orders or fetches HTTP.",
    expectations,
  );
  assert.deepEqual(result, {
    results: expectations.map((expectation) => ({ expectation, passed: true })),
    passedCount: 3,
    totalCount: 3,
    score: 1,
  });
  assert.equal(gradeExpectations("", expectations).score, 0);
  assert.ok(Number.isNaN(gradeExpectations("", []).score));
});
