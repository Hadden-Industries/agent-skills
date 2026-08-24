import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import {
  readOnlyGitText,
  runReadOnlyGit,
  streamGit,
} from "../git/gitRepository.js";
import { splitNul } from "../git/gitPath.js";

const CHECK_STATUSES = new Set(["passed", "failed"]);
const VERIFICATION_POLICIES = new Set(["required", "advisory", "skipped"]);
const SIGNATURE_STATUSES = new Set([
  "verified",
  "failed",
  "unavailable",
  "skipped",
]);
const CHECK_CONTEXTS = new Set([
  "approved staged snapshot",
  "current working tree",
  "isolated worktree/container",
  "external environment",
]);
const SSH_FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/=_-]+$/u;
const OPENPGP_FINGERPRINT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const SAFE_TERMINAL_TEXT = /^[^\p{Cc}\p{Cf}]*$/u;
const MAXIMUM_INLINE_WORKSPACE_BYTES = 48 * 1024;
const MAXIMUM_COMPACT_DIRECTORY_SAMPLES = 16;

export const MAXIMUM_REPORT_RESULT_BYTES = 80 * 1024;

function hasExactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

function signatureIdentityMatchesBackend(attempt) {
  if (attempt.status !== "verified") {
    return (
      attempt.identity === null &&
      (attempt.status !== "skipped" || attempt.backend === null)
    );
  }

  if (attempt.backend === "ssh") {
    return (
      hasExactKeys(attempt.identity, ["principal", "keyFingerprint"]) &&
      typeof attempt.identity.principal === "string" &&
      attempt.identity.principal.length > 0 &&
      typeof attempt.identity.keyFingerprint === "string" &&
      SSH_FINGERPRINT_PATTERN.test(attempt.identity.keyFingerprint)
    );
  }

  if (attempt.backend === "openpgp") {
    return (
      hasExactKeys(attempt.identity, [
        "signer",
        "primaryKeyFingerprint",
        "signingSubkeyFingerprint",
      ]) &&
      typeof attempt.identity.signer === "string" &&
      attempt.identity.signer.length > 0 &&
      typeof attempt.identity.primaryKeyFingerprint === "string" &&
      OPENPGP_FINGERPRINT_PATTERN.test(
        attempt.identity.primaryKeyFingerprint,
      ) &&
      (attempt.identity.signingSubkeyFingerprint === null ||
        (typeof attempt.identity.signingSubkeyFingerprint === "string" &&
          OPENPGP_FINGERPRINT_PATTERN.test(
            attempt.identity.signingSubkeyFingerprint,
          )))
    );
  }

  return false;
}

export function validateChecksArtifact(checks) {
  if (
    !hasExactKeys(checks, ["schemaVersion", "checks"]) ||
    checks.schemaVersion !== 1 ||
    !Array.isArray(checks.checks)
  ) {
    throw new Error(
      "Checks artifact must use schema version 1 and a checks array.",
    );
  }

  for (const check of checks.checks) {
    if (
      !hasExactKeys(check, ["label", "status", "context"]) ||
      typeof check.label !== "string" ||
      check.label.trim() === "" ||
      check.label !== check.label.trim() ||
      !CHECK_STATUSES.has(check.status) ||
      !CHECK_CONTEXTS.has(check.context)
    ) {
      throw new Error(
        "Each check requires a trimmed label, passed or failed status, and a supported context.",
      );
    }
  }

  return checks;
}

