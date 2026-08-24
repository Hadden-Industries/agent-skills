import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import {
  createScopeSynopsis,
  manifestDigest,
  safeBoundedText,
  sha256Bytes,
  stableJsonBytes,
} from "./inlineEvidenceCapsule.js";
import {
  MAXIMUM_PACKET_BYTES,
  writePacketBytesSync,
  writePacketChunksSync,
  writePacketStream,
} from "./streamingPacketWriter.js";
import { readOnlyGitText, streamGit } from "../git/gitRepository.js";
import { formatGitAlternatePaths } from "../snapshot/createSnapshot.js";

const EVIDENCE_POLICIES = new Set(["reuse", "message", "review"]);
const BASIS_KINDS = new Set([
  "authored-current-task",
  "read-current-task",
  "task-lineage",
  "user-grounded",
  "generated-derived",
  "unknown-preexisting",
]);
const REUSE_BASIS_KINDS = new Set([
  "authored-current-task",
  "read-current-task",
  "task-lineage",
  "generated-derived",
]);
const ARRAY_SELECTOR_FIELDS = [
  "ids",
  "destinationPaths",
  "destinationPathPrefixes",
  "sourcePaths",
  "sourcePathPrefixes",
  "kinds",
];
const SELECTOR_FIELDS = new Set(["all", "remaining", ...ARRAY_SELECTOR_FIELDS]);
const PACKET_PREFIXES = Object.freeze({
  "scope-synopsis": "S",
  "exact-inventory": "I",
  "text-patch": "P",
  "deleted-content": "D",
});
const MAXIMUM_BASIS_NOTE_BYTES = 512;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalCatalogPayload(catalog) {
  return Object.fromEntries(
    Object.entries(catalog).filter(
      ([key]) =>
        key !== "catalogSha256" &&
        key !== "catalogPath" &&
        key !== "priorCoverage",
    ),
  );
}

function withCatalogIdentity(catalog, catalogPath) {
  Object.defineProperty(catalog, "catalogPath", {
    configurable: true,
    enumerable: false,
    value: catalogPath,
    writable: false,
  });
  return catalog;
}

function digestCatalog(catalog) {
  return sha256Bytes(stableJsonBytes(canonicalCatalogPayload(catalog)));
}

function pathBytes(unit, direction) {
  const encoded = unit[`${direction}PathBytesBase64`];

  if (typeof encoded === "string") {
    return Buffer.from(encoded, "base64");
  }

  const text = unit[`${direction}Path`];
  return typeof text === "string" ? Buffer.from(text, "utf8") : null;
}

function assertRepositoryPath(value, { prefix, label }) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    prefix !== value.endsWith("/")
  ) {
    throw new Error(`${label} is not a canonical repository-relative path.`);
  }

  const components = value.split("/");
  const meaningful = prefix ? components.slice(0, -1) : components;

  if (
    meaningful.some(
      (component) =>
        component.length === 0 || component === "." || component === "..",
    )
  ) {
    throw new Error(`${label} contains an invalid path component.`);
  }
}

function normalizedSelection(selection) {
  if (!isPlainObject(selection)) {
    throw new Error("Evidence selection must be an object.");
  }

  const unknown = Object.keys(selection).find(
    (field) => !SELECTOR_FIELDS.has(field),
  );

  if (unknown) {
    throw new Error(`Unknown evidence selector field ${unknown}.`);
  }

  const all = selection.all === true;
  const remaining = selection.remaining === true;

  if (
    ("all" in selection && typeof selection.all !== "boolean") ||
    ("remaining" in selection && typeof selection.remaining !== "boolean")
  ) {
    throw new Error("Evidence all and remaining selectors must be booleans.");
  }

  const populatedArrayFields = ARRAY_SELECTOR_FIELDS.filter(
    (field) => Array.isArray(selection[field]) && selection[field].length > 0,
  );

  for (const field of ARRAY_SELECTOR_FIELDS) {
    const values = selection[field];

    if (values === undefined) {
      continue;
    }

    if (
      !Array.isArray(values) ||
      values.some((value) => typeof value !== "string" || value.length === 0)
    ) {
      throw new Error(`Evidence selector ${field} must be a string array.`);
    }

    if (new Set(values).size !== values.length) {
      throw new Error(`Evidence selector ${field} contains duplicates.`);
    }

    if (field.endsWith("Paths")) {
      values.forEach((value) =>
        assertRepositoryPath(value, { prefix: false, label: field }),
      );
    } else if (field.endsWith("Prefixes")) {
      values.forEach((value) =>
        assertRepositoryPath(value, { prefix: true, label: field }),
      );
    }
  }

  if (
    (all || remaining) &&
    (all === remaining || populatedArrayFields.length > 0)
  ) {
    throw new Error(
      "Evidence all and remaining selectors are exclusive of every other selector field.",
    );
  }

  if (!all && !remaining && populatedArrayFields.length === 0) {
    throw new Error("Evidence selection must contain a nonempty selector.");
  }

  if (all) {
    return { all: true };
  }

  if (remaining) {
    return { remaining: true };
  }

  return Object.fromEntries(
    ARRAY_SELECTOR_FIELDS.filter((field) =>
      populatedArrayFields.includes(field),
    ).map((field) => {
      const values = [...selection[field]].sort((left, right) =>
        Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
      );
      return [field, values];
    }),
  );
}

function prefixMatches(path, prefix) {
  return (
    path !== null &&
    path.length >= prefix.length &&
    path.subarray(0, prefix.length).equals(prefix)
  );
}

function matchesSelectorField(unit, field, values) {
  switch (field) {
    case "ids":
      return values.includes(unit.id);
    case "kinds":
      return values.includes(unit.kind);
    case "destinationPaths": {
      const bytes = pathBytes(unit, "destination");
      return values.some((value) => bytes?.equals(Buffer.from(value, "utf8")));
    }
    case "destinationPathPrefixes": {
      const bytes = pathBytes(unit, "destination");
      return values.some((value) =>
        prefixMatches(bytes, Buffer.from(value, "utf8")),
      );
    }
    case "sourcePaths": {
      if (unit.kind !== "renamed") {
        return false;
      }
      const bytes = pathBytes(unit, "source");
      return values.some((value) => bytes?.equals(Buffer.from(value, "utf8")));
    }
    case "sourcePathPrefixes": {
      if (unit.kind !== "renamed") {
        return false;
      }
      const bytes = pathBytes(unit, "source");
      return values.some((value) =>
        prefixMatches(bytes, Buffer.from(value, "utf8")),
      );
    }
    default:
      throw new Error(`Unsupported selector field ${field}.`);
  }
}

