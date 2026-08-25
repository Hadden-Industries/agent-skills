import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

import { activeGitOperations, indexMatchesTree } from "../git/gitRepository.js";
import {
  bindReviewCoverage,
  canonicalizeEvidencePlan,
  createVerifiedReviewReceipt,
  findReviewCatalogRevisionPath,
  readReviewCatalog,
  requiredReviewPacketIds,
  reviseReviewCatalog,
  verifyReviewReceipt,
} from "../inspection/reviewCatalog.js";
import { stableJsonBytes } from "../inspection/inlineEvidenceCapsule.js";
import { renderCommitMessage } from "../message/commitMessageRenderer.js";
import {
  readTransactionOwnedFile,
  replaceCanonicalMessage,
  replaceTransactionOwnedJson,
} from "../message/canonicalMessageState.js";
import { captureHeadAnchor } from "../transaction/indexInstallation.js";
import {
  MAXIMUM_INITIAL_JSON_INPUT_BYTES,
  advanceTransaction,
  readTransaction,
  updateTransaction,
} from "../transaction/transactionWorkspace.js";
import {
  acquireEvidence,
  cleanupEvidenceSpools,
  manifestEnvironment,
} from "./prepareWorkflow.js";
import {
  MessageWorkflowError,
  asMessageWorkflowError,
  assertMessageResultBudget,
  messageErrorResult,
  parseMessageWorkflowArguments,
  readExactRecordedSnapshot,
} from "./checkMessageWorkflow.js";

const CONTENT_NAME = "content.json";
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const COMPLETE_COMMON_KEYS = [
  "schemaVersion",
  "authoringState",
  "evidenceGroups",
  "subject",
  "sharedRationales",
  "userExperienceChanges",
  "mode",
];

function fail(code, message, { exitCode = 2, details = {} } = {}) {
  throw new MessageWorkflowError(code, message, { exitCode, details });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, keys, label) {
  if (!isPlainObject(value)) {
    fail("INVALID_MESSAGE_CONTENT", `${label} must be an object.`);
  }

  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      "INVALID_MESSAGE_CONTENT",
      `${label} contains missing or unknown members.`,
      { details: { label, expected, actual } },
    );
  }
}

function decodeContent(bytes) {
  let text;

  try {
    text = STRICT_UTF8_DECODER.decode(bytes);
  } catch {
    fail("INVALID_CONTENT_UTF8", "The fixed content.json is not strict UTF-8.");
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    fail(
      "INVALID_MESSAGE_CONTENT",
      `The fixed content.json is invalid JSON: ${error.message}`,
    );
  }
}

function assertSelectionContainer(entry, label, extraKeys = []) {
  assertExactKeys(entry, ["selection", ...extraKeys], label);
}

function assertCompleteContentShape(content) {
  if (!isPlainObject(content) || content.schemaVersion !== 3) {
    fail(
      "INVALID_MESSAGE_CONTENT",
      "Extended finalization requires schema-version-3 semantic content.",
    );
  }

  if (content.authoringState !== "complete") {
    fail(
      "INCOMPLETE_SEMANTIC_CONTENT",
      "Set authoringState to complete only after every semantic decision and required review is complete.",
    );
  }

  if (!new Set(["detailed", "bulk"]).has(content.mode)) {
    fail(
      "INVALID_MESSAGE_CONTENT",
      "Semantic message mode must be detailed or bulk.",
    );
  }

  assertExactKeys(
    content,
    [
      ...COMPLETE_COMMON_KEYS,
      content.mode === "bulk" ? "domains" : "fileNotes",
    ],
    "Complete semantic content",
  );
  assertExactKeys(
    content.subject,
    ["type", "scope", "description"],
    "Commit subject",
  );

  if (
    !Array.isArray(content.evidenceGroups) ||
    content.evidenceGroups.length === 0
  ) {
    fail(
      "INVALID_MESSAGE_CONTENT",
      "Evidence groups must be a nonempty array.",
    );
  }

  for (const [index, group] of content.evidenceGroups.entries()) {
    assertExactKeys(
      group,
      ["selection", "policy", "basis"],
      `Evidence group ${index + 1}`,
    );
    assertExactKeys(
      group.basis,
      ["kind", "note"],
      `Evidence group ${index + 1} basis`,
    );
  }

  for (const [field, entries] of [
    ["sharedRationales", content.sharedRationales],
    ["fileNotes", content.mode === "detailed" ? content.fileNotes : []],
  ]) {
    if (!Array.isArray(entries)) {
      fail("INVALID_MESSAGE_CONTENT", `${field} must be an array.`);
    }

    entries.forEach((entry, index) =>
      assertSelectionContainer(entry, `${field} entry ${index + 1}`, [
        "reasons",
      ]),
    );
  }

  if (!Array.isArray(content.userExperienceChanges)) {
    fail("INVALID_MESSAGE_CONTENT", "userExperienceChanges must be an array.");
  }

  if (content.mode === "bulk") {
    if (!Array.isArray(content.domains) || content.domains.length === 0) {
      fail(
        "MISSING_SEMANTIC_DECISIONS",
        "Complete bulk content requires at least one semantic domain.",
      );
    }

    content.domains.forEach((domain, index) =>
      assertSelectionContainer(domain, `Domain ${index + 1}`, [
        "title",
        "reasons",
      ]),
    );
  }
}

