import { createHash } from "node:crypto";

// Legacy command-only inspection artifacts and acknowledgements. High-level
// workflows use the immutable review catalog and packet queue instead.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const MAX_CHUNK_LINES = 200;
export const MAX_CHUNK_BYTES = 16 * 1024;

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function utf8SafeBoundary(buffer, start, end) {
  const isContinuation = (byte) => byte >= 0x80 && byte <= 0xbf;

  if (end >= buffer.length || end <= start || !isContinuation(buffer[end])) {
    return end;
  }

  let boundary = end;

  while (boundary > start && isContinuation(buffer[boundary])) {
    boundary -= 1;
  }

  return boundary > start ? boundary : end;
}

export function splitPatch(buffer) {
  const chunks = [];

  for (let start = 0; start < buffer.length;) {
    let end = start;
    let newlineCount = 0;

    while (end < buffer.length && end - start < MAX_CHUNK_BYTES) {
      if (buffer[end] === 10) {
        newlineCount += 1;
      }

      end += 1;

      if (newlineCount === MAX_CHUNK_LINES) {
        break;
      }
    }

    const lastNewline = buffer.lastIndexOf(10, end - 1);

    if (lastNewline >= start) {
      end = lastNewline + 1;
    } else {
      end = utf8SafeBoundary(buffer, start, end);
    }

    const payload = buffer.subarray(start, end);
    newlineCount = 0;

    for (const byte of payload) {
      if (byte === 10) {
        newlineCount += 1;
      }
    }

    const endsWithNewline = payload[payload.length - 1] === 10;
    const lineCount = newlineCount + (endsWithNewline ? 0 : 1);

    chunks.push({ payload, start, end, lineCount });
    start = end;
  }

  return chunks;
}

export function isWholeDeletion(unit) {
  return unit?.oldMode !== "000000" && unit?.newMode === "000000";
}

export function writeInspection({ outputDir, manifest, patch }) {
  const chunksDir = join(outputDir, "chunks");
  const deletionsDir = join(outputDir, "deletions");
  const inventoryDir = join(outputDir, "inventory");
  const metadataDir = join(outputDir, "metadata");
  const chunks = splitPatch(patch);
  const summarizedDeletions = manifest.changeUnits.filter(isWholeDeletion);
  const summarizedTextDeletionLines = summarizedDeletions.reduce(
    (total, unit) =>
      total +
      (!unit.binary &&
      unit.oldMode !== "160000" &&
      Number.isInteger(unit.deletions)
        ? unit.deletions
        : 0),
    0,
  );

  mkdirSync(outputDir);
  mkdirSync(chunksDir);
  mkdirSync(deletionsDir);
  mkdirSync(inventoryDir);
  mkdirSync(metadataDir);

  const inventoryPayload = Buffer.from(
    [
      "# Commit snapshot change inventory",
      "",
      ...manifest.changeUnits.map((unit) => {
        const statistics = unit.binary
          ? "binary/unavailable"
          : `+${unit.additions}/-${unit.deletions}`;

        const deletionSummary = isWholeDeletion(unit)
          ? `; historical body summarized; old object ${unit.oldOid}; mode ${unit.oldMode}`
          : "";

        return `- \`${unit.id}\` ${unit.kind}: ${unit.displayPath} -- ${statistics}${deletionSummary}`;
      }),
      "",
    ].join("\n"),
  );
  const inventoryUnits = splitPatch(inventoryPayload).map(
    ({ payload, start, end, lineCount }, index) => {
      const id = `I${String(index + 1).padStart(6, "0")}`;
      const artifact = `inventory/${id}.md`;

      writeFileSync(join(outputDir, artifact), payload);

      return {
        id,
        kind: "inventory-page",
        artifact,
        byteStart: start,
        byteEnd: end,
        byteCount: payload.length,
        lineCount,
        sha256: sha256(payload),
        status: "pending",
      };
    },
  );

  const textUnits = chunks.map(({ payload, start, end, lineCount }, index) => {
    const id = `C${String(index + 1).padStart(6, "0")}`;
    const artifact = `chunks/${id}.patch`;

    writeFileSync(join(outputDir, artifact), payload);

    return {
      id,
      kind: "text-patch",
      artifact,
      byteStart: start,
      byteEnd: end,
      byteCount: payload.length,
      lineCount,
      sha256: sha256(payload),
      status: "pending",
    };
  });
  const metadataUnits = manifest.changeUnits
    .filter((unit) => unit.binary || unit.kind === "submodule-changed")
    .map((unit, index) => {
      const id = `M${String(index + 1).padStart(6, "0")}`;
      const kind = unit.binary ? "binary" : "submodule";
      const artifact = `metadata/${id}.json`;
      const metadata = unit.binary
        ? {
            changeUnitId: unit.id,
            kind,
            path: unit.destinationPath,
            additions: null,
            deletions: null,
          }
        : {
            changeUnitId: unit.id,
            kind,
            path: unit.destinationPath,
            oldOid: unit.oldOid,
            newOid: unit.newOid,
          };
      const payload = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);

      writeFileSync(join(outputDir, artifact), payload);

      return {
        id,
        kind: unit.binary ? "binary-metadata" : "submodule-metadata",
        artifact,
        byteStart: 0,
        byteEnd: payload.length,
        byteCount: payload.length,
        lineCount: payload.toString("utf8").split("\n").length - 1,
        sha256: sha256(payload),
        status: "pending",
      };
    });
  const units = [...inventoryUnits, ...textUnits, ...metadataUnits];

  const ledger = {
    schemaVersion: 2,
    indexTreeOid: manifest.indexTreeOid,
    reviewPatchSha256: sha256(patch),
    reviewPatchBytes: patch.length,
    summarizedDeletionCount: summarizedDeletions.length,
    summarizedTextDeletionLines,
    expandedDeletions: [],
    unitCount: units.length,
    reviewedCount: 0,
    complete: units.length === 0,
    units,
  };

  const inventory = [
    "# Commit snapshot inventory",
    "",
    `- Index tree: \`${manifest.indexTreeOid}\``,
    `- File change units: ${manifest.changeUnitCount}`,
    `- Required patch bytes: ${patch.length}`,
    `- Inventory pages: ${inventoryUnits.length}`,
    `- Required text chunks: ${textUnits.length}`,
    `- Summarized whole-file deletions: ${summarizedDeletions.length} (${summarizedTextDeletionLines} text lines)`,
    `- Metadata units: ${metadataUnits.length}`,
    "",
    "Process one pending artifact at a time:",
    "1. Read exactly one pending artifact in a dedicated tool action.",
    "2. Confirm that the complete artifact was returned without truncation.",
    "3. Then acknowledge its recorded ID and SHA-256 before reading the next artifact.",
    "Tool output limits apply to the combined response, so batching or parallel reads can truncate evidence before review.",
    "",
    "Whole-file deletion bodies are summarized by default. Run `inspection expand-deletion` for a specific change unit when its historical content is needed to ground the rationale or assess its effect.",
    "",
  ].join("\n");

  writeFileSync(join(outputDir, "inventory.md"), inventory);
  writeFileSync(
    join(outputDir, "ledger.json"),
    `${JSON.stringify(ledger, null, 2)}\n`,
  );

  return ledger;
}