function resolveSelection(manifest, selection, assignedIds = new Set()) {
  if (selection.all === true) {
    return [...manifest.changeUnits];
  }

  if (selection.remaining === true) {
    return manifest.changeUnits.filter(({ id }) => !assignedIds.has(id));
  }

  const matches = new Set();

  for (const [field, values] of Object.entries(selection)) {
    const fieldMatches = manifest.changeUnits.filter((unit) =>
      matchesSelectorField(unit, field, values),
    );

    if (fieldMatches.length === 0) {
      throw new Error(
        `Evidence selector field ${field} matched no change units.`,
      );
    }

    fieldMatches.forEach((unit) => matches.add(unit.id));
  }

  return manifest.changeUnits.filter(({ id }) => matches.has(id));
}

function ordinalForId(id) {
  const match = /^F([0-9]{6})$/u.exec(id);

  if (!match) {
    throw new Error(`Change-unit ID ${id} is not canonical.`);
  }

  return Number(match[1]);
}

function rangesForUnits(units) {
  const ordinals = units
    .map(({ id }) => ordinalForId(id))
    .sort((a, b) => a - b);
  const ranges = [];

  for (const ordinal of ordinals) {
    const prior = ranges.at(-1);

    if (prior && prior.lastOrdinal + 1 === ordinal) {
      prior.lastOrdinal = ordinal;
      prior.last = `F${String(ordinal).padStart(6, "0")}`;
    } else {
      ranges.push({
        first: `F${String(ordinal).padStart(6, "0")}`,
        last: `F${String(ordinal).padStart(6, "0")}`,
        lastOrdinal: ordinal,
      });
    }
  }

  return ranges.map(({ first, last }) => ({ first, last }));
}

function validateBasis(policy, basis) {
  if (
    !isPlainObject(basis) ||
    !BASIS_KINDS.has(basis.kind) ||
    !(basis.note === null || typeof basis.note === "string") ||
    (typeof basis.note === "string" &&
      Buffer.byteLength(basis.note, "utf8") > MAXIMUM_BASIS_NOTE_BYTES)
  ) {
    throw new Error("Evidence basis is invalid.");
  }

  if (policy === "reuse" && !REUSE_BASIS_KINDS.has(basis.kind)) {
    throw new Error(
      "Reuse evidence requires authored, read, generated, or specific task-lineage basis.",
    );
  }

  if (
    policy === "reuse" &&
    basis.kind === "task-lineage" &&
    (typeof basis.note !== "string" || basis.note.trim().length === 0)
  ) {
    throw new Error(
      "Reuse task-lineage basis requires a specific nonempty note.",
    );
  }

  return { kind: basis.kind, note: basis.note };
}

export function canonicalizeEvidencePlan({ manifest, groups }) {
  if (
    !manifest ||
    !Array.isArray(manifest.changeUnits) ||
    manifest.changeUnitCount !== manifest.changeUnits.length ||
    manifest.changeUnitCount < 1
  ) {
    throw new Error("Evidence planning requires one nonempty exact manifest.");
  }

  if (!Array.isArray(groups) || groups.length === 0 || groups.length > 4096) {
    throw new Error("Evidence plan groups must be a bounded nonempty array.");
  }

  const assignedIds = new Set();
  const canonicalGroups = groups.map((group, index) => {
    if (!isPlainObject(group) || !EVIDENCE_POLICIES.has(group.policy)) {
      throw new Error(`Evidence group ${index + 1} has an invalid policy.`);
    }

    const selection = normalizedSelection(group.selection);

    if (selection.remaining === true && index !== groups.length - 1) {
      throw new Error(
        "The remaining evidence selector is valid only in the final group.",
      );
    }

    const units = resolveSelection(manifest, selection, assignedIds);

    if (units.length === 0) {
      throw new Error(`Evidence group ${index + 1} matched no change units.`);
    }

    const overlap = units.find(({ id }) => assignedIds.has(id));

    if (overlap) {
      throw new Error(`Evidence groups overlap at ${overlap.id}.`);
    }

    units.forEach(({ id }) => assignedIds.add(id));
    const canonicalGroup = {
      id: `E${String(index + 1).padStart(6, "0")}`,
      selection,
      policy: group.policy,
      basis: validateBasis(group.policy, group.basis),
      changeUnitRanges: rangesForUnits(units),
      changeUnitCount: units.length,
    };

    Object.defineProperty(canonicalGroup, "changeUnitIds", {
      enumerable: false,
      value: units.map(({ id }) => id),
    });
    return canonicalGroup;
  });

  if (assignedIds.size !== manifest.changeUnitCount) {
    throw new Error(
      `Evidence plan must be exhaustive; ${manifest.changeUnitCount - assignedIds.size} change units are omitted.`,
    );
  }

  const manifestSha256 = manifestDigest(manifest);
  const digestPayload = {
    schemaVersion: 1,
    manifestSha256,
    groups: canonicalGroups.map(({ selection, policy, basis }) => ({
      selection,
      policy,
      basis,
    })),
  };
  const evidencePlan = {
    schemaVersion: 1,
    manifestSha256,
    groups: canonicalGroups,
    evidencePlanSha256: sha256Bytes(stableJsonBytes(digestPayload)),
  };

  return evidencePlan;
}

function changeUnitIdsForRanges(manifest, ranges) {
  const byOrdinal = new Map(
    manifest.changeUnits.map((unit) => [ordinalForId(unit.id), unit.id]),
  );
  const ids = [];

  for (const range of ranges) {
    const first = ordinalForId(range.first);
    const last = ordinalForId(range.last);

    if (last < first) {
      throw new Error("Change-unit range is reversed.");
    }

    for (let ordinal = first; ordinal <= last; ordinal += 1) {
      const id = byOrdinal.get(ordinal);

      if (!id) {
        throw new Error(
          `Change-unit range references missing ordinal ${ordinal}.`,
        );
      }

      ids.push(id);
    }
  }

  return ids;
}

function selectionUnits(manifest, selection) {
  const normalized = normalizedSelection(selection);
  return resolveSelection(manifest, normalized, new Set());
}

function nextPacketOrdinal(catalog, prefix) {
  return (
    catalog.packets
      .filter(({ id }) => id.startsWith(prefix))
      .reduce((maximum, { id }) => Math.max(maximum, Number(id.slice(1))), 0) +
    1
  );
}

function packetize({
  outputDirectory,
  catalog,
  kind,
  bytes,
  units,
  changeUnitId = null,
  pathIdentity = null,
  context = "",
}) {
  const prefix = PACKET_PREFIXES[kind];

  if (!prefix) {
    throw new Error(`Unknown review packet kind ${kind}.`);
  }

  return writePacketBytesSync({
    outputDirectory,
    source: bytes,
    idPrefix: prefix,
    startingOrdinal: nextPacketOrdinal(catalog, prefix),
    kind,
    changeUnitRanges: rangesForUnits(units),
    changeUnitCount: units.length,
    changeUnitId,
    pathIdentity,
    context,
  }).packets;
}

function writeNewJson(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

  try {
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }

    if (!readFileSync(path).equals(bytes)) {
      throw new Error(`Immutable JSON artifact collision at ${path}.`, {
        cause: error,
      });
    }
  }
}

