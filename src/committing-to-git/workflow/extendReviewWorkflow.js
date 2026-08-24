import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

import { activeGitOperations, indexMatchesTree } from "../git/gitRepository.js";
import {
  canonicalizeEvidencePlan,
  createReviewCatalog,
  writeReviewPacketQueue,
} from "../inspection/reviewCatalog.js";
import {
  sha256Bytes,
  stableJsonBytes,
} from "../inspection/inlineEvidenceCapsule.js";
import { scaffoldContent } from "../message/commitMessageRenderer.js";
import { ensureTransactionOwnedJson } from "../message/canonicalMessageState.js";
import { captureHeadAnchor } from "../transaction/indexInstallation.js";
import {
  MAXIMUM_INITIAL_JSON_INPUT_BYTES,
  advanceTransaction,
  getEvidencePlanInputPath,
  readTransaction,
} from "../transaction/transactionWorkspace.js";
import {
  PreparationError,
  acquireEvidence,
  cleanupEvidenceSpools,
  manifestEnvironment,
  preMaterializePatchPackets,
} from "./prepareWorkflow.js";

const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const EXTENSION_REASONS = new Set([
  "evidence-uncertainty",
  "semantic-structure-required",
]);

function fail(code, message, { exitCode = 2, details = {} } = {}) {
  throw new PreparationError(code, message, { exitCode, details });
}

function readFixedEvidencePlan(path) {
  const initialPathStat = lstatSync(path);

  if (
    initialPathStat.isSymbolicLink() ||
    !initialPathStat.isFile() ||
    initialPathStat.size > MAXIMUM_INITIAL_JSON_INPUT_BYTES
  ) {
    fail(
      "INVALID_EVIDENCE_PLAN_INPUT",
      "The fixed evidence-plan input must be a bounded non-symbolic regular file.",
    );
  }

  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW;
  const descriptor = openSync(path, fsConstants.O_RDONLY + noFollow);

  try {
    const before = fstatSync(descriptor);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const finalPathStat = lstatSync(path);

    if (
      !before.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      after.dev !== finalPathStat.dev ||
      after.ino !== finalPathStat.ino ||
      after.size !== finalPathStat.size ||
      bytes.length > MAXIMUM_INITIAL_JSON_INPUT_BYTES
    ) {
      fail(
        "EVIDENCE_PLAN_INPUT_CHANGED",
        "The fixed evidence-plan input changed while it was read.",
      );
    }

    let text;

    try {
      text = STRICT_UTF8_DECODER.decode(bytes);
    } catch {
      fail(
        "INVALID_EVIDENCE_PLAN_INPUT",
        "The fixed evidence-plan input is not strict UTF-8.",
      );
    }

    let payload;

    try {
      payload = JSON.parse(text);
    } catch (error) {
      fail(
        "INVALID_EVIDENCE_PLAN_INPUT",
        `The fixed evidence-plan input is invalid JSON: ${error.message}`,
      );
    }

    if (
      payload === null ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      payload.schemaVersion !== 1 ||
      !Array.isArray(payload.groups) ||
      JSON.stringify(Object.keys(payload).sort()) !==
        JSON.stringify(["groups", "schemaVersion"])
    ) {
      fail(
        "INVALID_EVIDENCE_PLAN_INPUT",
        "The fixed evidence-plan input must contain only schemaVersion and groups.",
      );
    }

    return payload.groups;
  } finally {
    closeSync(descriptor);
  }
}

function readExactSnapshot(transaction) {
  const bytes = readFileSync(transaction.snapshot.path);

  if (sha256Bytes(bytes) !== transaction.snapshot.sha256) {
    fail(
      "SNAPSHOT_CHANGED",
      "The transaction snapshot changed after preparation.",
      {
        exitCode: 1,
        details: {
          transaction: resolve(
            transaction.snapshot.path,
            "..",
            "transaction.json",
          ),
        },
      },
    );
  }

  const manifest = JSON.parse(STRICT_UTF8_DECODER.decode(bytes));

  if (
    manifest.indexTreeOid !== transaction.snapshot.indexTreeOid ||
    manifest.changeUnitCount !== transaction.snapshot.changeUnitCount
  ) {
    fail("SNAPSHOT_CHANGED", "The transaction snapshot anchors do not match.", {
      exitCode: 1,
    });
  }

  return { ...manifest, manifestSha256: transaction.snapshot.sha256 };
}

