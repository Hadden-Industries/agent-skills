import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

export const MAXIMUM_CONCISE_RESULT_BYTES = 32 * 1024;

const MAXIMUM_SYNOPSIS_GROUPS = 24;
const MAXIMUM_GROUP_SAMPLES = 3;
// The catalog appends one newline before packetization. Keeping the synopsis
// itself one byte below two raw segments guarantees at most two packets.
const MAXIMUM_BULK_SYNOPSIS_BYTES = 8 * 1024 - 1;
const MAXIMUM_SAFE_TEXT_BYTES = 192;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const EPHEMERAL_MANIFEST_KEYS = new Set([
  "conciseEnvelope",
  "coveredEvidenceGroupIds",
  "coveredSynopsis",
  "evidenceByChangeUnitId",
  "evidenceByGroupId",
  "manifestSha256",
  "preMaterializedPacketsByGroupId",
  "scopeSynopsis",
]);
const EPHEMERAL_CHANGE_UNIT_KEYS = new Set([
  "deletedContent",
  "evidenceBytes",
  "evidenceBytesBase64",
  "patchBytes",
  "patchText",
]);

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }

  return value;
}

export function stableJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalValue(value))}\n`, "utf8");
}

function digestableManifest(manifest) {
  return Object.fromEntries(
    Object.entries(manifest)
      .filter(([key]) => !EPHEMERAL_MANIFEST_KEYS.has(key))
      .map(([key, value]) => [
        key,
        key === "changeUnits"
          ? value.map((unit) =>
              Object.fromEntries(
                Object.entries(unit).filter(
                  ([unitKey]) => !EPHEMERAL_CHANGE_UNIT_KEYS.has(unitKey),
                ),
              ),
            )
          : value,
      ]),
  );
}

export function manifestDigest(manifest) {
  if (/^[0-9a-f]{64}$/u.test(manifest?.manifestSha256 ?? "")) {
    return manifest.manifestSha256;
  }

  return sha256Bytes(stableJsonBytes(digestableManifest(manifest)));
}

function strictUtf8(bytes) {
  try {
    return STRICT_UTF8_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

function containsUnsafeControl(text) {
  return [...text].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

export function safeBoundedText(bytes, label = "bytes") {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const text = strictUtf8(buffer);

  if (
    text !== null &&
    !containsUnsafeControl(text) &&
    buffer.length <= MAXIMUM_SAFE_TEXT_BYTES
  ) {
    return text;
  }

  const prefix = buffer.subarray(0, 48).toString("hex");
  const suffix = buffer.length > 48 ? buffer.subarray(-24).toString("hex") : "";

  return `${label}:${prefix}${suffix ? `...${suffix}` : ""};bytes=${buffer.length};sha256=${sha256Bytes(buffer)}`;
}

function unitPathBytes(unit) {
  if (typeof unit.destinationPathBytesBase64 === "string") {
    return Buffer.from(unit.destinationPathBytesBase64, "base64");
  }

  return Buffer.from(
    unit.destinationPath ?? unit.displayPath ?? unit.id,
    "utf8",
  );
}

function unitPathDisplay(unit) {
  return safeBoundedText(unitPathBytes(unit), "path-bytes");
}

function serializedStatistic(value) {
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : "deferred";
}

function exactSynopsis(manifest, digest) {
  const lines = [
    `${manifest.changeUnitCount} change unit${manifest.changeUnitCount === 1 ? "" : "s"}; manifest ${digest}`,
  ];

  for (const unit of manifest.changeUnits) {
    const source = unit.sourcePathBytesBase64
      ? ` from ${safeBoundedText(Buffer.from(unit.sourcePathBytesBase64, "base64"), "source-path-bytes")}`
      : "";
    const statistics = unit.binary
      ? "binary/unavailable"
      : `+${serializedStatistic(unit.additions)}/-${serializedStatistic(unit.deletions)}`;
    const exactFacts = [
      unit.oldMode && unit.newMode
        ? `mode ${unit.oldMode}->${unit.newMode}`
        : null,
      unit.kind === "deleted" ||
      unit.kind === "type-changed" ||
      unit.kind === "mode-changed" ||
      unit.kind === "submodule-changed" ||
      unit.binary
        ? `objects ${unit.oldOid ?? "unknown"}->${unit.newOid ?? "unknown"}`
        : null,
      unit.renameClassification ? `rename ${unit.renameClassification}` : null,
      `line-stat ${unit.lineStatistics ?? "unknown"}`,
    ].filter(Boolean);

    lines.push(
      `${unit.id} ${unit.kind}: ${unitPathDisplay(unit)}${source}; ${statistics}; ${exactFacts.join("; ")}`,
    );
  }

  return lines.join("\n");
}

function directoryComponents(bytes) {
  const components = [];
  let start = 0;

  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 47) {
      components.push(bytes.subarray(start, index));
      start = index + 1;
    }
  }

  return components;
}

function trieNode(prefix = Buffer.alloc(0)) {
  return { prefix, units: [], directUnits: [], children: new Map() };
}

function pathTrie(units) {
  const root = trieNode();

  for (const unit of units) {
    const path = unitPathBytes(unit);
    let node = root;

    node.units.push(unit);

    for (const component of directoryComponents(path)) {
      const key = component.toString("base64");
      let child = node.children.get(key);

      if (!child) {
        child = trieNode(
          Buffer.concat([node.prefix, component, Buffer.of(47)]),
        );
        node.children.set(key, child);
      }

      child.units.push(unit);
      node = child;
    }

    node.directUnits.push(unit);
  }

  return root;
}

function compressedNode(node) {
  let current = node;

  while (current.directUnits.length === 0 && current.children.size === 1) {
    current = [...current.children.values()][0];
  }

  return current;
}

function pathPrefixDisplay(prefix) {
  if (prefix.length === 0) {
    return "(repository root)";
  }

  return `${safeBoundedText(prefix.subarray(0, -1), "path-prefix-bytes")}/`;
}

function directGroup(node) {
  return {
    sortKey: Buffer.concat([node.prefix, Buffer.of(0)]),
    display:
      node.prefix.length === 0
        ? "(repository root)"
        : `${pathPrefixDisplay(node.prefix)} (direct files)`,
    units: node.directUnits,
    node: null,
  };
}

function nodeGroup(node) {
  const compressed = compressedNode(node);

  return {
    sortKey: compressed.prefix,
    display: pathPrefixDisplay(compressed.prefix),
    units: compressed.units,
    node: compressed,
  };
}

function childGroups(node) {
  const groups = [...node.children.values()].map(nodeGroup);

  if (node.directUnits.length > 0) {
    groups.push(directGroup(node));
  }

  return groups.sort((left, right) =>
    Buffer.compare(left.sortKey, right.sortKey),
  );
}

function mergeOverflowGroups(groups, maximumGroups, parent) {
  if (groups.length <= maximumGroups) {
    return groups;
  }

  const retained = groups.slice(0, maximumGroups - 1);
  const overflow = groups.slice(maximumGroups - 1);

  retained.push({
    sortKey: Buffer.concat([parent.prefix, Buffer.of(0xff)]),
    display:
      parent.prefix.length === 0
        ? "(other path-prefix groups)"
        : `${pathPrefixDisplay(parent.prefix)} (other descendants)`,
    units: overflow.flatMap(({ units }) => units),
    node: null,
  });
  return retained;
}

function synopsisGroups(manifest, maximumGroups) {
  const root = compressedNode(pathTrie(manifest.changeUnits));
  const groups = [nodeGroup(root)];

  for (;;) {
    const available = maximumGroups - groups.length + 1;
    const candidates = groups
      .map((candidate, index) => ({ candidate, index }))
      .filter(
        ({ candidate }) =>
          candidate.node !== null &&
          childGroups(candidate.node).length > 1 &&
          available >= 2,
      )
      .sort(
        (left, right) =>
          right.candidate.units.length - left.candidate.units.length ||
          Buffer.compare(left.candidate.sortKey, right.candidate.sortKey),
      );

    if (candidates.length === 0) {
      break;
    }

    const { candidate, index } = candidates[0];
    const replacements = mergeOverflowGroups(
      childGroups(candidate.node),
      available,
      candidate.node,
    );

    groups.splice(index, 1, ...replacements);
  }

  return groups.sort((left, right) =>
    Buffer.compare(left.sortKey, right.sortKey),
  );
}

function kindSummary(units) {
  const kindCounts = new Map();

  for (const unit of units) {
    kindCounts.set(unit.kind, (kindCounts.get(unit.kind) ?? 0) + 1);
  }

  return [...kindCounts.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
}

function orderedUnits(units) {
  return [...units].sort((left, right) =>
    Buffer.compare(unitPathBytes(left), unitPathBytes(right)),
  );
}

function countedGroupLines(manifest, maximumGroups, maximumSamples) {
  return synopsisGroups(manifest, maximumGroups).map(({ display, units }) => {
    const samples = orderedUnits(units)
      .slice(0, maximumSamples)
      .map(unitPathDisplay)
      .join(", ");

    return `${display}: ${units.length} change units (${kindSummary(units)})${samples ? `; samples ${samples}` : ""}`;
  });
}

function boundedWarning(warning) {
  return safeBoundedText(Buffer.from(String(warning), "utf8"), "warning-bytes");
}

function pathHasInvalidUtf8(unit) {
  const paths = [unitPathBytes(unit)];

  if (unit.sourcePathBytesBase64) {
    paths.push(Buffer.from(unit.sourcePathBytesBase64, "base64"));
  }

  return paths.some((path) => strictUtf8(path) === null);
}

function categoryLine(label, units, maximumSamples) {
  if (units.length === 0) {
    return null;
  }

  const samples = orderedUnits(units)
    .slice(0, maximumSamples)
    .map(unitPathDisplay)
    .join(", ");

  return `${label} (${units.length})${samples ? `: examples ${samples}` : ""}`;
}

function quantityText(value) {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : "unknown";
}

function anomalyLines(manifest, maximumSamples) {
  const categories = [
    categoryLine(
      "Non-UTF-8 paths",
      manifest.changeUnits.filter(pathHasInvalidUtf8),
      maximumSamples,
    ),
    categoryLine(
      "Type or mode changes",
      manifest.changeUnits.filter(({ kind }) =>
        new Set(["mode-changed", "symlink-changed", "type-changed"]).has(kind),
      ),
      maximumSamples,
    ),
    categoryLine(
      "Gitlinks",
      manifest.changeUnits.filter(
        ({ kind, oldMode, newMode }) =>
          kind === "submodule-changed" ||
          oldMode === "160000" ||
          newMode === "160000",
      ),
      maximumSamples,
    ),
    categoryLine(
      "Deferred line statistics",
      manifest.changeUnits.filter(
        ({ lineStatistics }) => lineStatistics === "deferred",
      ),
      maximumSamples,
    ),
  ].filter(Boolean);
  const ambiguousRenames = manifest.changeUnits.filter(
    ({ renameClassification }) =>
      renameClassification === "exact-rename-ambiguous",
  );
  const renamePolicy = manifest.diffPolicy?.rename;

  if (ambiguousRenames.length > 0 || renamePolicy?.mode === "deferred") {
    const samples = orderedUnits(ambiguousRenames)
      .slice(0, maximumSamples)
      .map(unitPathDisplay)
      .join(", ");

    categories.push(
      `Rename ambiguity or deferred detection: ambiguous=${ambiguousRenames.length}, policy=${renamePolicy?.mode ?? "unknown"}, candidate-pairs=${quantityText(renamePolicy?.candidatePairs)}, maximum=${quantityText(renamePolicy?.maximumCandidatePairs)}${samples ? `; examples ${samples}` : ""}`,
    );
  }

  const linePolicy = manifest.diffPolicy?.lineStatistics;

  if (linePolicy?.mode === "deferred") {
    categories.push(
      `Objects above eager-analysis budget: eligible blob bytes=${quantityText(linePolicy.eligibleBlobBytes)}, maximum=${quantityText(linePolicy.maximumEagerBytes)}`,
    );
  }

  if (Array.isArray(manifest.warnings) && manifest.warnings.length > 0) {
    categories.push(
      `Other deterministic anomalies (${manifest.warnings.length}): ${manifest.warnings
        .slice(0, maximumSamples)
        .map(boundedWarning)
        .join(", ")}`,
    );
  }

  return categories;
}

function bulkSynopsis(manifest, digest) {
  const kinds = new Map();
  let deferredStatistics = 0;
  let binaryFiles = 0;

  for (const unit of manifest.changeUnits) {
    kinds.set(unit.kind, (kinds.get(unit.kind) ?? 0) + 1);
    deferredStatistics += unit.lineStatistics === "deferred" ? 1 : 0;
    binaryFiles += unit.binary ? 1 : 0;
  }

  const kindSummary = [...kinds.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
  const fixedLines = [
    `${manifest.changeUnitCount} change units; manifest ${digest}`,
    `Kinds: ${kindSummary}`,
    `Statistics: additions=${serializedStatistic(manifest.statistics?.additions)}, deletions=${serializedStatistic(manifest.statistics?.deletions)}, binary=${binaryFiles}, deferred=${deferredStatistics}`,
  ];

  for (
    let maximumGroups = MAXIMUM_SYNOPSIS_GROUPS;
    maximumGroups >= 1;
    maximumGroups -= 1
  ) {
    for (
      let maximumSamples = MAXIMUM_GROUP_SAMPLES;
      maximumSamples >= 0;
      maximumSamples -= 1
    ) {
      const lines = [
        ...fixedLines,
        ...countedGroupLines(manifest, maximumGroups, maximumSamples),
        ...anomalyLines(manifest, maximumSamples),
      ];
      const text = lines.join("\n");

      if (Buffer.byteLength(text, "utf8") <= MAXIMUM_BULK_SYNOPSIS_BYTES) {
        return text;
      }
    }
  }

  return [...fixedLines, ...anomalyLines(manifest, 0)].join("\n");
}

export function createScopeSynopsis(manifest) {
  if (
    !manifest ||
    !Array.isArray(manifest.changeUnits) ||
    manifest.changeUnitCount !== manifest.changeUnits.length
  ) {
    throw new Error("A scope synopsis requires an exact manifest.");
  }

  const digest = manifestDigest(manifest);
  const text =
    typeof manifest.scopeSynopsis === "string"
      ? manifest.scopeSynopsis
      : manifest.changeUnitCount < 50
        ? exactSynopsis(manifest, digest)
        : bulkSynopsis(manifest, digest);

  return {
    text,
    manifestSha256: digest,
    changeUnitCount: manifest.changeUnitCount,
    detailed: manifest.changeUnitCount < 50,
  };
}

function groupEvidenceBytes(manifest, evidencePlan, group) {
  const sources = [
    group.patchBytes,
    evidencePlan.evidenceByGroupId?.[group.id],
    manifest.evidenceByGroupId?.[group.id],
  ];
  const direct = sources.find((value) => value !== undefined);

  if (direct !== undefined) {
    if (Buffer.isBuffer(direct)) {
      return direct;
    }

    if (direct instanceof Uint8Array) {
      return Buffer.from(direct);
    }

    if (typeof direct === "string") {
      return Buffer.from(direct, "utf8");
    }

    throw new Error(`Evidence for ${group.id} must be bytes or text.`);
  }

  const byUnit = manifest.evidenceByChangeUnitId;

  if (byUnit && Array.isArray(group.changeUnitIds)) {
    const parts = [];

    for (const id of group.changeUnitIds) {
      const value = byUnit[id];

      if (value === undefined) {
        return null;
      }

      parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
    }

    return Buffer.concat(parts);
  }

  return null;
}

function selectionSummary(group) {
  const selection = group.selection;

  if (selection.all === true) {
    return `all ${group.changeUnitCount} change units`;
  }

  if (selection.remaining === true) {
    return `remaining ${group.changeUnitCount} change units`;
  }

  const fields = Object.entries(selection)
    .filter(([, value]) => Array.isArray(value) && value.length > 0)
    .map(([name, value]) => `${name}=${value.join(",")}`);

  return `${fields.join("; ")} (${group.changeUnitCount} change units)`;
}

function completeResultByteCount(capsule) {
  let byteCount = 0;

  for (;;) {
    const candidate = {
      route: "concise",
      capsule: { ...capsule, byteCount },
      extendedReason: null,
    };
    const measured = Buffer.byteLength(JSON.stringify(candidate), "utf8");

    if (measured === byteCount) {
      return measured;
    }

    byteCount = measured;
  }
}

function extended(reason) {
  return { route: "extended", capsule: null, extendedReason: reason };
}

function manifestExtendedReason(manifest) {
  if (
    manifest.warnings?.some((warning) =>
      String(warning).startsWith("required-object-unavailable:"),
    )
  ) {
    return "required-object-unavailable";
  }

  if (manifest.warnings?.length > 0) {
    return "unresolved-anomaly";
  }

  return null;
}

export function createInlineEvidenceCapsule({
  manifest,
  evidencePlan,
  maximumResultBytes = MAXIMUM_CONCISE_RESULT_BYTES,
}) {
  if (!Number.isSafeInteger(maximumResultBytes) || maximumResultBytes < 1) {
    throw new Error("maximumResultBytes must be a positive safe integer.");
  }

  if (
    !evidencePlan ||
    evidencePlan.manifestSha256 !== manifestDigest(manifest) ||
    !Array.isArray(evidencePlan.groups)
  ) {
    throw new Error("Evidence plan does not match the exact manifest.");
  }

  if (evidencePlan.groups.some(({ policy }) => policy === "review")) {
    return extended("review-policy");
  }

  const anomalyReason = manifestExtendedReason(manifest);

  if (anomalyReason !== null) {
    return extended(anomalyReason);
  }

  const synopsis = createScopeSynopsis(manifest);
  const evidence = [];

  for (const group of evidencePlan.groups) {
    if (group.policy === "reuse") {
      evidence.push({
        policy: group.policy,
        selectionSummary: selectionSummary(group),
        basisKind: group.basis.kind,
        basisNote: group.basis.note,
        patchText: null,
        patchComplete: true,
      });
      continue;
    }

    const bytes = groupEvidenceBytes(manifest, evidencePlan, group);

    if (bytes === null) {
      return extended("required-object-unavailable");
    }

    const patchText = strictUtf8(bytes);

    if (patchText === null) {
      return extended("invalid-evidence-encoding");
    }

    evidence.push({
      policy: group.policy,
      selectionSummary: selectionSummary(group),
      basisKind: group.basis.kind,
      basisNote: group.basis.note,
      patchText,
      patchComplete: true,
    });
  }

  const capsule = {
    schemaVersion: 1,
    manifestSha256: synopsis.manifestSha256,
    evidencePlanSha256: evidencePlan.evidencePlanSha256,
    changeUnitCount: manifest.changeUnitCount,
    scopeSynopsis: synopsis.text,
    evidence,
    unresolved: [],
    byteCount: 0,
  };
  const byteCount = completeResultByteCount(capsule);
  const synopsisOnly = {
    ...capsule,
    evidence: evidence.map((entry) => ({
      ...entry,
      patchText: null,
      patchComplete: entry.policy === "reuse",
    })),
  };
  const synopsisOnlyBytes = completeResultByteCount(synopsisOnly);

  if (byteCount > maximumResultBytes) {
    return extended(
      synopsisOnlyBytes > maximumResultBytes
        ? "scope-synopsis-over-budget"
        : "required-evidence-over-budget",
    );
  }

  capsule.byteCount = byteCount;
  return { route: "concise", capsule, extendedReason: null };
}