export function validatePublicationArtifact(publication) {
  if (
    hasExactKeys(publication, ["status"]) &&
    publication.status === "not-requested"
  ) {
    return publication;
  }

  if (
    hasExactKeys(publication, ["status", "reason"]) &&
    publication.status === "blocked" &&
    typeof publication.reason === "string" &&
    publication.reason.length > 0
  ) {
    return publication;
  }

  const workflowKeys = [
    "schemaVersion",
    "status",
    "attemptId",
    "retryOf",
    "commitOid",
    "remote",
    "destination",
    "refspec",
    "exitCode",
    "transcript",
    "observation",
    "resolution",
    "retryPermitted",
    "reason",
  ];

  if (publication?.schemaVersion === 2) {
    const statusValid = new Set([
      "rejected",
      "unknown",
      "observed-matching",
      "succeeded",
    ]).has(publication.status);
    if (
      !hasExactKeys(publication, workflowKeys) ||
      !statusValid ||
      !UUID_V4_PATTERN.test(publication.attemptId) ||
      (publication.retryOf !== null &&
        !UUID_V4_PATTERN.test(publication.retryOf)) ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(publication.commitOid) ||
      typeof publication.remote !== "string" ||
      publication.remote.length === 0 ||
      typeof publication.destination !== "string" ||
      !publication.destination.startsWith("refs/heads/") ||
      publication.refspec !==
        `${publication.commitOid}:${publication.destination}` ||
      (publication.exitCode !== null &&
        !Number.isInteger(publication.exitCode)) ||
      (publication.transcript !== null &&
        (typeof publication.transcript !== "object" ||
          Array.isArray(publication.transcript))) ||
      (publication.observation !== null &&
        (typeof publication.observation !== "object" ||
          Array.isArray(publication.observation))) ||
      (publication.resolution !== null &&
        (typeof publication.resolution !== "object" ||
          Array.isArray(publication.resolution))) ||
      typeof publication.retryPermitted !== "boolean" ||
      (publication.reason !== null && typeof publication.reason !== "string") ||
      (publication.status === "succeeded" &&
        (publication.exitCode !== 0 || publication.transcript === null)) ||
      (publication.status === "observed-matching" &&
        (publication.observation?.status !== "observed" ||
          publication.observation.observedOid !== publication.commitOid ||
          publication.retryPermitted)) ||
      (publication.retryPermitted &&
        (publication.status !== "unknown" ||
          publication.observation === null ||
          publication.resolution === null))
    ) {
      throw new Error(
        "Publication artifact does not match the workflow contract.",
      );
    }

    return publication;
  }

  const keys = [
    "schemaVersion",
    "status",
    "commitOid",
    "remote",
    "destination",
    "refspec",
    "exitCode",
    "stdout",
    "stderr",
  ];
  const validStatus =
    publication?.status === "pushed" || publication?.status === "failed";
  const validExit =
    (publication?.status === "pushed" && publication?.exitCode === 0) ||
    (publication?.status === "failed" && publication?.exitCode > 0);

  if (
    !hasExactKeys(publication, keys) ||
    publication.schemaVersion !== 1 ||
    !validStatus ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(publication.commitOid) ||
    typeof publication.remote !== "string" ||
    publication.remote === "" ||
    typeof publication.destination !== "string" ||
    !publication.destination.startsWith("refs/heads/") ||
    publication.refspec !==
      `${publication.commitOid}:${publication.destination}` ||
    !validExit ||
    typeof publication.stdout !== "string" ||
    typeof publication.stderr !== "string"
  ) {
    throw new Error(
      "Publication artifact does not match the workflow contract.",
    );
  }

  return publication;
}

export function validateVerificationArtifact(verification, commitOid) {
  const topLevelKeys = [
    "schemaVersion",
    "commitOid",
    "initialPolicy",
    "finalPolicy",
    "attempts",
    "effectiveAttempt",
    "blocksPush",
  ];
  const attemptsValid =
    Array.isArray(verification?.attempts) &&
    verification.attempts.length > 0 &&
    verification.attempts.every(
      (attempt) =>
        hasExactKeys(attempt, [
          "status",
          "reason",
          "backend",
          "identity",
          "timestamp",
        ]) &&
        SIGNATURE_STATUSES.has(attempt.status) &&
        new Set(["ssh", "openpgp", null]).has(attempt.backend) &&
        (attempt.reason === null || typeof attempt.reason === "string") &&
        (attempt.identity === null ||
          (typeof attempt.identity === "object" &&
            !Array.isArray(attempt.identity))) &&
        typeof attempt.timestamp === "string" &&
        Number.isFinite(Date.parse(attempt.timestamp)) &&
        signatureIdentityMatchesBackend(attempt),
    );
  const effective = attemptsValid
    ? verification.attempts[verification.effectiveAttempt]
    : null;

  if (
    !hasExactKeys(verification, topLevelKeys) ||
    verification.schemaVersion !== 2 ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(verification.commitOid) ||
    !VERIFICATION_POLICIES.has(verification.initialPolicy) ||
    !VERIFICATION_POLICIES.has(verification.finalPolicy) ||
    !attemptsValid ||
    !Number.isSafeInteger(verification.effectiveAttempt) ||
    verification.effectiveAttempt < 0 ||
    verification.effectiveAttempt >= verification.attempts.length ||
    verification.blocksPush !==
      (verification.finalPolicy === "required" &&
        effective?.status !== "verified") ||
    (verification.finalPolicy === "skipped" && effective?.status !== "skipped")
  ) {
    throw new Error(
      "Verification artifact does not match the workflow contract.",
    );
  }

  if (verification.commitOid.toLowerCase() !== commitOid.toLowerCase()) {
    throw new Error("Verification artifact belongs to a different commit.");
  }

  return verification;
}