function containedPath(attemptDirectory, path, label) {
  const absolute = resolve(path);
  const contained = relative(attemptDirectory, absolute);

  if (
    contained === "" ||
    contained === ".." ||
    contained.startsWith(`..${sep}`) ||
    isAbsolute(contained)
  ) {
    fail(
      "MESSAGE_ARTIFACT_ESCAPES_TRANSACTION",
      `${label} escapes its transaction.`,
    );
  }

  return absolute;
}

function assertStableRecordedPath(attemptDirectory, path, label) {
  const absolute = containedPath(attemptDirectory, path, label);
  const stat = lstatSync(absolute);

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(
      "MESSAGE_ARTIFACT_REPLACED",
      `${label} must be a non-link regular file.`,
    );
  }

  if (realpathSync(absolute) !== absolute) {
    fail(
      "MESSAGE_ARTIFACT_REPLACED",
      `${label} no longer resolves to its recorded path.`,
    );
  }

  return absolute;
}

function assertFinalizeTransaction(transaction, transactionPath) {
  if (transaction.route !== "extended") {
    fail(
      "FINALIZER_REQUIRES_EXTENDED_TRANSACTION",
      "Structured finalization requires an extended transaction; concise text remains valid through message check or direct subject approval.",
      {
        details: {
          transaction: resolve(transactionPath),
          route: transaction.route,
        },
      },
    );
  }

  if (
    !new Set(["review-pending", "message-ready"]).has(transaction.phase) ||
    transaction.commit !== null
  ) {
    fail(
      "MESSAGE_FINALIZE_NOT_ALLOWED",
      `Structured finalization is unavailable in phase ${transaction.phase}.`,
      {
        details: {
          transaction: resolve(transactionPath),
          route: transaction.route,
        },
      },
    );
  }
}

function readCurrentCatalog(transaction) {
  const expectedReviewDirectory = resolve(
    transaction.attemptDirectory,
    "review",
  );
  const catalogPath = assertStableRecordedPath(
    transaction.attemptDirectory,
    transaction.review.catalogPath,
    "Current review catalog",
  );

  if (
    relative(expectedReviewDirectory, catalogPath).startsWith(`..${sep}`) ||
    isAbsolute(relative(expectedReviewDirectory, catalogPath))
  ) {
    fail(
      "MESSAGE_ARTIFACT_ESCAPES_TRANSACTION",
      "Review catalog is outside the fixed review directory.",
    );
  }

  const catalog = readReviewCatalog(catalogPath);

  if (
    catalog.catalogSha256 !== transaction.review.catalogSha256 ||
    catalog.evidencePlanSha256 !== transaction.review.evidencePlanSha256 ||
    catalog.indexTreeOid !== transaction.snapshot.indexTreeOid ||
    catalog.manifestSha256 !== transaction.initialEvidencePlan.manifestSha256
  ) {
    fail(
      "REVIEW_CATALOG_MISMATCH",
      "The current review catalog does not match the transaction snapshot and evidence plan.",
    );
  }

  return catalog;
}