function writeImmutableSmallFile(path, bytes) {
  if (bytes.length > MAXIMUM_PACKET_BYTES) {
    throw new Error(`Immutable bounded artifact exceeds its budget: ${path}`);
  }

  try {
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }

    if (!readFileSync(path).equals(bytes)) {
      throw new Error(`Immutable artifact collision at ${path}.`, {
        cause: error,
      });
    }
  }
}

function relativeArtifact(outputDirectory, path) {
  return relative(outputDirectory, path).split(sep).join("/");
}

function persistBaseCatalog(outputDirectory, catalog) {
  const baseIndex = {
    schemaVersion: 1,
    packets: catalog.packets,
  };
  const baseIndexArtifact = "base-packet-index.json";
  const baseIndexPath = join(outputDirectory, baseIndexArtifact);

  writeNewJson(baseIndexPath, baseIndex);
  const baseIndexSha256 = sha256Bytes(readFileSync(baseIndexPath));
  catalog.storage = {
    kind: "base-plus-revisions",
    baseIndexArtifact,
    baseIndexSha256,
    revisionCount: 0,
    currentRevisionArtifact: null,
  };
  catalog.catalogSha256 = digestCatalog(catalog);
  const catalogPath = join(
    outputDirectory,
    `catalog-${catalog.catalogSha256}.json`,
  );

  writeNewJson(catalogPath, catalog);
  return withCatalogIdentity(catalog, catalogPath);
}

function catalogOutputDirectory(catalog) {
  if (typeof catalog.catalogPath !== "string") {
    throw new Error("Catalog is missing its immutable storage path.");
  }

  const catalogPath = resolve(catalog.catalogPath);

  return dirname(catalogPath).endsWith(`${sep}revisions`)
    ? dirname(dirname(catalogPath))
    : dirname(catalogPath);
}

function arrayDifference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function persistCatalogRevision(priorCatalog, catalog, addedPackets) {
  const outputDirectory = catalogOutputDirectory(priorCatalog);
  const revisionsDirectory = join(outputDirectory, "revisions");

  if (!existsSync(revisionsDirectory)) {
    mkdirSync(revisionsDirectory);
  }

  catalog.storage = {
    ...priorCatalog.storage,
    revisionCount: priorCatalog.storage.revisionCount + 1,
    currentRevisionArtifact: null,
  };
  catalog.catalogSha256 = digestCatalog(catalog);
  const ordinal = String(catalog.storage.revisionCount).padStart(6, "0");
  const revisionArtifact = `revisions/R${ordinal}-${catalog.catalogSha256}.json`;

  catalog.storage.currentRevisionArtifact = revisionArtifact;
  catalog.catalogSha256 = digestCatalog(catalog);
  const revisionPath = join(outputDirectory, revisionArtifact);
  const coveredHashes = coverageHashes(priorCatalog);
  const record = {
    revisionRecordVersion: 1,
    priorCatalogArtifact: relativeArtifact(
      outputDirectory,
      priorCatalog.catalogPath,
    ),
    priorCatalogSha256: priorCatalog.catalogSha256,
    catalogSha256: catalog.catalogSha256,
    evidencePlanSha256: catalog.evidencePlanSha256,
    evidenceGroups: catalog.evidenceGroups,
    inlineCoverage: catalog.inlineCoverage,
    addedPackets,
    addedRequiredSynopsisPacketIds: arrayDifference(
      catalog.requiredSynopsisPacketIds,
      priorCatalog.requiredSynopsisPacketIds,
    ),
    removedRequiredSynopsisPacketIds: arrayDifference(
      priorCatalog.requiredSynopsisPacketIds,
      catalog.requiredSynopsisPacketIds,
    ),
    addedExactInventoryPacketIds: arrayDifference(
      catalog.exactInventoryPacketIds,
      priorCatalog.exactInventoryPacketIds,
    ),
    removedExactInventoryPacketIds: arrayDifference(
      priorCatalog.exactInventoryPacketIds,
      catalog.exactInventoryPacketIds,
    ),
    addedFullPatchPacketIds: arrayDifference(
      catalog.fullPatchPacketIds,
      priorCatalog.fullPatchPacketIds,
    ),
    removedFullPatchPacketIds: arrayDifference(
      priorCatalog.fullPatchPacketIds,
      catalog.fullPatchPacketIds,
    ),
    addedDeletions: catalog.deletions.slice(priorCatalog.deletions.length),
    coveredPacketHashCount: coveredHashes.size,
    coveredPacketHashesSha256: sha256Bytes(
      stableJsonBytes([...coveredHashes].sort()),
    ),
    storage: catalog.storage,
  };

  writeNewJson(revisionPath, record);
  return withCatalogIdentity(catalog, revisionPath);
}

function evidenceBytesForGroup(manifest, group) {
  const value = manifest.evidenceByGroupId?.[group.id];

  if (value !== undefined) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  }

  const byUnit = manifest.evidenceByChangeUnitId;

  if (byUnit && Array.isArray(group.changeUnitIds)) {
    const parts = [];

    for (const id of group.changeUnitIds) {
      if (byUnit[id] === undefined) {
        return null;
      }
      parts.push(
        Buffer.isBuffer(byUnit[id]) ? byUnit[id] : Buffer.from(byUnit[id]),
      );
    }
    return Buffer.concat(parts);
  }

  return null;
}

function unitsForGroup(manifest, group) {
  const ids = new Set(changeUnitIdsForRanges(manifest, group.changeUnitRanges));

  return manifest.changeUnits.filter(({ id }) => ids.has(id));
}

function inventoryPath(unit, direction) {
  const bytes = pathBytes(unit, direction);

  return bytes === null
    ? null
    : safeBoundedText(bytes, `${direction}-path-bytes`);
}

function* inventoryChunks(units) {
  yield Buffer.from("# Exact change inventory\n\n", "utf8");

  for (const unit of units) {
    const sourcePath = inventoryPath(unit, "source");
    const source = sourcePath === null ? "" : ` from ${sourcePath}`;
    const path = inventoryPath(unit, "destination") ?? "missing-path";
    const statistics = unit.binary
      ? "binary/unavailable"
      : `+${unit.additions ?? "deferred"}/-${unit.deletions ?? "deferred"}`;

    yield Buffer.from(
      `- ${unit.id} ${unit.kind}: ${path}${source}; ${statistics}; mode ${unit.oldMode}->${unit.newMode}; objects ${unit.oldOid}->${unit.newOid}; rename=${unit.renameClassification ?? "none"}; line-stat=${unit.lineStatistics ?? "unknown"}\n`,
      "utf8",
    );
  }
}