export function parseRawCommitObject(rawCommit, oid = null) {
  const raw = Buffer.isBuffer(rawCommit) ? rawCommit : Buffer.from(rawCommit);
  const separator = raw.indexOf(Buffer.from("\n\n", "ascii"));

  if (separator < 0) {
    throw new Error(
      "Commit object does not contain a header/message boundary.",
    );
  }

  const headerText = raw.subarray(0, separator).toString("utf8");
  const lines = headerText.split("\n");
  const treeLine = lines.find((line) => line.startsWith("tree "));
  const parents = lines
    .filter((line) => line.startsWith("parent "))
    .map((line) => line.slice("parent ".length));
  const signatureHeaders = lines
    .filter((line) => /^gpgsig(?:-sha256)? /u.test(line))
    .map((line) => line.slice(0, line.indexOf(" ")));

  if (!treeLine) {
    throw new Error("Commit object does not record a tree.");
  }

  return {
    oid,
    treeOid: treeLine.slice("tree ".length),
    parents,
    messageBytes: Buffer.from(raw.subarray(separator + 2)),
    signed: signatureHeaders.length > 0,
    signatureHeaders,
  };
}

export function inspectCommitObject(root, commitOid) {
  const raw = runReadOnlyGit(root, "cat-file", ["commit", commitOid]).stdout;
  return parseRawCommitObject(raw, commitOid);
}

function commitFacts(root, commitOid, headAnchor = null) {
  const fields = readOnlyGitText(root, "show-commit-fields", [
    "--format=%H%x00%P%x00%T%x00%an%x00%ae%x00%cn%x00%ce%x00%s",
    commitOid,
  ])
    .replace(/\r?\n$/u, "")
    .split("\0");
  const object = inspectCommitObject(root, commitOid);
  const branchResult =
    headAnchor === null
      ? runReadOnlyGit(root, "short-symbolic-head", [], {
          allowFailure: true,
        })
      : null;

  return {
    messageBytes: object.messageBytes,
    facts: {
      oid: fields[0],
      parents: object.parents,
      treeOid: object.treeOid,
      author: { name: fields[3], email: fields[4] },
      committer: { name: fields[5], email: fields[6] },
      subject: fields[7],
      message: object.messageBytes.toString("utf8"),
      messageSha256: createHash("sha256")
        .update(object.messageBytes)
        .digest("hex"),
      signed: object.signed,
      signatureHeaders: object.signatureHeaders,
      branch:
        headAnchor?.targetRef ??
        (branchResult?.status === 0
          ? branchResult.stdout.toString("utf8").trim()
          : null),
      headKind: headAnchor?.headKind ?? null,
      shortOid: readOnlyGitText(root, "short-object-id", [commitOid]).trim(),
    },
  };
}

function kindName(status) {
  switch (status[0]) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "added";
    case "T":
      return "type-changed";
    default:
      return "modified";
  }
}

function normalizedKind({ oldMode, newMode, status }) {
  const kind = kindName(status);

  if (oldMode === "160000" || newMode === "160000") {
    return "submodule-changed";
  }

  if (oldMode === "120000" || newMode === "120000") {
    return oldMode === newMode ? "symlink-changed" : "type-changed";
  }

  if (oldMode !== newMode && kind === "modified") {
    return "mode-changed";
  }

  return kind;
}

function commitStatistics(root, commitOid) {
  const common = ["--root", "--no-commit-id", "-r", "-z", "--no-renames"];
  const numstatFields = splitNul(
    runReadOnlyGit(root, "diff-tree", [...common, "--numstat", commitOid])
      .stdout,
  );
  let additions = 0;
  let deletions = 0;
  let binaryFiles = 0;
  let files = 0;

  for (let index = 0; index < numstatFields.length;) {
    const field = numstatFields[index].toString("utf8");
    const [added, deleted, path = ""] = field.split("\t");

    files += 1;

    if (added === "-" || deleted === "-") {
      binaryFiles += 1;
    } else {
      additions += Number(added);
      deletions += Number(deleted);
    }

    index += path === "" ? 3 : 1;
  }

  const rawFields = splitNul(
    runReadOnlyGit(root, "diff-tree", [...common, "--raw", commitOid]).stdout,
  );
  const kinds = {};

  for (let index = 0; index < rawFields.length;) {
    const header = rawFields[index].toString("ascii");

    if (!header.startsWith(":")) {
      throw new Error(`Unexpected raw diff field: ${JSON.stringify(header)}`);
    }

    const [oldMode, newMode, , , status] = header.slice(1).split(" ");
    const renamedOrCopied = status.startsWith("R") || status.startsWith("C");
    const expectedFields = renamedOrCopied ? 3 : 2;

    if (rawFields.length < index + expectedFields) {
      throw new Error(`Incomplete raw diff record for ${status}`);
    }

    const kind = normalizedKind({ oldMode, newMode, status });

    kinds[kind] = (kinds[kind] ?? 0) + 1;
    index += expectedFields;
  }

  return { files, additions, deletions, binaryFiles, kinds };
}

