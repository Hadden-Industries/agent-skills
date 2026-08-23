import { readOnlyGitText, runReadOnlyGit } from "../git/gitRepository.js";
import { splitNul } from "../git/gitPath.js";

const CHECK_STATUSES = new Set(["passed", "failed"]);
const VERIFICATION_POLICIES = new Set(["required", "advisory", "skipped"]);
const SIGNATURE_STATUSES = new Set([
  "verified",
  "failed",
  "unavailable",
  "skipped",
]);
const INTEGRITY_STATUSES = new Set([
  "not-run",
  "passed",
  "failed",
  "unavailable",
]);
const CHECK_CONTEXTS = new Set([
  "approved staged snapshot",
  "current working tree",
  "isolated worktree/container",
  "external environment",
]);

function hasExactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

function hasAllowedKeys(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);

  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    actual.every((key) => allowed.has(key))
  );
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
    "overridden",
    "signature",
    "integrityOnly",
    "signatureVerified",
    "blocksPush",
  ];
  const signatureKeys = ["status", "reason", "signer", "fingerprint"];
  const validSignature =
    hasAllowedKeys(verification?.signature, signatureKeys, [
      "keyType",
      "verifierOutput",
    ]) &&
    SIGNATURE_STATUSES.has(verification.signature.status) &&
    ["reason", "signer", "fingerprint", "keyType"].every(
      (key) =>
        verification.signature[key] === undefined ||
        verification.signature[key] === null ||
        typeof verification.signature[key] === "string",
    ) &&
    (verification.signature.verifierOutput === undefined ||
      typeof verification.signature.verifierOutput === "string");
  const validIntegrity =
    hasAllowedKeys(verification?.integrityOnly, ["status"], ["reason"]) &&
    INTEGRITY_STATUSES.has(verification.integrityOnly.status) &&
    (verification.integrityOnly.reason === undefined ||
      verification.integrityOnly.reason === null ||
      typeof verification.integrityOnly.reason === "string");
  const signatureVerified = verification?.signature?.status === "verified";

  if (
    !hasExactKeys(verification, topLevelKeys) ||
    verification.schemaVersion !== 1 ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(verification.commitOid) ||
    !VERIFICATION_POLICIES.has(verification.initialPolicy) ||
    !VERIFICATION_POLICIES.has(verification.finalPolicy) ||
    verification.overridden !==
      (verification.initialPolicy !== verification.finalPolicy) ||
    !validSignature ||
    !validIntegrity ||
    verification.signatureVerified !== signatureVerified ||
    verification.blocksPush !==
      (verification.finalPolicy === "required" && !signatureVerified) ||
    (verification.finalPolicy === "skipped" &&
      verification.signature.status !== "skipped")
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

function normalizeMessage(text) {
  return `${text.replace(/\r\n?/gu, "\n").replace(/\n+$/u, "")}\n`;
}

function commitFacts(root, commitOid) {
  const fields = readOnlyGitText(root, "show-commit-fields", [
    "--format=%H%x00%P%x00%T%x00%an%x00%ae%x00%cn%x00%ce%x00%s",
    commitOid,
  ])
    .replace(/\r?\n$/u, "")
    .split("\0");
  const message = readOnlyGitText(root, "show-message", [commitOid]);
  const raw = runReadOnlyGit(root, "cat-file", ["commit", commitOid]).stdout;
  const branchResult = runReadOnlyGit(root, "short-symbolic-head", [], {
    allowFailure: true,
  });

  return {
    oid: fields[0],
    parents: fields[1] ? fields[1].split(" ") : [],
    treeOid: fields[2],
    author: { name: fields[3], email: fields[4] },
    committer: { name: fields[5], email: fields[6] },
    subject: fields[7],
    message: normalizeMessage(message),
    signed: raw.includes(Buffer.from("\ngpgsig ")),
    branch:
      branchResult.status === 0
        ? branchResult.stdout.toString("utf8").trim()
        : null,
    shortOid: readOnlyGitText(root, "short-object-id", [commitOid]).trim(),
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

export function collectCommitReport({
  root,
  commitOid,
  manifest,
  approvedMessage,
  verification,
  checks,
  publication = { status: "not-requested" },
}) {
  const commit = commitFacts(root, commitOid);

  validateChecksArtifact(checks);
  validatePublicationArtifact(publication);
  validateVerificationArtifact(verification, commit.oid);

  if (
    publication.status !== "not-requested" &&
    publication.commitOid !== commit.oid
  ) {
    throw new Error("Publication artifact belongs to a different commit.");
  }

  commit.treeMatches = commit.treeOid === manifest.indexTreeOid;
  commit.messageMatches = commit.message === normalizeMessage(approvedMessage);

  if (manifest.headOid) {
    commit.parentMatches =
      commit.parents.length === 1 && commit.parents[0] === manifest.headOid;
  } else {
    commit.parentMatches = commit.parents.length === 0;
  }

  const approvedStatistics = commit.treeMatches
    ? manifestStatistics(manifest)
    : null;

  return {
    schemaVersion: 1,
    commit,
    statistics: approvedStatistics ?? commitStatistics(root, commitOid),
    verification,
    checks,
    publication,
    workspace: workspaceState(root),
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
  switch (verification.signature.status) {
    case "verified": {
      const identity = `${
        verification.signature.signer
          ? ` for ${verification.signature.signer}`
          : ""
      }${
        verification.signature.fingerprint
          ? ` (${verification.signature.fingerprint})`
          : ""
      }`;

      if (verification.signature.keyType === "OpenPGP") {
        return (
          `OpenPGP signature is cryptographically valid${identity}; ` +
          "identity authorization was not assessed"
        );
      }

      return verification.signature.keyType
        ? `SSH signature verification succeeded${identity}`
        : `Signature verification succeeded${identity}`;
    }
    case "skipped":
      return "Skipped by user policy";
    case "unavailable":
      return verification.signature.reason === "trust-store-unreadable"
        ? "Unavailable because the configured trust store could not be read"
        : "Signature verification unavailable";
    default:
      return "Signature verification failed";
  }
}

function renderWorkspace(workspace) {
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
  const lines = [
    `Created ${commit.signed ? "signed " : ""}commit \`${commit.shortOid}\` on ` +
      `\`${commit.branch ?? "detached HEAD"}\`:`,
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

  lines.push(
    `- Snapshot: ${
      commit.treeMatches
        ? "Matches the approved staged tree"
        : "DIFFERS from the approved staged tree"
    }`,
    `- Message: ${
      commit.messageMatches
        ? "Matches the approved message"
        : "DIFFERS from the approved message"
    }`,
    `- Parent: ${
      commit.parentMatches
        ? "Matches the approved one-parent contract"
        : "DIFFERS from the approved one-parent contract"
    }`,
    `- Changes: ${plural(statistics.files, "file")}` +
      (statistics.additions === null || statistics.deletions === null
        ? "; line statistics deferred by the approved snapshot budget"
        : `, ${plural(statistics.additions, "insertion")}, ` +
          plural(statistics.deletions, "deletion") +
          (statistics.binaryFiles > 0
            ? `, ${plural(statistics.binaryFiles, "binary file")} with unavailable line counts`
            : "")),
    `- Change types: ${renderKinds(statistics.kinds) || "none"}`,
    "",
    "Signature:",
    `- Policy: ${verification.finalPolicy}${
      verification.overridden
        ? ` (overridden from ${verification.initialPolicy})`
        : ""
    }`,
    `- Result: ${verificationText(verification)}`,
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

  lines.push("", "Publication:");

  if (publication.status === "not-requested") {
    lines.push("- Not requested; not attempted by this workflow");
  } else if (publication.status === "pushed") {
    lines.push(
      `- Pushed \`${publication.commitOid}\` to \`${publication.remote}\` ` +
        `\`${publication.destination}\``,
    );
  } else {
    lines.push(
      `- Push failed for \`${publication.commitOid}\` to ` +
        `\`${publication.remote}\` \`${publication.destination}\` ` +
        `(exit ${publication.exitCode}); see publication.json for Git output`,
    );
  }

  lines.push("", "Workspace:", ...renderWorkspace(workspace), "");
  return lines.join("\n");
}