function sha256Chunks(chunks) {
  const hash = createHash("sha256");

  for (const chunk of chunks) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

function packetizeInventory({ outputDirectory, catalog, units, context }) {
  return writePacketChunksSync({
    outputDirectory,
    source: inventoryChunks(units),
    idPrefix: PACKET_PREFIXES["exact-inventory"],
    startingOrdinal: nextPacketOrdinal(
      catalog,
      PACKET_PREFIXES["exact-inventory"],
    ),
    kind: "exact-inventory",
    changeUnitRanges: rangesForUnits(units),
    changeUnitCount: units.length,
    context,
  }).packets;
}

function evidenceGroupRecord(manifest, group) {
  const units = unitsForGroup(manifest, group);
  const requiredTextUnits = units.filter(
    (unit) =>
      unit.newMode !== "000000" &&
      unit.oldMode !== "160000" &&
      unit.newMode !== "160000" &&
      unit.binary !== true,
  );

  return {
    id: group.id,
    policy: group.policy,
    changeUnitRanges: group.changeUnitRanges,
    changeUnitCount: group.changeUnitCount,
    requiredTextPatchRanges: rangesForUnits(requiredTextUnits),
    requiredTextPatchCount: requiredTextUnits.length,
  };
}

function baseCatalog(manifest, evidencePlan) {
  return {
    schemaVersion: 1,
    indexTreeOid: manifest.indexTreeOid,
    manifestSha256: evidencePlan.manifestSha256,
    evidencePlanSha256: evidencePlan.evidencePlanSha256,
    evidenceGroups: evidencePlan.groups.map((group) =>
      evidenceGroupRecord(manifest, group),
    ),
    inlineCoverage: {
      scopeSynopsis: manifest.coveredSynopsis === true,
      evidenceGroupIds: [...(manifest.coveredEvidenceGroupIds ?? [])],
    },
    packets: [],
    requiredSynopsisPacketIds: [],
    exactInventoryPacketIds: [],
    fullPatchPacketIds: [],
    deletions: [],
    storage: null,
    catalogSha256: null,
  };
}

function addInitialRequiredPackets(
  manifest,
  evidencePlan,
  catalog,
  outputDirectory,
) {
  if (manifest.coveredSynopsis !== true) {
    const synopsis = createScopeSynopsis(manifest);
    const synopsisPackets = packetize({
      outputDirectory,
      catalog,
      kind: "scope-synopsis",
      bytes: Buffer.from(`${synopsis.text}\n`, "utf8"),
      units: manifest.changeUnits,
      context: `manifest=${synopsis.manifestSha256}`,
    });

    catalog.packets.push(...synopsisPackets);
    catalog.requiredSynopsisPacketIds.push(
      ...synopsisPackets.map(({ id }) => id),
    );
  }

  for (const group of evidencePlan.groups) {
    const units = unitsForGroup(manifest, group);

    if (manifest.coveredEvidenceGroupIds?.includes(group.id)) {
      continue;
    }

    if (group.policy === "review" && manifest.changeUnitCount >= 50) {
      const packets = packetizeInventory({
        outputDirectory,
        catalog,
        units,
        context: `evidence-group=${group.id}`,
      }).map((packet) => ({ ...packet, evidenceGroupIds: [group.id] }));

      catalog.packets.push(...packets);
      catalog.exactInventoryPacketIds.push(...packets.map(({ id }) => id));
    }

    if (!new Set(["message", "review"]).has(group.policy)) {
      continue;
    }

    const patchUnits = units.filter(
      (unit) =>
        unit.newMode !== "000000" &&
        unit.oldMode !== "160000" &&
        unit.newMode !== "160000" &&
        unit.binary !== true,
    );

    if (patchUnits.length === 0) {
      continue;
    }

    const preMaterialized =
      manifest.preMaterializedPacketsByGroupId?.[group.id];
    let packets;

    if (preMaterialized !== undefined) {
      if (!Array.isArray(preMaterialized) || preMaterialized.length === 0) {
        throw new Error(
          `Pre-materialized patch evidence for ${group.id} is invalid.`,
        );
      }

      packets = preMaterialized.map((packet) => ({
        ...packet,
        evidenceGroupIds: [group.id],
      }));
    } else {
      const bytes = evidenceBytesForGroup(manifest, group);

      if (bytes === null) {
        throw new Error(
          `Required patch evidence for ${group.id} is unavailable.`,
        );
      }

      packets = packetize({
        outputDirectory,
        catalog,
        kind: "text-patch",
        bytes,
        units: patchUnits,
        context: `evidence-group=${group.id}`,
      }).map((packet) => ({ ...packet, evidenceGroupIds: [group.id] }));
    }

    catalog.packets.push(...packets);
    catalog.fullPatchPacketIds.push(...packets.map(({ id }) => id));
  }
}

export function createReviewCatalog({
  manifest,
  outputDirectory,
  evidencePlan,
}) {
  const preMaterialized =
    manifest.preMaterializedPacketsByGroupId !== undefined;

  if (existsSync(outputDirectory) && !preMaterialized) {
    throw new Error(`Review output already exists: ${outputDirectory}`);
  }

  if (evidencePlan.manifestSha256 !== manifestDigest(manifest)) {
    throw new Error("Evidence plan belongs to a different manifest.");
  }

  if (!existsSync(outputDirectory)) {
    mkdirSync(outputDirectory);
  }
  for (const name of ["packets", "raw"]) {
    if (!existsSync(join(outputDirectory, name))) {
      mkdirSync(join(outputDirectory, name));
    }
  }

  const catalog = baseCatalog(manifest, evidencePlan);

  addInitialRequiredPackets(manifest, evidencePlan, catalog, outputDirectory);
  return persistBaseCatalog(outputDirectory, catalog);
}

function descriptorIdentity(packet) {
  return stableJsonBytes({
    kind: packet.kind,
    sha256: packet.sha256,
    rawSha256: packet.rawSha256,
    changeUnitRanges: packet.changeUnitRanges,
    changeUnitCount: packet.changeUnitCount,
  }).toString("base64");
}

function appendPackets(catalog, packets, requirementField, extra = {}) {
  const priorIdentities = new Map(
    catalog.packets.map((packet) => [descriptorIdentity(packet), packet]),
  );
  const additions = [];
  const requiredIds = [];

  for (const packet of packets) {
    const prior = priorIdentities.get(descriptorIdentity(packet));

    if (prior) {
      requiredIds.push(prior.id);
    } else {
      additions.push(packet);
      requiredIds.push(packet.id);
    }
  }

  const next = {
    ...catalog,
    packets:
      additions.length === 0
        ? catalog.packets
        : [...catalog.packets, ...additions],
    [requirementField]: [
      ...new Set([...catalog[requirementField], ...requiredIds]),
    ],
    ...extra,
    storage: null,
    catalogSha256: null,
  };

  return persistCatalogRevision(catalog, next, additions);
}

export function materializeInventoryPackets({ manifest, catalog, selection }) {
  const units = selectionUnits(manifest, selection);
  const outputDirectory = catalogOutputDirectory(catalog);
  const packets = packetizeInventory({
    outputDirectory,
    catalog,
    units,
    context: "on-demand exact inventory",
  });

  return appendPackets(catalog, packets, "exactInventoryPacketIds");
}

function patchBytesForUnits(manifest, catalog, units) {
  const ids = new Set(units.map(({ id }) => id));
  const matchingGroup = catalog.evidenceGroups.find((group) => {
    const groupIds = new Set(
      changeUnitIdsForRanges(manifest, group.changeUnitRanges),
    );
    return (
      groupIds.size === ids.size && [...ids].every((id) => groupIds.has(id))
    );
  });

  if (
    matchingGroup &&
    manifest.evidenceByGroupId?.[matchingGroup.id] !== undefined
  ) {
    const value = manifest.evidenceByGroupId[matchingGroup.id];
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  }

  const parts = [];

  for (const unit of units) {
    const value =
      manifest.evidenceByChangeUnitId?.[unit.id] ??
      unit.patchBytes ??
      unit.patchText ??
      (unit.evidenceBytesBase64
        ? Buffer.from(unit.evidenceBytesBase64, "base64")
        : undefined);

    if (value === undefined) {
      throw new Error(`Required patch evidence for ${unit.id} is unavailable.`);
    }

    parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  }

  return Buffer.concat(parts);
}

export function materializePatchPackets({ manifest, catalog, selection }) {
  const units = selectionUnits(manifest, selection).filter(
    (unit) =>
      unit.newMode !== "000000" &&
      unit.oldMode !== "160000" &&
      unit.newMode !== "160000" &&
      unit.binary !== true,
  );

  if (units.length === 0) {
    return catalog;
  }

  const outputDirectory = catalogOutputDirectory(catalog);
  const packets = packetize({
    outputDirectory,
    catalog,
    kind: "text-patch",
    bytes: patchBytesForUnits(manifest, catalog, units),
    units,
    context: "on-demand full patch",
  });

  return appendPackets(catalog, packets, "fullPatchPacketIds");
}

function deletedBytes(unit) {
  if (Buffer.isBuffer(unit.deletedContent)) {
    return unit.deletedContent;
  }

  if (unit.deletedContent instanceof Uint8Array) {
    return Buffer.from(unit.deletedContent);
  }

  if (typeof unit.deletedContent === "string") {
    return Buffer.from(unit.deletedContent, "utf8");
  }

  if (typeof unit.deletedContentBytesBase64 === "string") {
    return Buffer.from(unit.deletedContentBytesBase64, "base64");
  }

  return null;
}

function manifestGitEnvironment(manifest) {
  if (!manifest.indexFile) {
    return undefined;
  }

  return {
    GIT_INDEX_FILE: manifest.indexFile,
    ...(manifest.temporaryObjectDirectory
      ? { GIT_OBJECT_DIRECTORY: manifest.temporaryObjectDirectory }
      : {}),
    ...(Array.isArray(manifest.objectAlternates) &&
    manifest.objectAlternates.length > 0
      ? {
          GIT_ALTERNATE_OBJECT_DIRECTORIES: formatGitAlternatePaths(
            manifest.objectAlternates,
          ),
        }
      : {}),
  };
}

function appendDeletionPackets(catalog, packets, unit, bytesIdentity) {
  const deletion = {
    changeUnitId: unit.id,
    oldOid: unit.oldOid,
    byteCount: bytesIdentity.byteCount,
    sha256: bytesIdentity.sha256,
    packetIds: packets.map(({ id }) => id),
  };

  return appendPackets(catalog, packets, "fullPatchPacketIds", {
    deletions: [...catalog.deletions, deletion],
  });
}

async function streamDeletionPackets({ manifest, catalog, unit }) {
  if (
    typeof manifest.repositoryRoot !== "string" ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(unit.oldOid)
  ) {
    throw new Error(`Deleted content for ${unit.id} is unavailable.`);
  }

  const environment = manifestGitEnvironment(manifest);
  const objectType = readOnlyGitText(
    manifest.repositoryRoot,
    "cat-file",
    ["-t", unit.oldOid],
    { env: environment },
  ).trim();

  if (objectType !== "blob") {
    throw new Error(
      `Old object ${unit.oldOid} must identify a blob object, not ${objectType}.`,
    );
  }

  const outputDirectory = catalogOutputDirectory(catalog);
  const spoolPath = join(outputDirectory, `.deletion-${unit.id}.tmp`);
  const descriptor = openSync(spoolPath, "wx", 0o600);
  let streamResult;

  try {
    try {
      streamResult = await streamGit("cat-file", ["blob", unit.oldOid], {
        cwd: manifest.repositoryRoot,
        env: environment,
        onStdout(chunk) {
          writeFileSync(descriptor, chunk);
        },
      });
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }

    if (
      streamResult.aborted ||
      streamResult.timedOut ||
      streamResult.status !== 0
    ) {
      throw new Error(
        `Deleted content stream for ${unit.id} did not complete.`,
      );
    }

    const written = await writePacketStream({
      outputDirectory,
      source: createReadStream(spoolPath, { highWaterMark: 16 * 1024 }),
      idPrefix: "D",
      startingOrdinal: nextPacketOrdinal(catalog, "D"),
      kind: "deleted-content",
      changeUnitRanges: rangesForUnits([unit]),
      changeUnitCount: 1,
      changeUnitId: unit.id,
      pathIdentity: unit.destinationPath ?? unit.displayPath ?? unit.id,
      context: `old-object=${unit.oldOid}`,
    });

    return appendDeletionPackets(catalog, written.packets, unit, {
      byteCount: written.rawByteCount,
      sha256: written.rawSha256,
    });
  } finally {
    if (existsSync(spoolPath)) {
      unlinkSync(spoolPath);
    }
  }
}

export function materializeDeletionPackets({
  manifest,
  catalog,
  changeUnitId,
}) {
  const unit = manifest.changeUnits.find(({ id }) => id === changeUnitId);

  if (!unit) {
    throw new Error(`Unknown change unit ${changeUnitId}.`);
  }

  if (unit.newMode !== "000000") {
    throw new Error(
      `Change unit ${changeUnitId} is not a whole-file deletion.`,
    );
  }

  if (catalog.deletions.some((entry) => entry.changeUnitId === changeUnitId)) {
    throw new Error(`Deletion ${changeUnitId} was already expanded.`);
  }

  const bytes = deletedBytes(unit);

  if (bytes === null) {
    return streamDeletionPackets({ manifest, catalog, unit });
  }

  const outputDirectory = catalogOutputDirectory(catalog);
  const packets = packetize({
    outputDirectory,
    catalog,
    kind: "deleted-content",
    bytes,
    units: [unit],
    changeUnitId,
    pathIdentity: unit.destinationPath ?? unit.displayPath ?? unit.id,
    context: `old-object=${unit.oldOid}`,
  });
  return appendDeletionPackets(catalog, packets, unit, {
    byteCount: bytes.length,
    sha256: sha256Bytes(bytes),
  });
}

function requiredPacketIds(catalog) {
  return [
    ...new Set([
      ...catalog.requiredSynopsisPacketIds,
      ...catalog.exactInventoryPacketIds,
      ...catalog.fullPatchPacketIds,
    ]),
  ];
}

function applyDelta(values, additions, removals) {
  const removed = new Set(removals);
  return [
    ...new Set([
      ...values.filter((value) => !removed.has(value)),
      ...additions,
    ]),
  ];
}

function loadCatalogDocument(catalogPath, visited = new Set()) {
  const absolutePath = resolve(catalogPath);

  if (visited.has(absolutePath)) {
    throw new Error("Catalog revision chain contains a cycle.");
  }
  visited.add(absolutePath);
  const document = JSON.parse(readFileSync(absolutePath, "utf8"));

  if (document.revisionRecordVersion !== 1) {
    const expected = digestCatalog(document);

    if (document.catalogSha256 !== expected) {
      throw new Error("Catalog digest does not match its immutable payload.");
    }
    return withCatalogIdentity(document, absolutePath);
  }

  const outputDirectory = dirname(dirname(absolutePath));
  const priorPath = resolve(outputDirectory, document.priorCatalogArtifact);
  const prior = loadCatalogDocument(priorPath, visited);

  if (prior.catalogSha256 !== document.priorCatalogSha256) {
    throw new Error("Catalog revision prior digest does not match.");
  }

  const catalog = {
    ...prior,
    evidencePlanSha256: document.evidencePlanSha256,
    evidenceGroups: document.evidenceGroups,
    inlineCoverage: document.inlineCoverage,
    packets: [...prior.packets, ...document.addedPackets],
    requiredSynopsisPacketIds: applyDelta(
      prior.requiredSynopsisPacketIds,
      document.addedRequiredSynopsisPacketIds,
      document.removedRequiredSynopsisPacketIds,
    ),
    exactInventoryPacketIds: applyDelta(
      prior.exactInventoryPacketIds,
      document.addedExactInventoryPacketIds,
      document.removedExactInventoryPacketIds,
    ),
    fullPatchPacketIds: applyDelta(
      prior.fullPatchPacketIds,
      document.addedFullPatchPacketIds,
      document.removedFullPatchPacketIds,
    ),
    deletions: [...prior.deletions, ...document.addedDeletions],
    storage: document.storage,
    catalogSha256: document.catalogSha256,
  };

  if (digestCatalog(catalog) !== document.catalogSha256) {
    throw new Error(
      "Reconstructed catalog digest does not match its revision.",
    );
  }

  return withCatalogIdentity(catalog, absolutePath);
}

export function readReviewCatalog(catalogPath) {
  return loadCatalogDocument(catalogPath);
}

export function findReviewCatalogRevisionPath(catalogPath, catalogSha256) {
  let currentPath = resolve(catalogPath);
  const visited = new Set();

  while (true) {
    if (visited.has(currentPath)) {
      throw new Error("Catalog revision chain contains a cycle.");
    }
    visited.add(currentPath);
    const document = JSON.parse(readFileSync(currentPath, "utf8"));

    if (document.catalogSha256 === catalogSha256) {
      // Reconstructing the selected revision also validates every link and
      // digest between that revision and its immutable base catalog.
      loadCatalogDocument(currentPath);
      return currentPath;
    }

    if (document.revisionRecordVersion !== 1) {
      return null;
    }

    const outputDirectory = dirname(dirname(currentPath));
    currentPath = resolve(outputDirectory, document.priorCatalogArtifact);
  }
}

export function requiredReviewPacketIds(catalog) {
  return requiredPacketIds(catalog);
}

export function bindReviewCoverage(catalog, coverage) {
  const covered = { ...catalog, priorCoverage: coverage };

  return withCatalogIdentity(covered, catalog.catalogPath);
}

function packetById(catalog, id) {
  const packet = catalog.packets.find((candidate) => candidate.id === id);

  if (!packet) {
    throw new Error(`Unknown review packet ID ${id}.`);
  }

  return packet;
}

function verifyPacket(outputDirectory, packet) {
  const path = resolve(outputDirectory, packet.artifact);
  const bytes = readFileSync(path);
  const actual = sha256Bytes(bytes);

  if (actual !== packet.sha256) {
    throw new Error(
      `Review packet ${packet.id} changed after catalog creation.`,
    );
  }
}

function coverageHashes(catalog) {
  const coverage = catalog.priorCoverage;

  if (!coverage) {
    return new Set();
  }

  return new Set(coverage.coveredPacketSha256 ?? []);
}

function assertReceipt(receipt, catalog) {
  const expectedKeys = [
    "schemaVersion",
    "catalogSha256",
    "evidencePlanSha256",
    "requiredPacketsReviewed",
    "additionalPacketIds",
  ].sort();

  if (
    !isPlainObject(receipt) ||
    JSON.stringify(Object.keys(receipt).sort()) !==
      JSON.stringify(expectedKeys) ||
    receipt.schemaVersion !== 1 ||
    receipt.catalogSha256 !== catalog.catalogSha256 ||
    receipt.evidencePlanSha256 !== catalog.evidencePlanSha256 ||
    receipt.requiredPacketsReviewed !== true ||
    !Array.isArray(receipt.additionalPacketIds) ||
    new Set(receipt.additionalPacketIds).size !==
      receipt.additionalPacketIds.length
  ) {
    throw new Error(
      "Review receipt does not bind the current catalog and evidence plan.",
    );
  }
}

function assertReviewPatchCoverage(catalog, requiredIds) {
  const required = new Set(requiredIds);

  if (
    !catalog.inlineCoverage.scopeSynopsis &&
    catalog.requiredSynopsisPacketIds.length === 0
  ) {
    throw new Error("Required scope synopsis packets are missing.");
  }

  for (const group of catalog.evidenceGroups.filter(
    ({ policy, id }) =>
      new Set(["message", "review"]).has(policy) &&
      !catalog.inlineCoverage.evidenceGroupIds.includes(id),
  )) {
    const coveredOrdinals = new Set(
      catalog.packets
        .filter(
          (packet) => required.has(packet.id) && packet.kind === "text-patch",
        )
        .flatMap((packet) =>
          packet.changeUnitRanges.flatMap((range) => {
            const first = ordinalForId(range.first);
            const last = ordinalForId(range.last);
            return Array.from(
              { length: last - first + 1 },
              (_, index) => first + index,
            );
          }),
        ),
    );
    const requiredOrdinals = new Set(
      group.requiredTextPatchRanges.flatMap((range) => {
        const first = ordinalForId(range.first);
        const last = ordinalForId(range.last);
        return Array.from(
          { length: last - first + 1 },
          (_, index) => first + index,
        );
      }),
    );

    if (
      requiredOrdinals.size !== group.requiredTextPatchCount ||
      [...requiredOrdinals].some((ordinal) => !coveredOrdinals.has(ordinal))
    ) {
      throw new Error(
        `Required text-patch coverage for ${group.id} is incomplete.`,
      );
    }
  }
}

function assertRequiredPacketKinds(catalog, requiredIds) {
  const required = new Set(requiredIds);

  for (const id of catalog.requiredSynopsisPacketIds) {
    const packet = catalog.packets.find(
      (candidate) => required.has(candidate.id) && candidate.id === id,
    );

    if (packet?.kind !== "scope-synopsis") {
      throw new Error(`Required synopsis packet ${id} has the wrong kind.`);
    }
  }
}

// This verifies artifact identity and the receipt's declared coverage. It
// cannot establish that a human or model mentally understood the packets.
export function verifyReviewReceipt({ catalogPath, receipt }) {
  const catalog = loadCatalogDocument(catalogPath);

  assertReceipt(receipt, catalog);
  const additional = receipt.additionalPacketIds;
  additional.forEach((id) => packetById(catalog, id));
  const ids = [...new Set([...requiredPacketIds(catalog), ...additional])];
  const outputDirectory = catalogOutputDirectory(catalog);

  for (const id of ids) {
    verifyPacket(outputDirectory, packetById(catalog, id));
  }

  assertRequiredPacketKinds(catalog, ids);
  assertReviewPatchCoverage(catalog, ids);
  const hashes = ids.map((id) => packetById(catalog, id).sha256);

  return {
    schemaVersion: 1,
    catalogSha256: catalog.catalogSha256,
    evidencePlanSha256: catalog.evidencePlanSha256,
    complete: true,
    coveredPacketCount: ids.length,
    coveredPacketIds: ids,
    coveredPacketSha256: [...new Set(hashes)].sort(),
  };
}

function pagePayload({ catalog, queueKind, records, nextPage }) {
  return {
    schemaVersion: 1,
    kind: queueKind,
    catalogSha256: catalog.catalogSha256,
    evidencePlanSha256: catalog.evidencePlanSha256,
    packets: records,
    nextPage,
  };
}

function partitionQueueRecords(catalog, records, maximumPageBytes, queueKind) {
  const partitions = [];
  let current = [];
  const placeholder = {
    artifact: `queues/${queueKind}-${"0".repeat(12)}-Q000000.json`,
    sha256: "0".repeat(64),
  };

  for (const record of records) {
    const candidate = [...current, record];
    const bytes = stableJsonBytes(
      pagePayload({
        catalog,
        queueKind,
        records: candidate,
        nextPage: placeholder,
      }),
    );

    if (bytes.length > maximumPageBytes && current.length > 0) {
      partitions.push(current);
      current = [record];
    } else if (bytes.length > maximumPageBytes) {
      throw new Error(`Queue record for ${record.id} exceeds the page budget.`);
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    partitions.push(current);
  }

  return partitions;
}

export function writeReviewPacketQueue({
  catalog,
  packetIds,
  queueKind,
  outputDirectory,
  maximumPageBytes = MAXIMUM_PACKET_BYTES,
}) {
  if (!new Set(["initial", "delta"]).has(queueKind)) {
    throw new Error("Review queue kind must be initial or delta.");
  }

  if (
    !Array.isArray(packetIds) ||
    new Set(packetIds).size !== packetIds.length
  ) {
    throw new Error("Review queue packet IDs must be a unique array.");
  }

  if (packetIds.length === 0) {
    return null;
  }

  const records = packetIds
    .map((id) => packetById(catalog, id))
    .map(({ id, artifact, sha256 }) => ({ id, artifact, sha256 }))
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left.artifact), Buffer.from(right.artifact)),
    );
  const partitions = partitionQueueRecords(
    catalog,
    records,
    maximumPageBytes,
    queueKind,
  );
  const queuesDirectory = join(outputDirectory, "queues");

  if (!existsSync(queuesDirectory)) {
    mkdirSync(queuesDirectory);
  }

  const pages = new Array(partitions.length);
  let nextPage = null;

  for (let index = partitions.length - 1; index >= 0; index -= 1) {
    const ordinal = String(index + 1).padStart(6, "0");
    const artifact = `queues/${queueKind}-${catalog.catalogSha256.slice(0, 12)}-Q${ordinal}.json`;
    const payload = pagePayload({
      catalog,
      queueKind,
      records: partitions[index],
      nextPage,
    });
    const bytes = stableJsonBytes(payload);

    if (bytes.length > maximumPageBytes) {
      throw new Error(`Review queue page ${ordinal} exceeds its byte budget.`);
    }

    writeImmutableSmallFile(join(outputDirectory, artifact), bytes);
    const page = {
      artifact,
      sha256: sha256Bytes(bytes),
      byteCount: bytes.length,
      packetCount: partitions[index].length,
    };
    pages[index] = page;
    nextPage = { artifact, sha256: page.sha256 };
  }

  const summary = {
    schemaVersion: 1,
    kind: queueKind,
    catalogSha256: catalog.catalogSha256,
    evidencePlanSha256: catalog.evidencePlanSha256,
    requiredPacketCount: records.length,
    pageCount: pages.length,
    firstPage: pages[0],
  };

  Object.defineProperty(summary, "pages", {
    enumerable: false,
    value: pages,
  });
  return summary;
}