function manifestStatistics(manifest) {
  if (manifest?.schemaVersion !== 2) {
    return null;
  }

  const values = [
    manifest?.statistics?.files,
    manifest?.statistics?.additions,
    manifest?.statistics?.deletions,
    manifest?.statistics?.binaryFiles,
  ];

  if (
    !Array.isArray(manifest.changeUnits) ||
    manifest.changeUnitCount !== manifest.changeUnits.length ||
    manifest.statistics?.files !== manifest.changeUnits.length ||
    !Number.isSafeInteger(values[0]) ||
    values[0] < 0 ||
    values
      .slice(1)
      .some(
        (value) =>
          value !== null && (!Number.isSafeInteger(value) || value < 0),
      ) ||
    manifest.changeUnits.some(
      (unit) =>
        unit === null ||
        typeof unit !== "object" ||
        typeof unit.kind !== "string" ||
        unit.kind.length === 0,
    )
  ) {
    throw new Error(
      "Matching snapshot manifest has invalid reusable statistics.",
    );
  }

  const kinds = {};

  for (const unit of manifest.changeUnits) {
    kinds[unit.kind] = (kinds[unit.kind] ?? 0) + 1;
  }

  return {
    files: manifest.statistics.files,
    additions: manifest.statistics.additions,
    deletions: manifest.statistics.deletions,
    binaryFiles: manifest.statistics.binaryFiles,
    kinds,
  };
}

function statusLabel(code) {
  const labels = {
    A: "added",
    M: "modified",
    D: "deleted",
    R: "renamed",
    C: "added",
    T: "type changed",
    U: "unmerged",
  };

  return labels[code] ?? "changed";
}

function workspaceState(root) {
  const fields = splitNul(
    runReadOnlyGit(root, "status", [
      "--porcelain=v2",
      "-z",
      "--untracked-files=all",
      "--no-renames",
      "--ignore-submodules=dirty",
    ]).stdout,
  );
  const workspace = { staged: [], unstaged: [], untracked: [], conflicted: [] };

  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index].toString("utf8");

    if (record.startsWith("? ")) {
      workspace.untracked.push({ path: record.slice(2), status: "untracked" });
      continue;
    }

    if (record.startsWith("u ")) {
      const path = record.split(" ").slice(10).join(" ");
      workspace.conflicted.push({ path, status: "unmerged" });
      continue;
    }

    const match =
      /^(?<recordType>[12]) (?<xy>..) \S+ \S+ \S+ \S+ \S+ \S+ (?<path>.*)$/u.exec(
        record,
      );

    if (!match) {
      continue;
    }

    const { recordType, xy, path } = match.groups;

    if (xy[0] !== ".") {
      workspace.staged.push({ path, status: statusLabel(xy[0]) });
    }

    if (xy[1] !== ".") {
      workspace.unstaged.push({ path, status: statusLabel(xy[1]) });
    }

    if (recordType === "2") {
      index += 1;
    }
  }

  for (const entries of Object.values(workspace)) {
    entries.sort((left, right) =>
      Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
    );
  }

  return workspace;
}

function bytesAfterSpaces(field, count) {
  let offset = 0;

  for (let index = 0; index < count; index += 1) {
    offset = field.indexOf(0x20, offset);

    if (offset < 0) {
      throw new Error("Git status emitted a malformed porcelain v2 record.");
    }

    offset += 1;
  }

  return field.subarray(offset);
}

function safeByteDisplay(bytes) {
  try {
    const decoded = STRICT_UTF8_DECODER.decode(bytes);

    if (SAFE_TERMINAL_TEXT.test(decoded)) {
      return decoded;
    }
  } catch {
    // Fall through to a byte-exact escaped display.
  }

  return [...bytes]
    .map((byte) =>
      byte >= 0x20 && byte <= 0x7e && byte !== 0x5c
        ? String.fromCharCode(byte)
        : `\\x${byte.toString(16).padStart(2, "0")}`,
    )
    .join("");
}

