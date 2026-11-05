import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWorkflowResult } from "../diagnostics/diagnosticContract.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { runIndexMutationGit } from "../git/gitRepository.js";
import { validateApprovedMessage } from "../message/approvedMessage.js";
import { decodeCommitProposal } from "./commitProposal.js";
import { inspectCommitObject } from "../report/commitReport.js";
import {
  applyVerificationPolicy,
  verifyCommitSignature,
} from "../signature/commitSignature.js";
import { inspectSignatureRequirements } from "../signature/signaturePreflight.js";
import {
  changeSetSha256,
  observeCommitChangeSet,
  observeStagedChangeSet,
} from "../snapshot/changeSet.js";
import { captureHeadAnchor } from "../transaction/indexInstallation.js";
import { verificationDiagnostics } from "./createCommitWorkflow.js";
import {
  assertNoGitStorageOverrides,
  assertPreallocationRepositoryState,
  preflightVerificationPolicy,
} from "./prepareWorkflow.js";
import {
  observeCurrentProposal,
  proposalStale,
  selectedIndexDigest,
} from "./proposalObservation.js";

const VERIFICATION_POLICIES = new Set(["required", "advisory", "skipped"]);
const MAXIMUM_CAPTURED_STDERR_BYTES = 16 * 1024;
const MAXIMUM_PATHSPEC_TRANSPORT_BYTES = 64 * 1024 * 1024;

function fail(code, message, options) {
  throw new WorkflowDiagnosticError(code, message, options);
}

