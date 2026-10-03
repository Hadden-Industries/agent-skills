import {
  canonicalJsonBytes,
  sha256Hex,
} from "../../../../../scripts/evaluation/runtime.js";

/** Reviewed semantic judgments are distinct from execution and keyword diagnostics. */
export function validateSemanticGrade({ evaluationCase, outcome, grade }) {
  if (outcome.status !== "completed" || outcome.closureStatus !== "safe")
    throw new Error(
      "Incomplete or unsafe execution cannot receive a semantic pass",
    );
  if (
    grade?.schemaVersion !== 1 ||
    grade.evidenceCategory !== "reviewed-semantic-grade" ||
    typeof grade.graderVersion !== "string" ||
    !grade.graderVersion ||
    typeof grade.rationale !== "string" ||
    !grade.rationale.trim()
  )
    throw new Error("Semantic grade provenance is incomplete");
  if (
    grade.authoritativeSha256 !== outcome.authoritativeSha256 ||
    grade.caseId !== evaluationCase.id ||
    outcome.caseId !== evaluationCase.id
  )
    throw new Error("Semantic grade identity mismatch");
  if (
    !Array.isArray(grade.assertions) ||
    grade.assertions.length !== evaluationCase.assertions.length
  )
    throw new Error("Semantic grade must cover every assertion");
  for (const [index, judgment] of grade.assertions.entries()) {
    if (
      judgment.assertion !== evaluationCase.assertions[index] ||
      !["pass", "fail", "unknown"].includes(judgment.status) ||
      typeof judgment.reason !== "string" ||
      !judgment.reason.trim()
    )
      throw new Error("Semantic assertion judgment is missing or reordered");
  }
  const status = grade.assertions.some((item) => item.status === "fail")
    ? "fail"
    : grade.assertions.some((item) => item.status === "unknown")
      ? "unknown"
      : "pass";
  return Object.freeze({
    schemaVersion: 1,
    evidenceCategory: grade.evidenceCategory,
    status,
    gradeSha256: sha256Hex(canonicalJsonBytes(grade)),
  });
}