function queuePagesForCatalog(outputDirectory, catalogSha256) {
  const queuesDirectory = join(outputDirectory, "queues");

  if (!existsSync(queuesDirectory)) {
    return [];
  }

  return readdirSync(queuesDirectory)
    .filter((name) =>
      /^(?:initial|delta)-[0-9a-f]{12}-Q[0-9]{6}\.json$/u.test(name),
    )
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    )
    .flatMap((name) => {
      const path = join(queuesDirectory, name);
      const bytes = readFileSync(path);
      let page;

      try {
        page = JSON.parse(bytes.toString("utf8"));
      } catch {
        return [];
      }

      return page.catalogSha256 === catalogSha256
        ? [
            {
              artifact: `queues/${name}`,
              path,
              sha256: sha256Bytes(bytes),
            },
          ]
        : [];
    });
}

function supersedePriorQueue({
  outputDirectory,
  priorCatalog,
  supersedingCatalogSha256,
}) {
  const pages = queuePagesForCatalog(
    outputDirectory,
    priorCatalog.catalogSha256,
  );

  if (pages.length === 0) {
    return null;
  }

  // Queue pages are navigation for one catalog revision, not evidence. Once
  // the replacement revision and any replacement queue are durable, retain a
  // constant-size tombstone and remove the abandoned navigation pages. Packet
  // bytes stay immutable and shared by both catalog revisions.
  const pageSetSha256 = sha256Bytes(
    stableJsonBytes(
      pages.map(({ artifact, sha256 }) => ({ artifact, sha256 })),
    ),
  );
  const marker = {
    schemaVersion: 1,
    status: "superseded",
    catalogSha256: priorCatalog.catalogSha256,
    evidencePlanSha256: priorCatalog.evidencePlanSha256,
    supersededByCatalogSha256: supersedingCatalogSha256,
    removedPageCount: pages.length,
    removedPageSetSha256: pageSetSha256,
  };
  const markerBytes = stableJsonBytes(marker);
  const markerSha256 = sha256Bytes(markerBytes);
  const markerArtifact = `queues/superseded-${markerSha256}.json`;

  writeImmutableSmallFile(join(outputDirectory, markerArtifact), markerBytes);

  for (const { path } of pages) {
    unlinkSync(path);
  }

  return {
    catalogSha256: priorCatalog.catalogSha256,
    supersededByCatalogSha256: supersedingCatalogSha256,
    removedPageCount: pages.length,
    removedPageSetSha256: pageSetSha256,
    markerArtifact,
    markerSha256,
  };
}