function pathFact(bytes) {
  return {
    display: safeByteDisplay(bytes),
    bytesBase64: bytes.toString("base64"),
    byteCount: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function compactPathSample(bytes) {
  const sampleBytes = 64;
  const prefix = bytes.subarray(0, Math.min(sampleBytes, bytes.length));
  const suffixStart = Math.max(prefix.length, bytes.length - sampleBytes);
  const suffix = bytes.subarray(suffixStart);

  return {
    prefix: safeByteDisplay(prefix),
    suffix: safeByteDisplay(suffix),
    byteCount: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function statusEntries(field) {
  if (field.length < 2 || field[1] !== 0x20) {
    throw new Error("Git status emitted an unknown porcelain v2 record.");
  }

  const recordType = String.fromCharCode(field[0]);

  if (recordType === "?") {
    const pathBytes = field.subarray(2);
    return [
      {
        category: "untracked",
        status: "untracked",
        pathBytes,
        compactDirectory: pathBytes.at(-1) === 0x2f,
      },
    ];
  }

  if (recordType === "u") {
    return [
      {
        category: "conflicted",
        status: "unmerged",
        pathBytes: bytesAfterSpaces(field, 10),
        compactDirectory: false,
      },
    ];
  }

  if (recordType !== "1" && recordType !== "2") {
    return [];
  }

  const xy = field.subarray(2, 4).toString("ascii");
  const pathBytes = bytesAfterSpaces(field, recordType === "2" ? 9 : 8);
  const entries = [];

  if (xy[0] !== ".") {
    entries.push({
      category: "staged",
      status: statusLabel(xy[0]),
      pathBytes,
      compactDirectory: false,
    });
  }

  if (xy[1] !== ".") {
    entries.push({
      category: "unstaged",
      status: statusLabel(xy[1]),
      pathBytes,
      compactDirectory: false,
    });
  }

  return entries;
}

export async function observeWorkspaceEntries(
  root,
  { scope, enumerateAllUntracked = false, onEntry, stream = streamGit } = {},
) {
  const scopeKind = typeof scope === "string" ? scope : scope?.kind;
  const untrackedMode =
    enumerateAllUntracked || scopeKind === "full" ? "all" : "normal";
  const digest = createHash("sha256");
  let pending = Buffer.alloc(0);
  let discardRenameSource = false;
  let observedEntries = 0;

  const consumeField = (field) => {
    if (discardRenameSource) {
      discardRenameSource = false;
      return;
    }

    const entries = statusEntries(field);

    if (field[0] === 0x32) {
      discardRenameSource = true;
    }

    for (const entry of entries) {
      digest.update(Buffer.from(entry.category, "ascii"));
      digest.update(Buffer.from([0]));
      digest.update(Buffer.from(entry.status, "ascii"));
      digest.update(Buffer.from([0]));
      digest.update(entry.pathBytes);
      digest.update(Buffer.from([0]));
      observedEntries += 1;
      onEntry?.(entry, observedEntries - 1);
    }
  };

  const result = await stream(
    "status",
    [
      "--porcelain=v2",
      "-z",
      `--untracked-files=${untrackedMode}`,
      "--no-renames",
      "--ignore-submodules=dirty",
    ],
    {
      cwd: root,
      onStdout(chunk) {
        pending = Buffer.concat([pending, chunk]);
        let separator;

        while ((separator = pending.indexOf(0)) >= 0) {
          consumeField(pending.subarray(0, separator));
          pending = pending.subarray(separator + 1);
        }
      },
    },
  );

  if (pending.length !== 0 || discardRenameSource) {
    throw new Error("Git status ended with an incomplete porcelain v2 record.");
  }

  return {
    observedEntries,
    digest: digest.digest("hex"),
    untrackedMode,
    stdoutByteCount: result.stdoutByteCount,
    stdoutSha256: result.stdoutSha256,
  };
}

export async function collectWorkspaceSummary(
  root,
  {
    scope,
    detailLimit = 49,
    enumerateAllUntracked = false,
    stream = streamGit,
  } = {},
) {
  if (!Number.isSafeInteger(detailLimit) || detailLimit < 0) {
    throw new Error("Workspace detail limit must be a nonnegative integer.");
  }

  const counts = {
    observedEntries: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };
  const exactPaths = [];
  const directorySamples = [];
  let firstCompactSample = null;
  let compact = false;
  const observation = await observeWorkspaceEntries(root, {
    scope,
    enumerateAllUntracked,
    stream,
    onEntry(entry) {
      counts.observedEntries += 1;
      counts[entry.category] += 1;

      if (!entry.compactDirectory) {
        firstCompactSample ??= {
          category: entry.category,
          status: entry.status,
          path: compactPathSample(entry.pathBytes),
        };
      }

      if (
        entry.compactDirectory &&
        directorySamples.length < MAXIMUM_COMPACT_DIRECTORY_SAMPLES
      ) {
        directorySamples.push({
          category: entry.category,
          path: compactPathSample(entry.pathBytes),
          observedEntryCount: 1,
          exactFileCount: false,
        });
      }

      if (compact || entry.compactDirectory) {
        compact = true;
        exactPaths.length = 0;
        return;
      }

      exactPaths.push({
        category: entry.category,
        status: entry.status,
        path: pathFact(entry.pathBytes),
      });

      if (
        exactPaths.length > detailLimit ||
        Buffer.byteLength(JSON.stringify(exactPaths)) >
          MAXIMUM_INLINE_WORKSPACE_BYTES
      ) {
        compact = true;
        exactPaths.length = 0;
      }
    },
  });

  const compactDirectories = compact ? directorySamples : [];
  const compactPathSamples =
    compact && firstCompactSample !== null ? [firstCompactSample] : [];

  return {
    observedAt: new Date().toISOString(),
    scopeKind: typeof scope === "string" ? scope : (scope?.kind ?? "full"),
    untrackedMode: observation.untrackedMode,
    detailMode: compact ? "fresh-observation" : "inline-exact",
    exactAtReportTime: true,
    counts,
    exactPaths,
    compactDirectories,
    compactPathSamples,
    digest: observation.digest,
    nestedSubmoduleWorktrees: "not-inspected",
  };
}

export function compactWorkspaceSummary(workspace) {
  if (!workspace || !Array.isArray(workspace.exactPaths)) {
    return workspace;
  }

  if (workspace.detailMode === "fresh-observation") {
    return workspace;
  }

  const firstPath = workspace.exactPaths[0] ?? null;
  const compactRecord =
    firstPath === null
      ? null
      : {
          category: firstPath.category,
          path: compactPathSample(
            Buffer.from(firstPath.path.bytesBase64, "base64"),
          ),
          status: firstPath.status,
        };

  return {
    ...workspace,
    detailMode: "fresh-observation",
    exactPaths: [],
    compactDirectories: [],
    compactPathSamples: compactRecord === null ? [] : [compactRecord],
  };
}

export function collectCommitReport({
  root,
  commitOid,
  manifest,
  approvedMessage,
  verification,
  checks,
  publication = { status: "not-requested" },
  headAnchor = null,
  workspaceSummary = null,
}) {
  const observedCommit = commitFacts(root, commitOid, headAnchor);
  const commit = observedCommit.facts;
  const approvedMessageBytes = Buffer.isBuffer(approvedMessage)
    ? approvedMessage
    : Buffer.from(approvedMessage, "utf8");

  validateChecksArtifact(checks);
  validatePublicationArtifact(publication);
  validateVerificationArtifact(verification, commit.oid);

  if (
    !new Set(["not-requested", "blocked"]).has(publication.status) &&
    publication.commitOid !== commit.oid
  ) {
    throw new Error("Publication artifact belongs to a different commit.");
  }

  commit.treeMatches = commit.treeOid === manifest.indexTreeOid;
  commit.messageMatches =
    observedCommit.messageBytes.equals(approvedMessageBytes);

  const expectedParentOids =
    headAnchor?.expectedParentOids ??
    (manifest.headOid ? [manifest.headOid] : []);

  commit.parentMatches =
    commit.parents.length === expectedParentOids.length &&
    commit.parents.every(
      (parent, index) => parent === expectedParentOids[index],
    );

  const approvedStatistics = commit.treeMatches
    ? manifestStatistics(manifest)
    : null;
  const comparisonMatches =
    commit.parentMatches && commit.treeMatches && commit.messageMatches;
  const recordedPublication =
    publication.status === "not-requested" &&
    (!comparisonMatches || !commit.signed || verification.blocksPush)
      ? {
          status: "blocked",
          reason: !comparisonMatches
            ? "commit-comparison-mismatch"
            : !commit.signed
              ? "signed-commit-header-missing"
              : "verification-policy-blocked",
        }
      : publication;

  return {
    schemaVersion: 1,
    headAnchor: headAnchor ?? {
      headKind: manifest.headOid ? "attached" : "unborn",
      targetRef: commit.branch,
      expectedParentOids,
    },
    commit,
    comparison: {
      expectedParentOids,
      actualParentOids: commit.parents,
      parentMatches: commit.parentMatches,
      expectedTreeOid: manifest.indexTreeOid,
      actualTreeOid: commit.treeOid,
      treeMatches: commit.treeMatches,
      expectedMessageSha256: createHash("sha256")
        .update(approvedMessageBytes)
        .digest("hex"),
      actualMessageSha256: commit.messageSha256,
      messageMatches: commit.messageMatches,
      signatureHeaderPresent: commit.signed,
      signatureHeaders: commit.signatureHeaders,
    },
    statistics: approvedStatistics ?? commitStatistics(root, commitOid),
    verification,
    checks,
    publication: recordedPublication,
    workspace: workspaceSummary ?? workspaceState(root),
  };
}

export function augmentReportWithPublication(report, publication) {
  validatePublicationArtifact(publication);

  if (
    !new Set(["not-requested", "blocked"]).has(publication.status) &&
    publication.commitOid !== report.commit.oid
  ) {
    throw new Error("Publication artifact belongs to a different commit.");
  }

  return {
    ...structuredClone(report),
    publication: structuredClone(publication),
  };
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function renderKinds(kinds) {
  return Object.entries(kinds)
    .map(([kind, count]) => `${count} ${kind}`)
    .join(", ");
}

function verificationText(verification) {
  const attempt = verification.attempts[verification.effectiveAttempt];

  switch (attempt.status) {
    case "verified": {
      if (attempt.backend === "openpgp") {
        const identity = attempt.identity;
        return (
          "OpenPGP signature is cryptographically valid" +
          `${identity?.signer ? ` for ${identity.signer}` : ""}` +
          `${
            identity?.primaryKeyFingerprint
              ? ` (${identity.primaryKeyFingerprint})`
              : ""
          }; identity authorization was not assessed`
        );
      }

      if (attempt.backend === "ssh") {
        return (
          "SSH signature verification succeeded" +
          `${attempt.identity?.principal ? ` for ${attempt.identity.principal}` : ""}` +
          `${
            attempt.identity?.keyFingerprint
              ? ` (${attempt.identity.keyFingerprint})`
              : ""
          }`
        );
      }

      return "Signature verification succeeded";
    }
    case "skipped":
      return "Skipped by user policy";
    case "unavailable":
      return attempt.reason === "trust-store-unreadable"
        ? "Unavailable because the configured trust store could not be read"
        : "Signature verification unavailable";
    default:
      return "Signature verification failed";
  }
}

function renderWorkspace(workspace) {
  if (Array.isArray(workspace.exactPaths)) {
    if (workspace.counts.observedEntries === 0) {
      return [
        "- Clean in the inspected top-level workspace",
        `- Scope: ${workspace.scopeKind}; untracked enumeration: ${workspace.untrackedMode}`,
        `- Nested submodule worktrees: ${workspace.nestedSubmoduleWorktrees}`,
      ];
    }

    if (workspace.detailMode === "fresh-observation") {
      const directoryRecords = workspace.compactDirectories.length;
      return [
        `- ${
          directoryRecords === 0
            ? plural(workspace.counts.observedEntries, "path")
            : plural(
                workspace.counts.observedEntries,
                "workspace status record",
              )
        } observed at report time; exact paths require a fresh report-detail observation`,
        `- Scope: ${workspace.scopeKind}; untracked enumeration: ${workspace.untrackedMode}`,
        `- Conflicts observed: ${workspace.counts.conflicted}`,
        ...(directoryRecords > 0
          ? [
              `- ${plural(directoryRecords, "compact directory record")} (not an exact file count)`,
            ]
          : []),
        `- Nested submodule worktrees: ${workspace.nestedSubmoduleWorktrees}`,
      ];
    }

    return [
      ...workspace.exactPaths.map(
        ({ category, status, path }) =>
          `- ${category}: \`${path.display}\` (${status})`,
      ),
      `- Scope: ${workspace.scopeKind}; untracked enumeration: ${workspace.untrackedMode}`,
      `- Conflicts observed: ${workspace.counts.conflicted}`,
      `- Nested submodule worktrees: ${workspace.nestedSubmoduleWorktrees}`,
    ];
  }

  const groups = [
    ["Staged", workspace.staged],
    ["Unstaged", workspace.unstaged],
    ["Untracked", workspace.untracked],
    ["Conflicted", workspace.conflicted],
  ].filter(([, entries]) => entries.length > 0);

  if (groups.length === 0) {
    return ["- Clean"];
  }

  return groups.flatMap(([heading, entries]) => [
    `- ${heading}:`,
    ...entries
      .slice(0, 49)
      .map(({ path, status }) => `  - \`${path}\` (${status})`),
    ...(entries.length >= 50
      ? [
          `  - ${entries.length} paths; see the machine-readable report for the full inventory`,
        ]
      : []),
  ]);
}

export function renderCommitReport(report) {
  const { commit, statistics, verification, checks, publication, workspace } =
    report;
  const comparison = report.comparison ?? {
    parentMatches: commit.parentMatches,
    treeMatches: commit.treeMatches,
    messageMatches: commit.messageMatches,
    signatureHeaderPresent: commit.signed,
  };
  const comparisonsMatch =
    comparison.parentMatches &&
    comparison.treeMatches &&
    comparison.messageMatches;
  const outcome =
    !comparison.signatureHeaderPresent || !comparisonsMatch
      ? "Created commit; signing/comparison invariant failed"
      : verification.blocksPush
        ? "Created commit; publication blocked"
        : "Created signed commit";
  const target = report.headAnchor?.targetRef ?? commit.branch;
  const targetText =
    report.headAnchor?.headKind === "detached" || target === null
      ? "detached `HEAD`"
      : `\`${target}\``;
  const lines = [
    `${outcome} \`${commit.shortOid}\` on ${targetText}:`,
    `\`${commit.subject}\``,
    "",
    "Commit:",
    `- Author: ${commit.author.name} <${commit.author.email}>`,
  ];

  if (
    commit.author.name !== commit.committer.name ||
    commit.author.email !== commit.committer.email
  ) {
    lines.push(
      `- Committer: ${commit.committer.name} <${commit.committer.email}>`,
    );
  }

  lines.push("", "Comparison:");
  lines.push(
    `- Snapshot: ${
      comparison.treeMatches
        ? "Matches the approved staged tree"
        : "DIFFERS from the approved staged tree"
    }`,
    `- Message: ${
      comparison.messageMatches
        ? "Matches the approved message"
        : "DIFFERS from the approved message"
    }`,
    `- Parent: ${
      comparison.parentMatches
        ? "Matches the approved parent array"
        : "DIFFERS from the approved parent array"
    }`,
    `- Signed commit header: ${
      comparison.signatureHeaderPresent ? "Present" : "MISSING"
    }`,
    "",
    "Changes:",
    `- ${plural(statistics.files, "file")}` +
      (statistics.additions === null || statistics.deletions === null
        ? "; line statistics deferred by the approved snapshot budget"
        : `, ${plural(statistics.additions, "insertion")}, ` +
          plural(statistics.deletions, "deletion") +
          (statistics.binaryFiles > 0
            ? `, ${plural(statistics.binaryFiles, "binary file")} with unavailable line counts`
            : "")),
    `- Types: ${renderKinds(statistics.kinds) || "none"}`,
    "",
    "Checks:",
  );

  if ((checks.checks ?? []).length === 0) {
    lines.push("- No checks were run in this workflow");
  } else {
    for (const check of checks.checks) {
      lines.push(`- ${check.label}: ${check.status} (${check.context})`);
    }
  }

  lines.push(
    "",
    "Signature:",
    `- Policy: ${verification.finalPolicy}${
      verification.initialPolicy !== verification.finalPolicy
        ? ` (overridden from ${verification.initialPolicy})`
        : ""
    }`,
    `- Result: ${verificationText(verification)}`,
    "",
    "Workspace:",
    ...renderWorkspace(workspace),
    "",
    "Publication:",
  );

  if (publication.status === "not-requested") {
    lines.push("- Not requested; no successful push was recorded");
  } else if (new Set(["pushed", "succeeded"]).has(publication.status)) {
    lines.push(
      `- The helper pushed \`${publication.commitOid}\` to \`${publication.remote}\` ` +
        `\`${publication.destination}\`; successful push witnessed`,
    );
  } else if (publication.status === "observed-matching") {
    lines.push(
      `- Remote \`${publication.remote}\` \`${publication.destination}\` was observed at ` +
        `\`${publication.commitOid}\`; the original push actor and attempt remain unproven`,
    );
  } else if (publication.status === "unknown") {
    lines.push(
      `- Push outcome is unknown for \`${publication.remote}\` ` +
        `\`${publication.destination}\`; no successful push was recorded`,
    );
  } else if (publication.status === "blocked") {
    lines.push(
      "- Not attempted because publication is blocked; no successful push was recorded",
    );
  } else {
    lines.push(
      `- Push was rejected for \`${publication.commitOid}\` to ` +
        `\`${publication.remote}\` \`${publication.destination}\`; no successful push was recorded`,
    );
  }

  const recovery = [];

  if (publication.status === "unknown") {
    recovery.push("- Recovery is required before another publication attempt");
  }

  if (publication.transcript?.retainRecommended) {
    recovery.push(
      `- Retained publication log: ${publication.transcript.path} ` +
        `(SHA-256 ${publication.transcript.sha256})`,
    );
  }

  if (recovery.length > 0) {
    lines.push("", "Recovery:", ...recovery);
  }

  lines.push("");
  return lines.join("\n");
}
