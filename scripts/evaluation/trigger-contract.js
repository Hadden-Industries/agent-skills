import { canonicalJsonBytes, sha256Hex } from "./runtime.js";

export function projectTriggerDataset(entries) {
  if (!Array.isArray(entries) || !entries.length)
    throw new Error("Trigger dataset must be nonempty");
  const seen = new Set();
  for (const entry of entries) {
    if (
      !entry ||
      Object.keys(entry).sort().join(",") !== "query,should_trigger" ||
      typeof entry.query !== "string" ||
      !entry.query.trim() ||
      typeof entry.should_trigger !== "boolean"
    )
      throw new Error("Invalid trigger dataset entry");
    const key = entry.query
      .normalize("NFKC")
      .trim()
      .replace(/\s+/gu, " ")
      .toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate normalized trigger query");
    seen.add(key);
  }
  return Object.freeze({
    schemaVersion: 1,
    evidenceCategory: "dataset-conformance",
    datasetSha256: sha256Hex(canonicalJsonBytes(entries)),
    entries: entries.map((entry) => Object.freeze({ ...entry })),
    establishesActivation: false,
  });
}

export function classifyTriggerObservation(record) {
  if (record?.evidenceCategory === "selection-diagnostic")
    return Object.freeze({
      status: "diagnostic-only",
      establishesActivation: false,
    });
  if (record?.evidenceCategory !== "host-activation-experiment")
    throw new Error("Unknown trigger evidence category");
  for (const key of [
    "host",
    "hostVersion",
    "provider",
    "model",
    "effort",
    "installedArtifactSha256",
    "query",
    "querySet",
    "observationContract",
  ]) {
    if (typeof record[key] !== "string" || !record[key].trim())
      throw new Error(`Host observation requires ${key}`);
  }
  if (
    !/^[a-f0-9]{64}$/u.test(record.installedArtifactSha256) ||
    !["original", "held-out"].includes(record.querySet) ||
    !Number.isSafeInteger(record.repetition) ||
    record.repetition < 1 ||
    !Array.isArray(record.competingSkills) ||
    !record.environmentPolicy ||
    !record.capabilityPolicy ||
    !Array.isArray(record.loadEvidence) ||
    typeof record.answer !== "string"
  )
    throw new Error("Incomplete host observation context");
  if (!["completed", "failed", "unknown"].includes(record.status))
    throw new Error("Unknown host observation status");
  const observed = record.loadEvidence.some(
    (event) =>
      event?.type === "skill-loaded" &&
      event.artifactSha256 === record.installedArtifactSha256 &&
      typeof event.source === "string" &&
      event.source.length > 0,
  );
  return Object.freeze({
    status:
      record.status === "failed"
        ? "failed"
        : observed
          ? "observed-load"
          : "unknown",
    establishesActivation: record.status === "completed" && observed,
  });
}