function groupRequirementDescriptors(manifest, catalog, plan, group) {
  const units = unitsForGroup(manifest, group);
  const descriptors = [];

  if (group.policy === "review" && manifest.changeUnitCount >= 50) {
    descriptors.push({ kind: "exact-inventory", units, group });
  }

  const patchUnits = units.filter(
    (unit) =>
      unit.newMode !== "000000" &&
      unit.oldMode !== "160000" &&
      unit.newMode !== "160000" &&
      unit.binary !== true,
  );

  if (
    new Set(["message", "review"]).has(group.policy) &&
    patchUnits.length > 0
  ) {
    descriptors.push({ kind: "text-patch", units: patchUnits, group, plan });
  }

  return descriptors;
}

function requirementBytes(manifest, descriptor) {
  const { group } = descriptor;
  const bytes = evidenceBytesForGroup(manifest, group);

  if (bytes === null) {
    throw new Error(`Required patch evidence for ${group.id} is unavailable.`);
  }

  return bytes;
}

function requirementRawSha256(manifest, descriptor) {
  return descriptor.kind === "exact-inventory"
    ? sha256Chunks(inventoryChunks(descriptor.units))
    : sha256Bytes(requirementBytes(manifest, descriptor));
}

function requirementIdentity(kind, rawSha256, units) {
  return `${kind}:${rawSha256}:${JSON.stringify(rangesForUnits(units))}`;
}