function readCurrentEvidencePlan(transactionPath, transaction, manifest) {
  const recordedPath = assertStableRecordedPath(
    transaction.attemptDirectory,
    transaction.review.evidencePlanPath,
    "Current evidence plan",
  );
  const name = basename(recordedPath);
  const opened = readTransactionOwnedFile({
    transactionPath,
    artifactName: name,
    maximumBytes: MAXIMUM_INITIAL_JSON_INPUT_BYTES,
    label: "Current evidence plan",
    allowPathReplacement: false,
  });
  let stored;

  try {
    stored = JSON.parse(STRICT_UTF8_DECODER.decode(opened.bytes));
  } catch (error) {
    fail(
      "INVALID_EVIDENCE_PLAN",
      `Current evidence plan is invalid JSON: ${error.message}`,
    );
  }

  const canonical = canonicalizeEvidencePlan({
    manifest,
    groups: stored.groups,
  });

  if (
    canonical.evidencePlanSha256 !== transaction.review.evidencePlanSha256 ||
    stored.evidencePlanSha256 !== canonical.evidencePlanSha256 ||
    stored.manifestSha256 !== canonical.manifestSha256 ||
    !stableJsonBytes(stored).equals(stableJsonBytes(canonical))
  ) {
    fail(
      "EVIDENCE_PLAN_MISMATCH",
      "The current evidence plan artifact is not canonical for this snapshot.",
    );
  }

  return canonical;
}

function receiptCoverage(transaction, catalog) {
  const receipt =
    transaction.review.receipt?.requiredPacketsReviewed === true
      ? transaction.review.receipt
      : null;

  if (
    !receipt ||
    !findReviewCatalogRevisionPath(catalog.catalogPath, receipt.catalogSha256)
  ) {
    return { receipt: null, coverage: null };
  }

  const revisionPath = findReviewCatalogRevisionPath(
    catalog.catalogPath,
    receipt.catalogSha256,
  );

  try {
    return {
      receipt,
      coverage: verifyReviewReceipt({ catalogPath: revisionPath, receipt }),
    };
  } catch (error) {
    fail(
      "REVIEW_RECEIPT_INVALID",
      `Review receipt is invalid: ${error.message}`,
    );
  }
}

function assertLiveSnapshotAnchor(transaction, manifest) {
  if (
    JSON.stringify(captureHeadAnchor(transaction.repositoryRoot)) !==
    JSON.stringify(transaction.headAnchor)
  ) {
    fail("HEAD_DRIFT", "HEAD changed after evidence preparation.", {
      exitCode: 1,
    });
  }

  const operations = activeGitOperations(transaction.repositoryRoot);

  if (operations.length > 0) {
    fail(
      "ACTIVE_GIT_OPERATION",
      `Message finalization cannot revise evidence during an active ${operations.join(", ")} operation.`,
      { exitCode: 1 },
    );
  }

  if (
    !indexMatchesTree(
      transaction.repositoryRoot,
      manifest.indexTreeOid,
      manifestEnvironment(manifest),
    )
  ) {
    fail(
      "INDEX_DRIFT",
      "The prepared index tree changed before evidence revision.",
      {
        exitCode: 1,
      },
    );
  }
}

function writeEvidencePlanRevision(transaction, evidencePlan) {
  const path = join(
    transaction.attemptDirectory,
    `evidence-plan-${evidencePlan.evidencePlanSha256}.json`,
  );
  const bytes = stableJsonBytes(evidencePlan);

  if (existsSync(path)) {
    if (!readFileSync(path).equals(bytes)) {
      fail(
        "EVIDENCE_PLAN_COLLISION",
        "An immutable evidence-plan revision has conflicting bytes.",
      );
    }
  } else {
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  }

  return path;
}

function canonicalContentGroups(evidencePlan) {
  return evidencePlan.groups.map(({ selection, policy, basis }) => ({
    selection,
    policy,
    basis,
  }));
}

function canonicalSelection(selection) {
  return Object.fromEntries(
    Object.entries(selection)
      .sort(([left], [right]) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)),
      )
      .map(([key, value]) => [
        key,
        Array.isArray(value)
          ? [...value].sort((left, right) =>
              Buffer.compare(Buffer.from(left), Buffer.from(right)),
            )
          : value,
      ]),
  );
}

function normalizeSemanticSelections(content) {
  for (const field of ["sharedRationales", "fileNotes", "domains"]) {
    if (!Array.isArray(content[field])) {
      continue;
    }

    content[field] = content[field].map((entry) => ({
      ...entry,
      selection: canonicalSelection(entry.selection),
    }));
  }

  return content;
}

function updateReviewTransaction(transactionPath, review, status) {
  const transaction = readTransaction(transactionPath);

  assertFinalizeTransaction(transaction, transactionPath);
  return updateTransaction(transactionPath, transaction.phase, {
    ...transaction,
    phase: transaction.phase,
    status,
    review,
  });
}

