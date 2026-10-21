/** Bind fresh-preparation inputs to admitted historical requests, never to stored commands. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { projectRecovery } from "../diagnostics/diagnosticContract.js";
import { readTransaction } from "../transaction/transactionWorkspace.js";
import { activeGitOperations, readOnlyGitText } from "../git/gitRepository.js";
import {
  captureHeadAnchor,
  readIndexIdentity,
} from "../transaction/indexInstallation.js";
import { captureStagedSourceIdentity } from "../snapshot/commitSnapshot.js";
import { readStableFile } from "../../../lib/filesystem/stableFile.js";
import {
  normalizeScopePayload,
  normalizeEvidencePlan,
} from "./preparationInputs.js";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MAXIMUM_INPUT_BYTES = 8 * 1024 * 1024;

/** Reuse native input admission and compare pre-routing canonical identities. */
function retainedRequest(transaction) {
  const scope = transaction.scope;
  let normalizedScope = null;
  if (scope?.kind === "paths") {
    normalizedScope = normalizeScopePayload(scope.selectors);
    if (digest(normalizedScope.canonicalBytes) !== scope.selectorDigest)
      throw new Error(
        "Retained selectors do not match their pre-routing digest.",
      );
  } else if (
    !["full", "staged"].includes(scope?.kind) ||
    scope.selectors !== null ||
    digest(Buffer.from(`${scope.kind}\n`)) !== scope.selectorDigest
  ) {
    throw new Error("Retained non-path scope is invalid.");
  }
  const evidence = normalizeEvidencePlan({
    schemaVersion: 1,
    groups: transaction.initialEvidencePlan?.groups,
  });
  if (
    digest(evidence.canonicalBytes) !== transaction.initialEvidencePlan.sha256
  )
    throw new Error("Retained evidence does not match its pre-routing digest.");
  if (!["actual", "draft"].includes(transaction.mode))
    throw new Error("Original mode is unavailable.");
  return {
    scope: normalizedScope?.canonicalBytes ?? null,
    evidence: evidence.canonicalBytes,
  };
}

function bindingFor(path, bytes) {
  const opened = readStableFile(path, MAXIMUM_INPUT_BYTES, {
    rejectLinkedAncestors: true,
  });
  if (!opened.bytes.equals(bytes))
    throw new Error("Correction input bytes changed.");
  if (opened.stat.nlink !== 1n)
    throw new Error("Correction inputs must not have hard-link aliases.");
  return {
    sha256: digest(bytes),
    byteCount: bytes.length,
    device: String(opened.stat.dev),
    inode: String(opened.stat.ino),
  };
}

/** Create owned correction files during rejection via the allocation owner.
 * Throws on request, file identity or I/O failure; callers must withhold runnable
 * advice and retain the mandatory stop. Partial files grant no execution authority.
 */
export function createCorrectionInputs(
  transaction,
  writeInput,
  failureInjector,
) {
  const request = retainedRequest(transaction);
  const bindings = { scope: null, evidence: null };
  for (const role of ["scope", "evidence"]) {
    if (request[role] === null) continue;
    const name = `correction-${role}.json`;
    const path = resolve(transaction.attemptDirectory, name);
    failureInjector?.("correction-input-creation");
    writeInput(path, request[role]);
    bindings[role] = { name, ...bindingFor(path, request[role]) };
  }
  return bindings;
}

/** Read the exact dedicated files and admitted request without rewriting either.
 * Throws on unsafe or changed bytes, ownership identity or retained request.
 * The transaction owner retains the files; successful inspection grants no approval.
 */
export function inspectCorrectionInputs(transaction) {
  const request = retainedRequest(transaction);
  const bindings = transaction.preparationFailure?.correctionInputs;
  if (!bindings)
    throw new Error("Dedicated correction inputs were not retained.");
  const paths = {};
  for (const role of ["scope", "evidence"]) {
    const binding = bindings[role];
    if (request[role] === null) {
      if (binding !== null) throw new Error("Unexpected scope input.");
      continue;
    }
    if (!binding || binding.name !== `correction-${role}.json`)
      throw new Error("Correction input role is invalid.");
    const path = resolve(transaction.attemptDirectory, binding.name);
    if (
      JSON.stringify(bindingFor(path, request[role])) !==
      JSON.stringify({
        sha256: binding.sha256,
        byteCount: binding.byteCount,
        device: binding.device,
        inode: binding.inode,
      })
    )
      throw new Error("Correction input identity changed.");
    paths[role] = path;
  }
  return { paths, bindings };
}

function requireCorrectionSource(transaction) {
  if (
    transaction.phase !== "stopped" ||
    transaction.terminalDisposition !== "no-commit-stopped" ||
    transaction.preparationFailure?.diagnostic.code !==
      "DETAILED_MESSAGE_LIMIT_EXCEEDED" ||
    !transaction.preparationFailure.snapshotObservation
  )
    throw new Error(
      "A retained detailed-limit stop with validated snapshot observations is required.",
    );
}