/** Run `git commit -F -`: hooks and signing behave as on the transaction route. */
async function runNativeCommit({
  root,
  messageBytes,
  environment,
  processLauncher,
  pathspecBytes = null,
}) {
  let directory = null;
  let pathspecFile = null;
  try {
    if (pathspecBytes !== null) {
      directory = mkdtempSync(join(tmpdir(), "c2g-commit-paths-"));
      pathspecFile = join(directory, "paths");
      writeFileSync(pathspecFile, pathspecBytes, { flag: "wx", mode: 0o600 });
    }
    return await new Promise((resolvePromise, reject) => {
      const child = processLauncher(
        "git",
        [
          ...(pathspecFile === null ? [] : ["--literal-pathspecs"]),
          "commit",
          "--cleanup=verbatim",
          "-S",
          "-F",
          "-",
          ...(pathspecFile === null
            ? []
            : [
                "--only",
                `--pathspec-from-file=${pathspecFile}`,
                "--pathspec-file-nul",
              ]),
        ],
        {
          cwd: root,
          env: {
            ...environment,
            GIT_PAGER: "cat",
            PAGER: "cat",
            NO_COLOR: "1",
          },
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stderr = Buffer.alloc(0);

      child.stdout.resume();
      child.stderr.on("data", (chunk) => {
        stderr = Buffer.concat([stderr, chunk]);

        if (stderr.length > MAXIMUM_CAPTURED_STDERR_BYTES) {
          stderr = stderr.subarray(
            stderr.length - MAXIMUM_CAPTURED_STDERR_BYTES,
          );
        }
      });
      // Node emits close after spawn failure as well as normal exit. Wait for
      // that closure before removing transport that a child could still read.
      child.once("error", (error) => {
        if (pathspecFile === null) reject(error);
        else
          stderr = Buffer.from(error.message, "utf8").subarray(
            -MAXIMUM_CAPTURED_STDERR_BYTES,
          );
      });
      child.once("close", (exitCode, signal) =>
        resolvePromise({ exitCode, signal, stderr: stderr.toString("utf8") }),
      );
      child.stdin.once("error", () => {
        /* Git may exit before reading; its exit status is authoritative. */
      });
      child.stdin.end(messageBytes);
    });
  } finally {
    if (directory !== null) {
      try {
        if (pathspecFile !== null && existsSync(pathspecFile))
          unlinkSync(pathspecFile);
        rmdirSync(directory);
      } catch (error) {
        fail(
          "PATH_TRANSPORT_CLEANUP_FAILED",
          "The native path commit transport could not be cleaned up; inspect HEAD and the owned path before retrying.",
          {
            disposition: "internal-failure",
            cause: error,
            state: {
              commitState: "unknown",
              publicationState: "not-requested",
              recoveryRequired: true,
            },
            details: { pathspecFile, directory },
          },
        );
      }
    }
  }
}

function verificationAttempt({
  root,
  commitOid,
  finalPolicy,
  signaturePreflight,
  signatureVerifier,
}) {
  if (finalPolicy === "skipped") {
    return null;
  }

  if (
    finalPolicy === "advisory" &&
    signaturePreflight.backend === "ssh" &&
    signaturePreflight.trustSource?.state !== "readable"
  ) {
    return {
      status: "unavailable",
      reason: "trust-store-unreadable",
      backend: "ssh",
      identity: null,
      timestamp: new Date().toISOString(),
    };
  }

  return signatureVerifier(root, commitOid, {
    backend: signaturePreflight.backend ?? null,
  });
}

function committedResult({ commitOid, commit, verification, displayText }) {
  const comparisonMatches =
    commit.parentMatches &&
    commit.treeMatches &&
    commit.messageMatches &&
    commit.signed;
  const blocked = !comparisonMatches || verification.blocksPush;

  return createWorkflowResult({
    disposition: blocked ? "completed-with-failure" : "succeeded",
    code: blocked ? "COMMIT_POLICY_BLOCKED" : null,
    message: blocked
      ? "The commit exists, but its comparison or signature policy failed."
      : null,
    status: blocked ? "commit-blocked" : "reported",
    phase: "reported",
    route: "concise",
    commitState: "created",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    warnings: verificationDiagnostics(verification),
    recovery: {
      kind: blocked ? "inspect-state" : "none",
      automatic: false,
      requiredInputs: [],
      commands: [],
    },
    data: {
      terminalDisposition: "local-commit-recorded",
      stateStorage: "memory",
      commitOid,
      commit,
      verification,
      displayText,
    },
  });
}

/**
 * Commit an approved memory-mode proposal. Every fact is recomputed from the
 * repository first; a difference rejects the request before any mutation.
 */
export async function commitProposalWorkflow({
  proposal: encodedProposal,
  approvedSubject = null,
  messageBytes = null,
  expectedMessageSha256 = null,
  verificationPolicyOverride = null,
  cwd = process.cwd(),
  environment = process.env,
  processLauncher = spawn,
  signatureVerifier = verifyCommitSignature,
  signaturePreflightInspector = inspectSignatureRequirements,
}) {
  const proposal = decodeCommitProposal(encodedProposal);

  if (proposal.mode !== "actual") {
    fail(
      "DRAFT_PROPOSAL_NOT_COMMITTABLE",
      "A draft proposal is never committed; prepare again with --mode actual.",
      { disposition: "rejected" },
    );
  }

  if ((approvedSubject === null) === (messageBytes === null)) {
    fail(
      "MESSAGE_INPUT_REQUIRED",
      "Supply exactly one of --message or --message-stdin.",
    );
  }

  if (
    verificationPolicyOverride !== null &&
    !VERIFICATION_POLICIES.has(verificationPolicyOverride)
  ) {
    fail(
      "INVALID_VERIFICATION_POLICY",
      "Verification override must be required, advisory, or skipped.",
    );
  }

  assertNoGitStorageOverrides(environment);
  const finalPolicy = verificationPolicyOverride ?? proposal.verificationPolicy;
  const { root, manifest, selectedPaths } = await observeCurrentProposal({
    proposal,
    cwd,
  });

  assertPreallocationRepositoryState(root);
  const signaturePreflight = preflightVerificationPolicy({
    root,
    verificationPolicy: finalPolicy,
    signaturePreflightInspector,
  });
  const bytes =
    approvedSubject === null
      ? messageBytes
      : Buffer.from(`${approvedSubject}\n`, "utf8");
  const validation = validateApprovedMessage({
    manifest,
    route: "concise",
    bytes,
    repositoryTypePolicy: { allowedTypes: proposal.allowedTypes },
    messageSource:
      approvedSubject === null ? "checked-input" : "approved-subject",
    requiredMessageFormat: proposal.messageFormat ?? null,
  });

  if (
    expectedMessageSha256 !== null &&
    validation.messageSha256 !== expectedMessageSha256
  ) {
    fail(
      "MESSAGE_DIGEST_MISMATCH",
      "The supplied message bytes differ from the checked message digest.",
      { disposition: "rejected" },
    );
  }

  const headOid = proposal.headAnchor.expectedParentOids[0] ?? null;
  const pathspecByteCount =
    selectedPaths?.reduce((total, path) => total + path.length + 1, 0) ?? 0;
  if (pathspecByteCount > MAXIMUM_PATHSPEC_TRANSPORT_BYTES) {
    fail(
      "PATH_SCOPE_TOO_LARGE",
      "The selected native path transport exceeds its 64 MiB bound; nothing was changed.",
      {
        disposition: "unmet-prerequisite",
        details: {
          byteCount: pathspecByteCount,
          maximumBytes: MAXIMUM_PATHSPEC_TRANSPORT_BYTES,
        },
      },
    );
  }
  const pathspecBytes =
    selectedPaths === null
      ? null
      : Buffer.concat(
          selectedPaths.flatMap((path) => [path, Buffer.from([0])]),
        );

  if (proposal.scope === "full") {
    runIndexMutationGit(root, "add-all", []);

    if (
      changeSetSha256(observeStagedChangeSet(root, headOid)) !==
      proposal.changeSetSha256
    ) {
      const stale = proposalStale(["working-tree"]);

      stale.message =
        "The working tree changed while it was staged. The index now holds the current working tree; nothing was committed. Prepare again.";
      throw stale;
    }
  }

  if (proposal.scope === "paths") {
    // Whole-path authority covers selected staging, including newly untracked
    // files. The subsequent native --only commit isolates unrelated staging.
    try {
      runIndexMutationGit(root, "add-paths", [], { input: pathspecBytes });
    } catch (error) {
      fail(
        "PATH_STAGING_FAILED",
        "Native selected-path staging failed; no commit was attempted.",
        {
          disposition: "rejected",
          cause: error,
          state: { commitState: "absent", publicationState: "not-requested" },
          details: {
            indexMutationAttempted: true,
            selectedIndexChanged:
              selectedIndexDigest(root, selectedPaths) !==
              proposal.selectedIndexSha256,
          },
        },
      );
    }
    const keys = new Set(selectedPaths.map((path) => path.toString("base64")));
    const staged = observeStagedChangeSet(root, headOid).filter(
      ({ pathBytes }) => keys.has(pathBytes.toString("base64")),
    );
    if (changeSetSha256(staged) !== proposal.changeSetSha256) {
      const stale = proposalStale(["working-tree"]);
      stale.message =
        "Selected paths changed while being staged. Their current contents are staged; nothing was committed. Prepare again.";
      throw stale;
    }
  }

  let outcome;
  try {
    outcome = await runNativeCommit({
      root,
      messageBytes: Buffer.from(validation.displayText, "utf8"),
      environment,
      processLauncher,
      pathspecBytes,
    });
  } catch (error) {
    if (proposal.scope !== "paths" || error instanceof WorkflowDiagnosticError)
      throw error;
    const headAfter = captureHeadAnchor(root);
    const unchangedHead =
      JSON.stringify(headAfter) === JSON.stringify(proposal.headAnchor);
    fail(
      unchangedHead ? "GIT_COMMIT_FAILED" : "COMMIT_OUTCOME_UNKNOWN",
      "Native path commit execution failed; inspect the recorded index and HEAD effects before retrying.",
      {
        disposition: unchangedHead ? "rejected" : "internal-failure",
        cause: error,
        state: {
          commitState: unchangedHead ? "absent" : "unknown",
          publicationState: "not-requested",
          recoveryRequired: !unchangedHead,
        },
        details: { indexUpdated: true, headAfter },
      },
    );
  }
  const headAfter = captureHeadAnchor(root);

  if (outcome.exitCode !== 0) {
    if (JSON.stringify(headAfter) === JSON.stringify(proposal.headAnchor)) {
      fail("GIT_COMMIT_FAILED", "git commit did not create a commit.", {
        disposition: "rejected",
        state: { commitState: "absent", publicationState: "not-requested" },
        details: {
          exitCode: outcome.exitCode,
          signal: outcome.signal,
          stderrTail: outcome.stderr,
          indexUpdated: proposal.scope === "full" || proposal.scope === "paths",
        },
      });
    }

    fail(
      "COMMIT_OUTCOME_UNKNOWN",
      "git commit failed but HEAD moved; inspect HEAD before another commit.",
      {
        disposition: "internal-failure",
        state: {
          commitState: "unknown",
          publicationState: "not-requested",
          recoveryRequired: true,
        },
        details: { exitCode: outcome.exitCode, headAfter },
      },
    );
  }

  const commitOid = headAfter.expectedParentOids[0];

  try {
    const object = inspectCommitObject(root, commitOid);
    const verification = applyVerificationPolicy({
      commitOid,
      initialPolicy: proposal.verificationPolicy,
      finalPolicy,
      verificationAttempt: verificationAttempt({
        root,
        commitOid,
        finalPolicy,
        signaturePreflight,
        signatureVerifier,
      }),
    });

    return committedResult({
      commitOid,
      commit: {
        oid: commitOid,
        parentOids: object.parents,
        treeOid: object.treeOid,
        parentMatches:
          JSON.stringify(object.parents) ===
          JSON.stringify(proposal.headAnchor.expectedParentOids),
        treeMatches:
          changeSetSha256(observeCommitChangeSet(root, commitOid)) ===
          proposal.changeSetSha256,
        messageMatches: object.messageBytes.equals(
          Buffer.from(validation.displayText, "utf8"),
        ),
        signed: object.signed,
      },
      verification,
      displayText: validation.displayText,
    });
  } catch (error) {
    fail(
      "POST_COMMIT_OBSERVATION_FAILED",
      "The commit exists, but its comparison or verification could not complete.",
      {
        disposition: "internal-failure",
        cause: error,
        state: {
          commitState: "created",
          commitOid,
          publicationState: "not-requested",
        },
      },
    );
  }
}
