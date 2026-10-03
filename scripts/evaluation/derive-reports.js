import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  assertTransmissionPacket,
  canonicalJsonBytes,
  sha256Hex,
} from "./runtime.js";
import { assertRegularPath } from "./toolchain.js";

/** One-way public reference. Never exports prompts, transcripts or arm mapping. */
export function deriveOutcomeReference({
  path,
  profile,
  transmissionSha256,
  evidenceLayout = "legacy-v1",
}) {
  assertRegularPath(path);
  const bytes = readFileSync(path);
  const record = JSON.parse(bytes);
  if (!canonicalJsonBytes(record).equals(bytes))
    throw new Error("Authoritative outcome is not canonical");
  if (!["legacy-v1", "evaluation-trial-v1"].includes(evidenceLayout))
    throw new Error("Unknown authoritative evidence layout");
  const status =
    evidenceLayout === "evaluation-trial-v1"
      ? record.executionStatus
      : record.status;
  if (
    record.schemaVersion !== 1 ||
    (evidenceLayout === "evaluation-trial-v1" &&
      record.artifactType !== "evaluation-trial-result") ||
    record.transmissionSha256 !== transmissionSha256 ||
    !["completed", "failed"].includes(status)
  )
    throw new Error("Authoritative outcome identity/status mismatch");
  if (
    !record.closure ||
    !["safe", "unsafe", "indeterminate"].includes(record.closure.status)
  )
    throw new Error("Missing authoritative closure evidence");
  if (
    !record.artifacts ||
    typeof record.artifacts !== "object" ||
    Array.isArray(record.artifacts) ||
    !record.artifacts["packet.json"] ||
    !record.artifacts["inputs/manifest.json"]
  )
    throw new Error("Missing authoritative artifact inventory");
  for (const [relativePath, identity] of Object.entries(record.artifacts)) {
    if (
      relativePath.includes("\\") ||
      relativePath.includes(":") ||
      relativePath
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Unsafe authoritative artifact path");
    const artifactPath = join(dirname(path), ...relativePath.split("/"));
    assertRegularPath(artifactPath);
    const artifact = readFileSync(artifactPath);
    if (
      artifact.length !== identity.byteLength ||
      sha256Hex(artifact) !== identity.sha256
    )
      throw new Error(`Authoritative artifact drift: ${relativePath}`);
  }
  const packet = JSON.parse(
    readFileSync(join(dirname(path), "packet.json"), "utf8"),
  );
  assertTransmissionPacket(packet);
  if (packet.transmissionSha256 !== transmissionSha256)
    throw new Error("Authoritative packet identity mismatch");
  if (status === "completed" && record.closure.status !== "safe")
    throw new Error("Completed outcome lacks safe closure");
  return Object.freeze({
    schemaVersion: 1,
    artifactType: "hadden-outcome-reference",
    profile,
    caseId: packet.transmission.session.caseId,
    preparedSessionId: packet.transmission.session.preparedSessionId,
    transmissionSha256,
    authoritativeSha256: sha256Hex(bytes),
    status,
    closureStatus: record.closure.status,
    failureClass: record.failureClass ?? null,
    grading: "not-graded",
  });
}