function requireEvidence(
  transactionPath,
  transaction,
  review,
  content,
  opened,
  evidenceDelta,
) {
  replaceTransactionOwnedJson({
    transactionPath,
    artifactName: CONTENT_NAME,
    value: content,
    expectedIdentity: opened.identity,
  });
  const latest = readTransaction(transactionPath);
  const next = {
    ...latest,
    phase: "review-pending",
    status: "evidence-required",
    review,
  };

  if (latest.phase === "message-ready") {
    advanceTransaction(transactionPath, "message-ready", next);
  } else {
    updateTransaction(transactionPath, "review-pending", next);
  }

  const firstPage = evidenceDelta.queue?.firstPage ?? null;
  const result = {
    schemaVersion: 1,
    status: "evidence-required",
    phase: "review-pending",
    terminalDisposition: null,
    route: "extended",
    transaction: resolve(transactionPath),
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    canonical: false,
    evidenceDelta: {
      newlyRequiredPacketCount: evidenceDelta.requiredPacketCount,
      firstQueuePage:
        firstPage === null
          ? null
          : resolve(transaction.attemptDirectory, firstPage.artifact),
      firstQueuePageSha256: firstPage?.sha256 ?? null,
    },
    displayText: null,
  };

  return assertMessageResultBudget(result);
}

function validationSummary(validation) {
  return {
    valid: validation.valid,
    subject: validation.subject,
    sections: validation.sections,
    files: validation.files,
  };
}

function finalizedResult({ transactionPath, rendered, canonical }) {
  return {
    schemaVersion: 1,
    status: "message-ready",
    phase: "message-ready",
    terminalDisposition: null,
    route: "extended",
    transaction: resolve(transactionPath),
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    canonical: true,
    messageSource: "finalized-extended",
    messageRevision: canonical.messageRevision,
    presentationWarnings: rendered.presentationWarnings,
    messageSha256: canonical.messageSha256,
    validation: validationSummary(rendered.validation),
    displayText: canonical.displayText,
  };
}