/** Observe repository anchors without writing an index, object, worksheet or record. */
function assertCurrentCorrectionAnchors(transaction) {
  const observation = transaction.preparationFailure.snapshotObservation;
  const root = transaction.repositoryRoot;
  const sourceIndexSha256 =
    transaction.scope.kind === "staged"
      ? captureStagedSourceIdentity(root).sha256
      : (readIndexIdentity(
          resolve(root, readOnlyGitText(root, "git-path", ["index"]).trim()),
        ).sha256 ?? null);
  if (
    JSON.stringify(captureHeadAnchor(root)) !==
      JSON.stringify(observation.headAnchor) ||
    sourceIndexSha256 !== observation.sourceIndexSha256 ||
    activeGitOperations(root).length > 0
  )
    throw new Error(
      "Repository HEAD, source index or active-operation state changed.",
    );
}

/** Return bounded correction operands only while retained request and anchors qualify.
 * Reads repository and owned files without mutation. Any admission failure yields
 * unavailable advice; the fresh operation must revalidate before installation.
 */
export function correctionAdvice(transaction) {
  const unavailable = {
    status: "inputs-unavailable",
    inputs: null,
    commands: [],
    requiredInputs: [
      "Current validated scope, evidence and repository anchors",
    ],
  };
  try {
    requireCorrectionSource(transaction);
    const inputs = inspectCorrectionInputs(transaction);
    assertCurrentCorrectionAnchors(transaction);
    const arguments_ = [
      "workflow",
      "prepare",
      "--mode",
      transaction.mode,
      "--scope",
      transaction.scope.kind,
      "--evidence-plan",
      inputs.paths.evidence,
      "--verification",
      transaction.verificationPolicy,
      "--correction-from",
      resolve(transaction.attemptDirectory, "transaction.json"),
      ...(inputs.paths.scope ? ["--scope-file", inputs.paths.scope] : []),
      ...(transaction.repositoryTypePolicy.allowedTypes ?? []).flatMap(
        (type) => ["--allowed-type", type],
      ),
    ];
    const recovery = projectRecovery({
      kind: "correct-input",
      automatic: false,
      requiredInputs: Object.values(inputs.paths),
      commands: [{ arguments: arguments_ }],
    });
    return {
      status: "ready",
      inputs,
      commands: recovery.commands,
      requiredInputs: recovery.requiredInputs,
      freshness:
        "The fresh operation revalidates retained inputs and compares HEAD, selected tree, unit count and source index before index installation. No approvals or check receipts transfer.",
    };
  } catch {
    return unavailable;
  }
}

/** Admit the stopped source and exact normalized request before fresh allocation.
 * Reads only; rejects drift with CORRECTION_INPUTS_CHANGED and no runnable advice.
 * Admission transfers no approvals, receipts or ownership to the fresh attempt.
 */
export function admitCorrectionSource({
  transactionPath,
  root,
  options,
  normalizedScope,
  normalizedEvidence,
}) {
  try {
    const source = readTransaction(transactionPath);
    requireCorrectionSource(source);
    inspectCorrectionInputs(source);
    assertCurrentCorrectionAnchors(source);
    const request = retainedRequest(source);
    if (
      resolve(source.repositoryRoot) !== resolve(root) ||
      source.mode !== options.mode ||
      source.scope.kind !== options.scope ||
      source.verificationPolicy !== options.verificationPolicy ||
      options.messageFormat !== null ||
      JSON.stringify(source.repositoryTypePolicy.allowedTypes) !==
        JSON.stringify(options.allowedTypes) ||
      !(request.scope === null
        ? normalizedScope === null
        : request.scope.equals(
            normalizedScope?.canonicalBytes ?? Buffer.alloc(0),
          )) ||
      !request.evidence.equals(normalizedEvidence.canonicalBytes)
    )
      throw new Error(
        "Fresh request differs from the original scope, evidence or policy.",
      );
    return source;
  } catch {
    throw new WorkflowDiagnosticError(
      "CORRECTION_INPUTS_CHANGED",
      "The stopped correction no longer has matching request, inputs and repository anchors. Reassess current scope, evidence and authority before ordinary fresh preparation.",
      {
        recovery: {
          kind: "satisfy-prerequisite",
          automatic: false,
          requiredInputs: ["Current validated request and evidence"],
          commands: [],
        },
      },
    );
  }
}

/** Compare a validated fresh snapshot before deferred real-index installation.
 * Reads source inputs and repository anchors, throwing CORRECTION_CANDIDATE_CHANGED
 * on drift. The fresh preparation owner remains responsible for stop persistence.
 */
export function assertCorrectionSnapshot(source, observation) {
  try {
    inspectCorrectionInputs(source);
    assertCurrentCorrectionAnchors(source);
    if (
      JSON.stringify(observation) !==
      JSON.stringify(source.preparationFailure.snapshotObservation)
    )
      throw new Error("Selected candidate changed.");
  } catch {
    throw new WorkflowDiagnosticError(
      "CORRECTION_CANDIDATE_CHANGED",
      "The fresh snapshot differs from the stopped attempt or its retained inputs changed. No prepared index was installed; reassess scope, evidence and authority.",
    );
  }
}