function createRequirementPacket(
  manifest,
  catalog,
  descriptor,
  outputDirectory,
  bytes = null,
) {
  const { kind, units, group } = descriptor;

  const packets =
    kind === "exact-inventory"
      ? packetizeInventory({
          outputDirectory,
          catalog,
          units,
          context: `evidence-group=${group.id}`,
        })
      : packetize({
          outputDirectory,
          catalog,
          kind,
          bytes: bytes ?? requirementBytes(manifest, descriptor),
          units,
          context: `evidence-group=${group.id}`,
        });

  return packets.map((packet) => ({
    ...packet,
    evidenceGroupIds: [group.id],
  }));
}

export function reviseReviewCatalog({ manifest, priorCatalog, evidencePlan }) {
  if (evidencePlan.manifestSha256 !== priorCatalog.manifestSha256) {
    throw new Error("Revised evidence plan belongs to a different manifest.");
  }

  const outputDirectory = catalogOutputDirectory(priorCatalog);
  const packets = priorCatalog.packets;
  const packetGroups = new Map();

  for (const packet of packets) {
    const identity = `${packet.kind}:${packet.rawSha256}:${JSON.stringify(packet.changeUnitRanges)}`;
    packetGroups.set(identity, [...(packetGroups.get(identity) ?? []), packet]);
  }
  const additions = [];
  const exactInventoryPacketIds = [];
  const fullPatchPacketIds = [];

  for (const group of evidencePlan.groups) {
    for (const descriptor of groupRequirementDescriptors(
      manifest,
      priorCatalog,
      evidencePlan,
      group,
    )) {
      const bytes =
        descriptor.kind === "exact-inventory"
          ? null
          : requirementBytes(manifest, descriptor);
      const identity = requirementIdentity(
        descriptor.kind,
        requirementRawSha256(manifest, descriptor),
        descriptor.units,
      );
      const existingPackets = packetGroups.get(identity);
      const candidatePackets =
        existingPackets ??
        createRequirementPacket(
          manifest,
          { ...priorCatalog, packets: [...packets, ...additions] },
          descriptor,
          outputDirectory,
          bytes,
        );

      for (const packet of candidatePackets) {
        if (!existingPackets) {
          additions.push(packet);
        }

        if (descriptor.kind === "exact-inventory") {
          exactInventoryPacketIds.push(packet.id);
        } else {
          fullPatchPacketIds.push(packet.id);
        }
      }

      if (!existingPackets) {
        packetGroups.set(identity, candidatePackets);
      }
    }
  }

  const catalog = {
    ...priorCatalog,
    evidencePlanSha256: evidencePlan.evidencePlanSha256,
    evidenceGroups: evidencePlan.groups.map((group) =>
      evidenceGroupRecord(manifest, group),
    ),
    inlineCoverage:
      evidencePlan.evidencePlanSha256 === priorCatalog.evidencePlanSha256
        ? priorCatalog.inlineCoverage
        : {
            scopeSynopsis: priorCatalog.inlineCoverage.scopeSynopsis,
            evidenceGroupIds: [],
          },
    packets: additions.length === 0 ? packets : [...packets, ...additions],
    exactInventoryPacketIds: [...new Set(exactInventoryPacketIds)],
    fullPatchPacketIds: [...new Set(fullPatchPacketIds)],
    storage: null,
    catalogSha256: null,
  };
  const persisted = persistCatalogRevision(priorCatalog, catalog, additions);
  const covered = coverageHashes(priorCatalog);
  const deltaIds = requiredPacketIds(persisted).filter(
    (id) => !covered.has(packetById(persisted, id).sha256),
  );
  const queue =
    deltaIds.length === 0
      ? null
      : writeReviewPacketQueue({
          catalog: persisted,
          packetIds: deltaIds,
          queueKind: "delta",
          outputDirectory,
        });
  const supersededQueue = supersedePriorQueue({
    outputDirectory,
    priorCatalog,
    supersedingCatalogSha256: persisted.catalogSha256,
  });
  const evidenceDelta = {
    schemaVersion: 1,
    priorCatalogSha256: priorCatalog.catalogSha256,
    catalogSha256: persisted.catalogSha256,
    evidencePlanSha256: persisted.evidencePlanSha256,
    requiredPacketIds: deltaIds,
    requiredPacketCount: deltaIds.length,
    queue,
    supersededQueue,
  };

  return { catalog: persisted, evidenceDelta };
}
