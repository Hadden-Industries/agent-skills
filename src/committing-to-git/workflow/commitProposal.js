import { TextDecoder } from "node:util";

import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";

export const COMMIT_PROPOSAL_SCHEMA = "commit-proposal/v1";
// A proposal travels as one command argument and one recovery operand.
export const MAXIMUM_PROPOSAL_BYTES = 4096;

const PROPOSAL_PREFIX = "ctg1.";
const PROPOSAL_FIELDS = [
  "schema",
  "repositoryRoot",
  "mode",
  "scope",
  "headAnchor",
  "changeSetSha256",
  "changeUnitCount",
  "allowedTypes",
  "verificationPolicy",
];
const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function invalid(message) {
  throw new WorkflowDiagnosticError("INVALID_PROPOSAL", message, {
    recovery: {
      kind: "correct-input",
      requiredInputs: ["the exact proposal returned by workflow prepare"],
      commands: [],
      automatic: false,
    },
  });
}

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function validHeadAnchor(anchor) {
  if (!hasExactKeys(anchor, ["headKind", "targetRef", "expectedParentOids"])) {
    return false;
  }

  const parents = anchor.expectedParentOids;

  if (
    !Array.isArray(parents) ||
    !parents.every((oid) => FULL_OBJECT_ID.test(oid))
  ) {
    return false;
  }

  switch (anchor.headKind) {
    case "attached":
      return typeof anchor.targetRef === "string" && parents.length === 1;
    case "unborn":
      return typeof anchor.targetRef === "string" && parents.length === 0;
    case "detached":
      return anchor.targetRef === null && parents.length === 1;
    default:
      return false;
  }
}

/** Facts that bind approval; never authority, always recomputed before use. */
export function validateCommitProposal(proposal) {
  if (
    !hasExactKeys(proposal, PROPOSAL_FIELDS) ||
    proposal.schema !== COMMIT_PROPOSAL_SCHEMA ||
    typeof proposal.repositoryRoot !== "string" ||
    proposal.repositoryRoot.length === 0 ||
    !new Set(["actual", "draft"]).has(proposal.mode) ||
    !new Set(["staged", "full"]).has(proposal.scope) ||
    !validHeadAnchor(proposal.headAnchor) ||
    !SHA256.test(proposal.changeSetSha256) ||
    !Number.isSafeInteger(proposal.changeUnitCount) ||
    proposal.changeUnitCount < 1 ||
    !Array.isArray(proposal.allowedTypes) ||
    !proposal.allowedTypes.every((type) => typeof type === "string") ||
    !new Set(["required", "advisory", "skipped"]).has(
      proposal.verificationPolicy,
    )
  ) {
    invalid(`The proposal is not a valid ${COMMIT_PROPOSAL_SCHEMA} value.`);
  }

  return proposal;
}

export function encodeCommitProposal(proposal) {
  const { headAnchor } = validateCommitProposal(proposal);
  // Fixed key order at every level makes the encoding canonical.
  const ordered = Object.fromEntries(
    PROPOSAL_FIELDS.map((field) => [
      field,
      field === "headAnchor"
        ? {
            headKind: headAnchor.headKind,
            targetRef: headAnchor.targetRef,
            expectedParentOids: [...headAnchor.expectedParentOids],
          }
        : proposal[field],
    ]),
  );
  const encoded = `${PROPOSAL_PREFIX}${Buffer.from(JSON.stringify(ordered), "utf8").toString("base64url")}`;

  if (Buffer.byteLength(encoded) > MAXIMUM_PROPOSAL_BYTES) {
    throw new WorkflowDiagnosticError(
      "PROPOSAL_TOO_LARGE",
      `The proposal exceeds ${MAXIMUM_PROPOSAL_BYTES} bytes; use --state-storage disk.`,
      { disposition: "rejected" },
    );
  }

  return encoded;
}

export function decodeCommitProposal(text) {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text) > MAXIMUM_PROPOSAL_BYTES ||
    !text.startsWith(PROPOSAL_PREFIX) ||
    !/^[A-Za-z0-9_-]+$/u.test(text.slice(PROPOSAL_PREFIX.length))
  ) {
    invalid("The proposal is not an encoded commit proposal.");
  }

  const bytes = Buffer.from(text.slice(PROPOSAL_PREFIX.length), "base64url");
  let proposal;

  try {
    proposal = JSON.parse(STRICT_UTF8_DECODER.decode(bytes));
  } catch {
    invalid("The proposal does not contain strict UTF-8 JSON.");
  }

  if (encodeCommitProposal(validateCommitProposal(proposal)) !== text) {
    invalid("The proposal is not in its canonical encoding.");
  }

  return proposal;
}