function assertUnchangedAnchor(transaction, manifest) {
  if (
    JSON.stringify(captureHeadAnchor(transaction.repositoryRoot)) !==
    JSON.stringify(transaction.headAnchor)
  ) {
    fail("HEAD_DRIFT", "HEAD changed after concise evidence preparation.", {
      exitCode: 1,
    });
  }

  const operations = activeGitOperations(transaction.repositoryRoot);

  if (operations.length > 0) {
    fail(
      "ACTIVE_GIT_OPERATION",
      `Review cannot be extended during an active ${operations.join(", ")} operation.`,
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
      "The prepared index tree changed before review extension.",
      {
        exitCode: 1,
      },
    );
  }
}

function initialGroups(transaction) {
  return transaction.initialEvidencePlan.groups.map(
    ({ selection, policy, basis }) => ({ selection, policy, basis }),
  );
}

function writeEvidencePlanRevision(transaction, evidencePlan) {
  const path = resolve(
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
    return path;
  }

  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  return path;
}

function extensionResult(transaction) {
  return {
    schemaVersion: 1,
    status: transaction.status,
    phase: transaction.phase,
    terminalDisposition: transaction.terminalDisposition,
    transaction: resolve(transaction.attemptDirectory, "transaction.json"),
    route: transaction.route,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    mode: transaction.mode,
    headAnchor: transaction.headAnchor,
    indexTreeOid: transaction.snapshot.indexTreeOid,
    changeUnitCount: transaction.snapshot.changeUnitCount,
    evidencePlanSha256: transaction.review.evidencePlanSha256,
    capsuleSha256: transaction.review.coveredCapsuleSha256,
    extendedReason: transaction.review.extendedReason,
    reviewQueue: transaction.review.queue,
  };
}

export async function extendReviewWorkflow({ transactionPath, reason }) {
  if (!EXTENSION_REASONS.has(reason)) {
    fail(
      "INVALID_EXTENSION_REASON",
      "Review extension reason must be evidence-uncertainty or semantic-structure-required.",
    );
  }

  const transaction = readTransaction(transactionPath);

  if (
    transaction.phase !== "evidence-ready" ||
    transaction.route !== "concise"
  ) {
    fail(
      "EXTENSION_NOT_ALLOWED",
      `Review extension requires a concise evidence-ready transaction, not ${transaction.phase}.`,
      { exitCode: 1, details: { transaction: resolve(transactionPath) } },
    );
  }

  const inputPath = getEvidencePlanInputPath(transactionPath);

  if (reason === "semantic-structure-required" && existsSync(inputPath)) {
    fail(
      "UNEXPECTED_EVIDENCE_PLAN_INPUT",
      "Semantic-structure extension forbids an evidence-plan input.",
      { details: { transaction: resolve(transactionPath) } },
    );
  }

  if (reason === "evidence-uncertainty" && !existsSync(inputPath)) {
    fail(
      "MISSING_EVIDENCE_PLAN_INPUT",
      "Evidence uncertainty requires the fixed transaction-local evidence-plan input.",
      { details: { transaction: resolve(transactionPath) } },
    );
  }

  const manifest = readExactSnapshot(transaction);
  assertUnchangedAnchor(transaction, manifest);
  const groups =
    reason === "evidence-uncertainty"
      ? readFixedEvidencePlan(inputPath)
      : initialGroups(transaction);
  const evidencePlan = canonicalizeEvidencePlan({ manifest, groups });
  const evidencePlanPath = writeEvidencePlanRevision(transaction, evidencePlan);
  const reviewDirectory = resolve(transaction.attemptDirectory, "review");
  let records = [];

  try {
    if (reason === "evidence-uncertainty") {
      records = await acquireEvidence({
        root: transaction.repositoryRoot,
        manifest,
        evidencePlan,
        attemptDirectory: transaction.attemptDirectory,
      });
    }

    if (records.some(({ empty }) => !empty) && !existsSync(reviewDirectory)) {
      mkdirSync(reviewDirectory);
    }

    const packetsByGroupId = await preMaterializePatchPackets({
      reviewDirectory,
      records,
    });
    const extendedManifest = {
      ...manifest,
      manifestSha256: evidencePlan.manifestSha256,
      coveredSynopsis: true,
      coveredEvidenceGroupIds:
        reason === "semantic-structure-required"
          ? evidencePlan.groups.map(({ id }) => id)
          : [],
      preMaterializedPacketsByGroupId: packetsByGroupId,
      evidenceByGroupId: Object.fromEntries(
        records
          .filter(({ empty }) => empty)
          .map(({ group }) => [group.id, Buffer.alloc(0)]),
      ),
    };
    const catalog = createReviewCatalog({
      manifest: extendedManifest,
      outputDirectory: reviewDirectory,
      evidencePlan,
    });
    const packetIds = [
      ...new Set([
        ...catalog.requiredSynopsisPacketIds,
        ...catalog.exactInventoryPacketIds,
        ...catalog.fullPatchPacketIds,
      ]),
    ];
    const queue =
      packetIds.length === 0
        ? null
        : writeReviewPacketQueue({
            catalog,
            packetIds,
            queueKind: "delta",
            outputDirectory: reviewDirectory,
          });
    ensureTransactionOwnedJson({
      transactionPath,
      artifactName: "content.json",
      value: scaffoldContent(manifest, catalog, evidencePlan),
    });
    const completed = advanceTransaction(transactionPath, "evidence-ready", {
      ...transaction,
      phase: "review-pending",
      status: "review-pending",
      route: "extended",
      inlineEvidence: null,
      review: {
        catalogPath: catalog.catalogPath,
        catalogSha256: catalog.catalogSha256,
        evidencePlanPath,
        evidencePlanSha256: evidencePlan.evidencePlanSha256,
        coveredCapsuleSha256: transaction.inlineEvidence.capsuleSha256,
        extendedReason: reason,
        queue,
        receipt: null,
        semanticStructureRequired: reason === "semantic-structure-required",
      },
    });

    if (reason === "evidence-uncertainty") {
      unlinkSync(inputPath);
    }

    return extensionResult(completed);
  } finally {
    cleanupEvidenceSpools(records);
  }
}

