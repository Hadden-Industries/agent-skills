import assert from "node:assert/strict";
import test from "node:test";
import { validateSemanticGrade } from "../../../src/naming-objects-in-software-engineering/evals/assurance/v1/grading-contract.mjs";
test("semantic grades bind complete ordered judgments and cannot promote lexical passes", () => {
  const evaluationCase = { id: 1, assertions: ["Denotes the correct concept"] };
  const outcome = {
    caseId: 1,
    status: "completed",
    closureStatus: "safe",
    authoritativeSha256: "a".repeat(64),
  };
  const grade = {
    schemaVersion: 1,
    evidenceCategory: "reviewed-semantic-grade",
    graderVersion: "reviewer-v1",
    rationale: "Review against task",
    caseId: 1,
    authoritativeSha256: outcome.authoritativeSha256,
    assertions: [
      {
        assertion: evaluationCase.assertions[0],
        status: "fail",
        reason: "Lexically valid but denotes a different concept",
      },
    ],
  };
  assert.throws(
    () =>
      validateSemanticGrade({
        evaluationCase,
        outcome: { ...outcome, caseId: 2 },
        grade,
      }),
    /identity mismatch/u,
  );
  assert.equal(
    validateSemanticGrade({ evaluationCase, outcome, grade }).status,
    "fail",
  );
  assert.throws(
    () =>
      validateSemanticGrade({
        evaluationCase,
        outcome,
        grade: { ...grade, assertions: [] },
      }),
    /every assertion/u,
  );
  assert.throws(
    () =>
      validateSemanticGrade({
        evaluationCase,
        outcome: { ...outcome, status: "failed" },
        grade,
      }),
    /Incomplete/u,
  );
  assert.throws(
    () =>
      validateSemanticGrade({
        evaluationCase,
        outcome,
        grade: { ...grade, evidenceCategory: "keyword-diagnostic" },
      }),
    /provenance/u,
  );
  assert.equal(
    validateSemanticGrade({
      evaluationCase,
      outcome,
      grade: {
        ...grade,
        assertions: [{ ...grade.assertions[0], status: "unknown" }],
      },
    }).status,
    "unknown",
  );
});
