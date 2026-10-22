// This positive registry is executable suite policy, not inferred prompt text.
// New or draft-only cases cannot gain authority from a caller's flag.
const COMMIT_AUTHORIZATION_CASE_IDS = new Set([
  2, 6, 7, 8, 11, 13, 16, 28, 35, 36, 37, 38, 40, 41, 42, 43, 44, 45, 46, 47,
  48, 49, 50, 51, 52, 60, 64, 67, 68, 71, 72, 73, 74, 75, 76, 77,
]);

export function casePermitsCommitAuthorization(caseId) {
  return (
    Number.isSafeInteger(caseId) && COMMIT_AUTHORIZATION_CASE_IDS.has(caseId)
  );
}

export function assertCaseCommitAuthorization(caseId, authorizationEligible) {
  if (typeof authorizationEligible !== "boolean") {
    throw new TypeError("authorizationEligible must be an explicit boolean");
  }
  if (authorizationEligible && !casePermitsCommitAuthorization(caseId)) {
    throw new Error(`Case ${caseId} does not permit commit authorization`);
  }
}