export function parseExtendReviewArguments(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];

    if (!new Set(["--transaction", "--reason", "--format"]).has(token)) {
      fail("UNKNOWN_ARGUMENT", `Unknown workflow extend flag ${token}.`);
    }

    if (value === undefined || value.length === 0) {
      fail("INVALID_ARGUMENT", `${token} requires a non-empty value.`);
    }

    if (values.has(token)) {
      fail("DUPLICATE_ARGUMENT", `${token} may be supplied only once.`);
    }

    values.set(token, value);
  }

  if (!values.has("--transaction") || !values.has("--reason")) {
    fail(
      "MISSING_ARGUMENT",
      "--transaction and --reason are required for workflow extend.",
    );
  }

  const format = values.get("--format") ?? "json";

  if (!new Set(["json", "text"]).has(format)) {
    fail("INVALID_FORMAT", "--format must be json or text.");
  }

  return {
    transactionPath: values.get("--transaction"),
    reason: values.get("--reason"),
    format,
  };
}

function errorResult(error) {
  return {
    schemaVersion: 1,
    status: error.exitCode === 1 ? "stopped" : "invalid",
    phase: null,
    terminalDisposition: null,
    transaction: error.details.transaction ?? null,
    route: null,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    code: error.code,
    message: error.message,
  };
}

function textResult(result) {
  return [
    `Status: ${result.status}`,
    ...(result.code
      ? [`Code: ${result.code}`, `Message: ${result.message}`]
      : []),
    ...(result.transaction ? [`Transaction: ${result.transaction}`] : []),
    ...(result.indexTreeOid ? [`Index tree: ${result.indexTreeOid}`] : []),
    "",
  ].join("\n");
}

export async function runExtendReviewCommand(
  argv,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  let format = "json";

  try {
    const options = parseExtendReviewArguments(argv);
    format = options.format;
    const result = await extendReviewWorkflow(options);
    stdout.write(
      format === "text" ? textResult(result) : `${JSON.stringify(result)}\n`,
    );
    return 0;
  } catch (caught) {
    const error =
      caught instanceof PreparationError
        ? caught
        : new PreparationError("EXTENSION_FAILED", caught.message);
    const result = errorResult(error);

    stderr.write(`${error.code}: ${error.message}\n`);
    stdout.write(
      format === "text" ? textResult(result) : `${JSON.stringify(result)}\n`,
    );
    return error.exitCode;
  }
}