export async function finalizeMessageWorkflow({
  transactionPath,
  afterContentOpen,
} = {}) {
  if (typeof transactionPath !== "string" || transactionPath.length === 0) {
    fail("MISSING_ARGUMENT", "--transaction is required for message finalize.");
  }

  let transaction = readTransaction(transactionPath);

  assertFinalizeTransaction(transaction, transactionPath);
  const opened = readTransactionOwnedFile({
    transactionPath,
    artifactName: CONTENT_NAME,
    maximumBytes: MAXIMUM_INITIAL_JSON_INPUT_BYTES,
    label: "Fixed semantic message content",
    afterOpen: afterContentOpen,
    allowPathReplacement: true,
  });
  const content = decodeContent(opened.bytes);

  if (
    new Set(["detailed", "bulk"]).has(content?.mode) &&
    content.mode !== transaction.review.structuredMessageMode
  ) {
    fail(
      "MESSAGE_PRESENTATION_MODE_MISMATCH",
      `Semantic content mode ${content.mode} does not match the helper-selected ${transaction.review.structuredMessageMode} mode.`,
    );
  }

  assertCompleteContentShape(content);
  const snapshot = readExactRecordedSnapshot(transactionPath);

  transaction = snapshot.transaction;
  assertFinalizeTransaction(transaction, transactionPath);
  const manifest = snapshot.manifest;
  const currentCatalog = readCurrentCatalog(transaction);
  const recordedPlan = readCurrentEvidencePlan(
    transactionPath,
    transaction,
    manifest,
  );
  const authoredPlan = canonicalizeEvidencePlan({
    manifest,
    groups: content.evidenceGroups,
  });
  const planChanged =
    authoredPlan.evidencePlanSha256 !== recordedPlan.evidencePlanSha256;
  const prior = receiptCoverage(transaction, currentCatalog);
  let catalog = currentCatalog;
  let evidencePlan = recordedPlan;
  let review = transaction.review;
  let receipt = prior.receipt;
  const normalized = normalizeSemanticSelections(structuredClone(content));

  if (planChanged) {
    assertLiveSnapshotAnchor(transaction, manifest);
    let records = [];

    try {
      records = await acquireEvidence({
        root: transaction.repositoryRoot,
        manifest,
        evidencePlan: authoredPlan,
        attemptDirectory: transaction.attemptDirectory,
      });
      const evidenceManifest = {
        ...manifest,
        manifestSha256: authoredPlan.manifestSha256,
        evidenceByGroupId: Object.fromEntries(
          records.map(({ group, empty, path }) => [
            group.id,
            empty ? Buffer.alloc(0) : readFileSync(path),
          ]),
        ),
      };
      const coveredCatalog = prior.coverage
        ? bindReviewCoverage(currentCatalog, prior.coverage)
        : currentCatalog;
      const revision = reviseReviewCatalog({
        manifest: evidenceManifest,
        priorCatalog: coveredCatalog,
        evidencePlan: authoredPlan,
      });

      catalog = revision.catalog;
      evidencePlan = authoredPlan;
      const evidencePlanPath = writeEvidencePlanRevision(
        transaction,
        evidencePlan,
      );
      review = {
        ...transaction.review,
        catalogPath: catalog.catalogPath,
        catalogSha256: catalog.catalogSha256,
        evidencePlanPath,
        evidencePlanSha256: evidencePlan.evidencePlanSha256,
        // Keep the helper-owned delivery round distinct from the catalog's
        // full requirements so unchanged, previously verified packets are
        // never sent back through the agent's context window.
        deliveryPacketIds: revision.evidenceDelta.requiredPacketIds,
        queue: revision.evidenceDelta.queue,
        receipt: null,
        traversal: null,
      };
      normalized.evidenceGroups = canonicalContentGroups(evidencePlan);

      if (revision.evidenceDelta.requiredPacketCount > 0) {
        return requireEvidence(
          transactionPath,
          transaction,
          review,
          normalized,
          opened,
          revision.evidenceDelta,
        );
      }

      receipt = createVerifiedReviewReceipt({
        catalog,
        reviewedPacketIds: requiredReviewPacketIds(catalog),
      });
      review = { ...review, queue: null, receipt };
    } finally {
      cleanupEvidenceSpools(records);
    }
  } else {
    if (
      receipt?.requiredPacketsReviewed !== true ||
      receipt.catalogSha256 !== currentCatalog.catalogSha256 ||
      receipt.evidencePlanSha256 !== recordedPlan.evidencePlanSha256
    ) {
      fail(
        "CURRENT_REVIEW_RECEIPT_REQUIRED",
        "Finalization requires a reviewed receipt for the current catalog and evidence plan.",
      );
    }

    try {
      verifyReviewReceipt({
        catalogPath: currentCatalog.catalogPath,
        receipt,
      });
    } catch (error) {
      fail(
        "REVIEW_RECEIPT_INVALID",
        `Review receipt is invalid: ${error.message}`,
      );
    }
    normalized.evidenceGroups = canonicalContentGroups(recordedPlan);
  }

  const rendered = renderCommitMessage({
    manifest,
    content: normalized,
    reviewCatalog: catalog,
    evidencePlan,
    reviewReceipt: receipt,
    repositoryTypePolicy: transaction.repositoryTypePolicy,
  });
  const nextRevision = (transaction.message?.revision ?? 0) + 1;
  const prospective = finalizedResult({
    transactionPath,
    rendered,
    canonical: {
      messageRevision: nextRevision,
      messageSha256: rendered.validation.messageSha256,
      displayText: rendered.displayText,
    },
  });

  assertMessageResultBudget(prospective);
  replaceTransactionOwnedJson({
    transactionPath,
    artifactName: CONTENT_NAME,
    value: normalized,
    expectedIdentity: opened.identity,
  });
  review = {
    ...review,
    queue: null,
    receipt,
  };
  updateReviewTransaction(transactionPath, review, transaction.status);
  const canonical = replaceCanonicalMessage({
    transactionPath,
    bytes: rendered.bytes,
    validation: rendered.validation,
    source: "finalized-extended",
  });

  return assertMessageResultBudget(
    finalizedResult({ transactionPath, rendered, canonical }),
  );
}

export async function runFinalizeMessageCommand(
  argv,
  { stdout = process.stdout } = {},
) {
  let options = null;

  try {
    options = parseMessageWorkflowArguments(argv, "finalize");
    const result = await finalizeMessageWorkflow(options);

    if (options.format === "text" && result.displayText !== null) {
      stdout.write(result.displayText);
    } else {
      stdout.write(`${JSON.stringify(result)}\n`);
    }
    return result.status === "evidence-required" ? 1 : 0;
  } catch (caught) {
    const error = asMessageWorkflowError(caught, "MESSAGE_FINALIZE_FAILED");
    const result = assertMessageResultBudget(
      messageErrorResult(error, options?.transactionPath),
    );

    stdout.write(`${JSON.stringify(result)}\n`);
    return error.exitCode;
  }
}
