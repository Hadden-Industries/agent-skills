import { runGit, writeIndexTree } from "../git/gitRepository.js";
import { comparePathBytes, pathRecord, splitNul } from "../git/gitPath.js";

const DIFF_POLICY = Object.freeze({
  renameScore: 50,
  // Similarity can aid rename navigation but cannot establish copy provenance.
  copyDetection: false,
  renameLimit: 1000,
  externalDiff: false,
  textconv: false,
});

function kindForStatus(status) {
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

function parseRawDiff(buffer) {
  const fields = splitNul(buffer);
  const records = [];

  for (let index = 0; index < fields.length;) {
    const header = fields[index].toString("ascii");

    if (!header.startsWith(":")) {
      throw new Error(`Unexpected raw diff field: ${JSON.stringify(header)}`);
    }

    const parts = header.slice(1).split(" ");
    const [oldMode, newMode, oldOid, newOid, status] = parts;
    const renamedOrCopied = status.startsWith("R") || status.startsWith("C");
    const sourceBytes = fields[index + 1];
    const destinationBytes = renamedOrCopied ? fields[index + 2] : sourceBytes;

    if (!sourceBytes || !destinationBytes) {
      throw new Error(`Incomplete raw diff record for ${status}`);
    }

    records.push({
      oldMode,
      newMode,
      oldOid,
      newOid,
      status,
      kind: kindForStatus(status),
      similarity: renamedOrCopied ? Number(status.slice(1)) : null,
      sourceBytes,
      destinationBytes,
    });

    index += renamedOrCopied ? 3 : 2;
  }

  return records;
}

function parseNumstat(buffer) {
  const fields = splitNul(buffer);
  const statistics = new Map();

  for (let index = 0; index < fields.length;) {
    const header = fields[index];
    const firstTab = header.indexOf(9);
    const secondTab = firstTab < 0 ? -1 : header.indexOf(9, firstTab + 1);

    if (firstTab < 0 || secondTab < 0) {
      throw new Error("Unexpected numstat record.");
    }

    const addedText = header.subarray(0, firstTab).toString("ascii");
    const deletedText = header
      .subarray(firstTab + 1, secondTab)
      .toString("ascii");
    const inlinePath = header.subarray(secondTab + 1);
    const destinationBytes =
      inlinePath.length > 0 ? inlinePath : fields[index + 2];

    if (!destinationBytes) {
      throw new Error("Incomplete numstat path record.");
    }

    statistics.set(destinationBytes.toString("base64"), {
      additions: addedText === "-" ? null : Number(addedText),
      deletions: deletedText === "-" ? null : Number(deletedText),
      binary: addedText === "-" || deletedText === "-",
    });
    index += inlinePath.length > 0 ? 1 : 3;
  }

  return statistics;
}

function normalizedChangeUnit(record, index, statistics) {
  const source = pathRecord(record.sourceBytes);
  const destination = pathRecord(record.destinationBytes);
  const renamed = record.kind === "renamed";
  const lineStatistics = statistics.get(
    record.destinationBytes.toString("base64"),
  ) ?? {
    additions: 0,
    deletions: 0,
    binary: false,
  };
  let kind = record.kind;

  if (record.oldMode === "160000" || record.newMode === "160000") {
    kind = "submodule-changed";
  } else if (record.oldMode === "120000" || record.newMode === "120000") {
    kind =
      record.oldMode === record.newMode ? "symlink-changed" : "type-changed";
  } else if (record.oldMode !== record.newMode && record.kind === "modified") {
    kind = "mode-changed";
  }

  return {
    id: `F${String(index + 1).padStart(6, "0")}`,
    kind,
    sourcePath: renamed ? source.text : null,
    destinationPath: destination.text,
    path: renamed ? null : destination.text,
    sourcePathBytesBase64: renamed ? source.bytesBase64 : null,
    destinationPathBytesBase64: destination.bytesBase64,
    displayPath: renamed
      ? `${source.display} -> ${destination.display}`
      : destination.display,
    oldMode: record.oldMode,
    newMode: record.newMode,
    oldOid: record.oldOid,
    newOid: record.newOid,
    similarity: renamed ? record.similarity : null,
    binary: lineStatistics.binary,
    additions: lineStatistics.additions,
    deletions: lineStatistics.deletions,
    stageablePaths: [],
    inspectionUnitIds: [],
  };
}

export function buildSnapshot({
  root,
  env,
  workflowMode,
  scopeKind,
  sourceIndex,
  headOid,
}) {
  const sharedArguments = [
    "-c",
    `diff.renameLimit=${DIFF_POLICY.renameLimit}`,
    "diff",
    "--cached",
    "-z",
    "--no-ext-diff",
    "--no-textconv",
    `--find-renames=${DIFF_POLICY.renameScore}%`,
    ...(headOid ? [headOid] : ["--root"]),
    "--",
  ];
  const rawResult = runGit(
    [
      ...sharedArguments.slice(0, 4),
      "--raw",
      "--no-abbrev",
      ...sharedArguments.slice(4),
    ],
    { cwd: root, env },
  );
  const numstatResult = runGit(
    [...sharedArguments.slice(0, 4), "--numstat", ...sharedArguments.slice(4)],
    { cwd: root, env },
  );

  const parsed = parseRawDiff(rawResult.stdout).sort((left, right) =>
    comparePathBytes(left.destinationBytes, right.destinationBytes),
  );
  const lineStatistics = parseNumstat(numstatResult.stdout);
  const changeUnits = parsed.map((record, index) =>
    normalizedChangeUnit(record, index, lineStatistics),
  );
  const textUnits = changeUnits.filter(({ binary }) => !binary);

  return {
    schemaVersion: 2,
    workflowMode,
    scopeKind,
    sourceIndex,
    repositoryRoot: root,
    headOid,
    indexTreeOid: writeIndexTree(root, env),
    diffPolicy: DIFF_POLICY,
    changeUnitCount: changeUnits.length,
    changeUnits,
    statistics: {
      files: changeUnits.length,
      additions: textUnits.reduce((total, unit) => total + unit.additions, 0),
      deletions: textUnits.reduce((total, unit) => total + unit.deletions, 0),
      binaryFiles: changeUnits.length - textUnits.length,
    },
    warnings: [],
  };
}
