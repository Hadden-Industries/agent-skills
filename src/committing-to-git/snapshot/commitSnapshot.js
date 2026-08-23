import { runReadOnlyGit, writeIndexTree } from "../git/gitRepository.js";
import { comparePathBytes, pathRecord, splitNul } from "../git/gitPath.js";

export const MAXIMUM_SIMILARITY_CANDIDATE_PAIRS = 40_000;
export const MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES = 64 * 1024 * 1024;

const RENAME_SCORE = 50;
const ZERO_OBJECT_ID = /^(?:0{40}|0{64})$/u;

function parseNonNegativeInteger(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${label} must be a non-negative integer.`);
    }

    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return BigInt(value);
  }

  throw new Error(`${label} must be a non-negative integer.`);
}

function serializedInteger(value) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value.toString(10);
}

export function selectRenamePolicy({
  addedCandidates,
  deletedCandidates,
  maximumCandidatePairs = MAXIMUM_SIMILARITY_CANDIDATE_PAIRS,
}) {
  const added = parseNonNegativeInteger(
    addedCandidates,
    "Added rename candidates",
  );
  const deleted = parseNonNegativeInteger(
    deletedCandidates,
    "Deleted rename candidates",
  );
  const maximum = parseNonNegativeInteger(
    maximumCandidatePairs,
    "Maximum rename candidate pairs",
  );
  const candidatePairs = added * deleted;

  return {
    mode: candidatePairs <= maximum ? "eager" : "deferred",
    candidatePairs: serializedInteger(candidatePairs),
  };
}

export function selectLineStatisticsPolicy({
  eligibleBlobBytes,
  maximumEagerBytes = MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES,
}) {
  const eligible = parseNonNegativeInteger(
    eligibleBlobBytes,
    "Eligible blob bytes",
  );
  const maximum = parseNonNegativeInteger(
    maximumEagerBytes,
    "Maximum eager line-stat bytes",
  );

  return {
    mode: eligible <= maximum ? "eager" : "deferred",
    eligibleBlobBytes: serializedInteger(eligible),
  };
}

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

function normalizedChangeUnit(record) {
  const source = pathRecord(record.sourceBytes);
  const destination = pathRecord(record.destinationBytes);
  const renamed = record.kind === "renamed";
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
    id: null,
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
    renameClassification: renamed ? "similarity" : null,
    lineStatistics: "deferred",
    binary: null,
    additions: null,
    deletions: null,
    stageablePaths: [],
    inspectionUnitIds: [],
  };
}

function renameCandidateSide(unit) {
  if (unit.newMode === "000000" && !ZERO_OBJECT_ID.test(unit.oldOid)) {
    return "deletion";
  }

  if (unit.oldMode === "000000" && !ZERO_OBJECT_ID.test(unit.newOid)) {
    return "addition";
  }

  return null;
}

function exactObjectBucket(unit) {
  const side = renameCandidateSide(unit);

  if (side === "deletion") {
    return `${unit.oldMode}:${unit.oldOid}`;
  }

  if (side === "addition") {
    return `${unit.newMode}:${unit.newOid}`;
  }

  return null;
}

function sortChangeUnits(units) {
  return [...units].sort((left, right) =>
    comparePathBytes(
      Buffer.from(left.destinationPathBytesBase64, "base64"),
      Buffer.from(right.destinationPathBytesBase64, "base64"),
    ),
  );
}

export function pairExactObjectRenames(changeUnits) {
  const buckets = new Map();

  for (const unit of changeUnits) {
    const bucket = exactObjectBucket(unit);

    if (bucket === null) {
      continue;
    }

    const entry = buckets.get(bucket) ?? { additions: [], deletions: [] };
    entry[
      renameCandidateSide(unit) === "addition" ? "additions" : "deletions"
    ].push(unit);
    buckets.set(bucket, entry);
  }

  const consumed = new Set();
  const replacements = [];
  const classifications = new Map();

  for (const { additions, deletions } of buckets.values()) {
    if (additions.length === 1 && deletions.length === 1) {
      const [addition] = additions;
      const [deletion] = deletions;

      consumed.add(addition);
      consumed.add(deletion);
      replacements.push({
        ...addition,
        kind: "renamed",
        sourcePath: deletion.destinationPath,
        path: null,
        sourcePathBytesBase64: deletion.destinationPathBytesBase64,
        displayPath: `${deletion.displayPath} -> ${addition.displayPath}`,
        oldMode: deletion.oldMode,
        oldOid: deletion.oldOid,
        similarity: 100,
        renameClassification: "exact-object",
      });
    } else if (additions.length > 0 && deletions.length > 0) {
      for (const unit of [...additions, ...deletions]) {
        classifications.set(unit, "exact-rename-ambiguous");
      }
    }
  }

  return sortChangeUnits([
    ...changeUnits
      .filter((unit) => !consumed.has(unit))
      .map((unit) => ({
        ...unit,
        renameClassification:
          classifications.get(unit) ?? unit.renameClassification ?? null,
      })),
    ...replacements,
  ]);
}

function applySimilarityRenames(changeUnits, similarityRecords) {
  let units = [...changeUnits];

  for (const record of similarityRecords.filter(
    ({ kind }) => kind === "renamed",
  )) {
    const similarity = normalizedChangeUnit(record);
    const sourceIndex = units.findIndex(
      (unit) =>
        renameCandidateSide(unit) === "deletion" &&
        unit.destinationPathBytesBase64 === similarity.sourcePathBytesBase64 &&
        unit.renameClassification === null,
    );
    const destinationIndex = units.findIndex(
      (unit) =>
        renameCandidateSide(unit) === "addition" &&
        unit.destinationPathBytesBase64 ===
          similarity.destinationPathBytesBase64 &&
        unit.renameClassification === null,
    );

    if (sourceIndex < 0 || destinationIndex < 0) {
      continue;
    }

    const kept = units.filter(
      (_, index) => index !== sourceIndex && index !== destinationIndex,
    );
    units = [...kept, similarity];
  }

  return sortChangeUnits(units);
}

function objectIdsForUnits(changeUnits) {
  return [
    ...new Set(
      changeUnits
        .flatMap(({ oldOid, newOid }) => [oldOid, newOid])
        .filter((oid) => !ZERO_OBJECT_ID.test(oid)),
    ),
  ];
}

function inspectObjectSizes(root, env, changeUnits) {
  const objectIds = objectIdsForUnits(changeUnits);

  if (objectIds.length === 0) {
    return {
      eligibleBlobBytes: 0n,
      unavailableObjectIds: [],
    };
  }

  const result = runReadOnlyGit(
    root,
    "cat-file",
    ["--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    {
      env,
      input: Buffer.from(`${objectIds.join("\n")}\n`, "ascii"),
    },
  );
  const lines = result.stdout.toString("utf8").trim().split(/\r?\n/u);
  const objects = new Map();
  const unavailableObjectIds = [];

  if (lines.length !== objectIds.length) {
    throw new Error("Git returned an incomplete cat-file batch response.");
  }

  for (let index = 0; index < objectIds.length; index += 1) {
    const requestedOid = objectIds[index];
    const fields = lines[index].split(" ");

    if (fields.length === 2 && fields[1] === "missing") {
      unavailableObjectIds.push(requestedOid);
      continue;
    }

    if (
      fields.length !== 3 ||
      fields[0] !== requestedOid ||
      !new Set(["blob", "tree", "commit", "tag"]).has(fields[1])
    ) {
      throw new Error(
        `Git returned malformed object metadata for ${requestedOid}.`,
      );
    }

    objects.set(requestedOid, {
      type: fields[1],
      size: parseNonNegativeInteger(fields[2], "Git object size"),
    });
  }

  let eligibleBlobBytes = 0n;

  for (const unit of changeUnits) {
    for (const oid of [unit.oldOid, unit.newOid]) {
      const object = objects.get(oid);

      if (object?.type === "blob") {
        eligibleBlobBytes += object.size;
      }
    }
  }

  return { eligibleBlobBytes, unavailableObjectIds };
}

function statisticsForUnit(unit, statistics) {
  if (
    unit.kind === "renamed" &&
    unit.renameClassification === "exact-object" &&
    unit.oldOid === unit.newOid &&
    unit.oldMode === unit.newMode
  ) {
    return { additions: 0, deletions: 0, binary: false };
  }

  const paths = [
    ...(unit.sourcePathBytesBase64 ? [unit.sourcePathBytesBase64] : []),
    unit.destinationPathBytesBase64,
  ];
  const entries = paths
    .map((path) => statistics.get(path))
    .filter((entry) => entry !== undefined);

  if (entries.length === 0) {
    return { additions: 0, deletions: 0, binary: false };
  }

  if (entries.some(({ binary }) => binary)) {
    return { additions: null, deletions: null, binary: true };
  }

  return {
    additions: entries.reduce((total, entry) => total + entry.additions, 0),
    deletions: entries.reduce((total, entry) => total + entry.deletions, 0),
    binary: false,
  };
}

function assignIdentifiers(changeUnits) {
  return sortChangeUnits(changeUnits).map((unit, index) => ({
    ...unit,
    id: `F${String(index + 1).padStart(6, "0")}`,
  }));
}

export function buildSnapshot({
  root,
  env,
  workflowMode,
  scopeKind,
  sourceIndex,
  headOid,
  indexTreeOid = null,
  maximumSimilarityCandidatePairs = MAXIMUM_SIMILARITY_CANDIDATE_PAIRS,
  maximumEagerLineStatInputBytes = MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES,
}) {
  const comparison = headOid ? [headOid] : ["--root"];
  const rawArguments = [
    "--cached",
    "-z",
    "--raw",
    "--no-abbrev",
    "--no-renames",
    ...comparison,
    "--",
  ];
  const initialRecords = parseRawDiff(
    runReadOnlyGit(root, "diff", rawArguments, { env }).stdout,
  );
  const initialUnits = initialRecords.map(normalizedChangeUnit);
  let changeUnits = pairExactObjectRenames(initialUnits);
  const addedCandidates = initialUnits.filter(
    (unit) => renameCandidateSide(unit) === "addition",
  ).length;
  const deletedCandidates = initialUnits.filter(
    (unit) => renameCandidateSide(unit) === "deletion",
  ).length;
  const renameSelection = selectRenamePolicy({
    addedCandidates,
    deletedCandidates,
    maximumCandidatePairs: maximumSimilarityCandidatePairs,
  });
  const warnings = [];

  if (
    renameSelection.mode === "eager" &&
    addedCandidates > 0 &&
    deletedCandidates > 0
  ) {
    const similarityArguments = [
      "--cached",
      "-z",
      "--raw",
      "--no-abbrev",
      `--find-renames=${RENAME_SCORE}%`,
      "-l0",
      ...comparison,
      "--",
    ];
    const similarityRecords = parseRawDiff(
      runReadOnlyGit(root, "diff", similarityArguments, { env }).stdout,
    );
    changeUnits = applySimilarityRenames(changeUnits, similarityRecords);
  } else if (renameSelection.mode === "deferred") {
    warnings.push(
      `Similarity rename detection deferred: ${renameSelection.candidatePairs} candidate pairs exceed the ${maximumSimilarityCandidatePairs} pair budget.`,
    );
  }

  const { eligibleBlobBytes, unavailableObjectIds } = inspectObjectSizes(
    root,
    env,
    changeUnits,
  );
  const selectedLineStatistics = selectLineStatisticsPolicy({
    eligibleBlobBytes,
    maximumEagerBytes: maximumEagerLineStatInputBytes,
  });
  const lineStatistics = {
    ...selectedLineStatistics,
    mode:
      unavailableObjectIds.length > 0
        ? "deferred"
        : selectedLineStatistics.mode,
  };

  for (const oid of unavailableObjectIds) {
    warnings.push(`required-object-unavailable:${oid}`);
  }

  if (lineStatistics.mode === "eager" && changeUnits.length > 0) {
    const numstatArguments = [
      "--cached",
      "-z",
      "--numstat",
      "--no-renames",
      ...comparison,
      "--",
    ];
    const statistics = parseNumstat(
      runReadOnlyGit(root, "diff", numstatArguments, { env }).stdout,
    );
    changeUnits = changeUnits.map((unit) => ({
      ...unit,
      ...statisticsForUnit(unit, statistics),
      lineStatistics: "eager",
    }));
  }

  changeUnits = assignIdentifiers(changeUnits);
  const textUnits = changeUnits.filter(({ binary }) => binary === false);
  const deferredStatistics = lineStatistics.mode === "deferred";

  return {
    schemaVersion: 2,
    workflowMode,
    scopeKind,
    sourceIndex,
    repositoryRoot: root,
    headOid,
    indexTreeOid: indexTreeOid ?? writeIndexTree(root, env),
    diffPolicy: {
      renameScore: RENAME_SCORE,
      copyDetection: false,
      renameLimit: 0,
      externalDiff: false,
      textconv: false,
      rename: {
        mode: renameSelection.mode,
        maximumCandidatePairs: maximumSimilarityCandidatePairs,
        addedCandidates,
        deletedCandidates,
        candidatePairs: renameSelection.candidatePairs,
      },
      lineStatistics: {
        mode: lineStatistics.mode,
        maximumEagerBytes: maximumEagerLineStatInputBytes,
        eligibleBlobBytes: lineStatistics.eligibleBlobBytes,
      },
    },
    changeUnitCount: changeUnits.length,
    changeUnits,
    statistics: {
      files: changeUnits.length,
      additions: deferredStatistics
        ? null
        : textUnits.reduce((total, unit) => total + unit.additions, 0),
      deletions: deferredStatistics
        ? null
        : textUnits.reduce((total, unit) => total + unit.deletions, 0),
      binaryFiles: deferredStatistics
        ? null
        : changeUnits.length - textUnits.length,
    },
    warnings,
  };
}