export function expandDeletionInspection({ ledgerPath, changeUnit, content }) {
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));

  if (ledger.schemaVersion !== 2) {
    throw new Error(
      "Deletion expansion requires an inspection ledger version 2.",
    );
  }

  if (
    ledger.expandedDeletions.some(
      ({ changeUnitId }) => changeUnitId === changeUnit.id,
    )
  ) {
    throw new Error(`Deletion ${changeUnit.id} was already expanded.`);
  }

  const inspectionDir = dirname(ledgerPath);
  const deletionDir = join(inspectionDir, "deletions", changeUnit.id);
  const chunks = splitPatch(content);

  mkdirSync(deletionDir);

  const units = chunks.map(({ payload, start, end, lineCount }, index) => {
    const ordinal = `D${String(index + 1).padStart(6, "0")}`;
    const id = `${changeUnit.id}-${ordinal}`;
    const artifact = `deletions/${changeUnit.id}/${ordinal}.deleted`;

    writeFileSync(join(inspectionDir, artifact), payload);

    return {
      id,
      kind: "deleted-content",
      changeUnitId: changeUnit.id,
      artifact,
      byteStart: start,
      byteEnd: end,
      byteCount: payload.length,
      lineCount,
      sha256: sha256(payload),
      status: "pending",
    };
  });
  const expansion = {
    changeUnitId: changeUnit.id,
    oldOid: changeUnit.oldOid,
    byteCount: content.length,
    sha256: sha256(content),
    unitIds: units.map(({ id }) => id),
  };

  ledger.expandedDeletions.push(expansion);
  ledger.units.push(...units);
  ledger.unitCount = ledger.units.length;
  ledger.reviewedCount = ledger.units.filter(
    ({ status }) => status === "reviewed",
  ).length;
  ledger.complete = ledger.reviewedCount === ledger.unitCount;
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  return { ledger, expansion, units };
}

export function acknowledgeInspection({ ledgerPath, id, expectedSha256 }) {
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const unit = ledger.units.find((candidate) => candidate.id === id);

  if (!unit) {
    throw new Error(`Unknown inspection unit ${id}.`);
  }

  const artifactPath = join(dirname(ledgerPath), unit.artifact);
  const actualSha256 = sha256(readFileSync(artifactPath));

  if (actualSha256 !== unit.sha256 || actualSha256 !== expectedSha256) {
    throw new Error(`Inspection unit ${id} changed after it was generated.`);
  }

  unit.status = "reviewed";
  ledger.reviewedCount = ledger.units.filter(
    ({ status }) => status === "reviewed",
  ).length;
  ledger.complete = ledger.reviewedCount === ledger.unitCount;
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  return ledger;
}
